-- Give the investor admin explicit ownership of page-level labels and supporting copy.
-- The existing typed offer columns and structured memo_sections remain the source of
-- truth for economics and memo narrative respectively.

ALTER TABLE public.investor_settings
  ADD COLUMN IF NOT EXISTS page_content JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Preserve today's rendered copy as database-owned values on existing records.
UPDATE public.investor_settings
SET page_content = $content$
{
  "preview_badge": "Investor preview",
  "preview_thesis_eyebrow": "The thesis",
  "preview_visual_heading": "Built from a real operating floor.",
  "preview_stack_heading": "One stack. Many surfaces.",
  "preview_access_eyebrow": "Investor access",
  "preview_access_title": "Request the memo.",
  "preview_access_body": "The full investor memorandum — vision, traction, team, financials and offer — is shared privately with vetted investors. Leave your email below and we'll get back to you.",
  "preview_highlights": [
    {"label": "01", "title": "Live venue", "body": "Pickleball + Stockholm Dart Arena + F&B"},
    {"label": "02", "title": "One OS", "body": "Booking, events, memberships, community"},
    {"label": "03", "title": "Network", "body": "Hosts, ambassadors, affiliates, venues"}
  ],
  "preview_pillars": [
    {"label": "Pickleball", "title": "Pickleball", "body": "Courts, memberships, open play and community programming."},
    {"label": "Stockholm Dart Arena", "title": "Stockholm Dart Arena", "body": "Dart as a first-class social sports surface."},
    {"label": "Events", "title": "Events", "body": "Corporate, private, tournaments and partner activations."},
    {"label": "F&B", "title": "F&B", "body": "Venue revenue, hospitality and community rituals."},
    {"label": "Admin OS", "title": "Admin OS", "body": "Planning, calendar, operations truth and capacity."},
    {"label": "Desk OS", "title": "Desk OS", "body": "Arrivals, check-in, customers and live actions."},
    {"label": "Customer 360", "title": "Customer 360", "body": "Bookings, tickets, memberships, receipts and history."},
    {"label": "AI Operations", "title": "AI Operations", "body": "Agent-assisted planning with human approval."}
  ],
  "visual_venue_label": "Pickla Arena",
  "visual_venue_title": "Live venue",
  "visual_venue_body": "Pickleball, events, F&B and community operations in one venue.",
  "visual_dart_label": "Stockholm Dart Arena",
  "visual_dart_title": "Dart is part of the core surface",
  "visual_dart_body": "Stockholm Dart Arena is presented as a first-class Pickla venue surface, not an add-on.",
  "visual_product_label": "Pickla OS",
  "visual_product_title": "The operating system",
  "visual_product_body": "Admin OS, Desk OS, Customer 360, Operations Truth, Revenue Ledger and Event OS.",
  "memo_visual_eyebrow": "Visual evidence",
  "memo_visual_title": "The venue and product surfaces",
  "memo_deck_eyebrow": "Deck",
  "memo_deck_title": "Investor deck",
  "memo_offer_eyebrow": "Offer",
  "memo_round_size_label": "Round size",
  "memo_valuation_label": "Valuation",
  "memo_share_price_label": "Share price",
  "memo_shares_offered_label": "Shares offered",
  "memo_existing_shares_label": "Existing shares",
  "memo_minimum_label": "Minimum",
  "memo_deadline_label": "Application deadline",
  "memo_allocation_label": "Allocation communicated",
  "memo_use_of_funds_eyebrow": "Use of funds",
  "memo_use_of_funds_title": "Where the round goes",
  "memo_traction_eyebrow": "Traction",
  "memo_traction_title": "What is working",
  "memo_risks_eyebrow": "Risks",
  "memo_risks_title": "What could go wrong",
  "memo_team_eyebrow": "Team",
  "memo_team_title": "Operators, not tourists",
  "memo_interest_eyebrow": "Register interest",
  "memo_interest_title": "Want to go deeper?",
  "memo_interest_body": "Register non-binding interest. We'll follow up with the full data room, financials and offer details."
}
$content$::jsonb
WHERE page_content = '{}'::jsonb;

-- Remove the editor note accidentally saved into the live memo title while
-- preserving section order and every other field in the JSON objects.
UPDATE public.investor_settings AS settings
SET memo_sections = (
  SELECT COALESCE(
    jsonb_agg(
      CASE
        WHEN section ->> 'title' = 'Ägande och avkastning – ändra'
          THEN jsonb_set(section, '{title}', to_jsonb('Ägande och avkastning'::text), false)
        ELSE section
      END
      ORDER BY ordinal
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(settings.memo_sections) WITH ORDINALITY AS sections(section, ordinal)
)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(settings.memo_sections) AS sections(section)
  WHERE section ->> 'title' = 'Ägande och avkastning – ändra'
);

COMMENT ON COLUMN public.investor_settings.page_content IS
  'Explicit investor preview and private memo labels/supporting copy edited in /hub/admin/investors.';
