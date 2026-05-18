import { useState, useEffect, useRef } from "react";
import { X, CheckCircle2, XCircle, Clock, Users, ShieldCheck, Loader2, RefreshCw, FileText, Trash2, Calendar, ExternalLink, ImageIcon, Upload, ZoomIn, AlertTriangle, Sliders, RotateCcw, Save, Eye, Flame, Laugh, VenetianMask, Heart, Sunrise, Zap, Link2, Pencil } from "lucide-react";
import { CardDetailsModal } from "./CardDetailsModal";
import { EditCardModal } from "./EditCardModal";
import { AdminUserDetail } from "./AdminUserDetail";
import { UserAvatar } from "./UserAvatar";
import type { ActionCardData } from "./ActionCard";
import type { LucideIcon } from "lucide-react";
import { projectId } from "/utils/supabase/info";
import type { UserApproval } from "../lib/supabase";
import { DEFAULT_CATEGORY_TONE, applyMatcherConfig, type Tone } from "../lib/matcher";
import { ToneRangeSlider } from "./ToneSlider";
import { getUserTier } from "../lib/tiers";

/** Friendly relative time string like "3 days ago" or "just now". */
function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0)                       return "just now";
  if (diffMs < 60_000)                  return "just now";
  if (diffMs < 3600_000)                return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000)              return `${Math.floor(diffMs / 3600_000)}h ago`;
  if (diffMs < 7 * 86_400_000)          return `${Math.floor(diffMs / 86_400_000)}d ago`;
  if (diffMs < 30 * 86_400_000)         return `${Math.floor(diffMs / (7 * 86_400_000))}w ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04`;

interface AdminPanelProps {
  accessToken: string;
  onClose: () => void;
  imageMap?: Record<string, string>;
}

type TabFilter = "active" | "pending" | "approved" | "rejected" | "all";
type PanelMode = "cards" | "users" | "nourl" | "matcher" | "online";

interface OnlineUser {
  userId: string;
  name: string;
  email: string;
  avatar: string | null;
  isAdmin: boolean;
  status: string;
  lastSeenAt: string;
}

const TONE_DIMS: { key: keyof Tone; label: string; Icon: LucideIcon; stops: { label: string; desc: string }[] }[] = [
  { key: "anger",      label: "Angry",      Icon: Flame,        stops: [
    { label: "None", desc: "Calm, no confrontation" }, { label: "Low", desc: "A little edge, stays subtle" }, { label: "Bold", desc: "Direct and attention-getting" }, { label: "High", desc: "In-the-streets energy" },
  ]},
  { key: "comedy",     label: "Funny",      Icon: Laugh,        stops: [
    { label: "None", desc: "Straight-faced, serious" }, { label: "Light", desc: "A bit of wit" }, { label: "Irreverent", desc: "Mockery and mischief" }, { label: "Full mockery", desc: "Absurdity as resistance" },
  ]},
  { key: "subversion", label: "Subversive", Icon: VenetianMask, stops: [
    { label: "None", desc: "Conventional approach" }, { label: "Mild", desc: "Slightly off the beaten path" }, { label: "Edgy", desc: "Disruptive, unconventional" }, { label: "Radical", desc: "Throw the rulebook out" },
  ]},
  { key: "care",       label: "Care",       Icon: Heart,        stops: [
    { label: "None", desc: "Action-focused, no emotional appeal" }, { label: "Some", desc: "Gentle warmth" }, { label: "Warm", desc: "Community and connection" }, { label: "Deep", desc: "Led by love and solidarity" },
  ]},
  { key: "hope",       label: "Hope",       Icon: Sunrise,      stops: [
    { label: "None", desc: "Realistic, no rose-tinting" }, { label: "Some", desc: "A glimmer of optimism" }, { label: "Uplifting", desc: "Building and inspiring" }, { label: "Full hope", desc: "Movement energy, community-first" },
  ]},
  { key: "energy",     label: "Energy",     Icon: Zap,          stops: [
    { label: "Low", desc: "Low demand on the participant" }, { label: "Mild", desc: "A moderate lift" }, { label: "Engaged", desc: "Requires real showing up" }, { label: "On fire", desc: "All in, maximum commitment" },
  ]},
];

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
  authorLink?: string | null;
  topImageUrl?: string | null;
  topImageKey?: string | null;
  targetUrl?: string | null;
  eventDate?: string;
  createdAt?: string;
  createdBy?: string;
  adminApproved?: boolean;
  notOnTopic?: boolean;
  firstTimerFriendly?: boolean;
  _store?: string;
}

// ── Resolve a card's display image: explicit URL > imageKey lookup > undefined ─
function resolveImage(card: PendingCard, imageMap?: Record<string, string>): string | undefined {
  if (card.topImageUrl) return card.topImageUrl;
  if (card.topImageKey && imageMap) return imageMap[card.topImageKey];
  return undefined;
}

// ── Image preview + upload modal ──────────────────────────────────────────────
function ImageModal({
  card,
  accessToken,
  imageMap,
  onClose,
  onImageUpdated,
}: {
  card: PendingCard;
  accessToken: string;
  imageMap?: Record<string, string>;
  onClose: () => void;
  onImageUpdated: (id: number, newUrl: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("cardId", String(card.id));
      const res = await fetch(`${API}/actions/upload-image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) { setUploadError(data.error ?? "Upload failed"); return; }
      // Also patch the card with the new image URL
      const patchRes = await fetch(`${API}/actions/${card.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ topImageUrl: data.url }),
      });
      if (patchRes.ok) {
        onImageUpdated(card.id, data.url);
        onClose();
      } else {
        setUploadError("Image uploaded but card update failed. URL: " + data.url);
      }
    } catch {
      setUploadError("Network error during upload.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
          <p className="font-['Poppins',sans-serif] font-semibold text-gray-800 text-sm truncate pr-4">{card.title}</p>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 shrink-0">
            <X size={15} />
          </button>
        </div>

        {/* Image area */}
        <div className="bg-gray-50 flex items-center justify-center min-h-[200px] max-h-[400px] overflow-hidden">
          {resolveImage(card, imageMap) ? (
            <img
              src={resolveImage(card, imageMap)}
              alt={card.title}
              className="max-w-full max-h-[400px] object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 py-12 text-gray-300">
              <ImageIcon size={48} />
              <p className="font-['Poppins',sans-serif] text-sm">No image</p>
            </div>
          )}
        </div>

        {/* Upload controls */}
        <div className="px-5 py-4 border-t border-gray-100 flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleUpload}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-4 py-2 bg-[#23297e] hover:bg-[#1a2060] text-white rounded-lg font-['Poppins',sans-serif] font-semibold text-sm transition-colors disabled:opacity-50"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {resolveImage(card, imageMap) ? "Replace image" : "Upload image"}
          </button>
          {uploadError && (
            <p className="font-['Poppins',sans-serif] text-xs text-red-500 flex-1">{uploadError}</p>
          )}
          {resolveImage(card, imageMap) && (
            <a
              href={resolveImage(card, imageMap)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#23297e] underline font-['Poppins',sans-serif] ml-auto"
            >
              Open original
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export function AdminPanel({ accessToken, onClose, imageMap }: AdminPanelProps) {
  const [mode, setMode] = useState<PanelMode>("cards");

  // ── Users state ──────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<UserApproval[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabFilter>("active");
  /** Per-user detail drawer: the userId whose dashboard is open (or null). */
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ── Cards state ──────────────────────────────────────────────────────────────
  const [pendingCards, setPendingCards] = useState<PendingCard[]>([]);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [cardsError, setCardsError] = useState<string | null>(null);
  const [cardActionLoading, setCardActionLoading] = useState<number | null>(null);
  const [imageModalCard, setImageModalCard] = useState<PendingCard | null>(null);
  /** Pending card whose full preview (CardDetailsModal) is open. */
  const [previewCard, setPreviewCard] = useState<PendingCard | null>(null);
  /** Pending card open in EditCardModal. */
  const [editingCard, setEditingCard] = useState<PendingCard | null>(null);

  // ── No-URL cards state ───────────────────────────────────────────────────────
  const [noUrlCards, setNoUrlCards] = useState<PendingCard[]>([]);
  const [noUrlLoading, setNoUrlLoading] = useState(false);
  const [noUrlError, setNoUrlError] = useState<string | null>(null);
  const [urlEdits, setUrlEdits] = useState<Record<number, string>>({});
  const [urlSaving, setUrlSaving] = useState<number | null>(null);

  // ── Online-now state ─────────────────────────────────────────────────────────
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);

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

  async function fetchNoUrlCards() {
    setNoUrlLoading(true);
    setNoUrlError(null);
    try {
      const res = await fetch(`${API}/admin/actions/no-url`, { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) { setNoUrlError(data.error ?? "Failed to load cards."); return; }
      setNoUrlCards(data.cards ?? []);
      setUrlEdits({});
    } catch {
      setNoUrlError("Network error loading cards.");
    } finally {
      setNoUrlLoading(false);
    }
  }

  async function handleSaveUrl(id: number) {
    const url = (urlEdits[id] ?? "").trim();
    if (!url) return;
    setUrlSaving(id);
    try {
      const res = await fetch(`${API}/actions/${id}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ targetUrl: url }),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error ?? "Save failed"); return; }
      setNoUrlCards((prev) => prev.filter((c) => c.id !== id));
      setUrlEdits((prev) => { const n = { ...prev }; delete n[id]; return n; });
    } catch {
      alert("Network error saving URL.");
    } finally {
      setUrlSaving(null);
    }
  }

  async function fetchOnlineUsers() {
    setOnlineLoading(true);
    setOnlineError(null);
    try {
      // 1440 minutes = 24 hours. The Online tab now answers "who has used
      // the site today?", not "who is on right now?" — much more useful for
      // an admin checking engagement after pushing the site out.
      const res = await fetch(`${API}/admin/online-users?windowMinutes=1440`, { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) { setOnlineError(data.error ?? "Failed to load online users."); return; }
      setOnlineUsers(data.users ?? []);
    } catch {
      setOnlineError("Network error loading online users.");
    } finally {
      setOnlineLoading(false);
    }
  }

  useEffect(() => { fetchPendingCards(); }, []);
  useEffect(() => { if (mode === "users" && users.length === 0) fetchUsers(); }, [mode]);
  useEffect(() => { if (mode === "nourl" && noUrlCards.length === 0 && !noUrlLoading) fetchNoUrlCards(); }, [mode]);
  // Online tab: fetch on enter, then re-fetch every 30s while the tab is open.
  useEffect(() => {
    if (mode !== "online") return;
    fetchOnlineUsers();
    const id = window.setInterval(fetchOnlineUsers, 30_000);
    return () => window.clearInterval(id);
  }, [mode]);

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

  // The off-topic flag/unflag UI was removed from this panel — the badge is
  // an AI-side signal (set via /admin/flag-off-topic), and admins act on it
  // by Approve or Delete instead. Endpoints stay live for that automation.

  // "Active" = anyone who has marked at least one action done in the last 30
  // days. Excludes never-active users (totalActions = 0) and stale accounts.
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const activeCutoff = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
  const filtered = users.filter((u) => {
    if (tab === "all") return true;
    if (tab === "active") return Boolean(u.lastActiveAt && u.lastActiveAt > activeCutoff);
    return u.status === tab;
  });
  const pendingCount  = users.filter((u) => u.status === "pending").length;
  const activeCount   = users.filter((u) => u.lastActiveAt && u.lastActiveAt > activeCutoff).length;
  const pendingCardsCount = pendingCards.length;

  const TAB_ITEMS: { key: TabFilter; label: string }[] = [
    { key: "active",   label: `Active${activeCount > 0 ? ` (${activeCount})` : ""}` },
    { key: "pending",  label: `Pending${pendingCount > 0 ? ` (${pendingCount})` : ""}` },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
    { key: "all",      label: "All" },
  ];

  return (
    <>
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
                  {mode === "users" ? "Manage user approvals" : mode === "nourl" ? "Cards missing an action link" : mode === "online" ? "Users active in the last 24 hours" : "Review submitted actions"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={mode === "users" ? fetchUsers : mode === "nourl" ? fetchNoUrlCards : mode === "online" ? fetchOnlineUsers : fetchPendingCards}
                disabled={mode === "users" ? loading : mode === "nourl" ? noUrlLoading : mode === "online" ? onlineLoading : cardsLoading}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40"
              >
                <RefreshCw size={15} className={(mode === "users" ? loading : mode === "nourl" ? noUrlLoading : mode === "online" ? onlineLoading : cardsLoading) ? "animate-spin" : ""} />
              </button>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Mode switcher — Cards first */}
          <div className="px-5 flex gap-1 border-b border-gray-100 shrink-0">
            {([
              { key: "cards" as PanelMode, icon: <FileText size={13} />, label: `Cards${!cardsLoading && pendingCardsCount > 0 ? ` (${pendingCardsCount})` : ""}` },
              { key: "nourl" as PanelMode, icon: <Link2 size={13} />, label: `No URL${noUrlCards.length > 0 ? ` (${noUrlCards.length})` : ""}` },
              { key: "users" as PanelMode, icon: <Users size={13} />, label: "Users" },
              { key: "matcher" as PanelMode, icon: <Sliders size={13} />, label: "Matcher" },
              { key: "online" as PanelMode, icon: <Users size={13} />, label: `Online${onlineUsers.length > 0 ? ` (${onlineUsers.length})` : ""}` },
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

          {/* ── CARDS mode ─────────────────────────────────────────────────────────── */}
          {mode === "cards" && (
            <>
              <div className="px-5 py-3 border-b border-gray-100 shrink-0">
                <p className="font-['Poppins',sans-serif] text-xs text-gray-500">
                  {cardsLoading
                    ? "Loading…"
                    : pendingCards.length === 0
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
                            {/* Thumbnail — clickable to open image modal */}
                            <button
                              onClick={() => setImageModalCard(card)}
                              className="relative w-14 h-14 rounded-lg shrink-0 overflow-hidden group bg-gray-100 border border-gray-200 hover:border-[#23297e] transition-colors"
                              title="Click to view / change image"
                            >
                              {resolveImage(card, imageMap) ? (
                                <img
                                  src={resolveImage(card, imageMap)}
                                  alt={card.title}
                                  className="w-full h-full object-cover"
                                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center" style={{ background: card.categoryColor + "22" }}>
                                  <FileText size={20} style={{ color: card.categoryColor }} />
                                </div>
                              )}
                              {/* Hover overlay */}
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <ZoomIn size={16} className="text-white" />
                              </div>
                            </button>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                                <span
                                  className="text-[10px] font-bold font-['Poppins',sans-serif] uppercase tracking-wider px-1.5 py-0.5 rounded-md text-white"
                                  style={{ background: card.categoryColor }}
                                >
                                  {card.category}
                                </span>
                                {/* NOT ON TOPIC badge */}
                                {card.notOnTopic && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold font-['Poppins',sans-serif] uppercase tracking-wider px-1.5 py-0.5 rounded-md text-red-600 bg-red-50 border border-red-200">
                                    <AlertTriangle size={9} />
                                    NOT ON TOPIC
                                  </span>
                                )}
                                {/* Highlighted action badge */}
                                {card.firstTimerFriendly && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold font-['Poppins',sans-serif] uppercase tracking-wider px-1.5 py-0.5 rounded-md text-emerald-700 bg-emerald-50 border border-emerald-200">
                                    ⭐ HIGHLIGHTED
                                  </span>
                                )}
                                {card.eventDate && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 bg-blue-50 border border-blue-100 rounded-md px-1.5 py-0.5 font-['Poppins',sans-serif]">
                                    <Calendar size={10} />
                                    {card.eventDate}
                                  </span>
                                )}
                                {/* Warn when the action link is just the author's homepage — needs a real direct URL */}
                                {card.targetUrl && card.authorLink && card.targetUrl === card.authorLink && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold font-['Poppins',sans-serif] uppercase tracking-wider px-1.5 py-0.5 rounded-md text-amber-700 bg-amber-50 border border-amber-300" title="Action link is the same as the author homepage — needs a direct action URL">
                                    <AlertTriangle size={9} />
                                    LINK = HOMEPAGE
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
                          <div className="flex gap-2 mt-3 flex-wrap">
                            {/* View — opens full CardDetailsModal so the admin
                                can see the card the way users will see it. */}
                            <button
                              onClick={() => setPreviewCard(card)}
                              disabled={isActing}
                              className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-[#23297e]/5 hover:bg-[#23297e]/10 border border-[#23297e]/20 rounded-lg font-['Poppins',sans-serif] font-semibold text-xs text-[#23297e] transition-colors disabled:opacity-50"
                              title="Preview the full card"
                            >
                              <Eye size={13} />
                              View
                            </button>

                            {/* Edit */}
                            <button
                              onClick={() => setEditingCard(card)}
                              disabled={isActing}
                              className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg font-['Poppins',sans-serif] font-semibold text-xs text-amber-700 transition-colors disabled:opacity-50"
                              title="Edit this card"
                            >
                              <Pencil size={13} />
                              Edit
                            </button>

                            {/* Approve */}
                            <button
                              onClick={() => handleApproveCard(card.id)}
                              disabled={isActing}
                              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-green-50 hover:bg-green-100 border border-green-200 rounded-lg font-['Poppins',sans-serif] font-semibold text-xs text-green-700 transition-colors disabled:opacity-50"
                            >
                              {isActing ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={13} />}
                              Approve
                            </button>

                            {/* Delete */}
                            <button
                              onClick={() => handleDeleteCard(card.id)}
                              disabled={isActing}
                              className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg font-['Poppins',sans-serif] font-semibold text-xs text-red-600 transition-colors disabled:opacity-50"
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

          {/* ── NO-URL mode ────────────────────────────────────────────────────────── */}
          {mode === "nourl" && (
            <>
              <div className="px-5 py-3 border-b border-gray-100 shrink-0">
                <p className="font-['Poppins',sans-serif] text-xs text-gray-500">
                  {noUrlCards.length === 0 && !noUrlLoading
                    ? "All approved cards have an action URL."
                    : `${noUrlCards.length} approved card${noUrlCards.length !== 1 ? "s" : ""} with no link`}
                </p>
              </div>

              <div className="flex-1 overflow-y-auto">
                {noUrlLoading ? (
                  <div className="flex items-center justify-center h-40">
                    <Loader2 size={24} className="animate-spin text-[#23297e]" />
                  </div>
                ) : noUrlError ? (
                  <div className="p-5 text-center">
                    <p className="font-['Poppins',sans-serif] text-sm text-red-500">{noUrlError}</p>
                    <button onClick={fetchNoUrlCards} className="mt-3 text-xs text-[#23297e] underline font-['Poppins',sans-serif]">Retry</button>
                  </div>
                ) : noUrlCards.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 gap-2">
                    <CheckCircle2 size={28} className="text-green-200" />
                    <p className="font-['Poppins',sans-serif] text-sm text-gray-400">All cards have links!</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-50">
                    {noUrlCards.map((card) => {
                      const isSaving = urlSaving === card.id;
                      const draft = urlEdits[card.id] ?? "";
                      return (
                        <li key={card.id} className="px-5 py-4 hover:bg-gray-50/60 transition-colors">
                          <div className="flex items-start gap-2 mb-2">
                            <span
                              className="text-[10px] font-bold font-['Poppins',sans-serif] uppercase tracking-wider px-1.5 py-0.5 rounded-md text-white shrink-0 mt-0.5"
                              style={{ background: card.categoryColor }}
                            >
                              {card.category}
                            </span>
                            <p className="font-['Poppins',sans-serif] font-semibold text-gray-900 text-sm leading-snug">
                              {card.title}
                            </p>
                          </div>
                          <p className="font-['Poppins',sans-serif] text-[11px] text-gray-400 mb-2 line-clamp-2">
                            {card.description}
                          </p>
                          {/* URL input + save */}
                          <div className="flex items-center gap-2">
                            <input
                              type="url"
                              value={draft}
                              onChange={(e) => setUrlEdits((prev) => ({ ...prev, [card.id]: e.target.value }))}
                              placeholder="https://..."
                              className="flex-1 min-w-0 px-3 py-1.5 text-xs font-['Poppins',sans-serif] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#23297e] focus:border-transparent placeholder-gray-300"
                            />
                            <button
                              onClick={() => handleSaveUrl(card.id)}
                              disabled={!draft.trim() || isSaving}
                              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-[#23297e] hover:bg-[#1a2060] text-white rounded-lg font-['Poppins',sans-serif] font-semibold text-xs transition-colors disabled:opacity-40"
                            >
                              {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                              Save
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
                    <p className="font-['Poppins',sans-serif] text-sm text-gray-400">
                    {tab === "active" ? "No users active in the last 30 days." : `No ${tab === "all" ? "" : tab} users`}
                  </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-50">
                    {filtered.map((user) => {
                      const status = STATUS_CONFIG[user.status] ?? STATUS_CONFIG.pending;
                      const isActing = actionLoading?.startsWith(user.userId);
                      const total = user.totalActions ?? 0;
                      const tier = getUserTier(total).tier;
                      return (
                        <li key={user.userId} className="px-5 py-4 hover:bg-gray-50/60 transition-colors">
                          {/* Row clickable area — opens the detail drawer */}
                          <button
                            type="button"
                            onClick={() => setDetailUserId(user.userId)}
                            className="w-full text-left flex items-start gap-3 group"
                            aria-label={`Open dashboard for ${user.name}`}
                          >
                            {/* Avatar — UserAvatar gracefully swaps to the
                                initial-letter bubble when the image URL fails
                                (Google avatar URLs rotate and 403 sometimes). */}
                            <div className="shrink-0">
                              <UserAvatar name={user.name} avatar={user.avatar} />
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-['Poppins',sans-serif] font-semibold text-gray-900 text-sm truncate group-hover:underline">{user.name}</p>
                                {user.isAdmin && (
                                  <span className="text-[10px] font-bold bg-[#23297e] text-white rounded-md px-1.5 py-0.5 font-['Poppins',sans-serif]">ADMIN</span>
                                )}
                                <span className={`inline-flex items-center gap-1 text-[10px] font-semibold border rounded-md px-1.5 py-0.5 font-['Poppins',sans-serif] ${status.color}`}>
                                  {status.icon}
                                  {status.label}
                                </span>
                                {/* Tier chip — color-coded to the user's current tier. */}
                                <span
                                  className="inline-flex items-center gap-1 text-[10px] font-bold rounded-md px-1.5 py-0.5 font-['Poppins',sans-serif] uppercase tracking-wider"
                                  style={{ background: `${tier.color}22`, color: tier.color }}
                                  title={tier.tagline}
                                >
                                  {tier.name}
                                </span>
                              </div>
                              <p className="font-['Poppins',sans-serif] text-xs text-gray-400 truncate mt-0.5">{user.email}</p>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <span className="font-['Poppins',sans-serif] text-[10px] font-semibold text-gray-600">
                                  {total} action{total === 1 ? "" : "s"}
                                </span>
                                <span className="text-gray-200">·</span>
                                <span className="font-['Poppins',sans-serif] text-[10px] text-gray-400">
                                  {user.lastActiveAt
                                    ? `active ${formatRelative(user.lastActiveAt)}`
                                    : "never active"}
                                </span>
                                <span className="text-gray-200">·</span>
                                <span className="font-['Poppins',sans-serif] text-[10px] text-gray-400">
                                  via {PROVIDER_LABELS[user.provider] ?? user.provider}
                                </span>
                                <span className="text-gray-200">·</span>
                                <span className="font-['Poppins',sans-serif] text-[10px] text-gray-400">
                                  joined {new Date(user.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                </span>
                                {user.emailConsent != null && (
                                  <>
                                    <span className="text-gray-200">·</span>
                                    <span
                                      className={`inline-flex items-center gap-1 font-['Poppins',sans-serif] text-[10px] font-semibold rounded-md px-1.5 py-0.5 ${
                                        user.emailConsent
                                          ? "text-emerald-700 bg-emerald-50 border border-emerald-200"
                                          : "text-gray-400 bg-gray-50 border border-gray-200 line-through"
                                      }`}
                                      title={user.emailConsent ? "Opted in to emails" : "No email consent"}
                                    >
                                      ✉️ {user.emailConsent ? "emails ok" : "no emails"}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </button>

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

          {/* ── MATCHER mode ───────────────────────────────────────────────────────── */}
          {mode === "matcher" && (
            <MatcherTuning accessToken={accessToken} />
          )}

          {/* ── ONLINE-NOW mode ────────────────────────────────────────────────────── */}
          {mode === "online" && (
            <>
              <div className="px-5 py-3 border-b border-gray-100 shrink-0">
                <p className="font-['Poppins',sans-serif] text-xs text-gray-500">
                  {onlineLoading && onlineUsers.length === 0
                    ? "Loading…"
                    : onlineUsers.length === 0
                      ? "No one has been active in the last 24 hours."
                      : `${onlineUsers.length} user${onlineUsers.length !== 1 ? "s" : ""} active in the last 24 hours · refreshes every 30s`}
                </p>
              </div>

              <div className="flex-1 overflow-y-auto">
                {onlineError ? (
                  <div className="p-5 text-center">
                    <p className="font-['Poppins',sans-serif] text-sm text-red-500">{onlineError}</p>
                    <button onClick={fetchOnlineUsers} className="mt-3 text-xs text-[#23297e] underline font-['Poppins',sans-serif]">Retry</button>
                  </div>
                ) : onlineUsers.length === 0 && !onlineLoading ? (
                  <div className="flex flex-col items-center justify-center h-40 gap-2">
                    <Users size={28} className="text-gray-200" />
                    <p className="font-['Poppins',sans-serif] text-sm text-gray-400">No activity in the last 24 hours.</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-50">
                    {onlineUsers.map((u) => {
                      // Tier the status dot by how recent: green = truly live,
                      // amber = recent, gray = active today but cold. Avoids
                      // implying "online right now" for 23-hours-ago activity.
                      const ageMs = Date.now() - new Date(u.lastSeenAt).getTime();
                      const dot = ageMs < 5 * 60_000
                        ? { color: "bg-green-500", label: "online now" }
                        : ageMs < 60 * 60_000
                          ? { color: "bg-amber-400", label: "active recently" }
                          : { color: "bg-gray-300", label: "active today" };
                      return (
                      <li key={u.userId} className="px-5 py-3 flex items-center gap-3">
                        <span className={`w-2 h-2 rounded-full ${dot.color} shrink-0`} aria-label={dot.label} title={dot.label} />
                        <UserAvatar name={u.name} avatar={u.avatar} sizeClasses="w-8 h-8" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-['Poppins',sans-serif] font-semibold text-sm text-gray-800 truncate">{u.name}</p>
                            {u.isAdmin && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#23297e] bg-[#23297e]/10 rounded px-1.5 py-0.5">
                                <ShieldCheck size={10} /> Admin
                              </span>
                            )}
                          </div>
                          <p className="font-['Poppins',sans-serif] text-xs text-gray-400 truncate">{u.email}</p>
                        </div>
                        <p className="font-['Poppins',sans-serif] text-xs text-gray-400 shrink-0" title={u.lastSeenAt}>
                          {formatRelative(u.lastSeenAt)}
                        </p>
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

      {/* Image modal */}
      {imageModalCard && (
        <ImageModal
          card={imageModalCard}
          accessToken={accessToken}
          imageMap={imageMap}
          onClose={() => setImageModalCard(null)}
          onImageUpdated={(id, url) => {
            setPendingCards((prev) => prev.map((c) => c.id === id ? { ...c, topImageUrl: url } : c));
            setImageModalCard(null);
          }}
        />
      )}

      {/* Full-card preview — same component users see via "Read more →" */}
      {previewCard && (
        <CardDetailsModal
          card={{
            ...(previewCard as unknown as ActionCardData),
            // PendingCard stores the raw URL in `topImageUrl`; CardDetailsModal
            // renders from `topImage`, so map it explicitly.
            topImage: previewCard.topImageUrl ?? undefined,
          }}
          onClose={() => setPreviewCard(null)}
        />
      )}

      {editingCard && (
        <EditCardModal
          card={{
            ...(editingCard as unknown as ActionCardData),
            topImage: editingCard.topImageUrl ?? undefined,
          }}
          accessToken={accessToken}
          isAdmin={true}
          onClose={() => setEditingCard(null)}
          onSaved={(updated) => {
            setPendingCards((prev) => prev.map((c) => c.id === updated.id ? { ...c, ...updated } as unknown as PendingCard : c));
            setEditingCard(null);
          }}
          onDeleted={(id) => {
            setPendingCards((prev) => prev.filter((c) => c.id !== id));
            setEditingCard(null);
          }}
        />
      )}

      {/* Per-user detail drawer — tier, breakdown, recent activity */}
      {detailUserId && (
        <AdminUserDetail
          userId={detailUserId}
          accessToken={accessToken}
          onClose={() => setDetailUserId(null)}
        />
      )}
    </>
  );
}

// ─── Matcher tuning panel ─────────────────────────────────────────────────────
// Lets admins edit the per-category default tone vector that the matcher uses
// when a card has no per-card override. Loads the current saved config (or the
// built-in defaults) on mount; saving PUTs to /admin/matcher-config, and the
// next page-load (or applyMatcherConfig call) picks it up. The "Reset" button
// clears the override on the server so future loads get the built-ins again.
function MatcherTuning({ accessToken }: { accessToken: string }) {
  const [tones, setTones] = useState<Record<string, Tone>>({ ...DEFAULT_CATEGORY_TONE });
  const [originalTones, setOriginalTones] = useState<Record<string, Tone>>({ ...DEFAULT_CATEGORY_TONE });
  const [selectedCategory, setSelectedCategory] = useState<string>("PROTEST");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);

  const dirty = JSON.stringify(tones) !== JSON.stringify(originalTones);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Reuse the admin's bearer token — works for any authed user, and
        // an admin will always have one open (they're in the admin panel).
        const res = await fetch(`${API}/matcher-config`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await res.json();
        if (cancelled) return;
        if (data?.config?.categoryTone && typeof data.config.categoryTone === "object") {
          // Merge saved overrides into the defaults (defaults fill any gaps).
          const merged: Record<string, Tone> = { ...DEFAULT_CATEGORY_TONE };
          for (const [cat, partial] of Object.entries(data.config.categoryTone as Record<string, Partial<Tone>>)) {
            const base = DEFAULT_CATEGORY_TONE[cat.toUpperCase()] ?? merged[cat.toUpperCase()];
            if (!base) continue;
            merged[cat.toUpperCase()] = { ...base, ...partial };
          }
          setTones(merged);
          setOriginalTones(merged);
          setSavedAt(data.config.updatedAt ?? null);
          setUpdatedBy(data.config.updatedBy ?? null);
        }
      } catch (err) {
        if (!cancelled) setError(`Couldn't load matcher config: ${err}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/admin/matcher-config`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ categoryTone: tones }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      setOriginalTones({ ...tones });
      setSavedAt(data.config?.updatedAt ?? new Date().toISOString());
      setUpdatedBy(data.config?.updatedBy ?? null);
      // Apply locally so live matches use the new values immediately.
      applyMatcherConfig({ categoryTone: tones });
    } catch (err) {
      setError(`Network error: ${err}`);
    } finally {
      setSaving(false);
    }
  }

  async function resetToDefaults() {
    if (!window.confirm("Reset all category tones to the built-in defaults? This clears the saved override on the server.")) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/admin/matcher-config`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Reset failed");
        return;
      }
      setTones({ ...DEFAULT_CATEGORY_TONE });
      setOriginalTones({ ...DEFAULT_CATEGORY_TONE });
      setSavedAt(null);
      setUpdatedBy(null);
      applyMatcherConfig(null);
    } catch (err) {
      setError(`Network error: ${err}`);
    } finally {
      setSaving(false);
    }
  }

  function resetCategory(cat: string) {
    const def = DEFAULT_CATEGORY_TONE[cat];
    if (!def) return;
    setTones({ ...tones, [cat]: { ...def } });
  }

  const current = tones[selectedCategory] ?? DEFAULT_CATEGORY_TONE.OTHER;
  const def = DEFAULT_CATEGORY_TONE[selectedCategory];
  const categoryDirty = def && JSON.stringify(current) !== JSON.stringify(def);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 size={24} className="animate-spin text-[#23297e]" />
      </div>
    );
  }

  return (
    <>
      {/* Header / status */}
      <div className="px-5 py-3 border-b border-gray-100 shrink-0 space-y-1">
        <p className="font-['Poppins',sans-serif] text-xs text-gray-500">
          Per-category default tone the matcher uses when a card has no per-card override.
          Changes apply to live matching once saved.
        </p>
        {savedAt && (
          <p className="font-['Poppins',sans-serif] text-[11px] text-gray-400">
            Last saved {new Date(savedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
            {updatedBy ? ` by ${updatedBy}` : ""}
          </p>
        )}
      </div>

      {/* Category picker */}
      <div className="px-5 py-3 border-b border-gray-100 shrink-0">
        <label className="block font-['Poppins',sans-serif] text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
          Category
        </label>
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="w-full pl-3 pr-10 py-2 bg-white border border-gray-200 rounded-lg font-['Poppins',sans-serif] text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#23297e]/30 focus:border-[#23297e]"
        >
          {Object.keys(DEFAULT_CATEGORY_TONE).sort().map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      {/* Sliders */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3.5">
        {TONE_DIMS.map(({ key, label, Icon, stops }) => {
          const v = current[key];
          const defV = def ? def[key] : 1;
          const isModified = v !== defV;
          const stop = stops[v];
          return (
            <div key={key}>
              <div className="flex items-center mb-1.5">
                <Icon size={14} strokeWidth={2} className="text-[#23297e] mr-1.5 shrink-0" />
                <strong className="font-['Poppins',sans-serif] font-semibold text-sm text-[#23297e]">
                  {label}
                </strong>
                <span className="ml-2 font-['Poppins',sans-serif] text-xs text-gray-500 truncate">
                  · <span className="font-medium text-[#fd8e33]">{stop.label}</span> — {stop.desc}
                </span>
                {isModified && (
                  <span className="ml-auto shrink-0 font-['Poppins',sans-serif] text-[10px] text-gray-400">
                    default {defV}
                  </span>
                )}
              </div>
              <ToneRangeSlider
                value={v}
                onChange={(nv) => setTones({ ...tones, [selectedCategory]: { ...current, [key]: nv } })}
              />
            </div>
          );
        })}
        {categoryDirty && (
          <button
            onClick={() => resetCategory(selectedCategory)}
            className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-[#23297e] underline font-['Poppins',sans-serif]"
          >
            <RotateCcw size={11} />
            Reset {selectedCategory} to default
          </button>
        )}
        {error && (
          <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2 font-['Poppins',sans-serif]">
            {error}
          </p>
        )}
      </div>

      {/* Footer actions */}
      <div className="border-t border-gray-100 px-5 py-3 shrink-0 flex items-center gap-2">
        <button
          onClick={resetToDefaults}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-['Poppins',sans-serif] font-semibold text-gray-600 hover:text-red-600 hover:bg-red-50 border border-gray-200 rounded-lg transition-colors disabled:opacity-50"
          title="Clear saved overrides — all categories return to built-in defaults"
        >
          <RotateCcw size={13} />
          Reset all
        </button>
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="ml-auto flex items-center gap-1.5 px-4 py-2 text-xs font-['Poppins',sans-serif] font-bold text-white bg-[#fd8e33] hover:bg-[#e07a28] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed rounded-lg transition-colors"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
      </div>
    </>
  );
}
