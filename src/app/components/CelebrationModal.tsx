/**
 * CelebrationModal — fires when the user marks a fresh action as DONE.
 *
 * Goals:
 *   1. Make finishing an action feel earned. Fireworks + count-up + the
 *      tier badge front and center.
 *   2. Make the next tier feel *doable*. The micro-copy adapts to how many
 *      actions are left — "Just 1 more" lands very differently from "200 to
 *      go." We frame larger gaps as "one a day for a week" / "this month"
 *      so the climb stays human-scale.
 *   3. Encourage another action without nagging. One primary CTA, one quiet
 *      Close. Auto-dismissable via Esc / backdrop / 8-second timer.
 *
 * Behaviorally we only show this on a *positive* completion delta — un-doing
 * a "DONE!" does not retrigger fireworks.
 */
import { useEffect, useMemo, useState } from "react";
import { X, ArrowRight } from "lucide-react";
import { getUserTier } from "../lib/tiers";
import { TierIcon } from "./TierBadge";

interface CelebrationModalProps {
  prevCount: number;
  newCount: number;
  onClose: () => void;
  onFindMore: () => void;
}

// ─── Copy ────────────────────────────────────────────────────────────────────
// Headline + supporting copy. Everything is calibrated so the climb to the
// next tier feels concrete and short. Big numbers become "X a week", not "X."

function celebrationCopy(prev: number, next: number) {
  const justLeveledUp = getUserTier(prev).tier.key !== getUserTier(next).tier.key;
  const { tier, nextTier, actionsToNext } = getUserTier(next);

  let headline: string;
  let kicker: string | null = null;

  if (justLeveledUp) {
    headline = `Welcome to ${tier.name}.`;
    kicker = tier.tagline + ".";
  } else if (next === 1) {
    headline = "First one — welcome to the resistance.";
    kicker = "Every movement is built from \"firsts\".";
  } else if (next === 5)        { headline = "Five down. You're rolling."; }
  else if (next === 10)         { headline = "Ten actions. That's a streak."; }
  else if (next % 25 === 0)     { headline = `${next} actions. Quietly enormous.`; }
  else if (next % 10 === 0)     { headline = `${next}. Still going.`; }
  else                          { headline = "Done. Nice."; }

  // "Doable" framing for the next tier. We translate raw counts into time
  // metaphors users feel in their body — a week, a month — instead of dry
  // numbers. The frame matters more than the math.
  let nextLine: string;
  if (!nextTier || actionsToNext == null) {
    nextLine = "You're at the top tier. Keep showing up — the movement needs you.";
  } else if (actionsToNext === 1) {
    nextLine = `Just **1 more** action and you're a ${nextTier.name}.`;
  } else if (actionsToNext === 2) {
    nextLine = `**2 more** actions — that's tonight and tomorrow.`;
  } else if (actionsToNext <= 4) {
    nextLine = `**${actionsToNext} more** to ${nextTier.name}. One a day this week.`;
  } else if (actionsToNext <= 7) {
    nextLine = `**${actionsToNext} more** to ${nextTier.name} — one a day for a week.`;
  } else if (actionsToNext <= 14) {
    nextLine = `**${actionsToNext} more** to ${nextTier.name}. Two weeks at one a day.`;
  } else if (actionsToNext <= 30) {
    nextLine = `**${actionsToNext} more** to ${nextTier.name} — about a month at one a day.`;
  } else if (actionsToNext <= 60) {
    nextLine = `**${actionsToNext}** to ${nextTier.name}. Two months. Pick one each evening.`;
  } else {
    nextLine = `**${actionsToNext}** to ${nextTier.name}. Aspirational — but you've already started.`;
  }

  return { headline, kicker, nextLine, justLeveledUp, tier, nextTier, actionsToNext };
}

// ─── Count-up hook — animates an integer up to `target` over `durationMs` ────
function useCountUp(target: number, durationMs = 700) {
  const [n, setN] = useState(Math.max(0, target - 1));
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const from = Math.max(0, target - 1);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // Ease-out so the number lands on `target` and softly stops.
      const eased = 1 - Math.pow(1 - t, 3);
      setN(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return n;
}

// ─── Fireworks (compact, modal-internal) ─────────────────────────────────────
// Stays inside the modal hero behind the tier badge — gives the burst origin
// a focal point. The BIG explosion is a sibling rendered outside the modal
// (ExplosiveFireworks below) so particles can fly past the modal edges and
// across the whole viewport.
function HeroBurst({ tierColor, glowColor }: { tierColor: string; glowColor: string }) {
  const ringColors = ["#fd8e33", "#23297e", tierColor];
  const particlesPerRing = 22;

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
      {ringColors.map((color, ringIdx) => (
        <div key={ringIdx} className="absolute">
          {Array.from({ length: particlesPerRing }).map((_, i) => {
            const angle = (i / particlesPerRing) * 360;
            const radius = 80 + ringIdx * 40;
            const tx = Math.cos((angle * Math.PI) / 180) * radius;
            const ty = Math.sin((angle * Math.PI) / 180) * radius;
            return (
              <span
                key={i}
                className="celebration-particle"
                style={{
                  background: color,
                  boxShadow: `0 0 10px ${glowColor}`,
                  ["--tx" as any]: `${tx}px`,
                  ["--ty" as any]: `${ty}px`,
                  animationDelay: `${ringIdx * 120}ms`,
                }}
              />
            );
          })}
        </div>
      ))}
      <style>{`
        @keyframes celebration-burst {
          0%   { transform: translate(0, 0)                  scale(0.3); opacity: 0; }
          15%  { transform: translate(0, 0)                  scale(1);   opacity: 1; }
          70%  { transform: translate(var(--tx), var(--ty))  scale(1);   opacity: 1; }
          100% { transform: translate(var(--tx), var(--ty))  scale(0.3); opacity: 0; }
        }
        .celebration-particle {
          position: absolute;
          top: 0; left: 0;
          width: 9px; height: 9px;
          border-radius: 9999px;
          animation: celebration-burst 1600ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
          will-change: transform, opacity;
        }
      `}</style>
    </div>
  );
}

// ─── ExplosiveFireworks (viewport-wide, bleeds everywhere) ───────────────────
// Renders OUTSIDE the modal so it spans the full viewport and bleeds past the
// modal edges. Multiple shockwave bursts + a confetti storm + (for tier-up
// moments) a brief radial flash of the tier color. Aims for "I just won the
// playoffs" energy, not "subtle micro-interaction" energy.
//
// Built deliberately with vanilla CSS keyframes — no canvas-confetti dep so
// it works whether or not the user is online and ships in the existing
// bundle.
function ExplosiveFireworks({
  tierColor,
  glowColor,
  justLeveledUp,
}: {
  tierColor: string;
  glowColor: string;
  justLeveledUp: boolean;
}) {
  // Generate burst + confetti config once per mount so re-renders don't
  // restart the animations.
  const data = useMemo(() => {
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const palette = [
      "#fd8e33", "#23297e", "#FCD34D", "#EF4444",
      "#10B981", "#3B82F6", "#A855F7", "#EC4899",
      tierColor,
    ];

    // Burst origins (viewport-percentage). Each burst gets ~40 particles
    // shooting outward to a random distance up to 600px.
    const burstOrigins = [
      { left: "50%", top: "42%", delay: 0,    color: tierColor, count: 56 },
      { left: "22%", top: "32%", delay: 220,  color: palette[0], count: 36 },
      { left: "78%", top: "32%", delay: 360,  color: palette[3], count: 36 },
      { left: "18%", top: "62%", delay: 540,  color: palette[2], count: 28 },
      { left: "82%", top: "62%", delay: 680,  color: palette[5], count: 28 },
      { left: "50%", top: "12%", delay: 820,  color: palette[6], count: 36 },
    ];

    const bursts = burstOrigins.map((o, bi) => ({
      ...o,
      id: bi,
      particles: Array.from({ length: o.count }, (_, i) => {
        const angle    = (i / o.count) * 360 + rand(-12, 12);
        const distance = rand(220, justLeveledUp ? 720 : 520);
        const tx = Math.cos((angle * Math.PI) / 180) * distance;
        // Slight upward bias on Y — feels more like a real firework that
        // rises and arcs, less like a uniform circle.
        const ty = Math.sin((angle * Math.PI) / 180) * distance - rand(0, 80);
        const size = rand(6, 14);
        const color = palette[Math.floor(Math.random() * palette.length)];
        const dur = rand(1400, 2200);
        const innerDelay = rand(0, 220);
        const spin = (Math.random() < 0.5 ? -1 : 1) * rand(180, 720);
        return { tx, ty, size, color, dur, innerDelay, spin, key: `${bi}-${i}` };
      }),
    }));

    // Confetti rain — falls from above the viewport, drifts sideways. More
    // pieces (and longer fall) on tier-up.
    const confettiCount = justLeveledUp ? 140 : 80;
    const confetti = Array.from({ length: confettiCount }, (_, i) => {
      const left  = rand(0, 100);              // viewport %
      const drift = rand(-180, 180);           // horizontal drift in px
      const dur   = rand(2200, 3800);
      const delay = rand(0, 1200);
      const size  = rand(6, 12);
      const color = palette[Math.floor(Math.random() * palette.length)];
      const spin  = (Math.random() < 0.5 ? -1 : 1) * rand(360, 1080);
      const shape = ["circle", "square", "bar"][Math.floor(Math.random() * 3)];
      return { left, drift, dur, delay, size, color, spin, shape, key: i };
    });

    return { bursts, confetti };
  }, [tierColor, justLeveledUp]);

  return (
    <div className="fixed inset-0 z-[125] pointer-events-none overflow-hidden">
      {/* Tier-up only: a brief radial flash of the tier color across the
          whole viewport. Lasts ~600ms, then fades. */}
      {justLeveledUp && (
        <div
          className="absolute inset-0 celebration-screenflash"
          style={{
            background: `radial-gradient(circle at center, ${tierColor}55 0%, ${tierColor}00 55%)`,
          }}
        />
      )}

      {/* Shockwave rings — concentric pulses centered on the main burst. */}
      <div className="absolute" style={{ left: "50%", top: "42%" }}>
        {[0, 200, 400].map((delay) => (
          <span
            key={delay}
            className="celebration-shockwave"
            style={{
              borderColor: tierColor,
              boxShadow: `0 0 24px ${glowColor}`,
              animationDelay: `${delay}ms`,
            }}
          />
        ))}
      </div>

      {/* Particle bursts */}
      {data.bursts.map((burst) => (
        <div key={burst.id} className="absolute" style={{ left: burst.left, top: burst.top }}>
          {burst.particles.map((p) => (
            <span
              key={p.key}
              className="celebration-big-particle"
              style={{
                background: p.color,
                boxShadow: `0 0 12px ${p.color}aa`,
                width: p.size,
                height: p.size,
                ["--tx" as any]: `${p.tx}px`,
                ["--ty" as any]: `${p.ty}px`,
                ["--spin" as any]: `${p.spin}deg`,
                ["--dur" as any]: `${p.dur}ms`,
                animationDuration: `${p.dur}ms`,
                animationDelay: `${burst.delay + p.innerDelay}ms`,
              }}
            />
          ))}
        </div>
      ))}

      {/* Confetti storm — falls from above the viewport. */}
      {data.confetti.map((c) => (
        <span
          key={c.key}
          className={`celebration-confetti celebration-confetti-${c.shape}`}
          style={{
            left: `${c.left}vw`,
            background: c.color,
            width: c.size,
            height: c.shape === "bar" ? c.size * 0.4 : c.size,
            animationDuration: `${c.dur}ms`,
            animationDelay: `${c.delay}ms`,
            ["--drift" as any]: `${c.drift}px`,
            ["--spin" as any]: `${c.spin}deg`,
          }}
        />
      ))}

      <style>{`
        /* ───── Big-burst particles ─────────────────────────────────────── */
        @keyframes celebration-big-burst {
          0%   { transform: translate(0, 0) rotate(0deg) scale(0.4); opacity: 0; }
          12%  { transform: translate(0, 0) rotate(0deg) scale(1);   opacity: 1; }
          60%  {
            transform: translate(calc(var(--tx) * 0.85), calc(var(--ty) * 0.85)) rotate(calc(var(--spin) * 0.6)) scale(1);
            opacity: 1;
          }
          100% {
            transform: translate(var(--tx), calc(var(--ty) + 80px)) rotate(var(--spin)) scale(0.5);
            opacity: 0;
          }
        }
        .celebration-big-particle {
          position: absolute;
          top: 0; left: 0;
          border-radius: 9999px;
          animation-name: celebration-big-burst;
          animation-timing-function: cubic-bezier(0.18, 0.7, 0.3, 1);
          animation-fill-mode: forwards;
          will-change: transform, opacity;
        }

        /* ───── Shockwave rings ────────────────────────────────────────── */
        @keyframes celebration-shockwave {
          0%   { width: 20px;  height: 20px;  opacity: 0.9; border-width: 4px; }
          100% { width: 900px; height: 900px; opacity: 0;   border-width: 1px; }
        }
        .celebration-shockwave {
          position: absolute;
          left: 50%; top: 50%;
          translate: -50% -50%;
          border-radius: 9999px;
          border: 4px solid;
          animation: celebration-shockwave 1400ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
          will-change: width, height, opacity;
        }

        /* ───── Confetti rain ──────────────────────────────────────────── */
        @keyframes celebration-confetti-fall {
          0%   { transform: translate(0, -60px) rotate(0deg);              opacity: 0; }
          10%  { opacity: 1; }
          100% { transform: translate(var(--drift), 110vh) rotate(var(--spin)); opacity: 0.9; }
        }
        .celebration-confetti {
          position: absolute;
          top: 0;
          animation-name: celebration-confetti-fall;
          animation-timing-function: cubic-bezier(0.35, 0.05, 0.85, 0.95);
          animation-fill-mode: forwards;
          will-change: transform, opacity;
        }
        .celebration-confetti-circle { border-radius: 9999px; }
        .celebration-confetti-square { border-radius: 2px; }
        .celebration-confetti-bar    { border-radius: 1px; }

        /* ───── Tier-up screen flash ───────────────────────────────────── */
        @keyframes celebration-screenflash {
          0%   { opacity: 0;    }
          15%  { opacity: 1;    }
          100% { opacity: 0;    }
        }
        .celebration-screenflash {
          animation: celebration-screenflash 900ms ease-out forwards;
        }
      `}</style>
    </div>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────────

export function CelebrationModal({ prevCount, newCount, onClose, onFindMore }: CelebrationModalProps) {
  const copy = useMemo(() => celebrationCopy(prevCount, newCount), [prevCount, newCount]);
  const displayedCount = useCountUp(newCount, copy.justLeveledUp ? 1100 : 650);

  // Auto-dismiss after 8s so a tab left open doesn't trap the UI behind a
  // celebration. User can always click "Find another" or X earlier.
  useEffect(() => {
    const t = window.setTimeout(onClose, 8000);
    return () => window.clearTimeout(t);
  }, [onClose]);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { tier, nextTier, actionsToNext, justLeveledUp } = copy;

  // Progress within the current tier.
  const tierMin   = tier.min;
  const tierRange = (nextTier ? nextTier.min : tierMin + 1) - tierMin;
  const filled    = Math.max(0, Math.min(1, (newCount - tierMin) / tierRange));

  // Pull bold spans out of the nextLine markup-lite (we use **x**).
  const nextLineParts = copy.nextLine.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) =>
    chunk.startsWith("**") ? (
      <strong key={i} className="font-bold text-[#23297e]">{chunk.replace(/\*\*/g, "")}</strong>
    ) : (
      <span key={i}>{chunk}</span>
    )
  );

  return (
    <>
      {/* Viewport-wide explosion — rendered as a sibling so particles + confetti
          bleed past the modal edges. z-[115] sits between the modal backdrop
          (z-[120]) and the page (z < 100) so the modal itself stays clickable. */}
      <ExplosiveFireworks
        tierColor={tier.color}
        glowColor={tier.glowColor}
        justLeveledUp={justLeveledUp}
      />

      <div
        className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/45"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label="Action complete"
      >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-[130] bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
        style={{
          // Subtle radial halo behind the content tied to the tier color.
          background: `radial-gradient(circle at center top, ${tier.color}14, white 65%)`,
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
        >
          <X size={16} strokeWidth={2.5} />
        </button>

        {/* Hero — tier badge with the compact burst right behind it */}
        <div className="relative h-[200px] flex items-center justify-center">
          <HeroBurst tierColor={tier.color} glowColor={tier.glowColor} />
          <div className="relative z-[1]">
            <div
              className={`flex items-center justify-center w-24 h-24 rounded-full shadow-2xl ${
                justLeveledUp ? "celebration-pulse" : "celebration-pop"
              }`}
              style={{
                background: tier.color,
                boxShadow: `0 0 0 6px white, 0 12px 36px ${tier.glowColor}99`,
              }}
            >
              <TierIcon tier={tier} size={48} />
            </div>
          </div>
          <style>{`
            @keyframes celebration-pop {
              0%   { transform: scale(0.4); opacity: 0; }
              60%  { transform: scale(1.12); opacity: 1; }
              100% { transform: scale(1); }
            }
            @keyframes celebration-pulse {
              0%   { transform: scale(0.3); opacity: 0; }
              45%  { transform: scale(1.2);  opacity: 1; }
              60%  { transform: scale(0.95); }
              75%  { transform: scale(1.08); }
              100% { transform: scale(1); }
            }
            .celebration-pop   { animation: celebration-pop   750ms cubic-bezier(0.22,1,0.36,1) forwards; }
            .celebration-pulse { animation: celebration-pulse 1200ms cubic-bezier(0.22,1,0.36,1) forwards; }
          `}</style>
        </div>

        {/* Headline + count */}
        <div className="px-6 pb-1 text-center">
          {justLeveledUp && (
            <p
              className="font-['Poppins',sans-serif] font-extrabold text-[11px] uppercase tracking-[0.18em] mb-1"
              style={{ color: tier.color }}
            >
              ✨ Level up ✨
            </p>
          )}
          <h2 className="font-['Poppins',sans-serif] font-extrabold text-[#23297e] text-xl leading-tight">
            {copy.headline}
          </h2>
          {copy.kicker && (
            <p className="font-['Poppins',sans-serif] text-sm text-gray-600 mt-1 italic">
              {copy.kicker}
            </p>
          )}

          {/* Big number — the new total */}
          <div className="mt-3 flex items-baseline justify-center gap-2">
            <span className="font-['Poppins',sans-serif] font-extrabold text-5xl tabular-nums" style={{ color: tier.color }}>
              {displayedCount}
            </span>
            <span className="font-['Poppins',sans-serif] text-sm text-gray-500">
              {displayedCount === 1 ? "action total" : "actions total"}
            </span>
          </div>
        </div>

        {/* Progress to next tier */}
        <div className="px-6 mt-4">
          <div className="flex items-center justify-between text-[10.5px] font-['Poppins',sans-serif] uppercase tracking-wider font-semibold mb-1.5">
            <span style={{ color: tier.color }}>{tier.name}</span>
            {nextTier ? (
              <span className="text-gray-400">{nextTier.name}</span>
            ) : (
              <span className="text-gray-400">Top tier</span>
            )}
          </div>
          <div className="relative h-2.5 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-1000 ease-out"
              style={{
                width: `${filled * 100}%`,
                background: `linear-gradient(90deg, ${tier.color}, ${nextTier?.color ?? tier.color})`,
              }}
            />
          </div>

          <p className="mt-3 font-['Poppins',sans-serif] text-sm text-gray-700 text-center leading-snug">
            {nextLineParts}
          </p>
        </div>

        {/* CTAs */}
        <div className="px-6 pt-4 pb-5 flex items-center gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2.5 rounded-xl font-['Poppins',sans-serif] font-semibold text-sm text-gray-600 hover:bg-gray-100 transition-colors"
          >
            Close
          </button>
          <button
            onClick={() => { onFindMore(); onClose(); }}
            className="flex-[1.6] flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl font-['Poppins',sans-serif] font-bold text-sm text-white shadow-md hover:shadow-lg transition-all"
            style={{ background: "#fd8e33" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#e07a28")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#fd8e33")}
          >
            {actionsToNext === 1 ? "One more →" : "Find another action"}
            <ArrowRight size={14} strokeWidth={2.5} />
          </button>
        </div>
      </div>
      </div>
    </>
  );
}
