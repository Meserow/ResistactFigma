import { useLayoutEffect, useRef } from "react";

/**
 * FLIP-animated grid wrapper for the Acts feed.
 *
 * When the feed re-orders (e.g. the user toggles a category pill), cards that
 * survive the new filter physically GLIDE from their old grid slot to their new
 * one, while cards that newly enter the set FADE + slide up with a small stagger.
 * This is the classic FLIP technique (First-Last-Invert-Play): we never animate
 * layout properties — only `transform` and `opacity`, which the compositor can
 * run on the GPU, so it stays cheap even with a full feed on screen.
 *
 * Cost controls:
 *  - Only cards within (or near) the viewport are animated; off-screen movers
 *    just snap into place. This bounds the work to ~a screenful of cards no
 *    matter how long the filtered list is.
 *  - `prefers-reduced-motion` disables all motion (cards snap), matching the
 *    rest of the app's animation gating.
 *
 * Each child must expose a stable `data-flip-id` so we can match a card's old
 * position to its new one across the re-render.
 */

type Pos = { left: number; top: number; vtop: number; vbottom: number };

// Cards this far outside the viewport (px) are snapped rather than animated.
const VIEWPORT_MARGIN = 280;
const FLIP_MS = 420;
const ENTER_MS = 380;
const ENTER_STAGGER_MS = 35;
const ENTER_MAX_STAGGER = 11; // cap the cascade so a big enter set doesn't drag
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

export function FlipGrid({
  signature,
  forceKey,
  className,
  children,
}: {
  /** Changes whenever the rendered card order/set changes — drives the effect. */
  signature: string;
  /** Bump to force a full re-stagger (every card treated as a new entrant). */
  forceKey: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef<Map<string, Pos>>(new Map());
  const lastForce = useRef(forceKey);

  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const nodes = Array.from(
      grid.querySelectorAll<HTMLElement>("[data-flip-id]"),
    );

    // 1. Reset any in-flight inline animation styles so measurements reflect the
    //    real settled layout (a getBoundingClientRect includes active transforms).
    for (const n of nodes) {
      n.style.transition = "none";
      n.style.transform = "";
      n.style.opacity = "";
    }

    // 2. Measure the new ("Last") positions, relative to the grid so page scroll
    //    between renders can't poison the deltas.
    const gridRect = grid.getBoundingClientRect();
    const next = new Map<string, Pos>();
    for (const n of nodes) {
      const id = n.dataset.flipId;
      if (!id) continue;
      const r = n.getBoundingClientRect();
      next.set(id, {
        left: r.left - gridRect.left,
        top: r.top - gridRect.top,
        vtop: r.top,
        vbottom: r.bottom,
      });
    }

    const force = forceKey !== lastForce.current;
    lastForce.current = forceKey;

    if (!reduce) {
      const vh = window.innerHeight;
      let enterIdx = 0;

      // 3a. Invert: offset survivors back to their old slot, prep entrants.
      for (const n of nodes) {
        const id = n.dataset.flipId;
        if (!id) continue;
        const after = next.get(id)!;
        const onscreen =
          after.vbottom > -VIEWPORT_MARGIN && after.vtop < vh + VIEWPORT_MARGIN;
        if (!onscreen) continue;

        const before = force ? undefined : prev.current.get(id);
        if (before) {
          const dx = before.left - after.left;
          const dy = before.top - after.top;
          if (dx || dy) {
            n.style.transform = `translate(${dx}px, ${dy}px)`;
            n.dataset.flipMove = "1";
          }
        } else {
          // New entrant — start low + transparent, staggered by visible order.
          const delay = Math.min(enterIdx++, ENTER_MAX_STAGGER) * ENTER_STAGGER_MS;
          n.style.transform = "translateY(14px)";
          n.style.opacity = "0";
          n.dataset.flipEnter = String(delay);
        }
      }

      // 3b. Play: on the next frame, transition everything back to rest.
      const raf = requestAnimationFrame(() => {
        for (const n of nodes) {
          if (n.dataset.flipEnter !== undefined) {
            const delay = n.dataset.flipEnter;
            n.style.transition = `transform ${ENTER_MS}ms ${EASE} ${delay}ms, opacity ${ENTER_MS}ms ease-out ${delay}ms`;
            n.style.transform = "";
            n.style.opacity = "";
            delete n.dataset.flipEnter;
          } else if (n.dataset.flipMove !== undefined) {
            n.style.transition = `transform ${FLIP_MS}ms ${EASE}`;
            n.style.transform = "";
            delete n.dataset.flipMove;
          }
        }
      });

      prev.current = next;
      return () => cancelAnimationFrame(raf);
    }

    prev.current = next;
  }, [signature, forceKey]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
