import { useEffect, useRef, useState } from "react";
import {
  X, Upload, Loader2, Share2, Copy, Check, Download,
  ExternalLink, Plus, Tag, Flame, Trash2,
} from "lucide-react";
import { projectId } from "/utils/supabase/info";
import type { UserApproval } from "../lib/supabase";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04`;

// Static smack images from public/smacks/ — always shown regardless of API state.
// Add entries here whenever you drop a new image into public/smacks/.
export const STATIC_SMACKS: ReceiptCard[] = [
  {
    id: 5001,
    title: "Impeach Trump Again",
    tags: ["Trump", "MAGA", "Fascism"],
    imageUrl: "/Smacks/impeach.png",
    caption: "He was impeached twice and should have been removed. Twice wasn't enough — the country deserves accountability. Share this. #ImpeachTrump #ResistAct",
    adminApproved: true,
  },
  {
    id: 5002,
    title: "Rock the Vote",
    tags: ["Voting Rights"],
    imageUrl: "/Smacks/rock-the-vote.webp",
    caption: "Your vote is your most powerful tool. Use it. Share it. Protect it. #RockTheVote #ResistAct",
    adminApproved: true,
  },
  {
    id: 5003,
    title: "JD Vance",
    tags: ["Trump", "MAGA"],
    imageUrl: "/Smacks/vance.png",
    adminApproved: true,
  },
  {
    id: 5004,
    title: "Presidents",
    tags: ["Trump", "MAGA"],
    imageUrl: "/Smacks/presidents.png",
    adminApproved: true,
  },
  {
    id: 5006,
    title: "Trump Human Body",
    tags: ["Trump", "MAGA"],
    imageUrl: "/Smacks/trumphumanbody.png",
    adminApproved: true,
  },
  {
    id: 5007,
    title: "Dem States",
    tags: ["Trump", "MAGA"],
    imageUrl: "/Smacks/demstates.png",
    adminApproved: true,
  },
  {
    id: 5008,
    title: "No Conviction",
    tags: ["Trump", "MAGA"],
    imageUrl: "/Smacks/noconviction.png",
    adminApproved: true,
  },
  {
    id: 5009,
    title: "Hillary Obama",
    tags: ["Trump", "MAGA"],
    imageUrl: "/Smacks/hillaryobama.png",
    adminApproved: true,
  },
  {
    id: 5010,
    title: "Clarence Thomas",
    tags: ["Trump", "MAGA", "Fascism"],
    imageUrl: "/Smacks/thomas.png",
    adminApproved: true,
  },
  {
    id: 5011,
    title: "2024 Votes",
    tags: ["Trump", "MAGA"],
    imageUrl: "/Smacks/2024votes.jpg",
    adminApproved: true,
  },
  {
    id: 5012,
    title: "Land",
    tags: ["Trump", "MAGA"],
    imageUrl: "/Smacks/land.png",
    adminApproved: true,
  },
  {
    id: 5013,
    title: "Richer",
    tags: ["Trump", "MAGA"],
    imageUrl: "/Smacks/richer.png",
    adminApproved: true,
  },
  {
    id: 5014,
    title: "Wealth",
    tags: ["Trump", "MAGA"],
    imageUrl: "/Smacks/wealth.png",
    adminApproved: true,
  },
  {
    id: 5015,
    title: "Redistricting",
    tags: ["Trump", "MAGA"],
    imageUrl: "/Smacks/redistricting.png",
    adminApproved: true,
  },
  {
    id: 5016,
    title: "Timeline",
    tags: ["Trump", "MAGA"],
    imageUrl: "/Smacks/timeline.png",
    adminApproved: true,
  },
  {
    id: 5017,
    title: "Billionaires",
    tags: ["Trump", "MAGA"],
    imageUrl: "/Smacks/billionaires.png",
    adminApproved: true,
  },
  {
    id: 5018,
    title: "Corruption",
    tags: ["Trump", "MAGA"],
    imageUrl: "/Smacks/corruption.png",
    adminApproved: true,
  },
  {
    id: 5019,
    title: "8647",
    tags: ["Trump", "MAGA"],
    imageUrl: "/Smacks/8647.png",
    adminApproved: true,
  },
  {
    id: 5020,
    title: "Iran",
    tags: ["Trump", "MAGA"],
    imageUrl: "/Smacks/iran.png",
    adminApproved: true,
  },
  {
    id: 5021,
    title: "ResistAct",
    tags: ["ResistAct"],
    imageUrl: "/Smacks/ResistAct.png",
    adminApproved: true,
  },
  {
    id: 5022,
    title: "Epstein",
    tags: ["Trump", "MAGA", "Corruption"],
    imageUrl: "/Smacks/epstein.png",
    adminApproved: true,
  },
  {
    id: 5023,
    title: "Project 2025",
    tags: ["Trump", "MAGA", "Fascism"],
    imageUrl: "/Smacks/project2025.png",
    adminApproved: true,
  },
  {
    id: 5024,
    title: "Voting Rights",
    tags: ["Voting Rights"],
    imageUrl: "/Smacks/votingrights.png",
    adminApproved: true,
  },
  {
    id: 5025,
    title: "Epstein Redactions",
    tags: ["Trump", "MAGA", "Corruption"],
    imageUrl: "/Smacks/epsteinredactions.png",
    adminApproved: true,
  },
];

export interface ReceiptCard {
  id: number;
  title: string;
  tags: string[];
  imageUrl: string;
  sourceUrl?: string;
  sourceLabel?: string;
  /** Pre-written tweet / caption ready to copy and post. */
  caption?: string;
  adminApproved: boolean;
  boosts?: number;
  createdAt?: string;
}

// Well-known tag taxonomy — drives the filter chips.
const ALL_TAGS = [
  "Economy", "Deficit & Debt", "Taxes", "Immigration",
  "Voting Rights", "Healthcare", "Fox News", "Environment",
  "Trump", "MAGA", "Fascism", "Hypocrisy",
  "Social Security", "Education", "Gun Violence",
  "Women's Rights", "LGBTQ+", "Labor",
];

interface SmacksPageProps {
  receipts: ReceiptCard[];
  searchQuery?: string;
  accessToken: string | null;
  approval: UserApproval | null;
  onReceiptAdded?: (r: ReceiptCard) => void;
  onReceiptApproved?: (id: number) => void;
  pendingFilterVersion?: number;
}

export function SmacksPage({ receipts: apiReceipts, searchQuery = "", accessToken, approval, onReceiptAdded, onReceiptApproved, pendingFilterVersion }: SmacksPageProps) {
  const isAdmin = approval?.isAdmin === true;
  const canSubmit = !!accessToken && (approval?.status === "approved");

  // Merge static smacks with API receipts; API version wins on duplicate ID.
  const apiIds = new Set(apiReceipts.map((r) => r.id));
  const receipts = [...apiReceipts, ...STATIC_SMACKS.filter((r) => !apiIds.has(r.id))];

  // ── Tag filter ──────────────────────────────────────────────────────────────
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const toggleTag = (t: string) =>
    setActiveTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  // ── Share modal ─────────────────────────────────────────────────────────────
  const [shareReceipt, setShareReceipt] = useState<ReceiptCard | null>(null);
  const [copied, setCopied] = useState(false);
  const [captionDraft, setCaptionDraft] = useState("");

  function openShare(r: ReceiptCard) {
    setShareReceipt(r);
    setCaptionDraft(r.caption ?? "");
    setCopied(false);
  }
  function closeShare() { setShareReceipt(null); setLightboxOpen(false); }

  const [copyImageState, setCopyImageState] = useState<"idle" | "copying" | "done">("idle");
  const [fbInstruction, setFbInstruction] = useState<"idle" | "copied" | "downloaded">("idle");
  const [lightboxOpen, setLightboxOpen] = useState(false);

  async function handleCopyCaption() {
    try {
      await navigator.clipboard.writeText(captionDraft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  async function fetchImageBlob(url: string) {
    const res = await fetch(url);
    return res.blob();
  }

  async function handleNativeShare() {
    if (!shareReceipt) return;
    try {
      const blob = await fetchImageBlob(shareReceipt.imageUrl);
      const ext = blob.type.split("/")[1] || "jpg";
      const file = new File(
        [blob],
        `${shareReceipt.title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.${ext}`,
        { type: blob.type }
      );
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: captionDraft });
        return;
      }
    } catch { /* fall through */ }
    // Fallback: share URL
    const data: ShareData = {
      title: shareReceipt.title,
      text: captionDraft,
      url: shareReceipt.sourceUrl ?? "https://resistact.org",
    };
    if (navigator.canShare?.(data)) navigator.share(data).catch(() => {});
  }

  async function handleCopyImage() {
    if (!shareReceipt) return;
    setCopyImageState("copying");
    try {
      const blob = await fetchImageBlob(shareReceipt.imageUrl);
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      setCopyImageState("done");
      setTimeout(() => setCopyImageState("idle"), 2000);
    } catch {
      // Fallback: copy URL
      await navigator.clipboard.writeText(shareReceipt.imageUrl).catch(() => {});
      setCopyImageState("done");
      setTimeout(() => setCopyImageState("idle"), 2000);
    }
  }

  function twitterUrl(r: ReceiptCard) {
    const text = encodeURIComponent((r.caption ?? r.title) + "\n\nresistact.org");
    return `https://twitter.com/intent/tweet?text=${text}`;
  }

  async function handleFacebookShare(r: ReceiptCard) {
    // Open Facebook synchronously before any await (popup blocker rule).
    window.open("https://www.facebook.com/", "_blank");
    // Copy image to clipboard so the user can paste directly into a FB post.
    try {
      const blob = await fetchImageBlob(r.imageUrl);
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      setFbInstruction("copied");
    } catch {
      // Clipboard not available — fall back to downloading the file.
      await handleDownload(r);
      setFbInstruction("downloaded");
    }
    setTimeout(() => setFbInstruction("idle"), 6000);
  }

  async function handleInstagramShare(r: ReceiptCard) {
    // Same pattern — open the app first, then trigger the download.
    window.open("https://www.instagram.com/", "_blank");
    await handleDownload(r);
  }

  function threadsUrl(r: ReceiptCard) {
    const text = encodeURIComponent((r.caption ?? r.title) + "\n\nresistact.org");
    return `https://www.threads.net/intent/post?text=${text}`;
  }

  function blueskyUrl(r: ReceiptCard) {
    const text = encodeURIComponent((r.caption ?? r.title) + "\n\nresistact.org");
    return `https://bsky.app/intent/compose?text=${text}`;
  }

  function pinterestUrl(r: ReceiptCard) {
    const media = encodeURIComponent(window.location.origin + r.imageUrl);
    const desc = encodeURIComponent(r.caption ?? r.title);
    return `https://pinterest.com/pin/create/button/?media=${media}&description=${desc}`;
  }

  function redditUrl(r: ReceiptCard) {
    const title = encodeURIComponent(r.title);
    const url = encodeURIComponent(window.location.origin + r.imageUrl);
    return `https://www.reddit.com/submit?url=${url}&title=${title}`;
  }

  function tumblrUrl(r: ReceiptCard) {
    const source = encodeURIComponent(window.location.origin + r.imageUrl);
    const caption = encodeURIComponent(r.caption ?? r.title);
    return `https://www.tumblr.com/widgets/share/tool?posttype=photo&content=${source}&caption=${caption}`;
  }

  async function handleDownload(r: ReceiptCard) {
    try {
      const res = await fetch(r.imageUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${r.title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.jpg`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(r.imageUrl, "_blank");
    }
  }

  // ── Admin: delete ───────────────────────────────────────────────────────────
  // Static smacks (id ≥ 5000) can't be server-deleted, so we hide them locally.
  const [deletedIds, setDeletedIds] = useState<Set<number>>(() => {
    try {
      const s = localStorage.getItem("resistact_smacks_deleted");
      return s ? new Set<number>(JSON.parse(s)) : new Set<number>();
    } catch { return new Set<number>(); }
  });

  async function handleDelete(id: number) {
    const isStatic = id >= 5000;
    if (!isStatic && accessToken) {
      try {
        await fetch(`${API}/admin/receipts/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch { /* ignore */ }
    }
    setDeletedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem("resistact_smacks_deleted", JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  // ── Admin: approve ──────────────────────────────────────────────────────────
  async function handleApprove(id: number) {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API}/admin/approve-receipt/${id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) onReceiptApproved?.(id);
    } catch { /* ignore */ }
  }

  // ── Admin: add receipt modal ─────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);

  // ── Boosts ──────────────────────────────────────────────────────────────────
  const [boostedReceipts, setBoostedReceipts] = useState<Set<number>>(() => {
    try {
      const s = localStorage.getItem("resistact_receipt_boosted");
      return s ? new Set<number>(JSON.parse(s)) : new Set<number>();
    } catch { return new Set<number>(); }
  });
  // Local deltas for this session (applied on top of server-fetched r.boosts)
  const [boostDeltas, setBoostDeltas] = useState<Record<number, number>>({});

  function boostCountFor(r: ReceiptCard) {
    return Math.max(0, (r.boosts ?? 0) + (boostDeltas[r.id] ?? 0));
  }

  function handleReceiptBoost(id: number) {
    const alreadyBoosted = boostedReceipts.has(id);
    const delta = alreadyBoosted ? -1 : 1;
    setBoostedReceipts((prev) => {
      const next = new Set(prev);
      alreadyBoosted ? next.delete(id) : next.add(id);
      try { localStorage.setItem("resistact_receipt_boosted", JSON.stringify([...next])); } catch {}
      return next;
    });
    setBoostDeltas((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + delta }));
    // Fire-and-forget to server — no auth required
    fetch(`${API}/receipts/${id}/boost`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delta }),
    }).catch(() => {});
  }

  // ── Sort ────────────────────────────────────────────────────────────────────
  const [sortBy, setSortBy] = useState<"top" | "new" | "pending">("top");
  useEffect(() => {
    if (pendingFilterVersion && pendingFilterVersion > 0) setSortBy("pending");
  }, [pendingFilterVersion]);

  // ── Local search ─────────────────────────────────────────────────────────────
  // Search now lives in the top navbar only; the lower search bar was removed
  // so this page can lead with an intro paragraph instead of a duplicate input.

  // ── Filter + sort ────────────────────────────────────────────────────────────
  const q = searchQuery.toLowerCase().trim();
  const filtered = receipts
    .filter((r) => {
      if (deletedIds.has(r.id)) return false;
      if (sortBy === "pending") return isAdmin && !r.adminApproved;
      if (!isAdmin && !r.adminApproved) return false;
      if (q) {
        return (
          r.title.toLowerCase().includes(q) ||
          r.tags.some((t) => t.toLowerCase().includes(q)) ||
          r.caption?.toLowerCase().includes(q)
        );
      }
      if (activeTags.length === 0) return true;
      return activeTags.some((t) => r.tags.map((x) => x.toLowerCase()).includes(t.toLowerCase()));
    })
    .sort((a, b) =>
      sortBy === "top"
        ? boostCountFor(b) - boostCountFor(a)
        : (b.createdAt ?? "").localeCompare(a.createdAt ?? "")
    );

  // Collect distinct tags from loaded receipts for the filter bar.
  const availableTags = Array.from(
    new Set(receipts.flatMap((r) => r.tags))
  ).sort();

  return (
    <div className="min-h-screen">
      {/* ── Intro: what is a Smack? ── */}
      <div className="mb-5 rounded-2xl border border-[#23297e]/15 bg-gradient-to-br from-[#fd8e33]/5 via-white to-[#23297e]/5 px-4 py-3.5 sm:px-5 sm:py-4">
        <p className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-sm sm:text-base mb-1.5 flex items-center gap-1.5">
          <span aria-hidden="true">💥</span> What's a Smack?
        </p>
        <p className="font-['Poppins',sans-serif] text-xs sm:text-sm text-gray-700 leading-snug">
          The president is a cartoon villain. So is the Supreme Court. So is half of Congress. You don't fight a cartoon with a footnoted essay — you fight it with a meme that lands in two seconds. <strong className="text-[#23297e]">Smacks</strong> are shareable images that meet their grift, corruption, and stupidity with the simplicity those deserve. <span className="text-[#fd8e33] font-semibold">Save it. Post it. Move on.</span>
        </p>
      </div>

      {/* ── Top bar: sort toggle + filter chips ── */}
      <div className="flex items-start gap-3 flex-wrap mb-6">
        {/* Sort toggle */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-gray-100 shrink-0 self-start">
          <button
            onClick={() => setSortBy("top")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-['Poppins',sans-serif] font-bold text-xs transition-all ${
              sortBy === "top"
                ? "bg-white text-[#fd8e33] shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <Flame size={12} />
            Top
          </button>
          <button
            onClick={() => setSortBy("new")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-['Poppins',sans-serif] font-bold text-xs transition-all ${
              sortBy === "new"
                ? "bg-white text-[#23297e] shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            New
          </button>
          {isAdmin && (
            <button
              onClick={() => setSortBy("pending")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-['Poppins',sans-serif] font-bold text-xs transition-all ${
                sortBy === "pending"
                  ? "bg-white text-red-500 shadow-sm"
                  : "text-gray-500 hover:text-red-500"
              }`}
            >
              Pending
            </button>
          )}
        </div>

        {/* Tag chips */}
        <div className="flex items-center gap-2 flex-wrap flex-1">
          {availableTags.map((tag) => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-['Poppins',sans-serif] font-semibold transition-all border ${
                activeTags.includes(tag)
                  ? "bg-[#23297e] text-white border-[#23297e]"
                  : "bg-white text-gray-600 border-gray-200 hover:border-[#23297e] hover:text-[#23297e]"
              }`}
            >
              <Tag size={10} />
              {tag}
            </button>
          ))}
          {activeTags.length > 0 && (
            <button
              onClick={() => setActiveTags([])}
              className="px-3 py-1.5 rounded-full text-xs font-['Poppins',sans-serif] text-gray-500 hover:text-gray-700 border border-dashed border-gray-300 hover:border-gray-400 transition-all"
            >
              Clear
            </button>
          )}
        </div>

        {/* Any approved user can submit */}
        {canSubmit && (
          <button
            onClick={() => setAddOpen(true)}
            className="shrink-0 flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#fd8e33] hover:bg-[#d96612] text-white font-['Poppins',sans-serif] font-bold text-xs transition-colors self-start"
          >
            <Plus size={13} />
            {isAdmin ? "Add to The Smacks" : "Submit to The Smacks"}
          </button>
        )}
      </div>

      {/* ── Empty state ── */}
      {filtered.length === 0 && (
        <div className="text-center py-24">
          <p className="font-['Poppins',sans-serif] text-gray-400 text-lg mb-2">
            {receipts.length === 0 ? "Nothing in The Smacks yet." : "No results match that filter."}
          </p>
          {activeTags.length > 0 && (
            <button
              onClick={() => setActiveTags([])}
              className="font-['Poppins',sans-serif] text-sm text-[#23297e] hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* ── Card grid ── */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {filtered.map((r) => (
          <ReceiptTile
            key={r.id}
            receipt={r}
            isAdmin={isAdmin}
            boostCount={boostCountFor(r)}
            isBoosted={boostedReceipts.has(r.id)}
            onShare={() => openShare(r)}
            onBoost={() => handleReceiptBoost(r.id)}
            onApprove={() => handleApprove(r.id)}
            onDelete={() => handleDelete(r.id)}
          />
        ))}
      </div>

      {/* ── Share modal ── */}
      {shareReceipt && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={closeShare}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-3 shrink-0">
              <Share2 size={18} className="text-[#23297e] shrink-0" />
              <h2 className="flex-1 font-['Poppins',sans-serif] font-bold text-[#23297e] text-base leading-tight truncate">
                {shareReceipt.title}
              </h2>
              <button
                onClick={closeShare}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 shrink-0"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-4">
              {/* Image — click to expand to lightbox */}
              <button
                type="button"
                onClick={() => setLightboxOpen(true)}
                className="group relative block w-full rounded-2xl overflow-hidden bg-gray-50 border border-gray-100 cursor-zoom-in"
              >
                <img
                  src={shareReceipt.imageUrl}
                  alt={shareReceipt.title}
                  className="w-full h-auto object-contain max-h-[38vh]"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity px-2.5 py-1 rounded-lg bg-black/60 text-white font-['Poppins',sans-serif] text-xs font-semibold">
                    View full size
                  </span>
                </div>
              </button>

              {/* Tags */}
              {shareReceipt.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {shareReceipt.tags.map((t) => (
                    <span
                      key={t}
                      className="px-2.5 py-0.5 rounded-full bg-[#23297e]/10 text-[#23297e] font-['Poppins',sans-serif] text-[11px] font-semibold"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}

              {/* Share buttons — shown immediately on open */}
              <div className="grid grid-cols-4 gap-2">
                {/* Native share with image file — mobile gets full share sheet */}
                {typeof navigator !== "undefined" && "share" in navigator && (
                  <button
                    onClick={handleNativeShare}
                    className="col-span-4 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#23297e] hover:bg-[#1a2060] text-white font-['Poppins',sans-serif] font-bold text-sm transition-colors"
                  >
                    <Share2 size={15} />
                    Share image via…
                  </button>
                )}

                {/* Copy image to clipboard — paste directly into any platform */}
                <button
                  onClick={handleCopyImage}
                  className="col-span-4 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#fd8e33] hover:bg-[#d96612] text-white font-['Poppins',sans-serif] font-bold text-sm transition-colors"
                >
                  {copyImageState === "done" ? <Check size={15} className="text-white" /> : <Copy size={15} />}
                  {copyImageState === "copying" ? "Copying…" : copyImageState === "done" ? "Image copied! Paste anywhere." : "Copy image to clipboard"}
                </button>

                {/* Facebook paste instruction — appears after clicking Facebook */}
                {fbInstruction !== "idle" && (
                  <div className="col-span-4 flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 text-[11px] text-blue-800 font-['Poppins',sans-serif] leading-snug">
                    <span className="text-base leading-none mt-0.5">📘</span>
                    <span>
                      {fbInstruction === "copied"
                        ? <><strong>Image copied!</strong> In your Facebook post, click "Photo/Video" then paste with <strong>⌘V</strong> (Mac) or <strong>Ctrl+V</strong> (PC).</>
                        : <><strong>Image downloaded!</strong> In your Facebook post, click "Photo/Video" and upload it from your Downloads folder.</>}
                    </span>
                  </div>
                )}

                {/* Facebook — spot 1 */}
                <button
                  onClick={() => handleFacebookShare(shareReceipt)}
                  className="flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl bg-[#1877f2] hover:bg-[#1464cc] text-white font-['Poppins',sans-serif] font-bold text-[10px] transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
                  Facebook
                </button>

                {/* Threads — spot 2 */}
                <a
                  href={threadsUrl(shareReceipt)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl bg-black hover:bg-gray-900 text-white font-['Poppins',sans-serif] font-bold text-[10px] transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.397-.893h-.089c-.83 0-1.955.226-2.657 1.29l-1.736-1.194c.897-1.378 2.426-2.132 4.413-2.13h.11c3.53.033 5.552 2.075 5.807 5.786.137.064.272.132.404.204 1.323.744 2.278 1.799 2.768 3.056.743 1.981.735 5.203-1.951 7.812-1.692 1.66-3.704 2.518-6.435 2.519z"/></svg>
                  Threads
                </a>

                {/* Bluesky — spot 3 */}
                <a
                  href={blueskyUrl(shareReceipt)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl bg-[#0085ff] hover:bg-[#006fdb] text-white font-['Poppins',sans-serif] font-bold text-[10px] transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z"/></svg>
                  Bluesky
                </a>

                {/* Instagram — spot 4 */}
                <button
                  onClick={() => handleInstagramShare(shareReceipt)}
                  className="flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl bg-[#e1306c] hover:bg-[#c0275d] text-white font-['Poppins',sans-serif] font-bold text-[10px] transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                  Instagram
                </button>

                {/* Pinterest — spot 5 */}
                <a
                  href={pinterestUrl(shareReceipt)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl bg-[#e60023] hover:bg-[#c0001d] text-white font-['Poppins',sans-serif] font-bold text-[10px] transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>
                  Pinterest
                </a>

                {/* Reddit — spot 6 */}
                <a
                  href={redditUrl(shareReceipt)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl bg-[#ff4500] hover:bg-[#d93a00] text-white font-['Poppins',sans-serif] font-bold text-[10px] transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>
                  Reddit
                </a>

                {/* Tumblr — spot 7 */}
                <a
                  href={tumblrUrl(shareReceipt)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl bg-[#35465c] hover:bg-[#2a3a4f] text-white font-['Poppins',sans-serif] font-bold text-[10px] transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M14.563 24c-5.093 0-7.031-3.756-7.031-6.411V9.747H5.116V6.648c3.63-1.313 4.512-4.596 4.71-6.469C9.84.051 9.941 0 9.999 0h3.517v6.114h4.801v3.633h-4.82v7.47c.016 1.001.375 2.371 2.228 2.371h.032c.401-.013 1.143-.142 1.502-.355l1.449 3.396c-.524.252-1.532.557-2.936.61H14.563z"/></svg>
                  Tumblr
                </a>

                {/* Post to X — spot 8 */}
                <a
                  href={twitterUrl(shareReceipt)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl bg-black hover:bg-gray-900 text-white font-['Poppins',sans-serif] font-bold text-[10px] transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.836L1.254 2.25H8.08l4.258 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                  Post to X
                </a>

                {/* Download */}
                <button
                  onClick={() => handleDownload(shareReceipt)}
                  className="col-span-4 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-['Poppins',sans-serif] font-bold text-sm transition-colors"
                >
                  <Download size={14} />
                  Download image
                </button>
              </div>

              <p className="font-['Poppins',sans-serif] text-[11px] text-gray-400 text-center leading-relaxed">
                📱 On mobile, "Share image via…" sends the image directly to Instagram, WhatsApp, and more.<br/>
                📘 Facebook copies the image to your clipboard — paste it into a new post. Instagram downloads it — upload from your camera roll.
              </p>

              {/* Caption — below the fold, for users who want to customise text */}
              <div className="border-t border-gray-100 pt-4">
                <label className="block font-['Poppins',sans-serif] text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                  Ready-to-post caption (edit before sharing)
                </label>
                <textarea
                  rows={3}
                  value={captionDraft}
                  onChange={(e) => setCaptionDraft(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl font-['Poppins',sans-serif] text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-[#fd8e33]/30 focus:border-[#fd8e33]"
                />
                <div className="flex items-center justify-between mt-1">
                  <span className={`font-['Poppins',sans-serif] text-[11px] ${captionDraft.length > 280 ? "text-red-500" : "text-gray-400"}`}>
                    {captionDraft.length}/280 chars for X/Twitter
                  </span>
                  <button
                    onClick={handleCopyCaption}
                    className="flex items-center gap-1 text-[11px] font-['Poppins',sans-serif] font-semibold text-[#23297e] hover:text-[#fd8e33] transition-colors"
                  >
                    {copied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
                    {copied ? "Copied!" : "Copy text"}
                  </button>
                </div>
              </div>

              {/* Source */}
              {(shareReceipt.sourceUrl || shareReceipt.sourceLabel) && (
                <a
                  href={shareReceipt.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 font-['Poppins',sans-serif] text-xs text-gray-500 hover:text-[#23297e] transition-colors"
                >
                  <ExternalLink size={11} />
                  Source: {shareReceipt.sourceLabel ?? shareReceipt.sourceUrl}
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Lightbox ── */}
      {lightboxOpen && shareReceipt && (
        <div
          className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setLightboxOpen(false)}
        >
          <img
            src={shareReceipt.imageUrl}
            alt={shareReceipt.title}
            className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
          />
          <button
            onClick={() => setLightboxOpen(false)}
            className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* ── Admin: Add Receipt modal ── */}
      {addOpen && (
        <AddReceiptModal
          accessToken={accessToken}
          isAdmin={isAdmin}
          allTags={ALL_TAGS}
          onClose={() => setAddOpen(false)}
          onAdded={(r) => { onReceiptAdded?.(r); setAddOpen(false); }}
        />
      )}
    </div>
  );
}

// ─── Receipt tile ──────────────────────────────────────────────────────────────
function ReceiptTile({
  receipt, isAdmin, boostCount, isBoosted, onShare, onBoost, onApprove, onDelete,
}: {
  receipt: ReceiptCard;
  isAdmin: boolean;
  boostCount: number;
  isBoosted: boolean;
  onShare: () => void;
  onBoost: () => void;
  onApprove: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`rounded-2xl overflow-hidden shadow-md hover:shadow-lg transition-all bg-white flex flex-col ${!receipt.adminApproved && isAdmin ? "ring-2 ring-red-400" : ""}`}
    >
      {/* Pending banner */}
      {!receipt.adminApproved && isAdmin && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-red-50 border-b border-red-200 shrink-0">
          <span className="font-['Poppins',sans-serif] font-bold text-[11px] uppercase tracking-wider text-red-600">
            ⚠ Pending
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onApprove}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-600 hover:bg-green-700 text-white font-['Poppins',sans-serif] font-bold text-[10px] uppercase tracking-wide transition-colors"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-600 hover:bg-red-700 text-white font-['Poppins',sans-serif] font-bold text-[10px] uppercase tracking-wide transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Thumbnail — click to open share modal */}
      <button
        type="button"
        onClick={onShare}
        className="relative block w-full h-[200px] overflow-hidden bg-gray-100 group shrink-0 text-left"
      >
        <img
          src={receipt.imageUrl}
          alt={receipt.title}
          className="w-full h-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]"
          loading="lazy"
        />
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/90 font-['Poppins',sans-serif] font-bold text-xs text-[#23297e]">
            <Share2 size={12} />
            Share this
          </span>
        </div>
        {/* Admin delete */}
        {receipt.adminApproved && isAdmin && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="absolute top-2 left-2 w-7 h-7 flex items-center justify-center rounded-full bg-white/90 text-gray-400 hover:text-red-600 hover:bg-white shadow-sm transition-colors"
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        )}
      </button>

      {/* Card body */}
      <div className="px-4 pt-3 pb-4 flex flex-col flex-1">
        {/* Tags */}
        {receipt.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {receipt.tags.map((t) => (
              <span
                key={t}
                className="px-2 py-0.5 rounded-full bg-[#23297e]/10 text-[#23297e] font-['Poppins',sans-serif] text-[10px] font-semibold"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        {/* Title */}
        <p className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-sm leading-snug mb-3 flex-1">
          {receipt.title}
        </p>

        {/* Footer: boost + share */}
        <div className="flex items-center justify-between gap-2 mt-auto">
          <button
            type="button"
            onClick={onBoost}
            title={isBoosted ? "Remove boost" : "Boost"}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full font-['Poppins',sans-serif] font-bold text-xs transition-all ${
              isBoosted
                ? "bg-[#fd8e33] text-white"
                : "bg-gray-100 text-gray-500 hover:text-[#fd8e33] hover:bg-orange-50"
            }`}
          >
            <Flame size={12} className={isBoosted ? "fill-white" : ""} />
            {boostCount > 0 ? boostCount : "Boost"}
          </button>

          <button
            type="button"
            onClick={onShare}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#23297e] hover:bg-[#1a2060] text-white font-['Poppins',sans-serif] font-bold text-xs transition-colors"
          >
            <Share2 size={12} />
            Share
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Admin: Add Receipt modal ──────────────────────────────────────────────────
function AddReceiptModal({
  accessToken, isAdmin, allTags, onClose, onAdded,
}: {
  accessToken: string | null;
  isAdmin: boolean;
  allTags: string[];
  onClose: () => void;
  onAdded: (r: ReceiptCard) => void;
}) {
  const [title,       setTitle]       = useState("");
  const [imageUrl,    setImageUrl]    = useState("");
  const [caption,     setCaption]     = useState("");
  const [sourceUrl,   setSourceUrl]   = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customTag,   setCustomTag]   = useState("");
  const [uploading,   setUploading]   = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setUploadError("Image files only."); return; }
    if (file.size > 10 * 1024 * 1024) { setUploadError("Max 10 MB."); return; }
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
      if (!res.ok) { setUploadError(data.error ?? "Upload failed."); return; }
      setImageUrl(data.url);
    } catch { setUploadError("Network error during upload."); }
    finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function toggleTag(t: string) {
    setSelectedTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
  }

  function addCustomTag() {
    const t = customTag.trim();
    if (t && !selectedTags.includes(t)) setSelectedTags((prev) => [...prev, t]);
    setCustomTag("");
  }

  async function handleSave() {
    if (!title.trim() || !imageUrl.trim()) {
      setError("Title and image are required."); return;
    }
    setError(null);
    setSaving(true);
    try {
      const endpoint = isAdmin ? `${API}/admin/receipts/create` : `${API}/receipts/submit`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          title: title.trim(),
          imageUrl: imageUrl.trim(),
          caption: caption.trim() || undefined,
          sourceUrl: sourceUrl.trim() || undefined,
          sourceLabel: sourceLabel.trim() || undefined,
          tags: selectedTags,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to save."); return; }
      onAdded(data.receipt as ReceiptCard);
    } catch { setError("Network error."); }
    finally { setSaving(false); }
  }

  const inputCls = "w-full px-3.5 py-2.5 border border-gray-200 rounded-xl font-['Poppins',sans-serif] text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#fd8e33]/30 focus:border-[#fd8e33] placeholder:text-gray-400 placeholder:italic";

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#23297e] px-5 py-4 flex items-center gap-3 shrink-0">
          <Plus size={16} className="text-white shrink-0" />
          <p className="flex-1 font-['Poppins',sans-serif] font-bold text-white text-base">
            {isAdmin ? "Add to The Smacks" : "Submit to The Smacks"}
          </p>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Title */}
          <div>
            <label className="block font-['Poppins',sans-serif] text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">Title *</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Facts Fox Will Never Show You: Deficit by President" className={inputCls} />
          </div>

          {/* Image */}
          <div>
            <label className="block font-['Poppins',sans-serif] text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">Image *</label>
            <div className="flex items-center gap-2 mb-2">
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1.5 px-3 py-2 bg-[#fd8e33] hover:bg-[#d96612] disabled:opacity-60 text-white font-['Poppins',sans-serif] font-semibold text-xs rounded-lg transition-colors"
              >
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                {uploading ? "Uploading…" : "Upload image"}
              </button>
              <span className="font-['Poppins',sans-serif] text-[11px] text-gray-400">or paste URL ↓</span>
            </div>
            <input type="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" className={inputCls} />
            {imageUrl && (
              <div className="mt-2 rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                <img src={imageUrl} alt="Preview" className="w-full h-auto max-h-48 object-contain" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
              </div>
            )}
            {uploadError && <p className="mt-1 text-[11px] text-red-500 font-['Poppins',sans-serif]">{uploadError}</p>}
          </div>

          {/* Caption */}
          <div>
            <label className="block font-['Poppins',sans-serif] text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">Ready-to-post caption</label>
            <textarea rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Republicans claim to care about the deficit. The data says otherwise. Share this. 🧾 #ResistAct" className={`${inputCls} resize-none`} />
            <p className={`text-right text-[11px] mt-0.5 font-['Poppins',sans-serif] ${caption.length > 280 ? "text-red-500" : "text-gray-400"}`}>{caption.length}/280</p>
          </div>

          {/* Source */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-['Poppins',sans-serif] text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">Source URL</label>
              <input type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" className={inputCls} />
            </div>
            <div>
              <label className="block font-['Poppins',sans-serif] text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">Source label</label>
              <input type="text" value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} placeholder="CBO, Reuters…" className={inputCls} />
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block font-['Poppins',sans-serif] text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Tags</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {allTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTag(t)}
                  className={`px-2.5 py-1 rounded-full text-xs font-['Poppins',sans-serif] font-medium transition-all border ${
                    selectedTags.includes(t)
                      ? "bg-[#23297e] text-white border-[#23297e]"
                      : "bg-white text-gray-600 border-gray-200 hover:border-[#23297e]"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            {/* Custom tag */}
            <div className="flex gap-2">
              <input
                type="text" value={customTag}
                onChange={(e) => setCustomTag(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomTag(); } }}
                placeholder="Add a custom tag…"
                className={`${inputCls} flex-1`}
              />
              <button type="button" onClick={addCustomTag} className="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-['Poppins',sans-serif] text-sm font-semibold transition-colors">
                Add
              </button>
            </div>
          </div>

          {!isAdmin && (
            <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 font-['Poppins',sans-serif] leading-relaxed">
              ℹ️ Your submission will be reviewed by a moderator before it goes live in The Smacks.
            </p>
          )}
          {error && <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2 font-['Poppins',sans-serif]">{error}</p>}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-4 border-t border-gray-100 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl font-['Poppins',sans-serif] font-semibold text-sm text-gray-600 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim() || !imageUrl.trim()}
            className="flex-1 py-2.5 bg-[#23297e] hover:bg-[#1a2060] disabled:opacity-60 text-white font-['Poppins',sans-serif] font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            {saving ? "Saving…" : isAdmin ? "Save" : "Submit for Review"}
          </button>
        </div>
      </div>
    </div>
  );
}
