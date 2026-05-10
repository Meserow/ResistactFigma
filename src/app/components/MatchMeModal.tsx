import { useEffect, useMemo, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, CircleAlert, ThumbsDown, Flame, Laugh, VenetianMask, Sunrise, Zap } from "lucide-react";
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
  type TimeBucket,
  type VulnerableGroup,
} from "../lib/matcher";
import { LOCATION_OPTIONS } from "../lib/locations";
import type { ActionCardData } from "./ActionCard";

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
  /** Called when the user clicks "Show me more like these". Closes the modal
   * and tells the app to apply the preferences as the active filter+sort. */
  onApply: (prefs: Preferences) => void;
  /** Whether a user is signed in. Drives the wording on the Step 3 privacy
   * notice — anonymous users get an extra-loud "we are not recording you"
   * message; signed-in users get the same guarantee in less-shouting form. */
  isLoggedIn?: boolean;
}

const SETTING_OPTIONS: { value: Setting; label: string }[] = [
  { value: "online",   label: "Online only" },
  { value: "atHome",   label: "At home" },
  { value: "inPerson", label: "In-person" },
  { value: "either",   label: "Any" },
];

// State picker options — actual US states only. "Online", "National", and
// "Multi-state" aren't picked here because they're not where a *user* lives;
// the state filter passes those locations through automatically.
const STATE_OPTIONS = LOCATION_OPTIONS.filter(
  (o) => o !== "Online" && o !== "National" && o !== "Multi-state"
);

const GROUP_OPTIONS: { value: VulnerableGroup; label: string }[] = [
  { value: "immigrant",  label: "Immigrant (documented, undocumented, mixed status family)" },
  { value: "lgbtq",      label: "LGBTQIA+ / Trans" },
  { value: "repro",      label: "Seeking or providing reproductive care" },
  { value: "disabled",   label: "Disabled / chronically ill / medically challenged" },
  { value: "fedWorker",  label: "Federal worker / contractor" },
  { value: "journalist", label: "Journalist / researcher" },
  { value: "woman",      label: "Woman" },
];

const TONE_LABELS: Record<"anger" | "comedy" | "subversion" | "hope" | "energy", { Icon: LucideIcon; label: string; desc: string }> = {
  anger:      { Icon: Flame,        label: "Angry",      desc: "Confrontational, serious efforts" },
  comedy:     { Icon: Laugh,        label: "Funny",      desc: "Mockery, irreverence, prank" },
  subversion: { Icon: VenetianMask, label: "Subversive", desc: "Disruptive, off the beaten path" },
  hope:       { Icon: Sunrise,      label: "Hope",       desc: "Uplifting, optimistic, building" },
  energy:     { Icon: Zap,          label: "Energy",     desc: "How fired-up are you today?" },
};

type Step = 0 | 1 | 2 | 3 | 4;
const TOTAL_STEPS = 5;

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

  const matches = useMemo(() => topN(cards, prefs, 5), [cards, prefs]);

  function next() { setStep((s) => Math.min(4, (s + 1) as Step)); }
  function prev() { setStep((s) => Math.max(0, (s - 1) as Step)); }

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
        className="hero-modal-card relative w-full max-w-[600px] max-h-[90vh] overflow-y-auto rounded-[10px] bg-white p-6 sm:p-8 shadow-2xl"
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
          <StepIntro onStart={() => setStep(1)} />
        )}

        {step === 1 && (
          <StepLocation
            value={prefs.state}
            onChange={(state) => setPrefs((p) => ({ ...p, state }))}
          />
        )}

        {step === 2 && (
          <StepSetting
            value={prefs.setting}
            onChange={(setting) => setPrefs((p) => ({ ...p, setting }))}
          />
        )}

        {step === 3 && (
          <StepGroups
            value={prefs.vulnerableGroups}
            onChange={(vulnerableGroups) => setPrefs((p) => ({ ...p, vulnerableGroups }))}
            isLoggedIn={isLoggedIn}
          />
        )}

        {step === 4 && (
          <StepResultsAndTone
            prefs={prefs}
            onPrefsChange={(updater) => setPrefs(updater)}
            matches={matches}
            onApply={() => onApply(prefs)}
          />
        )}

        {/* Footer nav */}
        {step > 0 && (
          <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4">
            <button
              onClick={prev}
              className="inline-flex items-center gap-1 font-['Poppins',sans-serif] text-sm font-medium text-gray-600 hover:text-[#23297e]"
            >
              <ChevronLeft size={16} /> Back
            </button>
            {step < 4 && (
              <button
                onClick={next}
                className="inline-flex items-center gap-1 rounded-full bg-[#23297e] px-5 py-2 font-['Poppins',sans-serif] text-sm font-bold text-white hover:bg-[#1a2060]"
              >
                Next <ChevronRight size={16} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step 0: intro ────────────────────────────────────────────────────────────

function StepIntro({ onStart }: { onStart: () => void }) {
  return (
    <div className="text-center">
      <h2 id="match-me-title" className="font-['Poppins',sans-serif] text-[24px] font-bold text-[#23297e] mb-3">
        What's your fit today?
      </h2>
      <p className="font-['Poppins',sans-serif] text-[15px] text-gray-700 leading-[1.65] mb-6">
        A few quick questions and we'll surface the actions that fit your location, your situation, and your mood right now.
      </p>
      <button
        onClick={onStart}
        className="inline-flex items-center rounded-full bg-[#fd8e33] px-6 py-3 font-['Poppins',sans-serif] text-sm font-bold text-white hover:bg-[#d96612]"
      >
        Match me
      </button>
    </div>
  );
}

// ─── Step 1: location ─────────────────────────────────────────────────────────

function StepLocation({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div>
      <h2 className="font-['Poppins',sans-serif] text-[20px] font-bold text-[#23297e] mb-2">
        Where are you?
      </h2>
      <p className="font-['Poppins',sans-serif] text-sm text-gray-600 mb-4">
        We'll skip in-person actions in other states. Online and at-home actions stay in either way.
      </p>

      <div className="space-y-2.5">
        {/* Anywhere pill — pinned at top */}
        <button
          onClick={() => onChange(null)}
          className={`w-full text-left rounded-lg border px-4 py-3 font-['Poppins',sans-serif] text-sm transition-colors ${
            value === null
              ? "border-[#fd8e33] bg-[#fd8e33]/10 text-[#23297e] font-semibold"
              : "border-gray-300 text-gray-700 hover:border-gray-400"
          }`}
        >
          🌍 Anywhere — show me everything
        </button>

        {/* State dropdown */}
        <select
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          className="w-full rounded-lg border border-gray-300 px-4 py-3 font-['Poppins',sans-serif] text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#23297e]/30 focus:border-[#23297e]"
        >
          <option value="">— pick your state —</option>
          {STATE_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ─── Step 2: setting (action type) ────────────────────────────────────────────

function StepSetting({ value, onChange }: { value: Setting | null; onChange: (v: Setting | null) => void }) {
  return (
    <div>
      <h2 className="font-['Poppins',sans-serif] text-[20px] font-bold text-[#23297e] mb-2">
        How do you want to act?
      </h2>
      <p className="font-['Poppins',sans-serif] text-sm text-gray-600 mb-5">
        On a screen, around the house, or out in the world.
      </p>
      <PillRow
        options={SETTING_OPTIONS}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}

// ─── Step 3: vulnerable groups ────────────────────────────────────────────────

function StepGroups({
  value,
  onChange,
  isLoggedIn,
}: {
  value: VulnerableGroup[];
  onChange: (v: VulnerableGroup[]) => void;
  isLoggedIn: boolean;
}) {
  function toggle(g: VulnerableGroup) {
    onChange(value.includes(g) ? value.filter((x) => x !== g) : [...value, g]);
  }
  return (
    <div>
      <h2 className="font-['Poppins',sans-serif] text-[20px] font-bold text-[#23297e] mb-2">
        Are you part of a group being targeted?
      </h2>
      <p className="font-['Poppins',sans-serif] text-sm text-gray-600 mb-5">
        Optional. Helps us surface actions where your voice carries unique weight — and quiet warnings on actions that may put you at extra risk.
      </p>

      <div className="space-y-2 mb-5">
        {GROUP_OPTIONS.map((g) => {
          const checked = value.includes(g.value);
          return (
            <button
              key={g.value}
              onClick={() => toggle(g.value)}
              className={`w-full text-left rounded-lg border px-4 py-3 font-['Poppins',sans-serif] text-sm transition-colors ${
                checked
                  ? "border-[#fd8e33] bg-[#fd8e33]/10 text-[#23297e] font-semibold"
                  : "border-gray-300 text-gray-700 hover:border-gray-400"
              }`}
            >
              <span className={`mr-2 inline-block h-4 w-4 rounded border align-middle ${checked ? "border-[#fd8e33] bg-[#fd8e33]" : "border-gray-400"}`}>
                {checked && <span className="block text-center text-[10px] leading-4 text-white">✓</span>}
              </span>
              {g.label}
            </button>
          );
        })}
      </div>

      {/* Privacy notice — pink so it's visually distinct from the orange-tinted
       * selected checklist items. Louder copy when the user is anonymous. */}
      <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 font-['Poppins',sans-serif] text-[13px] leading-[1.5] ${
        isLoggedIn
          ? "border-[#ec4899] bg-[#fdf2f8] text-[#831843]"
          : "border-[#ec4899] bg-[#fce7f3] text-[#831843]"
      }`}>
        <CircleAlert size={18} className="shrink-0 mt-0.5" />
        <span>
          {isLoggedIn ? (
            <>
              <strong>NOTE:</strong> This stays on your device. Your selections are saved in your browser only — not sent to our servers or anywhere else, not tied to your account.
            </>
          ) : (
            <>
              <strong>NOTE: We are not recording any of this.</strong> You're not signed in, and these selections never leave your browser. Nothing is sent to ResistAct's servers or anywhere else.
            </>
          )}
        </span>
      </div>
    </div>
  );
}

// ─── Step 3 (final): time + energy + tone sliders + results preview ──────────

function StepResultsAndTone({
  prefs,
  onPrefsChange,
  matches,
  onApply,
}: {
  prefs: Preferences;
  onPrefsChange: (updater: (prev: Preferences) => Preferences) => void;
  matches: ActionCardData[];
  onApply: () => void;
}) {
  const tone = prefs.tone;
  const setTone = (next: Preferences["tone"]) =>
    onPrefsChange((p) => ({ ...p, tone: next }));
  // Track which result rows the user has flagged as a bad match this session.
  // We don't unflag on click; one click logs and shows visual confirmation.
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
      <h2 className="font-['Poppins',sans-serif] text-[20px] font-bold text-[#23297e] mb-2">
        What fits you right now?
      </h2>
      <p className="font-['Poppins',sans-serif] text-sm text-gray-600 mb-4">
        Slide each one. Watch the matches below shift as you tune.
      </p>

      <div className="space-y-4 mb-5">
        {/* Involvement picker — 4 cards, mapped to TimeBucket */}
        <InvolvementPicker
          value={prefs.time}
          onChange={(t) => onPrefsChange((p) => ({ ...p, time: t }))}
          question="How involved do you want to be?"
          hint="You can change this anytime."
        />

        {/* Tone + energy sliders — 0-3 each */}
        {(["anger", "comedy", "subversion", "hope", "energy"] as const).map((k) => {
          const { Icon, label, desc } = TONE_LABELS[k];
          return (
            <div key={k} className="space-y-1.5">
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

      <div className="border-t border-gray-200 pt-4">
        <h3 className="font-['Poppins',sans-serif] text-sm font-bold uppercase tracking-wider text-gray-500 mb-3">
          Top matches for you
        </h3>
        {matches.length === 0 ? (
          <p className="font-['Poppins',sans-serif] text-sm italic text-gray-500 mb-4">
            No matches yet — try loosening your filters.
          </p>
        ) : (
          <ol className="space-y-2 mb-5">
            {matches.map((m, i) => {
              const reasons = explainMatch(m, prefs);
              const isFlagged = flagged.has(m.id);
              return (
                <li
                  key={m.id}
                  className={`flex items-start gap-3 rounded-lg border p-3 transition-opacity ${
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
                    <p className="font-['Poppins',sans-serif] text-sm font-semibold text-gray-900 leading-tight mb-1.5">
                      {m.title}
                    </p>
                    {reasons.length > 0 && (
                      <ul className="flex flex-wrap gap-1 mt-1">
                        {reasons.map((r) => (
                          <li
                            key={r}
                            className="rounded-full bg-[#fd8e33]/10 px-2 py-0.5 font-['Poppins',sans-serif] text-[10px] font-medium text-[#23297e]"
                          >
                            {r}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <button
                    onClick={() => handleBadMatch(m)}
                    disabled={isFlagged}
                    aria-label={isFlagged ? "Marked as bad match" : "Flag as bad match"}
                    title={isFlagged ? "Thanks — feedback recorded" : "Bad match? Let us know."}
                    className={`shrink-0 flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                      isFlagged
                        ? "bg-gray-200 text-gray-500 cursor-default"
                        : "text-gray-400 hover:bg-gray-100 hover:text-[#fd8e33]"
                    }`}
                  >
                    <ThumbsDown size={14} />
                  </button>
                </li>
              );
            })}
          </ol>
        )}

        <button
          onClick={onApply}
          disabled={matches.length === 0}
          className="w-full rounded-full bg-[#fd8e33] px-6 py-3 font-['Poppins',sans-serif] text-sm font-bold text-white hover:bg-[#d96612] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Show me more like these
        </button>
      </div>
    </div>
  );
}

// ─── Reusable: pill row ───────────────────────────────────────────────────────

function PillRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(selected ? null : opt.value)}
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
    </div>
  );
}
