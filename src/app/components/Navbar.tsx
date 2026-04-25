import logoImg from "../../assets/6f09d83b1b948a5a0a2a9e7558c073db252c1f59.png";
import { useState, useRef, useEffect } from "react";
import { FACT_CARDS } from "../data/factCards";
import { Bell, ChevronDown, Clock, Info, LogIn, LogOut, Menu, Plus, Search, ShieldCheck, X } from "lucide-react";
import type { UserApproval } from "../lib/supabase";

function ResistActLogo() {
  return (
    <img src={logoImg} alt="ResistAct logo" className="w-20 h-20 object-contain" />
  );
}

// ─── Filter config ────────────────────────────────────────────────────────────
// Category is dynamic — derived from actually-loaded cards in App.tsx and
// passed in via the `actsCategories` prop. Everything else stays static.
const ACTS_STATIC_FILTERS: Record<string, string[]> = {
  Type: ["Online", "In Person"],
  Location: ["Online Only", "National", "Minnesota / Twin Cities", "California", "Maryland", "Illinois", "Washington State", "Massachusetts", "Other Local"],
  "My Interests": ["Art & Creativity", "Social Media", "Advocacy & Legal", "Street Action", "Fundraising"],
};

const FACTS_FILTER_OPTIONS: Record<string, string[]> = {
  Category: ["Economy", "Immigration", "Crime & Policing", "Elections & Democracy", "Energy & Climate", "Health & COVID", "Women & Families", "Work, Wages & Education", "Media & Institutions", "Foreign Policy & Security", "Taxes"],
};

interface NavbarProps {
  approval: UserApproval | null;
  onLoginClick: () => void;
  onLogout: () => void;
  onAdminClick: () => void;
  onInfoClick: () => void;
  onActClick: () => void;
  onAskClick: () => void;
  statsActsCount?: number | null;
  statsResistorsCount?: number | null;
  statsCitiesCount?: number | null;
  statsSynced?: boolean;
  activeFilters: Record<string, string[]>;
  actsCategories?: string[];
  onFilterChange: (filterName: string, selected: string[]) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  activeTab: "facts" | "acts";
  onTabChange: (tab: "facts" | "acts") => void;
}

export function Navbar({ approval, onLoginClick, onLogout, onAdminClick, onInfoClick, onActClick, onAskClick, statsActsCount, statsResistorsCount, statsCitiesCount, statsSynced, activeFilters, actsCategories, onFilterChange, searchQuery, onSearchChange, activeTab, onTabChange }: NavbarProps) {
  // Build the full Acts filter map: dynamic Category + static rest.
  const ACTS_FILTER_OPTIONS: Record<string, string[]> = {
    Category: actsCategories ?? [],
    ...ACTS_STATIC_FILTERS,
  };
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);

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

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
      {/* Top bar */}
      <div className="px-5 md:px-8 py-3 flex items-center gap-4">
        {/* Logo + Brand */}
        <div className="flex items-center gap-3 shrink-0">
          <ResistActLogo />
          <div className="hidden sm:block">
            <p className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-2xl leading-tight tracking-tight">
              ResistAct
            </p>
            <p className="font-['Poppins',sans-serif] text-[#767574] text-[11px] leading-snug hidden lg:block max-w-[200px] italic">
              "Never doubt that a small group of thoughtful, committed citizens can change the world."
              <span className="not-italic font-semibold block">— Margaret Mead</span>
            </p>
          </div>
        </div>

        {/* ── Tab switcher: The Facts / The Acts ── */}
        <div className="hidden sm:flex items-center shrink-0 bg-gray-100 rounded-2xl p-1.5 gap-1">
          <button
            onClick={() => onTabChange("acts")}
            className={`px-5 py-3 rounded-xl font-['Poppins',sans-serif] font-bold text-base transition-all whitespace-nowrap ${
              activeTab === "acts"
                ? "bg-white text-[#fd8e33] shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            The Acts
          </button>
          <button
            onClick={() => onTabChange("facts")}
            className={`px-5 py-3 rounded-xl font-['Poppins',sans-serif] font-bold text-base transition-all whitespace-nowrap ${
              activeTab === "facts"
                ? "bg-white text-[#fd8e33] shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            The Facts
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
              placeholder={activeTab === "facts" ? "Search facts by topic or claim…" : "Search Resistance Acts…"}
              className="w-full pl-11 pr-4 py-2.5 bg-white border border-gray-300 rounded-xl font-['Poppins',sans-serif] text-base text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#23297e] focus:border-transparent"
            />
          </div>

          {/* Ask Button */}
          <button
            onClick={onAskClick}
            className="shrink-0 bg-[#23297e] hover:bg-[#1a2060] transition-colors text-white font-['Poppins',sans-serif] font-semibold text-base px-5 py-2.5 rounded-xl flex items-center gap-2 whitespace-nowrap shadow-sm"
          >
            <Search size={16} strokeWidth={2.5} />
            Ask
          </button>

          {/* About / Info button */}
          <button
            onClick={onInfoClick}
            title="How does ResistAct work?"
            className="shrink-0 flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-gray-300 text-gray-500 hover:border-[#23297e] hover:text-[#23297e] hover:bg-[#23297e]/5 transition-all font-['Poppins',sans-serif] font-semibold text-sm whitespace-nowrap"
          >
            <Info size={16} />
            <span className="hidden lg:inline">About</span>
          </button>
        </div>

        {/* ── Auth / User section ── */}
        <div className="hidden md:flex items-center gap-3 shrink-0 ml-1">
          {isLoggedIn ? (
            <>
              <Bell size={20} className="text-gray-500 cursor-pointer hover:text-[#23297e] transition-colors" />
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-2.5 cursor-pointer hover:opacity-80 transition-opacity"
                >
                  {approval?.avatar ? (
                    <img src={approval.avatar} alt={approval.name} className="w-9 h-9 rounded-full object-cover ring-2 ring-gray-100" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-[#23297e]/10 ring-2 ring-gray-100 flex items-center justify-center">
                      <span className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-sm">
                        {approval?.name?.charAt(0)?.toUpperCase() ?? "?"}
                      </span>
                    </div>
                  )}
                  <div className="hidden lg:block text-left">
                    <p className="font-['Poppins',sans-serif] font-semibold text-[#3b3b3b] text-sm leading-tight">{approval?.name}</p>
                    <div className="flex items-center gap-1">
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
                  <div className="absolute right-0 top-full mt-2 w-52 bg-white border border-gray-100 rounded-2xl shadow-xl py-1.5 z-50">
                    <div className="px-4 py-2.5 border-b border-gray-50">
                      <p className="font-['Poppins',sans-serif] font-semibold text-gray-800 text-sm truncate">{approval?.name}</p>
                      <p className="font-['Poppins',sans-serif] text-gray-400 text-xs truncate">{approval?.email}</p>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={() => { setDropdownOpen(false); onAdminClick(); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-['Poppins',sans-serif] font-medium text-[#23297e] hover:bg-gray-50 transition-colors"
                      >
                        <ShieldCheck size={15} />
                        Admin Panel
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
            <button
              onClick={onLoginClick}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[#23297e] text-[#23297e] font-['Poppins',sans-serif] font-semibold text-sm hover:bg-[#23297e]/5 transition-colors"
            >
              <LogIn size={16} />
              Sign In
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

      {/* ── Filter bar ── */}
      <div className="px-5 md:px-8 py-2 bg-[#f7f7f7] border-t border-gray-100 hidden md:flex items-center gap-1 flex-wrap" ref={filterBarRef}>
        <span className="font-['Poppins',sans-serif] text-[#888] text-sm font-medium shrink-0 mr-2">Filter by:</span>

        {activeTab === "facts" ? (
          /* ── Facts: inline category pills ── */
          FACTS_FILTER_OPTIONS.Category.map((option) => {
            const selected = (activeFilters["Category"] ?? []).includes(option);
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
          })
        ) : (
          /* ── Acts: dropdown filters ── */
          Object.entries(ACTS_FILTER_OPTIONS).map(([filterName, options]) => {
            const selected = activeFilters[filterName] ?? [];
            const isOpen = openFilter === filterName;
            return (
              <div key={filterName} className="relative shrink-0">
                <button
                  onClick={() => setOpenFilter(isOpen ? null : filterName)}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-['Poppins',sans-serif] font-medium transition-all whitespace-nowrap border ${
                    selected.length > 0
                      ? "border-[#23297e] text-[#23297e] bg-[#23297e]/5"
                      : "border-transparent text-gray-600 hover:bg-white hover:shadow-sm hover:border-gray-200"
                  }`}
                >
                  {filterName}
                  {selected.length > 0 && (
                    <span className="w-4 h-4 rounded-full bg-[#fd8e33] text-white text-[9px] flex items-center justify-center font-bold shrink-0">
                      {selected.length}
                    </span>
                  )}
                  <ChevronDown size={13} className={`text-[#5a5a5a] transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && (
                  <div className="absolute top-full left-0 mt-1.5 w-56 bg-white border border-gray-100 rounded-2xl shadow-xl py-2 z-50">
                    <p className="px-4 pt-1 pb-2 font-['Poppins',sans-serif] text-[10px] uppercase tracking-widest text-gray-400 font-semibold border-b border-gray-50">
                      {filterName}
                    </p>
                    {options.map((option) => (
                      <label key={option} className="flex items-center gap-2.5 px-4 py-2 cursor-pointer hover:bg-gray-50 transition-colors">
                        <input
                          type="checkbox"
                          checked={selected.includes(option)}
                          onChange={() => toggleFilterOption(filterName, option)}
                          className="accent-[#23297e] w-3.5 h-3.5 rounded shrink-0"
                        />
                        <span className="font-['Poppins',sans-serif] text-sm text-gray-700">{option}</span>
                      </label>
                    ))}
                    {selected.length > 0 && (
                      <button
                        onClick={() => onFilterChange(filterName, [])}
                        className="w-full text-center text-xs text-red-400 hover:text-red-600 py-2 border-t border-gray-50 mt-1 font-['Poppins',sans-serif] font-medium transition-colors"
                      >
                        Clear filter
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Clear all */}
        {totalActiveFilters > 0 && (
          <button
            onClick={() => Object.keys(activeTab === "facts" ? FACTS_FILTER_OPTIONS : ACTS_FILTER_OPTIONS).forEach((f) => onFilterChange(f, []))}
            className="shrink-0 ml-1 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-['Poppins',sans-serif] font-semibold text-red-400 hover:text-red-600 hover:bg-red-50 transition-all border border-transparent hover:border-red-100"
          >
            <X size={11} />
            Clear all ({totalActiveFilters})
          </button>
        )}

        {/* Stats — right-aligned */}
        <div className="ml-auto flex items-center gap-5 shrink-0 pl-4 border-l border-gray-200">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-[#fd8e33]" />
            <span className="font-['Poppins',sans-serif] text-xs text-gray-500 whitespace-nowrap">
              <strong className="text-[#23297e] font-bold">{statsSynced ? statsActsCount : "—"}</strong>{" "}resistance acts active
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-[#127f05]" />
            <span className="font-['Poppins',sans-serif] text-xs text-gray-500 whitespace-nowrap">
              <strong className="text-[#127f05] font-bold">{FACT_CARDS.length}</strong>{" "}facts in the database
            </span>
          </div>
        </div>
      </div>

      {/* ── Mobile persistent tab + filter bar ── */}
      <div className="md:hidden border-t border-gray-100 bg-[#f7f7f7]">
        {/* Tab switcher — always visible */}
        <div className="px-4 pt-2 pb-1.5">
          <div className="flex items-center bg-gray-200 rounded-xl p-1 gap-0.5">
            <button
              onClick={() => onTabChange("acts")}
              className={`flex-1 py-2 rounded-lg font-['Poppins',sans-serif] font-bold text-sm transition-all ${
                activeTab === "acts" ? "bg-white text-[#fd8e33] shadow-sm" : "text-gray-500"
              }`}
            >
              The Acts
            </button>
            <button
              onClick={() => onTabChange("facts")}
              className={`flex-1 py-2 rounded-lg font-['Poppins',sans-serif] font-bold text-sm transition-all ${
                activeTab === "facts" ? "bg-white text-[#fd8e33] shadow-sm" : "text-gray-500"
              }`}
            >
              The Facts
            </button>
          </div>
        </div>

        {/* Filter row — scrollable pills for Facts, dropdown buttons for Acts */}
        {activeTab === "facts" ? (
          <div className="flex flex-wrap gap-1.5 px-4 pb-2">
            {FACTS_FILTER_OPTIONS.Category.map((option) => {
              const selected = (activeFilters["Category"] ?? []).includes(option);
              return (
                <button
                  key={option}
                  onClick={() => toggleFilterOption("Category", option)}
                  className={`px-2.5 py-1 rounded-full font-['Poppins',sans-serif] text-xs font-medium transition-all whitespace-nowrap border ${
                    selected
                      ? "bg-[#23297e] text-white border-[#23297e]"
                      : "bg-white text-gray-600 border-gray-200"
                  }`}
                >
                  {option}
                </button>
              );
            })}
            {(activeFilters["Category"] ?? []).length > 0 && (
              <button
                onClick={() => onFilterChange("Category", [])}
                className="flex-none px-2.5 py-1 rounded-full font-['Poppins',sans-serif] text-xs font-medium border border-red-200 text-red-400 bg-white whitespace-nowrap"
              >
                Clear
              </button>
            )}
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
                {approval?.avatar ? (
                  <img src={approval.avatar} alt={approval.name} className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-[#23297e]/10 flex items-center justify-center">
                    <span className="font-bold text-[#23297e]">{approval?.name?.charAt(0)?.toUpperCase()}</span>
                  </div>
                )}
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
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-[#23297e] text-[#23297e] rounded-xl font-['Poppins',sans-serif] font-semibold text-sm"
            >
              <LogIn size={16} />
              Sign In / Create Account
            </button>
          )}
          {isLoggedIn && isAdmin && (
            <button
              onClick={() => { setMobileMenuOpen(false); onAdminClick(); }}
              className="w-full flex items-center gap-2 py-2.5 px-4 bg-[#23297e]/5 text-[#23297e] rounded-xl font-['Poppins',sans-serif] font-semibold text-sm"
            >
              <ShieldCheck size={16} />
              Admin Panel
            </button>
          )}
        </div>
      )}
    </header>
  );
}