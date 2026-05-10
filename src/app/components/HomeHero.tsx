import logoImg from "../../assets/6f09d83b1b948a5a0a2a9e7558c073db252c1f59.png";
import { HeroPills } from "./HeroPills";

interface HomeHeroProps {
  onMatchClick?: () => void;
  onAskClick?: () => void;
}

export function HomeHero({ onMatchClick, onAskClick }: HomeHeroProps) {
  return (
    <div className="bg-white relative overflow-hidden border-b border-[#f0e8de]">
      <div className="relative z-10 max-w-[880px] mx-auto px-5 pt-9 pb-7 text-center">
        <h1 className="font-['Poppins',sans-serif] text-gray-900 text-[18px] md:text-[24px] font-bold leading-[1.2]">
          America is out of control. MAGA is nuts.{" "}
          <em className="italic font-semibold text-[#fd8e33] underline">But what can I do?</em>
        </h1>

        <div className="flex items-center justify-center gap-2 mt-3 mb-0">
          <img src={logoImg} alt="" aria-hidden="true" className="h-10 md:h-12 w-auto" />
          <p className="font-['Poppins',sans-serif] text-[26px] md:text-[34px] font-extrabold text-[#23297e] leading-tight">
            ResistAct.
          </p>
        </div>

        <div className="mt-5 mb-5">
          <HeroPills onMatchClick={onMatchClick} onAskClick={onAskClick} />
        </div>

        <p className="font-['Poppins',sans-serif] text-base">
          <strong className="font-bold text-[#23297e]">Pick one. Do it. Share it.</strong>{" "}
          <em className="italic text-gray-600">Come back tomorrow.</em>
        </p>
      </div>
    </div>
  );
}
