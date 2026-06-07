import { Flame } from "lucide-react";

/**
 * SwipeCardStack — the little fanned card-stack with a flame on the top card.
 * It's the shared visual language for the Swipe (Discover) feature, used in the
 * hero "Swipe to Discover" button AND the "A lot to scroll through?" toast so
 * the affordance reads the same everywhere.
 *
 * White cards (legible on orange or light backgrounds) with soft navy borders +
 * drop shadows for depth. The top card gives a gentle idle "nudge" and, when
 * inside a `group` (e.g. the hero button), tilts on hover. Respects
 * prefers-reduced-motion.
 */
export function SwipeCardStack({ className = "" }: { className?: string }) {
  return (
    <span className={`swipe-card-stack relative inline-block h-7 w-[22px] shrink-0 ${className}`}>
      <span className="swipe-cc-back absolute inset-0 rounded-[5px] border-2 border-[#23297e]/55 bg-white" />
      <span className="swipe-cc-mid absolute inset-0 rounded-[5px] border-2 border-[#23297e]/75 bg-white" />
      <span className="swipe-cc-top absolute inset-0 flex items-center justify-center rounded-[5px] border-2 border-[#23297e] bg-white shadow-sm">
        <Flame size={11} strokeWidth={2} className="text-[#ed6624]" fill="#ed6624" />
      </span>
      <style>{`
        .swipe-card-stack .swipe-cc-back { transform: translate(4px, 3px) rotate(7deg); }
        .swipe-card-stack .swipe-cc-mid  { transform: translate(2px, 1.5px) rotate(3.5deg); }
        @keyframes swipe-cc-nudge {
          0%, 86%, 100% { transform: rotate(0deg) translateX(0); }
          90% { transform: rotate(-8deg) translateX(-3px); }
          95% { transform: rotate(4deg) translateX(2px); }
        }
        .swipe-card-stack .swipe-cc-top { animation: swipe-cc-nudge 4.5s ease-in-out infinite; transform-origin: bottom center; }
        .group:hover .swipe-card-stack .swipe-cc-top { animation: none; transform: rotate(-11deg) translateX(-4px); transition: transform .35s cubic-bezier(.2,.8,.2,1); }
        @media (prefers-reduced-motion: reduce) {
          .swipe-card-stack .swipe-cc-top { animation: none; }
        }
      `}</style>
    </span>
  );
}
