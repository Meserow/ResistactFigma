import logoImg from "../../assets/6f09d83b1b948a5a0a2a9e7558c073db252c1f59.png";

interface HomeHeroProps {
  onJoinClick: () => void;
}

export function HomeHero({ onJoinClick }: HomeHeroProps) {
  return (
    <div className="bg-white relative overflow-hidden">
      <img
        src={logoImg}
        alt=""
        aria-hidden
        className="hidden md:block absolute right-[-60px] top-1/2 -translate-y-1/2 w-[460px] h-[460px] object-contain opacity-10 pointer-events-none select-none"
      />
      <div className="relative z-10 max-w-[880px] mx-auto px-5 pt-8 pb-6 text-center">
        <h1 className="font-serif text-gray-900 text-[28px] md:text-[36px] font-medium leading-[1.15]">
          America is out of control. MAGA is nuts.
          <br />
          <em className="italic">But what can I do?</em>
        </h1>
        <p className="mt-4 font-['Poppins',sans-serif] text-gray-500 text-base leading-[1.6]">
          If you've been doomscrolling, rage-texting friends, or lying awake wondering how we got here —
          <br />
          you're not alone. And if you're tired of being told you can only "vote", "donate", or participate in infrequent protests — <i>you're really not alone.</i>
        </p>
        <p className="mt-3 font-['Poppins',sans-serif] text-gray-500 text-base leading-[1.6]">
          ResistAct is a daily menu of small, grassroots, concrete micro-actions you can actually do.
        </p>
        <p className="mt-3 font-['Poppins',sans-serif] text-gray-500 text-base leading-[1.6]">
          Browse anonymously. No signup, no tracking, no donation texts.
          <br />
          Want to add actions or share what you're doing? That's when you{" "}
          <a
            href="#jointheresistance"
            onClick={onJoinClick}
            className="italic font-semibold text-gray-700 hover:text-[#23297e] underline decoration-dotted underline-offset-4 transition-colors"
          >
            #jointheresistance
          </a>
          {" "}— on your terms.
        </p>
        <p className="mt-5 font-['Poppins',sans-serif] text-gray-900 text-base">
          <b>Pick one. Do it. Share it.</b><br /><i>Come back tomorrow.</i>
        </p>
      </div>
    </div>
  );
}
