import { Sparkles, X } from "lucide-react";

/**
 * WelcomeHero — a one-time, dismissible welcome card shown above the Acts feed.
 *
 * It lands the emotional "we're glad you're here" beat and frames the feed as
 * something the visitor SHAPES (not something we surveil) — critical given
 * ResistAct's no-tracking, anonymous-first promise. Copy is state-aware:
 *   • `personalized` (the feed has learned enough to rank for them) → a warm
 *     "welcome back, your feed is tuned" message.
 *   • cold start (brand-new / barely-used) → a "this is yours to shape" invite.
 *
 * Deliberately general — no specific inferred traits are named, so it never
 * shows a label that feels off. Dismissal is owned by the parent (persisted to
 * localStorage) so it shows once and then stays gone.
 */
export function WelcomeHero({
  personalized,
  signedIn = false,
  count,
  filtered = false,
  quickActionsOnly = false,
  onQuickActions,
  onDismiss,
}: {
  personalized: boolean;
  signedIn?: boolean;
  /** Live result count, folded into the headline ("We have N actions for you"). */
  count?: number;
  /** Whether any filter is active — switches "unfiltered" → "matching your filters". */
  filtered?: boolean;
  /** Whether the "5 Mins Max" quick filter is currently on. */
  quickActionsOnly?: boolean;
  /** Toggle the "5 Mins Max" quick filter. When provided AND the visitor is
   *  logged out, the banner offers a one-tap "filter to quick acts" invite.
   *  (Signed-in users get the same offer in the tagline footer instead.) */
  onQuickActions?: (next: boolean) => void;
  onDismiss: () => void;
}) {
  // Headline tail that states how many acts are on offer. Only rendered when a
  // count is supplied; mirrors the result-banner copy ("— unfiltered" vs
  // "matching your filters") so the fused card reads consistently.
  const countLine =
    typeof count === "number" ? (
      <>
        {" "}We have{" "}
        <span className="text-[#ed6624]">{count.toLocaleString()}</span>{" "}
        {count === 1 ? "Act" : "Acts"} for you
        {filtered ? " — matching your filters" : " — unfiltered"}.
      </>
    ) : null;
  // "Swamped today?" quick-acts invite — logged-out only, appended INLINE to the
  // end of the intro copy so it reads as one continuous sentence at the same
  // size as the body text (not a separate line). Signed-in users get the same
  // offer in the tagline footer instead, so we never double it up. Toggles the
  // "5 Mins Max" filter the pill row used to own.
  const swampedInline =
    !signedIn && onQuickActions ? (
      quickActionsOnly ? (
        <>
          {" "}Showing only acts you can do in under 5 minutes.{" "}
          <button
            type="button"
            onClick={() => onQuickActions(false)}
            className="font-semibold text-[#ed6624] underline underline-offset-2 transition-colors hover:text-[#e07a28]"
          >
            Show all acts.
          </button>
        </>
      ) : (
        <>
          {" "}Swamped today?{" "}
          <button
            type="button"
            onClick={() => onQuickActions(true)}
            className="font-semibold text-[#ed6624] underline underline-offset-2 transition-colors hover:text-[#e07a28]"
          >
            Let me know if you want me to filter to actions you can take that will be under 5 minutes!
          </button>
        </>
      )
    ) : null;
  return (
    <div className="relative mb-4 overflow-hidden rounded-xl border border-[#ed6624]/30 bg-gradient-to-r from-[#ed6624]/[0.08] via-white to-[#23297e]/[0.05] px-4 py-3.5 sm:px-5">
      {/* Warm accent rail */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-[#ed6624] to-[#f5853f]" />
      <div className="flex items-start gap-3 pl-2">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#ed6624] to-[#f5853f] text-white shadow-sm">
          <Sparkles size={16} strokeWidth={2.5} />
        </span>
        <div className="min-w-0 flex-1">
          {personalized ? (
            <>
              <p className="font-['Poppins',sans-serif] text-[15px] font-extrabold text-[#23297e]">
                Welcome back, Resister!
              </p>
              <p className="mt-0.5 font-['Poppins',sans-serif] text-[13px] leading-snug text-gray-700">
                This feed is yours — we've ranked today's acts around what you've been into. New acts daily; keep doing small things.{swampedInline}
              </p>
            </>
          ) : (
            <>
              <p className="font-['Poppins',sans-serif] text-[15px] font-extrabold text-[#23297e]">
                You're here. That counts.{countLine}
              </p>
              <p className="mt-0.5 font-['Poppins',sans-serif] text-[13px] leading-snug text-gray-700">
                {/* "No account, no tracking" is the anonymous-first pitch — it
                    only makes sense to logged-out visitors. Signed-in users
                    already have an account, so we drop that clause for them. */}
                This feed is yours to shape. Filter using the buttons above, and then boost, save for later, or do a few acts now and the results will start tuning themselves to you — {signedIn ? "" : "no account, no tracking, "}just your corner of the resistance.{swampedInline}
              </p>
            </>
          )}
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss welcome"
          className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-[#23297e]/5 hover:text-[#23297e]"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
