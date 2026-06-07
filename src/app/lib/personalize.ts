// "For You" — learns what a visitor likes from their own behavior and re-ranks
// the feed to match, with no sliders to set.
//
// The matcher (matcher.ts) ranks against EXPLICIT preferences the user dialed
// in on the Match Me wizard. We don't surface those tone sliders anymore — this
// module replaces that input by INFERRING the same preference dimensions from
// what the user actually does on the site: which acts they save, boost, mark
// "I did this", share, and open.
//
// Design goals:
//   • No new per-act metadata — we reuse the feature vectors matcher.ts already
//     derives (tone, time bucket, in-person/remote) plus the act's category.
//   • Recency-aware — a save from last week should count more than one from two
//     months ago. Each signal decays on a 30-day half-life.
//   • Equal blend — tone, category, time, and location each contribute a
//     comparable amount to the final score; no single dimension dominates.
//   • Graceful cold-start — under a handful of signals we have nothing to learn
//     from, so callers fall back to the Popular ordering.

import type { ActionCardData } from "../components/ActionCard";
import { toneFor, timeBucketFor, cardIsAtHome, type Tone, type TimeBucket } from "./matcher";

// ─── Signal model ───────────────────────────────────────────────────────────
// A flat, append-only event log is the personalization data layer. It lives
// ALONGSIDE the existing `Set<id>` state (resistact_boosted, _bookmarks, etc.)
// rather than replacing it — those Sets remain the source of truth for UI state
// ("is this card saved?"), while the log carries the extra dimensions the
// profile needs: which KIND of signal, and WHEN it happened.

export type SignalKind =
  | "did"      // marked "I did this!" — strongest endorsement, they acted
  | "saved"    // bookmarked — real intent to act
  | "boosted"  // 🔥 boost — endorsement
  | "shared"   // shared the act — endorsement + amplification
  | "opened"   // opened the detail modal — curiosity, weak signal
  | "passed";  // dismissed / swiped-left — explicit "not for me" (negative)

export interface SignalEvent {
  /** Card id the signal is about. */
  id: number;
  kind: SignalKind;
  /** Unix ms timestamp. */
  ts: number;
}

// Base intent weight per signal kind, before recency decay. Tuned so the
// "I did this → saved/boosted → shared → opened" ordering the product asked for
// holds, with a pass pulling in the opposite direction at roughly save-strength.
const SIGNAL_WEIGHT: Record<SignalKind, number> = {
  did: 5,
  saved: 4,
  boosted: 4,
  shared: 3,
  opened: 1,
  passed: -4,
};

// Recency: a signal counts half as much every HALF_LIFE_DAYS. 30 days = a month
// of behavior shapes the feed; older signals fade smoothly rather than dropping
// off a cliff.
const HALF_LIFE_DAYS = 30;
const DAY_MS = 86_400_000;

function decay(ageMs: number): number {
  if (ageMs <= 0) return 1;
  return Math.pow(0.5, ageMs / (HALF_LIFE_DAYS * DAY_MS));
}

// Below this many DISTINCT positively-engaged acts we don't have enough signal
// to personalize — callers should fall back to Popular instead.
export const MIN_SIGNALS_FOR_PERSONALIZATION = 4;

// Keep the on-device log bounded. Recency decay already makes ancient events
// near-weightless, so trimming the oldest beyond this cap loses nothing the
// ranking would have used.
export const MAX_SIGNAL_LOG = 500;

// ─── Time buckets → minutes (local copy) ─────────────────────────────────────
// matcher.ts keeps its BUCKET_MINUTES private; mirror the same scale here so the
// time-affinity term lines up with how the matcher reasons about duration.
const BUCKET_MINUTES: Record<TimeBucket, number> = {
  "5min": 5,
  "10min": 10,
  "30min": 30,
  "1hr": 60,
  "fewHours": 180,
  "fullDay": 480,
  "ongoing": 720,
};

// ─── The learned profile ─────────────────────────────────────────────────────

export interface UserProfile {
  /** Inferred tone vector (each dim ~0-3, matcher-compatible) — the weighted
   * average tone of everything the user positively engaged with. */
  tone: Tone;
  /** Per-category net affinity, normalized to [-1, 1]. Positive = drawn to it,
   * negative = passes on it. Categories never touched are absent (neutral). */
  categoryAffinity: Record<string, number>;
  /** Preferred time commitment in minutes — weighted average of engaged acts. */
  preferredMinutes: number;
  /** In-person ↔ remote lean in [-1, 1]. +1 = only ever engages in-person
   * acts, -1 = only remote/at-home, 0 = no lean (show both). */
  inPersonLean: number;
  /** How many distinct acts contributed positive signal — drives cold-start. */
  positiveCount: number;
}

const NEUTRAL_TONE: Tone = { anger: 1, comedy: 1, subversion: 1, care: 1, hope: 1, energy: 1 };

/**
 * Fold the signal log into a learned profile. `cardsById` resolves each signal
 * to the act's feature vector. Events whose card we can't resolve (deleted,
 * not yet loaded) are skipped. Returns null when there isn't enough positive
 * signal to personalize — the caller should fall back to Popular.
 */
export function buildProfile(
  log: SignalEvent[],
  cardsById: Map<number, ActionCardData>,
  now: number,
): UserProfile | null {
  // Tone accumulates over POSITIVE signals only (a weighted average tone makes
  // sense for "what they like"; pulling it toward the negation of a passed
  // card's tone is noisy). Passes instead bite at category affinity and the
  // location lean, where the intent is cleaner.
  const toneSum: Tone = { anger: 0, comedy: 0, subversion: 0, care: 0, hope: 0, energy: 0 };
  let tonePosWeight = 0;
  let minutesSum = 0;
  let minutesPosWeight = 0;

  // Net signed weight per category, and per location class.
  const catNet: Record<string, number> = {};
  let inPersonWeight = 0;
  let remoteWeight = 0;

  // Distinct positively-engaged cards (de-duped across kinds) for cold-start.
  const positiveIds = new Set<number>();

  for (const ev of log) {
    const card = cardsById.get(ev.id);
    if (!card) continue;
    const base = SIGNAL_WEIGHT[ev.kind];
    if (base === undefined) continue;
    const w = base * decay(now - ev.ts); // signed; negative for passes

    const cat = (card.category ?? "OTHER").toUpperCase();
    catNet[cat] = (catNet[cat] ?? 0) + w;

    const atHome = cardIsAtHome(card);
    if (atHome) remoteWeight += w;
    else inPersonWeight += w;

    if (w > 0) {
      const t = toneFor(card);
      toneSum.anger += w * t.anger;
      toneSum.comedy += w * t.comedy;
      toneSum.subversion += w * t.subversion;
      toneSum.care += w * t.care;
      toneSum.hope += w * t.hope;
      toneSum.energy += w * t.energy;
      tonePosWeight += w;

      minutesSum += w * BUCKET_MINUTES[timeBucketFor(card)];
      minutesPosWeight += w;

      if (typeof ev.id === "number") positiveIds.add(ev.id);
    }
  }

  if (positiveIds.size < MIN_SIGNALS_FOR_PERSONALIZATION) return null;

  const tone: Tone = tonePosWeight > 0
    ? {
        anger: toneSum.anger / tonePosWeight,
        comedy: toneSum.comedy / tonePosWeight,
        subversion: toneSum.subversion / tonePosWeight,
        care: toneSum.care / tonePosWeight,
        hope: toneSum.hope / tonePosWeight,
        energy: toneSum.energy / tonePosWeight,
      }
    : { ...NEUTRAL_TONE };

  // Normalize category affinity to [-1, 1] by the largest magnitude so the
  // scale is comparable across users with very different activity levels.
  let maxAbs = 0;
  for (const v of Object.values(catNet)) maxAbs = Math.max(maxAbs, Math.abs(v));
  const categoryAffinity: Record<string, number> = {};
  if (maxAbs > 0) {
    for (const [cat, v] of Object.entries(catNet)) categoryAffinity[cat] = v / maxAbs;
  }

  const preferredMinutes = minutesPosWeight > 0 ? minutesSum / minutesPosWeight : 30;

  // In-person lean: net in-person weight vs net remote weight, normalized.
  const denom = Math.abs(inPersonWeight) + Math.abs(remoteWeight);
  const inPersonLean = denom > 0 ? (inPersonWeight - remoteWeight) / denom : 0;

  return {
    tone,
    categoryAffinity,
    preferredMinutes,
    inPersonLean,
    positiveCount: positiveIds.size,
  };
}

// ─── Scoring ──────────────────────────────────────────────────────────────────
// Each of the four learned dimensions returns ~0-10 so the blend is even. On
// top we add small engagement + event-proximity overlays (the urgency layer the
// product wanted: in-person events and community-proven acts get a nudge) that
// act as tiebreakers without overpowering the learned fit.

function cosineToneAffinity(card: ActionCardData, tone: Tone): number {
  const t = toneFor(card);
  const dot =
    t.anger * tone.anger +
    t.comedy * tone.comedy +
    t.subversion * tone.subversion +
    t.care * tone.care +
    t.hope * tone.hope +
    t.energy * tone.energy;
  const magA = Math.hypot(t.anger, t.comedy, t.subversion, t.care, t.hope, t.energy);
  const magB = Math.hypot(tone.anger, tone.comedy, tone.subversion, tone.care, tone.hope, tone.energy);
  if (magA === 0 || magB === 0) return 5; // neutral when one vector is all-zero
  return (dot / (magA * magB)) * 10; // cosine in [0,1] → 0-10
}

function categoryAffinityScore(card: ActionCardData, profile: UserProfile): number {
  const cat = (card.category ?? "OTHER").toUpperCase();
  const a = profile.categoryAffinity[cat]; // [-1,1] or undefined (neutral)
  if (a === undefined) return 5; // unseen category → neutral midpoint
  return (a + 1) * 5; // [-1,1] → [0,10]
}

function timeAffinityScore(card: ActionCardData, profile: UserProfile): number {
  const have = BUCKET_MINUTES[timeBucketFor(card)];
  const want = profile.preferredMinutes;
  if (want <= 0 || have <= 0) return 5;
  const ratio = Math.min(want, have) / Math.max(want, have); // (0,1]
  return ratio * 10;
}

function locationAffinityScore(card: ActionCardData, profile: UserProfile): number {
  // Soft, blended location fit (NOT a hard filter): a user who leans in-person
  // still sees remote acts, just ranked a touch lower, and vice-versa. With no
  // lean (lean≈0) every card scores the neutral midpoint, so location stops
  // mattering and other dimensions decide.
  const cardInPerson = !cardIsAtHome(card);
  // dir = +1 when the card's class matches the user's lean direction.
  const dir = cardInPerson ? profile.inPersonLean : -profile.inPersonLean;
  return (dir + 1) * 5; // [-1,1] → [0,10]
}

function eventProximityBonus(card: ActionCardData, now: number): number {
  const eventDate = card.eventDate;
  if (!eventDate) return 0;
  const todayISO = new Date(now).toISOString().slice(0, 10);
  if (eventDate < todayISO) return 0;
  const today = Date.parse(todayISO);
  const event = Date.parse(eventDate);
  if (Number.isNaN(today) || Number.isNaN(event)) return 0;
  const daysUntil = Math.max(0, Math.round((event - today) / DAY_MS));
  if (daysUntil === 0) return 10;
  if (daysUntil === 1) return 8;
  if (daysUntil <= 3) return 6;
  if (daysUntil <= 7) return 4;
  if (daysUntil <= 14) return 2;
  if (daysUntil <= 30) return 1;
  return 0.5;
}

/**
 * Score one card against the learned profile. Higher = better fit. The four
 * learned dimensions are weighted equally; engagement + event proximity are
 * lighter overlays for urgency / proven traction.
 */
export function personalScore(card: ActionCardData, profile: UserProfile, now: number): number {
  const tone = cosineToneAffinity(card, profile.tone);   // 0-10
  const category = categoryAffinityScore(card, profile); // 0-10
  const time = timeAffinityScore(card, profile);         // 0-10
  const location = locationAffinityScore(card, profile); // 0-10

  // Equal blend of the four learned dimensions.
  const learned = tone + category + time + location; // 0-40

  // Community traction overlay — break ties toward proven acts. 0-5.
  const engagement = (card.boosts ?? 0) + (card.completions ?? 0);
  const engagementScore = Math.min(engagement, 40) / 8;

  // Upcoming-event overlay — time-sensitive acts get a nudge. 0-10.
  const event = eventProximityBonus(card, now);

  return learned + engagementScore + event;
}

/** Rank cards by personal fit, best first. Pure — does no filtering. */
export function personalRank(cards: ActionCardData[], profile: UserProfile, now: number): ActionCardData[] {
  return cards
    .map((c) => ({ c, s: personalScore(c, profile, now) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}

// ─── Log persistence helpers ─────────────────────────────────────────────────
// Pure helpers the App layer uses to read/append/trim the log. Kept here so the
// storage shape and the profile builder stay in one place.

export const SIGNAL_LOG_KEY = "resistact_signal_log";

/** Parse a stored log, tolerating legacy / malformed payloads. */
export function parseSignalLog(raw: string | null): SignalEvent[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is SignalEvent =>
        e && typeof e.id === "number" && typeof e.ts === "number" && typeof e.kind === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Append an event and return a trimmed log. We don't dedupe — repeated opens of
 * the same act are themselves signal (sustained interest), and recency decay
 * keeps the math sane. We only cap total length.
 */
export function appendSignal(log: SignalEvent[], id: number, kind: SignalKind, ts: number): SignalEvent[] {
  const next = [...log, { id, kind, ts }];
  return next.length > MAX_SIGNAL_LOG ? next.slice(next.length - MAX_SIGNAL_LOG) : next;
}
