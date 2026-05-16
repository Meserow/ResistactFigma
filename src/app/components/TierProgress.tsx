import { getUserTier } from "../lib/tiers";
import { TierIcon } from "./TierBadge";
import { TIERS } from "../lib/tiers";

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
            style={{ color: tier.color }}
          >
            {tier.name}
          </p>
          <p className="font-['Poppins',sans-serif] text-[11px] text-gray-500 leading-tight">
            {tier.tagline}
          </p>
        </div>

        {/* Action count */}
        <span className="ml-auto font-['Poppins',sans-serif] font-bold text-[13px] tabular-nums text-gray-800 shrink-0">
          {actionCount.toLocaleString()}
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
              {actionsToNext!.toLocaleString()} more action
              {actionsToNext !== 1 ? "s" : ""}
            </span>{" "}
            to reach{" "}
            <span className="font-semibold" style={{ color: nextTier!.color }}>
              {nextTier!.name}
            </span>
          </>
        )}
      </p>

      {/* Tier ladder */}
      <div className="mt-2.5" aria-hidden="true">
        {/* Icons row — shown above current + future tiers */}
        <div className="flex gap-1 mb-1 items-end">
          {TIERS.map((t) => {
            const isActive = t.key === tier.key;
            const isPast   = t.min < tier.min;
            const isFuture = !isActive && !isPast;
            return (
              <div key={t.key} className="flex-1 flex justify-center">
                {(isActive || isFuture) ? (
                  <div
                    className={["w-5 h-5 rounded-full flex items-center justify-center transition-all", tier.animated && isActive ? "animate-pulse" : ""].filter(Boolean).join(" ")}
                    style={{ backgroundColor: t.color, opacity: isFuture ? 0.25 : 1 }}
                    title={t.name}
                  >
                    <TierIcon tier={t} size={10} />
                  </div>
                ) : (
                  /* past tier — just a spacer so the dashes stay aligned */
                  <div className="w-5 h-5" />
                )}
              </div>
            );
          })}
        </div>
        {/* Dash row */}
        <div className="flex items-center gap-1">
          {TIERS.map((t) => {
            const isActive = t.key === tier.key;
            const isPast   = t.min < tier.min;
            return (
              <div
                key={t.key}
                title={t.name}
                className={["flex-1 rounded-full transition-all", isActive ? "h-1.5" : "h-1"].join(" ")}
                style={{
                  backgroundColor: isActive || isPast ? t.color : "#e5e7eb",
                  opacity: isPast ? 0.5 : 1,
                }}
              />
            );
          })}
        </div>
        <div className="flex justify-between mt-0.5">
          <span className="font-['Poppins',sans-serif] text-[9px] text-gray-300">{TIERS[0].name}</span>
          <span className="font-['Poppins',sans-serif] text-[9px] text-gray-300">{TIERS[TIERS.length - 1].name}</span>
        </div>
      </div>
    </section>
  );
}
