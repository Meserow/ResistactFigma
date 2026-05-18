/**
 * Lightweight confetti — for moments where the full CelebrationModal
 * fireworks spectacle would be overkill but we still want a "yay you did it"
 * burst. ~120 particles, falls from top of viewport, 3 seconds, gone.
 *
 * Why this exists separately from CelebrationModal: that component is bound
 * to action-completion + tier-up choreography (count-up, headlines, primary
 * CTA). We need a no-modal burst for cases like "user finished the Match
 * wizard for the first time" where there's no completion to celebrate, just
 * a small accomplishment-marker.
 *
 * Usage:
 *   import { burstConfetti } from "../lib/confetti";
 *   burstConfetti();          // one-off burst
 *   burstConfetti({ pieces: 240, duration: 4500 }); // a bigger one
 *
 * Respects prefers-reduced-motion — returns immediately without rendering.
 */
import { prefersReducedMotion } from "./animations";

interface ConfettiOpts {
  /** Number of particles. Default 140. */
  pieces?: number;
  /** Total flight time per particle (ms). Default 3200. */
  duration?: number;
  /** Palette overrides. Default = ResistAct brand + complementary. */
  colors?: string[];
}

const DEFAULT_COLORS = [
  "#fd8e33", // ResistAct orange
  "#23297e", // ResistAct navy
  "#FCD34D", // yellow
  "#10B981", // emerald
  "#3B82F6", // blue
  "#A855F7", // purple
  "#EC4899", // pink
];

export function burstConfetti(opts: ConfettiOpts = {}): void {
  if (prefersReducedMotion()) return;
  if (typeof document === "undefined") return;

  const pieces = opts.pieces ?? 140;
  const duration = opts.duration ?? 3200;
  const colors = opts.colors ?? DEFAULT_COLORS;

  // Container — fixed, full-viewport, pointer-events-none so the user can
  // keep clicking while confetti falls.
  const root = document.createElement("div");
  root.setAttribute("aria-hidden", "true");
  root.style.cssText = [
    "position:fixed",
    "inset:0",
    "pointer-events:none",
    "z-index:9999",
    "overflow:hidden",
  ].join(";");

  // Per-piece keyframes injected into the container's shadow scope via a
  // <style> child. We use the unique container so multiple bursts don't
  // collide on global keyframe names if they fire close together.
  const style = document.createElement("style");
  style.textContent = `
    @keyframes resistact-confetti-fall {
      0%   { transform: translate3d(0, -10vh, 0) rotate(0deg); opacity: 1; }
      100% { transform: translate3d(var(--drift), 110vh, 0) rotate(var(--spin)); opacity: 0.85; }
    }
  `;
  root.appendChild(style);

  const rand = (a: number, b: number) => a + Math.random() * (b - a);

  for (let i = 0; i < pieces; i++) {
    const p = document.createElement("span");
    const color = colors[Math.floor(Math.random() * colors.length)];
    const drift = `${rand(-180, 180)}px`;
    const spin  = `${rand(-720, 720)}deg`;
    const w = rand(6, 13);
    const h = rand(8, 18);
    const left = rand(0, 100);
    const delay = rand(0, duration * 0.4);
    const dur = rand(duration * 0.7, duration);
    // Mix shapes — squares + bars give the feed visual variety.
    const shape = Math.random() < 0.5 ? "border-radius:2px" : "border-radius:50%";
    p.style.cssText = [
      "position:absolute",
      `top:0`,
      `left:${left}%`,
      `width:${w}px`,
      `height:${h}px`,
      `background:${color}`,
      shape,
      "will-change:transform,opacity",
      `animation:resistact-confetti-fall ${dur}ms cubic-bezier(0.22, 0.61, 0.36, 1) ${delay}ms forwards`,
      `--drift:${drift}`,
      `--spin:${spin}`,
    ].join(";");
    root.appendChild(p);
  }

  document.body.appendChild(root);

  // Self-clean after the longest particle lands. +500ms safety margin.
  window.setTimeout(() => {
    root.remove();
  }, duration + 500);
}
