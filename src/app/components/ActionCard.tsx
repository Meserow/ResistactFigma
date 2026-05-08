import { useEffect, useState } from "react";
import { Bookmark, BookmarkCheck, Globe, MapPin, Pencil, Share2 } from "lucide-react";
import { ShareModal } from "./ShareModal";
import { ImageWithFallback } from "./figma/ImageWithFallback";

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
  boosts: number;
  completions?: number;
  spotsTotal: number | "Unlimited";
  authorName: string;
  authorRole: string;
  authorLink?: string;
  topImage?: string;
  authorAvatar?: string;
  isFeatured?: boolean;
  featuredIllustration?: React.ReactNode;
  createdBy?: string;
  /** True for actions that take ~5–10 minutes — drives the "Quick wins" filter. */
  quickAction?: boolean;
  /** When true, fit the top image inside the header (object-contain) instead of cropping. Use for logo-style art. */
  imageContain?: boolean;
  /** False = awaiting admin review; true / undefined = visible to all users. */
  adminApproved?: boolean;
  /** ISO date string (YYYY-MM-DD). Cards with a past date are hidden; upcoming ones sort to the top. */
  eventDate?: string;
}

interface ActionCardProps {
  card: ActionCardData;
  onBoost?: (id: number) => void;
  onComplete?: (id: number) => void;
  onShare?: (id: number) => void;
  onBookmark?: (id: number) => void;
  onEdit?: (id: number) => void;
  isBoosted?: boolean;
  isCompleted?: boolean;
  isBookmarked?: boolean;
  canEdit?: boolean;
}

export function ActionCard({ card, onBoost, onComplete, onShare, onBookmark, onEdit, isBoosted, isCompleted, isBookmarked, canEdit }: ActionCardProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => { setImageFailed(false); }, [card.topImage]);
  const showTopImage = !!card.topImage && !imageFailed;

  const completionsCount = card.completions ?? 0;

  // ── "I did this" pill — overlaid on the header image so it reads on any
  //    background. Uses a translucent white capsule with a green check.
  function CompletionPill({ onImage = false }: { onImage?: boolean }) {
    const completedClasses = "bg-[#0d8c6e] text-white shadow-md hover:bg-[#0a7159]";
    const idleOnImageClasses =
      "bg-white/85 backdrop-blur-sm text-[#0d8c6e] shadow-sm hover:bg-white";
    const idleOffImageClasses =
      "bg-[#0d8c6e]/10 text-[#0d8c6e] hover:bg-[#0d8c6e]/20";

    return (
      <button
        onClick={(e) => { e.stopPropagation(); onComplete?.(card.id); }}
        title={isCompleted ? 'Undo "I did this"' : 'Mark as done'}
        aria-label={isCompleted ? "Undo I did this" : "I did this"}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-['Poppins',sans-serif] font-bold text-[12px] transition-all ${
          isCompleted ? completedClasses : (onImage ? idleOnImageClasses : idleOffImageClasses)
        }`}
      >
        {isCompleted && <span aria-hidden>✓</span>}
        <span>{isCompleted ? "Did it!" : "I did this"}</span>
        {(() => {
          const n = Math.max(completionsCount, isCompleted ? 1 : 0);
          return n > 0 ? <span className="opacity-80">· {n.toLocaleString()}</span> : null;
        })()}
      </button>
    );
  }

  // ── Boost button — sibling of CompletionPill in style. Used as the image
  //    overlay (translucent white pill) and as the inline action when there
  //    is no header image.
  function BoostButton({ onImage = false }: { onImage?: boolean }) {
    const boostedClasses = "bg-[#fd8e33]/80 text-white shadow-md";
    const idleOnImageClasses =
      "bg-white/85 backdrop-blur-sm text-[#fd8e33] shadow-sm hover:bg-white";
    const idleOffImageClasses =
      "bg-[#fd8e33]/10 text-[#fd8e33] hover:bg-[#fd8e33]/20";

    return (
      <button
        onClick={(e) => { e.stopPropagation(); onBoost?.(card.id); }}
        aria-label={isBoosted ? "Boosted" : "Boost"}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-['Poppins',sans-serif] font-bold text-[12px] transition-all ${
          isBoosted ? boostedClasses : (onImage ? idleOnImageClasses : idleOffImageClasses)
        }`}
      >
        <span aria-hidden>🔥</span>
        <span>{isBoosted ? "Boosted!" : "Boost"}</span>
        {(() => {
          const n = Math.max(card.boosts ?? 0, isBoosted ? 1 : 0);
          return n > 0 ? <span className="opacity-80">· {n.toLocaleString()}</span> : null;
        })()}
      </button>
    );
  }

  // ── Floating share button (top-right of content area, below image) ───────
  function FloatingShareButton() {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setShareOpen(true); }}
        title="Share"
        aria-label={`Share ${card.title}`}
        className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-full bg-white/90 backdrop-blur-sm text-gray-500 hover:text-[#fd8e33] hover:bg-white transition-colors z-10"
      >
        <Share2 size={13} />
      </button>
    );
  }

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
            <div className="absolute bottom-2 left-3 z-10">
              <BoostButton onImage />
            </div>
          </div>

          {/* Content */}
          <div className="relative flex flex-col flex-1 px-4 pb-4 pt-3 gap-2">
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

            {/* Author + Boost button */}
            <div className="flex items-center justify-between gap-3 pt-1 border-t border-gray-100">
              <div className="flex items-center gap-2.5 min-w-0">
                {card.authorAvatar && (
                  <ImageWithFallback src={card.authorAvatar} alt={card.authorName} className="w-8 h-8 rounded-full object-cover ring-1 ring-gray-200 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="font-['Poppins',sans-serif] font-semibold text-[12px] text-gray-800 truncate leading-tight">{card.authorName}</p>
                  <p className="font-['Poppins',sans-serif] text-[11px] text-gray-400 truncate leading-tight">{card.authorRole}</p>
                </div>
              </div>

              <CompletionPill />
            </div>

            <FloatingShareButton />
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
        {showTopImage ? (
          <div className={`relative h-[220px] shrink-0 ${card.imageContain ? "bg-gray-50" : ""}`}>
            <ImageWithFallback
              src={card.topImage}
              alt={card.title}
              className={`w-full h-full ${card.imageContain ? "object-contain p-2" : "object-cover"}`}
              onError={() => setImageFailed(true)}
            />
            {/* Gradient overlay for readability — skipped for logo-fit cards. */}
            {!card.imageContain && (
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
            )}

            {/* Stretched link — image area opens the same URL as the title.
                Placed before badges/buttons so they remain clickable. */}
            {(card.targetUrl || card.authorLink) && (
              <a
                href={card.targetUrl ?? card.authorLink}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={card.title}
                className="absolute inset-0"
              />
            )}

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

            {/* "I did this" — overlaid bottom-left so it reads across image styles */}
            <div className="absolute bottom-2 left-3 z-10">
              <BoostButton onImage />
            </div>
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
        <div className="relative flex flex-col flex-1 px-4 pb-4 pt-3 gap-2">
          {/* Floating share button — top-right of content area, below header. */}
          <FloatingShareButton />

          {/* Category */}
          <span
            className="font-['Poppins',sans-serif] font-bold text-[11px] uppercase tracking-wider"
            style={{ color: card.categoryColor }}
          >
            {card.category}
          </span>

          {/* Title */}
          <h3 className="font-['Poppins',sans-serif] font-bold text-[15px] text-gray-900 leading-snug pr-8">
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

          {/* Cards without a header image — show "I did this" inline since
              we have no image to overlay it on. */}
          {!showTopImage && <BoostButton />}

          {/* Author + Boost button */}
          <div className="flex items-center justify-between gap-3 pt-1 border-t border-gray-100">
            {/* Author */}
            <div className="flex items-center gap-2.5 min-w-0">
              {card.authorAvatar && (
                <ImageWithFallback
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

            <CompletionPill />
          </div>
        </div>
      </div>
      {shareOpen && (
        <ShareModal title={card.title} description={card.description} onClose={() => setShareOpen(false)} />
      )}
    </>
  );
}