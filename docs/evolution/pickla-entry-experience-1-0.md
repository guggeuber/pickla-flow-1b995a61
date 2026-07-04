# Entry Experience 1.0
## The first ten seconds of Pickla · complete deliverables

Companion to the entry-flow diagram and the prior council wireframes (decision-first home, guest sheet, member sheet, first-run landing, tab bar — all still canonical). This document is the full specification. Constitution 2.0 articles cited throughout. No backend changes anywhere: every mechanic runs on the existing customer master, resolver, membership engine, and deep-link infrastructure.

---

## 1. The complete Entry Experience

**The three-second payload:** Tonight. People. Join.
A first-time opener must understand: something is happening here tonight, real people are going, one tap joins. Nothing else has entry-screen standing.

**The ten-second timeline:**
- 0–1 s — open on Ikväll (or higher entry priority). First paint = tonight's card. No splash sequence.
- 1–3 s — comprehension: time, name, faces, one button.
- 3–6 s — desire: names do the work (Art IV). Price appears once, subordinate to people, or "Ingår."
- 6–10 s — action: member joined; stranger at the payment sheet.
**KPI: entry-to-joined time.** Member < 10 s. Stranger to payment sheet < 10 s.

**Entry priority stack (replaces "which screen is home"):**
1. Imminent/live ticket (session ≤ 2 h or checked in) → the ticket. Wallet behavior: the pass surfaces when relevant.
2. Deep link (desk QR, invite, push) → the target, surviving auth (see §7).
3. Default → Ikväll.
My Page is never an entry, for anyone. (Kills Story 1 structurally.)

**One surface, three renders** (resolver + customer master drive it):
| State | Greeting | Card state | Extra |
|---|---|---|---|
| Stranger | none — no fake familiarity | guest price, "Häng på · 99 kr" | nothing else; no login prompts on entry |
| Known guest | "Hej Anna" | guest price | ticket strip if upcoming booking |
| Member | "Hej Gunnar" | "Ingår" where covered, one-tap | quieter than stranger — recognition is the absence of persuasion (Art III) |

**Empty-night rule:** entry never shows an empty state. If nothing joinable tonight → "Imorgon händer det här" with tomorrow's pick. The house always has a next moment (Art XV).

---

## 2. Navigation philosophy

- Navigation follows intent; the top level is verbs (Art IX).
- **Ikväll is home because it answers the only universal question** — "what should I do?" Every other tab answers a narrower intent.
- Inventory exists honestly, on request: the evening list under the pick, the Boka catalogs — menus, not mazes.
- The tab bar is a map, always visible (decision speed). The hamburger menu is deleted; its contents relocate (history → Min sida; statistik → Min sida; actions → their tabs).
- Precedent (Court ruling #1): the top of Ikväll is one pick (Art X, one decision); the full evening list follows beneath (Art IX, inventory on request). The pick is the host's recommendation; the list is the menu.

## 3. Bottom navigation

| Tab | Question | Contents |
|---|---|---|
| **Ikväll** | What should I do? | Nu i huset strip · tonight's pick · evening list · tomorrow |
| **Spela** | Who can I play with? | open play, activities, 101s, events to join — people-first cards |
| **Boka** | I want my own court/tavla | courts + dart lanes (sport toggle), group/event request card |
| **Chatt** | What's happening with my people? | human threads only |
| **Min sida** | What do I have? | wallet card · live ticket · membership · history · receipts |

Pick default per intent: Spela is the newcomer's default second tab; Boka is deliberately separate (Story 2 fix — Open Play desire can never land in court rental again).

## 4. Home (Ikväll) redesign

Top to bottom: compact header (logo + "Öppet till 23" status pill) → Nu i huset one-liner (live, from ops data, Art XV) → **tonight's pick** (time, title, people row, one CTA) → evening list (simplified ActivityCards) → tomorrow header. Deleted: mood hero, 101 floating chips, placeholder-void tiles, every counter. First-run variant adds one line above the pick: "Välkommen till Pickla" and two quiet cards below the list (Pickla 101 · Boka egen bana).

## 5. Guest journey (first Open Play)

Ikväll → pick → sheet (title, time, people row, ONE price + one context line, Apple Pay CTA, "Inget konto behövs · kvitto via mejl") → pay → **ticket** with first-timer strip: "Första gången? Kom 15 min innan — vi lånar ut racket och visar dig runt." → arrival: check-in state live on ticket, greeting at 15:30 → post-play recap → "Samma tid nästa fredag?"
Auth appears only if payment requires it — as a parenthesis (§7), never a wall.

## 6. Member journey

Open → "Hej Gunnar" → pick shows "Ingår" → tap → sheet is three elements (title/time · green Ingår strip · Anmäl mig) → joined, "Du sparade 99 kr idag ✓" → ticket → next open lands on ticket (entry stack). Zero persuasion anywhere. Target: < 10 s, ~3 taps, no reading required.

## 7. Signup return flow — the parenthesis principle

Signup is a parenthesis inside a join, never a destination.
- Auth opens as a sheet within the activity sheet (Apple/Google one-tap; name flows from provider).
- On return: the SAME sheet, scroll position and selection preserved, CTA armed ("Betala 99 kr").
- Deep links survive auth: desk QR → activity → auth parenthesis → same activity, joined. The person finishes where they started.
- Forbidden as post-signup destinations: welcome tours, profile forms, My Page, membership pitches.
- Lazy profile completion, host voice, at the moment of need: "Lägg till ditt nummer så vi kan nå dig om tiden ändras" (first check-in, skippable).

## 8. Wireframes

Canonical set (delivered in prior sessions, unchanged): decision-first Ikväll with tab bar and Nu i huset · first-run landing · guest activity sheet (one price) · member activity sheet (one tap). This document adds no new wireframes — Entry Experience 1.0 is the *logic* those wireframes run on.

## 9. Interaction diagrams

Delivered inline: the entry decision flow (priority stack → three renders → join → parenthesis → ticket → loop). Supporting state machines: ticket check-in (locked → countdown → active → checked-in+greeting) and the render resolver (auth state × membership state × ticket proximity → entry render).

## 10. Component hierarchy

Entry Experience composes ONLY existing council components — no new concepts (Art XII: concept delta = 0 for this entire program; it *retires* concepts: hamburger menu, My-Page-as-landing, splash):
- **EntryResolver** (logic, not UI): priority stack + render selection. The only new named thing, and it replaces "default route" — net concept change ≤ 0.
- TonightPick = ActivityCard (featured variant)
- ActivityCard · ActivitySheet (guest/member states) · PeopleRow · PriceLine · MemberStrip · Ticket (+ FirstTimerStrip content slot) · NowStrip · TabBar · RecapCard · RebookChip

## 11. Animation ideas (constitutional motion language)

Rule: **animate people and confirmation; never prices, promotions, or brand.** (Art XIII/XIV)
- **Entry:** tonight's card settles with one gentle rise (~250 ms). No logo choreography — instant paint IS the brand gesture.
- **The room fills:** avatars in PeopleRow populate with a subtle stagger (60–80 ms apart) on first appearance. The product's signature animation: motion = people arriving. Never re-plays on scroll.
- **Join:** button morphs to a checkmark; ticket slides up Wallet-style; one soft haptic.
- **Check-in:** countdown ticks quietly; at open, the button pulses ONCE (not looping) and goes still.
- **Ingår strip:** no animation. Recognition is instant and calm — a nod, not a fanfare.
- **Recap/share:** card lifts slightly as the share sheet opens.
- Global: nothing loops, nothing bounces, nothing competes. If two things move at once, cut one.

## 12. Copywriting

| Moment | Write | Never |
|---|---|---|
| Home headline | "Ikväll på Pickla" / "Ikväll 16:00" | "WEEKEND VIBES" |
| Stranger entry | (no greeting) | "Välkommen tillbaka!" to a stranger |
| Known entry | "Hej Anna" | "Hej Anna! Har du sett våra medlemskap?" |
| Pick CTA | "Häng på · 99 kr" / "Anmäl mig" | "Logga in & anmäl" |
| People line | "Lars, Maria och 4 till är med" | "2 intresserade" / "100 kvar" |
| Below threshold | "Bli först — ta med en vän" | any count |
| Trust footer | "Inget konto behövs · kvitto via mejl" | account-required copy |
| Auth parenthesis | "Fortsätt med Apple" (in-sheet) | "Skapa ditt Pickla-konto" (page) |
| First-timer ticket | "Första gången? Kom 15 min innan — vi lånar ut racket och visar dig runt." | FAQ links |
| Lazy profile | "Lägg till ditt nummer så vi kan nå dig om tiden ändras" | "Slutför din profil (60%)" |
| Empty night | "Imorgon händer det här" | "Inga aktiviteter idag" |
| Post-join (member) | "Anmäld ✓ · Du sparade 99 kr idag" | savings math before joining |

## 13. Customer journey — before vs after

| Moment | Before | After |
|---|---|---|
| First open | Splash-ish hero → mood, no decision | Tonight's card, faces, one button (3 s payload) |
| New account | Staff: "skapa konto" → lands on empty My Page → staff explains | Desk QR → activity → auth parenthesis → joined. Staff says "välkommen," nothing else |
| Wants Open Play | Taps "Boka Pickleball" → court rental (wrong model) | Spela tab / tonight's pick — rental lives elsewhere |
| Guest pays | Login wall → 7 price expressions → checkout | One price → Apple Pay → ticket (< 10 s to sheet) |
| Member joins | Re-sold Play+, savings ×3, truncated header | "Ingår" → one tap → "Du sparade 99 kr" after |
| Returning w/ booking | Hunt through menu/My Page for booking | App opens ON the ticket (entry stack) |
| First arrival | Static "Check-in: Öppnar 15:30" | Live ticket → greeting: "Välkommen, Anna 👋" |
| Staff role | Tech support ("tap the logo") | Hospitality only |

## 14. Prioritized implementation roadmap (customer impact order)

**Wave E1 — Entry logic (week 1–2):** EntryResolver (priority stack; My Page removed as landing) · first-run lands on Ikväll · deep links survive auth (parenthesis v1: return-to-target after OAuth). Impact: Story 1 dead; the single biggest staff-explanation source removed.
**Wave E2 — The surface (week 2–4):** Ikväll rebuilt as pick + list + NowStrip · tab bar ships (Spela/Boka split — Story 2 dead) · hamburger deleted. Depends on council Wave 1 deletions (one price, people rows) being in.
**Wave E3 — The parenthesis, complete (week 4–6):** in-sheet auth · Apple Pay guest checkout wired to it · lazy profile prompts · first-timer ticket strip.
**Wave E4 — The loop (week 6–8):** ticket-first entry for imminent sessions · check-in greeting · rebook chip on ticket/recap · signature animations (room-fills stagger, join morph).

Measurement: entry-to-joined time · signup→first-join same-session rate · staff explanation rate · Spela share of first-time navigation · ticket-entry open rate before sessions.

---

## Closing: what disappears (Art XII ledger for this program)

Retired concepts: hamburger menu · My Page as landing · splash/hero as entry · "Boka Pickleball" as top nav · login wall · welcome tour (never built — now constitutionally unbuildable) · profile-completion meter (same). Added concepts: EntryResolver (replacing default-route). Net: negative. The Entry Experience makes Pickla smaller.
