// One-off: regenerate card 1108 ("Subscribe to actions" — Faithful America).
//
// Why a dedicated script:
//   The card had no topImageUrl (just a placeholder logo), so the original
//   run went through the /generations text-to-image path. gpt-image-1
//   painted a protest sign reading "SUBSCRITE TO ACTIONS" — exactly the
//   gibberish the main style prompt tries to forbid but produces anyway
//   when it tries to render the card title as poster text.
//
//   This script:
//     • forces text-to-image (the card has no real reference image)
//     • uses an aggressively text-banning prompt — NO letters, NO words,
//       NO signs with text at all. Foreground signs must be BLANK or
//       absent. (We can't trust gpt-image-1 to render "SUBSCRIBE" cleanly.)
//     • leans into faith iconography (cross, candles, stained glass light)
//       so the visual still telegraphs "Faithful America / religious
//       dissent" without depending on legible signage.
//     • overwrites both ./scripts/generated-card-art/card-1108.webp and
//       ./public/cartoon-banners/card-1108.webp on success. The cartoon
//       manifest already lists 1108, so no manifest rewrite is needed.
//
// Run:
//   OPENAI_API_KEY=sk-... node scripts/regen-card-1108.mjs

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(__dirname, "generated-card-art");
const PUBLIC_DIR = path.join(REPO_ROOT, "public", "cartoon-banners");
const GEN_SIZE = "1536x1024";
const QUALITY = process.env.QUALITY ?? "medium";

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("Missing OPENAI_API_KEY env var");
  process.exit(1);
}

// Tighter style prompt than the main script's. The two biggest changes:
//   (1) "NO TEXT ANYWHERE" repeated multiple times in different framings.
//       gpt-image-1 reliably violates one mention; harder to violate three.
//   (2) Subject anchored on faith imagery, not protest signage — so even
//       if the model wants to invent letters, there are no signs to put
//       them on.
const STYLE_PROMPT =
  "Create a clean modern comic-book illustration adapted for a wide horizontal banner. " +
  "Clean black ink linework (refined, not heavy or grainy), flat colors with light gradient shading, subtle Ben-Day dot accents used sparingly only on skin tones or sky. " +
  "Palette: cream/off-white background, warm orange (#ed6624), deep navy (#23297e), rich purple (#5a3e9e), sky blue, occasional muted teal. Optimistic, hopeful, vibrant — not dark or overwhelming. " +
  "COMPOSITION — wide horizontal banner. Place the main subject (face or head) in the UPPER portion of the frame so it survives cropping to a narrow strip. " +
  "ABSOLUTELY NO TEXT, NO LETTERS, NO NUMBERS, NO WORDS, NO SIGNS WITH TEXT, NO BANNERS WITH WRITING, NO POSTERS WITH SLOGANS, NO BOOK TITLES, NO LOGOS, NO WORDMARKS — anywhere in the image. " +
  "If the scene would naturally contain a sign, poster, book, or banner, leave it BLANK or omit it entirely. NEVER paint letters of any kind. " +
  "This rule is non-negotiable: the previous generation invented a fake misspelled word and we cannot allow that again.";

const SUBJECT =
  "A diverse group of people of faith gathered in quiet solidarity — a young woman with thoughtful eyes in the foreground, a small wooden cross on a chain visible at her neck, a stained-glass window or church silhouette softly visible behind. Warm light. Hands clasped or raised in hopeful, peaceful gesture. No signs, no banners, no text of any kind. The mood is religious dissent: faith mobilized for justice, calm and resolute.";

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(PUBLIC_DIR, { recursive: true });

  const prompt = `${STYLE_PROMPT}\n\nSubject: ${SUBJECT}`;
  console.log(`[1108] regenerating "Subscribe to actions" — Faithful America`);
  console.log(`  quality: ${QUALITY}`);
  console.log(`  endpoint: /v1/images/generations (no source image)\n`);

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
  if (!b64) throw new Error(`No image data: ${JSON.stringify(json).slice(0, 400)}`);
  const rawOut = Buffer.from(b64, "base64");

  // Same encoding pipeline as generate-card-art.mjs: webp q80 master to
  // both the scratch dir and the public dir, plus a raw PNG for debugging.
  const masterBuf = await sharp(rawOut).webp({ quality: 80 }).toBuffer();
  const previewBuf = await sharp(rawOut)
    .resize(416, 106, { fit: "cover", position: "attention" })
    .webp({ quality: 80 })
    .toBuffer();

  const masterPath = path.join(OUT_DIR, "card-1108.webp");
  const publicPath = path.join(PUBLIC_DIR, "card-1108.webp");
  const previewPath = path.join(OUT_DIR, "card-1108-grid-preview.webp");
  const rawPath = path.join(OUT_DIR, "card-1108-raw.png");

  await fs.writeFile(masterPath, masterBuf);
  await fs.writeFile(publicPath, masterBuf);
  await fs.writeFile(previewPath, previewBuf);
  await fs.writeFile(rawPath, rawOut);

  console.log(`  ✓ master   ${(masterBuf.length / 1024).toFixed(0)} KB → ${publicPath}`);
  console.log(`  ✓ preview  ${(previewBuf.length / 1024).toFixed(0)} KB → ${previewPath}`);
  console.log(`  ✓ raw      ${(rawOut.length / 1024).toFixed(0)} KB → ${rawPath}`);
  console.log(`\nDone. Reload the browser to see the new banner.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
