#!/usr/bin/env node
/**
 * One-off script: generate retro-comic-style card banners using OpenAI's
 * gpt-image-1 model (their current image model — "GPT-2" isn't an image
 * model, this is the most capable thing available).
 *
 * For each sample card:
 *   1. Download the existing topImageUrl
 *   2. Send it to /v1/images/edits with the brand style prompt
 *   3. Save the result to ./scripts/generated-card-art/card-<id>.webp
 *   4. Also save a grid-sized preview so we can eyeball card legibility
 *
 * For the full sweep (not yet authorized): once each card is generated,
 * the corresponding KV record gets `cartoonImageUrl` set to the public
 * URL and `cartoonStatus: "done"`. The ActionCard component already
 * prefers cartoonImageUrl over topImage, so a deploy after generation
 * flips the whole feed to the comic style at once.
 *
 * Run:
 *   OPENAI_API_KEY=sk-... node scripts/generate-card-art.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
// Scratch/dev outputs (PNG raws + grid previews + debug masters) — not
// committed to git, used for visual review.
const OUT_DIR = path.join(__dirname, "generated-card-art");
// Production output: the canonical banner the site actually loads. Vite
// serves /public/ at the site root, so a file written here becomes
// available at `/cartoon-banners/card-<id>.webp` immediately.
const PUBLIC_DIR = path.join(REPO_ROOT, "public", "cartoon-banners");
// Manifest the React app reads to know which card IDs have a cartoon
// banner. Rewritten after every successful card.
const MANIFEST_PATH = path.join(REPO_ROOT, "src", "app", "data", "cartoon-manifest.ts");

// Live data source — fetch real cards from the deployed Edge Function so
// titles, descriptions, and image URLs always match what users actually
// see. Hardcoding card data here was what caused the 1313 t-shirt /
// coloring-book mismatch in the original sample run.
const PROJECT_ID = "zkihnylrvdofdbnhmmoq";
const PUBLIC_ANON_KEY =
  "sb_publishable_leJ13K9-4bbJ4n9v_R68LA__A2GqGdx";
const ACTIONS_URL = `https://${PROJECT_ID}.supabase.co/functions/v1/make-server-9eb1ae04/actions?limit=2000`;

// How many cards to generate this run. Pass via env: COUNT=100 node ...
const COUNT = Number(process.env.COUNT ?? "100");

// Quality tier for gpt-image-1. Pass via env: QUALITY=medium node ...
// Options: "low" (~$0.02/image), "medium" (~$0.06/image), "high" (~$0.25/image),
// or "auto" (model picks — defaults to high for landscape sizes). Defaults
// to "low": a low/medium/high side-by-side on this flat comic style showed
// low holds up — clean faces and linework at our display sizes (416px grid,
// 720px modal) — while the medium→high gain is marginal. low is ~4× cheaper
// to generate AND ~2.5× lighter as a stored webp (71 KB vs 178 KB), which
// also helps the feed. Bump to medium only if a real batch disappoints.
const QUALITY = process.env.QUALITY ?? "low";

// Optional category filter. Pass via env: CATEGORY="Art/Performance Art" node ...
// Case-insensitive substring match against each card's category. Useful for
// generating just one category at a time so a budget bump only commits to
// that slice. Unset = all eligible cards (default behavior).
const CATEGORY = (process.env.CATEGORY ?? "").trim().toLowerCase();

// Stylization prompt — calibrated against the ResistAct "Smacks" infographic
// style: clean line work, optimistic palette, brand orange + navy + purple
// + sky blue + cream. NOT heavy 1960s protest-poster (too red, too grainy).
//
// Treat the reference image as INSPIRATION: capture the subject and spirit,
// but feel free to reinvent the composition to fit the wide banner shape.
// Not all source images work as banners as-is — some are square product
// photos, logos, or vertical portraits. The model has creative license to
// reframe.
//
// "No text/letters/numbers" is repeated because gpt-image-1 stubbornly
// invents protest signage even when forbidden.
const STYLE_PROMPT =
  "Create a clean modern comic-book illustration inspired by the reference image, adapted for a wide horizontal banner. " +
  "Use the reference for INSPIRATION — capture the subject, mood, and spirit — but feel free to reinvent the composition so it fills a wide banner format well. The reference may be a square photo, a logo, or a portrait; reframe it as a horizontal scene. Keep the same general subject matter (e.g. if the reference shows a protest sign, paint a protest scene; if a phone, paint someone using a phone; if a product, paint someone using or holding it). " +
  "Apply: clean black ink linework (refined, not heavy or grainy), flat colors with light gradient shading, subtle Ben-Day dot accents used sparingly only on skin tones or sky — not all over the image. " +
  "Palette: cream/off-white background as the foundation, warm orange (#ed6624) and soft red as accents, deep navy (#23297e) and rich purple (#5a3e9e) for structure, sky blue for openness, occasional muted teal or green. Optimistic, hopeful, vibrant feeling — not dark or overwhelming. " +
  "COMPOSITION — wide horizontal banner. CRITICAL: place the main subject (especially any face or head) in the UPPER portion of the frame so it stays visible when the banner is cropped to a narrow strip. Heads near the top, weight near the top. Background, hands, props, lower body, or ground can fill the bottom. " +
  "TEXT RULES — short real-word slogans on signs are FINE and on-style (STOP, NO ICE, RESIST, ABOLISH ICE, VOTE NO, NO WAR, etc.). " +
  "BUT NEVER: " +
  "(a) invent fake/nonsense words or gibberish letter combinations (e.g. no \"Sarcascitics\", no fake place names, no made-up brand names). " +
  "(b) render the card's own title as text painted into the image — the title appears separately above the banner in the UI, so painting it in the image is redundant. " +
  "(c) invent logos or fake brand wordmarks. " +
  "If you can't think of a real, accurate word to put on a sign, leave the sign blank or off-frame.";

// gpt-image-1's widest native size. That's the master we save — modal
// banners render the full 3:2; card grid banners use CSS object-cover to
// crop to ~4:1 at display time.
const GEN_SIZE = "1536x1024";
const GEN_W = 1536;
const GEN_H = 1024;

// Card-grid display dimensions for the preview thumbnail (sim of what the
// user will actually see in the feed). The grid banner is ~416×106.
const PREVIEW_W = 416;
const PREVIEW_H = 106;

/**
 * Pull all cards from the live API and filter to those that:
 *  - aren't the pinned Spread the Word card
 *  - haven't already been cartoonized (no cartoonImageUrl yet)
 * Cards without a usable topImageUrl go through the text-to-image
 * (`generations`) endpoint instead of image-to-image (`edits`) — the
 * ResistAct logo fallback is brand chrome, not subject matter, so feeding
 * it to the model as fodder produces off-topic results. Title +
 * description become the only inputs in that case.
 * Sorted by id ascending so the run is deterministic.
 */
async function fetchCards() {
  console.log(`Fetching cards from ${ACTIONS_URL}...`);
  const r = await fetch(ACTIONS_URL, {
    headers: { Authorization: `Bearer ${PUBLIC_ANON_KEY}` },
  });
  if (!r.ok) throw new Error(`actions endpoint ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const json = await r.json();
  const list = Array.isArray(json) ? json : (json.cards ?? json.data ?? []);
  console.log(`  got ${list.length} cards total`);
  const usable = list
    .filter((c) => !c.pinToTop)
    .filter((c) => !c.cartoonImageUrl)
    .filter((c) => !CATEGORY || (c.category ?? "").toLowerCase().includes(CATEGORY))
    .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  const withImage = usable.filter((c) => {
    const url = c.topImageUrl ?? c.topImage ?? "";
    return typeof url === "string" && url.startsWith("http");
  }).length;
  console.log(`  ${usable.length} cards eligible (not pinned, not yet cartoonized)`);
  console.log(`  ${withImage} have a reference image (use edits endpoint)`);
  console.log(`  ${usable.length - withImage} have no image (use generations endpoint)`);
  return usable;
}

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("Missing OPENAI_API_KEY env var");
  process.exit(1);
}

async function downloadImage(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to download ${url}: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return buf;
}

/**
 * gpt-image-1 /v1/images/edits accepts PNG. Convert whatever we downloaded
 * (jpg/webp/etc) to PNG before sending — keeps the API happy and lets sharp
 * normalize any weird color profiles.
 */
async function toPng(buf) {
  return await sharp(buf).png().toBuffer();
}

async function generateForCard(card) {
  console.log(`\n[${card.id}] ${card.title}`);
  const refUrl = card.topImageUrl ?? card.topImage;
  // Try /edits when there's a reference URL, but TRY-and-FALL-BACK rather
  // than skip-on-failure: if the download fails for ANY reason (expired
  // signed URL, deleted resource, host down, etc.), fall through to the
  // /generations text-to-image path using just title + description. That
  // way a card with a dead reference still gets a banner instead of being
  // skipped indefinitely.
  let refBuf = null;
  if (typeof refUrl === "string" && refUrl.startsWith("http")) {
    try {
      refBuf = await downloadImage(refUrl);
    } catch (err) {
      console.log(`  ref URL unreachable (${err.message.slice(0, 80)}), falling back to text-to-image`);
      refBuf = null;
    }
  }
  const hasRef = refBuf !== null;

  // Build the prompt: brand style + subject hint from BOTH title and
  // description so the model knows what the composition is about. The
  // description gives the model context the title alone often misses.
  const descSnippet = (card.description ?? "").trim().slice(0, 280);
  const prompt = `${STYLE_PROMPT}\n\nSubject: ${card.title}.\nContext: ${descSnippet}`;

  let rawOut;
  if (hasRef) {
    // Image-to-image: real reference photo/logo to riff on. We already
    // downloaded `refBuf` up top — just normalize to PNG.
    console.log(`  ref image: ${refUrl.slice(0, 80)}...`);
    const pngBuf = await toPng(refBuf);
    console.log(`  calling gpt-image-1 edits at ${GEN_SIZE}...`);
    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("prompt", prompt);
    form.append("size", GEN_SIZE);
    form.append("quality", QUALITY);
    form.append("n", "1");
    form.append(
      "image",
      new Blob([pngBuf], { type: "image/png" }),
      `card-${card.id}.png`,
    );
    const r = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: form,
    });
    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`OpenAI edits ${r.status}: ${errText.slice(0, 500)}`);
    }
    const json = await r.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) throw new Error(`No image data in edits response: ${JSON.stringify(json).slice(0, 400)}`);
    rawOut = Buffer.from(b64, "base64");
  } else {
    // Text-to-image: no real reference. The card had only the ResistAct
    // logo placeholder, which is brand chrome — useless as subject fodder.
    // Pure generations from title + description instead.
    console.log(`  no ref image (placeholder logo on card) → using generations endpoint`);
    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        size: GEN_SIZE,
        quality: QUALITY,
        n: 1,
      }),
    });
    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`OpenAI generations ${r.status}: ${errText.slice(0, 500)}`);
    }
    const json = await r.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) throw new Error(`No image data in generations response: ${JSON.stringify(json).slice(0, 400)}`);
    rawOut = Buffer.from(b64, "base64");
  }

  // Save the master at native 1536×1024 as webp. This is what the modal
  // banner will display — full 3:2 composition, model-painted (not cropped
  // from a square). WebP at q80 typically lands ~70-80× smaller than PNG.
  console.log(`  saving master webp at ${GEN_W}×${GEN_H}...`);
  const masterBuf = await sharp(rawOut)
    .webp({ quality: 80 })
    .toBuffer();
  // Write both to the dev folder (for debug review) and to the public
  // folder (what the live site actually serves).
  const masterPath = path.join(OUT_DIR, `card-${card.id}.webp`);
  const publicPath = path.join(PUBLIC_DIR, `card-${card.id}.webp`);
  await fs.writeFile(masterPath, masterBuf);
  await fs.writeFile(publicPath, masterBuf);

  // Also save a small preview webp at the actual card-grid render size with
  // object-cover behavior, so we can eyeball whether the composition still
  // makes sense at the small rectangle the grid uses.
  const previewBuf = await sharp(rawOut)
    .resize(PREVIEW_W, PREVIEW_H, { fit: "cover", position: "attention" })
    .webp({ quality: 80 })
    .toBuffer();
  const previewPath = path.join(OUT_DIR, `card-${card.id}-grid-preview.webp`);
  await fs.writeFile(previewPath, previewBuf);

  // Raw PNG kept too for side-by-side debugging if needed.
  const rawPath = path.join(OUT_DIR, `card-${card.id}-raw.png`);
  await fs.writeFile(rawPath, rawOut);

  console.log(`  master ${masterPath} (${(masterBuf.length / 1024).toFixed(0)} KB)`);
  console.log(`  preview ${previewPath} (${(previewBuf.length / 1024).toFixed(0)} KB)`);
}

/** Rewrite the cartoon-manifest.ts file from the current set of webps
 *  in public/cartoon-banners/. Called after every successful generation
 *  so a crash/interrupt mid-run still leaves a consistent manifest. */
async function writeManifest() {
  const files = await fs.readdir(PUBLIC_DIR).catch(() => []);
  const ids = files
    .filter((f) => /^card-\d+\.webp$/.test(f))
    .map((f) => Number(f.match(/^card-(\d+)\.webp$/)[1]))
    .sort((a, b) => a - b);
  const body = `/**
 * Manifest of card IDs that have a cartoonized banner in
 * \`public/cartoon-banners/card-{id}.webp\`.
 *
 * Auto-generated by \`scripts/generate-card-art.mjs\`. Hand edits will be
 * overwritten on the next generation run — if you want to remove a card
 * from cartoonization, also delete its webp from
 * \`public/cartoon-banners/\` so this list stays in sync.
 *
 * resolveCard() in App.tsx checks membership of this Set; matching cards
 * get \`cartoonImageUrl = "/cartoon-banners/card-\${id}.webp"\` set, which
 * ActionCard already prefers over the original topImage.
 */
export const CARTOON_IDS: ReadonlySet<number> = new Set([
  ${ids.join(", ")},
]);

/** Returns the public URL for a cartoonized banner, or null if the card
 *  hasn't been cartoonized yet. */
export function cartoonUrlFor(cardId: number | undefined | null): string | null {
  if (typeof cardId !== "number") return null;
  if (!CARTOON_IDS.has(cardId)) return null;
  return \`/cartoon-banners/card-\${cardId}.webp\`;
}
`;
  await fs.writeFile(MANIFEST_PATH, body);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  console.log(`Output dir: ${OUT_DIR}`);
  console.log(`Public dir: ${PUBLIC_DIR}`);
  console.log(`Manifest:   ${MANIFEST_PATH}`);
  console.log(`Target count: ${COUNT}`);
  console.log(`Quality tier: ${QUALITY}\n`);

  const allCards = await fetchCards();

  // Skip any cards we've already generated locally in a previous run so
  // re-running is incremental — only generates the next N missing cards.
  const existing = new Set(
    (await fs.readdir(OUT_DIR).catch(() => []))
      .filter((f) => /^card-\d+\.webp$/.test(f))
      .map((f) => Number(f.match(/^card-(\d+)\.webp$/)[1])),
  );
  const todo = allCards.filter((c) => !existing.has(c.id)).slice(0, COUNT);
  console.log(`Skipping ${existing.size} already-generated cards.`);
  console.log(`Generating ${todo.length} new cards this run.\n`);

  let ok = 0;
  let fail = 0;
  for (const card of todo) {
    try {
      await generateForCard(card);
      ok++;
      // Refresh the manifest after every card so the React app picks up
      // newly-generated banners even mid-run (HMR will reload on save).
      await writeManifest();
    } catch (err) {
      console.error(`  ✗ ${card.id} failed: ${err.message}`);
      fail++;
    }
  }

  // Final manifest write (in case the very last card succeeded — no-op
  // otherwise since we wrote after each success).
  await writeManifest();

  console.log(`\nDone. ${ok} succeeded, ${fail} failed.`);
  console.log(`Public banners: ${PUBLIC_DIR}`);
  console.log(`Manifest:       ${MANIFEST_PATH}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
