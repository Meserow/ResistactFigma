import { HeroPills } from "./HeroPills";
import { HeroLogoReveal } from "./HeroLogoReveal";

interface HomeHeroProps {
  onMatchClick?: () => void;
  onAskClick?: () => void;
  onHowClick?: () => void;
  onBookmarksClick?: () => void;
  bookmarkCount?: number;
  onSwipeClick?: () => void;
}

export function HomeHero({ onMatchClick, onAskClick, onHowClick, onBookmarksClick, bookmarkCount, onSwipeClick }: HomeHeroProps) {
  return (
    // Hidden on phones: the top bar already shows the ResistAct logo, so this
    // centered hero logo is redundant there (its only phone content). Desktop
    // keeps the full animated reveal + pills.
    <div className="hero-collapsing bg-white relative overflow-hidden border-b border-[#f0e8de] hidden md:block">
      <div className="relative z-10 max-w-[880px] mx-auto px-5 pt-1 pb-2 text-center">
        <HeroLogoReveal />

        <div className="mt-2.5 md:mt-4 mb-0">
          <HeroPills onMatchClick={onMatchClick} onAskClick={onAskClick} onHowClick={onHowClick} onBookmarksClick={onBookmarksClick} bookmarkCount={bookmarkCount} onSwipeClick={onSwipeClick} />
        </div>
      </div>
    </div>
  );
}
