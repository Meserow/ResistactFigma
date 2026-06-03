import logoImg from "../../assets/resistact-logo-horizontal.webp";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import type { ReactNode } from "react";
import { FACT_CARDS } from "../data/factCards";
import { Bell, Heart, ChevronDown, Clock, Flag, Flame, Globe, Info, Loader2, LogOut, MapPin, Megaphone, Menu, MessageCircle, MessageSquare, Search, ShieldCheck, SlidersHorizontal, Sparkles, Tag, X, Zap } from "lucide-react";
import type { UserApproval } from "../lib/supabase";
import { TierProgress } from "./TierProgress";
import { getUserTier } from "../lib/tiers";
import { UserAvatar } from "./UserAvatar";
import { colorForCategory, iconForCategory } from "../lib/categoryGroups";

function ResistActLogo() {
  return (
    <img src={logoImg} alt="ResistAct — Citizen Action" className="h-11 md:h-[52px] w-auto object-contain" />
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
  isSearchPending?: boolean;
  activeTab: "facts" | "acts" | "receipts";
  onTabChange: (tab: "facts" | "acts" | "receipts") => void;
  /** Render between the top bar and the filter row (e.g. the homepage hero). */
  heroSlot?: ReactNode;
  /** True when a collapsing hero is present (Acts tab). Drives the left-logo
      cross-fade: hidden at the top of the page, fades in as the hero collapses. */
  hasHero?: boolean;
  /** Quick-actions toggle: when true, only show 5–10 min "quick win" cards. */
  quickActionsOnly?: boolean;
  onQuickActionsChange?: (v: boolean) => void;
  textingOnly?: boolean;
  onTextingChange?: (v: boolean) => void;
  sortBy?: "popular" | "newest" | "az";
  onSortChange?: (sort: "popular" | "newest" | "az") => void;
  onBookmarksClick?: () => void;
  bookmarkCount?: number;
  onFeedbackClick?: () => void;
  onMatchClick?: () => void;
  /** "Add an Act!" — opens the Ask/Add-an-Act flow (mirrors the hero pill). */
  onAskClick?: () => void;
  onPendingSmacksClick?: () => void;
  onPendingActsClick?: () => void;
  onFlaggedActsClick?: () => void;
  pendingActsCount?: number;
  pendingSmacksCount?: number;
  flagsCount?: number;
  onTierClick?: () => void;
  pendingUsersCount?: number;
  // ── Smacks filter / sort, surfaced in the navbar's filter bar so chips and
  //   sort sit on one row with the stats counts (instead of a second row
  //   below the "What's a Smack" intro card). ──
  smacksAvailableTags?: string[];
  smacksActiveTags?: string[];
  onSmacksTagToggle?: (tag: string) => void;
  onSmacksTagsClear?: () => void;
  smacksSortBy?: "top" | "new" | "pending";
  onSmacksSortChange?: (s: "top" | "new" | "pending") => void;
  smacksIsAdmin?: boolean;
  showDone?: boolean;
  onShowDoneChange?: (v: boolean) => void;
  completedCount?: number;
}

export function Navbar({ approval, myCompletions, onLoginClick, onLogout, onAdminClick, onInfoClick, onActClick, matchActive, onMatchClear, statsActsCount, statsSmacksCount, statsResistorsCount, statsCitiesCount, statsSynced, activeFilters, actsCategories, actsLocations, onFilterChange, searchQuery, onSearchChange, isSearchPending = false, activeTab, onTabChange, heroSlot, hasHero = false, quickActionsOnly, onQuickActionsChange, textingOnly, onTextingChange, showDone, onShowDoneChange, completedCount, sortBy = "popular", onSortChange, onBookmarksClick, bookmarkCount, onFeedbackClick, onMatchClick, onAskClick, onPendingSmacksClick, onPendingActsClick, onFlaggedActsClick, pendingActsCount, pendingSmacksCount, flagsCount = 0, pendingUsersCount = 0, onTierClick, smacksAvailableTags, smacksActiveTags, onSmacksTagToggle, onSmacksTagsClear, smacksSortBy, onSmacksSortChange, smacksIsAdmin }: NavbarProps & { activeTab: "facts" | "acts" | "receipts"; onTabChange: (tab: "facts" | "acts" | "receipts") => void }) {
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
  const mobileFilterBarRef = useRef<HTMLDivElement>(null);
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

  // Close filter dropdowns when clicking outside. The desktop and mobile filter
  // bars are separate DOM trees (one is hidden by media query), so we have to
  // check both — otherwise tapping inside the mobile bar registers as "outside"
  // the desktop ref and closes the panel before it can open.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const inDesktop = filterBarRef.current?.contains(target);
      const inMobile = mobileFilterBarRef.current?.contains(target);
      if (!inDesktop && !inMobile) {
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
  const totalActiveAll = totalActiveFilters + (hasActiveSearch ? 1 : 0) + (quickActionsOnly ? 1 : 0) + (textingOnly ? 1 : 0);

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
  const actsCategoryOpen = openFilter === "Category";
  // The "Texting" filter is a special toggle (matches by title-regex AND the
  // real "Texting" category), surfaced in alphabetical order alongside the
  // category pills rather than dangling after Remote / 5-Min. "Texting" is now
  // a real category, so it may already be in actsCats — dedupe so the pill
  // renders exactly once, then the pill map below branches on it to render the
  // toggle (not a plain category filter).
  const actsPillItems = onTextingChange
    ? Array.from(new Set([...actsCats, "Texting"])).sort()
    : actsCats;
  const locOptions = actsLocations ?? [];
  const locSelected = activeFilters["Location"] ?? [];
  const locOpen = openFilter === "Location";
  // Selected states (excludes the "Remote" token, which has its own pill).
  const locStates = locSelected.filter((l) => l !== "Remote");
  // What the navy Location pill reads: the state name when exactly one is
  // picked, otherwise just "Location" (with a count badge for 2+).
  const locLabel = locStates.length === 1 ? locStates[0] : "Location";
  // Checked states float to the top of the dropdown. Stable sort keeps each
  // group alphabetical since locOptions is already alpha-sorted.
  const locOptionsOrdered = [...locOptions].sort(
    (a, b) => (locSelected.includes(a) ? 0 : 1) - (locSelected.includes(b) ? 0 : 1),
  );

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
    // Location: Remote is no longer a dropdown option — it has its own pill.
    // Picking a state and clicking the Remote pill compose naturally: the
    // matcher returns cards matching either ANY selected state OR (when
    // Remote is in the array) any isOnline / atHome card.
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
          <button
            onClick={onInfoClick}
            title="How does ResistAct work?"
            className="focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ed6624] rounded-md"
          >
            <ResistActLogo />
          </button>
          {/* Margaret Mead quote moved into the "How does ResistAct work?"
              InfoModal and the "Join the Resistance" AuthModal so the
              top nav stays cleaner. */}
        </div>

        {/* ── Tab switcher: The Acts / The Facts / The Smacks ── */}
        <div className="hidden md:flex items-center shrink-0 bg-gray-100 rounded-2xl p-1.5 gap-1">
          <button
            onClick={() => onTabChange("acts")}
            className={`px-3 py-2.5 rounded-xl font-['Poppins',sans-serif] font-bold text-sm transition-all whitespace-nowrap ${
              activeTab === "acts"
                ? "bg-white text-[#ed6624] shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            The Acts
          </button>
          <button
            onClick={() => onTabChange("facts")}
            className={`px-3 py-2.5 rounded-xl font-['Poppins',sans-serif] font-bold text-sm transition-all whitespace-nowrap ${
              activeTab === "facts"
                ? "bg-white text-[#ed6624] shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            The Facts
          </button>
          <button
            onClick={() => onTabChange("receipts")}
            className={`px-3 py-2.5 rounded-xl font-['Poppins',sans-serif] font-bold text-sm transition-all whitespace-nowrap ${
              activeTab === "receipts"
                ? "bg-white text-[#ed6624] shadow-sm"
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
            {isSearchPending
              ? <Loader2 className="absolute left-4 top-1/2 -translate-y-1/2 text-[#23297e] animate-spin" size={18} />
              : <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            }
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={activeTab === "facts" ? "Search facts by topic or claim…" : activeTab === "receipts" ? "Search The Smacks…" : "Search Resistance Acts…"}
              className="w-full pl-11 pr-4 py-2.5 bg-white border border-gray-300 rounded-xl font-['Poppins',sans-serif] text-base text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#23297e] focus:border-transparent"
            />
          </div>

        </div>

        {/* ── Scroll-revealed action cluster — takes over the hero pills' role
            once the hero collapses on scroll (Acts tab only). Hidden while the
            hero is fully expanded; fades in via --hero-collapse. ── */}
        {hasHero && (
          <div className="scroll-reveal hidden xl:flex items-center gap-2 shrink-0">
            <button
              onClick={onInfoClick}
              title="About — what is this site about?"
              aria-label="About"
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 px-2.5 2xl:px-3 py-1.5 font-['Poppins',sans-serif] text-[13px] font-bold text-gray-600 transition-colors hover:border-[#ed6624] hover:bg-[#ed6624]/5 hover:text-[#ed6624] whitespace-nowrap group"
            >
              <Zap size={14} strokeWidth={2.5} className="text-gray-500 group-hover:text-[#ed6624]" />
              <span className="hidden 2xl:inline">About</span>
            </button>
            {onMatchClick && (
              <button
                onClick={onMatchClick}
                title="Refine Your Matches — your preferences stay saved"
                aria-label="Refine Your Matches"
                className="inline-flex items-center gap-1.5 rounded-full bg-[#ed6624] px-2.5 2xl:px-3.5 py-1.5 font-['Poppins',sans-serif] text-[13px] font-extrabold text-white shadow-sm ring-1 ring-[#ed6624] transition-all hover:bg-[#d35a1d] hover:shadow whitespace-nowrap"
              >
                <Sparkles size={15} strokeWidth={2.75} className="text-white" />
                <span className="hidden 2xl:inline">Refine Matches</span>
              </button>
            )}
            {onAskClick && (
              <button
                onClick={onAskClick}
                title="Add an Act — find people to do a great idea"
                aria-label="Add an Act"
                className="inline-flex items-center gap-1.5 rounded-full border border-[#23297e] bg-white px-2.5 2xl:px-3 py-1.5 font-['Poppins',sans-serif] text-[13px] font-bold text-[#23297e] transition-colors hover:bg-[#23297e]/5 whitespace-nowrap"
              >
                <Megaphone size={14} strokeWidth={2.5} className="text-[#23297e]" />
                <span className="hidden 2xl:inline">Add an Act</span>
              </button>
            )}
          </div>
        )}

        {/* ── Auth / User section ── */}
        <div className="hidden md:flex items-center gap-3 shrink-0 ml-1">
          {isLoggedIn ? (
            <>

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
                            style={{ backgroundColor: tier?.color ?? "#ed6624" }}
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
                      ) : isAdmin ? (() => {
                        const todoCount = (pendingActsCount ?? 0) + (pendingSmacksCount ?? 0) + (pendingUsersCount ?? 0) + (flagsCount ?? 0);
                        return (
                          <span className={`font-['Poppins',sans-serif] text-xs font-semibold ${todoCount > 0 ? "text-red-600" : "text-green-600"}`}>
                            {todoCount > 0 ? `Admin To Dos: ${todoCount}` : "Admin ✓ All clear"}
                          </span>
                        );
                      })() : (
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
                      <Heart size={15} />
                      My Matches
                      {bookmarkCount != null && bookmarkCount > 0 && (
                        <span className="ml-auto bg-[#ed6624] text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
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
                    {isAdmin && !!flagsCount && (
                      <button
                        onClick={() => { setDropdownOpen(false); onFlaggedActsClick?.(); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-['Poppins',sans-serif] font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        <Flag size={15} />
                        Flagged Acts
                        <span className="ml-auto bg-red-600 text-white text-[10px] font-bold rounded-full min-w-[20px] h-5 px-1 flex items-center justify-center">
                          {flagsCount > 99 ? "99+" : flagsCount}
                        </span>
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
                  className="flex items-center gap-1.5 px-1 text-[#ed6624] hover:text-[#c2521b] transition-colors font-['Poppins',sans-serif] font-bold text-sm"
                >
                  <span aria-hidden>🔥</span>
                  {myCompletions.total > 99 ? "99+" : myCompletions.total} done
                </button>
              )}
              <button
                onClick={onLoginClick}
                className="resistact-anim-shimmer inline-flex flex-col items-start rounded-2xl bg-[#23297e] px-4 py-1.5 text-left font-['Poppins',sans-serif] text-white hover:bg-[#1a1f63] transition-colors"
              >
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold leading-tight">
                  <Flame size={14} strokeWidth={2.25} className="shrink-0" />
                  Join The Resistance
                </span>
                <span className="text-[10.5px] font-normal italic text-white/85 leading-tight mt-0.5">
                  Sign in or Create an Account...
                </span>
              </button>
            </>
          )}
          {onFeedbackClick && (
            <button
              onClick={onFeedbackClick}
              aria-label="Contact us"
              title="Contact us — questions, feedback, or report a problem"
              className="inline-flex flex-col items-center justify-center gap-0.5 px-1.5 py-1 font-['Poppins',sans-serif] text-[#ed6624] hover:text-[#c2521b] transition-colors shrink-0"
            >
              <MessageCircle size={17} fill="currentColor" strokeWidth={0} />
              <span className="text-[10px] font-bold leading-none">Contact Us</span>
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
        {/* "Filter by" label removed — the pills are self-explanatory. */}

        {/* 5 Minutes Max toggle moved INTO the Acts branch below, where it's
            stacked vertically with the Location dropdown to free horizontal
            space for the category pill row. Smacks/Facts tabs don't show it. */}

        {/* Show Done toggle moved into the Sort dropdown — see right group below.
            Keeps the filter row focused on filters; "show/hide completed" is a
            view modifier that pairs better with sort order. */}

        {activeTab === "receipts" ? (
          /* ── Smacks: tag chips + Top/New/Pending sort, rendered here in the
                navbar's filter row so they sit on a single line with the
                stats counts. SmacksPage no longer renders its own copy of
                this row — state is lifted to App and threaded through. */
          <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
            {(smacksAvailableTags ?? []).map((tag) => {
              const selected = smacksActiveTags?.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => onSmacksTagToggle?.(tag)}
                  className={`px-2.5 py-1 rounded-full font-['Poppins',sans-serif] text-xs font-medium transition-all whitespace-nowrap border ${
                    selected
                      ? "bg-[#23297e] text-white border-[#23297e]"
                      : "bg-white text-gray-600 border-gray-200 hover:border-[#23297e] hover:text-[#23297e]"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
            {smacksActiveTags && smacksActiveTags.length > 0 && (
              <button
                onClick={onSmacksTagsClear}
                className="px-3 py-1 rounded-full text-xs font-['Poppins',sans-serif] text-gray-500 hover:text-gray-700 border border-dashed border-gray-300 hover:border-gray-400 transition-all"
              >
                Clear
              </button>
            )}
            {/* Smacks sort — Top / New / Pending(admin). Renders inline so the
                chips and the sort live in the same flex row. */}
            <div className="ml-auto flex items-center gap-1 p-1 rounded-xl bg-gray-100 shrink-0">
              <button
                onClick={() => onSmacksSortChange?.("top")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-['Poppins',sans-serif] font-bold text-xs transition-all ${
                  smacksSortBy === "top"
                    ? "bg-white text-[#ed6624] shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <Flame size={12} />
                Top
              </button>
              <button
                onClick={() => onSmacksSortChange?.("new")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-['Poppins',sans-serif] font-bold text-xs transition-all ${
                  smacksSortBy === "new"
                    ? "bg-white text-[#23297e] shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                New
              </button>
              {smacksIsAdmin && (
                <button
                  onClick={() => onSmacksSortChange?.("pending")}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-['Poppins',sans-serif] font-bold text-xs transition-all ${
                    smacksSortBy === "pending"
                      ? "bg-white text-red-500 shadow-sm"
                      : "text-gray-500 hover:text-red-500"
                  }`}
                >
                  Pending
                </button>
              )}
            </div>
          </div>
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
                    <span className="w-4 h-4 rounded-full bg-[#ed6624] text-white text-[9px] flex items-center justify-center font-bold shrink-0">
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
          /* ── Acts: Location pill (first) + Category pills ── */
          <>
            {/* Desktop: Location dropdown leads, then every category as a
                pill that wraps to as many rows as needed. Location matches
                the category-pill styling exactly so it reads as one
                continuous filter row — but it opens a dropdown instead of
                being a simple toggle. "Where can I act?" is the most
                useful first cut at the feed, so it sits at the front. */}
            <div className="hidden sm:flex flex-1 min-w-0 flex-wrap items-center gap-y-1.5 gap-x-1">
              {/* Location pill — same chip style as the categories, but opens
                  a dropdown panel for state/region selection rather than being
                  a single-toggle. */}
              <div className="relative shrink-0">
                <button
                  onClick={() => setOpenFilter(locOpen ? null : "Location")}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full font-['Poppins',sans-serif] text-xs font-medium transition-all whitespace-nowrap border ${
                    locStates.length > 0
                      ? "bg-[#23297e] text-white border-[#23297e]"
                      : "bg-white text-gray-600 border-gray-200 hover:border-[#23297e] hover:text-[#23297e]"
                  }`}
                >
                  <MapPin size={11} className={locStates.length > 0 ? "text-white" : "text-gray-400"} />
                  {locLabel}
                  {locStates.length > 1 && (
                    <span className="ml-0.5 w-4 h-4 rounded-full bg-[#ed6624] text-white text-[9px] flex items-center justify-center font-bold shrink-0">
                      {locStates.length}
                    </span>
                  )}
                  <ChevronDown size={11} className={`transition-transform duration-150 ${locOpen ? "rotate-180" : ""}`} />
                </button>
                {locOpen && (
                  <div className="absolute top-full left-0 mt-1.5 w-56 bg-white border border-gray-100 rounded-2xl shadow-xl py-2 z-50 flex flex-col max-h-[min(28rem,80vh)]">
                    <p className="px-4 pt-1 pb-2 font-['Poppins',sans-serif] text-[10px] uppercase tracking-widest text-gray-400 font-semibold border-b border-gray-50 shrink-0">
                      Location
                    </p>
                    <div className="overflow-y-auto flex-1">
                      {locOptionsOrdered.map((option) => (
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
                    {locStates.length > 0 && (
                      <button
                        onClick={() => onFilterChange("Location", locSelected.filter((l) => l === "Remote"))}
                        className="w-full text-center text-xs text-red-400 hover:text-red-600 py-2 border-t border-gray-50 mt-1 font-['Poppins',sans-serif] font-medium transition-colors shrink-0"
                      >
                        Clear filter
                      </button>
                    )}
                  </div>
                )}
              </div>
              {/* Remote pill (2nd) — strict filter: only online/at-home acts
                  show, so every in-person card disappears. Underlying filter
                  token is "Remote" in the Location array. */}
              <button
                onClick={() => toggleFilterOption("Location", "Remote")}
                className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full font-['Poppins',sans-serif] text-xs font-medium transition-all whitespace-nowrap border ${
                  locSelected.includes("Remote")
                    ? "bg-[#ed6624] text-white border-[#ed6624]"
                    : "bg-white text-gray-600 border-gray-200 hover:border-[#ed6624] hover:text-[#ed6624]"
                }`}
                title="Show only remote actions (doable from anywhere)"
              >
                <Globe size={11} className={locSelected.includes("Remote") ? "text-white" : "text-gray-400"} />
                Remote Only
              </button>
              {/* 5 Minutes Max pill (3rd) — toggles the quickAction-only filter.
                  Clustered with Location + Remote at the front of the row. */}
              {onQuickActionsChange && (
                <button
                  onClick={() => onQuickActionsChange(!quickActionsOnly)}
                  className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full font-['Poppins',sans-serif] text-xs font-medium transition-all whitespace-nowrap border ${
                    quickActionsOnly
                      ? "bg-[#5a3e9e] text-white border-[#5a3e9e]"
                      : "bg-white text-gray-600 border-gray-200 hover:border-[#5a3e9e] hover:text-[#5a3e9e]"
                  }`}
                  title="Show only actions that take 5 minutes or less"
                >
                  <Zap size={11} className={quickActionsOnly ? "text-white" : "text-gray-400"} fill={quickActionsOnly ? "#ffffff" : "none"} />
                  5 Minutes Max
                </button>
              )}
              {/* Category pills — every category as a wrapping pill row.
                  Sits after Location → Remote → 5 Minutes Max. */}
              {actsPillItems.map((option) => {
                // Texting sentinel — render the special SMS-only toggle in its
                // alphabetical slot instead of a category filter pill.
                if (option === "Texting") {
                  return (
                    <button
                      key="__texting__"
                      onClick={() => onTextingChange?.(!textingOnly)}
                      className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full font-['Poppins',sans-serif] text-xs font-medium transition-all whitespace-nowrap border ${
                        textingOnly
                          ? "bg-[#2f6fa8] text-white border-[#2f6fa8]"
                          : "bg-white text-gray-600 border-gray-200 hover:border-[#2f6fa8] hover:text-[#2f6fa8]"
                      }`}
                      title="Show only texting / SMS actions"
                    >
                      <MessageSquare size={11} className={textingOnly ? "text-white" : "text-gray-400"} />
                      Texting
                    </button>
                  );
                }
                const selected = actsCatsSelected.includes(option);
                const catColor = colorForCategory(option);
                const CatIcon = iconForCategory(option);
                return (
                  <button
                    key={option}
                    onClick={() => toggleFilterOption("Category", option)}
                    className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full font-['Poppins',sans-serif] text-xs font-medium transition-all whitespace-nowrap border ${
                      selected
                        ? "text-white"
                        : "bg-white text-gray-600 border-gray-200 hover:border-[#23297e] hover:text-[#23297e]"
                    }`}
                    style={selected ? { background: catColor, borderColor: catColor } : undefined}
                  >
                    <CatIcon size={11} className={selected ? "text-white" : "text-gray-400"} />
                    {option}
                  </button>
                );
              })}
              {/* Texting pill now renders inline in its alphabetical slot among
                  the category pills above (see the actsPillItems map). */}
              {/* Clear all — appended to the chip row so it doesn't claim
                  dedicated horizontal real estate on the right. Only shows
                  when at least one filter is active. */}
              {totalActiveAll > 0 && (
                <button
                  onClick={() => {
                    Object.keys(activeTab === "facts" ? FACTS_FILTER_OPTIONS : ACTS_FILTER_OPTIONS).forEach((f) => onFilterChange(f, []));
                    if (hasActiveSearch) onSearchChange("");
                    if (quickActionsOnly && onQuickActionsChange) onQuickActionsChange(false);
                    if (textingOnly && onTextingChange) onTextingChange(false);
                  }}
                  className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full font-['Poppins',sans-serif] text-xs font-semibold whitespace-nowrap text-red-400 hover:text-red-600 hover:bg-red-50 transition-all"
                >
                  <X size={11} />
                  Clear all ({totalActiveAll})
                </button>
              )}
            </div>

            {/* Mobile: dropdown (existing behavior preserved) */}
            <div className="sm:hidden relative shrink-0">
              <button
                onClick={() => setOpenFilter(openFilter === "Category" ? null : "Category")}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-['Poppins',sans-serif] font-medium transition-all whitespace-nowrap border ${
                  actsCatsSelected.length > 0
                    ? "border-[#23297e] text-[#23297e] bg-[#23297e]/5"
                    : "border-transparent text-gray-600 hover:bg-white hover:shadow-sm hover:border-gray-200"
                }`}
              >
                <SlidersHorizontal size={13} className={actsCatsSelected.length > 0 ? "text-[#23297e]" : "text-gray-400"} />
                Category
                {actsCatsSelected.length > 0 && (
                  <span className="w-4 h-4 rounded-full bg-[#ed6624] text-white text-[9px] flex items-center justify-center font-bold shrink-0">
                    {actsCatsSelected.length}
                  </span>
                )}
                <ChevronDown size={13} className={`text-[#5a5a5a] transition-transform duration-150 ${openFilter === "Category" ? "rotate-180" : ""}`} />
              </button>
              {openFilter === "Category" && (
                <div className="absolute top-full left-0 mt-1.5 w-64 bg-white border border-gray-100 rounded-2xl shadow-xl py-2 z-50 flex flex-col max-h-[min(28rem,80vh)]">
                  <p className="px-4 pt-1 pb-2 font-['Poppins',sans-serif] text-[10px] uppercase tracking-widest text-gray-400 font-semibold border-b border-gray-50 shrink-0">
                    Category
                  </p>
                  <div className="overflow-y-auto flex-1">
                    {actsCats.map((option) => {
                      const CatIcon = iconForCategory(option);
                      return (
                        <label key={option} className="flex items-center gap-2.5 px-4 py-2 cursor-pointer hover:bg-gray-50 transition-colors">
                          <input
                            type="checkbox"
                            checked={actsCatsSelected.includes(option)}
                            onChange={() => toggleFilterOption("Category", option)}
                            className="accent-[#23297e] w-3.5 h-3.5 rounded shrink-0"
                          />
                          <CatIcon size={14} className="shrink-0" style={{ color: colorForCategory(option) }} />
                          <span className="font-['Poppins',sans-serif] text-sm text-gray-700">{option}</span>
                        </label>
                      );
                    })}
                  </div>
                  {actsCatsSelected.length > 0 && (
                    <button
                      onClick={() => onFilterChange("Category", [])}
                      className="w-full text-center text-xs text-red-400 hover:text-red-600 py-2 border-t border-gray-50 mt-1 font-['Poppins',sans-serif] font-medium transition-colors shrink-0"
                    >
                      Clear filter
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        </div>{/* END LEFT GROUP */}

        {/* Right group removed — "Clear all" lives inside the chip row now. */}
      </div>

      {/* ── Mobile persistent tab + filter bar — sticks below top bar ── */}
      <div ref={mobileFilterBarRef} className="sticky z-30 md:hidden border-t border-gray-100 bg-[#f7f7f7]" style={{ top: topBarHeight }}>
        {/* Tab switcher — always visible */}
        <div className="px-4 pt-2 pb-1.5">
          <div className="flex items-center bg-gray-200 rounded-xl p-1 gap-0.5">
            <button
              onClick={() => onTabChange("acts")}
              className={`flex-1 py-2 rounded-lg font-['Poppins',sans-serif] font-bold text-xs transition-all ${
                activeTab === "acts" ? "bg-white text-[#ed6624] shadow-sm" : "text-gray-500"
              }`}
            >
              The Acts
            </button>
            <button
              onClick={() => onTabChange("facts")}
              className={`flex-1 py-2 rounded-lg font-['Poppins',sans-serif] font-bold text-xs transition-all ${
                activeTab === "facts" ? "bg-white text-[#ed6624] shadow-sm" : "text-gray-500"
              }`}
            >
              The Facts
            </button>
            <button
              onClick={() => onTabChange("receipts")}
              className={`flex-1 py-2 rounded-lg font-['Poppins',sans-serif] font-bold text-xs transition-all ${
                activeTab === "receipts" ? "bg-white text-[#ed6624] shadow-sm" : "text-gray-500"
              }`}
            >
              The Smacks
            </button>
          </div>
        </div>

        {/* Filter row — Smacks: tag chips + Top/New/Pending sort;
            Facts: single Category dropdown; Acts: scrollable dropdown buttons. */}
        {activeTab === "receipts" ? (
          /* ── Mobile Smacks filter row — horizontally-scrollable tag chips
              followed by the Top / New / Pending(admin) sort control. Mirrors
              the desktop Smacks branch but uses the same scroll-strip pattern
              as the mobile Acts row so it never overflows the viewport. The
              prior code fell through to the Acts branch here, surfacing
              Location/Category/Remote filters that don't apply to Smacks. ── */
          <div className="px-4 pb-2">
            {/* Topics live in a "Category" dropdown on phones (they used to be a
                horizontally-scrollable chip strip, which pushed most topics off
                the right edge). Mirrors the Acts / Facts mobile Category pattern. */}
            {(() => {
              const isOpen = openFilter === "smacks-cat-mobile";
              const selectedCount = smacksActiveTags?.length ?? 0;
              return (
                <div className="relative w-fit">
                  <button
                    onClick={() => setOpenFilter(isOpen ? null : "smacks-cat-mobile")}
                    className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-['Poppins',sans-serif] font-medium transition-all whitespace-nowrap border ${
                      selectedCount > 0
                        ? "bg-[#23297e] text-white border-[#23297e]"
                        : "bg-white text-gray-600 border-gray-200"
                    }`}
                  >
                    Category
                    {selectedCount > 0 && (
                      <span className="w-4 h-4 rounded-full bg-[#ed6624] text-white text-[9px] flex items-center justify-center font-bold shrink-0">
                        {selectedCount}
                      </span>
                    )}
                    <ChevronDown size={11} className={isOpen ? "rotate-180" : ""} />
                  </button>
                  {isOpen && (
                    <div className="absolute top-full left-0 mt-1.5 w-64 bg-white border border-gray-100 rounded-2xl shadow-xl py-2 z-50 max-h-80 overflow-y-auto">
                      <p className="px-4 pt-1 pb-2 font-['Poppins',sans-serif] text-[10px] uppercase tracking-widest text-gray-400 font-semibold border-b border-gray-50">
                        Category
                      </p>
                      {(smacksAvailableTags ?? []).map((tag) => (
                        <label key={tag} className="flex items-center gap-2.5 px-4 py-2 cursor-pointer hover:bg-gray-50 transition-colors">
                          <input
                            type="checkbox"
                            checked={smacksActiveTags?.includes(tag) ?? false}
                            onChange={() => onSmacksTagToggle?.(tag)}
                            className="accent-[#23297e] w-3.5 h-3.5 rounded shrink-0"
                          />
                          <span className="font-['Poppins',sans-serif] text-sm text-gray-700">{tag}</span>
                        </label>
                      ))}
                      {selectedCount > 0 && (
                        <button
                          onClick={onSmacksTagsClear}
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
            <div className="flex items-center gap-1 mt-2 p-1 rounded-xl bg-gray-100 w-fit">
              <button
                onClick={() => onSmacksSortChange?.("top")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-['Poppins',sans-serif] font-bold text-xs transition-all ${
                  smacksSortBy === "top"
                    ? "bg-white text-[#ed6624] shadow-sm"
                    : "text-gray-500"
                }`}
              >
                <Flame size={12} />
                Top
              </button>
              <button
                onClick={() => onSmacksSortChange?.("new")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-['Poppins',sans-serif] font-bold text-xs transition-all ${
                  smacksSortBy === "new"
                    ? "bg-white text-[#23297e] shadow-sm"
                    : "text-gray-500"
                }`}
              >
                New
              </button>
              {smacksIsAdmin && (
                <button
                  onClick={() => onSmacksSortChange?.("pending")}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-['Poppins',sans-serif] font-bold text-xs transition-all ${
                    smacksSortBy === "pending"
                      ? "bg-white text-red-500 shadow-sm"
                      : "text-gray-500"
                  }`}
                >
                  Pending
                </button>
              )}
            </div>
          </div>
        ) : activeTab === "facts" ? (
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
                      <span className="w-4 h-4 rounded-full bg-[#ed6624] text-white text-[9px] flex items-center justify-center font-bold shrink-0">
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
          /* ── Mobile Acts filter row — Location dropdown + Category
              dropdown + Remote Only + 5 Min Max toggles. Location leads
              because "where can I act?" is most users' first cut at the
              feed; Category is the second-pass narrow-down.

              The chip strip is horizontally scrollable (overflow-x-auto),
              which the browser converts into clipping on BOTH axes — so
              the open dropdown can't render as an absolute child of the
              strip or it gets clipped. The open panel renders as a
              full-width drawer below the strip instead. ───── */
          (() => {
            const locMobileOpen = openFilter === "acts-loc-mobile";
            const catMobileOpen = openFilter === "acts-cat-mobile";
            return (
              <div className="px-4 pb-2">
                {/* Wrap to a second row instead of scrolling sideways if the
                    pills don't fit on one line. "Remote Only" now lives inside
                    the Location dropdown (below), keeping this row short.
                    Centered on phones. */}
                <div className="flex flex-wrap justify-center gap-1.5">
                  {/* Location button */}
                  <button
                    onClick={() => setOpenFilter(locMobileOpen ? null : "acts-loc-mobile")}
                    className={`shrink-0 flex items-center gap-1 px-3 py-1 rounded-full text-xs font-['Poppins',sans-serif] font-medium transition-all whitespace-nowrap border ${
                      locSelected.length > 0
                        ? "bg-[#23297e] text-white border-[#23297e]"
                        : "bg-white text-gray-600 border-gray-200"
                    }`}
                  >
                    {/* "Remote only" takes over the label whenever it's on — the
                        user cares more about knowing they're on Remote than which
                        state they picked. The state stays selected; if any states
                        are also chosen we still show their count as a badge. */}
                    {locSelected.includes("Remote") ? <Globe size={11} /> : <MapPin size={11} />}
                    {locSelected.includes("Remote") ? "Remote" : locLabel}
                    {locStates.length > (locSelected.includes("Remote") ? 0 : 1) && (
                      <span className="w-4 h-4 rounded-full bg-[#ed6624] text-white text-[9px] flex items-center justify-center font-bold shrink-0">
                        {locStates.length}
                      </span>
                    )}
                    <ChevronDown size={11} className={locMobileOpen ? "rotate-180" : ""} />
                  </button>

                  {/* Category button — "5 Min Max" now lives inside this
                      dropdown on phones (see the Category drawer below) to
                      keep the filter row short. */}
                  <button
                    onClick={() => setOpenFilter(catMobileOpen ? null : "acts-cat-mobile")}
                    className={`shrink-0 flex items-center gap-1 px-3 py-1 rounded-full text-xs font-['Poppins',sans-serif] font-medium transition-all whitespace-nowrap border ${
                      actsCatsSelected.length > 0
                        ? "bg-[#23297e] text-white border-[#23297e]"
                        : "bg-white text-gray-600 border-gray-200"
                    }`}
                  >
                    Category
                    {actsCatsSelected.length > 0 && (
                      <span className="w-4 h-4 rounded-full bg-[#ed6624] text-white text-[9px] flex items-center justify-center font-bold shrink-0">
                        {actsCatsSelected.length}
                      </span>
                    )}
                    <ChevronDown size={11} className={catMobileOpen ? "rotate-180" : ""} />
                    {/* "Texting" and "5 Min Max" live inside this dropdown on
                        phones (see the Category drawer below) to save horizontal
                        room — show a dot on the button when either is the active
                        filter and no categories are chosen. */}
                    {(textingOnly || quickActionsOnly) && actsCatsSelected.length === 0 && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#ed6624] shrink-0" />
                    )}
                  </button>
                </div>

                {/* Location drawer */}
                {locMobileOpen && (
                  <div className="mt-2 bg-white border border-gray-100 rounded-2xl shadow-xl py-2 max-h-80 overflow-y-auto">
                    {/* "Remote only" — moved in here from its own pill on phones
                        to keep the filter row short. It's the "doable from
                        anywhere" cut, so it leads, separated from the place list. */}
                    <label className="flex items-center gap-2.5 px-4 py-2 cursor-pointer hover:bg-gray-50 transition-colors border-b border-gray-100">
                      <input
                        type="checkbox"
                        checked={locSelected.includes("Remote")}
                        onChange={() => toggleFilterOption("Location", "Remote")}
                        className="accent-[#ed6624] w-3.5 h-3.5 rounded shrink-0"
                      />
                      <Globe size={14} className="shrink-0 text-[#ed6624]" />
                      <span className="font-['Poppins',sans-serif] text-sm text-gray-700">Remote only</span>
                    </label>
                    {locOptionsOrdered.map((option) => (
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
                    {locSelected.length > 0 && (
                      <button
                        onClick={() => onFilterChange("Location", [])}
                        className="w-full text-center text-xs text-red-400 hover:text-red-600 py-2 border-t border-gray-50 mt-1 font-['Poppins',sans-serif] font-medium transition-colors"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                )}

                {/* Category drawer */}
                {catMobileOpen && (
                  <div className="mt-2 bg-white border border-gray-100 rounded-2xl shadow-xl py-2 max-h-80 overflow-y-auto">
                    {/* "5 Min Max" — moved in here from its own pill on phones
                        to keep the filter row short. It's a quick cross-cutting
                        cut (not a category), so it leads, separated from the
                        category list — mirroring "Remote only" in Location. */}
                    {onQuickActionsChange && (
                      <label className="flex items-center gap-2.5 px-4 py-2 cursor-pointer hover:bg-gray-50 transition-colors border-b border-gray-100">
                        <input
                          type="checkbox"
                          checked={quickActionsOnly}
                          onChange={() => onQuickActionsChange(!quickActionsOnly)}
                          className="accent-[#5a3e9e] w-3.5 h-3.5 rounded shrink-0"
                        />
                        <Zap size={14} className="shrink-0 text-[#5a3e9e]" fill={quickActionsOnly ? "#5a3e9e" : "none"} />
                        <span className="font-['Poppins',sans-serif] text-sm text-gray-700">5 Min Max</span>
                      </label>
                    )}
                    <p className="px-4 pt-1 pb-2 font-['Poppins',sans-serif] text-[10px] uppercase tracking-widest text-gray-400 font-semibold border-b border-gray-50">
                      Category
                    </p>
                    {/* actsPillItems = categories + the "Texting" sentinel, deduped
                        and alpha-sorted (same list the desktop pills use), so the
                        Texting/SMS toggle lands in its alphabetical slot rather
                        than pinned at the top. */}
                    {actsPillItems.map((option) => {
                      if (option === "Texting") {
                        return (
                          <label key="__texting__" className="flex items-center gap-2.5 px-4 py-2 cursor-pointer hover:bg-gray-50 transition-colors">
                            <input
                              type="checkbox"
                              checked={textingOnly}
                              onChange={() => onTextingChange?.(!textingOnly)}
                              className="accent-[#2f6fa8] w-3.5 h-3.5 rounded shrink-0"
                            />
                            <MessageSquare size={14} className="shrink-0 text-[#2f6fa8]" />
                            <span className="font-['Poppins',sans-serif] text-sm text-gray-700">Texting / SMS only</span>
                          </label>
                        );
                      }
                      const CatIcon = iconForCategory(option);
                      return (
                        <label key={option} className="flex items-center gap-2.5 px-4 py-2 cursor-pointer hover:bg-gray-50 transition-colors">
                          <input
                            type="checkbox"
                            checked={actsCatsSelected.includes(option)}
                            onChange={() => toggleFilterOption("Category", option)}
                            className="accent-[#23297e] w-3.5 h-3.5 rounded shrink-0"
                          />
                          <CatIcon size={14} className="shrink-0" style={{ color: colorForCategory(option) }} />
                          <span className="font-['Poppins',sans-serif] text-sm text-gray-700">{option}</span>
                        </label>
                      );
                    })}
                    {actsCatsSelected.length > 0 && (
                      <button
                        onClick={() => onFilterChange("Category", [])}
                        className="w-full text-center text-xs text-red-400 hover:text-red-600 py-2 border-t border-gray-50 mt-1 font-['Poppins',sans-serif] font-medium transition-colors"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })()
        )}
      </div>

      {/* Mobile dropdown — overlays the page (dims the content) instead of
          pushing it down. The backdrop starts just below the sticky top bar
          so the hamburger/X toggle stays tappable; tapping the backdrop
          closes the menu. The panel itself scrolls if it ever outgrows the
          available height. */}
      {mobileMenuOpen && (
        <>
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50"
          style={{ top: topBarHeight }}
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
        <div
          className="md:hidden fixed inset-x-0 z-50 bg-white rounded-b-2xl shadow-2xl overflow-y-auto"
          style={{ top: topBarHeight, maxHeight: `calc(100dvh - ${topBarHeight}px)` }}
        >
          {/* Header — a clear "Menu" label + close so it's obvious you've opened
              a menu, not just more page chrome. */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
            <span className="font-['Poppins',sans-serif] text-[12px] font-bold uppercase tracking-[0.18em] text-gray-400">
              Menu
            </span>
            <button
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close menu"
              className="-mr-1 p-1 text-gray-400 hover:text-gray-700 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Identity row — signed-in user, or the one highlighted "Join" badge. */}
          {isLoggedIn ? (
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                {(() => {
                  const ti = myCompletions ? getUserTier(myCompletions.total) : null;
                  return (
                    <UserAvatar
                      name={approval?.name ?? ""}
                      avatar={approval?.avatar}
                      className=""
                      progressPct={ti?.progressPct}
                      ringColor={ti?.tier.color ?? "#ed6624"}
                      ringSizePx={40}
                    />
                  );
                })()}
                <div className="min-w-0">
                  <p className="font-['Poppins',sans-serif] font-semibold text-base truncate">{approval?.name}</p>
                  <p className="font-['Poppins',sans-serif] text-gray-400 text-sm truncate">{approval?.email}</p>
                </div>
              </div>
              <button onClick={onLogout} aria-label="Sign out" className="text-gray-400 hover:text-red-500 transition-colors shrink-0">
                <LogOut size={18} />
              </button>
            </div>
          ) : (
            <div className="px-5 py-4 border-b border-gray-100">
              <button
                onClick={() => { setMobileMenuOpen(false); onLoginClick(); }}
                className="resistact-anim-shimmer w-full flex flex-col items-center py-2.5 rounded-2xl bg-[#23297e] text-white font-['Poppins',sans-serif] hover:bg-[#1a1f63] transition-colors"
              >
                <span className="inline-flex items-center gap-1.5 text-sm font-bold leading-tight">
                  <Flame size={14} strokeWidth={2.25} />
                  Join The Resistance
                </span>
                <span className="text-[10.5px] font-normal italic text-white/85 leading-tight mt-0.5">
                  Sign in or Create an Account...
                </span>
              </button>
            </div>
          )}

          {/* Everything else — plain text rows, separated by hairlines so the
              menu reads as a list, not a stack of buttons. */}
          <div className="divide-y divide-gray-100 py-1">
            {onAskClick && (
              <button
                onClick={() => { setMobileMenuOpen(false); onAskClick(); }}
                className="w-full flex items-center gap-3 px-5 py-3 text-left font-['Poppins',sans-serif] text-[15px] text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Megaphone size={18} className="shrink-0 text-gray-400" />
                Add an Act!
              </button>
            )}
            {/* My Saved Matches — only when there are saves. */}
            {onBookmarksClick && bookmarkCount != null && bookmarkCount > 0 && (
              <button
                onClick={() => { setMobileMenuOpen(false); onBookmarksClick(); }}
                className="w-full flex items-center gap-3 px-5 py-3 text-left font-['Poppins',sans-serif] text-[15px] text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Heart size={18} className="shrink-0 text-gray-400" />
                My Saved Matches
                <span className="ml-auto bg-[#ed6624] text-white text-[10px] font-bold rounded-full min-w-5 h-5 px-1 flex items-center justify-center">
                  {bookmarkCount > 99 ? "99+" : bookmarkCount}
                </span>
              </button>
            )}
            {onMatchClick && (
              <button
                onClick={() => { setMobileMenuOpen(false); onMatchClick(); }}
                className="w-full flex items-center gap-3 px-5 py-3 text-left font-['Poppins',sans-serif] text-[15px] text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Sparkles size={18} className="shrink-0 text-gray-400" />
                My Act Preferences
              </button>
            )}
            {onFeedbackClick && (
              <button
                onClick={() => { setMobileMenuOpen(false); onFeedbackClick(); }}
                className="w-full flex items-center gap-3 px-5 py-3 text-left font-['Poppins',sans-serif] text-[15px] text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <MessageCircle size={18} className="shrink-0 text-gray-400" />
                Share Feedback
              </button>
            )}
            <button
              onClick={() => { setMobileMenuOpen(false); onInfoClick(); }}
              className="w-full flex items-center gap-3 px-5 py-3 text-left font-['Poppins',sans-serif] text-[15px] text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Info size={18} className="shrink-0 text-gray-400" />
              About ResistAct
            </button>
            {isLoggedIn && isAdmin && (
              <button
                onClick={() => { setMobileMenuOpen(false); onAdminClick(); }}
                className="w-full flex items-center gap-3 px-5 py-3 text-left font-['Poppins',sans-serif] text-[15px] text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <ShieldCheck size={18} className="shrink-0 text-gray-400" />
                Admin Panel
                {pendingUsersCount > 0 && (
                  <span className="ml-auto text-[10px] font-bold bg-amber-500 text-white rounded-full px-1.5 py-0.5 leading-none">
                    {pendingUsersCount}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>
        </>
      )}
    </>
  );
}