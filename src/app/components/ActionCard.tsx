import { memo, useEffect, useState } from "react";
import { Bookmark, BookmarkCheck, Flame, Globe, MapPin, Pencil, Share2 } from "lucide-react";
import { ShareModal } from "./ShareModal";
import { SpreadTheWordModal } from "./SpreadTheWordModal";
import { CardDetailsModal } from "./CardDetailsModal";
import { ImageWithFallback } from "./figma/ImageWithFallback";

// Approximate threshold for when the description gets clamped in the grid view.
// We use a character count rather than measuring DOM because measuring on every
// card render is overkill and ResizeObserver is overkill-er. ~150 chars roughly
// matches what fits in a 3-line clamp at 13px / 4-col grid.
const READ_MORE_THRESHOLD = 150;

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
  /** When true, this card always renders first in every sort/filter view —
   * even ahead of the matcher's score. Reserved for the canonical
   * "Spread the Word about ResistAct" pinned card. */
  pinToTop?: boolean;
  /** When true, fit the top image inside the header (object-contain) instead of cropping. Use for logo-style art. */
  imageContain?: boolean;
  /** False = awaiting admin review; true / undefined = visible to all users. */
  adminApproved?: boolean;
  /** Curated for "Today's Five" — actions that are <5 min, fun, easy, and
   * location-agnostic so a brand-new anonymous visitor can do them right
   * away without needing to log in or share their location. Hand-flagged
   * by admins via the admin panel. */
  firstTimerFriendly?: boolean;
  /** Last automated URL health check result. False = link is broken /
   * 404s — card is auto-pulled from the public feed until an admin
   * fixes the URL and re-approves. */
  urlOk?: boolean;
  urlCheckedAt?: string;
  /** ISO date string (YYYY-MM-DD). Cards with a past date are hidden; upcoming ones sort to the top. */
  eventDate?: string;
  /** True for actions you can do without leaving your house (knit, write
   * letters, call reps, sew flags). Overlaps with `isOnline` — anything online
   * is also at-home — but `atHome` covers offline-but-still-at-home tasks. */
  atHome?: boolean;
  /** Per-card override for the matcher's tone vector. Partial — fields you
   * don't set fall back to the category's default. Each value 0–3.
   * Use to fix cards whose category default doesn't fit them. */
  toneOverride?: {
    anger?: number;
    comedy?: number;
    subversion?: number;
    care?: number;
    hope?: number;
    energy?: number;
  };
  /** Groups this card especially serves — their voice carries extra weight
   * when they pick this card. Unioned with the category-level amplification
   * rule in `assessRisk`. Useful for cards whose category alone doesn't
   * capture who it's for (e.g. a Crafting card making letters for trans kids).
   * Stored as plain strings (rather than `VulnerableGroup[]`) so old cards
   * persisted before new groups were added still typecheck. */
  amplifiesGroups?: string[];
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
  /** Smaller image + tighter padding + 2-line description. Used inside the
   * Match Me sample preview so cards read as previews, not as the main event. */
  compact?: boolean;
}

function ActionCardInner({ card, onBoost, onComplete, onShare, onBookmark, onEdit, isBoosted, isCompleted, isBookmarked, canEdit, compact = false }: ActionCardProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => { setImageFailed(false); }, [card.topImage]);
  const showTopImage = !!card.topImage && !imageFailed;

  const isDescriptionLong = (card.description?.length ?? 0) > READ_MORE_THRESHOLD;

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
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-['Poppins',sans-serif] font-bold text-[12px] whitespace-nowrap shrink-0 transition-all ${
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
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-['Poppins',sans-serif] font-bold text-[12px] whitespace-nowrap shrink-0 transition-all ${
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
        title={card.pinToTop ? "Spread the word!" : "Share"}
        aria-label={`Share ${card.title}`}
        className={`absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-full backdrop-blur-sm transition-colors z-10 ${
          card.pinToTop
            ? "bg-[#fd8e33] text-white hover:bg-[#d96612]"
            : "bg-white/90 text-gray-500 hover:text-[#fd8e33] hover:bg-white"
        }`}
      >
        {card.pinToTop ? <Flame size={13} /> : <Share2 size={13} />}
      </button>
    );
  }

  // ── Shared top-right controls (pencil + bookmark) ──────────────────────────
  // On image (`light`), the icons sit inside a translucent dark pill so they
  // stay legible regardless of the photo behind them — bright/light images
  // were swallowing the white icon previously.
  function TopControls({ light = true }: { light?: boolean }) {
    const btnCls = light
      ? "w-7 h-7 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm text-white hover:bg-black/55 transition-colors"
      : "text-gray-500 hover:text-[#23297e] transition-colors";
    return (
      <div className="flex items-center gap-1">
        {canEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); onEdit?.(card.id); }}
            title="Edit this act"
            className={btnCls}
          >
            <Pencil size={14} />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onBookmark?.(card.id); }}
          aria-label={isBookmarked ? "Remove bookmark" : "Bookmark"}
          className={btnCls}
        >
          {isBookmarked ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
        </button>
      </div>
    );
  }

  /* ── Featured (navy) card ─────────────────────────────── */
  if (card.isFeatured) {
    return (
      <>
        <div
          className={`bg-white rounded-2xl shadow-md flex flex-col overflow-hidden h-full hover:shadow-lg transition-shadow ${card.pinToTop ? "cursor-pointer" : ""}`}
          onClick={card.pinToTop ? () => setShareOpen(true) : undefined}
        >
          {/* Illustration — use uploaded image if available, else navy illustration */}
          <div className="relative h-[160px] shrink-0 bg-[#23297e] flex items-center justify-center overflow-hidden">
            {card.topImage
              ? <img src={card.topImage} alt={card.title} className="absolute inset-0 w-full h-full object-cover" />
              : card.featuredIllustration
            }
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

            {isDescriptionLong && (
              <button
                onClick={(e) => { e.stopPropagation(); setDetailsOpen(true); }}
                className="self-start font-['Poppins',sans-serif] italic text-[11px] font-medium text-[#fd8e33] underline underline-offset-2 decoration-[#fd8e33]/40 hover:decoration-[#fd8e33]"
              >
                Read more →
              </button>
            )}

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
          card.pinToTop
            ? <SpreadTheWordModal onClose={() => setShareOpen(false)} />
            : <ShareModal title={card.title} description={card.description} onClose={() => setShareOpen(false)} />
        )}
        {detailsOpen && (
          <CardDetailsModal card={card} onClose={() => setDetailsOpen(false)} />
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
          <div className={`relative ${compact ? "h-[80px]" : "h-[160px]"} shrink-0 ${card.imageContain ? "bg-gray-50" : ""}`}>
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

            {/* Pencil + Bookmark — hidden in compact preview mode. */}
            {!compact && (
              <div className="absolute top-2.5 right-3">
                <TopControls light={true} />
              </div>
            )}

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

            {/* "I did this" — hidden in compact preview mode. */}
            {!compact && (
              <div className="absolute bottom-2 left-3 z-10">
                <BoostButton onImage />
              </div>
            )}
          </div>
        ) : (
          /* No image — show controls in top-right corner of card (skip in compact mode). */
          !compact && (
            <div className="relative h-8 shrink-0">
              <div className="absolute top-2 right-3">
                <TopControls light={false} />
              </div>
            </div>
          )
        )}

        {/* Content */}
        <div className={`relative flex flex-col flex-1 ${compact ? "gap-1 px-3 pb-2 pt-1.5" : "gap-2 px-4 pb-4 pt-3"}`}>
          {/* Floating share button — top-right of content area, below header. Hidden in compact. */}
          {!compact && <FloatingShareButton />}

          {/* Category */}
          <span
            className={`font-['Poppins',sans-serif] font-bold uppercase tracking-wider ${compact ? "text-[10px]" : "text-[11px]"}`}
            style={{ color: card.categoryColor }}
          >
            {card.category}
          </span>

          {/* Title */}
          <h3 className={`font-['Poppins',sans-serif] font-bold text-gray-900 leading-snug pr-8 ${compact ? "text-[13px]" : "text-[15px]"}`}>
            {(card.targetUrl || card.authorLink) ? (
              <a href={card.targetUrl ?? card.authorLink} target="_blank" rel="noopener noreferrer" className="hover:underline hover:text-[#23297e] transition-colors">
                {card.title}
              </a>
            ) : card.title}
          </h3>

          {/* Description */}
          <p className={`font-['Poppins',sans-serif] text-gray-600 leading-relaxed flex-1 ${compact ? "text-[12px] line-clamp-1" : "text-[13px] line-clamp-3"}`}>
            {card.description}
          </p>

          {/* Universal Know-Your-Rights chip on PROTEST / FLASH MOB cards in
              the main feed. Hidden in compact (sample matches) mode to keep
              the modal short — users will see it when they open the card. */}
          {!compact && (() => {
            const cat = (card.category ?? "").toUpperCase();
            if (cat !== "PROTEST" && cat !== "FLASH MOB") return null;
            return (
              <a
                href="https://www.aclu.org/know-your-rights/protesters-rights"
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="self-start inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 font-['Poppins',sans-serif] text-[11px] font-semibold text-amber-800 hover:bg-amber-100 transition-colors"
                title="ACLU protesters' rights guide"
              >
                ⚠ In-person — know your rights
              </a>
            );
          })()}

          {isDescriptionLong && (
            <button
              onClick={(e) => { e.stopPropagation(); setDetailsOpen(true); }}
              className="self-start font-['Poppins',sans-serif] text-[12px] font-semibold text-[#23297e] hover:underline"
            >
              Read more →
            </button>
          )}

          {/* Cards without a header image — show "I did this" inline since
              we have no image to overlay it on. Skipped in compact mode so
              the mini card stays a focused preview. */}
          {!showTopImage && !compact && <BoostButton />}

          {/* Author + Boost button — hidden in compact mode (mini preview). */}
          {!compact && (
            <div className="flex items-center justify-between gap-3 pt-1 border-t border-gray-100">
              {/* Author */}
              <div className="flex items-center gap-2.5 min-w-0">
                {card.authorAvatar && (
                  <ImageWithFallback
                    src={card.authorAvatar}
                    alt={card.authorName}
                    className="rounded-full object-cover ring-1 ring-gray-200 shrink-0 w-8 h-8"
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
          )}
        </div>
      </div>
      {shareOpen && (
        <ShareModal title={card.title} description={card.description} onClose={() => setShareOpen(false)} />
      )}
      {detailsOpen && (
        <CardDetailsModal card={card} onClose={() => setDetailsOpen(false)} />
      )}
    </>
  );
}

// Memoised wrapper — skips re-render when none of the props changed. The big
// win is during search-typing: setSearchQuery triggers a parent re-render, but
// the cards' own props (card, isBoosted, etc.) haven't moved, so memo bails
// out and we skip ~400 ActionCard renders per keystroke.
export const ActionCard = memo(ActionCardInner);