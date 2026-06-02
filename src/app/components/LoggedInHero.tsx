import { useState, useEffect } from "react";
import { HeroPills } from "./HeroPills";
import { HeroLogoReveal } from "./HeroLogoReveal";
import { useIsMobile } from "./ui/use-mobile";
import { prefersReducedMotion } from "../lib/animations";

interface LoggedInHeroProps {
  userId: string;
  name: string;
  streak: number;
  onMatchClick?: () => void;
  onAskClick?: () => void;
  onHowClick?: () => void;
  hasMatchPrefs?: boolean;
  onBookmarksClick?: () => void;
  bookmarkCount?: number;
  onSwipeClick?: () => void;
}

export function LoggedInHero({ name, streak, onMatchClick, onAskClick, onHowClick, hasMatchPrefs, onBookmarksClick, bookmarkCount, onSwipeClick }: LoggedInHeroProps) {
  const firstName = name.split(/\s+/)[0] || name;
  const greeting = streak <= 1 ? "Welcome to the resistance" : "Welcome back to the resistance";
  // The "N new actions today" line moved to the persistent footer (next to
  // the total acts count) so the hero stays focused on the greeting + streak.
  const showStreakFlame = streak >= 7;
  // Hold the greeting back until the shared intro animation resolves to the
  // logo, so the villains line doesn't show stacked above "Welcome back".
  const isMobile = useIsMobile();
  const [revealed, setRevealed] = useState(() => prefersReducedMotion());
  // On phones the logo reveal is hidden (redundant with the top-bar logo), so
  // show the greeting right away instead of waiting on an animation no one sees.
  useEffect(() => { if (isMobile) setRevealed(true); }, [isMobile]);

  return (
    <div className="hero-collapsing bg-gradient-to-b from-white to-[#faf6f0] border-b border-[#f0e8de]">
      <div className="max-w-[880px] mx-auto px-5 pt-2 pb-3 text-center">
        {/* Logo reveal hidden on phones (top bar already shows the logo). */}
        <div className="mb-2 hidden md:block">
          <HeroLogoReveal onResolved={() => setRevealed(true)} />
        </div>
        <p
          className={`font-['Poppins',sans-serif] text-[#23297e] text-[14px] md:text-[17px] font-bold leading-[1.2] m-0 transition-opacity duration-500 ${revealed || isMobile ? "opacity-100" : "opacity-0"}`}
        >
          {greeting}, {firstName}.{" "}
          <em className="italic font-semibold text-[#ed6624]">
            {showStreakFlame && (
              <span className="resistact-anim-flicker mr-1" aria-hidden title={`${streak}-day streak — keep it lit!`}>🔥</span>
            )}
            Day {streak}.
          </em>
        </p>

        {/* Pills live in the hamburger menu on phones, so this wrapper (and its
            top margin) would just leave an empty gap under the greeting — hide
            it below md. */}
        <div className="mt-4 hidden md:block">
          <HeroPills onMatchClick={onMatchClick} onAskClick={onAskClick} onHowClick={onHowClick} hasMatchPrefs={hasMatchPrefs} onBookmarksClick={onBookmarksClick} bookmarkCount={bookmarkCount} onSwipeClick={onSwipeClick} />
        </div>
      </div>
    </div>
  );
}
