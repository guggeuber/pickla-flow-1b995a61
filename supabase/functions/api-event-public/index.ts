import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/auth.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';

  try {
    const client = getServiceClient();

    // GET /api-event-public/detail?id=X or ?slug=X — public event info
    if (req.method === 'GET' && path === 'detail') {
      const id = url.searchParams.get('id');
      const slug = url.searchParams.get('slug');
      if (!id && !slug) return errorResponse('Missing id or slug');

      const selectFields = 'id, name, display_name, description, event_type, format, category, start_date, end_date, start_time, end_time, entry_fee, entry_fee_type, status, logo_url, background_url, primary_color, secondary_color, number_of_courts, points_to_win, best_of, scoring_type, competition_type, player_info_general, whatsapp_url, is_drop_in, registration_fields, slug, venue_id, template_id, venues(id, name, address, city)';

      let query = client.from('events').select(selectFields).eq('is_public', true);
      if (slug) {
        query = query.eq('slug', slug);
      } else {
        query = query.eq('id', id!);
      }

      const { data, error: qErr } = await query.single();
      if (qErr) return errorResponse('Event not found', 404);

      // Get player count, category config, event pricing, template, courts, and tier pricing in parallel
      const [playerResult, catResult, pricingResult, templateResult, courtsResult, tierPricingResult] = await Promise.all([
        client.from('players')
          .select('id', { count: 'exact', head: true })
          .eq('event_id', data.id),
        data.venue_id
          ? client.from('venue_event_categories')
              .select('*')
              .eq('venue_id', data.venue_id)
              .eq('category_key', data.category)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        data.venue_id
          ? client.from('pricing_rules')
              .select('id, name, price, vat_rate')
              .eq('venue_id', data.venue_id)
              .eq('type', 'event')
              .eq('is_active', true)
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        data.template_id
          ? client.from('event_templates')
              .select('id, name, entry_fee, currency, vat_rate, logo_url, display_name')
              .eq('id', data.template_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        client.from('event_courts')
          .select('venue_court_id, venue_courts(id, name, court_number)')
          .eq('event_id', data.id),
        data.venue_id
          ? client.from('membership_tier_pricing')
              .select('tier_id, product_type, fixed_price, discount_percent, label, membership_tiers(id, name, color, sort_order)')
              .in('product_type', ['event_fee', 'day_pass'])
          : Promise.resolve({ data: null }),
      ]);

      const categoryConfig = catResult.data || null;
      const eventPricing = pricingResult.data || null;
      const template = templateResult.data || null;

      // Template pricing takes precedence over venue pricing rules
      const effectivePricing = template && template.entry_fee != null && template.entry_fee > 0
        ? { price: template.entry_fee, vat_rate: template.vat_rate || 6, source: 'template', currency: template.currency || 'SEK' }
        : data.entry_fee != null && data.entry_fee > 0
          ? { price: data.entry_fee, vat_rate: 6, source: 'event', currency: 'SEK' }
          : eventPricing
            ? { ...eventPricing, source: 'venue_rule' }
            : null;

      // Build tier pricing map
      const tierPricing = (tierPricingResult.data || []).map((tp: any) => ({
        tier_id: tp.tier_id,
        tier_name: tp.membership_tiers?.name || '',
        tier_color: tp.membership_tiers?.color || '#666',
        sort_order: tp.membership_tiers?.sort_order || 0,
        product_type: tp.product_type,
        fixed_price: tp.fixed_price,
        discount_percent: tp.discount_percent,
        label: tp.label,
      }));

      return jsonResponse({
        ...data,
        player_count: playerResult.count || 0,
        category_config: categoryConfig,
        event_pricing: effectivePricing,
        template,
        event_courts: (courtsResult.data || []).map((c: any) => c.venue_courts || { id: c.venue_court_id }),
        tier_pricing: tierPricing,
      }, 200, 5);
    }

    // GET /api-event-public/list?venueId=X — list public events
    if (req.method === 'GET' && path === 'list') {
      const venueId = url.searchParams.get('venueId');
      const category = url.searchParams.get('category');
      const excludeId = url.searchParams.get('excludeId');
      const today = url.searchParams.get('today'); // pass 'true' to filter today's events

      let query = client.from('events')
        .select('id, name, display_name, category, start_date, end_date, start_time, end_time, entry_fee, entry_fee_type, status, logo_url, primary_color, is_drop_in, format, venue_id, venues(id, name)')
        .eq('is_public', true)
        .in('status', ['active', 'upcoming', 'in_progress'])
        .order('start_date', { ascending: true })
        .limit(20);

      if (venueId) query = query.eq('venue_id', venueId);
      if (category) query = query.eq('category', category);
      if (excludeId) query = query.neq('id', excludeId);

      const { data, error: qErr } = await query;
      if (qErr) return errorResponse(qErr.message);

      return jsonResponse(data, 200, 10);
    }

    // POST /api-event-public/group-inquiry — lightweight public lead for corporate/group bookings
    if (req.method === 'POST' && path === 'group-inquiry') {
      const body = await req.json();
      const {
        slug,
        eventType,
        participants,
        preferredDate,
        preferredTime,
        activities,
        resources,
        name,
        email,
        phone,
        notes,
      } = body;

      if (!slug) return errorResponse('Missing slug');
      if (!name || String(name).trim().length < 2) return errorResponse('Missing name');
      if (!phone || String(phone).trim().length < 5) return errorResponse('Missing phone');
      if (email && String(email).length > 255) return errorResponse('Email too long');

      const participantCount = Math.max(1, Math.min(Number(participants || 1), 500));
      const requestedDate = typeof preferredDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(preferredDate)
        ? preferredDate
        : null;
      const selectedActivities = Array.isArray(activities)
        ? activities.map((value: unknown) => String(value).trim()).filter(Boolean).slice(0, 12)
        : [];
      const selectedResources = Array.isArray(resources)
        ? resources.map((value: unknown) => String(value).trim()).filter(Boolean).slice(0, 12)
        : [];
      const resourceList = Array.from(new Set([...selectedActivities, ...selectedResources]));
      const normalizedType = String(eventType || 'company');
      const typeLabelMap: Record<string, string> = {
        company: 'Företagsevent',
        team: 'Teamaktivitet',
        birthday: 'Födelsedag',
        bachelorette: 'Möhippa / svensexa',
        private: 'Privat grupp',
        other: 'Gruppbokning',
      };
      const timeMap: Record<string, string> = {
        morning: '10:00',
        lunch: '12:00',
        afternoon: '15:00',
        evening: '18:00',
      };
      const typeLabel = typeLabelMap[normalizedType] || 'Gruppbokning';
      const timeLabel = String(preferredTime || '').trim();
      const startTime = timeMap[timeLabel] || (/^\d{2}:\d{2}$/.test(timeLabel) ? timeLabel : null);
      const cleanName = String(name).trim().slice(0, 160);
      const cleanPhone = String(phone).trim().slice(0, 50);
      const cleanEmail = email ? String(email).trim().slice(0, 255) : null;
      const cleanNotes = notes ? String(notes).trim().slice(0, 1200) : '';

      const { data: venue, error: venueErr } = await client.from('venues')
        .select('id, name')
        .eq('slug', slug)
        .eq('is_public', true)
        .maybeSingle();
      if (venueErr || !venue) return errorResponse('Venue not found', 404);

      const partnerNotes = [
        `Källa: publik gruppbokningsförfrågan`,
        `Typ: ${typeLabel}`,
        `Önskat datum: ${requestedDate || 'Flexibelt'}`,
        `Önskad tid: ${timeLabel || 'Flexibelt'}`,
        `Aktiviteter/resurser: ${resourceList.length ? resourceList.join(', ') : 'Ej valt'}`,
        `Kontakt: ${cleanName}${cleanEmail ? ` · ${cleanEmail}` : ''} · ${cleanPhone}`,
        cleanNotes ? `Övrigt: ${cleanNotes}` : null,
      ].filter(Boolean).join('\n');

      const { data: event, error: insertErr } = await client.from('events').insert({
        venue_id: venue.id,
        name: `${typeLabel} · ${cleanName}`,
        display_name: `${typeLabel} · ${participantCount} pers`,
        event_type: 'corporate_event',
        format: 'custom',
        category: 'corporate',
        status: 'upcoming',
        is_public: false,
        planning_status: 'inquiry',
        visibility: 'internal',
        number_of_courts: 1,
        start_date: requestedDate,
        end_date: requestedDate,
        start_time: startTime,
        end_time: null,
        customer_name: cleanName,
        customer_email: cleanEmail,
        customer_phone: cleanPhone,
        expected_participants: participantCount,
        owner_name: null,
        partner_notes: partnerNotes,
        internal_notes: cleanNotes || null,
        resources: resourceList,
      }).select('id').single();

      if (insertErr) return errorResponse(insertErr.message, 500);

      return jsonResponse({ success: true, event_id: event.id }, 201);
    }

    // POST /api-event-public/register — register a player + auto-create account
    if (req.method === 'POST' && path === 'register') {
      const body = await req.json();
      const { eventId, name, phone, email, level } = body;

      if (!eventId || !name) return errorResponse('Missing eventId or name');
      if (name.length > 100) return errorResponse('Name too long');
      if (phone && phone.length > 20) return errorResponse('Phone too long');
      if (email && email.length > 255) return errorResponse('Email too long');

      // Check event exists and is public
      const { data: event, error: evErr } = await client.from('events')
        .select('id, status, is_drop_in')
        .eq('id', eventId)
        .eq('is_public', true)
        .single();

      if (evErr || !event) return errorResponse('Event not found', 404);
      if (event.status === 'completed') return errorResponse('Event is completed');

      // Check duplicate registration
      const identifier = phone?.trim() || email?.trim() || null;
      if (identifier) {
        const { data: existing } = await client.from('players')
          .select('id')
          .eq('event_id', eventId)
          .eq('email', identifier)
          .maybeSingle();
        if (existing) return errorResponse('Redan anmäld');
      } else {
        const { data: existing } = await client.from('players')
          .select('id')
          .eq('event_id', eventId)
          .eq('name', name.trim())
          .maybeSingle();
        if (existing) return errorResponse('Redan anmäld med detta namn');
      }

      // Auto-create auth account with phone as identifier
      let authUserId: string | null = null;
      if (phone) {
        const { data: existingProfile } = await client.from('player_profiles')
          .select('auth_user_id')
          .eq('phone', phone)
          .maybeSingle();

        if (existingProfile) {
          authUserId = existingProfile.auth_user_id;
        } else if (email) {
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const adminClient = createClient(supabaseUrl, serviceKey, {
            auth: { autoRefreshToken: false, persistSession: false },
          });

          const { data: newUser, error: authErr } = await adminClient.auth.admin.createUser({
            email,
            phone,
            user_metadata: { display_name: name.trim() },
            email_confirm: true,
          });

          if (!authErr && newUser?.user) {
            authUserId = newUser.user.id;
            await client.from('player_profiles')
              .update({ phone: phone.trim(), display_name: name.trim() })
              .eq('auth_user_id', authUserId);
          }
        }
      }

      const { data: player, error: insErr } = await client.from('players')
        .insert({
          event_id: eventId,
          name: name.trim(),
          email: phone?.trim() || email?.trim() || null,
          auth_user_id: authUserId,
        })
        .select()
        .single();

      if (insErr) return errorResponse(insErr.message);

      return jsonResponse({ success: true, player }, 201);
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
