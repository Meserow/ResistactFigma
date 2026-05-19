import { useEffect, useState } from "react";
import { Flag, X, ExternalLink } from "lucide-react";
import { projectId } from "/utils/supabase/info";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04`;

interface FlagRecord {
  id: string;
  cardId: number;
  cardTitle: string | null;
  reason: string;
  detail: string;
  reporterId: string | null;
  reporterName: string | null;
  reporterEmail: string | null;
  createdAt: string;
}

const REASON_LABELS: Record<string, string> = {
  "broken-link": "Broken link / 404",
  "out-of-date": "Out of date",
  "wrong-info": "Wrong info",
  "not-on-topic": "Not on topic",
  duplicate: "Duplicate",
  other: "Other",
};

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const secs = Math.max(0, (Date.now() - t) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86_400)}d ago`;
}

interface FlagsAdminModalProps {
  accessToken: string;
  onClose: () => void;
  /** Called whenever a flag is dismissed so the parent can refresh its count. */
  onFlagsChange?: (newCount: number) => void;
}

export function FlagsAdminModal({ accessToken, onClose, onFlagsChange }: FlagsAdminModalProps) {
  const [flags, setFlags] = useState<FlagRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch(`${API}/admin/flags`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
      const data = await res.json();
      const list = (data.flags as FlagRecord[]) ?? [];
      setFlags(list);
      onFlagsChange?.(list.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load flags");
      setFlags([]);
    }
  }

  useEffect(() => { load(); }, []);

  async function dismiss(flagId: string) {
    setDismissing(flagId);
    try {
      const res = await fetch(`${API}/admin/flags/${flagId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
      setFlags((prev) => {
        const next = (prev ?? []).filter((f) => f.id !== flagId);
        onFlagsChange?.(next.length);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to dismiss flag");
    } finally {
      setDismissing(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Flagged acts"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] bg-white rounded-2xl shadow-xl flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <Flag size={18} className="text-[#ed6624]" />
            <p className="font-['Poppins',sans-serif] font-bold text-gray-900 text-[16px] leading-tight">
              Flagged acts {flags ? `(${flags.length})` : ""}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <p className="font-['Poppins',sans-serif] text-sm text-red-600 mb-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          {flags === null && !error && (
            <p className="font-['Poppins',sans-serif] text-sm text-gray-500">Loading…</p>
          )}
          {flags && flags.length === 0 && !error && (
            <p className="font-['Poppins',sans-serif] text-sm text-gray-500 text-center py-8">
              No open flags. Everything's quiet.
            </p>
          )}
          {flags && flags.length > 0 && (
            <ul className="space-y-3">
              {flags.map((f) => (
                <li key={f.id} className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-['Poppins',sans-serif] font-bold text-gray-900 text-sm leading-tight">
                          {f.cardTitle ?? `Card #${f.cardId}`}
                        </span>
                        <a
                          href={`/?act=${f.cardId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open the card"
                          className="text-gray-400 hover:text-[#23297e]"
                        >
                          <ExternalLink size={12} />
                        </a>
                      </div>
                      <p className="font-['Poppins',sans-serif] text-[11px] uppercase tracking-wider font-semibold text-[#ed6624] mt-1">
                        {REASON_LABELS[f.reason] ?? f.reason}
                      </p>
                      {f.detail && (
                        <p className="font-['Poppins',sans-serif] text-sm text-gray-700 mt-1.5 whitespace-pre-wrap">
                          {f.detail}
                        </p>
                      )}
                      <p className="font-['Poppins',sans-serif] text-[11px] text-gray-400 mt-2">
                        {f.reporterName || f.reporterEmail || "anonymous"} · {relativeTime(f.createdAt)}
                      </p>
                    </div>
                    <button
                      onClick={() => dismiss(f.id)}
                      disabled={dismissing === f.id}
                      className="shrink-0 font-['Poppins',sans-serif] text-xs font-bold text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 disabled:opacity-60 rounded-lg px-3 py-1.5 transition-colors"
                    >
                      {dismissing === f.id ? "…" : "Dismiss"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
