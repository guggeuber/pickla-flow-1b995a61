import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import {
  assertVenueAdmin,
  choosePackage,
  estimateValue,
  leadActivity,
  leadSummary,
  sanitizeLeadInput,
  scoreLead,
} from '../_shared/event_agents.ts';
import { createEventOperationsRecommendationActivity } from '../_shared/event_operations_agent.ts';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';
  const admin = getServiceClient();

  try {
    if (req.method === 'POST' && path === 'intake') {
      const lead = sanitizeLeadInput(await req.json());
      if (!lead.slug && !lead.venueId) return errorResponse('Missing venue');
      if (!lead.contactName || lead.contactName.length < 2) return errorResponse('Missing name');
      if (!lead.email || lead.email.length < 5) return errorResponse('Missing email');
      if (!lead.phone || lead.phone.length < 5) return errorResponse('Missing phone');

      const venueQuery = admin.from('venues').select('id, name, email, phone, address, slug, is_public');
      const { data: venue, error: venueErr } = lead.venueId
        ? await venueQuery.eq('id', lead.venueId).maybeSingle()
        : await venueQuery.eq('slug', lead.slug).eq('is_public', true).maybeSingle();
      if (venueErr || !venue) return errorResponse('Venue not found', 404);

      const pack = choosePackage(lead);
      const leadScore = scoreLead(lead);
      const estimatedValue = estimateValue(lead, pack);
      const resources = Array.from(new Set([...lead.activities, ...lead.resources]));
      const typeLabel = typeLabelMap[lead.eventType] || 'Gruppbokning';
      const startTime = lead.preferredTime ? timeMap[lead.preferredTime] || (/^\d{2}:\d{2}$/.test(lead.preferredTime) ? lead.preferredTime : null) : null;

      const partnerNotes = [
        'Källa: Event Intake Agent',
        `Score: ${leadScore}/100`,
        `Föreslaget paket: ${pack.title}`,
        `Typ: ${typeLabel}`,
        `Företag: ${lead.companyName || 'Ej angivet'}`,
        `Önskat datum: ${lead.preferredDate || 'Flexibelt'}`,
        `Önskad tid: ${lead.preferredTime || 'Flexibelt'}`,
        `Aktiviteter/resurser: ${resources.length ? resources.join(', ') : 'Ej valt'}`,
        `Kontakt: ${lead.contactName} · ${lead.email} · ${lead.phone}`,
        lead.message ? `Övrigt: ${lead.message}` : null,
      ].filter(Boolean).join('\n');

      const eventPayload = {
        venue_id: venue.id,
        name: `${typeLabel} · ${lead.companyName || lead.contactName}`,
        display_name: `${typeLabel} · ${lead.participants} pers`,
        event_type: 'corporate_event',
        format: 'custom',
        category: 'corporate',
        status: 'upcoming',
        is_public: false,
        planning_status: 'inquiry',
        visibility: 'internal',
        number_of_courts: 1,
        start_date: lead.preferredDate,
        end_date: lead.preferredDate,
        start_time: startTime,
        end_time: null,
        customer_name: lead.contactName,
        customer_email: lead.email,
        customer_phone: lead.phone,
        expected_participants: lead.participants,
        owner_name: null,
        partner_notes: partnerNotes,
        internal_notes: lead.message || null,
        resources,
      };

      let { data: event, error: eventErr } = await admin.from('events').insert(eventPayload).select('id').single();
      if (eventErr && eventErr.message?.includes('invalid input value for enum event_format')) {
        const fallback = await admin.from('events').insert({ ...eventPayload, format: 'team_vs_team' }).select('id').single();
        event = fallback.data;
        eventErr = fallback.error;
      }
      if (eventErr) return errorResponse(eventErr.message, 500);

      const { data: eventLead, error: leadErr } = await admin.from('event_leads').insert({
        venue_id: venue.id,
        event_id: event.id,
        company_name: lead.companyName,
        contact_name: lead.contactName,
        email: lead.email,
        phone: lead.phone,
        participants_count: lead.participants,
        preferred_date: lead.preferredDate,
        preferred_time: lead.preferredTime,
        event_type: lead.eventType,
        activities: lead.activities,
        resources: lead.resources,
        message: lead.message,
        source: lead.source,
        lead_score: leadScore,
        status: 'new_event_lead',
        package_type: pack.key,
        estimated_value: estimatedValue,
        agent_summary: leadSummary(lead, pack),
      }).select('*').single();
      if (leadErr) return errorResponse(leadErr.message, 500);

      await admin.from('event_lead_activities').insert(leadActivity({
        lead: eventLead,
        type: 'lead_created',
        title: 'Lead created',
        body: `${lead.contactName} skickade en eventförfrågan.`,
        metadata: { source: lead.source, package_type: pack.key, lead_score: leadScore },
      }));
      try {
        await createEventOperationsRecommendationActivity(admin, eventLead.id);
      } catch (agentErr) {
        console.error('event_operations_agent_create_failed', agentErr);
      }

      return jsonResponse({
        ok: true,
        event_id: event.id,
        event_lead: eventLead,
        lead_id: eventLead.id,
        lead_score: leadScore,
        suggested_package: pack,
      }, 201);
    }

    const { userId, error } = await getAuthenticatedClient(req);
    if (error || !userId) return errorResponse(error || 'Unauthorized', 401);

    if (req.method === 'GET' && path === 'leads') {
      const venueId = url.searchParams.get('venueId');
      if (!venueId) return errorResponse('Missing venueId');
      if (!await assertVenueAdmin(admin, userId, venueId)) return errorResponse('Forbidden', 403);
      const { data, error: qErr } = await admin.from('event_leads')
        .select('*, event_offers(id, status, total_price, pdf_url, sent_at, created_at), event_followups(id, followup_type, scheduled_at, sent_at, status, message, created_at), event_lead_activities(id, activity_type, title, body, created_at, metadata)')
        .eq('venue_id', venueId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (qErr) return errorResponse(qErr.message);
      const rows = data || [];
      const eventIds = rows.map((row: any) => row.event_id).filter(Boolean);
      if (eventIds.length) {
        const { data: events } = await admin
          .from('events')
          .select('id, start_date, end_date, start_time, end_time, planning_status, status')
          .in('id', eventIds);
        const eventsById = new Map((events || []).map((event: any) => [event.id, event]));
        for (const row of rows) {
          row.event = row.event_id ? eventsById.get(row.event_id) || null : null;
        }
      }
      return jsonResponse(rows);
    }

    if (req.method === 'PATCH' && path === 'lead') {
      const body = await req.json();
      if (!body.leadId) return errorResponse('Missing leadId');
      const { data: leadRow } = await admin.from('event_leads').select('id, venue_id, event_id').eq('id', body.leadId).maybeSingle();
      if (!leadRow) return errorResponse('Lead not found', 404);
      if (!await assertVenueAdmin(admin, userId, leadRow.venue_id)) return errorResponse('Forbidden', 403);

      const allowed: Record<string, true> = {
        status: true,
        lead_score: true,
        estimated_value: true,
        package_type: true,
      };
      const updates: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body)) {
        if (allowed[key]) updates[key] = value;
      }
      const { data, error: uErr } = await admin.from('event_leads').update(updates).eq('id', body.leadId).select('*').single();
      if (uErr) return errorResponse(uErr.message);

      if (body.status === 'lost' && leadRow.event_id) {
        await admin.from('events').update({ planning_status: 'cancelled' }).eq('id', leadRow.event_id);
      }
      if (body.status === 'ready_to_book' && leadRow.event_id) {
        await admin.from('events').update({ planning_status: 'tentative' }).eq('id', leadRow.event_id);
      }
      if (body.status === 'won' || body.status === 'lost' || body.status === 'ready_to_book') {
        await admin.from('event_lead_activities').insert(leadActivity({
          lead: data,
          type: body.status,
          title: body.status === 'won' ? 'Won' : body.status === 'ready_to_book' ? 'Ready to book' : 'Lost',
          body: body.status === 'won'
            ? 'Lead markerades som vunnen utan att boka eventet.'
            : body.status === 'ready_to_book'
              ? 'Leadet är redo för resurskontroll och bindande bokning.'
              : 'Lead markerades som förlorad.',
          actorUserId: userId,
        }));
      }
      try {
        await createEventOperationsRecommendationActivity(admin, data.id, userId);
      } catch (agentErr) {
        console.error('event_operations_agent_update_failed', agentErr);
      }
      return jsonResponse(data);
    }

    return errorResponse('Not found', 404);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Server error', 500);
  }
});
