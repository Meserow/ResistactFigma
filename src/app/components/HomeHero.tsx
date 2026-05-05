import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import logoImg from "../../assets/6f09d83b1b948a5a0a2a9e7558c073db252c1f59.png";

interface HomeHeroProps {
  onJoinClick: () => void;
}

type ModalKey = "how" | "privacy" | "join";

export function HomeHero({ onJoinClick }: HomeHeroProps) {
  const [openModal, setOpenModal] = useState<ModalKey | null>(null);
  const triggerRefs = useRef<Record<ModalKey, HTMLButtonElement | null>>({
    how: null,
    privacy: null,
    join: null,
  });

  useEffect(() => {
    if (!openModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAndRestore();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [openModal]);

  function closeAndRestore() {
    const prev = openModal;
    setOpenModal(null);
    if (prev) requestAnimationFrame(() => triggerRefs.current[prev]?.focus());
  }

  return (
    <div className="bg-white relative overflow-hidden border-b border-[#f0e8de]">
      <img
        src={logoImg}
        alt=""
        aria-hidden
        className="hidden md:block absolute right-[-60px] top-1/2 -translate-y-1/2 w-[360px] h-[360px] object-contain opacity-10 pointer-events-none select-none"
      />
      <div className="relative z-10 max-w-[880px] mx-auto px-5 pt-9 pb-7 text-center">
        <h1 className="font-['Poppins',sans-serif] text-gray-900 text-[18px] md:text-[24px] font-bold leading-[1.2]">
          America is out of control. MAGA is nuts.
          <br />
          <em className="italic font-semibold">But what can I do?</em>
        </h1>

        <div className="mt-6 mb-5 flex flex-wrap justify-center gap-2">
          <button
            ref={(el) => { triggerRefs.current.how = el; }}
            onClick={() => setOpenModal("how")}
            aria-haspopup="dialog"
            aria-expanded={openModal === "how"}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-400 px-4 py-2 font-['Poppins',sans-serif] text-[13px] font-medium text-gray-600 transition-colors hover:border-[#fd8e33] hover:bg-[#fd8e33]/5 hover:text-[#fd8e33]"
          >
            How it works <span className="text-[11px] opacity-60">→</span>
          </button>
          <button
            ref={(el) => { triggerRefs.current.privacy = el; }}
            onClick={() => setOpenModal("privacy")}
            aria-haspopup="dialog"
            aria-expanded={openModal === "privacy"}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-400 px-4 py-2 font-['Poppins',sans-serif] text-[13px] font-medium text-gray-600 transition-colors hover:border-[#fd8e33] hover:bg-[#fd8e33]/5 hover:text-[#fd8e33]"
          >
            Anonymous by design <span className="text-[11px] opacity-60">→</span>
          </button>
          <button
            ref={(el) => { triggerRefs.current.join = el; }}
            onClick={() => setOpenModal("join")}
            aria-haspopup="dialog"
            aria-expanded={openModal === "join"}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#fd8e33] bg-[#fd8e33] px-4 py-2 font-['Poppins',sans-serif] text-[13px] font-bold text-white transition-colors hover:border-[#d96612] hover:bg-[#d96612]"
          >
            #jointheresistance
          </button>
        </div>

        <p className="font-['Poppins',sans-serif] text-base">
          <strong className="font-bold text-[#23297e]">Pick one. Do it. Share it.</strong>{" "}
          <em className="italic text-gray-600">Come back tomorrow.</em>
        </p>
      </div>

      {openModal === "how" && (
        <HeroModal onClose={closeAndRestore} title="How ResistAct works" titleId="hero-modal-how">
          <p>
            If you've been doomscrolling, rage-texting friends, or lying awake wondering how we got here —{" "}
            <em>you're not alone.</em> And if you're tired of being told you can only "vote," "donate," or wait for the next protest — you're <em>really</em> not alone.
          </p>
          <p>
            ResistAct is a daily menu of small, grassroots, concrete micro-actions you can actually do.
            Show up at a meeting. Make one phone call. Talk to one neighbor.
          </p>
          <p>
            <strong>Pick what fits your day.</strong>
          </p>
        </HeroModal>
      )}

      {openModal === "privacy" && (
        <HeroModal onClose={closeAndRestore} title="Anonymous by design" titleId="hero-modal-privacy">
          <p>
            <strong>Act without signing up.</strong> No account, no email, no tracking pixels, no donation texts at 9pm. We understand in this day and age, resistance can be scary.
          </p>
          <p>
            The whole site is readable without identifying yourself. We don't sell data because we don't collect it.
            The only time we ask anything is if <em>you</em> want to add an action or mark one as done — and even then,
            an anonymous handle is fine.
          </p>
          <p><strong>This isn't a fundraising funnel. It's a tool.</strong></p>
        </HeroModal>
      )}

      {openModal === "join" && (
        <HeroModal onClose={closeAndRestore} title="#jointheresistance" titleId="hero-modal-join">
          <p>You don't need an account to use ResistAct. But if you want to:</p>
          <ul className="list-none space-y-1 pl-0">
            <li>· Mark actions as done and build a streak</li>
            <li>· Submit your own actions to the daily menu</li>

          </ul>
          <p>
            …then create an account. Email or anonymous handle — your call. <em>On your terms.</em>
          </p>
          <button
            onClick={() => {
              closeAndRestore();
              onJoinClick();
            }}
            className="mt-2 inline-flex items-center rounded-md bg-[#fd8e33] px-5 py-2.5 font-['Poppins',sans-serif] text-sm font-bold text-white transition-colors hover:bg-[#d96612]"
          >
            Create my account
          </button>
        </HeroModal>
      )}
    </div>
  );
}

interface HeroModalProps {
  onClose: () => void;
  title: string;
  titleId: string;
  children: React.ReactNode;
}

function HeroModal({ onClose, title, titleId, children }: HeroModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const focusables = cardRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusables?.[0]?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
      className="hero-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-[#0d1b2a]/60 p-6"
    >
      <div
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
        className="hero-modal-card relative w-full max-w-[560px] rounded-[10px] bg-white p-9 md:p-10 shadow-2xl"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-[#f0e8de] hover:text-[#23297e]"
        >
          <X size={20} />
        </button>
        <h3
          id={titleId}
          className="mb-4 font-serif text-[28px] font-bold leading-[1.15] text-[#23297e]"
        >
          {title}
        </h3>
        <div className="space-y-3 font-['Poppins',sans-serif] text-[15px] leading-[1.65] text-gray-700 [&_em]:italic [&_em]:text-[#23297e] [&_strong]:text-[#23297e]">
          {children}
        </div>
      </div>
    </div>
  );
}
