import { useState } from "react";
import { HeroPills } from "./HeroPills";
import { HeroLogoReveal } from "./HeroLogoReveal";
import { prefersReducedMotion } from "../lib/animations";

interface LoggedInHeroProps {
  userId: string;
  name: string;
  streak: number;
  onMatchClick?: () => void;
  onAskClick?: () => void;
  onHowClick?: () => void;
  hasMatchPrefs?: boolean;
}

export function LoggedInHero({ name, streak, onMatchClick, onAskClick, onHowClick, hasMatchPrefs }: LoggedInHeroProps) {
  const firstName = name.split(/\s+/)[0] || name;
  const greeting = streak <= 1 ? "Welcome to the resistance" : "Welcome back to the resistance";
  // The "N new actions today" line moved to the persistent footer (next to
  // the total acts count) so the hero stays focused on the greeting + streak.
  const showStreakFlame = streak >= 7;
  // Hold the greeting back until the shared intro animation resolves to the
  // logo, so the villains line doesn't show stacked above "Welcome back".
  const [revealed, setRevealed] = useState(() => prefersReducedMotion());

  return (
    <div className="hero-collapsing bg-gradient-to-b from-white to-[#faf6f0] border-b border-[#f0e8de]">
      <div className="max-w-[880px] mx-auto px-5 pt-2 pb-3 text-center">
        <div className="mb-2">
          <HeroLogoReveal onResolved={() => setRevealed(true)} />
        </div>
        <p
          className={`font-['Poppins',sans-serif] text-[#23297e] text-[14px] md:text-[17px] font-bold leading-[1.2] m-0 transition-opacity duration-500 ${revealed ? "opacity-100" : "opacity-0"}`}
        >
          {greeting}, {firstName}.{" "}
          <em className="italic font-semibold text-[#ed6624]">
            {showStreakFlame && (
              <span className="resistact-anim-flicker mr-1" aria-hidden title={`${streak}-day streak — keep it lit!`}>🔥</span>
            )}
            Day {streak}.
          </em>
        </p>

        <div className="mt-4">
          <HeroPills onMatchClick={onMatchClick} onAskClick={onAskClick} onHowClick={onHowClick} hasMatchPrefs={hasMatchPrefs} />
        </div>
      </div>
    </div>
  );
}
