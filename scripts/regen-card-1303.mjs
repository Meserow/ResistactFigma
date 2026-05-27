// One-off: regenerate card 1303 ("Buy a Fifth Amendment Sticker or Magnet
// — 50% to Immigrant Rights Orgs" — Dissent Pins).
//
// Why a dedicated script:
//   The original run fed the live product photo (a bumper sticker on white)
//   to /edits. The model latched onto the "person holding a sign" motif
//   from elsewhere in the comic style guide and painted a generic protester
//   holding a BLANK orange sign — completely losing the actual subject
//   (the sticker/magnet itself). The card reads as merch purchase, not a
//   protest.
//
//   This script switches to TEXT-TO-IMAGE (/generations) and pins the
//   subject explicitly on the merch: a bumper sticker and a fridge magnet
//   sitting on a tabletop, with hands applying one to a laptop in the
//   background. No protest crowd, no signs, no slogans — this is a
//   commerce action, not a march.
//
//   Same no-text discipline as card 1108: gpt-image-1 will want to invent
//   legible-looking type on the sticker. We forbid it three times and
//   describe an abstract design (scales of justice icon, simple stripe
//   motif) so there's nothing for letters to attach to.
//
// Run:
//   OPENAI_API_KEY=sk-... node scripts/regen-card-1303.mjs

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

const STYLE_PROMPT =
  "Create a clean modern comic-book illustration adapted for a wide horizontal banner. " +
  "Clean black ink linework (refined, not heavy or grainy), flat colors with light gradient shading, subtle Ben-Day dot accents used sparingly only on skin tones or sky. " +
  "Palette: cream/off-white background, warm orange (#ed6624), deep navy (#23297e), rich purple (#5a3e9e), sky blue, occasional muted teal. Optimistic, hopeful, vibrant — not dark or overwhelming. " +
  "COMPOSITION — wide horizontal banner. Main subject in the UPPER portion of the frame so it survives cropping to a narrow strip. " +
  "ABSOLUTELY NO TEXT, NO LETTERS, NO NUMBERS, NO WORDS, NO SIGNS WITH TEXT, NO POSTERS WITH SLOGANS, NO BOOK TITLES, NO LOGOS, NO WORDMARKS — anywhere in the image. " +
  "If a sticker, magnet, banner, or sign appears in the scene, it must show only abstract iconography (e.g. scales of justice icon, simple stripe pattern, geometric shape) — NEVER any readable letters or numbers. " +
  "This rule is non-negotiable: a previous generation invented fake misspelled words and we cannot allow that again.";

const SUBJECT =
  "A cheerful flat-lay scene of resistance merchandise on a warm wooden tabletop: a horizontal rectangular bumper sticker (orange and navy, featuring a stylized scales-of-justice icon — no text), a round fridge magnet beside it (purple with a small abstract emblem — no text), and a pair of hands in the upper portion of the frame applying another sticker to the back of an open laptop. Soft cream background. Hopeful, indie-shop, kitchen-table feeling. No protest signs, no crowd, no banners with writing.";

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(PUBLIC_DIR, { recursive: true });

  const prompt = `${STYLE_PROMPT}\n\nSubject: ${SUBJECT}`;
  console.log(`[1303] regenerating "Buy a Fifth Amendment Sticker..." — Dissent Pins`);
  console.log(`  quality: ${QUALITY}`);
  console.log(`  endpoint: /v1/images/generations (text-to-image, ignoring product photo)\n`);

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

  const masterBuf = await sharp(rawOut).webp({ quality: 80 }).toBuffer();
  const previewBuf = await sharp(rawOut)
    .resize(416, 106, { fit: "cover", position: "attention" })
    .webp({ quality: 80 })
    .toBuffer();

  const masterPath = path.join(OUT_DIR, "card-1303.webp");
  const publicPath = path.join(PUBLIC_DIR, "card-1303.webp");
  const previewPath = path.join(OUT_DIR, "card-1303-grid-preview.webp");
  const rawPath = path.join(OUT_DIR, "card-1303-raw.png");

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
