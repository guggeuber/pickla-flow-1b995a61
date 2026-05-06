import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { generateAccessCode, getOrCreatePublicBookingUserId } from '../_shared/bookings.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DateTime } from 'https://esm.sh/luxon@3.5.0';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';

  // ── POST /create-checkout — create a Stripe Checkout Session (no auth required) ──
  if (req.method === 'POST' && path === 'create-checkout') {
    const body = await req.json();
    const { product_type, amount_sek, venue_id, metadata } = body;

    if (!product_type || !amount_sek) return errorResponse('Missing required fields');
    if (!['court_booking', 'day_pass', 'membership'].includes(product_type)) return errorResponse('Invalid product_type');
    if (typeof amount_sek !== 'number' || amount_sek <= 0) return errorResponse('amount_sek must be positive');
    // venue_id required for court_booking and day_pass, optional for membership
    if (product_type !== 'membership' && !venue_id) return errorResponse('Missing venue_id');

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) return errorResponse('Stripe not configured', 500);

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

    // Derive base URL from request Origin to support multiple environments
    const origin = req.headers.get('origin') || 'http://localhost:8080';

    const meta = metadata || {};
    const isMembership = product_type === 'membership';

    // ── Entitlement check — apply discounts / check limits ───────────────────
    // user_id is set in metadata by the frontend from useAuth(); membership
    // benefits are applied here. Hard cap (Founder 4h/week) blocks checkout.
    let finalAmountSek = amount_sek;
    let entitlementUserId = meta.user_id || '';

    if (!entitlementUserId) {
      const authHeader = req.headers.get('authorization') || '';
      if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice('Bearer '.length);
        const { data: { user: authUser } } = await getServiceClient().auth.getUser(token);
        entitlementUserId = authUser?.id || '';
        if (entitlementUserId) meta.user_id = entitlementUserId;
      }
    }

    if (entitlementUserId && !isMembership && venue_id) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const adminEnt = createClient(supabaseUrl, serviceKey);
      let entitlementSportType: string | null = product_type === 'day_pass' ? 'pickleball' : null;

      if (product_type === 'court_booking' && meta.court_ids) {
        let courtIds: string[] = [];
        try { courtIds = JSON.parse(meta.court_ids || '[]'); } catch { courtIds = []; }

        if (courtIds.length > 0) {
          const { data: courtsForEntitlement } = await adminEnt
            .from('venue_courts')
            .select('sport_type')
            .in('id', courtIds);
          const sportTypes = [...new Set((courtsForEntitlement || []).map((c: any) => c.sport_type || 'pickleball'))];
          entitlementSportType = sportTypes.length === 1 ? sportTypes[0] : null;
        }
      }

      // Fetch active membership + entitlements
      const { data: membership } = await adminEnt
        .from('memberships')
        .select('id, tier_id, venue_id')
        .eq('user_id', entitlementUserId)
        .eq('venue_id', venue_id)
        .eq('status', 'active')
        .maybeSingle();

      if (membership?.tier_id) {
        const { data: entitlements } = await adminEnt
          .from('membership_entitlements')
          .select('entitlement_type, value, period, sport_type')
          .eq('tier_id', membership.tier_id);

        const ents = (entitlements || []).filter((e: any) =>
          entitlementSportType && (e.sport_type || 'pickleball') === entitlementSportType
        );
        const hasEnt = (type: string) => ents.find((e: any) => e.entitlement_type === type);
        const pricingProductType = product_type === 'court_booking' ? 'court_hourly' : product_type;
        const { data: tierPricingRows } = await adminEnt
          .from('membership_tier_pricing')
          .select('product_type, fixed_price, discount_percent')
          .eq('tier_id', membership.tier_id)
          .eq('product_type', pricingProductType);
        const tierPricing = entitlementSportType === 'pickleball' ? (tierPricingRows || [])[0] : null;

        const applyTierPricing = (baseAmount: number) => {
          if (!tierPricing) return baseAmount;

          if (tierPricing.fixed_price != null) {
            if (product_type === 'court_booking') {
              let courtIds: string[] = [];
              try { courtIds = JSON.parse(meta.court_ids || '[]'); } catch { courtIds = []; }
              const durationHours = parseFloat(meta.duration_hours || '1') || 1;
              return Math.round(Number(tierPricing.fixed_price) * Math.max(courtIds.length, 1) * durationHours);
            }

            return Math.round(Number(tierPricing.fixed_price));
          }

          if (tierPricing.discount_percent) {
            return Math.round(baseAmount * (1 - (Number(tierPricing.discount_percent) / 100)));
          }

          return baseAmount;
        };

        if (product_type === 'court_booking') {
          const courtDiscount = hasEnt('court_discount_pct');
          if (tierPricing) {
            finalAmountSek = applyTierPricing(finalAmountSek);
          } else if (courtDiscount) {
            finalAmountSek = Math.round(amount_sek * (1 - (courtDiscount.value / 100)));
          }

          // Founder: hard cap 4h/week — check usage
          const weekLimit = hasEnt('court_hours_per_week');
          if (weekLimit) {
            const bookingHours = parseFloat(meta.duration_hours || '0');
            if (bookingHours > 0) {
              const now = DateTime.now().setZone('Europe/Stockholm');
              const weekStart = now.startOf('week').toISODate()!;
              const weekEnd   = now.endOf('week').toISODate()!;

              const { data: usage } = await adminEnt
                .from('membership_usage')
                .select('used_value')
                .eq('user_id', entitlementUserId)
                .eq('venue_id', venue_id)
                .eq('entitlement_type', 'court_hours_per_week')
                .eq('period_start', weekStart)
                .maybeSingle();

              const usedHours = (usage?.used_value || 0);
              if (usedHours + bookingHours > weekLimit.value) {
                return errorResponse(
                  `Ditt Founder-memberskap inkluderar max ${weekLimit.value}h banbokning/vecka. Du har ${weekLimit.value - usedHours}h kvar denna vecka.`,
                  403
                );
              }
              // Make it free (included in membership)
              finalAmountSek = 0;
            }
          }
        }

        if (product_type === 'day_pass') {
          const passDiscount = hasEnt('day_pass_discount_pct');
          const freePass = hasEnt('free_day_pass_monthly');

          if (freePass) {
            const now = DateTime.now().setZone('Europe/Stockholm');
            const monthStart = now.startOf('month').toISODate()!;
            const monthEnd   = now.endOf('month').toISODate()!;

            const { data: usage } = await adminEnt
              .from('membership_usage')
              .select('used_value')
              .eq('user_id', entitlementUserId)
              .eq('venue_id', venue_id)
              .eq('entitlement_type', 'free_day_pass_monthly')
              .eq('period_start', monthStart)
              .maybeSingle();

            const usedPasses = (usage?.used_value || 0);
            if (usedPasses < freePass.value) {
              finalAmountSek = 0;
              meta.entitlement_type = 'free_day_pass_monthly';
              meta.entitlement_period_start = monthStart;
              meta.entitlement_period_end = monthEnd;
            }
          } else if (tierPricing) {
            finalAmountSek = applyTierPricing(finalAmountSek);
          } else if (passDiscount) {
            finalAmountSek = Math.round(amount_sek * (1 - (passDiscount.value / 100)));
          }
        }
      }
    }

    // Free entitlement bookings bypass Stripe entirely
    if (finalAmountSek === 0 && !isMembership) {
      // Create booking/day-pass directly and return success
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const adminFree = createClient(supabaseUrl, serviceKey);

      if (product_type === 'court_booking' && meta.court_ids && meta.date) {
        const startISO = DateTime.fromISO(`${meta.date}T${meta.start_time}:00`, { zone: 'Europe/Stockholm' }).toUTC().toISO()!;
        const endISO   = DateTime.fromISO(`${meta.date}T${meta.end_time}:00`,   { zone: 'Europe/Stockholm' }).toUTC().toISO()!;

        let courtIds: string[];
        try { courtIds = JSON.parse(meta.court_ids || '[]'); } catch { courtIds = []; }

        for (const courtId of courtIds) {
          const accessCode = await generateAccessCode(adminFree, venue_id, meta.date);
          await adminFree.from('bookings').insert({
            venue_id, venue_court_id: courtId, user_id: entitlementUserId, booked_by: entitlementUserId,
            start_time: startISO, end_time: endISO, total_price: 0,
            status: 'confirmed', access_code: accessCode, access_code_expires_at: endISO,
          });
        }

        // Track usage
        const now = DateTime.now().setZone('Europe/Stockholm');
        const weekStart = now.startOf('week').toISODate()!;
        const weekEnd   = now.endOf('week').toISODate()!;
        const durationHours = parseFloat(meta.duration_hours || '0');
        if (durationHours > 0) {
          await adminFree.from('membership_usage').upsert({
            user_id: entitlementUserId, venue_id, entitlement_type: 'court_hours_per_week',
            period_start: weekStart, period_end: weekEnd, used_value: durationHours,
          }, { onConflict: 'user_id,venue_id,entitlement_type,period_start' });
        }

        const bookingRef = courtIds[0]; // simplified ref for redirect
        return jsonResponse({ free: true, redirect: `/b/${bookingRef}` });
      }

      if (product_type === 'day_pass' && meta.entitlement_type === 'free_day_pass_monthly') {
        const today = DateTime.now().setZone('Europe/Stockholm').toISODate()!;
        const { data: newPass } = await adminFree.from('day_passes').insert({
          venue_id, user_id: entitlementUserId, valid_date: today,
          purchase_date: today, price: 0, status: 'active', is_free: true,
        }).select('id').single();

        // Track usage
        await adminFree.from('membership_usage').upsert({
          user_id: entitlementUserId, venue_id,
          entitlement_type: 'free_day_pass_monthly',
          period_start: meta.entitlement_period_start,
          period_end: meta.entitlement_period_end,
          used_value: 1,
        }, { onConflict: 'user_id,venue_id,entitlement_type,period_start' });

        return jsonResponse({ free: true, redirect: '/my' });
      }
    }

    // Use finalAmountSek for Stripe session (may be discounted)
    const billedAmountSek = finalAmountSek > 0 ? finalAmountSek : amount_sek;

    const productName = product_type === 'court_booking'
      ? `Banbokning${meta.date ? ` · ${meta.date}` : ''}${meta.start_time ? ` ${meta.start_time}–${meta.end_time || ''}` : ''}`
      : product_type === 'membership'
      ? `Pickla Membership${meta.tier_name ? ` · ${meta.tier_name}` : ''}`
      : 'Dagspass';

    // Shared metadata (all values must be strings, max 500 chars each)
    const stripeMetadata: Record<string, string> = {
      product_type,
      venue_id:         String(venue_id             || ''),
      slug:             String(meta.slug             || ''),
      court_ids:        String(meta.court_ids        || '[]'),
      date:             String(meta.date             || ''),
      start_time:       String(meta.start_time       || ''),
      end_time:         String(meta.end_time         || ''),
      name:             String(meta.name             || '').slice(0, 200),
      phone:            String(meta.phone            || '').slice(0, 50),
      user_id:          String(meta.user_id          || ''),
      // Membership-specific
      tier_id:          String(meta.tier_id          || ''),
      customer_name:    String(meta.customer_name    || '').slice(0, 200),
      customer_email:   String(meta.customer_email   || '').slice(0, 200),
      customer_phone:   String(meta.customer_phone   || '').slice(0, 50),
      // Day-pass-specific
      open_play_session_id: String(meta.open_play_session_id || ''),
      session_name:     String(meta.session_name     || ''),
    };

    const cancelPath = meta.slug ? `/book?v=${meta.slug}` : isMembership ? '/membership' : '/book';
    const successPath = isMembership
      ? '/membership/confirmed'
      : product_type === 'day_pass'
      ? '/booking/confirmed?type=day_pass'
      : '/booking/confirmed';

    let stripeSession: Stripe.Checkout.Session;

    if (isMembership) {
      // Subscription mode — recurring monthly charge
      stripeSession = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'subscription',
        line_items: [{
          price_data: {
            currency: 'sek',
            product_data: { name: productName },
            unit_amount: Math.round(billedAmountSek) * 100,
            recurring: { interval: 'month' },
          },
          quantity: 1,
        }],
        metadata: stripeMetadata,
        subscription_data: { metadata: stripeMetadata },
        success_url: `${origin}${successPath}${successPath.includes('?') ? '&' : '?'}session={CHECKOUT_SESSION_ID}`,
        cancel_url:  `${origin}${cancelPath}`,
      });
    } else {
      // One-time payment (court_booking, day_pass)
      stripeSession = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'sek',
            product_data: { name: productName },
            unit_amount: Math.round(billedAmountSek) * 100,
          },
          quantity: 1,
        }],
        metadata: stripeMetadata,
        success_url: `${origin}${successPath}${successPath.includes('?') ? '&' : '?'}session={CHECKOUT_SESSION_ID}`,
        cancel_url:  `${origin}${cancelPath}`,
      });
    }

    return jsonResponse({ url: stripeSession.url });
  }

  // ── GET /by-session?session=xxx — look up a booking by Stripe session ID ──
  if (req.method === 'GET' && path === 'by-session') {
    const sessionId = url.searchParams.get('session');
    if (!sessionId) return errorResponse('Missing session');

    const serviceClient = getServiceClient();
    const { data: booking } = await serviceClient
      .from('bookings')
      .select('booking_ref')
      .eq('stripe_session_id', sessionId)
      .neq('status', 'cancelled')
      .limit(1)
      .maybeSingle();

    if (!booking) return jsonResponse({ pending: true }, 200, 0);
    return jsonResponse({ pending: false, booking_ref: booking.booking_ref }, 200, 0);
  }

  // ── Public endpoint: venue by slug (no auth required) ──
  if (req.method === 'GET' && path === 'public-venue') {
    const slug = url.searchParams.get('slug');
    if (!slug) return errorResponse('Missing slug');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: venue, error: vErr } = await admin.from('venues')
      .select('id, name, slug, description, address, city, logo_url, cover_image_url, primary_color, secondary_color, phone, email, website_url, status')
      .eq('slug', slug)
      .eq('is_public', true)
      .single();

    if (vErr || !venue) return errorResponse('Venue not found', 404);

    // Get opening hours
    const { data: hours } = await admin.from('opening_hours')
      .select('day_of_week, open_time, close_time, is_closed')
      .eq('venue_id', venue.id)
      .order('day_of_week');

    // Get active events
    const { data: events } = await admin.from('events')
      .select('id, name, display_name, event_type, format, start_date, end_date, status, logo_url, primary_color')
      .eq('venue_id', venue.id)
      .eq('is_public', true)
      .in('status', ['upcoming', 'active', 'live'])
      .order('start_date')
      .limit(5);

    // Get community/social links
    const { data: links } = await admin.from('venue_links')
      .select('id, title, description, url, icon, color, member_count')
      .eq('venue_id', venue.id)
      .eq('is_active', true)
      .order('sort_order');

    return jsonResponse({ venue, openingHours: hours || [], events: events || [], links: links || [] }, 200, 60);
  }

  // ── Public endpoint: booking by ref ──
  if (req.method === 'GET' && path === 'public-booking') {
    const ref = url.searchParams.get('ref');
    if (!ref) return errorResponse('Missing ref');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Get all bookings with same notes (grouped booking) or single
    const { data: booking } = await admin.from('bookings')
      .select('id, booking_ref, venue_court_id, start_time, end_time, total_price, status, notes, venue_id, venue_courts(name, court_number)')
      .eq('booking_ref', ref).single();

    if (!booking) return errorResponse('Booking not found', 404);

    // Get venue info
    const { data: venue } = await admin.from('venues')
      .select('name, slug, address, city, logo_url').eq('id', booking.venue_id).single();

    // Find sibling bookings (same time + same notes = same group booking)
    const { data: siblings } = await admin.from('bookings')
      .select('id, booking_ref, venue_court_id, start_time, end_time, total_price, venue_courts(name, court_number)')
      .eq('venue_id', booking.venue_id)
      .eq('start_time', booking.start_time)
      .eq('end_time', booking.end_time)
      .eq('notes', booking.notes)
      .neq('status', 'cancelled');

    return jsonResponse({
      booking,
      venue,
      courts: (siblings || [booking]).map((b: any) => ({
        ref: b.booking_ref,
        court_name: b.venue_courts?.name,
        price: b.total_price,
      })),
      totalPrice: (siblings || [booking]).reduce((s: number, b: any) => s + (b.total_price || 0), 0),
    }, 200, 30);
  }

  // ── Public endpoint: available courts for a venue ──
  if (req.method === 'GET' && path === 'public-courts') {
    const venueSlug = url.searchParams.get('slug');
    const date = url.searchParams.get('date'); // YYYY-MM-DD
    if (!venueSlug || !date) return errorResponse('Missing slug or date');

    // showAll=true skips the is_available filter — used by the ops display screen
    const showAll = url.searchParams.get('showAll') === 'true';

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: venue } = await admin.from('venues')
      .select('id, name').eq('slug', venueSlug).eq('is_public', true).single();
    if (!venue) return errorResponse('Venue not found', 404);

    // Get courts — display screen passes showAll=true to include unavailable courts
    let courtQuery = admin.from('venue_courts')
      .select('id, name, court_number, court_type, sport_type, hourly_rate, is_available')
      .eq('venue_id', venue.id)
      .order('court_number');
    if (!showAll) courtQuery = courtQuery.eq('is_available', true);
    const { data: courts } = await courtQuery;

    // Get opening hours for requested day
    const dayOfWeek = new Date(date + 'T12:00:00Z').getUTCDay();
    const { data: hours } = await admin.from('opening_hours')
      .select('open_time, close_time, is_closed')
      .eq('venue_id', venue.id).eq('day_of_week', dayOfWeek).maybeSingle();

    // Get existing bookings for the date
    const start = `${date}T00:00:00.000Z`;
    const end = `${date}T23:59:59.999Z`;
    const { data: bookings } = await admin.from('bookings')
      .select('venue_court_id, start_time, end_time')
      .eq('venue_id', venue.id)
      .neq('status', 'cancelled')
      .gte('start_time', start).lte('start_time', end);

    // Get active pricing rules for this venue
    const { data: pricingRules } = await admin.from('pricing_rules')
      .select('id, name, type, price, days_of_week, time_from, time_to, sport_type, court_type')
      .eq('venue_id', venue.id).eq('is_active', true)
      .order('price', { ascending: false });

    return jsonResponse({
      venue: { id: venue.id, name: venue.name },
      courts: courts || [],
      openingHours: hours || null,
      bookings: (bookings || []).map((b: any) => ({
        court_id: b.venue_court_id,
        start: b.start_time,
        end: b.end_time,
      })),
      pricingRules: pricingRules || [],
    }, 200, 10);
  }

  if (req.method === 'POST' && path === 'public-book') {
    const body = await req.json();
    const { slug, courtIds, date, startTime, endTime, name, phone, corporatePackageId } = body;

    const safeName = typeof name === 'string' ? name.trim() : '';
    const safePhone = typeof phone === 'string'
      ? phone.replace(/[^\d+()\-\s]/g, '').trim()
      : '';

    if (!slug || !courtIds?.length || !date || !startTime || !endTime || !safeName || !safePhone) {
      return errorResponse('Fyll i alla fält');
    }
    if (safeName.length > 100 || safePhone.length < 6 || safePhone.length > 20) {
      return errorResponse('Ogiltiga uppgifter', 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: venue } = await admin.from('venues')
      .select('id').eq('slug', slug).eq('is_public', true).single();
    if (!venue) return errorResponse('Venue not found', 404);

    // Build UTC ISO timestamps from Stockholm local time
    const startISO = DateTime.fromISO(`${date}T${startTime}:00`, { zone: 'Europe/Stockholm' }).toUTC().toISO()!;
    const endISO = DateTime.fromISO(`${date}T${endTime}:00`, { zone: 'Europe/Stockholm' }).toUTC().toISO()!;
    const durationHours = (new Date(endISO).getTime() - new Date(startISO).getTime()) / 3600000;

    // Check conflicts for all courts
    for (const courtId of courtIds) {
      const { data: conflicts } = await admin.from('bookings')
        .select('id').eq('venue_court_id', courtId)
        .neq('status', 'cancelled')
        .lt('start_time', endISO).gt('end_time', startISO);
      if (conflicts && conflicts.length > 0) {
        return errorResponse('En eller flera banor är redan bokade för denna tid', 409);
      }
    }

    // Try to resolve authenticated user from Authorization header
    let bookingUserId: string | null = null;
    const authHeader = req.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const { data: { user: authUser } } = await admin.auth.getUser(token);
      if (authUser?.id) {
        bookingUserId = authUser.id;
      }
    }

    // Validate corporate package if provided
    let validCorporatePackageId: string | null = null;
    if (corporatePackageId && bookingUserId) {
      const { data: pkg } = await admin.from('corporate_packages')
        .select('id, total_hours, used_hours, status, corporate_account_id')
        .eq('id', corporatePackageId)
        .eq('status', 'active')
        .single();

      if (pkg) {
        // Verify user is a member of this corporate account
        const { data: membership } = await admin.from('corporate_members')
          .select('id')
          .eq('corporate_account_id', pkg.corporate_account_id)
          .eq('user_id', bookingUserId)
          .maybeSingle();

        if (membership) {
          const totalBookingHours = durationHours * courtIds.length;
          const remaining = pkg.total_hours - pkg.used_hours;
          if (totalBookingHours > remaining) {
            return errorResponse(`Inte tillräckligt med timmar kvar (${remaining}h tillgängligt)`, 400);
          }
          validCorporatePackageId = pkg.id;
        }
      }
    }

    // Fallback to guest user if not authenticated
    if (!bookingUserId) {
      bookingUserId = await getOrCreatePublicBookingUserId(admin);
    }

    // Fetch pricing rules for this venue
    const { data: pricingRules } = await admin.from('pricing_rules')
      .select('type, price, days_of_week, time_from, time_to, sport_type, court_type')
      .eq('venue_id', venue.id).eq('is_active', true).eq('type', 'hourly')
      .order('price', { ascending: false });

    const bookingDayOfWeek = new Date(date + 'T12:00:00Z').getUTCDay();

    const bookings = [];
    let totalHoursBooked = 0;
    for (const courtId of courtIds) {
      const { data: court } = await admin.from('venue_courts')
        .select('hourly_rate, sport_type, court_type').eq('id', courtId).single();

      // Find matching pricing rule: day + time window
      let hourlyRate = court?.hourly_rate || 350;
      if (pricingRules && pricingRules.length > 0) {
        const matchingRule = pricingRules.find((r: any) => {
          const daysMatch = !r.days_of_week || r.days_of_week.length === 0 || r.days_of_week.includes(bookingDayOfWeek);
          const sportMatches = !r.sport_type || r.sport_type === (court?.sport_type || 'pickleball');
          const courtTypeMatches = !r.court_type || r.court_type === (court?.court_type || null);
          const timeFrom = r.time_from || '00:00';
          const timeTo = r.time_to || '23:59';
          return sportMatches && courtTypeMatches && daysMatch && startTime >= timeFrom.slice(0, 5) && startTime < timeTo.slice(0, 5);
        });
        if (matchingRule) hourlyRate = matchingRule.price;
      }

      const price = validCorporatePackageId ? 0 : Math.round(hourlyRate * durationHours);
      const accessCode = await generateAccessCode(admin, venue.id, date);

      const { data: booking, error: bErr } = await admin.from('bookings').insert({
        venue_id: venue.id,
        venue_court_id: courtId,
        user_id: bookingUserId,
        booked_by: bookingUserId,
        start_time: startISO,
        end_time: endISO,
        total_price: price,
        status: 'confirmed',
        notes: `${safeName} | ${safePhone}`,
        corporate_package_id: validCorporatePackageId,
        access_code: accessCode,
        access_code_expires_at: endISO,
      }).select().single();

      if (bErr) return errorResponse(bErr.message);
      bookings.push(booking);
      totalHoursBooked += durationHours;
    }

    // Deduct hours from corporate package
    if (validCorporatePackageId && totalHoursBooked > 0) {
      const { data: currentPkg } = await admin.from('corporate_packages')
        .select('used_hours').eq('id', validCorporatePackageId).single();
      if (currentPkg) {
        await admin.from('corporate_packages')
          .update({ used_hours: (currentPkg.used_hours || 0) + totalHoursBooked })
          .eq('id', validCorporatePackageId);
      }
    }

    return jsonResponse({ bookings, count: bookings.length, corporate: !!validCorporatePackageId }, 201);
  }

  try {
    const { client, userId, error } = await getAuthenticatedClient(req);
    if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);

    // GET /api-bookings/venue?venueId=X&date=YYYY-MM-DD
    if (req.method === 'GET' && path === 'venue') {
      const venueId = url.searchParams.get('venueId');
      const date = url.searchParams.get('date');
      if (!venueId) return errorResponse('Missing venueId');

      let query = client.from('bookings')
        .select('*, venue_courts(name, court_number)')
        .eq('venue_id', venueId)
        .order('start_time');

      if (date) {
        const start = `${date}T00:00:00.000Z`;
        const end = `${date}T23:59:59.999Z`;
        query = query.gte('start_time', start).lte('start_time', end);
      }

      const { data, error: qErr } = await query;
      if (qErr) return errorResponse(qErr.message);

      return jsonResponse(data, 200, 5);
    }

    // GET /api-bookings/revenue?venueId=X&date=YYYY-MM-DD
    if (req.method === 'GET' && path === 'revenue') {
      const venueId = url.searchParams.get('venueId');
      const date = url.searchParams.get('date');
      if (!venueId || !date) return errorResponse('Missing venueId or date');

      const start = `${date}T00:00:00.000Z`;
      const end = `${date}T23:59:59.999Z`;

      const [bookingsRes, passesRes] = await Promise.all([
        client.from('bookings').select('total_price').eq('venue_id', venueId)
          .gte('start_time', start).lte('start_time', end).in('status', ['confirmed', 'completed']),
        client.from('day_passes').select('price').eq('venue_id', venueId)
          .eq('valid_date', date).eq('status', 'active'),
      ]);

      const bookingRevenue = (bookingsRes.data || []).reduce((s: number, b: any) => s + (b.total_price || 0), 0);
      const passRevenue = (passesRes.data || []).reduce((s: number, p: any) => s + (p.price || 0), 0);

      return jsonResponse({
        total: bookingRevenue + passRevenue,
        bookings: bookingRevenue,
        dayPasses: passRevenue,
        bookingCount: bookingsRes.data?.length || 0,
        passCount: passesRes.data?.length || 0,
      }, 200, 15);
    }

    // GET /api-bookings/pricing?venueId=X
    if (req.method === 'GET' && path === 'pricing') {
      const venueId = url.searchParams.get('venueId');
      if (!venueId) return errorResponse('Missing venueId');

      const { data, error: qErr } = await client.from('pricing_rules')
        .select('id, name, type, price, days_of_week, time_from, time_to, is_active')
        .eq('venue_id', venueId).eq('is_active', true).order('price');
      if (qErr) return errorResponse(qErr.message);

      return jsonResponse(data, 200, 30);
    }

    // GET /api-bookings/hours?venueId=X
    if (req.method === 'GET' && path === 'hours') {
      const venueId = url.searchParams.get('venueId');
      if (!venueId) return errorResponse('Missing venueId');

      const { data, error: qErr } = await client.from('opening_hours')
        .select('day_of_week, open_time, close_time, is_closed')
        .eq('venue_id', venueId).order('day_of_week');
      if (qErr) return errorResponse(qErr.message);

      return jsonResponse(data, 200, 60);
    }

    // GET /api-bookings/courts?venueId=X
    if (req.method === 'GET' && path === 'courts') {
      const venueId = url.searchParams.get('venueId');
      if (!venueId) return errorResponse('Missing venueId');

      const { data, error: qErr } = await client.from('venue_courts')
        .select('*').eq('venue_id', venueId).order('court_number');
      if (qErr) return errorResponse(qErr.message);

      return jsonResponse(data, 200, 30);
    }

    // POST /api-bookings/create
    if (req.method === 'POST' && path === 'create') {
      const body = await req.json();
      const { venueId, venueCourtId, startTime, endTime, totalPrice, bookedBy, notes } = body;
      if (!venueId || !venueCourtId || !startTime || !endTime) {
        return errorResponse('Missing required fields');
      }

      const { data: conflicts } = await client.from('bookings')
        .select('id').eq('venue_court_id', venueCourtId)
        .neq('status', 'cancelled')
        .lt('start_time', endTime).gt('end_time', startTime);

      if (conflicts && conflicts.length > 0) {
        return errorResponse('Court is already booked for this time slot', 409);
      }

      const bookingDate = startTime.slice(0, 10);
      const accessCode = await generateAccessCode(getServiceClient(), venueId, bookingDate);

      const { data, error: insertErr } = await client.from('bookings').insert({
        venue_id: venueId,
        venue_court_id: venueCourtId,
        user_id: userId,
        booked_by: bookedBy || userId,
        start_time: startTime,
        end_time: endTime,
        total_price: totalPrice,
        status: 'confirmed',
        notes,
        access_code: accessCode,
        access_code_expires_at: endTime,
      }).select().single();

      if (insertErr) return errorResponse(insertErr.message);
      return jsonResponse(data, 201);
    }

    // PATCH /api-bookings/update
    if (req.method === 'PATCH' && path === 'update') {
      const body = await req.json();
      const { bookingId, status, notes } = body;
      if (!bookingId) return errorResponse('Missing bookingId');

      const updates: Record<string, any> = {};
      if (status) updates.status = status;
      if (notes !== undefined) updates.notes = notes;

      const { data, error: upErr } = await client.from('bookings')
        .update(updates).eq('id', bookingId).select().single();
      if (upErr) return errorResponse(upErr.message);

      return jsonResponse(data);
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
