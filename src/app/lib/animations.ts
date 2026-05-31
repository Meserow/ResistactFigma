/**
 * Shared animation primitives.
 *
 * - `useAnimatedNumber(target)` — smoothly tweens an integer toward `target`
 *   so counters roll up instead of snapping. Respects prefers-reduced-motion
 *   (snaps instantly when reduced motion is on).
 *
 * - `useFirstChange(value)` — true the first time `value` changes from its
 *   initial render value. Lets components fire a one-shot animation only on
 *   real user-driven changes, not on mount.
 *
 * - `prefersReducedMotion()` — reads the media query once at call time.
 */
import { useEffect, useRef, useState } from "react";

/** Media-query helper. Returns false on SSR / non-browser environments. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Tween an integer from its previous value to `target` over `durationMs`.
 * Uses requestAnimationFrame + cubic ease-out so the number lands and settles.
 * On reduced-motion users it snaps immediately to `target`.
 */
export function useAnimatedNumber(target: number, durationMs = 600): number {
  // Keep the previous value in a ref so re-renders that don't change `target`
  // don't restart the animation — only a NEW target triggers a new tween.
  const fromRef = useRef<number>(target);
  const [displayed, setDisplayed] = useState<number>(target);

  useEffect(() => {
    if (fromRef.current === target) return;
    if (prefersReducedMotion()) {
      fromRef.current = target;
      setDisplayed(target);
      return;
    }
    const from = fromRef.current;
    fromRef.current = target;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplayed(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return displayed;
}

/**
 * Returns a stable boolean that flips to `true` the first time `value`
 * changes from its initial render value, and stays true thereafter (until
 * unmount). Useful for distinguishing "user just bumped this" from "page
 * loaded with this value already set" — only the former should trigger a
 * one-shot celebratory animation.
 */
export function useHasChanged<T>(value: T): boolean {
  const firstRef = useRef<T>(value);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (!changed && firstRef.current !== value) setChanged(true);
  }, [value, changed]);
  return changed;
}

/**
 * Global keyframes used across the gamification animations. Injected once
 * via a <style> tag at app root (see App.tsx). Centralising here keeps the
 * `@keyframes` defs out of every component file.
 */
export const GAMIFICATION_KEYFRAMES = `
  /* Twinkle: a sparkle that pulses scale + opacity to feel "alive". */
  @keyframes resistact-twinkle {
    0%, 100% { transform: scale(1)    rotate(0deg);   opacity: 1; }
    25%      { transform: scale(1.25) rotate(8deg);   opacity: 0.85; }
    50%      { transform: scale(0.9)  rotate(-6deg);  opacity: 1; }
    75%      { transform: scale(1.15) rotate(4deg);   opacity: 0.9; }
  }
  /* Flicker: a flame that breathes — subtle scale + skew so it feels organic. */
  @keyframes resistact-flicker {
    0%, 100% { transform: scale(1)    skewX(0deg);    filter: drop-shadow(0 0 4px #ed6624aa); }
    20%      { transform: scale(1.1)  skewX(-2deg);   filter: drop-shadow(0 0 8px #ed6624cc); }
    50%      { transform: scale(0.95) skewX(1.5deg);  filter: drop-shadow(0 0 3px #ed662499); }
    75%      { transform: scale(1.08) skewX(-1deg);   filter: drop-shadow(0 0 7px #ed6624bb); }
  }
  /* Shimmer: a diagonal highlight sweeps across the element every 6s. */
  @keyframes resistact-shimmer {
    0%        { transform: translateX(-150%) skewX(-20deg); opacity: 0; }
    20%       { opacity: 0.6; }
    60%       { opacity: 0.6; }
    100%      { transform: translateX(250%)  skewX(-20deg); opacity: 0; }
  }
  /* Card gloss: on hover, a wide gloss sweep fires once across the whole card —
     like picking up a physical card and catching the light. */
  @keyframes resistact-card-gloss {
    0%   { transform: translateX(-160%) skewX(-18deg); opacity: 0; }
    10%  { opacity: 1; }
    90%  { opacity: 1; }
    100% { transform: translateX(260%)  skewX(-18deg); opacity: 0; }
  }
  /* Bookmark pop: scale up, then back, like a satisfying tap. */
  @keyframes resistact-bookmark-pop {
    0%   { transform: scale(1); }
    40%  { transform: scale(1.45); }
    70%  { transform: scale(0.92); }
    100% { transform: scale(1); }
  }
  /* Slide-up only — NO opacity. Card resting opacity (0.85, → 1 on hover)
     is governed by CSS classes on the card itself; animating opacity here
     too would fight that and re-introduce the fade-in we deliberately
     dropped. The translateY still gives the "lineup built for you" motion
     on Match Me re-stagger without touching opacity. */
  @keyframes resistact-stagger-in {
    0%   { transform: translateY(14px); }
    100% { transform: translateY(0); }
  }
  /* Counter pop: brief scale bump on the parent when the number rolls. */
  @keyframes resistact-count-pop {
    0%, 100% { transform: scale(1); }
    50%      { transform: scale(1.08); }
  }

  /* All gamification animations are gated behind motion-safe via this class
     wrapper. Users with prefers-reduced-motion get the static styles only. */
  @media (prefers-reduced-motion: reduce) {
    .resistact-anim-twinkle,
    .resistact-anim-flicker,
    .resistact-anim-shimmer::after,
    .resistact-anim-pop,
    .resistact-anim-stagger,
    .resistact-card-shine::before {
      animation: none !important;
    }
  }

  .resistact-anim-twinkle  { animation: resistact-twinkle 2200ms ease-in-out infinite; display: inline-block; transform-origin: center; }
  .resistact-anim-flicker  { animation: resistact-flicker 1600ms ease-in-out infinite; display: inline-block; transform-origin: bottom center; }
  .resistact-anim-pop      { animation: resistact-count-pop 320ms ease-out; }
  .resistact-anim-bookmark { animation: resistact-bookmark-pop 320ms cubic-bezier(0.34, 1.56, 0.64, 1); }
  .resistact-anim-stagger  { animation: resistact-stagger-in 420ms ease-out both; }
  /* Shimmer uses a pseudo-element so it can sweep on top of the parent
     without changing the parent's layout. Parent needs position:relative
     and overflow:hidden. */
  .resistact-anim-shimmer { position: relative; overflow: hidden; }
  .resistact-anim-shimmer::after {
    content: "";
    position: absolute; inset: 0;
    background: linear-gradient(120deg,
      transparent 30%,
      rgba(255,255,255,0.55) 50%,
      transparent 70%);
    pointer-events: none;
    animation: resistact-shimmer 5500ms ease-in-out infinite;
    animation-delay: 1500ms;
  }

  /* Card gloss — applied to the outer card wrapper. On hover, fires a single
     gloss sweep across the whole card (image + content area). The card's own
     overflow:hidden and border-radius clip it so it stays inside the rounded
     corners. Looks like a physical card catching light as you reach for it. */
  .resistact-card-shine { position: relative; }
  .resistact-card-shine::before {
    content: "";
    position: absolute; inset: 0;
    background: linear-gradient(110deg,
      transparent 20%,
      rgba(255,255,255,0.18) 42%,
      rgba(255,255,255,0.32) 50%,
      rgba(255,255,255,0.18) 58%,
      transparent 80%);
    pointer-events: none;
    z-index: 15;
    opacity: 0;
  }
  .resistact-card-shine:hover::before {
    animation: resistact-card-gloss 650ms ease-in-out forwards;
  }

  /* Banner desaturation — calms the grid by muting per-card photo color so
     12 cards in a row don't fight each other. On hover, the focused card
     pops back to full color. Only applied to real photo content; the brand
     fallback logo is already light and stays as-is.
       .resistact-banner-host       → outer card wrapper, the hover target
       .resistact-banner-desat      → b/w banner (default for all cards)
       .resistact-banner-half-desat → 50%-saturated banner, currently used
                                       only by the pinToTop "Spread the
                                       Word" card so it stays a little
                                       brand-color anchor in a grayscale
                                       grid
     Tweak the value to taste:
       1.00 = full color
       0.90 = barely muted (current default — rests just shy of full,
              pops to full on hover; the feed is now almost entirely
              full-color cartoon banners, so heavy desaturation made the
              few plain-photo cards look broken)
       0.70 = subtle, "still colored just less neon"
       0.50 = half-saturated
       0.35 = strong, editorial
       0.10 = whisper of color
       0.00 = full grayscale */
  .resistact-banner-desat {
    filter: saturate(0.9);
    transition: filter 250ms ease-out;
  }
  .resistact-banner-half-desat {
    filter: saturate(0.5);
    transition: filter 250ms ease-out;
  }
  .resistact-banner-host:hover .resistact-banner-desat,
  .resistact-banner-host:hover .resistact-banner-half-desat {
    filter: saturate(1);
  }
  /* Keep the rounded corners during the hover transform. Without this, the
     hover scale/translate/rotate re-rasterizes the card's composited layer and
     Chrome flashes square corners before re-applying the rounded overflow clip.
     Pre-promoting with will-change keeps the rounded backing stable throughout. */
  .resistact-banner-host {
    will-change: transform;
  }
  @media (prefers-reduced-motion: reduce) {
    .resistact-banner-desat,
    .resistact-banner-half-desat { transition: none; }
  }

  /* Hot-card flicker — applied to the 🔥 emoji on cards with boost counts
     above the HOT_BOOST_THRESHOLD in ActionCard. A slow 2s opacity + scale
     pulse signals "this one is moving" without flashing or strobing.
     Reduced-motion users get a steady icon — no animation. */
  @keyframes resistact-anim-flicker-kf {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.7; transform: scale(1.15); }
  }
  .resistact-anim-flicker {
    animation: resistact-anim-flicker-kf 2s ease-in-out infinite;
    will-change: opacity, transform;
  }
  @media (prefers-reduced-motion: reduce) {
    .resistact-anim-flicker { animation: none; }
  }
`;
