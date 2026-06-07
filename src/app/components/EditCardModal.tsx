import { useRef, useState } from "react";
import { X, Loader2, Pencil, Trash2, Upload, Clock, Flame, Laugh, VenetianMask, Sunrise, Zap, ZoomIn, Sparkles, CheckCircle2, Eye, Copy, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { projectId } from "/utils/supabase/info";
import type { ActionCardData } from "./ActionCard";
import { CardDetailsModal } from "./CardDetailsModal";
import { LOCATION_OPTIONS, locationToState, normalizeCardLocation } from "../lib/locations";
import { ToneRangeSlider } from "./ToneSlider";
import type { TimeBucket } from "../lib/matcher";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04`;

const INPUT_BASE =
  "w-full px-3.5 py-2.5 border border-gray-200 rounded-xl font-['Poppins',sans-serif] text-sm focus:outline-none focus:ring-2 focus:ring-[#23297e]/30 focus:border-[#23297e]";
const INPUT_CLS = `${INPUT_BASE} text-gray-800 placeholder-gray-400 placeholder:italic placeholder:text-gray-400`;
const SELECT_CLS = (val: string | null | undefined) =>
  `${INPUT_BASE} !pr-10 ${val ? "text-gray-800" : "text-gray-400 italic"}`;

// ─── Category list — kept in sync with AskFlowModal ───────────────────────────
// Alphabetical order so editors can find labels quickly. Includes every
// category that exists in production card data plus "Other" as a catch-all.
// Production-data audit ran via /actions API on 2026-05-25 informed this
// list (previously was missing Show Up, Host, Witness, Call, Learn,
// Bird-Dog, Letter Writing, Irreverence — combined ~150 active cards).
// "Art Piece" intentionally NOT a separate option — it merges into
// Art/Performance Art via normaliseCategory in App.tsx.
const CATEGORY_OPTIONS: { label: string; color: string }[] = [
  { label: "Kindness",             color: "#127f05" },
  // Renamed from "Boost" June 2026 — collided with the 🔥 boost action.
  { label: "Amplify",              color: "#8a00e6" },
  { label: "Art",                  color: "#896312" },
  // Bird-Dog merged into Show Up (May 2026).
  { label: "Boycott",              color: "#23297e" },
  { label: "Crafting",             color: "#c34e00" },
  { label: "Email",                color: "#e44b4b" },
  { label: "Flash Mob",            color: "#ff00d5" },
  { label: "Funding",              color: "#127f05" },
  { label: "Host",                 color: "#b45309" },
  { label: "Housing",              color: "#896312" },
  { label: "Irreverence",          color: "#ff00d5" },
  { label: "Group",                color: "#0891b2" },
  { label: "Labor",                color: "#127f05" },
  // Learn merged into Training; Letter to Editor merged into Letter Writing (May 2026).
  { label: "Writing",              color: "#c34e00" },
  { label: "Meeting",              color: "#23297e" },
  { label: "Mental Health",        color: "#ff00d5" },
  { label: "News Story",           color: "#896312" },
  { label: "Commitment",           color: "#23297e" },
  { label: "Petition",             color: "#05737f" },
  { label: "Phoning",              color: "#c2185b" },
  { label: "Prayer",               color: "#8a00e6" },
  { label: "Skills",               color: "#126d89" },
  { label: "Protest",              color: "#23297e" },
  { label: "Represent",            color: "#b45309" },
  { label: "Show Up",              color: "#23297e" },
  { label: "Social Media",         color: "#e44b4b" },
  // Spread Positivity merged into Act of Kindness (May 2026).
  { label: "Texting",              color: "#2f7d6b" },
  { label: "Training",             color: "#126d89" },
  { label: "Transport",            color: "#126d89" },
  { label: "Video",                color: "#e44b4b" },
  { label: "Volunteer",            color: "#4a7c59" },
  { label: "Witness",              color: "#767574" },
];

/** Normalise legacy ALL-CAPS categories to their title-case equivalent. */
function normaliseCategory(raw: string): string {
  const upper = raw.toUpperCase();
  const match = CATEGORY_OPTIONS.find((o) => o.label.toUpperCase() === upper);
  return match ? match.label : raw;
}

const TIME_COMMITMENT_MAP: Record<TimeBucket, string> = {
  "5min":     "< 5 minutes",
  "10min":    "5–10 minutes",
  "30min":    "~30 minutes",
  "1hr":      "1–3 hours",
  "fewHours": "1–3 hours",
  "fullDay":  "Full day",
  "ongoing":  "Ongoing",
};

// Time-commitment dropdown options. Labels are the exact strings stored on the
// card (TIME_COMMITMENT_MAP) so the picker can never disagree with what shows on
// the card — the old slider used separate, drifted labels (e.g. "30min" read as
// "A few hours per month" while the card said "~30 minutes").
const TIME_OPTIONS: { key: TimeBucket; label: string }[] = [
  { key: "5min",     label: "< 5 minutes" },
  { key: "10min",    label: "5–10 minutes" },
  { key: "30min",    label: "~30 minutes" },
  { key: "fewHours", label: "1–3 hours" },
  { key: "fullDay",  label: "Full day" },
  { key: "ongoing",  label: "Ongoing" },
];

function timeBucketFromCard(timeCommitment: string | undefined, quickAction?: boolean): TimeBucket {
  if (quickAction) return "5min";
  if (!timeCommitment) return "30min";
  if (timeCommitment === "5–10 minutes" || timeCommitment === "5-10 minutes") return "10min";
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
  isAdmin?: boolean;
  onDeleted?: (id: number) => void;
  // Fired after a successful Save & Approve (admin only). Parents that keep a
  // separate "pending" list (the admin panel) use this to drop the card out of
  // the pending queue; if omitted, the modal falls back to onSaved.
  onApproved?: (updated: ActionCardData) => void;
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

export function EditCardModal({ card, accessToken, onClose, onSaved, isAdmin, onDeleted, onApproved }: EditCardModalProps) {
  const [title,          setTitle]          = useState(card.title);
  const [synopsis,       setSynopsis]       = useState(card.synopsis ?? ""); // one-line subtitle shown below the title on the card
  const [description,    setDescription]    = useState(card.description);
  const [category,       setCategory]       = useState(() => normaliseCategory(card.category));
  const [categoryColor,  setCategoryColor]  = useState(card.categoryColor);
  const [involvement,    setInvolvement]    = useState<TimeBucket>(() =>
    timeBucketFromCard(card.timeCommitment, (card as any).quickAction)
  );
  // Remote-ness ("doable from home / online") is a SEPARATE axis from geography.
  // normalizeCardLocation folds the legacy `atHome` flag and the old
  // "Remote"/"At Home"/"Online"/"From Home" location strings into `isOnline`
  // and strips them from `location`, so the geography dropdown only ever shows
  // a real place — and a card can be state-tied AND remote at the same time.
  const normalized = normalizeCardLocation(card);
  // Resolve the (geography-only) stored location to a canonical dropdown value.
  // locationToState maps "City, ST" → state ("Beverly, MA" → "Massachusetts"),
  // passes through canonical values, and returns null for free-form venue
  // strings it can't place — so editing a legacy card pre-selects the right
  // state instead of forcing a manual re-pick.
  const normalizedLocation = locationToState(normalized.location);
  const initialLocation =
    (normalizedLocation && (LOCATION_OPTIONS as readonly string[]).includes(normalizedLocation))
      ? normalizedLocation
      : "";
  const [location,           setLocation]           = useState(initialLocation);
  const [isOnline,           setIsOnline]           = useState(normalized.isOnline);
  const isLegacyLocation = !!normalized.location && !initialLocation;
  const [authorName,         setAuthorName]         = useState(card.authorName);
  const [authorRole,         setAuthorRole]         = useState(card.authorRole);
  const [authorLink,         setAuthorLink]         = useState(card.authorLink ?? "");
  const [targetUrl,          setTargetUrl]          = useState<string>((card as any).targetUrl ?? "");
  // The URL field surfaces ONLY the card's cartoon (cartoonImageUrl) — never the
  // legacy source photo (topImageUrl/topImage), which ResistAct no longer uses.
  // So admins see/copy the cartoon URL, and a card with no cartoon yet starts
  // blank (ready to paste one) instead of showing a dead photo path. Saving an
  // empty field is non-destructive — see saveCard, which omits the image fields
  // when blank so it never wipes the card's existing image.
  const [topImageUrl,        setTopImageUrl]        = useState<string>(card.cartoonImageUrl ?? "");
  const [imageContain,       setImageContain]       = useState<boolean>(card.imageContain === true);
  const [atHome,             setAtHome]             = useState<boolean>(card.atHome === true);
  const [highlighted, setHighlighted] = useState<boolean>((card as any).highlighted === true);
  const [eventDate,          setEventDate]          = useState<string>((card as any).eventDate ?? "");
  const [toneAnger,      setToneAnger]      = useState<number | null>((card.toneOverride?.anger      ?? null) as number | null);
  const [toneComedy,     setToneComedy]     = useState<number | null>((card.toneOverride?.comedy     ?? null) as number | null);
  const [toneSubversion, setToneSubversion] = useState<number | null>((card.toneOverride?.subversion ?? null) as number | null);
  const [toneHope,       setToneHope]       = useState<number | null>((card.toneOverride?.hope       ?? null) as number | null);
  const [toneEnergy,     setToneEnergy]     = useState<number | null>((card.toneOverride?.energy     ?? null) as number | null);

  const [lightboxOpen,  setLightboxOpen]  = useState(false);
  const [previewOpen,   setPreviewOpen]   = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [uploading,     setUploading]     = useState(false);
  const [uploadError,   setUploadError]   = useState<string | null>(null);
  // Brief "Copied!" confirmation after copying the header image URL.
  const [urlCopied,     setUrlCopied]     = useState(false);
  // AI assist (admin) — generate the subtitle text and the cartoon banner.
  const [genSub,        setGenSub]        = useState(false);
  const [subError,      setSubError]      = useState<string | null>(null);
  const [genCartoon,    setGenCartoon]    = useState(false);
  const [cartoonError,  setCartoonError]  = useState<string | null>(null);
  const [approving,     setApproving]     = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  // The card's *original* source image, captured once at mount. Used as the
  // visual reference for "Generate cartoon" so regenerating keeps referencing
  // the source art rather than the last cartoon we produced (which would drift).
  const originalRefImage = useRef<string>(
    ((card as any).topImageUrl as string) || card.topImage || card.cartoonImageUrl || ""
  );

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setUploadError("Pick an image file (jpg/png/webp/gif)."); return; }
    if (file.size > 5 * 1024 * 1024) { setUploadError("Image too large (max 5 MB)."); return; }
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
      if (!res.ok) { setUploadError(data.error ?? `Upload failed (${res.status}).`); return; }
      setTopImageUrl(data.url);
    } catch (err) {
      console.error("Image upload error:", err);
      setUploadError("Network error during upload.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleCategoryChange(val: string) {
    setCategory(val);
    const found = CATEGORY_OPTIONS.find((o) => o.label === val);
    if (found) setCategoryColor(found.color);
  }

  // ── AI: draft a one-line subtitle from the current title + description ──
  async function handleGenerateSubtitle() {
    if (!title.trim() && !description.trim()) {
      setSubError("Add a title or description first.");
      return;
    }
    setSubError(null);
    setGenSub(true);
    try {
      const res = await fetch(`${API}/admin/cards/generate-subtitle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ title: title.trim(), description: description.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setSubError(data.error ?? `Generate failed (${res.status}).`); return; }
      if (data.synopsis) setSynopsis(data.synopsis);
    } catch (err) {
      console.error("Generate subtitle error:", err);
      setSubError("Network error — please try again.");
    } finally {
      setGenSub(false);
    }
  }

  // ── AI: draw a brand cartoon banner from the title/description ──
  // Reuses the original source image as a visual reference (image-to-image)
  // when one exists; otherwise the model paints a fresh scene from the text.
  async function handleGenerateCartoon() {
    if (!title.trim()) {
      setCartoonError("Add a title first — the banner is drawn from it.");
      return;
    }
    setCartoonError(null);
    setGenCartoon(true);
    try {
      const refImageUrl = originalRefImage.current?.trim() || topImageUrl.trim() || undefined;
      const res = await fetch(`${API}/admin/cards/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ title: title.trim(), description: description.trim(), refImageUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setCartoonError(data.error ?? `Image generation failed (${res.status}).`); return; }
      if (data.url) setTopImageUrl(data.url);
    } catch (err) {
      console.error("Generate cartoon error:", err);
      setCartoonError("Network error — please try again.");
    } finally {
      setGenCartoon(false);
    }
  }

  async function handleCopyImageUrl() {
    const url = topImageUrl.trim();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API unavailable (insecure context / permissions) — fall back
      // to selecting the field so the admin can copy manually.
      urlInputRef.current?.select();
      return;
    }
    setUrlCopied(true);
    window.setTimeout(() => setUrlCopied(false), 1500);
  }

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      if (accessToken.startsWith("demo-")) { onDeleted?.(card.id); onClose(); return; }
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

  // Core save — validates, PUTs the card, and returns the saved record (or null
  // on failure, with `error` already set). Does NOT close the modal or fire any
  // callback, so it can be composed by both Save and Save & Approve.
  async function saveCard(): Promise<ActionCardData | null> {
    if (!title.trim() || !description.trim()) { setError("Title and description are required."); return null; }
    // Any image satisfies the requirement — a pasted/uploaded URL, a static
    // image key, or the act's cartoon (cartoonImageUrl/topImage). The cartoon
    // is what the feed actually renders, so a card with a cartoon is never
    // "missing" a header image.
    const hasImage =
      topImageUrl.trim() || (card as any).topImageKey || card.cartoonImageUrl || card.topImage;
    if (!hasImage) { setError("A header image is required."); return null; }
    setError(null);
    try {
      const toneOverride =
        toneAnger != null || toneComedy != null || toneSubversion != null || toneHope != null || toneEnergy != null
          ? Object.fromEntries(
              Object.entries({ anger: toneAnger, comedy: toneComedy, subversion: toneSubversion, hope: toneHope, energy: toneEnergy })
                .filter(([, v]) => v != null)
            )
          : null;

      const payload = {
        title:          title.trim(),
        // null (not "") clears it back to the manifest fallback, mirroring targetUrl.
        synopsis:       synopsis.trim() || null,
        description:    description.trim(),
        category,
        categoryColor,
        timeCommitment: TIME_COMMITMENT_MAP[involvement],
        quickAction:    involvement === "5min",
        // Independent axes: isOnline (remote/from-home) + geographic location.
        isOnline,
        location:       location || undefined,
        spotsTotal:     "Unlimited",
        authorName:     authorName.trim(),
        authorRole:     authorRole.trim(),
        authorLink:     authorLink.trim() || undefined,
        targetUrl:      targetUrl.trim() || null,
        // Image fields: write ONLY when the field has a URL (which is always a
        // cartoon now). We mirror it into cartoonImageUrl too — the field the
        // feed reads first — so the cartoon wins over any legacy image. When the
        // field is blank we OMIT both: the PUT merges, so omitting preserves the
        // card's existing image rather than wiping it. A blank field means "no
        // cartoon yet," never "delete the image."
        ...(topImageUrl.trim()
          ? { topImageUrl: topImageUrl.trim(), cartoonImageUrl: topImageUrl.trim() }
          : {}),
        imageContain,
        atHome,
        highlighted,
        eventDate:      eventDate.trim() || undefined,
        toneOverride,
      };

      const res = await fetch(`${API}/actions/${card.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to save changes."); return null; }
      return data.card as ActionCardData;
    } catch (err) {
      console.error("Edit card error:", err);
      setError("Network error — please try again.");
      return null;
    }
  }

  async function handleSave() {
    setLoading(true);
    const saved = await saveCard();
    setLoading(false);
    if (saved) { onSaved(saved); onClose(); }
  }

  // Save the edits, then flip the card to approved in one click. Approval is a
  // separate endpoint (PUT /actions strips adminApproved on purpose), and it
  // hard-requires an image — which saveCard() has already enforced.
  async function handleSaveAndApprove() {
    setApproving(true);
    const saved = await saveCard();
    if (!saved) { setApproving(false); return; }
    try {
      const res = await fetch(`${API}/admin/approve-action/${card.id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? `Approval failed (${res.status}).`); return; }
      const approved = { ...saved, ...(data.card ?? {}) } as ActionCardData;
      (onApproved ?? onSaved)(approved);
      onClose();
    } catch (err) {
      console.error("Approve card error:", err);
      setError("Network error during approval.");
    } finally {
      setApproving(false);
    }
  }

  return (
    <>
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
          <div className="w-9 h-9 rounded-full bg-[#23297e]/10 flex items-center justify-center shrink-0">
            <Pencil size={15} className="text-[#23297e]" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-[18px] leading-tight">Edit Action</h2>
            <p className="font-['Poppins',sans-serif] text-gray-400 text-xs truncate">{card.title}</p>
          </div>
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            title="Preview how this act looks to users"
            className="flex items-center gap-1.5 h-9 px-3 rounded-full border border-[#23297e]/20 bg-[#23297e]/5 text-[#23297e] hover:bg-[#23297e]/10 font-['Poppins',sans-serif] font-semibold text-xs transition-colors shrink-0"
          >
            <Eye size={14} />
            Preview
          </button>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* Admin: highlighted action — shown at top for quick access */}
          {isAdmin && (
            <label className="flex items-center gap-2 cursor-pointer select-none bg-[#23297e]/5 rounded-xl px-3 py-2.5">
              <input
                type="checkbox" checked={highlighted}
                onChange={(e) => setHighlighted(e.target.checked)}
                className="w-4 h-4 rounded accent-[#23297e]"
              />
              <span className="font-['Poppins',sans-serif] text-sm font-semibold text-[#23297e]">
                ⭐ Highlighted action <span className="font-normal text-gray-500">(pins to top of the feed)</span>
              </span>
            </label>
          )}

          {/* Core fields */}
          <Field label="Title *">
            <input
              type="text" value={title} maxLength={100}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Clear, compelling title…"
              className={INPUT_CLS}
            />
          </Field>

          <Field label="Subtitle">
            <div className="flex items-start gap-2">
              <input
                type="text" value={synopsis} maxLength={100}
                onChange={(e) => setSynopsis(e.target.value)}
                placeholder="One line in plainer language — shows under the title on the card"
                className={INPUT_CLS}
              />
              {isAdmin && (
                <button
                  type="button"
                  onClick={handleGenerateSubtitle}
                  disabled={genSub || loading || approving}
                  title="Write a subtitle from the title & description"
                  className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-[#23297e]/20 bg-[#23297e]/5 text-[#23297e] hover:bg-[#23297e]/10 disabled:opacity-60 font-['Poppins',sans-serif] font-semibold text-xs transition-colors"
                >
                  {genSub ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  {genSub ? "Writing…" : "Generate"}
                </button>
              )}
            </div>
            {subError && (
              <p className="mt-1.5 font-['Poppins',sans-serif] text-[11px] text-red-500">{subError}</p>
            )}
          </Field>

          <Field label="Description *">
            <textarea
              rows={4} value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What do you need help with and why does it matter?"
              className={`${INPUT_CLS} resize-none`}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <select
                value={category}
                onChange={(e) => handleCategoryChange(e.target.value)}
                className={SELECT_CLS(category)}
              >
                {[...CATEGORY_OPTIONS].sort((a, b) => a.label.localeCompare(b.label)).map((o) => (
                  <option key={o.label} value={o.label}>{o.label}</option>
                ))}
                {!CATEGORY_OPTIONS.find((o) => o.label === category) && (
                  <option value={category}>{category}</option>
                )}
              </select>
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
                <p className="mt-1 font-['Poppins',sans-serif] text-[11px] text-amber-600">
                  Previous: <span className="font-semibold">{card.location}</span>
                </p>
              )}
              {/* Remote-ness is independent of the state above: an act can be
                  tied to a place AND still be doable from home. */}
              <label className="mt-2 flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isOnline}
                  onChange={(e) => setIsOnline(e.target.checked)}
                  className="h-4 w-4 accent-[#23297e]"
                />
                <span className="font-['Poppins',sans-serif] text-[12px] text-gray-700">
                  Can be done remotely / from home
                </span>
              </label>
            </Field>
          </div>

          <Field label="Action URL">
            <input
              type="url" value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://… (where the title and banner link)"
              className={INPUT_CLS}
            />
          </Field>

          {/* Tone & Time — grouped card matching the add wizard */}
          <div className="rounded-2xl border border-gray-100 bg-gray-50/60 px-4 py-4 space-y-4">
            <p className="font-['Poppins',sans-serif] text-[13px] font-semibold text-[#23297e]">
              Tone & Time
            </p>

            {/* Time — a dropdown of the exact time-commitment labels, so it always
                matches the value shown on the card (the old slider drifted). */}
            <div>
              <div className="flex items-center mb-1.5">
                <Clock size={14} strokeWidth={2} className="text-[#23297e] mr-1.5 shrink-0" />
                <strong className="font-['Poppins',sans-serif] font-semibold text-xs text-[#23297e]">Time commitment</strong>
              </div>
              <select
                value={involvement === "1hr" ? "fewHours" : involvement}
                onChange={(e) => setInvolvement(e.target.value as TimeBucket)}
                className={INPUT_CLS}
              >
                {TIME_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </div>

            {/* Tone sliders — admin override; non-admins see read-only defaults */}
            {isAdmin ? (
              <div className="space-y-3">
                <p className="font-['Poppins',sans-serif] text-[11px] text-gray-400">
                  Leave at "auto" to use the category default. Set only when this card's tone differs from its category.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3">
                  {([
                    { key: "anger",      label: "Angry",      val: toneAnger,      set: setToneAnger,      Icon: Flame as LucideIcon,        stops: [
                      { label: "None", desc: "Calm, no confrontation" }, { label: "Low", desc: "A little edge, stays subtle" }, { label: "Bold", desc: "Direct and attention-getting" }, { label: "High", desc: "In-the-streets energy" },
                    ]},
                    { key: "comedy",     label: "Funny",      val: toneComedy,     set: setToneComedy,     Icon: Laugh as LucideIcon,        stops: [
                      { label: "None", desc: "Straight-faced, serious" }, { label: "Light", desc: "A bit of wit" }, { label: "Irreverent", desc: "Mockery and mischief" }, { label: "Full mockery", desc: "Absurdity as resistance" },
                    ]},
                    { key: "subversion", label: "Subversive", val: toneSubversion, set: setToneSubversion, Icon: VenetianMask as LucideIcon, stops: [
                      { label: "None", desc: "Conventional approach" }, { label: "Mild", desc: "Slightly off the beaten path" }, { label: "Edgy", desc: "Disruptive, unconventional" }, { label: "Radical", desc: "Throw the rulebook out" },
                    ]},
                    { key: "hope",       label: "Hope",       val: toneHope,       set: setToneHope,       Icon: Sunrise as LucideIcon,      stops: [
                      { label: "None", desc: "Realistic, no rose-tinting" }, { label: "Some", desc: "A glimmer of optimism" }, { label: "Uplifting", desc: "Building and inspiring" }, { label: "Full hope", desc: "Movement energy, community-first" },
                    ]},
                    { key: "energy",     label: "Energy",     val: toneEnergy,     set: setToneEnergy,     Icon: Zap as LucideIcon,          stops: [
                      { label: "Low", desc: "Low demand on the participant" }, { label: "Mild", desc: "A moderate lift" }, { label: "Engaged", desc: "Requires real showing up" }, { label: "On fire", desc: "All in, maximum commitment" },
                    ]},
                  ] as const).map(({ key, label, val, set, Icon, stops }) => {
                    const stop = val != null ? stops[val] : null;
                    return (
                      <div key={key}>
                        <div className="flex items-center mb-1.5">
                          <Icon size={14} strokeWidth={2} className="text-[#23297e] mr-1.5 shrink-0" />
                          <strong className="font-['Poppins',sans-serif] font-semibold text-xs text-[#23297e]">{label}</strong>
                          {stop && (
                            <span className="ml-1.5 font-['Poppins',sans-serif] text-[11px] text-gray-500 truncate">
                              · <span className="font-medium text-[#ed6624]">{stop.label}</span> — {stop.desc}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => set(val == null ? 1 : null)}
                            className="ml-auto shrink-0 font-['Poppins',sans-serif] text-[11px] text-gray-500 hover:text-[#23297e] underline"
                          >
                            {val == null ? "set" : "auto"}
                          </button>
                        </div>
                        <ToneRangeSlider value={val ?? 0} onChange={(v) => set(v)} unset={val == null} disabled={val == null} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          {/* Header image */}
          <Field label="Header Image *">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1.5 px-3 py-2 bg-[#ed6624] hover:bg-[#c2521b] disabled:opacity-60 text-white font-['Poppins',sans-serif] font-semibold text-xs rounded-lg transition-colors"
              >
                {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                {uploading ? "Uploading…" : "Upload from computer"}
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={handleGenerateCartoon}
                  disabled={genCartoon || loading || approving}
                  title="Draw a brand cartoon banner from the title & description (falls back to the current image as a reference if the text isn't descriptive enough)"
                  className="flex items-center gap-1.5 px-3 py-2 border border-[#23297e]/20 bg-[#23297e]/5 hover:bg-[#23297e]/10 disabled:opacity-60 text-[#23297e] font-['Poppins',sans-serif] font-semibold text-xs rounded-lg transition-colors"
                >
                  {genCartoon ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  {genCartoon ? "Drawing…" : "Generate cartoon"}
                </button>
              )}
              <span className="font-['Poppins',sans-serif] text-[11px] text-gray-400">or paste a URL ↓</span>
              <label className="ml-auto flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox" checked={imageContain}
                  onChange={(e) => setImageContain(e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-[#ed6624]"
                />
                <span className="font-['Poppins',sans-serif] text-[11.5px] text-gray-500">Fit logo (don't crop)</span>
              </label>
            </div>
            <div className="flex items-stretch gap-2">
              <input
                ref={urlInputRef}
                type="url" value={topImageUrl}
                onChange={(e) => setTopImageUrl(e.target.value)}
                placeholder="https://… (paste any image URL)"
                className={`${INPUT_CLS} flex-1`}
              />
              <button
                type="button"
                onClick={handleCopyImageUrl}
                disabled={!topImageUrl.trim()}
                title="Copy image URL"
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[#23297e]/20 bg-[#23297e]/5 px-3 font-['Poppins',sans-serif] text-xs font-semibold text-[#23297e] transition-colors hover:bg-[#23297e]/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {urlCopied ? <Check size={13} /> : <Copy size={13} />}
                {urlCopied ? "Copied!" : "Copy"}
              </button>
            </div>
            {/* Preview shows ONLY the cartoon (field value or cartoonImageUrl) —
                never the legacy source photo. No cartoon yet → no preview. */}
            {(topImageUrl.trim() || card.cartoonImageUrl) && (
              <div
                className="mt-2 relative h-24 rounded-xl overflow-hidden bg-gray-50 border border-gray-200 cursor-zoom-in group"
                onClick={() => setLightboxOpen(true)}
              >
                <img
                  src={topImageUrl.trim() || card.cartoonImageUrl}
                  alt="Header preview"
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/25 transition-colors">
                  <ZoomIn size={22} className="text-white opacity-0 group-hover:opacity-100 drop-shadow transition-opacity" />
                </div>
              </div>
            )}
            {uploadError && (
              <p className="mt-1.5 font-['Poppins',sans-serif] text-[11px] text-red-500">{uploadError}</p>
            )}
            {cartoonError && (
              <p className="mt-1.5 font-['Poppins',sans-serif] text-[11px] text-red-500">{cartoonError}</p>
            )}
            {genCartoon && (
              <p className="mt-1.5 font-['Poppins',sans-serif] text-[11px] text-[#23297e]">
                Drawing your cartoon banner… this can take 15–30 seconds.
              </p>
            )}
          </Field>

          {/* Optional section */}
          <div className="border-t border-gray-100 pt-4">
            <p className="font-['Poppins',sans-serif] text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-3">Optional</p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Author name or org">
                  <input
                    type="text" value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    placeholder="e.g. NAACP, Indivisible"
                    className={INPUT_CLS}
                  />
                </Field>
                <Field label="Role">
                  <input
                    type="text" value={authorRole}
                    onChange={(e) => setAuthorRole(e.target.value)}
                    placeholder="e.g. Organizer"
                    className={INPUT_CLS}
                  />
                </Field>
              </div>
              <Field label="Author's website">
                <input
                  type="url" value={authorLink}
                  onChange={(e) => setAuthorLink(e.target.value)}
                  placeholder="https://…"
                  className={INPUT_CLS}
                />
              </Field>
              <Field label="Event date">
                <input
                  type="date" value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className={INPUT_CLS}
                />
                <p className="mt-1 font-['Poppins',sans-serif] text-[11px] text-gray-400">
                  Cards are hidden after this date. Leave blank for evergreen actions.
                </p>
              </Field>
            </div>
          </div>


          {error && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2 font-['Poppins',sans-serif]">
              {error}
            </p>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="shrink-0 px-6 py-4 border-t border-gray-100 flex items-center gap-3">
          {isAdmin && (
            confirmDelete ? (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-3 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-['Poppins',sans-serif] font-bold text-sm rounded-xl transition-colors flex items-center gap-2 shrink-0"
              >
                {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={15} />}
                Confirm Delete
              </button>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
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
            disabled={loading || approving || deleting}
            className="flex-1 py-2.5 bg-[#23297e] hover:bg-[#1a2060] disabled:opacity-60 text-white font-['Poppins',sans-serif] font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Pencil size={15} />}
            Save Changes
          </button>
          {isAdmin && !(card as any).adminApproved && (
            <button
              onClick={handleSaveAndApprove}
              disabled={loading || approving || deleting}
              title="Save these edits and publish the act to the live feed"
              className="flex-1 py-2.5 bg-[#127f05] hover:bg-[#0f6804] disabled:opacity-60 text-white font-['Poppins',sans-serif] font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {approving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={15} />}
              Save &amp; Approve
            </button>
          )}
        </div>
      </div>
    </div>

    {/* ── Live preview — the full CardDetailsModal users see, built from the
         current (unsaved) edits so admins can sanity-check before saving. ── */}
    {previewOpen && (
      <CardDetailsModal
        card={{
          ...card,
          title:          title.trim() || card.title,
          synopsis:       synopsis.trim() || undefined,
          description:    description.trim() || card.description,
          category,
          categoryColor,
          timeCommitment: TIME_COMMITMENT_MAP[involvement],
          quickAction:    involvement === "5min",
          isOnline,
          location:       location || card.location,
          authorName,
          authorRole,
          authorLink:     authorLink.trim() || undefined,
          targetUrl:      targetUrl.trim() || (card as any).targetUrl,
          imageContain,
          eventDate:      eventDate.trim() || undefined,
          // CardDetailsModal renders `cartoonImageUrl ?? topImage`; mirror the
          // edited header URL into both so the preview reflects unsaved image
          // changes. Cartoon only — legacy source photos are intentionally not
          // surfaced (no cartoon yet → the card's own fallback art shows).
          cartoonImageUrl: topImageUrl.trim() || card.cartoonImageUrl,
          topImage:        topImageUrl.trim() || card.cartoonImageUrl,
        } as ActionCardData}
        onClose={() => setPreviewOpen(false)}
      />
    )}

    {/* ── Lightbox ── */}
    {lightboxOpen && (
      <div
        className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-4"
        onClick={() => setLightboxOpen(false)}
      >
        <button
          className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
          onClick={() => setLightboxOpen(false)}
        >
          <X size={18} />
        </button>
        <img
          src={topImageUrl.trim() || card.cartoonImageUrl}
          alt="Header image"
          className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    )}
    </>
  );
}
