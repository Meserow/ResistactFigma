import { useState } from "react";
import { Bookmark, BookmarkCheck, Globe, MapPin, Pencil, Share2 } from "lucide-react";
import { ShareModal } from "./ShareModal";

export interface ActionCardData {
  id: number;
  category: string;
  categoryColor: string;
  title: string;
  targetUrl?: string;
  description: string;
  typeTag?: string;
  location?: string;
  isOnline?: boolean;
  actionType?: string;
  timeCommitment?: string;
  spotsUsed: number;
  spotsTotal: number | "Unlimited";
  authorName: string;
  authorRole: string;
  authorLink?: string;
  topImage?: string;
  authorAvatar?: string;
  isFeatured?: boolean;
  featuredIllustration?: React.ReactNode;
  createdBy?: string;
}

interface ActionCardProps {
  card: ActionCardData;
  onBoost?: (id: number) => void;
  onShare?: (id: number) => void;
  onBookmark?: (id: number) => void;
  onEdit?: (id: number) => void;
  isBoosted?: boolean;
  isBookmarked?: boolean;
  canEdit?: boolean;
}

export function ActionCard({ card, onBoost, onShare, onBookmark, onEdit, isBoosted, isBookmarked, canEdit }: ActionCardProps) {
  const [shareOpen, setShareOpen] = useState(false);

  const boostLabel = `${card.spotsUsed.toLocaleString()} boost${card.spotsUsed === 1 ? "" : "s"}`;

  // ── Shared top-right controls (pencil + bookmark) ──────────────────────────
  function TopControls({ light = true }: { light?: boolean }) {
    return (
      <div className="flex items-center gap-1">
        {canEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); onEdit?.(card.id); }}
            title="Edit this act"
            className={`${light ? "text-white" : "text-gray-500"} drop-shadow hover:scale-110 transition-transform`}
          >
            <Pencil size={15} />
          </button>
        )}
        <button
          onClick={() => onBookmark?.(card.id)}
          className={`${light ? "text-white" : "text-gray-500"} drop-shadow hover:scale-110 transition-transform`}
        >
          {isBookmarked ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
        </button>
      </div>
    );
  }

  /* ── Featured (navy) card ─────────────────────────────── */
  if (card.isFeatured) {
    return (
      <>
        <div className="bg-white rounded-2xl shadow-md flex flex-col overflow-hidden h-full hover:shadow-lg transition-shadow">
          {/* Illustration */}
          <div className="relative h-[220px] shrink-0 bg-[#23297e] flex items-center justify-center">
            {card.featuredIllustration}
            <div className="absolute top-2.5 right-3">
              <TopControls light={true} />
            </div>
          </div>

          {/* Content */}
          <div className="flex flex-col flex-1 px-4 pb-4 pt-3 gap-2">
            <span className="font-['Poppins',sans-serif] font-bold text-[11px] uppercase tracking-wider" style={{ color: card.categoryColor }}>
              {card.category}
            </span>

            <h3 className="font-['Poppins',sans-serif] font-bold text-[15px] text-gray-900 leading-snug">
              {(card.targetUrl || card.authorLink) ? (
                <a href={card.targetUrl ?? card.authorLink} target="_blank" rel="noopener noreferrer" className="hover:underline hover:text-[#23297e] transition-colors">
                  {card.title}
                </a>
              ) : card.title}
            </h3>

            <p className="font-['Poppins',sans-serif] text-[13px] text-gray-600 leading-relaxed line-clamp-3 flex-1">
              {card.description}
            </p>

            {/* Boost count */}
            <p className="font-['Poppins',sans-serif] font-semibold text-[13px] text-[#de7c2d] pt-1">🔥 {boostLabel}</p>

            {/* Author + Buttons */}
            <div className="flex items-center justify-between gap-3 pt-1 border-t border-gray-100">
              <div className="flex items-center gap-2.5 min-w-0">
                {card.authorAvatar && (
                  <img src={card.authorAvatar} alt={card.authorName} className="w-8 h-8 rounded-full object-cover ring-1 ring-gray-200 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="font-['Poppins',sans-serif] font-semibold text-[12px] text-gray-800 truncate leading-tight">{card.authorName}</p>
                  <p className="font-['Poppins',sans-serif] text-[11px] text-gray-400 truncate leading-tight">{card.authorRole}</p>
                </div>
              </div>

              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={() => onBoost?.(card.id)}
                  className={`flex items-center gap-1 px-3.5 py-2 rounded-xl font-['Poppins',sans-serif] font-bold text-[13px] transition-all ${
                    isBoosted ? "bg-[#fd8e33]/80 text-white" : "bg-[#fd8e33] hover:bg-[#e07a28] text-white shadow-sm"
                  }`}
                >
                  🔥 {isBoosted ? "Boosted!" : "Boost"}
                </button>
                <button
                  onClick={() => setShareOpen(true)}
                  className="flex items-center justify-center px-2.5 py-2 rounded-xl border border-[#fd8e33] text-[#fd8e33] hover:bg-[#fd8e33]/10 transition-colors"
                >
                  <Share2 size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
        {shareOpen && (
          <ShareModal title={card.title} description={card.description} onClose={() => setShareOpen(false)} />
        )}
      </>
    );
  }

  /* ── Standard card ────────────────────────────────────── */
  return (
    <>
      <div className="bg-white rounded-2xl shadow-md flex flex-col overflow-hidden h-full hover:shadow-lg transition-shadow">
        {/* Top image */}
        {card.topImage ? (
          <div className="relative h-[220px] shrink-0">
            <img
              src={card.topImage}
              alt={card.title}
              className="w-full h-full object-cover"
            />
            {/* Gradient overlay for readability */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />

            {/* Pencil + Bookmark */}
            <div className="absolute top-2.5 right-3">
              <TopControls light={true} />
            </div>

            {/* Type tag */}
            {card.typeTag && (
              <div className="absolute top-2.5 left-3 bg-white/90 backdrop-blur-sm border border-[#fb00ff] rounded-lg px-2.5 py-0.5">
                <span className="font-['Poppins',sans-serif] font-bold text-[11px] text-[#fc20ff]">{card.typeTag}</span>
              </div>
            )}

            {/* Location badge on image */}
            {(card.isOnline || card.location) && (
              <div className="absolute bottom-2 right-3 flex items-center gap-1 bg-black/50 backdrop-blur-sm rounded-md px-2 py-0.5">
                {card.isOnline
                  ? <><Globe size={11} className="text-white" /><span className="font-['Poppins',sans-serif] text-[11px] text-white">Online</span></>
                  : <><MapPin size={11} className="text-white" /><span className="font-['Poppins',sans-serif] text-[11px] text-white">{card.location}</span></>
                }
              </div>
            )}
          </div>
        ) : (
          /* No image — show controls in top-right corner of card */
          <div className="relative h-8 shrink-0">
            <div className="absolute top-2 right-3">
              <TopControls light={false} />
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex flex-col flex-1 px-4 pb-4 pt-3 gap-2">
          {/* Category */}
          <span
            className="font-['Poppins',sans-serif] font-bold text-[11px] uppercase tracking-wider"
            style={{ color: card.categoryColor }}
          >
            {card.category}
          </span>

          {/* Title */}
          <h3 className="font-['Poppins',sans-serif] font-bold text-[15px] text-gray-900 leading-snug">
            {(card.targetUrl || card.authorLink) ? (
              <a href={card.targetUrl ?? card.authorLink} target="_blank" rel="noopener noreferrer" className="hover:underline hover:text-[#23297e] transition-colors">
                {card.title}
              </a>
            ) : card.title}
          </h3>

          {/* Description */}
          <p className="font-['Poppins',sans-serif] text-[13px] text-gray-600 leading-relaxed line-clamp-3 flex-1">
            {card.description}
          </p>

          {/* Boost count */}
          <p className="font-['Poppins',sans-serif] font-semibold text-[12px] text-[#de7c2d] pt-1">🔥 {boostLabel}</p>

          {/* Author + Buttons */}
          <div className="flex items-center justify-between gap-3 pt-1 border-t border-gray-100">
            {/* Author */}
            <div className="flex items-center gap-2.5 min-w-0">
              {card.authorAvatar && (
                <img
                  src={card.authorAvatar}
                  alt={card.authorName}
                  className="w-8 h-8 rounded-full object-cover ring-1 ring-gray-200 shrink-0"
                />
              )}
              <div className="min-w-0">
                <p className="font-['Poppins',sans-serif] font-semibold text-[12px] text-gray-800 truncate leading-tight">
                  {card.authorName}
                </p>
                {card.authorLink ? (
                  <a
                    href={card.authorLink}
                    className="font-['Poppins',sans-serif] text-[11px] text-[#23297e] underline truncate block hover:text-[#1a2060] leading-tight"
                  >
                    {card.authorRole}
                  </a>
                ) : (
                  <p className="font-['Poppins',sans-serif] text-[11px] text-gray-400 truncate leading-tight">
                    {card.authorRole}
                  </p>
                )}
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-1.5 shrink-0">
              <button
                onClick={() => onBoost?.(card.id)}
                className={`flex items-center gap-1 px-3.5 py-2 rounded-xl font-['Poppins',sans-serif] font-bold text-[13px] transition-all ${
                  isBoosted
                    ? "bg-[#fd8e33]/80 text-white"
                    : "bg-[#fd8e33] hover:bg-[#e07a28] text-white shadow-sm"
                }`}
              >
                🔥 {isBoosted ? "Boosted!" : "Boost"}
              </button>
              <button
                onClick={() => setShareOpen(true)}
                className="flex items-center justify-center px-2.5 py-2 rounded-xl border border-[#fd8e33] text-[#fd8e33] hover:bg-[#fd8e33]/10 transition-colors"
              >
                <Share2 size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
      {shareOpen && (
        <ShareModal title={card.title} description={card.description} onClose={() => setShareOpen(false)} />
      )}
    </>
  );
}