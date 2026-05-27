import { memo, useEffect, useState } from "react";
import { CheckCircle2, Clock, Globe, MapPin, Pencil } from "lucide-react";
import { useAnimatedNumber } from "../lib/animations";
import { ShareModal } from "./ShareModal";
import { SpreadTheWordModal } from "./SpreadTheWordModal";
import { CardDetailsModal } from "./CardDetailsModal";
import { FlagCardModal } from "./FlagCardModal";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import cardFallbackImg from "../../assets/resistact-card-fallback.webp";
import { colorForCategory } from "../lib/categoryGroups";

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
  /** Called when the CardDetailsModal commits a partial edit (currently
   * just the admin "change category" affordance). The parent uses this
   * to update its source-of-truth `cards` state so the grid pill and
   * filters reflect the change immediately. */
  onCardUpdated?: (updated: ActionCardData) => void;
}

function ActionCardInner({ card, onBoost, onComplete, onShare, onBookmark, onEdit, onApprove, onInfoClick, isBoosted, isCompleted, isBookmarked, canEdit, isPending, compact = false, accessToken, onCardUpdated }: ActionCardProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

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

  // ── ActionRow — quartet of pills/circles that lives in the card footer.
  //    Boost and Done stats: rounded pills with icon + count, color-tinted.
  //    Counts tick-up via useAnimatedNumber so bumps don't pop in instantly.
  //    Flag and Share: icon-only circles. All share h-7 and rounded-full so
  //    they read as one cohesive control set rather than two separate ones.
  //    Cards with boosts >= HOT_BOOST_THRESHOLD get a slow flicker on the
  //    🔥 emoji to signal "this one is moving" without screaming for
  //    attention.
  // 5 is roughly the top-of-distribution today (max boost in the catalog
  // is single digits). If/when the data grows and boost counts rise into
  // the tens, this should drift upward so the flicker stays meaningful.
  const HOT_BOOST_THRESHOLD = 5;
  function ActionRow() {
    const boostCount = card.boosts ?? 0;
    const showBoost = !card.pinToTop && boostCount > 0;
    const showDone = effectiveCount > 0;
    const animatedBoosts = useAnimatedNumber(boostCount);
    const animatedDones = useAnimatedNumber(effectiveCount);
    const isHotBoost = boostCount >= HOT_BOOST_THRESHOLD;
    // Empty placeholder when both stats are zero — keeps the flex layout
    // stable (justify-between still pushes the author block to the right)
    // without rendering any visible badges. Quiet by default; the badges
    // only earn space once there's something to count.
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        {showBoost && (
          <span className="inline-flex items-center gap-1 px-1 text-gray-400 font-['Poppins',sans-serif] font-medium text-[11px] whitespace-nowrap">
            <span aria-hidden className={isHotBoost ? "resistact-anim-flicker inline-block" : "inline-block"}>🔥</span>
            <span>{animatedBoosts.toLocaleString()}</span>
          </span>
        )}
        {showDone && (
          // Done badge: brand teal-green (#0d8c6e — same identity as the
          // "I did this!" pill inside the modal) so the checkmark reads
          // as a positive signal at a glance, not as a neutral metric.
          // Count stays in the same color but a touch dimmer so the
          // checkmark anchors the eye.
          <span className="inline-flex items-center gap-1 px-1 text-[#0d8c6e] font-['Poppins',sans-serif] font-medium text-[11px] whitespace-nowrap">
            <span aria-hidden>✓</span>
            <span className="text-[#0d8c6e]/80">{animatedDones.toLocaleString()}</span>
          </span>
        )}
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

  // ── Shared top-right controls (edit pencil only — bookmark moved to modal) ─
  // On image (`light`), the icons sit inside a translucent dark pill so they
  // stay legible regardless of the photo behind them — bright/light images
  // were swallowing the white icon previously.
  // TopControls now holds only the admin "edit" pencil. Bookmark moved
  // into CardDetailsModal as a labeled button so non-admin users
  // actually discover the feature. For non-admins (canEdit=false), this
  // component renders nothing — the caller should skip rendering its
  // wrapper too so the absolute-positioned slot doesn't reserve space.
  function TopControls({ light = true }: { light?: boolean }) {
    if (!canEdit) return null;
    const btnCls = light
      ? "w-7 h-7 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm text-white hover:bg-black/55 transition-colors"
      : "text-gray-500 hover:text-[#23297e] transition-colors";
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit?.(card.id); }}
          title="Edit this act"
          className={btnCls}
        >
          <Pencil size={14} />
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
          className={`resistact-card-shine resistact-banner-host transform-gpu cursor-pointer bg-white rounded-2xl border border-gray-200 flex flex-col overflow-hidden h-full transition-all duration-200 ease-out hover:border-gray-300 hover:shadow-md motion-safe:hover:-translate-y-1 motion-safe:hover:scale-[1.02] motion-safe:hover:rotate-[0.3deg] hover:z-10`}
          onClick={card.pinToTop ? () => setShareOpen(true) : () => setDetailsOpen(true)}
        >
          {/* Illustration — use uploaded image if available, else navy illustration */}
          {/* `resistact-anim-shimmer` overlays a diagonal highlight sweep on
              top of the navy hero image, every 5.5s. Featured cards are the
              ones we want to draw the eye to — the shimmer says "look here"
              without flashing or strobing. */}
          <div className={`resistact-anim-shimmer relative ${compact ? "h-[70px]" : "h-[106px]"} shrink-0 bg-[#23297e] flex items-center justify-center overflow-hidden`}>
            {effectiveTopImage
              ? <img src={effectiveTopImage} alt={card.title} className={`${card.cartoonImageUrl || card.pinToTop ? "" : "resistact-banner-desat"} absolute inset-0 w-full h-full object-cover ${card.cartoonImageUrl ? "object-[center_20%]" : "object-top"}`} />
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
          <div className={`relative flex flex-col flex-1 ${compact ? "gap-1 px-3 pb-2 pt-1.5" : "gap-2 px-5 pb-3 pt-3"}`}>
            {/* Category hidden on the pinToTop Spread the Word card —
                it's the hero card, not a category-bucketed Act. */}
            {!card.pinToTop && (
              <span className={`font-['Poppins',sans-serif] font-bold tracking-wider uppercase ${compact ? "text-[10px]" : "text-[11px]"}`} style={{ color: categoryColor }}>
                {card.category}
              </span>
            )}

            <h3 className={`font-['Poppins',sans-serif] font-bold text-gray-900 leading-snug ${compact ? "text-[13px]" : "text-[15px]"}`}>
              {card.title}
              {/* Featured card subtitle — only the hand-authored synopsis;
                  no title-split for hero cards. Trailing ellipsis matches
                  the rest of the grid. */}
              {card.synopsis && (
                <span className={`block font-normal italic text-gray-400 leading-snug ${compact ? "text-[11px] mt-1" : "text-[12px] mt-1.5"}`}>
                  {/[.…!?]$/.test(card.synopsis) ? card.synopsis : card.synopsis + "…"}
                </span>
              )}
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

            {/* Action circles (left) + author (right). Stats + Flag +
                Share share the row as one unified pill set. Spread the
                Word suppresses both Flag (not user-submitted) and Boost
                (can't boost yourself). */}
            <div className="flex items-center justify-between gap-3 pt-1 border-t border-gray-100">
              <ActionRow />

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
            onBookmark={onBookmark}
            isBookmarked={isBookmarked}
            canEdit={canEdit}
            accessToken={accessToken}
            onCardUpdated={onCardUpdated}
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
        className={`resistact-banner-host transform-gpu cursor-pointer bg-white rounded-2xl border border-gray-200 flex flex-col overflow-hidden h-full transition-all duration-200 ease-out hover:border-gray-300 hover:shadow-md motion-safe:hover:-translate-y-1 motion-safe:hover:scale-[1.02] motion-safe:hover:rotate-[0.3deg] hover:z-10 ${isPending ? "ring-2 ring-red-400" : ""}`}
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
        {compact ? (
          /* Compact (Quick Match preview) keeps the old banner-on-top
             layout — the preview is small enough that the horizontal
             split would feel cramped. */
          <div className={`relative h-[70px] shrink-0 ${showTopImage && card.imageContain ? "bg-gray-50" : ""} ${!showTopImage ? "bg-[#fff8f3]" : ""}`}>
            {showTopImage ? (
              <ImageWithFallback
                src={effectiveTopImage}
                alt={card.title}
                className={`${card.cartoonImageUrl ? "" : "resistact-banner-desat"} w-full h-full ${card.imageContain ? "object-contain p-2" : `object-cover ${card.cartoonImageUrl ? "object-[center_20%]" : "object-top"}`}`}
                onError={() => setImageFailed(true)}
              />
            ) : (
              <img src={cardFallbackImg} alt="" aria-hidden="true" className="w-full h-full object-contain p-2" />
            )}
            {showTopImage && !card.imageContain && (
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
            )}
          </div>
        ) : (
          /* Non-compact: full-width banner on top (matches the Spread the
             Word featured card's silhouette). Overlays back on the image:
             time badge + bookmark/edit top-right, type tag top-left,
             location badge bottom-right. Category + title sit in the
             content area below. */
          <div className={`relative h-[106px] shrink-0 ${showTopImage && card.imageContain ? "bg-gray-50" : ""} ${!showTopImage ? "bg-[#fff8f3]" : ""}`}>
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
                className={`${card.cartoonImageUrl ? "" : "resistact-banner-desat"} w-full h-full ${card.imageContain ? "object-contain p-2" : `object-cover ${card.cartoonImageUrl ? "[object-position:50%_15%]" : "object-top"}`}`}
                onError={() => setImageFailed(true)}
              />
            ) : (
              <img src={cardFallbackImg} alt="" aria-hidden="true" className="w-full h-full object-contain p-4" />
            )}
            {/* Gradient overlay for readability — only on real photos. */}
            {showTopImage && !card.imageContain && (
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
            )}

            {/* Top-right cluster: time pill + admin edit pencil. */}
            <div className="absolute top-2.5 right-3 flex items-center gap-1.5">
              <TimeBadge light={showTopImage} />
              <TopControls light={showTopImage} />
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
                {card.isOnline
                  ? <><Globe size={11} className="text-gray-700 shrink-0" /><span className="font-['Poppins',sans-serif] text-[11px] text-gray-700 truncate">Online</span></>
                  : <><MapPin size={11} className="text-gray-700 shrink-0" /><span className="font-['Poppins',sans-serif] text-[11px] text-gray-700 truncate">{card.location}</span></>
                }
              </div>
            )}

            {/* Category pill — top-left of the banner. Solid category
                color background with white text so each card carries
                strong identity at a glance. Replaces the plain-text
                category label that used to sit in the content area. */}
            <div
              className="absolute top-2.5 left-3 inline-flex items-center rounded-md px-2 py-0.5 shadow-sm"
              style={{ backgroundColor: categoryColor }}
            >
              <span className="font-['Poppins',sans-serif] font-bold tracking-wide text-[11px] text-white">
                {card.category}
              </span>
            </div>
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
                  <span className={`block font-normal italic text-gray-400 leading-snug ${compact ? "text-[11px] mt-1" : "text-[12px] mt-1.5"}`}>
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
              <ActionRow />

              {/* Author */}
              <div className="flex items-center gap-2.5 min-w-0 justify-end">
                <div className="min-w-0 text-right">
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
          canEdit={canEdit}
          accessToken={accessToken}
          onCardUpdated={onCardUpdated}
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