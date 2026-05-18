import logoImg from "../../assets/6f09d83b1b948a5a0a2a9e7558c073db252c1f59.png";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import type { ReactNode } from "react";
import { FACT_CARDS } from "../data/factCards";
import { Bell, Bookmark, ChevronDown, Clock, Flame, Info, LogOut, MapPin, Menu, MessageCircle, Search, ShieldCheck, SlidersHorizontal, Sparkles, X, Zap } from "lucide-react";
import type { UserApproval } from "../lib/supabase";
import { TierProgress } from "./TierProgress";
import { getUserTier } from "../lib/tiers";
import { UserAvatar } from "./UserAvatar";

function ResistActLogo() {
  return (
    <img src={logoImg} alt="ResistAct logo" className="w-20 h-20 object-contain" />
  );
}

// ─── Filter config ────────────────────────────────────────────────────────────
// Both Acts filters (Category, Location) are dynamic — derived from the
// loaded cards in App.tsx and passed in via the `actsCategories` /
// `actsLocations` props. Category is rendered as inline pills (top N + a
// "more" overflow dropdown), Location as a single dropdown.

const FACTS_FILTER_OPTIONS: Record<string, string[]> = {
  Category: ["Economy", "Immigration", "Crime & Policing", "Elections & Democracy", "Energy & Climate", "Health & COVID", "Women & Families", "Work, Wages & Education", "Media & Institutions", "Foreign Policy & Security", "Taxes"],
};

interface NavbarProps {
  approval: UserApproval | null;
  myCompletions?: { total: number; byCategory: Record<string, number>; completedIds: number[] } | null;
  onLoginClick: () => void;
  onLogout: () => void;
  onAdminClick: () => void;
  onInfoClick: () => void;
  onActClick: () => void;
  /** True when match preferences are currently filtering the feed. */
  matchActive?: boolean;
  /** Clear active match filter. */
  onMatchClear?: () => void;
  statsActsCount?: number | null;
  statsSmacksCount?: number | null;
  statsResistorsCount?: number | null;
  statsCitiesCount?: number | null;
  statsSynced?: boolean;
  activeFilters: Record<string, string[]>;
  actsCategories?: string[];
  actsLocations?: string[];
  onFilterChange: (filterName: string, selected: string[]) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  activeTab: "facts" | "acts" | "receipts";
  onTabChange: (tab: "facts" | "acts" | "receipts") => void;
  /** Render between the top bar and the filter row (e.g. the homepage hero). */
  heroSlot?: ReactNode;
  /** Quick-actions toggle: when true, only show 5–10 min "quick win" cards. */
  quickActionsOnly?: boolean;
  onQuickActionsChange?: (v: boolean) => void;
  sortBy?: "popular" | "newest" | "az";
  onSortChange?: (sort: "popular" | "newest" | "az") => void;
  onBookmarksClick?: () => void;
  bookmarkCount?: number;
  onFeedbackClick?: () => void;
  onMatchClick?: () => void;
  onPendingSmacksClick?: () => void;
  onPendingActsClick?: () => void;
  pendingActsCount?: number;
  pendingSmacksCount?: number;
  onTierClick?: () => void;
  siteUpdating?: boolean;
  onToggleSiteUpdating?: (enabled: boolean) => void;
  pendingUsersCount?: number;
}

export function Navbar({ approval, myCompletions, onLoginClick, onLogout, onAdminClick, onInfoClick, onActClick, matchActive, onMatchClear, statsActsCount, statsSmacksCount, statsResistorsCount, statsCitiesCount, statsSynced, activeFilters, actsCategories, actsLocations, onFilterChange, searchQuery, onSearchChange, activeTab, onTabChange, heroSlot, quickActionsOnly, onQuickActionsChange, sortBy = "popular", onSortChange, onBookmarksClick, bookmarkCount, onFeedbackClick, onMatchClick, onPendingSmacksClick, onPendingActsClick, pendingActsCount, pendingSmacksCount, pendingUsersCount = 0, onTierClick, siteUpdating, onToggleSiteUpdating }: NavbarProps & { activeTab: "facts" | "acts" | "receipts"; onTabChange: (tab: "facts" | "acts" | "receipts") => void }) {
  // Acts filters in render order: Location dropdown first, Category pills second.
  // Used for "Clear all" and the mobile filter row that shows just the names.
  const ACTS_FILTER_OPTIONS: Record<string, string[]> = {
    Location: actsLocations ?? [],
    Category: actsCategories ?? [],
  };
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);
  const factsPillsRef = useRef<HTMLDivElement>(null);
  const actsPillsRef = useRef<HTMLDivElement>(null);

  // Dynamic pill limits — computed from the available container width.
  const [factsLimit, setFactsLimit] = useState(5);
  const [actsLimit, setActsLimit] = useState(5);

  // Use canvas text measurement (Poppins 500 12px = text-xs font-medium) to
  // estimate how many pills fit in the container, reserving ~80 px for the
  // "+ N more" button.
  const computeLimit = useCallback((
    containerEl: HTMLElement | null,
    categories: string[],
    setLimit: (n: number) => void,
  ) => {
    if (!containerEl || categories.length === 0) return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.font = '500 12px Poppins, ui-sans-serif, sans-serif';
    const containerWidth = containerEl.offsetWidth;
    // "+ N more" can include a 16px count badge + 12px chevron + paddings.
    // Plus we add an extra safety buffer so the trailing "Clear all" link
    // never collides with the rightmost pill, even if Poppins metrics differ
    // a hair from our canvas estimate.
    const MORE_BTN_W = 132;
    const SAFETY_BUFFER = 24;
    const PILL_H_PAD = 22;  // px-2.5 × 2 sides = 20px + 2px border
    const GAP = 4;           // gap-1
    let used = MORE_BTN_W + SAFETY_BUFFER;
    let count = 0;
    for (const cat of categories) {
      const w = Math.ceil(ctx.measureText(cat).width) + PILL_H_PAD + GAP;
      if (used + w > containerWidth) break;
      used += w;
      count++;
    }
    setLimit(Math.max(1, count));
  }, []);

  // Close user dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Close filter dropdowns when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (filterBarRef.current && !filterBarRef.current.contains(e.target as Node)) {
        setOpenFilter(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const isLoggedIn = !!approval;
  const isPending = approval?.status === "pending";
  const isApproved = approval?.status === "approved";
  const isAdmin = approval?.isAdmin === true;

  const totalActiveFilters = Object.values(activeFilters).reduce((sum, arr) => sum + arr.length, 0);
  const hasActiveSearch = searchQuery.trim().length > 0;
  const totalActiveAll = totalActiveFilters + (hasActiveSearch ? 1 : 0) + (quickActionsOnly ? 1 : 0);

  // ── Facts: distinct categories sorted alphabetically.
  //   First 5 show as inline pills; the rest go into a "More" dropdown.
  //   Anything currently selected stays visible as a pill regardless. ───────
  const factsCategoriesRanked = useMemo(() => {
    const set = new Set<string>();
    for (const f of FACT_CARDS) set.add(f.category);
    return Array.from(set).sort();
  }, []);
  const factsSelected = activeFilters["Category"] ?? [];
  const factsTopVisible = factsCategoriesRanked.slice(0, factsLimit);
  const factsOverflow = factsCategoriesRanked.slice(factsLimit);
  // If a selected category is in overflow, surface it inline alongside the top pills.
  const factsExtraVisible = factsOverflow.filter((c) => factsSelected.includes(c));
  const factsInlinePills = [...factsTopVisible, ...factsExtraVisible];
  const factsMoreOpen = openFilter === "facts-more";
  const factsMoreSelectedCount = factsOverflow.filter((c) => factsSelected.includes(c)).length;

  // ── Acts: same pattern as Facts, but the source list is `actsCategories`
  //   which App.tsx already ranks by card count (popular categories first).
  //   "More" dropdown holds the long tail. ───────────────────────────────────
  const actsCats = actsCategories ?? [];
  const actsCatsSelected = activeFilters["Category"] ?? [];
  const actsTopVisible = actsCats.slice(0, actsLimit);
  const actsOverflow = actsCats.slice(actsLimit);
  const actsExtraVisible = actsOverflow.filter((c) => actsCatsSelected.includes(c));
  const actsInlinePills = [...actsTopVisible, ...actsExtraVisible];
  const actsMoreOpen = openFilter === "acts-more";
  const actsMoreSelectedCount = actsOverflow.filter((c) => actsCatsSelected.includes(c)).length;
  const locOptions = actsLocations ?? [];
  const locSelected = activeFilters["Location"] ?? [];
  const locOpen = openFilter === "Location";

  function handleActClick() {
    if (!isLoggedIn) { onLoginClick(); return; }
    if (isPending) { return; }
    onActClick();
  }

  function toggleFilterOption(filterName: string, option: string) {
    const current = activeFilters[filterName] ?? [];
    const next = current.includes(option)
      ? current.filter((s) => s !== option)
      : [...current, option];
    onFilterChange(filterName, next);
  }

  // Wire up ResizeObservers so the pill limit recalculates whenever the
  // container resizes (window resize, sidebar open/close, etc.).
  useEffect(() => {
    const el = factsPillsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => computeLimit(el, factsCategoriesRanked, setFactsLimit));
    ro.observe(el);
    computeLimit(el, factsCategoriesRanked, setFactsLimit);
    return () => ro.disconnect();
  }, [factsCategoriesRanked, computeLimit]);

  useEffect(() => {
    const el = actsPillsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => computeLimit(el, actsCats, setActsLimit));
    ro.observe(el);
    computeLimit(el, actsCats, setActsLimit);
    return () => ro.disconnect();
  }, [actsCats, computeLimit]);

  // Measure the top bar so the filter bar can sticky-pin directly below it,
  // even though the hero (in normal flow) sits between them in the DOM.
  const topBarRef = useRef<HTMLDivElement>(null);
  const [topBarHeight, setTopBarHeight] = useState(0);
  useEffect(() => {
    const update = () => setTopBarHeight(topBarRef.current?.offsetHeight ?? 0);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <>
      {/* Top bar — sticks to top of viewport */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm px-5 md:px-8 py-3" ref={topBarRef}>
       <div className="flex items-center gap-4">
        {/* Logo + Brand */}
        <div className="flex items-center gap-3 shrink-0">
          <button onClick={onInfoClick} title="How does ResistAct work?" className="focus:outline-none focus-visible:ring-2 focus-visible:ring-[#fd8e33] rounded-full">
            <ResistActLogo />
          </button>
          <div className="hidden sm:block">
            <p className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-2xl leading-tight tracking-tight">
              ResistAct
            </p>
            <p
              onClick={onInfoClick}
              title="How does ResistAct work?"
              className="font-['Poppins',sans-serif] text-[#767574] text-[11px] leading-snug hidden lg:block max-w-[200px] italic cursor-pointer hover:text-[#23297e] transition-colors"
            >
              "Never doubt that a small group
              <br />
              of thoughtful, committed citizens can change the world. Indeed, it's the only thing that ever has."
              <span className="not-italic font-semibold block text-right">— Margaret Mead</span>
            </p>
          </div>
        </div>

        {/* ── Tab switcher: The Acts / The Facts / The Smacks ── */}
        <div className="hidden md:flex items-center shrink-0 bg-gray-100 rounded-2xl p-1.5 gap-1">
          <button
            onClick={() => onTabChange("acts")}
            className={`px-3 py-2.5 rounded-xl font-['Poppins',sans-serif] font-bold text-sm transition-all whitespace-nowrap ${
              activeTab === "acts"
                ? "bg-white text-[#fd8e33] shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            The Acts
          </button>
          <button
            onClick={() => onTabChange("facts")}
            className={`px-3 py-2.5 rounded-xl font-['Poppins',sans-serif] font-bold text-sm transition-all whitespace-nowrap ${
              activeTab === "facts"
                ? "bg-white text-[#fd8e33] shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            The Facts
          </button>
          <button
            onClick={() => onTabChange("receipts")}
            className={`px-3 py-2.5 rounded-xl font-['Poppins',sans-serif] font-bold text-sm transition-all whitespace-nowrap ${
              activeTab === "receipts"
                ? "bg-white text-[#fd8e33] shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            The Smacks
          </button>
        </div>

        {/* Search + Ask + Act + About */}
        <div className="flex-1 flex items-center gap-3 min-w-0">
          {/* Search */}
          <div className="flex-1 min-w-0 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={activeTab === "facts" ? "Search facts by topic or claim…" : activeTab === "receipts" ? "Search The Smacks…" : "Search Resistance Acts…"}
              className="w-full pl-11 pr-4 py-2.5 bg-white border border-gray-300 rounded-xl font-['Poppins',sans-serif] text-base text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#23297e] focus:border-transparent"
            />
          </div>

        </div>

        {/* ── Auth / User section ── */}
        <div className="hidden md:flex items-center gap-3 shrink-0 ml-1">
          {isLoggedIn ? (
            <>
              <Bell size={20} className="text-gray-500 cursor-pointer hover:text-[#23297e] transition-colors" />

              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setDropdownOpen(o => !o)}
                  className="flex items-center gap-2.5 cursor-pointer hover:opacity-80 transition-opacity"
                >
                  {(() => {
                    const tierInfo = myCompletions ? getUserTier(myCompletions.total) : null;
                    const tier = tierInfo?.tier;
                    return (
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="relative">
                          <div
                            className="w-9 h-9 rounded-full ring-2 ring-gray-100 flex items-center justify-center"
                            style={{ backgroundColor: tier?.color ?? "#fd8e33" }}
                            aria-label={tier ? `${tier.name} tier` : undefined}
                          >
                            {tier?.icon === "sparkles"
                              ? <Sparkles size={20} className="text-white" strokeWidth={2.5} aria-hidden="true" style={{ color: tier.iconColor }} />
                              : <Flame    size={20} strokeWidth={2.5} aria-hidden="true" style={{ color: tier?.iconColor ?? "#fff" }} />
                            }
                          </div>
                          {myCompletions && (
                            <span
                              title={`You've done ${myCompletions.total} action${myCompletions.total === 1 ? "" : "s"}`}
                              aria-label={`You've done ${myCompletions.total} action${myCompletions.total === 1 ? "" : "s"} — click to see scoreboard`}
                              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#23297e] text-white shadow ring-2 ring-white flex items-center justify-center font-['Poppins',sans-serif] font-bold text-[9px] leading-none pointer-events-none"
                            >
                              {myCompletions.total > 99 ? "99+" : myCompletions.total}
                            </span>
                          )}
                        </span>
                        {tier && (
                          <span
                            className="font-['Poppins',sans-serif] font-semibold text-[9px] leading-none tracking-wide"
                            style={{ color: tier.labelColor }}
                          >
                            {tier.name}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                  <div className="hidden lg:block text-left">
                    <p className="font-['Poppins',sans-serif] font-semibold text-[#3b3b3b] text-sm leading-tight">{approval?.name}</p>
                    <div className="flex items-center gap-1.5">
                      {isPending ? (
                        <span className="font-['Poppins',sans-serif] text-amber-500 text-xs flex items-center gap-0.5">
                          <Clock size={10} />Pending approval
                        </span>
                      ) : (
                        <span className="font-['Poppins',sans-serif] text-green-600 text-xs">✓ Approved</span>
                      )}
                    </div>
                  </div>
                  <ChevronDown size={15} className="text-[#5a5a5a]" />
                </button>

                {dropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-gray-100 rounded-2xl shadow-xl py-1.5 z-50">
                    <div className="px-4 py-2.5 border-b border-gray-50">
                      <p className="font-['Poppins',sans-serif] font-semibold text-gray-800 text-sm truncate">{approval?.name}</p>
                      <p className="font-['Poppins',sans-serif] text-gray-400 text-xs truncate">{approval?.email}</p>
                    </div>
                    {myCompletions && (
                      <TierProgress actionCount={myCompletions.total} />
                    )}
                    {myCompletions && onTierClick && (
                      <button
                        onClick={() => { setDropdownOpen(false); onTierClick(); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-['Poppins',sans-serif] font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        <Flame size={15} />
                        My Tier Dashboard
                      </button>
                    )}
                    <button
                      onClick={() => { setDropdownOpen(false); onBookmarksClick?.(); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-['Poppins',sans-serif] font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      <Bookmark size={15} />
                      My Bookmarks
                      {bookmarkCount != null && bookmarkCount > 0 && (
                        <span className="ml-auto bg-[#fd8e33] text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                          {bookmarkCount > 99 ? "99+" : bookmarkCount}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => { setDropdownOpen(false); onMatchClick?.(); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-['Poppins',sans-serif] font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      <SlidersHorizontal size={15} />
                      My Match Settings
                    </button>
                    {isAdmin && !!pendingActsCount && (
                      <button
                        onClick={() => { setDropdownOpen(false); onPendingActsClick?.(); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-['Poppins',sans-serif] font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        <ShieldCheck size={15} />
                        Pending Acts
                        <span className="ml-auto bg-red-600 text-white text-[10px] font-bold rounded-full min-w-[20px] h-5 px-1 flex items-center justify-center">
                          {pendingActsCount > 99 ? "99+" : pendingActsCount}
                        </span>
                      </button>
                    )}
                    {isAdmin && !!pendingSmacksCount && (
                      <button
                        onClick={() => { setDropdownOpen(false); onPendingSmacksClick?.(); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-['Poppins',sans-serif] font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        <ShieldCheck size={15} />
                        Pending Smacks
                        <span className="ml-auto bg-red-600 text-white text-[10px] font-bold rounded-full min-w-[20px] h-5 px-1 flex items-center justify-center">
                          {pendingSmacksCount > 99 ? "99+" : pendingSmacksCount}
                        </span>
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        onClick={() => onToggleSiteUpdating?.(!siteUpdating)}
                        className={[
                          "w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-['Poppins',sans-serif] font-medium transition-colors",
                          siteUpdating
                            ? "text-orange-600 hover:bg-orange-50"
                            : "text-gray-600 hover:bg-gray-50",
                        ].join(" ")}
                      >
                        <span className="text-base leading-none">🔧</span>
                        {siteUpdating ? "Turn off updating banner" : "Show updating banner"}
                        {siteUpdating && (
                          <span className="ml-auto text-[10px] font-bold bg-orange-500 text-white rounded-full px-1.5 py-0.5">ON</span>
                        )}
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        onClick={() => { setDropdownOpen(false); onAdminClick(); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-['Poppins',sans-serif] font-medium text-[#23297e] hover:bg-gray-50 transition-colors"
                      >
                        <ShieldCheck size={15} />
                        Admin Panel
                        {pendingUsersCount > 0 && (
                          <span className="ml-auto text-[10px] font-bold bg-amber-500 text-white rounded-full px-1.5 py-0.5 leading-none">
                            {pendingUsersCount}
                          </span>
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => { setDropdownOpen(false); onLogout(); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-['Poppins',sans-serif] font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      <LogOut size={15} />
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {myCompletions && myCompletions.total > 0 && (
                <button
                  onClick={onLoginClick}
                  title={`You've done ${myCompletions.total} action${myCompletions.total === 1 ? "" : "s"}. Sign in so we don't lose your streak.`}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#fd8e33]/10 text-[#fd8e33] hover:bg-[#fd8e33]/20 transition-colors font-['Poppins',sans-serif] font-bold text-sm"
                >
                  <span aria-hidden>🔥</span>
                  {myCompletions.total > 99 ? "99+" : myCompletions.total} done
                </button>
              )}
              <button
                onClick={onLoginClick}
                className="inline-flex flex-col items-start rounded-2xl bg-[#fd8e33] px-4 py-1.5 text-left font-['Poppins',sans-serif] text-white hover:bg-[#d96612] transition-colors whitespace-nowrap"
              >
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold leading-tight">
                  <Flame size={14} strokeWidth={2.25} className="shrink-0" />
                  #jointheresistance
                </span>
                <span className="text-[10.5px] font-normal italic text-white/85 leading-tight mt-0.5">
                  Sign in to continue — or join if you're new.
                </span>
              </button>
            </>
          )}
          {onFeedbackClick && (
            <button
              onClick={onFeedbackClick}
              aria-label="Share feedback"
              title="Share feedback"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[#23297e] text-white hover:bg-[#1a1f5e] transition-colors shrink-0"
            >
              <MessageCircle size={18} fill="currentColor" strokeWidth={0} />
            </button>
          )}
        </div>

        {/* Mobile menu toggle */}
        <button
          className="md:hidden ml-auto p-1 rounded-lg hover:bg-gray-100 transition-colors"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
       </div>
      </header>

      {/* ── Hero slot (optional) — sits between top bar and filter row ── */}
      {heroSlot}

      {/* ── Filter bar — sticks directly below the top bar ── */}
      <div
        className="sticky z-30 px-5 md:px-8 py-2 bg-[#f7f7f7] border-t border-b border-gray-100 hidden md:flex items-center gap-2"
        style={{ top: topBarHeight }}
        ref={filterBarRef}
      >
        {/* LEFT GROUP — takes all available space; pills inside adapt via ResizeObserver.
            On the Smacks tab there are no Location/Category filters; the page leads with
            an intro instead. The left group still gets a flex-1 spacer so the right group
            (Sort + counts) stays anchored to the right. */}
        <div className="flex-1 min-w-0 flex items-center gap-1">
        {activeTab !== "receipts" && (
          <span className="font-['Poppins',sans-serif] text-gray-400 text-[10px] uppercase tracking-widest font-semibold shrink-0 mr-1">Filter by</span>
        )}

        {/* Quick-actions toggle (Acts tab only) */}
        {activeTab === "acts" && onQuickActionsChange && (
          <button
            onClick={() => onQuickActionsChange(!quickActionsOnly)}
            className={`shrink-0 mr-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-['Poppins',sans-serif] font-medium transition-all whitespace-nowrap border ${
              quickActionsOnly
                ? "border-[#fd8e33] text-[#fd8e33] bg-[#fd8e33]/10"
                : "border-transparent text-gray-600 hover:bg-white hover:shadow-sm hover:border-gray-200"
            }`}
            title="Show only actions that take 5–10 minutes"
          >
            <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${quickActionsOnly ? "bg-[#fd8e33] border-[#fd8e33]" : "border-gray-300"}`}>
              {quickActionsOnly && <X size={10} className="text-white rotate-45" strokeWidth={3} />}
            </span>
            <Zap size={13} className={quickActionsOnly ? "text-[#fd8e33]" : "text-gray-400"} fill={quickActionsOnly ? "#fd8e33" : "none"} />
            Quick Actions
          </button>
        )}

        {activeTab === "receipts" ? (
          /* ── Smacks: no filters in the navbar. The SmacksPage shows its own
                tag chips + sort toggle, and the intro lives inline above. */
          null
        ) : activeTab === "facts" ? (
          /* ── Facts: top-N category pills + "More" dropdown ───────────── */
          <div ref={factsPillsRef} className="flex-1 min-w-0 flex items-center gap-1">
            <div className="flex-1 min-w-0 flex items-center gap-1 overflow-hidden">
            {factsInlinePills.map((option) => {
              const selected = factsSelected.includes(option);
              return (
                <button
                  key={option}
                  onClick={() => toggleFilterOption("Category", option)}
                  className={`px-2.5 py-1 rounded-full font-['Poppins',sans-serif] text-xs font-medium transition-all whitespace-nowrap border ${
                    selected
                      ? "bg-[#23297e] text-white border-[#23297e]"
                      : "bg-white text-gray-600 border-gray-200 hover:border-[#23297e] hover:text-[#23297e]"
                  }`}
                >
                  {option}
                </button>
              );
            })}
            </div>
            {factsOverflow.length > 0 && (
              <div className="relative shrink-0">
                <button
                  onClick={() => setOpenFilter(factsMoreOpen ? null : "facts-more")}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-['Poppins',sans-serif] font-medium whitespace-nowrap border transition-all ${
                    factsMoreSelectedCount > 0
                      ? "border-[#23297e] text-[#23297e] bg-[#23297e]/5"
                      : "border-gray-200 text-gray-600 bg-white hover:border-[#23297e] hover:text-[#23297e]"
                  }`}
                >
                  + {factsOverflow.length - factsExtraVisible.length} more
                  {factsMoreSelectedCount > 0 && (
                    <span className="w-4 h-4 rounded-full bg-[#fd8e33] text-white text-[9px] flex items-center justify-center font-bold shrink-0">
                      {factsMoreSelectedCount}
                    </span>
                  )}
                  <ChevronDown size={12} className={`text-[#5a5a5a] transition-transform duration-150 ${factsMoreOpen ? "rotate-180" : ""}`} />
                </button>
                {factsMoreOpen && (
                  <div className="absolute top-full left-0 mt-1.5 w-64 bg-white border border-gray-100 rounded-2xl shadow-xl py-2 z-50">
                    <p className="px-4 pt-1 pb-2 font-['Poppins',sans-serif] text-[10px] uppercase tracking-widest text-gray-400 font-semibold border-b border-gray-50">
                      More categories
                    </p>
                    {factsOverflow.map((option) => (
                      <label key={option} className="flex items-center gap-2.5 px-4 py-2 cursor-pointer hover:bg-gray-50 transition-colors">
                        <input
                          type="checkbox"
                          checked={factsSelected.includes(option)}
                          onChange={() => toggleFilterOption("Category", option)}
                          className="accent-[#23297e] w-3.5 h-3.5 rounded shrink-0"
                        />
                        <span className="font-['Poppins',sans-serif] text-sm text-gray-700">{option}</span>
                      </label>
                    ))}
                    {factsMoreSelectedCount > 0 && (
                      <button
                        onClick={() => onFilterChange("Category", factsSelected.filter((c) => !factsOverflow.includes(c)))}
                        className="w-full text-center text-xs text-red-400 hover:text-red-600 py-2 border-t border-gray-50 mt-1 font-['Poppins',sans-serif] font-medium transition-colors"
                      >
                        Clear these
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* ── Acts: Location dropdown + Category pills (mirrors Facts UX) ── */
          <>
            {/* Location dropdown — first */}
            <div className="relative shrink-0">
              <button
                onClick={() => setOpenFilter(locOpen ? null : "Location")}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-['Poppins',sans-serif] font-medium transition-all whitespace-nowrap border ${
                  locSelected.length > 0
                    ? "border-[#23297e] text-[#23297e] bg-[#23297e]/5"
                    : "border-transparent text-gray-600 hover:bg-white hover:shadow-sm hover:border-gray-200"
                }`}
              >
                <MapPin size={13} className={locSelected.length > 0 ? "text-[#23297e]" : "text-gray-400"} />
                Location
                {locSelected.length > 0 && (
                  <span className="w-4 h-4 rounded-full bg-[#fd8e33] text-white text-[9px] flex items-center justify-center font-bold shrink-0">
                    {locSelected.length}
                  </span>
                )}
                <ChevronDown size={13} className={`text-[#5a5a5a] transition-transform duration-150 ${locOpen ? "rotate-180" : ""}`} />
              </button>
              {locOpen && (
                <div className="absolute top-full left-0 mt-1.5 w-56 bg-white border border-gray-100 rounded-2xl shadow-xl py-2 z-50 flex flex-col max-h-[min(28rem,80vh)]">
                  <p className="px-4 pt-1 pb-2 font-['Poppins',sans-serif] text-[10px] uppercase tracking-widest text-gray-400 font-semibold border-b border-gray-50 shrink-0">
                    Location
                  </p>
                  <div className="overflow-y-auto flex-1">
                    {locOptions.map((option) => (
                      <label key={option} className="flex items-center gap-2.5 px-4 py-2 cursor-pointer hover:bg-gray-50 transition-colors">
                        <input
                          type="checkbox"
                          checked={locSelected.includes(option)}
                          onChange={() => toggleFilterOption("Location", option)}
                          className="accent-[#23297e] w-3.5 h-3.5 rounded shrink-0"
                        />
                        <span className="font-['Poppins',sans-serif] text-sm text-gray-700">{option}</span>
                      </label>
                    ))}
                  </div>
                  {locSelected.length > 0 && (
                    <button
                      onClick={() => onFilterChange("Location", [])}
                      className="w-full text-center text-xs text-red-400 hover:text-red-600 py-2 border-t border-gray-50 mt-1 font-['Poppins',sans-serif] font-medium transition-colors shrink-0"
                    >
                      Clear filter
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Category pills + "more" overflow — mirrors Facts UX */}
            <span className="font-['Poppins',sans-serif] text-gray-400 text-[10px] uppercase tracking-widest font-semibold shrink-0">Category</span>
            <div ref={actsPillsRef} className="flex-1 min-w-0 flex items-center gap-1">
            <div className="flex-1 min-w-0 flex items-center gap-1 overflow-hidden">
            {actsInlinePills.map((option) => {
              const selected = actsCatsSelected.includes(option);
              return (
                <button
                  key={option}
                  onClick={() => toggleFilterOption("Category", option)}
                  className={`px-2.5 py-1 rounded-full font-['Poppins',sans-serif] text-xs font-medium transition-all whitespace-nowrap border ${
                    selected
                      ? "bg-[#23297e] text-white border-[#23297e]"
                      : "bg-white text-gray-600 border-gray-200 hover:border-[#23297e] hover:text-[#23297e]"
                  }`}
                >
                  {option}
                </button>
              );
            })}
            </div>
            {actsOverflow.length > 0 && (
              <div className="relative shrink-0">
                <button
                  onClick={() => setOpenFilter(actsMoreOpen ? null : "acts-more")}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-['Poppins',sans-serif] font-medium whitespace-nowrap border transition-all ${
                    actsMoreSelectedCount > 0
                      ? "border-[#23297e] text-[#23297e] bg-[#23297e]/5"
                      : "border-gray-200 text-gray-600 bg-white hover:border-[#23297e] hover:text-[#23297e]"
                  }`}
                >
                  + {actsOverflow.length - actsExtraVisible.length} more
                  {actsMoreSelectedCount > 0 && (
                    <span className="w-4 h-4 rounded-full bg-[#fd8e33] text-white text-[9px] flex items-center justify-center font-bold shrink-0">
                      {actsMoreSelectedCount}
                    </span>
                  )}
                  <ChevronDown size={12} className={`text-[#5a5a5a] transition-transform duration-150 ${actsMoreOpen ? "rotate-180" : ""}`} />
                </button>
                {actsMoreOpen && (
                  <div className="absolute top-full left-0 mt-1.5 w-64 bg-white border border-gray-100 rounded-2xl shadow-xl py-2 z-50 flex flex-col max-h-[min(28rem,80vh)]">
                    <p className="px-4 pt-1 pb-2 font-['Poppins',sans-serif] text-[10px] uppercase tracking-widest text-gray-400 font-semibold border-b border-gray-50 shrink-0">
                      More categories
                    </p>
                    <div className="overflow-y-auto flex-1">
                      {actsOverflow.map((option) => (
                        <label key={option} className="flex items-center gap-2.5 px-4 py-2 cursor-pointer hover:bg-gray-50 transition-colors">
                          <input
                            type="checkbox"
                            checked={actsCatsSelected.includes(option)}
                            onChange={() => toggleFilterOption("Category", option)}
                            className="accent-[#23297e] w-3.5 h-3.5 rounded shrink-0"
                          />
                          <span className="font-['Poppins',sans-serif] text-sm text-gray-700">{option}</span>
                        </label>
                      ))}
                    </div>
                    {actsMoreSelectedCount > 0 && (
                      <button
                        onClick={() => onFilterChange("Category", actsCatsSelected.filter((c) => !actsOverflow.includes(c)))}
                        className="w-full text-center text-xs text-red-400 hover:text-red-600 py-2 border-t border-gray-50 mt-1 font-['Poppins',sans-serif] font-medium transition-colors shrink-0"
                      >
                        Clear these
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            </div>
          </>
        )}

        {/* Clear all — clears filter chips AND the search box */}
        {totalActiveAll > 0 && (
          <button
            onClick={() => {
              Object.keys(activeTab === "facts" ? FACTS_FILTER_OPTIONS : ACTS_FILTER_OPTIONS).forEach((f) => onFilterChange(f, []));
              if (hasActiveSearch) onSearchChange("");
              if (quickActionsOnly && onQuickActionsChange) onQuickActionsChange(false);
            }}
            className="shrink-0 ml-1 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-['Poppins',sans-serif] font-semibold text-red-400 hover:text-red-600 hover:bg-red-50 transition-all border border-transparent hover:border-red-100"
          >
            <X size={11} />
            Clear all ({totalActiveAll})
          </button>
        )}
        </div>{/* END LEFT GROUP */}

        {/* RIGHT GROUP — fixed width, always visible on the right */}
        <div className="shrink-0 flex items-center gap-3 pl-3 border-l border-gray-200">
          {/* Sort by dropdown */}
          {onSortChange && (
            <div className="relative">
              <button
                onClick={() => setOpenFilter(openFilter === "sort" ? null : "sort")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-['Poppins',sans-serif] font-medium transition-all whitespace-nowrap border ${
                  sortBy !== "popular"
                    ? "border-[#23297e] text-[#23297e] bg-[#23297e]/5"
                    : "border-transparent text-gray-600 hover:bg-white hover:shadow-sm hover:border-gray-200"
                }`}
              >
                <span className="text-gray-400 text-[10px] uppercase tracking-widest font-semibold">Sort</span>
                <span className="font-medium">
                  {sortBy === "popular" ? "Popular" : sortBy === "newest" ? "Newest" : "A–Z"}
                </span>
                <ChevronDown size={13} className={`text-[#5a5a5a] transition-transform duration-150 ${openFilter === "sort" ? "rotate-180" : ""}`} />
              </button>
              {openFilter === "sort" && (
                <div className="absolute top-full right-0 mt-1.5 w-40 bg-white border border-gray-100 rounded-2xl shadow-xl py-1.5 z-50">
                  {(["popular", "newest", "az"] as const).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => { onSortChange(opt); setOpenFilter(null); }}
                      className={`w-full text-left px-4 py-2 font-['Poppins',sans-serif] text-sm transition-colors flex items-center justify-between ${
                        sortBy === opt
                          ? "text-[#23297e] font-semibold bg-[#23297e]/5"
                          : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {opt === "popular" ? "Popular" : opt === "newest" ? "Newest" : "A–Z"}
                      {sortBy === opt && <span className="w-1.5 h-1.5 rounded-full bg-[#23297e]" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Stats */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-[#fd8e33]" />
              <span className="font-['Poppins',sans-serif] text-xs text-gray-500 whitespace-nowrap">
                <strong className="text-[#23297e] font-bold">{statsSynced ? statsActsCount : "—"}</strong>{" "}acts
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-[#127f05]" />
              <span className="font-['Poppins',sans-serif] text-xs text-gray-500 whitespace-nowrap">
                <strong className="text-[#127f05] font-bold">{FACT_CARDS.length}</strong>{" "}facts
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-[#23297e]" />
              <span className="font-['Poppins',sans-serif] text-xs text-gray-500 whitespace-nowrap">
                <strong className="text-[#23297e] font-bold">{statsSmacksCount ?? "—"}</strong>{" "}smacks
              </span>
            </div>
          </div>
        </div>{/* END RIGHT GROUP */}
      </div>

      {/* ── Mobile persistent tab + filter bar — sticks below top bar ── */}
      <div className="sticky z-30 md:hidden border-t border-gray-100 bg-[#f7f7f7]" style={{ top: topBarHeight }}>
        {/* Tab switcher — always visible */}
        <div className="px-4 pt-2 pb-1.5">
          <div className="flex items-center bg-gray-200 rounded-xl p-1 gap-0.5">
            <button
              onClick={() => onTabChange("acts")}
              className={`flex-1 py-2 rounded-lg font-['Poppins',sans-serif] font-bold text-xs transition-all ${
                activeTab === "acts" ? "bg-white text-[#fd8e33] shadow-sm" : "text-gray-500"
              }`}
            >
              The Acts
            </button>
            <button
              onClick={() => onTabChange("facts")}
              className={`flex-1 py-2 rounded-lg font-['Poppins',sans-serif] font-bold text-xs transition-all ${
                activeTab === "facts" ? "bg-white text-[#fd8e33] shadow-sm" : "text-gray-500"
              }`}
            >
              The Facts
            </button>
            <button
              onClick={() => onTabChange("receipts")}
              className={`flex-1 py-2 rounded-lg font-['Poppins',sans-serif] font-bold text-xs transition-all ${
                activeTab === "receipts" ? "bg-white text-[#fd8e33] shadow-sm" : "text-gray-500"
              }`}
            >
              The Smacks
            </button>
          </div>
        </div>

        {/* Filter row — single Category dropdown for Facts, scrollable dropdown buttons for Acts */}
        {activeTab === "facts" ? (
          <div className="px-4 pb-2">
            {(() => {
              const isOpen = openFilter === "facts-mobile";
              const selectedCount = factsSelected.length;
              return (
                <div className="relative">
                  <button
                    onClick={() => setOpenFilter(isOpen ? null : "facts-mobile")}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-['Poppins',sans-serif] font-medium transition-all whitespace-nowrap border ${
                      selectedCount > 0
                        ? "border-[#23297e] text-[#23297e] bg-[#23297e]/5"
                        : "border-gray-200 text-gray-600 bg-white"
                    }`}
                  >
                    Category
                    {selectedCount > 0 && (
                      <span className="w-4 h-4 rounded-full bg-[#fd8e33] text-white text-[9px] flex items-center justify-center font-bold shrink-0">
                        {selectedCount}
                      </span>
                    )}
                    <ChevronDown size={13} className={`text-[#5a5a5a] transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                  {isOpen && (
                    <div className="absolute top-full left-0 mt-1.5 w-64 bg-white border border-gray-100 rounded-2xl shadow-xl py-2 z-50 max-h-80 overflow-y-auto">
                      <p className="px-4 pt-1 pb-2 font-['Poppins',sans-serif] text-[10px] uppercase tracking-widest text-gray-400 font-semibold border-b border-gray-50">
                        Category
                      </p>
                      {factsCategoriesRanked.map((option) => (
                        <label key={option} className="flex items-center gap-2.5 px-4 py-2 cursor-pointer hover:bg-gray-50 transition-colors">
                          <input
                            type="checkbox"
                            checked={factsSelected.includes(option)}
                            onChange={() => toggleFilterOption("Category", option)}
                            className="accent-[#23297e] w-3.5 h-3.5 rounded shrink-0"
                          />
                          <span className="font-['Poppins',sans-serif] text-sm text-gray-700">{option}</span>
                        </label>
                      ))}
                      {selectedCount > 0 && (
                        <button
                          onClick={() => onFilterChange("Category", [])}
                          className="w-full text-center text-xs text-red-400 hover:text-red-600 py-2 border-t border-gray-50 mt-1 font-['Poppins',sans-serif] font-medium transition-colors"
                        >
                          Clear filter
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        ) : (
          <div className="flex gap-1.5 overflow-x-auto px-4 pb-2" style={{ scrollbarWidth: "none" }}>
            {Object.keys(ACTS_FILTER_OPTIONS).map((f) => (
              <button key={f} className="flex-none flex items-center gap-1 px-3 py-1 bg-white border border-gray-200 rounded-full text-xs font-['Poppins',sans-serif] text-gray-600 whitespace-nowrap">
                {f} <ChevronDown size={11} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Mobile dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden px-5 py-4 border-t border-gray-100 bg-white space-y-3">
          {onFeedbackClick && (
            <button
              onClick={() => { setMobileMenuOpen(false); onFeedbackClick(); }}
              className="w-full flex items-center gap-2 py-2.5 px-4 bg-[#23297e]/5 text-[#23297e] rounded-xl font-['Poppins',sans-serif] font-semibold text-sm"
            >
              <MessageCircle size={16} strokeWidth={2} />
              Share Feedback
            </button>
          )}
          <button
            onClick={() => { setMobileMenuOpen(false); onInfoClick(); }}
            className="w-full flex items-center gap-2 py-2.5 px-4 bg-gray-50 text-gray-700 rounded-xl font-['Poppins',sans-serif] font-semibold text-sm"
          >
            <Info size={16} />
            How does ResistAct work?
          </button>
          {isLoggedIn ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {(() => {
                  // XP ring around the mobile-menu avatar. Tier-colored arc
                  // fills clockwise to show progress to the next tier — visible
                  // every time the user opens the menu. Top tier (no next)
                  // gets a full-ring "100%" feel as the tier definition
                  // returns progressPct=100.
                  const ti = myCompletions ? getUserTier(myCompletions.total) : null;
                  return (
                    <UserAvatar
                      name={approval?.name ?? ""}
                      avatar={approval?.avatar}
                      className=""
                      progressPct={ti?.progressPct}
                      ringColor={ti?.tier.color ?? "#fd8e33"}
                      ringSizePx={40}
                    />
                  );
                })()}
                <div>
                  <p className="font-['Poppins',sans-serif] font-semibold text-base">{approval?.name}</p>
                  <p className="font-['Poppins',sans-serif] text-gray-400 text-sm">{approval?.email}</p>
                </div>
              </div>
              <button onClick={onLogout} className="text-gray-400 hover:text-red-500 transition-colors">
                <LogOut size={18} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setMobileMenuOpen(false); onLoginClick(); }}
              className="w-full flex flex-col items-center py-2 rounded-2xl bg-[#fd8e33] text-white font-['Poppins',sans-serif] hover:bg-[#d96612] transition-colors"
            >
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold leading-tight">
                <Flame size={14} strokeWidth={2.25} />
                #jointheresistance
              </span>
              <span className="text-[10.5px] font-normal italic text-white/85 leading-tight mt-0.5">
                Sign in to continue — or join if you're new.
              </span>
            </button>
          )}
          {isLoggedIn && (
            <button
              onClick={() => { setMobileMenuOpen(false); onMatchClick?.(); }}
              className="w-full flex items-center gap-2 py-2.5 px-4 bg-gray-50 text-gray-700 rounded-xl font-['Poppins',sans-serif] font-semibold text-sm"
            >
              <SlidersHorizontal size={16} />
              My Match Settings
            </button>
          )}
          {isLoggedIn && isAdmin && (
            <button
              onClick={() => { setMobileMenuOpen(false); onAdminClick(); }}
              className="w-full flex items-center gap-2 py-2.5 px-4 bg-[#23297e]/5 text-[#23297e] rounded-xl font-['Poppins',sans-serif] font-semibold text-sm"
            >
              <ShieldCheck size={16} />
              Admin Panel
              {pendingUsersCount > 0 && (
                <span className="ml-auto text-[10px] font-bold bg-amber-500 text-white rounded-full px-1.5 py-0.5 leading-none">
                  {pendingUsersCount}
                </span>
              )}
            </button>
          )}
        </div>
      )}
    </>
  );
}