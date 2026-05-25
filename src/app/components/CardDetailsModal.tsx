import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, ExternalLink, Flame, Globe, MapPin, X } from "lucide-react";
import type { ActionCardData } from "./ActionCard";
import { ImageWithFallback } from "./figma/ImageWithFallback";

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
}

/**
 * Full-text card detail. Shown when the card's description is long enough that
 * `line-clamp-5` cuts it off in the grid view. Click the "Read more" link on a
 * card to open this; click overlay / Escape / X to close.
 */
export function CardDetailsModal({ card, onClose, onShare, onComplete, isCompleted, onBoost, isBoosted }: CardDetailsModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const link = card.targetUrl ?? card.authorLink;

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
        className="hero-modal-card relative w-full max-w-[560px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-gray-600 backdrop-blur-sm transition-colors hover:bg-white hover:text-[#23297e]"
        >
          <X size={20} />
        </button>

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
          </div>
        )}

        <div className="p-5 sm:p-7">
          {/* Category */}
          <span
            className="font-['Poppins',sans-serif] font-bold text-[11px] tracking-wide"
            style={{ color: card.categoryColor }}
          >
            {card.category}
          </span>

          {/* Title — scaled down from the previous 22/26px which wrapped 4–5
              lines for long titles on narrow viewports. 17/20 keeps the heading
              authoritative without taking over the modal. */}
          <h2
            id="card-details-title"
            className="mt-1.5 font-['Poppins',sans-serif] font-bold text-[17px] sm:text-[20px] text-gray-900 leading-snug"
          >
            {card.title}
          </h2>

          {/* Author */}
          <div className="mt-2 flex items-center gap-2.5">
            {card.authorAvatar && (
              <ImageWithFallback
                src={card.authorAvatar}
                alt={card.authorName}
                className="w-8 h-8 rounded-full object-cover ring-1 ring-gray-200"
              />
            )}
            <div className="min-w-0">
              <p className="font-['Poppins',sans-serif] font-semibold text-[13px] text-gray-800 leading-tight">{card.authorName}</p>
              <p className="font-['Poppins',sans-serif] text-[12px] text-gray-500 leading-tight">{card.authorRole}</p>
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
                  (teal when complete, light teal when idle). */}
              {onComplete && (
                <button
                  onClick={() => onComplete(card.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 font-['Poppins',sans-serif] text-sm font-bold transition-colors ${
                    isCompleted
                      ? "bg-[#0d8c6e] text-white hover:bg-[#0a7159]"
                      : "bg-[#0d8c6e]/10 text-[#0d8c6e] hover:bg-[#0d8c6e]/20"
                  }`}
                >
                  <CheckCircle2 size={14} />
                  {isCompleted ? "Done · undo" : "I did this!"}
                </button>
              )}

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
            </div>

            {/* Primary CTA — right-anchored so it reads as the "go do it" call */}
            {onShare ? (
              <button
                onClick={() => { onClose(); onShare(); }}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#ed6624] px-5 py-2.5 font-['Poppins',sans-serif] text-sm font-bold text-white transition-colors hover:bg-[#c2521b]"
              >
                <Flame size={14} /> Spread the Word!
              </button>
            ) : link ? (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
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
