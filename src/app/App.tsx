import { useState, useEffect, useMemo, useRef } from "react";
import { Navbar } from "./components/Navbar";
import { ActionCard, ActionCardData } from "./components/ActionCard";
import { FactCard } from "./components/FactCard";
import { FACT_CARDS } from "./data/factCards";
import { STATIC_CARDS, IMAGE_MAP } from "./data/actionCards";
import { AuthModal } from "./components/AuthModal";
import { AdminPanel } from "./components/AdminPanel";
import { AskFlowModal } from "./components/AskFlowModal";
import { JoinACTersModal } from "./components/JoinACTersModal";
import { InfoModal } from "./components/InfoModal";
import { EditCardModal } from "./components/EditCardModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { locationToState } from "./lib/locations";
import { HomeHero } from "./components/HomeHero";
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
}

const API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04`;
const HEADERS = { "Content-Type": "application/json", Authorization: `Bearer ${publicAnonKey}` };

function resolveCard(raw: ServerCard): ActionCardData {
  return {
    ...raw,
    boosts:       raw.boosts ?? raw.spotsUsed ?? 0,
    completions:  raw.completions ?? 0,
    targetUrl:    raw.targetUrl ?? undefined,
    // Explicit topImageUrl wins over topImageKey so admin edits to the image
    // override the seed-provided org logo. Empty/null URL falls back to the key.
    topImage:     (raw.topImageUrl && raw.topImageUrl.length > 0)
                    ? raw.topImageUrl
                    : (raw.topImageKey ? IMAGE_MAP[raw.topImageKey] : undefined),
    authorAvatar: raw.authorAvatarKey ? IMAGE_MAP[raw.authorAvatarKey] : (raw.authorAvatarUrl ?? undefined),
  };
}

// ─── Featured illustration ────────────────────────────────────────────────────
import diagramImg from "../assets/3a930cb92932029145f5289a4b745deaa43e0aa6.png";

function FeaturedIllustration() {
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <img
        src={diagramImg}
        alt="ASK → MATCH → ACT → CHANGE"
        className="w-full h-full object-contain"
      />
    </div>
  );
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
  const [cards, setCards] = useState<ActionCardData[]>([]);
  const [synced, setSynced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverOffset, setServerOffset] = useState(0);
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
  const [bookmarkedCards, setBookmarkedCards] = useState<Set<number>>(new Set());
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
  const [askOpen, setAskOpen] = useState(false);
  const [editCardId, setEditCardId] = useState<number | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  function showToast(msg: string) {
    setToastMessage(msg);
    window.setTimeout(() => setToastMessage((current) => (current === msg ? null : current)), 2200);
  }

  // ── Live stats from server ──
  const [statsCitiesCount, setStatsCitiesCount] = useState<number | null>(null);
  const [statsUsersCount, setStatsUsersCount] = useState<number | null>(null);

  // ── Filters ──
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [activeTab, setActiveTab] = useState<"facts" | "acts">("acts");
  const [searchQuery, setSearchQuery] = useState("");
  const [quickActionsOnly, setQuickActionsOnly] = useState(false);

  function handleFilterChange(filterName: string, selected: string[]) {
    setActiveFilters((prev) => ({ ...prev, [filterName]: selected }));
  }

  function handleTabChange(tab: "facts" | "acts") {
    setActiveTab(tab);
    setActiveFilters({});
    setSearchQuery("");
    setQuickActionsOnly(false);
  }

  // ── Apply filters client-side ──
  function applyFilters(allCards: ActionCardData[]): ActionCardData[] {
    const q = searchQuery.toLowerCase().trim();
    return allCards.filter((card) => {
      // Search — matches across title, description, category, author, location, type
      if (q) {
        const haystack = [
          card.title,
          card.description,
          card.category,
          card.authorName,
          card.authorRole,
          card.location ?? "",
          card.actionType ?? "",
        ].join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      // Category
      const cats = activeFilters["Category"] ?? [];
      if (cats.length > 0 && !cats.includes(card.category)) return false;

      // Location — match by canonical state (or "Online"/"National"/etc).
      // legacy "City, ST" values get normalized via locationToState.
      const locs = activeFilters["Location"] ?? [];
      if (locs.length > 0) {
        const matchesOnline = locs.includes("Online") && card.isOnline;
        const cardState = locationToState(card.location);
        const matchesLoc = cardState !== null && locs.includes(cardState);
        if (!matchesOnline && !matchesLoc) return false;
      }

      // Quick actions only (5–10 min wins)
      if (quickActionsOnly && !card.quickAction) return false;

      return true;
    });
  }

  // Stable random key per card id — used for shuffling within boost groups.
  // Keys persist across re-renders so card order doesn't reshuffle when a
  // user boosts something; new cards from pagination get a fresh key on
  // first sight.
  const tieBreakKeysRef = useRef(new Map<number, number>());
  for (const c of cards) {
    if (!tieBreakKeysRef.current.has(c.id)) {
      tieBreakKeysRef.current.set(c.id, Math.random());
    }
  }
  const keyOf = (c: ActionCardData) => tieBreakKeysRef.current.get(c.id) ?? 0;

  // Sort: boost desc → within each boost level, round-robin by category so
  // same-category cards never cluster. Order inside each (boost, category)
  // bucket is the stable random key.
  function interleaveByCategory(group: ActionCardData[]): ActionCardData[] {
    const buckets = new Map<string, ActionCardData[]>();
    for (const c of group) {
      const cat = c.category || "_other";
      if (!buckets.has(cat)) buckets.set(cat, []);
      buckets.get(cat)!.push(c);
    }
    for (const arr of buckets.values()) arr.sort((a, b) => keyOf(a) - keyOf(b));
    // Stable random category visit order (uses the first card in each bucket
    // as a proxy seed — same input always produces the same order).
    const cats = Array.from(buckets.keys()).sort((a, b) => keyOf(buckets.get(a)![0]) - keyOf(buckets.get(b)![0]));
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
    if (loc === "Multi-state") return 2;
    if (loc) return 3;
    return 4;
  }
  function engagementScore(c: ActionCardData): number {
    return (c.boosts ?? 0) + (c.completions ?? 0);
  }
  const displayedCards = (() => {
    const filtered = applyFilters(cards);
    const byScore = new Map<number, ActionCardData[]>();
    for (const c of filtered) {
      const s = engagementScore(c);
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
    return out;
  })();

  // True when any filter chip is selected OR a search is active — bypasses
  // server pagination so client-side filtering sees the full dataset.
  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    quickActionsOnly ||
    Object.values(activeFilters).some((arr) => (arr ?? []).length > 0);

  // Distinct categories from currently-loaded cards, sorted alphabetically.
  // Drives the Category pills in the navbar.
  const dynamicCategories = useMemo(() => {
    const set = new Set<string>();
    for (const c of cards) {
      const cat = (c.category ?? "").trim();
      if (cat) set.add(cat);
    }
    return Array.from(set).sort();
  }, [cards]);

  // Distinct locations from currently-loaded cards. "Online" stays at the
  // top as a special option that maps to `card.isOnline` in applyFilters.
  // Any literal "Online" location strings are deduped so the dropdown shows
  // a single Online entry.
  const dynamicLocations = useMemo(() => {
    const set = new Set<string>();
    for (const c of cards) {
      const state = locationToState(c.location);
      if (state && state !== "Online") set.add(state);
    }
    return ["Online", ...Array.from(set).sort()];
  }, [cards]);

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
      } else {
        setAccessToken(null);
        setApproval(null);
        setMyCompletions(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

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

        // Drain the rest in the background — small payload, keeps the
        // category filter list and search complete for power users.
        let offset = all.length;
        while (offset < total) {
          const res = await fetch(`${API}/actions?limit=100&offset=${offset}`, { headers: HEADERS });
          if (!res.ok) break;
          const data = await res.json();
          const batch = (data.cards as ServerCard[] | undefined) ?? [];
          if (batch.length === 0) break;
          const resolved = batch.map(resolveCard);
          setCards((prev) => {
            const seen = new Set(prev.map((c) => c.id));
            return [...prev, ...resolved.filter((c) => !seen.has(c.id))];
          });
          offset += batch.length;
          setServerOffset(offset);
        }
      } catch (err) {
        console.error("Network error syncing cards:", err);
        setCards(STATIC_CARDS);
        setLoading(false);
      }
    }
    syncCards();
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
      return next;
    });
  };

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
      <Navbar
        approval={approval}
        myCompletions={myCompletions ?? localCompletions}
        onLoginClick={() => setAuthModalOpen(true)}
        onLogout={handleLogout}
        onAdminClick={() => setAdminPanelOpen(true)}
        onInfoClick={() => setInfoOpen(true)}
        onActClick={() => setActOpen(true)}
        onAskClick={() => setAskOpen(true)}
        statsActsCount={hasActiveFilters ? displayedCards.length : (synced && serverTotal > 0 ? serverTotal : cards.length)}
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
        heroSlot={
          activeTab === "acts" && !approval ? (
            <HomeHero onJoinClick={() => setAuthModalOpen(true)} />
          ) : null
        }
      />

      <main className="px-4 md:px-8 py-8">
        <ErrorBoundary>
        {activeTab === "facts" ? (
          /* ── Facts view ── */
          (() => {
            const q = searchQuery.toLowerCase().trim();
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
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
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
          <>
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {Array.from({ length: 10 }).map((_, i) => <CardSkeleton key={i} />)}
              </div>
            ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {(hasActiveFilters ? displayedCards : displayedCards.slice(0, displayLimit)).map((card) => (
                <ActionCard
                  key={card.id}
                  card={card.isFeatured ? { ...card, featuredIllustration: <FeaturedIllustration /> } : card}
                  onBoost={handleBoost}
                  onComplete={handleComplete}
                  onShare={handleShare}
                  onBookmark={handleBookmark}
                  onEdit={(id) => setEditCardId(id)}
                  isBoosted={boostedCards.has(card.id)}
                  isCompleted={completedCards.has(card.id)}
                  isBookmarked={bookmarkedCards.has(card.id)}
                  canEdit={canEditCard(card)}
                />
              ))}
            </div>
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
                  Showing {Math.min(displayLimit, displayedCards.length)} of {serverTotal} campaigns
                </p>
              </div>
            )}
          </>
        )}
        </ErrorBoundary>
      </main>

      {/* Footer */}
      <footer className="mt-12 border-t border-gray-200 py-8 px-8 text-center">
        <p className="font-['Poppins',sans-serif] text-sm text-gray-400">
          © 2026 ResistAct · Building grassroots resistance, one act at a time.
        </p>
      </footer>

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
        />
      )}

      {/* Info / About modal */}
      {infoOpen && (
        <InfoModal onClose={() => setInfoOpen(false)} />
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
          onLoginRequired={() => { setAskOpen(false); setAuthModalOpen(true); }}
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
    </div>
  );
}