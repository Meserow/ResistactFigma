# Onboarding Wizard Redesign — Implementation Plan

**For:** the implementing agent (Opus). Read this whole doc before writing code.
**Written:** 2026-07-08, against v1.4.119 on `develop`.
**Goal owner:** Ellen. Do not commit or deploy without her explicit go-ahead. Bump
`package.json` version + add a `src/app/data/changelog.ts` entry when the work is done
(user-facing language), per CLAUDE.md.

---

## 1. What we're building, in one paragraph

Merge the two first-visit surfaces — the "How does ResistAct work?" InfoModal and the
"Find your path" JourneyModal (added in v1.4.119) — into **one** beautifully designed,
full-size onboarding wizard called **Get Started**. It explains the site, asks what kind
of activism fits the visitor's life (time + location), shows them their place on the
spark→inferno ladder, and lands them in a feed filtered to their tier's unlocked act
categories. It is launched by a new **Get Started** button in the navbar next to "Join
The Resistance," auto-opens once for brand-new visitors, and is re-enterable from the
welcome banner. The current implementations are functional but visually cramped — this
plan is as much a **design fix** as a feature merge.

## 2. Design critique of what exists (why we're redoing it)

Both current surfaces squeeze content into small dialogs with small type. Specifics:

**InfoModal** (`src/app/components/InfoModal.tsx`):
- 980px dialog split 50/50 with a photo; the text half crams a pitch, a quote, and
  five value-prop bullets at **12–12.5px** type.
- The tier ladder is a frosted overlay on the photo's bottom third at **10–11px** —
  the gamification system, one of the site's best hooks, is presented as fine print.
- It's a static brochure: no progression, no next step. Its primary CTA is
  "Contact Us," which is the wrong ask for a first-time visitor.
- It auto-opens on first visit, and when the visitor closes it the JourneyModal
  auto-opens — two stacked-in-sequence modals with different visual chrome.

**JourneyModal** (`src/app/components/JourneyModal.tsx`):
- `max-w-[560px]` dialog. Header title 16px; body copy 13–14px; ladder pitch lines
  **11px**; category chips **10px**; step dots 6px. Everything was sized to fit the
  box instead of the box being sized for the content.
- Step 3 ("your path") renders all six tiers × all their category chips at once,
  forcing an inner scroll on a modal — the payoff screen is the most cramped.
- Its chrome (header/footer/close/dots) matches neither InfoModal nor TierModal.

**Verdict:** replace both auto-open experiences with one wizard, designed at a
comfortable size with a single coherent visual system. InfoModal survives only as the
"About" reference page (see §8).

## 3. The new component: `OnboardingWizard`

New file: `src/app/components/OnboardingWizard.tsx` (plus small subcomponents in the
same file or `components/onboarding/` if it grows past ~600 lines). The existing
`lib/journey.ts` (tier→category unlock ladder, pitches, helpers) is the data source of
truth and **must not change**. `lib/tiers.ts` thresholds must not change.

### Container & chrome (one system for every step)

- **Desktop (md+):** centered dialog, `max-w-[880px]`, `min-h-[620px]`, `max-h-[92vh]`,
  `rounded-3xl`, on a `bg-[#0d1b2a]/60 backdrop-blur-sm` overlay. Content padding
  `px-10 py-8`.
- **Mobile:** full-screen takeover (inset-0, no rounding), body scrolls, footer pinned.
  Content padding `px-5 py-6`.
- **Header (every step):** orange eyebrow (`text-[11px] font-extrabold uppercase
  tracking-[0.18em] text-[#ed6624]`) reading `GET STARTED`, step title below it at
  **28px desktop / 22px mobile, font-bold, #23297e**, close (X) top-right, back chevron
  top-left from step 2 onward.
- **Footer (every step):** pinned bar with step-progress dots on the left (active dot
  24px wide bar, inactive 8px circles — bigger than today's), buttons on the right.
  Primary button: orange `#ed6624` pill, `h-12 px-7`, **15px bold** white text.
  Secondary: ghost navy text button, same height. All tap targets ≥ 44px.
- **Step transitions:** 200ms fade+slide (translateX 24px), honoring
  `prefers-reduced-motion: reduce` (no motion, instant swap).
- **Type floor: nothing under 12px anywhere in the wizard.** Body copy 15–16px,
  `leading-relaxed`. This is the single most important rule in this plan.
- Focus trap inside the dialog, `role="dialog" aria-modal="true"`, Esc closes,
  body scroll locked while open (copy the pattern from App.tsx's swipeOpen effect).

### Props

```ts
interface OnboardingWizardProps {
  actionCount: number;                     // (effectiveMyCompletions ?? localCompletions)?.total ?? 0
  isLoggedIn: boolean;
  categoryCounts: Record<string, number>;  // existing journeyCategoryCounts memo in App.tsx
  detectedState: string | null;            // from the existing geo detect (GEO_KEY) if available
  stateOptions: string[];                  // existing dynamicLocations
  onClose: () => void;
  onApply: (p: { timeBucket: TimeBucket | null; state: string | null; remoteOnly: boolean; categories: string[] | null }) => void;
  onJoin?: () => void;                     // opens AuthModal (signup nudge on the final step)
}
```

## 4. The five steps (layout + full copy)

Copy voice: warm, funny-adjacent, zero shame. Never imply the visitor *should* do more.
The copy below is ready to use verbatim; small edits for fit are fine, tone changes are not.

### Step 1 — Welcome (replaces InfoModal's pitch)

Layout: single centered column, max-w-[560px] inside the wide dialog — generous
whitespace is the point. Logo fist image (48px) above the title.

- Title: **"You're here. That already counts."**
- Body (16px): "Feeling helpless? Tired of hearing that voting and donating are the
  only levers you've got? ResistAct is a daily menu of small, doable acts of
  resistance — vetted, matched to your real life, and private. No tracking, no email
  list you can't escape, no account required."
- The Margaret Mead quote, styled large enough to read (14px italic, orange left rule) —
  keep it, it's the founding beat.
- Primary: "Show me how it works →"  Secondary: "Skip — just let me browse"
  (secondary closes the wizard entirely).

### Step 2 — How it works (the InfoModal content, redesigned as three big cards)

Layout: three horizontal cards on desktop (stack on mobile), each with a 40px icon
tile, an 18px bold heading, and 15px body. This absorbs the InfoModal's five bullets
into three:

1. **Find your act.** (Zap icon, navy tile) "Filter by time, mood, and place — or let
   Quick Match deal you a hand. Text your reps, drop a flyer, knit a hat for a march.
   New acts daily."
2. **Do it. Count it.** (Flame icon, orange tile) "Hit 'I did this!' and it counts —
   for you and for the movement's momentum. No account needed; your progress lives on
   your device."
3. **Level up. Unlock more.** (the tier strip, see below) "Every act moves you up the
   ladder, from Spark to Inferno. Each tier opens new kinds of acts — when you're
   ready, never before."

Under the cards: the six tier badges in a horizontal strip (36px badges, names beneath
at 12px) — reuse `TierIcon` + `TIERS`. This replaces InfoModal's fine-print ladder
overlay with a proper, legible moment.

Footer note (13px, gray-500): "The Facts (ready-made rebuttals) and The Smacks
(shareable receipts) live in the top nav whenever you need ammo."

- Primary: "Find my starting point →"  Back: chevron.

### Step 3 — Time (existing question, more room)

Reuse `InvolvementPicker` but **restyle for this context**: pass a new size variant or
wrap with overrides so the five cards render larger — title 16px, subtitle 12px, desc
13px, `py-4` padding, and on desktop a single row of five with real gaps (`gap-3`).
(Today they render at 10–14px. If modifying InvolvementPicker, add an optional
`size?: "default" | "large"` prop so the Quick Match and Add-an-Action call sites are
untouched.)

- Title: **"How much room does life have right now?"**
- Hint (15px, not 12px): "Honest answers only — 'barely any' is a great answer. Small
  acts count, and on hard weeks they count double."
- Selecting a card advances automatically after 250ms (plus a Continue button for
  keyboard users). Preselect nothing; if the user hits Continue with no pick, treat as
  `null` (no time filter).

### Step 4 — Place (new step; completes "a proper set of cards")

- Title: **"Where should your acts find you?"**
- Two large toggle cards side by side: **"Near me"** (MapPin icon; below it a state
  select prefilled from `detectedState`, options from `stateOptions`) and **"From my
  couch"** (House icon; remote/at-home acts only). Both can be on; at least the visual
  states must make combinations obvious.
- Skip link: "Show me everything, everywhere" (sets state null, remoteOnly false).
- This step writes nothing itself — selections ride along in the apply payload and are
  mirrored into the existing Location pill exactly the way MatchMeModal's `onApply`
  does in App.tsx (~line 4500: preserve Remote/In Person mode tokens, state token owned
  by the picker).

### Step 5 — Your path (the payoff — this is the screen that must feel designed)

Do **not** render six tiers × all chips in a wall like today. Structure:

1. **Hero zone (top):** the visitor's current tier, big. 72px tier badge with its glow
   color, "You start as a **Spark**" / "You're already an **Ember**" at 28px, tier
   pitch from `JOURNEY_PITCH` at 16px, then the unlocked category chips at a readable
   size — **13px bold text, 12px icon, px-3 py-1.5 pills** in the category's canonical
   color (`colorForCategory` / `iconForCategory`). Below the chips: "**N acts** are
   waiting in these categories." (count from `categoryCounts` summed over
   `unlockedCategoriesFor(tier.key)`; when that helper returns `null` — Wildfire and
   up — say "Every act on the site is yours." and sum everything.)
2. **The road ahead (middle):** a horizontal stepper on desktop (vertical timeline on
   mobile) of all six rungs. Each rung: 32px badge, name (14px bold, tier labelColor;
   gray for locked), threshold ("at 10 acts", 12px, with a Lock icon for locked rungs).
   The **next** tier's rung is expanded by default into a teaser card: "3 acts from
   Ember — unlocks Email, Phoning, Social Media, Kindness, Petition, Commitment"
   with those chips rendered grayscale. Other locked rungs expand on click
   (accordion, one open at a time). Past rungs show a small "unlocked ✓".
   Data: `JOURNEY_UNLOCKS[tierKey]` for per-rung chips.
3. **Pinned CTA bar (bottom):** primary "**Show my Spark acts (N)**" (tier name +
   live count), secondary "Just browsing". If `!isLoggedIn`, a third quiet line under
   the buttons: "Want your flame to follow you across devices? [Create a free
   account]" wired to `onJoin` — this is a nudge, not a gate; do not block anything
   on signup.

Wildfire/Inferno visitors (count ≥ 50): skip the accordion teaser (nothing is locked);
hero says everything is unlocked; CTA reads "Show me everything (N)".

## 5. Apply behavior (App.tsx)

Keep the existing `handleJourneyApply` logic and extend it for the new payload:

- Categories → Category pill filters, **intersected with categories that have live
  cards** (`journeyCategoryCounts[c] > 0`), exactly as today. `null` categories →
  clear the Category pill.
- `timeBucket === "5min"` → `setQuickActionsOnly(true)`, else false (unchanged).
- NEW: `state` / `remoteOnly` → mirror into the Location pill using the MatchMeModal
  `onApply` pattern (preserve mode tokens; don't clobber other location state).
- Then: close wizard, `setStaggerKey(k => k+1)`, smooth-scroll to top, and show a
  **confirmation banner** above the feed (not just a 2-second toast): reuse the
  WelcomeHero visual style — orange accent rail, "Your Spark path is set — N acts fit
  your life right now. Clear or change any filter above whenever you like." with a
  dismiss X. One-time per apply (component state, not localStorage).

## 6. Entry points

1. **Navbar button (the ask):** in `components/Navbar.tsx`, logged-out branch of the
   right-side cluster (desktop version ~line 592–617, next to the orange "Join The
   Resistance" button; there is a parallel mobile-menu branch ~line 1235 — add it in
   both). Style: navy **outlined** pill so it reads as the path *before* the orange
   join CTA — `border-2 border-[#23297e] text-[#23297e] rounded-2xl px-4`, Compass
   icon, label **"Get Started"**, hover fills navy with white text. Same height as the
   Join button. New prop `onGetStarted?: () => void` threaded from App.tsx.
   Show it only when logged out (logged-in users have LoggedInHero + tier dashboard).
2. **Auto-open, once per device:** keep the existing effect in App.tsx (search for
   `resistact_journey_seen`) but simplify: the wizard **replaces** the InfoModal
   auto-open entirely. Delete the `resistact_intro_seen` effect's auto-open (the
   effect near `introSeen` in App.tsx) and let the wizard be THE first-visit
   experience. Gate stays: logged-out + `synced` + acts tab + no swipe overlay.
   Flag: keep using `resistact_journey_seen` (existing visitors who already saw the
   v1.4.119 journey won't be re-popped; brand-new visitors get the wizard).
3. **WelcomeHero button:** keep, relabel to "Get Started — find your path", opens the
   wizard (same handler as the navbar button).
4. Remove the JourneyModal render + its states once the wizard is wired; delete
   `components/JourneyModal.tsx` after porting (git history keeps it).

## 7. What happens to InfoModal

- It no longer auto-opens (see §6.2) and loses its onboarding job.
- Keep it reachable from the navbar "About" item as the reference page (contact,
  founders, the Baby Trump photo, the long-form pitch). Slim it in this pass only as
  far as removing the tier-ladder photo overlay (the wizard owns the ladder now) and
  raising its body text to ≥ 13px. A deeper About redesign is out of scope.

## 8. Files touched (checklist for the implementer)

| File | Change |
|---|---|
| `components/OnboardingWizard.tsx` | NEW — everything in §3–4 |
| `components/JourneyModal.tsx` | DELETE after port |
| `App.tsx` | swap journey state/render for wizard; retire InfoModal auto-open; extend apply handler (§5); confirmation banner; thread `onGetStarted` to Navbar |
| `components/Navbar.tsx` | Get Started button, desktop + mobile menu (§6.1) |
| `components/WelcomeHero.tsx` | relabel re-entry button (§6.3) |
| `components/InvolvementPicker.tsx` | optional `size="large"` variant (§4 step 3) |
| `components/InfoModal.tsx` | remove ladder overlay; min 13px text (§7) |
| `lib/journey.ts`, `lib/tiers.ts`, `lib/matcher.ts` | **no changes** |
| `package.json`, `data/changelog.ts` | version bump + user-facing entry |

## 9. Acceptance criteria (verify each in the browser before reporting done)

Use the preview tools (`preview_start` config "resistact", port 5173/auto). Simulate a
fresh visitor by clearing `resistact_journey_seen` (and check both with and without
`resistact_intro_seen`).

1. Fresh logged-out visitor: exactly ONE thing auto-opens — the wizard. Never two
   modals in sequence or stacked.
2. Navbar shows "Get Started" next to "Join The Resistance" when logged out (desktop
   and mobile menu); clicking it opens the wizard at step 1 any time.
3. No text anywhere in the wizard renders under 12px (spot-check with
   `preview_inspect` on chips, hints, dots); body copy is 15–16px.
4. Step 5 hero shows the correct tier for `actionCount` 0 (Spark), 5 (Ember), 30
   (Blaze; verify cumulative chips), 60 (Wildfire; "everything" state) — drive via
   `localStorage.resistact_completed` arrays of fake ids + reload.
5. Applying as a Spark sets Category pills to exactly Amplify/Crafting/Represent/
   Texting (those with live cards), the 5-min filter iff "Just the basics" was picked,
   and the Location pill iff a state/remote choice was made; the confirmation banner
   shows the same count as the CTA promised.
6. "Just browsing" and the X close without touching any filter.
7. Esc closes; focus is trapped while open; `prefers-reduced-motion` disables the
   step slide animation.
8. Mobile (preview_resize 375×812): full-screen wizard, pinned footer, step 5 timeline
   is vertical, no horizontal scroll.
9. `npm run build` passes. Version + changelog updated.
10. Screenshot each step (desktop + one mobile) in the final report.

## 10. Known landmines (learned building v1.4.119 — don't rediscover these)

- Every ActionCard's flip side has an "I did this!" button in the DOM. When driving
  the UI in preview_eval, scope queries to the open modal's `.fixed` container or
  you'll complete a random background card.
- POST `/actions/:id/complete` 404s ("Unknown card id") for some newer harvest-era
  card ids (e.g. 2746, 2748) — a pre-existing prod bug tracked separately. If a
  completion doesn't celebrate during testing, use an old card (ids 1, 19, 21, 22
  work).
- `activeTab`, `synced`, and other App.tsx state are declared in a specific order —
  an effect placed above a `useState` it references crashes with a TDZ error. Put new
  effects near the existing journey effect (search `resistact_journey_seen`).
- The WelcomeHero auto-dismisses after >100px scroll and switches to a "personalized"
  copy variant once the signal log warms up — any button added there must render in
  BOTH variants (this was already fixed once; don't regress it).
- Always deploy nothing. Frontend ships when Ellen pushes `develop`.
