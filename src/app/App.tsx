import { useState, useEffect, useMemo } from "react";
import { Navbar } from "./components/Navbar";
import { ActionCard, ActionCardData } from "./components/ActionCard";
import { FactCard } from "./components/FactCard";
import { FACT_CARDS } from "./data/factCards";
import { AuthModal } from "./components/AuthModal";
import { AdminPanel } from "./components/AdminPanel";
import { AskFlowModal } from "./components/AskFlowModal";
import { JoinACTersModal } from "./components/JoinACTersModal";
import { InfoModal } from "./components/InfoModal";
import { EditCardModal } from "./components/EditCardModal";
import svgPaths from "../imports/svg-77lgd1zdt6";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { supabase } from "./lib/supabase";
import type { UserApproval } from "./lib/supabase";

// ─── Figma bundled assets ─────────────────────────────────────────────────────
import imgImage    from "../assets/8845f14cf11ec3b7059898cd8adda5059833c2c7.png";
import imgImage1   from "../assets/6dd4ba1639105589e2d4bcdd59e21ad50a4f0db2.png";
import imgImage2   from "../assets/17ae6a615bc1a99b8cbc5240e532f4d9a2e76ba9.png";
import imgImage3   from "../assets/2122e5681fca2a67fa8c21ce938335204646f5f3.png";
import imgImage4   from "../assets/81cfc6786bc36ca734bbdefbda22c4ed8f215998.png";
import imgImage5   from "../assets/83f5ff48d560ab0e0bf359f87c6066ed854f2614.png";
import imgImage6   from "../assets/672f9df1a029464f302dfcd18d0af1213faee70d.png";
import imgImage7   from "../assets/df2e72270a76b043f5ae0dab18876bdf49110ecf.png";
import imgImage8   from "../assets/d7d24dcae11e3763828c0a43fac7fc22a50cef19.png";
import imgImage9   from "../assets/985494e2d4efacbac6fe9eeab8b3bb05987c598b.png";
import imgImage10  from "../assets/6fb5e9741ea7c952728321cc45c7b5643d390520.png";
import imgImage11  from "../assets/5b1a9d6121b57c97b38ed951d385ab4fb571380c.png";
import imgImage12  from "../assets/feb6ae285a92a2b1c606d3ef7402227e137292e9.png";
import imgImage13  from "../assets/cfca6ec0f7d46bd37209105f50f378c7291dd60e.png";
import imgImage14  from "../assets/77dc333618263389c5c551cb5201f1417ba52106.png";
import imgImage15  from "../assets/f086c5ab52082a738351d7d2ac485a119b3fed97.png";
import imgImage16  from "../assets/f55ceb9640e90e362c0b56f89883b2d57199d1a8.png";
import imgImage17  from "../assets/f6b1f90b5d4a6453a308692cef5c384b793b5cbc.png";
import imgImage18  from "../assets/8e3b35fdf8b10fb6307188626c720152ca6b1ae9.png";
import imgImage19  from "../assets/2c8e6a99c675347c7cec3aea8f490848603746ed.png";
import imgImage20  from "../assets/3fc52741865fd1c68c6b1fa7e0dd59c90346bd31.png";
import imgImage21  from "../assets/50c8572422ebf0309458e2b1f0d4bea2e682d9f3.png";
import imgImage22  from "../assets/50c8572422ebf0309458e2b1f0d4bea2e682d9f3.png";
import imgImage25  from "../assets/0e573958d76815ca5260107ddbc78923948e1490.png";
import imgImage34  from "../assets/f757504534bf51b4afc042b9ec12280b63be51da.png";

// ─── Image key → imported asset map ──────────────────────────────────────────
const IMAGE_MAP: Record<string, string> = {
  imgImage,
  imgImage1,
  imgImage2,
  imgImage3,
  imgImage4,
  imgImage5,
  imgImage6,
  imgImage7,
  imgImage8,
  imgImage9,
  imgImage10,
  imgImage11,
  imgImage12,
  imgImage13,
  imgImage14,
  imgImage15,
  imgImage16,
  imgImage17,
  imgImage18,
  imgImage19,
  imgImage20,
  imgImage21,
  imgImage22,
  imgImage25,
  imgImage34,
};

// Raw shape coming back from the server (uses string keys instead of imports)
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
  spotsUsed: number;
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
}

const API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04`;
const HEADERS = { "Content-Type": "application/json", Authorization: `Bearer ${publicAnonKey}` };

function resolveCard(raw: ServerCard): ActionCardData {
  return {
    ...raw,
    targetUrl:    raw.targetUrl ?? undefined,
    topImage:     raw.topImageKey ? IMAGE_MAP[raw.topImageKey] : (raw.topImageUrl ?? undefined),
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

// ─── Static fallback cards (shown immediately; replaced by live data on fetch) ─
const STATIC_CARDS: ActionCardData[] = [
  { id: 1, isFeatured: true, category: "BOOST", categoryColor: "#8a00e6", title: "Spread the Word about ResistAct", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community needs your help spreading awareness about ResistAct so we can build a stronger resistance network together.", spotsUsed: 3020, spotsTotal: "Unlimited", authorName: "Ellen Meserow", authorRole: "ResistAct Founder", authorAvatar: imgImage34 },
  { id: 2, category: "CRAFTING", categoryColor: "#c34e00", title: "Make 1460 Orange Paper Chains", description: "Help trans kids survive the next 4 years by sending them paper chains with 365x4 links to will help them see that there will be an end to this persecution of them.", spotsUsed: 500, spotsTotal: 1000, authorName: "Jo Jones", authorRole: "Citizen Activist", topImage: imgImage12, authorAvatar: imgImage },
  { id: 3, category: "FLASH MOB", categoryColor: "#ff00d5", title: "Join us in forming human RESIST", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community is forming a human 'RESIST' sign visible from above — join us!", location: "Boston, MA", spotsUsed: 50, spotsTotal: 200, authorName: "Meg Jones", authorRole: "Franklin High School", topImage: imgImage6, authorAvatar: imgImage4 },
  { id: 4, category: "FUNDING", categoryColor: "#127f05", title: "Help Me Launch Over Los Angeles", description: "I have the land to protect and the people to set up a massive Trump balloon over my house, but I need the funding to purchase it. Go to my GoFundMe and help me buy it!", isOnline: true, spotsUsed: 739, spotsTotal: "Unlimited", authorName: "Patrick Escarcega", authorRole: "Citizen Activist", topImage: imgImage19, authorAvatar: imgImage1 },
  { id: 5, category: "PROTEST", categoryColor: "#23297e", title: "Show Trump We Are United", description: "March on the Capitol with us to show Trump the size of the resistance. Spread the word about July 4th Patriotic Resistance March and bring all your friends and family!", location: "Washington DC", spotsUsed: 2, spotsTotal: 10, authorName: "John Smith", authorRole: "MoveOn.org", topImage: imgImage13, authorAvatar: imgImage20 },
  { id: 6, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", title: "Here Let me Pray for You", description: "We are social media warriors who prove the religious left lives its values. Join us online to pray for our conservative brothers/sisters in Christ who have strayed from His teachings.", isOnline: true, spotsUsed: 52, spotsTotal: 75, authorName: "McKenna Hartman", authorRole: "Citizen Activist", topImage: imgImage7, authorAvatar: imgImage16 },
  { id: 7, category: "BOOST", categoryColor: "#8a00e6", title: "Spread the Word about ResistAct", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community needs your help spreading awareness about ResistAct.", spotsUsed: 3020, spotsTotal: "Unlimited", authorName: "Ellen Meserow", authorRole: "ResistAct Founder", topImage: imgImage25, authorAvatar: imgImage34 },
  { id: 8, category: "FLASH MOB", categoryColor: "#ff00d5", title: "Petition the Leftist Billionaires", description: "We need electronic billboards that show the daily price of eggs/gas since Trump took office. Another to show the Trump deficit versus Elon Musk's wealth. Another to show...", typeTag: "FLASH MOB", spotsUsed: 5, spotsTotal: 10, authorName: "Nancie Kosnoff", authorRole: "Citizen Activist", topImage: imgImage14, authorAvatar: imgImage2 },
  { id: 9, category: "PETITION", categoryColor: "#05737f", title: "Stop Funding Fox", description: "MoveOn Civic Action has a long history of taking on Fox's lies. With actions taken by thousands of MoveOn members, we've been able to put pressure on cable providers to drop Fox News.", location: "Austin, TX", spotsUsed: 5, spotsTotal: 10, authorName: "Meg Jones", authorRole: "Franklin High School", topImage: imgImage21, authorAvatar: imgImage4 },
  { id: 10, category: "PROTEST", categoryColor: "#23297e", title: "Towns Across America Blackout", description: "On Tuesday, April 22, 2025, we invite you to participate in a nationwide television blackout in protest of Trump's signing of the bill to defund Planned Parenthood.", location: "Austin, TX", spotsUsed: 5, spotsTotal: 10, authorName: "Patrick Escarcega", authorRole: "Citizen Activist", topImage: imgImage17, authorAvatar: imgImage1 },
  { id: 11, category: "ART PIECE", categoryColor: "#896312", title: "Puppets for March on Washington", description: "We are making effigies of Trump and his minions for the March on Washington on July 4th. Join in even if you can't attend — we will help the attendees get them!", location: "Austin, TX", spotsUsed: 5, spotsTotal: 10, authorName: "John Smith", authorRole: "MoveOn.org", topImage: imgImage8, authorAvatar: imgImage20 },
  { id: 12, category: "FUNDING", categoryColor: "#127f05", title: "Help Fund my Elon Mural!", description: "I am making a mural to show Elon as a reincarnation of Adolf Hitler, using a real photo of Trump giving the Nazi salute! It will be in my community center's parking lot!", isOnline: true, spotsUsed: 500, spotsTotal: "Unlimited", authorName: "McKenna Hartman", authorRole: "Citizen Activist", topImage: imgImage10, authorAvatar: imgImage16 },
  { id: 13, category: "TRAINING", categoryColor: "#126d89", title: "Online ICE Rapid Response", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community has set up a rapid response network — join us.", location: "Austin, TX", spotsUsed: 5, spotsTotal: 10, authorName: "Adam Jordan", authorRole: "Catholic Legal Immigration Network", authorLink: "https://www.cliniclegal.org/", topImage: imgImage5, authorAvatar: imgImage3 },
  { id: 14, category: "FLASH MOB", categoryColor: "#ff00d5", title: "Petition the Leftist Billionaires", description: "We need electronic billboards that show the daily price of eggs/gas since Trump took office. Another to show the Trump deficit versus Elon Musk's wealth. Another to show...", typeTag: "FLASH MOB", spotsUsed: 500, spotsTotal: "Unlimited", authorName: "Nancie Kosnoff", authorRole: "Citizen Activist", topImage: imgImage15, authorAvatar: imgImage2 },
  { id: 15, category: "PETITION", categoryColor: "#05737f", title: "Stop Funding Fox", description: "MoveOn Civic Action has a long history of taking on Fox's lies. With actions taken by thousands of MoveOn members, we've been able to put pressure on cable providers.", location: "Austin, TX", spotsUsed: 500, spotsTotal: "Unlimited", authorName: "Adam Jordan", authorRole: "Catholic Legal Immigration Network", authorLink: "https://www.cliniclegal.org/", topImage: imgImage22, authorAvatar: imgImage3 },
  { id: 16, category: "PROTEST", categoryColor: "#23297e", title: "Towns Across America Blackout", description: "On Tuesday, April 22, 2025, we invite you to participate in a nationwide television blackout in protest of Trump's signing of the bill to defund Planned Parenthood.", location: "Austin, TX", spotsUsed: 500, spotsTotal: "Unlimited", authorName: "Nancie Kosnoff", authorRole: "Citizen Activist", topImage: imgImage18, authorAvatar: imgImage2 },
  { id: 17, category: "ART PIECE", categoryColor: "#896312", title: "Puppets for March on Washington", description: "We are making effigies of Trump and his minions for the March on Washington on July 4th. Join in even if you can't attend — we will help the attendees get them!", location: "Austin, TX", spotsUsed: 500, spotsTotal: "Unlimited", authorName: "Adam Jordan", authorRole: "Catholic Legal Immigration Network", authorLink: "https://www.cliniclegal.org/", topImage: imgImage9, authorAvatar: imgImage3 },
  { id: 18, category: "FUNDING", categoryColor: "#127f05", title: "Help Fund my Elon Mural!", description: "I am making a mural to show Elon as a reincarnation of Adolf Hitler, using a real photo of Trump giving the Nazi salute! It will be in my community center's parking lot!", isOnline: true, spotsUsed: 500, spotsTotal: "Unlimited", authorName: "Nancie Kosnoff", authorRole: "Citizen Activist", topImage: imgImage11, authorAvatar: imgImage2 },
];

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  // ── Card state ──
  const [cards, setCards] = useState<ActionCardData[]>([]);
  const [synced, setSynced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverOffset, setServerOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [boostedCards, setActedCards] = useState<Set<number>>(() => {
    try {
      const stored = localStorage.getItem("resistact_boosted");
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
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [actOpen, setActOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [editCardId, setEditCardId] = useState<number | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);

  // ── Live stats from server ──
  const [statsCitiesCount, setStatsCitiesCount] = useState<number | null>(null);
  const [statsUsersCount, setStatsUsersCount] = useState<number | null>(null);

  // ── Filters ──
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [activeTab, setActiveTab] = useState<"facts" | "acts">("acts");
  const [searchQuery, setSearchQuery] = useState("");

  function handleFilterChange(filterName: string, selected: string[]) {
    setActiveFilters((prev) => ({ ...prev, [filterName]: selected }));
  }

  function handleTabChange(tab: "facts" | "acts") {
    setActiveTab(tab);
    setActiveFilters({});
    setSearchQuery("");
  }

  // ── Apply filters client-side ──
  const INTEREST_MAP: Record<string, string[]> = {
    "Art & Creativity": ["ART PIECE", "CRAFTING"],
    "Social Media": ["SOCIAL MEDIA", "BOOST"],
    "Advocacy & Legal": ["PETITION", "TRAINING"],
    "Street Action": ["FLASH MOB", "PROTEST"],
    "Fundraising": ["FUNDING"],
  };

  function applyFilters(allCards: ActionCardData[]): ActionCardData[] {
    return allCards.filter((card) => {
      // Category
      const cats = activeFilters["Category"] ?? [];
      if (cats.length > 0 && !cats.includes(card.category)) return false;

      // Type
      const types = activeFilters["Type"] ?? [];
      if (types.length > 0) {
        const cardType = card.actionType ?? (card.isOnline ? "Online" : "In Person");
        if (!types.includes(cardType)) return false;
      }

      // Location
      const locs = activeFilters["Location"] ?? [];
      if (locs.length > 0) {
        const matchesOnline = locs.includes("Online Only") && card.isOnline;
        const matchesLoc = card.location && locs.includes(card.location);
        if (!matchesOnline && !matchesLoc) return false;
      }

      // My Interests — maps interest labels to categories
      const interests = activeFilters["My Interests"] ?? [];
      if (interests.length > 0) {
        const validCats = interests.flatMap((i) => INTEREST_MAP[i] ?? []);
        if (!validCats.includes(card.category)) return false;
      }

      return true;
    });
  }

  const displayedCards = applyFilters(cards).sort((a, b) => b.spotsUsed - a.spotsUsed);

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
      } else {
        setAccessToken(null);
        setApproval(null);
        setIsDemoMode(false);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

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

  function handleDemoLogin(ellenApproval: UserApproval, fakeToken: string) {
    setApproval(ellenApproval);
    setAccessToken(fakeToken);
    setIsDemoMode(true);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setApproval(null);
    setAccessToken(null);
    setIsDemoMode(false);
  }

  // ── Sync cards from Supabase ──
  const PAGE_SIZE = 20;

  useEffect(() => {
    async function syncCards() {
      try {
        const res = await fetch(`${API}/actions?limit=${PAGE_SIZE}&offset=0`, { headers: HEADERS });
        if (!res.ok) {
          const text = await res.text();
          console.error(`Failed to sync cards from server (${res.status}): ${text}`);
          setCards(STATIC_CARDS);
          setLoading(false);
          return;
        }
        const data = await res.json();
        if (data.cards && data.cards.length > 0) {
          setCards((data.cards as ServerCard[]).map(resolveCard));
          setServerTotal(data.total ?? data.cards.length);
          setServerOffset(data.cards.length);
          setSynced(true);
        } else {
          setCards(STATIC_CARDS);
        }
      } catch (err) {
        console.error("Network error syncing cards:", err);
        setCards(STATIC_CARDS);
      } finally {
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

  // ── Load more ──
  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await fetch(`${API}/actions?limit=${PAGE_SIZE}&offset=${serverOffset}`, { headers: HEADERS });
      if (!res.ok) { console.error("Load more failed:", await res.text()); return; }
      const data = await res.json();
      if (data.cards?.length > 0) {
        setCards((prev) => [...prev, ...(data.cards as ServerCard[]).map(resolveCard)]);
        setServerTotal(data.total ?? serverTotal);
        setServerOffset((prev) => prev + data.cards.length);
      }
    } catch (err) {
      console.error("Network error loading more:", err);
    } finally {
      setLoadingMore(false);
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
      prev.map((c) => c.id === id ? { ...c, spotsUsed: Math.max(0, c.spotsUsed + delta) } : c)
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
          prev.map((c) => (c.id === id ? { ...resolveCard(updated), spotsUsed: updated.spotsUsed } : c))
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
    const newCard: ActionCardData = { ...raw, topImage: undefined, authorAvatar: undefined };
    setCards((prev) => [...prev, newCard]);
    setServerTotal((prev) => prev + 1);
    setServerOffset((prev) => prev + 1);
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
  }

  return (
    <div className="min-h-screen bg-gray-50 font-['Poppins',sans-serif]">
      {/* Demo mode banner */}
      {isDemoMode && (
        <div className="bg-amber-400 text-amber-900 text-center py-1.5 px-4 font-['Poppins',sans-serif] text-xs font-semibold flex items-center justify-center gap-2">
          <span>⚠️ DEMO MODE — Simulated as Ellen Escarcega (Admin). API writes are disabled.</span>
          <button
            onClick={handleLogout}
            className="underline hover:no-underline ml-2 font-bold"
          >
            Exit demo
          </button>
        </div>
      )}
      <Navbar
        approval={approval}
        onLoginClick={() => setAuthModalOpen(true)}
        onLogout={handleLogout}
        onAdminClick={() => setAdminPanelOpen(true)}
        onInfoClick={() => setInfoOpen(true)}
        onActClick={() => setActOpen(true)}
        onAskClick={() => setAskOpen(true)}
        statsActsCount={synced && serverTotal > 0 ? serverTotal : cards.length}
        statsResistorsCount={statsUsersCount}
        statsCitiesCount={statsCitiesCount}
        statsSynced={synced}
        activeFilters={activeFilters}
        onFilterChange={handleFilterChange}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />

      <main className="px-4 md:px-8 py-8">
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
              <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {Array.from({ length: 10 }).map((_, i) => <CardSkeleton key={i} />)}
              </div>
            ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {displayedCards.map((card) => (
                <ActionCard
                  key={card.id}
                  card={card.isFeatured ? { ...card, featuredIllustration: <FeaturedIllustration /> } : card}
                  onBoost={handleBoost}
                  onShare={handleShare}
                  onBookmark={handleBookmark}
                  onEdit={(id) => setEditCardId(id)}
                  isBoosted={boostedCards.has(card.id)}
                  isBookmarked={bookmarkedCards.has(card.id)}
                  canEdit={canEditCard(card)}
                />
              ))}
            </div>
            )}

            {/* Load more — only shown when the server has more cards than we've fetched */}
            {synced && serverOffset < serverTotal && (
              <div className="mt-12 flex flex-col items-center gap-2">
                <button
                  onClick={handleLoadMore}
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
                  Showing {cards.length} of {serverTotal} campaigns
                </p>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-12 border-t border-gray-200 py-8 px-8 text-center">
        <p className="font-['Poppins',sans-serif] text-sm text-gray-400">
          © 2025 ResistAct · Building grassroots resistance, one act at a time.
        </p>
      </footer>

      {/* Auth Modal */}
      {authModalOpen && (
        <AuthModal
          onClose={() => setAuthModalOpen(false)}
          onApproval={(a) => setApproval(a)}
          onDemoLogin={handleDemoLogin}
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
            onClose={() => setEditCardId(null)}
            onSaved={(updated) => { handleCardSaved(updated); }}
          />
        ) : null;
      })()}
    </div>
  );
}