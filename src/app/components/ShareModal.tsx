import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Link, Mail, MessageSquare, Check, Share2 } from "lucide-react";
import { analytics } from "../lib/analytics";
import {
  intents, openShareWindow, openProtocolUrl, nativeShareLink, isMobile,
} from "../lib/share";
import {
  FacebookIcon, XIcon, ThreadsIcon, WhatsAppIcon, InstagramIcon, TikTokIcon, BlueSkyIcon,
} from "../lib/shareIcons";

interface ShareModalProps {
  cardId: number;
  title: string;
  description: string;
  onClose: () => void;
}

// Share the PRODUCTION deep link even from localhost/preview so the ?act=
// handler resolves and social scrapers can reach og tags. (Sharing a
// localhost URL would be a dead link for every recipient.)
function actShareUrl(cardId: number): string {
  const origin = /^https?:\/\/(localhost|127\.|\[?::1)/.test(window.location.origin)
    ? "https://www.resistact.org"
    : window.location.origin;
  return `${origin}/?act=${cardId}`;
}

// ─── Share platforms ──────────────────────────────────────────────────────────
function buildPlatforms(cardId: number, title: string, description: string) {
  const url = actShareUrl(cardId);
  const text = `${title} — Join the resistance! ${url}`;

  return [
    {
      id: "facebook",
      label: "Facebook",
      bg: "#1877F2",
      fg: "#fff",
      icon: <FacebookIcon />,
      action: () => openShareWindow(intents.facebook(url), "facebook"),
    },
    {
      id: "threads",
      label: "Threads",
      bg: "#000",
      fg: "#fff",
      icon: <ThreadsIcon />,
      action: () => openShareWindow(intents.threads(text), "threads"),
    },
    {
      id: "bluesky",
      label: "Bluesky",
      bg: "#0085FF",
      fg: "#fff",
      icon: <BlueSkyIcon />,
      action: () => openShareWindow(intents.bluesky(text), "bluesky"),
    },
    {
      id: "whatsapp",
      label: "WhatsApp",
      bg: "#25D366",
      fg: "#fff",
      icon: <WhatsAppIcon />,
      action: () => openShareWindow(intents.whatsapp(text), "whatsapp"),
    },
    {
      id: "instagram",
      label: "Instagram",
      bg: "linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)",
      fg: "#fff",
      icon: <InstagramIcon />,
      copyText: text,
      copyNote: "Text copied — paste it into Instagram!",
    },
    {
      id: "tiktok",
      label: "TikTok (copy)",
      bg: "#010101",
      fg: "#fff",
      icon: <TikTokIcon />,
      copyText: text,
      copyNote: "Text copied — paste it into TikTok!",
    },
    {
      id: "x",
      label: "X / Twitter",
      bg: "#000",
      fg: "#fff",
      icon: <XIcon />,
      action: () => openShareWindow(intents.x(title, url), "x"),
    },
    {
      id: "sms",
      label: "SMS",
      bg: "#34C759",
      fg: "#fff",
      icon: <MessageSquare className="w-5 h-5" />,
      action: () => openProtocolUrl(intents.sms(text)),
    },
    {
      id: "email",
      label: "Email",
      bg: "#6B7280",
      fg: "#fff",
      icon: <Mail className="w-5 h-5" />,
      action: () => openProtocolUrl(intents.mailto(title, `${description}\n\n${url}`)),
    },
    {
      id: "copy",
      label: "Copy Link",
      bg: "#F3F4F6",
      fg: "#111827",
      icon: <Link className="w-5 h-5" />,
      copyText: url,
      copyNote: "Link copied!",
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────
export function ShareModal({ cardId, title, description, onClose }: ShareModalProps) {
  const [toast, setToast] = useState<string | null>(null);
  // Per-tile confirmation. On mobile a copy-tile tap often jumps straight to
  // another app, so a 2.5s toast can go unseen — the tile's own checkmark swap
  // is the reliable feedback (same idea as FactShareModal's Copy button).
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const platforms = buildPlatforms(cardId, title, description);
  const url = actShareUrl(cardId);

  // Lock body scroll while open — on iOS the page behind an unlocked modal
  // scrolls under the user's thumb. Restore on unmount.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const handleCopy = (id: string, text: string, note: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setToast(note);
    setCopiedId(id);
    setTimeout(() => setToast(null), 2500);
    setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 2000);
  };

  // Render through a portal so `position: fixed` resolves to the viewport,
  // not to whatever transformed ancestor we live under (e.g. the hover-lifted
  // ActionCard). Same rationale as CardDetailsModal — without this the share
  // modal anchors inside the card it was opened from instead of centering.
  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        {/* Panel */}
        <div
          className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div>
              <p className="font-['Poppins',sans-serif] font-bold text-gray-900 text-base leading-tight">Share this Act</p>
              <p className="font-['Poppins',sans-serif] text-gray-400 text-xs mt-0.5 line-clamp-1">{title}</p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition-colors text-gray-500 shrink-0 ml-3"
            >
              <X size={16} />
            </button>
          </div>

          {/* Native share — mobile only. Link + text share via the OS sheet,
              which on a phone offers the user's actual apps (Messages, the
              installed social apps, etc.). Desktop navigator.share usually
              only offers "Save to Files", so we hide it there and lead with
              the platform grid instead. */}
          {isMobile() && typeof navigator !== "undefined" && "share" in navigator && (
            <div className="px-5 pt-4">
              <button
                onClick={() => {
                  analytics.shareClicked("native", "act", cardId);
                  const ok = nativeShareLink({
                    title,
                    text: `${title} — Join the resistance!`,
                    url,
                  });
                  if (!ok) handleCopy("copy", url, "Link copied!");
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#23297e] hover:bg-[#1a2060] text-white font-['Poppins',sans-serif] font-bold text-sm transition-colors"
              >
                <Share2 size={15} />
                Share via…
              </button>
            </div>
          )}

          {/* Platform grid */}
          <div className="p-5 grid grid-cols-3 gap-3">
            {platforms.map((p) => {
              const showCheck = copiedId === p.id;
              return (
              <button
                key={p.id}
                onClick={() => {
                  analytics.shareClicked(p.id, "act", cardId);
                  if (p.copyText) {
                    handleCopy(p.id, p.copyText, p.copyNote!);
                  } else if (p.action) {
                    p.action();
                  }
                }}
                className="flex flex-col items-center gap-2 group focus:outline-none"
              >
                {/* Icon circle */}
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 group-active:scale-95 transition-transform"
                  style={{
                    background: showCheck ? "#10b981" : p.bg,
                    color: showCheck ? "#fff" : p.fg,
                  }}
                >
                  {showCheck ? <Check className="w-5 h-5" /> : p.icon}
                </div>
                <span className="font-['Poppins',sans-serif] text-[11px] text-gray-600 font-medium leading-tight text-center">
                  {p.label}
                </span>
              </button>
              );
            })}
          </div>

          {/* Toast */}
          <div
            className={`absolute bottom-0 inset-x-0 transition-all duration-300 ${
              toast ? "translate-y-0 opacity-100" : "translate-y-full opacity-0"
            }`}
          >
            <div className="mx-4 mb-4 flex items-center gap-2 bg-gray-900 text-white text-sm font-['Poppins',sans-serif] px-4 py-2.5 rounded-xl shadow-lg">
              <Check size={15} className="text-green-400 shrink-0" />
              {toast}
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
