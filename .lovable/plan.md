

# Pickla Smart UX Redesign — Bolt-inspired, Self-Driving Experience

## The Vision
Transform Pickla from a "form-filling booking app" into a **smart, predictive, Bolt/Uber-like experience** where the app knows what you want before you do. Less clicking, more doing.

## Key Problems to Solve
1. **BookingPage is too long** — sport filter missing, all courts shown (Dart + Pickleball mixed), phone/name input is friction for logged-in users
2. **No intelligence** — app doesn't learn from your habits or suggest repeat bookings
3. **MyPage is a data dump** — needs to become a smart hub (Wallet, Activities, Receipts)
4. **No sport selection** — user sees 27 courts when they only want Pickleball

## Changes

### 1. BookingPage.tsx — Smart Booking Flow (Bolt-inspired)

**Step 1: Sport selector** (like Bolt's "Rides / 2 wheels / Schedule")
- Three large tappable cards at top: **Pickleball**, **Dart**, **Padel**
- Filters courts by `court_type` / sport prefix
- Remember last selected sport in localStorage

**Step 2: Smart suggestions** (like Bolt's recent addresses)
- If logged in: show "Du brukar boka torsdagar 17:00" with one-tap re-book
- Query last 5 bookings, find patterns (same day/time), surface as suggestion cards
- "Boka igen" button that pre-fills everything

**Step 3: Simplified court selection**
- After sport + date + time selected, show ONLY relevant courts
- Option: "Bana spelar ingen roll" toggle (auto-assigns cheapest available court)
- Selected = brand red (#CC2936), not black

**Step 4: No name/phone for logged-in users**
- If authenticated + profile has name & phone: skip the form entirely
- Show small "Bokar som: Lars S. · 070..." with edit link
- Only show form for anonymous users

**Step 5: Sticky bottom CTA**
- Fixed bottom bar: "2 banor · 590 kr · BOKA" always visible
- No scroll needed to find the button

### 2. MyPage.tsx → Smart Hub with Wallet & Activities

**Replace current sections with Bolt-like card structure:**

**Top: Smart greeting + suggestion**
- "Hej Lars — din vanliga torsdag 17:00 är ledig. Boka?"
- One-tap action card based on booking patterns

**Section: Aktiviteter** (replaces "Bokningar")
- Two tabs: **Kommande** (with access codes, share buttons) | **Historik** (receipts)
- Each card: date, time, court, code, share icon
- Upcoming cards have countdown timer + QR

**Section: Wallet**
- Payment methods (future Stripe saved cards)
- Active day passes with share
- Membership status + tier badge
- Coupons/credits (future)
- Corporate hour bank

**Section: Quick Actions** (keep existing pills but smarter)
- Dynamic: if no upcoming booking → "Boka bana" is primary
- If has booking today → "Visa kod" is primary

### 3. PlayPage.tsx — Update Links
- "Boka bana" → `/book` (unchanged)
- Keep existing hero + card design from recent redesign

### 4. Shared: Brand Colors Update
Apply the new palette consistently:
- Red #CC2936 for selected states and hero
- Dark Blue #1a1f3a for buttons and headers
- Cream #faf8f5 for backgrounds
- NO orange anywhere

## Technical Details

### Smart Suggestions Logic (BookingPage)
```typescript
// Query user's booking history
const { data: history } = useQuery({
  queryKey: ["booking-history", user?.id],
  enabled: !!user,
  queryFn: async () => {
    const { data } = await supabase
      .from("bookings")
      .select("start_time, venue_court_id, venue_courts(name, court_type)")
      .eq("user_id", user.id)
      .order("start_time", { ascending: false })
      .limit(20);
    return data;
  },
});

// Find patterns: most common day + time
function findPattern(bookings) {
  const freq = {};
  bookings.forEach(b => {
    const dt = DateTime.fromISO(b.start_time, { zone: 'Europe/Stockholm' });
    const key = `${dt.weekday}-${dt.hour}`;
    freq[key] = (freq[key] || 0) + 1;
  });
  // Return most frequent day+time combo
}
```

### Sport Filter
- Use existing `court_type` field or name prefix ("Dart", "Bana") to categorize
- localStorage key: `pickla_preferred_sport`

### Wallet Section (MyPage)
- Reuses existing hooks: `useMyPasses`, `useActiveMembership`, `useCorporateMemberships`
- Reorganized into a single "Wallet" card with sub-sections
- Day pass sharing UI stays but moves inside Wallet

### "Bana spelar ingen roll" Toggle
- When enabled: on submit, auto-pick first available court matching selected sport
- Reduces cognitive load for casual players

## Files to Edit
1. **src/pages/BookingPage.tsx** — Sport selector, smart suggestions, skip form for auth users, sticky CTA
2. **src/pages/MyPage.tsx** — Wallet section, Activities tabs, smart greeting with suggestions
3. **src/pages/PlayPage.tsx** — Minor link updates if needed

## What This Does NOT Change
- All backend APIs remain the same
- Booking mutation logic unchanged
- Stripe checkout flow unchanged
- Corporate booking flow unchanged
- Authentication flow unchanged

