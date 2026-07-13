import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { analytics } from "../lib/analytics";
import { X, Flame, Send, Check, Loader2, AlertCircle, Link, Mail, MessageSquare } from "lucide-react";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { intents, openShareWindow, openProtocolUrl, isMobile } from "../lib/share";
import {
  FacebookIcon, XIcon, ThreadsIcon, WhatsAppIcon, InstagramIcon, TikTokIcon, BlueSkyIcon,
} from "../lib/shareIcons";

const SHARE_API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04/share-invite`;

const DEFAULT_NOTE =
  `Hey! — I've been using this site. ResistAct gives you a few small, doable things to do each day instead of just doomscrolling. You pick how much time and energy you've got. No account required, no spam, no donation asks. Take a look.\n\n${window.location.origin}`;

function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function buildPlatforms(siteUrl: string) {
  // Always share the production URL so Facebook/Twitter can scrape og:image,
  // even when testing on localhost.
  const shareUrl = /^https?:\/\/(localhost|127\.|\[?::1)/.test(siteUrl)
    ? "https://www.resistact.org/"
    : siteUrl;
  const shareText = `I've been using ResistAct to find small, doable actions to push back. Come join the resistance! ${shareUrl}`;
  // Facebook killed pre-fill support in sharer.php years ago, and on mobile
  // the FB app intercepts the URL and drops users on the feed with nothing
  // composed. So on mobile we behave exactly like Instagram/TikTok: copy
  // caption+link to clipboard, show a paste-it toast, and let the user paste
  // into the FB app themselves. Desktop keeps the popup composer (the URL
  // still attaches a link preview even without text). Uses the shared isMobile()
  // (which unmasks iPadOS's MacIntel disguise) — no local UA regex.
  const mobile = isMobile();
  return [
    mobile
      ? { id: "facebook", label: "Facebook", bg: "#1877F2", fg: "#fff", icon: <FacebookIcon />, copyText: shareText, copyNote: "Text copied — paste it into Facebook!" }
      : { id: "facebook", label: "Facebook", bg: "#1877F2", fg: "#fff", icon: <FacebookIcon />, action: () => openShareWindow(intents.facebook(shareUrl), "facebook") },
    { id: "threads",  label: "Threads",     bg: "#000", fg: "#fff", icon: <ThreadsIcon />,  action: () => openShareWindow(intents.threads(shareText), "threads") },
    { id: "bluesky",  label: "Bluesky",     bg: "#0085FF", fg: "#fff", icon: <BlueSkyIcon />, action: () => openShareWindow(intents.bluesky(shareText), "bluesky") },
    { id: "whatsapp", label: "WhatsApp",    bg: "#25D366", fg: "#fff", icon: <WhatsAppIcon />, action: () => openShareWindow(intents.whatsapp(shareText), "whatsapp") },
    { id: "instagram", label: "Instagram", bg: "linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)", fg: "#fff", icon: <InstagramIcon />, copyText: shareText, copyNote: "Text copied — paste it into Instagram!" },
    { id: "tiktok", label: "TikTok", bg: "#010101", fg: "#fff", icon: <TikTokIcon />, copyText: shareText, copyNote: "Text copied — paste it into TikTok!" },
    { id: "x",        label: "X / Twitter", bg: "#000", fg: "#fff", icon: <XIcon />, action: () => openShareWindow(intents.x(shareText), "x") },
    { id: "sms", label: "SMS", bg: "#34C759", fg: "#fff", icon: <MessageSquare className="w-5 h-5" />, action: () => openProtocolUrl(intents.sms(shareText)) },
    { id: "email-app", label: "Email App", bg: "#6B7280", fg: "#fff", icon: <Mail className="w-5 h-5" />, action: () => openProtocolUrl(intents.mailto("Actions you can take today — ResistAct", shareText)) },
    { id: "copy", label: "Copy Link", bg: "#F3F4F6", fg: "#111827", icon: <Link className="w-5 h-5" />, copyText: shareUrl, copyNote: "Link copied!" },
  ];
}

// ─── Main component ───────────────────────────────────────────────────────────
export function SpreadTheWordModal({ onClose, onShared, artUrl }: { onClose: () => void; onShared?: () => void; artUrl?: string }) {
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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${publicAnonKey}`,
        },
        body: JSON.stringify({ emails: allTags, note }),
      });

      if (res.status === 503) {
        // No email service configured — fall back to the user's mail client.
        // Use location.href, not window.open: window.open("mailto:…") can
        // leave a stuck blank tab in iOS Safari.
        const enc = encodeURIComponent;
        window.location.href =
          `mailto:${allTags.join(",")}?subject=${enc("Actions you can take today — ResistAct")}&body=${enc(note)}`;
        onShared?.();
        setSendState("idle");
        return;
      }

      if (!res.ok) throw new Error("Send failed");
      onShared?.();
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
        className="relative w-full max-w-[640px] my-auto flex flex-col max-h-[calc(100dvh-2rem)] rounded-2xl bg-white shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="shrink-0 flex items-center gap-3 px-5 py-4 border-b border-gray-100">
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

        {/* Scrollable body — header stays pinned above, the Send row stays
            pinned below, so the primary action is always reachable even when
            the modal is taller than a phone viewport. */}
        <div className="flex-1 overflow-y-auto">
        {/* Act art — moved here from the pinned "Spread the Word" feed card,
            which now shows the ResistAct fist instead. */}
        {artUrl && (
          <img
            src={artUrl}
            alt=""
            aria-hidden="true"
            className="w-full h-[236px] object-cover object-top"
          />
        )}
        {/* Intro copy */}
        <div className="px-5 pt-3 pb-1.5">
          <p className="font-['Poppins',sans-serif] text-[12.5px] text-gray-700 leading-snug">
            <strong className="text-gray-900">Resistance grows one share at a time</strong> — but only if you actually share. Pick a friend who's been doomscrolling and send this their way. If everyone here invites two friends, ResistAct doubles by Tuesday. That's how movements actually scale — not virally, but two-by-two, through people who trust each other.
          </p>
        </div>

        {/* Social section header */}
        <div className="mx-5 flex items-center gap-3 pt-2 pb-1">
          <div className="flex-1 h-px bg-gray-300" />
          <span className="font-['Poppins',sans-serif] text-[11px] font-semibold text-gray-600 whitespace-nowrap">Share through social</span>
          <div className="flex-1 h-px bg-gray-300" />
        </div>

        {/* Social sharing grid */}
        <div className="px-5 pt-1.5 pb-2 grid grid-cols-5 gap-2.5">
          {platforms.map(p => (
            <button
              key={p.id}
              onClick={() => {
                // Analytics fires regardless of which branch handles the click
                // (some platforms copy text to clipboard, some open a tab) so
                // every share button is counted uniformly by platform `method`.
                analytics.shareClicked(p.id, "spread_the_word");
                // Any genuine share action counts as "spread the word" — let the
                // parent record it (and hide the pinned card for logged-in users).
                onShared?.();
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
                className="w-10 h-10 rounded-xl flex items-center justify-center shadow-sm group-hover:scale-110 group-active:scale-95 transition-transform"
                style={{ background: p.bg, color: p.fg }}
              >
                {p.icon}
              </div>
              <span className="font-['Poppins',sans-serif] text-[10px] text-gray-500 font-medium leading-tight text-center">{p.label}</span>
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="mx-5 flex items-center gap-3 my-0.5">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="font-['Poppins',sans-serif] text-[11px] font-semibold text-gray-600 whitespace-nowrap">Or email friends directly</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* Email section */}
        <div className="px-5 pb-4 pt-2.5 space-y-2.5">
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
              rows={5}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 font-['Poppins',sans-serif] text-[13px] text-gray-700 leading-relaxed resize-none focus:border-[#ed6624] focus:ring-1 focus:ring-[#ed6624]/30 focus:outline-none transition-colors"
            />
          </div>

        </div>{/* end email section */}
        </div>{/* end scrollable body */}

        {/* Send row — pinned footer. Always visible at the bottom of the
            modal so the primary action never falls below the fold on a
            phone, no matter how tall the body content gets. */}
        <div className="shrink-0 flex items-center justify-between gap-3 border-t border-gray-100 bg-white px-5 py-3">
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
              <p className="flex-1 min-w-0 font-['Poppins',sans-serif] text-[10px] text-gray-400 italic leading-tight">
                <span className="block whitespace-nowrap">Sharing helps more than you think.</span>
                <span className="block whitespace-nowrap">Thanks for doing this.</span>
              </p>
            )}

            <button
              onClick={sendInvites}
              disabled={sendState === "sending" || sendState === "sent" || tags.length === 0}
              className="ml-auto shrink-0 flex items-center gap-2 rounded-lg bg-[#ed6624] px-4 py-2 font-['Poppins',sans-serif] text-[13px] font-bold text-white transition-colors hover:bg-[#c2521b] disabled:opacity-50 disabled:cursor-not-allowed"
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
