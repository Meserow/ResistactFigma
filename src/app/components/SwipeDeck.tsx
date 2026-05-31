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
  // Live drag offset for the top card. dragging=false means "resting".
  const [drag, setDrag] = useState({ x: 0, y: 0, dragging: false });
  // When set, the top card is mid-fling (off-screen animation in flight).
  const [flying, setFlying] = useState<Dir | null>(null);

  const startRef = useRef<{ x: number; y: number } | null>(null);
  const interestedCount = history.filter((h) => h.dir === "right").length;
  const remaining = cards.length - index;
  const reduced = useMemo(prefersReducedMotion, []);

  const commit = useCallback(
    (dir: Dir) => {
      if (flying || index >= cards.length) return;
      const card = cards[index];
      const finish = () => {
        if (dir === "right") onInterested?.(card);
        else onPass?.(card);
        setHistory((h) => [...h, { index, dir }]);
        setIndex((i) => i + 1);
        setDrag({ x: 0, y: 0, dragging: false });
        setFlying(null);
      };
      if (reduced) { finish(); return; }
      setFlying(dir);
      // Let the fling transition play, then advance.
      window.setTimeout(finish, 300);
    },
    [cards, index, flying, onInterested, onPass, reduced],
  );

  const undo = useCallback(() => {
    if (flying || history.length === 0) return;
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setIndex(last.index);
    setDrag({ x: 0, y: 0, dragging: false });
  }, [flying, history]);

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
  const onPointerDown = (e: React.PointerEvent) => {
    if (flying) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    startRef.current = { x: e.clientX, y: e.clientY };
    setDrag({ x: 0, y: 0, dragging: true });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!startRef.current) return;
    setDrag({ x: e.clientX - startRef.current.x, y: e.clientY - startRef.current.y, dragging: true });
  };
  const onPointerUp = () => {
    if (!startRef.current) return;
    startRef.current = null;
    if (Math.abs(drag.x) > COMMIT_PX) commit(drag.x > 0 ? "right" : "left");
    else setDrag({ x: 0, y: 0, dragging: false }); // snap back
  };

  // Verdict intent from the live drag, for the LIKE / NOPE overlay badges.
  const intent: Dir | null = drag.x > 40 ? "right" : drag.x < -40 ? "left" : null;
  const intentStrength = Math.min(1, Math.abs(drag.x) / COMMIT_PX);

  // Top card transform — follows the finger while dragging, flies off on commit.
  const topTransform = (() => {
    if (flying) {
      const x = flying === "right" ? FLY_PX : -FLY_PX;
      return `translate(${x}px, -60px) rotate(${flying === "right" ? 22 : -22}deg)`;
    }
    return `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x / 22}deg)`;
  })();
  const topTransition = drag.dragging ? "none" : "transform 0.3s cubic-bezier(.2,.8,.2,1)";

  const done = index >= cards.length;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#23297e]/95 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <button
          onClick={onClose}
          className="font-['Poppins',sans-serif] text-sm font-semibold inline-flex items-center gap-1 rounded-full px-3 py-1.5 hover:bg-white/10 transition-colors"
        >
          <X size={16} /> Done
        </button>
        <p className="font-['Poppins',sans-serif] text-sm">
          <span className="resistact-anim-twinkle" aria-hidden>✨</span>{" "}
          <strong>Swipe to discover</strong>
        </p>
        <span className="font-['Poppins',sans-serif] text-xs text-white/80 tabular-nums w-16 text-right">
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
              They've been saved to your bookmarks so you can act on them.
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
            const style: React.CSSProperties = isTop
              ? { transform: topTransform, transition: topTransition, touchAction: "none", zIndex: 30, cursor: flying ? "default" : "grab" }
              : {
                  transform: `translateY(${i * 10}px) scale(${1 - i * 0.04})`,
                  transition: "transform 0.3s ease",
                  zIndex: 30 - i,
                  opacity: 1 - i * 0.15,
                };
            return (
              <div
                key={card.id}
                className="absolute w-[min(92vw,400px)]"
                style={style}
                onPointerDown={isTop ? onPointerDown : undefined}
                onPointerMove={isTop ? onPointerMove : undefined}
                onPointerUp={isTop ? onPointerUp : undefined}
                onPointerCancel={isTop ? onPointerUp : undefined}
              >
                <SwipeCardFace card={card} />
                {/* LIKE / NOPE badges, driven by the live drag on the top card. */}
                {isTop && intent && (
                  <>
                    <Badge kind="right" show={intent === "right"} strength={intentStrength} />
                    <Badge kind="left" show={intent === "left"} strength={intentStrength} />
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Action bar */}
      {!done && (
        <div className="flex items-center justify-center gap-6 py-5">
          <DeckButton label="Pass" onClick={() => commit("left")} className="border-red-400 text-red-500 hover:bg-red-50">
            <X size={26} />
          </DeckButton>
          <DeckButton
            label="Undo"
            onClick={undo}
            disabled={history.length === 0}
            className="h-12 w-12 border-white/40 text-white/80 hover:bg-white/10 disabled:opacity-30"
          >
            <RotateCcw size={18} />
          </DeckButton>
          <DeckButton label="Interested" onClick={() => commit("right")} className="border-green-400 text-green-500 hover:bg-green-50">
            <Heart size={24} />
          </DeckButton>
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
  const subtitle = card.synopsis || card.description;
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className="relative h-44 bg-[#23297e] overflow-hidden">
        <ImageWithFallback
          src={banner}
          alt=""
          className={`h-full w-full ${card.imageContain ? "object-contain" : "object-cover"}`}
          draggable={false}
        />
        <span
          className="absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white font-['Poppins',sans-serif]"
          style={{ backgroundColor: catColor }}
        >
          {card.category}
        </span>
      </div>
      <div className="p-4">
        <h3 className="font-['Poppins',sans-serif] text-lg font-bold leading-snug text-[#23297e]">
          {card.title}
        </h3>
        {subtitle && (
          <p className="mt-1.5 font-['Poppins',sans-serif] text-sm leading-relaxed text-gray-600 line-clamp-4">
            {subtitle}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-gray-500 font-['Poppins',sans-serif]">
          {card.timeCommitment && (
            <span className="inline-flex items-center gap-1"><Clock size={13} /> {card.timeCommitment}</span>
          )}
          {card.isOnline ? (
            <span className="inline-flex items-center gap-1"><Globe size={13} /> Online</span>
          ) : card.location ? (
            <span className="inline-flex items-center gap-1"><MapPin size={13} /> {card.location}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Badge({ kind, show, strength }: { kind: Dir; show: boolean; strength: number }) {
  const isRight = kind === "right";
  return (
    <div
      className={`pointer-events-none absolute top-6 ${isRight ? "left-5 -rotate-12" : "right-5 rotate-12"}`}
      style={{ opacity: show ? strength : 0, transition: "opacity 0.1s" }}
    >
      <span
        className={`rounded-lg border-4 px-3 py-1 font-['Poppins',sans-serif] text-2xl font-extrabold uppercase ${
          isRight ? "border-green-500 text-green-500" : "border-red-500 text-red-500"
        }`}
      >
        {isRight ? "Yes" : "Pass"}
      </span>
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
