import { useState, useEffect } from "react";
import { X, Link, Mail, MessageSquare, Check } from "lucide-react";

interface ShareModalProps {
  title: string;
  description: string;
  onClose: () => void;
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
      <path d="m135.72 44.03c66.496 49.921 138.02 151.14 164.28 205.46 26.262-54.316 97.782-155.54 164.28-205.46 47.98-36.021 125.72-63.892 125.72 24.795 0 17.712-10.155 148.79-16.111 170.07-20.703 73.984-96.144 92.854-163.25 81.433 117.3 19.964 147.14 86.092 82.697 152.22-122.39 125.59-175.91-31.511-189.63-71.766-2.514-7.3797-3.6904-10.832-3.7077-7.8964-0.0174-2.9357-1.1937 0.51669-3.7077 7.8964-13.714 40.255-67.233 197.36-189.63 71.766-64.444-66.128-34.605-132.26 82.697-152.22-67.108 11.421-142.55-7.4491-163.25-81.433-5.9562-21.282-16.111-152.36-16.111-170.07 0-88.687 77.742-60.816 125.72-24.795z" />
    </svg>
  );
}

// ─── Share platforms ──────────────────────────────────────────────────────────
function buildPlatforms(title: string, description: string) {
  const url = window.location.href;
  const text = `${title} — Join the resistance! ${url}`;
  const enc = (s: string) => encodeURIComponent(s);

  return [
    {
      id: "facebook",
      label: "Facebook",
      bg: "#1877F2",
      fg: "#fff",
      icon: <FacebookIcon />,
      action: () => window.open(`https://www.facebook.com/sharer/sharer.php?u=${enc(url)}&quote=${enc(title)}`, "_blank"),
    },
    {
      id: "threads",
      label: "Threads",
      bg: "#000",
      fg: "#fff",
      icon: <ThreadsIcon />,
      action: () => window.open(`https://www.threads.net/intent/post?text=${enc(text)}`, "_blank"),
    },
    {
      id: "bluesky",
      label: "Bluesky",
      bg: "#0085FF",
      fg: "#fff",
      icon: <BlueSkyIcon />,
      action: () => window.open(`https://bsky.app/intent/compose?text=${enc(text)}`, "_blank"),
    },
    {
      id: "whatsapp",
      label: "WhatsApp",
      bg: "#25D366",
      fg: "#fff",
      icon: <WhatsAppIcon />,
      action: () => window.open(`https://wa.me/?text=${enc(text)}`, "_blank"),
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
      label: "TikTok",
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
      action: () => window.open(`https://twitter.com/intent/tweet?text=${enc(title)}&url=${enc(url)}`, "_blank"),
    },
    {
      id: "sms",
      label: "SMS",
      bg: "#34C759",
      fg: "#fff",
      icon: <MessageSquare className="w-5 h-5" />,
      action: () => { window.location.href = `sms:?body=${enc(text)}`; },
    },
    {
      id: "email",
      label: "Email",
      bg: "#6B7280",
      fg: "#fff",
      icon: <Mail className="w-5 h-5" />,
      action: () => window.open(`mailto:?subject=${enc(title)}&body=${enc(`${description}\n\n${url}`)}`, "_blank"),
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
export function ShareModal({ title, description, onClose }: ShareModalProps) {
  const [toast, setToast] = useState<string | null>(null);
  const [nativeShared, setNativeShared] = useState(false);
  const platforms = buildPlatforms(title, description);

  // On mobile, try the native share sheet first — avoids the Facebook app
  // misconfiguration error and gives a much better UX on iOS/Android.
  useEffect(() => {
    if (typeof navigator.share === "function" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      const url = window.location.href;
      navigator.share({ title, text: `${title} — Join the resistance!`, url })
        .then(() => { setNativeShared(true); onClose(); })
        .catch(() => { /* user cancelled or share failed — fall through to modal */ });
    }
  }, []);

  // If native share was triggered, render nothing while it's in progress
  if (nativeShared) return null;

  const handleCopy = (text: string, note: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setToast(note);
    setTimeout(() => setToast(null), 2500);
  };

  return (
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

          {/* Platform grid */}
          <div className="p-5 grid grid-cols-3 gap-3">
            {platforms.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  if (p.copyText) {
                    handleCopy(p.copyText, p.copyNote!);
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
                    background: p.bg,
                    color: p.fg,
                  }}
                >
                  {p.icon}
                </div>
                <span className="font-['Poppins',sans-serif] text-[11px] text-gray-600 font-medium leading-tight text-center">
                  {p.label}
                </span>
              </button>
            ))}
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
    </>
  );
}
