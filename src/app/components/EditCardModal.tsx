import { useRef, useState } from "react";
import { X, Loader2, Pencil, Trash2, Upload, Flame, Laugh, VenetianMask, Sunrise, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { projectId } from "/utils/supabase/info";
import type { ActionCardData } from "./ActionCard";
import { LOCATION_OPTIONS } from "../lib/locations";
import { ToneRangeSlider } from "./ToneSlider";
import { InvolvementPicker, involvementLevelFor } from "./InvolvementPicker";
import type { TimeBucket } from "../lib/matcher";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04`;

// Base shared between text inputs and selects so styling stays in lockstep.
// The text-color class is appended per-context: text inputs always show their
// content in dark; selects swap between dark (when a value is picked) and
// grey-italic (when the placeholder option is selected).
const INPUT_BASE =
  "w-full px-3.5 py-2.5 border border-gray-200 rounded-xl font-['Poppins',sans-serif] text-sm focus:outline-none focus:ring-2 focus:ring-[#23297e]/30 focus:border-[#23297e]";
const INPUT_CLS = `${INPUT_BASE} text-gray-800 placeholder-gray-400 placeholder:italic placeholder:text-gray-400`;
const SELECT_CLS = (val: string | null | undefined) =>
  `${INPUT_BASE} ${val ? "text-gray-800" : "text-gray-400 italic"}`;

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

const TIME_COMMITMENT_MAP: Record<TimeBucket, string> = {
  "5min":     "< 1 hour",
  "30min":    "< 1 hour",
  "1hr":      "1–3 hours",
  "fewHours": "1–3 hours",
  "fullDay":  "Full day",
  "ongoing":  "Ongoing",
};

function timeBucketFromCard(timeCommitment: string | undefined, quickAction?: boolean): TimeBucket {
  if (quickAction) return "5min";
  if (!timeCommitment) return "30min";
  if (timeCommitment === "< 1 hour") return "30min";
  if (timeCommitment === "1 hour" || timeCommitment === "1hr") return "1hr";
  if (timeCommitment === "1–3 hours") return "fewHours";
  if (timeCommitment === "Half day" || timeCommitment === "Full day") return "fewHours";
  if (timeCommitment === "Ongoing") return "ongoing";
  return "30min";
}

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
  const [involvement, setInvolvement] = useState<TimeBucket>(() =>
    timeBucketFromCard(card.timeCommitment, (card as any).quickAction)
  );
  // Map the card's current location/isOnline into a single canonical option.
  // Legacy free-form values that don't match the canonical list show as blank
  // and require the editor to pick a value before saving.
  const initialLocation = card.isOnline
    ? "Online"
    : (LOCATION_OPTIONS as readonly string[]).includes(card.location ?? "")
      ? (card.location as string)
      : "";
  const [location, setLocation] = useState(initialLocation);
  const isOnline = location === "Online";
  const isLegacyLocation = !card.isOnline && !!card.location && !initialLocation;
  const [spotsTotal,     setSpotsTotal]     = useState<string>(
    card.spotsTotal === "Unlimited" ? "" : String(card.spotsTotal)
  );
  const [unlimited,      setUnlimited]      = useState(card.spotsTotal === "Unlimited");
  const [authorName,     setAuthorName]     = useState(card.authorName);
  const [authorRole,     setAuthorRole]     = useState(card.authorRole);
  const [authorLink,     setAuthorLink]     = useState(card.authorLink ?? "");
  const [targetUrl,      setTargetUrl]      = useState<string>((card as any).targetUrl ?? "");
  // Header image URL — the resolved card.topImage may be a Vite-bundled asset
  // path (e.g. /assets/foo.svg) when topImageKey is set; only seed the field
  // from the raw URL the server stored, so we don't write a bundled path back.
  const [topImageUrl,    setTopImageUrl]    = useState<string>((card as any).topImageUrl ?? "");
  const [imageContain,   setImageContain]   = useState<boolean>(card.imageContain === true);
  const [atHome,         setAtHome]         = useState<boolean>(card.atHome === true);
  const [firstTimerFriendly, setFirstTimerFriendly] = useState<boolean>((card as any).firstTimerFriendly === true);
  const [eventDate,      setEventDate]      = useState<string>((card as any).eventDate ?? "");
  // Tone override — admins can manually fix cards whose category default doesn't
  // fit the matcher. null in any slot = no override (use category default).
  const [toneAnger,      setToneAnger]      = useState<number | null>((card.toneOverride?.anger      ?? null) as number | null);
  const [toneComedy,     setToneComedy]     = useState<number | null>((card.toneOverride?.comedy     ?? null) as number | null);
  const [toneSubversion, setToneSubversion] = useState<number | null>((card.toneOverride?.subversion ?? null) as number | null);
  const [toneHope,       setToneHope]       = useState<number | null>((card.toneOverride?.hope       ?? null) as number | null);
  const [toneEnergy,     setToneEnergy]     = useState<number | null>((card.toneOverride?.energy     ?? null) as number | null);

  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting,       setDeleting]       = useState(false);
  const [uploading,      setUploading]      = useState(false);
  const [uploadError,    setUploadError]    = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side guard rails — server enforces the same.
    if (!file.type.startsWith("image/")) {
      setUploadError("Pick an image file (jpg/png/webp/gif).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("Image too large (max 5 MB).");
      return;
    }

    setUploadError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API}/actions/upload-image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error ?? `Upload failed (${res.status}).`);
        return;
      }
      setTopImageUrl(data.url);
    } catch (err) {
      console.error("Image upload error:", err);
      setUploadError("Network error during upload.");
    } finally {
      setUploading(false);
      // Reset so re-picking the same file re-fires onChange.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

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
      // Build toneOverride only when at least one slider has been set. Null
      // means "use the category default" so we omit the field entirely.
      const toneOverride =
        toneAnger != null || toneComedy != null || toneSubversion != null || toneHope != null || toneEnergy != null
          ? Object.fromEntries(
              Object.entries({
                anger: toneAnger,
                comedy: toneComedy,
                subversion: toneSubversion,
                hope: toneHope,
                energy: toneEnergy,
              }).filter(([, v]) => v != null)
            )
          : null;

      const payload = {
        title:          title.trim(),
        description:    description.trim(),
        category,
        categoryColor,
        actionType,
        timeCommitment: TIME_COMMITMENT_MAP[involvement],
        // Explicit false (not undefined) so the server overwrites an existing
        // quickAction: true on the stored card. JSON.stringify drops undefined,
        // which means {...card, ...safeUpdates} would otherwise keep the old
        // value and the matcher would still see the card as a 5-min action.
        quickAction: involvement === "5min",
        isOnline,
        location:       isOnline ? undefined : (location || undefined),
        spotsTotal:     unlimited ? "Unlimited" : (Number(spotsTotal) || 10),
        authorName:     authorName.trim(),
        authorRole:     authorRole.trim(),
        authorLink:     authorLink.trim() || undefined,
        targetUrl:      targetUrl.trim() || null,
        // null clears the URL so the seed-provided topImageKey can take over again.
        topImageUrl:    topImageUrl.trim() || null,
        imageContain,
        atHome,
        firstTimerFriendly,
        eventDate:      eventDate.trim() || undefined,
        // Send null to explicitly clear an existing override; omit the field
        // when there's nothing to send.
        toneOverride,
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

      onSaved(data.card as ActionCardData);
      onClose();
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
                  className={SELECT_CLS(category)}
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
                  className={SELECT_CLS(actionType)}
                >
                  {ACTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            </div>

            {/* Time Commitment */}
            <Field label="Time Commitment">
              <InvolvementPicker
                value={involvementLevelFor(involvement)}
                onChange={setInvolvement}
                variant="plan"
              />
            </Field>

            <Field label="Location">
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className={SELECT_CLS(location)}
              >
                <option value="">— select —</option>
                {LOCATION_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              {isLegacyLocation && (
                <p className="mt-1.5 font-['Poppins',sans-serif] text-xs text-amber-600">
                  Previous value: <span className="font-semibold">{card.location}</span> — pick a canonical location to update.
                </p>
              )}
              <p className="mt-1.5 font-['Poppins',sans-serif] text-[11px] text-gray-400">
                Pick "From Home" for couch-friendly actions that aren't necessarily online — knitting, letter-writing, sign-making, calling reps, prayer. Online cards already count as at-home.
              </p>
            </Field>

            {/* Event Date */}
            <Field label="Event Date (optional)">
              <input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className={INPUT_CLS}
              />
              <p className="mt-1 font-['Poppins',sans-serif] text-[11px] text-gray-400">
                Set for time-limited events. Cards expire and are hidden after this date. Leave blank for evergreen actions.
              </p>
            </Field>

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

            {/* Header image */}
            <Field label="Header Image">
              <div className="flex items-center gap-2 mb-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1.5 px-3 py-2 bg-[#fd8e33] hover:bg-[#d96612] disabled:opacity-60 text-white font-['Poppins',sans-serif] font-semibold text-xs rounded-lg transition-colors"
                >
                  {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  {uploading ? "Uploading…" : "Upload from computer"}
                </button>
                <span className="font-['Poppins',sans-serif] text-[11px] text-gray-400">or paste a URL ↓</span>
              </div>
              <input
                type="url" value={topImageUrl}
                onChange={(e) => setTopImageUrl(e.target.value)}
                placeholder="https://… (paste any image URL; leave blank for default)"
                className={INPUT_CLS}
              />
              {(topImageUrl.trim() || card.topImage) && (
                <div className="mt-2 relative h-24 rounded-lg overflow-hidden bg-gray-50 border border-gray-200">
                  <img
                    src={topImageUrl.trim() || card.topImage}
                    alt="Header preview"
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
                  />
                </div>
              )}
              {uploadError && (
                <p className="mt-1.5 font-['Poppins',sans-serif] text-[11px] text-red-500">{uploadError}</p>
              )}
              <p className="mt-1.5 font-['Poppins',sans-serif] text-[11px] text-gray-400">
                Upload from your computer (max 5 MB) or paste a URL. Tip: right-click → Copy Image Address on any web image.
              </p>
              <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                <input
                  type="checkbox" checked={imageContain}
                  onChange={(e) => setImageContain(e.target.checked)}
                  className="w-4 h-4 rounded accent-[#23297e]"
                />
                <span className="font-['Poppins',sans-serif] text-sm text-gray-600">
                  Fit logo inside header (don't crop)
                </span>
              </label>
              <p className="mt-1 font-['Poppins',sans-serif] text-[11px] text-gray-400">
                Turn on for org logos and banners; leave off for photos.
              </p>
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
                <Field label="Action URL (where the title and banner link)">
                  <input
                    type="url" value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                    placeholder="https://…"
                    className={INPUT_CLS}
                  />
                </Field>
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

            {/* ── Highlighted action (admin only) ── */}
            {isAdmin && (
              <div className="border-t border-gray-100 pt-4">
                <h3 className="font-['Poppins',sans-serif] font-bold text-[13px] uppercase tracking-wider text-gray-700 mb-1">
                  Highlighted action
                </h3>
                <p className="font-['Poppins',sans-serif] text-xs text-gray-500 mb-3">
                  Mark this card as a highlighted action — boosts it in matching and surfaces a ⭐ HIGHLIGHTED badge in the admin panel. Best for cards that are <strong>under 5 minutes</strong>, <strong>fun or satisfying</strong>, <strong>location-agnostic</strong>, and <strong>doable without logging in</strong>. Examples: send a pre-written email to your reps, share ResistAct with a friend, text RESIST to 50409, boost an existing action.
                </p>
                <label className="flex items-start gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={firstTimerFriendly}
                    onChange={(e) => setFirstTimerFriendly(e.target.checked)}
                    className="w-4 h-4 rounded accent-[#23297e] mt-0.5"
                  />
                  <span className="font-['Poppins',sans-serif] text-sm text-gray-700">
                    Mark as a highlighted action
                  </span>
                </label>
              </div>
            )}

            {/* ── Matcher tone override (admin only) ── */}
            {isAdmin && (
              <div className="border-t border-gray-100 pt-4">
                <h3 className="font-['Poppins',sans-serif] font-bold text-[13px] uppercase tracking-wider text-gray-700 mb-1">
                  Matcher tone override
                </h3>
                <p className="font-['Poppins',sans-serif] text-xs text-gray-500 mb-3">
                  Each slider is 0–3. Leave at "auto" to use the category default. Set a value when this card's tone differs from its category — for example, a serious investigative-journalism card sitting in BOOST.
                </p>
                <div className="space-y-3">
                  {([
                    { key: "anger",      label: "Angry",      val: toneAnger,      set: setToneAnger,      Icon: Flame as LucideIcon },
                    { key: "comedy",     label: "Funny",      val: toneComedy,     set: setToneComedy,     Icon: Laugh as LucideIcon },
                    { key: "subversion", label: "Subversive", val: toneSubversion, set: setToneSubversion, Icon: VenetianMask as LucideIcon },
                    { key: "hope",       label: "Hope",       val: toneHope,       set: setToneHope,       Icon: Sunrise as LucideIcon },
                    { key: "energy",     label: "Energy",     val: toneEnergy,     set: setToneEnergy,     Icon: Zap as LucideIcon },
                  ] as const).map(({ key, label, val, set, Icon }) => (
                    <div key={key}>
                      <div className="flex items-center mb-1.5">
                        <Icon size={14} strokeWidth={2} className="text-[#23297e] mr-1.5 shrink-0" />
                        <strong className="font-['Poppins',sans-serif] font-semibold text-sm text-[#23297e]">
                          {label}
                        </strong>
                        <button
                          type="button"
                          onClick={() => set(val == null ? 1 : null)}
                          className="ml-auto font-['Poppins',sans-serif] text-[11px] text-gray-500 hover:text-[#23297e] underline"
                        >
                          {val == null ? "set" : "auto"}
                        </button>
                      </div>
                      <ToneRangeSlider
                        value={val ?? 0}
                        onChange={(v) => set(v)}
                        unset={val == null}
                        disabled={val == null}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2 font-['Poppins',sans-serif]">
                {error}
              </p>
            )}
          </div>

        {/* ── Footer ── */}
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
      </div>
    </div>
  );
}
