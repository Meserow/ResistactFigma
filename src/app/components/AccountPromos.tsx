import { Flame, TrendingUp, Award, RefreshCw, Megaphone, X } from "lucide-react";
import { SwipeCallout } from "./SwipeCallout";

/**
 * Account-creation promos for logged-out users:
 *   • AccountBenefits — the value-prop list (shown in the Join modal).
 *   • SignupCard      — a card injected into the feed grid every ~12 acts.
 *   • SignupBanner    — a persistent, dismissible bar above the bottom footer.
 */

const ACCOUNT_BENEFITS = [
  { icon: <TrendingUp size={16} strokeWidth={2.5} />, label: "Track your impact", sub: "Every act you take adds up." },
  { icon: <Award size={16} strokeWidth={2.5} />, label: "Earn resistance tiers", sub: "Build a streak, level up." },
  { icon: <RefreshCw size={16} strokeWidth={2.5} />, label: "Sync saves across devices", sub: "Your matches, everywhere." },
  { icon: <Megaphone size={16} strokeWidth={2.5} />, label: "Add your own acts", sub: "Share an idea for others to join." },
];

/** Vertical benefits list for the Join The Resistance modal. */
export function AccountBenefits() {
  return (
    <ul className="flex flex-col gap-2.5">
      {ACCOUNT_BENEFITS.map((b) => (
        <li key={b.label} className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#23297e]/[0.07] text-[#23297e]">
            {b.icon}
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-['Poppins',sans-serif] text-[14px] font-bold text-[#23297e]">{b.label}</span>
            <span className="font-['Poppins',sans-serif] text-[12px] text-gray-500">{b.sub}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function SignupBanner({ onLoginClick, onDismiss, onSwipeClick }: { onLoginClick: () => void; onDismiss: () => void; onSwipeClick?: () => void }) {
  return (
    // Takes over the bottom footer slot for logged-out users (the white tagline
    // footer is hidden while this shows). Adapts to phones — the longer copy
    // collapses so the message + Join button still fit on one row.
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white shadow-[0_-1px_3px_rgba(0,0,0,0.08)]">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-[#23297e] md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {/* Join The Resistance — primary CTA, on the LEFT (swapped with the
              Swipe pill). */}
          <button
            onClick={onLoginClick}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[#ed6624] px-3.5 font-['Poppins',sans-serif] text-sm font-bold text-white transition-colors hover:bg-[#c2521b]"
          >
            <Flame size={14} strokeWidth={2.25} />
            <span className="hidden sm:inline">Join The Resistance</span>
            <span className="sm:hidden">Join</span>
          </button>
          {/* One paragraph (not two stacked) so the copy flows and wraps to at
              most 2 lines — "Stay anonymous…" sits right after "…sync across
              devices." instead of forcing its own third line. */}
          <p className="min-w-0 font-['Poppins',sans-serif] text-[13px] leading-snug md:text-sm">
            <span className="font-bold">You're browsing anonymously.</span>{" "}
            <span className="hidden text-gray-600 sm:inline">Create a free account to save your progress, earn tiers, and sync across devices.</span>{" "}
            <span className="hidden italic text-gray-400 sm:inline">Stay anonymous if you like — no tracking, no spam.</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Swipe to Discover — now on the RIGHT (swapped with Join). Desktop
              only; the pill hides below md. */}
          {onSwipeClick && <SwipeCallout onSwipeClick={onSwipeClick} />}
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
