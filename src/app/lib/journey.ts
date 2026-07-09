/**
 * The Activist Journey — the tier-gated category ladder behind the
 * "Find your path" onboarding flow (JourneyModal) for visitors without
 * accounts.
 *
 * The idea: nobody starts at a protest. Each gamification tier (lib/tiers.ts)
 * OFFERS a set of act categories that fit that stage of the journey — Sparks
 * get quiet from-your-couch acts, Blazes get the out-loud in-person ones.
 * Unlocks are cumulative: reaching a tier keeps everything below it.
 *
 * Category names here are the canonical Title-Case forms from
 * categoryGroups.ts / normaliseCategory(). One edit vs. the original spec:
 * "Host" was specced at both Flame and Blaze — it unlocks at Flame.
 */
import { TIERS, getUserTier } from "./tiers";
import type { TierKey } from "./tiers";
import { KNOWN_CATEGORIES } from "./categoryGroups";

/** Categories NEWLY offered at each tier (not cumulative). Wildfire is
 *  computed below as "every known category not already on the ladder";
 *  Inferno adds nothing new — by then everything is open. */
export const JOURNEY_UNLOCKS: Record<TierKey, string[]> = {
  spark: ["Amplify", "Crafting", "Represent", "Texting"],
  ember: ["Commitment", "Email", "Kindness", "Petition", "Phoning", "Social Media"],
  flame: ["Art", "Educate", "Group", "Host", "Irreverence", "Mental Health", "Prayer", "Witness", "Writing"],
  blaze: ["Boycott", "Funding", "Protest", "Show Up", "Skills", "Training"],
  wildfire: [], // filled in below
  inferno: [],
};

// Wildfire = everything else. Derived from KNOWN_CATEGORIES so a category
// added to the app later automatically lands on the top rung instead of
// silently falling off the journey.
{
  const laddered = new Set(
    (["spark", "ember", "flame", "blaze"] as TierKey[]).flatMap((k) => JOURNEY_UNLOCKS[k]),
  );
  JOURNEY_UNLOCKS.wildfire = [...KNOWN_CATEGORIES].filter((c) => !laddered.has(c)).sort();
}

/** One-line, shame-free pitch for each rung of the ladder. Rendered in the
 *  JourneyModal path view and reusable anywhere the ladder shows up. */
export const JOURNEY_PITCH: Record<TierKey, string> = {
  spark:    "Quiet, from-your-couch acts. Boost a voice, craft for a cause, wear your values, send a text.",
  ember:    "Reach out in your own words — email, call, sign, share, commit.",
  flame:    "Create, care, and connect. Your kind of activism starts taking shape.",
  blaze:    "Be counted — in person, out loud, on purpose.",
  wildfire: "Everything opens up. Every category, every act, no limits.",
  inferno:  "You're not just finding acts anymore — you're the reason others start.",
};

/** Cumulative unlocked categories for a tier — everything offered at that
 *  tier and below. Returns null for Wildfire and Inferno, meaning "no
 *  filter — everything is unlocked" (including categories the ladder has
 *  never heard of). */
export function unlockedCategoriesFor(tierKey: TierKey): string[] | null {
  if (tierKey === "wildfire" || tierKey === "inferno") return null;
  const out: string[] = [];
  for (const tier of TIERS) {
    out.push(...JOURNEY_UNLOCKS[tier.key]);
    if (tier.key === tierKey) break;
  }
  return out;
}

/** Categories newly offered at exactly this tier. */
export function newUnlocksFor(tierKey: TierKey): string[] {
  return JOURNEY_UNLOCKS[tierKey];
}

/** Convenience: the unlocked-category filter for a raw action count. */
export function unlockedCategoriesForCount(actionCount: number): string[] | null {
  return unlockedCategoriesFor(getUserTier(actionCount).tier.key);
}
