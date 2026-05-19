import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, MessageCircle, Send, Check } from "lucide-react";

// Feedback recipient. Used to assemble the mailto: link below.
// The Supabase /feedback endpoint is left wired up server-side (so old
// integrations don't break) but the UI now opens the user's email client
// directly — that's the only path Ellen actually reads.
const FEEDBACK_EMAIL = "ellen@meserow.com";

const TYPES = [
  { value: "bug",     label: "Something is broken" },
  { value: "feature", label: "Feature request" },
  { value: "general", label: "General feedback" },
  { value: "other",   label: "Other" },
];

interface FeedbackModalProps {
  onClose: () => void;
  userEmail?: string | null;
  userName?: string | null;
}

export function FeedbackModal({ onClose, userEmail, userName }: FeedbackModalProps) {
  const [type, setType] = useState("general");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(userEmail ?? "");
  const [sendState, setSendState] = useState<"idle" | "sent">("idle");
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  useEffect(() => {
    cardRef.current?.querySelector<HTMLElement>("select,textarea,input")?.focus();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    // Open the user's email client via mailto: AND copy the message to the
    // clipboard. The dual-path matters because:
    //   - mailto: only triggers when the user has a registered default email
    //     handler (Apple Mail, Outlook, etc.). Users whose default is "Gmail
    //     in the browser" or who never configured one get silently nothing.
    //   - Clipboard always works. Worst case the user pastes into their
    //     webmail (Gmail tab, etc.) and sends from there.
    // We surface BOTH options in the success state so users can pick.
    const typeLabel = TYPES.find((t) => t.value === type)?.label ?? type;
    const subject = `ResistAct feedback — ${typeLabel}`;
    const bodyLines = [
      message.trim(),
      "",
      "—",
      userName ? `From: ${userName}` : null,
      email.trim() ? `Reply to: ${email.trim()}` : null,
      `Sent from: ${typeof window !== "undefined" ? window.location.href : "ResistAct"}`,
    ].filter(Boolean) as string[];
    const body = bodyLines.join("\n");
    const href = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    // Try mailto first. Use window.open instead of location.href so the
    // current page isn't navigated away from if no handler is registered.
    try { window.open(href, "_blank"); } catch { /* ignored */ }
    // Always copy a paste-ready version to the clipboard.
    const clipboardText = `To: ${FEEDBACK_EMAIL}\nSubject: ${subject}\n\n${body}`;
    navigator.clipboard?.writeText(clipboardText).catch(() => { /* ignored */ });
    setSendState("sent");
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Share feedback"
      onClick={onClose}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-[#0d1b2a]/60 p-4 sm:p-6 overflow-y-auto"
    >
      <div
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[480px] my-auto rounded-2xl bg-white shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <X size={18} />
          </button>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#23297e] text-white">
              <MessageCircle size={18} strokeWidth={2} />
            </div>
            <div>
              <h2 className="font-['Poppins',sans-serif] font-bold text-[18px] text-[#23297e] leading-tight">
                Share Feedback
              </h2>
              <p className="font-['Poppins',sans-serif] text-[12px] text-gray-400 leading-snug">
                Beta testers make this better. We read every message.
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {sendState === "sent" ? (
            <div className="flex flex-col items-center py-6 gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-[#23297e]/10 flex items-center justify-center">
                <Check size={22} className="text-[#23297e]" />
              </div>
              <p className="font-['Poppins',sans-serif] font-bold text-[16px] text-[#23297e]">Two ways to send</p>
              <div className="font-['Poppins',sans-serif] text-[13px] text-gray-600 max-w-[360px] space-y-2 text-left">
                <p>
                  <strong className="text-[#23297e]">1. Email app:</strong> Check your default email app — we tried to pre-fill a message to <span className="font-mono text-[12px]">{FEEDBACK_EMAIL}</span>. If it opened, just hit Send.
                </p>
                <p>
                  <strong className="text-[#23297e]">2. Webmail (Gmail, etc.):</strong> The full message is on your clipboard. Open Gmail / Outlook in a tab, start a new email, and paste with <strong>⌘V</strong>.
                </p>
              </div>
              <button
                onClick={onClose}
                className="mt-2 px-5 py-2 rounded-full bg-[#23297e] text-white font-['Poppins',sans-serif] font-semibold text-sm hover:bg-[#1a1f5e] transition-colors"
              >
                Close
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block font-['Poppins',sans-serif] text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Type
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 pl-3 pr-10 py-2 font-['Poppins',sans-serif] text-[13px] text-gray-700 focus:border-[#23297e] focus:ring-1 focus:ring-[#23297e]/30 focus:outline-none transition-colors bg-white"
                >
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-['Poppins',sans-serif] text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Message <span className="text-red-400 normal-case font-normal">*</span>
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  required
                  placeholder="Tell us what you think, what broke, or what you wish existed…"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 font-['Poppins',sans-serif] text-[13px] text-gray-700 leading-relaxed resize-none focus:border-[#23297e] focus:ring-1 focus:ring-[#23297e]/30 focus:outline-none transition-colors placeholder:text-gray-300"
                />
              </div>

              <div>
                <label className="block font-['Poppins',sans-serif] text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Email <span className="text-gray-300 normal-case font-normal italic">(optional — only if you want a reply)</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 font-['Poppins',sans-serif] text-[13px] text-gray-700 focus:border-[#23297e] focus:ring-1 focus:ring-[#23297e]/30 focus:outline-none transition-colors placeholder:text-gray-300"
                />
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={!message.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#23297e] text-white font-['Poppins',sans-serif] font-bold text-sm hover:bg-[#1a1f5e] disabled:opacity-50 transition-colors"
                >
                  <Send size={14} />
                  Open in email app
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
