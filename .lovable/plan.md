

## Plan: Fix Event Admin & Play Page Issues

### Problems identified

1. **No date field in event detail editor** -- The detail view has time fields but no date picker for `start_date`/`end_date`. The create dialog has a date field, but once created you can't change it.

2. **Status should auto-derive from date** -- If an event has a future date it should default to "upcoming", if today then "active", if past then "completed". Currently status is only manual.

3. **Duplicate event lists on Play page** -- The Play page shows events in "Idag" and "Kommande" sections, then the community feed at bottom also shows event feed cards, creating repetition.

4. **All events show "Gratis"** -- The `EventPriceBadges` component checks `entry_fee` but events likely have no `entry_fee` set yet (null/0). The tier pricing query fetches globally but doesn't match against the event's actual base price. If `entry_fee` is 0 or null, everything shows "Gratis".

5. **Play page should show tier prices inline** -- Like the screenshot shows: each event card should display the price directly (e.g. "Gratis" for members, specific prices for others), not just badges.

### Changes

#### 1. Add date fields to EventDetail editor
- Add `startDate` and `endDate` state from `event.start_date`
- Add date input fields in the detail form (before time fields)
- Include `startDate`/`endDate` in the save payload

#### 2. Auto-set status based on date
- When saving, if `startDate` is in the future -> suggest "upcoming"
- If `startDate` is today -> suggest "active"  
- If `startDate` is past -> suggest "completed"
- Keep manual override possible but show a hint

#### 3. Fix Play page: single event list, no duplicate feed
- Remove the separate "Idag" / "Kommande" split if it duplicates content
- Keep one clean list matching the screenshot: "Inga aktiviteter idag" empty state, then "KOMMANDE" section with event cards
- Each event card shows the relevant price for the user's tier (not just "Gratis" for everything)

#### 4. Fix price display logic
- The `EventPriceBadges` must handle: if event has `entry_fee_type = 'day_pass'`, look up day_pass tier pricing; if `fixed`, use `entry_fee` as base
- If `entry_fee` is null/0, show "Gratis" 
- If `entry_fee` > 0, calculate tier-specific prices and show the user's applicable price prominently
- In the event list on Play page: show single price relevant to user (member price if member, guest price if not) instead of all tier badges

### Files to change

| File | Change |
|------|--------|
| `src/components/admin/AdminEvents.tsx` | Add date picker fields to EventDetail, include in save |
| `src/pages/PlayPage.tsx` | Fix price display, clean up duplicate sections, match screenshot layout |

