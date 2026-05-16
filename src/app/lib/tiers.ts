// ─── Tier definitions ─────────────────────────────────────────────────────────
// Thresholds are calibrated for a civic-action platform where most users do
// 1–10 actions.  The low end is fine-grained so new users feel progress fast;
// the top end is aspirational and motivates long-term engagement.
//
// Spark     0–4      just getting started
// Ember     5–19     building momentum
// Flame     20–74    actively resisting
// Blaze     75–199   unstoppable
// Wildfire  200–499  movement builder
// Inferno   500+     legendary activist

export type TierKey = "spark" | "ember" | "flame" | "blaze" | "wildfire" | "inferno";

export interface TierDef {
  key: TierKey;
  name: string;
  /** Inclusive lower bound. */
  min: number;
  /** Inclusive upper bound; null for the top tier. */
  max: number | null;
  /** Badge background colour. */
  color: string;
  /** Icon / text colour rendered on top of `color`. */
  iconColor: string;
  /** Glow / ring accent colour for higher tiers. */
  glowColor: string;
  /** One-line tagline shown in the progress popover. */
  tagline: string;
  /** Which Lucide icon to use — "sparkles" for Spark, "flame" for the rest. */
  icon: "sparkles" | "flame";
  /** Whether to apply a pulsing glow animation (Inferno only). */
  animated: boolean;
}

export const TIERS: TierDef[] = [
  {
    key: "spark",    name: "Spark",    min: 0,   max: 4,   icon: "sparkles",
    color: "#FCD34D", iconColor: "#78350f", glowColor: "#FDE68A",
    tagline: "Just getting started", animated: false,
  },
  {
    key: "ember",    name: "Ember",    min: 5,   max: 19,  icon: "flame",
    color: "#FB923C", iconColor: "#fff",    glowColor: "#FED7AA",
    tagline: "Building momentum", animated: false,
  },
  {
    key: "flame",    name: "Flame",    min: 20,  max: 74,  icon: "flame",
    color: "#F97316", iconColor: "#fff",    glowColor: "#FDBA74",
    tagline: "Actively resisting", animated: false,
  },
  {
    key: "blaze",    name: "Blaze",    min: 75,  max: 199, icon: "flame",
    color: "#EF4444", iconColor: "#fff",    glowColor: "#FCA5A5",
    tagline: "Unstoppable", animated: false,
  },
  {
    key: "wildfire", name: "Wildfire", min: 200, max: 499, icon: "flame",
    color: "#DC2626", iconColor: "#fff",    glowColor: "#F87171",
    tagline: "Movement builder", animated: false,
  },
  {
    key: "inferno",  name: "Inferno",  min: 500, max: null, icon: "flame",
    color: "#991B1B", iconColor: "#fff",    glowColor: "#EF4444",
    tagline: "Legendary activist", animated: true,
  },
];

// ─── Core utility ─────────────────────────────────────────────────────────────

export interface TierInfo {
  tier: TierDef;
  nextTier: TierDef | null;
  /** How many more actions until the next tier; null at top tier. */
  actionsToNext: number | null;
  /** 0–100 progress within the current tier's range. */
  progressPct: number;
}

export function getUserTier(actionCount: number): TierInfo {
  // Walk backwards to find the highest tier the user qualifies for.
  let tierIdx = 0;
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (actionCount >= TIERS[i].min) { tierIdx = i; break; }
  }

  const tier     = TIERS[tierIdx];
  const nextTier = tierIdx < TIERS.length - 1 ? TIERS[tierIdx + 1] : null;

  const actionsToNext = nextTier ? nextTier.min - actionCount : null;

  const progressPct = nextTier
    ? Math.min(100, ((actionCount - tier.min) / (nextTier.min - tier.min)) * 100)
    : 100; // top tier is always "full"

  return { tier, nextTier, actionsToNext, progressPct };
}
