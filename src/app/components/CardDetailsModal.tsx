import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bookmark, BookmarkCheck, CheckCircle2, ExternalLink, Flag, Flame, Globe, MapPin, Share2, X } from "lucide-react";
import type { ActionCardData } from "./ActionCard";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { colorForCategory } from "../lib/categoryGroups";

interface CardDetailsModalProps {
  card: ActionCardData;
  onClose: () => void;
  onShare?: () => void;
  /** "I did this!" toggle handler. When passed, the modal renders the
      completion pill below the primary action. */
  onComplete?: (id: number) => void;
  isCompleted?: boolean;
  /** Boost handler — mirrors the on-card boost button so the user can
      boost from inside the modal without dismissing it. */
  onBoost?: (id: number) => void;
  isBoosted?: boolean;
  /** Bookmark handler + state — surfaced in the modal action row with
      a labeled button so users discover the bookmark feature (it used
      to be just an icon at the top of the card). */
  onBookmark?: (id: number) => void;
  isBookmarked?: boolean;
  /** Flag handler — opens the FlagCardModal. When provided the modal
      renders a small flag icon button at top-right. Skipped for the
      pinned Spread the Word card. */
  onFlag?: () => void;
}

/**
 * Full-text card detail. Shown when the card's description is long enough that
 * `line-clamp-5` cuts it off in the grid view. Click the "Read more" link on a
 * card to open this; click overlay / Escape / X to close.
 */
export function CardDetailsModal({ card, onClose, onShare, onComplete, isCompleted, onBoost, isBoosted, onBookmark, isBookmarked, onFlag }: CardDetailsModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Return-from-action prompt: when the user clicks the primary "I want
  // to ResistAct!" link, the target opens in a new tab and we set a
  // pending flag. When they come back (visibilitychange → visible), we
  // surface a "Mark this action: I did this?" prompt in place of the
  // link-out so they can confirm completion in one click. Doesn't show
  // for cards that are already completed.
  const clickedLinkRef = useRef(false);
  const [showDonePrompt, setShowDonePrompt] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onVisible = () => {
      if (document.visibilityState === "visible" && clickedLinkRef.current && !isCompleted) {
        setShowDonePrompt(true);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisible);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, isCompleted]);

  const link = card.targetUrl ?? card.authorLink;
  // Canonical category color — keeps the modal banner pill aligned with the
  // grid card pill and the Navbar filter chip.
  const categoryColor = colorForCategory(card.category);
  // Spread the Word doesn't carry a real category — hide the pill on it.
  const showCategoryPill = !!card.category && !card.pinToTop;

  // CRITICAL: render through a portal to document.body so the modal escapes
  // any ancestor's CSS `transform` containing block. ActionCard applies a
  // hover transform (translate + scale + rotate) which, when the user clicks
  // "Read more" while still hovering the card, makes `position: fixed`
  // resolve relative to the card instead of the viewport. The visible
  // symptom: the modal renders INSIDE the card cell rather than centered
  // over the page. createPortal hoists the modal DOM out of the card's
  // subtree so `fixed` works as intended.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="card-details-title"
      onClick={onClose}
      className="hero-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-[#0d1b2a]/80 backdrop-blur-sm p-4 sm:p-6"
    >
      <div
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
        className="hero-modal-card relative w-full max-w-[720px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl"
      >
        {/* Utility cluster — bookmark, flag, share, close. All icon-only,
            sit in the modal header so secondary actions stay out of the
            way of the primary action row at the bottom. */}
        <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5">
          {onBookmark && (
            <button
              onClick={() => onBookmark(card.id)}
              title={isBookmarked ? "Remove bookmark" : "Bookmark"}
              aria-label={isBookmarked ? "Remove bookmark" : "Bookmark"}
              className={`flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-sm transition-colors ${
                isBookmarked
                  ? "bg-[#23297e] text-white hover:bg-[#1a2060]"
                  : "bg-white/80 text-gray-600 hover:bg-white hover:text-[#23297e]"
              }`}
            >
              {isBookmarked ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
            </button>
          )}
          {onFlag && (
            <button
              onClick={() => { onClose(); onFlag(); }}
              title="Report a problem with this act"
              aria-label="Report"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-gray-500 backdrop-blur-sm transition-colors hover:bg-white hover:text-red-500"
            >
              <Flag size={15} />
            </button>
          )}
          {onShare && (
            <button
              onClick={() => { onClose(); onShare(); }}
              title="Share"
              aria-label="Share"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-gray-600 backdrop-blur-sm transition-colors hover:bg-white hover:text-[#ed6624]"
            >
              <Share2 size={15} />
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-gray-600 backdrop-blur-sm transition-colors hover:bg-white hover:text-[#23297e]"
          >
            <X size={20} />
          </button>
        </div>

        {/* Header image — large on desktop (360px) so the banner reads as a
            real piece of the experience, not a thumbnail. Phone still
            moderate (180px) so the title + buttons stay above the fold on
            small screens. Modal capped at max-h-[90vh] either way — content
            scrolls inside if it overflows. */}
        {card.topImage && (
          <div className={`relative h-[180px] sm:h-[360px] shrink-0 ${card.imageContain ? "bg-gray-50" : ""}`}>
            <ImageWithFallback
              src={card.topImage}
              alt={card.title}
              className={`w-full h-full ${card.imageContain ? "object-contain p-3" : "object-cover object-top"}`}
            />
            {!card.imageContain && (
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
            )}
            {(card.isOnline || card.location) && (
              <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-white/95 backdrop-blur-sm rounded-md px-2.5 py-1 shadow-sm">
                {card.isOnline
                  ? <><Globe size={12} className="text-gray-700" /><span className="font-['Poppins',sans-serif] text-[12px] text-gray-700">Online</span></>
                  : <><MapPin size={12} className="text-gray-700" /><span className="font-['Poppins',sans-serif] text-[12px] text-gray-700">{card.location}</span></>
                }
              </div>
            )}
            {/* Category pill — top-left of the banner, matches the on-card
                placement so the modal feels like a zoomed-in card. */}
            {showCategoryPill && (
              <div
                className="absolute top-3 left-3 inline-flex items-center rounded-md px-2.5 py-1 shadow-sm"
                style={{ backgroundColor: categoryColor }}
              >
                <span className="font-['Poppins',sans-serif] font-bold tracking-wide text-[12px] text-white">
                  {card.category}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="p-5 sm:p-7">

          {/* Title + Author row — title takes the left column, author sits
              to its right and aligns to the bottom of the title block so
              long titles stack on top of the author info naturally. Stacks
              vertically on phone where horizontal room runs out. */}
          <div className="mt-1.5 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <h2
              id="card-details-title"
              className="font-['Poppins',sans-serif] font-bold text-[17px] sm:text-[20px] text-gray-900 leading-snug flex-1 min-w-0"
            >
              {card.title}
            </h2>

            {/* Author block — right-aligned on desktop so it reads as a
                supporting attribution next to the title. */}
            <div className="flex items-center gap-2.5 shrink-0 sm:justify-end">
              {card.authorAvatar && (
                <ImageWithFallback
                  src={card.authorAvatar}
                  alt={card.authorName}
                  className="w-8 h-8 rounded-full object-cover ring-1 ring-gray-200"
                />
              )}
              <div className="min-w-0 sm:text-right">
                <p className="font-['Poppins',sans-serif] font-semibold text-[13px] text-gray-800 leading-tight">{card.authorName}</p>
                <p className="font-['Poppins',sans-serif] text-[12px] text-gray-500 leading-tight">{card.authorRole}</p>
              </div>
            </div>
          </div>

          {/* Full description — preserves line breaks from the source. */}
          <p className="mt-5 font-['Poppins',sans-serif] text-[15px] text-gray-700 leading-[1.65] whitespace-pre-wrap">
            {card.description}
          </p>

          {/* Know-Your-Rights chip — surfaces a safety reminder right
              before the user takes action on a PROTEST or FLASH MOB
              card. Lived on the grid card itself in older builds; moved
              here so the chip lands in the same field of view as the
              "I want to ResistAct!" link-out. */}
          {(() => {
            const cat = (card.category ?? "").toUpperCase();
            if (cat !== "PROTEST" && cat !== "FLASH MOB") return null;
            return (
              <a
                href="https://www.aclu.org/know-your-rights/protesters-rights"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 self-start inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 font-['Poppins',sans-serif] text-[12px] font-semibold text-amber-800 hover:bg-amber-100 transition-colors"
                title="ACLU protesters' rights guide"
              >
                ⚠ In-person — know your rights
              </a>
            );
          })()}

          {/* Action row — secondary actions ("I did this!" + Boost) cluster
              on the left, primary link-out ("I want to ResistAct!") anchors
              on the right so the eye lands on the primary CTA last. Wraps
              to a single column on narrow viewports. */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {/* "I did this!" toggle — same color identity as the on-card pill
                  (teal when complete, light teal when idle). Shows the running
                  done count so users see the social proof + their own click. */}
              {onComplete && (() => {
                const baseCount = card.completions ?? 0;
                const displayedCount = Math.max(baseCount, isCompleted ? 1 : 0);
                return (
                  <button
                    onClick={() => onComplete(card.id)}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 font-['Poppins',sans-serif] text-[13px] font-bold transition-colors ${
                      isCompleted
                        ? "bg-[#0d8c6e] text-white hover:bg-[#0a7159]"
                        : "bg-[#0d8c6e]/10 text-[#0d8c6e] hover:bg-[#0d8c6e]/20"
                    }`}
                  >
                    <CheckCircle2 size={14} />
                    {isCompleted ? "Done · undo" : "I did this!"}
                    {displayedCount > 0 && <span className="opacity-80">· {displayedCount}</span>}
                  </button>
                );
              })()}

              {/* Boost — orange identity, mirrors the on-image boost button. */}
              {onBoost && (
                <button
                  onClick={() => onBoost(card.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 font-['Poppins',sans-serif] text-sm font-bold transition-colors ${
                    isBoosted
                      ? "bg-[#ed6624]/80 text-white hover:bg-[#ed6624]"
                      : "bg-[#ed6624]/10 text-[#ed6624] hover:bg-[#ed6624]/20"
                  }`}
                >
                  <Flame size={14} />
                  {isBoosted ? "Boosted" : "Boost"}
                  {typeof card.boosts === "number" && card.boosts > 0 ? <span className="opacity-80">· {card.boosts}</span> : null}
                </button>
              )}

              {/* Bookmark moved to the modal header utility cluster (icon-
                  only). Keeping it out of the action row gives the other
                  buttons more room. */}
            </div>

            {/* Primary CTA — right-anchored so it reads as the "go do it" call.
                Spread the Word (pinToTop) gets its own "Spread the Word!"
                button that re-opens the share dialog as the primary action.
                Every other card link-outs to the targetUrl/authorLink.

                When the user returns to this tab after clicking the link
                (clickedLinkRef + visibilitychange handler in the effect
                above), the link transforms into a "Mark this action: I
                did this?" prompt so they can confirm completion in one
                click without re-finding the on-card button. */}
            {card.pinToTop && onShare ? (
              <button
                onClick={() => { onClose(); onShare(); }}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#ed6624] px-5 py-2.5 font-['Poppins',sans-serif] text-sm font-bold text-white transition-colors hover:bg-[#c2521b]"
              >
                <Flame size={14} /> Spread the Word!
              </button>
            ) : showDonePrompt && onComplete ? (
              <button
                onClick={() => { onComplete(card.id); setShowDonePrompt(false); }}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#0d8c6e] px-5 py-2.5 font-['Poppins',sans-serif] text-sm font-bold text-white transition-colors hover:bg-[#0a7159]"
              >
                <CheckCircle2 size={14} /> Mark this action: I did this?
              </button>
            ) : link ? (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => { clickedLinkRef.current = true; }}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#ed6624] px-5 py-2.5 font-['Poppins',sans-serif] text-sm font-bold text-white transition-colors hover:bg-[#c2521b]"
              >
                I want to ResistAct! <ExternalLink size={14} />
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
