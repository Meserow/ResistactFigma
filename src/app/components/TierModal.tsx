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
        className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <div>
            <h2 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-lg leading-tight">
              Resistance Tiers
            </h2>
            <p className="font-['Poppins',sans-serif] text-gray-400 text-xs mt-0.5">
              Every action moves you up the ladder
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 shrink-0"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tier list */}
        <div className="px-6 py-4 space-y-1">
          {TIERS.map((tier, i) => {
            const isActive   = tierInfo?.tier.key === tier.key;
            const isPast     = tierInfo ? tier.min < tierInfo.tier.min : false;
            const isNext     = tierInfo?.nextTier?.key === tier.key;
            const isFuture   = !isActive && !isPast;
            const nextMin    = TIERS[i + 1]?.min ?? null;
            const rangeLabel = nextMin != null
              ? `${tier.min}–${nextMin - 1}`
              : `${tier.min}+`;

            return (
              <div
                key={tier.key}
                className={[
                  "flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors",
                  isActive ? "bg-gray-50 ring-1 ring-gray-200" : "",
                  isFuture && !isNext ? "opacity-50" : "",
                ].join(" ")}
                aria-current={isActive ? "true" : undefined}
              >
                {/* Icon */}
                <div
                  className={["w-10 h-10 rounded-full flex items-center justify-center shrink-0", tier.animated ? "animate-pulse" : ""].join(" ")}
                  style={{
                    backgroundColor: tier.color,
                    boxShadow: tier.animated
                      ? `0 0 0 3px ${tier.glowColor}, 0 0 10px 3px ${tier.glowColor}55`
                      : (tier.key === "wildfire" || tier.key === "blaze")
                      ? `0 0 0 2px ${tier.glowColor}`
                      : undefined,
                  }}
                  aria-label={`${tier.name} icon`}
                >
                  <TierIcon tier={tier} size={18} />
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="font-['Poppins',sans-serif] font-bold text-sm"
                      style={{ color: isActive || isPast ? tier.color : "#9ca3af" }}
                    >
                      {tier.name}
                    </span>
                    {isActive && (
                      <span className="font-['Poppins',sans-serif] text-[10px] font-semibold bg-[#23297e] text-white rounded-full px-2 py-0.5 leading-none">
                        You
                      </span>
                    )}
                  </div>
                  <p className="font-['Poppins',sans-serif] text-[11px] text-gray-400 leading-tight truncate">
                    {tier.tagline}
                  </p>
                </div>

                {/* Range */}
                <span className="font-['Poppins',sans-serif] text-[11px] text-gray-400 font-medium shrink-0 tabular-nums">
                  {rangeLabel}
                </span>
              </div>
            );
          })}
        </div>

        {/* Scoreboard — per-category breakdown */}
        {byCategory !== undefined && (
          <div className="px-6 pb-2 pt-0">
            <div className="border-t border-gray-100 pt-3">
              <p className="font-['Poppins',sans-serif] text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-2">
                Your scoreboard
              </p>
              {Object.keys(byCategory).length === 0 ? (
                <p className="font-['Poppins',sans-serif] text-[12px] text-gray-400 italic">
                  Click &#34;✓ I did this&#34; on any card to start your streak.
                </p>
              ) : (
                <div className="max-h-36 overflow-y-auto space-y-0.5">
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

        {/* Progress footer — only when logged in */}
        {tierInfo && (
          <div className="px-6 pb-5 pt-1">
            <div className="bg-gray-50 rounded-2xl px-4 py-3">
              {tierInfo.nextTier ? (
                <>
                  <p className="font-['Poppins',sans-serif] text-xs text-gray-500 mb-2">
                    <span className="font-bold text-gray-800">{tierInfo.actionsToNext!.toLocaleString()} more action{tierInfo.actionsToNext !== 1 ? "s" : ""}</span>
                    {" "}to reach{" "}
                    <span className="font-bold" style={{ color: tierInfo.nextTier.color }}>{tierInfo.nextTier.name}</span>
                  </p>
                  <div className="w-full h-2 rounded-full bg-gray-200 overflow-hidden" role="progressbar" aria-valuenow={Math.round(tierInfo.progressPct)} aria-valuemin={0} aria-valuemax={100}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${tierInfo.progressPct}%`, background: `linear-gradient(90deg, ${tierInfo.tier.color}, ${tierInfo.nextTier.color})` }}
                    />
                  </div>
                </>
              ) : (
                <p className="font-['Poppins',sans-serif] text-xs font-bold text-center" style={{ color: tierInfo.tier.color }}>
                  🎉 Maximum tier reached — you're a legend.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
