export type InvestorAssetType =
  | "logo"
  | "hero"
  | "venue_photo"
  | "dart_photo"
  | "product_screenshot"
  | "deck"
  | "other";

export type InvestorMetric = {
  label: string;
  value: string;
};

export type InvestorPerson = {
  name: string;
  role?: string;
  bio?: string;
};

export type InvestorMemoSection = {
  kicker?: string;
  title: string;
  body: string;
};

export type InvestorContentCard = {
  label: string;
  title: string;
  body: string;
};

export type InvestorPageContent = {
  preview_badge: string;
  preview_thesis_eyebrow: string;
  preview_visual_heading: string;
  preview_stack_heading: string;
  preview_access_eyebrow: string;
  preview_access_title: string;
  preview_access_body: string;
  preview_highlights: InvestorContentCard[];
  preview_pillars: InvestorContentCard[];
  visual_venue_label: string;
  visual_venue_title: string;
  visual_venue_body: string;
  visual_dart_label: string;
  visual_dart_title: string;
  visual_dart_body: string;
  visual_product_label: string;
  visual_product_title: string;
  visual_product_body: string;
  memo_visual_eyebrow: string;
  memo_visual_title: string;
  memo_deck_eyebrow: string;
  memo_deck_title: string;
  memo_offer_eyebrow: string;
  memo_round_size_label: string;
  memo_valuation_label: string;
  memo_share_price_label: string;
  memo_shares_offered_label: string;
  memo_existing_shares_label: string;
  memo_minimum_label: string;
  memo_deadline_label: string;
  memo_allocation_label: string;
  memo_use_of_funds_eyebrow: string;
  memo_use_of_funds_title: string;
  memo_traction_eyebrow: string;
  memo_traction_title: string;
  memo_risks_eyebrow: string;
  memo_risks_title: string;
  memo_team_eyebrow: string;
  memo_team_title: string;
  memo_interest_eyebrow: string;
  memo_interest_title: string;
  memo_interest_body: string;
};

export type InvestorSettings = {
  id?: string;
  organization_id?: string | null;
  round_name: string | null;
  round_label: string | null;
  company_name: string | null;
  company_org_number: string | null;
  headline: string | null;
  subheadline: string | null;
  public_thesis: string | null;
  memo_intro: string | null;
  round_size_sek: number | null;
  valuation_sek: number | null;
  share_price_sek: number | null;
  shares_offered: number | null;
  total_existing_shares: number | null;
  minimum_shares: number | null;
  minimum_investment_sek: number | null;
  deadline_date: string | null;
  allocation_date: string | null;
  use_of_funds: InvestorMetric[];
  traction_metrics: InvestorMetric[];
  risks: InvestorMetric[];
  team: InvestorPerson[];
  memo_sections: InvestorMemoSection[];
  page_content: InvestorPageContent;
  is_active?: boolean;
};

export type InvestorAsset = {
  id: string;
  organization_id: string | null;
  asset_type: InvestorAssetType;
  title: string;
  description: string | null;
  storage_path: string;
  public_url: string | null;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

export const investorPageContentDefaults: InvestorPageContent = {
  preview_badge: "Investor preview",
  preview_thesis_eyebrow: "The thesis",
  preview_visual_heading: "Built from a real operating floor.",
  preview_stack_heading: "One stack. Many surfaces.",
  preview_access_eyebrow: "Investor access",
  preview_access_title: "Request the memo.",
  preview_access_body:
    "The full investor memorandum — vision, traction, team, financials and offer — is shared privately with vetted investors. Leave your email below and we'll get back to you.",
  preview_highlights: [
    { label: "01", title: "Live venue", body: "Pickleball + Stockholm Dart Arena + F&B" },
    { label: "02", title: "One OS", body: "Booking, events, memberships, community" },
    { label: "03", title: "Network", body: "Hosts, ambassadors, affiliates, venues" },
  ],
  preview_pillars: [
    { label: "Pickleball", title: "Pickleball", body: "Courts, memberships, open play and community programming." },
    { label: "Stockholm Dart Arena", title: "Stockholm Dart Arena", body: "Dart as a first-class social sports surface." },
    { label: "Events", title: "Events", body: "Corporate, private, tournaments and partner activations." },
    { label: "F&B", title: "F&B", body: "Venue revenue, hospitality and community rituals." },
    { label: "Admin OS", title: "Admin OS", body: "Planning, calendar, operations truth and capacity." },
    { label: "Desk OS", title: "Desk OS", body: "Arrivals, check-in, customers and live actions." },
    { label: "Customer 360", title: "Customer 360", body: "Bookings, tickets, memberships, receipts and history." },
    { label: "AI Operations", title: "AI Operations", body: "Agent-assisted planning with human approval." },
  ],
  visual_venue_label: "Pickla Arena",
  visual_venue_title: "Live venue",
  visual_venue_body: "Pickleball, events, F&B and community operations in one venue.",
  visual_dart_label: "Stockholm Dart Arena",
  visual_dart_title: "Dart is part of the core surface",
  visual_dart_body: "Stockholm Dart Arena is presented as a first-class Pickla venue surface, not an add-on.",
  visual_product_label: "Pickla OS",
  visual_product_title: "The operating system",
  visual_product_body: "Admin OS, Desk OS, Customer 360, Operations Truth, Revenue Ledger and Event OS.",
  memo_visual_eyebrow: "Visual evidence",
  memo_visual_title: "The venue and product surfaces",
  memo_deck_eyebrow: "Deck",
  memo_deck_title: "Investor deck",
  memo_offer_eyebrow: "Offer",
  memo_round_size_label: "Round size",
  memo_valuation_label: "Valuation",
  memo_share_price_label: "Share price",
  memo_shares_offered_label: "Shares offered",
  memo_existing_shares_label: "Existing shares",
  memo_minimum_label: "Minimum",
  memo_deadline_label: "Application deadline",
  memo_allocation_label: "Allocation communicated",
  memo_use_of_funds_eyebrow: "Use of funds",
  memo_use_of_funds_title: "Where the round goes",
  memo_traction_eyebrow: "Traction",
  memo_traction_title: "What is working",
  memo_risks_eyebrow: "Risks",
  memo_risks_title: "What could go wrong",
  memo_team_eyebrow: "Team",
  memo_team_title: "Operators, not tourists",
  memo_interest_eyebrow: "Register interest",
  memo_interest_title: "Want to go deeper?",
  memo_interest_body: "Register non-binding interest. We'll follow up with the full data room, financials and offer details.",
};

export const investorDefaults: InvestorSettings = {
  round_name: "Pickla Solna 2026",
  round_label: "Seed · 2026",
  company_name: "Pickla Solna AB",
  company_org_number: "556977-4481",
  headline: "The operating system for social sports communities.",
  subheadline:
    "Pickla is building the operating layer for community-first racket sports, darts, events, F&B and AI-assisted venue operations.",
  public_thesis:
    "Pickla is building the operating system for social sports communities. Today that means Pickleball, Stockholm Dart Arena, events, F&B and community in one live venue. Tomorrow it expands through hosts, ambassadors, affiliates, playable resources and venues running on Pickla OS.",
  memo_intro:
    "This memo is shared privately with approved investors. It covers the company, round terms, traction, risks, use of funds and the operating system behind Pickla.",
  round_size_sek: 1250000,
  valuation_sek: 5000000,
  share_price_sek: 10000,
  shares_offered: 125,
  total_existing_shares: 500,
  minimum_shares: 5,
  minimum_investment_sek: 50000,
  deadline_date: "2026-07-01",
  allocation_date: "2026-07-03",
  use_of_funds: [
    { label: "Product and Pickla OS", value: "Admin OS, Desk OS, Operations Truth, Customer 360, Revenue Ledger, Self Check-in and Event OS." },
    { label: "Venue growth", value: "Stockholm Dart Arena, events, F&B and community programming." },
    { label: "Network model", value: "Hosts, ambassadors, affiliates and partner venues." },
  ],
  traction_metrics: [
    { label: "Live venue", value: "Pickleball, Stockholm Dart Arena, events and F&B under one roof." },
    { label: "Pickla OS", value: "Admin OS, Desk OS, Customer 360, Operations Truth, Revenue Ledger, Self Check-in, Zettle/POS visibility and Event OS." },
    { label: "Expansion surface", value: "Hosts, ambassadors, affiliates, playable resources and AI-assisted operations." },
  ],
  risks: [
    { label: "Execution", value: "Scaling venue operations and software in parallel requires discipline." },
    { label: "Category timing", value: "Social sports demand is strong but formats can shift quickly." },
    { label: "Venue economics", value: "Events, F&B, memberships and utilization must keep improving." },
  ],
  team: [
    { name: "Gunnar Svalander", role: "Founder / operator", bio: "Runs the venue, customer relationships and Pickla OS direction." },
  ],
  memo_sections: [
    { kicker: "01 · Vision", title: "The operating system for social sports", body: "Pickla is building the software and operating model for the next generation of social sports communities." },
    { kicker: "02 · Today", title: "Pickla Arena and Stockholm Dart Arena", body: "The live venue combines pickleball, Stockholm Dart Arena, events, F&B and community into one operating system." },
    { kicker: "03 · Product", title: "Pickla OS", body: "Admin OS, Desk OS, Customer 360, Operations Truth, Revenue Ledger, Self Check-in, Zettle/POS revenue visibility and Event OS are already visible in the product." },
    { kicker: "04 · Future", title: "Hosts, ambassadors, affiliates and venues", body: "The future architecture is resource-first and AI-assisted, designed for distributed hosts, ambassadors, affiliates and venue partners." },
    { kicker: "05 · Offer", title: "Round terms", body: "Pickla Solna AB offers up to 125 shares at 10,000 SEK per share, with a maximum round size of 1,250,000 SEK." },
  ],
  page_content: investorPageContentDefaults,
};

export const investorAssetTypes: { value: InvestorAssetType; label: string }[] = [
  { value: "logo", label: "Logo" },
  { value: "hero", label: "Hero" },
  { value: "venue_photo", label: "Venue photo" },
  { value: "dart_photo", label: "Dart photo" },
  { value: "product_screenshot", label: "Product screenshot" },
  { value: "deck", label: "Deck" },
  { value: "other", label: "Other" },
];

export function moneySek(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value).toLocaleString("sv-SE")} SEK`;
}

export function assetByType(assets: InvestorAsset[], type: InvestorAssetType) {
  return assets
    .filter((asset) => asset.is_active && asset.asset_type === type)
    .sort((a, b) => a.sort_order - b.sort_order)[0] || null;
}

export function assetsByType(assets: InvestorAsset[], type: InvestorAssetType) {
  return assets
    .filter((asset) => asset.is_active && asset.asset_type === type)
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function mergeInvestorSettings(settings?: Partial<InvestorSettings> | null): InvestorSettings {
  const pageContent = settings?.page_content;
  return {
    ...investorDefaults,
    ...(settings || {}),
    use_of_funds: Array.isArray(settings?.use_of_funds) ? settings.use_of_funds : investorDefaults.use_of_funds,
    traction_metrics: Array.isArray(settings?.traction_metrics) ? settings.traction_metrics : investorDefaults.traction_metrics,
    risks: Array.isArray(settings?.risks) ? settings.risks : investorDefaults.risks,
    team: Array.isArray(settings?.team) ? settings.team : investorDefaults.team,
    memo_sections: Array.isArray(settings?.memo_sections) ? settings.memo_sections : investorDefaults.memo_sections,
    page_content: {
      ...investorPageContentDefaults,
      ...(pageContent && typeof pageContent === "object" ? pageContent : {}),
      preview_highlights: Array.isArray(pageContent?.preview_highlights)
        ? pageContent.preview_highlights
        : investorPageContentDefaults.preview_highlights,
      preview_pillars: Array.isArray(pageContent?.preview_pillars)
        ? pageContent.preview_pillars
        : investorPageContentDefaults.preview_pillars,
    },
  };
}
