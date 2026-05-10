import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Zap, Sparkles, Megaphone } from "lucide-react";

interface HeroPillsProps {
  onMatchClick?: () => void;
  onAskClick?: () => void;
}

export function HeroPills({ onMatchClick, onAskClick }: HeroPillsProps) {
  const [openModal, setOpenModal] = useState<"how" | null>(null);
  const triggerRefs = useRef<Record<"how", HTMLButtonElement | null>>({
    how: null,
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
      <div className="flex flex-wrap lg:flex-nowrap justify-center gap-2">
        <button
          ref={(el) => { triggerRefs.current.how = el; }}
          onClick={() => setOpenModal("how")}
          aria-haspopup="dialog"
          aria-expanded={openModal === "how"}
          className="shrink-0 inline-flex items-center gap-2 rounded-full border border-gray-400 px-4 py-2 font-['Poppins',sans-serif] transition-colors hover:border-[#fd8e33] hover:bg-[#fd8e33]/5 hover:text-[#fd8e33] group"
        >
          <Zap size={14} strokeWidth={2.5} className="text-gray-600 group-hover:text-[#fd8e33]" />
          <span className="flex flex-col items-start text-left leading-tight whitespace-nowrap">
            <span className="text-[13px] font-bold text-gray-600 group-hover:text-[#fd8e33]">How ResistAct Works</span>
            <span className="text-[10.5px] font-normal text-gray-400 italic group-hover:text-[#fd8e33]/70">What is this site about?</span>
          </span>
        </button>
        {onMatchClick && (
          <button
            onClick={onMatchClick}
            className="shrink-0 inline-flex items-center gap-2 rounded-full border border-[#fd8e33] bg-white px-4 py-2 font-['Poppins',sans-serif] transition-colors hover:bg-[#fd8e33]/5"
          >
            <Sparkles size={14} strokeWidth={2.5} className="text-[#fd8e33]" />
            <span className="flex flex-col items-start text-left leading-tight whitespace-nowrap">
              <span className="text-[13px] font-bold text-[#fd8e33]">Match me with Acts</span>
              <span className="text-[10.5px] font-normal text-[#d97318] italic">Pressed for time? Show me what fits.</span>
            </span>
          </button>
        )}
        {onAskClick && (
          <button
            onClick={onAskClick}
            className="shrink-0 inline-flex items-center gap-2 rounded-full border border-[#23297e] bg-white px-4 py-2 font-['Poppins',sans-serif] transition-colors hover:bg-[#23297e]/5"
          >
            <Megaphone size={14} strokeWidth={2.5} className="text-[#23297e]" />
            <span className="flex flex-col items-start text-left leading-tight whitespace-nowrap">
              <span className="text-[13px] font-bold text-[#23297e]">Add an Act!</span>
              <span className="text-[10.5px] font-normal text-[#23297e]/70 italic">Need people to join me in a great idea!</span>
            </span>
          </button>
        )}
      </div>

      {openModal === "how" && (
        <HeroModal onClose={closeAndRestore} title="How ResistAct Works" titleId="hero-modal-how" accentColor="#23297e" icon={<Zap size={20} strokeWidth={2} />}>
          <p>
            If you've been doomscrolling, rage-texting friends, or lying awake wondering how we got here —{" "}
            <em>you're not alone.</em> Tired of being told you can only vote, donate, or wait for the next No Kings protest? <em>You're really not alone.</em>
          </p>
          <p><strong>How does ResistAct help?</strong></p>
          <p>
            ResistAct is a daily menu of small, doable actions — text your reps, drop a flyer, knit a hat for a march, light a candle in your window. Find actions that suit your mood. Do something small if that's all you have time for this week. But keep doing small things.
          </p>
          <p>
            <strong>Pick what fits your day.</strong> Use the matching tool to find actions that fit the time, energy, and snark coursing through your veins. New actions every day — come back tomorrow, find new ones. Let's get the community and momentum we need to roll into the midterms…
          </p>
          <p>
            <strong>Stay private.</strong> No tracking, no email, no list you can't get off. Resist without being afraid of leaving a trail. Only make an account if you want to gamify your ResistActs or make an action (so we can vet it).
          </p>
          <p>
            <strong>This isn't a fundraising funnel. It's a tool for you.</strong> Find your people. Make your own actions. For example, add your local anti-fascist meetings. Or since we know mockery throws Trump off his game, let's all show up at the grocery store in a Baby Trump costume on July 1. Maybe get the local news out to see it.</p>
          <p><strong>You get the idea.</strong>
          </p>
          <img
            src="/trump-kroger.jpg"
            alt="Group of people in Baby Trump inflatable costumes and orange Baby Trump t-shirts walking out of a Kroger grocery store"
            className="rounded-xl w-full max-h-[260px] object-cover mt-2"
          />
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

  // Portal to document.body so the overlay isn't trapped inside the navbar's
  // sticky/z-40 stacking context (HeroPills renders as the navbar's heroSlot,
  // which on mobile let the navbar bleed through the overlay).
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
      className="hero-modal-overlay fixed inset-0 z-[1000] flex items-center justify-center bg-[#0d1b2a]/60 p-4 sm:p-6 overflow-y-auto"
    >
      <div
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
        className="hero-modal-card relative w-full max-w-[700px] my-auto max-h-[calc(100vh-2rem)] overflow-y-auto rounded-[10px] bg-white shadow-2xl"
      >
        <div className="relative p-6 sm:p-9 md:p-10">
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
    </div>,
    document.body
  );
}
