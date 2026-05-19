import { ActionCardData } from "../components/ActionCard";

import imgImage34  from "../../assets/f757504534bf51b4afc042b9ec12280b63be51da.png";

// Pre-built figma asset map for the original hand-curated cards.
// Only `imgImage34` remains — Ellen's avatar on the pinned ResistAct intro
// card (SEED_CARDS id=1). The other figma demo images were removed when
// STATIC_CARDS was trimmed to a single fallback row.
export const FIGMA_IMAGE_MAP: Record<string, string> = {
  imgImage34,
};

// Bulk-import every logo in src/assets/orgs/ as `org_<slug>` keys, where the
// slug matches the filename (without extension). Server-side seed cards use
// these keys as their `topImageKey`.
const orgGlob = import.meta.glob<string>("../../assets/orgs/*", {
  eager: true,
  import: "default",
});
export const ORG_IMAGE_MAP: Record<string, string> = {};
for (const [path, mod] of Object.entries(orgGlob)) {
  const fname = path.split("/").pop()!.replace(/\.[^.]+$/, "");
  ORG_IMAGE_MAP[`org_${fname}`] = mod;
}

// Combined map used by the resolver in App.tsx.
export const IMAGE_MAP: Record<string, string> = {
  ...FIGMA_IMAGE_MAP,
  ...ORG_IMAGE_MAP,
};

// ─── Static fallback cards ────────────────────────────────────────────────────
// Shown on first paint only if the /actions API fails; replaced by live data.
// Cards 1, 3, 13 removed — the live KV store now owns the pinned intro and
// the rest of the catalog.
export const STATIC_CARDS: ActionCardData[] = [
  { id: 5, isFeatured: true, category: "BOOST", categoryColor: "#8a00e6", title: "Spread the Word about ResistAct", description: "Resistance grows one share at a time — but only if you actually share. Pick a friend who's been doomscrolling and send this their way. If everyone here invites two friends, ResistAct doubles by Tuesday. That's how movements actually scale — not virally, but two-by-two, through people who trust each other.", boosts: 2, spotsTotal: "Unlimited", authorName: "Ellen Meserow", authorRole: "ResistAct Founder", topImage: "/og-image-v3.jpg", authorAvatar: imgImage34 },
];
