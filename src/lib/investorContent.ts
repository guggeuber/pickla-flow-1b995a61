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
  return {
    ...investorDefaults,
    ...(settings || {}),
    use_of_funds: Array.isArray(settings?.use_of_funds) ? settings.use_of_funds : investorDefaults.use_of_funds,
    traction_metrics: Array.isArray(settings?.traction_metrics) ? settings.traction_metrics : investorDefaults.traction_metrics,
    risks: Array.isArray(settings?.risks) ? settings.risks : investorDefaults.risks,
    team: Array.isArray(settings?.team) ? settings.team : investorDefaults.team,
    memo_sections: Array.isArray(settings?.memo_sections) ? settings.memo_sections : investorDefaults.memo_sections,
  };
}
