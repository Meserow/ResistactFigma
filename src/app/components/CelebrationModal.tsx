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
import { getUserTier } from "../lib/tiers";
import { TierIcon } from "./TierBadge";

interface CelebrationModalProps {
  prevCount: number;
  newCount: number;
  onClose: () => void;
  /** Optional — no longer used by the simplified modal, kept so existing
   * call sites still type-check. */
  onFindMore?: () => void;
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
    nextLine = `Just **1 more** action and you're ${/^[aeiou]/i.test(nextTier.name) ? "an" : "a"} ${nextTier.name}.`;
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

// ─── Inline emphasis — renders `**bold**` segments from the copy strings ─────
// Copy like "**3 more** to Flame" carries the count we most want to pop; bold
// (and tint) those segments so the "how far to go" number reads at a glance.
function renderEmphasis(text: string, accent: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((seg, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-extrabold" style={{ color: accent }}>
        {seg}
      </strong>
    ) : (
      <span key={i}>{seg}</span>
    )
  );
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
  const ringColors = ["#ed6624", "#23297e", tierColor];
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
      "#ed6624", "#23297e", "#FCD34D", "#EF4444",
      "#10B981", "#3B82F6", "#A855F7", "#EC4899",
      "#F59E0B", "#06B6D4", "#FF6B6B",
      tierColor,
    ];

    // Regular burst — a single gentle pop near center.
    const regularOrigins = [
      { left: "50%", top: "42%", delay: 0,   color: tierColor,  count: 26 },
      { left: "28%", top: "34%", delay: 140, color: palette[0], count: 18 },
      { left: "72%", top: "34%", delay: 260, color: palette[5], count: 18 },
    ];

    // Tier-up burst — slightly fuller, still one calm wave (no storm).
    const tierUpOrigins = [
      { left: "50%", top: "42%", delay: 0,   color: tierColor,  count: 38 },
      { left: "24%", top: "30%", delay: 150, color: palette[0], count: 26 },
      { left: "76%", top: "30%", delay: 280, color: palette[3], count: 26 },
      { left: "36%", top: "58%", delay: 420, color: palette[2], count: 20 },
      { left: "64%", top: "58%", delay: 540, color: palette[5], count: 20 },
    ];

    const burstOrigins = justLeveledUp ? tierUpOrigins : regularOrigins;
    const maxDist = justLeveledUp ? 460 : 340;

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
    const confettiCount = justLeveledUp ? 80 : 34;
    const shapes = justLeveledUp
      ? ["circle","square","star","circle","square"]
      : ["circle","square","bar"];
    const confetti = Array.from({ length: confettiCount }, (_, i) => {
      const left  = rand(0, 100);              // viewport %
      const drift = rand(-150, 150);           // horizontal drift in px
      const dur   = rand(justLeveledUp ? 2600 : 2200, justLeveledUp ? 4200 : 3400);
      const delay = rand(0, justLeveledUp ? 1300 : 800);
      const size  = rand(justLeveledUp ? 9 : 6, justLeveledUp ? 18 : 12);
      const color = palette[Math.floor(Math.random() * palette.length)];
      const spin  = (Math.random() < 0.5 ? -1 : 1) * rand(360, 1080);
      const shape = shapes[Math.floor(Math.random() * shapes.length)];
      return { left, drift, dur, delay, size, color, spin, shape, key: i };
    });

    return { bursts, confetti };
  }, [tierColor, justLeveledUp]);

  // Shockwave delays — kept minimal so the moment stays calm.
  const shockwaveDelays = justLeveledUp ? [0, 220] : [0];

  return (
    <div className="fixed inset-0 z-[125] pointer-events-none overflow-hidden">
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

export function CelebrationModal({ prevCount, newCount, onClose }: CelebrationModalProps) {
  const copy = useMemo(() => celebrationCopy(prevCount, newCount), [prevCount, newCount]);
  const displayedCount = useCountUp(newCount, copy.justLeveledUp ? 1100 : 650);

  // Self-dismissing: a brief beat to register the win, then it closes on its
  // own. Tier-ups linger a little longer so the bigger celebration can play.
  // Tap-outside and Esc still close it sooner.
  useEffect(() => {
    const t = window.setTimeout(onClose, copy.justLeveledUp ? 3200 : 2000);
    return () => window.clearTimeout(t);
  }, [onClose, copy.justLeveledUp]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { tier, justLeveledUp } = copy;

  return (
    <>
      {/* Viewport-wide explosion — rendered as a sibling so particles + confetti
          bleed past the modal edges. */}
      <ExplosiveFireworks
        tierColor={tier.color}
        glowColor={tier.glowColor}
        justLeveledUp={justLeveledUp}
      />

      {/* No white card — the badge, headline and count float on a softly
          dimmed backdrop so it reads as a graceful "moment" over the page,
          not a second modal stacked on the card behind it. */}
      <div
        className="fixed inset-0 z-[120] flex flex-col items-center justify-center p-6 text-center bg-black/75"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label="Action complete"
      >
        <div onClick={(e) => e.stopPropagation()} className="relative z-[130] flex flex-col items-center">
          {/* Tier badge with the compact burst right behind it */}
          <div className="relative flex items-center justify-center mb-5">
            <HeroBurst tierColor={tier.color} glowColor={tier.glowColor} />
            <div
              className={`relative z-[1] flex items-center justify-center w-20 h-20 rounded-full ${
                justLeveledUp ? "celebration-pulse" : "celebration-pop"
              }`}
              style={{
                background: tier.color,
                boxShadow: `0 0 0 4px rgba(255,255,255,0.14), 0 14px 44px ${tier.glowColor}66`,
              }}
            >
              <TierIcon tier={tier} size={40} />
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

          {/* Headline + count — light type for legibility on the dark backdrop. */}
          {justLeveledUp && (
            <p
              className="font-['Poppins',sans-serif] font-extrabold text-[11px] uppercase tracking-[0.18em] mb-1.5"
              style={{ color: tier.glowColor }}
            >
              ✨ Level up ✨
            </p>
          )}
          <h2 className="font-['Poppins',sans-serif] font-extrabold text-white text-2xl leading-tight drop-shadow">
            {copy.headline}
          </h2>
          <div className="mt-3 flex items-baseline justify-center gap-2">
            <span className="font-['Poppins',sans-serif] font-extrabold text-5xl tabular-nums" style={{ color: tier.glowColor }}>
              {displayedCount}
            </span>
            <span className="font-['Poppins',sans-serif] text-sm text-white/70">
              {displayedCount === 1 ? "action total" : "actions total"}
            </span>
          </div>

          {/* How far to the next tier — the whole point of the moment is to
              make the next rung feel close and concrete. */}
          <p className="mt-3 max-w-[18rem] font-['Poppins',sans-serif] text-sm leading-snug text-white/85">
            {renderEmphasis(copy.nextLine, tier.glowColor)}
          </p>
        </div>
      </div>
    </>
  );
}
