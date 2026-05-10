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

export type TimeBucket = "5min" | "30min" | "1hr" | "fewHours" | "fullDay" | "ongoing";

/**
 * What kind of action context the user is willing to engage in. Stored as
 * an array on Preferences so the user can pick more than one (e.g. "online"
 * + "at home" but not in-person). An empty array means "any" — no filter.
 *  - "online":    needs an internet connection; mostly screen time
 *  - "atHome":    can be done in the user's home (online OR offline tasks like
 *                 knitting, letter-writing, phone-calling reps)
 *  - "inPerson":  requires showing up somewhere
 */
export type Setting = "online" | "atHome" | "inPerson";

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
  tone: Pick<Tone, "anger" | "comedy" | "subversion" | "hope" | "energy">;
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
  tone: { anger: 1, comedy: 1, subversion: 1, hope: 1, energy: 1 },
};

// ─── Category → tone defaults ─────────────────────────────────────────────────
// 0 = none, 3 = strong. These are coarse — IRREVERENCE is high comedy/subversion,
// PROTEST is high anger, ACT OF KINDNESS is high care, etc.

/** Built-in category tone defaults. Used as the fallback when no runtime
 * override has been loaded from the admin "Matcher Tuning" panel. */
export const DEFAULT_CATEGORY_TONE: Record<string, Tone> = {
  "IRREVERENCE":          { anger: 1, comedy: 3, subversion: 3, care: 0, hope: 1, energy: 3 },
  "PROTEST":              { anger: 3, comedy: 0, subversion: 1, care: 1, hope: 2, energy: 3 },
  "FLASH MOB":            { anger: 2, comedy: 2, subversion: 3, care: 0, hope: 1, energy: 3 },
  "BOYCOTT":              { anger: 2, comedy: 0, subversion: 2, care: 0, hope: 2, energy: 1 },
  "ART PIECE":            { anger: 1, comedy: 2, subversion: 2, care: 1, hope: 2, energy: 2 },
  "PETITION":             { anger: 2, comedy: 0, subversion: 0, care: 1, hope: 3, energy: 1 },
  "EMAIL CAMPAIGN":       { anger: 2, comedy: 0, subversion: 0, care: 1, hope: 3, energy: 1 },
  "LETTER TO EDITOR":     { anger: 2, comedy: 0, subversion: 0, care: 1, hope: 3, energy: 1 },
  "SOCIAL MEDIA":         { anger: 2, comedy: 2, subversion: 1, care: 1, hope: 1, energy: 2 },
  "BOOST":                { anger: 1, comedy: 0, subversion: 0, care: 2, hope: 2, energy: 1 },
  "ACT OF KINDNESS":      { anger: 0, comedy: 0, subversion: 0, care: 3, hope: 2, energy: 1 },
  "SPREAD POSITIVITY":    { anger: 0, comedy: 1, subversion: 0, care: 3, hope: 3, energy: 2 },
  "PRAYER":               { anger: 0, comedy: 0, subversion: 0, care: 3, hope: 3, energy: 0 },
  "MENTAL HEALTH":        { anger: 0, comedy: 0, subversion: 0, care: 3, hope: 2, energy: 0 },
  "MEETING":              { anger: 1, comedy: 0, subversion: 0, care: 2, hope: 3, energy: 2 },
  "TRAINING":             { anger: 1, comedy: 0, subversion: 1, care: 2, hope: 2, energy: 2 },
  "JOIN A GROUP":         { anger: 1, comedy: 0, subversion: 1, care: 2, hope: 2, energy: 2 },
  "PERSONAL COMMITMENT":  { anger: 1, comedy: 0, subversion: 0, care: 2, hope: 3, energy: 1 },
  "PROFESSIONAL SKILLS":  { anger: 1, comedy: 0, subversion: 0, care: 2, hope: 2, energy: 2 },
  "TRANSPORTATION":       { anger: 0, comedy: 0, subversion: 0, care: 3, hope: 2, energy: 2 },
  "HOUSING":              { anger: 0, comedy: 0, subversion: 0, care: 3, hope: 2, energy: 2 },
  "LABOR":                { anger: 2, comedy: 0, subversion: 1, care: 2, hope: 2, energy: 2 },
  "CRAFTING":             { anger: 0, comedy: 1, subversion: 0, care: 2, hope: 2, energy: 1 },
  "NEWS STORY":           { anger: 1, comedy: 0, subversion: 0, care: 1, hope: 2, energy: 1 },
  "FUNDING":              { anger: 1, comedy: 0, subversion: 0, care: 2, hope: 2, energy: 1 },
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

export function timeBucketFor(card: ActionCardData): TimeBucket {
  const t = (card.timeCommitment ?? "").toLowerCase();
  if (card.quickAction) return "5min";
  if (t.includes("ongoing")) return "ongoing";
  if (t.includes("full")) return "fullDay";
  if (t.includes("half")) return "fewHours";
  if (t.includes("1–3") || t.includes("1-3") || t.includes("hour")) {
    if (t.includes("< 1") || t.includes("<1")) return "30min";
    return "fewHours";
  }
  return "30min"; // default — most online petitions/calls
}

// Bucket → minutes-equivalent for ranking. Lower is shorter.
const BUCKET_MINUTES: Record<TimeBucket, number> = {
  "5min": 5,
  "30min": 30,
  "1hr": 60,
  "fewHours": 180,
  "fullDay": 480,
  "ongoing": 720,
};

// ─── Risk model: which actions are risky for which groups, and which actions
// surface a group's voice with extra weight. Both keyed by category as a
// reasonable default; specific cards can override later.

// Risk and amplification mappings only need entries for groups where we have
// a clear signal. Groups not listed default to no risk and no amplification —
// they're tracked but don't influence scoring until tuned.
const HIGH_RISK_FOR_GROUP: Partial<Record<VulnerableGroup, Set<string>>> = {
  // Women face elevated risk at clinic-defense + trans/repro adjacent in-person
  // actions, but not on the standard protest spectrum — light touch only.
  woman:      new Set([]),
  // Front-line in-person actions where ICE / arrest exposure matters.
  immigrant:  new Set(["PROTEST", "FLASH MOB"]),
  // Public confrontation in red areas; acceptable in blue ones — soft warning.
  lgbtq:      new Set(["FLASH MOB"]),
  repro:      new Set([]),
  disabled:   new Set(["FLASH MOB", "PROTEST"]),
  // Federal workers risk Hatch Act issues with overt partisan in-person acts.
  fedWorker:  new Set(["PROTEST", "FLASH MOB", "LETTER TO EDITOR"]),
  journalist: new Set([]),
};

// Categories where the group's identity gives the action extra weight.
const SURFACES_VOICE_FOR: Partial<Record<VulnerableGroup, Set<string>>> = {
  woman:      new Set(["PETITION", "EMAIL CAMPAIGN", "LETTER TO EDITOR", "MEETING", "SOCIAL MEDIA", "NEWS STORY"]),
  immigrant:  new Set(["PETITION", "EMAIL CAMPAIGN", "LETTER TO EDITOR", "MEETING", "SOCIAL MEDIA", "NEWS STORY"]),
  lgbtq:      new Set(["PETITION", "EMAIL CAMPAIGN", "LETTER TO EDITOR", "MEETING", "SOCIAL MEDIA", "NEWS STORY"]),
  repro:      new Set(["PETITION", "EMAIL CAMPAIGN", "LETTER TO EDITOR", "MEETING", "SOCIAL MEDIA", "NEWS STORY"]),
  disabled:   new Set(["PETITION", "EMAIL CAMPAIGN", "LETTER TO EDITOR", "MEETING", "SOCIAL MEDIA"]),
  fedWorker:  new Set(["NEWS STORY", "EMAIL CAMPAIGN", "PROFESSIONAL SKILLS"]),
  journalist: new Set(["NEWS STORY", "BOOST", "PROFESSIONAL SKILLS"]),
};

export interface RiskAssessment {
  /** True if this card carries elevated risk for at least one selected group. */
  risky: boolean;
  /** True if this card surfaces the user's voice with extra weight. */
  amplifies: boolean;
  /** Human-readable warning, or null. */
  warning: string | null;
}

export function assessRisk(card: ActionCardData, groups: VulnerableGroup[]): RiskAssessment {
  if (groups.length === 0) return { risky: false, amplifies: false, warning: null };
  const cat = card.category?.toUpperCase() ?? "";
  const cardAmps = new Set(card.amplifiesGroups ?? []);
  let risky = false;
  let amplifies = false;
  for (const g of groups) {
    if (HIGH_RISK_FOR_GROUP[g]?.has(cat)) risky = true;
    if (SURFACES_VOICE_FOR[g]?.has(cat) || cardAmps.has(g)) amplifies = true;
  }
  return {
    risky,
    amplifies,
    warning: risky ? "In-person exposure — consider risk before joining" : null,
  };
}

// ─── Setting / online / at-home filter ────────────────────────────────────────

/** True for cards that can be done from a couch — online, the legacy `atHome`
 * boolean, or the canonical `location === "From Home"` string. */
function cardIsAtHome(card: ActionCardData): boolean {
  return !!card.isOnline || !!card.atHome || card.location === "From Home";
}

/** True if the card matches at least one of the requested settings, or if
 * the request is empty (= "any"). */
export function settingMatches(card: ActionCardData, settings: Setting[]): boolean {
  if (!settings || settings.length === 0) return true;
  const isOnline = !!card.isOnline;
  return settings.some((s) => {
    if (s === "online")   return isOnline;
    if (s === "atHome")   return cardIsAtHome(card);
    if (s === "inPerson") return !isOnline;
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

// ─── Scoring ──────────────────────────────────────────────────────────────────
// Higher score = better fit. Returns 0 for cards that fail a hard filter.

export function score(card: ActionCardData, prefs: Preferences): number {
  // Hard filter: setting mismatch
  if (!settingMatches(card, prefs.setting)) return 0;
  // Hard filter: state mismatch — keeps Illinois events out of California's
  // feed. When `includeAnywhere` is true, the state field is used for ranking
  // only and the filter is bypassed (every state passes).
  if (!prefs.includeAnywhere && !stateMatches(card, prefs.state)) return 0;

  // Risk assessment for selected groups (penalty/bonus, not a hard filter)
  const risk = assessRisk(card, prefs.vulnerableGroups);

  // Tone match: cosine-like dot product between user's wishes and card's tone.
  // Each user dimension is 0-3. Card dimension is 0-3.
  const t = toneFor(card);
  const toneScore =
    (prefs.tone.anger * t.anger) +
    (prefs.tone.comedy * t.comedy) +
    (prefs.tone.subversion * t.subversion) +
    (prefs.tone.hope * t.hope) +
    (prefs.tone.energy * t.energy);

  // Time match: distance between card's bucket minutes and user's pick.
  // Smaller distance = bigger bonus. Capped.
  let timeScore = 0;
  if (prefs.time) {
    const wantMin = BUCKET_MINUTES[prefs.time];
    const haveMin = BUCKET_MINUTES[timeBucketFor(card)];
    const ratio = Math.min(wantMin, haveMin) / Math.max(wantMin, haveMin);
    timeScore = ratio * 10; // 0-10
  }

  // Risk penalty / amplification bonus
  const riskAdj = (risk.amplifies ? 8 : 0) - (risk.risky ? 12 : 0);

  // Engagement floor — boost cards that have community traction so a tie
  // breaks toward proven actions.
  const engagement = (card.boosts ?? 0) + (card.completions ?? 0);
  const engagementScore = Math.min(engagement, 20) / 4; // 0-5

  // Local-state priority bonus — when the user picked a state and chose to
  // see actions from anywhere, lift cards that match their state above the
  // rest so local stuff still ranks first.
  const stateBonus = (prefs.includeAnywhere && prefs.state && stateMatches(card, prefs.state)) ? 6 : 0;

  return toneScore + timeScore + riskAdj + engagementScore + stateBonus;
}

// ─── Top N ────────────────────────────────────────────────────────────────────

export function rankCards(cards: ActionCardData[], prefs: Preferences): ActionCardData[] {
  return cards
    .map((c) => ({ c, s: score(c, prefs) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}

export function topN(cards: ActionCardData[], prefs: Preferences, n = 5): ActionCardData[] {
  return rankCards(cards, prefs).slice(0, n);
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

export function explainMatch(card: ActionCardData, prefs: Preferences): string[] {
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
  if (prefs.setting.length > 0 && prefs.setting.length < 3) {
    if (prefs.setting.includes("online")   && card.isOnline) reasons.push("online");
    else if (prefs.setting.includes("atHome")   && (card.atHome || card.isOnline)) reasons.push("at home");
    else if (prefs.setting.includes("inPerson") && !card.isOnline) reasons.push("in-person");
  }

  // State match — call out a local card when the user picked a state.
  if (prefs.state) {
    const cardLoc = (card.location ?? "").trim();
    if (cardLoc && cardLoc !== "National" && cardLoc !== "Multi-state" && !card.isOnline) {
      reasons.push(`local to ${prefs.state}`);
    }
  }

  // Voice amplification + risk
  if (prefs.vulnerableGroups.length > 0) {
    const risk = assessRisk(card, prefs.vulnerableGroups);
    if (risk.amplifies) reasons.push("your voice carries weight");
    if (risk.risky) reasons.push("⚠ may carry risk for you");
  }

  // Community traction — only flag highly-engaged cards.
  const engagement = (card.boosts ?? 0) + (card.completions ?? 0);
  if (engagement >= 10) reasons.push("high community traction");

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
    // setting was previously a single string ("online"|"atHome"|"inPerson"|
    // "either"|null). Migrate to array form: a single value becomes a one-elem
    // array; "either"/null/missing/array-of-strings → empty array means "any".
    let setting: Setting[] = [];
    if (Array.isArray(parsed.setting)) {
      setting = parsed.setting.filter((s: unknown): s is Setting =>
        s === "online" || s === "atHome" || s === "inPerson"
      );
    } else if (typeof parsed.setting === "string" && parsed.setting !== "either") {
      if (parsed.setting === "online" || parsed.setting === "atHome" || parsed.setting === "inPerson") {
        setting = [parsed.setting];
      }
    }
    return {
      time: parsed.time ?? null,
      setting,
      state: typeof parsed.state === "string" ? parsed.state : null,
      includeAnywhere: parsed.includeAnywhere === true,
      vulnerableGroups: Array.isArray(parsed.vulnerableGroups) ? parsed.vulnerableGroups : [],
      tone: {
        anger: typeof parsed.tone?.anger === "number" ? parsed.tone.anger : 1,
        comedy: typeof parsed.tone?.comedy === "number" ? parsed.tone.comedy : 1,
        subversion: typeof parsed.tone?.subversion === "number" ? parsed.tone.subversion : 1,
        hope: typeof parsed.tone?.hope === "number" ? parsed.tone.hope : 1,
        energy: typeof parsed.tone?.energy === "number" ? parsed.tone.energy : 1,
      },
    };
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
