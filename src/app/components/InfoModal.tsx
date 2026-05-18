import { X, Zap, Shield, Users, Flame, BookOpen } from "lucide-react";
import logoImg from "../../assets/6f09d83b1b948a5a0a2a9e7558c073db252c1f59.png";
import { TIERS } from "../lib/tiers";
import { TierIcon } from "./TierBadge";

interface InfoModalProps {
  onClose: () => void;
}

export function InfoModal({ onClose }: InfoModalProps) {
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

            <p className="font-['Poppins',sans-serif] text-gray-700 text-[13px] leading-relaxed mb-5">
              Feeling helpless? Tired of being told money is the only way to make change? We match you with fellow citizens' ideas for action — ones that fit your already-full life of kids, work, and exhaustion. We vet every submission, protect your privacy, and help you turn this ship before it hits the iceberg.
            </p>

            <div className="space-y-4">
              <div className="flex gap-3 items-start">
                <div className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5" style={{ backgroundColor: "#8892db" }}>
                  <Zap size={14} strokeWidth={2.5} className="text-white" />
                </div>
                <p className="font-['Poppins',sans-serif] text-gray-600 text-[12.5px] leading-relaxed">
                  <span className="font-semibold text-[#23297e]">Pick what fits your day.</span>{" "}Quick Match finds actions that suit your time, energy, and snark. Text your reps, drop a flyer, knit a hat for a march. New actions daily.
                </p>
              </div>

              <div className="flex gap-3 items-start">
                <div className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5" style={{ backgroundColor: "#6b77cc" }}>
                  <Shield size={14} strokeWidth={2.5} className="text-white" />
                </div>
                <p className="font-['Poppins',sans-serif] text-gray-600 text-[12.5px] leading-relaxed">
                  <span className="font-semibold text-[#23297e]">Stay private.</span>{" "}No tracking, no inescapable email list. Resist without leaving a trail. Apply for founding access if you want to save your progress, track your streak, or submit your own actions.
                </p>
              </div>

              <div className="flex gap-3 items-start">
                <div className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5" style={{ backgroundColor: "#535fbb" }}>
                  <Users size={14} strokeWidth={2.5} className="text-white" />
                </div>
                <p className="font-['Poppins',sans-serif] text-gray-600 text-[12.5px] leading-relaxed">
                  <span className="font-semibold text-[#23297e]">Find your people. Make your own actions.</span>{" "}Add your local anti-fascist meetings. Organize a stunt. Mockery throws Trump off his game — show up at your grocery store in a Baby Trump costume and get the local news out. You get the idea.
                </p>
              </div>

              <div className="flex gap-3 items-start">
                <div className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5" style={{ backgroundColor: "#2d3690" }}>
                  <BookOpen size={14} strokeWidth={2.5} className="text-white" />
                </div>
                <p className="font-['Poppins',sans-serif] text-gray-600 text-[12.5px] leading-relaxed">
                  <span className="font-semibold text-[#23297e]">Read The Facts. Share The Smacks.</span>{" "}The Facts surfaces daily political truths worth citing. The Smacks are ready-made images you can post straight to Instagram, Threads, Bluesky, or Twitter — sometimes a picture says everything.
                </p>
              </div>

              <div className="flex gap-3 items-start">
                <div className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5" style={{ backgroundColor: "#fd8e33" }}>
                  <Flame size={14} strokeWidth={2.5} className="text-white" />
                </div>
                <p className="font-['Poppins',sans-serif] text-gray-600 text-[12.5px] leading-relaxed">
                  <span className="font-semibold text-[#23297e]">This isn't a fundraising funnel.</span>{" "}It's a tool for you. Let's build the community and momentum we need heading into the midterms. At the very least, we'll show how united we are.
                </p>
              </div>
            </div>
          </div>

          {/* Right — photo with tier ladder overlaid on the legs */}
          <div className="sm:w-1/2 relative overflow-hidden rounded-b-2xl sm:rounded-r-2xl sm:rounded-bl-none min-h-[480px]">

            {/* Photo fills the full panel */}
            <img
              src="/trump-kroger.jpg"
              alt="Group of people in Baby Trump inflatable costumes walking out of a Kroger grocery store"
              className="absolute inset-0 w-full h-full object-cover object-center"
            />

            {/* Tier ladder — frosted panel over the legs area */}
            <div className="absolute bottom-0 left-0 right-0 px-5 pt-4 pb-5 bg-white/75 backdrop-blur-md">
              <div className="flex items-center gap-1.5 mb-1">
                <Flame size={12} strokeWidth={2.5} className="text-[#fd8e33]" />
                <p className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-[11px] uppercase tracking-widest">
                  Earn your resistance tier
                </p>
              </div>
              <p className="font-['Poppins',sans-serif] text-gray-500 text-[11px] leading-relaxed mb-3 whitespace-nowrap">
                Every action you complete levels up your rank — from first spark to full Inferno.
              </p>
              <div className="space-y-[7px]">
                {TIERS.map((t) => (
                  <div key={t.key} className="flex items-center gap-2">
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                      style={{ backgroundColor: t.color }}
                    >
                      <TierIcon tier={t} size={10} />
                    </div>
                    <span
                      className="font-['Poppins',sans-serif] font-bold text-[11px] w-[52px] shrink-0"
                      style={{ color: t.key === "spark" ? "#d97706" : t.color }}
                    >
                      {t.name}
                    </span>
                    <span className="font-['Poppins',sans-serif] text-gray-600 text-[10px] flex-1 truncate">
                      {t.tagline}
                    </span>
                    <span className="font-['Poppins',sans-serif] text-gray-500 text-[10px] shrink-0 tabular-nums">
                      {t.max !== null ? `${t.min}–${t.max}` : `${t.min}+`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
