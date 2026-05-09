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

export type Setting = "online" | "inPerson" | "either";

export type VulnerableGroup =
  | "woman"
  | "immigrant"
  | "lgbtq"
  | "repro"
  | "disabled"
  | "fedWorker"
  | "journalist";

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
}

export interface Preferences {
  time: TimeBucket | null;
  setting: Setting | null;
  vulnerableGroups: VulnerableGroup[];
  tone: Pick<Tone, "anger" | "comedy" | "subversion">;
}

export const DEFAULT_PREFERENCES: Preferences = {
  time: null,
  setting: null,
  vulnerableGroups: [],
  tone: { anger: 1, comedy: 1, subversion: 1 },
};

// ─── Category → tone defaults ─────────────────────────────────────────────────
// 0 = none, 3 = strong. These are coarse — IRREVERENCE is high comedy/subversion,
// PROTEST is high anger, ACT OF KINDNESS is high care, etc.

const CATEGORY_TONE: Record<string, Tone> = {
  "IRREVERENCE":          { anger: 1, comedy: 3, subversion: 3, care: 0, hope: 1 },
  "PROTEST":              { anger: 3, comedy: 0, subversion: 1, care: 1, hope: 2 },
  "FLASH MOB":            { anger: 2, comedy: 2, subversion: 3, care: 0, hope: 1 },
  "BOYCOTT":              { anger: 2, comedy: 0, subversion: 2, care: 0, hope: 2 },
  "ART PIECE":            { anger: 1, comedy: 2, subversion: 2, care: 1, hope: 2 },
  "PETITION":             { anger: 2, comedy: 0, subversion: 0, care: 1, hope: 3 },
  "EMAIL CAMPAIGN":       { anger: 2, comedy: 0, subversion: 0, care: 1, hope: 3 },
  "LETTER TO EDITOR":     { anger: 2, comedy: 0, subversion: 0, care: 1, hope: 3 },
  "SOCIAL MEDIA":         { anger: 2, comedy: 2, subversion: 1, care: 1, hope: 1 },
  "BOOST":                { anger: 1, comedy: 0, subversion: 0, care: 2, hope: 2 },
  "ACT OF KINDNESS":      { anger: 0, comedy: 0, subversion: 0, care: 3, hope: 2 },
  "SPREAD POSITIVITY":    { anger: 0, comedy: 1, subversion: 0, care: 3, hope: 3 },
  "PRAYER":               { anger: 0, comedy: 0, subversion: 0, care: 3, hope: 3 },
  "MENTAL HEALTH":        { anger: 0, comedy: 0, subversion: 0, care: 3, hope: 2 },
  "MEETING":              { anger: 1, comedy: 0, subversion: 0, care: 2, hope: 3 },
  "TRAINING":             { anger: 1, comedy: 0, subversion: 1, care: 2, hope: 2 },
  "JOIN A GROUP":         { anger: 1, comedy: 0, subversion: 1, care: 2, hope: 2 },
  "PERSONAL COMMITMENT":  { anger: 1, comedy: 0, subversion: 0, care: 2, hope: 3 },
  "PROFESSIONAL SKILLS":  { anger: 1, comedy: 0, subversion: 0, care: 2, hope: 2 },
  "TRANSPORTATION":       { anger: 0, comedy: 0, subversion: 0, care: 3, hope: 2 },
  "HOUSING":              { anger: 0, comedy: 0, subversion: 0, care: 3, hope: 2 },
  "LABOR":                { anger: 2, comedy: 0, subversion: 1, care: 2, hope: 2 },
  "CRAFTING":             { anger: 0, comedy: 1, subversion: 0, care: 2, hope: 2 },
  "NEWS STORY":           { anger: 1, comedy: 0, subversion: 0, care: 1, hope: 2 },
  "FUNDING":              { anger: 1, comedy: 0, subversion: 0, care: 2, hope: 2 },
  "OTHER":                { anger: 1, comedy: 1, subversion: 1, care: 1, hope: 1 },
};

const NEUTRAL_TONE: Tone = { anger: 1, comedy: 1, subversion: 1, care: 1, hope: 1 };

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

const HIGH_RISK_FOR_GROUP: Record<VulnerableGroup, Set<string>> = {
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
const SURFACES_VOICE_FOR: Record<VulnerableGroup, Set<string>> = {
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
  let risky = false;
  let amplifies = false;
  for (const g of groups) {
    if (HIGH_RISK_FOR_GROUP[g]?.has(cat)) risky = true;
    if (SURFACES_VOICE_FOR[g]?.has(cat)) amplifies = true;
  }
  return {
    risky,
    amplifies,
    warning: risky ? "In-person exposure — consider risk before joining" : null,
  };
}

// ─── Setting / online filter ──────────────────────────────────────────────────

export function settingMatches(card: ActionCardData, setting: Setting | null): boolean {
  if (!setting || setting === "either") return true;
  const isOnline = !!card.isOnline;
  if (setting === "online") return isOnline;
  if (setting === "inPerson") return !isOnline;
  return true;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────
// Higher score = better fit. Returns 0 for cards that fail a hard filter.

export function score(card: ActionCardData, prefs: Preferences): number {
  // Hard filter: setting mismatch
  if (!settingMatches(card, prefs.setting)) return 0;

  // Hard filter: high-risk for selected groups (still rankable but penalized)
  const risk = assessRisk(card, prefs.vulnerableGroups);

  // Tone match: cosine-like dot product between user's wishes and card's tone.
  // Each user dimension is 0-3. Card dimension is 0-3.
  const t = toneFor(card);
  const toneScore =
    (prefs.tone.anger * t.anger) +
    (prefs.tone.comedy * t.comedy) +
    (prefs.tone.subversion * t.subversion);

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

  return toneScore + timeScore + riskAdj + engagementScore;
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

  // Time match — exact bucket only.
  if (prefs.time && timeBucketFor(card) === prefs.time) {
    reasons.push(TIME_LABEL[prefs.time]);
  }

  // Setting match — only call out if the user picked a non-"either" preference.
  if (prefs.setting === "online" && card.isOnline) reasons.push("online");
  if (prefs.setting === "inPerson" && !card.isOnline) reasons.push("in-person");

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
    return {
      time: parsed.time ?? null,
      setting: parsed.setting ?? null,
      vulnerableGroups: Array.isArray(parsed.vulnerableGroups) ? parsed.vulnerableGroups : [],
      tone: {
        anger: typeof parsed.tone?.anger === "number" ? parsed.tone.anger : 1,
        comedy: typeof parsed.tone?.comedy === "number" ? parsed.tone.comedy : 1,
        subversion: typeof parsed.tone?.subversion === "number" ? parsed.tone.subversion : 1,
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
