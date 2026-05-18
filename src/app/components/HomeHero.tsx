import logoImg from "../../assets/resistact-logo-horizontal.webp";
import { HeroPills } from "./HeroPills";

interface HomeHeroProps {
  onMatchClick?: () => void;
  onAskClick?: () => void;
  onHowClick?: () => void;
}

export function HomeHero({ onMatchClick, onAskClick, onHowClick }: HomeHeroProps) {
  return (
    <div className="bg-white relative overflow-hidden border-b border-[#f0e8de]">
      <div className="relative z-10 max-w-[880px] mx-auto px-5 pt-9 pb-7 text-center">
        <div className="relative">
          <h1 className="font-['Poppins',sans-serif] text-[#2a2a2a] text-[18px] md:text-[22px] font-bold leading-[1.2]">
            <span className="inline-block -translate-x-20 md:-translate-x-44">America is being run by cartoon villains. MAGA is nuts.</span>
            <br />
            <em className="stamp-in font-['Rock_Salt',cursive] not-italic font-bold text-[#fd8e33] text-[23px] md:text-[27px] leading-none align-baseline inline-block translate-x-24 md:translate-x-52" style={{ WebkitTextStroke: "1.25px #fd8e33", paintOrder: "stroke fill" }}>But what can one person do?</em>
          </h1>

          <div className="flex items-center justify-center mt-3 mb-0">
            <img src={logoImg} alt="ResistAct — Citizen Action" className="h-16 md:h-24 w-auto" />
          </div>
        </div>

        <div className="mt-5 mb-5">
          <HeroPills onMatchClick={onMatchClick} onAskClick={onAskClick} onHowClick={onHowClick} />
        </div>
      </div>
    </div>
  );
}
