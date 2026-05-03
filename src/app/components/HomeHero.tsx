interface HomeHeroProps {
  onJoinClick: () => void;
}

export function HomeHero({ onJoinClick: _onJoinClick }: HomeHeroProps) {
  return (
    <div className="bg-white">
      <div className="max-w-[880px] mx-auto px-5 pt-8 pb-6 text-center">
        <h1 className="font-serif text-gray-900 text-[28px] md:text-[36px] font-medium leading-[1.15]">
          MAGA is nuts. But what can <em className="italic">I</em> do?
        </h1>
        <p className="mt-4 font-['Poppins',sans-serif] text-gray-500 text-base leading-[1.6]">
          If you've been doomscrolling, rage-texting friends, or lying awake wondering how we got here —
          <br />
          you're not alone. And if you're tired of being told the only answers are "vote" and "donate" —
          <span className="block italic">you're really not alone.</span>
        </p>
        <p className="mt-3 font-['Poppins',sans-serif] text-gray-500 text-base leading-[1.6]">
          ResistAct is a daily menu of small, grassroots, concrete micro-actions you can actually take.
          <br />
          And taking daily action is the only way out.
        </p>
        <p className="mt-3 font-['Poppins',sans-serif] text-gray-500 text-base leading-[1.6]">
          Browse anonymously. No signup, no tracking, no donation texts.
          <br />
          Want to add actions or share what you're doing? That's when you join the Resistance — on your terms.
        </p>
        <p className="mt-5 font-['Poppins',sans-serif] text-gray-900 text-base">
          <b>Pick one. Do it. Share it.</b><br /><i>Come back tomorrow.</i>
        </p>
      </div>
    </div>
  );
}
