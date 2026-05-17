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
}

export function UserAvatar({
  name,
  avatar,
  sizeClasses = "w-10 h-10",
  className = "ring-1 ring-gray-100",
}: UserAvatarProps) {
  const [errored, setErrored] = useState(false);

  // If the parent swaps in a new avatar URL, give it another chance to load.
  useEffect(() => { setErrored(false); }, [avatar]);

  const initial = (name?.trim().charAt(0) || "?").toUpperCase();

  if (!avatar || errored) {
    return (
      <div
        className={`${sizeClasses} rounded-full bg-[#23297e]/10 flex items-center justify-center ${className}`}
        aria-label={name}
      >
        <span className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-sm">
          {initial}
        </span>
      </div>
    );
  }

  return (
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
}
