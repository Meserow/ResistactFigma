// SwipeDeck — a Tinder-style "Discover" mode for browsing Acts one at a time.
//
// PROTOTYPE: this is the interaction shell only. It presents whatever ranked
// list it's handed (today: the same `displayedCards` the feed shows) as a
// draggable card stack and records left/right verdicts. The learning loop that
// turns those verdicts into matcher signal (a `swipeAffinity` term in
// matcher.ts `score()`) is a deliberate next step — see the App-level
// `onInterested` / `onPass` callbacks, which is where that signal will be
// captured and persisted.
//
//   • Swipe RIGHT  → "this is a possibility" → bookmarked + counted
//   • Swipe LEFT   → "not for me"            → recorded as a pass
//
// Gestures are native pointer events + CSS transforms (no new dependency — the
// repo's animation style is CSS/rAF, not framer-motion). Buttons and arrow
// keys mirror the gesture so it's usable on desktop too.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Heart, RotateCcw, X, MapPin, Globe, Clock } from "lucide-react";
import type { ActionCardData } from "./ActionCard";
import { colorForCategory } from "../lib/categoryGroups";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import cardFallbackImg from "../../assets/resistact-card-fallback.webp";

type Dir = "left" | "right";

interface SwipeDeckProps {
  /** Ordered Acts to present — typically the current ranked feed. */
  cards: ActionCardData[];
  onClose: () => void;
  /** Right swipe — "this is a possibility". App bookmarks + (later) learns. */
  onInterested?: (card: ActionCardData) => void;
  /** Left swipe — "not for me". App records the pass + (later) learns. */
  onPass?: (card: ActionCardData) => void;
}

// Past this horizontal drag distance (px), releasing commits the swipe.
const COMMIT_PX = 110;
// How far off-screen a committed/flung card travels.
const FLY_PX = 900;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function SwipeDeck({ cards, onClose, onInterested, onPass }: SwipeDeckProps) {
  // Pointer into `cards` for the current top card.
  const [index, setIndex] = useState(0);
  // Stack of past verdicts so a single level of Undo is possible.
  const [history, setHistory] = useState<{ index: number; dir: Dir }[]>([]);
  // When set, the top card is mid-fling (off-screen animation in flight). This
  // is the ONLY swipe state that lives in React — the live drag is driven
  // imperatively (see below) so dragging never triggers a re-render.
  const [flying, setFlying] = useState<Dir | null>(null);

  const interestedCount = history.filter((h) => h.dir === "right").length;
  const remaining = cards.length - index;
  const reduced = useMemo(prefersReducedMotion, []);
  const done = index >= cards.length;

  // ── Imperative drag (no per-move React state) ───────────────────────────────
  // Re-rendering the whole deck on every pointermove made the gesture jagged on
  // phones (touchscreens fire 120+ move events/sec, each re-rendering 3 image
  // cards). Instead we mutate the top card's transform directly via a ref, so a
  // drag costs zero React renders and stays buttery on mobile. React only runs
  // once per *committed* swipe (to advance the index).
  const startRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const dragXRef = useRef(0);
  const topCardRef = useRef<HTMLDivElement | null>(null);
  const likeRef = useRef<HTMLSpanElement | null>(null);
  const nopeRef = useRef<HTMLSpanElement | null>(null);
  // Source of truth for "a card is mid-fling". A ref (read synchronously by the
  // gesture handlers) so it can never get stuck out of sync with the `flying`
  // state + a pending timer — that desync is what froze the deck after a few
  // swipes.
  const flyingRef = useRef<Dir | null>(null);

  const SPRING = "transform 0.32s cubic-bezier(.2,.8,.2,1)";

  // Paint the top card + LIKE/PASS badges at a given drag offset.
  const paint = useCallback((x: number, y: number, animate: boolean) => {
    const el = topCardRef.current;
    if (el) {
      el.style.transition = animate && !reduced ? SPRING : "none";
      el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${x / 22}deg)`;
    }
    const strength = Math.min(1, Math.abs(x) / COMMIT_PX);
    if (likeRef.current) likeRef.current.style.opacity = x > 40 ? String(strength) : "0";
    if (nopeRef.current) nopeRef.current.style.opacity = x < -40 ? String(strength) : "0";
  }, [reduced]);

  // Whenever a new card becomes the top card (index change / undo), reset its
  // transform to resting. Runs after render, so topCardRef points at the new
  // top node. The transition gives the next card a gentle settle-in.
  useEffect(() => {
    dragXRef.current = 0;
    paint(0, 0, true);
  }, [index, paint]);

  const commit = useCallback(
    (dir: Dir) => {
      if (flyingRef.current || index >= cards.length) return;
      const card = cards[index];
      flyingRef.current = dir;

      // Advance the deck + fire the verdict. Runs EXACTLY once — whichever of
      // the transitionend event or the safety timeout gets here first wins, the
      // other no-ops. Clears the flying flag FIRST so neither a thrown verdict
      // callback nor a dropped timer can ever leave the deck frozen.
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        flyingRef.current = null;
        setFlying(null);
        setHistory((h) => [...h, { index, dir }]);
        setIndex((i) => i + 1);
        try {
          if (dir === "right") onInterested?.(card);
          else onPass?.(card);
        } catch (err) {
          console.error("SwipeDeck verdict callback threw:", err);
        }
      };

      if (reduced) { finish(); return; }
      setFlying(dir);

      // Fling the current top card off-screen from wherever it is right now
      // (drag position for a gesture, centre for a button).
      const el = topCardRef.current;
      if (el) {
        el.style.transition = "transform 0.3s ease-out";
        const fx = dir === "right" ? FLY_PX : -FLY_PX;
        el.style.transform = `translate3d(${fx}px, -60px, 0) rotate(${dir === "right" ? 22 : -22}deg)`;
        // Advance when the fling actually finishes…
        const onEnd = (ev: TransitionEvent) => {
          if (ev.propertyName !== "transform") return;
          el.removeEventListener("transitionend", onEnd);
          finish();
        };
        el.addEventListener("transitionend", onEnd);
      }
      if (dir === "right" && likeRef.current) likeRef.current.style.opacity = "1";
      if (dir === "left" && nopeRef.current) nopeRef.current.style.opacity = "1";
      // …with a safety net in case transitionend never fires (animation
      // interrupted, tab backgrounded, no layout box, etc.).
      window.setTimeout(finish, 380);
    },
    [cards, index, onInterested, onPass, reduced],
  );

  const undo = useCallback(() => {
    if (flyingRef.current || history.length === 0) return;
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setIndex(last.index);
  }, [history]);

  // Keyboard: ←/→ swipe, ⌫ undo, Esc close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") commit("left");
      else if (e.key === "ArrowRight") commit("right");
      else if (e.key === "Backspace") { e.preventDefault(); undo(); }
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit, undo, onClose]);

  // ── Pointer drag on the top card ───────────────────────────────────────────
  // Capture on the card element itself (topCardRef) — NOT e.target, which is a
  // child (image/heading) that unmounts when the card flies, which used to
  // leave the next card unresponsive (the "only works once" bug).
  const onPointerDown = (e: React.PointerEvent) => {
    if (flyingRef.current || done) return;
    topCardRef.current?.setPointerCapture?.(e.pointerId);
    startRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    dragXRef.current = 0;
    paint(0, 0, false);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!startRef.current) return;
    const x = e.clientX - startRef.current.x;
    const y = e.clientY - startRef.current.y;
    dragXRef.current = x;
    paint(x, y, false);
  };
  const onPointerUp = () => {
    const start = startRef.current;
    if (!start) return;
    topCardRef.current?.releasePointerCapture?.(start.id);
    startRef.current = null;
    const x = dragXRef.current;
    if (Math.abs(x) > COMMIT_PX) {
      commit(x > 0 ? "right" : "left");
    } else {
      dragXRef.current = 0;
      paint(0, 0, true); // snap back
    }
  };

  return (
    <div className="hero-modal-overlay fixed inset-0 z-[100] flex flex-col bg-[#0d1b2a]/80 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <button
          onClick={onClose}
          className="font-['Poppins',sans-serif] text-sm font-semibold inline-flex items-center gap-1 rounded-full px-3 py-1.5 hover:bg-white/10 transition-colors shrink-0"
        >
          <X size={16} /> Done
        </button>
        <div className="min-w-0 text-center">
          <p className="font-['Poppins',sans-serif] text-sm leading-tight">
            <span className="resistact-anim-twinkle" aria-hidden>✨</span>{" "}
            <strong>Swipe to discover</strong>
          </p>
          <p className="font-['Poppins',sans-serif] text-[11px] text-white/70 leading-tight mt-0.5">
            Swipe right to save it · left to pass
          </p>
        </div>
        <span className="font-['Poppins',sans-serif] text-xs text-white/80 tabular-nums w-16 text-right shrink-0">
          {done ? "—" : `${remaining} to go`}
        </span>
      </div>

      {/* Deck */}
      <div className="relative flex-1 flex items-center justify-center px-4 overflow-hidden select-none">
        {done ? (
          <div className="text-center text-white max-w-sm">
            <div className="text-5xl mb-3">🎉</div>
            <h2 className="font-['Poppins',sans-serif] text-2xl font-bold mb-2">That's the stack!</h2>
            <p className="font-['Poppins',sans-serif] text-white/85 mb-1">
              You're interested in <strong>{interestedCount}</strong> act{interestedCount === 1 ? "" : "s"}.
            </p>
            <p className="font-['Poppins',sans-serif] text-sm text-white/70 mb-6">
              They've been saved to My Matches so you can act on them.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => { setIndex(0); setHistory([]); }}
                className="font-['Poppins',sans-serif] text-sm font-semibold rounded-full bg-white/15 hover:bg-white/25 text-white px-5 py-2.5 transition-colors"
              >
                Start over
              </button>
              <button
                onClick={onClose}
                className="font-['Poppins',sans-serif] text-sm font-bold rounded-full bg-[#ed6624] hover:bg-[#e07a28] text-white px-5 py-2.5 transition-colors"
              >
                Back to the feed
              </button>
            </div>
          </div>
        ) : (
          // Render up to 3 cards: the top (interactive) + 2 peeking behind.
          cards.slice(index, index + 3).map((card, i) => {
            const isTop = i === 0;
            // The top card's transform/transition are driven imperatively (see
            // paint()/commit()), so they're deliberately omitted here — React
            // must not own them or it would clobber the live drag on re-render.
            const style: React.CSSProperties = isTop
              ? { touchAction: "none", zIndex: 30, cursor: flying ? "default" : "grab", willChange: "transform" }
              : {
                  transform: `translateY(${i * 10}px) scale(${1 - i * 0.04})`,
                  transition: "transform 0.3s ease",
                  zIndex: 30 - i,
                  opacity: 1 - i * 0.15,
                };
            return (
              <div
                key={card.id}
                ref={isTop ? topCardRef : undefined}
                className="absolute w-[min(92vw,500px)]"
                style={style}
                onPointerDown={isTop ? onPointerDown : undefined}
                onPointerMove={isTop ? onPointerMove : undefined}
                onPointerUp={isTop ? onPointerUp : undefined}
                onPointerCancel={isTop ? onPointerUp : undefined}
              >
                <SwipeCardFace card={card} />
                {/* LIKE / PASS badges — opacity driven imperatively by paint(). */}
                {isTop && (
                  <>
                    <span
                      ref={likeRef}
                      className="pointer-events-none absolute left-5 top-6 -rotate-12"
                      style={{ opacity: 0, transition: "opacity 0.1s" }}
                    >
                      <span className="rounded-lg border-4 border-white bg-green-500 px-3 py-1 font-['Poppins',sans-serif] text-2xl font-extrabold uppercase text-white shadow-lg">
                        Yes
                      </span>
                    </span>
                    <span
                      ref={nopeRef}
                      className="pointer-events-none absolute right-5 top-6 rotate-12"
                      style={{ opacity: 0, transition: "opacity 0.1s" }}
                    >
                      <span className="rounded-lg border-4 border-white bg-red-500 px-3 py-1 font-['Poppins',sans-serif] text-2xl font-extrabold uppercase text-white shadow-lg">
                        Pass
                      </span>
                    </span>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Action bar + always-visible help so the gesture is never a guess. */}
      {!done && (
        <div className="flex flex-col items-center gap-2.5 py-5">
          <div className="flex items-center justify-center gap-2 font-['Poppins',sans-serif] text-[11px] text-white/80">
            <span className="inline-flex items-center gap-1"><X size={12} className="text-red-400" /> Left = not for me</span>
            <span className="text-white/30">•</span>
            <span className="inline-flex items-center gap-1"><Heart size={12} className="text-green-400" /> Right = save as a possibility</span>
          </div>
          <div className="flex items-start justify-center gap-7">
            <ActionButton label="Pass" caption="Pass">
              <DeckButton label="Pass" onClick={() => commit("left")} className="border-red-400 text-red-500 hover:bg-red-50">
                <X size={26} />
              </DeckButton>
            </ActionButton>
            <ActionButton label="Undo" caption="Undo">
              <DeckButton
                label="Undo"
                onClick={undo}
                disabled={history.length === 0}
                className="h-12 w-12 border-gray-300 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
              >
                <RotateCcw size={18} />
              </DeckButton>
            </ActionButton>
            <ActionButton label="Save" caption="Save">
              <DeckButton label="Interested" onClick={() => commit("right")} className="border-green-400 text-green-500 hover:bg-green-50">
                <Heart size={24} />
              </DeckButton>
            </ActionButton>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Card face ─────────────────────────────────────────────────────────────────
// A purpose-built, calm presentation of one Act for the deck (we don't reuse
// ActionCard because its tap-to-open / footer actions fight the drag gesture).
function SwipeCardFace({ card }: { card: ActionCardData }) {
  const banner = card.cartoonImageUrl || card.topImage || cardFallbackImg;
  const catColor = card.categoryColor || colorForCategory(card.category) || "#23297e";
  return (
    // Mirrors the card-details modal: rounded white panel, 3:2 banner with
    // category + location pills, full title and description, time meta.
    <div className="flex max-h-[76vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className={`relative aspect-[3/2] w-full shrink-0 ${card.imageContain ? "bg-gray-50" : "bg-[#23297e]"}`}>
        <ImageWithFallback
          src={banner}
          alt=""
          className={`h-full w-full ${card.imageContain ? "object-contain p-3" : "object-cover"}`}
          draggable={false}
        />
        <span
          className="absolute left-3 top-3 rounded-md px-2.5 py-1 font-['Poppins',sans-serif] text-[12px] font-bold tracking-wide text-white shadow-sm"
          style={{ backgroundColor: catColor }}
        >
          {card.category}
        </span>
        {(card.isOnline || card.location) && (
          <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-md bg-white/95 px-2.5 py-1 shadow-sm backdrop-blur-sm">
            {card.location ? (
              <>
                <MapPin size={12} className="text-gray-700" />
                <span className="font-['Poppins',sans-serif] text-[12px] text-gray-700">{card.location}</span>
                {card.isOnline && <Globe size={12} className="text-gray-700" aria-label="also doable remotely" />}
              </>
            ) : (
              <><Globe size={12} className="text-gray-700" /><span className="font-['Poppins',sans-serif] text-[12px] text-gray-700">Online</span></>
            )}
          </div>
        )}
      </div>
      <div className="overflow-hidden p-5">
        <h3 className="font-['Poppins',sans-serif] text-xl font-bold leading-snug text-[#23297e]">
          {card.title}
        </h3>
        {card.synopsis && (
          <p className="mt-1.5 font-['Poppins',sans-serif] text-sm italic leading-relaxed text-gray-500 line-clamp-2">
            {card.synopsis}
          </p>
        )}
        {card.description && (
          <p className="mt-2.5 font-['Poppins',sans-serif] text-[15px] leading-relaxed text-gray-700 line-clamp-6">
            {card.description}
          </p>
        )}
        {card.timeCommitment && (
          <div className="mt-3 inline-flex items-center gap-1 font-['Poppins',sans-serif] text-[12px] text-gray-500">
            <Clock size={13} /> {card.timeCommitment}
          </div>
        )}
      </div>
    </div>
  );
}

// Round action button with a caption underneath (so the icons are labelled).
function ActionButton({ children, caption }: { children: React.ReactNode; caption: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      {children}
      <span className="font-['Poppins',sans-serif] text-[11px] font-semibold text-white/80">{caption}</span>
    </div>
  );
}

function DeckButton({
  children, label, onClick, disabled, className = "",
}: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex h-16 w-16 items-center justify-center rounded-full border-2 bg-white transition-colors disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  );
}
