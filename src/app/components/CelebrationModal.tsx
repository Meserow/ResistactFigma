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
// Renders OUTSIDE the modal so it spans the full viewport.
// Regular completion: one salvo of bursts + light confetti.
// Tier-up: THREE salvos (waves), massive confetti storm (400+ pieces), eight
//          shockwave rings, three rapid screen-color pulses, star confetti.
//          Aims for "I just won the championship" energy.
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
      "#F59E0B", "#06B6D4", "#FF6B6B",
      tierColor,
    ];

    // Regular burst origins — 6 origins scattered across the viewport.
    const regularOrigins = [
      { left: "50%", top: "44%", delay: 0,   color: tierColor,  count: 80 },
      { left: "20%", top: "28%", delay: 180, color: palette[0], count: 64 },
      { left: "80%", top: "28%", delay: 320, color: palette[3], count: 64 },
      { left: "12%", top: "58%", delay: 480, color: palette[2], count: 52 },
      { left: "88%", top: "58%", delay: 620, color: palette[5], count: 52 },
      { left: "50%", top: "14%", delay: 780, color: palette[1], count: 48 },
    ];

    // Tier-up burst origins — 14 origins across 3 waves.
    const tierUpOrigins = [
      // wave 1 (0–740ms)
      { left:"50%", top:"45%", delay:0,    color:tierColor,  count:80 },
      { left:"18%", top:"28%", delay:200,  color:palette[0], count:52 },
      { left:"82%", top:"28%", delay:380,  color:palette[3], count:52 },
      { left:"12%", top:"68%", delay:560,  color:palette[2], count:44 },
      { left:"88%", top:"68%", delay:740,  color:palette[5], count:44 },
      // wave 2 (1700–2500ms)
      { left:"32%", top:"18%", delay:1700, color:palette[6], count:64 },
      { left:"68%", top:"18%", delay:1900, color:palette[7], count:64 },
      { left:"50%", top:"75%", delay:2100, color:palette[8], count:56 },
      { left:"8%",  top:"48%", delay:2300, color:palette[9], count:48 },
      { left:"92%", top:"48%", delay:2500, color:palette[1], count:48 },
      // wave 3 — grand finale (3300–3950ms)
      { left:"50%", top:"42%", delay:3300, color:tierColor,   count:96 },
      { left:"25%", top:"50%", delay:3550, color:palette[0],  count:68 },
      { left:"75%", top:"50%", delay:3750, color:palette[3],  count:68 },
      { left:"50%", top:"12%", delay:3950, color:palette[10], count:60 },
    ];

    const burstOrigins = justLeveledUp ? tierUpOrigins : regularOrigins;
    const maxDist = justLeveledUp ? 860 : 520;

    const bursts = burstOrigins.map((o, bi) => ({
      ...o,
      id: bi,
      // Launch streak — a thin bright line that streaks UP from below the
      // viewport to the burst origin, arriving right when the explosion
      // fires. The "rocket trail" before the boom.
      launchFromVh: rand(45, 75),
      particles: Array.from({ length: o.count }, (_, i) => {
        const angle    = (i / o.count) * 360 + rand(-9, 9);
        const distance = rand(260, maxDist);
        const tx = Math.cos((angle * Math.PI) / 180) * distance;
        // Slight upward bias before gravity kicks in — feels like a real
        // firework that rises slightly before arcing down.
        const ty = Math.sin((angle * Math.PI) / 180) * distance - rand(50, 160);
        const size = rand(justLeveledUp ? 8 : 6, justLeveledUp ? 18 : 14);
        const color = palette[Math.floor(Math.random() * palette.length)];
        const dur = rand(justLeveledUp ? 1700 : 1400, justLeveledUp ? 2800 : 2200);
        const innerDelay = rand(0, 300);
        const spin = (Math.random() < 0.5 ? -1 : 1) * rand(180, 1080);
        // ~18% of particles are "sparklers" that twinkle on/off as they fall.
        const sparkler = Math.random() < 0.18;
        return { tx, ty, size, color, dur, innerDelay, spin, sparkler, key: `${bi}-${i}` };
      }),
    }));

    // Confetti rain — falls from above the viewport, drifts sideways. More
    // pieces (and longer fall) on tier-up.
    const confettiCount = justLeveledUp ? 450 : 80;
    const shapes = justLeveledUp
      ? ["circle","square","bar","star","star","star","circle","square"]
      : ["circle","square","bar"];
    const confetti = Array.from({ length: confettiCount }, (_, i) => {
      const left  = rand(0, 100);              // viewport %
      const drift = rand(-260, 260);           // horizontal drift in px
      const dur   = rand(justLeveledUp ? 2800 : 2200, justLeveledUp ? 6500 : 3800);
      const delay = rand(0, justLeveledUp ? 4500 : 1200);
      const size  = rand(justLeveledUp ? 24 : 6, justLeveledUp ? 54 : 12);
      const color = palette[Math.floor(Math.random() * palette.length)];
      const spin  = (Math.random() < 0.5 ? -1 : 1) * rand(360, 1080);
      const shape = shapes[Math.floor(Math.random() * shapes.length)];
      return { left, drift, dur, delay, size, color, spin, shape, key: i };
    });

    return { bursts, confetti };
  }, [tierColor, justLeveledUp]);

  // Shockwave delays — 9 rings for tier-up, 3 for regular.
  const shockwaveDelays = justLeveledUp
    ? [0, 160, 320, 480, 1750, 1920, 2090, 3380, 3560]
    : [0, 200, 400];

  return (
    <div className="fixed inset-0 z-[125] pointer-events-none overflow-hidden">
      {/* Tier-up only: THREE rapid color pulses */}
      {justLeveledUp && [0, 320, 640].map((d, i) => (
        <div
          key={i}
          className="absolute inset-0 celebration-screenflash"
          style={{
            background: `radial-gradient(circle at center, ${tierColor}70 0%, ${tierColor}00 60%)`,
            animationDelay: `${d}ms`,
          }}
        />
      ))}

      {/* Shockwave rings — concentric pulses centered on the main burst. */}
      <div className="absolute" style={{ left: "50%", top: "44%" }}>
        {shockwaveDelays.map((delay, idx) => (
          <span
            key={delay}
            className="celebration-shockwave"
            style={{
              borderColor: idx % 2 === 0 ? tierColor : glowColor,
              boxShadow: `0 0 24px ${glowColor}`,
              animationDelay: `${delay}ms`,
            }}
          />
        ))}
      </div>

      {/* Launch streaks — a bright vertical streak rises from below the viewport
          to each burst origin, arriving the instant the burst fires. This is
          the "rocket trail" of a real firework, the bit before the boom. */}
      {data.bursts.map((burst) => (
        <span
          key={`launch-${burst.id}`}
          className="celebration-launch"
          style={{
            left: burst.left,
            top: burst.top,
            background: `linear-gradient(to top, transparent, ${burst.color} 70%, #ffffff)`,
            boxShadow: `0 0 12px ${burst.color}, 0 0 24px ${burst.color}66`,
            animationDelay: `${Math.max(0, burst.delay - 280)}ms`,
            ["--launch-h" as any]: `${burst.launchFromVh}vh`,
          }}
        />
      ))}

      {/* Particle bursts — each particle has a luminous multi-shadow glow
          so it reads as "burning ember" not "colored dot." */}
      {data.bursts.map((burst) => (
        <div key={burst.id} className="absolute" style={{ left: burst.left, top: burst.top }}>
          {burst.particles.map((p) => (
            <span
              key={p.key}
              className={p.sparkler ? "celebration-big-particle celebration-sparkler" : "celebration-big-particle"}
              style={{
                background: p.color,
                // Layered glow — a tight inner halo, a wider soft halo, and a
                // big diffuse tier-color wash to read as luminous, not flat.
                boxShadow: `
                  0 0 4px #ffffff,
                  0 0 ${justLeveledUp ? 18 : 12}px ${p.color}cc,
                  0 0 22px ${p.color}aa,
                  0 0 40px ${p.color}55
                `,
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
        /* ───── Big-burst particles — gravity arc ────────────────────────
           Real fireworks rise to their burst apex, expand outward as the
           shell explodes, hang in the air for a moment, then drift DOWN
           under gravity while fading. Our keyframes model that:
            - 0–8%   : pre-burst flash (small, bright)
            - 8–20%  : initial blast (full size + brightness at near-origin)
            - 20–55% : rapid outward expansion toward (tx, ty)
            - 55–75% : hang time at the outer position
            - 75–100%: gravity drop (+ extra y) while fading + shrinking */
        @keyframes celebration-big-burst {
          0%   {
            transform: translate(0, 0) rotate(0deg) scale(0.2);
            opacity: 0;
          }
          8%   {
            transform: translate(0, 0) rotate(0deg) scale(1.4);
            opacity: 1;
          }
          20%  {
            transform: translate(calc(var(--tx) * 0.4), calc(var(--ty) * 0.4)) rotate(calc(var(--spin) * 0.25)) scale(1.1);
            opacity: 1;
          }
          55%  {
            transform: translate(var(--tx), var(--ty)) rotate(calc(var(--spin) * 0.65)) scale(1);
            opacity: 1;
          }
          75%  {
            transform: translate(var(--tx), calc(var(--ty) + 60px)) rotate(calc(var(--spin) * 0.8)) scale(0.85);
            opacity: 0.85;
          }
          100% {
            transform: translate(calc(var(--tx) * 1.05), calc(var(--ty) + 220px)) rotate(var(--spin)) scale(0.35);
            opacity: 0;
          }
        }
        .celebration-big-particle {
          position: absolute;
          top: 0; left: 0;
          border-radius: 9999px;
          animation-name: celebration-big-burst;
          animation-timing-function: cubic-bezier(0.16, 0.66, 0.32, 1);
          animation-fill-mode: forwards;
          will-change: transform, opacity;
        }

        /* ───── Sparkler particles — twinkle on/off while traveling ───── */
        @keyframes celebration-twinkle {
          0%, 100% { opacity: 1;   filter: brightness(1);   }
          50%      { opacity: 0.3; filter: brightness(2.4); }
        }
        .celebration-sparkler {
          animation:
            celebration-big-burst var(--dur) cubic-bezier(0.16, 0.66, 0.32, 1) forwards,
            celebration-twinkle 240ms ease-in-out infinite;
        }

        /* ───── Launch streak — vertical rocket trail before each burst ─
           A thin bright vertical line that streaks up from below the
           viewport to the burst origin, ending right when the burst fires. */
        @keyframes celebration-launch {
          0%   {
            transform: translate(-50%, 100vh) scaleY(0.15);
            opacity: 0;
          }
          15%  { opacity: 1; }
          85%  { opacity: 1; }
          100% {
            transform: translate(-50%, 0) scaleY(1);
            opacity: 0;
          }
        }
        .celebration-launch {
          position: absolute;
          width: 3px;
          height: var(--launch-h, 60vh);
          transform-origin: bottom center;
          border-radius: 999px;
          animation: celebration-launch 360ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
          will-change: transform, opacity;
          pointer-events: none;
        }

        /* ───── Shockwave rings ────────────────────────────────────────── */
        @keyframes celebration-shockwave {
          0%   { width: 20px;   height: 20px;   opacity: 0.9; border-width: 4px; }
          100% { width: 1400px; height: 1400px; opacity: 0;   border-width: 1px; }
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
        .celebration-confetti-star {
          clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%);
        }

        /* ───── Tier-up screen flash ───────────────────────────────────── */
        @keyframes celebration-screenflash {
          0%   { opacity: 0;    }
          18%  { opacity: 1;    }
          100% { opacity: 0;    }
        }
        .celebration-screenflash {
          animation: celebration-screenflash 650ms ease-out forwards;
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
        className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/65"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label="Action complete"
      >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-[130] rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
        style={{
          // Solid white base so the modal is fully opaque — the shorthand
          // `background:` previously overrode the bg-white class and left
          // the center see-through. Now we set color and image separately.
          backgroundColor: "#ffffff",
          backgroundImage: `radial-gradient(circle at center top, ${tier.color}22, transparent 70%)`,
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
