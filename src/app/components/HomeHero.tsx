import { useEffect, useState } from "react";
import logoImg from "../../assets/resistact-logo-horizontal.webp";
import { HeroPills } from "./HeroPills";
import { prefersReducedMotion } from "../lib/animations";

interface HomeHeroProps {
  onMatchClick?: () => void;
  onAskClick?: () => void;
  onHowClick?: () => void;
}

// Three-phase hero reveal (no loop).
//   Phase 0: dark line fades in alone:
//            "America is being run by cartoon villains. MAGA is nuts."
//   Phase 1: dark line stays put; orange handwritten "But what can one
//            person do?" slides in from the left, slightly tilted, below.
//   Phase 2: both lines are replaced by the ResistAct logo, which pops in.
const PHASE_DURATIONS_MS = [1500, 2400];

export function HomeHero({ onMatchClick, onAskClick, onHowClick }: HomeHeroProps) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setPhase(2);
      return;
    }
    if (phase >= 2) return;
    const id = window.setTimeout(
      () => setPhase((p) => p + 1),
      PHASE_DURATIONS_MS[phase],
    );
    return () => window.clearTimeout(id);
  }, [phase]);

  return (
    <div className="bg-white relative overflow-hidden border-b border-[#f0e8de]">
      <div className="relative z-10 max-w-[880px] mx-auto px-5 pt-1 pb-2 text-center">
        <div className="flex items-center justify-center">
          {phase < 2 && (
            <div key="text" className="py-1">
              <h1 className="hero-line-fade-in font-['Poppins',sans-serif] text-[#2a2a2a] text-[14px] md:text-[17px] font-bold leading-[1.2]">
                America is being run by cartoon villains. MAGA is nuts.
              </h1>
              {phase >= 1 && (
                <p
                  key="orange"
                  className="hero-orange-slide-in font-['Rock_Salt',cursive] not-italic font-bold text-[#ed6624] text-[17px] md:text-[22px] leading-none mt-2 md:mt-3"
                  style={{ WebkitTextStroke: "1.25px #ed6624", paintOrder: "stroke fill" }}
                >
                  But what can one person do?
                </p>
              )}
            </div>
          )}
          {phase >= 2 && (
            <div key="logo" className="hero-logo-pop">
              <img
                src={logoImg}
                alt="ResistAct"
                className="h-[68px] md:h-[95px] w-auto block"
              />
            </div>
          )}
        </div>

        <div className="mt-4 mb-0">
          <HeroPills onMatchClick={onMatchClick} onAskClick={onAskClick} onHowClick={onHowClick} />
        </div>
      </div>

      <style>{`
        @keyframes hero-line-fade-in {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes hero-orange-slide-in {
          0%   { opacity: 0; transform: translateX(-120%) rotate(-6deg); }
          70%  { opacity: 1; transform: translateX(2%) rotate(-2deg); }
          100% { opacity: 1; transform: translateX(0) rotate(-3deg); }
        }
        @keyframes hero-logo-pop {
          0%   { opacity: 0; transform: scale(0.6); }
          60%  { opacity: 1; transform: scale(1.08); }
          100% { opacity: 1; transform: scale(1); }
        }
        .hero-line-fade-in {
          animation: hero-line-fade-in 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .hero-orange-slide-in {
          animation: hero-orange-slide-in 700ms cubic-bezier(0.22, 1, 0.36, 1) both;
          transform-origin: center;
          display: inline-block;
        }
        .hero-logo-pop {
          animation: hero-logo-pop 520ms cubic-bezier(0.22, 1.6, 0.36, 1) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .hero-line-fade-in,
          .hero-orange-slide-in,
          .hero-logo-pop { animation: none; }
        }
      `}</style>
    </div>
  );
}
