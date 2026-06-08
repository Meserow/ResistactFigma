import { memo, useEffect, useState } from "react";
import { CheckCircle2, Clock, Globe, Heart, MapPin, Pencil, X } from "lucide-react";
import { useAnimatedNumber } from "../lib/animations";
import { safeHref } from "../lib/safeUrl";
import { ShareModal } from "./ShareModal";
import { SpreadTheWordModal } from "./SpreadTheWordModal";
import { CardDetailsModal } from "./CardDetailsModal";
import { FlagCardModal } from "./FlagCardModal";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import cardFallbackImg from "../../assets/resistact-card-fallback.webp";
import { colorForCategory } from "../lib/categoryGroups";

// Hand-authored subtitle shown ONLY on the pinned "Spread the Word" hero card
// (in the full feed, not the compact carousel). Longer than a normal synopsis —
// it fills the card body in place of the author footer.
const SPREAD_THE_WORD_SUBTITLE =
  "Resistance grows one share at a time — but only if you actually share. Pick a friend who's been doomscrolling and send this their way. If everyone here invites two friends, ResistAct doubles by Tuesday. That's how movements actually scale — not virally, but two-by-two, through people who trust each other.";

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
  /** Optional one-line hand-authored summary that renders as the
   *  subtitle below the title on the card. When present, takes
   *  priority over any colon/em-dash split of the title. Keep it
   *  ~5–10 words: "what is this Act, in plainer language than the
   *  title". When absent, the title's split (if any) is used; if
   *  there's no split either, no subtitle renders. */
  synopsis?: string;
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
  /** Cartoonized banner URL — a retro-comic-style version of the act's
   *  art, generated via the cartoonize pipeline (initially gpt-image-1).
   *  When present, the card grid and modal banner prefer this over
   *  topImage so the feed reads as one visual system. When absent, the
   *  original topImage renders as before. */
  cartoonImageUrl?: string;
  /** Cartoonize pipeline status for this card's banner:
   *    "done"    — cartoonImageUrl is populated and ready
   *    "pending" — queued for the cartoonize worker (e.g. new user upload
   *                that needs on-the-fly stylization)
   *    "failed"  — worker tried and gave up; admin review needed
   *    "skipped" — intentionally left as the original (logos, photos we
   *                want to preserve, etc.)
   *  Absence of the field means "not yet considered" — the cartoonize
   *  sweep should pick the card up on next run. */
  cartoonStatus?: "done" | "pending" | "failed" | "skipped";
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
  /** Admin editorial pin — floats the card to the top of the feed (just below
   * the "Spread the Word" pinToTop card). Set via the Edit modal's "⭐
   * Highlighted action" checkbox. Distinct from firstTimerFriendly. */
  highlighted?: boolean;
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
  /** Toggle "pass" (not-for-me) from the card's pass (X) button. */
  onPass?: (id: number) => void;
  onEdit?: (id: number) => void;
  onApprove?: (id: number) => void;
  onInfoClick?: () => void;
  isBoosted?: boolean;
  isCompleted?: boolean;
  isBookmarked?: boolean;
  /** Whether the user has passed (left-swiped / "not for me") this act. */
  isPassed?: boolean;
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
  /** Called when the CardDetailsModal commits a partial edit (currently
   * just the admin "change category" affordance). The parent uses this
   * to update its source-of-truth `cards` state so the grid pill and
   * filters reflect the change immediately. */
  onCardUpdated?: (updated: ActionCardData) => void;
  /** Called when the user takes any genuine share action inside the pinned
   * "Spread the Word" modal. The parent records it (server-side for logged-in
   * users) and hides the pinned card from people who've already shared. */
  onSpreadShared?: () => void;
  /** Horizontal swipe on this card's detail modal → enter swipe mode. */
  onSwipeToDeck?: () => void;
  /** Behavioral signal sink for the "For You" ranking. Fired when the user
   * opens this act's detail modal ("opened") or its share sheet ("shared").
   * Strong signals (boost/save/complete/pass) are logged by the parent's
   * own handlers, so they're not duplicated here. */
  onSignal?: (id: number, kind: "opened" | "shared") => void;
}

function ActionCardInner({ card, onBoost, onComplete, onShare, onBookmark, onPass, onEdit, onApprove, onInfoClick, isBoosted, isCompleted, isBookmarked, isPassed, canEdit, isPending, compact = false, accessToken, onCardUpdated, onSpreadShared, onSwipeToDeck, onSignal }: ActionCardProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // "For You" engagement signals. Fire when the detail or share surface opens
  // (transition to true). The pinned "Spread the Word" card is excluded — its
  // share/detail aren't act-level interest. Deps intentionally track only the
  // open flag so each fresh open re-logs (sustained interest is itself signal).
  useEffect(() => {
    if (detailsOpen && !card.pinToTop) onSignal?.(card.id, "opened");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailsOpen]);
  useEffect(() => {
    if (shareOpen && !card.pinToTop) onSignal?.(card.id, "shared");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareOpen]);

  // Pull the category color from the canonical map rather than card.categoryColor.
  // Per-card stored colors have drifted over many imports — same category, different
  // colors on different cards. The filter chip in the Navbar already uses
  // CATEGORY_COLORS, and we want the on-card label to match it visually.
  const categoryColor = colorForCategory(card.category);

  function openShare() {
    setShareOpen(true);
  }
  const [flagOpen, setFlagOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  // Prefer the cartoonized banner when available — keeps the grid visually
  // unified. Falls back to the original topImage if the cartoon hasn't been
  // generated yet (or was skipped). imageFailed resets when either source
  // changes so a swap from cartoon → original (or vice versa) reattempts.
  const effectiveTopImage = card.cartoonImageUrl ?? card.topImage;
  useEffect(() => { setImageFailed(false); }, [effectiveTopImage]);
  const showTopImage = !!effectiveTopImage && !imageFailed;

  // Compact (Quick Matches preview): 3 lines is the sweet spot — enough to
  // tell what the action is, not so much that the tile drowns in text.
  const isDescriptionLong = (card.description?.length ?? 0) > (compact ? 140 : READ_MORE_THRESHOLD);

  const completionsCount = card.completions ?? 0;
  // Effective done count — `isCompleted` bumps it by 1 so the user sees
  // their own click reflected immediately even before the server count
  // catches up. Still surfaced through CardDetailsModal where the user
  // can actually mark themselves done; on the grid it's now read-only.
  const effectiveCount = Math.max(completionsCount, isCompleted ? 1 : 0);

  // Boost button used to live here as both an image overlay and an
  // inline action; it now lives only inside CardDetailsModal so the
  // card grid stays calm. onBoost / isBoosted props are still passed
  // through to the modal.

  // Boost/done stat counts tick-up via useAnimatedNumber so bumps don't pop
  // in instantly. Cards with boosts >= HOT_BOOST_THRESHOLD get a slow flicker
  // on the 🔥 emoji to signal "this one is moving" without screaming for
  // attention.
  // 5 is roughly the top-of-distribution today (max boost in the catalog
  // is single digits). If/when the data grows and boost counts rise into
  // the tens, this should drift upward so the flicker stays meaningful.
  const HOT_BOOST_THRESHOLD = 5;
  // Boost / done stats, rendered as a frosted pill overlaid on the banner's
  // lower-left (mirrors the location badge at lower-right). Hidden entirely
  // when both counts are zero — a brand-new act shows a clean banner. Hooks
  // run before the early return so hook order stays stable.
  function BannerStatsPill() {
    const boostCount = card.boosts ?? 0;
    const showBoost = !card.pinToTop && boostCount > 0;
    const showDone = effectiveCount > 0;
    // Personal controls to the LEFT of the public boost/done counts. The save
    // HEART always shows (solid orange when saved, hollow grey when not) so you
    // can save straight from the grid. The pass X appears ONLY once an act has
    // actually been passed (cyan) — a "this is passed" marker, not an always-on
    // button. In practice it's rarely seen (passed acts are hidden from the
    // feed); it's here for the saved/completed-and-passed cases and smoke tests.
    // Tapping it un-passes. Both hidden on the pinned Spread-the-Word card.
    const showHeart = !card.pinToTop && !!onBookmark;
    const showPass = !card.pinToTop && !!onPass && !!isPassed;
    const animatedBoosts = useAnimatedNumber(boostCount);
    const animatedDones = useAnimatedNumber(effectiveCount);
    const isHotBoost = boostCount >= HOT_BOOST_THRESHOLD;
    if (!showBoost && !showDone && !showHeart && !showPass) return null;
    // Two SEPARATE frosted chips at the banner's bottom-left: a personal
    // save/pass pill (heart + pass-X marker) and, beside it, the public
    // boost/done counts pill — so "your action" reads as distinct from "the
    // crowd's tallies". Each chip self-hides when it has nothing to show.
    return (
      <div className="absolute bottom-2 left-3 flex items-center gap-1.5">
        {(showHeart || showPass) && (
          <div className={`flex items-center justify-center bg-white/95 backdrop-blur-sm shadow-sm ${showHeart && showPass ? "gap-2 rounded-full px-2.5 py-1" : "h-7 w-7 rounded-full"}`}>
            {showHeart && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onBookmark?.(card.id); }}
                aria-label={isBookmarked ? "Remove from saved" : "Save this act"}
                aria-pressed={isBookmarked}
                title={isBookmarked ? "Saved — tap to remove" : "Save this act"}
                className={`inline-flex items-center transition-colors ${isBookmarked ? "text-[#ed6624]" : "text-gray-400 hover:text-[#ed6624]"}`}
              >
                <Heart size={13} strokeWidth={2.5} fill={isBookmarked ? "currentColor" : "none"} />
              </button>
            )}
            {showPass && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onPass?.(card.id); }}
                aria-label={isPassed ? "Undo pass" : "Pass — not for me"}
                aria-pressed={isPassed}
                title={isPassed ? "Passed — tap to undo" : "Pass — hide this from my feed"}
                className={`inline-flex items-center transition-colors ${isPassed ? "text-cyan-500" : "text-gray-400 hover:text-cyan-500"}`}
              >
                <X size={14} strokeWidth={isPassed ? 3.5 : 2.5} />
              </button>
            )}
          </div>
        )}
        {(showBoost || showDone) && (
          <div className="flex items-center gap-2 bg-white/95 backdrop-blur-sm rounded-md px-2 py-0.5 shadow-sm">
            {showBoost && (
              <span className="inline-flex items-center gap-1 text-gray-600 font-['Poppins',sans-serif] font-medium text-[11px] whitespace-nowrap">
                <span aria-hidden className={isHotBoost ? "resistact-anim-flicker inline-block" : "inline-block"}>🔥</span>
                <span>{animatedBoosts.toLocaleString()}</span>
              </span>
            )}
            {showDone && (
              // Done badge: brand teal-green (#0d8c6e — same identity as the
              // "I did this!" pill inside the modal) so the checkmark reads
              // as a positive signal at a glance, not as a neutral metric.
              <span className="inline-flex items-center gap-1 text-[#0d8c6e] font-['Poppins',sans-serif] font-medium text-[11px] whitespace-nowrap">
                <span aria-hidden>✓</span>
                <span className="text-[#0d8c6e]/80">{animatedDones.toLocaleString()}</span>
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  // Category pill — solid category color, white text. Moved from the banner
  // top-left overlay down into the card footer (where the stats used to be).
  function CategoryPill() {
    return (
      <span
        className="inline-flex items-center rounded-lg px-3 py-1 shrink-0"
        style={{ backgroundColor: categoryColor }}
      >
        <span className="font-['Poppins',sans-serif] font-bold tracking-wide text-[13px] text-white">
          {card.category}
        </span>
      </span>
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
          className={`resistact-card-shine resistact-banner-host transform-gpu cursor-pointer bg-white rounded-2xl flex flex-col overflow-hidden h-full transition-[transform,box-shadow,opacity] duration-200 ease-out hover:shadow-md motion-safe:hover:-translate-y-1 motion-safe:hover:scale-[1.02] hover:z-10 ${
            // Pinned "Spread the Word" gets a hairline navy outline (and stays
            // full color); any other featured card uses the grid-wide gray
            // border + 85%→100%-on-hover rule.
            "border-[0.75px] border-gray-400 hover:border-[#23297e] hover:ring-2 hover:ring-[#23297e] opacity-95 hover:opacity-100"
          }`}
          onClick={card.pinToTop ? () => setShareOpen(true) : () => setDetailsOpen(true)}
        >
          {/* Illustration — use uploaded image if available, else navy illustration */}
          {/* `resistact-anim-shimmer` overlays a diagonal highlight sweep on
              top of the navy hero image, every 5.5s. Featured cards are the
              ones we want to draw the eye to — the shimmer says "look here"
              without flashing or strobing. */}
          <div className={`resistact-anim-shimmer relative ${compact ? "h-[70px]" : "h-[106px]"} shrink-0 bg-[#23297e] flex items-center justify-center overflow-hidden rounded-t-2xl`}>
            {effectiveTopImage
              ? <img src={effectiveTopImage} alt={card.title} loading="lazy" decoding="async" style={card.pinToTop ? { transform: "scale(1.01)" } : undefined} className={`${card.pinToTop ? "" : "resistact-banner-desat"} absolute inset-0 w-full h-full object-cover ${card.cartoonImageUrl ? "object-[center_20%]" : "object-top"}`} />
              : card.featuredIllustration
            }
            {!compact && (
              <div className="absolute top-2.5 right-3 flex items-center gap-1.5">
                <TimeBadge light={true} />
              </div>
            )}
            {/* Stats pill — bottom-left of the banner, same as regular cards.
                Spread the Word suppresses boost (pinToTop) but can still show
                a done count; self-hides when there's nothing to show. */}
            {!compact && <BannerStatsPill />}
          </div>

          {/* Content */}
          <div className={`relative flex flex-col flex-1 ${compact ? "gap-1 px-3 pb-2 pt-1.5" : "gap-2 px-5 pb-3 pt-3"}`}>
            {/* Category moved to a pill in the footer (below), matching the
                regular cards. Compact preview still shows it inline as text
                since the preview has no footer row. */}
            {!card.pinToTop && compact && (
              <span className="font-['Poppins',sans-serif] font-bold tracking-wider uppercase text-[10px]" style={{ color: categoryColor }}>
                {card.category}
              </span>
            )}

            <h3 className={`font-['Poppins',sans-serif] font-bold leading-snug ${compact ? "text-[13px]" : "text-[15px]"} ${card.pinToTop ? "text-[#23297e]" : "text-gray-900"} ${card.pinToTop && !compact ? "flex items-center justify-between gap-2" : ""}`}>
              <span>{card.title}</span>
              {/* Spread the Word: a boost flame pushed to the right edge of the
                  title row (no count) — title stays left, flame sits right. */}
              {card.pinToTop && (
                <span aria-hidden className="resistact-anim-flicker ml-1.5 inline-block shrink-0">🔥</span>
              )}
              {/* Featured card subtitle — only the hand-authored synopsis;
                  no title-split for hero cards. Trailing ellipsis matches
                  the rest of the grid. */}
              {card.synopsis && !(card.pinToTop && !compact) && (
                <span className={`font-normal italic text-gray-400 leading-snug line-clamp-2 ${compact ? "text-[11px] mt-1" : "text-[12px] mt-1.5"}`}>
                  {/[.…!?]$/.test(card.synopsis) ? card.synopsis : card.synopsis + "…"}
                </span>
              )}
            </h3>

            {/* Pinned "Spread the Word" hero: a longer share-prompt passage that
                fills the body (a touch darker grey than other subtitles). Same
                font size as other cards' subtitles, sitting close under the
                title. flex-1 + overflow-hidden shows as much as fits. */}
            {card.pinToTop && !compact && (
              <p className="font-['Poppins',sans-serif] not-italic text-gray-500 text-[12px] leading-snug mt-1 flex-1 overflow-hidden">
                {SPREAD_THE_WORD_SUBTITLE}
              </p>
            )}

            {/* Description: compact-only, matches the regular card. The
                full message lives in the share modal that opens on click. */}
            {compact && (
              <p className="font-['Poppins',sans-serif] text-gray-600 leading-relaxed flex-1 text-[12px] line-clamp-3">
                {card.description}
              </p>
            )}
            {!compact && !card.pinToTop && <div className="flex-1" />}

            {compact && isDescriptionLong && (
              <button
                onClick={(e) => { e.stopPropagation(); setDetailsOpen(true); }}
                className="self-end font-['Poppins',sans-serif] italic text-[12px] font-normal text-[#ed6624] underline underline-offset-2 decoration-[#ed6624]/40 hover:decoration-[#ed6624]"
              >
                Read more →
              </button>
            )}

            {/* Footer: category pill (left) + author (right), matching the
                regular cards. The pinned "Spread the Word" card hides this
                entirely — no author name/avatar — so the passage above can use
                the full body. */}
            {!card.pinToTop && (
              <div className="flex items-center justify-between gap-3 pt-1 border-t border-gray-100">
                <CategoryPill />
                <div className="flex items-center gap-2.5 min-w-0 justify-end">
                  <div className="min-w-0 text-right">
                    <p className="font-['Poppins',sans-serif] font-semibold text-[12px] text-gray-800 truncate leading-tight">{card.authorName}</p>
                    <p className="font-['Poppins',sans-serif] text-[11px] text-gray-400 truncate leading-tight">{card.authorRole}</p>
                  </div>
                  {card.authorAvatar && (
                    <ImageWithFallback src={card.authorAvatar} alt={card.authorName} className="w-8 h-8 rounded-full object-cover ring-1 ring-gray-200 shrink-0" />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        {shareOpen && (
          card.pinToTop
            ? <SpreadTheWordModal onClose={() => setShareOpen(false)} onShared={onSpreadShared} />
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
            onBookmark={onBookmark}
            isBookmarked={isBookmarked}
            onEdit={onEdit}
            canEdit={canEdit}
            accessToken={accessToken}
            onCardUpdated={onCardUpdated}
            onSwipeToDeck={onSwipeToDeck && (() => { setDetailsOpen(false); onSwipeToDeck(); })}
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
        className={`resistact-banner-host transform-gpu cursor-pointer bg-white rounded-2xl border-[0.75px] border-gray-400 hover:border-[#23297e] hover:ring-2 hover:ring-[#23297e] flex flex-col overflow-hidden h-full transition-[transform,box-shadow,opacity] duration-200 ease-out hover:shadow-md motion-safe:hover:-translate-y-1 motion-safe:hover:scale-[1.02] hover:z-10 ${
          // Resting 95% opacity for every card, full color on hover — a calm,
          // browsable grid where the hovered card pops. `transition-all` above
          // covers the opacity tween so it eases in/out smoothly.
          "opacity-95 hover:opacity-100"
        } ${isPending ? "ring-2 ring-red-400" : ""}`}
      >
        {/* ── Admin: pending approval banner ── */}
        {isPending && !compact && (
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-red-50 border-b border-red-200 shrink-0">
            <span className="font-['Poppins',sans-serif] font-bold text-[11px] uppercase tracking-wider text-red-600">
              ⚠ Pending approval
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              {onEdit && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onEdit?.(card.id); }}
                  title="Edit this act"
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500 hover:bg-amber-600 text-white font-['Poppins',sans-serif] font-bold text-[10px] uppercase tracking-wide transition-colors"
                >
                  <Pencil size={11} />
                  Edit
                </button>
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onApprove?.(card.id); }}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-600 hover:bg-green-700 text-white font-['Poppins',sans-serif] font-bold text-[10px] uppercase tracking-wide transition-colors"
              >
                <CheckCircle2 size={11} />
                Approve
              </button>
            </div>
          </div>
        )}
        {compact ? (
          /* Compact (Quick Match preview) keeps the old banner-on-top
             layout — the preview is small enough that the horizontal
             split would feel cramped. */
          <div className={`relative h-[70px] shrink-0 overflow-hidden rounded-t-2xl ${showTopImage && card.imageContain ? "bg-gray-50" : ""} ${!showTopImage ? "bg-[#fff8f3]" : ""}`}>
            {showTopImage ? (
              <ImageWithFallback
                src={effectiveTopImage}
                alt={card.title}
                className={`${card.pinToTop ? "" : "resistact-banner-desat"} w-full h-full ${card.imageContain ? "object-contain p-2" : `object-cover ${card.cartoonImageUrl ? "object-[center_20%]" : "object-top"}`}`}
                onError={() => setImageFailed(true)}
              />
            ) : (
              <img src={cardFallbackImg} alt="" aria-hidden="true" className="w-full h-full object-contain p-2" />
            )}
          </div>
        ) : (
          /* Non-compact: full-width banner on top (matches the Spread the
             Word featured card's silhouette). Overlays back on the image:
             time badge + bookmark/edit top-right, type tag top-left,
             location badge bottom-right. Category + title sit in the
             content area below. */
          <div className={`relative h-[106px] shrink-0 overflow-hidden rounded-t-2xl ${showTopImage && card.imageContain ? "bg-gray-50" : ""} ${!showTopImage ? "bg-[#fff8f3]" : ""}`}>
            {showTopImage ? (
              <ImageWithFallback
                src={effectiveTopImage}
                alt={card.title}
                /* Cartoonized banners are 3:2 with the subject's head
                   typically painted in the upper portion. Object-position
                   50% 15% slides the visible window slightly up from
                   center so heads stay in frame at the 4:1 card aspect.
                   For original photos (no cartoon), use object-top to keep
                   the legacy behavior. */
                className={`${card.pinToTop ? "" : "resistact-banner-desat"} w-full h-full ${card.imageContain ? "object-contain p-2" : `object-cover ${card.cartoonImageUrl ? "[object-position:50%_15%]" : "object-top"}`}`}
                onError={() => setImageFailed(true)}
              />
            ) : (
              <img src={cardFallbackImg} alt="" aria-hidden="true" className="w-full h-full object-contain p-4" />
            )}
            {/* Top-right: time pill. Admin edit pencil lives in the
                details modal so the grid stays uncluttered. */}
            <div className="absolute top-2.5 right-3 flex items-center gap-1.5">
              <TimeBadge light={showTopImage} />
            </div>

            {/* Type tag on top-left of the banner. */}
            {card.typeTag && (
              <div className="absolute top-2.5 left-3 bg-white/90 backdrop-blur-sm border border-[#fb00ff] rounded-lg px-2.5 py-0.5">
                <span className="font-['Poppins',sans-serif] font-bold text-[11px] text-[#fc20ff]">{card.typeTag}</span>
              </div>
            )}

            {/* Location badge bottom-right. Capped to 55% width with
                truncation so long location strings don't overrun the
                banner. */}
            {(card.isOnline || card.location) && (
              <div className="absolute bottom-2 right-3 max-w-[55%] flex items-center gap-1 bg-white/95 backdrop-blur-sm rounded-md px-2 py-0.5 shadow-sm">
                {card.location
                  ? <>
                      <MapPin size={11} className="text-gray-700 shrink-0" />
                      <span className="font-['Poppins',sans-serif] text-[11px] text-gray-700 truncate">{card.location}</span>
                      {card.isOnline && <Globe size={11} className="text-gray-700 shrink-0" aria-label="also doable remotely" />}
                    </>
                  : <><Globe size={11} className="text-gray-700 shrink-0" /><span className="font-['Poppins',sans-serif] text-[11px] text-gray-700 truncate">Online</span></>
                }
              </div>
            )}

            {/* Boost/done stats pill — bottom-left of the banner. Moved here
                from the card footer; the category pill took its old spot.
                Self-hides when both counts are zero. */}
            <BannerStatsPill />
          </div>
        )}

        {/* Content */}
        <div className={`relative flex flex-col flex-1 ${compact ? "gap-1 px-3 pb-2 pt-1.5" : "gap-2 px-5 pb-3 pt-3"}`}>
          {/* Category — only renders in compact (Quick Match preview)
              mode here. Non-compact moved the category onto a pill
              overlay on the banner's bottom-left. */}
          {compact && (
            <span
              className="font-['Poppins',sans-serif] font-bold tracking-wider uppercase text-[10px]"
              style={{ color: categoryColor }}
            >
              {card.category}
            </span>
          )}

          {/* Title — full content-area width since the controls (bookmark,
              edit) are overlaid on the banner image now, not in the content
              area. */}
          {/* Title with optional subtitle.
              Subtitle source (in priority order):
                1. card.synopsis if hand-authored — gives editorial control
                   over what shows below the title.
                2. Title split: if the title contains " — " em-dash or
                   ": " colon, the part after becomes the subtitle.
                     "Headline — location / scope" → drops em-dash
                     "Topic: Detail"               → keeps colon on head
                   When both are present, splits on whichever appears
                   first so the head stays the natural opening phrase.
                3. Nothing — no subtitle row renders.
              Description is intentionally NOT used as a fallback;
              auto-derived summaries read worse than no subtitle. */}
          {(() => {
            const t = card.title;
            const emDashIdx = t.indexOf(" — ");
            const colonIdx = t.indexOf(": ");
            let head = t;
            const synopsis = (card.synopsis ?? "").trim();
            let tail = synopsis;
            // True when the subtitle came from a synopsis (hand-authored
            // or generated) vs a title split — we add an ellipsis only
            // to synopses, since title splits are already complete phrases.
            const tailFromSynopsis = tail.length > 0;
            if (!tail) {
              const colonFirst =
                colonIdx >= 0 && (emDashIdx < 0 || colonIdx < emDashIdx);
              const emDashFirst =
                emDashIdx >= 0 && (colonIdx < 0 || emDashIdx < colonIdx);
              if (colonFirst) {
                // Strip the trailing colon from the head — dangling ":"
                // reads as broken punctuation when the subtitle below
                // already separates the two phrases visually.
                const proposedHead = t.slice(0, colonIdx);
                const headMeaningful =
                  proposedHead.length >= 8 && /\s/.test(proposedHead);
                if (headMeaningful) {
                  head = proposedHead;
                  tail = t.slice(colonIdx + 2);
                }
              } else if (emDashFirst) {
                head = t.slice(0, emDashIdx);
                tail = t.slice(emDashIdx + 3);
              }

              // ── Swap head and tail when the head is a boilerplate
              //    "verb + audience" phrase ("Tell Congress", "Call your
              //    Senators", "Email Republican Reps", "Urge Your State
              //    Legislators") and the tail carries the specific ask.
              //    Without this, a wall of "Tell Congress" cards all look
              //    identical at a glance — the meat sits in the subordinate
              //    line. With the swap, the specific bill / topic becomes
              //    the prominent title and the contact verb shrinks to the
              //    subtitle, which reads like a news headline. ─────────
              if (tail) {
                const VERB_STARTS = /^(tell|call|email|urge|ask|write|sign)\b/i;
                const headIsBoilerplate =
                  VERB_STARTS.test(head) && tail.length > head.length;
                if (headIsBoilerplate) {
                  const swap = head;
                  head = tail;
                  tail = swap;
                }
              }
            }
            // Append a soft ellipsis on synopsis subtitles — visual cue
            // that there's more to read inside the modal. Title-split
            // subtitles read as complete phrases and don't need it.
            const displayedTail =
              tail && tailFromSynopsis && !/[.…!?]$/.test(tail)
                ? tail + "…"
                : tail;
            return (
              <h3 className={`font-['Poppins',sans-serif] font-bold text-gray-900 leading-snug ${compact ? "text-[13px]" : "text-[15px]"}`}>
                {head}
                {tail && (
                  // Subtitle styling deliberately more distinct from the head
                  // than before: smaller, lighter gray, italic, and a bigger
                  // vertical gap. Previously the subtitle read as natural
                  // line-wrap because the visual delta was too small.
                  <span className={`font-normal italic text-gray-400 leading-snug line-clamp-2 ${compact ? "text-[11px] mt-1" : "text-[12px] mt-1.5"}`}>
                    {displayedTail}
                  </span>
                )}
              </h3>
            );
          })()}

          {/* Compact-only description preview — the user's only look at the
              card before deciding in Quick Match. */}
          {compact && (
            <p className="font-['Poppins',sans-serif] text-gray-600 leading-relaxed text-[12px] line-clamp-3 flex-1">
              {card.description}
            </p>
          )}
          {/* Spacer keeps the footer (author + stats) anchored to the
              bottom of the card so heights stay aligned across the grid. */}
          {!compact && <div className="flex-1" />}

          {/* Know-Your-Rights chip moved to CardDetailsModal — keeps the
              grid clean and shows the safety reminder right where the
              user is about to act on a PROTEST / FLASH MOB card. */}

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

          {/* Action circles (left) + author (right). Stats + Flag + Share
              share the row as one unified pill set; author lands in the
              right corner so the stats lead the eye. Hidden in compact
              mode (Quick Match preview is too small for this density). */}
          {!compact && (
            <div className="flex items-center justify-between gap-3 pt-1 border-t border-gray-100">
              <CategoryPill />

              {/* Author */}
              <div className="flex items-center gap-2.5 min-w-0 justify-end">
                <div className="min-w-0 text-right">
                  <p className="font-['Poppins',sans-serif] font-semibold text-[12px] text-gray-800 truncate leading-tight">
                    {card.authorName}
                  </p>
                  {card.authorLink ? (
                    <a
                      href={safeHref(card.authorLink)}
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
                {card.authorAvatar && (
                  <ImageWithFallback
                    src={card.authorAvatar}
                    alt={card.authorName}
                    className="rounded-full object-cover ring-1 ring-gray-200 shrink-0 w-8 h-8"
                  />
                )}
              </div>
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
          onBookmark={onBookmark}
          isBookmarked={isBookmarked}
          onShare={() => setShareOpen(true)}
          onFlag={() => setFlagOpen(true)}
          onEdit={onEdit}
          canEdit={canEdit}
          accessToken={accessToken}
          onCardUpdated={onCardUpdated}
          onSwipeToDeck={onSwipeToDeck && (() => { setDetailsOpen(false); onSwipeToDeck(); })}
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