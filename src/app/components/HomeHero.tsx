import { ArrowRight } from "lucide-react";

interface HomeHeroProps {
  onJoinClick: () => void;
}

export function HomeHero({ onJoinClick }: HomeHeroProps) {
  return (
    <div className="bg-white">
      <div className="max-w-[580px] mx-auto px-5 pt-10 pb-8 text-center">
        <span className="inline-block px-3 py-1 rounded-full bg-[#23297e]/10 text-[#23297e] font-['Poppins',sans-serif] font-semibold text-[12px] uppercase tracking-[0.08em]">
          Daily micro-actions
        </span>
        <h1 className="mt-4 font-serif text-gray-900 text-[28px] md:text-[36px] font-medium leading-[1.15]">
          But what can I do?
        </h1>
        <p className="mt-4 font-['Poppins',sans-serif] text-gray-500 text-base leading-[1.6]">
          If you've been doomscrolling, rage-texting friends, or lying awake wondering how we got here — you're not alone. ResistAct turns that feeling into something useful: a daily menu of small, concrete actions to push back.
        </p>
        <p className="mt-6 font-['Poppins',sans-serif] text-gray-900 text-base font-medium">
          Pick one. Do it. Come back tomorrow.
        </p>
        <button
          onClick={onJoinClick}
          className="mt-6 inline-flex items-center gap-2 bg-black text-white font-['Poppins',sans-serif] font-semibold text-base px-5 py-2.5 rounded-lg hover:bg-gray-800 transition-colors"
        >
          Join the resistance
          <ArrowRight size={18} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
