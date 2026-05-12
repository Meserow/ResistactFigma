import { X, Zap, Shield, Users, Flame } from "lucide-react";
import logoImg from "../../assets/6f09d83b1b948a5a0a2a9e7558c073db252c1f59.png";

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
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[980px] overflow-hidden"
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
            </div>
          </div>

          {/* Right — photo, takes the remaining width */}
          <div className="sm:w-1/2 min-h-[420px] overflow-hidden">
            <img
              src="/trump-kroger.jpg"
              alt="Group of people in Baby Trump inflatable costumes walking out of a Kroger grocery store"
              className="w-full h-full object-cover object-center"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
