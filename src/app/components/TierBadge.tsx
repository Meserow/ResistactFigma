import { Flame, FlameKindling, Sparkles } from "lucide-react";
import { getUserTier } from "../lib/tiers";
import type { TierDef } from "../lib/tiers";

// ─── Shared icon renderer ─────────────────────────────────────────────────────

function TierIcon({
  tier,
  size,
  className = "",
}: {
  tier: TierDef;
  size: number;
  className?: string;
}) {
  const baseProps = {
    "aria-hidden": true as const,
    color: tier.iconColor,
    strokeWidth: 2.5,
    className,
  };

  // Wildfire — two overlapping flames
  if (tier.key === "wildfire") {
    const s = Math.max(6, Math.round(size * 0.75));
    const ov = -Math.round(s * 0.36);
    return (
      <span className="inline-flex items-end">
        <Flame size={s} strokeWidth={2.5} aria-hidden style={{ color: tier.iconColor, opacity: 0.65 }} className={className} />
        <Flame size={s} strokeWidth={2.5} aria-hidden style={{ color: tier.iconColor, marginLeft: ov }} className={className} />
      </span>
    );
  }

  // Inferno — three overlapping flames
  if (tier.key === "inferno") {
    const s = Math.max(5, Math.round(size * 0.62));
    const ov = -Math.round(s * 0.33);
    return (
      <span className="inline-flex items-end">
        <Flame size={s} strokeWidth={2.5} aria-hidden style={{ color: tier.iconColor, opacity: 0.8 }} className={className} />
        <Flame size={s} strokeWidth={2.5} aria-hidden style={{ color: tier.iconColor, marginLeft: ov }} className={className} />
        <Flame size={s} strokeWidth={2.5} aria-hidden style={{ color: tier.iconColor, marginLeft: ov, opacity: 0.8 }} className={className} />
      </span>
    );
  }

  // Ember — kindling flame (just building up)
  if (tier.key === "ember") {
    return <FlameKindling size={size} {...baseProps} />;
  }

  // Blaze — solid filled flame (fully ablaze)
  if (tier.key === "blaze") {
    return <Flame size={size} {...baseProps} fill={tier.iconColor} strokeWidth={1.5} />;
  }

  const props = { size, ...baseProps };
  return tier.icon === "sparkles" ? <Sparkles {...props} /> : <Flame {...props} />;
}

// ─── Avatar badge ─────────────────────────────────────────────────────────────
// Sits at the bottom-centre of the avatar circle.  The parent <span> must be
// `position: relative` and have no overflow:hidden (both are already true in
// Navbar).

interface TierBadgeProps {
  actionCount: number;
  className?: string;
}

export function TierBadge({ actionCount, className = "" }: TierBadgeProps) {
  const { tier } = getUserTier(actionCount);

  // Inferno: pulsing box-shadow glow
  const glowStyle: React.CSSProperties =
    tier.animated
      ? { boxShadow: `0 0 0 3px ${tier.glowColor}, 0 0 10px 3px ${tier.glowColor}66` }
      : tier.key === "wildfire"
      ? { boxShadow: `0 0 0 2px ${tier.glowColor}` }
      : tier.key === "blaze"
      ? { boxShadow: `0 0 0 2px ${tier.glowColor}` }
      : {};

  return (
    <span
      role="img"
      aria-label={`${tier.name} tier`}
      title={`${tier.name} — ${tier.tagline}`}
      className={[
        // Layout
        "absolute -bottom-1.5 left-1/2 -translate-x-1/2",
        // Shape
        "w-6 h-6 rounded-full flex items-center justify-center",
        // Separation ring
        "ring-2 ring-white",
        // Inferno pulse
        tier.animated ? "animate-pulse" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ backgroundColor: tier.color, ...glowStyle }}
    >
      <TierIcon tier={tier} size={12} />
    </span>
  );
}

// ─── Inline tier chip ─────────────────────────────────────────────────────────
// Small pill used in the name/status area (lg:block section of Navbar).

interface TierChipProps {
  actionCount: number;
}

export function TierChip({ actionCount }: TierChipProps) {
  const { tier } = getUserTier(actionCount);

  return (
    <span
      className="inline-flex items-center gap-0.5 font-['Poppins',sans-serif] font-semibold"
      style={{ color: tier.color }}
      aria-label={`Tier: ${tier.name}`}
    >
      <TierIcon tier={tier} size={10} />
      <span className="text-[10px] leading-none">{tier.name}</span>
    </span>
  );
}

// ─── Re-export TierIcon for use in TierProgress ───────────────────────────────
export { TierIcon };
