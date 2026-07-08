/**
 * 5-card picker that replaces the 7-stop time slider in the matcher and
 * collects the same field on Add an Action. Stores values as TimeBucket so
 * the existing matcher math works unchanged. Time buckets that don't have
 * their own card (1hr, fullDay) are folded into the closest selected card —
 * so an existing card with timeCommitment "1hr" still highlights "A little".
 */
import type { TimeBucket } from "../lib/matcher";

interface Level {
  key: TimeBucket;
  title: string;
  subtitle: string;
  desc: string;
}

/** Subtitle copy from the user's perspective — used in the matcher wizard
 * where the question is "how involved do *you* want to be?". */
const LEVELS_MATCH: Level[] = [
  { key: "5min",     title: "Just the basics", subtitle: "When I have a sec", desc: "Quick, < 5 minutes" },
  { key: "10min",    title: "A few minutes",   subtitle: "5–10 min",          desc: "Takes a few minutes" },
  { key: "30min",    title: "A little",        subtitle: "Few hrs / month",   desc: "Show up here and there" },
  { key: "fewHours", title: "Regularly",       subtitle: "Few hrs / week",    desc: "Phone bank, local org" },
  { key: "ongoing",  title: "All in",          subtitle: "Ongoing",           desc: "Organizing, leadership" },
];

/** Subtitle copy from the action-planner's perspective — used on Add an
 * Action where the planner is describing what their action takes, not what
 * they personally have time for. */
const LEVELS_PLAN: Level[] = [
  { key: "5min",     title: "Just the basics", subtitle: "Takes a moment",  desc: "Quick, < 5 minutes" },
  { key: "10min",    title: "A few minutes",   subtitle: "5–10 min",        desc: "Takes a few minutes" },
  { key: "30min",    title: "A little",        subtitle: "Few hrs / month", desc: "Show up here and there" },
  { key: "fewHours", title: "Regularly",       subtitle: "Few hrs / week",  desc: "Phone bank, local org" },
  { key: "ongoing",  title: "All in",          subtitle: "Ongoing",         desc: "Organizing, leadership" },
];

/** Maps any TimeBucket to one of the 5 picker cards. The matcher still scores
 * against the underlying TimeBucket, so cards with `1hr` or `fullDay` keep
 * their precision — this only governs which card the user sees highlighted. */
export function involvementLevelFor(b: TimeBucket | null | undefined): TimeBucket {
  if (b === "1hr") return "30min";
  if (b === "fullDay") return "fewHours";
  return (b ?? "30min") as TimeBucket;
}

interface InvolvementPickerProps {
  value: TimeBucket | null;
  onChange: (v: TimeBucket) => void;
  /** Optional copy above the cards. */
  question?: string;
  hint?: string;
  /** "match" = user perspective (default, used in MatchMe wizard).
   *  "plan"  = action-planner perspective (used in Add an Action). */
  variant?: "match" | "plan";
  /** "large" renders roomier cards + type for the onboarding wizard, where
   *  the picker gets the whole screen instead of a cramped modal. Default
   *  keeps the compact sizing used by Quick Match and Add an Action. */
  size?: "default" | "large";
  /** When true, a null `value` highlights NOTHING (the wizard wants an
   *  un-preselected first impression). Default false preserves the existing
   *  behaviour where null falls back to the "A little" card being lit. */
  allowUnselected?: boolean;
}

export function InvolvementPicker({ value, onChange, question, hint, variant = "match", size = "default", allowUnselected = false }: InvolvementPickerProps) {
  const large = size === "large";
  // With allowUnselected, a null value lights no card; otherwise the legacy
  // fallback (null → "30min") keeps a default highlighted.
  const selected = allowUnselected && value == null ? null : involvementLevelFor(value);
  const levels = variant === "plan" ? LEVELS_PLAN : LEVELS_MATCH;
  return (
    <div>
      {question && (
        <h3 className={`font-['Poppins',sans-serif] font-bold text-[#23297e] leading-tight ${large ? "text-lg" : "text-base"}`}>
          {question}
        </h3>
      )}
      {hint && (
        <p className={`font-['Poppins',sans-serif] text-gray-500 mt-1 mb-3 ${large ? "text-[15px] leading-relaxed" : "text-xs"}`}>
          {hint}
        </p>
      )}
      <div className={`grid grid-cols-2 ${large ? "md:grid-cols-5 gap-3" : "lg:grid-cols-5 gap-2"}`}>
        {levels.map(({ key, title, subtitle, desc }) => {
          const isSelected = selected === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              aria-pressed={isSelected}
              className={`text-left rounded-xl border-2 transition-colors ${large ? "px-4 py-4" : "px-3 py-2.5"} ${
                isSelected
                  ? "border-[#ed6624] bg-[#ed6624]/5"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <p className={`font-['Poppins',sans-serif] font-bold text-gray-900 leading-tight ${large ? "text-base" : "text-sm"}`}>
                {title}
              </p>
              <p className={`font-['Poppins',sans-serif] font-semibold uppercase tracking-wider text-[#ed6624] mt-1 ${large ? "text-[12px]" : "text-[10px]"}`}>
                {subtitle}
              </p>
              <p className={`font-['Poppins',sans-serif] text-gray-500 mt-1.5 leading-snug ${large ? "text-[13px]" : "text-xs"}`}>
                {desc}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
