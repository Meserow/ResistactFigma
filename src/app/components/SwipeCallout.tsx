import { ChevronRight } from "lucide-react";

/**
 * SwipeCallout — a tasteful, attention-getting hero promo for Swipe (Discover)
 * mode on desktop. A small animated card-stack (the top card gives a gentle
 * idle "swipe" nudge, then tilts on hover) plus a short label. Desktop-only —
 * phones already have the Scroll/Swipe toggle. Doesn't dominate the hero; it
 * reads as one inviting affordance, not a banner.
 */
export function SwipeCallout({ onSwipeClick }: { onSwipeClick?: () => void }) {
  if (!onSwipeClick) return null;
  return (
    <button
      onClick={onSwipeClick}
      title="Swipe through acts one at a time"
      className="swipe-callout group hidden md:inline-flex items-center gap-3 rounded-full border border-[#d6541a] bg-gradient-to-r from-[#ed6624] to-[#f5853f] px-4 py-1.5 shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg hover:from-[#e25a1c] hover:to-[#f07a2e]"
    >
      {/* Animated mini card-stack — solid white cards with navy borders so the
          three offset cards stay legible against the orange fill (white-on-white
          borders made them blur into a single blob). */}
      <span className="relative inline-block h-7 w-[22px] shrink-0">
        <span className="swipe-cc-back absolute inset-0 rounded-[5px] border-2 border-[#23297e]/40 bg-white" />
        <span className="swipe-cc-mid absolute inset-0 rounded-[5px] border-2 border-[#23297e]/65 bg-white" />
        <span className="swipe-cc-top absolute inset-0 flex items-center justify-center rounded-[5px] border-2 border-[#23297e] bg-white">
          <span className="block h-1.5 w-1.5 rounded-full bg-[#ed6624]" />
        </span>
      </span>
      <span className="flex flex-col items-start text-left leading-tight whitespace-nowrap">
        <span className="text-[13px] font-extrabold text-white">Swipe to Discover</span>
        <span className="text-[10.5px] font-medium italic text-white/85">Flip through acts one at a time</span>
      </span>
      <ChevronRight size={16} className="text-white/80 transition-all group-hover:translate-x-0.5 group-hover:text-white" />
      <style>{`
        .swipe-callout .swipe-cc-back { transform: translate(4px, 3px) rotate(7deg); }
        .swipe-callout .swipe-cc-mid  { transform: translate(2px, 1.5px) rotate(3.5deg); }
        @keyframes swipe-cc-nudge {
          0%, 86%, 100% { transform: rotate(0deg) translateX(0); }
          90% { transform: rotate(-8deg) translateX(-3px); }
          95% { transform: rotate(4deg) translateX(2px); }
        }
        .swipe-callout .swipe-cc-top { animation: swipe-cc-nudge 4.5s ease-in-out infinite; transform-origin: bottom center; }
        .swipe-callout:hover .swipe-cc-top { animation: none; transform: rotate(-11deg) translateX(-4px); transition: transform .35s cubic-bezier(.2,.8,.2,1); }
        @media (prefers-reduced-motion: reduce) {
          .swipe-callout .swipe-cc-top { animation: none; }
        }
      `}</style>
    </button>
  );
}
