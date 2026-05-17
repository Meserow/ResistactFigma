import { getUserTier } from "../lib/tiers";
import { TierIcon } from "./TierBadge";

// ─── TierProgress ─────────────────────────────────────────────────────────────
// Rendered inside the existing user dropdown.  Shows:
//   • Current tier icon + name + tagline
//   • Progress bar toward the next tier
//   • "N more actions to reach [NextTier]" or "Maximum tier reached"

interface TierProgressProps {
  actionCount: number;
}

export function TierProgress({ actionCount }: TierProgressProps) {
  const { tier, nextTier, actionsToNext, progressPct } = getUserTier(actionCount);

  const isTopTier = !nextTier;

  return (
    <section
      className="px-4 py-3 border-b border-gray-50"
      aria-label="Your resistance tier"
    >
      {/* Tier header */}
      <p className="font-['Poppins',sans-serif] text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-2">
        Your tier
      </p>

      <div className="flex items-center gap-2 mb-2.5">
        {/* Icon badge */}
        <span
          className={[
            "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
            "ring-2 ring-white shadow-sm",
            tier.animated ? "animate-pulse" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{
            backgroundColor: tier.color,
            boxShadow:
              tier.animated
                ? `0 0 0 3px ${tier.glowColor}, 0 0 12px 4px ${tier.glowColor}55`
                : tier.key === "wildfire" || tier.key === "blaze"
                ? `0 0 0 2px ${tier.glowColor}`
                : undefined,
          }}
          aria-hidden="true"
        >
          <TierIcon tier={tier} size={16} />
        </span>

        {/* Name + tagline */}
        <div className="min-w-0">
          <p
            className="font-['Poppins',sans-serif] font-bold text-sm leading-tight"
            style={{ color: tier.labelColor }}
          >
            {tier.name}
          </p>
          <p className="font-['Poppins',sans-serif] text-[11px] text-gray-500 leading-tight">
            {tier.tagline}
          </p>
        </div>

        {/* Action count */}
        <span className="ml-auto font-['Poppins',sans-serif] text-[11px] tabular-nums text-gray-500 shrink-0 text-right leading-tight">
          <span className="font-bold text-[13px] text-gray-800">{actionCount.toLocaleString()}</span>
          <br />acts done
        </span>
      </div>

      {/* Progress bar */}
      <div
        className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(progressPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={
          isTopTier
            ? "Maximum tier reached"
            : `${Math.round(progressPct)}% of the way to ${nextTier!.name}`
        }
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${progressPct}%`,
            background: isTopTier
              ? `linear-gradient(90deg, ${tier.color}, ${tier.glowColor})`
              : `linear-gradient(90deg, ${tier.color}, ${nextTier!.color})`,
          }}
        />
      </div>

      {/* Progress label */}
      <p className="font-['Poppins',sans-serif] text-[11px] text-gray-400 mt-1.5">
        {isTopTier ? (
          <span className="font-semibold" style={{ color: tier.color }}>
            Maximum tier reached 🎉
          </span>
        ) : (
          <>
            <span className="font-semibold text-gray-600">
              {actionsToNext!.toLocaleString()} more act
              {actionsToNext !== 1 ? "s" : ""}
            </span>{" "}
            to reach{" "}
            <span className="font-semibold" style={{ color: nextTier!.color }}>
              {nextTier!.name}
            </span>
          </>
        )}
      </p>
    </section>
  );
}
