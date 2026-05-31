import { useState, useEffect, useMemo, useRef, useDeferredValue, lazy, Suspense } from "react";
import { Wrench, Clock, Flame, Smile, VenetianMask, Sun, Zap, MapPin, Users, DollarSign, EyeOff, Loader2, Eye, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { initAnalytics, analytics } from "./lib/analytics";
import { GAMIFICATION_KEYFRAMES } from "./lib/animations";
import { burstConfetti } from "./lib/confetti";
import fistIcon from "../assets/6f09d83b1b948a5a0a2a9e7558c073db252c1f59.png";
import { Navbar } from "./components/Navbar";
import { SortDropdown } from "./components/SortDropdown";
import { ActionCard, ActionCardData } from "./components/ActionCard";
import { cartoonUrlFor } from "./data/cartoon-manifest";
import { synopsisFor } from "./data/synopsis-manifest";
import { FactCard } from "./components/FactCard";
import { FACT_CARDS } from "./data/factCards";
import { STATIC_CARDS, IMAGE_MAP } from "./data/actionCards";
import { AuthModal } from "./components/AuthModal";
import { AdminPanel } from "./components/AdminPanel";
import { FlagsAdminModal } from "./components/FlagsAdminModal";
import { AskFlowModal } from "./components/AskFlowModal";
import { JoinACTersModal } from "./components/JoinACTersModal";
import { InfoModal } from "./components/InfoModal";
import { EditCardModal } from "./components/EditCardModal";
import { BookmarksPanel } from "./components/BookmarksPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { locationToState, LOCATION_OPTIONS } from "./lib/locations";
import { HomeHero } from "./components/HomeHero";
import { LoggedInHero } from "./components/LoggedInHero";
import { MatchMeModal } from "./components/MatchMeModal";
import { SwipeDeck } from "./components/SwipeDeck";
// Lazy-loaded: the changelog data (~68 KB gzipped) is admin-only and rarely
// opened, so it's code-split into its own chunk instead of riding in the main
// bundle every visitor downloads.
const ChangelogModal = lazy(() =>
  import("./components/ChangelogModal").then((m) => ({ default: m.ChangelogModal })),
);
import { TierModal } from "./components/TierModal";
import { CelebrationModal } from "./components/CelebrationModal";
import { FeedbackModal } from "./components/FeedbackModal";
import { SmacksPage, STATIC_SMACKS, type ReceiptCard } from "./components/SmacksPage";
import { rankCards, score as scoreCard, loadPreferences, clearPreferences, applyMatcherConfig, fetchUserPreferences, pushUserPreferences, savePreferences, timeBucketFor, cardIsLocalToState, DEFAULT_PREFERENCES, type Preferences, type UserContext } from "./lib/matcher";
import svgPaths from "../imports/svg-77lgd1zdt6";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { supabase } from "./lib/supabase";
import type { UserApproval } from "./lib/supabase";

// Raw shape coming back from the server (uses string keys instead of imports).
// Older deployments persist cards with `spotsUsed` from before the rename, so
// accept both — `resolveCard` normalizes to `boosts` for the UI.
interface ServerCard {
  id: number;
  isFeatured?: boolean;
  pinToTop?: boolean;
  category: string;
  categoryColor: string;
  title: string;
  description: string;
  typeTag?: string;
  location?: string;
  isOnline?: boolean;
  boosts?: number;
  completions?: number;
  spotsUsed?: number;
  spotsTotal: number | "Unlimited";
  authorName: string;
  authorRole: string;
  authorLink?: string;
  targetUrl?: string | null;
  topImageKey?: string | null;
  topImageUrl?: string | null;
  /** Cartoonized banner URL — preferred display source when present.
   *  Populated by the cartoonize pipeline (scripts/generate-card-art.mjs
   *  for the seed sweep; on-the-fly worker for user uploads). */
  cartoonImageUrl?: string | null;
  /** Cartoonize pipeline status: done | pending | failed | skipped.
   *  Missing = not yet considered. */
  cartoonStatus?: "done" | "pending" | "failed" | "skipped" | null;
  authorAvatarKey?: string | null;
  authorAvatarUrl?: string | null;
  createdBy?: string;
  quickAction?: boolean;
  imageContain?: boolean;
  adminApproved?: boolean;
  firstTimerFriendly?: boolean;
  /** Admin editorial pin: floats the card to the top of the feed (just below
   *  the unconditional "Spread the Word" pinToTop card), above the automatic
   *  state-local event band. Distinct from `firstTimerFriendly`, which is a
   *  broad "good for first-timers / Today's Five" curation flag set on many
   *  seed cards — that one must NOT pin to the top. Set via the Edit modal's
   *  "⭐ Highlighted action" checkbox. */
  highlighted?: boolean;
  urlOk?: boolean;
  urlCheckedAt?: string;
  eventDate?: string;
  toneOverride?: { anger?: number; comedy?: number; subversion?: number; care?: number; hope?: number; energy?: number };
}

const API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04`;
const HEADERS = { "Content-Type": "application/json", Authorization: `Bearer ${publicAnonKey}` };

// Normalise a category string to a single canonical Title-Case form so we
// don't end up with both "FUNDING" and "Funding" in the category dropdown
// (which happened when some server seeds were uppercased and the client UI
// uses Title Case). Treats common short prepositions / articles as lowercase
// so "Letter to Editor" stays correct rather than becoming "Letter To Editor".
//
// Also folds legacy/duplicate category names into a single canonical bucket:
//   "Art Piece" / "ART PIECE" → "Art/Performance Art"
//   "Call/write" / "CALL/WRITE" → "Call" (renamed from "Call/Write" — the
//   bucket only ever contained phone-call actions; letter-writing has its
//   own category. Old data is folded forward here so any KV records still
//   carrying the old label render under the new one.)
const TITLE_CASE_STOPWORDS = new Set(["of", "to", "a", "the", "and", "or", "in", "on", "for", "at"]);
const CATEGORY_ALIASES: Record<string, string> = {
  "art piece": "Art/Performance Art",
  "art/performance art": "Art/Performance Art",
  "call/write": "Call",
  // Three category mergers (May 2026): old name on the left, surviving
  // category on the right. KV records with the old value render as the
  // new one — no migration required for display. A KV migration in the
  // Edge Function rewrites stored values to match.
  "learn": "Training",
  "letter to editor": "Letter Writing",
  "bird-dog": "Show Up",
  "spread positivity": "Act of Kindness",
  "purchase": "Represent",
};
function normaliseCategory(s: string | undefined | null): string {
  const trimmed = (s ?? "").trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (CATEGORY_ALIASES[lower]) return CATEGORY_ALIASES[lower];
  return lower
    .split(/\s+/)
    .map((w, i) =>
      i === 0 || !TITLE_CASE_STOPWORDS.has(w)
        ? w.charAt(0).toUpperCase() + w.slice(1)
        : w
    )
    .join(" ");
}

// Canonical description for the pinToTop "Spread the Word" card — kept in
// code so it's always current regardless of what's stored in the database.
const SPREAD_THE_WORD_DESCRIPTION =
  "Resistance grows one share at a time — but only if you actually share. Pick a friend who's been doomscrolling and send this their way. If everyone here invites two friends, ResistAct doubles by Tuesday. That's how movements actually scale — not virally, but two-by-two, through people who trust each other.";

// Canonical image for the pinToTop "Spread the Word" card. Server-side cards
// still have the old "RESISTACT — CITIZEN ACTION" illustration cached at a
// Supabase storage URL; we override it here so the card always picks up the
// current branding. Uses the WebP variant of the OG image (smaller than the
// JPG that the og:image meta tag references) since browsers all support it
// and the in-card render benefits from the smaller payload.
const SPREAD_THE_WORD_TOP_IMAGE = "/og-image.webp";

// Rewrite a Supabase Storage public-object URL to the on-the-fly image render
// endpoint, resizing to `width` px at quality 60. This is the single biggest
// payload win on the feed: raw uploads are warehoused at up to 1200px wide but
// the card image slot is only ~400px CSS wide, so we were shipping 3-4x the
// pixels (and 150-360 KB) per card. The render endpoint hands back a resized,
// re-compressed variant instead.
//
// Only our own Supabase object URLs are rewritten. Local "/foo.jpg" paths
// (which get WebP siblings), IMAGE_MAP bundle assets, and external CDNs all
// pass through untouched. Cartoon banners ARE routed through here now (at the
// card width) — they're generated at a full 1536px, far larger than the card
// renders, so resizing cuts each one to a fraction of its weight.
const STORAGE_OBJECT_SEG = "/storage/v1/object/public/";
function storageRenderUrl(url: string | undefined, width: number, quality = 60): string | undefined {
  if (!url) return url;
  if (!url.includes(`${projectId}.supabase.co`)) return url; // only our own storage
  const i = url.indexOf(STORAGE_OBJECT_SEG);
  if (i === -1) return url; // not an object URL (already a render URL, signed, etc.)
  const rendered =
    url.slice(0, i) + "/storage/v1/render/image/public/" + url.slice(i + STORAGE_OBJECT_SEG.length);
  const sep = rendered.includes("?") ? "&" : "?";
  // resize=contain is REQUIRED. The render endpoint defaults to resize=cover,
  // and with only a width given it crops to the source's original-height box —
  // i.e. a center crop that silently lops the sides off a wide banner (a 3:2
  // 1536×1024 came back as a face-only 800×1024). contain scales to the width
  // and preserves aspect (→ 800×533), letting CSS object-fit do any cropping.
  return `${rendered}${sep}width=${width}&resize=contain&quality=${quality}`;
}

function resolveCard(raw: ServerCard): ActionCardData {
  // Compute the topImage with the normal priority order (explicit URL beats
  // key beats undefined), THEN clobber it for the pinned Spread-the-Word
  // card so the latest branded image always shows regardless of what's in
  // the DB. Same idea as the description override below.
  const baseTopImage = (raw.topImageUrl && raw.topImageUrl.length > 0)
    ? raw.topImageUrl
    : (raw.topImageKey ? IMAGE_MAP[raw.topImageKey] : undefined);
  return {
    ...raw,
    // Normalise category casing so "FUNDING" and "Funding" don't both
    // appear as separate entries in the navbar's category dropdown.
    category:     normaliseCategory(raw.category) || raw.category,
    boosts:       raw.boosts ?? raw.spotsUsed ?? 0,
    completions:  raw.completions ?? 0,
    targetUrl:    raw.targetUrl ?? undefined,
    topImage:     raw.pinToTop ? SPREAD_THE_WORD_TOP_IMAGE : storageRenderUrl(baseTopImage, 800),
    // Cartoonized banner: server-provided value wins, then fall back to
    // the local manifest (public/cartoon-banners/ + cartoon-manifest.ts).
    // Spread the Word always shows its hand-designed art, so cartoon is
    // suppressed there even if a stray value snuck into the row.
    // cartoonUrlFor() (CDN) takes priority over the KV value — some KV rows
    // still have the old local path (/cartoon-banners/card-N.webp) from before
    // images moved to Supabase Storage, and those would 404.
    //
    // The resolved CDN URL is run through the same image-transform endpoint as
    // topImage (width 800): the source webp is a full 1536px / ~170 KB, which
    // is ~4× the card's display size. Resizing to 800px drops each banner to
    // ~40–60 KB (under our 100 KB budget) without changing the crop — ActionCard
    // still does the final object-cover. A stale local "/cartoon-banners/…" path
    // isn't a Supabase URL, so storageRenderUrl passes it through untouched.
    cartoonImageUrl: raw.pinToTop
      ? undefined
      : storageRenderUrl(cartoonUrlFor(raw.id) ?? raw.cartoonImageUrl, 800) ?? undefined,
    // Synopsis (card subtitle): server value wins, then local manifest
    // fallback so we can ship subtitle copy without an Edge Function
    // deploy. Applies to Spread the Word too now — its synopsis lives
    // in the SEED_CARD + manifest.
    synopsis: (raw as { synopsis?: string }).synopsis ?? synopsisFor(raw.id) ?? undefined,
    cartoonStatus:   raw.cartoonStatus ?? undefined,
    authorAvatar: raw.authorAvatarKey ? IMAGE_MAP[raw.authorAvatarKey] : (raw.authorAvatarUrl ?? undefined),
    // Override description for the pinToTop card so it's always current.
    description:  raw.pinToTop ? SPREAD_THE_WORD_DESCRIPTION : raw.description,
  };
}

// ─── Featured illustration ────────────────────────────────────────────────────
import diagramImg from "../assets/3a930cb92932029145f5289a4b745deaa43e0aa6.png";
import fistImg from "../assets/6f09d83b1b948a5a0a2a9e7558c073db252c1f59.png";

function FeaturedIllustration() {
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <img
        src={diagramImg}
        alt="ACTION → MATCH → ACT → CHANGE"
        className="w-full h-full object-contain"
      />
    </div>
  );
}

// ─── Cards localStorage cache ─────────────────────────────────────────────────
// First-paint optimization: stash the first page of /actions in localStorage so
// returning visitors see ~100 real cards immediately instead of waiting for the
// edge function to cold-start, run migrations, and prefix-scan KV. We cache the
// raw ServerCard array (not the resolved one) so image keys re-resolve through
// the *current* bundle's IMAGE_MAP — avoids stale hashed URLs after a deploy.
const CARDS_CACHE_KEY = "resistact:cards-cache:v1";
const CARDS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — fresh enough; sync overrides anyway

interface CardsCachePayload {
  savedAt: number;
  total: number;
  rawCards: ServerCard[];
}

// ─── Pill-filter persistence ──────────────────────────────────────────────────
// Stores the user's current pill picks (category / location / remote / quick-
// actions / show-done / sort) in localStorage so they survive page reloads
// and tab restarts. Pure same-device persistence — no server round-trip. The
// Match Me / Refine Your Matches preferences are stored separately via
// loadPreferences/savePreferences and ALSO sync to the user's account; this
// pill state isn't synced cross-device yet (we can lift it into Preferences
// later if users complain about losing picks across devices).
const PILL_FILTERS_KEY = "resistact:pill-filters:v1";

interface PillFiltersPayload {
  activeFilters: Record<string, string[]>;
  quickActionsOnly: boolean;
  showDone: boolean;
  sortBy: "popular" | "newest" | "az";
}

function readPillFilters(): PillFiltersPayload | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(PILL_FILTERS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PillFiltersPayload>;
    // Light validation — anything broken just returns null and we fall back
    // to the in-code defaults.
    if (!parsed || typeof parsed !== "object") return null;
    const activeFilters = (parsed.activeFilters && typeof parsed.activeFilters === "object")
      ? Object.fromEntries(
          Object.entries(parsed.activeFilters)
            .filter(([, v]) => Array.isArray(v))
            .map(([k, v]) => [k, (v as unknown[]).filter((x): x is string => typeof x === "string")]),
        )
      : {};
    return {
      activeFilters,
      quickActionsOnly: parsed.quickActionsOnly === true,
      showDone: parsed.showDone === true,
      sortBy: parsed.sortBy === "newest" || parsed.sortBy === "az" ? parsed.sortBy : "popular",
    };
  } catch {
    return null;
  }
}

function writePillFilters(p: PillFiltersPayload) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PILL_FILTERS_KEY, JSON.stringify(p));
  } catch {
    // Quota exceeded, private browsing, etc. — silently no-op.
  }
}

function readCardsCache(): { cards: ActionCardData[]; total: number } | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(CARDS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CardsCachePayload;
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > CARDS_CACHE_TTL_MS) return null;
    if (!Array.isArray(parsed.rawCards) || parsed.rawCards.length === 0) return null;
    // Defense-in-depth: never resurrect a card from cache unless it was
    // EXPLICITLY adminApproved at the time we cached it. Stops a stale cache
    // (or a future bug elsewhere) from briefly flashing pending / deleted /
    // imageless cards to public visitors on first paint before the live sync
    // overwrites them. Admins also won't see pending cards until the live
    // sync arrives, but pending-review is not a first-paint-critical surface.
    const approvedOnly = parsed.rawCards.filter((c) => (c as any).adminApproved === true);
    if (approvedOnly.length === 0) return null;
    return {
      cards: approvedOnly.map(resolveCard),
      total: parsed.total ?? approvedOnly.length,
    };
  } catch {
    return null;
  }
}

function writeCardsCache(rawCards: ServerCard[], total: number) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      CARDS_CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), total, rawCards } satisfies CardsCachePayload),
    );
  } catch {
    // Quota exceeded, private browsing, etc. — silently no-op.
  }
}

// ─── Skeleton card ────────────────────────────────────────────────────────────
function CardSkeleton() {
  return (
    <div className="bg-white rounded-2xl shadow-md overflow-hidden animate-pulse">
      <div className="h-[220px] bg-gray-200" />
      <div className="px-4 pb-4 pt-3 space-y-2.5">
        <div className="h-3 w-16 bg-gray-200 rounded" />
        <div className="h-4 w-3/4 bg-gray-200 rounded" />
        <div className="h-3 w-full bg-gray-200 rounded" />
        <div className="h-3 w-5/6 bg-gray-200 rounded" />
        <div className="h-2 w-full bg-gray-200 rounded-full mt-2" />
        <div className="flex items-center gap-2 pt-1">
          <div className="w-8 h-8 rounded-full bg-gray-200 shrink-0" />
          <div className="flex-1 space-y-1">
            <div className="h-3 w-24 bg-gray-200 rounded" />
            <div className="h-2 w-16 bg-gray-200 rounded" />
          </div>
          <div className="h-8 w-16 bg-gray-200 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  // ── Card state ──
  // Hydrate from localStorage cache when fresh so repeat visitors skip the
  // edge-function round-trip and see ~100 cards on first paint. Falls back
  // to STATIC_CARDS (1 card) on first visit; a fresh sync runs in the
  // background either way to reconcile boosts, new cards, and admin edits.
  const cardsCacheHit = readCardsCache();
  const [cards, setCards] = useState<ActionCardData[]>(cardsCacheHit?.cards ?? STATIC_CARDS);
  const [synced, setSynced] = useState(false);
  // Render skeleton grid only when we have nothing meaningful to show yet.
  // With a cache hit we skip skeletons entirely — the cached cards are good
  // enough until the live sync replaces them milliseconds later.
  const [loading, setLoading] = useState(!cardsCacheHit);
  const [serverTotal, setServerTotal] = useState(cardsCacheHit?.total ?? 0);
  const [serverOffset, setServerOffset] = useState(cardsCacheHit?.cards.length ?? 0);
  const [loadingMore, setLoadingMore] = useState(false);
  // How many cards to actually render in the DOM. Kept small to avoid
  // Safari/mobile memory crashes when hundreds of image-bearing cards are
  // painted at once. Cards are still loaded into `cards` state for filtering.
  // Mobile (<640px) gets 20; desktop gets 100 to fill a wide screen on first load.
  function getDisplayPage() {
    return typeof window !== "undefined" && window.innerWidth >= 640 ? 9999 : 20;
  }
  const [displayLimit, setDisplayLimit] = useState(getDisplayPage);
  const [boostedCards, setActedCards] = useState<Set<number>>(() => {
    try {
      const stored = localStorage.getItem("resistact_boosted");
      return stored ? new Set<number>(JSON.parse(stored)) : new Set<number>();
    } catch { return new Set<number>(); }
  });
  const [completedCards, setCompletedCards] = useState<Set<number>>(() => {
    try {
      const stored = localStorage.getItem("resistact_completed");
      return stored ? new Set<number>(JSON.parse(stored)) : new Set<number>();
    } catch { return new Set<number>(); }
  });
  const [bookmarkedCards, setBookmarkedCards] = useState<Set<number>>(() => {
    try {
      const stored = localStorage.getItem("resistact_bookmarks");
      return stored ? new Set<number>(JSON.parse(stored)) : new Set<number>();
    } catch { return new Set<number>(); }
  });
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [boostedFacts, setBoostedFacts] = useState<Set<number>>(new Set());
  const [factBoostCounts, setFactBoostCounts] = useState<Record<number, number>>({});

  // Stable random ordering for facts — shuffled once on mount.
  const factOrder = useMemo<Record<number, number>>(() => {
    const ids = FACT_CARDS.map((f) => f.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return Object.fromEntries(ids.map((id, idx) => [id, idx]));
  }, []);

  const handleFactBoost = (id: number) => {
    const alreadyBoosted = boostedFacts.has(id);
    const delta = alreadyBoosted ? -1 : 1;
    setBoostedFacts((prev) => {
      const next = new Set(prev);
      alreadyBoosted ? next.delete(id) : next.add(id);
      return next;
    });
    setFactBoostCounts((prev) => ({
      ...prev,
      [id]: Math.max(0, (prev[id] ?? 0) + delta),
    }));
  };

  // ── Auth state ──
  const [approval, setApproval] = useState<UserApproval | null>(null);
  const [loginStreak, setLoginStreak] = useState<number>(1);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [myCompletions, setMyCompletions] = useState<{
    total: number;
    byCategory: Record<string, number>;
    completedIds: number[];
  } | null>(null);
  // Anonymous fallback so non-logged-in users still see a personal scoreboard
  // backed by their localStorage completedCards set.
  const localCompletions = useMemo(() => {
    const ids = [...completedCards];
    if (ids.length === 0) return null;
    const byCategory: Record<string, number> = {};
    for (const id of ids) {
      const card = cards.find((c) => c.id === id);
      const cat = card?.category ?? "OTHER";
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    }
    return { total: ids.length, byCategory, completedIds: ids };
  }, [completedCards, cards]);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  // Swipe "Discover" mode — presents the current ranked feed one card at a time.
  const [swipeOpen, setSwipeOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [actOpen, setActOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [tierModalOpen, setTierModalOpen] = useState(false);
  // Celebration modal fires on a positive "I did this" — carries the before /
  // after action totals so the modal can animate the count-up and detect
  // tier-up. Null = no celebration showing.
  const [celebration, setCelebration] = useState<{ prev: number; next: number } | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [matchInitialStep, setMatchInitialStep] = useState<0 | 1>(0);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [scrollNudgeDismissed, setScrollNudgeDismissed] = useState(
    () => localStorage.getItem("resistact_nudge_dismissed") === "1"
  );
  const [scrollNudgeVisible, setScrollNudgeVisible] = useState(false);
  const scrollNudgeFired = useRef(false);
  /** Active match prefs — when set, the feed re-ranks by `rankCards`. */
  const [matchPrefs, setMatchPrefs] = useState<Preferences | null>(null);
  // Incremented every time the user applies a new Match config. Used to
  // re-key the first 12 cards in the Acts grid so they stagger-fade in,
  // giving the "we just built this lineup for you" feel — without animating
  // every card on every infinite-scroll page.
  const [staggerKey, setStaggerKey] = useState(0);
  const [editCardId, setEditCardId] = useState<number | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  function showToast(msg: string) {
    setToastMessage(msg);
    window.setTimeout(() => setToastMessage((current) => (current === msg ? null : current)), 2200);
  }

  // ── Admin impersonation (read-only view-as) ──────────────────────────────
  // When non-null, the app overlays this user's state on top of the admin's
  // own state for the duration of the view-as session. Writes (boost,
  // complete, bookmark, etc.) are suppressed via the isImpersonating guard
  // in each handler — they no-op with a toast. Exiting clears the snapshot
  // and posts to /admin/impersonate/:id/exit so the audit log closes.
  type ImpersonationSession = {
    userId: string;
    approval: UserApproval;
    matchPrefs: Preferences | null;
    bookmarks: number[];
    completions: { total: number; byCategory: Record<string, number>; completedIds: number[] };
    boostedIds: number[];
    streak: number;
    startedAt: string;
  };
  const [impersonating, setImpersonating] = useState<ImpersonationSession | null>(null);
  const isImpersonating = impersonating !== null;

  async function startImpersonation(targetUserId: string, fallbackName: string) {
    if (!accessToken) { showToast("Not signed in"); return; }
    try {
      const res = await fetch(`${API}/admin/impersonate/${targetUserId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) { showToast(data?.error ?? "Could not start view-as"); return; }
      setImpersonating({
        userId: targetUserId,
        approval: data.approval,
        matchPrefs: data.preferences ?? null,
        bookmarks: Array.isArray(data.bookmarks) ? data.bookmarks : [],
        completions: data.completions ?? { total: 0, byCategory: {}, completedIds: [] },
        boostedIds: Array.isArray(data.boostedIds) ? data.boostedIds : [],
        streak: typeof data.streak === "number" ? data.streak : 1,
        startedAt: data.startedAt ?? new Date().toISOString(),
      });
      setAdminPanelOpen(false);
      setStaggerKey((k) => k + 1); // re-stagger the feed so the new view animates in
      showToast(`Viewing as ${data.approval?.name ?? fallbackName}`);
    } catch {
      showToast("Network error starting view-as");
    }
  }

  async function exitImpersonation() {
    const target = impersonating;
    setImpersonating(null);
    setStaggerKey((k) => k + 1);
    showToast("Exited view-as");
    if (target && accessToken) {
      // Best-effort audit-log close. Don't block the UI on it.
      fetch(`${API}/admin/impersonate/${target.userId}/exit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => { /* ignore */ });
    }
  }

  // Computed values that swap in the impersonated user's state when active.
  // Component code reads these instead of the raw state slots so the
  // override is a single substitution point per render, not 20.
  const effectiveApproval     = isImpersonating ? impersonating!.approval               : approval;
  const effectiveMatchPrefs   = isImpersonating ? impersonating!.matchPrefs             : matchPrefs;
  const effectiveBookmarked   = isImpersonating ? new Set<number>(impersonating!.bookmarks)        : bookmarkedCards;
  const effectiveCompleted    = isImpersonating ? new Set<number>(impersonating!.completions.completedIds) : completedCards;
  const effectiveBoosted      = isImpersonating ? new Set<number>(impersonating!.boostedIds)       : boostedCards;
  const effectiveMyCompletions = isImpersonating ? impersonating!.completions            : myCompletions;
  const effectiveLoginStreak  = isImpersonating ? impersonating!.streak                 : loginStreak;

  // Block any write handler during view-as. Returns true (write was blocked)
  // if impersonating; otherwise false (caller should proceed). Single source
  // of truth for the "view-as is read-only" rule.
  function blockWriteIfImpersonating(): boolean {
    if (!isImpersonating) return false;
    showToast("View-as is read-only — exit to make changes");
    return true;
  }

  // ── Live stats from server ──
  const [statsCitiesCount, setStatsCitiesCount] = useState<number | null>(null);
  const [statsUsersCount, setStatsUsersCount] = useState<number | null>(null);
  const [pendingUsersCount, setPendingUsersCount] = useState<number>(0);
  const [serverPendingActsCount, setServerPendingActsCount] = useState<number>(0);
  const [flagsCount, setFlagsCount] = useState<number>(0);
  const [flagsAdminOpen, setFlagsAdminOpen] = useState<boolean>(false);
  const [siteUpdating, setSiteUpdating] = useState(false);

  // ── Filters ── persisted in localStorage so a user's pill picks
  //   (Category / Location / Remote / 5 Min Max / Sort / Show Done) survive
  //   page reloads and tab restarts. Same-device persistence only for now;
  //   could be lifted into the server-side Preferences record for cross-
  //   device sync later.
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>(
    () => readPillFilters()?.activeFilters ?? {},
  );
  // Live ref to the latest activeFilters so async callbacks (e.g. the auth
  // sync handler) can read it without going stale across re-renders. The
  // useEffect below keeps it in lock-step with the state.
  const activeFiltersRef = useRef(activeFilters);
  useEffect(() => { activeFiltersRef.current = activeFilters; }, [activeFilters]);
  const [activeTab, setActiveTab] = useState<"facts" | "acts" | "receipts">("acts");
  const [smacksPendingVersion, setSmacksPendingVersion] = useState(0);
  // ── Smacks filter / sort state lifted up so the navbar can render the same
  //   chips + sort toggle as the SmacksPage. Keeping a single source of truth
  //   here means both places stay in sync without prop-callbacks dance. ──
  const [smacksActiveTags, setSmacksActiveTags] = useState<string[]>([]);
  const [smacksSortBy, setSmacksSortBy] = useState<"top" | "new" | "pending">("top");
  const [pendingActsVersion, setPendingActsVersion] = useState(0);
  const [showPendingActsOnly, setShowPendingActsOnly] = useState(false);
  const [deepLinkId, setDeepLinkId] = useState<number | null>(() => {
    const param = new URLSearchParams(window.location.search).get("act");
    const id = param ? parseInt(param, 10) : NaN;
    return isNaN(id) ? null : id;
  });
  const [receipts, setReceipts] = useState<ReceiptCard[]>([]);
  const [hiddenSmackIds, setHiddenSmackIds] = useState<number[]>([]);
  // Derived once per `receipts` change so the navbar's chip rendering doesn't
  // recompute on every render. Must be declared AFTER `receipts` (temporal
  // dead zone — referencing receipts earlier crashed with "Cannot access
  // 'receipts' before initialization"). STATIC_SMACKS is constant so it's
  // safe to fold in here. Tags sorted alphabetically for stable chip order.
  const smacksAvailableTags = useMemo(
    () => Array.from(new Set([...receipts, ...STATIC_SMACKS].flatMap((r) => r.tags))).sort(),
    [receipts],
  );
  const [searchQuery, setSearchQuery] = useState("");
  // useDeferredValue lets React keep the input responsive: keystrokes update
  // `searchQuery` synchronously (so the textbox shows them instantly), while
  // the heavy feed re-filter uses `deferredSearchQuery` and runs as a low-
  // priority update React can interrupt for more typing.
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [quickActionsOnly, setQuickActionsOnly] = useState(
    () => readPillFilters()?.quickActionsOnly ?? false,
  );
  const [showDone, setShowDone] = useState(
    () => readPillFilters()?.showDone ?? false,
  );
  const [sortBy, setSortBy] = useState<"popular" | "newest" | "az">(
    () => readPillFilters()?.sortBy ?? "popular",
  );

  function handleFilterChange(filterName: string, selected: string[]) {
    setActiveFilters((prev) => ({ ...prev, [filterName]: selected }));
  }

  function handleTabChange(tab: "facts" | "acts" | "receipts") {
    setActiveTab(tab);
    setActiveFilters({});
    setSearchQuery("");
    setQuickActionsOnly(false);
    if (tab !== "acts") setShowPendingActsOnly(false);
  }

  // ── Apply filters client-side ──
  // A card is "location-agnostic" — doable from anywhere, so it must NEVER be
  // hidden by a state filter (it sorts below local results instead). Single
  // source of truth shared by the Location filter chip AND the Match Me
  // state filter so the two paths can't disagree. Critically this includes
  // the canonical "Remote"/"At Home" location strings: a card can carry
  // location:"Remote" while isOnline is false (the create/edit form doesn't
  // always set both), and locationToState("Remote") returns "Remote" (not
  // null), so without these explicit cases such a card would wrongly fail
  // both the isOnline check and the cardState===null check and get dropped.
  function isLocationAgnostic(card: ActionCardData): boolean {
    if (card.isOnline) return true;
    if ((card as any).atHome === true) return true;
    const loc = (card.location ?? "").trim();
    if (loc === "" || loc === "Remote" || loc === "At Home" ||
        loc === "National" || loc === "Multi-state" || loc === "Multi-State") return true;
    // Unrecognized freeform location that doesn't resolve to a known state →
    // treat as agnostic so it's never hidden by a state filter.
    return locationToState(loc) === null;
  }

  function applyFilters(allCards: ActionCardData[]): ActionCardData[] {
    const q = deferredSearchQuery.toLowerCase().trim();
    // SEARCH OVERRIDES EVERYTHING — when the user types a query, the
    // explicit intent ("find me THIS thing") is much stronger than any
    // filter chip they set earlier. Bypass all other filters (category,
    // location, 5 Minutes Max, Show Done, completed-hiding) so the user
    // never wonders why they can't find a card they know exists. The
    // chips stay lit in the UI but they don't apply while q is non-empty.
    if (q) {
      return allCards.filter((card) => {
        const haystack = [
          card.title,
          card.description,
          card.category,
          card.authorName,
          card.authorRole,
          card.authorLink ?? "",
          card.targetUrl ?? "",
          card.location ?? "",
          card.actionType ?? "",
          card.timeCommitment ?? "",
          (card as { sponsor?: string }).sponsor ?? "",
        ].join(" ").toLowerCase();
        return haystack.includes(q);
      });
    }
    return allCards.filter((card) => {

      // Category
      const cats = activeFilters["Category"] ?? [];
      if (cats.length > 0 && !cats.includes(card.category)) return false;

      // Location — match by canonical state (or "Remote"/"National"/etc).
      // Legacy "City, ST" values and old names ("Online"/"From Home"/"Multi-state")
      // get normalized via locationToState.
      //
      // Design intent: selecting a state (e.g. "Washington") sorts state-matching
      // cards to the top but does NOT eliminate online/national/multi-state acts —
      // those are always doable from anywhere and should still appear below the
      // local results. Only cards that are location-specific AND belong to a
      // different state are hard-filtered out.
      // "Remote" works differently: it IS a hard filter — it shows only
      // online/at-home acts and nothing else.
      const locs = activeFilters["Location"] ?? [];
      if (locs.length > 0) {
        const cardState = locationToState(card.location);
        const matchesState = cardState !== null && locs.some(l => l !== "Remote" && l === cardState);
        const stateFilters = locs.filter(l => l !== "Remote");
        const hasStateFilter = stateFilters.length > 0;

        // "Remote" pill: show only online/at-home acts. Accept both the
        // isOnline/atHome booleans AND the canonical "Remote"/"At Home"
        // location strings, since the create/edit form doesn't always set
        // both (a card can be location:"Remote" with isOnline:false).
        const remoteLoc = (card.location ?? "").trim();
        const matchesRemote = locs.includes("Remote") &&
          (card.isOnline || (card as any).atHome === true ||
           remoteLoc === "Remote" || remoteLoc === "At Home");

        if (hasStateFilter) {
          // State filter is active: keep matching-state cards + location-agnostic cards.
          // Hard-filter only cards pinned to a specific OTHER state.
          if (!matchesState && !isLocationAgnostic(card)) return false;
        } else {
          // "Remote"-only filter: strict — show only online/at-home acts.
          if (!matchesRemote) return false;
        }
      }

      // Quick actions only (5–10 min wins)
      if (quickActionsOnly && !card.quickAction) return false;

      // Hide completed cards unless "Show Done" is checked
      if (!showDone && completedCards.has(card.id)) return false;

      return true;
    });
  }

  // Sort: round-robin by category so same-category cards never cluster.
  // Within each category bucket, order by id descending (newer/higher-curated first).
  function interleaveByCategory(group: ActionCardData[]): ActionCardData[] {
    const buckets = new Map<string, ActionCardData[]>();
    for (const c of group) {
      const cat = c.category || "_other";
      if (!buckets.has(cat)) buckets.set(cat, []);
      buckets.get(cat)!.push(c);
    }
    // Within each category bucket, sort by id descending so higher IDs (more
    // recently curated) appear first when engagement scores are equal.
    for (const arr of buckets.values()) arr.sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
    // Category visit order: sort categories by highest id in each bucket so
    // categories with newer cards cycle first.
    const cats = Array.from(buckets.keys()).sort((a, b) => {
      const aTop = buckets.get(a)![0].id ?? 0;
      const bTop = buckets.get(b)![0].id ?? 0;
      return bTop - aTop;
    });
    const out: ActionCardData[] = [];
    while (out.length < group.length) {
      for (const cat of cats) {
        const bucket = buckets.get(cat)!;
        if (bucket.length > 0) out.push(bucket.shift()!);
      }
    }
    return out;
  }

  // Sort order:
  //   1. Engagement score = boosts + completions DESC — high-engagement
  //      cards bubble to the top regardless of location.
  //   2. Within a score tier: location bucket — Online → National →
  //      Multi-state → specific states → no-location.
  //   3. Within a (score, location) bucket: round-robin by category so
  //      same-category cards never cluster (existing helper).
  function locationBucket(c: ActionCardData): number {
    if (c.isOnline) return 0;
    const loc = (c.location ?? "").trim();
    if (loc === "National") return 1;
    if (loc === "Multi-state" || loc === "Multi-State") return 2;
    if (loc) return 3;
    return 4;
  }
  // When a specific state is selected, matching-state cards sort first.
  // Within that, location-agnostic acts (Online → National → Multi-state →
  // unspecified) follow in the usual order. Other-state cards are already
  // filtered out before we reach the sort, so bucket 5 is a safe sentinel.
  function locationBucketWithState(c: ActionCardData, selectedStates: string[]): number {
    if (selectedStates.length === 0) return locationBucket(c);
    const cardState = locationToState(c.location);
    if (cardState !== null && selectedStates.includes(cardState)) return 0; // matching state: top
    if (c.isOnline) return 1;
    const loc = (c.location ?? "").trim();
    if (loc === "National") return 2;
    if (loc === "Multi-state" || loc === "Multi-State") return 3;
    return 4; // no location / at-home
  }
  function engagementScore(c: ActionCardData): number {
    return (c.boosts ?? 0) + (c.completions ?? 0);
  }
  // For anonymous users with no known location (no login, no Match Me prefs),
  // demote hyper-local actions so the feed leads with Online / National
  // actions instead of e.g. "Beaver, OR" or "Tesla Takedown — Boston".
  // A new user who can't act on a hyper-local card will bounce; the global
  // actions give them something to actually do.
  // Doesn't change behaviour for logged-in users or anyone who has run
  // Match Me — those flows already factor in location intent.
  const demoteHyperLocal = !accessToken && !matchPrefs;


  // Today's date as ISO string (YYYY-MM-DD) for expiry + sort comparisons.
  // MUST be declared BEFORE the function declarations below — those close
  // over `todayISO`, and a `const` in the temporal dead zone throws
  // "Cannot access 'todayISO' before initialization" if the function is
  // ever invoked before this line executes. Hoisted function declarations
  // are callable immediately on entry to the component body, so the safest
  // ordering is: declare the constants first, then the functions that
  // close over them.
  const todayISO = new Date().toISOString().slice(0, 10);

  // Count of acts created today (UTC). Surfaced as a parenthetical next to
  // the total acts count in the persistent footer ("701 acts (1 new today)").
  const newActionsToday = useMemo(
    () => cards.filter((c) => (((c as any).createdAt as string | undefined) ?? "").slice(0, 10) === todayISO).length,
    [cards, todayISO],
  );

  // Upcoming-event boost — pushes time-sensitive cards toward the top of the
  // Popular sort. Closer event = bigger boost. Past events return 0 because
  // they're already filtered out of the visible feed (see gated[] above).
  // Tuned to the engagement-score scale (raw boosts + completions, typically
  // 0-50 for the busiest cards), so a "tomorrow" event meaningfully tiers
  // with the most popular evergreen cards but doesn't unconditionally beat
  // a 100-boost flagship card. Tweak the magnitudes here if events need to
  // surface harder or softer.
  function upcomingEventBoost(c: ActionCardData): number {
    if (!c.eventDate) return 0;
    if (c.eventDate < todayISO) return 0;
    const today = Date.parse(todayISO);
    const event = Date.parse(c.eventDate);
    if (Number.isNaN(today) || Number.isNaN(event)) return 0;
    const daysUntil = Math.max(0, Math.round((event - today) / 86_400_000));
    if (daysUntil === 0)   return 40;   // happening today
    if (daysUntil === 1)   return 30;   // tomorrow
    if (daysUntil <= 3)    return 20;   // within 3 days
    if (daysUntil <= 7)    return 12;   // within a week
    if (daysUntil <= 14)   return 6;    // within two weeks
    if (daysUntil <= 30)   return 3;    // within a month
    return 1;                           // scheduled but far out — small lift
  }

  function effectiveScore(c: ActionCardData): number {
    const base = engagementScore(c) + upcomingEventBoost(c);
    if (!demoteHyperLocal) return base;
    const lb = locationBucket(c);
    if (lb === 3) return base * 0.35;       // specific state / city
    if (lb === 4) return base * 0.7;        // unspecified location
    return base;                            // Online / National / Multi-state untouched
  }
  const isAdminUser = approval?.isAdmin === true;
  const pendingActsCount   = isAdminUser ? serverPendingActsCount : 0;
  const pendingSmacksCount = isAdminUser ? receipts.filter((r) => (r as any).adminApproved === false).length : 0;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const displayedCards = useMemo(() => {
    // IMPERSONATION OVERRIDE — when view-as is active, shadow the per-user
    // state slots with the impersonated user's data so the rest of this
    // memo's existing references (matchPrefs, completedCards, boostedCards,
    // isAdminUser) automatically reflect the target user's POV. Cheaper
    // than threading effective* values through every internal reference.
    const matchPrefs      = effectiveMatchPrefs;
    const completedCards  = effectiveCompleted;
    const boostedCards    = effectiveBoosted;
    const isAdminUser     = isImpersonating ? false : (approval?.isAdmin === true);
    // ── Global gate: expiry + approval + already-done ────────────────────────
    const gated = cards.filter((card) => {
      // Hide expired events from everyone
      if (card.eventDate && card.eventDate < todayISO) return false;
      // Hide unapproved cards from non-admins. Tightened from `=== false` to
      // `!== true` so cards with `adminApproved: undefined` ALSO get hidden
      // from the public — explicit approval is required, not just absence of
      // an explicit false. Admins still see everything (with a PENDING badge
      // on the unapproved ones).
      if (card.adminApproved !== true && !isAdminUser) return false;
      // Defense in depth: even an approved card hidden from public if it has
      // no image. Server-side `approved-without-image-cleanup` migration is
      // the authoritative fix, but until that's redeployed and re-run, this
      // client-side guard stops imageless cards from leaking onto the public
      // feed. Admins still see them so they can review + add an image.
      if (!isAdminUser) {
        // A URL counts as "no image" if it points at a CDN we know expires
        // its signed-URL payloads — tiktokcdn-us / tiktokcdn rotates signed
        // URLs every couple weeks and silently returns 403 after that.
        // Instagram's `cdninstagram.com` does the same (`oh=` / `oe=` ttl).
        // Treating those as missing means cards with dead URLs get hidden
        // from the public until an admin re-hosts the image. Admins still
        // see them so they can edit + replace.
        const url = (card as any).topImageUrl as string | undefined;
        const isLikelyExpired = typeof url === "string" && /(?:tiktokcdn|cdninstagram)/i.test(url);
        const hasUsableUrl = Boolean(url) && !isLikelyExpired;
        const hasImage = hasUsableUrl || Boolean((card as any).topImageKey) || Boolean((card as any).topImage);
        if (!hasImage) return false;
      }
      // Completed cards stay in the feed but get sorted to the bottom (see
      // `completedLast` below) so users can still find things they've done
      // without them dominating the top.
      return true;
    });

    // The "Spread the Word about ResistAct" card (pinToTop) must show up at
    // the very top of the feed UNCONDITIONALLY — filters, search query,
    // Quick Actions, Match Me preferences, sort orders, login state — none
    // of them should be able to push it down or hide it. Pull pinToTop cards
    // OUT of the working set before any filtering / ranking happens, then
    // prepend them to whatever the rest of the pipeline produces.
    const pinnedAlwaysShow = gated.filter((c) => c.pinToTop);
    const unpinnedGated = gated.filter((c) => !c.pinToTop);

    const filtered = applyFilters(unpinnedGated);

    // Helper: prepend the always-show pinned card(s) to any result array.
    // Filters and match-me operate only on `filtered` / `rankable` below,
    // so the pinned card never gets dropped by category/location/Match Me/etc.
    //
    // Second pin layer: when the user has told us a state (via Match Me) AND
    // we have a card with an upcoming `eventDate` in that state, lift those
    // ahead of everything else. The matcher's score already gives state-local
    // and event-proximity bonuses but they can be out-scored by tone matches
    // — a hard pin guarantees a state-local rally next week is the first
    // thing the user sees regardless of how it scores. Cards inside the pin
    // band are sorted by event date ASC (soonest first). Reuses the outer
    // `todayISO` constant declared above the useMemo.
    const userState = matchPrefs?.state ?? null;
    const localUpcomingIds = new Set<number>();
    if (userState) {
      // Candidates: future-dated, state-local, approved.
      const candidates = cards.filter((c) => {
        const d = (c as any).eventDate as string | undefined;
        if (!d || d < todayISO) return false;
        if (!cardIsLocalToState(c, userState)) return false;
        if (c.adminApproved === false && !isAdminUser) return false;
        return true;
      });
      // CRITICAL: route the candidates through the same applyFilters
      // pipeline the rest of the feed uses. Without this, the pin band
      // bypasses the navbar filter chips ("5 Minutes Max", Category,
      // Location, Search, Show-Done) — surfacing a 3-hour PROTEST when
      // the user has clicked "5 Minutes Max" is a contradiction of the
      // explicit filter intent. Fixes the audit finding from v1.1.52
      // (reports/audit-2026-05-24.md) where state-local protests
      // bypassed quickActionsOnly.
      for (const c of applyFilters(candidates)) {
        if (typeof c.id === "number") localUpcomingIds.add(c.id);
      }
    }
    const localUpcomingCards = (() => {
      if (localUpcomingIds.size === 0) return [] as ActionCardData[];
      const matches = cards.filter((c) => typeof c.id === "number" && localUpcomingIds.has(c.id));
      matches.sort((a, b) => {
        const da = (a as any).eventDate as string | undefined;
        const db = (b as any).eventDate as string | undefined;
        return (da ?? "9999").localeCompare(db ?? "9999");
      });
      return matches;
    })();

    // The in-person lift only kicks in once the user has actually set a
    // location (a non-Remote state in the Location filter — which is mirrored
    // from the Match Me state). Without a location, in-person events come from
    // all over the country and floating them up is just noise, so we keep the
    // original order (pin → highlights → rest). With a location set, the feed
    // is already scoped to that state + agnostic cards, so the in-person tier
    // surfaces *local* show-up-somewhere actions.
    const hasStateLocation = (activeFilters["Location"] ?? []).some((l) => l !== "Remote");

    const withPinned = (arr: ActionCardData[]): ActionCardData[] => {
      // Order (location set): pinToTop (Spread the Word) → IN-PERSON tier →
      // admin-highlighted → everything else. Order (no location): pinToTop →
      // admin-highlighted → everything else (in-person tier is empty).
      // Each band is de-duped against the ones above it and against the rest so
      // cards never appear twice.
      //
      // The in-person tier sits ABOVE admin highlights (product call: physical,
      // show-up-somewhere actions are the priority once we know where you are).
      // It has two sub-bands:
      //   1. state-local upcoming events, soonest-first (localUpcomingCards is
      //      already date-sorted) — preserves the "what's near me & soon" lift;
      //   2. every other location-specific (non-agnostic) card, in the active
      //      sort order.
      // Online / remote / national / at-home cards are location-agnostic and
      // stay below. Highlights are still pulled from `arr` (not `cards`) so they
      // keep respecting the active filters / search / Match Me result set.
      const usedIds = new Set<number>();
      for (const c of pinnedAlwaysShow) if (typeof c.id === "number") usedIds.add(c.id);

      const localBand = hasStateLocation
        ? localUpcomingCards.filter((c) => typeof c.id === "number" && !usedIds.has(c.id))
        : [];
      for (const c of localBand) usedIds.add(c.id!);

      const inPersonBand = hasStateLocation
        ? arr.filter(
            (c) => !c.pinToTop && typeof c.id === "number" && !usedIds.has(c.id) && !isLocationAgnostic(c),
          )
        : [];
      for (const c of inPersonBand) usedIds.add(c.id!);

      const highlightBand = arr.filter(
        (c) => c.highlighted && !c.pinToTop && typeof c.id === "number" && !usedIds.has(c.id),
      );
      for (const c of highlightBand) usedIds.add(c.id!);

      const rest = arr.filter((c) => !c.pinToTop && !(typeof c.id === "number" && usedIds.has(c.id)));
      return [...pinnedAlwaysShow, ...localBand, ...inPersonBand, ...highlightBand, ...rest];
    };
    // Backwards-compat alias used further down — same behaviour now.
    const pinFirst = withPinned;

    // Push completed cards to the bottom while preserving relative order
    // within each group. Applied AFTER sort/rank but BEFORE pinFirst so a
    // pinned-but-completed card still rises to the top.
    const completedLast = (arr: ActionCardData[]): ActionCardData[] => {
      if (completedCards.size === 0) return arr;
      const active: ActionCardData[] = [];
      const done: ActionCardData[] = [];
      for (const c of arr) {
        if (completedCards.has(c.id)) done.push(c);
        else active.push(c);
      }
      return [...active, ...done];
    };

    // ── Match-me mode: rank by user-supplied tone/time/setting/risk prefs ─────
    // Drops engagement-based, location-bucket, and category-interleave ordering;
    // the matcher's score already incorporates engagement and the user's intent
    // is more specific. We pass an empty completedIds so the matcher doesn't
    // drop completed cards — completedLast pushes them to the bottom instead.
    //
    // SEARCH OVERRIDE: when the user has typed a query, skip the Match Me
    // branch entirely. applyFilters has already bypassed all chips above, so
    // `filtered` holds the raw search hits. Running them through the matcher
    // would apply the 30%-of-top-score threshold and the time-bucket hard
    // caps — both of which can hide cards the user explicitly searched for.
    // Fall through to the normal Popular/AZ/Newest sort below instead.
    if (matchPrefs && !deferredSearchQuery.trim()) {
      // Admins always see pending cards — pull them out so the score threshold
      // doesn't silently drop them, then append them after the ranked results.
      // Admin-only "still pending" set surfaced in their match feed. Apply the
      // same state hard filter the matcher's `score()` uses so picking a state
      // actually hides out-of-state pending cards from the matched view. Admins
      // still see everything in the AdminPanel — this only narrows the feed.
      const pendingForAdmin = isAdminUser
        ? filtered.filter((c) => {
            if (c.adminApproved !== false) return false;
            if (!matchPrefs.includeAnywhere && matchPrefs.state) {
              if (!cardIsLocalToState(c, matchPrefs.state) && !isLocationAgnostic(c)) {
                return false;
              }
            }
            return true;
          })
        : [];
      let rankable = isAdminUser ? filtered.filter((c) => c.adminApproved !== false) : filtered;

      // Hard time caps for the "I have very little time" buckets. The user
      // picking either of these is explicitly saying "show me only the
      // quickies" — anything longer doesn't belong in the result set.
      //   • "Quick wins — Under 5 min" → keep only 5min cards
      //   • "A few minutes — 5–10 min" → keep 5min + 10min cards
      // Longer buckets (30min and up) stay ranking-only — picking those is
      // a "weighted preference," not an explicit cap.
      if (matchPrefs.time === "5min") {
        rankable = rankable.filter((c) => timeBucketFor(c) === "5min");
      } else if (matchPrefs.time === "10min") {
        rankable = rankable.filter((c) => ["5min", "10min"].includes(timeBucketFor(c)));
      }

      const userCtx: UserContext = { boostedIds: boostedCards };
      const ranked = rankCards(rankable, matchPrefs, userCtx);
      // Apply a score floor so only genuine matches surface. Score every card,
      // keep only those hitting ≥ 30% of the top card's score. This prevents
      // the "396 matches" problem where low-preference-overlap cards still pass
      // because the engagement floor alone keeps them above zero.
      if (ranked.length > 0 || pendingForAdmin.length > 0) {
        const matched = ranked.length > 0
          ? (() => {
              const topScore = scoreCard(ranked[0], matchPrefs, userCtx);
              const threshold = topScore * 0.30;
              const thresholded = ranked.filter((c) => scoreCard(c, matchPrefs, userCtx) >= threshold);
              // The Quick Match carousel shows up to 12 cards with no score
              // floor; the main feed must never return fewer results than the
              // modal did. If the 30% threshold is too aggressive (steep score
              // distribution with heavy tone-mismatch penalties), fall back to
              // the top 20 by rank so the feed always feels populated.
              return thresholded.length >= 20 ? thresholded : ranked.slice(0, Math.max(thresholded.length, 20));
            })()
          : [];
        const combined = [...matched, ...pendingForAdmin];
        // Honor explicit sort selection within the match-filtered set.
        if (sortBy === "az") {
          return pinFirst(completedLast([...combined].sort((a, b) => a.title.localeCompare(b.title))));
        }
        if (sortBy === "newest") {
          return pinFirst(completedLast([...combined].sort((a, b) => (b.id ?? 0) - (a.id ?? 0))));
        }
        return pinFirst(completedLast(combined));
      }
      // No matches AND no pending — still show the pinned Spread the Word
      // card so it's never the case that an empty match-result hides it.
      return withPinned([]);
    }

    if (sortBy === "az") {
      return pinFirst(completedLast([...filtered].sort((a, b) => a.title.localeCompare(b.title))));
    }
    if (sortBy === "newest") {
      return pinFirst(completedLast([...filtered].sort((a, b) => (b.id ?? 0) - (a.id ?? 0))));
    }

    // ── Popular: engagement sort with an upcoming-event lift ──────────────────
    // `effectiveScore` = engagement (boosts + completions) + upcomingEventBoost.
    // The event boost gives time-sensitive cards a meaningful chance to surface
    // even with low engagement — a protest tomorrow needs to be visible NOW,
    // not after it accumulates a month of clicks. For anonymous users with no
    // known location, `effectiveScore` additionally penalises hyper-local
    // actions so Online/National rise. Round to integer so scores like 12.6
    // and 13 still tier together cleanly.
    // When a state filter is active, use a context-aware bucket so that
    // state-matching cards sort ABOVE online/national/multi-state acts
    // within each score tier (rather than falling below them).
    const activeStateFilters = (activeFilters["Location"] ?? []).filter(l => l !== "Remote");
    const byScore = new Map<number, ActionCardData[]>();
    for (const c of filtered) {
      const s = Math.round(effectiveScore(c));
      if (!byScore.has(s)) byScore.set(s, []);
      byScore.get(s)!.push(c);
    }
    const scores = Array.from(byScore.keys()).sort((a, b) => b - a);
    const out: ActionCardData[] = [];
    for (const s of scores) {
      const tier = byScore.get(s)!;
      const byLoc = new Map<number, ActionCardData[]>();
      for (const c of tier) {
        const lb = locationBucketWithState(c, activeStateFilters);
        if (!byLoc.has(lb)) byLoc.set(lb, []);
        byLoc.get(lb)!.push(c);
      }
      for (const lb of [0, 1, 2, 3, 4]) {
        const grp = byLoc.get(lb);
        if (grp && grp.length > 0) out.push(...interleaveByCategory(grp));
      }
    }
    return pinFirst(completedLast(out));
  // deps: everything applyFilters + ranking reads from component scope.
  // deferredSearchQuery (not searchQuery) means this memo is bypassed
  // entirely during keystrokes — React renders the stale list instantly,
  // then re-runs the memo only after the deferred value settles.
  }, [cards, deferredSearchQuery, activeFilters, quickActionsOnly, showDone,
      completedCards, matchPrefs, isAdminUser, todayISO, boostedCards,
      sortBy, demoteHyperLocal,
      // Impersonation override — recompute when entering / exiting view-as,
      // and when any of the impersonated slots change underneath us.
      isImpersonating, effectiveMatchPrefs, effectiveCompleted, effectiveBoosted, approval]); // eslint-disable-line react-hooks/exhaustive-deps

  // True when any filter chip is selected OR a search is active — bypasses
  // server pagination so client-side filtering sees the full dataset.
  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    quickActionsOnly ||
    matchPrefs !== null ||
    Object.values(activeFilters).some((arr) => (arr ?? []).length > 0);

  // Distinct categories from currently-loaded cards, sorted alphabetically.
  // Approved, non-expired cards — used to drive filter pills so only
  // categories/locations that actually have visible cards appear.
  const approvedCards = useMemo(() =>
    cards.filter((c) => {
      if (c.adminApproved === false) return false;
      if (c.eventDate && c.eventDate < todayISO) return false;
      return true;
    }),
  [cards, todayISO]);

  // Drives the Category pills in the navbar — built from approved cards only
  // so no empty-result pills appear.
  const dynamicCategories = useMemo(() => {
    // Pass every category through normaliseCategory again before deduping.
    // resolveCard already does this when cards enter state, but writing the
    // dedupe at the chip-render layer is cheap insurance against any code
    // path that creates an ActionCardData without going through resolveCard
    // (or against stale module / HMR glitches that leave a raw "BOOST"
    // alongside a normalized "Boost"). Without this, the navbar's category
    // pill row would render both "BOOST" and "Boost" as separate chips.
    const set = new Set<string>();
    for (const c of approvedCards) {
      const cat = normaliseCategory(c.category);
      if (cat) set.add(cat);
    }
    return Array.from(set).sort();
  }, [approvedCards]);

  // Distinct locations from currently-loaded cards, ordered to match the
  // canonical `LOCATION_OPTIONS` list used by Add-an-Action and Edit. "Online"
  // is always included (it filters cards by `isOnline`, which is independent
  // of the literal location string).
  const dynamicLocations = useMemo(() => {
    // "Remote" is intentionally NOT in this list anymore — it has its own
    // top-level pill ("Remote") in the filter row, separate from the state
    // dropdown. Users pick states here; they pick Remote separately.
    const set = new Set<string>();
    for (const c of approvedCards) {
      const loc = locationToState(c.location);
      if (loc) set.add(loc);
    }
    return LOCATION_OPTIONS.filter((opt) => opt !== "Remote" && set.has(opt));
  }, [approvedCards]);

  // ── Scroll nudge — fires once after user scrolls past ~8 cards ──────────────
  useEffect(() => {
    if (scrollNudgeDismissed || matchPrefs !== null || activeTab !== "acts") return;
    const onScroll = () => {
      if (scrollNudgeFired.current) return;
      if (window.scrollY > 1600) {
        scrollNudgeFired.current = true;
        setScrollNudgeVisible(true);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [scrollNudgeDismissed, matchPrefs, activeTab]);

  // Hide nudge if user sets match prefs
  useEffect(() => {
    if (matchPrefs !== null) setScrollNudgeVisible(false);
  }, [matchPrefs]);

  // Auto-dismiss the nudge toast after 30 seconds so it doesn't stick around
  // forever. It's a soft suggestion — if the user hasn't engaged in 30s,
  // it's clutter.
  useEffect(() => {
    if (!scrollNudgeVisible) return;
    const t = setTimeout(() => setScrollNudgeVisible(false), 30_000);
    return () => clearTimeout(t);
  }, [scrollNudgeVisible]);

  // ── On mount: restore session + listen for OAuth redirects ──
  useEffect(() => {
    // Check for an existing session (including OAuth redirects)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) {
        setAccessToken(session.access_token);
        fetchApprovalStatus(session.access_token, session.user);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        setAccessToken(session.access_token);
        fetchApprovalStatus(session.access_token, session.user);
        fetchMyCompletions(session.access_token);
        fetchMyBoosts(session.access_token);
        fetchMyBookmarks(session.access_token);
        syncMatchPreferencesOnLogin(session.access_token);
      } else {
        setAccessToken(null);
        setApproval(null);
        setMyCompletions(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── Sync match-me prefs on sign-in ──
  // Server wins if it has prefs (so prefs follow the account across devices).
  // Otherwise, push the anonymous-session local prefs up so they get stored on
  // the new account. Best-effort — failures don't block anything.
  //
  // NOTE: previously this function also auto-applied the saved prefs to the
  // live feed via setMatchPrefs(remote|local). That behavior was removed —
  // users now see the full unfiltered grid on load and have to explicitly
  // open the Refine Your Matches wizard and click "These Matches Look Good!"
  // to apply. Preferences still sync silently (localStorage ↔ user record)
  // so when they DO open the wizard, their sliders / picks are already
  // populated from where they left off.
  async function syncMatchPreferencesOnLogin(token: string) {
    try {
      const remote = await fetchUserPreferences(token);
      if (remote) {
        savePreferences(remote);
        // Cross-device restore for the Navbar Location pill. Whichever
        // surface the user picked their location on — pill, or Match Me
        // wizard via the state→locationFilter mirror below — the saved
        // values flow back into activeFilters.Location so the new device
        // wakes up with the same location filter applied. Other pills
        // (Category, etc.) still live in localStorage only.
        if (Array.isArray(remote.locationFilter) && remote.locationFilter.length > 0) {
          setActiveFilters((prev) => ({ ...prev, Location: remote.locationFilter }));
        }
      } else {
        const local = loadPreferences();
        if (local) {
          // On first server-side miss (new account / new device with
          // nothing pushed yet), seed locationFilter from the local pill
          // state if the user happens to already have a Location picked.
          // Otherwise the server record would land with `locationFilter:
          // []` and future devices would have nothing to restore.
          const localLoc = activeFiltersRef.current?.Location ?? [];
          const seeded = localLoc.length > 0 && local.locationFilter.length === 0
            ? { ...local, locationFilter: localLoc }
            : local;
          await pushUserPreferences(token, seeded);
        }
      }
    } catch (err) {
      console.warn("Match prefs sync failed:", err);
    }
  }

  // ── Fetch the signed-in user's completion scoreboard ──
  async function fetchMyCompletions(token: string) {
    try {
      const res = await fetch(`${API}/me/completions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setMyCompletions(data);
      // Merge server-known completions into the optimistic local set so the
      // pill shows "Did it!" on cards even right after sign-in across devices.
      if (Array.isArray(data.completedIds)) {
        setCompletedCards((prev) => {
          const next = new Set(prev);
          for (const id of data.completedIds) next.add(id);
          try { localStorage.setItem("resistact_completed", JSON.stringify([...next])); } catch {}
          return next;
        });
      }
    } catch (err) {
      console.error("Could not fetch completions:", err);
    }
  }

  async function fetchMyBoosts(token: string) {
    try {
      const res = await fetch(`${API}/me/boosts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.boostedIds)) {
        setActedCards((prev) => {
          const next = new Set(prev);
          for (const id of data.boostedIds) next.add(id);
          try { localStorage.setItem("resistact_boosted", JSON.stringify([...next])); } catch {}
          return next;
        });
      }
    } catch (err) {
      console.error("Could not fetch boosts:", err);
    }
  }

  async function fetchApprovalStatus(token: string, user?: any) {
    try {
      const res = await fetch(`${API}/auth/status`, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        setApproval(data.approval);
        if (typeof data.streak === "number") setLoginStreak(data.streak);
        return;
      }
      console.error("Approval status fetch failed:", res.status, await res.text());
    } catch (err) {
      console.error("Could not fetch approval status:", err);
    }
    // Fallback: build a minimal approval record from the Supabase session so
    // the navbar always reflects the signed-in user even if the server is slow.
    if (user) {
      setApproval({
        userId: user.id,
        email: user.email ?? "",
        name:
          user.user_metadata?.full_name ??
          user.user_metadata?.name ??
          user.email?.split("@")[0] ??
          "Resistor",
        avatar: user.user_metadata?.avatar_url ?? null,
        status: "pending",
        isAdmin: false,
        provider: user.app_metadata?.provider ?? "email",
        createdAt: new Date().toISOString(),
      });
    }
  }

  function handleLogout() {
    // Clear local React state synchronously so the UI reflects sign-out
    // immediately — don't wait on a network round-trip that Safari ITP can
    // stall or drop. scope: 'local' tells Supabase to wipe the session from
    // localStorage and fire SIGNED_OUT locally without calling the auth
    // server to revoke; that revoke is what was failing intermittently on
    // Safari and leaving the UI stuck in a "signed in" state.
    if (isImpersonating) setImpersonating(null);
    setApproval(null);
    setAccessToken(null);
    supabase.auth.signOut({ scope: "local" }).catch((err) => {
      console.warn("signOut(local) failed:", err);
    });
  }

  // ── Boot analytics on mount. No-op when VITE_GA_MEASUREMENT_ID is unset
  //    or the browser has Do-Not-Track on. Idempotent — safe to call again. ──
  useEffect(() => { initAnalytics(); }, []);

  // ── Persist pill-filter selections to localStorage on every change.
  //    Same-device persistence so a user's category / location / Remote /
  //    quick-actions / show-done / sort pick survives page reloads. ──
  useEffect(() => {
    writePillFilters({ activeFilters, quickActionsOnly, showDone, sortBy });
  }, [activeFilters, quickActionsOnly, showDone, sortBy]);

  // ── Cross-device sync for the Location pill (signed-in users only) ──
  //    The Match Me preferences blob is the only thing we sync to the
  //    user account today; piggybacking the Location pill onto it lets a
  //    signed-in user keep their location filter across devices without
  //    standing up a new endpoint. Debounced lightly so rapid pill
  //    toggling doesn't fire a request per click — we wait for the user
  //    to settle before pushing. The local pill state stays the source
  //    of truth on the active session; this is just a follow-up sync. ──
  useEffect(() => {
    if (!accessToken) return;
    const loc = activeFilters["Location"] ?? [];
    const handle = window.setTimeout(() => {
      const current = loadPreferences() ?? DEFAULT_PREFERENCES;
      const next: Preferences = { ...current, locationFilter: loc };
      savePreferences(next);
      pushUserPreferences(accessToken, next);
    }, 600);
    return () => window.clearTimeout(handle);
  }, [activeFilters, accessToken]);

  // ── Sync cards from Supabase ──
  const PAGE_SIZE = 20;

  useEffect(() => {
    async function syncCards() {
      try {
        // Single drain — server's /actions cap is now 2000 (was 100), big
        // enough to return the whole catalog in one response. Previously we
        // paged 100-at-a-time and spawned 5+ parallel fetches, each subject
        // to edge-function cold-start latency. That made the "Matched for
        // you" banner read low ("Showing 3 actions") until all batches
        // settled, which felt like a broken matcher. One round-trip ≈ one
        // cold-start instead of six.
        const res = await fetch(`${API}/actions?limit=2000&offset=0`, { headers: HEADERS });
        if (!res.ok) {
          const text = await res.text();
          console.error(`Failed to sync cards from server (${res.status}): ${text}`);
          setCards(STATIC_CARDS);
          setLoading(false);
          return;
        }
        const data = await res.json();
        const batch = (data.cards as ServerCard[] | undefined) ?? [];
        if (batch.length === 0) {
          setCards(STATIC_CARDS);
          setLoading(false);
          return;
        }
        const total = data.total ?? batch.length;
        const all: ActionCardData[] = batch.map(resolveCard);
        setCards(all);
        setServerTotal(total);
        setServerOffset(all.length);
        setSynced(true);
        setLoading(false);
        // Cache the raw response so the next visit hydrates instantly.
        writeCardsCache(batch, total);

        // Safety net: if the server returned fewer cards than `total` (e.g.
        // the cap was hit because we let the catalog grow past 2000), fall
        // back to the old paginated drain for the remainder. We expect this
        // branch to be cold for years given current growth, but it keeps the
        // UI honest if/when we cross the threshold.
        if (all.length < total) {
          const remainingOffsets: number[] = [];
          for (let o = all.length; o < total; o += 2000) remainingOffsets.push(o);
          const results = await Promise.all(
            remainingOffsets.map(async (o) => {
              const r = await fetch(`${API}/actions?limit=2000&offset=${o}`, { headers: HEADERS });
              if (!r.ok) return { offset: o, cards: [] as ServerCard[] };
              const d = await r.json();
              return { offset: o, cards: (d.cards as ServerCard[] | undefined) ?? [] };
            }),
          );
          const ordered = results
            .sort((a, b) => a.offset - b.offset)
            .flatMap((r) => r.cards);
          if (ordered.length > 0) {
            const resolved = ordered.map(resolveCard);
            setCards((prev) => {
              const seen = new Set(prev.map((c) => c.id));
              return [...prev, ...resolved.filter((c) => !seen.has(c.id))];
            });
            setServerOffset(all.length + ordered.length);
          }
        }
      } catch (err) {
        console.error("Network error syncing cards:", err);
        setCards(STATIC_CARDS);
        setLoading(false);
      }
    }
    syncCards();
  }, []);

  // ── Load Receipts ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/receipts`, { headers: HEADERS });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) {
          setReceipts(data.receipts ?? []);
          setHiddenSmackIds(data.hiddenIds ?? []);
        }
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Pull admin-tuned matcher config on mount so scoring uses the latest
  //    CATEGORY_TONE values without needing a redeploy. Falls through to the
  //    built-in defaults silently if the request fails. ─────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/matcher-config`, { headers: HEADERS });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data?.config && !cancelled) applyMatcherConfig(data.config);
      } catch {
        // Silent fallback — defaults already in place.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Fetch live stats (cities + users) ──
  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch(`${API}/stats`, { headers: HEADERS });
        if (!res.ok) { console.error("Stats fetch failed:", await res.text()); return; }
        const data = await res.json();
        if (typeof data.citiesCount === "number") setStatsCitiesCount(data.citiesCount);
        if (typeof data.usersCount === "number") setStatsUsersCount(data.usersCount);
        if (typeof data.pendingUsersCount === "number") setPendingUsersCount(data.pendingUsersCount);
        if (typeof data.pendingActsCount === "number") setServerPendingActsCount(data.pendingActsCount);
        if (typeof data.flagsCount === "number") setFlagsCount(data.flagsCount);
        if (typeof data.siteUpdating === "boolean") setSiteUpdating(data.siteUpdating);
      } catch (err) {
        console.error("Network error fetching stats:", err);
      }
    }
    fetchStats();
  }, []);

  // ── Eagerly fetch the rest of the cards once the initial paint is in.
  //    Previously gated on `hasActiveFilters` — i.e. only fetched the long
  //    tail when the user activated a filter. That created a race: if the
  //    user typed in the search box before the full dataset arrived, the
  //    search ran against the first 20 cards and the user thought a card
  //    was missing (real bug report: searching "refer" returned 4 cards
  //    instead of 5 because Refer-an-artist-at-risk lived at id=1180,
  //    past the initial batch). Now the prefetch fires as soon as we have
  //    serverTotal — regardless of filter state — so the in-memory cards
  //    array always catches up to the full server set within a few seconds
  //    of page load. The Load More UI is still driven by display-limit
  //    pagination, so initial paint stays fast (we render the first 20
  //    cards immediately and stream the rest into state in the background).
  useEffect(() => {
    if (!synced || loadingMore) return;
    if (cards.length >= serverTotal) return;

    let cancelled = false;
    (async () => {
      setLoadingMore(true);
      try {
        let offset = serverOffset;
        const collected: ActionCardData[] = [];
        // Server cap is 2000 per request (raised from 100), so we almost
        // always finish in a single iteration. The loop stays for the
        // unlikely future where we cross 2000 cards.
        while (offset < serverTotal && !cancelled) {
          const res = await fetch(`${API}/actions?limit=2000&offset=${offset}`, { headers: HEADERS });
          if (!res.ok) break;
          const data = await res.json();
          const batch = (data.cards as ServerCard[] | undefined) ?? [];
          if (batch.length === 0) break;
          collected.push(...batch.map(resolveCard));
          offset += batch.length;
        }
        if (!cancelled && collected.length > 0) {
          setCards((prev) => {
            const seen = new Set(prev.map((c) => c.id));
            return [...prev, ...collected.filter((c) => !seen.has(c.id))];
          });
          setServerOffset(offset);
        }
      } finally {
        if (!cancelled) setLoadingMore(false);
      }
    })();

    return () => { cancelled = true; };
  }, [synced, serverTotal]);

  // Reset display limit whenever filters/search change so the view refreshes
  // from the top rather than showing a truncated filtered list.
  useEffect(() => {
    setDisplayLimit(getDisplayPage());
  }, [hasActiveFilters, searchQuery, activeFilters, quickActionsOnly]);

  // ── Infinite scroll (desktop only) ──
  // A sentinel <div> at the bottom of the card grid; when it enters the
  // viewport on a non-mobile screen we load the next batch automatically.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hasActiveFilters) return;
    function onScroll() {
      if (loadingMore) return;
      const distFromBottom =
        document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      if (distFromBottom > 1200) return;
      if (displayLimit < displayedCards.length) {
        setDisplayLimit((prev) => prev + getDisplayPage());
      } else if (serverOffset < serverTotal) {
        handleLoadMore();
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    // Fire once immediately in case the page is already short enough to show everything
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [displayLimit, displayedCards.length, hasActiveFilters, loadingMore, serverOffset, serverTotal]);

  // ── Deep link: ?act=<cardId> ──
  // Switch to The Acts tab and scroll the target card into view.
  useEffect(() => {
    if (deepLinkId === null) return;
    setActiveTab("acts");
    // Make sure the card is within the visible slice (increase limit if needed).
    const idx = displayedCards.findIndex((c) => c.id === deepLinkId);
    if (idx !== -1 && idx >= displayLimit) {
      setDisplayLimit(idx + 1);
    }
    // Give React one frame to render the card, then scroll to it.
    const frame = requestAnimationFrame(() => {
      const el = document.getElementById(`card-${deepLinkId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-[#ed6624]", "ring-offset-2");
        setTimeout(() => el.classList.remove("ring-2", "ring-[#ed6624]", "ring-offset-2"), 2500);
        setDeepLinkId(null);
        // Clean the param from the URL bar without triggering a reload.
        const url = new URL(window.location.href);
        url.searchParams.delete("act");
        window.history.replaceState({}, "", url.toString());
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [deepLinkId, displayedCards, displayLimit]);

  useEffect(() => {
    if (pendingActsVersion > 0) setShowPendingActsOnly(true);
  }, [pendingActsVersion]);

  // ── Load more ──
  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await fetch(`${API}/actions?limit=${PAGE_SIZE}&offset=${serverOffset}`, { headers: HEADERS });
      if (!res.ok) { console.error("Load more failed:", await res.text()); return; }
      const data = await res.json();
      if (data.cards?.length > 0) {
        const incoming = (data.cards as ServerCard[]).map(resolveCard);
        setCards((prev) => {
          const seen = new Set(prev.map((c) => c.id));
          return [...prev, ...incoming.filter((c) => !seen.has(c.id))];
        });
        setServerTotal(data.total ?? serverTotal);
        setServerOffset((prev) => prev + data.cards.length);
      }
    } catch (err) {
      console.error("Network error loading more:", err);
    } finally {
      setLoadingMore(false);
    }
  };

  // ── Self-reported "I did this" toggle ──
  const handleComplete = async (id: number) => {
    if (blockWriteIfImpersonating()) return;
    const alreadyCompleted = completedCards.has(id);
    const delta = alreadyCompleted ? -1 : 1;

    // Snapshot the user's pre-toggle action total so the celebration modal
    // can show the before → after climb. We prefer the server-known total
    // when signed in; otherwise fall back to the local optimistic set.
    const prevTotal =
      myCompletions?.total ?? completedCards.size;

    setCompletedCards((prev) => {
      const next = new Set(prev);
      alreadyCompleted ? next.delete(id) : next.add(id);
      try { localStorage.setItem("resistact_completed", JSON.stringify([...next])); } catch {}
      return next;
    });
    setCards((prev) =>
      prev.map((c) => c.id === id
        ? { ...c, completions: Math.max(0, (c.completions ?? 0) + delta) }
        : c)
    );

    // Fireworks for a fresh completion — never on un-do. Use the optimistic
    // bump (prevTotal + 1) so the modal pops immediately; the server-side
    // count syncs back in the background and overrides if it disagrees.
    if (delta === 1) {
      setCelebration({ prev: prevTotal, next: prevTotal + 1 });
      // Analytics: fire only on a fresh completion. Pulls the card from the
      // current state map so we know the category at click-time.
      const card = cards.find((c) => c.id === id);
      analytics.actionCompleted(id, card?.category);
    }

    try {
      // Use the user's access token when signed in so the server can record
      // the completion against their account; falls back to the anon key.
      const authHeader = accessToken
        ? `Bearer ${accessToken}`
        : `Bearer ${publicAnonKey}`;
      const res = await fetch(`${API}/actions/${id}/complete`, {
        method: "POST",
        headers: { ...HEADERS, Authorization: authHeader },
        body: JSON.stringify({ delta }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error(`Completion update failed for card ${id}: ${text}`);
      } else {
        const { card: updated } = await res.json();
        setCards((prev) =>
          prev.map((c) => (c.id === id ? resolveCard(updated) : c))
        );
        if (accessToken) fetchMyCompletions(accessToken);
      }
    } catch (err) {
      console.error("Network error updating completion:", err);
    }
  };

  // ── Act ──
  const handleBoost = async (id: number) => {
    if (blockWriteIfImpersonating()) return;
    const alreadyActed = boostedCards.has(id);
    const delta = alreadyActed ? -1 : 1;

    setActedCards((prev) => {
      const next = new Set(prev);
      alreadyActed ? next.delete(id) : next.add(id);
      try { localStorage.setItem("resistact_boosted", JSON.stringify([...next])); } catch {}
      return next;
    });
    setCards((prev) =>
      prev.map((c) => c.id === id ? { ...c, boosts: Math.max(0, c.boosts + delta) } : c)
    );

    try {
      const res = await fetch(`${API}/actions/${id}/act`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ delta }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error(`Act update failed for card ${id}: ${text}`);
      } else {
        const { card: updated } = await res.json();
        setCards((prev) =>
          prev.map((c) => (c.id === id ? resolveCard(updated) : c))
        );
      }
    } catch (err) {
      console.error("Network error updating act:", err);
    }
  };

  const handleShare = (id: number) => {
    const card = cards.find((c) => c.id === id);
    if (card && navigator.share) {
      navigator.share({ title: card.title, text: card.description }).catch(() => {});
    }
  };

  const handleBookmark = (id: number) => {
    if (blockWriteIfImpersonating()) return;
    setBookmarkedCards((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      try { localStorage.setItem("resistact_bookmarks", JSON.stringify([...next])); } catch {}
      if (accessToken) {
        fetch(`${API}/me/bookmarks`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ ids: [...next] }),
        }).catch(() => {});
      }
      return next;
    });
  };

  async function fetchMyBookmarks(token: string) {
    try {
      const res = await fetch(`${API}/me/bookmarks`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data.bookmarks)) return;
      setBookmarkedCards((prev) => {
        const merged = new Set([...prev, ...data.bookmarks]);
        try { localStorage.setItem("resistact_bookmarks", JSON.stringify([...merged])); } catch {}
        // Push merged set back only if it grew (anon bookmarks that server didn't have)
        if (merged.size !== data.bookmarks.length) {
          fetch(`${API}/me/bookmarks`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ ids: [...merged] }),
          }).catch(() => {});
        }
        return merged;
      });
    } catch (err) {
      console.warn("Could not fetch bookmarks:", err);
    }
  }

  // Handler when a new user-created card arrives from AskFlowModal
  function handleNewCard(raw: any) {
    const newCard = resolveCard(raw);
    setCards((prev) => prev.some((c) => c.id === newCard.id) ? prev : [...prev, newCard]);
    setServerTotal((prev) => prev + 1);
    setServerOffset((prev) => prev + 1);
    showToast("Action posted");
  }

  // ── Determine if logged-in user can edit a given card ──
  function canEditCard(card: ActionCardData): boolean {
    if (!approval || approval.status !== "approved") return false;
    if (approval.isAdmin) return true;
    if (card.createdBy && card.createdBy === approval.userId) return true;
    return false;
  }

  // ── One-click approve from the main feed (admin only) ────────────────────────
  async function handleApproveCard(id: number) {
    if (blockWriteIfImpersonating()) return;
    if (!accessToken) return;
    try {
      const res = await fetch(`${API}/admin/approve-action/${id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(`Approval failed: ${(err as any).error ?? res.status}`);
        return;
      }
      const data = await res.json();
      setCards((prev) => prev.map((c) => c.id === id ? { ...c, adminApproved: true, ...data.card } : c));
    } catch (err) {
      console.error("Approve card error:", err);
      showToast("Approval failed — check console");
    }
  }

  // ── Toggle site-updating banner (admin only) ─────────────────────────────────
  async function handleToggleSiteUpdating(enabled: boolean) {
    if (!accessToken) return;
    try {
      await fetch(`${API}/admin/site-updating`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      setSiteUpdating(enabled);
    } catch (err) {
      console.error("Toggle site-updating failed:", err);
    }
  }

  // ── Approve all pending acts at once (admin only) ────────────────────────────
  // Pass an explicit list of IDs to approve only the currently-visible filtered set.
  async function handleApproveAll(ids: number[]) {
    if (!accessToken) return;
    for (const id of ids) {
      await handleApproveCard(id);
    }
  }

  // ── Handle card update from EditCardModal ──
  function handleCardSaved(updated: ActionCardData) {
    setCards((prev) =>
      prev.map((c) => c.id === updated.id ? { ...c, ...updated } : c)
    );
    showToast("Changes saved");
  }

  // ── Remove a deleted card from the local feed (admin only) ──
  function handleCardDeleted(id: number) {
    setCards((prev) => prev.filter((c) => c.id !== id));
    setServerTotal((t) => Math.max(0, t - 1));
  }

  // Called by the AdminPanel after it approves/deletes a card in its pending
  // list, so the live feed reflects the change immediately instead of going
  // stale until the next full sync. Approve → flip adminApproved (so the
  // PENDING badge drops); delete → remove from the feed entirely.
  function handleAdminCardChanged(id: number, change: "approved" | "deleted") {
    if (change === "approved") {
      setCards((prev) => prev.map((c) => c.id === id ? { ...c, adminApproved: true } : c));
      setServerPendingActsCount((n) => Math.max(0, n - 1));
    } else {
      handleCardDeleted(id);
      setServerPendingActsCount((n) => Math.max(0, n - 1));
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 font-['Poppins',sans-serif]">
      {/* Gamification keyframes injected once. Centralised in lib/animations.ts
          so individual components only need to add a class name to opt in. */}
      <style>{GAMIFICATION_KEYFRAMES}</style>

      {/* Impersonation banner — persistent strip at the very top of the
          page while admin is view-as'ing another user. Hard-to-miss colours;
          single Exit button. Kept outside any container so it sticks above
          everything including the navbar. */}
      {isImpersonating && impersonating && (
        <div
          className="sticky top-0 z-[200] bg-[#23297e] text-white shadow-lg border-b-2 border-[#ed6624]"
          role="status"
          aria-live="polite"
        >
          <div className="max-w-[1200px] mx-auto px-4 py-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Eye size={15} className="shrink-0 text-[#ed6624]" />
              <p className="font-['Poppins',sans-serif] text-sm truncate">
                Viewing as{" "}
                <strong className="font-bold">{impersonating.approval.name || impersonating.approval.email || "user"}</strong>
                <span className="hidden sm:inline text-white/70 font-normal"> — read-only. Boosts, completions, edits, and saves are disabled.</span>
              </p>
            </div>
            <button
              onClick={exitImpersonation}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-[#23297e] hover:bg-[#ed6624] hover:text-white rounded-full font-['Poppins',sans-serif] font-bold text-xs transition-colors"
            >
              <X size={13} strokeWidth={3} />
              Exit
            </button>
          </div>
        </div>
      )}

      <Navbar
        approval={effectiveApproval}
        myCompletions={effectiveMyCompletions ?? localCompletions}
        onLoginClick={() => setAuthModalOpen(true)}
        onLogout={handleLogout}
        onAdminClick={() => setAdminPanelOpen(true)}
        onPendingActsClick={() => { handleTabChange("acts"); setPendingActsVersion((v) => v + 1); }}
        onPendingSmacksClick={() => { handleTabChange("receipts"); setSmacksPendingVersion((v) => v + 1); }}
        onFlaggedActsClick={() => setFlagsAdminOpen(true)}
        pendingActsCount={isImpersonating ? 0 : pendingActsCount}
        pendingSmacksCount={isImpersonating ? 0 : pendingSmacksCount}
        pendingUsersCount={isImpersonating ? 0 : pendingUsersCount}
        flagsCount={isAdminUser && !isImpersonating ? flagsCount : 0}
        onInfoClick={() => setInfoOpen(true)}
        onActClick={() => setActOpen(true)}
        onBookmarksClick={() => setBookmarksOpen(true)}
        bookmarkCount={effectiveBookmarked.size}
        onFeedbackClick={() => setFeedbackOpen(true)}
        onMatchClick={() => setMatchOpen(true)}
        onTierClick={() => setTierModalOpen(true)}
        siteUpdating={siteUpdating}
        onToggleSiteUpdating={handleToggleSiteUpdating}
        matchActive={matchPrefs !== null}
        onMatchClear={() => { setMatchPrefs(null); clearPreferences(); }}
        statsActsCount={displayedCards.length}
        statsSmacksCount={receipts.length + STATIC_SMACKS.length}
        statsResistorsCount={statsUsersCount}
        statsCitiesCount={statsCitiesCount}
        statsSynced={synced}
        activeFilters={activeFilters}
        actsCategories={dynamicCategories}
        actsLocations={dynamicLocations}
        onFilterChange={handleFilterChange}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        isSearchPending={searchQuery !== deferredSearchQuery}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        quickActionsOnly={quickActionsOnly}
        onQuickActionsChange={setQuickActionsOnly}
        showDone={showDone}
        onShowDoneChange={setShowDone}
        completedCount={completedCards.size}
        sortBy={sortBy}
        onSortChange={setSortBy}
        smacksAvailableTags={smacksAvailableTags}
        smacksActiveTags={smacksActiveTags}
        onSmacksTagToggle={(t) => setSmacksActiveTags((prev) =>
          prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
        )}
        onSmacksTagsClear={() => setSmacksActiveTags([])}
        smacksSortBy={smacksSortBy}
        onSmacksSortChange={setSmacksSortBy}
        smacksIsAdmin={isAdminUser && !isImpersonating}
        heroSlot={
          effectiveApproval
            ? activeTab === "acts"
              ? (
                  <LoggedInHero
                    userId={effectiveApproval.userId}
                    name={effectiveApproval.name || "Resistor"}
                    streak={effectiveLoginStreak}
                    onMatchClick={() => isImpersonating ? showToast("View-as is read-only") : setMatchOpen(true)}
                    onAskClick={() => isImpersonating ? showToast("View-as is read-only") : setAskOpen(true)}
                    onHowClick={() => setInfoOpen(true)}
                    hasMatchPrefs={effectiveMatchPrefs !== null}
                  />
                )
              : null
            : <HomeHero
                onMatchClick={() => setMatchOpen(true)}
                onAskClick={() => setAskOpen(true)}
                onHowClick={() => setInfoOpen(true)}
              />
        }
      />

      {/* Site-updating banner */}
      {siteUpdating && (
        <div className="w-full bg-[#23297e] text-white text-center px-4 py-3 font-['Poppins',sans-serif] font-bold text-sm flex items-center justify-center gap-2">
          <Wrench size={16} strokeWidth={2.25} className="text-white" />
          <span>SITE UPDATING — Please be patient if you see any oddities!</span>
          <Wrench size={16} strokeWidth={2.25} className="text-white" />
        </div>
      )}

      <main className="px-4 md:px-8 pt-3 pb-20">
        <ErrorBoundary>
        {activeTab === "receipts" ? (
          /* ── Receipts view ── */
          <SmacksPage
            receipts={receipts}
            hiddenIds={hiddenSmackIds}
            searchQuery={deferredSearchQuery}
            accessToken={accessToken}
            approval={approval}
            onReceiptAdded={(r) => setReceipts((prev) => [...prev, r])}
            onReceiptDeleted={(id) => {
              setReceipts((prev) => prev.filter((r) => r.id !== id));
              setHiddenSmackIds((prev) => prev.includes(id) ? prev : [...prev, id]);
            }}
            onReceiptApproved={(id) =>
              setReceipts((prev) =>
                prev.map((r) => (r.id === id ? { ...r, adminApproved: true } : r))
              )
            }
            onReceiptUpdated={(updated) => {
              setReceipts((prev) =>
                prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r))
              );
              showToast("Smack updated");
            }}
            pendingFilterVersion={smacksPendingVersion}
            onComplete={handleComplete}
            completedSmackIds={completedCards}
            activeTags={smacksActiveTags}
            onActiveTagsChange={setSmacksActiveTags}
            sortBy={smacksSortBy}
            onSortByChange={setSmacksSortBy}
          />
        ) : activeTab === "facts" ? (
          /* ── Facts view ── */
          (() => {
            const q = deferredSearchQuery.toLowerCase().trim();
            const catFilters = activeFilters["Category"] ?? [];
            const filteredFacts = FACT_CARDS.filter((fc) => {
              // Search overrides category filters
              if (q) {
                return fc.claim.toLowerCase().includes(q) || fc.response.toLowerCase().includes(q) || fc.category.toLowerCase().includes(q) || fc.askBack.toLowerCase().includes(q) || fc.proof.toLowerCase().includes(q);
              }
              if (catFilters.length > 0 && !catFilters.includes(fc.category)) return false;
              return true;
            }).sort((a, b) => {
              const boostDiff = (factBoostCounts[b.id] ?? 0) - (factBoostCounts[a.id] ?? 0);
              if (boostDiff !== 0) return boostDiff;
              return (factOrder[a.id] ?? 0) - (factOrder[b.id] ?? 0);
            });
            return (
              <>
                {/* ── Facts hero panel ── */}
                <div className="mb-5 rounded-2xl border border-[#23297e]/15 bg-gradient-to-br from-[#23297e]/5 via-white to-[#ed6624]/5 px-4 py-3.5 sm:px-5 sm:py-4">
                  <p className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-sm sm:text-base mb-1.5 flex items-center gap-1.5">
                    <span aria-hidden="true">🧠</span> What's a Fact?
                  </p>
                  <p className="font-['Poppins',sans-serif] text-xs sm:text-sm text-gray-700 leading-snug">
                    MAGA spreads lies faster than you can look them up. <strong className="text-[#23297e]">The Facts</strong> gives you pre-loaded rebuttals — the claim, the truth, and a question to ask back that puts them on defense. <span className="text-[#ed6624] font-semibold">Read one. Use it. Win the argument.</span>
                  </p>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5">
                  {filteredFacts.map((fc) => (
                    <FactCard
                      key={fc.id}
                      card={fc}
                      onBoost={handleFactBoost}
                      isBoosted={boostedFacts.has(fc.id)}
                      boostCount={factBoostCounts[fc.id] ?? 0}
                    />
                  ))}
                </div>
                {filteredFacts.length === 0 && (
                  <div className="text-center py-20">
                    <p className="font-['Poppins',sans-serif] text-gray-400 text-lg">No facts match your filters.</p>
                    <button
                      onClick={() => { setActiveFilters({}); setSearchQuery(""); }}
                      className="mt-3 font-['Poppins',sans-serif] text-sm text-[#23297e] hover:underline"
                    >
                      Clear all filters
                    </button>
                  </div>
                )}
              </>
            );
          })()
        ) : (
          /* ── Acts view ── */
          (() => {
            const visibleActsCards = (isAdminUser && showPendingActsOnly)
              // Pull from the raw card list so match-scoring / ranking can't hide
              // unapproved cards from the admin review queue.
              ? cards.filter((c) => c.adminApproved === false && !(c.eventDate && c.eventDate < todayISO))
              : displayedCards;
            return (
          <>
            {/* Unfiltered banner — nudges users to try the match tool.
                Also carries the Sort dropdown so the sort control lives
                next to the live result count. */}
            {!matchPrefs && !hasActiveFilters && activeTab === "acts" && synced && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5">
                <p className="font-['Poppins',sans-serif] text-sm text-gray-600">
                  Showing all <strong className="text-[#23297e]">{displayedCards.length}</strong> actions — unfiltered.
                </p>
                <div className="flex items-center gap-4 shrink-0">
                  <SortDropdown
                    sortBy={sortBy}
                    onSortChange={setSortBy}
                    showDone={showDone}
                    onShowDoneChange={setShowDone}
                    completedCount={myCompletions?.total ?? 0}
                  />
                  <button
                    onClick={() => setMatchOpen(true)}
                    className="font-['Poppins',sans-serif] text-xs font-bold text-[#ed6624] hover:text-[#e07a28] hover:underline transition-colors whitespace-nowrap"
                  >
                    ✨ Find my match →
                  </button>
                </div>
              </div>
            )}

            {/* Filtered banner — shown when categories / search / location /
                quick-actions filters are active (but no Match preferences).
                Mirrors the unfiltered banner style; carries the Sort control. */}
            {!matchPrefs && hasActiveFilters && activeTab === "acts" && synced && !showPendingActsOnly && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-[#23297e]/30 bg-[#23297e]/5 px-4 py-2.5">
                <p className="font-['Poppins',sans-serif] text-sm text-gray-700">
                  <strong className="text-[#23297e]">{displayedCards.length}</strong> {displayedCards.length === 1 ? "action" : "actions"} match your filters.
                </p>
                <SortDropdown
                  sortBy={sortBy}
                  onSortChange={setSortBy}
                  showDone={showDone}
                  onShowDoneChange={setShowDone}
                  completedCount={myCompletions?.total ?? 0}
                />
              </div>
            )}

            {/* Pending-only banner */}
            {isAdminUser && showPendingActsOnly && (() => {
              // Mirror the server-side image check in /admin/approve-action/:id:
              // a card needs at least one of topImageUrl, topImageKey to pass.
              // (The server also accepts a `topImage` field, but that's a
              // client-only resolved value derived from the other two.)
              const cardsWithImages = visibleActsCards.filter(
                (c) => Boolean(c.topImageUrl) || Boolean(c.topImageKey) || Boolean(c.cartoonImageUrl)
              );
              const allHaveImages = cardsWithImages.length === visibleActsCards.length;
              return (
                <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-2.5">
                  <p className="font-['Poppins',sans-serif] text-sm text-red-700">
                    ⚠️ <strong>Pending approval only</strong> — showing {visibleActsCards.length} unapproved act{visibleActsCards.length !== 1 ? "s" : ""}.
                  </p>
                  <div className="flex items-center gap-3 shrink-0">
                    {/* "Approve N with images" — surfaces whenever at least one
                        pending card has a recognised image (topImageUrl,
                        topImageKey, or cartoonImageUrl). Lets an admin
                        one-click approve only the image-bearing cards and
                        leave truly imageless cards pending for a manual
                        image upload. When every card has an image the count
                        will match the "Approve all" button — that's fine,
                        both do the same thing and the label makes it clear
                        the batch is clean. */}
                    {cardsWithImages.length > 0 && (
                      <button
                        onClick={() => handleApproveAll(cardsWithImages.map((c) => c.id))}
                        className="font-['Poppins',sans-serif] text-xs font-semibold bg-green-600 hover:bg-green-700 text-white rounded-lg px-3 py-1.5 transition-colors"
                        title={`Approve only the ${cardsWithImages.length} pending acts that have a top image (server rejects approval on imageless cards).`}
                      >
                        ✓ Approve {cardsWithImages.length} with images
                      </button>
                    )}
                    <button
                      onClick={() => handleApproveAll(visibleActsCards.map((c) => c.id))}
                      className="font-['Poppins',sans-serif] text-xs font-semibold bg-green-600 hover:bg-green-700 text-white rounded-lg px-3 py-1.5 transition-colors"
                    >
                      ✓ Approve all {visibleActsCards.length} showing
                    </button>
                    <button
                      onClick={() => setShowPendingActsOnly(false)}
                      className="font-['Poppins',sans-serif] text-xs font-semibold text-red-600 hover:underline"
                    >
                      Show all
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Match-mode banner — visible when match prefs are filtering the feed.
                Surfaces the user's actual settings as chips so they remember WHY
                this set of cards is showing (and the total count, so the volume
                is visible at a glance). */}
            {matchPrefs && (() => {
              // Friendly time labels — match the MatchMe slider vocabulary.
              const timeLabel = (
                matchPrefs.time === "5min"     ? "Under 5 min"
                : matchPrefs.time === "10min"    ? "5–10 min"
                : matchPrefs.time === "30min"    ? "~30 min"
                : matchPrefs.time === "1hr"      ? "~1 hr"
                : matchPrefs.time === "fewHours" ? "Few hrs / week"
                : matchPrefs.time === "fullDay"  ? "~1 day"
                : matchPrefs.time === "ongoing"  ? "Ongoing"
                : null
              );
              // Tone-stop names — must match MatchMeModal TONE_LABELS so the
              // banner chip says exactly what the user picked. Icons render as
              // simple navy line-icons (lucide-react) — replaced the older
              // colourful emoji set so the strip reads as one unified UI
              // element rather than a row of disparate Unicode glyphs.
              const toneStops: Record<"anger" | "comedy" | "subversion" | "hope" | "energy", { Icon: LucideIcon; label: string; stops: string[] }> = {
                anger:      { Icon: Flame,         label: "Confrontational", stops: ["None", "Low", "Bold", "High"] },
                comedy:     { Icon: Smile,         label: "Humor",           stops: ["None", "Light", "Irreverent", "Full mockery"] },
                subversion: { Icon: VenetianMask,  label: "Subversive",      stops: ["None", "Mild", "Edgy", "Radical"] },
                hope:       { Icon: Sun,           label: "Hopeful",         stops: ["None", "Some", "Uplifting", "Full hope"] },
                energy:     { Icon: Zap,           label: "Motivation",      stops: ["Low",  "Mild",  "Engaged", "On fire"] },
              };
              // Show all 5 tone dims always, but visually distinguish dims at
              // the default (1) from ones the user has moved off. Defaults
              // render greyed-out + slimmer so they read as "background", and
              // bumped ones get an orange accent so they pop. This gives the
              // user a complete at-a-glance view of their match config without
              // having to open the Match wizard, while still calling out
              // what's been customised.
              const toneChips = (Object.keys(toneStops) as Array<keyof typeof toneStops>)
                .map((k) => {
                  const raw = matchPrefs.tone[k] ?? 1;
                  const v = Math.max(0, Math.min(3, raw));
                  return {
                    Icon: toneStops[k].Icon,
                    label: toneStops[k].label,
                    value: toneStops[k].stops[v],
                    isDefault: raw === 1,
                  };
                });
              const groupCount = matchPrefs.vulnerableGroups?.length ?? 0;
              return (
                <div className="mb-4 flex flex-col gap-2 rounded-lg border border-[#ed6624] bg-[#ed6624]/5 px-4 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-['Poppins',sans-serif] text-sm text-gray-700">
                      <span className="resistact-anim-twinkle" aria-hidden>✨</span>{" "}
                      <strong className="text-[#23297e]">Matched for you.</strong>{" "}
                      Showing <strong className="text-[#23297e]">{displayedCards.length}</strong> {displayedCards.length === 1 ? "action" : "actions"}.
                      {/* Loading indicator while the rest of the catalog
                          is still streaming in. Without this, the user sees
                          "Matched for you. Showing 3 actions." and thinks
                          the matcher is broken — when in reality the cards
                          array is only at offset 100/587 and more matches
                          are seconds away. */}
                      {serverTotal > 0 && cards.length < serverTotal && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs text-gray-500 italic">
                          <Loader2 size={11} className="animate-spin shrink-0" />
                          loading more… ({cards.length}/{serverTotal})
                        </span>
                      )}
                    </p>
                    {/* Chip strip — wraps on narrow viewports. All icons are
                        simple navy line-icons so the strip reads as one unified
                        UI element rather than a row of disparate emoji. */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] text-gray-600 font-['Poppins',sans-serif]">
                      {timeLabel && (
                        <button onClick={() => { setMatchInitialStep(0); setMatchOpen(true); }} className="inline-flex items-center gap-0.5 rounded-full bg-white/70 border border-gray-200 px-1.5 py-0.5 text-[10px] leading-tight hover:border-[#ed6624] hover:bg-[#ed6624]/5 transition-colors">
                          <Clock size={10} className="text-[#23297e] shrink-0" strokeWidth={2} />
                          {timeLabel}
                        </button>
                      )}
                      {toneChips.map((c) => {
                        const Icon = c.Icon;
                        return (
                          <button
                            key={c.label}
                            onClick={() => { setMatchInitialStep(0); setMatchOpen(true); }}
                            className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] leading-tight border transition-colors ${
                              c.isDefault
                                ? "bg-gray-50 border-gray-100 text-gray-400 hover:border-[#ed6624] hover:bg-[#ed6624]/5"
                                : "bg-[#ed6624]/10 border-[#ed6624]/30 text-[#23297e] font-semibold hover:border-[#ed6624] hover:bg-[#ed6624]/20"
                            }`}
                            title={c.isDefault ? `${c.label} — default (not set)` : `${c.label} bumped to ${c.value}`}
                          >
                            <Icon size={10} className={`shrink-0 ${c.isDefault ? "text-gray-400" : "text-[#23297e]"}`} strokeWidth={2} />
                            {c.label}: {c.value}
                          </button>
                        );
                      })}
                      {matchPrefs.state && (
                        <button onClick={() => { setMatchInitialStep(0); setMatchOpen(true); }} className="inline-flex items-center gap-0.5 rounded-full bg-white/70 border border-gray-200 px-1.5 py-0.5 text-[10px] leading-tight hover:border-[#ed6624] hover:bg-[#ed6624]/5 transition-colors">
                          <MapPin size={10} className="text-[#23297e] shrink-0" strokeWidth={2} />
                          {matchPrefs.state}
                        </button>
                      )}
                      {groupCount > 0 && (
                        <button onClick={() => { setMatchInitialStep(1); setMatchOpen(true); }} className="inline-flex items-center gap-0.5 rounded-full bg-white/70 border border-gray-200 px-1.5 py-0.5 text-[10px] leading-tight hover:border-[#ed6624] hover:bg-[#ed6624]/5 transition-colors">
                          <Users size={10} className="text-[#23297e] shrink-0" strokeWidth={2} />
                          Amplifies {groupCount} {groupCount === 1 ? "group" : "groups"}
                        </button>
                      )}
                      {matchPrefs.focusDonations && (
                        <button onClick={() => { setMatchInitialStep(1); setMatchOpen(true); }} className="inline-flex items-center gap-0.5 rounded-full bg-white/70 border border-gray-200 px-1.5 py-0.5 text-[10px] leading-tight hover:border-[#ed6624] hover:bg-[#ed6624]/5 transition-colors">
                          <DollarSign size={10} className="text-[#23297e] shrink-0" strokeWidth={2} />
                          Donation focus
                        </button>
                      )}
                      {/* Hidden-categories chip — appears when the user has any
                          "Skip these" exclusions active. Click reopens the
                          Match Tool so they can adjust which categories are
                          hidden; the bare X-style "show all again" lives
                          inside the modal itself. */}
                      {(matchPrefs.excludedCategories?.length ?? 0) > 0 && (
                        <button
                          onClick={() => { setMatchInitialStep(0); setMatchOpen(true); }}
                          className="inline-flex items-center gap-0.5 rounded-full bg-white/70 border border-gray-200 px-1.5 py-0.5 text-[10px] leading-tight hover:border-[#ed6624] hover:bg-[#ed6624]/5 transition-colors"
                          title={`Hidden: ${(matchPrefs.excludedCategories ?? []).join(", ")}`}
                        >
                          <EyeOff size={10} className="text-[#23297e] shrink-0" strokeWidth={2} />
                          Hiding {matchPrefs.excludedCategories!.length} {matchPrefs.excludedCategories!.length === 1 ? "category" : "categories"}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 self-start">
                    <SortDropdown
                      sortBy={sortBy}
                      onSortChange={setSortBy}
                      showDone={showDone}
                      onShowDoneChange={setShowDone}
                      completedCount={myCompletions?.total ?? 0}
                    />
                    <button
                      onClick={() => setMatchOpen(true)}
                      className="font-['Poppins',sans-serif] text-xs font-semibold text-[#23297e] hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => { setMatchPrefs(null); clearPreferences(); }}
                      className="font-['Poppins',sans-serif] text-xs font-semibold text-gray-600 hover:text-[#ed6624]"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              );
            })()}

            {loading ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-6">
                {Array.from({ length: 10 }).map((_, i) => <CardSkeleton key={i} />)}
              </div>
            ) : (
            <>
            <div className={`grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-6 transition-opacity duration-150 ${searchQuery !== deferredSearchQuery ? "opacity-50" : "opacity-100"}`}>
              {(hasActiveFilters || showPendingActsOnly ? visibleActsCards : visibleActsCards.slice(0, displayLimit)).map((card, idx) => (
                <div
                  key={idx < 12 ? `${card.id}-${staggerKey}` : card.id}
                  id={`card-${card.id}`}
                  className={idx < 12 ? "resistact-anim-stagger" : undefined}
                  style={idx < 12 ? { animationDelay: `${idx * 40}ms` } : undefined}
                >
                <ActionCard
                  card={card.isFeatured ? { ...card, featuredIllustration: <FeaturedIllustration /> } : card}
                  onBoost={handleBoost}
                  onComplete={handleComplete}
                  onShare={handleShare}
                  onBookmark={handleBookmark}
                  onEdit={isImpersonating ? undefined : (id) => setEditCardId(id)}
                  onInfoClick={card.pinToTop ? () => setInfoOpen(true) : undefined}
                  isBoosted={effectiveBoosted.has(card.id)}
                  isCompleted={effectiveCompleted.has(card.id)}
                  isBookmarked={effectiveBookmarked.has(card.id)}
                  canEdit={!isImpersonating && canEditCard(card)}
                  isPending={!isImpersonating && isAdminUser && card.adminApproved === false}
                  onApprove={!isImpersonating && isAdminUser ? handleApproveCard : undefined}
                  accessToken={accessToken}
                  onCardUpdated={handleCardSaved}
                />
                </div>
              ))}
            </div>
            </>
            )}

            {/* Sentinel — ref lives on the card 8 slots before the slice end
                (see sentinelCardIdx above). This div is kept as a layout anchor
                but no longer holds the ref. When no card holds it (all cards
                loaded / filters active) sentinelRef.current is null and the
                observer skips, which is correct — nothing more to load. */}
            <div className="h-1" aria-hidden />

            {/* Load more button */}
            {synced && !hasActiveFilters && (displayLimit < displayedCards.length || serverOffset < serverTotal) && (
              <div className="mt-12 flex flex-col items-center gap-2">
                <button
                  onClick={() => {
                    if (displayLimit < displayedCards.length) {
                      setDisplayLimit((prev) => prev + getDisplayPage());
                    } else {
                      handleLoadMore();
                    }
                  }}
                  disabled={loadingMore}
                  className="px-10 py-3.5 bg-[#23297e] hover:bg-[#1a2060] disabled:opacity-60 text-white font-['Poppins',sans-serif] font-semibold text-base rounded-xl transition-colors shadow-sm flex items-center gap-2"
                >
                  {loadingMore && (
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  )}
                  {loadingMore ? "Loading…" : "Load More Campaigns"}
                </button>
                <p className="font-['Poppins',sans-serif] text-xs text-gray-400">
                  Showing {Math.min(displayLimit, displayedCards.length)} of {displayedCards.length} campaigns
                </p>
              </div>
            )}
          </>
            );
          })()
        )}
        </ErrorBoundary>
      </main>

      {/* Always-on tagline footer: motivational reminder pinned to the bottom
          of the viewport. Three columns — acts count (left), the call-to-action
          tag (center), facts + smacks counts (right) — so the live library
          size always appears alongside the message. On narrow screens the
          word labels (acts/facts/smacks) drop to just the colored numbers
          so the center tag stays on one line. */}
      <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-gray-200 shadow-[0_-1px_3px_rgba(0,0,0,0.08)]">
        <div className="flex items-center justify-between gap-2 md:gap-5 py-4 px-3 md:px-6">
          {/* Left: acts count, with a "(N new today)" parenthetical when any
              acts were created today. The "acts" word is hidden on mobile to
              save space; the "new today" note rides along with it. */}
          {/* On the Facts/Smacks tabs the acts count becomes a button that
              jumps back to The Acts (and scrolls to top). On the Acts tab
              itself it stays a plain label — clicking your current tab is a
              no-op, so we don't dress it up as a link. */}
          {(() => {
            const innerContent = (
              <>
                <div className="w-2 h-2 rounded-full bg-[#ed6624]" />
                <span className="font-['Poppins',sans-serif] text-xs text-gray-500 whitespace-nowrap">
                  <strong className="text-[#ed6624] font-bold">{synced ? displayedCards.length : "—"}</strong>
                  <span className="hidden md:inline">
                    {" "}acts
                    {synced && newActionsToday > 0 && ` (${newActionsToday} new today)`}
                  </span>
                </span>
              </>
            );
            return activeTab === "acts" ? (
              <div className="flex items-center gap-1.5 shrink-0">{innerContent}</div>
            ) : (
              <button
                type="button"
                onClick={() => { handleTabChange("acts"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                className="flex items-center gap-1.5 shrink-0 rounded-md px-1 -mx-1 hover:bg-[#ed6624]/10 transition-colors cursor-pointer"
                title="Go to The Acts"
              >
                {innerContent}
              </button>
            );
          })()}
          {/* Center: call-to-action tag */}
          <p className="font-['Poppins',sans-serif] text-center text-[12px] md:text-base leading-tight min-w-0 flex-1">
            <strong className="font-bold text-[#23297e]">
              Pick one. <span className="text-[#ed6624]">Do it.</span> Share it.
            </strong>{" "}
            <em className="italic font-bold text-[#ed6624]">Come back tomorrow.</em>
          </p>
          {/* Right: facts + smacks counts — each is a button that jumps to
              its tab and scrolls to the top, so the footer doubles as quick
              nav between sections. */}
          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            <button
              type="button"
              onClick={() => { handleTabChange("facts"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              className="flex items-center gap-1.5 rounded-md px-1 -mx-1 hover:bg-[#127f05]/10 transition-colors cursor-pointer"
              title="Go to The Facts"
            >
              <div className="w-2 h-2 rounded-full bg-[#127f05]" />
              <span className="font-['Poppins',sans-serif] text-xs text-gray-500 whitespace-nowrap">
                <strong className="text-[#127f05] font-bold">{FACT_CARDS.length}</strong><span className="hidden md:inline">{" "}facts</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => { handleTabChange("receipts"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              className="flex items-center gap-1.5 rounded-md px-1 -mx-1 hover:bg-[#23297e]/10 transition-colors cursor-pointer"
              title="Go to The Smacks"
            >
              <div className="w-2 h-2 rounded-full bg-[#23297e]" />
              <span className="font-['Poppins',sans-serif] text-xs text-gray-500 whitespace-nowrap">
                <strong className="text-[#23297e] font-bold">{receipts.length + STATIC_SMACKS.length}</strong><span className="hidden md:inline">{" "}smacks</span>
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Scroll nudge — lower-right orange toast after scrolling past ~8 cards.
          Auto-expires after 30s (see useEffect above). Sits well clear of the
          always-on tagline footer so it doesn't cover it. */}
      {scrollNudgeVisible && !scrollNudgeDismissed && (
        <div className="toast-pop-in fixed bottom-16 right-4 md:bottom-24 md:right-8 z-40 w-[min(92vw,480px)] flex items-start gap-3 bg-[#fd8e33] rounded-2xl shadow-2xl px-5 py-4 ring-2 ring-white/20">
          <div className="min-w-0 flex-1">
            <p className="font-['Poppins',sans-serif] font-black text-[18px] md:text-[20px] text-white leading-snug mb-2">
              Finding it hard to choose?
            </p>
            <p className="font-['Poppins',sans-serif] text-[13px] md:text-[14px] text-white/90 leading-snug mb-3">
              Let us match you in 30 seconds.
            </p>
            <div className="flex justify-end">
              <button
                onClick={() => { setScrollNudgeVisible(false); setMatchOpen(true); }}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-white hover:bg-gray-50 text-[#fd8e33] font-['Poppins',sans-serif] font-extrabold text-[15px] rounded-xl shadow-sm transition-colors whitespace-nowrap"
              >
                ✨ Refine My Matches →
              </button>
            </div>
          </div>
          <button
            onClick={() => {
              setScrollNudgeVisible(false);
              setScrollNudgeDismissed(true);
              localStorage.setItem("resistact_nudge_dismissed", "1");
            }}
            className="text-white/70 hover:text-white transition-colors shrink-0"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-12 border-t border-gray-200 py-8 px-8 text-center">
        {/* Library size stats (acts/facts/smacks) live in the persistent
            bottom banner now, so they don't render here. */}
        <p className="font-['Poppins',sans-serif] text-sm text-gray-400">
          © 2026 ResistAct · Building grassroots resistance, one act at a time.
        </p>
        <p className="mt-3 max-w-3xl mx-auto font-['Poppins',sans-serif] text-[11px] leading-[1.6] text-gray-400">
          <strong className="font-semibold text-gray-500">Disclaimer:</strong>{" "}
          Action cards on ResistAct are gathered from and submitted by members of the general public. Their inclusion does not constitute endorsement, sponsorship, verification, or recommendation by ResistAct, its operators, contributors, or affiliates. ResistAct makes no representations or warranties as to the accuracy, legality, safety, or efficacy of any submitted action and expressly disclaims all liability arising from any reliance on, or participation in, content posted by users. Participants act at their own risk and are solely responsible for evaluating the legality and safety of any action in their jurisdiction.
        </p>
      </footer>

      {/* Bookmarks Panel */}
      {bookmarksOpen && (
        <BookmarksPanel
          cards={cards}
          bookmarkedIds={bookmarkedCards}
          onBookmark={handleBookmark}
          onClose={() => setBookmarksOpen(false)}
          isLoggedIn={!!approval}
          onLoginClick={() => { setBookmarksOpen(false); setAuthModalOpen(true); }}
        />
      )}

      {/* Auth Modal */}
      {authModalOpen && (
        <AuthModal
          onClose={() => setAuthModalOpen(false)}
          onApproval={(a) => setApproval(a)}
        />
      )}

      {/* Admin Panel */}
      {adminPanelOpen && accessToken && (
        <AdminPanel
          accessToken={accessToken}
          onClose={() => setAdminPanelOpen(false)}
          imageMap={IMAGE_MAP}
          onImpersonate={startImpersonation}
          onCardChanged={handleAdminCardChanged}
        />
      )}

      {/* Flagged Acts admin modal */}
      {flagsAdminOpen && accessToken && (
        <FlagsAdminModal
          accessToken={accessToken}
          onClose={() => setFlagsAdminOpen(false)}
          onFlagsChange={setFlagsCount}
        />
      )}

      {/* Info / About modal */}
      {infoOpen && (
        <InfoModal onClose={() => setInfoOpen(false)} />
      )}

      {/* Feedback modal */}
      {feedbackOpen && (
        <FeedbackModal
          onClose={() => setFeedbackOpen(false)}
          userEmail={approval?.email ?? null}
          userName={approval?.name ?? null}
        />
      )}

      {/* Match Me wizard — suppressed during impersonation so admin can't
          accidentally save Match Me changes to their own account while
          they're trying to see the impersonated user's view. */}
      {/* Admin-only floating entry to the Swipe "Discover" preview. Persistent
          (not tied to a banner) so it's reachable on the Acts tab regardless of
          search / filter / match state. Hidden while the deck itself is open. */}
      {isAdminUser && activeTab === "acts" && !swipeOpen && (
        <button
          onClick={() => setSwipeOpen(true)}
          title="Swipe to discover Acts (admin preview)"
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-[#23297e] px-4 py-3 text-white shadow-lg hover:bg-[#ed6624] transition-colors font-['Poppins',sans-serif] text-sm font-bold"
        >
          🃏 <span className="hidden sm:inline">Swipe</span>
        </button>
      )}

      {/* Swipe "Discover" mode — full-screen overlay over the current feed.
          Right swipe ("interested") adds the card to bookmarks; left swipe
          ("pass") is recorded but not yet fed back into the matcher. The
          learning loop (a swipeAffinity term in matcher.ts) is the next step. */}
      {swipeOpen && isAdminUser && (
        <ErrorBoundary>
          <SwipeDeck
            cards={displayedCards.filter((c) => !c.pinToTop)}
            onClose={() => setSwipeOpen(false)}
            onInterested={(card) => {
              if (!bookmarkedCards.has(card.id)) handleBookmark(card.id);
            }}
          />
        </ErrorBoundary>
      )}
      {matchOpen && isImpersonating && (() => { setMatchOpen(false); return null; })()}
      {matchOpen && !isImpersonating && (
        <ErrorBoundary>
        <MatchMeModal
          cards={cards}
          isLoggedIn={!!approval}
          completedIds={[...completedCards]}
          boostedIds={[...boostedCards]}
          initialStep={matchInitialStep}
          onClose={() => { setMatchOpen(false); setMatchInitialStep(0); }}
          onApply={(prefs) => {
            // Mirror Match Me's state into the Location pill so the
            // navbar reflects what the user picked in the wizard — and
            // so the same value flows through localStorage / server
            // sync as if they'd set it on the pill directly. Empty
            // state clears the pill rather than carrying stale values.
            const mirrored: Preferences = {
              ...prefs,
              locationFilter: prefs.state ? [prefs.state] : [],
            };
            setMatchPrefs(mirrored);
            savePreferences(mirrored);
            setActiveFilters((prev) => ({ ...prev, Location: mirrored.locationFilter }));
            setMatchOpen(false);
            setStaggerKey((k) => k + 1);
            analytics.matchSet(mirrored.time, mirrored.tone);
            // First-match-ever confetti. The flag is per-browser (localStorage)
            // so a user who's switched devices may see it again — that's fine,
            // the moment is "you finished the wizard for the first time HERE".
            // Wrapped in try/catch because localStorage can throw in private
            // browsing on some Safaris, and we never want to break the apply.
            try {
              if (!localStorage.getItem("resistact_first_match_done")) {
                burstConfetti({
                  pieces: 180,
                  duration: 3600,
                  colors: ["#ed6624", "#ffb066", "#ffcc8c", "#e07a28", "#c4661f", "#ffe0bf"],
                });
                localStorage.setItem("resistact_first_match_done", "1");
              }
            } catch {}
            // Sync to the user's profile so prefs follow them across devices.
            // Anonymous users skip the push — their prefs stay in localStorage
            // until they sign up, at which point syncMatchPreferencesOnLogin
            // hands them up on first auth.
            if (accessToken) pushUserPreferences(accessToken, mirrored);
          }}
          onJoinResistance={(prefs) => {
            // Save the picks first so they survive the auth flow — when the
            // user comes back signed in, syncMatchPreferencesOnLogin pushes
            // them to the server and they keep their lineup. Same
            // state→locationFilter mirror as the onApply path so the pill
            // and the wizard always agree on the user's location.
            const mirrored: Preferences = {
              ...prefs,
              locationFilter: prefs.state ? [prefs.state] : [],
            };
            setMatchPrefs(mirrored);
            savePreferences(mirrored);
            setActiveFilters((prev) => ({ ...prev, Location: mirrored.locationFilter }));
            setMatchOpen(false);
            analytics.matchSet(mirrored.time, mirrored.tone);
            setAuthModalOpen(true);
          }}
        />
        </ErrorBoundary>
      )}

      {/* Join ACTers modal (orange — Act button) */}
      {actOpen && (
        <JoinACTersModal
          accessToken={accessToken}
          approval={approval}
          onClose={() => setActOpen(false)}
          onLoginRequired={() => { setActOpen(false); setAuthModalOpen(true); }}
        />
      )}

      {/* Make an ASK modal (navy — Ask button) */}
      {askOpen && isImpersonating && (() => { setAskOpen(false); return null; })()}
      {askOpen && !isImpersonating && (
        <AskFlowModal
          accessToken={accessToken}
          approval={approval}
          onClose={() => setAskOpen(false)}
          // Open AuthModal on top — leaves AskFlow mounted so the wizard's
          // form data and current step survive a sign-in round-trip.
          onLoginRequired={() => setAuthModalOpen(true)}
          onNewCard={handleNewCard}
        />
      )}

      {/* Edit Card Modal */}
      {editCardId !== null && accessToken && (() => {
        const card = cards.find((c) => c.id === editCardId);
        return card ? (
          <EditCardModal
            card={card}
            accessToken={accessToken}
            isAdmin={approval?.isAdmin === true}
            onClose={() => setEditCardId(null)}
            onSaved={(updated) => { handleCardSaved(updated); }}
            onDeleted={(id) => { handleCardDeleted(id); }}
          />
        ) : null;
      })()}

      {/* Transient toast (e.g. after saving a card edit) */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-gray-900 text-white px-4 py-2.5 rounded-xl shadow-lg font-['Poppins',sans-serif] text-sm font-medium pointer-events-none">
          {toastMessage}
        </div>
      )}

      {/* Build version badge — admin-only */}
      {isAdminUser && (
        <>
          <button
            onClick={() => setChangelogOpen(true)}
            title={`v${__APP_VERSION__} · ${__APP_GIT_SHA__} — built ${__APP_BUILD_DATE__} · click for changelog`}
            aria-label={`Version ${__APP_VERSION__}, click to view changelog`}
            className="fixed bottom-2 left-2 z-[100] px-1.5 py-0.5 rounded text-gray-400/40 hover:text-gray-600 hover:bg-white/80 text-[9px] font-mono leading-none select-none transition-all cursor-pointer"
          >
            v{__APP_VERSION__}
          </button>
          {changelogOpen && (
            <Suspense fallback={null}>
              <ChangelogModal onClose={() => setChangelogOpen(false)} />
            </Suspense>
          )}
        </>
      )}

      {/* Tier modal — available to all logged-in users, not just admins */}
      {tierModalOpen && <TierModal actionCount={myCompletions?.total ?? null} byCategory={myCompletions?.byCategory} onClose={() => setTierModalOpen(false)} />}

      {/* Celebration modal — fires for ALL users on a fresh "I did this".
          Rendered outside the admin block so anon + approved users both see
          fireworks. */}
      {celebration && (
        <CelebrationModal
          prevCount={celebration.prev}
          newCount={celebration.next}
          onClose={() => setCelebration(null)}
          onFindMore={() => {
            setCelebration(null);
            // Smooth-scroll back to the top of the action grid so "Find
            // another action" lands on the live feed.
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      )}
    </div>
  );
}