import { X, Clock, ArrowRight } from "lucide-react";

interface TakeABreakModalProps {
  /** Logged-in users get the "save Acts for later" swipe CTA; logged-out get
      the "join so your matches are saved" CTA. */
  isLoggedIn: boolean;
  /** Fires the right thing for the user's auth state (open swipe deck or the
      Join the Resistance modal). The parent also snoozes the nudge. */
  onPrimary: () => void;
  /** Dismiss without acting — also snoozes the nudge for the day. */
  onClose: () => void;
}

// Soft "you've been here a while" check-in. The image's punchline — the body
// wasn't built to know what the worst person alive is doing every fifteen
// minutes — IS the message, so it leads and the copy just turns the doom-scroll
// into one concrete next step.
export function TakeABreakModal({ isLoggedIn, onPrimary, onClose }: TakeABreakModalProps) {
  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[520px] max-h-[90vh] overflow-y-auto"
      >
        {/* Close */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/30 hover:bg-black/50 text-white transition-colors"
        >
          <X size={15} />
        </button>

        {/* The meme leads — shown whole (object-contain-equivalent via natural
            ratio) so the red text block isn't cropped; it carries the point. */}
        <img
          src="/Smacks/trumphumanbody.webp"
          alt="Cartoon of Trump pointing at a watch reading '15 minutes' next to a poster: 'The human body was not designed to know what the worst person in the world is doing every fifteen minutes.'"
          className="w-full h-auto block rounded-t-2xl"
        />

        <div className="p-7 pt-6">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={15} strokeWidth={2.5} className="text-[#ed6624] shrink-0" />
            <p className="font-['Poppins',sans-serif] font-bold text-[#ed6624] text-[11px] uppercase tracking-widest">
              You've been here a while
            </p>
          </div>

          <h2 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-[20px] leading-tight mb-3">
            The 15-minute outrage cycle isn't helping.
          </h2>

          <p className="font-['Poppins',sans-serif] text-gray-700 text-[13px] leading-relaxed mb-6">
            Refreshing the feed doesn't change what he's doing — but doing one
            real thing does.{" "}
            {isLoggedIn
              ? "Save a few Acts you'll actually get to, then close the tab and go live your life."
              : "Join the Resistance so the Acts you pick are saved for you, then close the tab and go live your life."}
          </p>

          <div className="flex flex-col gap-2.5">
            <button
              onClick={onPrimary}
              className="group inline-flex items-center justify-center gap-2 w-full rounded-xl bg-[#ed6624] hover:bg-[#d4571a] text-white font-['Poppins',sans-serif] font-semibold text-[14px] px-5 py-3 transition-colors"
            >
              {isLoggedIn ? "Swipe to save Acts for later" : "Save my matches — join the Resistance"}
              <ArrowRight size={16} strokeWidth={2.5} className="transition-transform group-hover:translate-x-0.5" />
            </button>

            <button
              onClick={onClose}
              className="w-full rounded-xl text-gray-500 hover:text-[#23297e] font-['Poppins',sans-serif] font-medium text-[13px] px-5 py-2 transition-colors"
            >
              I'm good — keep browsing
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
