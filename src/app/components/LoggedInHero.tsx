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
  // The greeting + streak moved to the persistent bottom footer (App.tsx).
  // This hero is now just the logo reveal + the quick-action pills.
  const isMobile = useIsMobile();
  const [revealed, setRevealed] = useState(() => prefersReducedMotion());
  // On phones the logo reveal is hidden (redundant with the top-bar logo), so
  // show the greeting right away instead of waiting on an animation no one sees.
  useEffect(() => { if (isMobile) setRevealed(true); }, [isMobile]);

  return (
    <div className="hero-collapsing bg-gradient-to-b from-white to-[#faf6f0] border-b border-[#f0e8de]">
      <div className="max-w-[880px] mx-auto px-5 pt-2 pb-3 text-center">
        {/* Logo reveal hidden on phones (top bar already shows the logo). The
            personalized greeting + streak now lives in the persistent bottom
            footer (see App.tsx), not here. */}
        <div className="mb-2 hidden md:block">
          <HeroLogoReveal onResolved={() => setRevealed(true)} />
        </div>

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
