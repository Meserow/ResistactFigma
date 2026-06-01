import { HeroPills } from "./HeroPills";
import { HeroLogoReveal } from "./HeroLogoReveal";

interface HomeHeroProps {
  onMatchClick?: () => void;
  onAskClick?: () => void;
  onHowClick?: () => void;
}

export function HomeHero({ onMatchClick, onAskClick, onHowClick }: HomeHeroProps) {
  return (
    <div className="hero-collapsing bg-white relative overflow-hidden border-b border-[#f0e8de]">
      <div className="relative z-10 max-w-[880px] mx-auto px-5 pt-1 pb-2 text-center">
        <HeroLogoReveal />

        <div className="mt-2.5 md:mt-4 mb-0">
          <HeroPills onMatchClick={onMatchClick} onAskClick={onAskClick} onHowClick={onHowClick} />
        </div>
      </div>
    </div>
  );
}
