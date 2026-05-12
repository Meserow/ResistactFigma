import { useEffect, useRef } from "react";
import { ExternalLink, Flame, Globe, MapPin, X } from "lucide-react";
import type { ActionCardData } from "./ActionCard";
import { ImageWithFallback } from "./figma/ImageWithFallback";

interface CardDetailsModalProps {
  card: ActionCardData;
  onClose: () => void;
  onShare?: () => void;
}

/**
 * Full-text card detail. Shown when the card's description is long enough that
 * `line-clamp-5` cuts it off in the grid view. Click the "Read more" link on a
 * card to open this; click overlay / Escape / X to close.
 */
export function CardDetailsModal({ card, onClose, onShare }: CardDetailsModalProps) {
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="card-details-title"
      onClick={onClose}
      className="hero-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-[#0d1b2a]/60 p-4 sm:p-6"
    >
      <div
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
        className="hero-modal-card relative w-full max-w-[640px] max-h-[90vh] overflow-y-auto rounded-[12px] bg-white shadow-2xl"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-gray-600 backdrop-blur-sm transition-colors hover:bg-white hover:text-[#23297e]"
        >
          <X size={20} />
        </button>

        {/* Header image */}
        {card.topImage && (
          <div className={`relative h-[200px] sm:h-[260px] shrink-0 ${card.imageContain ? "bg-gray-50" : ""}`}>
            <ImageWithFallback
              src={card.topImage}
              alt={card.title}
              className={`w-full h-full ${card.imageContain ? "object-contain p-3" : "object-cover"}`}
            />
            {!card.imageContain && (
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
            )}
            {(card.isOnline || card.location) && (
              <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-black/55 backdrop-blur-sm rounded-md px-2.5 py-1">
                {card.isOnline
                  ? <><Globe size={12} className="text-white" /><span className="font-['Poppins',sans-serif] text-[12px] text-white">Online</span></>
                  : <><MapPin size={12} className="text-white" /><span className="font-['Poppins',sans-serif] text-[12px] text-white">{card.location}</span></>
                }
              </div>
            )}
          </div>
        )}

        <div className="p-6 sm:p-8">
          {/* Category */}
          <span
            className="font-['Poppins',sans-serif] font-bold text-[11px] uppercase tracking-wider"
            style={{ color: card.categoryColor }}
          >
            {card.category}
          </span>

          {/* Title */}
          <h2
            id="card-details-title"
            className="mt-2 font-['Poppins',sans-serif] font-bold text-[22px] sm:text-[26px] text-gray-900 leading-tight"
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

          {/* Primary action */}
          {onShare ? (
            <button
              onClick={() => { onClose(); onShare(); }}
              className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-[#fd8e33] px-5 py-2.5 font-['Poppins',sans-serif] text-sm font-bold text-white transition-colors hover:bg-[#d96612]"
            >
              <Flame size={14} /> Spread the Word!
            </button>
          ) : link ? (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-[#fd8e33] px-5 py-2.5 font-['Poppins',sans-serif] text-sm font-bold text-white transition-colors hover:bg-[#d96612]"
            >
              Take this action <ExternalLink size={14} />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
