import { useEffect, useRef, useState } from "react";
import { X, Zap, Flame, Sparkles, Plus } from "lucide-react";

interface HeroPillsProps {
  onJoinClick: () => void;
  onMatchClick?: () => void;
  onAskClick?: () => void;
  /** When true, the Join modal hides the "Create my account" CTA. */
  isLoggedIn?: boolean;
}

type ModalKey = "how" | "join";

export function HeroPills({ onJoinClick, onMatchClick, onAskClick, isLoggedIn = false }: HeroPillsProps) {
  const [openModal, setOpenModal] = useState<ModalKey | null>(null);
  const triggerRefs = useRef<Record<ModalKey, HTMLButtonElement | null>>({
    how: null,
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
    <>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          ref={(el) => { triggerRefs.current.how = el; }}
          onClick={() => setOpenModal("how")}
          aria-haspopup="dialog"
          aria-expanded={openModal === "how"}
          className="inline-flex items-center gap-1.5 rounded-full border border-gray-400 px-4 py-2 font-['Poppins',sans-serif] text-[13px] font-medium text-gray-600 transition-colors hover:border-[#fd8e33] hover:bg-[#fd8e33]/5 hover:text-[#fd8e33]"
        >
          <Zap size={13} strokeWidth={2.5} />
          How ResistAct Works
        </button>
        {onMatchClick && (
          <button
            onClick={onMatchClick}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#fd8e33] bg-white px-4 py-2 font-['Poppins',sans-serif] text-[13px] font-bold text-[#fd8e33] transition-colors hover:bg-[#fd8e33]/5"
          >
            <Sparkles size={13} strokeWidth={2.5} />
            Match me with Acts
          </button>
        )}
        {onAskClick && (
          <button
            onClick={onAskClick}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#23297e] bg-white px-4 py-2 font-['Poppins',sans-serif] text-[13px] font-bold text-[#23297e] transition-colors hover:bg-[#23297e]/5"
          >
            <Plus size={13} strokeWidth={2.5} />
            Add an Act Card
          </button>
        )}
        <button
          ref={(el) => { triggerRefs.current.join = el; }}
          onClick={() => setOpenModal("join")}
          aria-haspopup="dialog"
          aria-expanded={openModal === "join"}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#fd8e33] bg-[#fd8e33] px-4 py-2 font-['Poppins',sans-serif] text-[13px] font-bold text-white transition-colors hover:border-[#d96612] hover:bg-[#d96612]"
        >
          <Flame size={13} strokeWidth={2.5} />
          Join The Resistance
        </button>
      </div>

      {openModal === "how" && (
        <HeroModal onClose={closeAndRestore} title="How ResistAct Works" titleId="hero-modal-how" accentColor="#23297e" icon={<Zap size={20} strokeWidth={2} />}>
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
          <p>
            Perform an Action without even signing in. The whole site is usable without identifying yourself. The only time we ask anything is if you want to ADD an action (so we can vet it), or allow us to count your actions so you can feel more accomplished!
          </p>
          <p>
            But our goal is to make this easy and not scary: no required account info, no email, no tracking pixels, no donation texts at 9pm.
          </p>
          <p><strong>This isn't a fundraising funnel. It's a tool.</strong></p>
        </HeroModal>
      )}

      {openModal === "join" && (
        <HeroModal onClose={closeAndRestore} title="Join The Resistance" titleId="hero-modal-join" accentColor="#fd8e33" icon={<Flame size={20} strokeWidth={2} />}>
          <p>You don't need an account to use ResistAct. But if you want to:</p>
          <ul className="list-none space-y-1 pl-0">
            <li className="pl-4">· Mark actions as done and build a streak</li>
            <li className="pl-4">· Submit your own actions to the daily menu</li>
          </ul>
          <p>
            …then create an account.
          </p>
          <p><strong>On your terms.</strong>
          </p>
          {!isLoggedIn && (
            <button
              onClick={() => {
                closeAndRestore();
                onJoinClick();
              }}
              className="mt-2 ml-auto flex items-center rounded-md bg-[#fd8e33] px-5 py-2.5 font-['Poppins',sans-serif] text-sm font-bold text-white transition-colors hover:bg-[#d96612]"
            >
              Create my account
            </button>
          )}
        </HeroModal>
      )}
    </>
  );
}

interface HeroModalProps {
  onClose: () => void;
  title: string;
  titleId: string;
  children: React.ReactNode;
  accentColor?: string;
  icon?: React.ReactNode;
}

function HeroModal({ onClose, title, titleId, children, accentColor, icon }: HeroModalProps) {
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
        className="hero-modal-card relative w-full max-w-[560px] overflow-hidden rounded-[10px] bg-white shadow-2xl"
      >
        <div className="relative p-9 md:p-10">
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-[#f0e8de] hover:text-[#23297e]"
          >
            <X size={20} />
          </button>
          <div className="mb-4 flex items-center gap-3">
            {icon && accentColor && (
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
                style={{ background: accentColor }}
              >
                {icon}
              </div>
            )}
            <h3
              id={titleId}
              className="font-['Poppins',sans-serif] text-[24px] font-bold leading-[1.2] text-[#23297e]"
            >
              {title}
            </h3>
          </div>
          <div className="space-y-3 font-['Poppins',sans-serif] text-[15px] leading-[1.65] text-gray-700 [&_em]:italic [&_em]:text-[#23297e] [&_strong]:text-[#23297e]">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
