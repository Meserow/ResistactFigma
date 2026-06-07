import { useEffect, useRef, useState } from "react";
import {
  X, Upload, Loader2, Share2, Copy, Check, Download,
  ExternalLink, Plus, Tag, Flame, Trash2, ZoomIn, Pencil,
} from "lucide-react";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import type { UserApproval } from "../lib/supabase";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { analytics } from "../lib/analytics";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04`;

// Static smack images from public/smacks/ — always shown regardless of API state.
// Add entries here whenever you drop a new image into public/smacks/.
export const STATIC_SMACKS: ReceiptCard[] = [
  {
    id: 5000,
    title: "Join the Resistance",
    tags: ["ResistAct", "Resistance"],
    imageUrl: "/Smacks/ResistActSmack.webp",
    caption: "The resistance grows one share at a time. Tag a friend who's been doomscrolling and send them this. Then come find your next action at resistact.org. #ResistAct #JoinTheResistance",
    adminApproved: true,
    pinToTop: true,
  },
  {
    id: 5001,
    title: "Third Time's the Charm",
    tags: ["Accountability", "Democracy"],
    imageUrl: "/Smacks/impeach.webp",
    caption: "He was impeached twice and should have been removed. Twice wasn't enough — the country deserves accountability. Share this. #ImpeachTrump #ResistAct",
    adminApproved: true,
  },
  {
    id: 5002,
    title: "The Most Powerful Tool You're Not Using",
    tags: ["Voting Rights", "Democracy"],
    imageUrl: "/Smacks/rock-the-vote.webp",
    caption: "Your vote is your most powerful tool. Use it. Share it. Protect it. #RockTheVote #ResistAct",
    adminApproved: true,
  },
  {
    id: 5003,
    title: "The Human Reverse Midas Touch",
    tags: ["MAGA", "Accountability"],
    imageUrl: "/Smacks/vance.webp",
    adminApproved: true,
  },
  {
    id: 5004,
    title: "Spoiler: It's Always the Same Party",
    tags: ["Politics", "History"],
    imageUrl: "/Smacks/presidents.webp",
    adminApproved: true,
  },
  {
    id: 5006,
    title: "Your Body Was Not Designed for This",
    tags: ["Humor"],
    imageUrl: "/Smacks/trumphumanbody.webp",
    adminApproved: true,
  },
  {
    id: 5007,
    title: "Help Is on the Way (Terms and Conditions Apply)",
    tags: ["Democracy", "Politics"],
    imageUrl: "/Smacks/demstates.webp",
    adminApproved: true,
  },
  {
    id: 5008,
    title: "73% Had No Conviction. They're Locked Up Anyway.",
    tags: ["Accountability", "Corruption"],
    imageUrl: "/Smacks/noconviction.webp",
    adminApproved: true,
  },
  {
    id: 5009,
    title: "He Quoted Pulp Fiction to the Pope and Called It Scripture",
    tags: ["Politics", "History"],
    imageUrl: "/Smacks/hillaryobama.webp",
    adminApproved: true,
  },
  {
    id: 5010,
    title: "Nothing to See Here (Just an 862% Coincidence)",
    tags: ["Corruption", "Democracy"],
    imageUrl: "/Smacks/thomas.webp",
    adminApproved: true,
  },
  {
    id: 5011,
    title: "88 Million People Could Have Changed Everything",
    tags: ["Elections", "Voting Rights"],
    imageUrl: "/Smacks/2024votes.webp",
    adminApproved: true,
  },
  {
    id: 5012,
    title: "If Land Were Divided Like Wealth, You'd Own a Red Dot",
    tags: ["Foreign Policy", "Policy"],
    imageUrl: "/Smacks/land.webp",
    adminApproved: true,
  },
  {
    id: 5014,
    title: "One Line Goes Up. You Know Which One.",
    tags: ["Economy", "Inequality"],
    imageUrl: "/Smacks/wealth.webp",
    adminApproved: true,
  },
  {
    id: 5015,
    title: "One Side Lets Voters Choose Leaders. The Other Chooses Its Voters.",
    tags: ["Voting Rights", "Democracy"],
    imageUrl: "/Smacks/redistricting.webp",
    adminApproved: true,
  },
  {
    id: 5016,
    title: "Everything That's Happened Since January 2025 (It's a Lot)",
    tags: ["Accountability", "History"],
    imageUrl: "/Smacks/timeline.webp",
    adminApproved: true,
  },
  {
    id: 5017,
    title: "They Win. You Pay.",
    tags: ["Economy", "Inequality"],
    imageUrl: "/Smacks/billionaires.webp",
    adminApproved: true,
  },
  {
    id: 5018,
    title: "We Don't Make the Laws… We Cash In on Them",
    tags: ["Corruption", "Accountability"],
    imageUrl: "/Smacks/corruption.webp",
    adminApproved: true,
  },
  {
    id: 5019,
    title: "eighty-six (86): To Get Rid Of, Cancel, Discard",
    tags: ["Resistance", "Humor"],
    imageUrl: "/Smacks/8647.webp",
    adminApproved: true,
  },
  {
    id: 5020,
    title: "They Call It Strategy. You Pay the Bill.",
    tags: ["Foreign Policy"],
    imageUrl: "/Smacks/iran.webp",
    adminApproved: true,
  },
  {
    id: 5022,
    title: "He Called Him a 'Terrific Guy.' Now He's Hiding the Files.",
    tags: ["Corruption", "Accountability"],
    imageUrl: "/Smacks/epstein.webp",
    adminApproved: true,
  },
  {
    id: 5023,
    title: "They Said It Didn't Exist. Here's Every Page.",
    tags: ["Fascism", "Democracy", "MAGA"],
    imageUrl: "/Smacks/project2025.webp",
    adminApproved: true,
  },
  {
    id: 5024,
    title: "Our Vote. Their 40-Year Fight Against It.",
    tags: ["Voting Rights", "Democracy"],
    imageUrl: "/Smacks/votingrights.webp",
    adminApproved: true,
  },
  {
    id: 5025,
    title: "Survivors Named. Men in Power: Redacted.",
    tags: ["Corruption", "Accountability"],
    imageUrl: "/Smacks/epsteinredactions.webp",
    adminApproved: true,
  },
  {
    id: 5026,
    title: "There Is No Magic Presidential Gas Button",
    tags: ["Economy", "Policy"],
    imageUrl: "/Smacks/gasprices.webp",
    adminApproved: true,
  },
  {
    id: 5027,
    title: "Four Seats. The Whole Senate. 2026.",
    tags: ["Democracy", "Politics"],
    imageUrl: "/Smacks/senate.webp",
    adminApproved: true,
  },
  {
    id: 5028,
    title: "The Wind Doesn't Lie — and Neither Do These Unaltered Photos",
    tags: ["Humor"],
    imageUrl: "/Smacks/hair.webp",
    adminApproved: true,
  },
  {
    id: 5029,
    title: "Just a Reminder of Who's Actually Running the Show",
    tags: ["Politics", "Elections"],
    imageUrl: "/Smacks/bidenisnotpresident.webp",
    adminApproved: true,
  },
  {
    id: 5032,
    title: "Rules for You. Power for Them.",
    tags: ["Corruption", "Accountability", "Democracy"],
    imageUrl: "/Smacks/supremes.webp",
    caption: "Six justices. One standard for them. Another for everyone else. Roberts weakened voting rights. Thomas took luxury gifts. Alito flew flags. Gorsuch sided with corporations. Kavanaugh rolled back Roe. Barrett locked in a conservative supermajority for a generation. Share this. #SCOTUS #ResistAct",
    adminApproved: true,
  },
  {
    id: 5030,
    title: "America's Health? Stripped, Confused & Rockin'",
    tags: ["Accountability", "Policy"],
    imageUrl: "/Smacks/kennedy.webp",
    caption: "RFK Jr. has no medical degree, opposes vaccines, promoted bleach cures, and loves raw milk. He's now in charge of America's health. Share this. Science isn't a conspiracy. #RFKJr #PublicHealth #ResistAct",
    adminApproved: true,
  },
  {
    id: 5031,
    title: "Painting History — Not the Genius He Thinks He Is",
    tags: ["Accountability", "Corruption"],
    imageUrl: "/Smacks/pool.webp",
    caption: "Trump spent $13 million in taxpayer money painting the Reflecting Pool — with non-waterproof paint. The plumbing is still broken. Painters waste millions. Plumbers fix problems. Share this. #TrumpWaste #ResistAct",
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
  /** When true, this smack is forced to the top of the grid regardless of
   *  sort order (top / new / pending), tag filter, or search query. Use
   *  sparingly — pinning multiple cards just creates a sub-sort problem.
   *  Currently used for the branded ResistAct hero smack only. */
  pinToTop?: boolean;
}

// Well-known tag taxonomy — drives the filter chips.
// Tags are topic-based so filtering is actually useful.
const ALL_TAGS = [
  "Accountability", "Corruption", "Democracy", "Economy",
  "Elections", "Fascism", "Foreign Policy", "History",
  "Humor", "Inequality", "MAGA", "Policy",
  "Politics", "ResistAct", "Resistance", "Voting Rights",
];

interface SmacksPageProps {
  receipts: ReceiptCard[];
  /** IDs the admin has permanently hidden — server-sourced, works across devices. */
  hiddenIds?: number[];
  /** True once the hidden-id list is authoritative (cache hit or live sync
   *  landed). Static smacks are held back until then so hidden/deleted ones
   *  never flash in before suppression is known. */
  ready?: boolean;
  searchQuery?: string;
  accessToken: string | null;
  approval: UserApproval | null;
  onReceiptAdded?: (r: ReceiptCard) => void;
  onReceiptDeleted?: (id: number) => void;
  onReceiptApproved?: (id: number) => void;
  /** Called when an admin saves edits to an existing KV-stored smack. The
   *  parent should merge the returned receipt into its receipts state so
   *  the change reflects across the whole app. */
  onReceiptUpdated?: (r: ReceiptCard) => void;
  pendingFilterVersion?: number;
  onComplete?: (id: number) => void;
  completedSmackIds?: Set<number>;
  /** Filter / sort state — controlled by App so the Navbar's filter row can
   *  render the same chips + sort toggle. Optional so the component can
   *  still run standalone (falls back to internal state). */
  activeTags?: string[];
  onActiveTagsChange?: (tags: string[]) => void;
  sortBy?: "top" | "new" | "pending";
  onSortByChange?: (s: "top" | "new" | "pending") => void;
}

export function SmacksPage({ receipts: apiReceipts, hiddenIds: serverHiddenIds = [], ready = true, searchQuery = "", accessToken, approval, onReceiptAdded, onReceiptDeleted, onReceiptApproved, onReceiptUpdated, pendingFilterVersion, onComplete, completedSmackIds, activeTags: activeTagsProp, onActiveTagsChange, sortBy: sortByProp, onSortByChange }: SmacksPageProps) {
  const isAdmin = approval?.isAdmin === true;
  const canSubmit = !!accessToken && (approval?.status === "approved");

  // Merge static smacks with API receipts; API version wins on duplicate ID.
  // The `smacks:hidden` list is ONLY for hardcoded static smacks (id >= 5000)
  // that can't be deleted from KV — so it's applied solely to STATIC_SMACKS.
  // KV receipts are real, server-controlled records (deleting one removes it
  // from KV, so it won't be in apiReceipts at all); applying the hidden list to
  // them was the bug that made a freshly created smack vanish when its id
  // happened to sit in the hidden set.
  // Static smacks are held back until `ready` so a hidden/deleted one can't
  // flash in before the suppression list is known. KV receipts are always safe
  // to show (real, server-controlled records).
  const apiIds = new Set(apiReceipts.map((r) => r.id));
  const hiddenSet = new Set(serverHiddenIds);
  const receipts = [
    ...apiReceipts,
    ...(ready ? STATIC_SMACKS.filter((r) => !apiIds.has(r.id) && !hiddenSet.has(r.id)) : []),
  ];

  // ── Tag filter ──────────────────────────────────────────────────────────────
  // Controlled-or-uncontrolled: if `activeTags` is passed in, the parent owns
  // the state and we forward writes via `onActiveTagsChange`. Otherwise we
  // keep an internal copy so the component still works standalone.
  const [activeTagsInternal, setActiveTagsInternal] = useState<string[]>([]);
  const activeTags = activeTagsProp ?? activeTagsInternal;
  const setActiveTags = (next: string[] | ((prev: string[]) => string[])) => {
    const resolved = typeof next === "function" ? next(activeTags) : next;
    if (onActiveTagsChange) onActiveTagsChange(resolved);
    else setActiveTagsInternal(resolved);
  };
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

  // Mark a smack as shared — fires once per smack (guards against double-fire).
  function markShared(id: number) {
    if (completedSmackIds?.has(id)) return;
    onComplete?.(id);
  }

  /** Wraps markShared with GA event tracking. Use at every share-button click
   *  site so per-platform share counts are comparable. Analytics fires on
   *  EVERY click (so repeat-shares to different platforms are visible); the
   *  internal "completed smack" dedup only fires the user-facing badge once. */
  function trackShare(id: number, method: string) {
    analytics.shareClicked(method, "smack", id);
    markShared(id);
  }

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

  /** Smacks-only WebP rewrite: same logic as ImageWithFallback's
   *  webpSibling — root-rooted public path, .png/.jpg, not already WebP.
   *  Returns null for anything else (Supabase storage URLs, http(s) absolute,
   *  protocol-relative). The share/copy/native-share flow uses the WebP when
   *  available so users upload ~85% smaller files to social platforms. The
   *  "Download high-res" button bypasses this and pulls the original. */
  function smacksWebpSibling(src: string): string | null {
    if (!/^\/[^/]/.test(src)) return null;
    if (!/\.(jpe?g|png)(\?|#|$)/i.test(src)) return null;
    return src.replace(/\.(jpe?g|png)(\?|#|$)/i, ".webp$2");
  }

  /** Fetch the share-optimised version of a Smack: try the WebP sibling first,
   *  fall back to the original on 404. Used by share / copy / native-share so
   *  users upload tiny files. The "Download high-res" button skips this and
   *  passes through fetchImageBlobRaw(). */
  async function fetchImageBlob(url: string) {
    const webp = smacksWebpSibling(url);
    if (webp) {
      const r = await fetch(webp);
      if (r.ok) return r.blob();
      // fall through to the original on 404 / non-2xx
    }
    return fetchImageBlobRaw(url);
  }

  /** Always pull the raw original — for print downloads. */
  async function fetchImageBlobRaw(url: string) {
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
    // Capture the receipt up-front — `shareReceipt` is closed over but the
    // async work below may outlive the modal being closed.
    const receipt = shareReceipt;
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      try {
        // CRITICAL: call clipboard.write synchronously inside the click
        // handler so the user-gesture context is preserved. Earlier code
        // awaited the fetch + canvas conversion FIRST, which Chrome treats
        // as gesture-expired and rejects — making this button feel broken.
        const pngPromise = (async () => {
          const src = await fetchImageBlob(receipt.imageUrl);
          return blobToPngBlob(src);
        })();
        await navigator.clipboard.write([new ClipboardItem({ "image/png": pngPromise })]);
        setCopyImageState("done");
        setTimeout(() => setCopyImageState("idle"), 2000);
        return;
      } catch (err) {
        console.warn("[Smacks copy] clipboard.write failed:", err);
      }
    }
    // Last-resort fallback: copy URL as text. Better than silently doing
    // nothing — at least the user gets *something* on the clipboard.
    await navigator.clipboard.writeText(receipt.imageUrl).catch(() => {});
    setCopyImageState("done");
    setTimeout(() => setCopyImageState("idle"), 2000);
  }

  function twitterUrl(r: ReceiptCard) {
    const text = encodeURIComponent((r.caption ?? r.title) + "\n\nresistact.org");
    return `https://twitter.com/intent/tweet?text=${text}`;
  }

  /** Decode any blob (WebP / JPG / PNG / etc.) into a PNG blob via a canvas.
   *  Chrome's clipboard API only reliably supports `image/png` (and `image/jpeg`)
   *  — pushing a WebP blob silently fails, which used to land users on the
   *  "downloaded" fallback. Round-tripping through a canvas gives us PNG. */
  async function blobToPngBlob(blob: Blob): Promise<Blob> {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas 2d unavailable");
      ctx.drawImage(img, 0, 0);
      const pngBlob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => b ? resolve(b) : reject(new Error("toBlob null")), "image/png");
      });
      return pngBlob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Universal image-to-clipboard helper.
   *
   *  CRITICAL detail: Chrome's clipboard.write() only honours the user-gesture
   *  context if the call itself happens synchronously inside the click handler.
   *  Earlier versions of this helper `await`-ed fetch + canvas conversion
   *  BEFORE calling clipboard.write — which Chrome treats as "user gesture
   *  expired" and rejects, silently sending us into the download fallback.
   *
   *  The fix is the Promise form of ClipboardItem: we call clipboard.write
   *  immediately with a Promise that resolves to the PNG blob later. Chrome
   *  preserves the gesture for the entire promise chain.
   *
   *  Returns true on success (clipboard or, on mobile, native share sheet);
   *  false only when nothing worked, so the caller can decide whether to
   *  surface an error or fall back to download. */
  async function putImageOnClipboard(r: ReceiptCard): Promise<boolean> {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      try {
        // Build the Promise BEFORE calling clipboard.write so the
        // synchronous call happens inside the user-gesture window.
        const pngPromise = (async () => {
          const src = await fetchImageBlob(r.imageUrl);
          return blobToPngBlob(src);
        })();
        await navigator.clipboard.write([new ClipboardItem({ "image/png": pngPromise })]);
        return true;
      } catch (err) {
        console.warn("[Smacks share] clipboard.write failed:", err);
      }
    }
    // Fallback path — mobile native share sheet with file attached.
    try {
      const blob = await fetchImageBlob(r.imageUrl);
      const ext = blob.type.split("/")[1] || "jpg";
      const file = new File(
        [blob],
        `${r.title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.${ext}`,
        { type: blob.type }
      );
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: r.caption ?? r.title });
        return true;
      }
    } catch (err) {
      console.warn("[Smacks share] native share failed:", err);
    }
    return false;
  }

  /** Kick off a clipboard-image write SYNCHRONOUSLY from a click handler,
   *  before any focus-stealing window.open. Returns a promise that resolves to
   *  the success/failure state — call this *first*, then open the platform
   *  tab, then await the promise. Reversing this order causes Chrome to drop
   *  the user-gesture context and reject the clipboard write, sending users
   *  to the download fallback. */
  function startClipboardWrite(r: ReceiptCard): Promise<boolean> {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
      return Promise.resolve(false);
    }
    const pngPromise = (async () => {
      const src = await fetchImageBlob(r.imageUrl);
      return blobToPngBlob(src);
    })();
    return navigator.clipboard
      .write([new ClipboardItem({ "image/png": pngPromise })])
      .then(() => true)
      .catch((err) => { console.warn("[Smacks share] clipboard.write failed:", err); return false; });
  }

  async function handleFacebookShare(r: ReceiptCard) {
    // Open Facebook's sharer.php popup with the per-smack share page URL.
    // Each `/s/<id>.html` has og:image set to that smack's actual image
    // (see scripts/generate-smack-share-pages.mjs), so the FB share dialog
    // shows the smack itself as the preview — no clipboard paste needed.
    // For user-submitted smacks (id < 5000) that don't have static pages
    // yet, fall back to the homepage URL.
    //
    // We still copy the image to the clipboard as belt-and-suspenders —
    // if the user closes the share dialog and wants to paste into a regular
    // post or DM, the image is right there.
    //
    // CRITICAL ORDER (Chrome clipboard rules):
    //   1. Start clipboard write SYNCHRONOUSLY (preserves user-gesture).
    //   2. Open the Facebook sharer popup synchronously (popup-blocker rule).
    //   3. Await the clipboard promise.
    const hasStaticPage = r.id >= 5000;
    const sharedUrl = hasStaticPage
      ? `https://www.resistact.org/s/${r.id}.html`
      : "https://www.resistact.org";
    const clipboardPromise = startClipboardWrite(r);
    const fbShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(sharedUrl)}`;
    // iOS Safari silently blocks `window.open` from inside a modal's button
    // handler. The reliable workaround: build a real <a> and click it —
    // Safari treats programmatic anchor clicks as legit link navigation
    // and skips the popup blocker. Desktop keeps the popup window.open
    // behaviour so users don't lose their place on resistact.org.
    const isIOS = typeof navigator !== "undefined"
      && /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isIOS) {
      const a = document.createElement("a");
      a.href = fbShareUrl;
      a.target = "_blank";
      a.rel = "noopener,noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      window.open(fbShareUrl, "_blank", "noopener,noreferrer");
    }
    const ok = await clipboardPromise;
    setFbInstruction(ok ? "copied" : "downloaded");
    if (!ok) await handleDownload(r);
    setTimeout(() => setFbInstruction("idle"), 12000);
  }

  async function handleInstagramShare(r: ReceiptCard) {
    // Same critical order as handleFacebookShare — clipboard.write first
    // (sync), then open the Instagram tab, then await. Instagram has no web
    // share API, so the image-on-clipboard + manual paste is the only way to
    // get a Smack into an IG post / story / DM from the desktop browser.
    const clipboardPromise = startClipboardWrite(r);
    window.open("https://www.instagram.com/", "_blank");
    const ok = await clipboardPromise;
    setFbInstruction(ok ? "copied" : "downloaded");
    if (!ok) await handleDownload(r);
    setTimeout(() => setFbInstruction("idle"), 8000);
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

  /** Download the original file (PNG / JPG / WebP — whatever the seed
   *  references). This is the HI-RES path — print services want the lossless
   *  PNG when available, and the original keeps full dimensions. The share /
   *  copy / native-share flow uses the WebP sibling via fetchImageBlob() so
   *  uploads to social platforms are tiny; this download is for users who
   *  want the original quality (frame it, print it, archive it). */
  async function handleDownload(r: ReceiptCard) {
    try {
      const blob = await fetchImageBlobRaw(r.imageUrl);
      // Use the actual file extension from the URL so the saved filename
      // matches the bytes (was hardcoded to .jpg before, even for PNGs).
      const ext = (r.imageUrl.match(/\.(png|jpe?g|webp|gif)(?:\?|#|$)/i)?.[1] ?? "png").toLowerCase();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${r.title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-hires.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      window.open(r.imageUrl, "_blank");
    }
  }

  // ── Admin: delete ───────────────────────────────────────────────────────────
  // Deletes are persisted server-side in smacks:hidden so they survive across
  // devices and browser restarts. localStorage is kept as a fast local cache
  // so the UI snaps immediately even before the server round-trip completes.
  const [deletedIds, setDeletedIds] = useState<Set<number>>(() => {
    try {
      const s = localStorage.getItem("resistact_smacks_deleted");
      return s ? new Set<number>(JSON.parse(s)) : new Set<number>();
    } catch { return new Set<number>(); }
  });

  async function handleDelete(id: number) {
    // Optimistic: hide immediately in this session.
    setDeletedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem("resistact_smacks_deleted", JSON.stringify([...next])); } catch {}
      return next;
    });
    // Notify parent so App.tsx state stays in sync (removes from apiReceipts
    // and adds to hiddenSmackIds so the next render doesn't bring it back).
    onReceiptDeleted?.(id);

    if (!accessToken) return;
    const isStatic = id >= 5000;
    try {
      if (isStatic) {
        // Static smacks don't exist in KV — record the hide in smacks:hidden.
        const res = await fetch(`${API}/admin/receipts/hide/${id}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) console.error(`Failed to hide static smack #${id}:`, await res.text().catch(() => ""));
      } else {
        // Non-static: actually delete from KV (which also records in smacks:hidden).
        const res = await fetch(`${API}/admin/receipts/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) console.error(`Failed to delete smack #${id}:`, await res.text().catch(() => ""));
      }
    } catch (err) {
      console.error(`Error deleting smack #${id}:`, err);
    }
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

  // ── Admin: edit smack modal ──────────────────────────────────────────────────
  // Holds the id of the receipt currently being edited via the pencil button.
  // Null when no modal is open. Only KV-stored receipts (id < 5000) are
  // editable — the pencil button is hidden for static smacks.
  const [editingId, setEditingId] = useState<number | null>(null);

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
    // Fire-and-forget to server. The endpoint itself is anonymous, but
    // Supabase's gateway still requires an Authorization header to route
    // the call — the anon key satisfies it. Without this the request gets
    // rejected with UNAUTHORIZED_NO_AUTH_HEADER before our handler runs
    // and the boost count silently fails to sync.
    fetch(`${API}/receipts/${id}/boost`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${publicAnonKey}`,
      },
      body: JSON.stringify({ delta }),
    }).catch(() => {});
  }

  // ── Sort ────────────────────────────────────────────────────────────────────
  // Controlled-or-uncontrolled, same pattern as activeTags.
  const [sortByInternal, setSortByInternal] = useState<"top" | "new" | "pending">("top");
  const sortBy = sortByProp ?? sortByInternal;
  const setSortBy = (s: "top" | "new" | "pending") => {
    if (onSortByChange) onSortByChange(s);
    else setSortByInternal(s);
  };
  useEffect(() => {
    if (pendingFilterVersion && pendingFilterVersion > 0) setSortBy("pending");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFilterVersion]);

  // ── Local search ─────────────────────────────────────────────────────────────
  // Search now lives in the top navbar only; the lower search bar was removed
  // so this page can lead with an intro paragraph instead of a duplicate input.

  // ── Filter + sort ────────────────────────────────────────────────────────────
  // pinToTop cards (e.g. the branded ResistAct hero smack) ALWAYS lead the
  // grid regardless of sort, tag filter, or search query — they survive the
  // filter step unconditionally and then get prepended to the sorted rest.
  // This mirrors the Acts-side pinToTop ("Spread the Word") behaviour. They
  // STILL respect the pending filter (admin-only view) because that's a
  // different mode, not a sort within the public grid.
  const q = searchQuery.toLowerCase().trim();
  const isPendingMode = sortBy === "pending";
  const visible = receipts.filter((r) => {
    if (deletedIds.has(r.id) || serverHiddenIds.includes(r.id)) return false;
    if (isPendingMode) return isAdmin && !r.adminApproved;
    if (!isAdmin && !r.adminApproved) return false;
    return true;
  });
  const passesUserFilters = (r: ReceiptCard) => {
    if (q) {
      return (
        r.title.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q)) ||
        (r.caption?.toLowerCase().includes(q) ?? false)
      );
    }
    if (activeTags.length === 0) return true;
    return activeTags.some((t) => r.tags.map((x) => x.toLowerCase()).includes(t.toLowerCase()));
  };
  // Pinned cards skip the tag/search filters so they never disappear from
  // the top of the page. (We DO honor the pending-mode filter above — see
  // `visible` — because that's a deliberate admin view, not a public sort.)
  const pinnedCards = isPendingMode ? [] : visible.filter((r) => r.pinToTop);
  const pinnedIds = new Set(pinnedCards.map((r) => r.id));
  const filtered = [
    ...pinnedCards,
    ...visible
      .filter((r) => !pinnedIds.has(r.id) && passesUserFilters(r))
      .sort((a, b) =>
        sortBy === "top"
          ? boostCountFor(b) - boostCountFor(a)
          : (b.createdAt ?? "").localeCompare(a.createdAt ?? "")
      ),
  ];

  // Collect distinct tags from loaded receipts for the filter bar.
  const availableTags = Array.from(
    new Set(receipts.flatMap((r) => r.tags))
  ).sort();

  return (
    <div className="min-h-screen">
      {/* ── Intro: What's a Smack? — chips + sort live in the navbar above;
          the "Add to The Smacks" / "Submit to The Smacks" call-to-action
          tucks inside the intro card so submission is offered right next
          to the explanation of what users are creating. ── */}
      <div className="mb-5 rounded-2xl border border-[#23297e]/15 bg-gradient-to-br from-[#ed6624]/5 via-white to-[#23297e]/5 px-4 py-3.5 sm:px-5 sm:py-4">
        <div className="flex items-start justify-between gap-3 mb-1.5">
          <p className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-sm sm:text-base flex items-center gap-1.5">
            <span aria-hidden="true">💥</span> What's a Smack?
          </p>
          {canSubmit && (
            <button
              onClick={() => setAddOpen(true)}
              className="shrink-0 flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#ed6624] hover:bg-[#c2521b] text-white font-['Poppins',sans-serif] font-bold text-xs transition-colors"
            >
              <Plus size={13} />
              {isAdmin ? "Add to The Smacks" : "Submit to The Smacks"}
            </button>
          )}
        </div>
        <p className="font-['Poppins',sans-serif] text-xs sm:text-sm text-gray-700 leading-snug">
          The president is a cartoon villain. So is the Supreme Court. So is half of Congress. You don't fight a cartoon with a footnoted essay — you fight it with a meme that lands in two seconds. <strong className="text-[#23297e]">Smacks</strong> are shareable images that meet their grift, corruption, and stupidity with the simplicity those deserve. <span className="text-[#ed6624] font-semibold">Save it. Post it. Move on.</span>
        </p>
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
            isShared={completedSmackIds?.has(r.id) ?? false}
            onShare={() => openShare(r)}
            onBoost={() => handleReceiptBoost(r.id)}
            onApprove={() => handleApprove(r.id)}
            onDelete={() => handleDelete(r.id)}
            onEdit={() => setEditingId(r.id)}
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
                <ImageWithFallback
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

              {/* Share buttons — shown immediately on open. The native-share
                  button is ONLY shown on touch devices (iOS / Android), because
                  on Mac/Windows desktop `navigator.share` opens the OS share
                  sheet which usually only offers "Save to Files" (= download)
                  rather than social-app targets — which made users think the
                  Share button was downloading the image. On desktop, the
                  orange "Copy image" button becomes the primary action and
                  the platform tiles below copy the image to clipboard before
                  opening the platform tab. */}
              <div className="grid grid-cols-4 gap-2">
                {/* Native share with image file — mobile only */}
                {typeof navigator !== "undefined" && "share" in navigator
                    && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) && (
                  <button
                    onClick={() => { trackShare(shareReceipt.id, "native"); handleNativeShare(); }}
                    className="col-span-4 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#23297e] hover:bg-[#1a2060] text-white font-['Poppins',sans-serif] font-bold text-sm transition-colors"
                  >
                    <Share2 size={15} />
                    Share image via…
                  </button>
                )}

                {/* Copy image to clipboard — primary action on desktop */}
                <button
                  onClick={() => { trackShare(shareReceipt.id, "copy_image"); handleCopyImage(); }}
                  className="col-span-4 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#ed6624] hover:bg-[#c2521b] text-white font-['Poppins',sans-serif] font-bold text-sm transition-colors"
                >
                  {copyImageState === "done" ? <Check size={15} className="text-white" /> : <Copy size={15} />}
                  {copyImageState === "copying" ? "Copying…" : copyImageState === "done" ? "Image copied! Paste anywhere." : "Copy image to clipboard"}
                </button>

                {/* Paste instruction — appears after clicking Facebook or
                    Instagram. The smack image is on the clipboard as a
                    backup; the FB share dialog will also show the smack
                    image directly thanks to the per-smack /s/<id>.html
                    pages with proper og:image meta tags. */}
                {fbInstruction !== "idle" && (
                  <div className="col-span-4 flex items-start gap-3 bg-[#ed6624]/10 border-2 border-[#ed6624] rounded-xl px-4 py-3 text-[12px] text-[#23297e] font-['Poppins',sans-serif] leading-snug">
                    <span className="text-xl leading-none mt-0.5">✅</span>
                    <span>
                      {fbInstruction === "copied"
                        ? <>
                            <strong className="block text-[13px] mb-1">Ready to share!</strong>
                            The Facebook share dialog will show this Smack as the preview — just add a comment and hit Share.
                            <span className="block mt-1 text-[11px] text-gray-600 italic">Backup: the image is also on your clipboard (⌘V / Ctrl+V) if you'd rather paste it into a regular post or DM.</span>
                          </>
                        : <>
                            <strong className="block text-[13px] mb-1">Image downloaded.</strong>
                            In the post composer, click "Photo/Video" and upload it from your Downloads folder.
                          </>}
                    </span>
                  </div>
                )}

                {/* Facebook — spot 1 */}
                <button
                  onClick={() => { trackShare(shareReceipt.id, "facebook"); handleFacebookShare(shareReceipt); }}
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
                  onClick={() => trackShare(shareReceipt.id, "threads")}
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
                  onClick={() => trackShare(shareReceipt.id, "bluesky")}
                  className="flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl bg-[#0085ff] hover:bg-[#006fdb] text-white font-['Poppins',sans-serif] font-bold text-[10px] transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z"/></svg>
                  Bluesky
                </a>

                {/* Instagram — spot 4 */}
                <button
                  onClick={() => { trackShare(shareReceipt.id, "instagram"); handleInstagramShare(shareReceipt); }}
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
                  onClick={() => trackShare(shareReceipt.id, "pinterest")}
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
                  onClick={() => trackShare(shareReceipt.id, "reddit")}
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
                  onClick={() => trackShare(shareReceipt.id, "tumblr")}
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
                  onClick={() => trackShare(shareReceipt.id, "x")}
                  className="flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl bg-black hover:bg-gray-900 text-white font-['Poppins',sans-serif] font-bold text-[10px] transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.836L1.254 2.25H8.08l4.258 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                  Post to X
                </a>

                {/* Download — pulls the ORIGINAL high-res file (PNG, full
                    dimensions). Use this when you want to print the Smack
                    or archive it. The share / copy / "Save image via…"
                    buttons above silently route through the WebP sibling
                    instead, so social uploads are 80–90% smaller. */}
                <button
                  onClick={() => { trackShare(shareReceipt.id, "download"); handleDownload(shareReceipt); }}
                  className="col-span-4 flex flex-col items-center justify-center gap-0.5 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-['Poppins',sans-serif] transition-colors"
                >
                  <span className="flex items-center gap-2 font-bold text-sm">
                    <Download size={14} />
                    Download high-res (for print)
                  </span>
                  <span className="text-[10px] text-gray-500 font-medium">
                    Full-size original — slower upload, best for printing
                  </span>
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
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl font-['Poppins',sans-serif] text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-[#ed6624]/30 focus:border-[#ed6624]"
                />
                <div className="flex items-center justify-between mt-1">
                  <span className={`font-['Poppins',sans-serif] text-[11px] ${captionDraft.length > 280 ? "text-red-500" : "text-gray-400"}`}>
                    {captionDraft.length}/280 chars for X/Twitter
                  </span>
                  <button
                    onClick={handleCopyCaption}
                    className="flex items-center gap-1 text-[11px] font-['Poppins',sans-serif] font-semibold text-[#23297e] hover:text-[#ed6624] transition-colors"
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
          <ImageWithFallback
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

      {/* ── Admin: Edit Smack modal — opens when the pencil button on a
          KV-stored receipt is clicked. Static smacks (id ≥ 5000) live in
          code so the pencil is hidden for them. ── */}
      {editingId !== null && (() => {
        const r = receipts.find((x) => x.id === editingId);
        if (!r) return null;
        return (
          <EditSmackModal
            receipt={r}
            accessToken={accessToken}
            allTags={ALL_TAGS}
            onClose={() => setEditingId(null)}
            onSaved={(updated) => {
              onReceiptUpdated?.(updated);
              setEditingId(null);
            }}
          />
        );
      })()}
    </div>
  );
}

// ─── Receipt tile ──────────────────────────────────────────────────────────────
function ReceiptTile({
  receipt, isAdmin, boostCount, isBoosted, isShared, onShare, onBoost, onApprove, onDelete, onEdit,
}: {
  receipt: ReceiptCard;
  isAdmin: boolean;
  boostCount: number;
  isBoosted: boolean;
  isShared: boolean;
  onShare: () => void;
  onBoost: () => void;
  onApprove: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  // Static smacks (hardcoded in STATIC_SMACKS, id ≥ 5000) live in code and
  // can't be edited via the API. Only KV-stored receipts get the pencil.
  const isEditable = receipt.id < 5000;
  const [tileLightboxOpen, setTileLightboxOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  return (
    <>
    <div
      className={`rounded-2xl overflow-hidden border border-gray-600 bg-white flex flex-col transform-gpu transition-[transform,box-shadow,opacity] duration-200 ease-out shadow-md hover:shadow-lg hover:border-[#23297e] hover:ring-2 hover:ring-[#23297e] motion-safe:hover:-translate-y-1 motion-safe:hover:scale-[1.02] hover:z-10 ${!receipt.adminApproved && isAdmin ? "ring-2 ring-red-400" : ""}`}
    >
      {/* Pending banner */}
      {!receipt.adminApproved && isAdmin && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-red-50 border-b border-red-200 shrink-0">
          <span className="font-['Poppins',sans-serif] font-bold text-[11px] uppercase tracking-wider text-red-600">
            ⚠ Pending
          </span>
          <div className="flex items-center gap-1.5">
            {isEditable && (
              <button
                type="button"
                onClick={onEdit}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-red-200 hover:bg-red-100 text-red-700 font-['Poppins',sans-serif] font-bold text-[10px] uppercase tracking-wide transition-colors"
                title="Edit before approving"
              >
                <Pencil size={10} /> Edit
              </button>
            )}
            <button
              type="button"
              onClick={onApprove}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-600 hover:bg-green-700 text-white font-['Poppins',sans-serif] font-bold text-[10px] uppercase tracking-wide transition-colors"
            >
              Approve
            </button>
            {confirmingDelete ? (
              <div className="flex items-center gap-1">
                <span className="font-['Poppins',sans-serif] text-[10px] text-red-700 font-semibold">Sure?</span>
                <button
                  type="button"
                  onClick={() => { setConfirmingDelete(false); onDelete(); }}
                  className="px-2 py-0.5 rounded-md bg-red-600 hover:bg-red-700 text-white font-['Poppins',sans-serif] font-bold text-[10px] uppercase tracking-wide transition-colors"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="px-2 py-0.5 rounded-md bg-gray-200 hover:bg-gray-300 text-gray-700 font-['Poppins',sans-serif] font-bold text-[10px] uppercase tracking-wide transition-colors"
                >
                  No
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-600 hover:bg-red-700 text-white font-['Poppins',sans-serif] font-bold text-[10px] uppercase tracking-wide transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}

      {/* Thumbnail — click to open lightbox */}
      <button
        type="button"
        onClick={() => setTileLightboxOpen(true)}
        className="relative block w-full h-[200px] overflow-hidden bg-gray-100 group shrink-0 text-left cursor-zoom-in"
      >
        <ImageWithFallback
          src={receipt.imageUrl}
          alt={receipt.title}
          className="w-full h-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]"
          loading="lazy"
        />
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/90 font-['Poppins',sans-serif] font-bold text-xs text-[#23297e]">
            <ZoomIn size={12} />
            View larger
          </span>
        </div>
        {/* Boost — bottom-left overlay, same position as Acts cards */}
        <div className="absolute bottom-2 left-2.5 z-10">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onBoost(); }}
            aria-label={isBoosted ? "Boosted" : "Boost"}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-['Poppins',sans-serif] font-bold text-[12px] whitespace-nowrap shrink-0 transition-all ${
              isBoosted
                ? "bg-[#ed6624]/80 text-white shadow-md"
                : "bg-white/85 backdrop-blur-sm text-[#ed6624] shadow-sm hover:bg-white"
            }`}
          >
            <span aria-hidden>🔥</span>
            <span>{isBoosted ? "Boosted!" : "Boost"}</span>
            {boostCount > 0 && <span className="opacity-80">· {boostCount}</span>}
          </button>
        </div>
        {/* Admin edit + delete cluster (approved smacks only — pending ones
            already show approve/delete in the pending header). The pencil
            only appears for KV-stored receipts; static smacks (id ≥ 5000)
            hide it since editing them requires a code change. */}
        {receipt.adminApproved && isAdmin && (
          confirmingDelete ? (
            <div
              className="absolute top-2 left-2 flex items-center gap-1 z-10"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="font-['Poppins',sans-serif] text-[10px] text-white font-bold bg-black/60 px-1.5 py-0.5 rounded">Sure?</span>
              <button
                type="button"
                onClick={() => { setConfirmingDelete(false); onDelete(); }}
                className="px-2 py-0.5 rounded-md bg-red-600 hover:bg-red-700 text-white font-['Poppins',sans-serif] font-bold text-[10px] shadow transition-colors"
              >Yes</button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="px-2 py-0.5 rounded-md bg-white/90 text-gray-700 hover:bg-white font-['Poppins',sans-serif] font-bold text-[10px] shadow transition-colors"
              >No</button>
            </div>
          ) : (
            <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5">
              {isEditable && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onEdit(); }}
                  className="w-7 h-7 flex items-center justify-center rounded-full bg-white/90 text-gray-400 hover:text-[#23297e] hover:bg-white shadow-sm transition-colors"
                  title="Edit this smack"
                >
                  <Pencil size={13} />
                </button>
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmingDelete(true); }}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-white/90 text-gray-400 hover:text-red-600 hover:bg-white shadow-sm transition-colors"
                title="Delete"
              >
                <Trash2 size={13} />
              </button>
            </div>
          )
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

        {/* Footer: Share button — stays clickable after sharing so users
            can share again to different platforms. The "Shared ✓" state is
            just a visual confirmation, not a lockout. */}
        <div className="flex items-center justify-end gap-2 mt-auto">
          <button
            type="button"
            onClick={onShare}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-['Poppins',sans-serif] font-bold text-xs transition-colors ${
              isShared
                ? "bg-green-600 hover:bg-green-700 text-white"
                : "bg-[#23297e] hover:bg-[#1a2060] text-white"
            }`}
            title={isShared ? "Share again to another platform" : "Share this Smack"}
          >
            {isShared ? <Check size={12} strokeWidth={3} /> : <Share2 size={12} />}
            {isShared ? "Share again" : "Share"}
          </button>
        </div>
      </div>
    </div>

    {/* Tile lightbox — full-bleed image preview. Closes on backdrop click. */}
    {tileLightboxOpen && (
      <div
        className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-4"
        onClick={() => setTileLightboxOpen(false)}
      >
        <button
          type="button"
          className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
          onClick={() => setTileLightboxOpen(false)}
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <ImageWithFallback
          src={receipt.imageUrl}
          alt={receipt.title}
          // Use ImageWithFallback so the lightbox picks up the WebP sibling
          // when only the WebP variant ships on disk — the raw <img src> path
          // was 404-ing for smacks where we'd dropped the original PNG/JPG.
          className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
          onClick={(e: React.MouseEvent<HTMLImageElement>) => e.stopPropagation()}
        />
      </div>
    )}
    </>
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

  const inputCls = "w-full px-3.5 py-2.5 border border-gray-200 rounded-xl font-['Poppins',sans-serif] text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#ed6624]/30 focus:border-[#ed6624] placeholder:text-gray-400 placeholder:italic";

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
                className="flex items-center gap-1.5 px-3 py-2 bg-[#ed6624] hover:bg-[#c2521b] disabled:opacity-60 text-white font-['Poppins',sans-serif] font-semibold text-xs rounded-lg transition-colors"
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

// ─── Admin: Edit Receipt modal ────────────────────────────────────────────────
// Mirrors AddReceiptModal's field surface (title / image / caption / source /
// tags) but pre-populated from an existing receipt and submitting via PUT.
// Only callable by admins — static smacks (id ≥ 5000) live in code and aren't
// editable through this flow; the pencil button is hidden for them.
function EditSmackModal({
  receipt, accessToken, allTags, onClose, onSaved,
}: {
  receipt: ReceiptCard;
  accessToken: string | null;
  allTags: string[];
  onClose: () => void;
  onSaved: (r: ReceiptCard) => void;
}) {
  const [title,       setTitle]       = useState(receipt.title ?? "");
  const [imageUrl,    setImageUrl]    = useState(receipt.imageUrl ?? "");
  const [caption,     setCaption]     = useState(receipt.caption ?? "");
  const [sourceUrl,   setSourceUrl]   = useState(receipt.sourceUrl ?? "");
  const [sourceLabel, setSourceLabel] = useState(receipt.sourceLabel ?? "");
  const [selectedTags, setSelectedTags] = useState<string[]>(receipt.tags ?? []);
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
      const res = await fetch(`${API}/admin/receipts/${receipt.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          title: title.trim(),
          imageUrl: imageUrl.trim(),
          caption: caption.trim(),
          sourceUrl: sourceUrl.trim(),
          sourceLabel: sourceLabel.trim(),
          tags: selectedTags,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to save."); return; }
      onSaved(data.receipt as ReceiptCard);
    } catch { setError("Network error."); }
    finally { setSaving(false); }
  }

  const inputCls = "w-full px-3.5 py-2.5 border border-gray-200 rounded-xl font-['Poppins',sans-serif] text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#ed6624]/30 focus:border-[#ed6624] placeholder:text-gray-400 placeholder:italic";

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-[#23297e] px-5 py-4 flex items-center gap-3 shrink-0">
          <Pencil size={16} className="text-white shrink-0" />
          <p className="flex-1 font-['Poppins',sans-serif] font-bold text-white text-base">
            Edit smack <span className="text-white/60 font-normal text-xs ml-1">#{receipt.id}</span>
          </p>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="block font-['Poppins',sans-serif] text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">Title *</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className="block font-['Poppins',sans-serif] text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">Image *</label>
            <div className="flex items-center gap-2 mb-2">
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1.5 px-3 py-2 bg-[#ed6624] hover:bg-[#c2521b] disabled:opacity-60 text-white font-['Poppins',sans-serif] font-semibold text-xs rounded-lg transition-colors"
              >
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                {uploading ? "Uploading…" : "Replace image"}
              </button>
              <span className="font-['Poppins',sans-serif] text-[11px] text-gray-400">or edit URL ↓</span>
            </div>
            <input type="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} className={inputCls} />
            {imageUrl && (
              <div className="mt-2 rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                <img src={imageUrl} alt="Preview" className="w-full h-auto max-h-48 object-contain" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
              </div>
            )}
            {uploadError && <p className="mt-1 text-[11px] text-red-500 font-['Poppins',sans-serif]">{uploadError}</p>}
          </div>

          <div>
            <label className="block font-['Poppins',sans-serif] text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">Ready-to-post caption</label>
            <textarea rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} className={`${inputCls} resize-none`} />
            <p className={`text-right text-[11px] mt-0.5 font-['Poppins',sans-serif] ${caption.length > 280 ? "text-red-500" : "text-gray-400"}`}>{caption.length}/280</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-['Poppins',sans-serif] text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">Source URL</label>
              <input type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block font-['Poppins',sans-serif] text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">Source label</label>
              <input type="text" value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} className={inputCls} />
            </div>
          </div>

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

          {error && <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2 font-['Poppins',sans-serif]">{error}</p>}
        </div>

        <div className="shrink-0 px-5 py-4 border-t border-gray-100 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl font-['Poppins',sans-serif] font-semibold text-sm text-gray-600 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim() || !imageUrl.trim()}
            className="flex-1 py-2.5 bg-[#23297e] hover:bg-[#1a2060] disabled:opacity-60 text-white font-['Poppins',sans-serif] font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
