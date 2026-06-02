import { createPortal } from "react-dom";
import { X, Heart, ChevronRight } from "lucide-react";
import type { ActionCardData } from "./ActionCard";
import { colorForCategory } from "../lib/categoryGroups";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import cardFallbackImg from "../../assets/resistact-card-fallback.webp";

interface BookmarksPanelProps {
  cards: ActionCardData[];
  bookmarkedIds: Set<number>;
  onBookmark: (id: number) => void;
  onClose: () => void;
  isLoggedIn: boolean;
  onLoginClick: () => void;
  /** Open the full card detail modal for a saved act. Clicking a match pops
   *  the modal first rather than jumping straight to the act's external link. */
  onOpenCard: (card: ActionCardData) => void;
}

export function BookmarksPanel({ cards, bookmarkedIds, onBookmark, onClose, isLoggedIn, onLoginClick, onOpenCard }: BookmarksPanelProps) {
  const bookmarked = cards.filter((c) => bookmarkedIds.has(c.id));

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex justify-end"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Panel */}
      <div
        className="relative w-full max-w-[420px] h-full bg-white shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#23297e] px-5 py-4 flex items-center gap-3 shrink-0">
          <Heart size={18} className="text-white" fill="white" />
          <div className="flex-1">
            <p className="font-['Poppins',sans-serif] font-bold text-white text-base leading-tight">
              My Matches
            </p>
            <p className="font-['Poppins',sans-serif] text-white/60 text-xs">
              {bookmarked.length} saved act{bookmarked.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Anonymous sync nudge */}
        {!isLoggedIn && bookmarked.length > 0 && (
          <div className="px-4 py-3 bg-[#ed6624]/10 border-b border-[#ed6624]/20 flex items-start gap-3">
            <span className="text-lg leading-none mt-0.5">⚡</span>
            <div className="flex-1 min-w-0">
              <p className="font-['Poppins',sans-serif] text-[12px] text-gray-700 leading-snug">
                <strong className="text-[#ed6624]">Sign in</strong> to sync your matches across devices and never lose them.
              </p>
            </div>
            <button
              onClick={() => { onClose(); onLoginClick(); }}
              className="shrink-0 px-3 py-1 rounded-full bg-[#ed6624] text-white font-['Poppins',sans-serif] font-bold text-xs hover:bg-[#c2521b] transition-colors"
            >
              Sign in
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {bookmarked.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-8 text-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
                <Heart size={28} className="text-gray-300" />
              </div>
              <div>
                <p className="font-['Poppins',sans-serif] font-semibold text-gray-700 text-base">No matches yet</p>
                <p className="font-['Poppins',sans-serif] text-gray-400 text-sm mt-1">
                  Tap the heart on any card to save it to your matches.
                </p>
              </div>
            </div>
          ) : (
            <ul className="flex flex-col gap-2 p-3">
              {bookmarked.map((card) => (
                <BookmarkRow key={card.id} card={card} onUnbookmark={() => onBookmark(card.id)} onOpen={() => onOpenCard(card)} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function BookmarkRow({ card, onUnbookmark, onOpen }: { card: ActionCardData; onUnbookmark: () => void; onOpen: () => void }) {
  const banner = card.cartoonImageUrl || card.topImage || cardFallbackImg;
  return (
    // Card row mirroring the swipe deck's "Saved for later" recap: thumbnail +
    // title + solid category pill. Clicking anywhere opens the full card modal
    // (the act's external link lives inside). The heart stops propagation so
    // un-saving doesn't also open the modal.
    <li
      onClick={onOpen}
      className="group flex items-center gap-3 rounded-xl bg-gray-50 hover:bg-gray-100 p-2.5 transition-colors cursor-pointer"
    >
      <ImageWithFallback
        src={banner}
        alt=""
        className="h-14 w-14 shrink-0 rounded-lg object-cover"
        draggable={false}
      />

      <div className="min-w-0 flex-1">
        <p className="font-['Poppins',sans-serif] font-semibold text-[14px] text-gray-800 group-hover:text-[#23297e] leading-snug line-clamp-2 transition-colors">
          {card.title}
        </p>
        {card.category && (
          <span
            className="mt-1 inline-flex items-center rounded px-1.5 py-0.5 font-['Poppins',sans-serif] text-[10px] font-bold tracking-wide text-white"
            style={{ backgroundColor: colorForCategory(card.category) }}
          >
            {card.category}
          </span>
        )}
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        {/* Unbookmark */}
        <button
          onClick={(e) => { e.stopPropagation(); onUnbookmark(); }}
          title="Remove from My Matches"
          className="w-8 h-8 flex items-center justify-center rounded-full text-[#23297e] hover:bg-[#23297e]/10 transition-colors"
        >
          <Heart size={16} fill="currentColor" />
        </button>
        <ChevronRight size={16} className="text-gray-300 group-hover:text-[#23297e] transition-colors" />
      </div>
    </li>
  );
}
