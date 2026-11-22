# Patterns

How the components behave together. Each rule replaces something inconsistent in the shipped app.

## Formats

One formatter module, driven by the property's currency and locale. Remove the roughly 10 local date formatters and the hard-coded `$` in `ShiftStrip.tsx:157` and `BookingScreen.tsx:1098`.

| What | Format | Example |
|---|---|---|
| Money | Currency sign, grouped by locale, two decimals | ₹1,24,500.00 |
| Negative money | Minus sign before the currency | −₹5,000.00 |
| Report totals | Compact only where space demands it | ₹12.45L, ₹1.2Cr |
| Date in a table or form | `D Mon YYYY`, month name, set explicitly | 1 Nov 2026 |
| Date in a heading | Weekday, day, month, year | Sun 1 Nov 2026 |
| Tape column | Weekday and day, plus month at 7 days | Sun 1 Nov |
| Date range | Two dates and an en dash | 31/10/2026 – 03/11/2026 |
| Time | 12-hour with am or pm | 2:30 pm |
| Count of nights or rooms | Plain number, right-aligned | 3 |

The wire stays integer minor units. The client doesn't compute tax or allocate money.

## The three "nothing here" states

They never share a sentence.

| State | When | Wording |
|---|---|---|
| Empty | The list really has nothing | "No arrivals for this date." |
| No match | A filter or search hid everything | "No stay matches “Sharma”." Offer Clear filter. |
| Error | The data couldn't load | "Property unreachable. Can't load arrivals. This is not an empty day." Offer Try again. |

## Loading and saving

- **Loading:** `Skeleton` in the shape of what's coming. No spinners and no bare "Loading…".
- **Writing:** disable the button and change its label: "Posting…", "Saving…". There are no optimistic updates on money or inventory.
- **After a write:** update this screen at once by invalidating its real query keys. The WebSocket is for other tabs and users.
- **Queued writes:** `Alert` informational: "Request queued. It will apply when the property is reachable."
- **Autosave:** `AutosaveStatus`, at 800ms. A section either autosaves or has one Save, never both.
- **Search:** debounce by 300ms on every directory.

## Messages

| Need | Use |
|---|---|
| Result of what you just did | `Alert`, near the action |
| Problem with this page | `Alert`, above the content |
| Something across the whole app (permission miss, read-only, uncounted drawer) | `Band`, one at a time |
| A choice before acting | `Dialog` |
| Why a button is disabled | The button's `title` and a line of text |

Success notices may dismiss after a few seconds. Errors stay until they're resolved.

## Dialogs

- One `Dialog`, with a focus trap, Escape to close and focus returned to its trigger. Remove all `window.confirm` calls.
- Initial focus goes to the safest choice. Confirm buttons name the action.
- A reason, when required, is a `Textarea` that blocks confirm until filled.
- Dialogs never stack, and a form over about five fields becomes a page.
- `Popover` is the only other overlay. No drawers: use the inline `SidePanel`.

## Unsaved changes

`use-unsaved-changes.ts` only guards tab close today. `BrowserRouter` means `useBlocker` never mounts, so in-app navigation drops edits silently. Move to a data router or add a navigation guard, and use `Dialog`: "Leave without saving? Your changes to Rates will be lost." with **Keep editing** and **Leave**.

## Keyboard

Shown on screen with `kbd`, because people don't adopt shortcuts they can't see. Single-key shortcuts work only when focus isn't in a field.

| Key | Action | Where |
|---|---|---|
| Ctrl K | Focus search | Everywhere |
| Enter | Open the single match | Search |
| N | New booking | Room Plan, Front Desk, Dashboard |
| W | Walk-in | Front Desk |
| Arrow keys | Move between cells | Tape, grids |
| Enter | Open or edit the focused cell | Tape, grids |
| Enter or blur | Commit | Grid cell |
| Escape | Cancel, or close the popover or dialog | Everywhere |
| ? | List the shortcuts | Everywhere |

The aim is that a clerk can go from search to check-in to folio without the mouse. Test this with desk staff before freezing the keys.

## Permissions and impossible actions

- Nav items follow the route permission.
- A permission miss shows a `Band`, not a silent redirect.
- Impossible actions stay visible, disabled, with the reason.
- `FAIL_CLOSED` on types or availability disables Hold, Quote and Confirm with an `Alert`.

## Colour vision and language

- Check every new state in a red-green simulation: if two states look the same, change their shape or word.
- The desk is English. Whether room attendants need Hindi or another language is client question territory. The mobile client's strings must be translatable from day one.
- Hindi strings need review by a native speaker before release.
