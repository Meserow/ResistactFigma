import { X, Zap, Shield, Users, Flame, BookOpen, MessageCircle, Heart } from "lucide-react";
import logoImg from "../../assets/6f09d83b1b948a5a0a2a9e7558c073db252c1f59.png";

interface InfoModalProps {
  onClose: () => void;
  /** Opens the contact / feedback flow. Moved here from the top nav — rendered
   *  as a prominent button at the bottom of the modal's text column. */
  onContact?: () => void;
  /** Opens the founders / about-the-team modal. Rendered as a secondary text
   *  link beneath the Contact Us button. */
  onFounders?: () => void;
}

export function InfoModal({ onClose, onContact, onFounders }: InfoModalProps) {
  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[980px] max-h-[90vh] overflow-y-auto"
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/10 hover:bg-black/20 text-[#23297e] transition-colors"
        >
          <X size={15} />
        </button>

        <div className="flex flex-col sm:flex-row gap-0">
          {/* Left — text, fixed width so it doesn't sprawl */}
          <div className="sm:w-1/2 shrink-0 p-7 pr-6">

            {/* Logo + title */}
            <div className="flex items-center gap-3 mb-3">
              <img src={logoImg} alt="ResistAct fist logo" className="w-10 h-10 object-contain shrink-0" />
              <h2 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-[20px] leading-tight">
                How does ResistAct work?
              </h2>
            </div>

            <p className="font-['Poppins',sans-serif] text-gray-700 text-[13px] leading-relaxed mb-4">
              Feeling helpless? Tired of being told money is the only way to make change? We match you with fellow citizens' ideas for action — ones that fit your already-full life of kids, work, and exhaustion. We vet every submission, protect your privacy, and help you turn this ship before it hits the iceberg.
            </p>

            {/* Margaret Mead — the founding quote. Lives here (and in the
                Join the Resistance modal) instead of the top nav. */}
            <blockquote className="font-['Poppins',sans-serif] text-[#767574] text-[13px] leading-snug italic border-l-2 border-[#ed6624] pl-3 mb-5">
              "Never doubt that a small group of thoughtful, committed citizens can change the world. Indeed, it's the only thing that ever has."
              <span className="not-italic font-semibold block text-right mt-1 text-[#23297e]">— Margaret Mead</span>
            </blockquote>

            <div className="space-y-4">
              <div className="flex gap-3 items-start">
                <div className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5" style={{ backgroundColor: "#8892db" }}>
                  <Zap size={14} strokeWidth={2.5} className="text-white" />
                </div>
                <p className="font-['Poppins',sans-serif] text-gray-600 text-[13px] leading-relaxed">
                  <span className="font-semibold text-[#23297e]">Pick what fits your day.</span>{" "}Quick Match finds actions that suit your time, energy, and snark. Text your reps, drop a flyer, knit a hat for a march. New actions daily.
                </p>
              </div>

              <div className="flex gap-3 items-start">
                <div className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5" style={{ backgroundColor: "#6b77cc" }}>
                  <Shield size={14} strokeWidth={2.5} className="text-white" />
                </div>
                <p className="font-['Poppins',sans-serif] text-gray-600 text-[13px] leading-relaxed">
                  <span className="font-semibold text-[#23297e]">Stay private.</span>{" "}No tracking, no inescapable email list. Resist without leaving a trail. Apply for founding access if you want to save your progress, track your streak, or submit your own actions.
                </p>
              </div>

              <div className="flex gap-3 items-start">
                <div className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5" style={{ backgroundColor: "#535fbb" }}>
                  <Users size={14} strokeWidth={2.5} className="text-white" />
                </div>
                <p className="font-['Poppins',sans-serif] text-gray-600 text-[13px] leading-relaxed">
                  <span className="font-semibold text-[#23297e]">Find your people. Make your own actions.</span>{" "}Add your local anti-fascist meetings. Organize a stunt. Mockery throws Trump off his game — show up at your grocery store in a Baby Trump costume and get the local news out. You get the idea.
                </p>
              </div>

              <div className="flex gap-3 items-start">
                <div className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5" style={{ backgroundColor: "#2d3690" }}>
                  <BookOpen size={14} strokeWidth={2.5} className="text-white" />
                </div>
                <p className="font-['Poppins',sans-serif] text-gray-600 text-[13px] leading-relaxed">
                  <span className="font-semibold text-[#23297e]">Read The Facts. Share The Smacks.</span>{" "}The Facts surfaces daily political truths worth citing. The Smacks are ready-made images you can post straight to Instagram, Threads, Bluesky, or Twitter — sometimes a picture says everything.
                </p>
              </div>

              <div className="flex gap-3 items-start">
                <div className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5" style={{ backgroundColor: "#ed6624" }}>
                  <Flame size={14} strokeWidth={2.5} className="text-white" />
                </div>
                <p className="font-['Poppins',sans-serif] text-gray-600 text-[13px] leading-relaxed">
                  <span className="font-semibold text-[#23297e]">This isn't a fundraising funnel.</span>{" "}It's a tool for you. Let's build the community and momentum we need heading into the midterms. At the very least, we'll show how united we are.
                </p>
              </div>
            </div>

            {/* Contact Us — moved here from the top nav. Full-width orange CTA
                so it's clearly noticeable. Questions, feedback, or report a
                problem all route through the same feedback flow. */}
            {onContact && (
              <button
                onClick={onContact}
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#ed6624] px-5 py-3 font-['Poppins',sans-serif] text-[15px] font-bold text-white shadow-sm transition-colors hover:bg-[#c2521b]"
              >
                <MessageCircle size={18} strokeWidth={2.5} />
                Contact Us
              </button>
            )}

            {/* Meet the founders — secondary link to the team / bio modal. */}
            {onFounders && (
              <button
                onClick={onFounders}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 font-['Poppins',sans-serif] text-[13px] font-semibold text-[#23297e] transition-colors hover:text-[#ed6624]"
              >
                <Heart size={15} strokeWidth={2.5} />
                Meet the humans behind ResistAct
              </button>
            )}
          </div>

          {/* Right — photo. The tier ladder that used to overlay the legs here
              now lives in the Get Started wizard, where it gets a legible,
              full-size moment instead of being fine print on a photo. */}
          <div className="sm:w-1/2 relative overflow-hidden rounded-b-2xl sm:rounded-r-2xl sm:rounded-bl-none min-h-[480px]">
            <img
              src="/trump-kroger.jpg"
              alt="Group of people in Baby Trump inflatable costumes walking out of a Kroger grocery store"
              className="absolute inset-0 w-full h-full object-cover object-center"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
