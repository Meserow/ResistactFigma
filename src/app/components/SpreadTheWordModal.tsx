import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { analytics } from "../lib/analytics";
import { X, Flame, Send, Check, Loader2, AlertCircle, Link, Mail, MessageSquare } from "lucide-react";
import { projectId } from "/utils/supabase/info";

const SHARE_API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04/share-invite`;

const DEFAULT_NOTE =
  `Hey! — I've been using this site. ResistAct gives you a few small, doable things to do each day instead of just doomscrolling. You pick how much time and energy you've got. No account required, no spam, no donation asks. Take a look.\n\n${window.location.origin}`;

function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// ─── Platform icon SVGs ───────────────────────────────────────────────────────
function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
function ThreadsIcon() {
  return (
    <svg viewBox="0 0 192 192" className="w-5 h-5" fill="currentColor">
      <path d="M141.537 88.988a66.667 66.667 0 0 0-2.518-1.143c-1.482-27.307-16.403-42.94-41.457-43.1h-.34c-14.986 0-27.449 6.396-35.12 18.05l13.333 9.19c5.73-8.696 14.723-10.548 21.787-10.548h.23c8.415.054 14.762 2.5 18.87 7.275 2.98 3.445 4.976 8.204 5.967 14.2a110.08 110.08 0 0 0-24.055-1.5c-23.658 1.368-38.86 15.268-37.87 34.578.498 9.83 5.44 18.3 13.915 23.895 7.176 4.782 16.424 7.114 26.043 6.597 12.719-.696 22.701-5.554 29.674-14.435 5.243-6.828 8.562-15.664 9.98-26.78 5.984 3.613 10.416 8.376 12.837 14.138 4.051 9.673 4.29 25.58-8.413 38.243-11.101 11.072-24.44 15.87-44.607 16.012-22.35-.163-39.27-7.348-50.293-21.354C36.16 136.23 30.754 117.8 30.546 94c.208-23.8 5.614-42.23 16.065-54.754 11.023-14.006 27.943-21.19 50.293-21.354 22.509.163 39.738 7.39 51.238 21.475 5.626 6.885 9.87 15.516 12.667 25.627l15.587-4.154c-3.368-12.458-8.83-23.217-16.316-32.07C143.713 11.33 122.22 2.19 95.044 2h-.466C67.52 2.19 46.33 11.36 32.043 28.716 19.337 44.24 12.876 66.05 12.647 94v.1c.23 27.95 6.69 49.76 19.396 65.284C46.33 176.74 67.52 185.91 94.578 186h.466c24.016-.174 40.93-6.475 54.85-20.37 18.257-18.213 17.736-41.047 11.688-55.024-4.417-10.553-12.97-19.1-19.045-21.617z" />
    </svg>
  );
}
function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
    </svg>
  );
}
function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
    </svg>
  );
}
function TikTokIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.75a8.17 8.17 0 0 0 4.77 1.52V6.82a4.85 4.85 0 0 1-1-.13z" />
    </svg>
  );
}

function BlueSkyIcon() {
  return (
    <svg viewBox="0 0 600 530" className="w-5 h-5" fill="currentColor">
      <path d="m135.72 44.03c66.496 49.921 138.02 151.14 164.28 205.46 26.262-54.316 97.782-155.54 164.28-205.46 47.98-36.021 125.72-63.892 125.72 24.795 0 17.712-10.155 148.79-16.111 170.07-20.703 73.984-96.144 92.854-163.25 81.433 117.3 19.964 147.14 86.092 82.697 152.22-122.39 125.59-175.91-31.511-189.63-71.766-2.514-7.3797-3.6904-10.832-3.7077-7.8964-0.0173-2.9357-1.1937 0.51669-3.7077 7.8964-13.714 40.255-67.233 197.36-189.63 71.766-64.444-66.128-34.605-132.26 82.697-152.22-67.108 11.421-142.55-7.4491-163.25-81.433-5.9562-21.282-16.111-152.36-16.111-170.07 0-88.687 77.742-60.816 125.72-24.795z"/>
    </svg>
  );
}

/**
 * Open a share URL in a new tab, reliably focusing the new tab.
 *
 * Why all this ceremony instead of a plain `window.open(url, "_blank")`:
 *   1. Previously the Facebook share opened a *popup window* (width/height
 *      features) while every other share opened a *tab*. Mixing window types
 *      confuses OS window stacking — after a Facebook popup is created, a
 *      subsequent Bluesky/Threads tab opens BEHIND the still-floating FB
 *      popup. Hence the user-reported "click Bluesky, Facebook stays on top"
 *      bug.
 *   2. Using a stable per-platform window name (e.g. "resistact-share-bluesky")
 *      means a second click on the same platform re-uses the same tab instead
 *      of spawning duplicates.
 *   3. We deliberately omit `noopener,noreferrer` so we get the window
 *      reference back and can `.focus()` it. To still close the opener leak,
 *      we null `win.opener` ourselves. (`rel="noopener noreferrer"` only
 *      applies to anchor elements.)
 */
function openShare(url: string, platformId: string) {
  const name = `resistact-share-${platformId}`;
  const win = window.open(url, name);
  if (win) {
    try { win.opener = null; } catch { /* cross-origin, already detached */ }
    try { win.focus(); } catch { /* popup blocker / browser-quirky */ }
  }
}

function buildPlatforms(siteUrl: string) {
  // Always share the production URL so Facebook/Twitter can scrape og:image,
  // even when testing on localhost.
  const shareUrl = /^https?:\/\/(localhost|127\.|\[?::1)/.test(siteUrl)
    ? "https://www.resistact.org/"
    : siteUrl;
  const shareText = `I've been using ResistAct to find small, doable actions to push back. Come join the resistance! ${shareUrl}`;
  const enc = (s: string) => encodeURIComponent(s);
  return [
    { id: "facebook", label: "Facebook", bg: "#1877F2", fg: "#fff", icon: <FacebookIcon />, action: () => {
      // Copy the caption + link to the clipboard so the user can paste it
      // into Facebook's composer if needed.
      try { navigator.clipboard?.writeText(shareText); } catch {}
      const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      const fbUrl = `https://${isIOS ? "m.facebook.com" : "www.facebook.com"}/sharer/sharer.php?u=${enc(shareUrl)}`;
      if (isIOS) {
        // iOS Safari blocks BOTH window.open AND window.location.assign when
        // they fire from inside a modal's button handler. The only reliable
        // workaround: build a real <a> element and click it programmatically.
        // Safari treats that exactly like a user-clicked link — no popup
        // blocker, no gesture-context check. Desktop path is untouched.
        const a = document.createElement("a");
        a.href = fbUrl;
        a.target = "_blank";
        a.rel = "noopener,noreferrer";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        // Desktop: keep existing popup behaviour so the user doesn't lose
        // their place on the ResistAct page when sharing.
        openShare(fbUrl, "facebook");
      }
    }, copyNote: "Caption + link copied. Paste it into the Facebook post — the ResistAct preview will appear." },
    { id: "threads",  label: "Threads",     bg: "#000", fg: "#fff", icon: <ThreadsIcon />,  action: () => openShare(`https://www.threads.net/intent/post?text=${enc(shareText)}`, "threads") },
    { id: "bluesky",  label: "Bluesky",     bg: "#0085FF", fg: "#fff", icon: <BlueSkyIcon />, action: () => openShare(`https://bsky.app/intent/compose?text=${enc(shareText)}`, "bluesky") },
    { id: "whatsapp", label: "WhatsApp",    bg: "#25D366", fg: "#fff", icon: <WhatsAppIcon />, action: () => openShare(`https://wa.me/?text=${enc(shareText)}`, "whatsapp") },
    { id: "instagram", label: "Instagram", bg: "linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)", fg: "#fff", icon: <InstagramIcon />, copyText: shareText, copyNote: "Text copied — paste it into Instagram!" },
    { id: "tiktok", label: "TikTok", bg: "#010101", fg: "#fff", icon: <TikTokIcon />, copyText: shareText, copyNote: "Text copied — paste it into TikTok!" },
    { id: "x",        label: "X / Twitter", bg: "#000", fg: "#fff", icon: <XIcon />, action: () => openShare(`https://twitter.com/intent/tweet?text=${enc(shareText)}`, "x") },
    { id: "sms", label: "SMS", bg: "#34C759", fg: "#fff", icon: <MessageSquare className="w-5 h-5" />, action: () => { window.location.href = `sms:?body=${enc(shareText)}`; } },
    { id: "email-app", label: "Email App", bg: "#6B7280", fg: "#fff", icon: <Mail className="w-5 h-5" />, action: () => openShare(`mailto:?subject=${enc("Actions you can take today — ResistAct")}&body=${enc(shareText)}`, "email") },
    { id: "copy", label: "Copy Link", bg: "#F3F4F6", fg: "#111827", icon: <Link className="w-5 h-5" />, copyText: shareUrl, copyNote: "Link copied!" },
  ];
}

// ─── Main component ───────────────────────────────────────────────────────────
export function SpreadTheWordModal({ onClose }: { onClose: () => void }) {
  const siteUrl = window.location.origin;
  const platforms = buildPlatforms(siteUrl);

  const [toast, setToast] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState("");
  const [note, setNote] = useState(DEFAULT_NOTE);
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Trap focus + Escape
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  // ── Email tag logic ──────────────────────────────────────────────────────
  function commitInput(raw = emailInput) {
    const parsed = raw.split(/[,;\s]+/).map(e => e.trim().toLowerCase()).filter(isValidEmail);
    if (parsed.length) {
      setTags(prev => [...new Set([...prev, ...parsed])]);
      setEmailInput("");
    }
  }

  function onTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitInput();
    } else if (e.key === "Backspace" && !emailInput && tags.length) {
      setTags(prev => prev.slice(0, -1));
    }
  }

  function removeTag(tag: string) {
    setTags(prev => prev.filter(t => t !== tag));
  }

  // ── Send handler ─────────────────────────────────────────────────────────
  async function sendInvites() {
    // Commit any un-entered partial email first
    const partial = emailInput.trim();
    const allTags = partial && isValidEmail(partial) ? [...new Set([...tags, partial])] : tags;
    if (!allTags.length) return;
    setTags(allTags);
    setEmailInput("");

    setSendState("sending");
    try {
      const res = await fetch(SHARE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: allTags, note }),
      });

      if (res.status === 503) {
        // No email service configured — fall back to mailto
        const enc = encodeURIComponent;
        window.open(
          `mailto:${allTags.join(",")}?subject=${enc("Actions you can take today — ResistAct")}&body=${enc(note)}`,
          "_blank"
        );
        setSendState("idle");
        return;
      }

      if (!res.ok) throw new Error("Send failed");
      setSendState("sent");
    } catch {
      setSendState("error");
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Spread the Word about ResistAct"
      onClick={onClose}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-[#0d1b2a]/60 p-4 sm:p-6 overflow-y-auto"
    >
      <div
        ref={cardRef}
        onClick={e => e.stopPropagation()}
        className="relative w-full max-w-[640px] my-auto rounded-2xl bg-white shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#ed6624] text-white">
            <Flame size={18} strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-['Poppins',sans-serif] font-bold text-gray-900 text-[16px] leading-tight">Spread the Word!</p>
            <p className="font-['Poppins',sans-serif] text-gray-400 text-[11px] mt-0.5">Resistance grows one share at a time.</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition-colors text-gray-500 shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Intro copy */}
        <div className="px-5 pt-4 pb-2">
          <p className="font-['Poppins',sans-serif] text-[13px] text-gray-700 leading-relaxed">
            <strong className="text-gray-900">Resistance grows one share at a time</strong> — but only if you actually share. Pick a friend who's been doomscrolling and send this their way. If everyone here invites two friends, ResistAct doubles by Tuesday. That's how movements actually scale — not virally, but two-by-two, through people who trust each other.
          </p>
        </div>

        {/* Social section header */}
        <div className="mx-5 flex items-center gap-3 pt-3 pb-1">
          <div className="flex-1 h-px bg-gray-300" />
          <span className="font-['Poppins',sans-serif] text-[11px] font-semibold text-gray-600 whitespace-nowrap">Share through social</span>
          <div className="flex-1 h-px bg-gray-300" />
        </div>

        {/* Social sharing grid */}
        <div className="px-5 pt-2 pb-3 grid grid-cols-5 gap-3">
          {platforms.map(p => (
            <button
              key={p.id}
              onClick={() => {
                // Analytics fires regardless of which branch handles the click
                // (some platforms copy text to clipboard, some open a tab) so
                // every share button is counted uniformly by platform `method`.
                analytics.shareClicked(p.id, "spread_the_word");
                if ("copyText" in p && p.copyText) {
                  navigator.clipboard.writeText(p.copyText).catch(() => {});
                  showToast((p as { copyNote: string }).copyNote);
                } else if ("action" in p && p.action) {
                  (p as { action: () => void }).action();
                  if ("copyNote" in p && (p as { copyNote?: string }).copyNote) {
                    showToast((p as { copyNote: string }).copyNote);
                  }
                }
              }}
              className="flex flex-col items-center gap-1.5 group focus:outline-none"
            >
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center shadow-sm group-hover:scale-110 group-active:scale-95 transition-transform"
                style={{ background: p.bg, color: p.fg }}
              >
                {p.icon}
              </div>
              <span className="font-['Poppins',sans-serif] text-[10px] text-gray-500 font-medium leading-tight text-center">{p.label}</span>
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="mx-5 flex items-center gap-3 my-1">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="font-['Poppins',sans-serif] text-[11px] font-semibold text-gray-600 whitespace-nowrap">Or email friends directly</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* Email section */}
        <div className="px-5 pb-5 pt-3 space-y-3">
          {/* Tag input */}
          <div>
            <label className="font-['Poppins',sans-serif] text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">
              To
            </label>
            <div
              onClick={() => inputRef.current?.focus()}
              className="min-h-[42px] w-full flex flex-wrap gap-1.5 rounded-lg border border-gray-300 px-3 py-2 cursor-text focus-within:border-[#ed6624] focus-within:ring-1 focus-within:ring-[#ed6624]/30 transition-colors"
            >
              {tags.map(tag => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 bg-[#ed6624]/10 text-[#c96a15] rounded-full px-2.5 py-0.5 font-['Poppins',sans-serif] text-[11px] font-medium"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); removeTag(tag); }}
                    className="text-[#c96a15]/60 hover:text-[#c96a15] transition-colors"
                    aria-label={`Remove ${tag}`}
                  >
                    <X size={10} strokeWidth={2.5} />
                  </button>
                </span>
              ))}
              <input
                ref={inputRef}
                type="email"
                multiple
                value={emailInput}
                onChange={e => setEmailInput(e.target.value)}
                onKeyDown={onTagKeyDown}
                onBlur={() => commitInput()}
                placeholder={tags.length === 0 ? "friend@example.com, another@..." : ""}
                className="flex-1 min-w-[140px] bg-transparent outline-none font-['Poppins',sans-serif] text-[13px] text-gray-700 placeholder:text-gray-400 placeholder:italic"
              />
            </div>
            <p className="font-['Poppins',sans-serif] text-[10.5px] text-gray-400 mt-1">Press Enter or comma to add each address</p>
          </div>

          {/* Personal note */}
          <div>
            <label className="font-['Poppins',sans-serif] text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">
              Personal note
            </label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={7}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 font-['Poppins',sans-serif] text-[13px] text-gray-700 leading-relaxed resize-none focus:border-[#ed6624] focus:ring-1 focus:ring-[#ed6624]/30 focus:outline-none transition-colors"
            />
          </div>

          {/* Send row */}
          <div className="flex items-center justify-between gap-3">
            {sendState === "error" && (
              <p className="flex items-center gap-1.5 font-['Poppins',sans-serif] text-[11px] text-red-500">
                <AlertCircle size={12} /> Something went wrong — try again.
              </p>
            )}
            {sendState === "sent" && (
              <p className="flex items-center gap-1.5 font-['Poppins',sans-serif] text-[11px] text-[#0d8c6e]">
                <Check size={12} /> Invites sent!
              </p>
            )}
            {(sendState === "idle" || sendState === "sending") && (
              <p className="font-['Poppins',sans-serif] text-[10px] text-gray-400 italic leading-snug">
                Sharing helps more than you think.<br />Thanks for doing this.
              </p>
            )}

            <button
              onClick={sendInvites}
              disabled={sendState === "sending" || sendState === "sent" || tags.length === 0}
              className="ml-auto flex items-center gap-2 rounded-lg bg-[#ed6624] px-4 py-2 font-['Poppins',sans-serif] text-[13px] font-bold text-white transition-colors hover:bg-[#c2521b] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sendState === "sending" ? (
                <><Loader2 size={14} className="animate-spin" /> Sending…</>
              ) : sendState === "sent" ? (
                <><Check size={14} /> Sent!</>
              ) : (
                <><Send size={14} /> Send invites</>
              )}
            </button>
          </div>
        </div>

        {/* Toast */}
        <div className={`absolute bottom-0 inset-x-0 transition-all duration-300 ${toast ? "translate-y-0 opacity-100" : "translate-y-full opacity-0"}`}>
          <div className="mx-4 mb-4 flex items-center gap-2 bg-gray-900 text-white text-sm font-['Poppins',sans-serif] px-4 py-2.5 rounded-xl shadow-lg">
            <Check size={14} className="text-green-400 shrink-0" />
            {toast}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
