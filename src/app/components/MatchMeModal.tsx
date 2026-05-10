import { useEffect, useMemo, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, CircleAlert, Flame, Laugh, VenetianMask, Sunrise, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ToneRangeSlider } from "./ToneSlider";
import { InvolvementPicker } from "./InvolvementPicker";
import {
  DEFAULT_PREFERENCES,
  explainMatch,
  loadPreferences,
  savePreferences,
  topN,
  type Preferences,
  type Setting,
  type VulnerableGroup,
} from "../lib/matcher";
import { LOCATION_OPTIONS } from "../lib/locations";
import type { ActionCardData } from "./ActionCard";
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
}

const SETTING_OPTIONS: { value: Setting; label: string }[] = [
  { value: "online",   label: "Online only" },
  { value: "atHome",   label: "At home" },
  { value: "inPerson", label: "In-person" },
];

// State picker options — actual US states only. "Online", "National", and
// "Multi-state" aren't picked here because they're not where a *user* lives;
// the state filter passes those locations through automatically.
const STATE_OPTIONS = LOCATION_OPTIONS.filter(
  (o) => o !== "Online" && o !== "National" && o !== "Multi-state"
);

const TONE_LABELS: Record<"anger" | "comedy" | "subversion" | "hope" | "energy", { Icon: LucideIcon; label: string; desc: string }> = {
  anger:      { Icon: Flame,        label: "Angry",      desc: "Confrontational, serious efforts" },
  comedy:     { Icon: Laugh,        label: "Funny",      desc: "Mockery, irreverence, prank" },
  subversion: { Icon: VenetianMask, label: "Subversive", desc: "Disruptive, off the beaten path" },
  hope:       { Icon: Sunrise,      label: "Hope",       desc: "Uplifting, optimistic, building" },
  energy:     { Icon: Zap,          label: "Energy",     desc: "How fired-up are you today?" },
};

type Step = 0 | 1 | 2;
const TOTAL_STEPS = 3;

export function MatchMeModal({ cards, onClose, onApply, isLoggedIn = false }: MatchMeModalProps) {
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

  const matches = useMemo(() => topN(cards, prefs, 3), [cards, prefs]);

  function next() { setStep((s) => Math.min(2, (s + 1) as Step)); }
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
        className="hero-modal-card relative w-full max-w-[840px] max-h-[90vh] overflow-y-auto rounded-[10px] bg-white p-5 sm:p-7 shadow-2xl"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-[#f0e8de] hover:text-[#23297e]"
        >
          <X size={20} />
        </button>

        {/* Progress dots */}
        <div className="mb-5 flex justify-center gap-1.5">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === step ? "w-8 bg-[#fd8e33]" : i < step ? "w-1.5 bg-[#fd8e33]" : "w-1.5 bg-gray-300"}`}
            />
          ))}
        </div>

        {step === 0 && (
          <StepToneAndPreview
            prefs={prefs}
            onPrefsChange={setPrefs}
            matches={matches}
            onNext={next}
          />
        )}

        {step === 1 && (
          <StepFilters
            prefs={prefs}
            onPrefsChange={setPrefs}
          />
        )}

        {step === 2 && (
          <StepGroups
            value={prefs.vulnerableGroups}
            onToggle={toggleGroup}
            onClear={() => setPrefs((p) => ({ ...p, vulnerableGroups: [] }))}
          />
        )}

        {/* Step 1 footer — Back to tone | Next to groups */}
        {step === 1 && (
          <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4">
            <button
              onClick={prev}
              className="inline-flex items-center gap-1 font-['Poppins',sans-serif] text-sm font-medium text-gray-600 hover:text-[#23297e]"
            >
              <ChevronLeft size={16} /> Back
            </button>
            <button
              onClick={next}
              className="inline-flex items-center gap-1 rounded-full bg-[#23297e] px-5 py-2.5 font-['Poppins',sans-serif] text-sm font-bold text-white hover:bg-[#1a2060]"
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
        )}

        {/* Step 2 footer — Back to filters | Apply (Show me my matches) +
         * privacy footnote tucked beneath. */}
        {step === 2 && (
          <>
            <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4">
              <button
                onClick={prev}
                className="inline-flex items-center gap-1 font-['Poppins',sans-serif] text-sm font-medium text-gray-600 hover:text-[#23297e]"
              >
                <ChevronLeft size={16} /> Back
              </button>
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
  prefs,
  onPrefsChange,
  matches,
  onNext,
}: {
  prefs: Preferences;
  onPrefsChange: React.Dispatch<React.SetStateAction<Preferences>>;
  matches: ActionCardData[];
  onNext: () => void;
}) {
  const tone = prefs.tone;
  const setTone = (next: Preferences["tone"]) =>
    onPrefsChange((p) => ({ ...p, tone: next }));
  // Track which result rows the user has flagged as a bad match this session.
  const [flagged, setFlagged] = useState<Set<number>>(new Set());

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
      <h2 id="match-me-title" className="font-['Poppins',sans-serif] text-[18px] font-bold text-[#23297e] mb-3">
        What's your fit today?
      </h2>

      <div className="space-y-2 mb-3">
        {(["anger", "comedy", "subversion", "hope", "energy"] as const).map((k) => {
          const { Icon, label, desc } = TONE_LABELS[k];
          return (
            <div key={k} className="space-y-1">
              <div className="flex items-center">
                <Icon size={15} strokeWidth={2} className="text-[#23297e] mr-1.5 shrink-0" />
                <strong className="font-['Poppins',sans-serif] font-semibold text-sm text-[#23297e]">
                  {label}
                </strong>
                <span className="ml-2 font-['Poppins',sans-serif] text-xs text-gray-500">
                  {desc}
                </span>
              </div>
              <ToneRangeSlider
                value={tone[k]}
                onChange={(v) => setTone({ ...tone, [k]: v })}
              />
            </div>
          );
        })}
      </div>

      <div className="border-t border-gray-200 pt-3">
        <h3 className="font-['Poppins',sans-serif] text-xs font-bold uppercase tracking-wider text-gray-500 mb-0.5">
          A few quick matches
        </h3>
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <p className="font-['Poppins',sans-serif] text-[12px] text-gray-600">
            Some quick actions that align with your settings — let us know if these feel right?
          </p>
          <p className="font-['Poppins',sans-serif] text-[10.5px] italic text-gray-400 whitespace-nowrap shrink-0">
            Off the mark? Tap 👎 to teach the matcher.
          </p>
        </div>
        {matches.length === 0 ? (
          <p className="font-['Poppins',sans-serif] text-sm italic text-gray-500 mb-3">
            Move the sliders to see matches.
          </p>
        ) : (
          <ol className="space-y-1.5 mb-4">
            {matches.map((m, i) => {
              const reasons = explainMatch(m, prefs);
              const isFlagged = flagged.has(m.id);
              return (
                <li
                  key={m.id}
                  className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 transition-opacity ${
                    isFlagged ? "border-gray-200 opacity-50" : "border-gray-200"
                  }`}
                >
                  <span className="font-['Poppins',sans-serif] text-base font-bold text-[#fd8e33] shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p
                      className="font-['Poppins',sans-serif] text-[11px] font-bold uppercase tracking-wider mb-0.5"
                      style={{ color: m.categoryColor }}
                    >
                      {m.category}
                    </p>
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                      <p className="font-['Poppins',sans-serif] text-sm font-semibold text-gray-900 leading-tight sm:flex-1 sm:min-w-0">
                        {m.title}
                      </p>
                      {/* Right cluster: 2-up reasons grid + thumbs-down inline
                       * to the right of the badges, vertically centered. */}
                      <div className="flex items-center gap-2 sm:shrink-0">
                        {reasons.length > 0 && (
                          <div className="flex flex-col gap-0.5 items-start sm:items-end">
                            {Array.from({ length: Math.ceil(reasons.length / 2) }).map((_, rowIdx) => (
                              <ul key={rowIdx} className="flex gap-1">
                                {reasons.slice(rowIdx * 2, rowIdx * 2 + 2).map((r) => (
                                  <li
                                    key={r}
                                    className="rounded-full bg-[#fd8e33]/10 px-2 py-0.5 font-['Poppins',sans-serif] text-[10px] font-medium text-[#23297e] whitespace-nowrap"
                                  >
                                    {r}
                                  </li>
                                ))}
                              </ul>
                            ))}
                          </div>
                        )}
                        <button
                          onClick={() => handleBadMatch(m)}
                          disabled={isFlagged}
                          aria-label={isFlagged ? "Marked as bad match" : "Flag as bad match"}
                          title={isFlagged ? "Thanks — feedback recorded" : "Bad match? Let us know."}
                          className={`shrink-0 flex h-7 w-7 items-center justify-center rounded-full text-base leading-none transition-opacity ${
                            isFlagged ? "opacity-40 cursor-default" : "hover:bg-gray-100"
                          }`}
                        >
                          👎
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <div className="flex justify-end">
          <button
            onClick={onNext}
            className="inline-flex items-center gap-1 rounded-full bg-[#23297e] px-5 py-2.5 font-['Poppins',sans-serif] text-sm font-bold text-white hover:bg-[#1a2060]"
          >
            Next: a few details <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: involvement + location + setting ────────────────────────────────

function StepFilters({
  prefs,
  onPrefsChange,
}: {
  prefs: Preferences;
  onPrefsChange: React.Dispatch<React.SetStateAction<Preferences>>;
}) {
  return (
    <div className="space-y-3.5">
      {/* Involvement */}
      <InvolvementPicker
        value={prefs.time}
        onChange={(t) => onPrefsChange((p) => ({ ...p, time: t }))}
        question="How involved do you want to be?"
      />

      {/* Location — state dropdown + Anywhere reset checkbox on one row to
       * save vertical space. Picking a state from the dropdown sets the
       * filter; checking "Anywhere" clears it. */}
      <div>
        <h3 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-base leading-tight mb-1">
          Where are you?
        </h3>
        <p className="font-['Poppins',sans-serif] text-xs text-gray-500 mb-2.5">
          We'll skip in-person actions in other states. Online and at-home actions stay in either way.
        </p>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
          <select
            value={prefs.state ?? ""}
            onChange={(e) => onPrefsChange((p) => ({ ...p, state: e.target.value || null }))}
            className={`flex-1 rounded-lg border border-gray-300 px-4 py-2.5 font-['Poppins',sans-serif] text-sm focus:outline-none focus:ring-2 focus:ring-[#23297e]/30 focus:border-[#23297e] ${
              prefs.state ? "text-gray-800" : "text-gray-400 italic"
            }`}
          >
            <option value="">— pick your state —</option>
            {STATE_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 cursor-pointer select-none whitespace-nowrap">
            <input
              type="checkbox"
              checked={prefs.includeAnywhere}
              onChange={(e) => onPrefsChange((p) => ({ ...p, includeAnywhere: e.target.checked }))}
              className="w-4 h-4 rounded accent-[#fd8e33]"
            />
            <span className="font-['Poppins',sans-serif] font-normal text-sm text-gray-700">
              {prefs.state
                ? `But show me actions from anywhere, just prioritize ${prefs.state}`
                : "But show me actions from anywhere"}
            </span>
          </label>
        </div>
      </div>

      {/* Setting — multi-select. Empty array = "Any" (no filter); the Any pill
       * is highlighted in that state and clears the selection when clicked. */}
      <div>
        <h3 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-base leading-tight mb-1">
          How do you want to act?
        </h3>
        <p className="font-['Poppins',sans-serif] text-xs text-gray-500 mb-2.5">
          Pick one or more — on a screen, around the house, or out in the world.
        </p>
        <div className="flex flex-wrap gap-2">
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
                className={`rounded-full border px-4 py-2 font-['Poppins',sans-serif] text-[13px] font-medium transition-colors ${
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
            className={`rounded-full border px-4 py-2 font-['Poppins',sans-serif] text-[13px] font-medium transition-colors ${
              prefs.setting.length === 0
                ? "border-[#fd8e33] bg-[#fd8e33] text-white"
                : "border-gray-400 text-gray-700 hover:border-[#fd8e33] hover:text-[#fd8e33]"
            }`}
          >
            Any
          </button>
        </div>
      </div>

    </div>
  );
}

// ─── Step 2: vulnerable-group affinity (own page) ────────────────────────────

function StepGroups({
  value,
  onToggle,
  onClear,
}: {
  value: VulnerableGroup[];
  onToggle: (g: VulnerableGroup) => void;
  onClear: () => void;
}) {
  return (
    <div>
      <h3 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-base leading-tight mb-1">
        Are you part of a group being targeted?
      </h3>
      <p className="font-['Poppins',sans-serif] text-xs text-gray-500 mb-2.5">
        Optional. Helps us surface actions where your voice carries unique weight — and quiet warnings on actions that may put you at extra risk.
      </p>
      <GroupsDropdown value={value} onToggle={onToggle} onClear={onClear} />
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

