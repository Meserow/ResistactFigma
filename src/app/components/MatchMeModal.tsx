import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, EyeOff, Flame, Laugh, Lock, MapPin, Sparkles, Sunrise, ThumbsDown, ThumbsUp, VenetianMask, X, Zap } from "lucide-react";
import logoImg from "../../assets/6f09d83b1b948a5a0a2a9e7558c073db252c1f59.png";
import type { LucideIcon } from "lucide-react";
import { ToneRangeSlider } from "./ToneSlider";
import {
  DEFAULT_PREFERENCES,
  cardIsLocalToState,
  loadPreferences,
  rankCards,
  savePreferences,
  topN,
  type Preferences,
  type TimeBucket,
  type UserContext,
  type VulnerableGroup,
} from "../lib/matcher";
import { CATEGORY_GROUPS, KNOWN_CATEGORIES } from "../lib/categoryGroups";
import { LOCATION_OPTIONS } from "../lib/locations";
import { analytics } from "../lib/analytics";
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

// ─── Dismissal-learning helpers ──────────────────────────────────────────────
// When the user dismisses 3 cards in the same category, we offer to hide
// that whole category. If they decline ("No, keep showing"), we remember the
// category here so we don't prompt them again for it.
const DISMISS_OPTOUT_KEY = "resistact_match_dismiss_optouts";
const DISMISS_PROMPT_THRESHOLD = 3;

function loadDismissOptOuts(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_OPTOUT_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((c: unknown): c is string => typeof c === "string"));
  } catch {
    return new Set();
  }
}

function addDismissOptOut(category: string) {
  try {
    const current = loadDismissOptOuts();
    current.add(category);
    localStorage.setItem(DISMISS_OPTOUT_KEY, JSON.stringify([...current]));
  } catch {}
}

/** Count how many feedback entries exist for a given category. Used to
 * trigger the "hide N category?" prompt once the count crosses the
 * threshold. */
function countDismissalsForCategory(category: string): number {
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY);
    if (!raw) return 0;
    const list: FeedbackEntry[] = JSON.parse(raw);
    if (!Array.isArray(list)) return 0;
    return list.filter((e) => e?.cardCategory === category).length;
  } catch {
    return 0;
  }
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
  /** Which wizard step to open on. 0 = tone/time/setting, 1 = groups. */
  initialStep?: 0 | 1;
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

export function MatchMeModal({ cards, onClose, onApply, isLoggedIn = false, onJoinResistance, completedIds, boostedIds, initialStep = 0 }: MatchMeModalProps) {
  const [step, setStep] = useState<Step>(initialStep);
  const [prefs, setPrefs] = useState<Preferences>(() => loadPreferences() ?? DEFAULT_PREFERENCES);
  const cardRef = useRef<HTMLDivElement>(null);

  // Match-funnel analytics: fire match_started on open. On unmount, fire
  // match_abandoned UNLESS the user applied their preferences (which fires
  // match_set instead, via onApply in App). `appliedRef`/`stepRef` are read
  // in the unmount cleanup, which would otherwise close over stale values.
  const appliedRef = useRef(false);
  const stepRef = useRef(step);
  useEffect(() => { stepRef.current = step; }, [step]);
  useEffect(() => {
    analytics.matchStarted();
    return () => {
      if (!appliedRef.current) analytics.matchAbandoned(stepRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wrap the parent's apply so we can mark the funnel as converted (not
  // abandoned) before handing off. Every "see my matches"/apply button below
  // goes through this rather than calling onApply directly.
  const handleApply = (p: Preferences) => {
    appliedRef.current = true;
    onApply(p);
  };

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
    // Quick Matches deliberately excludes the pinned "Spread the Word about
    // ResistAct" card (and any other pinToTop card) — it's omnipresent at
    // the top of the live feed, so showing it as a Quick Match here is
    // redundant and crowds out actual matched picks.
    //
    // Also excludes cards that fall back to the generic ResistAct logo
    // banner (no topImage). Those look identical to each other in the
    // carousel and undersell the matcher; users complained that Quick
    // Match looked broken when several placeholder cards stacked up.
    // A fallback below re-includes them if filtering thins the pool too
    // far to fill the carousel.
    const hasRealImage = (c: ActionCardData) => !!(c.topImage ?? "").trim();
    const eligible = cards.filter((c) => !c.pinToTop && hasRealImage(c));
    const ranked = rankCards(eligible, prefs, carouselCtx);
    // completedIds is typed Set<number> | number[]; normalise to a check
    // that works on either shape. Still used below to skip cards the user
    // has already marked done.
    const isCompleted = (id: number) => {
      const c = userCtx.completedIds;
      if (!c) return false;
      return c instanceof Set ? c.has(id) : c.includes(id);
    };
    const spreadCard: ActionCardData | null = null; // intentionally not surfaced here anymore

    // Walk the ranking and fill 12 slots with UNIQUE images so the
    // carousel doesn't show two Tesla cards back-to-back. Falls back to score
    // order if we run out of unique-image cards before we hit 12.
    const TARGET = 12;
    const picked: ActionCardData[] = [];
    const seenImages = new Set<string>();

    const addCard = (c: ActionCardData) => {
      picked.push(c);
      const img = (c.topImage ?? "").trim();
      if (img) seenImages.add(img);
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
    // Fallback 2: if state prefs were so restrictive that ranked itself had
    // fewer than TARGET cards (e.g. "Massachusetts" with only 3 local cards),
    // re-rank ignoring state so the carousel always fills 12 slots. Cards
    // already picked are skipped.
    if (picked.length < TARGET) {
      const relaxedRanked = rankCards(
        cards,
        { ...prefs, state: null },
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
    const wantsLocal = !!prefs.state;
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
              onApply={() => handleApply(prefs)}
              userCtx={userCtx}
              step={step}
              totalSteps={TOTAL_STEPS}
            />
          )}

          {step === 1 && (
            <div>
              {/* ── Sharpen your matches — tone sliders (page 2 of the wizard).
                  Moved here from step 0 so the first page stays focused on
                  the fundamentals (time, location, categories) and the
                  second page handles refinement (tone) + identity
                  (vulnerable groups). ─────────────────────────────────── */}
              <div className="mb-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <Sparkles size={12} strokeWidth={1.75} className="text-[#23297e] shrink-0" />
                  <span className="font-['Poppins',sans-serif] text-xs font-bold uppercase tracking-wider text-gray-700">
                    Sharpen your matches
                  </span>
                  <span className="font-['Poppins',sans-serif] text-[11.5px] text-gray-500">— dial in tone</span>
                </div>
                <div className="pl-5 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1">
                  {(["anger", "comedy", "subversion", "hope", "energy"] as const).map((k) => {
                    const { Icon, label, stops } = TONE_LABELS[k];
                    const tone = prefs.tone;
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
                            onChange={(v) => setPrefs((p) => ({ ...p, tone: { ...p.tone, [k]: v } }))}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
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
            </div>
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
                  onClick={() => handleApply(prefs)}
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
  // Positive-feedback set — cards the user marked as "great match" via the
  // thumbs-up button. Records analytics + lets us swap the button into a
  // "Thanks!" confirmation state. Purely local to the wizard session.
  const [praised, setPraised] = useState<Set<number>>(new Set());
  function handleGreatMatch(card: ActionCardData) {
    if (praised.has(card.id)) return;
    setPraised((prev) => new Set(prev).add(card.id));
    analytics.matchFeedback(card.id, card.category);
  }
  const [carouselPage, setCarouselPage] = useState(0);
  const PAGE_SIZE = 4;
  // Whether the "Skip these — categories I can't or won't do" disclosure is
  // open. Collapsed by default to keep the modal short for users who don't
  // need it.
  const [showSkipCategories, setShowSkipCategories] = useState(false);
  // When set, render the inline "you've passed on 3 X actions — hide X?"
  // banner inside the Quick Matches section. Cleared when the user picks
  // either button or when the category gets added to excludedCategories
  // through some other path.
  const [pendingHidePrompt, setPendingHidePrompt] = useState<string | null>(null);

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

    // After logging, check whether the category has crossed the threshold
    // for a "hide this category?" prompt. Skip if the category is already
    // excluded (no point asking), the user previously declined the prompt
    // for this category, or we're already showing the prompt for a
    // different category (don't pile on).
    const cat = card.category;
    if (!cat) return;
    if ((prefs.excludedCategories ?? []).includes(cat)) return;
    if (loadDismissOptOuts().has(cat)) return;
    if (pendingHidePrompt) return;
    if (countDismissalsForCategory(cat) >= DISMISS_PROMPT_THRESHOLD) {
      setPendingHidePrompt(cat);
    }
  }

  // ── Skip-categories chip-grid handlers ─────────────────────────────────────
  function toggleExcludedCategory(category: string) {
    onPrefsChange((p) => {
      const current = p.excludedCategories ?? [];
      const next = current.includes(category)
        ? current.filter((c) => c !== category)
        : [...current, category];
      return { ...p, excludedCategories: next };
    });
  }
  function clearExcludedCategories() {
    onPrefsChange((p) => ({ ...p, excludedCategories: [] }));
  }
  // ── Include-categories handlers ────────────────────────────────────────────
  // Positive selection: when non-empty, ONLY cards whose category is in this
  // set survive the matcher. Mutually independent from excludedCategories —
  // an included category can't simultaneously be excluded, so toggling on
  // here removes from the excluded list (and vice versa).
  function toggleIncludedCategory(category: string) {
    onPrefsChange((p) => {
      const current = p.includedCategories ?? [];
      const next = current.includes(category)
        ? current.filter((c) => c !== category)
        : [...current, category];
      // If we just added a category to the include list, make sure it's not
      // also in the exclude list (those are contradictory).
      const excluded = (p.excludedCategories ?? []).filter((c) => !next.includes(c));
      return { ...p, includedCategories: next, excludedCategories: excluded };
    });
  }
  function clearIncludedCategories() {
    onPrefsChange((p) => ({ ...p, includedCategories: [] }));
  }
  function acceptHidePrompt() {
    if (!pendingHidePrompt) return;
    const cat = pendingHidePrompt;
    onPrefsChange((p) => {
      const current = p.excludedCategories ?? [];
      if (current.includes(cat)) return p;
      return { ...p, excludedCategories: [...current, cat] };
    });
    setPendingHidePrompt(null);
  }
  function declineHidePrompt() {
    if (!pendingHidePrompt) return;
    addDismissOptOut(pendingHidePrompt);
    setPendingHidePrompt(null);
  }

  // Build the chip-grid model: start from the canonical groups, plus a
  // synthetic "Other" group containing any categories the loaded cards
  // actually use that aren't already covered by CATEGORY_GROUPS. Keeps the
  // UI honest if a card ships with a new category that hasn't been added
  // to the groups list yet.
  const chipGroups = useMemo(() => {
    const unknown = new Set<string>();
    for (const c of cards) {
      const cat = c.category;
      if (!cat) continue;
      if (!KNOWN_CATEGORIES.has(cat)) unknown.add(cat);
    }
    if (unknown.size === 0) return CATEGORY_GROUPS;
    // Find an existing "Other" bucket and merge, or append a new one.
    const groups = CATEGORY_GROUPS.map((g) => ({ ...g, categories: [...g.categories] }));
    const otherIdx = groups.findIndex((g) => g.heading === "Other");
    if (otherIdx >= 0) {
      const merged = new Set([...groups[otherIdx].categories, ...unknown]);
      groups[otherIdx] = { ...groups[otherIdx], categories: [...merged] };
    } else {
      groups.push({ heading: "Other", categories: [...unknown] });
    }
    return groups;
  }, [cards]);
  const excludedSet = new Set(prefs.excludedCategories ?? []);
  const includedSet = new Set(prefs.includedCategories ?? []);

  return (
    <div>
      {/* Compact header — logo + title on one row, subtitle inline next to the
          title rather than a second line, to claw back vertical space. */}
      <div className="mb-2 flex items-center gap-2.5 flex-wrap">
        <img src={logoImg} alt="" aria-hidden="true" className="w-7 h-7 object-contain shrink-0" />
        <h2 id="match-me-title" className="font-['Poppins',sans-serif] text-[17px] font-bold text-[#23297e] leading-tight">
          Refine Your Matches
        </h2>
        <p className="font-['Poppins',sans-serif] text-[12px] text-gray-500 leading-tight">
          What kind of actions are you up for?
        </p>
      </div>

      {/* Time Commitment — header left-aligned flush with Location below
          so the two rows visually anchor to the same x. Slider track keeps
          its own pl-5 (line further down) so "Quick wins" / "All in" labels
          sit cleanly in the slider's own padding zones. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1 mb-1">
        {(() => {
          const tIdx = timeIndex(prefs.time);
          const tLevel = TIME_LEVELS[tIdx];
          return (
            <div className="sm:col-span-2 flex flex-col gap-0 mb-0">
              <div className="flex items-center gap-1.5">
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
      </div>

      {/* ── Location & quick filters ──────────────────────────────────────
          State dropdown + two quick-toggle pills sit on one row just above
          the category chips. Replaced the 4-stop Location slider. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-2 mb-1">
        <div className="flex items-center gap-1.5">
          <MapPin size={12} strokeWidth={1.75} className="text-gray-500 shrink-0" />
          <span className="font-['Poppins',sans-serif] font-medium text-[12px] text-gray-800">
            Location
          </span>
        </div>
        <select
          value={prefs.state ?? ""}
          onChange={(e) => onPrefsChange((p) => ({ ...p, state: e.target.value || null }))}
          className={`rounded-lg border border-gray-300 pl-3 pr-8 py-1 font-['Poppins',sans-serif] text-xs focus:outline-none focus:ring-2 focus:ring-[#23297e]/30 focus:border-[#23297e] ${
            prefs.state ? "text-gray-800" : "text-gray-400 italic"
          }`}
        >
          <option value="">— any state —</option>
          {STATE_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {/* "Show all states" checkbox removed — the state filter is now a
            strict filter on the picked state (the matcher still respects
            prefs.includeAnywhere if it's true from a saved profile, but
            new users have no UI to flip it). */}
      </div>

      {/* ── Include these — category INCLUDE chip grid (positive picker) ──
          When the user picks one or more, ONLY cards in those categories
          survive the matcher. Empty = "any category" (default). Sits ABOVE
          the Skip-these section because including is more common than
          excluding — most users land here knowing what they want to do
          rather than what they want to avoid. */}
      <div className="border-t border-gray-200 pt-3 mt-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="flex items-center gap-1.5">
            <Sparkles size={12} strokeWidth={1.75} className="text-[#23297e] shrink-0" />
            <span className="font-['Poppins',sans-serif] text-xs font-bold uppercase tracking-wider text-gray-700">
              Preferred Categories
            </span>
            {includedSet.size > 0 ? (
              <span className="font-['Poppins',sans-serif] text-[11px] font-semibold text-[#23297e]">
                · {includedSet.size} picked
              </span>
            ) : (
              <span className="font-['Poppins',sans-serif] text-[11.5px] text-gray-500">— pick as many as you want</span>
            )}
          </span>
          {includedSet.size > 0 && (
            <button
              type="button"
              onClick={clearIncludedCategories}
              className="font-['Poppins',sans-serif] text-[11px] font-semibold text-[#ed6624] hover:text-[#c2521b] transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        <div className="space-y-2">
          {chipGroups.map((group) => (
            <div key={"inc-" + group.heading} className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2">
              <span className="font-['Poppins',sans-serif] text-[10px] font-bold uppercase tracking-wider text-gray-400 sm:w-[88px] sm:pt-1 shrink-0">
                {group.heading}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {group.categories.map((cat) => {
                  const isIncluded = includedSet.has(cat);
                  return (
                    <button
                      key={"inc-" + cat}
                      type="button"
                      onClick={() => toggleIncludedCategory(cat)}
                      aria-pressed={isIncluded}
                      // `min-w-[64px] sm:min-w-0` — on mobile (iPhone) the
                      // pills have a small width floor so short labels
                      // ("Call", "Boost", "Host") aren't dwarfed by long ones
                      // ("Professional Skills", "Art/Performance Art"). The
                      // 64px floor is calibrated against the actual chip-row
                      // width (~311px at iPhone 375) so 3 mid-length pills
                      // (e.g. OTHER: News Story / Other / Personal Commitment)
                      // can sit on one line without wrapping. Pills hug their
                      // natural width past the floor — no stretching to fill
                      // the row. On sm+ viewports the floor goes away.
                      className={`min-w-[64px] sm:min-w-0 px-2.5 py-1 rounded-full text-[11px] font-['Poppins',sans-serif] font-medium transition-all border ${
                        isIncluded
                          ? "bg-[#23297e] text-white border-[#23297e]"
                          : "bg-white text-gray-700 border-gray-300 hover:border-[#23297e] hover:text-[#23297e]"
                      }`}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* "Skip these" exclude-categories section removed — was redundant
          with the positive "Match these" picker above. Users now express
          intent only by picking what they want, not what they avoid. The
          underlying `excludedCategories` mechanism still exists in the
          matcher (e.g. for future re-introduction or for the dismissal-
          learning prompt below the Quick Matches preview). */}

      {/* "Sharpen your matches" tone sliders moved to step 1 (the second
          wizard page). They live above the vulnerable-groups section there. */}

      <div className="border-t border-gray-200 pt-3 mt-3">
        <h3 className="font-['Poppins',sans-serif] text-xs font-bold uppercase tracking-wider text-gray-500 mb-0.5">
          Quick Matches
        </h3>
        <div className="mb-1.5">
          <p className="font-['Poppins',sans-serif] text-[11.5px] text-gray-600 leading-snug">
            Some quick actions that align with your settings above — let us know if these feel right?
          </p>
        </div>
        {/* Dismissal-learning prompt — appears after the user thumbs-down's
            3 cards in the same category. They can accept (add to
            excludedCategories) or decline (we never prompt for this
            category again, via the dismiss-optouts localStorage key). */}
        {pendingHidePrompt && (
          <div className="mb-3 rounded-xl border-2 border-[#ed6624] bg-[#ed6624]/10 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <p className="font-['Poppins',sans-serif] text-[13px] text-[#23297e] leading-snug">
              <span className="mr-1" aria-hidden>💡</span>
              You've passed on {DISMISS_PROMPT_THRESHOLD}+ <strong>{pendingHidePrompt}</strong> actions.
              Hide {pendingHidePrompt} from your matches going forward?
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={acceptHidePrompt}
                className="px-3 py-1.5 rounded-full bg-[#ed6624] hover:bg-[#c2521b] text-white font-['Poppins',sans-serif] font-bold text-xs transition-colors"
              >
                Yes, hide
              </button>
              <button
                type="button"
                onClick={declineHidePrompt}
                className="px-3 py-1.5 rounded-full border border-gray-300 hover:border-gray-400 bg-white text-gray-700 font-['Poppins',sans-serif] font-semibold text-xs transition-colors"
              >
                No, keep showing
              </button>
            </div>
          </div>
        )}
        {visibleMatches.length === 0 ? (
          <p className="font-['Poppins',sans-serif] text-sm italic text-gray-500 mb-3 min-h-[240px]">
            Move the sliders to see matches.
          </p>
        ) : (() => {
          const totalPages = Math.ceil(visibleMatches.length / PAGE_SIZE);
          const pageCards = visibleMatches.slice(carouselPage * PAGE_SIZE, (carouselPage + 1) * PAGE_SIZE);
          return (
            <div className="mb-4">
              <div className="flex items-center gap-2">
                {/* Left circle nav — visible on tablet+ only. On mobile, the
                    h-12 w-12 arrow eats ~48px of a 343px row (two of them =
                    112px), leaving only 94px per card — text wraps to
                    single-word lines and handles like "@teslatakedown" clip
                    mid-word. On mobile the arrows move below next to the
                    page dots so cards get the full row width. */}
                <button
                  onClick={() => setCarouselPage((p) => Math.max(0, p - 1))}
                  disabled={carouselPage === 0}
                  aria-label="Previous matches"
                  className={`hidden sm:flex shrink-0 h-12 w-12 items-center justify-center rounded-full bg-[#ed6624] text-white shadow-md hover:bg-[#c2521b] disabled:opacity-20 disabled:cursor-not-allowed transition-all ${totalPages <= 1 ? "invisible pointer-events-none" : ""}`}
                >
                  <ChevronLeft size={22} strokeWidth={2.5} />
                </button>
                <ul className="flex-1 grid grid-cols-1 sm:grid-cols-4 gap-3 min-h-[270px]">
                {pageCards.map((m) => {
                  const isFlagged = flagged.has(m.id);
                  return (
                    <li key={m.id} className="flex flex-col gap-2 min-w-0 h-[270px]">
                      <div className={`flex-1 min-h-0 rounded-2xl ring-1 ring-gray-200 transition-opacity ${isFlagged ? "opacity-40" : ""}`}>
                        <ActionCard card={m} compact />
                      </div>
                      <div className="flex items-center justify-center gap-1.5">
                        {/* Thumbs-up = great match — positive feedback. Stays
                            visible after click as a green "Thanks!" pill. */}
                        <button
                          onClick={() => handleGreatMatch(m)}
                          disabled={praised.has(m.id) || isFlagged}
                          aria-label={praised.has(m.id) ? "Marked as great match" : "Mark as great match"}
                          title={praised.has(m.id) ? "Thanks — feedback recorded" : "Great match? Let us know."}
                          className={`inline-flex items-center justify-center rounded-full border w-8 h-8 transition ${
                            praised.has(m.id)
                              ? "border-[#0d8c6e] bg-[#0d8c6e]/10 text-[#0d8c6e] cursor-default"
                              : isFlagged
                                ? "border-gray-200 text-gray-300 opacity-50 cursor-default"
                                : "border-[#0d8c6e] text-gray-700 hover:bg-[#0d8c6e]/10 hover:text-[#0d8c6e]"
                          }`}
                        >
                          <ThumbsUp size={14} strokeWidth={2} className="shrink-0" />
                        </button>
                        {/* Thumbs-down — bad match (existing behavior). */}
                        <button
                          onClick={() => handleBadMatch(m)}
                          disabled={isFlagged || praised.has(m.id)}
                          aria-label={isFlagged ? "Marked as bad match" : "Flag as bad match"}
                          title={isFlagged ? "Thanks — feedback recorded" : "Bad match? Let us know."}
                          className={`inline-flex items-center justify-center rounded-full border w-8 h-8 transition ${
                            isFlagged
                              ? "border-gray-200 text-gray-400 opacity-60 cursor-default"
                              : praised.has(m.id)
                                ? "border-gray-200 text-gray-300 opacity-50 cursor-default"
                                : "border-[#ed6624] text-gray-700 hover:bg-[#ed6624]/10 hover:text-[#ed6624]"
                          }`}
                        >
                          <ThumbsDown size={14} strokeWidth={2} className="shrink-0" />
                        </button>
                      </div>
                    </li>
                  );
                })}
                </ul>
                {/* Right circle nav — hidden on mobile, see comment on the
                    left nav above. */}
                <button
                  onClick={() => setCarouselPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={carouselPage === totalPages - 1}
                  aria-label="Next matches"
                  className={`hidden sm:flex shrink-0 h-12 w-12 items-center justify-center rounded-full bg-[#ed6624] text-white shadow-md hover:bg-[#c2521b] disabled:opacity-20 disabled:cursor-not-allowed transition-all ${totalPages <= 1 ? "invisible pointer-events-none" : ""}`}
                >
                  <ChevronRight size={22} strokeWidth={2.5} />
                </button>
              </div>

              {/* Bottom nav row — page dots, flanked by arrow buttons on
                  mobile. Desktop hides the arrows here (they sit beside the
                  grid above instead). Only renders when there's more than
                  one page of matches. */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-3">
                  <button
                    onClick={() => setCarouselPage((p) => Math.max(0, p - 1))}
                    disabled={carouselPage === 0}
                    aria-label="Previous matches"
                    className="sm:hidden shrink-0 flex h-9 w-9 items-center justify-center rounded-full bg-[#ed6624] text-white shadow hover:bg-[#c2521b] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronLeft size={18} strokeWidth={2.5} />
                  </button>
                  <div className="flex items-center justify-center gap-1.5">
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
                    aria-label="Next matches"
                    className="sm:hidden shrink-0 flex h-9 w-9 items-center justify-center rounded-full bg-[#ed6624] text-white shadow hover:bg-[#c2521b] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronRight size={18} strokeWidth={2.5} />
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
                Tell us more about you
              </span>
              <span className="text-[11px] font-normal italic text-[#23297e]/70 leading-tight mt-0.5">
                Amplify groups you're standing with
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
      {/* State picker moved to page 1 (next to the Location slider). */}

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

