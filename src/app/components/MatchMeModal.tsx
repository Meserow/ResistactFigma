import { useEffect, useMemo, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, Clock, Flame, Laugh, Lock, Sparkles, Sunrise, ThumbsDown, VenetianMask, Zap } from "lucide-react";
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

  // When the user picks In-person + a state, guarantee at least one of the 4
  // quick matches is genuinely local to that state. Without this, a Louisiana
  // user could see three Multi-state Tesla protests scoring higher than any
  // Louisiana-specific action — technically correct, but unhelpful.
  const matches = useMemo(() => {
    // Slot 1 is always "Spread the Word about ResistAct" (id=1) until the
    // user has marked it done — it's the cheapest, most-impactful first
    // action and reinforces the social-graph growth flywheel.
    const ranked = rankCards(cards, prefs, userCtx);
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

    // Then walk the ranking and fill slots 2-4 with UNIQUE images so the
    // preview doesn't show two Tesla cards back-to-back. Falls back to score
    // order if we run out of unique-image cards before we hit 4.
    const picked: ActionCardData[] = [];
    const seenImages = new Set<string>();
    if (spreadCard) {
      picked.push(spreadCard);
      const img = (spreadCard.topImage ?? "").trim();
      if (img) seenImages.add(img);
    }
    for (const c of ranked) {
      if (picked.length >= 4) break;
      if (spreadCard && c.id === spreadCard.id) continue;
      const img = (c.topImage ?? "").trim();
      if (img && seenImages.has(img)) continue;
      if (img) seenImages.add(img);
      picked.push(c);
    }
    if (picked.length < 4) {
      const pickedIds = new Set(picked.map((c) => c.id));
      for (const c of ranked) {
        if (picked.length >= 4) break;
        if (pickedIds.has(c.id)) continue;
        picked.push(c);
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
         * privacy footnote tucked beneath the buttons on the right. */}
        {step === 1 && (
          <div className="mt-6 flex items-start justify-between gap-4 border-t border-gray-200 pt-4">
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
      <div className="mb-5">
        <h2 id="match-me-title" className="font-['Poppins',sans-serif] text-[20px] font-semibold text-[#23297e] leading-tight">
          Quick Match Tool
        </h2>
      </div>

      {/* Setting + (conditional) state. State only matters when the user is
        * open to in-person actions — online/at-home cards aren't state-bound. */}
      <div className="mb-5 mt-4">
        <h3 className="font-['Poppins',sans-serif] font-semibold text-gray-800 text-sm leading-tight mb-1.5">
          Where do you want to act?
        </h3>
        <div className="pl-5">
          <div className="flex flex-wrap items-center gap-1.5">
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
            {/* State picker — inline on the same row as the setting pills,
                only when in-person (or unset / "Both") is in play. */}
            {(prefs.setting.length === 0 || prefs.setting.includes("inPerson")) && (
              <>
                <span className="font-['Poppins',sans-serif] text-xs text-gray-500 shrink-0 ml-1">
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
              </>
            )}
          </div>
        </div>
      </div>

      {/* Time + tone sliders — two-column grid, calmed visual weight.
       *   • Section title is the only navy heading on the page (anchors hierarchy)
       *   • Slider labels demoted to medium-gray (was bold navy x6)
       *   • Descriptions shrunk to 10.5px gray-500
       *   • Each slider capped + flanked by tiny 0 / 3 endpoint labels
       *   • Names indented past the icon for a cleaner left edge
       */}
      <h3 className="font-['Poppins',sans-serif] font-semibold text-gray-800 text-sm leading-tight mb-3 mt-6">
        What kind of actions are you up for?
      </h3>
      <div className="pl-5 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2 mb-3">
        {/* Time — first slider, drives time bucket. */}
        {(() => {
          const tIdx = timeIndex(prefs.time);
          const tLevel = TIME_LEVELS[tIdx];
          return (
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5 pl-1">
                <Clock size={12} strokeWidth={1.75} className="text-gray-500 shrink-0" />
                <span className="font-['Poppins',sans-serif] font-medium text-[12px] text-gray-800">
                  Time Commitment
                </span>
                <span className="font-['Poppins',sans-serif] text-[10.5px] text-gray-500 truncate">
                  · <span className="font-medium text-[#fd8e33]">{tLevel.title}</span> — {tLevel.desc}
                </span>
              </div>
              <div className="pl-5">
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
            <div key={k} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5 pl-1">
                <Icon size={12} strokeWidth={1.75} className="text-gray-500 shrink-0" />
                <span className="font-['Poppins',sans-serif] font-medium text-[12px] text-gray-800">
                  {label}
                </span>
                <span className="font-['Poppins',sans-serif] text-[10.5px] text-gray-500 truncate">
                  · {desc}
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

      <div className="border-t border-gray-200 pt-5 mt-5">
        <h3 className="font-['Poppins',sans-serif] text-xs font-bold uppercase tracking-wider text-gray-500 mb-0.5">
          Quick Matches
        </h3>
        <div className="mb-2">
          <p className="font-['Poppins',sans-serif] text-[12px] text-gray-600">
            Some quick actions that align with your settings above — let us know if these feel right?
          </p>
        </div>
        {visibleMatches.length === 0 ? (
          <p className="font-['Poppins',sans-serif] text-sm italic text-gray-500 mb-3 min-h-[240px]">
            Move the sliders to see matches.
          </p>
        ) : (
          // Fixed row height keeps the modal from jumping as different cards
          // swap in/out while the user drags sliders. 240px fits a compact
          // card with 2-line description; shorter cards just get a small
          // blank space below.
          <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 min-h-[240px]">
            {visibleMatches.map((m) => {
              const isFlagged = flagged.has(m.id);
              return (
                <li key={m.id} className="flex flex-col gap-2 min-w-0 h-[240px]">
                  {/* p-px so the inner ActionCard's shadow doesn't get clipped
                      by the flex bounds. ring on this wrapper gives a crisp
                      hairline border that reads well in the modal context. */}
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
                          : "border-[#fd8e33] text-gray-700 hover:bg-[#fd8e33]/10 hover:text-[#fd8e33]"
                      }`}
                    >
                      <ThumbsDown size={14} strokeWidth={2} className="shrink-0" />
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
              className="inline-flex items-center justify-center gap-1.5 rounded-full border border-[#23297e] bg-white px-5 py-2.5 font-['Poppins',sans-serif] text-sm font-medium text-[#23297e] hover:bg-[#23297e]/5 transition-colors"
            >
              <Sparkles size={14} strokeWidth={2} />
              Sharpen your matches — tell us more about who you are
            </button>
            <button
              onClick={onApply}
              disabled={matches.length === 0}
              className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[#23297e] px-6 py-2.5 font-['Poppins',sans-serif] text-sm font-semibold text-white shadow-sm hover:bg-[#1a2060] hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              Show me more matches <ChevronRight size={15} strokeWidth={2} />
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
          As we get closer to the midterms we'll add to your matches the closest, most pivotal races — the ones where every extra dollar tips the outcome. Avoid the spray-and-pray fundraising lists.
        </p>
        <div className="flex flex-col sm:flex-row items-stretch gap-2">
          <button
            type="button"
            onClick={() => onFocusDonationsChange(true)}
            aria-pressed={focusDonations}
            className={`inline-flex flex-col items-start rounded-2xl border px-4 py-2 font-['Poppins',sans-serif] text-left transition-colors ${
              focusDonations
                ? "border-[#fd8e33] bg-[#fd8e33] text-white"
                : "border-gray-300 bg-white text-gray-700 hover:border-[#fd8e33] hover:text-[#fd8e33]"
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
          : "Until you login, match settings live temporarily on this device so you can operate anonymously. If you create an account, we'll save them to your profile so they follow you across devices. But no matter what, we're not using your data for evil nor sharing it with anyone."}
      </span>
    </p>
  );
}

