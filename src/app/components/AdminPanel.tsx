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
import { LOCATION_OPTIONS } from "../lib/locations";
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
  /** Fires when admin clicks "View as" on a user row. Parent closes the
   *  panel, calls POST /admin/impersonate/:id, and overlays the snapshot
   *  on top of the app's normal state. Read-only — the impersonation
   *  banner is what tells the admin they're in view-as mode. */
  onImpersonate?: (userId: string, name: string) => void;
  /** Fires after a card is approved (or deleted) here so the parent can
   *  update its own `cards` array. Without this, the feed keeps showing a
   *  just-approved card with the PENDING badge until a full reload, because
   *  the panel only mutates its local pending list. `approved` distinguishes
   *  the two so the parent flips adminApproved vs. removes the card. */
  onCardChanged?: (id: number, change: "approved" | "deleted") => void;
  /** Current state of the global "site updating" banner shown to all visitors. */
  siteUpdating?: boolean;
  /** Toggle the global site-updating banner on/off. Admin-only. */
  onToggleSiteUpdating?: (enabled: boolean) => void;
  /** Fires after the "Create from URL" tool publishes a new (live) card. The
   *  parent injects it into the feed, closes the panel, and opens its detail
   *  modal so the admin can immediately test it. */
  onCardCreated?: (card: ActionCardData) => void;
}

type TabFilter = "active" | "pending" | "approved" | "rejected" | "all";
type PanelMode = "cards" | "users" | "nourl" | "noimage" | "matcher" | "online" | "bigimages" | "brokenimages" | "sameurl" | "newcard" | "siteupdate";

// Category labels + colors for the "Create from URL" form's dropdown. Mirrors
// EditCardModal's CATEGORY_OPTIONS so a created card gets the right pill color.
const NEWCARD_CATEGORIES: { label: string; color: string }[] = [
  { label: "Act of Kindness", color: "#127f05" }, { label: "Amplify", color: "#8a00e6" },
  { label: "Art/Performance Art", color: "#896312" }, { label: "Boycott", color: "#23297e" },
  { label: "Call", color: "#c2185b" }, { label: "Crafting", color: "#c34e00" },
  { label: "Email Campaign", color: "#e44b4b" }, { label: "Flash Mob", color: "#ff00d5" },
  { label: "Funding", color: "#127f05" }, { label: "Host", color: "#b45309" },
  { label: "Housing", color: "#896312" }, { label: "Irreverence", color: "#ff00d5" },
  { label: "Join a Group", color: "#0891b2" }, { label: "Labor", color: "#127f05" },
  { label: "Letter Writing", color: "#c34e00" }, { label: "Meeting", color: "#23297e" },
  { label: "Mental Health", color: "#ff00d5" }, { label: "News Story", color: "#896312" },
  { label: "Personal Commitment", color: "#23297e" }, { label: "Petition", color: "#05737f" },
  { label: "Prayer", color: "#8a00e6" }, { label: "Professional Skills", color: "#126d89" },
  { label: "Protest", color: "#23297e" }, { label: "Represent", color: "#b45309" },
  { label: "Show Up", color: "#23297e" }, { label: "Social Media", color: "#e44b4b" },
  { label: "Training", color: "#126d89" }, { label: "Transportation", color: "#126d89" },
  { label: "Video", color: "#e44b4b" }, { label: "Witness", color: "#767574" },
  { label: "Other", color: "#767574" },
];

interface NewCardForm {
  url: string; title: string; synopsis: string; description: string;
  category: string; location: string; isOnline: boolean; targetUrl: string;
  authorName: string; authorRole: string;
  tone: { anger: number; comedy: number; subversion: number; hope: number; energy: number };
  eventDate: string;
}
const EMPTY_NEWCARD: NewCardForm = {
  url: "", title: "", synopsis: "", description: "", category: "", location: "",
  isOnline: false, targetUrl: "", authorName: "", authorRole: "Movement Organization",
  tone: { anger: 1, comedy: 1, subversion: 1, hope: 1, energy: 1 }, eventDate: "",
};
const clampTone = (v: unknown): number => Math.max(0, Math.min(3, Math.round(Number(v) || 0)));

interface SameUrlCard {
  id: number;
  title: string;
  authorName: string;
  targetUrl: string;
  authorLink: string;
  adminApproved?: boolean;
}

interface BigImageCard {
  id: number;
  title: string;
  authorName: string;
  topImageUrl: string;
  size: number;
  contentType: string;
}

interface BrokenImageCard {
  id: number;
  title: string;
  authorName: string;
  topImageUrl: string;
  fullUrl: string;
  status: number;
  error: string | null;
  /** Why the scan flagged it: dead link, expiring social CDN, non-image body, or network failure. */
  reason?: "not-found" | "expiring-cdn" | "non-image" | "network";
  adminApproved?: boolean;
}

interface OnlineUser {
  userId: string;
  name: string;
  email: string;
  avatar: string | null;
  isAdmin: boolean;
  status: string;
  lastSeenAt: string;
  /** Total "I did this!" completions by this user, joined in client-side
   * from /admin/users so we can show act counts inline in the Online tab. */
  totalActions?: number;
}

interface AnonStats {
  /** Sum of every card's `completions` counter across the public catalog. */
  totalCardCompletions: number;
  /** Sum of `totalActions` over every registered user — i.e. the portion of
   * card completions we can attribute to a logged-in person. */
  totalLoggedInCompletions: number;
  /** Best estimate of completions performed without a sign-in. Equal to the
   * difference of the two above, floored at 0 to absorb double-counting from
   * legacy data (a few user records were re-counted in the early days). */
  totalAnonCompletions: number;
}

interface AnonEvent {
  /** ISO timestamp the anon completion was recorded. */
  completedAt: string;
  /** Action id that was bumped. */
  actionId: number;
  /** Action title at the time of the event (server side enriches). */
  title?: string;
  /** Action category at the time of the event. */
  category?: string;
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
  highlighted?: boolean;
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

export function AdminPanel({ accessToken, onClose, imageMap, onImpersonate, onCardChanged, siteUpdating, onToggleSiteUpdating, onCardCreated }: AdminPanelProps) {
  // Default to "online" — quickest read on engagement when an admin opens
  // the panel. Other modes (cards, users, …) are one dropdown click away.
  const [mode, setMode] = useState<PanelMode>("online");

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

  // ── No-image cards state ─────────────────────────────────────────────────────
  const [noImageCards, setNoImageCards] = useState<PendingCard[]>([]);
  const [noImageLoading, setNoImageLoading] = useState(false);
  const [noImageError, setNoImageError] = useState<string | null>(null);

  // ── Online-now state ─────────────────────────────────────────────────────────
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  /** Aggregate breakdown of card completions by attribution (logged-in vs
   *  anon). Computed once per Online-tab fetch from the public actions
   *  endpoint and the /admin/users response. */
  const [anonStats, setAnonStats] = useState<AnonStats | null>(null);
  /** Per-event anon completions from the backend tracker (populated only
   *  once the edge function is redeployed with `anon:complete:*` writes —
   *  empty / 404 is the harmless "feature not deployed yet" state). */
  const [anonEvents, setAnonEvents] = useState<AnonEvent[]>([]);
  /** True after we've successfully hit /admin/anon-online once. Lets the
   *  UI differentiate "no anon activity in this window" from "the per-event
   *  tracker isn't deployed yet" without a noisy error. */
  const [anonEventsAvailable, setAnonEventsAvailable] = useState(false);

  // ── Big-images state ─────────────────────────────────────────────────────────
  const [bigImages, setBigImages] = useState<BigImageCard[]>([]);
  const [bigImagesLoading, setBigImagesLoading] = useState(false);
  const [bigImagesError, setBigImagesError] = useState<string | null>(null);
  const [optimizing, setOptimizing] = useState<number | null>(null);
  /** Per-card status after a recompress click — feedback shown inline. */
  const [optResults, setOptResults] = useState<Record<number, { ok: boolean; msg: string }>>({});

  // ── Broken-images state ──────────────────────────────────────────────────────
  const [brokenImages, setBrokenImages] = useState<BrokenImageCard[]>([]);
  const [brokenLoading, setBrokenLoading] = useState(false);
  const [brokenError, setBrokenError] = useState<string | null>(null);
  const [brokenOrigin, setBrokenOrigin] = useState<string>(() => window.location.origin);
  const [brokenScannedCount, setBrokenScannedCount] = useState<number>(0);
  // Cards the scan couldn't confirm either way — host blocked our request
  // (403/429/5xx) or timed out. Likely fine in a real browser; surfaced
  // separately so they don't inflate the "broken" count.
  const [brokenInconclusive, setBrokenInconclusive] = useState<number>(0);
  // Cards skipped because they display a cartoon banner — their topImageUrl is
  // a stale fallback that's never shown, so a dead URL there is harmless.
  const [brokenViaCartoon, setBrokenViaCartoon] = useState<number>(0);

  // ── Same-URL audit state (action url == author link) ─────────────────────────
  const [sameUrlCards, setSameUrlCards] = useState<SameUrlCard[]>([]);
  const [sameUrlLoading, setSameUrlLoading] = useState(false);
  const [sameUrlError, setSameUrlError] = useState<string | null>(null);

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };

  // True when a backdrop mousedown started on the overlay itself (not dragged
  // out of the panel) — gates close-on-backdrop-click. See the overlay below.
  const backdropMouseDown = useRef(false);

  // ── "Create from URL" state ────────────────────────────────────────────────
  const [nc, setNc] = useState<NewCardForm>(EMPTY_NEWCARD);
  const [ncRefImage, setNcRefImage] = useState<string | null>(null);
  const [ncCartoon, setNcCartoon] = useState<string | null>(null);
  const [ncDrafting, setNcDrafting] = useState(false);
  const [ncImaging, setNcImaging] = useState(false);
  const [ncCreating, setNcCreating] = useState(false);
  const [ncError, setNcError] = useState<string | null>(null);
  const [ncToast, setNcToast] = useState<string | null>(null);

  async function ncGenerateDraft() {
    if (!/^https?:\/\//i.test(nc.url.trim())) { setNcError("Enter a valid http(s) URL."); return; }
    setNcError(null); setNcToast(null); setNcDrafting(true);
    try {
      const res = await fetch(`${API}/admin/cards/from-url`, {
        method: "POST", headers: authHeaders, body: JSON.stringify({ url: nc.url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setNcError(data.error ?? "Couldn't draft from that URL."); return; }
      const d = data.draft ?? {};
      const t = d.toneOverride && typeof d.toneOverride === "object" ? d.toneOverride : null;
      setNc((p) => ({
        ...p,
        title: d.title ?? p.title,
        synopsis: d.synopsis ?? p.synopsis,
        description: d.description ?? p.description,
        category: d.category ?? p.category,
        location: d.location ?? p.location,
        isOnline: typeof d.isOnline === "boolean" ? d.isOnline : p.isOnline,
        targetUrl: (d.targetUrl ?? p.url ?? p.targetUrl) || p.targetUrl,
        authorName: d.authorName ?? p.authorName,
        authorRole: d.authorRole ?? p.authorRole,
        eventDate: d.eventDate ?? "",
        tone: t ? {
          anger: clampTone(t.anger), comedy: clampTone(t.comedy), subversion: clampTone(t.subversion),
          hope: clampTone(t.hope), energy: clampTone(t.energy),
        } : p.tone,
      }));
      setNcRefImage(data.refImageUrl ?? null);
    } catch { setNcError("Network error drafting the card."); }
    finally { setNcDrafting(false); }
  }

  async function ncGenerateCartoon() {
    if (!nc.title.trim()) { setNcError("Add a title before generating a cartoon."); return; }
    setNcError(null); setNcImaging(true);
    try {
      const res = await fetch(`${API}/admin/cards/generate-image`, {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ title: nc.title.trim(), description: nc.description.trim(), refImageUrl: ncRefImage }),
      });
      const data = await res.json();
      if (!res.ok) { setNcError(data.error ?? "Image generation failed."); return; }
      setNcCartoon(data.url);
    } catch { setNcError("Network error generating the cartoon."); }
    finally { setNcImaging(false); }
  }

  async function ncCreate() {
    if (!nc.title.trim() || !nc.description.trim() || !nc.category) {
      setNcError("Title, description, and category are required."); return;
    }
    setNcError(null); setNcToast(null); setNcCreating(true);
    try {
      const color = NEWCARD_CATEGORIES.find((c) => c.label === nc.category)?.color;
      const res = await fetch(`${API}/admin/cards/create`, {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({
          title: nc.title.trim(), synopsis: nc.synopsis.trim() || undefined, description: nc.description.trim(),
          category: nc.category, categoryColor: color, location: nc.location || undefined, isOnline: nc.isOnline,
          targetUrl: nc.targetUrl.trim() || undefined, authorName: nc.authorName.trim() || undefined,
          authorRole: nc.authorRole.trim() || undefined, toneOverride: nc.tone,
          eventDate: nc.eventDate || undefined, cartoonImageUrl: ncCartoon || undefined,
          sourceUrl: nc.url.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setNcError(data.error ?? "Create failed."); return; }
      // Published live. Reset the form, then hand the card to the parent, which
      // injects it into the feed, closes this panel, and opens its detail modal
      // so the admin can immediately test it.
      setNc(EMPTY_NEWCARD); setNcRefImage(null); setNcCartoon(null);
      onCardCreated?.(data.card);
    } catch { setNcError("Network error creating the card."); }
    finally { setNcCreating(false); }
  }

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

  const [syncing, setSyncing] = useState(false);
  async function syncAuthUsers() {
    setSyncing(true);
    try {
      const res = await fetch(`${API}/admin/sync-auth-users`, { method: "POST", headers: authHeaders });
      const data = await res.json();
      if (!res.ok) { alert(data.error ?? "Sync failed"); return; }
      const msg = data.seeded.length === 0
        ? `All ${data.authTotal} Supabase users already have records.`
        : `Seeded ${data.seeded.length} missing user(s): ${data.seeded.map((u: any) => u.email).join(", ")}`;
      alert(msg);
      await fetchUsers();
    } catch {
      alert("Network error during sync.");
    } finally {
      setSyncing(false);
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
      const res = await fetch(`${API}/admin/actions/no-url?filter=url`, { headers: authHeaders });
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

  async function fetchNoImageCards() {
    setNoImageLoading(true);
    setNoImageError(null);
    try {
      const res = await fetch(`${API}/admin/actions/no-url?filter=image`, { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) { setNoImageError(data.error ?? "Failed to load cards."); return; }
      setNoImageCards(data.cards ?? []);
    } catch {
      setNoImageError("Network error loading cards.");
    } finally {
      setNoImageLoading(false);
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
      // 10080 minutes = 7 days. The Online tab now answers "who has used
      // the site this week?" — broader window catches weekly returners,
      // not just folks who happened to log in today. The status dot below
      // still tiers green / amber / gray-today / gray-week so the live
      // signal is preserved within the wider list.
      //
      // Four requests fire in parallel so one slow endpoint doesn't gate
      // the others:
      //   1. /admin/online-users   — primary list of who's been around
      //   2. /admin/users          — joined in for per-user totalActions
      //   3. /actions?limit=5000   — sum of card.completions for the anon
      //                              aggregate ("anonymous vs logged in")
      //   4. /admin/anon-online    — per-event anon list (404s harmlessly
      //                              until the tracker is deployed)
      const [onlineRes, usersRes, actionsRes, anonRes] = await Promise.all([
        fetch(`${API}/admin/online-users?windowMinutes=10080`, { headers: authHeaders }),
        fetch(`${API}/admin/users`, { headers: authHeaders }),
        fetch(`${API}/actions?limit=5000`, { headers: authHeaders }),
        fetch(`${API}/admin/anon-online?windowMinutes=10080`, { headers: authHeaders }),
      ]);

      const onlineData = await onlineRes.json();
      if (!onlineRes.ok) { setOnlineError(onlineData.error ?? "Failed to load online users."); return; }

      // Build a userId → totalActions lookup from /admin/users (best-effort —
      // if that endpoint fails, the chips simply don't render).
      const actionsByUser: Record<string, number> = {};
      if (usersRes.ok) {
        const usersData = await usersRes.json();
        for (const u of usersData.users ?? []) {
          if (u?.userId) actionsByUser[u.userId] = u.totalActions ?? 0;
        }
      }

      const enriched: OnlineUser[] = (onlineData.users ?? []).map((u: OnlineUser) => ({
        ...u,
        totalActions: actionsByUser[u.userId] ?? 0,
      }));
      setOnlineUsers(enriched);

      // ── Aggregate anon completions ────────────────────────────────────
      // totalAnon ≈ Σ card.completions − Σ user.totalActions. This isn't
      // perfectly exact (early users had a few double-attributed bumps that
      // never got reconciled), so the difference is clamped to ≥ 0 — better
      // to under-count anon than to show a negative.
      if (actionsRes.ok) {
        const actionsData = await actionsRes.json();
        const totalCardCompletions = (actionsData.cards ?? []).reduce(
          (sum: number, card: any) => sum + (typeof card.completions === "number" ? card.completions : 0),
          0,
        );
        const totalLoggedIn = Object.values(actionsByUser).reduce((s, n) => s + n, 0);
        setAnonStats({
          totalCardCompletions,
          totalLoggedInCompletions: totalLoggedIn,
          totalAnonCompletions: Math.max(0, totalCardCompletions - totalLoggedIn),
        });
      }

      // ── Per-event anon list (going-forward data) ───────────────────────
      if (anonRes.ok) {
        const anonData = await anonRes.json();
        setAnonEvents(anonData.events ?? []);
        setAnonEventsAvailable(true);
      } else {
        // 404 just means the backend tracker hasn't been deployed yet —
        // not an error worth surfacing. Other statuses (500, network) we
        // also tolerate silently here since the aggregate above is the
        // primary insight; the per-event list is bonus.
        setAnonEvents([]);
        setAnonEventsAvailable(false);
      }
    } catch {
      setOnlineError("Network error loading online users.");
    } finally {
      setOnlineLoading(false);
    }
  }

  async function fetchBigImages() {
    setBigImagesLoading(true);
    setBigImagesError(null);
    try {
      const res = await fetch(`${API}/admin/actions/big-images?threshold=500000`, { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) { setBigImagesError(data.error ?? "Failed to load big images."); return; }
      setBigImages(data.cards ?? []);
    } catch {
      setBigImagesError("Network error loading big images.");
    } finally {
      setBigImagesLoading(false);
    }
  }

  async function handleOptimize(id: number) {
    setOptimizing(id);
    setOptResults((prev) => ({ ...prev, [id]: { ok: false, msg: "Optimizing…" } }));
    try {
      const res = await fetch(`${API}/admin/actions/${id}/recompress-image`, {
        method: "POST",
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) {
        setOptResults((prev) => ({ ...prev, [id]: { ok: false, msg: data.error ?? "Failed" } }));
        return;
      }
      if (data.skipped) {
        setOptResults((prev) => ({ ...prev, [id]: { ok: false, msg: data.reason ?? "Skipped" } }));
        return;
      }
      const oldKb = Math.round(data.oldSize / 1024);
      const newKb = Math.round(data.newSize / 1024);
      setOptResults((prev) => ({ ...prev, [id]: { ok: true, msg: `${oldKb}KB → ${newKb}KB (-${data.savingsPct}%)` } }));
      // Update the row in place so the size badge reflects the new state.
      setBigImages((prev) => prev.map((b) => b.id === id ? { ...b, size: data.newSize, topImageUrl: data.newUrl } : b).filter((b) => b.size >= 500_000));
    } catch {
      setOptResults((prev) => ({ ...prev, [id]: { ok: false, msg: "Network error" } }));
    } finally {
      setOptimizing(null);
    }
  }

  useEffect(() => { fetchPendingCards(); }, []);
  useEffect(() => { if (mode === "users" && users.length === 0) fetchUsers(); }, [mode]);
  useEffect(() => { if (mode === "nourl" && noUrlCards.length === 0 && !noUrlLoading) fetchNoUrlCards(); }, [mode]);
  useEffect(() => { if (mode === "noimage" && noImageCards.length === 0 && !noImageLoading) fetchNoImageCards(); }, [mode]);
  // Online tab: fetch once when the tab opens. No auto-refresh — the
  // user said it's wasteful to repoll every 30s when they're just glancing
  // at it. Hitting the Refresh button in the header re-fetches on demand.
  useEffect(() => {
    if (mode !== "online") return;
    fetchOnlineUsers();
  }, [mode]);
  // Big-images tab: fetch on entry, no auto-refresh (the HEAD requests are
  // expensive — let the operator hit Refresh manually).
  useEffect(() => { if (mode === "bigimages" && bigImages.length === 0 && !bigImagesLoading) fetchBigImages(); }, [mode]);

  async function fetchBrokenImages() {
    setBrokenLoading(true);
    setBrokenError(null);
    try {
      const res = await fetch(`${API}/admin/actions/broken-images?origin=${encodeURIComponent(brokenOrigin)}`, { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) { setBrokenError(data.error ?? "Failed to scan broken images."); return; }
      setBrokenImages(data.cards ?? []);
      setBrokenScannedCount(data.scanned ?? 0);
      setBrokenInconclusive(data.inconclusive ?? 0);
      setBrokenViaCartoon(data.displaysViaCartoon ?? 0);
    } catch {
      setBrokenError("Network error scanning broken images.");
    } finally {
      setBrokenLoading(false);
    }
  }
  // Broken-images tab: fetch on entry. Slow (N HEAD requests through the
  // edge function) — manual Refresh thereafter.
  useEffect(() => { if (mode === "brokenimages" && brokenImages.length === 0 && !brokenLoading) fetchBrokenImages(); }, [mode]);

  async function fetchSameUrlCards() {
    setSameUrlLoading(true);
    setSameUrlError(null);
    try {
      const res = await fetch(`${API}/admin/actions/url-equals-authorlink`, { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) { setSameUrlError(data.error ?? "Failed to load."); return; }
      setSameUrlCards(data.cards ?? []);
    } catch {
      setSameUrlError("Network error.");
    } finally {
      setSameUrlLoading(false);
    }
  }
  useEffect(() => { if (mode === "sameurl" && sameUrlCards.length === 0 && !sameUrlLoading) fetchSameUrlCards(); }, [mode]);

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
      // Propagate to the parent so the live feed flips this card from
      // PENDING to approved without needing a full reload.
      onCardChanged?.(id, "approved");
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
      onCardChanged?.(id, "deleted");
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
      {/* Close only on a genuine backdrop click. Tracking where the mousedown
          started prevents the panel from closing when you drag a selection out
          of a text field and release on the backdrop — which used to wipe a
          half-filled "Create from URL" form. */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-start justify-end"
        onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget; }}
        onClick={(e) => { if (e.target === e.currentTarget && backdropMouseDown.current) onClose(); }}
      >
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
                  {mode === "users" ? "Manage user approvals" : mode === "newcard" ? "Build an Act from a URL with AI" : mode === "siteupdate" ? "Global 'site updating' banner" : mode === "nourl" ? "Approved cards with no action link" : mode === "noimage" ? "Approved cards with no image" : mode === "online" ? "Users active in the last 7 days" : mode === "bigimages" ? "Stored images over 500 KB — optimize to shrink" : mode === "brokenimages" ? "Cards whose topImageUrl 404s — needs re-upload" : mode === "sameurl" ? "Cards where action URL = author link — bulk-import default" : "Review submitted actions"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={mode === "users" ? fetchUsers : mode === "nourl" ? fetchNoUrlCards : mode === "noimage" ? fetchNoImageCards : mode === "online" ? fetchOnlineUsers : mode === "bigimages" ? fetchBigImages : mode === "brokenimages" ? fetchBrokenImages : mode === "sameurl" ? fetchSameUrlCards : fetchPendingCards}
                disabled={mode === "users" ? loading : mode === "nourl" ? noUrlLoading : mode === "noimage" ? noImageLoading : mode === "online" ? onlineLoading : mode === "bigimages" ? bigImagesLoading : mode === "brokenimages" ? brokenLoading : mode === "sameurl" ? sameUrlLoading : cardsLoading}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40"
              >
                <RefreshCw size={15} className={(mode === "users" ? loading : mode === "nourl" ? noUrlLoading : mode === "noimage" ? noImageLoading : mode === "online" ? onlineLoading : mode === "bigimages" ? bigImagesLoading : mode === "brokenimages" ? brokenLoading : mode === "sameurl" ? sameUrlLoading : cardsLoading) ? "animate-spin" : ""} />
              </button>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Mode switcher — dropdown */}
          <div className="px-5 py-2.5 border-b border-gray-100 shrink-0">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as PanelMode)}
              className="w-full font-['Poppins',sans-serif] text-sm font-semibold text-[#23297e] bg-[#23297e]/5 border border-[#23297e]/20 rounded-lg px-3 py-1.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#23297e]/30"
            >
              <option value="newcard">➕ Create from URL</option>
              <option value="users">Users</option>
              <option value="cards">{`Cards${!cardsLoading && pendingCardsCount > 0 ? ` (${pendingCardsCount})` : ""}`}</option>
              <option value="nourl">{`Missing URL${noUrlCards.length > 0 ? ` (${noUrlCards.length})` : ""}`}</option>
              <option value="noimage">{`Missing Image${noImageCards.length > 0 ? ` (${noImageCards.length})` : ""}`}</option>
              <option value="online">{`Online${onlineUsers.length > 0 ? ` (${onlineUsers.length})` : ""}`}</option>
              <option value="bigimages">{`Big images${bigImages.length > 0 ? ` (${bigImages.length})` : ""}`}</option>
              <option value="brokenimages">{`Broken images${brokenImages.length > 0 ? ` (${brokenImages.length})` : ""}`}</option>
              <option value="sameurl">{`URL = Author link${sameUrlCards.length > 0 ? ` (${sameUrlCards.length})` : ""}`}</option>
              <option value="matcher">Matcher</option>
              {onToggleSiteUpdating && <option value="siteupdate">{`🔧 Site-updating banner${siteUpdating ? " (ON)" : ""}`}</option>}
            </select>
          </div>

          {/* ── SITE-UPDATING BANNER mode ──────────────────────────────────────────── */}
          {mode === "siteupdate" && onToggleSiteUpdating && (
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <p className="font-['Poppins',sans-serif] text-xs text-gray-500 leading-relaxed">
                Shows a site-wide "we're updating" banner to every visitor. Use it while pushing changes so people know things may briefly look off.
              </p>
              <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3">
                <div>
                  <p className="font-['Poppins',sans-serif] text-sm font-semibold text-gray-900">Updating banner</p>
                  <p className="font-['Poppins',sans-serif] text-[11px] text-gray-500">
                    {siteUpdating ? "Currently shown to all visitors." : "Currently hidden."}
                  </p>
                </div>
                <button
                  onClick={() => onToggleSiteUpdating(!siteUpdating)}
                  className={[
                    "font-['Poppins',sans-serif] text-sm font-bold rounded-lg border px-4 py-2 transition-colors whitespace-nowrap flex items-center gap-1.5",
                    siteUpdating
                      ? "text-orange-600 border-orange-300 bg-orange-50 hover:bg-orange-100"
                      : "text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50",
                  ].join(" ")}
                >
                  <span className="text-base leading-none">🔧</span>
                  {siteUpdating ? "Turn banner OFF" : "Turn banner ON"}
                </button>
              </div>
            </div>
          )}

          {/* ── CREATE FROM URL mode ───────────────────────────────────────────────── */}
          {mode === "newcard" && (() => {
            const NC_INPUT = "w-full px-3 py-2 border border-gray-200 rounded-lg font-['Poppins',sans-serif] text-sm text-gray-800 placeholder-gray-400 placeholder:italic focus:outline-none focus:ring-2 focus:ring-[#23297e]/30 focus:border-[#23297e]";
            const NC_LABEL = "block font-['Poppins',sans-serif] text-[11px] font-semibold text-gray-500 mb-1 uppercase tracking-wider";
            const TONE_KEYS: { k: keyof NewCardForm["tone"]; label: string }[] = [
              { k: "anger", label: "Angry" }, { k: "comedy", label: "Funny" }, { k: "subversion", label: "Subversive" },
              { k: "hope", label: "Hope" }, { k: "energy", label: "Energy" },
            ];
            return (
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              <p className="font-['Poppins',sans-serif] text-xs text-gray-500 leading-relaxed">
                Paste a URL — AI drafts the card fields and a brand cartoon banner. Review and tweak everything, then publish. The card goes <span className="font-semibold">live immediately</span> and opens so you can test it.
              </p>

              {/* URL + generate draft */}
              <div>
                <label className={NC_LABEL}>Action URL</label>
                <div className="flex gap-2">
                  <input
                    value={nc.url} onChange={(e) => setNc((p) => ({ ...p, url: e.target.value }))}
                    placeholder="https://… the page for this action" className={NC_INPUT}
                  />
                  <button
                    onClick={ncGenerateDraft} disabled={ncDrafting}
                    className="shrink-0 px-3 py-2 bg-[#23297e] hover:bg-[#1a2060] disabled:opacity-60 text-white font-['Poppins',sans-serif] font-bold text-xs rounded-lg flex items-center gap-1.5"
                  >
                    {ncDrafting ? <Loader2 size={13} className="animate-spin" /> : "✨"} Draft
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 border-t border-gray-100 pt-3">
                <div>
                  <label className={NC_LABEL}>Title</label>
                  <input value={nc.title} maxLength={80} onChange={(e) => setNc((p) => ({ ...p, title: e.target.value }))} placeholder="Verb-led headline…" className={NC_INPUT} />
                </div>
                <div>
                  <label className={NC_LABEL}>Subtitle</label>
                  <input value={nc.synopsis} maxLength={100} onChange={(e) => setNc((p) => ({ ...p, synopsis: e.target.value }))} placeholder="One-line plainer subtitle…" className={NC_INPUT} />
                </div>
                <div>
                  <label className={NC_LABEL}>Description</label>
                  <textarea rows={3} value={nc.description} onChange={(e) => setNc((p) => ({ ...p, description: e.target.value }))} placeholder="What to do and why…" className={`${NC_INPUT} resize-none`} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={NC_LABEL}>Category</label>
                    <select value={nc.category} onChange={(e) => setNc((p) => ({ ...p, category: e.target.value }))} className={NC_INPUT}>
                      <option value="">— select —</option>
                      {NEWCARD_CATEGORIES.map((c) => <option key={c.label} value={c.label}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={NC_LABEL}>Location</label>
                    <select value={nc.location} onChange={(e) => setNc((p) => ({ ...p, location: e.target.value, isOnline: e.target.value === "Remote" }))} className={NC_INPUT}>
                      <option value="">— select —</option>
                      {LOCATION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={NC_LABEL}>Action link (targetUrl)</label>
                    <input value={nc.targetUrl} onChange={(e) => setNc((p) => ({ ...p, targetUrl: e.target.value }))} placeholder="https://…" className={NC_INPUT} />
                  </div>
                  <div>
                    <label className={NC_LABEL}>Event date (optional)</label>
                    <input type="date" value={nc.eventDate} onChange={(e) => setNc((p) => ({ ...p, eventDate: e.target.value }))} className={NC_INPUT} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={NC_LABEL}>Author / org</label>
                    <input value={nc.authorName} onChange={(e) => setNc((p) => ({ ...p, authorName: e.target.value }))} placeholder="e.g. Indivisible" className={NC_INPUT} />
                  </div>
                  <div>
                    <label className={NC_LABEL}>Author role</label>
                    <input value={nc.authorRole} onChange={(e) => setNc((p) => ({ ...p, authorRole: e.target.value }))} placeholder="Movement Organization" className={NC_INPUT} />
                  </div>
                </div>

                {/* Tone */}
                <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2.5">
                  <p className="font-['Poppins',sans-serif] text-[11px] font-semibold text-[#23297e] mb-2 uppercase tracking-wider">Tone</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                    {TONE_KEYS.map(({ k, label }) => (
                      <div key={k}>
                        <span className="font-['Poppins',sans-serif] text-[11px] text-gray-600">{label}</span>
                        <ToneRangeSlider value={nc.tone[k]} onChange={(v) => setNc((p) => ({ ...p, tone: { ...p.tone, [k]: v } }))} />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Cartoon */}
                <div>
                  <label className={NC_LABEL}>Cartoon banner</label>
                  <div className="flex items-center gap-2 mb-2">
                    <button
                      onClick={ncGenerateCartoon} disabled={ncImaging || !nc.title.trim()}
                      className="px-3 py-2 bg-[#ed6624] hover:bg-[#c2521b] disabled:opacity-60 text-white font-['Poppins',sans-serif] font-semibold text-xs rounded-lg flex items-center gap-1.5"
                    >
                      {ncImaging ? <Loader2 size={13} className="animate-spin" /> : <ImageIcon size={13} />}
                      {ncImaging ? "Generating…" : ncCartoon ? "Regenerate cartoon" : "Generate cartoon"}
                    </button>
                    {ncRefImage && <span className="font-['Poppins',sans-serif] text-[10px] text-gray-400">uses the page image as reference</span>}
                  </div>
                  {ncCartoon && (
                    <div className="relative h-28 rounded-xl overflow-hidden bg-gray-50 border border-gray-200">
                      <img src={ncCartoon} alt="Cartoon preview" className="w-full h-full object-cover object-[center_20%]" />
                    </div>
                  )}
                </div>
              </div>

              {ncError && <p className="font-['Poppins',sans-serif] text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{ncError}</p>}
              {ncToast && <p className="font-['Poppins',sans-serif] text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">{ncToast}</p>}

              <button
                onClick={ncCreate} disabled={ncCreating || !nc.title.trim() || !nc.description.trim() || !nc.category}
                className="w-full py-2.5 bg-[#23297e] hover:bg-[#1a2060] disabled:bg-gray-200 disabled:text-gray-400 text-white font-['Poppins',sans-serif] font-bold text-sm rounded-xl flex items-center justify-center gap-2"
              >
                {ncCreating ? <><Loader2 size={15} className="animate-spin" /> Publishing…</> : "Create & publish card"}
              </button>
            </div>
            );
          })()}

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
                                {card.highlighted && (
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
                    ? "All approved cards have an action link."
                    : `${noUrlCards.length} approved card${noUrlCards.length !== 1 ? "s" : ""} missing an action link`}
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
                    <p className="font-['Poppins',sans-serif] text-sm text-gray-400">All cards have action links!</p>
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

          {/* ── NO-IMAGE mode ───────────────────────────────────────────────────────── */}
          {mode === "noimage" && (
            <>
              <div className="px-5 py-3 border-b border-gray-100 shrink-0">
                <p className="font-['Poppins',sans-serif] text-xs text-gray-500">
                  {noImageCards.length === 0 && !noImageLoading
                    ? "All approved cards have an image."
                    : `${noImageCards.length} approved card${noImageCards.length !== 1 ? "s" : ""} missing a top image`}
                </p>
              </div>

              <div className="flex-1 overflow-y-auto">
                {noImageLoading ? (
                  <div className="flex items-center justify-center h-40">
                    <Loader2 size={24} className="animate-spin text-[#23297e]" />
                  </div>
                ) : noImageError ? (
                  <div className="p-5 text-center">
                    <p className="font-['Poppins',sans-serif] text-sm text-red-500">{noImageError}</p>
                    <button onClick={fetchNoImageCards} className="mt-3 text-xs text-[#23297e] underline font-['Poppins',sans-serif]">Retry</button>
                  </div>
                ) : noImageCards.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 gap-2">
                    <CheckCircle2 size={28} className="text-green-200" />
                    <p className="font-['Poppins',sans-serif] text-sm text-gray-400">All cards have images!</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-50">
                    {noImageCards.map((card) => (
                      <li key={card.id} className="px-5 py-4 hover:bg-gray-50/60 transition-colors">
                        <div className="flex items-start gap-2 mb-1.5">
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
                        <p className="font-['Poppins',sans-serif] text-[11px] text-gray-400 mb-1.5 line-clamp-2">
                          {card.description}
                        </p>
                        {card.targetUrl && (
                          <a
                            href={card.targetUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-['Poppins',sans-serif] text-[11px] text-[#23297e] underline decoration-dotted truncate block max-w-full"
                          >
                            {card.targetUrl}
                          </a>
                        )}
                        <p className="font-['Poppins',sans-serif] text-[10px] text-gray-300 mt-1">
                          ID {card.id} · open in edit modal to upload an image
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          {/* ── USERS mode ─────────────────────────────────────────────────────────── */}
          {mode === "users" && (
            <>
              {/* Stats — click to filter */}
              <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-4 shrink-0">
                {[
                  { label: "Total", value: users.length, color: "text-gray-700", filterKey: "all" as TabFilter },
                  { label: "Active", value: activeCount, color: "text-[#23297e]", filterKey: "active" as TabFilter },
                  { label: "Pending", value: users.filter(u => u.status === "pending").length, color: "text-amber-600", filterKey: "pending" as TabFilter },
                  { label: "Approved", value: users.filter(u => u.status === "approved").length, color: "text-green-600", filterKey: "approved" as TabFilter },
                  { label: "Rejected", value: users.filter(u => u.status === "rejected").length, color: "text-red-500", filterKey: "rejected" as TabFilter },
                ].map(({ label, value, color, filterKey }) => (
                  <button
                    key={label}
                    onClick={() => setTab(filterKey)}
                    className={`text-center rounded-lg px-2 py-1 transition-colors ${tab === filterKey ? "bg-gray-100" : "hover:bg-gray-50"}`}
                  >
                    <p className={`font-['Poppins',sans-serif] font-bold text-lg leading-tight ${color}`}>{value}</p>
                    <p className="font-['Poppins',sans-serif] text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
                  </button>
                ))}
                <button
                  onClick={syncAuthUsers}
                  disabled={syncing}
                  title="Seed KV records for any Supabase auth users who slipped through signup"
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-['Poppins',sans-serif] font-semibold rounded-lg bg-[#23297e]/10 text-[#23297e] hover:bg-[#23297e]/20 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  <RefreshCw size={11} className={syncing ? "animate-spin" : ""} />
                  Sync from Supabase
                </button>
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

                          {/* View-as (read-only impersonation) — only for approved
                              non-admin users. Click hands the userId + name back
                              to the parent App, which closes this panel and pulls
                              the user's snapshot via POST /admin/impersonate/:id. */}
                          {!user.isAdmin && user.status === "approved" && onImpersonate && (
                            <div className="flex gap-2 mt-3 ml-13">
                              <button
                                onClick={() => onImpersonate(user.userId, user.name || user.email || "user")}
                                className="flex items-center gap-1.5 py-1.5 px-3 bg-[#23297e]/5 hover:bg-[#23297e]/10 border border-[#23297e]/20 rounded-lg font-['Poppins',sans-serif] font-semibold text-xs text-[#23297e] transition-colors"
                                title="See the site as this user sees it. Read-only — you can't act on their behalf."
                              >
                                <Eye size={13} />
                                View as
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
                      ? "No one has been active in the last 7 days."
                      : `${onlineUsers.length} user${onlineUsers.length !== 1 ? "s" : ""} active in the last 7 days · tap Refresh for an update`}
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
                    <p className="font-['Poppins',sans-serif] text-sm text-gray-400">No activity in the last 7 days.</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-50">
                    {onlineUsers.map((u) => {
                      // Tier the status dot by how recent: green = truly
                      // live, amber = within the hour, gray-400 = active
                      // today, gray-200 = active this week. Four tiers
                      // keep the "online right now" signal meaningful even
                      // though the underlying window stretches to 7 days.
                      const ageMs = Date.now() - new Date(u.lastSeenAt).getTime();
                      const dot = ageMs < 5 * 60_000
                        ? { color: "bg-green-500", label: "online now" }
                        : ageMs < 60 * 60_000
                          ? { color: "bg-amber-400", label: "active recently" }
                          : ageMs < 24 * 60 * 60_000
                            ? { color: "bg-gray-400", label: "active today" }
                            : { color: "bg-gray-200", label: "active this week" };
                      const actsLabel = (u.totalActions ?? 0) === 1 ? "act" : "acts";
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
                        {/* Acts-performed chip — pulled from /admin/users
                            and joined client-side. Empty (0 acts) renders
                            as a faded "0 acts" to make it scannable that
                            the user has been around but hasn't completed
                            anything yet. */}
                        <span
                          className={`shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-['Poppins',sans-serif] text-[11px] font-semibold ${
                            (u.totalActions ?? 0) > 0
                              ? "bg-[#ed6624]/10 text-[#ed6624]"
                              : "bg-gray-50 text-gray-400"
                          }`}
                          title={`${u.totalActions ?? 0} ${actsLabel} completed`}
                        >
                          <CheckCircle2 size={11} />
                          {u.totalActions ?? 0} {actsLabel}
                        </span>
                        <p className="font-['Poppins',sans-serif] text-xs text-gray-400 shrink-0 w-20 text-right" title={u.lastSeenAt}>
                          {formatRelative(u.lastSeenAt)}
                        </p>
                      </li>
                      );
                    })}
                  </ul>
                )}

                {/* ── Anonymous activity section ─────────────────────────
                    Two layers, by design:
                      1. Aggregate banner — total card.completions vs total
                         logged-in completions. Always computable from data
                         we already have, so this loads on first paint and
                         needs no backend deploy.
                      2. Per-event list — recent anon "I did this" hits with
                         action title + timestamp. Only renders once the
                         backend tracker (anon:complete:* keys) is deployed
                         and starts collecting going-forward data.
                    ────────────────────────────────────────────────────── */}
                {anonStats && (
                  <div className="mt-6 mx-5 mb-5 border border-gray-200 rounded-lg bg-gray-50/50 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-200 bg-white">
                      <p className="font-['Poppins',sans-serif] font-bold text-sm text-gray-800 flex items-center gap-2">
                        <span aria-hidden>👤</span> Not-logged-in activity
                      </p>
                      <p className="font-['Poppins',sans-serif] text-[11px] text-gray-500 mt-0.5">
                        Anonymous visitors complete acts too — they just don't have a profile to attach the credit to.
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-px bg-gray-200">
                      <div className="px-3 py-2.5 bg-white text-center">
                        <p className="font-['Poppins',sans-serif] text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Anon completions</p>
                        <p className="font-['Poppins',sans-serif] font-bold text-[18px] text-[#ed6624] leading-tight mt-0.5">
                          {anonStats.totalAnonCompletions.toLocaleString()}
                        </p>
                      </div>
                      <div className="px-3 py-2.5 bg-white text-center">
                        <p className="font-['Poppins',sans-serif] text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Logged-in</p>
                        <p className="font-['Poppins',sans-serif] font-bold text-[18px] text-[#23297e] leading-tight mt-0.5">
                          {anonStats.totalLoggedInCompletions.toLocaleString()}
                        </p>
                      </div>
                      <div className="px-3 py-2.5 bg-white text-center">
                        <p className="font-['Poppins',sans-serif] text-[10px] uppercase tracking-wider text-gray-400 font-semibold">All-time total</p>
                        <p className="font-['Poppins',sans-serif] font-bold text-[18px] text-gray-700 leading-tight mt-0.5">
                          {anonStats.totalCardCompletions.toLocaleString()}
                        </p>
                      </div>
                    </div>
                    {anonEventsAvailable ? (
                      anonEvents.length > 0 ? (
                        <div className="border-t border-gray-200">
                          <p className="px-4 py-2 font-['Poppins',sans-serif] text-[11px] uppercase tracking-wider text-gray-400 font-semibold bg-white">
                            Recent anonymous completions (last 7 days)
                          </p>
                          <ul className="divide-y divide-gray-100 bg-white">
                            {anonEvents.slice(0, 50).map((evt, i) => (
                              <li key={`${evt.completedAt}-${evt.actionId}-${i}`} className="px-4 py-2 flex items-center gap-3">
                                <span className="w-2 h-2 rounded-full bg-gray-300 shrink-0" aria-hidden />
                                <div className="min-w-0 flex-1">
                                  <p className="font-['Poppins',sans-serif] text-[13px] text-gray-800 truncate">
                                    {evt.title ?? `Action #${evt.actionId}`}
                                  </p>
                                  {evt.category && (
                                    <p className="font-['Poppins',sans-serif] text-[10px] uppercase tracking-wider text-gray-400">
                                      {evt.category}
                                    </p>
                                  )}
                                </div>
                                <p className="font-['Poppins',sans-serif] text-[11px] text-gray-400 shrink-0" title={evt.completedAt}>
                                  {formatRelative(evt.completedAt)}
                                </p>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p className="px-4 py-3 bg-white border-t border-gray-200 font-['Poppins',sans-serif] text-[12px] text-gray-400 italic">
                          No anonymous completions logged in the last 7 days.
                        </p>
                      )
                    ) : (
                      <p className="px-4 py-3 bg-white border-t border-gray-200 font-['Poppins',sans-serif] text-[12px] text-gray-400 italic">
                        Per-event tracking ships in the next backend deploy — the totals above use the existing card counters and stay accurate either way.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── BIG IMAGES mode ────────────────────────────────────────────────────── */}
          {mode === "bigimages" && (
            <>
              <div className="px-5 py-3 border-b border-gray-100 shrink-0">
                <p className="font-['Poppins',sans-serif] text-xs text-gray-500">
                  {bigImagesLoading && bigImages.length === 0
                    ? "Scanning stored images (one HEAD request per card — takes ~10s)…"
                    : bigImages.length === 0
                      ? "No stored images over 500 KB. Nice."
                      : `${bigImages.length} stored image${bigImages.length !== 1 ? "s" : ""} over 500 KB`}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto">
                {bigImagesError ? (
                  <div className="p-5 text-center">
                    <p className="font-['Poppins',sans-serif] text-sm text-red-500">{bigImagesError}</p>
                    <button onClick={fetchBigImages} className="mt-3 text-xs text-[#23297e] underline font-['Poppins',sans-serif]">Retry</button>
                  </div>
                ) : bigImages.length === 0 && !bigImagesLoading ? (
                  <div className="flex flex-col items-center justify-center h-40 gap-2">
                    <ImageIcon size={28} className="text-gray-200" />
                    <p className="font-['Poppins',sans-serif] text-sm text-gray-400">All stored images are under 500 KB.</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-50">
                    {bigImages.map((b) => {
                      const isOpt = optimizing === b.id;
                      const result = optResults[b.id];
                      const sizeKb = Math.round(b.size / 1024);
                      return (
                        <li key={b.id} className="px-5 py-3 flex items-center gap-3">
                          <img src={b.topImageUrl} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0 bg-gray-100 border border-gray-200" loading="lazy" />
                          <div className="min-w-0 flex-1">
                            <p className="font-['Poppins',sans-serif] font-semibold text-sm text-gray-800 truncate">
                              <span className="text-gray-400 font-normal">#{b.id}</span> {b.title}
                            </p>
                            <p className="font-['Poppins',sans-serif] text-xs text-gray-400 truncate">{b.authorName}</p>
                            <p className="font-['Poppins',sans-serif] text-[11px] text-gray-500 mt-0.5">
                              <span className="font-semibold">{sizeKb.toLocaleString()} KB</span>
                              <span className="text-gray-400"> · {b.contentType}</span>
                              {result && (
                                <span className={`ml-2 ${result.ok ? "text-green-600" : "text-amber-600"}`}>{result.msg}</span>
                              )}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleOptimize(b.id)}
                            disabled={isOpt}
                            className="flex items-center gap-1.5 py-1.5 px-3 bg-[#23297e] hover:bg-[#1a2060] text-white font-['Poppins',sans-serif] font-semibold text-xs rounded-lg transition-colors disabled:opacity-50 shrink-0"
                          >
                            {isOpt ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                            {isOpt ? "Optimizing…" : "Optimize"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}

          {/* ── BROKEN IMAGES mode ─────────────────────────────────────────────────── */}
          {mode === "brokenimages" && (
            <>
              <div className="px-5 py-3 border-b border-gray-100 shrink-0 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="font-['Poppins',sans-serif] text-[11px] text-gray-500 font-semibold uppercase tracking-wide shrink-0">Frontend origin</span>
                  <input
                    type="url"
                    value={brokenOrigin}
                    onChange={(e) => setBrokenOrigin(e.target.value)}
                    placeholder="https://resistact.org"
                    className="flex-1 px-2 py-1 text-xs font-mono border border-gray-200 rounded focus:outline-none focus:border-[#23297e]"
                  />
                  <button
                    type="button"
                    onClick={fetchBrokenImages}
                    disabled={brokenLoading}
                    className="px-2.5 py-1 bg-[#23297e] hover:bg-[#1a2060] text-white font-['Poppins',sans-serif] font-semibold text-xs rounded transition-colors disabled:opacity-50"
                  >
                    {brokenLoading ? "Scanning…" : "Re-scan"}
                  </button>
                </div>
                <p className="font-['Poppins',sans-serif] text-xs text-gray-500">
                  {brokenLoading && brokenImages.length === 0
                    ? "Scanning the actually-displayed image of each card with a browser-style GET — this can take 30+ seconds…"
                    : brokenScannedCount === 0 && brokenViaCartoon === 0
                      ? "Haven't scanned yet — click Re-scan."
                      : brokenImages.length === 0
                        ? `No broken card images. All ${brokenScannedCount} cards that render a direct image URL load fine.`
                        : `${brokenImages.length} of ${brokenScannedCount} cards that render a direct image URL are genuinely broken`}
                  {brokenViaCartoon > 0 && (
                    <span className="block text-gray-400 mt-0.5">
                      {brokenViaCartoon} cards display a cartoon banner instead, so their topImageUrl isn't shown and isn't checked (a dead URL there is harmless).
                    </span>
                  )}
                  {brokenInconclusive > 0 && (
                    <span className="block text-gray-400 mt-0.5">
                      + {brokenInconclusive} couldn't be confirmed (host blocked the scan or timed out — usually fine in a real browser, not counted as broken)
                    </span>
                  )}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto">
                {brokenError ? (
                  <div className="p-5 text-center">
                    <p className="font-['Poppins',sans-serif] text-sm text-red-500">{brokenError}</p>
                    <button onClick={fetchBrokenImages} className="mt-3 text-xs text-[#23297e] underline font-['Poppins',sans-serif]">Retry</button>
                  </div>
                ) : brokenImages.length === 0 && !brokenLoading ? (
                  <div className="flex flex-col items-center justify-center h-40 gap-2">
                    <CheckCircle2 size={28} className="text-green-200" />
                    <p className="font-['Poppins',sans-serif] text-sm text-gray-400">No broken card images detected.</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-50">
                    {brokenImages.map((b) => (
                      <li key={b.id} className="px-5 py-3 flex items-start gap-3">
                        <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="font-['Poppins',sans-serif] font-semibold text-sm text-gray-800 truncate">
                            <span className="text-gray-400 font-normal">#{b.id}</span> {b.title}
                          </p>
                          <p className="font-['Poppins',sans-serif] text-xs text-gray-400 truncate">{b.authorName}</p>
                          <p className="font-['Poppins',sans-serif] text-[11px] text-gray-500 mt-0.5">
                            <span className="font-mono">{b.topImageUrl}</span>
                            <span className="ml-2 text-amber-700">
                              {b.reason === "not-found"    ? `HTTP ${b.status} · dead link`
                               : b.reason === "expiring-cdn" ? `HTTP ${b.status} · expiring TikTok/Instagram link`
                               : b.reason === "non-image"    ? `HTTP ${b.status} · not an image`
                               : b.reason === "network"      ? `network error: ${(b.error ?? "").slice(0, 50)}`
                               : b.error                     ? `network error: ${b.error.slice(0, 50)}`
                               : `HTTP ${b.status}`}
                            </span>
                            {b.adminApproved === false && (
                              <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-semibold uppercase tracking-wide">Pending</span>
                            )}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          {/* ── URL = AUTHOR LINK mode ─────────────────────────────────────────────── */}
          {mode === "sameurl" && (
            <>
              <div className="px-5 py-3 border-b border-gray-100 shrink-0">
                <p className="font-['Poppins',sans-serif] text-xs text-gray-500">
                  {sameUrlLoading && sameUrlCards.length === 0
                    ? "Scanning…"
                    : sameUrlCards.length === 0
                      ? "No cards have action URL == author link."
                      : `${sameUrlCards.length} card${sameUrlCards.length !== 1 ? "s" : ""} where action URL matches author link`}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto">
                {sameUrlError ? (
                  <div className="p-5 text-center">
                    <p className="font-['Poppins',sans-serif] text-sm text-red-500">{sameUrlError}</p>
                    <button onClick={fetchSameUrlCards} className="mt-3 text-xs text-[#23297e] underline font-['Poppins',sans-serif]">Retry</button>
                  </div>
                ) : sameUrlCards.length === 0 && !sameUrlLoading ? (
                  <div className="flex flex-col items-center justify-center h-40 gap-2">
                    <Link2 size={28} className="text-gray-200" />
                    <p className="font-['Poppins',sans-serif] text-sm text-gray-400">All cards have distinct action / author links.</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-50">
                    {sameUrlCards.map((b) => (
                      <li key={b.id} className="px-5 py-3 flex items-start gap-3">
                        <Link2 size={16} className="text-[#23297e] shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="font-['Poppins',sans-serif] font-semibold text-sm text-gray-800 truncate">
                            <span className="text-gray-400 font-normal">#{b.id}</span> {b.title}
                          </p>
                          <p className="font-['Poppins',sans-serif] text-xs text-gray-400 truncate">{b.authorName}</p>
                          <p className="font-['Poppins',sans-serif] text-[11px] text-gray-500 mt-0.5 truncate">
                            <a href={b.targetUrl} target="_blank" rel="noopener noreferrer" className="font-mono underline decoration-dotted hover:text-[#23297e]">{b.targetUrl}</a>
                            {b.adminApproved === false && (
                              <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-semibold uppercase tracking-wide">Pending</span>
                            )}
                          </p>
                        </div>
                      </li>
                    ))}
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
          onApproved={(approved) => {
            // Approved cards leave the pending queue entirely.
            setPendingCards((prev) => prev.filter((c) => c.id !== approved.id));
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
                  · <span className="font-medium text-[#ed6624]">{stop.label}</span> — {stop.desc}
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
          className="ml-auto flex items-center gap-1.5 px-4 py-2 text-xs font-['Poppins',sans-serif] font-bold text-white bg-[#ed6624] hover:bg-[#e07a28] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed rounded-lg transition-colors"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
      </div>
    </>
  );
}
