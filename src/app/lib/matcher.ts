// "Match me to an action" — scores cards against a user's preferences.
//
// Strategy: derive tone, time, and risk from existing card fields (category,
// timeCommitment, isOnline, actionType, description). No per-card metadata
// needed — we infer from the category buckets the platform already has.
//
// If a card needs a tone different from its category default, we'd add an
// optional `toneOverride` field on the card later. Not in v1.

import type { ActionCardData } from "../components/ActionCard";

// ─── Vocabulary ───────────────────────────────────────────────────────────────

export type TimeBucket = "5min" | "10min" | "30min" | "1hr" | "fewHours" | "fullDay" | "ongoing";

/**
 * What kind of action context the user is willing to engage in. Stored as
 * an array on Preferences so the user can pick more than one. An empty array
 * means "any" — no filter.
 *  - "online":   "Remote" in the UI; can be done from home (online OR offline
 *                tasks like knitting, letter-writing, phone-calling reps)
 *  - "inPerson": requires showing up somewhere
 */
export type Setting = "online" | "inPerson";

export type VulnerableGroup =
  // ── Identity (original 7) ──────────────────────────────────────────
  | "woman"
  | "immigrant"
  | "lgbtq"
  | "repro"
  | "disabled"
  | "fedWorker"
  | "journalist"
  // ── Race, ethnicity, religion ─────────────────────────────────────
  | "black"
  | "muslim"
  | "jewish"
  | "asian"
  | "indigenous"
  | "latino"
  | "nonChristianMinority"
  // ── Identity additions ────────────────────────────────────────────
  | "refugee"
  // ── Role, occupation, status ──────────────────────────────────────
  | "student"
  | "educator"
  | "publicHealthWorker"
  | "scientist"
  | "lawyer"
  | "whistleblower"
  | "libraryWorker"
  | "nonprofitWorker"
  | "electionWorker"
  | "veteran"
  | "unionWorker"
  | "farmworker"
  // ── Economic ──────────────────────────────────────────────────────
  | "lowIncome"
  | "medicaidMedicare"
  | "obamacare"
  | "ssdi"
  | "renter"
  // ── Geographic / situational ──────────────────────────────────────
  | "ruralHealthcare"
  | "climateAffected"
  | "abortionTravel"
  | "incarcerated"
  | "unhoused";

export interface Tone {
  /** Confrontational, in-the-streets energy. */
  anger: number;
  /** Mockery, irreverence, prank. */
  comedy: number;
  /** Below-board, system-disrupting energy. */
  subversion: number;
  /** Mutual aid, solidarity, listening. */
  care: number;
  /** Above-board institutional channels (calls, letters, votes). */
  hope: number;
  /** Physical/emotional intensity required — high for protests and flash mobs,
   * low for prayer and quiet boycotts. Lets users dial in by capacity. */
  energy: number;
}

export interface Preferences {
  time: TimeBucket | null;
  /** Empty array = "any" (no filter). One or more entries = card must match
   * at least one of them. */
  setting: Setting[];
  /** State name (e.g. "California", "New York", "Washington DC") or null for
   * "Anywhere". When set, hard-filters out cards tied to other states.
   * Cards marked "Online", "National", "Multi-state", or `atHome=true` always
   * pass — they're location-independent. */
  state: string | null;
  /** When true, the state field is used for ranking only — cards from other
   * states still pass the filter, but the user's state ranks higher. Lets a
   * user say "I'm in CA but show me everything, just put my local stuff
   * first." Has no effect when `state` is null. */
  includeAnywhere: boolean;
  vulnerableGroups: VulnerableGroup[];
  /** Opt-in: when true, the matcher should surface high-leverage donation
   * targets — close, urgent races where additional funding can tip the
   * outcome — ahead of broader actions. Stored on the user's profile so the
   * curation persists. */
  focusDonations: boolean;
  tone: Pick<Tone, "anger" | "comedy" | "subversion" | "hope" | "energy">;
  /** Categories the user has explicitly opted out of — cards in any of these
   * categories are hard-filtered from the matched feed. Title-Case strings
   * matching the canonical form produced by `normaliseCategory` in App.tsx
   * (e.g. "Petition", "Crafting", "Email Campaign"). Empty array = no
   * exclusions (default). */
  excludedCategories: string[];
}

export const DEFAULT_PREFERENCES: Preferences = {
  // 30 min is the default because that's where most casual users land.
  // The wizard shows time as a slider, so it must be a real value (not null) —
  // null was a holdover from the old pill-picker step.
  time: "30min",
  setting: [],
  state: null,
  includeAnywhere: false,
  vulnerableGroups: [],
  focusDonations: false,
  tone: { anger: 1, comedy: 1, subversion: 1, hope: 1, energy: 1 },
  excludedCategories: [],
};

// ─── Category → tone defaults ─────────────────────────────────────────────────
// 0 = none, 3 = strong. Design goal: vectors must be ORTHOGONAL so that moving
// a single slider produces a meaningful change in results.
//
// Key rules enforced here:
//   • High-energy categories (PROTEST, FLASH MOB, IRREVERENCE) get hope=0 so
//     raising the hope slider actually surfaces petitions/prayers over them.
//   • Low-effort categories (PETITION, EMAIL, PRAYER, BOOST) get energy=0 so
//     lowering the energy slider lifts them above protests and flash mobs.
//   • PETITION/EMAIL/LETTER anger is 1, not 2 — they shouldn't score high
//     when the user wants to channel pure rage (use PROTEST/BOYCOTT for that).

/** Built-in category tone defaults. Used as the fallback when no runtime
 * override has been loaded from the admin "Matcher Tuning" panel. */
export const DEFAULT_CATEGORY_TONE: Record<string, Tone> = {
  "IRREVERENCE":          { anger: 1, comedy: 3, subversion: 3, care: 0, hope: 0, energy: 2 },
  "PROTEST":              { anger: 3, comedy: 0, subversion: 1, care: 1, hope: 1, energy: 3 },
  "FLASH MOB":            { anger: 2, comedy: 2, subversion: 3, care: 0, hope: 0, energy: 3 },
  "BOYCOTT":              { anger: 2, comedy: 0, subversion: 2, care: 0, hope: 1, energy: 0 },
  "ART PIECE":            { anger: 1, comedy: 2, subversion: 2, care: 1, hope: 1, energy: 2 },
  "PETITION":             { anger: 1, comedy: 0, subversion: 0, care: 1, hope: 3, energy: 0 },
  "EMAIL CAMPAIGN":       { anger: 1, comedy: 0, subversion: 0, care: 1, hope: 3, energy: 0 },
  "LETTER TO EDITOR":     { anger: 1, comedy: 0, subversion: 0, care: 1, hope: 3, energy: 0 },
  "SOCIAL MEDIA":         { anger: 1, comedy: 2, subversion: 1, care: 1, hope: 1, energy: 2 },
  "BOOST":                { anger: 0, comedy: 0, subversion: 0, care: 2, hope: 2, energy: 0 },
  "ACT OF KINDNESS":      { anger: 0, comedy: 0, subversion: 0, care: 3, hope: 2, energy: 1 },
  "SPREAD POSITIVITY":    { anger: 0, comedy: 1, subversion: 0, care: 3, hope: 3, energy: 1 },
  "PRAYER":               { anger: 0, comedy: 0, subversion: 0, care: 3, hope: 3, energy: 0 },
  "MENTAL HEALTH":        { anger: 0, comedy: 0, subversion: 0, care: 3, hope: 2, energy: 0 },
  "MEETING":              { anger: 1, comedy: 0, subversion: 0, care: 2, hope: 3, energy: 2 },
  "TRAINING":             { anger: 1, comedy: 0, subversion: 1, care: 2, hope: 2, energy: 1 },
  "JOIN A GROUP":         { anger: 1, comedy: 0, subversion: 1, care: 2, hope: 2, energy: 2 },
  "PERSONAL COMMITMENT":  { anger: 0, comedy: 0, subversion: 0, care: 2, hope: 3, energy: 0 },
  "PROFESSIONAL SKILLS":  { anger: 0, comedy: 0, subversion: 0, care: 2, hope: 2, energy: 2 },
  "TRANSPORTATION":       { anger: 0, comedy: 0, subversion: 0, care: 3, hope: 2, energy: 2 },
  "HOUSING":              { anger: 0, comedy: 0, subversion: 0, care: 3, hope: 2, energy: 2 },
  "LABOR":                { anger: 2, comedy: 0, subversion: 1, care: 2, hope: 2, energy: 2 },
  "CRAFTING":             { anger: 0, comedy: 1, subversion: 0, care: 2, hope: 2, energy: 2 },
  "NEWS STORY":           { anger: 1, comedy: 0, subversion: 1, care: 1, hope: 1, energy: 1 },
  "FUNDING":              { anger: 0, comedy: 0, subversion: 0, care: 2, hope: 2, energy: 0 },
  "OTHER":                { anger: 1, comedy: 1, subversion: 1, care: 1, hope: 1, energy: 1 },
};

/** Live category tone map. Starts as a copy of DEFAULT_CATEGORY_TONE; admins
 * can replace per-category values via applyMatcherConfig() — those mutations
 * affect every subsequent score()/toneFor() call without a redeploy. */
let CATEGORY_TONE: Record<string, Tone> = { ...DEFAULT_CATEGORY_TONE };

/** Replace the live CATEGORY_TONE map with admin-supplied values. Unknown
 * categories are merged in; missing categories fall back to the default.
 * Pass `null` to reset to the built-in defaults. */
export function applyMatcherConfig(config: { categoryTone?: Record<string, Partial<Tone>> } | null): void {
  if (!config || !config.categoryTone) {
    CATEGORY_TONE = { ...DEFAULT_CATEGORY_TONE };
    return;
  }
  const merged: Record<string, Tone> = { ...DEFAULT_CATEGORY_TONE };
  for (const [cat, partial] of Object.entries(config.categoryTone)) {
    const base = DEFAULT_CATEGORY_TONE[cat.toUpperCase()] ?? NEUTRAL_TONE;
    merged[cat.toUpperCase()] = {
      anger:      typeof partial.anger      === "number" ? partial.anger      : base.anger,
      comedy:     typeof partial.comedy     === "number" ? partial.comedy     : base.comedy,
      subversion: typeof partial.subversion === "number" ? partial.subversion : base.subversion,
      care:       typeof partial.care       === "number" ? partial.care       : base.care,
      hope:       typeof partial.hope       === "number" ? partial.hope       : base.hope,
      energy:     typeof partial.energy     === "number" ? partial.energy     : base.energy,
    };
  }
  CATEGORY_TONE = merged;
}

/** Read the live category tone map (for the admin UI to render current values). */
export function getCategoryToneMap(): Record<string, Tone> {
  return { ...CATEGORY_TONE };
}

const NEUTRAL_TONE: Tone = { anger: 1, comedy: 1, subversion: 1, care: 1, hope: 1, energy: 1 };

/** Category default tone for the AskFlowModal so sliders pre-populate correctly
 * when a submitter picks a category. Falls back to NEUTRAL_TONE for unknown
 * categories. Case-insensitive. */
export function categoryToneDefault(category: string): Tone {
  return CATEGORY_TONE[category?.toUpperCase()] ?? NEUTRAL_TONE;
}

export function toneFor(card: ActionCardData): Tone {
  const base = CATEGORY_TONE[card.category?.toUpperCase()] ?? NEUTRAL_TONE;
  // Per-card override wins over the category default for any field that's set.
  // Fields the override doesn't include fall through to the category baseline.
  if (!card.toneOverride) return base;
  const o = card.toneOverride;
  const clip = (n: number | undefined, fallback: number) =>
    typeof n === "number" ? Math.max(0, Math.min(3, n)) : fallback;
  return {
    anger:      clip(o.anger,      base.anger),
    comedy:     clip(o.comedy,     base.comedy),
    subversion: clip(o.subversion, base.subversion),
    care:       clip(o.care,       base.care),
    hope:       clip(o.hope,       base.hope),
    energy:     clip((o as any).energy, base.energy),
  };
}

// ─── timeCommitment string → bucket ───────────────────────────────────────────

// Category-level time defaults used when a card has no explicit timeCommitment.
// Without this, every card without timeCommitment returns "30min" and the time
// slider becomes useless — protests, training, and prayer all look identical.
const CATEGORY_DEFAULT_BUCKET: Partial<Record<string, TimeBucket>> = {
  // Seconds to a few minutes — click, commit, share
  "BOYCOTT":            "5min",
  "MENTAL HEALTH":      "5min",
  "FUNDING":            "5min",
  "BOOST":              "5min",
  // 30 minutes — find, read, sign or write
  "PETITION":           "30min",
  "EMAIL CAMPAIGN":     "30min",
  "LETTER TO EDITOR":   "30min",
  "SOCIAL MEDIA":       "30min",
  "NEWS STORY":         "30min",
  "PERSONAL COMMITMENT":"30min",
  "PRAYER":             "30min",
  "SPREAD POSITIVITY":  "30min",
  "ACT OF KINDNESS":    "30min",
  "IRREVERENCE":        "30min",
  "OTHER":              "30min",
  // 1 hour — attend a call, a session, a meeting
  "MEETING":            "1hr",
  "TRAINING":           "1hr",
  // Several hours — travel + attend, or a work session
  "PROTEST":            "fewHours",
  "FLASH MOB":          "fewHours",
  "TRANSPORTATION":     "fewHours",
  "HOUSING":            "fewHours",
  "PROFESSIONAL SKILLS":"fewHours",
  "ART PIECE":          "fewHours",
  "CRAFTING":           "fewHours",
  // Ongoing commitment
  "LABOR":              "ongoing",
  "JOIN A GROUP":       "ongoing",
};

export function timeBucketFor(card: ActionCardData): TimeBucket {
  const t = (card.timeCommitment ?? "").toLowerCase();
  // quickAction wins when the stored timeCommitment is the legacy "< 1 hour"
  // string that was incorrectly used for both 5-min and 30-min cards. For any
  // other explicit timeCommitment, the string takes priority (so an "Ongoing"
  // or "1–3 hours" card isn't accidentally pulled into the quick bucket).
  if (card.quickAction && (!t || t === "< 1 hour")) return "5min";
  if (t) {
    if (t.includes("ongoing")) return "ongoing";
    if (t.includes("full")) return "fullDay";
    if (t.includes("half")) return "fewHours";
    if (t.includes("1–3") || t.includes("1-3") || t.includes("hour")) {
      if (t.includes("< 1") || t.includes("<1")) return "30min";
      return "fewHours";
    }
    // "5–10 min" / "5-10 min" / "10 min" → 10min (must come before the
    // generic "5" / "30" rules below or they'd misclassify).
    if (t.includes("5–10") || t.includes("5-10") || t.includes("10 min") || t.includes("10min")) return "10min";
    // "< 5 min" / "5 min" / "quick" → 5min (must come before "min" catch-all
    // or "< 5 minutes" would be misread as 30min).
    if (t.includes("5") || t.includes("quick")) return "5min";
    if (t.includes("30") || t.includes("min")) return "30min";
  }
  if (card.quickAction) return "5min";
  // Fall back to category default so the time slider works for seed cards.
  return CATEGORY_DEFAULT_BUCKET[card.category?.toUpperCase()] ?? "30min";
}

// Bucket → minutes-equivalent for ranking. Lower is shorter.
const BUCKET_MINUTES: Record<TimeBucket, number> = {
  "5min": 5,
  "10min": 10,
  "30min": 30,
  "1hr": 60,
  "fewHours": 180,
  "fullDay": 480,
  "ongoing": 720,
};

// ─── Amplification model ─────────────────────────────────────────────────────
// We no longer collect personal identity, so personalized-risk down-ranking
// is gone — the user's slider settings (Confrontational, Subversive, Motivation,
// "Where do you want to act?") already steer risk-averse users toward calmer
// actions without us keeping a list of who is targetable.
//
// What's left is amplification: when the user picks a focus group, we lift
// actions where that group's voice carries unique weight (or where the card
// is explicitly tagged via `amplifiesGroups`).

// Categories where the group's voice gives the action extra weight.
const SURFACES_VOICE_FOR: Partial<Record<VulnerableGroup, Set<string>>> = {
  woman:      new Set(["PETITION", "EMAIL CAMPAIGN", "LETTER TO EDITOR", "MEETING", "SOCIAL MEDIA", "NEWS STORY"]),
  immigrant:  new Set(["PETITION", "EMAIL CAMPAIGN", "LETTER TO EDITOR", "MEETING", "SOCIAL MEDIA", "NEWS STORY", "TRAINING"]),
  lgbtq:      new Set(["PETITION", "EMAIL CAMPAIGN", "LETTER TO EDITOR", "MEETING", "SOCIAL MEDIA", "NEWS STORY", "MENTAL HEALTH"]),
  repro:      new Set(["PETITION", "EMAIL CAMPAIGN", "LETTER TO EDITOR", "MEETING", "SOCIAL MEDIA", "NEWS STORY", "TRANSPORTATION"]),
  disabled:   new Set(["PETITION", "EMAIL CAMPAIGN", "LETTER TO EDITOR", "MEETING", "SOCIAL MEDIA", "PROFESSIONAL SKILLS"]),
  fedWorker:  new Set(["NEWS STORY", "EMAIL CAMPAIGN", "PROFESSIONAL SKILLS", "TRAINING"]),
  journalist: new Set(["NEWS STORY", "BOOST", "PROFESSIONAL SKILLS", "LETTER TO EDITOR"]),
  black:      new Set(["PETITION", "EMAIL CAMPAIGN", "LETTER TO EDITOR", "NEWS STORY", "SOCIAL MEDIA", "MEETING"]),
  latino:     new Set(["PETITION", "EMAIL CAMPAIGN", "LETTER TO EDITOR", "NEWS STORY", "SOCIAL MEDIA", "MEETING"]),
  indigenous: new Set(["PETITION", "EMAIL CAMPAIGN", "LETTER TO EDITOR", "NEWS STORY", "SOCIAL MEDIA", "MEETING"]),
  asian:      new Set(["PETITION", "EMAIL CAMPAIGN", "LETTER TO EDITOR", "NEWS STORY", "SOCIAL MEDIA"]),
  muslim:     new Set(["PETITION", "EMAIL CAMPAIGN", "LETTER TO EDITOR", "NEWS STORY", "SOCIAL MEDIA"]),
  jewish:     new Set(["PETITION", "EMAIL CAMPAIGN", "LETTER TO EDITOR", "NEWS STORY", "SOCIAL MEDIA", "PRAYER"]),
  unionWorker: new Set(["LABOR", "PETITION", "EMAIL CAMPAIGN", "SOCIAL MEDIA"]),
  veteran:    new Set(["PETITION", "EMAIL CAMPAIGN", "NEWS STORY", "MEETING"]),
  student:    new Set(["PETITION", "EMAIL CAMPAIGN", "SOCIAL MEDIA", "MEETING"]),
  educator:   new Set(["PETITION", "EMAIL CAMPAIGN", "LETTER TO EDITOR", "NEWS STORY"]),
  scientist:  new Set(["NEWS STORY", "PETITION", "PROFESSIONAL SKILLS", "LETTER TO EDITOR"]),
  lawyer:     new Set(["PROFESSIONAL SKILLS", "NEWS STORY", "PETITION"]),
  lowIncome:  new Set(["PETITION", "EMAIL CAMPAIGN", "LABOR", "MEETING"]),
  unhoused:   new Set(["PETITION", "EMAIL CAMPAIGN", "HOUSING"]),
  renter:     new Set(["PETITION", "EMAIL CAMPAIGN", "HOUSING"]),
};

export function assessAmplification(card: ActionCardData, groups: VulnerableGroup[]): boolean {
  if (groups.length === 0) return false;
  const cat = card.category?.toUpperCase() ?? "";
  const cardAmps = new Set(card.amplifiesGroups ?? []);
  for (const g of groups) {
    if (SURFACES_VOICE_FOR[g]?.has(cat) || cardAmps.has(g)) return true;
  }
  return false;
}

// ─── Setting / online / at-home filter ────────────────────────────────────────

/** True for cards that can be done from a couch — online, the legacy `atHome`
 * boolean, or the canonical `location === "From Home"` string. */
export function cardIsAtHome(card: ActionCardData): boolean {
  return !!card.isOnline || !!card.atHome || card.location === "From Home" || card.location === "At Home";
}

/** True if the card matches at least one of the requested settings, or if
 * the request is empty (= "any"). */
export function settingMatches(card: ActionCardData, settings: Setting[]): boolean {
  if (!settings || settings.length === 0) return true;
  return settings.some((s) => {
    // "online" covers anything that can be done remotely — online actions plus
    // the rare atHome=true / location="From Home" cards. The "At home" pill
    // collapsed into this in v0.2; remote === from home for our purposes.
    if (s === "online")   return cardIsAtHome(card);
    if (s === "inPerson") return !card.isOnline;
    return false;
  });
}

// ─── Location / state filter ──────────────────────────────────────────────────
// Cards stored with state-scoped locations only show when the user is in that
// state. Online / National / Multi-state / at-home cards always pass.

export function stateMatches(card: ActionCardData, userState: string | null): boolean {
  if (!userState) return true;                         // "Anywhere"
  if (cardIsAtHome(card)) return true;                  // Online / From Home / atHome flag travels
  const cardLoc = (card.location ?? "").trim();
  if (!cardLoc) return true;                           // No location specified
  if (cardLoc === "National" || cardLoc === "Multi-state") return true;
  // Normalize "City, ST" → "Full State Name" using the same helper the navbar uses.
  // (Inlined import to keep matcher.ts dependency-free at the type level.)
  const lower = cardLoc.toLowerCase();
  const userLower = userState.toLowerCase();
  if (lower === userLower) return true;
  // Match "Beaver County, PA" when userState === "Pennsylvania"
  const m = cardLoc.match(/,\s*([^,]+)\s*$/);
  if (m) {
    const tail = m[1].trim();
    if (tail.toLowerCase() === userLower) return true;
    // 2-letter code → full state lookup
    const code = tail.toUpperCase();
    const codeToState: Record<string, string> = {
      AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
      CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
      DC: "Washington DC", FL: "Florida", GA: "Georgia", HI: "Hawaii",
      ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
      KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
      MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
      MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
      NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
      NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
      OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
      SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
      VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
      WI: "Wisconsin", WY: "Wyoming",
    };
    if (codeToState[code]?.toLowerCase() === userLower) return true;
  }
  return false;
}

/** Stricter than `stateMatches`: returns true only when the card is
 * specifically tied to the user's state. National / Multi-state / online
 * cards do NOT count as "local" here — they travel to anyone. Used to
 * prioritize and inject genuinely state-local cards into samples. */
export function cardIsLocalToState(card: ActionCardData, userState: string | null): boolean {
  if (!userState) return false;
  if (card.isOnline) return false;
  const cardLoc = (card.location ?? "").trim();
  if (!cardLoc) return false;
  if (cardLoc === "National" || cardLoc === "Multi-state") return false;
  const userLower = userState.toLowerCase();
  if (cardLoc.toLowerCase() === userLower) return true;
  const m = cardLoc.match(/,\s*([^,]+)\s*$/);
  if (!m) return false;
  const tail = m[1].trim();
  if (tail.toLowerCase() === userLower) return true;
  const code = tail.toUpperCase();
  const codeToState: Record<string, string> = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
    CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
    DC: "Washington DC", FL: "Florida", GA: "Georgia", HI: "Hawaii",
    ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
    KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
    MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
    MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
    NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
    NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
    OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
    SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
    VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
    WI: "Wisconsin", WY: "Wyoming",
  };
  return codeToState[code]?.toLowerCase() === userLower;
}

// ─── User history context ─────────────────────────────────────────────────────
// Passed into the scorer when the user is logged in (or has local history).
// Both fields are optional — omitting them disables the filter/bonus entirely.

export interface UserContext {
  /** Card IDs the user has already completed ("I did this"). Filtered out. */
  completedIds?: Set<number> | number[];
  /** Card IDs the user has boosted. Gets a ranking bonus — they like these. */
  boostedIds?: Set<number> | number[];
}

function inSet(haystack: Set<number> | number[] | undefined, id: number): boolean {
  if (!haystack) return false;
  if (Array.isArray(haystack)) return haystack.includes(id);
  return haystack.has(id);
}

// ─── Scoring ──────────────────────────────────────────────────────────────────
// Higher score = better fit. Returns 0 for cards that fail a hard filter.

export function score(card: ActionCardData, prefs: Preferences, ctx?: UserContext): number {
  // Hard filter: already completed — don't re-suggest things the user did
  if (card.id != null && inSet(ctx?.completedIds, card.id)) return 0;

  // Hard filter: setting mismatch
  if (!settingMatches(card, prefs.setting)) return 0;
  // Hard filter: state mismatch — keeps Illinois events out of California's
  // feed. When `includeAnywhere` is true, the state field is used for ranking
  // only and the filter is bypassed (every state passes).
  if (!prefs.includeAnywhere && !stateMatches(card, prefs.state)) return 0;
  // Hard filter: user-opted-out category. The "Skip these" chips in the
  // Quick Match Tool write the chosen categories here; the dismissal-learning
  // prompt ("you've passed on 3 Crafting cards") adds the category here if
  // the user accepts the offer to hide it going forward.
  if (prefs.excludedCategories && prefs.excludedCategories.length > 0 &&
      prefs.excludedCategories.includes(card.category)) return 0;

  // Hard filter: extreme OVERSHOOT only. When the user explicitly picks
  // "None" (slider=0) for a tone, showing them a card with "Full mockery"
  // (or any 3-rating) on that dimension is actively offensive — they
  // asked us not to. So we hard-filter that case.
  //
  // We do NOT mirror this for the undershoot direction (user picks max,
  // card has none) — that asymmetry is intentional. "I want all of this"
  // is a soft preference, not a veto; if the user's other sliders narrow
  // the pool down to mostly-low-on-this-dim cards, we still want to
  // surface something. The soft undershoot penalty below already drags
  // those cards down the ranking when better options exist.
  const t = toneFor(card);
  if (prefs.tone.anger      === 0 && t.anger      === 3) return 0;
  if (prefs.tone.comedy     === 0 && t.comedy     === 3) return 0;
  if (prefs.tone.subversion === 0 && t.subversion === 3) return 0;
  if (prefs.tone.hope       === 0 && t.hope       === 3) return 0;
  if (prefs.tone.energy     === 0 && t.energy     === 3) return 0;

  // Amplification check — lifts cards where the user's focus group(s) have
  // unique standing. We no longer down-rank for personal risk; sliders do that.
  const amplifies = assessAmplification(card, prefs.vulnerableGroups);

  // Tone match: dot product between user sliders (0-3) and card tone (0-3).
  // `care` has no dedicated slider — it's driven by the hope slider at half
  // weight so that ACT OF KINDNESS, PRAYER, and TRANSPORTATION surface when
  // the user signals they want something constructive/warm.
  // (`t` is computed above for the extreme-mismatch hard filter.)
  const toneScore =
    (prefs.tone.anger      * t.anger) +
    (prefs.tone.comedy     * t.comedy) +
    (prefs.tone.subversion * t.subversion) +
    (prefs.tone.hope       * t.hope) +
    (prefs.tone.hope       * t.care * 0.5) +
    (prefs.tone.energy     * t.energy);

  // Tone-mismatch penalty — penalises cards that are HOTTER than the user
  // asked for on any given tone dimension. Without this, the pure-dot-product
  // score above only rewards matches, never penalises mismatches. So a card
  // that's high on Anger AND high on Comedy still surfaces when the user
  // wants Anger but Humor: None — comedy just contributes 0 to the bonus
  // rather than dragging the card down. The penalty weight (3) is calibrated
  // to be strong enough to push a clearly-wrong card below the 30 % score
  // floor used by `rankCards` while still letting partial overshoots survive
  // when other dimensions match strongly.
  const tonePenaltyOver = 3 * (
    Math.max(0, t.anger      - prefs.tone.anger)      +
    Math.max(0, t.comedy     - prefs.tone.comedy)     +
    Math.max(0, t.subversion - prefs.tone.subversion) +
    Math.max(0, t.hope       - prefs.tone.hope)       +
    Math.max(0, t.energy     - prefs.tone.energy)
  );
  // Symmetric UNDERSHOOT penalty — penalises cards that are COLDER than the
  // user asked for. Without this, the user can crank "Humor: Full mockery"
  // and still get serious petitions because the petition's hope/anger score
  // adds up to a passable toneScore even with comedy=0. We forgive a gap of
  // 1 (so a "Mild" card still surfaces when the user asks for "Bold") and
  // only penalise from gap=2 onward. Same weight as overshoot (3) so the
  // matcher feels symmetric — moving any slider in either direction has the
  // same magnitude of effect on which cards bubble up.
  const tonePenaltyUnder = 3 * (
    Math.max(0, prefs.tone.anger      - 1 - t.anger)      +
    Math.max(0, prefs.tone.comedy     - 1 - t.comedy)     +
    Math.max(0, prefs.tone.subversion - 1 - t.subversion) +
    Math.max(0, prefs.tone.hope       - 1 - t.hope)       +
    Math.max(0, prefs.tone.energy     - 1 - t.energy)
  );
  const tonePenalty = tonePenaltyOver + tonePenaltyUnder;

  // Time match: distance between card's bucket minutes and user's pick.
  // Smaller distance = bigger bonus. Capped.
  let timeScore = 0;
  if (prefs.time) {
    const wantMin = BUCKET_MINUTES[prefs.time];
    const haveMin = BUCKET_MINUTES[timeBucketFor(card)];
    const ratio = Math.min(wantMin, haveMin) / Math.max(wantMin, haveMin);
    timeScore = ratio * 10; // 0-10
  }

  // Amplification bonus — lifts cards where the user's focus group has weight.
  const amplifyBonus = amplifies ? 8 : 0;

  // Engagement floor — boost cards that have community traction so a tie
  // breaks toward proven actions.
  const engagement = (card.boosts ?? 0) + (card.completions ?? 0);
  const engagementScore = Math.min(engagement, 20) / 4; // 0-5

  // Local-state priority bonus — when the user picked a state and chose to
  // see actions from anywhere, lift cards that match their state above the
  // rest so local stuff still ranks first.
  // Only TRULY state-local cards get the bonus — National/Multi-state/online
  // cards already travel everywhere, so giving them this bonus would dilute
  // the lift meant for local stuff.
  const stateBonus = (prefs.state && cardIsLocalToState(card, prefs.state)) ? 6 : 0;

  // User-boost bonus — the user already signaled interest in this card.
  // Surface it higher so they can finally do it.
  const boostBonus = (card.id != null && inSet(ctx?.boostedIds, card.id)) ? 5 : 0;

  // Highlighted bonus — admin-curated cards get a lift so they reliably
  // appear in Quick Matches regardless of tone slider position.
  const highlightBonus = (card as any).firstTimerFriendly ? 7 : 0;

  // Upcoming-event bonus — pushes time-sensitive cards up in Match Me
  // results. Past events return 0 (they're filtered out of the visible feed
  // before they reach the matcher anyway). Magnitudes are tuned to the
  // 0-10 scale used by the other component scores above — tomorrow's event
  // gets roughly the same lift as a strong state match.
  const eventDate = (card as any).eventDate as string | undefined;
  let eventProximityBonus = 0;
  if (eventDate) {
    const todayISO = new Date().toISOString().slice(0, 10);
    if (eventDate >= todayISO) {
      const today = Date.parse(todayISO);
      const event = Date.parse(eventDate);
      if (!Number.isNaN(today) && !Number.isNaN(event)) {
        const daysUntil = Math.max(0, Math.round((event - today) / 86_400_000));
        if      (daysUntil === 0)  eventProximityBonus = 10; // today
        else if (daysUntil === 1)  eventProximityBonus = 8;  // tomorrow
        else if (daysUntil <= 3)   eventProximityBonus = 6;
        else if (daysUntil <= 7)   eventProximityBonus = 4;
        else if (daysUntil <= 14)  eventProximityBonus = 2;
        else if (daysUntil <= 30)  eventProximityBonus = 1;
        else                       eventProximityBonus = 0.5;
      }
    }
  }

  return toneScore - tonePenalty + timeScore + amplifyBonus + engagementScore + stateBonus + boostBonus + highlightBonus + eventProximityBonus;
}

// ─── Top N ────────────────────────────────────────────────────────────────────

export function rankCards(cards: ActionCardData[], prefs: Preferences, ctx?: UserContext): ActionCardData[] {
  return cards
    .map((c) => ({ c, s: score(c, prefs, ctx) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}

export function topN(cards: ActionCardData[], prefs: Preferences, n = 5, ctx?: UserContext): ActionCardData[] {
  return rankCards(cards, prefs, ctx).slice(0, n);
}

// ─── Explain why a card matched ───────────────────────────────────────────────
// Returns short human-readable reasons. Used in the wizard result list to make
// the score legible. Empty array if nothing notable matched.

const TIME_LABEL: Record<TimeBucket, string> = {
  "5min":     "fits 5 min",
  "30min":    "fits 30 min",
  "1hr":      "fits an hour",
  "fewHours": "fits a few hours",
  "fullDay":  "fits a whole day",
  "ongoing":  "ongoing",
};

export function explainMatch(card: ActionCardData, prefs: Preferences, ctx?: UserContext): string[] {
  const reasons: string[] = [];

  // Tone reasons — only mention dimensions where BOTH user wants ≥2 AND card scores ≥2.
  const t = toneFor(card);
  if (prefs.tone.anger >= 2 && t.anger >= 2) reasons.push("matches your anger");
  if (prefs.tone.comedy >= 2 && t.comedy >= 2) reasons.push("matches your humor");
  if (prefs.tone.subversion >= 2 && t.subversion >= 2) reasons.push("matches your subversion");
  if (prefs.tone.hope >= 2 && t.hope >= 2) reasons.push("matches your hope");
  if (prefs.tone.energy >= 2 && t.energy >= 2) reasons.push("matches your energy");
  if (prefs.tone.energy <= 1 && t.energy <= 1) reasons.push("low-effort fit");

  // Time match — exact bucket only.
  if (prefs.time && timeBucketFor(card) === prefs.time) {
    reasons.push(TIME_LABEL[prefs.time]);
  }

  // Setting match — only call out if the user picked a specific subset.
  if (prefs.setting.length > 0 && prefs.setting.length < 2) {
    if (prefs.setting.includes("online")   && cardIsAtHome(card)) reasons.push("remote");
    else if (prefs.setting.includes("inPerson") && !card.isOnline) reasons.push("in-person");
  }

  // State match — call out a local card when the user picked a state.
  if (prefs.state) {
    const cardLoc = (card.location ?? "").trim();
    if (cardLoc && cardLoc !== "National" && cardLoc !== "Multi-state" && !card.isOnline) {
      reasons.push(`local to ${prefs.state}`);
    }
  }

  // Group amplification — only when the user picked a focus group.
  if (prefs.vulnerableGroups.length > 0) {
    if (assessAmplification(card, prefs.vulnerableGroups)) {
      reasons.push("centers this group's fight");
    }
  }

  // Community traction — only flag highly-engaged cards.
  const engagement = (card.boosts ?? 0) + (card.completions ?? 0);
  if (engagement >= 10) reasons.push("high community traction");

  // Personal history signals
  if (card.id != null && inSet(ctx?.boostedIds, card.id)) reasons.push("you boosted this");

  return reasons;
}

// ─── localStorage persistence ─────────────────────────────────────────────────

const STORAGE_KEY = "resistact_match_prefs";

export function loadPreferences(): Preferences | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || !parsed) return null;
    return normalizePreferences(parsed);
  } catch {
    return null;
  }
}

export function savePreferences(prefs: Preferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
}

export function clearPreferences() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

// ─── Server-side sync (for signed-in users) ──────────────────────────────────
// Match prefs live in localStorage by default. When a user signs in we mirror
// them to a `user:preferences:{userId}` row on the server so they follow the
// account across devices. Failures are logged but never thrown — sync is a
// best-effort enhancement, not a blocker.

import { projectId } from "/utils/supabase/info";
const PREFS_API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04/me/preferences`;

/** Fetch the signed-in user's stored match prefs. Returns null on miss or
 * any error so callers can fall back to localStorage cleanly. */
export async function fetchUserPreferences(token: string): Promise<Preferences | null> {
  try {
    const res = await fetch(PREFS_API, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.preferences || typeof data.preferences !== "object") return null;
    // Reuse the same loose normalization that loadPreferences applies to the
    // localStorage payload — the server stores whatever shape the client sent,
    // so old records may be missing newer fields.
    return normalizePreferences(data.preferences);
  } catch (err) {
    console.warn("fetchUserPreferences failed:", err);
    return null;
  }
}

/** Push prefs to the server. Best-effort; the local copy stays the source of
 * truth until the next login on a fresh device. */
export async function pushUserPreferences(token: string, prefs: Preferences): Promise<void> {
  try {
    await fetch(PREFS_API, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(prefs),
    });
  } catch (err) {
    console.warn("pushUserPreferences failed:", err);
  }
}

/** Shared validation/migration so both `loadPreferences` (localStorage) and
 * `fetchUserPreferences` (server) hand back a fully-shaped Preferences. */
function normalizePreferences(parsed: any): Preferences {
  // Migration: "atHome" collapsed into "online" (now "Remote") in v0.2.
  // Old stored prefs with atHome get rewritten to online; dedup the array.
  const migrate = (s: unknown): Setting | null => {
    if (s === "online" || s === "atHome") return "online";
    if (s === "inPerson") return "inPerson";
    return null;
  };
  let setting: Setting[] = [];
  if (Array.isArray(parsed.setting)) {
    const mapped = parsed.setting
      .map(migrate)
      .filter((s: Setting | null): s is Setting => s !== null);
    setting = Array.from(new Set(mapped));
  } else if (typeof parsed.setting === "string" && parsed.setting !== "either") {
    const one = migrate(parsed.setting);
    if (one) setting = [one];
  }
  return {
    time: parsed.time ?? null,
    setting,
    state: typeof parsed.state === "string" ? parsed.state : null,
    includeAnywhere: parsed.includeAnywhere === true,
    vulnerableGroups: Array.isArray(parsed.vulnerableGroups) ? parsed.vulnerableGroups : [],
    focusDonations: false, // never default-on; user must explicitly opt in each session
    tone: {
      anger: typeof parsed.tone?.anger === "number" ? parsed.tone.anger : 1,
      comedy: typeof parsed.tone?.comedy === "number" ? parsed.tone.comedy : 1,
      subversion: typeof parsed.tone?.subversion === "number" ? parsed.tone.subversion : 1,
      hope: typeof parsed.tone?.hope === "number" ? parsed.tone.hope : 1,
      energy: typeof parsed.tone?.energy === "number" ? parsed.tone.energy : 1,
    },
    // Legacy prefs (saved before excludedCategories was a field) come back
    // without this key — default to empty so the hard filter in score()
    // becomes a no-op for legacy users.
    excludedCategories: Array.isArray(parsed.excludedCategories)
      ? parsed.excludedCategories.filter((c: unknown): c is string => typeof c === "string")
      : [],
  };
}
