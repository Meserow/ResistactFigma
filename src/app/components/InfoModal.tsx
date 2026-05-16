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
              For those who are feeling helpless — tired of being asked for money as the only way to make change — we match you with your fellow citizens' ideas for action. Ones that fit your already full schedule: raising kids, working long hours, or just paralyzed with fear. We keep the act-ers as private as they need, vet the act submissions, and help you participate in turning this American Titanic before it hits the inevitable iceberg.
            </p>

            <div className="space-y-4">
              <div className="flex gap-3 items-start">
                <div className="shrink-0 w-7 h-7 rounded-lg bg-pink-50 flex items-center justify-center mt-0.5">
                  <Zap size={14} strokeWidth={2.5} className="text-pink-500" />
                </div>
                <div>
                  <p className="font-['Poppins',sans-serif] font-semibold text-[#23297e] text-[13px] leading-tight mb-0.5">Pick what fits your day.</p>
                  <p className="font-['Poppins',sans-serif] text-gray-600 text-[12.5px] leading-relaxed">Use the Quick Match tool to find actions that suit your time, energy, and snark. Text your reps, drop a flyer, knit a hat for a march. New actions added daily — come back tomorrow, find new ones.</p>
                </div>
              </div>

              <div className="flex gap-3 items-start">
                <div className="shrink-0 w-7 h-7 rounded-lg bg-[#23297e]/10 flex items-center justify-center mt-0.5">
                  <Shield size={14} strokeWidth={2.5} className="text-[#23297e]" />
                </div>
                <div>
                  <p className="font-['Poppins',sans-serif] font-semibold text-[#23297e] text-[13px] leading-tight mb-0.5">Stay private.</p>
                  <p className="font-['Poppins',sans-serif] text-gray-600 text-[12.5px] leading-relaxed">No tracking, no email list you can't get off. Resist without being afraid of leaving a trail. Only make an account if you want to save your matches or submit an action for vetting.</p>
                </div>
              </div>

              <div className="flex gap-3 items-start">
                <div className="shrink-0 w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center mt-0.5">
                  <Users size={14} strokeWidth={2.5} className="text-emerald-600" />
                </div>
                <div>
                  <p className="font-['Poppins',sans-serif] font-semibold text-[#23297e] text-[13px] leading-tight mb-0.5">Find your people. Make your own actions.</p>
                  <p className="font-['Poppins',sans-serif] text-gray-600 text-[12.5px] leading-relaxed">Add your local anti-fascist meetings. Organize a stunt. Since mockery throws Trump off his game, show up at your grocery store in a Baby Trump costume. Get the local news out. You get the idea.</p>
                </div>
              </div>

              <div className="flex gap-3 items-start">
                <div className="shrink-0 w-7 h-7 rounded-lg bg-[#fd8e33]/15 flex items-center justify-center mt-0.5">
                  <Flame size={14} strokeWidth={2.5} className="text-[#fd8e33]" />
                </div>
                <div>
                  <p className="font-['Poppins',sans-serif] font-semibold text-[#23297e] text-[13px] leading-tight mb-0.5">This isn't a fundraising funnel.</p>
                  <p className="font-['Poppins',sans-serif] text-gray-600 text-[12.5px] leading-relaxed">It's a tool for you. Let's build the community and momentum we need rolling into the midterms. At the very least — we will show how united we are.</p>
                </div>
              </div>

              <div className="flex gap-3 items-start">
                <div className="shrink-0 w-7 h-7 rounded-lg bg-sky-50 flex items-center justify-center mt-0.5">
                  <BookOpen size={14} strokeWidth={2.5} className="text-sky-500" />
                </div>
                <div>
                  <p className="font-['Poppins',sans-serif] font-semibold text-[#23297e] text-[13px] leading-tight mb-0.5">Read the facts. Share the smacks.</p>
                  <p className="font-['Poppins',sans-serif] text-gray-600 text-[12.5px] leading-relaxed">RA Facts surfaces daily political truths you can cite and share. The Smacks are ready-made political images you can post straight to Instagram, Threads, Bluesky, or Twitter — because sometimes a picture says everything.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right — tier ladder above the Kroger photo */}
          <div className="sm:w-1/2 flex flex-col overflow-hidden rounded-b-2xl sm:rounded-r-2xl sm:rounded-bl-none">

            {/* Tier gamification */}
            <div className="bg-[#23297e]/[0.04] px-5 pt-5 pb-4 border-b border-[#23297e]/10 shrink-0">
              <div className="flex items-center gap-1.5 mb-1">
                <Flame size={12} strokeWidth={2.5} className="text-[#fd8e33]" />
                <p className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-[11px] uppercase tracking-widest">
                  Earn your resistance tier
                </p>
              </div>
              <p className="font-['Poppins',sans-serif] text-gray-500 text-[11px] leading-relaxed mb-3">
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
                      style={{ color: t.color }}
                    >
                      {t.name}
                    </span>
                    <span className="font-['Poppins',sans-serif] text-gray-400 text-[10px] flex-1 truncate">
                      {t.tagline}
                    </span>
                    <span className="font-['Poppins',sans-serif] text-gray-300 text-[10px] shrink-0 tabular-nums">
                      {t.max !== null ? `${t.min}–${t.max}` : `${t.min}+`}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Photo — object-bottom so legs are visible */}
            <div className="flex-1 overflow-hidden min-h-[160px] sm:min-h-0">
              <img
                src="/trump-kroger.jpg"
                alt="Group of people in Baby Trump inflatable costumes walking out of a Kroger grocery store"
                className="w-full h-full object-cover object-bottom"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
