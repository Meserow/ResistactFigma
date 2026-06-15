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
      className="group hidden md:inline-flex h-8 items-center gap-2 rounded-full border border-[#0e7490] bg-gradient-to-r from-[#0891b2] to-[#06b6d4] px-3 shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg hover:from-[#0e7490] hover:to-[#0891b2]"
    >
      <SwipeCardStack />
      <span className="text-[13px] font-extrabold text-white whitespace-nowrap">Swipe to Discover</span>
    </button>
  );
}
