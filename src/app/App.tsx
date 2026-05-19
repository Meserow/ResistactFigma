import { useState, useEffect, useMemo, useRef, useDeferredValue } from "react";
import { Wrench, Clock, Globe, Flame, Smile, VenetianMask, Sun, Zap, MapPin, Users, DollarSign } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { initAnalytics, analytics } from "./lib/analytics";
import { GAMIFICATION_KEYFRAMES } from "./lib/animations";
import { burstConfetti } from "./lib/confetti";
import fistIcon from "../assets/6f09d83b1b948a5a0a2a9e7558c073db252c1f59.png";
import { Navbar } from "./components/Navbar";
import { ActionCard, ActionCardData } from "./components/ActionCard";
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
import { ChangelogModal } from "./components/ChangelogModal";
import { TierModal } from "./components/TierModal";
import { CelebrationModal } from "./components/CelebrationModal";
import { FeedbackModal } from "./components/FeedbackModal";
import { SmacksPage, STATIC_SMACKS, type ReceiptCard } from "./components/SmacksPage";
import { rankCards, score as scoreCard, loadPreferences, clearPreferences, applyMatcherConfig, fetchUserPreferences, pushUserPreferences, savePreferences, timeBucketFor, type Preferences, type UserContext } from "./lib/matcher";
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
  authorAvatarKey?: string | null;
  authorAvatarUrl?: string | null;
  createdBy?: string;
  quickAction?: boolean;
  imageContain?: boolean;
  adminApproved?: boolean;
  firstTimerFriendly?: boolean;
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
const TITLE_CASE_STOPWORDS = new Set(["of", "to", "a", "the", "and", "or", "in", "on", "for", "at"]);
function normaliseCategory(s: string | undefined | null): string {
  const trimmed = (s ?? "").trim();
  if (!trimmed) return "";
  return trimmed
    .toLowerCase()
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
    topImage:     raw.pinToTop ? SPREAD_THE_WORD_TOP_IMAGE : baseTopImage,
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

function readCardsCache(): { cards: ActionCardData[]; total: number } | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(CARDS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CardsCachePayload;
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > CARDS_CACHE_TTL_MS) return null;
    if (!Array.isArray(parsed.rawCards) || parsed.rawCards.length === 0) return null;
    return {
      cards: parsed.rawCards.map(resolveCard),
      total: parsed.total ?? parsed.rawCards.length,
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
    return typeof window !== "undefined" && window.innerWidth >= 640 ? 100 : 20;
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

  // ── Live stats from server ──
  const [statsCitiesCount, setStatsCitiesCount] = useState<number | null>(null);
  const [statsUsersCount, setStatsUsersCount] = useState<number | null>(null);
  const [pendingUsersCount, setPendingUsersCount] = useState<number>(0);
  const [serverPendingActsCount, setServerPendingActsCount] = useState<number>(0);
  const [flagsCount, setFlagsCount] = useState<number>(0);
  const [flagsAdminOpen, setFlagsAdminOpen] = useState<boolean>(false);
  const [siteUpdating, setSiteUpdating] = useState(false);

  // ── Filters ──
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
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
  const [quickActionsOnly, setQuickActionsOnly] = useState(false);
  const [sortBy, setSortBy] = useState<"popular" | "newest" | "az">("popular");

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
  function applyFilters(allCards: ActionCardData[]): ActionCardData[] {
    const q = deferredSearchQuery.toLowerCase().trim();
    return allCards.filter((card) => {
      // Search — matches across the broadest reasonable surface so a user can
      // find a card by partial title, a phrase in the description, an author,
      // a sponsor name, a category/type tag, a location, the time bucket, or
      // even a substring of the linked URL ("events.pol-rev.com"). Sponsor
      // isn't on the card type today (server stores it on user-submissions),
      // hence the cast.
      if (q) {
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
        if (!haystack.includes(q)) return false;
      }

      // Category
      const cats = activeFilters["Category"] ?? [];
      if (cats.length > 0 && !cats.includes(card.category)) return false;

      // Location — match by canonical state (or "Remote"/"National"/etc).
      // Legacy "City, ST" values and old names ("Online"/"From Home"/"Multi-state")
      // get normalized via locationToState.
      const locs = activeFilters["Location"] ?? [];
      if (locs.length > 0) {
        // "Remote" matches any card with isOnline=true regardless of location string.
        const matchesRemote = locs.includes("Remote") && card.isOnline;
        const cardState = locationToState(card.location);
        const matchesLoc = cardState !== null && locs.includes(cardState);
        if (!matchesRemote && !matchesLoc) return false;
      }

      // Quick actions only (5–10 min wins)
      if (quickActionsOnly && !card.quickAction) return false;

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


  function effectiveScore(c: ActionCardData): number {
    const base = engagementScore(c);
    if (!demoteHyperLocal) return base;
    const lb = locationBucket(c);
    if (lb === 3) return base * 0.35;       // specific state / city
    if (lb === 4) return base * 0.7;        // unspecified location
    return base;                            // Online / National / Multi-state untouched
  }
  // Today's date as ISO string (YYYY-MM-DD) for expiry + sort comparisons.
  const todayISO = new Date().toISOString().slice(0, 10);
  const isAdminUser = approval?.isAdmin === true;
  const pendingActsCount   = isAdminUser ? serverPendingActsCount : 0;
  const pendingSmacksCount = isAdminUser ? receipts.filter((r) => (r as any).adminApproved === false).length : 0;

  const displayedCards = (() => {
    // ── Global gate: expiry + approval + already-done ────────────────────────
    const gated = cards.filter((card) => {
      // Hide expired events from everyone
      if (card.eventDate && card.eventDate < todayISO) return false;
      // Hide unapproved cards from non-admins — admins see them with a PENDING badge
      if (card.adminApproved === false && !isAdminUser) return false;
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
    const withPinned = (arr: ActionCardData[]): ActionCardData[] =>
      pinnedAlwaysShow.length === 0
        ? arr
        : [...pinnedAlwaysShow, ...arr.filter((c) => !c.pinToTop)];
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
    if (matchPrefs) {
      // Admins always see pending cards — pull them out so the score threshold
      // doesn't silently drop them, then append them after the ranked results.
      const pendingForAdmin = isAdminUser ? filtered.filter((c) => c.adminApproved === false) : [];
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
              return ranked.filter((c) => scoreCard(c, matchPrefs, userCtx) >= threshold);
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

    // ── Popular: pure engagement sort — boosts + completions DESC ──────────────
    // Event cards with a future date are NOT pinned; they compete on engagement
    // just like everything else. A zero-engagement event shouldn't jump the queue.
    // `effectiveScore` is identical to `engagementScore` for logged-in users
    // and Match-Me users; for anonymous users with no known location it
    // additionally penalises hyper-local actions so Online/National rise.
    // Round to integer so scores like 12.6 and 13 still tier together cleanly.
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
        const lb = locationBucket(c);
        if (!byLoc.has(lb)) byLoc.set(lb, []);
        byLoc.get(lb)!.push(c);
      }
      for (const lb of [0, 1, 2, 3, 4]) {
        const grp = byLoc.get(lb);
        if (grp && grp.length > 0) out.push(...interleaveByCategory(grp));
      }
    }
    return pinFirst(completedLast(out));
  })();

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
    const set = new Set<string>();
    for (const c of approvedCards) {
      const cat = (c.category ?? "").trim();
      if (cat) set.add(cat);
    }
    return Array.from(set).sort();
  }, [approvedCards]);

  // Distinct locations from currently-loaded cards, ordered to match the
  // canonical `LOCATION_OPTIONS` list used by Add-an-Action and Edit. "Online"
  // is always included (it filters cards by `isOnline`, which is independent
  // of the literal location string).
  const dynamicLocations = useMemo(() => {
    const set = new Set<string>(["Remote"]);
    for (const c of approvedCards) {
      const loc = locationToState(c.location);
      if (loc) set.add(loc);
    }
    return LOCATION_OPTIONS.filter((opt) => set.has(opt));
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
  async function syncMatchPreferencesOnLogin(token: string) {
    try {
      const remote = await fetchUserPreferences(token);
      if (remote) {
        savePreferences(remote);
        setMatchPrefs(remote);
      } else {
        const local = loadPreferences();
        if (local) {
          await pushUserPreferences(token, local);
          setMatchPrefs(local);
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

  async function handleLogout() {
    await supabase.auth.signOut();
    setApproval(null);
    setAccessToken(null);
  }

  // ── Boot analytics on mount. No-op when VITE_GA_MEASUREMENT_ID is unset
  //    or the browser has Do-Not-Track on. Idempotent — safe to call again. ──
  useEffect(() => { initAnalytics(); }, []);

  // ── Sync cards from Supabase ──
  const PAGE_SIZE = 20;

  useEffect(() => {
    async function syncCards() {
      try {
        // Fetch first page to learn the total
        const firstRes = await fetch(`${API}/actions?limit=100&offset=0`, { headers: HEADERS });
        if (!firstRes.ok) {
          const text = await firstRes.text();
          console.error(`Failed to sync cards from server (${firstRes.status}): ${text}`);
          setCards(STATIC_CARDS);
          setLoading(false);
          return;
        }
        const firstData = await firstRes.json();
        const firstBatch = (firstData.cards as ServerCard[] | undefined) ?? [];
        if (firstBatch.length === 0) {
          setCards(STATIC_CARDS);
          setLoading(false);
          return;
        }
        const total = firstData.total ?? firstBatch.length;
        const all: ActionCardData[] = firstBatch.map(resolveCard);
        // Show the first page immediately so the user sees something fast.
        setCards(all);
        setServerTotal(total);
        setServerOffset(all.length);
        setSynced(true);
        setLoading(false);
        // Cache the raw first page so the next visit hydrates instantly.
        writeCardsCache(firstBatch, total);

        // Drain the rest in parallel — sequential fetches add up to multi-second
        // sync on slower connections, which makes the acts count next to the
        // sort dropdown read low (e.g. "200 acts") and silently scopes search
        // to whatever's loaded so far. Fire all remaining pages at once and
        // commit them in offset order.
        const remainingOffsets: number[] = [];
        for (let o = all.length; o < total; o += 100) remainingOffsets.push(o);
        if (remainingOffsets.length > 0) {
          const results = await Promise.all(
            remainingOffsets.map(async (o) => {
              const res = await fetch(`${API}/actions?limit=100&offset=${o}`, { headers: HEADERS });
              if (!res.ok) return { offset: o, cards: [] as ServerCard[] };
              const data = await res.json();
              return { offset: o, cards: (data.cards as ServerCard[] | undefined) ?? [] };
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
        if (!cancelled) setReceipts(data.receipts ?? []);
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

  // ── When any filter is active, eagerly fetch the rest of the cards so
  //    client-side filtering sees the full dataset (server pagination would
  //    otherwise hide matching cards behind the Load More button). ───────────
  useEffect(() => {
    if (!hasActiveFilters || !synced || loadingMore) return;
    if (cards.length >= serverTotal) return;

    let cancelled = false;
    (async () => {
      setLoadingMore(true);
      try {
        let offset = serverOffset;
        const collected: ActionCardData[] = [];
        // Server caps per-request at 100; loop until we've drained.
        while (offset < serverTotal && !cancelled) {
          const res = await fetch(`${API}/actions?limit=100&offset=${offset}`, { headers: HEADERS });
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
  }, [hasActiveFilters, synced, serverTotal]);

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
    const isDesktop = () => window.innerWidth >= 640;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        if (!isDesktop()) return;                      // mobile keeps the button
        if (hasActiveFilters) return;                  // filters show all, nothing to load
        if (loadingMore) return;
        if (displayLimit < displayedCards.length) {
          setDisplayLimit((prev) => prev + getDisplayPage());
        } else if (serverOffset < serverTotal) {
          handleLoadMore();
        }
      },
      { rootMargin: "200px" }                         // trigger 200px before the sentinel
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
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
    if (!accessToken) return;
    try {
      const res = await fetch(`${API}/admin/approve-action/${id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setCards((prev) => prev.map((c) => c.id === id ? { ...c, adminApproved: true, ...data.card } : c));
    } catch (err) {
      console.error("Approve card error:", err);
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

  return (
    <div className="min-h-screen bg-gray-50 font-['Poppins',sans-serif]">
      {/* Gamification keyframes injected once. Centralised in lib/animations.ts
          so individual components only need to add a class name to opt in. */}
      <style>{GAMIFICATION_KEYFRAMES}</style>
      <Navbar
        approval={approval}
        myCompletions={myCompletions ?? localCompletions}
        onLoginClick={() => setAuthModalOpen(true)}
        onLogout={handleLogout}
        onAdminClick={() => setAdminPanelOpen(true)}
        onPendingActsClick={() => { handleTabChange("acts"); setPendingActsVersion((v) => v + 1); }}
        onPendingSmacksClick={() => { handleTabChange("receipts"); setSmacksPendingVersion((v) => v + 1); }}
        onFlaggedActsClick={() => setFlagsAdminOpen(true)}
        pendingActsCount={pendingActsCount}
        pendingSmacksCount={pendingSmacksCount}
        pendingUsersCount={pendingUsersCount}
        flagsCount={isAdminUser ? flagsCount : 0}
        onInfoClick={() => setInfoOpen(true)}
        onActClick={() => setActOpen(true)}
        onBookmarksClick={() => setBookmarksOpen(true)}
        bookmarkCount={bookmarkedCards.size}
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
        activeTab={activeTab}
        onTabChange={handleTabChange}
        quickActionsOnly={quickActionsOnly}
        onQuickActionsChange={setQuickActionsOnly}
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
        smacksIsAdmin={isAdminUser}
        heroSlot={
          approval
            ? activeTab === "acts"
              ? (() => {
                  const todayStr = new Date().toISOString().slice(0, 10);
                  const newToday = cards.filter((c: any) => {
                    const created = (c.createdAt as string | undefined) ?? "";
                    return created.slice(0, 10) === todayStr;
                  }).length;
                  return (
                    <LoggedInHero
                      userId={approval.userId}
                      name={approval.name || "Resistor"}
                      newActionsToday={newToday}
                      onMatchClick={() => setMatchOpen(true)}
                      onAskClick={() => setAskOpen(true)}
                      hasMatchPrefs={matchPrefs !== null}
                    />
                  );
                })()
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
            searchQuery={deferredSearchQuery}
            accessToken={accessToken}
            approval={approval}
            onReceiptAdded={(r) => setReceipts((prev) => [...prev, r])}
            onReceiptApproved={(id) =>
              setReceipts((prev) =>
                prev.map((r) => (r.id === id ? { ...r, adminApproved: true } : r))
              )
            }
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
            {/* Unfiltered banner — nudges users to try the match tool */}
            {!matchPrefs && !hasActiveFilters && activeTab === "acts" && synced && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5">
                <p className="font-['Poppins',sans-serif] text-sm text-gray-600">
                  Showing all <strong className="text-[#23297e]">{displayedCards.length}</strong> actions — unfiltered.
                </p>
                <button
                  onClick={() => setMatchOpen(true)}
                  className="shrink-0 font-['Poppins',sans-serif] text-xs font-bold text-[#ed6624] hover:text-[#e07a28] hover:underline transition-colors whitespace-nowrap"
                >
                  ✨ Find my match →
                </button>
              </div>
            )}

            {/* Pending-only banner */}
            {isAdminUser && showPendingActsOnly && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-2.5">
                <p className="font-['Poppins',sans-serif] text-sm text-red-700">
                  ⚠️ <strong>Pending approval only</strong> — showing {visibleActsCards.length} unapproved act{visibleActsCards.length !== 1 ? "s" : ""}.
                </p>
                <div className="flex items-center gap-3 shrink-0">
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
            )}

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
              // Location label derived from the setting array.
              const settingLabel = (() => {
                const s = matchPrefs.setting ?? [];
                if (s.includes("online") && s.includes("inPerson")) return "Mostly Remote";
                if (s.includes("online")) return "Remote only";
                if (s.includes("inPerson")) return "In-person";
                return "Remote + In-person";
              })();
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
                    </p>
                    {/* Chip strip — wraps on narrow viewports. All icons are
                        simple navy line-icons so the strip reads as one unified
                        UI element rather than a row of disparate emoji. */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-600 font-['Poppins',sans-serif]">
                      {timeLabel && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-white/70 border border-gray-200 px-2 py-0.5">
                          <Clock size={11} className="text-[#23297e] shrink-0" strokeWidth={2} />
                          {timeLabel}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/70 border border-gray-200 px-2 py-0.5">
                        <Globe size={11} className="text-[#23297e] shrink-0" strokeWidth={2} />
                        {settingLabel}
                      </span>
                      {toneChips.map((c) => {
                        const Icon = c.Icon;
                        return (
                          <span
                            key={c.label}
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border ${
                              c.isDefault
                                ? "bg-gray-50 border-gray-100 text-gray-400"
                                : "bg-[#ed6624]/10 border-[#ed6624]/30 text-[#23297e] font-semibold"
                            }`}
                            title={c.isDefault ? `${c.label} — default (not set)` : `${c.label} bumped to ${c.value}`}
                          >
                            <Icon size={11} className={`shrink-0 ${c.isDefault ? "text-gray-400" : "text-[#23297e]"}`} strokeWidth={2} />
                            {c.label}: {c.value}
                          </span>
                        );
                      })}
                      {matchPrefs.state && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-white/70 border border-gray-200 px-2 py-0.5">
                          <MapPin size={11} className="text-[#23297e] shrink-0" strokeWidth={2} />
                          {matchPrefs.state}
                        </span>
                      )}
                      {groupCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-white/70 border border-gray-200 px-2 py-0.5">
                          <Users size={11} className="text-[#23297e] shrink-0" strokeWidth={2} />
                          Amplifies {groupCount} {groupCount === 1 ? "group" : "groups"}
                        </span>
                      )}
                      {matchPrefs.focusDonations && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-white/70 border border-gray-200 px-2 py-0.5">
                          <DollarSign size={11} className="text-[#23297e] shrink-0" strokeWidth={2} />
                          Donation focus
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 self-start">
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
              <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
                {Array.from({ length: 10 }).map((_, i) => <CardSkeleton key={i} />)}
              </div>
            ) : (
            <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
              {(hasActiveFilters || showPendingActsOnly ? visibleActsCards : visibleActsCards.slice(0, displayLimit)).map((card, idx) => (
                // First 12 cards get a stagger-in animation, keyed by
                // `staggerKey` so it re-fires whenever the user applies a new
                // Match config. Cards past index 11 don't animate — keeps
                // infinite scroll quiet. The `key={...}-${staggerKey}` forces
                // React to re-mount the wrapper on key change so the CSS
                // keyframe runs from the start.
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
                  onEdit={(id) => setEditCardId(id)}
                  onInfoClick={card.pinToTop ? () => setInfoOpen(true) : undefined}
                  isBoosted={boostedCards.has(card.id)}
                  isCompleted={completedCards.has(card.id)}
                  isBookmarked={bookmarkedCards.has(card.id)}
                  canEdit={canEditCard(card)}
                  isPending={isAdminUser && card.adminApproved === false}
                  onApprove={isAdminUser ? handleApproveCard : undefined}
                  accessToken={accessToken}
                />
                </div>
              ))}
            </div>
            </>
            )}

            {/* Sentinel for desktop infinite scroll — sits just below the grid.
                IntersectionObserver fires ~200px before it enters the viewport. */}
            <div ref={sentinelRef} className="h-1" aria-hidden />

            {/* Load more button — mobile only. Desktop uses the sentinel above. */}
            {synced && !hasActiveFilters && (displayLimit < displayedCards.length || serverOffset < serverTotal) && (
              <div className="mt-12 flex flex-col items-center gap-2 sm:hidden">
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
          of the viewport. The scroll nudge toast sits in the lower-right
          (not full-width) so it no longer covers this. */}
      <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-gray-200 shadow-[0_-1px_3px_rgba(0,0,0,0.08)]">
        <p className="font-['Poppins',sans-serif] text-center text-[14px] md:text-base py-5 px-4 leading-tight">
          <strong className="font-bold text-[#23297e]">Pick one. <span className="text-[#ed6624]">Do it.</span> Share it.</strong>{" "}
          <em className="italic font-bold text-[#ed6624]">Come back tomorrow.</em>
        </p>
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
                ✨ Open Quick Acts for Me Tool →
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

      {/* Match Me wizard */}
      {matchOpen && (
        <ErrorBoundary>
        <MatchMeModal
          cards={cards}
          isLoggedIn={!!approval}
          completedIds={[...completedCards]}
          boostedIds={[...boostedCards]}
          onClose={() => setMatchOpen(false)}
          onApply={(prefs) => {
            setMatchPrefs(prefs);
            savePreferences(prefs);
            setMatchOpen(false);
            setStaggerKey((k) => k + 1);
            analytics.matchSet(prefs.time, prefs.tone);
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
            if (accessToken) pushUserPreferences(accessToken, prefs);
          }}
          onJoinResistance={(prefs) => {
            // Save the picks first so they survive the auth flow — when the
            // user comes back signed in, syncMatchPreferencesOnLogin pushes
            // them to the server and they keep their lineup.
            setMatchPrefs(prefs);
            savePreferences(prefs);
            setMatchOpen(false);
            analytics.matchSet(prefs.time, prefs.tone);
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
      {askOpen && (
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
          {changelogOpen && <ChangelogModal onClose={() => setChangelogOpen(false)} />}
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