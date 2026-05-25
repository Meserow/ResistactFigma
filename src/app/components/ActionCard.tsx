import { memo, useEffect, useState } from "react";
import { Bookmark, BookmarkCheck, CheckCircle2, Clock, Flag, Flame, Globe, MapPin, Pencil, Share2 } from "lucide-react";
import { useHasChanged } from "../lib/animations";
import { ShareModal } from "./ShareModal";
import { SpreadTheWordModal } from "./SpreadTheWordModal";
import { CardDetailsModal } from "./CardDetailsModal";
import { FlagCardModal } from "./FlagCardModal";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import cardFallbackImg from "../../assets/resistact-card-fallback.webp";

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
  onApprove?: (id: number) => void;
  onInfoClick?: () => void;
  isBoosted?: boolean;
  isCompleted?: boolean;
  isBookmarked?: boolean;
  canEdit?: boolean;
  /** When true (admin-only), renders a red PENDING APPROVAL banner with a
   * one-click approve button at the top of the card. */
  isPending?: boolean;
  /** Smaller image + tighter padding + 2-line description. Used inside the
   * Match Me sample preview so cards read as previews, not as the main event. */
  compact?: boolean;
  /** Supabase access token for authenticated flag submissions. Anonymous
   * users can still flag (anon key is used). */
  accessToken?: string | null;
}

function ActionCardInner({ card, onBoost, onComplete, onShare, onBookmark, onEdit, onApprove, onInfoClick, isBoosted, isCompleted, isBookmarked, canEdit, isPending, compact = false, accessToken }: ActionCardProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  function openShare() {
    setShareOpen(true);
  }
  const [flagOpen, setFlagOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => { setImageFailed(false); }, [card.topImage]);
  const showTopImage = !!card.topImage && !imageFailed;

  // Compact (Quick Matches preview): 3 lines is the sweet spot — enough to
  // tell what the action is, not so much that the tile drowns in text.
  const isDescriptionLong = (card.description?.length ?? 0) > (compact ? 140 : READ_MORE_THRESHOLD);

  const completionsCount = card.completions ?? 0;
  // Effective done count — `isCompleted` bumps it by 1 so the user sees
  // their own click reflected immediately even before the server count
  // catches up. Still surfaced through CardDetailsModal where the user
  // can actually mark themselves done; on the grid it's now read-only.
  const effectiveCount = Math.max(completionsCount, isCompleted ? 1 : 0);

  // ── Stats row — read-only boost + done counters that sit in the footer
  //    where the "I did this!" pill used to live. The actual mark-done /
  //    boost actions live inside CardDetailsModal now, keeping the grid
  //    quiet. Spread the Word (pinToTop) suppresses the boost half — that
  //    card can't be boosted. */
  function StatsRow() {
    const showBoost = !card.pinToTop;
    return (
      <div className="flex items-center gap-3 shrink-0 font-['Poppins',sans-serif] text-[12px]">
        {showBoost && (
          <span className="inline-flex items-center gap-1 font-bold text-[#ed6624] whitespace-nowrap">
            <span aria-hidden>🔥</span>
            <span>{(card.boosts ?? 0).toLocaleString()}</span>
          </span>
        )}
        <span className="inline-flex items-center gap-1 font-bold text-[#0d8c6e] whitespace-nowrap">
          <span aria-hidden>✓</span>
          <span>{effectiveCount.toLocaleString()}</span>
        </span>
      </div>
    );
  }

  // Boost button used to live here as both an image overlay and an
  // inline action; it now lives only inside CardDetailsModal so the
  // card grid stays calm. onBoost / isBoosted props are still passed
  // through to the modal.

  // ── Floating share button (top-right of content area, below image) ───────
  function FloatingShareButton() {
    return (
      <div className="absolute top-2 right-2 flex items-center gap-1.5 z-10">
        {/* Flag is hidden on the pinned "Spread the Word" card — that card
            isn't user-submitted content, so it can't be reported. */}
        {!card.pinToTop && (
          <button
            onClick={(e) => { e.stopPropagation(); setFlagOpen(true); }}
            title="Report a problem with this act"
            aria-label={`Report ${card.title}`}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-white/90 text-gray-400 hover:text-red-500 hover:bg-white backdrop-blur-sm transition-colors"
          >
            <Flag size={12} />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); card.pinToTop ? setShareOpen(true) : openShare(); }}
          title={card.pinToTop ? "Spread the word!" : "Share"}
          aria-label={`Share ${card.title}`}
          className={`w-7 h-7 flex items-center justify-center rounded-full backdrop-blur-sm transition-colors ${
            card.pinToTop
              ? "bg-[#ed6624] text-white hover:bg-[#c2521b]"
              : "bg-white/90 text-gray-500 hover:text-[#ed6624] hover:bg-white"
          }`}
        >
          {card.pinToTop ? <Flame size={13} /> : <Share2 size={13} />}
        </button>
      </div>
    );
  }

  // ── Time-commitment pill (top-right of header) ─────────────────────────────
  // Mirrors the location badge at bottom-right of the image so users can see
  // "how long will this take" at a glance without opening the card.
  function TimeBadge({ light = true }: { light?: boolean }) {
    if (!card.timeCommitment) return null;
    const cls = light
      ? "bg-black/50 backdrop-blur-sm text-white"
      : "bg-gray-100 text-gray-700";
    return (
      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-['Poppins',sans-serif] text-[11px] font-semibold ${cls}`}>
        <Clock size={11} />
        {card.timeCommitment}
      </span>
    );
  }

  // Bookmark icon: fire a spring-pop animation on tap. `useHasChanged` gates
  // the first-mount case so the bounce only happens when the user actually
  // toggles the bookmark, not when the card renders with an already-saved
  // state.
  const bookmarkHasChanged = useHasChanged(!!isBookmarked);

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
          {/* `key={String(isBookmarked)}` re-mounts the icon wrapper on toggle
              so the CSS pop animation re-fires each time, not just on first
              mount. Gated by `bookmarkHasChanged` so a card that loads with
              isBookmarked=true doesn't pop on page load. */}
          <span
            key={String(isBookmarked)}
            className={bookmarkHasChanged ? "resistact-anim-bookmark inline-block" : "inline-block"}
          >
            {isBookmarked ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
          </span>
        </button>
      </div>
    );
  }

  /* ── Featured (navy) card ─────────────────────────────── */
  if (card.isFeatured) {
    return (
      <>
        <div
          // Hover state: shadow lifts for everyone (gentle, no motion).
          // motion-safe lift + scale + microtilt only fires for users who
          // haven't asked the OS for reduced motion (vestibular safety).
          // hover:z-10 keeps the lifted card painting above its neighbors
          // in the grid rather than getting clipped at edges.
          className={`resistact-card-shine resistact-banner-host cursor-pointer bg-white rounded-2xl shadow-md flex flex-col overflow-hidden h-full transition-all duration-200 ease-out hover:shadow-lg motion-safe:hover:-translate-y-1 motion-safe:hover:scale-[1.02] motion-safe:hover:rotate-[0.3deg] hover:z-10`}
          onClick={card.pinToTop ? () => setShareOpen(true) : () => setDetailsOpen(true)}
        >
          {/* Illustration — use uploaded image if available, else navy illustration */}
          {/* `resistact-anim-shimmer` overlays a diagonal highlight sweep on
              top of the navy hero image, every 5.5s. Featured cards are the
              ones we want to draw the eye to — the shimmer says "look here"
              without flashing or strobing. */}
          <div className={`resistact-anim-shimmer relative ${compact ? "h-[70px]" : "h-[108px]"} shrink-0 bg-[#23297e] flex items-center justify-center overflow-hidden`}>
            {card.topImage
              ? <img src={card.topImage} alt={card.title} className={`${card.pinToTop ? "resistact-banner-half-desat" : "resistact-banner-desat"} absolute inset-0 w-full h-full object-cover object-top`} />
              : card.featuredIllustration
            }
            <div className="absolute top-2.5 right-3 flex items-center gap-1.5">
              {!compact && <TimeBadge light={true} />}
              <TopControls light={true} />
            </div>
            {/* Boost lives only inside the card-details modal now — keeping
                it off the card itself declutters the grid; users still
                get to it after opening the card. Spread the Word never
                showed a boost anyway. */}
          </div>

          {/* Content */}
          <div className={`relative flex flex-col flex-1 ${compact ? "gap-1 px-3 pb-2 pt-1.5" : "gap-2 px-4 pb-4 pt-3"}`}>
            <span className={`font-['Poppins',sans-serif] font-bold tracking-wide ${compact ? "text-[10px]" : "text-[11px]"}`} style={{ color: card.categoryColor }}>
              {card.category}
            </span>

            <h3 className={`font-['Poppins',sans-serif] font-bold text-gray-900 leading-snug ${compact ? "text-[13px]" : "text-[15px]"}`}>
              {card.title}
            </h3>

            {/* Description: compact-only, matches the regular card. The
                full message lives in the share modal that opens on click. */}
            {compact && (
              <p className="font-['Poppins',sans-serif] text-gray-600 leading-relaxed flex-1 text-[12px] line-clamp-3">
                {card.description}
              </p>
            )}
            {!compact && <div className="flex-1" />}

            {compact && isDescriptionLong && (
              <button
                onClick={(e) => { e.stopPropagation(); setDetailsOpen(true); }}
                className="self-end font-['Poppins',sans-serif] italic text-[12px] font-normal text-[#ed6624] underline underline-offset-2 decoration-[#ed6624]/40 hover:decoration-[#ed6624]"
              >
                Read more →
              </button>
            )}

            {/* Author + read-only stats */}
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

              <StatsRow />
            </div>

            {!compact && <FloatingShareButton />}
          </div>
        </div>
        {shareOpen && (
          card.pinToTop
            ? <SpreadTheWordModal onClose={() => setShareOpen(false)} />
            : <ShareModal cardId={card.id} title={card.title} description={card.description} onClose={() => setShareOpen(false)} />
        )}
        {detailsOpen && (
          <CardDetailsModal
            card={card}
            onClose={() => setDetailsOpen(false)}
            onShare={card.pinToTop ? () => setShareOpen(true) : undefined}
            onComplete={card.pinToTop ? undefined : onComplete}
            isCompleted={isCompleted}
            onBoost={card.pinToTop ? undefined : onBoost}
            isBoosted={isBoosted}
          />
        )}
        {flagOpen && (
          <FlagCardModal cardId={card.id} cardTitle={card.title} accessToken={accessToken} onClose={() => setFlagOpen(false)} />
        )}
      </>
    );
  }

  /* ── Standard card ────────────────────────────────────── */
  return (
    <>
      {/* Hover state: see the featured-card branch above for rationale.
          Same lift + scale + microtilt, gated behind motion-safe. */}
      {/* Whole card opens the Read More modal. Inner buttons (boost,
          bookmark, share, edit, "I did this!") still work because they
          call e.stopPropagation() before their own handlers. The modal
          itself carries the primary action (link out), the I-did-this
          toggle, and the boost — so the card preview-then-act flow lives
          end-to-end in the modal. */}
      <div
        onClick={() => setDetailsOpen(true)}
        className={`resistact-banner-host cursor-pointer bg-white rounded-2xl shadow-md flex flex-col overflow-hidden h-full transition-all duration-200 ease-out hover:shadow-lg motion-safe:hover:-translate-y-1 motion-safe:hover:scale-[1.02] motion-safe:hover:rotate-[0.3deg] hover:z-10 ${isPending ? "ring-2 ring-red-400" : ""}`}
      >
        {/* ── Admin: pending approval banner ── */}
        {isPending && !compact && (
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-red-50 border-b border-red-200 shrink-0">
            <span className="font-['Poppins',sans-serif] font-bold text-[11px] uppercase tracking-wider text-red-600">
              ⚠ Pending approval
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onApprove?.(card.id); }}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-600 hover:bg-green-700 text-white font-['Poppins',sans-serif] font-bold text-[10px] uppercase tracking-wide transition-colors shrink-0"
            >
              <CheckCircle2 size={11} />
              Approve
            </button>
          </div>
        )}
        {/* Top image — uses the card's own photo if available, else a
            generic ResistAct logo banner. We render the same wrapper either
            way so badges, controls, location pill and "I did this" sit in
            identical positions whether or not we have real art. */}
        <div className={`relative ${compact ? "h-[70px]" : "h-[108px]"} shrink-0 ${showTopImage && card.imageContain ? "bg-gray-50" : ""} ${!showTopImage ? "bg-[#fff8f3]" : ""}`}>
          {showTopImage ? (
            <ImageWithFallback
              src={card.topImage}
              alt={card.title}
              className={`resistact-banner-desat w-full h-full ${card.imageContain ? "object-contain p-2" : "object-cover object-top"}`}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <img
              src={cardFallbackImg}
              alt=""
              aria-hidden="true"
              className={`w-full h-full object-contain ${compact ? "p-2" : "p-4"}`}
            />
          )}
          {/* Gradient overlay for readability — only on real photos. Skipped
              for logo-fit cards and the brand fallback (both are light bg). */}
          {showTopImage && !card.imageContain && (
            <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
          )}

          {/* Stretched link removed — the whole card now opens the Read
              More modal instead of going directly to the external URL.
              The modal carries the link-out as its primary action button. */}

          {/* Pencil + Bookmark — hidden in compact preview mode. Dark icons
              on the brand fallback (light bg); white icons on photos. */}
          {!compact && (
            <div className="absolute top-2.5 right-3 flex items-center gap-1.5">
              <TimeBadge light={showTopImage} />
              <TopControls light={showTopImage} />
            </div>
          )}

          {/* Type tag */}
          {card.typeTag && (
            <div className="absolute top-2.5 left-3 bg-white/90 backdrop-blur-sm border border-[#fb00ff] rounded-lg px-2.5 py-0.5">
              <span className="font-['Poppins',sans-serif] font-bold text-[11px] text-[#fc20ff]">{card.typeTag}</span>
            </div>
          )}

          {/* Location badge on image — white pill with dark-gray text for
              better readability against varied banner photos (the previous
              black/50 backdrop disappeared on dark photos and felt heavy on
              light ones). Capped at 55% of card width with truncation so long
              location strings (e.g. sentence-style values from older imports)
              don't grow the pill across the centered fallback logo. */}
          {(card.isOnline || card.location) && (
            <div className="absolute bottom-2 right-3 max-w-[55%] flex items-center gap-1 bg-white/95 backdrop-blur-sm rounded-md px-2 py-0.5 shadow-sm">
              {card.isOnline
                ? <><Globe size={11} className="text-gray-700 shrink-0" /><span className="font-['Poppins',sans-serif] text-[11px] text-gray-700 truncate">Online</span></>
                : <><MapPin size={11} className="text-gray-700 shrink-0" /><span className="font-['Poppins',sans-serif] text-[11px] text-gray-700 truncate">{card.location}</span></>
              }
            </div>
          )}

          {/* Boost button used to sit here as an image overlay; it's been
              moved into the card-details modal only, so the grid stays
              calm and the modal becomes the single place to take action
              (link out, "I did this!", boost). */}
        </div>

        {/* Content */}
        <div className={`relative flex flex-col flex-1 ${compact ? "gap-1 px-3 pb-2 pt-1.5" : "gap-2 px-4 pb-4 pt-3"}`}>
          {/* Floating share button — top-right of content area, below header. Hidden in compact. */}
          {!compact && <FloatingShareButton />}

          {/* Category */}
          <span
            className={`font-['Poppins',sans-serif] font-bold tracking-wide ${compact ? "text-[10px]" : "text-[11px]"}`}
            style={{ color: card.categoryColor }}
          >
            {card.category}
          </span>

          {/* Title */}
          <h3 className={`font-['Poppins',sans-serif] font-bold text-gray-900 leading-snug ${compact ? "text-[13px]" : "text-[15px] pr-8"}`}>
            {card.title}
          </h3>

          {/* Description used to live here; it's been moved to modal-only
              so the grid stays calm. The compact (Quick Match preview)
              variant keeps the description because that view is the user's
              only look at the card before deciding. */}
          {compact && (
            <p className="font-['Poppins',sans-serif] text-gray-600 leading-relaxed text-[12px] line-clamp-3 flex-1">
              {card.description}
            </p>
          )}
          {/* Spacer that takes the place of the description on non-compact
              cards — keeps the footer (author + stats) anchored to the
              bottom of the card so heights stay aligned across the grid. */}
          {!compact && <div className="flex-1" />}

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

          {/* Read More link only shows in compact (Quick Match preview)
              mode, where the description is still rendered above. On the
              main grid the entire card is clickable and there's no
              description to truncate, so the link would be redundant. */}
          {compact && isDescriptionLong && (
            <button
              onClick={(e) => { e.stopPropagation(); setDetailsOpen(true); }}
              className="self-end font-['Poppins',sans-serif] italic text-[12px] font-normal text-[#ed6624] underline underline-offset-2 decoration-[#ed6624]/40 hover:decoration-[#ed6624]"
            >
              Read more →
            </button>
          )}

          {/* Author + read-only stats — hidden in compact mode (mini preview). */}
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

              <StatsRow />
            </div>
          )}
        </div>
      </div>
      {shareOpen && (
        <ShareModal cardId={card.id} title={card.title} description={card.description} onClose={() => setShareOpen(false)} />
      )}
      {detailsOpen && (
        <CardDetailsModal
          card={card}
          onClose={() => setDetailsOpen(false)}
          onComplete={onComplete}
          isCompleted={isCompleted}
          onBoost={onBoost}
          isBoosted={isBoosted}
        />
      )}
      {flagOpen && (
        <FlagCardModal cardId={card.id} cardTitle={card.title} accessToken={accessToken} onClose={() => setFlagOpen(false)} />
      )}
    </>
  );
}

// Memoised wrapper — skips re-render when none of the props changed. The big
// win is during search-typing: setSearchQuery triggers a parent re-render, but
// the cards' own props (card, isBoosted, etc.) haven't moved, so memo bails
// out and we skip ~400 ActionCard renders per keystroke.
export const ActionCard = memo(ActionCardInner);