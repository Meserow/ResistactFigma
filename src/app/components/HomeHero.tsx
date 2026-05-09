import { HeroPills } from "./HeroPills";

interface HomeHeroProps {
  onJoinClick: () => void;
  onMatchClick?: () => void;
  onAskClick?: () => void;
}

export function HomeHero({ onJoinClick, onMatchClick, onAskClick }: HomeHeroProps) {
  return (
    <div className="bg-white relative overflow-hidden border-b border-[#f0e8de]">
      <div className="relative z-10 max-w-[880px] mx-auto px-5 pt-9 pb-7 text-center">
        <h1 className="font-['Poppins',sans-serif] text-gray-900 text-[18px] md:text-[24px] font-bold leading-[1.2]">
          America is out of control. MAGA is nuts.
          <br />
          <em className="italic font-semibold">But what can I do?</em>
        </h1>

        <div className="mt-6 mb-5">
          <HeroPills onJoinClick={onJoinClick} onMatchClick={onMatchClick} onAskClick={onAskClick} />
        </div>

        <p className="font-['Poppins',sans-serif] text-base">
          <strong className="font-bold text-[#23297e]">Pick one. Do it. Share it.</strong>
        </p>
        <p className="mt-1 font-['Poppins',sans-serif] text-base">
          <em className="italic text-gray-600">Come back tomorrow.</em>
        </p>
      </div>
    </div>
  );
}
