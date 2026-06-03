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
import { Heart, RotateCcw, X, MapPin, Globe, Clock, ArrowLeft, ArrowRight, Check, Flag } from "lucide-react";
import logoImg from "../../assets/resistact-logo-horizontal.webp";
import type { ActionCardData } from "./ActionCard";
import { colorForCategory } from "../lib/categoryGroups";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { FlagCardModal } from "./FlagCardModal";
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
  /** "I did this!" — the user completed the act. App marks it done. */
  onCompleted?: (card: ActionCardData) => void;
  /** Auth token (or null when anonymous) — forwarded to the flag modal so a
   *  report is attributed to the signed-in user, or sent with the anon key. */
  accessToken?: string | null;
}

// Past this horizontal drag distance (px), releasing commits the swipe.
const COMMIT_PX = 110;
// How far off-screen a committed/flung card travels.
const FLY_PX = 900;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function SwipeDeck({ cards, onClose, onInterested, onPass, onCompleted, accessToken }: SwipeDeckProps) {
  // Snapshot the incoming cards once, at mount. The parent removes a card from
  // its list the moment it's swiped (so it won't come back next time the deck
  // opens) — but if we read that shrinking list live, advancing `index` while
  // the array shrinks would skip cards. Freezing the deck for this session
  // keeps the gesture correct; the next open re-snapshots the (smaller) list.
  const [deck] = useState(() => cards);
  // Pointer into `deck` for the current top card.
  const [index, setIndex] = useState(0);
  // Stack of past verdicts so a single level of Undo is possible.
  const [history, setHistory] = useState<{ index: number; dir: Dir }[]>([]);
  // When set, the top card is mid-fling (off-screen animation in flight). This
  // is the ONLY swipe state that lives in React — the live drag is driven
  // imperatively (see below) so dragging never triggers a re-render.
  const [flying, setFlying] = useState<Dir | null>(null);
  // Cards swiped right ("saved") this session — shown in a recap when the user
  // hits Done. Marking an act "I already did this" does NOT add to this list.
  const [savedCards, setSavedCards] = useState<ActionCardData[]>([]);
  // When true, the deck shows the "here's what you saved" recap instead of the
  // card stack (triggered by the header Done button when there's something saved).
  const [summaryOpen, setSummaryOpen] = useState(false);
  // Card id being reported, if any — drives the flag modal. Set from the flag
  // button on the top card's banner; cleared when the modal closes.
  const [flagCardId, setFlagCardId] = useState<number | null>(null);
  const flagCard = flagCardId == null ? null : deck.find((c) => c.id === flagCardId) ?? null;

  const remaining = deck.length - index;
  const reduced = useMemo(prefersReducedMotion, []);
  const done = index >= deck.length;

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
      if (flyingRef.current || index >= deck.length) return;
      const card = deck[index];
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
        if (dir === "right") setSavedCards((s) => [...s, card]);
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
    [deck, index, onInterested, onPass, reduced],
  );

  const undo = useCallback(() => {
    if (flyingRef.current || history.length === 0) return;
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setIndex(last.index);
    // If the undone card had been saved, pull it back out of the saved list
    // (no-op for passed/completed cards, which were never added).
    const restored = deck[last.index];
    if (restored) setSavedCards((s) => s.filter((c) => c.id !== restored.id));
  }, [history, deck]);

  // "I did this!" — mark the current act completed and advance. Flies the card
  // UP (a distinct motion from the left/right pass/save) and reuses the same
  // finish-once guard as commit() so the deck never gets stuck mid-animation.
  const completeCurrent = useCallback(() => {
    if (flyingRef.current || index >= deck.length) return;
    const card = deck[index];
    flyingRef.current = "right";
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      flyingRef.current = null;
      setFlying(null);
      setHistory((h) => [...h, { index, dir: "right" }]);
      setIndex((i) => i + 1);
      try { onCompleted?.(card); } catch (err) { console.error("SwipeDeck complete callback threw:", err); }
    };
    if (reduced) { finish(); return; }
    setFlying("right");
    const el = topCardRef.current;
    if (el) {
      el.style.transition = "transform 0.3s ease-out";
      el.style.transform = `translate3d(0, -${FLY_PX}px, 0) rotate(-4deg)`;
      const onEnd = (ev: TransitionEvent) => {
        if (ev.propertyName !== "transform") return;
        el.removeEventListener("transitionend", onEnd);
        finish();
      };
      el.addEventListener("transitionend", onEnd);
    }
    window.setTimeout(finish, 380);
  }, [deck, index, onCompleted, reduced]);

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
    // Track the drag FIRST, then try to capture the pointer. setPointerCapture
    // can throw ("No active pointer with the given id") on some browsers/states
    // — if it does, we must NOT abort the handler, or startRef never gets set
    // and the card goes dead. Capture is only a nicety (keeps move events coming
    // if the finger leaves the card); the swipe works fine without it.
    startRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    dragXRef.current = 0;
    try { topCardRef.current?.setPointerCapture?.(e.pointerId); } catch { /* best-effort */ }
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
    try { topCardRef.current?.releasePointerCapture?.(start.id); } catch { /* best-effort */ }
    startRef.current = null;
    const x = dragXRef.current;
    if (Math.abs(x) > COMMIT_PX) {
      commit(x > 0 ? "right" : "left");
    } else {
      dragXRef.current = 0;
      paint(0, 0, true); // snap back
    }
  };

  // Scrollable recap of the acts saved this session — shared by the Done recap
  // and the end-of-stack screen.
  const savedList = (
    <div className="mt-4 flex max-h-[40vh] w-full flex-col gap-2 overflow-y-auto px-1 text-left">
      {savedCards.map((c) => (
        <div key={c.id} className="flex items-center gap-3 rounded-xl bg-white/10 p-2">
          <img
            src={c.cartoonImageUrl || c.topImage || cardFallbackImg}
            alt=""
            className="h-12 w-12 shrink-0 rounded-lg object-cover"
            draggable={false}
          />
          <div className="min-w-0 flex-1">
            <p className="font-['Poppins',sans-serif] text-sm font-semibold leading-snug text-white line-clamp-2">{c.title}</p>
            {c.category && (
              <span
                className="mt-1 inline-flex items-center rounded px-1.5 py-0.5 font-['Poppins',sans-serif] text-[10px] font-bold tracking-wide text-white"
                style={{ backgroundColor: colorForCategory(c.category) }}
              >
                {c.category}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="hero-modal-overlay fixed inset-0 z-[100] flex flex-col bg-[#0d1b2a]/80 backdrop-blur-sm">
      {/* Header — a full-width white bar so the (dark-artwork) ResistAct logo
          reads big and clear above the dark deck. Done + count sit on the white
          bar in brand navy; the swipe hint moves just below on the dark area. */}
      <div className="relative flex items-center justify-center bg-white px-4 py-3 shadow-md">
        {/* Done button — phones/tablets only. On wide desktop the user just
            clicks the darkened area around the card to exit. */}
        <button
          onClick={() => {
            // Hitting Done with saved acts → show the recap first; otherwise
            // (nothing saved, or already on the recap / end screen) just close.
            if (savedCards.length > 0 && !summaryOpen && !done) setSummaryOpen(true);
            else onClose();
          }}
          className="lg:hidden absolute left-3 font-['Poppins',sans-serif] text-sm font-semibold inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-[#23297e] hover:bg-[#23297e]/10 transition-colors"
        >
          <X size={16} /> Done
        </button>
        <img src={logoImg} alt="ResistAct" className="h-9 w-auto block" />
        {/* Phone/tablet: counts in the upper-right. Desktop moves them to a
            centered strip below the logo (see below). */}
        <span className="lg:hidden absolute right-3 inline-flex items-center gap-1.5 font-['Poppins',sans-serif] text-[11px] font-semibold tabular-nums">
          {savedCards.length > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[#ed6624]" title="Saved this session">
              <Heart size={11} fill="currentColor" /> {savedCards.length}
            </span>
          )}
          <span className="text-gray-500">{done ? "done" : `${remaining} to go`}</span>
        </span>
      </div>

      {/* Desktop: saved + remaining counts, centered below the logo / above the
          card (the upper-right version above is hidden on lg). */}
      {!done && !summaryOpen && (
        <div className="hidden lg:flex items-center justify-center gap-3 pt-3 font-['Poppins',sans-serif] text-base font-bold tabular-nums">
          <span className="inline-flex items-center gap-1.5 text-[#ed6624]">
            <Heart size={16} fill="currentColor" /> {savedCards.length} saved
          </span>
          <span className="text-white/30">•</span>
          <span className="text-white/80">{remaining} to go</span>
        </div>
      )}
      {/* Plain-language, arrow-led instructions. "Pass" is teal, "Save" is the
          brand orange — orange vs teal differ on the blue-yellow axis, so they
          stay distinguishable for red-green color blindness; the words/arrows/
          icons also convey it without relying on hue. Hidden on the terminal
          recap / end screens where there's nothing left to swipe. */}
      {/* Compact top-row hints for phones/tablets, where there's no room beside
          the card. On wide screens (lg+) these hide and the side hints below
          flank the card instead. */}
      {!done && !summaryOpen && (
      <div className="flex lg:hidden items-center justify-between gap-2 whitespace-nowrap px-3 py-2 font-['Poppins',sans-serif] text-[11px] font-bold">
        <span className="inline-flex items-center gap-1 text-teal-400">
          <ArrowLeft size={14} strokeWidth={3} className="shrink-0" />
          Swipe left to PASS
          <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-teal-400 text-white">
            <X size={9} strokeWidth={3.5} />
          </span>
        </span>
        <span className="inline-flex items-center gap-1 text-[#ed6624]">
          <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-[#ed6624] text-white">
            <Heart size={8} fill="currentColor" />
          </span>
          Swipe right to SAVE
          <ArrowRight size={14} strokeWidth={3} className="shrink-0" />
        </span>
      </div>
      )}

      {/* Deck */}
      <div
        className="relative flex-1 flex items-center justify-center px-4 overflow-hidden select-none"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        {/* Wide-desktop hints — flank the card, vertically centered. */}
        {!done && !summaryOpen && (
          <>
            <span className="pointer-events-none absolute left-6 top-1/2 hidden -translate-y-1/2 items-center gap-2 whitespace-nowrap font-['Poppins',sans-serif] text-base font-bold text-teal-400 lg:inline-flex">
              <ArrowLeft size={20} strokeWidth={3} className="shrink-0" />
              Swipe left to PASS
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-400 text-white">
                <X size={12} strokeWidth={3.5} />
              </span>
            </span>
            <span className="pointer-events-none absolute right-6 top-1/2 hidden -translate-y-1/2 items-center gap-2 whitespace-nowrap font-['Poppins',sans-serif] text-base font-bold text-[#ed6624] lg:inline-flex">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#ed6624] text-white">
                <Heart size={11} fill="currentColor" />
              </span>
              Swipe right to SAVE
              <ArrowRight size={20} strokeWidth={3} className="shrink-0" />
            </span>
          </>
        )}
        {summaryOpen ? (
          <div className="flex w-full max-w-sm flex-col items-center text-center text-white">
            <h2 className="font-['Poppins',sans-serif] text-2xl font-bold">Saved for later</h2>
            <p className="mt-1 font-['Poppins',sans-serif] text-sm text-white/80">
              You saved <strong>{savedCards.length}</strong> act{savedCards.length === 1 ? "" : "s"} — they're in My Matches whenever you're ready.
            </p>
            {savedList}
            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                onClick={() => setSummaryOpen(false)}
                className="font-['Poppins',sans-serif] text-sm font-semibold rounded-full bg-white/15 hover:bg-white/25 text-white px-5 py-2.5 transition-colors"
              >
                Keep swiping
              </button>
              <button
                onClick={onClose}
                className="font-['Poppins',sans-serif] text-sm font-bold rounded-full bg-[#ed6624] hover:bg-[#e07a28] text-white px-5 py-2.5 transition-colors"
              >
                Back to the feed
              </button>
            </div>
          </div>
        ) : done ? (
          <div className="flex w-full max-w-sm flex-col items-center text-center text-white">
            <div className="mb-2 text-5xl">🎉</div>
            <h2 className="font-['Poppins',sans-serif] text-2xl font-bold">That's the stack!</h2>
            <p className="mt-1 font-['Poppins',sans-serif] text-white/85">
              You saved <strong>{savedCards.length}</strong> act{savedCards.length === 1 ? "" : "s"}.
            </p>
            {savedCards.length > 0 ? (
              <>
                {savedList}
                <p className="mb-5 mt-4 font-['Poppins',sans-serif] text-sm text-white/70">
                  They're in My Matches so you can act on them.
                </p>
              </>
            ) : (
              <p className="mb-5 mt-1 font-['Poppins',sans-serif] text-sm text-white/70">
                Nothing saved this round — that's ok.
              </p>
            )}
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => { setIndex(0); setHistory([]); setSavedCards([]); }}
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
          deck.slice(index, index + 3).map((card, i) => {
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
                <SwipeCardFace card={card} onFlag={isTop ? () => setFlagCardId(card.id) : undefined} />
                {/* LIKE / PASS badges — opacity driven imperatively by paint(). */}
                {isTop && (
                  <>
                    {/* SAVE / PASS stamps — centered over the card's text area
                        (not the banner) so they read clearly against the white. */}
                    <span
                      ref={likeRef}
                      className="pointer-events-none absolute left-1/2 top-[68%] -translate-x-1/2 -translate-y-1/2 -rotate-12"
                      style={{ opacity: 0, transition: "opacity 0.1s" }}
                    >
                      <span className="inline-flex items-center gap-1.5 rounded-lg border-4 border-white bg-[#ed6624] px-3 py-1 font-['Poppins',sans-serif] text-2xl font-extrabold uppercase text-white shadow-lg">
                        <Heart size={22} strokeWidth={2.75} fill="currentColor" />
                        Save
                      </span>
                    </span>
                    <span
                      ref={nopeRef}
                      className="pointer-events-none absolute left-1/2 top-[68%] -translate-x-1/2 -translate-y-1/2 rotate-12"
                      style={{ opacity: 0, transition: "opacity 0.1s" }}
                    >
                      <span className="inline-flex items-center gap-1.5 rounded-lg border-4 border-white bg-teal-500 px-3 py-1 font-['Poppins',sans-serif] text-2xl font-extrabold uppercase text-white shadow-lg">
                        <X size={22} strokeWidth={3} />
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

      {/* Action bar — three equal-size circle buttons (Pass / Undo / Save),
          each with a two-line plain-language label, plus a small text link
          below for marking the act already done (kept compact but with a
          finger-friendly tap target). */}
      {!done && !summaryOpen && (
        <div className="py-4">
          <div className="mx-auto grid w-full max-w-[360px] grid-cols-3 gap-1 px-2">
            <ActionButton label="Pass" caption="Pass" sub="Not for Me">
              <DeckButton label="Pass" onClick={() => commit("left")} className="h-14 w-14 border-teal-500 bg-teal-500 text-white hover:bg-teal-600">
                <X size={24} strokeWidth={2.75} />
              </DeckButton>
            </ActionButton>
            <ActionButton label="Undo" caption="Undo" sub="Changed My Mind">
              <DeckButton
                label="Undo"
                onClick={undo}
                disabled={history.length === 0}
                className="h-14 w-14 border-gray-400 bg-gray-400 text-white hover:bg-gray-500 disabled:opacity-30"
              >
                <RotateCcw size={24} strokeWidth={2.75} />
              </DeckButton>
            </ActionButton>
            <ActionButton label="Save" caption="Save" sub="Will Do This!">
              <DeckButton label="Interested" onClick={() => commit("right")} className="h-14 w-14 border-[#ed6624] bg-[#ed6624] text-white hover:bg-[#d35a1d]">
                <Heart size={22} fill="currentColor" />
              </DeckButton>
            </ActionButton>
          </div>
          <div className="mt-2 text-center">
            <button
              type="button"
              onClick={completeCurrent}
              className="inline-flex items-center gap-1.5 px-4 py-2 font-['Poppins',sans-serif] text-xs font-medium italic text-gray-400 underline underline-offset-2 transition-colors hover:text-gray-500"
            >
              <Check size={13} strokeWidth={3} />
              Mark this one already done and add to my score!
            </button>
          </div>
        </div>
      )}

      {/* Report-a-problem modal. Rendered inside the deck overlay so its own
          fixed backdrop layers above the card stack (the overlay establishes
          the stacking context). Anyone — signed in or not — can flag. */}
      {flagCard && (
        <FlagCardModal
          cardId={flagCard.id}
          cardTitle={flagCard.title}
          accessToken={accessToken}
          onClose={() => setFlagCardId(null)}
        />
      )}
    </div>
  );
}

// ── Card face ─────────────────────────────────────────────────────────────────
// A purpose-built, calm presentation of one Act for the deck (we don't reuse
// ActionCard because its tap-to-open / footer actions fight the drag gesture).
function SwipeCardFace({ card, onFlag }: { card: ActionCardData; onFlag?: () => void }) {
  const banner = card.cartoonImageUrl || card.topImage || cardFallbackImg;
  const catColor = card.categoryColor || colorForCategory(card.category) || "#23297e";
  return (
    // Mirrors the card-details modal: rounded white panel, 3:2 banner with
    // category + location pills, full title and description, time meta.
    <div className="flex h-[calc(100dvh-268px)] sm:h-auto sm:max-h-[80vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className={`relative w-full min-h-[180px] flex-1 sm:min-h-0 sm:flex-none sm:aspect-[3/2] ${card.imageContain ? "bg-gray-50" : "bg-[#23297e]"}`}>
        <ImageWithFallback
          src={banner}
          alt=""
          className={`h-full w-full ${card.imageContain ? "object-contain p-3" : "object-cover"}`}
          draggable={false}
        />
        {/* Top-right cluster: the time-commitment pill (when present) sits next
            to a flag button so people can report an expired or inappropriate
            act without leaving the deck. The flag stops pointer-down from
            bubbling to the card so tapping it never starts a swipe-drag. */}
        <div className="absolute right-3 top-3 flex items-center gap-2">
          {card.timeCommitment && (
            <span className="inline-flex items-center gap-1 rounded-md bg-black/55 px-2.5 py-1 font-['Poppins',sans-serif] text-[12px] font-semibold text-white shadow-sm backdrop-blur-sm">
              <Clock size={12} /> {card.timeCommitment}
            </span>
          )}
          {onFlag && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onFlag(); }}
              title="Report a problem with this act"
              aria-label="Report"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/80 text-gray-500 shadow-sm backdrop-blur-sm transition-colors hover:bg-white hover:text-red-500"
            >
              <Flag size={15} />
            </button>
          )}
        </div>
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
      <div className="min-h-0 shrink overflow-hidden p-5">
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
      </div>
      {/* Footer row — category pill (left) + author (right), matching the main
          feed card so the category sits in the same place across card types. */}
      <div className="shrink-0 flex items-center justify-between gap-3 border-t border-gray-100 px-5 py-3">
        <span
          className="inline-flex items-center rounded-md px-2 py-0.5 font-['Poppins',sans-serif] text-[11px] font-bold tracking-wide text-white shrink-0"
          style={{ backgroundColor: catColor }}
        >
          {card.category}
        </span>
        {card.authorName && (
          <div className="min-w-0 text-right">
            <p className="font-['Poppins',sans-serif] font-semibold text-[12px] text-gray-800 truncate leading-tight">{card.authorName}</p>
            {card.authorRole && (
              <p className="font-['Poppins',sans-serif] text-[11px] text-gray-400 truncate leading-tight">{card.authorRole}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Round action button with a caption underneath (so the icons are labelled).
function ActionButton({ children, caption, sub }: { children: React.ReactNode; caption: string; sub?: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      {children}
      <span className="flex flex-col items-center text-center leading-tight">
        <span className="font-['Poppins',sans-serif] text-[13px] font-bold text-white">{caption}</span>
        {sub && <span className="font-['Poppins',sans-serif] text-[11px] font-medium text-white/70">{sub}</span>}
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
      className={`flex items-center justify-center rounded-full border-2 shadow-md transition-colors disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  );
}
