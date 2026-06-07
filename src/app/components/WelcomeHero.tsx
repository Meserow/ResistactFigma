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
  onDismiss,
}: {
  personalized: boolean;
  onDismiss: () => void;
}) {
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
                This feed is yours — we've ranked today's acts around what you've been into. New acts daily; keep doing small things.
              </p>
            </>
          ) : (
            <>
              <p className="font-['Poppins',sans-serif] text-[15px] font-extrabold text-[#23297e]">
                Glad you showed up.
              </p>
              <p className="mt-0.5 font-['Poppins',sans-serif] text-[13px] leading-snug text-gray-700">
                This feed is yours to shape. Save, boost, or do a few acts and it starts tuning itself to you — no account, no tracking, just your corner of the resistance.
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
