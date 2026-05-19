import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, Clock, Flame, Laugh, Lock, MapPin, Sparkles, Sunrise, ThumbsDown, VenetianMask, Zap } from "lucide-react";
import logoImg from "../../assets/6f09d83b1b948a5a0a2a9e7558c073db252c1f59.png";
import type { LucideIcon } from "lucide-react";
import { ToneRangeSlider } from "./ToneSlider";
import {
  DEFAULT_PREFERENCES,
  cardIsAtHome,
  cardIsLocalToState,
  loadPreferences,
  rankCards,
  savePreferences,
  topN,
  type Preferences,
  type Setting,
  type TimeBucket,
  type UserContext,
  type VulnerableGroup,
} from "../lib/matcher";
import { LOCATION_OPTIONS } from "../lib/locations";
import { ActionCard, type ActionCardData } from "./ActionCard";
import { GroupsDropdown } from "./GroupsDropdown";

// Bad-match feedback log. Persisted to localStorage so we can later mine it
// for per-category/per-tone tuning. Schema is intentionally loose so we can
// evolve the matcher without migrating old entries.
const FEEDBACK_KEY = "resistact_match_feedback";

interface FeedbackEntry {
  ts: string;
  cardId: number;
  cardTitle: string;
  cardCategory: string;
  prefs: Preferences;
}

function logBadMatch(entry: FeedbackEntry) {
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY);
    const list: FeedbackEntry[] = raw ? JSON.parse(raw) : [];
    list.push(entry);
    // Cap at 200 entries so localStorage doesn't bloat indefinitely.
    const trimmed = list.length > 200 ? list.slice(list.length - 200) : list;
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(trimmed));
  } catch {}
}

interface MatchMeModalProps {
  cards: ActionCardData[];
  onClose: () => void;
  /** Called when the user clicks "Show me my matches". Closes the modal
   * and tells the app to apply the preferences as the active filter+sort. */
  onApply: (prefs: Preferences) => void;
  /** Whether a user is signed in. Drives the wording on the filters' privacy
   * notice — anonymous users get an extra-loud "we are not recording you"
   * message; signed-in users get the same guarantee in less-shouting form. */
  isLoggedIn?: boolean;
  /** Anonymous users see a second CTA at the end of the wizard:
   * "Save my picks — Join the Resistance". Calling this should apply the
   * prefs (so they're preserved across the auth flow) AND open the sign-up
   * modal. No-op / hidden when isLoggedIn is true. */
  onJoinResistance?: (prefs: Preferences) => void;
  /** Cards the user has already completed — excluded from match results. */
  completedIds?: number[];
  /** Cards the user has boosted — ranked higher in match results. */
  boostedIds?: number[];
}

// 4-stop slider for the "where" preference.
// "Mostly Remote" opens both online + in-person cards (you're *open* to in-person
// occasionally); "Remote only" hard-filters to online cards only.
const SETTING_STOPS: { label: string; setting: Setting[]; showState: boolean }[] = [
  { label: "Remote only",   setting: ["online"],              showState: false },
  { label: "Mostly Remote", setting: ["online", "inPerson"],  showState: true  },
  { label: "In-person",     setting: ["inPerson"],            showState: true  },
  { label: "Remote + In-person", setting: [],                  showState: true  },
];

function settingIndex(setting: Setting[]): number {
  if (setting.length === 0) return 3;
  if (setting.includes("online") && setting.includes("inPerson")) return 1;
  if (setting.includes("online")) return 0;
  if (setting.includes("inPerson")) return 2;
  return 3;
}

// State picker options — actual US states only. "Online", "National", and
// "Multi-state" aren't picked here because they're not where a *user* lives;
// the state filter passes those locations through automatically.
const STATE_OPTIONS = LOCATION_OPTIONS.filter(
  (o) => o !== "Remote" && o !== "At Home" && o !== "National" && o !== "Multi-State"
);

const TONE_LABELS: Record<"anger" | "comedy" | "subversion" | "hope" | "energy", { Icon: LucideIcon; label: string; stops: { label: string; desc: string }[] }> = {
  anger: {
    Icon: Flame, label: "Confrontational",
    stops: [
      { label: "None",   desc: "Keep it calm, no heat" },
      { label: "Low",    desc: "A little edge, stays subtle" },
      { label: "Bold",   desc: "Direct and attention-getting" },
      { label: "High",   desc: "In-the-streets energy" },
    ],
  },
  comedy: {
    Icon: Laugh, label: "Humorous",
    stops: [
      { label: "None",         desc: "Straight-faced, serious" },
      { label: "Light",        desc: "A bit of wit" },
      { label: "Irreverent",   desc: "Mockery and mischief" },
      { label: "Full mockery", desc: "Absurdity as resistance" },
    ],
  },
  subversion: {
    Icon: VenetianMask, label: "Subversive",
    stops: [
      { label: "None",     desc: "Conventional approach" },
      { label: "Mild",     desc: "Slightly off the beaten path" },
      { label: "Edgy",     desc: "Disruptive, unconventional" },
      { label: "Radical",  desc: "Throw the rulebook out" },
    ],
  },
  hope: {
    Icon: Sunrise, label: "Hopeful",
    stops: [
      { label: "None",      desc: "Realistic, no rose-tinting" },
      { label: "Some",      desc: "A glimmer of optimism" },
      { label: "Uplifting", desc: "Building and inspiring" },
      { label: "Full hope", desc: "Movement energy, community-first" },
    ],
  },
  energy: {
    Icon: Zap, label: "Motivation",
    stops: [
      { label: "Low",      desc: "Low energy day, that's ok" },
      { label: "Mild",     desc: "Getting there" },
      { label: "Engaged",  desc: "Ready to show up" },
      { label: "On fire",  desc: "Fully fired up, let's go" },
    ],
  },
};

type Step = 0 | 1;
const TOTAL_STEPS = 2;

/** Tiny inline progress indicator — rendered in the bottom-left of each step's
 * footer next to the buttons. Active step is a longer orange bar; future steps
 * are gray dots. */
function ProgressDots({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all ${
            i === step ? "w-8 bg-[#ed6624]" : i < step ? "w-1.5 bg-[#ed6624]" : "w-1.5 bg-gray-300"
          }`}
        />
      ))}
    </div>
  );
}

export function MatchMeModal({ cards, onClose, onApply, isLoggedIn = false, onJoinResistance, completedIds, boostedIds }: MatchMeModalProps) {
  const [step, setStep] = useState<Step>(0);
  const [prefs, setPrefs] = useState<Preferences>(() => loadPreferences() ?? DEFAULT_PREFERENCES);
  const cardRef = useRef<HTMLDivElement>(null);

  // Save on every change so coming back later pre-fills.
  useEffect(() => {
    savePreferences(prefs);
  }, [prefs]);

  // Body scroll lock + escape to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const userCtx = useMemo<UserContext>(() => ({
    completedIds: completedIds ?? [],
    boostedIds: boostedIds ?? [],
  }), [completedIds, boostedIds]);

  // Carousel-specific context: omit completedIds so that cards the user has
  // already done aren't hard-excluded from ranking (score = 0 → dropped).
  // Without this, completedIds loading from Supabase ~3 s after modal open
  // can collapse 12 carousel cards down to 3. Completed cards still sort to
  // the back of the picked list so fresh actions lead.
  const carouselCtx = useMemo<UserContext>(() => ({
    completedIds: [],
    boostedIds: boostedIds ?? [],
  }), [boostedIds]);

  // When the user picks In-person + a state, guarantee at least one of the 4
  // quick matches is genuinely local to that state. Without this, a Louisiana
  // user could see three Multi-state Tesla protests scoring higher than any
  // Louisiana-specific action — technically correct, but unhelpful.
  const matches = useMemo(() => {
    // Slot 1 is always "Spread the Word about ResistAct" (id=1) until the
    // user has marked it done — it's the cheapest, most-impactful first
    // action and reinforces the social-graph growth flywheel.
    const ranked = rankCards(cards, prefs, carouselCtx);
    // completedIds is typed Set<number> | number[]; normalise to a check that
    // works on either shape.
    const isCompleted = (id: number) => {
      const c = userCtx.completedIds;
      if (!c) return false;
      return c instanceof Set ? c.has(id) : c.includes(id);
    };
    const spreadCard =
      !isCompleted(1)
        ? cards.find((c) => c.id === 1) ?? null
        : null;

    // Walk the ranking and fill 12 slots with UNIQUE images so the
    // carousel doesn't show two Tesla cards back-to-back. Falls back to score
    // order if we run out of unique-image cards before we hit 12.
    //
    // When the user picks "Both equal" (online + in-person), enforce a ~50/50
    // split so the carousel doesn't skew 11/12 online just because there are
    // more online cards in the DB.
    const TARGET = 12;
    const wantsBothEqual =
      prefs.setting.includes("online") && prefs.setting.includes("inPerson");
    // Spread card is always online — count it toward the online quota.
    const ONLINE_MAX = wantsBothEqual ? Math.ceil(TARGET / 2) : TARGET;
    const IN_PERSON_MAX = wantsBothEqual ? Math.floor(TARGET / 2) : TARGET;

    const picked: ActionCardData[] = [];
    const seenImages = new Set<string>();
    let onlineCount = 0;
    let inPersonCount = 0;

    const addCard = (c: ActionCardData) => {
      picked.push(c);
      const img = (c.topImage ?? "").trim();
      if (img) seenImages.add(img);
      if (cardIsAtHome(c)) onlineCount++; else inPersonCount++;
    };

    if (spreadCard) {
      addCard(spreadCard);
    }
    for (const c of ranked) {
      if (picked.length >= TARGET) break;
      if (spreadCard && c.id === spreadCard.id) continue;
      if (isCompleted(c.id)) continue;
      const img = (c.topImage ?? "").trim();
      if (img && seenImages.has(img)) continue;
      // Quota check — skip if this bucket is already full.
      if (wantsBothEqual) {
        if (cardIsAtHome(c) && onlineCount >= ONLINE_MAX) continue;
        if (!cardIsAtHome(c) && inPersonCount >= IN_PERSON_MAX) continue;
      }
      addCard(c);
    }
    // Fallback 1: fill remaining slots ignoring quotas if one bucket ran dry.
    if (picked.length < TARGET) {
      const pickedIds = new Set(picked.map((c) => c.id));
      for (const c of ranked) {
        if (picked.length >= TARGET) break;
        if (pickedIds.has(c.id)) continue;
        if (isCompleted(c.id)) continue;
        addCard(c);
      }
    }
    // Fallback 2: if setting/state prefs were so restrictive that ranked itself
    // had fewer than TARGET cards (e.g. "In-person only" + "Massachusetts" with
    // only 3 local in-person cards), re-rank ignoring setting and state so the
    // carousel always fills 12 slots. Cards already picked are skipped.
    if (picked.length < TARGET) {
      const relaxedRanked = rankCards(
        cards,
        { ...prefs, setting: [], state: null },
        carouselCtx,
      );
      const pickedIds = new Set(picked.map((c) => c.id));
      for (const c of relaxedRanked) {
        if (picked.length >= TARGET) break;
        if (pickedIds.has(c.id)) continue;
        if (isCompleted(c.id)) continue;
        addCard(c);
      }
    }
    const top = picked;

    // State-local guarantee — swap in the best-scoring local card if none of
    // the unique-image top picks were local to the user's state.
    const wantsLocal =
      prefs.state &&
      (prefs.setting.length === 0 || prefs.setting.includes("inPerson"));
    if (!wantsLocal) return top;
    if (top.some((c) => cardIsLocalToState(c, prefs.state))) return top;
    const bestLocal = ranked.find((c) => cardIsLocalToState(c, prefs.state));
    if (!bestLocal) return top;
    if (top.length < 3) return [...top, bestLocal];
    return [...top.slice(0, 2), bestLocal, ...top.slice(3)];
  }, [cards, prefs, carouselCtx, userCtx]);

  function next() { setStep((s) => Math.min(1, (s + 1) as Step)); }
  function prev() { setStep((s) => Math.max(0, (s - 1) as Step)); }

  // Scroll the modal card back to the top whenever the step changes. Using
  // useLayoutEffect (fires before paint) so the reset is invisible to the
  // user — useEffect fires too late and the old scroll position is briefly
  // visible before it corrects.
  useLayoutEffect(() => {
    if (cardRef.current) {
      cardRef.current.scrollTop = 0;
    }
  }, [step]);

  function toggleGroup(g: VulnerableGroup) {
    setPrefs((p) => ({
      ...p,
      vulnerableGroups: p.vulnerableGroups.includes(g)
        ? p.vulnerableGroups.filter((x) => x !== g)
        : [...p.vulnerableGroups, g],
    }));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="match-me-title"
      onClick={onClose}
      className="hero-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-[#0d1b2a]/60 p-4 sm:p-6"
    >
      {/* Outer card — flex column so the footer can be pinned outside the
          scroll area. overflow-hidden clips the rounded corners. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="hero-modal-card relative flex flex-col w-full max-w-[1100px] max-h-[92vh] overflow-hidden rounded-[10px] bg-white shadow-2xl"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-[#f0e8de] hover:text-[#23297e]"
        >
          <X size={20} />
        </button>

        {/* Scrollable content area — flex-1 so it fills the space above the
            pinned footer. cardRef lives here so the scroll-to-top on step
            change resets only this div. */}
        <div ref={cardRef} className="flex-1 overflow-y-auto p-4 sm:p-5">
          {step === 0 && (
            <StepToneAndPreview
              cards={cards}
              prefs={prefs}
              onPrefsChange={setPrefs}
              matches={matches}
              onNext={next}
              onApply={() => onApply(prefs)}
              userCtx={userCtx}
              step={step}
              totalSteps={TOTAL_STEPS}
            />
          )}

          {step === 1 && (
            <StepGroups
              value={prefs.vulnerableGroups}
              onToggle={toggleGroup}
              onClear={() => setPrefs((p) => ({ ...p, vulnerableGroups: [] }))}
              focusDonations={prefs.focusDonations}
              onFocusDonationsChange={(v) => setPrefs((p) => ({ ...p, focusDonations: v }))}
              state={prefs.state}
              onStateChange={(s) => setPrefs((p) => ({ ...p, state: s }))}
              includeAnywhere={prefs.includeAnywhere}
              onIncludeAnywhereChange={(v) => setPrefs((p) => ({ ...p, includeAnywhere: v }))}
            />
          )}
        </div>

        {/* Step 1 footer — pinned outside the scroll area so it's always
            visible and doesn't contribute to the scrollable height. */}
        {step === 1 && (
          <div className="shrink-0 flex items-start justify-between gap-4 border-t border-gray-200 px-4 sm:px-5 pt-4 pb-4">
            <div className="flex items-center gap-4 pt-2.5">
              <button
                onClick={prev}
                className="inline-flex items-center gap-1 font-['Poppins',sans-serif] text-sm font-medium text-gray-600 hover:text-[#23297e]"
              >
                <ChevronLeft size={16} /> Back
              </button>
              <ProgressDots step={step} total={TOTAL_STEPS} />
            </div>
            <div className="flex flex-col items-end gap-2 max-w-[440px]">
              <div className="flex flex-col sm:flex-row items-stretch gap-2">
                <button
                  onClick={() => onApply(prefs)}
                  disabled={matches.length === 0}
                  className="inline-flex flex-col items-start rounded-2xl border border-[#23297e] bg-white px-5 py-2 font-['Poppins',sans-serif] text-left text-[#23297e] hover:bg-[#23297e]/5 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap transition-colors"
                >
                  <span className="text-sm font-semibold leading-tight">
                    Show me all my matches →
                  </span>
                  <span className="text-[11px] font-normal italic text-[#23297e]/70 leading-tight mt-0.5">
                    No sign up required
                  </span>
                </button>
                {!isLoggedIn && onJoinResistance && (
                  <button
                    onClick={() => onJoinResistance(prefs)}
                    disabled={matches.length === 0}
                    className="inline-flex flex-col items-start rounded-2xl bg-[#23297e] px-5 py-2 font-['Poppins',sans-serif] text-left text-white hover:bg-[#1a2060] disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap transition-colors"
                  >
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold leading-tight">
                      <Flame size={14} strokeWidth={2.25} className="shrink-0" />
                      #jointheresistance
                    </span>
                    <span className="text-[11px] font-normal italic text-white/80 leading-tight mt-0.5">
                      Sign up to save your match settings.
                    </span>
                  </button>
                )}
              </div>
              <PrivacyFootnote isLoggedIn={isLoggedIn} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step 0: tone sliders + live match preview ───────────────────────────────

function StepToneAndPreview({
  cards,
  prefs,
  onPrefsChange,
  matches,
  onNext,
  onApply,
  userCtx,
  step,
  totalSteps,
}: {
  cards: ActionCardData[];
  prefs: Preferences;
  onPrefsChange: React.Dispatch<React.SetStateAction<Preferences>>;
  matches: ActionCardData[];
  onNext: () => void;
  onApply: () => void;
  userCtx: UserContext;
  step: number;
  totalSteps: number;
}) {
  const tone = prefs.tone;
  const setTone = (next: Preferences["tone"]) =>
    onPrefsChange((p) => ({ ...p, tone: next }));
  // Track which result rows the user has flagged as a bad match this session.
  // We use this set both to (a) skip the flagged card when computing
  // replacement matches, and (b) gray-out the slot if no replacement exists.
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [carouselPage, setCarouselPage] = useState(0);
  const PAGE_SIZE = 4;

  // Reset carousel to page 0 when prefs change so the user always sees their
  // freshest top matches first after adjusting sliders.
  useEffect(() => { setCarouselPage(0); }, [prefs]);

  // Live-replace flagged matches with the next-best candidates not in the
  // current visible list. Rebuilds whenever prefs change or a card is flagged.
  // If the user flags all reasonable matches, slots fall back to empty (we
  // surface the dimmed flagged-card visual so they know it was rejected).
  const visibleMatches = useMemo(() => {
    if (flagged.size === 0) return matches;
    const ranked = rankCards(cards, prefs, userCtx);
    // Pre-populate `used` with all non-flagged matches so a replacement card
    // can't accidentally duplicate a card already visible in another slot.
    const used = new Set<number>(matches.filter((m) => !flagged.has(m.id)).map((m) => m.id));
    // Track which images are visible so replacements don't introduce a
    // duplicate-image card (e.g. another Tesla Takedown card).
    const usedImages = new Set<string>(
      matches
        .filter((m) => !flagged.has(m.id))
        .map((m) => (m.topImage ?? "").trim())
        .filter(Boolean)
    );
    const out: ActionCardData[] = [];
    for (const m of matches) {
      if (!flagged.has(m.id)) { out.push(m); continue; }
      const replacement = ranked.find((c) => {
        if (flagged.has(c.id) || used.has(c.id)) return false;
        const img = (c.topImage ?? "").trim();
        if (img && usedImages.has(img)) return false;
        return true;
      });
      if (replacement) {
        out.push(replacement);
        used.add(replacement.id);
        const rImg = (replacement.topImage ?? "").trim();
        if (rImg) usedImages.add(rImg);
      } else { out.push(m); }  // No replacement available — keep the dimmed card.
    }
    return out;
  }, [matches, flagged, cards, prefs, userCtx]);

  function handleBadMatch(card: ActionCardData) {
    if (flagged.has(card.id)) return;
    logBadMatch({
      ts: new Date().toISOString(),
      cardId: card.id,
      cardTitle: card.title,
      cardCategory: card.category,
      prefs,
    });
    setFlagged((prev) => new Set(prev).add(card.id));
  }

  return (
    <div>
      {/* Compact header — logo + title on one row, subtitle inline next to the
          title rather than a second line, to claw back vertical space in the
          Quick Match Tool modal. */}
      <div className="mb-2 flex items-center gap-2.5 flex-wrap">
        <img src={logoImg} alt="" aria-hidden="true" className="w-7 h-7 object-contain shrink-0" />
        <h2 id="match-me-title" className="font-['Poppins',sans-serif] text-[17px] font-bold text-[#23297e] leading-tight">
          Quick Match Tool
        </h2>
        <p className="font-['Poppins',sans-serif] text-[12px] text-gray-500 leading-tight">
          What kind of actions are you up for?
        </p>
      </div>

      <div className="pl-5 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1 mb-1">
        {/* Time Commitment — spans both columns, aligned with the grid below */}
        {(() => {
          const tIdx = timeIndex(prefs.time);
          const tLevel = TIME_LEVELS[tIdx];
          return (
            <div className="sm:col-span-2 flex flex-col gap-0 mb-0">
              <div className="flex items-center gap-1.5 pl-1">
                <Clock size={12} strokeWidth={1.75} className="text-gray-500 shrink-0" />
                <span className="font-['Poppins',sans-serif] font-medium text-[12px] text-gray-800">
                  Time Commitment
                </span>
                <span className="font-['Poppins',sans-serif] text-[10.5px] text-gray-500 truncate">
                  · <span className="font-medium text-[#ed6624]">{tLevel.title}</span> — {tLevel.desc}
                </span>
              </div>
              {/* Slider track starts at pl-5 — same offset as Location + tone sliders.
                  "Quick wins" / "All in" sit in ToneRangeSlider's built-in px-16 padding
                  zones so they don't shift the track left. */}
              <div className="pl-5 relative">
                <ToneRangeSlider
                  value={tIdx}
                  onChange={(v) => onPrefsChange((p) => ({ ...p, time: TIME_LEVELS[v].key }))}
                  max={6}
                />
                <span className="absolute left-0 w-16 text-right top-1/2 -translate-y-1/2 font-['Poppins',sans-serif] text-[9px] text-gray-400 pointer-events-none">
                  Quick wins
                </span>
                <span className="absolute right-0 w-16 pl-2 text-left top-1/2 -translate-y-1/2 font-['Poppins',sans-serif] text-[9px] text-gray-400 pointer-events-none">
                  All in
                </span>
              </div>
            </div>
          );
        })()}
        {/* Setting — first slider cell, same style as tone sliders */}
        {(() => {
          const sIdx = settingIndex(prefs.setting);
          const sStop = SETTING_STOPS[sIdx];
          return (
            <div className="flex flex-col gap-0">
              <div className="flex items-center gap-1.5 pl-1">
                <MapPin size={12} strokeWidth={1.75} className="text-gray-500 shrink-0" />
                <span className="font-['Poppins',sans-serif] font-medium text-[12px] text-gray-800">
                  Location
                </span>
                <span className="font-['Poppins',sans-serif] text-[10.5px] text-gray-500 truncate">
                  · <span className="font-medium text-[#ed6624]">{sStop.label}</span> — online/at home or in person
                </span>
              </div>
              <div className="pl-5">
                <ToneRangeSlider
                  value={sIdx}
                  onChange={(v) =>
                    onPrefsChange((p) => ({ ...p, setting: SETTING_STOPS[v].setting }))
                  }
                  max={3}
                />
              </div>
            </div>
          );
        })()}
        {(["anger", "comedy", "subversion", "hope", "energy"] as const).map((k) => {
          const { Icon, label, stops } = TONE_LABELS[k];
          const stop = stops[tone[k]];
          return (
            <div key={k} className="flex flex-col gap-0">
              <div className="flex items-center gap-1.5 pl-1">
                <Icon size={12} strokeWidth={1.75} className="text-gray-500 shrink-0" />
                <span className="font-['Poppins',sans-serif] font-medium text-[12px] text-gray-800">
                  {label}
                </span>
                <span className="font-['Poppins',sans-serif] text-[10.5px] text-gray-500 truncate">
                  · <span className="font-medium text-[#ed6624]">{stop.label}</span> — {stop.desc}
                </span>
              </div>
              <div className="pl-5">
                <ToneRangeSlider
                  value={tone[k]}
                  onChange={(v) => setTone({ ...tone, [k]: v })}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-gray-200 pt-3 mt-3">
        <h3 className="font-['Poppins',sans-serif] text-xs font-bold uppercase tracking-wider text-gray-500 mb-0.5">
          Quick Matches
        </h3>
        <div className="mb-1.5">
          <p className="font-['Poppins',sans-serif] text-[11.5px] text-gray-600 leading-snug">
            Some quick actions that align with your settings above — let us know if these feel right?
          </p>
        </div>
        {visibleMatches.length === 0 ? (
          <p className="font-['Poppins',sans-serif] text-sm italic text-gray-500 mb-3 min-h-[240px]">
            Move the sliders to see matches.
          </p>
        ) : (() => {
          const totalPages = Math.ceil(visibleMatches.length / PAGE_SIZE);
          const pageCards = visibleMatches.slice(carouselPage * PAGE_SIZE, (carouselPage + 1) * PAGE_SIZE);
          return (
            <div className="mb-4">
              <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3 min-h-[270px]">
                {pageCards.map((m) => {
                  const isFlagged = flagged.has(m.id);
                  return (
                    <li key={m.id} className="flex flex-col gap-2 min-w-0 h-[270px]">
                      <div className={`flex-1 min-h-0 rounded-2xl ring-1 ring-gray-200 transition-opacity ${isFlagged ? "opacity-40" : ""}`}>
                        <ActionCard card={m} compact />
                      </div>
                      <div className="flex justify-center">
                        <button
                          onClick={() => handleBadMatch(m)}
                          disabled={isFlagged}
                          aria-label={isFlagged ? "Marked as bad match" : "Flag as bad match"}
                          title={isFlagged ? "Thanks — feedback recorded" : "Bad match? Let us know."}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-['Poppins',sans-serif] text-xs transition ${
                            isFlagged
                              ? "border-gray-200 text-gray-400 opacity-60 cursor-default"
                              : "border-[#ed6624] text-gray-700 hover:bg-[#ed6624]/10 hover:text-[#ed6624]"
                          }`}
                        >
                          <ThumbsDown size={14} strokeWidth={2} className="shrink-0" />
                          <span>{isFlagged ? "Thanks!" : "Not a great match"}</span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* Carousel nav — only shown when there's more than one page */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-3">
                  <button
                    onClick={() => setCarouselPage((p) => Math.max(0, p - 1))}
                    disabled={carouselPage === 0}
                    className="inline-flex items-center gap-1 rounded-full border border-gray-300 px-3 py-1 font-['Poppins',sans-serif] text-xs text-gray-600 hover:border-[#23297e] hover:text-[#23297e] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft size={13} strokeWidth={2} /> Prev
                  </button>

                  <div className="flex items-center gap-1.5">
                    {Array.from({ length: totalPages }).map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setCarouselPage(i)}
                        className={`rounded-full transition-all ${
                          i === carouselPage
                            ? "w-4 h-1.5 bg-[#23297e]"
                            : "w-1.5 h-1.5 bg-gray-300 hover:bg-gray-400"
                        }`}
                        aria-label={`Page ${i + 1}`}
                      />
                    ))}
                  </div>

                  <button
                    onClick={() => setCarouselPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={carouselPage === totalPages - 1}
                    className="inline-flex items-center gap-1 rounded-full border border-gray-300 px-3 py-1 font-['Poppins',sans-serif] text-xs text-gray-600 hover:border-[#23297e] hover:text-[#23297e] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Next <ChevronRight size={13} strokeWidth={2} />
                  </button>
                </div>
              )}
            </div>
          );
        })()}

        {/* Twin CTAs:
         *   primary  → apply current prefs and dive into the full filtered feed
         *   secondary → step 1 (vulnerable groups) to refine for who they are
         * Both are orange because both are valid forward actions; the primary
         * is solid (most users will tap this), the secondary is outline so it
         * doesn't compete visually. */}
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 mt-5">
          <ProgressDots step={step} total={totalSteps} />
          <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2">
            <button
              onClick={onNext}
              className="inline-flex flex-col items-center justify-center rounded-2xl border border-[#23297e] bg-white px-5 py-2 font-['Poppins',sans-serif] text-[#23297e] hover:bg-[#23297e]/5 transition-colors"
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
                <Sparkles size={13} strokeWidth={2} />
                Sharpen your matches
              </span>
              <span className="text-[11px] font-normal italic text-[#23297e]/70 leading-tight mt-0.5">
                Tell us more about who you are
              </span>
            </button>
            <button
              onClick={onApply}
              disabled={matches.length === 0}
              className="inline-flex flex-col items-center justify-center rounded-2xl bg-[#23297e] px-6 py-2 font-['Poppins',sans-serif] text-white shadow-sm hover:bg-[#1a2060] hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
                These Matches Look Good!
              </span>
              <span className="flex items-center gap-1 text-[11px] font-normal italic text-white/80 leading-tight mt-0.5">
                Show Me More <ChevronRight size={12} strokeWidth={2} />
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// All 7 TimeBucket values mapped to friendly slider stops.
const TIME_LEVELS: { key: TimeBucket; title: string; desc: string }[] = [
  { key: "5min",     title: "Quick wins",    desc: "Under 5 min" },
  { key: "10min",    title: "A few minutes", desc: "5–10 min" },
  { key: "30min",    title: "Light touch",   desc: "~30 min" },
  { key: "1hr",      title: "Some effort",   desc: "~1 hr" },
  { key: "fewHours", title: "Regular",       desc: "Few hrs / week" },
  { key: "fullDay",  title: "Committed",     desc: "~1 day" },
  { key: "ongoing",  title: "All in",        desc: "Ongoing organizing" },
];

function timeIndex(t: TimeBucket | null): number {
  if (!t) return 1;
  const i = TIME_LEVELS.findIndex((l) => l.key === t);
  return i >= 0 ? i : 1;
}

// ─── Step 1: vulnerable-group affinity (own page) ────────────────────────────

function StepGroups({
  value,
  onToggle,
  onClear,
  focusDonations,
  onFocusDonationsChange,
  state,
  onStateChange,
  includeAnywhere,
  onIncludeAnywhereChange,
}: {
  value: VulnerableGroup[];
  onToggle: (g: VulnerableGroup) => void;
  onClear: () => void;
  focusDonations: boolean;
  onFocusDonationsChange: (v: boolean) => void;
  state: string | null;
  onStateChange: (s: string | null) => void;
  includeAnywhere: boolean;
  onIncludeAnywhereChange: (v: boolean) => void;
}) {
  return (
    <div>
      {/* ── Where are you? (state picker) ───────────────────────────────── */}
      <div className="mb-4">
        <h3 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-base leading-tight mb-0.5">
          Where could you show up for in-person actions?
        </h3>
        <p className="font-['Poppins',sans-serif] text-xs text-gray-500 mb-2">
          Optional. We'll surface nearby in-person actions when they match your other settings.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={state ?? ""}
            onChange={(e) => onStateChange(e.target.value || null)}
            className={`rounded-lg border border-gray-300 pl-3 pr-10 py-1.5 font-['Poppins',sans-serif] text-sm focus:outline-none focus:ring-2 focus:ring-[#23297e]/30 focus:border-[#23297e] ${
              state ? "text-gray-800" : "text-gray-400 italic"
            }`}
          >
            <option value="">— pick your state —</option>
            {STATE_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {state && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeAnywhere}
                onChange={(e) => onIncludeAnywhereChange(e.target.checked)}
                className="w-4 h-4 rounded accent-[#ed6624]"
              />
              <span className="font-['Poppins',sans-serif] text-sm text-gray-600">
                Show all states, prioritize mine
              </span>
            </label>
          )}
        </div>
      </div>

      {/* ── Targeted-group affinity ──────────────────────────────────────── */}
      <div className="mb-4">
        <h3 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-base leading-tight mb-0.5">
          Do you want to focus on a particular group being targeted?
        </h3>
        <p className="font-['Poppins',sans-serif] text-xs text-gray-500 mb-2">
          Optional. We'll prioritize actions centered on the group(s) you pick.
        </p>
        <GroupsDropdown value={value} onToggle={onToggle} onClear={onClear} defaultOpen />
      </div>

      {/* ── Donation-focus opt-in (second question) ─────────────────────── */}
      <div>
        <h3 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-base leading-tight mb-0.5">
          Include laser-focused donation guidance?
        </h3>
        <p className="font-['Poppins',sans-serif] text-xs text-gray-500 mb-2">
          As we get closer to the midterms we'll add to your matches the closest, most pivotal races — the ones where every extra dollar tips the outcome. Avoid the spray-and-pray fundraising lists.
        </p>
        <div className="flex flex-col sm:flex-row items-stretch gap-2">
          <button
            type="button"
            onClick={() => onFocusDonationsChange(true)}
            aria-pressed={focusDonations}
            className={`inline-flex flex-col items-start rounded-2xl border px-4 py-2 font-['Poppins',sans-serif] text-left transition-colors ${
              focusDonations
                ? "border-[#ed6624] bg-[#ed6624] text-white"
                : "border-gray-300 bg-white text-gray-700 hover:border-[#ed6624] hover:text-[#ed6624]"
            }`}
          >
            <span className="text-[13px] font-semibold leading-tight">
              Yes — show me high-leverage races
            </span>
            <span className={`text-[11px] font-normal italic leading-tight mt-0.5 ${focusDonations ? "text-white/85" : "text-gray-500"}`}>
              Target dollars where they tip races
            </span>
          </button>
          <button
            type="button"
            onClick={() => onFocusDonationsChange(false)}
            aria-pressed={!focusDonations}
            className={`inline-flex flex-col items-start rounded-2xl border px-4 py-2 font-['Poppins',sans-serif] text-left transition-colors ${
              !focusDonations
                ? "border-[#23297e] bg-[#23297e] text-white"
                : "border-gray-300 bg-white text-gray-700 hover:border-[#23297e] hover:text-[#23297e]"
            }`}
          >
            <span className="text-[13px] font-semibold leading-tight">
              No thanks — sweat equity only
            </span>
            <span className={`text-[11px] font-normal italic leading-tight mt-0.5 ${!focusDonations ? "text-white/85" : "text-gray-500"}`}>
              I'll do ResistActs as often as I can
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** Tiny privacy footnote shown under the modal footer. Honest about both the
 * current behaviour (stored on this device only) and the future behaviour
 * (synced to the user's profile after account creation). */
function PrivacyFootnote({ isLoggedIn }: { isLoggedIn: boolean }) {
  return (
    <p className="flex items-start gap-1.5 font-['Poppins',sans-serif] text-[10.5px] leading-[1.45] text-gray-400 italic text-right">
      <Lock size={10} strokeWidth={1.75} className="shrink-0 mt-[2px] text-gray-400 not-italic" aria-hidden />
      <span>
        {isLoggedIn
          ? "Selections live on this device and on your profile so they follow you across devices. We're not using your data for evil nor sharing it with anyone."
          : "Until you login, match settings live temporarily on this device so you can operate anonymously. Create an account and we'll sync them across devices. Either way, we're not using your data for evil nor sharing it with anyone."}
      </span>
    </p>
  );
}

