import { X } from "lucide-react";
import diagramImg from "figma:asset/3a930cb92932029145f5289a4b745deaa43e0aa6.png";

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
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[600px] overflow-hidden"
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/15 hover:bg-black/25 text-[#23297e] transition-colors"
        >
          <X size={15} />
        </button>

        <div className="flex gap-5 p-6 pr-12 items-start">
          {/* Text */}
          <div className="flex-1 min-w-0">
            <h2 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-[17px] mb-3">
              How does ResistAct work?
            </h2>
            <p className="font-['Poppins',sans-serif] text-gray-800 text-[13px] leading-relaxed">
              Our database helps those who are feeling helpless and tired of constantly being asked
              for money as the only way we can make change. Instead, we match you with your fellow
              citizen's ideas for making change, ones that can fit in your already full schedule
              raising kids, working long hours, or just paralyzed with fear. We keep the ACTers as
              private as they need, and vet the ASKers carefully – so we can all participate in
              turning this American Titanic before it hits the inevitable iceberg. At the very least
              we will show how united we are.
            </p>
          </div>

          {/* Diagram */}
          <div className="shrink-0 w-[170px] flex items-center justify-center">
            <img
              src={diagramImg}
              alt="ASK → MATCH → ACT → CHANGE cycle"
              className="w-full h-auto"
            />
          </div>
        </div>
      </div>
    </div>
  );
}