# Analytics — Event Taxonomy

ResistAct uses **GA4** via [`src/app/lib/analytics.ts`](../src/app/lib/analytics.ts).
The module is privacy-respecting by design: it honors Do-Not-Track, disables
Google Signals and ad personalization, and **sends no PII** — no email, no name,
no user ID, no free text. Events carry only IDs, categories, and enums.

> Adding a new event? Add a **typed helper** to the `analytics` object in
> `analytics.ts` — don't call the low-level `track()` from components. Keep
> param names `snake_case` to match GA4 recommended conventions.

## The funnels

**Engagement funnel** (does someone actually take a civic action?)

```
card_opened  →  action_link_clicked  →  action_completed  →  share
 (interest)      (click-through ★)        (did it ★)         (amplify ★)
```

**Match funnel** (does the wizard convert?)

```
match_started  →  match_set ★        (converted)
              ↘   match_abandoned    (dropped — `step` shows where)
```

**Growth** — `sign_up ★`, `login`, `act_submitted ★` (user-generated supply).

★ = should be marked as a **Key Event** in GA4 (see below).

## Event reference

| Event | Helper | Params | Fires when |
|---|---|---|---|
| `card_opened` | `cardOpened` | `card_id`, `category` | CardDetailsModal mounts |
| `action_link_clicked` ★ | `actionLinkClicked` | `card_id`, `category`, `link_surface` | "I want to ResistAct!" link-out clicked |
| `action_completed` ★ | `actionCompleted` | `card_id`, `category` | User marks an Act done (fresh only, not un-do) |
| `share` ★ | `shareClicked` | `method`, `content_type`, `item_id?` | A share destination is clicked |
| `resource_link_clicked` | `resourceLinkClicked` | `resource`, `card_id?` | ACLU know-your-rights (or similar) clicked |
| `boost` | `boostToggled` | `card_id` | A card is boosted (add only — un-boost not tracked) |
| `bookmark` | `bookmarkToggled` | `card_id` | A card is bookmarked (add only — un-bookmark not tracked) |
| `card_flagged` | `cardFlagged` | `card_id`, `reason` | A card is flagged |
| `match_started` | `matchStarted` | — | Match wizard opens |
| `match_set` ★ | `matchSet` | `time_bucket`, `tone_*` | Wizard preferences applied |
| `match_abandoned` | `matchAbandoned` | `step` | Wizard closed without applying |
| `match_feedback` | `matchFeedback` | `card_id`, `category`, `sentiment` | "Great match" thumbs-up |
| `sign_up` ★ | `signUp` | `method` | Account created (`method`: email/google) |
| `login` | `login` | `method` | Returning user signs in |
| `act_submitted` ★ | `actSubmitted` | `category` | A new Act is posted |

## Configuring Key Events in GA4 (no code — do this in the UI)

The dashboard currently shows **Key events: 0**, which is why GA can't report on
conversions. Fix it once:

1. GA4 → **Admin** (gear, bottom-left) → **Events** (under *Data display*).
2. Wait for an event to appear in the list (new events can take 24–48h to show
   after first fire), then toggle **Mark as key event** for:
   `action_link_clicked`, `action_completed`, `share`, `match_set`, `sign_up`,
   `act_submitted`.
3. If an event hasn't fired yet, **Admin → Key events → New key event** and type
   the exact name to pre-register it.

### Recommended next steps (optional)

- **Funnel exploration** (Explore → Funnel exploration): steps
  `card_opened → action_link_clicked → action_completed` to see drop-off.
- **Custom dimensions** (Admin → Custom definitions): register `category` and
  `link_surface` as event-scoped dimensions so you can break reports down by them.
- **Internal-traffic filter**: the `MEASUREMENT_ID` in `analytics.ts` falls back
  to the **production** property, so local `npm run dev` sessions send real
  events. Define an internal-traffic rule (Admin → Data Streams → Configure tag
  settings → Define internal traffic) by IP, and add a data filter, to keep dev
  noise out of reports.

## Privacy posture (do not regress)

Events must never carry PII. When in doubt, send an **ID or an enum**, never a
string a human typed. The founding-cohort promise is "no tracking, no list you
can't escape" — event-level product analytics is compatible with that only as
long as it stays anonymous and aggregate.
