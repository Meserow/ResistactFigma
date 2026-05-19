/**
 * UserAvatar — renders a user's profile picture with a graceful fallback to
 * an initial-letter circle when the image URL fails to load (Google rotates
 * its avatar URLs, ad-blockers occasionally block them, and accounts can
 * have a null avatar by design).
 *
 * Why this exists: every admin surface had its own `<img>` tag that checked
 * `avatar ? <img/> : <Initial/>` — but that only catches null/empty, not
 * 404/blocked loads, so Google avatars rendered as Chrome's torn-paper
 * broken-image icon. We swap to the initial-letter circle on `onError`.
 */
import { useEffect, useState } from "react";

interface UserAvatarProps {
  name: string;
  avatar?: string | null;
  /** Tailwind sizing classes (`w-10 h-10`, `w-14 h-14`, etc.). */
  sizeClasses?: string;
  /** Extra classes to merge onto both the <img> and the fallback bubble. */
  className?: string;
  /** 0–100 progress to next tier. When provided, renders an XP ring around the avatar. */
  progressPct?: number;
  /** Color of the XP ring stroke (the user's current tier color). */
  ringColor?: string;
  /** Pixel size of the avatar — needed when rendering the ring. Defaults to 40 (matches w-10 h-10). */
  ringSizePx?: number;
}

export function UserAvatar({
  name,
  avatar,
  sizeClasses = "w-10 h-10",
  className = "ring-1 ring-gray-100",
  progressPct,
  ringColor = "#ed6624",
  ringSizePx = 40,
}: UserAvatarProps) {
  const [errored, setErrored] = useState(false);

  // If the parent swaps in a new avatar URL, give it another chance to load.
  useEffect(() => { setErrored(false); }, [avatar]);

  const initial = (name?.trim().charAt(0) || "?").toUpperCase();

  const showRing = typeof progressPct === "number" && progressPct >= 0;

  // Inner avatar bubble — the bit that gets wrapped in a ring (or rendered
  // standalone if no ring is requested).
  const inner = (!avatar || errored) ? (
    <div
      className={`${sizeClasses} rounded-full bg-[#23297e]/10 flex items-center justify-center ${className}`}
      aria-label={name}
    >
      <span className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-sm">
        {initial}
      </span>
    </div>
  ) : (
    <img
      src={avatar}
      alt={name}
      onError={() => setErrored(true)}
      // referrerPolicy="no-referrer" helps Google avatar URLs that 403 when
      // an unexpected Referer header is sent — a common reason these break.
      referrerPolicy="no-referrer"
      className={`${sizeClasses} rounded-full object-cover ${className}`}
    />
  );

  if (!showRing) return inner;

  // XP ring: an SVG circle whose stroke-dashoffset is animated by CSS
  // transition. The avatar itself sits inside via absolute positioning.
  // We add a small padding so the ring doesn't touch the avatar edge.
  const padding = 3; // px gap between ring and avatar
  const stroke = 2.5;
  const ring = ringSizePx + padding * 2 + stroke;
  const r = (ring - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, progressPct!));
  const offset = circ * (1 - pct / 100);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: ring, height: ring }} title={`${Math.round(pct)}% to next tier`}>
      <svg
        width={ring}
        height={ring}
        viewBox={`0 0 ${ring} ${ring}`}
        className="absolute inset-0 -rotate-90"
        aria-hidden
      >
        {/* Background track — light gray rail behind the progress arc */}
        <circle cx={ring / 2} cy={ring / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
        {/* Progress arc — animates via stroke-dashoffset transition. */}
        <circle
          cx={ring / 2}
          cy={ring / 2}
          r={r}
          fill="none"
          stroke={ringColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 700ms cubic-bezier(0.22, 0.61, 0.36, 1)" }}
        />
      </svg>
      <div className="relative">{inner}</div>
    </div>
  );
}
