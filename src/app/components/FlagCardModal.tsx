import { useState } from "react";
import { Flag, X } from "lucide-react";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { analytics } from "../lib/analytics";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04`;

interface FlagCardModalProps {
  cardId: number;
  cardTitle: string;
  accessToken?: string | null;
  onClose: () => void;
}

const REASONS = [
  { value: "broken-link", label: "Link is broken" },
  { value: "wrong-info", label: "Details are wrong" },
  { value: "duplicate", label: "Duplicate" },
  { value: "out-of-date", label: "Info is stale" },
  { value: "not-on-topic", label: "Not a resistance act" },
  { value: "other", label: "Something else" },
];

export function FlagCardModal({ cardId, cardTitle, accessToken, onClose }: FlagCardModalProps) {
  const [reason, setReason] = useState<string>("broken-link");
  const [detail, setDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setStatus("idle");
    setError(null);
    try {
      const res = await fetch(`${API}/actions/${cardId}/flag`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken ?? publicAnonKey}`,
        },
        body: JSON.stringify({ reason, detail: detail.trim() }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      setStatus("ok");
      analytics.cardFlagged(cardId, reason);
      // Auto-close after a short beat so the user sees the confirmation.
      setTimeout(onClose, 1400);
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Flag ${cardTitle}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[calc(100dvh-1.5rem)] bg-white rounded-2xl shadow-xl flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <Flag size={16} className="text-[#ed6624]" />
            <p className="font-['Poppins',sans-serif] font-bold text-gray-900 text-[15px] leading-tight">
              Report a problem
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-2.5 overflow-y-auto flex-1">
          <p className="font-['Poppins',sans-serif] text-[12px] text-gray-600 mb-2 leading-snug">
            Flagging <span className="font-semibold text-gray-900">"{cardTitle}"</span>
            {" "}for admin review.
          </p>

          <p className="font-['Poppins',sans-serif] font-semibold text-[10px] uppercase tracking-wider text-gray-500 mb-1">
            What's wrong?
          </p>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mb-2.5">
            {REASONS.map((r) => (
              <label
                key={r.value}
                className="flex items-center gap-1.5 cursor-pointer rounded px-1 py-0.5 hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="flag-reason"
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                  className="accent-[#ed6624] shrink-0"
                />
                <span className="font-['Poppins',sans-serif] font-normal text-[12px] text-gray-800 leading-tight">
                  {r.label}
                </span>
              </label>
            ))}
          </div>

          <label className="block">
            <span className="font-['Poppins',sans-serif] font-semibold text-[10px] uppercase tracking-wider text-gray-500">
              Detail (optional)
            </span>
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Anything an admin should know."
              className="mt-0.5 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 font-['Poppins',sans-serif] text-[12px] text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#ed6624] focus:border-transparent"
            />
          </label>
        </div>

        <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-end gap-2 shrink-0">
          {status === "ok" && (
            <p className="font-['Poppins',sans-serif] text-sm text-[#0d8c6e] mr-auto">
              ✓ Sent — thanks.
            </p>
          )}
          {status === "error" && error && (
            <p className="font-['Poppins',sans-serif] text-xs text-red-600 mr-auto">
              {error}
            </p>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 font-['Poppins',sans-serif] text-sm font-semibold text-gray-600 hover:text-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || status === "ok"}
            className="px-4 py-2 font-['Poppins',sans-serif] text-sm font-bold bg-[#ed6624] hover:bg-[#e07a28] disabled:opacity-60 text-white rounded-lg transition-colors"
          >
            {submitting ? "Sending…" : "Send report"}
          </button>
        </div>
      </div>
    </div>
  );
}
