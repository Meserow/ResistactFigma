import { useState, useEffect } from "react";
import { X, CheckCircle2, XCircle, Clock, Users, ShieldCheck, Loader2, RefreshCw, FileText, Trash2, Calendar, ExternalLink } from "lucide-react";
import { projectId } from "/utils/supabase/info";
import type { UserApproval } from "../lib/supabase";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04`;

interface AdminPanelProps {
  accessToken: string;
  onClose: () => void;
}

type TabFilter = "pending" | "approved" | "rejected" | "all";
type PanelMode = "users" | "cards";

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  facebook: "Facebook",
  email: "Email",
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: "Pending", color: "text-amber-600 bg-amber-50 border-amber-100", icon: <Clock size={12} /> },
  approved: { label: "Approved", color: "text-green-600 bg-green-50 border-green-100", icon: <CheckCircle2 size={12} /> },
  rejected: { label: "Rejected", color: "text-red-500 bg-red-50 border-red-100", icon: <XCircle size={12} /> },
};

interface PendingCard {
  id: number;
  title: string;
  description: string;
  category: string;
  categoryColor: string;
  authorName: string;
  authorRole: string;
  topImageUrl?: string | null;
  targetUrl?: string | null;
  eventDate?: string;
  createdAt?: string;
  createdBy?: string;
  adminApproved?: boolean;
  _store?: string;
}

export function AdminPanel({ accessToken, onClose }: AdminPanelProps) {
  const [mode, setMode] = useState<PanelMode>("users");

  // ── Users state ──────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<UserApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabFilter>("pending");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ── Cards state ──────────────────────────────────────────────────────────────
  const [pendingCards, setPendingCards] = useState<PendingCard[]>([]);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [cardsError, setCardsError] = useState<string | null>(null);
  const [cardActionLoading, setCardActionLoading] = useState<number | null>(null);

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };

  async function fetchUsers() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/admin/users`, { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to load users."); return; }
      setUsers(data.users);
    } catch {
      setError("Network error loading users.");
    } finally {
      setLoading(false);
    }
  }

  async function fetchPendingCards() {
    setCardsLoading(true);
    setCardsError(null);
    try {
      const res = await fetch(`${API}/admin/actions/pending`, { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) { setCardsError(data.error ?? "Failed to load pending cards."); return; }
      setPendingCards(data.cards ?? []);
    } catch {
      setCardsError("Network error loading pending cards.");
    } finally {
      setCardsLoading(false);
    }
  }

  useEffect(() => { fetchUsers(); }, []);
  useEffect(() => { if (mode === "cards") fetchPendingCards(); }, [mode]);

  async function handleApprove(userId: string) {
    setActionLoading(userId + ":approve");
    try {
      const res = await fetch(`${API}/admin/approve/${userId}`, { method: "POST", headers: authHeaders });
      const data = await res.json();
      if (!res.ok) { alert(data.error); return; }
      setUsers((prev) => prev.map((u) => (u.userId === userId ? { ...u, status: "approved" } : u)));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject(userId: string) {
    setActionLoading(userId + ":reject");
    try {
      const res = await fetch(`${API}/admin/reject/${userId}`, { method: "POST", headers: authHeaders });
      const data = await res.json();
      if (!res.ok) { alert(data.error); return; }
      setUsers((prev) => prev.map((u) => (u.userId === userId ? { ...u, status: "rejected" } : u)));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleApproveCard(id: number) {
    setCardActionLoading(id);
    try {
      const res = await fetch(`${API}/admin/approve-action/${id}`, { method: "POST", headers: authHeaders });
      const data = await res.json();
      if (!res.ok) { alert(data.error); return; }
      setPendingCards((prev) => prev.filter((c) => c.id !== id));
    } finally {
      setCardActionLoading(null);
    }
  }

  async function handleDeleteCard(id: number) {
    if (!window.confirm("Delete this card permanently?")) return;
    setCardActionLoading(id);
    try {
      const res = await fetch(`${API}/actions/${id}`, { method: "DELETE", headers: authHeaders });
      if (!res.ok) { const d = await res.json(); alert(d.error); return; }
      setPendingCards((prev) => prev.filter((c) => c.id !== id));
    } finally {
      setCardActionLoading(null);
    }
  }

  const filtered = users.filter((u) => tab === "all" || u.status === tab);
  const pendingCount = users.filter((u) => u.status === "pending").length;

  const TAB_ITEMS: { key: TabFilter; label: string }[] = [
    { key: "pending", label: `Pending${pendingCount > 0 ? ` (${pendingCount})` : ""}` },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
    { key: "all", label: "All" },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-start justify-end" onClick={onClose}>
      <div
        className="bg-white h-full w-full max-w-md shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#23297e]/10 flex items-center justify-center">
              <ShieldCheck size={16} className="text-[#23297e]" />
            </div>
            <div>
              <p className="font-['Poppins',sans-serif] font-bold text-gray-900 text-base leading-tight">Admin Panel</p>
              <p className="font-['Poppins',sans-serif] text-gray-400 text-xs">
                {mode === "users" ? "Manage user approvals" : "Review submitted actions"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={mode === "users" ? fetchUsers : fetchPendingCards}
              disabled={mode === "users" ? loading : cardsLoading}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40"
            >
              <RefreshCw size={15} className={(mode === "users" ? loading : cardsLoading) ? "animate-spin" : ""} />
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Mode switcher */}
        <div className="px-5 flex gap-1 border-b border-gray-100 shrink-0">
          {([
            { key: "users" as PanelMode, icon: <Users size={13} />, label: "Users" },
            { key: "cards" as PanelMode, icon: <FileText size={13} />, label: `Cards${pendingCards.length > 0 && mode !== "cards" ? ` (${pendingCards.length})` : ""}` },
          ]).map(({ key, icon, label }) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={`py-2.5 px-3 flex items-center gap-1.5 font-['Poppins',sans-serif] text-xs font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors ${
                mode === key
                  ? "text-[#23297e] border-[#23297e]"
                  : "text-gray-400 border-transparent hover:text-gray-600"
              }`}
            >
              {icon}{label}
            </button>
          ))}
        </div>

        {/* ── USERS mode ─────────────────────────────────────────────────────────── */}
        {mode === "users" && (
          <>
            {/* Stats */}
            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-4 shrink-0">
              {[
                { label: "Total", value: users.length, color: "text-gray-700" },
                { label: "Pending", value: users.filter(u => u.status === "pending").length, color: "text-amber-600" },
                { label: "Approved", value: users.filter(u => u.status === "approved").length, color: "text-green-600" },
                { label: "Rejected", value: users.filter(u => u.status === "rejected").length, color: "text-red-500" },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center">
                  <p className={`font-['Poppins',sans-serif] font-bold text-lg leading-tight ${color}`}>{value}</p>
                  <p className="font-['Poppins',sans-serif] text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
                </div>
              ))}
            </div>

            {/* User tabs */}
            <div className="px-5 flex gap-1 border-b border-gray-100 shrink-0 overflow-x-auto">
              {TAB_ITEMS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`py-2.5 px-3 font-['Poppins',sans-serif] text-xs font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors ${
                    tab === key
                      ? "text-[#23297e] border-[#23297e]"
                      : "text-gray-400 border-transparent hover:text-gray-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* User list */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center h-40">
                  <Loader2 size={24} className="animate-spin text-[#23297e]" />
                </div>
              ) : error ? (
                <div className="p-5 text-center">
                  <p className="font-['Poppins',sans-serif] text-sm text-red-500">{error}</p>
                  <button onClick={fetchUsers} className="mt-3 text-xs text-[#23297e] underline font-['Poppins',sans-serif]">Retry</button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2">
                  <Users size={28} className="text-gray-200" />
                  <p className="font-['Poppins',sans-serif] text-sm text-gray-400">No {tab === "all" ? "" : tab} users</p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {filtered.map((user) => {
                    const status = STATUS_CONFIG[user.status] ?? STATUS_CONFIG.pending;
                    const isActing = actionLoading?.startsWith(user.userId);
                    return (
                      <li key={user.userId} className="px-5 py-4 hover:bg-gray-50/60 transition-colors">
                        <div className="flex items-start gap-3">
                          {/* Avatar */}
                          <div className="shrink-0">
                            {user.avatar ? (
                              <img src={user.avatar} alt={user.name} className="w-10 h-10 rounded-full object-cover ring-1 ring-gray-100" />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-[#23297e]/10 flex items-center justify-center">
                                <span className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-sm">
                                  {user.name.charAt(0).toUpperCase()}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-['Poppins',sans-serif] font-semibold text-gray-900 text-sm truncate">{user.name}</p>
                              {user.isAdmin && (
                                <span className="text-[10px] font-bold bg-[#23297e] text-white rounded-md px-1.5 py-0.5 font-['Poppins',sans-serif]">ADMIN</span>
                              )}
                              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold border rounded-md px-1.5 py-0.5 font-['Poppins',sans-serif] ${status.color}`}>
                                {status.icon}
                                {status.label}
                              </span>
                            </div>
                            <p className="font-['Poppins',sans-serif] text-xs text-gray-400 truncate mt-0.5">{user.email}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="font-['Poppins',sans-serif] text-[10px] text-gray-400">
                                via {PROVIDER_LABELS[user.provider] ?? user.provider}
                              </span>
                              <span className="text-gray-200">·</span>
                              <span className="font-['Poppins',sans-serif] text-[10px] text-gray-400">
                                {new Date(user.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Action buttons — only show for non-admin pending/rejected users */}
                        {!user.isAdmin && user.status !== "approved" && (
                          <div className="flex gap-2 mt-3 ml-13">
                            <button
                              onClick={() => handleApprove(user.userId)}
                              disabled={isActing}
                              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-green-50 hover:bg-green-100 border border-green-200 rounded-lg font-['Poppins',sans-serif] font-semibold text-xs text-green-700 transition-colors disabled:opacity-50"
                            >
                              {actionLoading === user.userId + ":approve" ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={13} />}
                              Approve
                            </button>
                            {user.status !== "rejected" && (
                              <button
                                onClick={() => handleReject(user.userId)}
                                disabled={isActing}
                                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg font-['Poppins',sans-serif] font-semibold text-xs text-red-600 transition-colors disabled:opacity-50"
                              >
                                {actionLoading === user.userId + ":reject" ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={13} />}
                                Reject
                              </button>
                            )}
                          </div>
                        )}

                        {/* Re-approve if rejected */}
                        {!user.isAdmin && user.status === "rejected" && (
                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={() => handleApprove(user.userId)}
                              disabled={isActing}
                              className="flex items-center gap-1.5 py-1.5 px-3 bg-green-50 hover:bg-green-100 border border-green-200 rounded-lg font-['Poppins',sans-serif] font-semibold text-xs text-green-700 transition-colors disabled:opacity-50"
                            >
                              {actionLoading === user.userId + ":approve" ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={13} />}
                              Approve anyway
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}

        {/* ── CARDS mode ─────────────────────────────────────────────────────────── */}
        {mode === "cards" && (
          <>
            <div className="px-5 py-3 border-b border-gray-100 shrink-0">
              <p className="font-['Poppins',sans-serif] text-xs text-gray-500">
                {pendingCards.length === 0 && !cardsLoading
                  ? "No cards awaiting approval."
                  : `${pendingCards.length} card${pendingCards.length !== 1 ? "s" : ""} awaiting review`}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto">
              {cardsLoading ? (
                <div className="flex items-center justify-center h-40">
                  <Loader2 size={24} className="animate-spin text-[#23297e]" />
                </div>
              ) : cardsError ? (
                <div className="p-5 text-center">
                  <p className="font-['Poppins',sans-serif] text-sm text-red-500">{cardsError}</p>
                  <button onClick={fetchPendingCards} className="mt-3 text-xs text-[#23297e] underline font-['Poppins',sans-serif]">Retry</button>
                </div>
              ) : pendingCards.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2">
                  <CheckCircle2 size={28} className="text-green-200" />
                  <p className="font-['Poppins',sans-serif] text-sm text-gray-400">All caught up!</p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {pendingCards.map((card) => {
                    const isActing = cardActionLoading === card.id;
                    return (
                      <li key={card.id} className="px-5 py-4 hover:bg-gray-50/60 transition-colors">
                        {/* Card image + title row */}
                        <div className="flex items-start gap-3">
                          {card.topImageUrl ? (
                            <img
                              src={card.topImageUrl}
                              alt={card.title}
                              className="w-14 h-14 rounded-lg object-cover shrink-0 bg-gray-100"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                            />
                          ) : (
                            <div
                              className="w-14 h-14 rounded-lg shrink-0 flex items-center justify-center"
                              style={{ background: card.categoryColor + "22" }}
                            >
                              <FileText size={20} style={{ color: card.categoryColor }} />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                              <span
                                className="text-[10px] font-bold font-['Poppins',sans-serif] uppercase tracking-wider px-1.5 py-0.5 rounded-md text-white"
                                style={{ background: card.categoryColor }}
                              >
                                {card.category}
                              </span>
                              {card.eventDate && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 bg-blue-50 border border-blue-100 rounded-md px-1.5 py-0.5 font-['Poppins',sans-serif]">
                                  <Calendar size={10} />
                                  {card.eventDate}
                                </span>
                              )}
                            </div>
                            <p className="font-['Poppins',sans-serif] font-semibold text-gray-900 text-sm leading-tight line-clamp-2">
                              {card.title}
                            </p>
                            <p className="font-['Poppins',sans-serif] text-[11px] text-gray-400 mt-0.5 truncate">
                              by {card.authorName} · #{card.id}
                            </p>
                          </div>
                        </div>

                        {/* Description */}
                        <p className="font-['Poppins',sans-serif] text-xs text-gray-500 mt-2 line-clamp-2">
                          {card.description}
                        </p>

                        {/* Link */}
                        {card.targetUrl && (
                          <a
                            href={card.targetUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 mt-1.5 font-['Poppins',sans-serif] text-[11px] text-[#23297e] hover:underline"
                          >
                            <ExternalLink size={10} />
                            <span className="truncate max-w-[240px]">{card.targetUrl}</span>
                          </a>
                        )}

                        {/* Action buttons */}
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={() => handleApproveCard(card.id)}
                            disabled={isActing}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-green-50 hover:bg-green-100 border border-green-200 rounded-lg font-['Poppins',sans-serif] font-semibold text-xs text-green-700 transition-colors disabled:opacity-50"
                          >
                            {isActing ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={13} />}
                            Approve
                          </button>
                          <button
                            onClick={() => handleDeleteCard(card.id)}
                            disabled={isActing}
                            className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg font-['Poppins',sans-serif] font-semibold text-xs text-red-600 transition-colors disabled:opacity-50"
                          >
                            {isActing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={13} />}
                            Delete
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
