import { useEffect, useMemo, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, CircleAlert, Clock, Flame, Laugh, Sparkles, Sunrise, VenetianMask, Zap } from "lucide-react";
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
  /** Cards the user has already completed — excluded from match results. */
  completedIds?: number[];
  /** Cards the user has boosted — ranked higher in match results. */
  boostedIds?: number[];
}

const SETTING_OPTIONS: { value: Setting; label: string }[] = [
  { value: "online",   label: "Remote" },
  { value: "inPerson", label: "In-person" },
];

// State picker options — actual US states only. "Online", "National", and
// "Multi-state" aren't picked here because they're not where a *user* lives;
// the state filter passes those locations through automatically.
const STATE_OPTIONS = LOCATION_OPTIONS.filter(
  (o) => o !== "Online" && o !== "National" && o !== "Multi-state"
);

const TONE_LABELS: Record<"anger" | "comedy" | "subversion" | "hope" | "energy", { Icon: LucideIcon; label: string; desc: string }> = {
  anger:      { Icon: Flame,        label: "Confrontational", desc: "In-the-streets energy — may attract attention" },
  comedy:     { Icon: Laugh,        label: "Humorous",        desc: "Mockery, irreverence, prank" },
  subversion: { Icon: VenetianMask, label: "Subversive",      desc: "Disruptive, off the beaten path" },
  hope:       { Icon: Sunrise,      label: "Hopeful",         desc: "Uplifting, optimistic, building" },
  energy:     { Icon: Zap,          label: "Motivation",      desc: "How fired-up are you today?" },
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
            i === step ? "w-8 bg-[#fd8e33]" : i < step ? "w-1.5 bg-[#fd8e33]" : "w-1.5 bg-gray-300"
          }`}
        />
      ))}
    </div>
  );
}

export function MatchMeModal({ cards, onClose, onApply, isLoggedIn = false, completedIds, boostedIds }: MatchMeModalProps) {
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

  // When the user picks In-person + a state, guarantee at least one of the 3
  // sample matches is genuinely local to that state. Without this, a Louisiana
  // user could see three Multi-state Tesla protests scoring higher than any
  // Louisiana-specific action — technically correct, but unhelpful.
  const matches = useMemo(() => {
    const top = topN(cards, prefs, 3, userCtx);
    const wantsLocal =
      prefs.state &&
      (prefs.setting.length === 0 || prefs.setting.includes("inPerson"));
    if (!wantsLocal) return top;
    if (top.some((c) => cardIsLocalToState(c, prefs.state))) return top;
    // Find the best-scoring local card and swap it into the last slot.
    const ranked = rankCards(cards, prefs, userCtx);
    const bestLocal = ranked.find((c) => cardIsLocalToState(c, prefs.state));
    if (!bestLocal) return top; // No local card exists for this state — leave as is.
    if (top.length < 3) return [...top, bestLocal];
    return [...top.slice(0, 2), bestLocal];
  }, [cards, prefs, userCtx]);

  function next() { setStep((s) => Math.min(1, (s + 1) as Step)); }
  function prev() { setStep((s) => Math.max(0, (s - 1) as Step)); }

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
      <div
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
        className="hero-modal-card relative w-full max-w-[1100px] max-h-[92vh] overflow-y-auto rounded-[10px] bg-white p-4 sm:p-5 shadow-2xl"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-[#f0e8de] hover:text-[#23297e]"
        >
          <X size={20} />
        </button>

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
          />
        )}

        {/* Step 1 footer — Back to first page | Apply (Show me my matches) +
         * privacy footnote tucked beneath. */}
        {step === 1 && (
          <>
            <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4">
              <div className="flex items-center gap-4">
                <button
                  onClick={prev}
                  className="inline-flex items-center gap-1 font-['Poppins',sans-serif] text-sm font-medium text-gray-600 hover:text-[#23297e]"
                >
                  <ChevronLeft size={16} /> Back
                </button>
                <ProgressDots step={step} total={TOTAL_STEPS} />
              </div>
              <button
                onClick={() => onApply(prefs)}
                disabled={matches.length === 0}
                className="rounded-full bg-[#fd8e33] px-6 py-2.5 font-['Poppins',sans-serif] text-sm font-bold text-white hover:bg-[#d96612] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Show me my matches
              </button>
            </div>
            <PrivacyFootnote isLoggedIn={isLoggedIn} />
          </>
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
    const out: ActionCardData[] = [];
    for (const m of matches) {
      if (!flagged.has(m.id)) { out.push(m); continue; }
      const replacement = ranked.find((c) => !flagged.has(c.id) && !used.has(c.id));
      if (replacement) { out.push(replacement); used.add(replacement.id); }
      else { out.push(m); }  // No replacement available — keep the dimmed card.
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
      <div className="mb-3">
        <h2 id="match-me-title" className="font-['Poppins',sans-serif] text-[22px] font-bold text-[#23297e] leading-tight">
          What's your fit today?
        </h2>
        <p className="font-['Poppins',sans-serif] text-sm text-gray-600 mt-0.5">
          Move the sliders to find actions that match how you're feeling. Your sample matches update live.
        </p>
      </div>

      {/* Setting + (conditional) state. State only matters when the user is
        * open to in-person actions — online/at-home cards aren't state-bound. */}
      <div className="mb-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-sm leading-tight shrink-0">
            Where do you want to act?
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {SETTING_OPTIONS.map((opt) => {
              const selected = prefs.setting.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  onClick={() =>
                    onPrefsChange((p) => ({
                      ...p,
                      setting: selected
                        ? p.setting.filter((s) => s !== opt.value)
                        : [...p.setting, opt.value],
                    }))
                  }
                  aria-pressed={selected}
                  className={`rounded-full border px-3 py-1 font-['Poppins',sans-serif] text-[12px] font-medium transition-colors ${
                    selected
                      ? "border-[#fd8e33] bg-[#fd8e33] text-white"
                      : "border-gray-400 text-gray-700 hover:border-[#fd8e33] hover:text-[#fd8e33]"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
            <button
              onClick={() => onPrefsChange((p) => ({ ...p, setting: [] }))}
              aria-pressed={prefs.setting.length === 0}
              className={`rounded-full border px-3 py-1 font-['Poppins',sans-serif] text-[12px] font-medium transition-colors ${
                prefs.setting.length === 0
                  ? "border-[#fd8e33] bg-[#fd8e33] text-white"
                  : "border-gray-400 text-gray-700 hover:border-[#fd8e33] hover:text-[#fd8e33]"
              }`}
            >
              Both
            </button>
          </div>
        </div>

        {/* State picker — sub-question, indented under the In-person pill. */}
        {(prefs.setting.length === 0 || prefs.setting.includes("inPerson")) && (
          <div className="mt-2 ml-[180px] flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="font-['Poppins',sans-serif] text-xs text-gray-500 shrink-0">
              ↳ Where are you?
            </span>
            <select
              value={prefs.state ?? ""}
              onChange={(e) => onPrefsChange((p) => ({ ...p, state: e.target.value || null }))}
              className={`rounded-lg border border-gray-300 px-3 py-1 font-['Poppins',sans-serif] text-xs focus:outline-none focus:ring-2 focus:ring-[#23297e]/30 focus:border-[#23297e] ${
                prefs.state ? "text-gray-800" : "text-gray-400 italic"
              }`}
            >
              <option value="">— pick your state —</option>
              {STATE_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {prefs.state && (
              <label className="flex items-center gap-1.5 cursor-pointer select-none whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={prefs.includeAnywhere}
                  onChange={(e) => onPrefsChange((p) => ({ ...p, includeAnywhere: e.target.checked }))}
                  className="w-4 h-4 rounded accent-[#fd8e33]"
                />
                <span className="font-['Poppins',sans-serif] text-xs text-gray-600">
                  Show all states, prioritize mine
                </span>
              </label>
            )}
          </div>
        )}
      </div>

      {/* Time + tone sliders — horizontal layout, label left + slider right. */}
      <h3 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-sm leading-tight mb-1.5">
        How are you feeling today?
      </h3>
      <div className="space-y-1 mb-3">
        {/* Time — first slider, drives time bucket. */}
        {(() => {
          const tIdx = timeIndex(prefs.time);
          const tLevel = TIME_LEVELS[tIdx];
          return (
            <div className="flex items-center gap-1.5">
              <div className="w-[260px] shrink-0 flex items-start gap-1">
                <Clock size={13} strokeWidth={2} className="text-[#23297e] mt-[1px] shrink-0" />
                <div className="leading-tight">
                  <div className="font-['Poppins',sans-serif] font-semibold text-[12px] text-[#23297e]">
                    Time Commitment
                  </div>
                  <div className="font-['Poppins',sans-serif] text-[10px] text-gray-500">
                    <span className="font-semibold text-[#fd8e33]">{tLevel.title}</span> — {tLevel.desc}
                  </div>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <ToneRangeSlider
                  value={tIdx}
                  onChange={(v) =>
                    onPrefsChange((p) => ({ ...p, time: TIME_LEVELS[v].key }))
                  }
                  max={3}
                />
              </div>
            </div>
          );
        })()}

        {(["anger", "comedy", "subversion", "hope", "energy"] as const).map((k) => {
          const { Icon, label, desc } = TONE_LABELS[k];
          return (
            <div key={k} className="flex items-center gap-1.5">
              <div className="w-[260px] shrink-0 flex items-start gap-1">
                <Icon size={13} strokeWidth={2} className="text-[#23297e] mt-[1px] shrink-0" />
                <div className="leading-tight">
                  <div className="font-['Poppins',sans-serif] font-semibold text-[12px] text-[#23297e]">
                    {label}
                  </div>
                  <div className="font-['Poppins',sans-serif] text-[10px] text-gray-500">
                    {desc}
                  </div>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <ToneRangeSlider
                  value={tone[k]}
                  onChange={(v) => setTone({ ...tone, [k]: v })}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-gray-200 pt-3">
        <h3 className="font-['Poppins',sans-serif] text-xs font-bold uppercase tracking-wider text-gray-500 mb-0.5">
          Sample Matches
        </h3>
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <p className="font-['Poppins',sans-serif] text-[12px] text-gray-600">
            Some quick actions that align with your settings — let us know if these feel right?
          </p>
          <p className="font-['Poppins',sans-serif] text-[10.5px] italic text-gray-400 whitespace-nowrap shrink-0">
            Off the mark? Tap 👎 to teach the matcher.
          </p>
        </div>
        {visibleMatches.length === 0 ? (
          <p className="font-['Poppins',sans-serif] text-sm italic text-gray-500 mb-3">
            Move the sliders to see matches.
          </p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            {visibleMatches.map((m) => {
              const isFlagged = flagged.has(m.id);
              return (
                <li key={m.id} className="flex flex-col gap-2 min-w-0">
                  <div className={`flex-1 transition-opacity ${isFlagged ? "opacity-40" : ""}`}>
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
                          : "border-gray-300 text-gray-700 hover:border-[#fd8e33] hover:text-[#fd8e33] hover:bg-[#fd8e33]/5"
                      }`}
                    >
                      <span className="text-lg leading-none">👎</span>
                      <span>{isFlagged ? "Thanks!" : "Not a good match"}</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Twin CTAs:
         *   primary  → apply current prefs and dive into the full filtered feed
         *   secondary → step 1 (vulnerable groups) to refine for who they are
         * Both are orange because both are valid forward actions; the primary
         * is solid (most users will tap this), the secondary is outline so it
         * doesn't compete visually. */}
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
          <ProgressDots step={step} total={totalSteps} />
          <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2">
            <button
              onClick={onNext}
              className="inline-flex items-center justify-center gap-1.5 rounded-full border-2 border-[#fd8e33] bg-white px-5 py-2.5 font-['Poppins',sans-serif] text-sm font-bold text-[#fd8e33] hover:bg-[#fd8e33]/5 transition-colors"
            >
              <Sparkles size={15} strokeWidth={2.5} />
              Sharpen matches — tell us who you are
            </button>
            <button
              onClick={onApply}
              disabled={matches.length === 0}
              className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[#fd8e33] px-6 py-2.5 font-['Poppins',sans-serif] text-sm font-bold text-white shadow-md hover:bg-[#e6792a] hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              Show Me More Matches! <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Slider stops for the involvement picker. The 6-bucket TimeBucket folds into
// these 4 visible levels — `1hr` rounds to "A little", `fullDay` to "Regularly".
const TIME_LEVELS: { key: TimeBucket; title: string; desc: string }[] = [
  { key: "5min",     title: "Just the basics",  desc: "< 5 minutes" },
  { key: "30min",    title: "A little",         desc: "A few hours per month" },
  { key: "fewHours", title: "Regularly",        desc: "A few hours per week" },
  { key: "ongoing",  title: "All in",           desc: "Ongoing organizing" },
];

function timeIndex(t: TimeBucket | null): number {
  if (!t) return 1;
  const i = TIME_LEVELS.findIndex((l) => l.key === t);
  if (i >= 0) return i;
  if (t === "1hr") return 1;
  if (t === "fullDay") return 2;
  return 1;
}

// ─── Step 1: vulnerable-group affinity (own page) ────────────────────────────

function StepGroups({
  value,
  onToggle,
  onClear,
  focusDonations,
  onFocusDonationsChange,
}: {
  value: VulnerableGroup[];
  onToggle: (g: VulnerableGroup) => void;
  onClear: () => void;
  focusDonations: boolean;
  onFocusDonationsChange: (v: boolean) => void;
}) {
  return (
    <div>
      {/* ── Targeted-group affinity (first question) ─────────────────────── */}
      <div className="mb-5">
        <h3 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-base leading-tight mb-1">
          Do you want to focus on a particular group being targeted?
        </h3>
        <p className="font-['Poppins',sans-serif] text-xs text-gray-500 mb-3">
          Optional. We'll prioritize actions centered on the group(s) you pick.
        </p>
        <GroupsDropdown value={value} onToggle={onToggle} onClear={onClear} defaultOpen />
      </div>

      {/* ── Donation-focus opt-in (second question) ─────────────────────── */}
      <div>
        <h3 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-base leading-tight mb-1">
          Include laser-focused donation guidance?
        </h3>
        <p className="font-['Poppins',sans-serif] text-xs text-gray-500 mb-3">
          As we get closer to the midterms we will point you to the closest, most pivotal races — the ones where every extra dollar tips the outcome. Skip the spray-and-pray fundraising lists.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onFocusDonationsChange(true)}
            aria-pressed={focusDonations}
            className={`rounded-full border px-4 py-1.5 font-['Poppins',sans-serif] text-[13px] font-medium transition-colors ${
              focusDonations
                ? "border-[#fd8e33] bg-[#fd8e33] text-white"
                : "border-gray-300 text-gray-700 hover:border-[#fd8e33] hover:text-[#fd8e33]"
            }`}
          >
            Yes — show me the high-leverage races
          </button>
          <button
            type="button"
            onClick={() => onFocusDonationsChange(false)}
            aria-pressed={!focusDonations}
            className={`rounded-full border px-4 py-1.5 font-['Poppins',sans-serif] text-[13px] font-medium transition-colors ${
              !focusDonations
                ? "border-[#23297e] bg-[#23297e] text-white"
                : "border-gray-300 text-gray-700 hover:border-[#23297e] hover:text-[#23297e]"
            }`}
          >
            No thanks — I'm using my sweat equity alone, doing ResistActs as often as possible
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
    <p className="mt-3 flex items-start justify-end gap-1.5 font-['Poppins',sans-serif] text-[11px] leading-[1.5] text-gray-500 text-right">
      <CircleAlert size={13} className="shrink-0 mt-[1.5px]" />
      <span>
        <strong className="font-semibold">NOTE:</strong>{" "}
        {isLoggedIn
          ? "Selections live on this device and on your profile so they follow you across devices."
          : "Selections live on this device. If you create an account, we'll save them to your profile so they follow you across devices."}
      </span>
    </p>
  );
}

