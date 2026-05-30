import { useRef, useState } from "react";
import { X, Loader2, Pencil, Trash2, Upload, Clock, Flame, Laugh, VenetianMask, Sunrise, Zap, ZoomIn } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { projectId } from "/utils/supabase/info";
import type { ActionCardData } from "./ActionCard";
import { LOCATION_OPTIONS } from "../lib/locations";
import { ToneRangeSlider } from "./ToneSlider";
import { InvolvementPicker, involvementLevelFor } from "./InvolvementPicker";
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
  { label: "Act of Kindness",      color: "#127f05" },
  { label: "Art/Performance Art",  color: "#896312" },
  // Bird-Dog merged into Show Up (May 2026).
  { label: "Boost",                color: "#8a00e6" },
  { label: "Boycott",              color: "#23297e" },
  { label: "Call",                 color: "#c2185b" },
  { label: "Crafting",             color: "#c34e00" },
  { label: "Email Campaign",       color: "#e44b4b" },
  { label: "Flash Mob",            color: "#ff00d5" },
  { label: "Funding",              color: "#127f05" },
  { label: "Host",                 color: "#b45309" },
  { label: "Housing",              color: "#896312" },
  { label: "Irreverence",          color: "#ff00d5" },
  { label: "Join a Group",         color: "#0891b2" },
  { label: "Labor",                color: "#127f05" },
  // Learn merged into Training; Letter to Editor merged into Letter Writing (May 2026).
  { label: "Letter Writing",       color: "#c34e00" },
  { label: "Meeting",              color: "#23297e" },
  { label: "Mental Health",        color: "#ff00d5" },
  { label: "News Story",           color: "#896312" },
  { label: "Personal Commitment",  color: "#23297e" },
  { label: "Petition",             color: "#05737f" },
  { label: "Prayer",               color: "#8a00e6" },
  { label: "Professional Skills",  color: "#126d89" },
  { label: "Protest",              color: "#23297e" },
  { label: "Represent",            color: "#b45309" },
  { label: "Show Up",              color: "#23297e" },
  { label: "Social Media",         color: "#e44b4b" },
  // Spread Positivity merged into Act of Kindness (May 2026).
  { label: "Training",             color: "#126d89" },
  { label: "Transportation",       color: "#126d89" },
  { label: "Video",                color: "#e44b4b" },
  { label: "Witness",              color: "#767574" },
  { label: "Other",                color: "#767574" },
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

const TIME_STOPS = [
  { key: "5min"     as TimeBucket, title: "Just the basics", desc: "< 5 minutes" },
  { key: "10min"    as TimeBucket, title: "A few minutes",   desc: "5–10 minutes" },
  { key: "30min"    as TimeBucket, title: "A little",        desc: "A few hours per month" },
  { key: "fewHours" as TimeBucket, title: "Regularly",       desc: "A few hours per week" },
  { key: "ongoing"  as TimeBucket, title: "All in",          desc: "Ongoing organizing" },
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
  const [title,          setTitle]          = useState(card.title);
  const [synopsis,       setSynopsis]       = useState(card.synopsis ?? ""); // one-line subtitle shown below the title on the card
  const [description,    setDescription]    = useState(card.description);
  const [category,       setCategory]       = useState(() => normaliseCategory(card.category));
  const [categoryColor,  setCategoryColor]  = useState(card.categoryColor);
  const [involvement,    setInvolvement]    = useState<TimeBucket>(() =>
    timeBucketFromCard(card.timeCommitment, (card as any).quickAction)
  );
  // "Remote" is the single canonical location-agnostic value. Legacy
  // online/at-home cards (isOnline:true, or location "Online"/"At Home"/
  // "From Home") all normalize to "Remote" so the dropdown — which now
  // only offers "Remote" — reflects them correctly.
  const LEGACY_REMOTE = new Set(["Online", "At Home", "From Home", "Remote"]);
  const initialLocation = (card.isOnline || LEGACY_REMOTE.has(card.location ?? ""))
    ? "Remote"
    : (LOCATION_OPTIONS as readonly string[]).includes(card.location ?? "")
      ? (card.location as string)
      : "";
  const [location,           setLocation]           = useState(initialLocation);
  const isOnline = location === "Remote";
  const isLegacyLocation = !card.isOnline && !!card.location && !initialLocation;
  const [authorName,         setAuthorName]         = useState(card.authorName);
  const [authorRole,         setAuthorRole]         = useState(card.authorRole);
  const [authorLink,         setAuthorLink]         = useState(card.authorLink ?? "");
  const [targetUrl,          setTargetUrl]          = useState<string>((card as any).targetUrl ?? "");
  const [topImageUrl,        setTopImageUrl]        = useState<string>((card as any).topImageUrl ?? "");
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
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [uploading,     setUploading]     = useState(false);
  const [uploadError,   setUploadError]   = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function handleSave() {
    if (!title.trim() || !description.trim()) { setError("Title and description are required."); return; }
    if (!topImageUrl.trim() && !(card as any).topImageKey) { setError("A header image is required."); return; }
    setError(null);
    setLoading(true);
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
        isOnline,
        // Keep location:"Remote" on the record (not undefined) so the string
        // and the isOnline flag stay in lock-step — both say "remote".
        location:       location || undefined,
        spotsTotal:     "Unlimited",
        authorName:     authorName.trim(),
        authorRole:     authorRole.trim(),
        authorLink:     authorLink.trim() || undefined,
        targetUrl:      targetUrl.trim() || null,
        topImageUrl:    topImageUrl.trim() || null,
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

  const tIdx = Math.max(0, TIME_STOPS.findIndex((l) => l.key === involvementLevelFor(involvement)));
  const tLevel = TIME_STOPS[tIdx];

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
            <input
              type="text" value={synopsis} maxLength={100}
              onChange={(e) => setSynopsis(e.target.value)}
              placeholder="One line in plainer language — shows under the title on the card"
              className={INPUT_CLS}
            />
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
                {CATEGORY_OPTIONS.map((o) => (
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

            {/* Time */}
            <div>
              <div className="flex items-center mb-1.5">
                <Clock size={14} strokeWidth={2} className="text-[#23297e] mr-1.5 shrink-0" />
                <strong className="font-['Poppins',sans-serif] font-semibold text-xs text-[#23297e]">Time</strong>
                <span className="ml-1.5 font-['Poppins',sans-serif] text-[11px] text-gray-500">
                  · <span className="font-medium text-[#ed6624]">{tLevel.title}</span> — {tLevel.desc}
                </span>
              </div>
              <ToneRangeSlider value={tIdx} onChange={(v) => setInvolvement(TIME_STOPS[v].key)} max={4} />
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
            <input
              type="url" value={topImageUrl}
              onChange={(e) => setTopImageUrl(e.target.value)}
              placeholder="https://… (paste any image URL)"
              className={INPUT_CLS}
            />
            {(topImageUrl.trim() || card.topImage) && (
              <div
                className="mt-2 relative h-24 rounded-xl overflow-hidden bg-gray-50 border border-gray-200 cursor-zoom-in group"
                onClick={() => setLightboxOpen(true)}
              >
                <img
                  src={topImageUrl.trim() || card.topImage}
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
            disabled={loading || deleting}
            className="flex-1 py-2.5 bg-[#23297e] hover:bg-[#1a2060] disabled:opacity-60 text-white font-['Poppins',sans-serif] font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Pencil size={15} />}
            Save Changes
          </button>
        </div>
      </div>
    </div>

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
          src={topImageUrl.trim() || card.topImage}
          alt="Header image"
          className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    )}
    </>
  );
}
