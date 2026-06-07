import { ChevronRight } from "lucide-react";
import { SwipeCardStack } from "./SwipeCardStack";

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
      className="group hidden md:inline-flex items-center gap-3 rounded-full border border-[#d6541a] bg-gradient-to-r from-[#ed6624] to-[#f5853f] px-4 py-1.5 shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg hover:from-[#e25a1c] hover:to-[#f07a2e]"
    >
      <SwipeCardStack />
      <span className="flex flex-col items-start text-left leading-tight whitespace-nowrap">
        <span className="text-[13px] font-extrabold text-white">Swipe to Discover</span>
        <span className="text-[10.5px] font-medium italic text-white/85">Flip through acts one at a time</span>
      </span>
      <ChevronRight size={16} className="text-white/80 transition-all group-hover:translate-x-0.5 group-hover:text-white" />
    </button>
  );
}
