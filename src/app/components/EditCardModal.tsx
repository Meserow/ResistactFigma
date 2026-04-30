import { useState, useEffect } from "react";
import { X, Loader2, CheckCircle2, Pencil, Trash2 } from "lucide-react";
import { projectId } from "/utils/supabase/info";
import type { ActionCardData } from "./ActionCard";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04`;

const INPUT_CLS =
  "w-full px-3.5 py-2.5 border border-gray-200 rounded-xl font-['Poppins',sans-serif] text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#23297e]/30 focus:border-[#23297e]";

// ─── Category → colour map ─────────────────────────────────────────────────────
const CATEGORY_OPTIONS: { label: string; color: string }[] = [
  { label: "ART PIECE",         color: "#896312" },
  { label: "BOOST",             color: "#8a00e6" },
  { label: "CRAFTING",          color: "#c34e00" },
  { label: "EMAIL CAMPAIGN",    color: "#e44b4b" },
  { label: "FLASH MOB",         color: "#ff00d5" },
  { label: "FUNDING",           color: "#127f05" },
  { label: "HOUSING",           color: "#896312" },
  { label: "LABOR",             color: "#127f05" },
  { label: "MEETING",           color: "#23297e" },
  { label: "NEWS STORY",        color: "#896312" },
  { label: "PETITION",          color: "#05737f" },
  { label: "PRAYER",            color: "#8a00e6" },
  { label: "PROFESSIONAL",      color: "#126d89" },
  { label: "PROTEST",           color: "#23297e" },
  { label: "SOCIAL MEDIA",      color: "#e44b4b" },
  { label: "TRAINING",          color: "#126d89" },
  { label: "TRANSPORTATION",    color: "#126d89" },
  { label: "OTHER",             color: "#767574" },
];

const ACTION_TYPES = ["Online", "In Person", "In Person Group"];
const TIME_COMMITMENTS = ["< 1 hour", "1–3 hours", "Half day", "Full day", "Ongoing"];

interface EditCardModalProps {
  card: ActionCardData;
  accessToken: string;
  onClose: () => void;
  onSaved: (updated: ActionCardData) => void;
  /** Admins see a delete button. Non-admins (card authors) don't. */
  isAdmin?: boolean;
  onDeleted?: (id: number) => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block font-['Poppins',sans-serif] text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">
        {label}
      </label>
      {children}
    </div>
  );
}

export function EditCardModal({ card, accessToken, onClose, onSaved, isAdmin, onDeleted }: EditCardModalProps) {
  // ── Form state ────────────────────────────────────────────────────────────────
  const [title,          setTitle]          = useState(card.title);
  const [description,    setDescription]    = useState(card.description);
  const [category,       setCategory]       = useState(card.category.toUpperCase());
  const [categoryColor,  setCategoryColor]  = useState(card.categoryColor);
  const [actionType,     setActionType]     = useState(card.actionType ?? "In Person Group");
  const [timeCommitment, setTimeCommitment] = useState(card.timeCommitment ?? "");
  const [isOnline,       setIsOnline]       = useState(card.isOnline ?? false);
  const [location,       setLocation]       = useState(card.location ?? "");
  const [spotsTotal,     setSpotsTotal]     = useState<string>(
    card.spotsTotal === "Unlimited" ? "" : String(card.spotsTotal)
  );
  const [unlimited,      setUnlimited]      = useState(card.spotsTotal === "Unlimited");
  const [authorName,     setAuthorName]     = useState(card.authorName);
  const [authorRole,     setAuthorRole]     = useState(card.authorRole);
  const [authorLink,     setAuthorLink]     = useState(card.authorLink ?? "");

  const [loading,  setLoading]  = useState(false);
  const [success,  setSuccess]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting,       setDeleting]       = useState(false);

  // Sync category colour whenever category changes via the dropdown
  function handleCategoryChange(val: string) {
    setCategory(val);
    const found = CATEGORY_OPTIONS.find((o) => o.label === val);
    if (found) setCategoryColor(found.color);
  }

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      // Demo mode uses a fake token the server rejects — short-circuit so the
      // admin UI still demonstrates correctly. Real deletes require a real
      // logged-in admin.
      if (accessToken.startsWith("demo-")) {
        onDeleted?.(card.id);
        onClose();
        return;
      }
      const res = await fetch(`${API}/actions/${card.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Delete failed (${res.status}).`);
        return;
      }
      onDeleted?.(card.id);
      onClose();
    } catch (err) {
      console.error("Delete card error:", err);
      setError("Network error — please try again.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleSave() {
    if (!title.trim() || !description.trim()) {
      setError("Title and description are required."); return;
    }
    setError(null);
    setLoading(true);
    try {
      const payload = {
        title:          title.trim(),
        description:    description.trim(),
        category,
        categoryColor,
        actionType,
        timeCommitment: timeCommitment || undefined,
        isOnline,
        location:       isOnline ? undefined : (location.trim() || undefined),
        spotsTotal:     unlimited ? "Unlimited" : (Number(spotsTotal) || 10),
        authorName:     authorName.trim(),
        authorRole:     authorRole.trim(),
        authorLink:     authorLink.trim() || undefined,
      };

      const res = await fetch(`${API}/actions/${card.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to save changes."); return; }

      setSuccess(true);
      onSaved(data.card as ActionCardData);
      setTimeout(onClose, 1800);
    } catch (err) {
      console.error("Edit card error:", err);
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="bg-[#23297e] px-5 py-4 flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <Pencil size={15} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-['Poppins',sans-serif] font-bold text-white text-base leading-tight">
              Edit ResistAct
            </p>
            <p className="font-['Poppins',sans-serif] text-white/60 text-xs truncate">
              {card.title}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 text-white shrink-0 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Body ── */}
        {success ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle2 size={32} className="text-green-500" />
            </div>
            <h3 className="font-['Poppins',sans-serif] font-bold text-gray-900 text-lg">Changes saved!</h3>
            <p className="font-['Poppins',sans-serif] text-gray-500 text-sm">
              Your updates are live on the board.
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">

            {/* Title */}
            <Field label="Title *">
              <input
                type="text" value={title} maxLength={100}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Clear, compelling title…"
                className={INPUT_CLS}
              />
            </Field>

            {/* Description */}
            <Field label="Description *">
              <textarea
                rows={4} value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What do you need help with and why does it matter?"
                className={`${INPUT_CLS} resize-none`}
              />
            </Field>

            {/* Category + Action Type row */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <select
                  value={category}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className={INPUT_CLS}
                >
                  {CATEGORY_OPTIONS.map((o) => (
                    <option key={o.label} value={o.label}>{o.label}</option>
                  ))}
                  {/* keep current category if it's not in the list */}
                  {!CATEGORY_OPTIONS.find((o) => o.label === category) && (
                    <option value={category}>{category}</option>
                  )}
                </select>
              </Field>
              <Field label="Action Type">
                <select
                  value={actionType}
                  onChange={(e) => setActionType(e.target.value)}
                  className={INPUT_CLS}
                >
                  {ACTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            </div>

            {/* Time Commitment */}
            <Field label="Time Commitment">
              <select
                value={timeCommitment}
                onChange={(e) => setTimeCommitment(e.target.value)}
                className={INPUT_CLS}
              >
                <option value="">— select —</option>
                {TIME_COMMITMENTS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>

            {/* Online toggle + Location */}
            <div className="space-y-2.5">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox" checked={isOnline}
                  onChange={(e) => { setIsOnline(e.target.checked); if (e.target.checked) setLocation(""); }}
                  className="w-4 h-4 rounded accent-[#23297e]"
                />
                <span className="font-['Poppins',sans-serif] text-sm font-semibold text-gray-700">
                  Online / virtual — no physical location
                </span>
              </label>
              {!isOnline && (
                <input
                  type="text" value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="City, State  (e.g. Austin, TX)"
                  className={INPUT_CLS}
                />
              )}
            </div>

            {/* Spots */}
            <Field label="Spots needed">
              <div className="flex items-center gap-3">
                <input
                  type="number" value={spotsTotal} min="1"
                  onChange={(e) => setSpotsTotal(e.target.value)}
                  disabled={unlimited}
                  className={`${INPUT_CLS} w-28 disabled:opacity-40`}
                />
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox" checked={unlimited}
                    onChange={(e) => setUnlimited(e.target.checked)}
                    className="w-4 h-4 rounded accent-[#23297e]"
                  />
                  <span className="font-['Poppins',sans-serif] text-sm text-gray-600">Unlimited</span>
                </label>
              </div>
            </Field>

            {/* Divider */}
            <div className="border-t border-gray-100 pt-1">
              <p className="font-['Poppins',sans-serif] text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-3">
                Author attribution
              </p>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Author Name">
                    <input
                      type="text" value={authorName}
                      onChange={(e) => setAuthorName(e.target.value)}
                      placeholder="Name"
                      className={INPUT_CLS}
                    />
                  </Field>
                  <Field label="Author Role / Org">
                    <input
                      type="text" value={authorRole}
                      onChange={(e) => setAuthorRole(e.target.value)}
                      placeholder="Role or organisation"
                      className={INPUT_CLS}
                    />
                  </Field>
                </div>
                <Field label="Author Link (optional)">
                  <input
                    type="url" value={authorLink}
                    onChange={(e) => setAuthorLink(e.target.value)}
                    placeholder="https://…"
                    className={INPUT_CLS}
                  />
                </Field>
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2 font-['Poppins',sans-serif]">
                {error}
              </p>
            )}
          </div>
        )}

        {/* ── Footer ── */}
        {!success && (
          <div className="shrink-0 px-5 py-4 border-t border-gray-100 flex items-center gap-3">
            {isAdmin && (
              confirmDelete ? (
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  title="Tap again to confirm"
                  className="px-3 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-['Poppins',sans-serif] font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2 shrink-0"
                >
                  {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={15} />}
                  Confirm Delete
                </button>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  title="Delete this act (admin only)"
                  className="w-10 h-10 flex items-center justify-center rounded-xl border border-red-200 text-red-600 hover:bg-red-50 transition-colors shrink-0"
                >
                  <Trash2 size={16} />
                </button>
              )
            )}
            <button
              onClick={onClose}
              className="flex-1 py-2.5 border border-gray-200 rounded-xl font-['Poppins',sans-serif] font-semibold text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={loading || deleting}
              className="flex-1 py-2.5 bg-[#23297e] hover:bg-[#1a2060] disabled:opacity-60 text-white font-['Poppins',sans-serif] font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Pencil size={15} />}
              Save Changes
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
