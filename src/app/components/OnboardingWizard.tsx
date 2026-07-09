/**
 * OnboardingWizard — the "Get Started" first-visit experience.
 *
 * Merges the old InfoModal (what is this site?) and JourneyModal (what fits my
 * life?) into ONE full-size, comfortably-designed wizard with a single visual
 * system across all five steps:
 *
 *   1. Welcome     — "you're here, that counts." The pitch, shame-free.
 *   2. How it works — the site explained as three big cards + the tier strip.
 *   3. Time        — how much room does life have? (InvolvementPicker, large).
 *   4. Place       — near me / from my couch (feeds the Location pill).
 *   5. Your path   — the spark→inferno ladder, the visitor's rung highlighted,
 *                    a CTA into a feed filtered to their unlocked categories.
 *
 * Data source of truth is lib/journey.ts + lib/tiers.ts (unchanged). The whole
 * point of the redesign is room to breathe: nothing here renders under 12px,
 * body copy sits at 15–16px. See docs/ONBOARDING_WIZARD_PLAN.md.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { X, ArrowRight, ChevronLeft, Lock, Zap, Flame, TrendingUp, MapPin, House, Check } from "lucide-react";
import welcomeBanner from "../../assets/onboarding-welcome-banner.webp";
import howItWorksArt from "../../assets/onboarding-howitworks.webp";
import timeArt from "../../assets/onboarding-time.webp";
import placeArt from "../../assets/onboarding-place.webp";
import pathArt from "../../assets/onboarding-path.webp";
import { TIERS, getUserTier } from "../lib/tiers";
import type { TierKey } from "../lib/tiers";
import { TierIcon } from "./TierBadge";
import { JOURNEY_UNLOCKS, JOURNEY_PITCH, unlockedCategoriesFor } from "../lib/journey";
import { colorForCategory, iconForCategory } from "../lib/categoryGroups";
import { InvolvementPicker } from "./InvolvementPicker";
import type { TimeBucket } from "../lib/matcher";

// A little cartoon for the top of each step, in the house comic style. Indexed
// by step (0-4). Each is heavily optimized (13–44KB) so all five together weigh
// less than the old single hero banner. `pos` tunes the object-position crop per
// image so each subject sits well in the short strip.
const STEP_BANNERS: { src: string; pos: string }[] = [
  { src: welcomeBanner, pos: "center 35%" },
  { src: howItWorksArt, pos: "center 40%" },
  { src: timeArt,       pos: "center 40%" },
  { src: placeArt,      pos: "center 45%" },
  { src: pathArt,       pos: "center 40%" },
];

export interface OnboardingApplyPayload {
  timeBucket: TimeBucket | null;
  state: string | null;
  remoteOnly: boolean;
  /** Cumulative unlocked categories at the visitor's tier; null = everything. */
  categories: string[] | null;
}

interface OnboardingWizardProps {
  /** Visitor's completed-act count — drives which rung of the ladder is "you". */
  actionCount: number;
  isLoggedIn: boolean;
  /** Approved-card counts per canonical category. Fallback for the "N acts"
   *  CTA when `countMatches` isn't supplied. */
  categoryCounts: Record<string, number>;
  /** Exact feed-match count for a given path (mirrors the real feed pipeline:
   *  pinned card + Texting fuzzy match + time/place). Preferred over the naive
   *  categoryCounts sum so the CTA promises what the feed will actually show. */
  countMatches?: (payload: OnboardingApplyPayload) => number;
  /** Best-guess home state from geo detect, prefilled into the "Near me" select. */
  detectedState: string | null;
  /** States that actually have live cards, for the "Near me" select. */
  stateOptions: string[];
  onClose: () => void;
  onApply: (payload: OnboardingApplyPayload) => void;
  /** Opens the sign-up flow (a quiet nudge on the final step; never a gate). */
  onJoin?: () => void;
}

const STEP_COUNT = 5;

/** prefers-reduced-motion, so the step slide can be disabled per §3. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

/** Small colored category chip; grayscale + lock styling when locked. Sized
 *  for real reading per the plan: 13px bold text, 12px icon, px-3 py-1.5. */
function CategoryChip({ category, locked }: { category: string; locked: boolean }) {
  const Icon = iconForCategory(category);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-['Poppins',sans-serif] text-[12px] font-bold leading-none"
      style={
        locked
          ? { background: "#f3f4f6", color: "#9ca3af" }
          : { background: colorForCategory(category), color: "#fff" }
      }
    >
      <Icon size={12} strokeWidth={2.5} aria-hidden />
      {category}
    </span>
  );
}

export function OnboardingWizard({
  actionCount,
  isLoggedIn,
  categoryCounts,
  countMatches,
  detectedState,
  stateOptions,
  onClose,
  onApply,
  onJoin,
}: OnboardingWizardProps) {
  const [step, setStep] = useState(0); // 0..4
  const [timeBucket, setTimeBucket] = useState<TimeBucket | null>(null);
  // Default "Near me" ON when we already know the visitor's state (from silent
  // IP geo) — otherwise the pre-filled state would be ignored, since apply()
  // only uses selectedState when nearMe is on.
  const [nearMe, setNearMe] = useState<boolean>(!!detectedState);
  const [selectedState, setSelectedState] = useState<string | null>(detectedState);
  const [fromCouch, setFromCouch] = useState(false);
  // Geo (IP) usually resolves AFTER this wizard has mounted — both fire on first
  // visit — so the mount-time detectedState is often null and the useState above
  // captures nothing. Sync it in when it arrives, but never override a choice the
  // visitor has already made on the Place step.
  const placeTouched = useRef(false);
  useEffect(() => {
    if (placeTouched.current || !detectedState) return;
    setSelectedState((cur) => cur ?? detectedState);
    setNearMe(true);
  }, [detectedState]);

  const reduceMotion = usePrefersReducedMotion();
  const dialogRef = useRef<HTMLDivElement>(null);
  const autoAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { tier, actionsToNext } = getUserTier(actionCount);
  const tierIdx = TIERS.findIndex((t) => t.key === tier.key);
  const unlocked = unlockedCategoriesFor(tier.key); // null = everything (Wildfire+)
  const everythingUnlocked = unlocked === null;

  // Which ladder rung's teaser is expanded on step 5. Starts closed — the
  // teaser card is tall, and this step already has a lot to fit under a fixed
  // modal height; a locked rung is still one click away. (Previously defaulted
  // open on the next tier; that cost ~110px of body height every visitor paid
  // for on load.)
  const [openRung, setOpenRung] = useState<TierKey | null>(null);

  // How many live acts the CTA will reveal — computed with the real feed
  // pipeline when App supplies `countMatches` (so the CTA reflects the visitor's
  // time/place picks and matches the feed exactly), else a naive category sum.
  const matchCount = useMemo(() => {
    if (countMatches) {
      return countMatches({
        timeBucket,
        state: nearMe ? selectedState : null,
        remoteOnly: fromCouch,
        categories: unlocked,
      });
    }
    if (unlocked === null) return Object.values(categoryCounts).reduce((a, b) => a + b, 0);
    return unlocked.reduce((sum, cat) => sum + (categoryCounts[cat] ?? 0), 0);
  }, [countMatches, unlocked, categoryCounts, timeBucket, nearMe, selectedState, fromCouch]);

  // ── Esc to close + body scroll lock (matches App.tsx's swipeOpen pattern) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const body = document.body;
    const prevOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // ── Focus trap: keep Tab inside the dialog; focus it on mount/step change ──
  useEffect(() => {
    dialogRef.current?.focus();
  }, [step]);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || active === root) { e.preventDefault(); last.focus(); }
      } else if (active === last) {
        e.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // Clear any pending auto-advance timer on unmount.
  useEffect(() => () => { if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current); }, []);

  const goTo = (n: number) => {
    if (autoAdvanceRef.current) { clearTimeout(autoAdvanceRef.current); autoAdvanceRef.current = null; }
    setStep(Math.max(0, Math.min(STEP_COUNT - 1, n)));
  };
  const next = () => goTo(step + 1);
  const back = () => goTo(step - 1);

  // Step 3: picking a card advances after a beat (keyboard users get Continue).
  const pickTime = (v: TimeBucket) => {
    setTimeBucket(v);
    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    autoAdvanceRef.current = setTimeout(() => { autoAdvanceRef.current = null; setStep(3); }, 250);
  };

  const apply = () => {
    onApply({
      timeBucket,
      state: nearMe ? selectedState : null,
      remoteOnly: fromCouch,
      categories: unlocked,
    });
  };

  // Skip everything on the Place step.
  const skipPlace = () => { placeTouched.current = true; setNearMe(false); setSelectedState(null); setFromCouch(false); next(); };

  // ── Shared button styles ──
  const primaryBtn =
    "inline-flex w-full sm:w-auto items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#ed6624] h-12 px-7 font-['Poppins',sans-serif] text-[15px] font-bold text-white transition-colors hover:bg-[#c2521b]";
  // Quiet secondary ("Skip — just let me browse" / "Just browsing"): muted gray,
  // not headline-navy, so it never competes with the blue title up top. The
  // orange primary CTA is the one thing meant to draw the eye.
  const secondaryBtn =
    "inline-flex w-full sm:w-auto items-center justify-center gap-1.5 whitespace-nowrap rounded-full h-12 px-5 font-['Poppins',sans-serif] text-[14px] font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700";

  const stepTitle = [
    "You're here. That already counts.",
    "How ResistAct works",
    "How much room does life have right now?",
    "Where should your acts find you?",
    actionCount === 0
      ? "You start as a Spark"
      : `You're already ${/^[aeiou]/i.test(tier.name) ? "an" : "a"} ${tier.name}`,
  ][step];

  const ctaLabel = everythingUnlocked
    ? `Show me everything${matchCount > 0 ? ` (${matchCount})` : ""}`
    : `Show my ${tier.name} acts${matchCount > 0 ? ` (${matchCount})` : ""}`;

  return (
    <div
      className="fixed inset-0 z-[115] flex bg-[#0d1b2a]/60 backdrop-blur-sm md:items-center md:justify-center md:p-4"
      onClick={onClose}
    >
      <style>{`@keyframes owStepIn{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}`}</style>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ow-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col overflow-hidden bg-white outline-none md:h-[780px] md:max-h-[94vh] md:max-w-[880px] md:rounded-3xl md:shadow-2xl"
      >
        {/* Every step gets its own little cartoon, full-bleed across the very
            top (bleeding off the top/left/right edges — the modal's
            overflow-hidden clips it to the rounded top corners). Uniform height
            so all steps are the same size. "GET STARTED" + the title sit below
            it in the header. */}
        <img
          key={step}
          src={STEP_BANNERS[step].src}
          alt=""
          aria-hidden
          style={{ objectPosition: STEP_BANNERS[step].pos }}
          className="h-48 w-full shrink-0 object-cover sm:h-64"
        />

        {/* ── Header ── */}
        <div className="flex shrink-0 items-start gap-3 border-b border-gray-100 px-5 py-4 md:px-10 md:pt-6 md:pb-4">
          {step > 0 && (
            <button
              onClick={back}
              aria-label="Back"
              className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-[#23297e]"
            >
              <ChevronLeft size={20} />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-['Poppins',sans-serif] text-[11px] font-extrabold uppercase tracking-[0.18em] text-[#ed6624]">
              Get Started
            </p>
            <h2
              id="ow-title"
              className="mt-1 font-['Poppins',sans-serif] text-[22px] font-bold leading-tight text-[#23297e] md:text-[28px]"
            >
              {stepTitle}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-[#23297e]"
          >
            <X size={20} />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-5 md:px-10 md:py-6">
          <div key={step} style={reduceMotion ? undefined : { animation: "owStepIn 200ms ease-out" }}>
            {step === 0 && <StepWelcome />}
            {step === 1 && <StepHowItWorks />}
            {step === 2 && (
              <StepTime value={timeBucket} onPick={pickTime} />
            )}
            {step === 3 && (
              <StepPlace
                nearMe={nearMe}
                onToggleNearMe={() => { placeTouched.current = true; setNearMe((v) => !v); }}
                selectedState={selectedState}
                onSelectState={(s) => { placeTouched.current = true; setSelectedState(s); }}
                stateOptions={stateOptions}
                fromCouch={fromCouch}
                onToggleCouch={() => { placeTouched.current = true; setFromCouch((v) => !v); }}
                onSkip={skipPlace}
              />
            )}
            {step === 4 && (
              <StepPath
                actionCount={actionCount}
                tierIdx={tierIdx}
                unlocked={unlocked}
                everythingUnlocked={everythingUnlocked}
                matchCount={matchCount}
                categoryCounts={categoryCounts}
                actionsToNext={actionsToNext}
                openRung={openRung}
                setOpenRung={setOpenRung}
              />
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="shrink-0 border-t border-gray-100 px-5 py-3 md:px-10 md:py-4">
          <div className="flex items-center justify-between gap-3">
            {/* Progress dots */}
            <div className="hidden sm:flex items-center gap-2 shrink-0" aria-hidden>
              {Array.from({ length: STEP_COUNT }).map((_, s) => (
                <span
                  key={s}
                  className="h-2 rounded-full transition-all"
                  style={{ width: s === step ? 24 : 8, background: s === step ? "#ed6624" : "#e5e7eb" }}
                />
              ))}
            </div>
            {/* Buttons — stack full-width on mobile, inline on desktop. */}
            <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:items-center">
              {step === 0 && (
                <>
                  <button onClick={onClose} className={secondaryBtn}>Skip — just let me browse</button>
                  <button onClick={next} className={primaryBtn}>
                    Show me how it works <ArrowRight size={17} strokeWidth={2.5} />
                  </button>
                </>
              )}
              {step === 1 && (
                <button onClick={next} className={primaryBtn}>
                  Find my starting point <ArrowRight size={17} strokeWidth={2.5} />
                </button>
              )}
              {step === 2 && (
                <button onClick={next} className={primaryBtn}>
                  Continue <ArrowRight size={17} strokeWidth={2.5} />
                </button>
              )}
              {step === 3 && (
                <button onClick={next} className={primaryBtn}>
                  See my path <ArrowRight size={17} strokeWidth={2.5} />
                </button>
              )}
              {step === 4 && (
                <>
                  <button onClick={onClose} className={secondaryBtn}>Just browsing</button>
                  <button onClick={apply} className={primaryBtn}>{ctaLabel}</button>
                </>
              )}
            </div>
          </div>
          {/* Step 5 sign-up nudge — a quiet line, never a gate. */}
          {step === 4 && !isLoggedIn && onJoin && (
            <p className="mt-3 text-center sm:text-right font-['Poppins',sans-serif] text-[13px] text-gray-500">
              Want your flame to follow you across devices?{" "}
              <button onClick={onJoin} className="font-bold text-[#ed6624] underline underline-offset-2 hover:text-[#c2521b]">
                Create a free account
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step 1 — Welcome ─────────────────────────────────────────────────────────
function StepWelcome() {
  return (
    <div className="mx-auto max-w-[620px]">
      {/* The welcome cartoon lives full-bleed at the top of the modal (see the
          OnboardingWizard header block), so this step is copy-only. */}
      <p className="font-['Poppins',sans-serif] text-[17px] leading-relaxed text-gray-700">
        <span className="font-semibold text-[#23297e]">You don't have to do everything — you just have to do something.</span>{" "}
        ResistAct is a daily menu of small, doable acts of resistance — protests, postcards, phone
        calls, boycotts, a hat you knit for a march. Each one is vetted, matched to your real life,
        and yours to do at your own pace.
      </p>
      {/* One line on desktop (the 620px content column fits it exactly at
          13px) — but nowrap unconditionally overflowed sideways on mobile,
          where this column is much narrower. md: scopes the nowrap to the
          width it was actually measured against; below that it wraps
          normally (2 short lines), which is fine. */}
      <p className="mt-3 font-['Poppins',sans-serif] text-[13px] font-semibold leading-relaxed text-[#23297e] md:whitespace-nowrap">
        No account. No tracking. No email list you can't escape. Just your corner of the resistance.
      </p>
      <blockquote className="mt-6 border-l-[3px] border-[#ed6624] pl-4 font-['Poppins',sans-serif] text-[14px] italic leading-relaxed text-[#767574]">
        "Never doubt that a small group of thoughtful, committed citizens can change the world.
        Indeed, it's the only thing that ever has."
        <span className="mt-1.5 block not-italic font-semibold text-gray-500">— Margaret Mead</span>
      </blockquote>
    </div>
  );
}

// ─── Step 2 — How it works ─────────────────────────────────────────────────────
function HowCard({ icon, tileColor, heading, children }: { icon: React.ReactNode; tileColor: string; heading: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col rounded-2xl border border-gray-100 bg-gray-50/60 p-4">
      <span
        className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-sm"
        style={{ backgroundColor: tileColor }}
      >
        {icon}
      </span>
      <h3 className="font-['Poppins',sans-serif] text-[16px] font-bold leading-tight text-[#23297e]">{heading}</h3>
      <p className="mt-1 font-['Poppins',sans-serif] text-[13px] leading-snug text-gray-600">{children}</p>
    </div>
  );
}

function StepHowItWorks() {
  return (
    <div>
      <div className="flex flex-col gap-3 md:flex-row">
        <HowCard icon={<Zap size={18} strokeWidth={2.5} />} tileColor="#23297e" heading="Find your act.">
          Filter by time, mood, and place — or let Quick Match deal you a hand. New acts daily.
        </HowCard>
        <HowCard icon={<Flame size={18} strokeWidth={2.5} />} tileColor="#ed6624" heading="Do it. Count it.">
          Hit "I did this!" and it counts. No account needed — your progress lives on your device.
        </HowCard>
        <HowCard icon={<TrendingUp size={18} strokeWidth={2.5} />} tileColor="#5a3e9e" heading="Level up. Unlock more.">
          Every act moves you up the ladder, from Spark to Inferno — new kinds of acts as you go.
        </HowCard>
      </div>

      {/* The six tier badges — a proper, legible ladder moment. */}
      <div className="mt-4 flex items-end justify-center gap-3 sm:gap-5">
        {TIERS.map((t) => (
          <div key={t.key} className="flex flex-col items-center gap-1">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full"
              style={{ backgroundColor: t.color }}
            >
              <TierIcon tier={t} size={14} />
            </span>
            <span className="font-['Poppins',sans-serif] text-[11px] font-semibold" style={{ color: t.labelColor }}>
              {t.name}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-4 text-center font-['Poppins',sans-serif] text-[12px] leading-snug text-gray-500">
        The Facts (ready-made rebuttals) and The Smacks (shareable receipts) live in the top nav
        whenever you need ammo.
      </p>
    </div>
  );
}

// ─── Step 3 — Time ─────────────────────────────────────────────────────────────
function StepTime({ value, onPick }: { value: TimeBucket | null; onPick: (v: TimeBucket) => void }) {
  return (
    <InvolvementPicker
      value={value}
      onChange={onPick}
      size="large"
      allowUnselected
      hint="Honest answers only — 'barely any' is a great answer. Small acts count, and on hard weeks they count double."
    />
  );
}

// ─── Step 4 — Place ────────────────────────────────────────────────────────────
function ToggleCard({ active, onToggle, icon, title, children }: { active: boolean; onToggle: () => void; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={`flex flex-1 flex-col items-start rounded-2xl border-2 p-4 text-left transition-colors ${
        active ? "border-[#ed6624] bg-[#ed6624]/5" : "border-gray-200 bg-white hover:border-gray-300"
      }`}
    >
      <span
        className={`mb-2 flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
          active ? "bg-[#ed6624] text-white" : "bg-gray-100 text-[#23297e]"
        }`}
      >
        {icon}
      </span>
      <span className="flex items-center gap-2 font-['Poppins',sans-serif] text-[16px] font-bold text-[#23297e]">
        {title}
        {active && <Check size={16} strokeWidth={3} className="text-[#ed6624]" />}
      </span>
      <span className="mt-0.5 font-['Poppins',sans-serif] text-[13px] leading-snug text-gray-600">{children}</span>
    </button>
  );
}

function StepPlace({
  nearMe, onToggleNearMe, selectedState, onSelectState, stateOptions,
  fromCouch, onToggleCouch, onSkip,
}: {
  nearMe: boolean;
  onToggleNearMe: () => void;
  selectedState: string | null;
  onSelectState: (s: string | null) => void;
  stateOptions: string[];
  fromCouch: boolean;
  onToggleCouch: () => void;
  onSkip: () => void;
}) {
  return (
    <div>
      <p className="mb-3 font-['Poppins',sans-serif] text-[15px] leading-snug text-gray-600">
        Pick either, both, or neither — you can change it anytime with the filters up top.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex flex-1 flex-col gap-2">
          <ToggleCard active={nearMe} onToggle={onToggleNearMe} icon={<MapPin size={20} strokeWidth={2.5} />} title="Near me">
            In-person acts happening around your state.
          </ToggleCard>
          {nearMe && (
            <select
              value={selectedState ?? ""}
              onChange={(e) => onSelectState(e.target.value || null)}
              onClick={(e) => e.stopPropagation()}
              className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-2 font-['Poppins',sans-serif] text-[15px] font-semibold text-[#23297e] focus:border-[#ed6624] focus:outline-none"
            >
              <option value="">Choose your state…</option>
              {stateOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex flex-1">
          <ToggleCard active={fromCouch} onToggle={onToggleCouch} icon={<House size={20} strokeWidth={2.5} />} title="From my couch">
            Remote and at-home acts you can do from anywhere.
          </ToggleCard>
        </div>
      </div>
      <div className="mt-3 text-center">
        <button
          onClick={onSkip}
          className="font-['Poppins',sans-serif] text-[14px] font-semibold text-gray-500 underline underline-offset-2 transition-colors hover:text-[#23297e]"
        >
          Show me everything, everywhere
        </button>
      </div>
    </div>
  );
}

// ─── Step 5 — Your path ────────────────────────────────────────────────────────
function StepPath({
  actionCount, tierIdx, unlocked, everythingUnlocked, matchCount, categoryCounts,
  actionsToNext, openRung, setOpenRung,
}: {
  actionCount: number;
  tierIdx: number;
  unlocked: string[] | null;
  everythingUnlocked: boolean;
  matchCount: number;
  categoryCounts: Record<string, number>;
  actionsToNext: number | null;
  openRung: TierKey | null;
  setOpenRung: (k: TierKey | null) => void;
}) {
  const tier = TIERS[tierIdx];
  const openTier = openRung ? TIERS.find((t) => t.key === openRung) ?? null : null;
  const openTierLocked = openTier ? TIERS.findIndex((t) => t.key === openTier.key) > tierIdx : false;

  return (
    <div className="space-y-2">
      {/* 1. Hero zone — the visitor's current tier, big. */}
      <div className="flex flex-col items-center text-center">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-full"
          style={{ backgroundColor: tier.color, boxShadow: `0 0 0 4px ${tier.glowColor}66` }}
        >
          <TierIcon tier={tier} size={22} />
        </span>
        <p className="mt-2 font-['Poppins',sans-serif] text-[14px] leading-snug text-gray-600">
          {JOURNEY_PITCH[tier.key]}
        </p>
        {!everythingUnlocked && unlocked && (
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {unlocked.map((cat) => (
              <CategoryChip key={cat} category={cat} locked={false} />
            ))}
          </div>
        )}
        <p className="mt-2 font-['Poppins',sans-serif] text-[14px] font-semibold text-[#23297e]">
          {everythingUnlocked ? (
            "Every act on the site is yours."
          ) : (
            <>
              <span className="text-[#ed6624]">{matchCount} act{matchCount === 1 ? "" : "s"}</span> are waiting in these categories.
            </>
          )}
        </p>
      </div>

      {/* 2. The road ahead — all six rungs. */}
      <div>
        <p className="mb-1.5 font-['Poppins',sans-serif] text-[12px] font-bold uppercase tracking-[0.14em] text-gray-400">
          The road ahead
        </p>
        {/* Rung strip: horizontal on desktop, vertical timeline on mobile. */}
        <div className="flex flex-col gap-1 md:flex-row md:items-start md:gap-1">
          {TIERS.map((t, i) => {
            const isYou = i === tierIdx;
            const isPast = i < tierIdx;
            const isLocked = i > tierIdx;
            const isOpen = openRung === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => isLocked && setOpenRung(isOpen ? null : t.key)}
                aria-expanded={isLocked ? isOpen : undefined}
                className={`flex items-center gap-2 rounded-xl px-2.5 py-1 text-left transition-colors md:flex-1 md:flex-col md:items-center md:gap-0.5 md:text-center ${
                  isYou ? "bg-[#ed6624]/[0.07] ring-1 ring-[#ed6624]/40" : ""
                } ${isLocked ? "cursor-pointer hover:bg-gray-50" : "cursor-default"} ${isOpen && isLocked ? "bg-gray-50" : ""}`}
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: t.color, filter: isLocked ? "grayscale(0.55) opacity(0.8)" : undefined }}
                >
                  <TierIcon tier={t} size={12} />
                </span>
                <span className="min-w-0 md:flex md:flex-col md:items-center">
                  <span
                    className="font-['Poppins',sans-serif] text-[13px] font-bold"
                    style={{ color: isLocked ? "#9ca3af" : t.labelColor }}
                  >
                    {t.name}
                  </span>
                  {isLocked ? (
                    <span className="ml-2 inline-flex items-center gap-1 font-['Poppins',sans-serif] text-[11px] font-semibold text-gray-400 md:ml-0">
                      <Lock size={11} aria-hidden /> at {t.min} acts
                    </span>
                  ) : (
                    <span className="ml-2 inline-flex items-center gap-1 font-['Poppins',sans-serif] text-[11px] font-semibold text-[#4a7c59] md:ml-0">
                      <Check size={11} strokeWidth={3} aria-hidden /> unlocked
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* Teaser card for the expanded rung — only when that rung actually
            unlocks something new (skip empty teasers, e.g. Inferno). Closed by
            default (see openRung init above); opens on a click and pushes the
            footer down within the scrollable body rather than the fixed
            modal, so it never causes layout jumps elsewhere. */}
        {openTier && openTierLocked && JOURNEY_UNLOCKS[openTier.key].length > 0 && (
          <div className="mt-2 rounded-2xl border border-gray-100 bg-gray-50/70 p-3">
            <p className="font-['Poppins',sans-serif] text-[14px] font-semibold text-[#23297e]">
              <span className="text-[#ed6624]">
                {Math.max(0, openTier.min - actionCount)} act{Math.max(0, openTier.min - actionCount) === 1 ? "" : "s"} from {openTier.name}
              </span>{" "}
              — unlocks these:
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {JOURNEY_UNLOCKS[openTier.key].map((cat) => (
                <CategoryChip key={cat} category={cat} locked />
              ))}
            </div>
          </div>
        )}

        {actionsToNext != null && !everythingUnlocked && (
          <p className="mt-2 text-center font-['Poppins',sans-serif] text-[13px] text-gray-500">
            No rush — they'll wait. Do acts at your own pace.
          </p>
        )}
      </div>
    </div>
  );
}
