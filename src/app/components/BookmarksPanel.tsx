import { createPortal } from "react-dom";
import { X, Bookmark, ExternalLink } from "lucide-react";
import type { ActionCardData } from "./ActionCard";

interface BookmarksPanelProps {
  cards: ActionCardData[];
  bookmarkedIds: Set<number>;
  onBookmark: (id: number) => void;
  onClose: () => void;
  isLoggedIn: boolean;
  onLoginClick: () => void;
}

export function BookmarksPanel({ cards, bookmarkedIds, onBookmark, onClose, isLoggedIn, onLoginClick }: BookmarksPanelProps) {
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
          <Bookmark size={18} className="text-white" fill="white" />
          <div className="flex-1">
            <p className="font-['Poppins',sans-serif] font-bold text-white text-base leading-tight">
              My Bookmarks
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
                <strong className="text-[#ed6624]">Sign in</strong> to sync bookmarks across devices and never lose them.
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
                <Bookmark size={28} className="text-gray-300" />
              </div>
              <div>
                <p className="font-['Poppins',sans-serif] font-semibold text-gray-700 text-base">No bookmarks yet</p>
                <p className="font-['Poppins',sans-serif] text-gray-400 text-sm mt-1">
                  Tap the bookmark icon on any card to save it for later.
                </p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {bookmarked.map((card) => (
                <BookmarkRow key={card.id} card={card} onUnbookmark={() => onBookmark(card.id)} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function BookmarkRow({ card, onUnbookmark }: { card: ActionCardData; onUnbookmark: () => void }) {
  const url = (card as any).targetUrl as string | undefined;

  return (
    <li className="px-4 py-3.5 hover:bg-gray-50 transition-colors flex items-start gap-3">
      <div className="flex-1 min-w-0">
        {/* Category chip */}
        <span
          className="inline-block text-[10px] font-bold font-['Poppins',sans-serif] uppercase tracking-wide rounded-full px-2 py-0.5 mb-1.5"
          style={{ background: `${card.categoryColor}18`, color: card.categoryColor }}
        >
          {card.category}
        </span>

        {/* Title */}
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-1 group"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="font-['Poppins',sans-serif] font-semibold text-[13px] text-gray-800 group-hover:text-[#23297e] leading-snug transition-colors">
              {card.title}
            </span>
            <ExternalLink size={11} className="text-gray-400 group-hover:text-[#23297e] shrink-0 mt-0.5 transition-colors" />
          </a>
        ) : (
          <p className="font-['Poppins',sans-serif] font-semibold text-[13px] text-gray-800 leading-snug">
            {card.title}
          </p>
        )}

        {/* Author */}
        <p className="font-['Poppins',sans-serif] text-[11px] text-gray-400 mt-0.5">
          {card.authorName}
          {card.authorRole && <span className="text-gray-300"> · {card.authorRole}</span>}
        </p>
      </div>

      {/* Unbookmark */}
      <button
        onClick={onUnbookmark}
        title="Remove bookmark"
        className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-[#23297e] hover:bg-[#23297e]/10 transition-colors mt-0.5"
      >
        <Bookmark size={16} fill="currentColor" />
      </button>
    </li>
  );
}
