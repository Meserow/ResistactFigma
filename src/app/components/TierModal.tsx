import { X, Flame, FlameKindling, Sparkles } from "lucide-react";
import { TIERS, getUserTier } from "../lib/tiers";
import type { TierDef } from "../lib/tiers";

function TierIcon({ tier, size }: { tier: TierDef; size: number }) {
  const base = { strokeWidth: 2.5, "aria-hidden": true as const, style: { color: tier.iconColor } };

  if (tier.key === "wildfire") {
    const s = Math.max(6, Math.round(size * 0.75));
    const ov = -Math.round(s * 0.36);
    return (
      <span className="inline-flex items-end">
        <Flame size={s} strokeWidth={2.5} aria-hidden style={{ color: tier.iconColor, opacity: 0.65 }} />
        <Flame size={s} strokeWidth={2.5} aria-hidden style={{ color: tier.iconColor, marginLeft: ov }} />
      </span>
    );
  }

  if (tier.key === "inferno") {
    const s = Math.max(5, Math.round(size * 0.62));
    const ov = -Math.round(s * 0.33);
    return (
      <span className="inline-flex items-end">
        <Flame size={s} strokeWidth={2.5} aria-hidden style={{ color: tier.iconColor, opacity: 0.8 }} />
        <Flame size={s} strokeWidth={2.5} aria-hidden style={{ color: tier.iconColor, marginLeft: ov }} />
        <Flame size={s} strokeWidth={2.5} aria-hidden style={{ color: tier.iconColor, marginLeft: ov, opacity: 0.8 }} />
      </span>
    );
  }

  if (tier.key === "ember") {
    return <FlameKindling size={size} {...base} />;
  }

  if (tier.key === "blaze") {
    return <Flame size={size} {...base} fill={tier.iconColor} strokeWidth={1.5} />;
  }

  const props = { size, ...base };
  return tier.icon === "sparkles" ? <Sparkles {...props} /> : <Flame {...props} />;
}

interface TierModalProps {
  actionCount: number | null;
  byCategory?: Record<string, number>;
  onClose: () => void;
}

export function TierModal({ actionCount, byCategory, onClose }: TierModalProps) {
  const tierInfo = actionCount != null ? getUserTier(actionCount) : null;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-sm flex flex-col max-h-[90vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header — fixed, never scrolls */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-base leading-tight">
              My Tier Dashboard
            </h2>
            <p className="font-['Poppins',sans-serif] text-gray-400 text-xs mt-0.5">
              Every act moves you up the ladder
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 shrink-0"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1">

          {/* Tier list — compact */}
          <div className="px-4 pt-3 pb-2 space-y-0.5">
            {TIERS.map((tier, i) => {
              const isActive   = tierInfo?.tier.key === tier.key;
              const isPast     = tierInfo ? tier.min < tierInfo.tier.min : false;
              const isNext     = tierInfo?.nextTier?.key === tier.key;
              const isFuture   = !isActive && !isPast;
              const nextMin    = TIERS[i + 1]?.min ?? null;
              const rangeLabel = nextMin != null ? `${tier.min}–${nextMin - 1}` : `${tier.min}+`;

              return (
                <div
                  key={tier.key}
                  className={[
                    "flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 transition-colors",
                    isActive ? "bg-gray-50 ring-1 ring-gray-200" : "",
                    isFuture && !isNext ? "opacity-40" : "",
                  ].join(" ")}
                  aria-current={isActive ? "true" : undefined}
                >
                  {/* Icon */}
                  <div
                    className={["w-7 h-7 rounded-full flex items-center justify-center shrink-0", tier.animated ? "animate-pulse" : ""].join(" ")}
                    style={{
                      backgroundColor: tier.color,
                      boxShadow: tier.animated
                        ? `0 0 0 2px ${tier.glowColor}, 0 0 8px 2px ${tier.glowColor}55`
                        : (tier.key === "wildfire" || tier.key === "blaze")
                        ? `0 0 0 1.5px ${tier.glowColor}`
                        : undefined,
                    }}
                    aria-label={`${tier.name} icon`}
                  >
                    <TierIcon tier={tier} size={13} />
                  </div>

                  {/* Name + "You" chip */}
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <span
                      className="font-['Poppins',sans-serif] font-bold text-xs"
                      style={{ color: isActive || isPast ? tier.labelColor : "#9ca3af" }}
                    >
                      {tier.name}
                    </span>
                    {isActive && (
                      <span className="font-['Poppins',sans-serif] text-[9px] font-semibold bg-[#23297e] text-white rounded-full px-1.5 py-0.5 leading-none">
                        You
                      </span>
                    )}
                  </div>

                  {/* Range */}
                  <span className="font-['Poppins',sans-serif] text-[10px] text-gray-400 font-medium shrink-0 tabular-nums">
                    {rangeLabel}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Progress bar */}
          {tierInfo && (
            <div className="px-4 pb-3">
              <div className="bg-gray-50 rounded-xl px-3 py-2.5">
                {tierInfo.nextTier ? (
                  <>
                    <p className="font-['Poppins',sans-serif] text-xs text-gray-500 mb-1.5">
                      <span className="font-bold text-gray-800">{tierInfo.actionsToNext!.toLocaleString()} more act{tierInfo.actionsToNext !== 1 ? "s" : ""}</span>
                      {" "}to reach{" "}
                      <span className="font-bold" style={{ color: tierInfo.nextTier.labelColor }}>{tierInfo.nextTier.name}</span>
                    </p>
                    <div className="w-full h-1.5 rounded-full bg-gray-200 overflow-hidden" role="progressbar" aria-valuenow={Math.round(tierInfo.progressPct)} aria-valuemin={0} aria-valuemax={100}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${tierInfo.progressPct}%`, background: `linear-gradient(90deg, ${tierInfo.tier.color}, ${tierInfo.nextTier.color})` }}
                      />
                    </div>
                  </>
                ) : (
                  <p className="font-['Poppins',sans-serif] text-xs font-bold text-center" style={{ color: tierInfo.tier.labelColor }}>
                    🎉 Maximum tier reached — you're a legend.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Scoreboard — per-category breakdown */}
          {byCategory !== undefined && (
            <div className="px-4 pb-4">
              <div className="border-t border-gray-100 pt-3">
                <p className="font-['Poppins',sans-serif] text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-2">
                  Your scoreboard
                </p>
                {Object.keys(byCategory).length === 0 ? (
                  <p className="font-['Poppins',sans-serif] text-[12px] text-gray-400 italic">
                    Click &#34;✓ I did this&#34; on any card to start your streak.
                  </p>
                ) : (
                  <div className="space-y-0.5">
                    {Object.entries(byCategory)
                      .sort((a, b) => b[1] - a[1])
                      .map(([cat, n]) => (
                        <div
                          key={cat}
                          className="flex items-center justify-between font-['Poppins',sans-serif] text-[12px] py-0.5"
                        >
                          <span className="text-gray-600 font-medium">{cat}</span>
                          <span className="text-[#fd8e33] font-bold tabular-nums">{n}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
