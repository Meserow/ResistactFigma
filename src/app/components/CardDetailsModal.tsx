import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Heart, CheckCircle2, ExternalLink, Flag, Flame, Globe, Loader2, MapPin, Pencil, Share2, X } from "lucide-react";
import type { ActionCardData } from "./ActionCard";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { CATEGORY_COLORS, CATEGORY_GROUPS, colorForCategory } from "../lib/categoryGroups";
import { analytics } from "../lib/analytics";
import { projectId } from "/utils/supabase/info";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04`;

// Every category, flattened out of the themed CATEGORY_GROUPS into one
// alphabetized list for the admin "Move to category" picker (no headings).
const ALL_CATEGORIES_SORTED: string[] = Array.from(
  new Set(CATEGORY_GROUPS.flatMap((g) => g.categories)),
).sort((a, b) => a.localeCompare(b));

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
  /** Admin "edit this act" handler — opens the full EditCardModal. When
   *  provided alongside `canEdit`, the modal renders a pencil button in
   *  the top-right utility cluster. Lives in the modal (not on the card)
   *  so the grid stays uncluttered for non-admin users. */
  onEdit?: (id: number) => void;
  /** Admin-only: when true, the category pill becomes click-to-edit so
   *  admins can re-categorize a card without opening the full edit modal.
   *  Pairs with `accessToken` + `onCardUpdated`; if either is missing the
   *  edit affordance silently no-ops. */
  canEdit?: boolean;
  /** Supabase access token, used for the PUT /actions/:id call that
   *  commits a category change. Required for the in-modal edit to fire. */
  accessToken?: string | null;
  /** Bubbles the server's updated card back up to App so the feed's
   *  source-of-truth state and any other open views stay in sync. */
  onCardUpdated?: (updated: ActionCardData) => void;
  /** Fired when the user makes a horizontal swipe gesture on the modal — a
   *  signal they expected the Tinder-style deck. App closes this modal and
   *  opens swipe mode. */
  onSwipeToDeck?: () => void;
}

/**
 * Full-text card detail. Shown when the card's description is long enough that
 * `line-clamp-5` cuts it off in the grid view. Click the "Read more" link on a
 * card to open this; click overlay / Escape / X to close.
 */
export function CardDetailsModal({ card, onClose, onShare, onComplete, isCompleted, onBoost, isBoosted, onBookmark, isBookmarked, onFlag, onEdit, canEdit, accessToken, onCardUpdated, onSwipeToDeck }: CardDetailsModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  // Horizontal-swipe detection → enter swipe mode. Records the touch start and,
  // on release, fires onSwipeToDeck if the gesture was a clear horizontal swipe
  // (so it doesn't trip on vertical scrolling of the modal's content).
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    swipeStart.current = { x: t.clientX, y: t.clientY };
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!onSwipeToDeck || !swipeStart.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeStart.current.x;
    const dy = t.clientY - swipeStart.current.y;
    swipeStart.current = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipeToDeck();
  };

  // ── Admin: inline category editor ──────────────────────────────────────
  // Only renders when canEdit + accessToken are both present. `catEditOpen`
  // toggles the dropdown; `catSaving` disables interaction while the PUT
  // is in flight; `catError` surfaces backend failures inline below the
  // dropdown so the admin doesn't have to look anywhere else for feedback.
  // The locally-displayed category is read from card.category directly so
  // once the parent updates state (via onCardUpdated), the pill rerenders
  // with the new value automatically — no internal mirror state needed.
  const [catEditOpen, setCatEditOpen] = useState(false);
  const [catSaving, setCatSaving]     = useState(false);
  const [catError, setCatError]       = useState<string | null>(null);
  const canEditCategory = !!(canEdit && accessToken && onCardUpdated);

  async function saveCategory(next: string) {
    if (!canEditCategory) return;
    if (next === card.category) { setCatEditOpen(false); return; }
    setCatSaving(true);
    setCatError(null);
    try {
      const res = await fetch(`${API}/actions/${card.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          category:      next,
          categoryColor: CATEGORY_COLORS[next] ?? "#23297e",
        }),
      });
      const data = await res.json();
      if (!res.ok) { setCatError(data.error ?? "Save failed."); return; }
      onCardUpdated?.(data.card as ActionCardData);
      setCatEditOpen(false);
    } catch (err) {
      console.error("Category save error:", err);
      setCatError("Network error.");
    } finally {
      setCatSaving(false);
    }
  }

  // Return-from-action prompt: when the user clicks the primary "I want
  // to ResistAct!" link, the target opens in a new tab and we set a
  // pending flag. When they come back (visibilitychange → visible), we
  // surface a "Mark this action: I did this?" prompt in place of the
  // link-out so they can confirm completion in one click. Doesn't show
  // for cards that are already completed.
  const clickedLinkRef = useRef(false);
  const [showDonePrompt, setShowDonePrompt] = useState(false);

  // Fire card_opened exactly once per mount — the top of the engagement
  // funnel. Empty deps so a category edit / re-render doesn't double-count.
  useEffect(() => {
    analytics.cardOpened(card.id, card.category);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="hero-modal-card relative w-full max-w-[720px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl"
      >
        {/* Utility cluster — bookmark, flag, share, close. All icon-only,
            sit in the modal header so secondary actions stay out of the
            way of the primary action row at the bottom. */}
        <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5">
          {onBookmark && (
            <button
              onClick={() => onBookmark(card.id)}
              title={isBookmarked ? "Remove from My Matches" : "Save to My Matches"}
              aria-label={isBookmarked ? "Remove from My Matches" : "Save to My Matches"}
              className={`flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-sm transition-colors ${
                isBookmarked
                  ? "bg-[#23297e] text-white hover:bg-[#1a2060]"
                  : "bg-white/80 text-gray-600 hover:bg-white hover:text-[#23297e]"
              }`}
            >
              <Heart size={15} fill={isBookmarked ? "currentColor" : "none"} />
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

        {/* Header image — rendered at the banner's native 3:2 aspect so the
            whole cartoon (1536×1024) reads, text and all, with no crop. A
            fixed height would crop a wide banner to fill, lopping off the
            side art/copy. Modal capped at max-h-[90vh] — content scrolls
            inside if it overflows. */}
        {/* Prefer the cartoonized banner if generated; fall back to the
            card's original topImage. Keeps the modal in sync with the grid. */}
        {(card.cartoonImageUrl || card.topImage) && (
          <div className={`relative w-full aspect-[3/2] shrink-0 ${card.imageContain ? "bg-gray-50" : ""}`}>
            <ImageWithFallback
              src={card.cartoonImageUrl ?? card.topImage}
              alt={card.title}
              className={`w-full h-full ${card.imageContain ? "object-contain p-3" : "object-cover"}`}
            />
            {(card.isOnline || card.location) && (
              <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-white/95 backdrop-blur-sm rounded-md px-2.5 py-1 shadow-sm">
                {card.location
                  ? <>
                      <MapPin size={12} className="text-gray-700" />
                      <span className="font-['Poppins',sans-serif] text-[12px] text-gray-700">{card.location}</span>
                      {card.isOnline && <Globe size={12} className="text-gray-700" aria-label="also doable remotely" />}
                    </>
                  : <><Globe size={12} className="text-gray-700" /><span className="font-['Poppins',sans-serif] text-[12px] text-gray-700">Online</span></>
                }
              </div>
            )}
            {/* Admin edit pencil — bottom-left of the banner. Brand-orange
                so it pops against any photo and reads as a primary admin
                affordance. */}
            {canEdit && onEdit && (
              <button
                onClick={(e) => { e.stopPropagation(); onClose(); onEdit(card.id); }}
                title="Edit this act"
                aria-label="Edit"
                className="absolute bottom-3 left-3 flex h-9 w-9 items-center justify-center rounded-full bg-[#ed6624] text-white shadow-md transition-colors hover:bg-[#d8551b]"
              >
                <Pencil size={15} />
              </button>
            )}
            {/* Category pill moved to a footer row (bottom of the modal) so it
                sits in the same place as on the feed card and swipe card. */}
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

          {/* Category — sits directly under the description. Admins can click
              to recategorize (popover opens downward here). */}
          {showCategoryPill && (
            <div className="mt-4 relative">
              {canEditCategory ? (
                <button
                  onClick={(e) => { e.stopPropagation(); setCatEditOpen((v) => !v); setCatError(null); }}
                  title="Change category (admin)"
                  className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 shadow-sm transition-opacity hover:opacity-90"
                  style={{ backgroundColor: categoryColor }}
                >
                  <span className="font-['Poppins',sans-serif] font-bold tracking-wide text-[12px] text-white">{card.category}</span>
                  {catSaving ? <Loader2 size={11} className="text-white animate-spin" /> : <Pencil size={10} className="text-white/85" />}
                </button>
              ) : (
                <span
                  className="inline-flex items-center rounded-md px-2.5 py-1 shadow-sm font-['Poppins',sans-serif] font-bold tracking-wide text-[12px] text-white"
                  style={{ backgroundColor: categoryColor }}
                >
                  {card.category}
                </span>
              )}
              {canEditCategory && catEditOpen && (
                <CategoryEditPopover
                  current={card.category}
                  onPick={saveCategory}
                  onClose={() => setCatEditOpen(false)}
                  error={catError}
                  saving={catSaving}
                />
              )}
            </div>
          )}

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
                onClick={() => analytics.resourceLinkClicked("aclu_know_your_rights", card.id)}
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
          <div className="mt-6 flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-2">
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 w-full sm:w-auto">
              {/* "I did this!" toggle — same color identity as the on-card pill
                  (teal when complete, light teal when idle). Shows the running
                  done count so users see the social proof + their own click. */}
              {onComplete && (() => {
                const baseCount = card.completions ?? 0;
                const displayedCount = Math.max(baseCount, isCompleted ? 1 : 0);
                return (
                  <button
                    onClick={() => onComplete(card.id)}
                    className={`inline-flex w-full sm:w-auto justify-center items-center gap-1 rounded-full px-3 py-2 sm:py-1.5 font-['Poppins',sans-serif] text-[13px] font-bold transition-colors ${
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
                  className={`inline-flex w-full sm:w-auto justify-center items-center gap-1.5 rounded-full px-4 py-2 font-['Poppins',sans-serif] text-sm font-bold transition-colors ${
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
                className="inline-flex w-full sm:w-auto justify-center items-center gap-1.5 rounded-full bg-[#ed6624] px-5 py-2.5 font-['Poppins',sans-serif] text-sm font-bold text-white transition-colors hover:bg-[#c2521b]"
              >
                <Flame size={14} /> Spread the Word!
              </button>
            ) : showDonePrompt && onComplete ? (
              <button
                onClick={() => { onComplete(card.id); setShowDonePrompt(false); }}
                className="inline-flex w-full sm:w-auto justify-center items-center gap-1.5 rounded-full bg-[#0d8c6e] px-5 py-2.5 font-['Poppins',sans-serif] text-sm font-bold text-white transition-colors hover:bg-[#0a7159]"
              >
                <CheckCircle2 size={14} /> Mark this action: I did this!
              </button>
            ) : link ? (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  clickedLinkRef.current = true;
                  analytics.actionLinkClicked(card.id, card.category);
                }}
                className="inline-flex w-full sm:w-auto justify-center items-center gap-1.5 rounded-full bg-[#ed6624] px-5 py-2.5 font-['Poppins',sans-serif] text-sm font-bold text-white transition-colors hover:bg-[#c2521b]"
              >
                I want to Act! <ExternalLink size={14} />
              </a>
            ) : null}
          </div>

        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Admin category-picker popover ─────────────────────────────────────────
// Floats below the category pill. One flat, alphabetized list of every
// category (no theme groupings) so the admin can scan straight down. The
// current category is highlighted with its color background; others render
// as quiet pills. A click stops propagation so the modal's outside-click-to-
// close doesn't dismiss the picker prematurely.
function CategoryEditPopover({
  current,
  onPick,
  onClose,
  error,
  saving,
  openUp = false,
}: {
  current: string;
  onPick: (next: string) => void;
  onClose: () => void;
  error: string | null;
  saving: boolean;
  openUp?: boolean;
}) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`absolute left-0 w-72 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-xl shadow-2xl p-3 z-30 ${openUp ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="font-['Poppins',sans-serif] text-[11px] uppercase tracking-widest text-gray-400 font-semibold">
          Move to category
        </p>
        <button
          onClick={onClose}
          aria-label="Cancel"
          className="text-gray-400 hover:text-gray-700"
        >
          <X size={14} />
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto pr-1">
        <div className="flex flex-wrap gap-1">
          {ALL_CATEGORIES_SORTED.map((cat) => {
            const isCurrent = cat === current;
            const color = CATEGORY_COLORS[cat] ?? "#23297e";
            return (
              <button
                key={cat}
                onClick={() => onPick(cat)}
                disabled={saving}
                className={`px-2 py-0.5 rounded-md font-['Poppins',sans-serif] text-[11px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  isCurrent
                    ? "text-white"
                    : "bg-gray-50 text-gray-600 hover:bg-gray-100"
                }`}
                style={isCurrent ? { backgroundColor: color } : undefined}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>
      {error && (
        <p className="mt-2 font-['Poppins',sans-serif] text-[11px] text-red-500">{error}</p>
      )}
    </div>
  );
}
