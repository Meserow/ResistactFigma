// One-off: cartoon banner for the MoveOn "No Iran War" billboard fundraiser
// (Act added 2026-05-27 via the one-off inbox import).
//
// Why a dedicated script:
//   The source material is a billboard photo SATURATED with text — "$50
//   BILLION + WAR", "TRUMP'S AND HEGSETH'S $50 BILLION WAR COSTS US AT THE
//   PUMP", "MOVEON.ORG/NOIRANWAR", plus gas prices. Feeding that to /edits
//   would make gpt-image-1 fight the no-text rule (it'll try to recreate
//   readable type, and the style prompt forbids that emphatically — see
//   card 1108 and 1303 for prior burns).
//
//   So this is TEXT-TO-IMAGE (/generations), no reference image. The
//   subject communicates the Act through composition + iconography only:
//   a big roadside billboard whose surface shows an abstract jet-contrail
//   emblem and a simple dollar sigil, looming over a gas pump and a car
//   below. The viewer reads "war is expensive at the pump" without a
//   single legible letter on the billboard.
//
// Card ID:
//   Set CARD_ID to whatever the /admin/bulk-import response returns for
//   this Act. Default is unset — the script will refuse to run without it
//   so we don't accidentally overwrite an existing card-NNNN.webp.
//
// Run (after /process-inbox returns the assigned ID):
//   OPENAI_API_KEY=sk-... CARD_ID=1272 node scripts/regen-card-moveon-noiranwar.mjs

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

const CARD_ID = process.env.CARD_ID;
if (!CARD_ID || !/^\d+$/.test(CARD_ID)) {
  console.error("Set CARD_ID=<numeric-id> env var — the ID assigned by /process-inbox.");
  console.error("e.g.  CARD_ID=1272 OPENAI_API_KEY=sk-... node scripts/regen-card-moveon-noiranwar.mjs");
  process.exit(1);
}

const STYLE_PROMPT =
  "Create a clean modern comic-book illustration adapted for a wide horizontal banner. " +
  "Clean black ink linework (refined, not heavy or grainy), flat colors with light gradient shading, subtle Ben-Day dot accents used sparingly only on skin tones or sky. " +
  "Palette: cream/off-white background, warm orange (#ed6624), deep navy (#23297e), rich purple (#5a3e9e), sky blue, occasional muted teal. Optimistic, hopeful, vibrant — not dark or overwhelming. " +
  "COMPOSITION — wide horizontal banner. Main subject in the UPPER portion of the frame so it survives cropping to a narrow strip. " +
  "ABSOLUTELY NO TEXT, NO LETTERS, NO NUMBERS, NO WORDS, NO SIGNS WITH TEXT, NO POSTERS WITH SLOGANS, NO BOOK TITLES, NO LOGOS, NO WORDMARKS — anywhere in the image. " +
  "The billboard surface must show only abstract iconography (a stylized fighter-jet silhouette with a curved contrail, a simple dollar-sign sigil) — NEVER any readable letters or numbers. The gas pump face is BLANK (no price digits, no brand). License plates are BLANK. " +
  "This rule is non-negotiable: previous generations invented misspelled words on billboards and signage and we cannot allow that again.";

const SUBJECT =
  "A wide horizontal scene of a giant rectangular highway billboard mounted on steel struts against a clear sky blue sky with a few small clouds. The billboard is the dominant element, filling the upper two-thirds of the frame, viewed from a slight upward angle as if from a driver's seat on the road below. " +
  "The billboard surface is divided into two flat-color zones: a deep navy (#23297e) left half showing a stylized orange (#ed6624) fighter-jet silhouette leaving a single curved contrail toward the upper-right corner, and an orange (#ed6624) right half showing a simple white dollar-sign sigil. Crisp black ink linework around the billboard frame. NO text, NO numbers, NO letters anywhere on the billboard. " +
  "In the lower foreground (bottom third of the frame): a small section of asphalt road, the top of a purple (#5a3e9e) gas pump on the left with a BLANK display face (no price digits, no brand mark), and a navy compact car parked at the pump on the right with a BLANK license plate. Tiny figure of one driver standing beside the car, looking UP toward the billboard, head tilted. " +
  "Sky has subtle Ben-Day dot accents in pale cream. Mood: hopeful civic awakening — drivers noticing political messaging in everyday life. No protest crowd, no signs with writing, no other billboards.";

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(PUBLIC_DIR, { recursive: true });

  const prompt = `${STYLE_PROMPT}\n\nSubject: ${SUBJECT}`;
  console.log(`[card-${CARD_ID}] generating "Chip in to run MoveOn's 'No Iran War' billboards…"`);
  console.log(`  quality: ${QUALITY}`);
  console.log(`  endpoint: /v1/images/generations (text-to-image, no reference)\n`);

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

  const masterPath = path.join(OUT_DIR, `card-${CARD_ID}.webp`);
  const publicPath = path.join(PUBLIC_DIR, `card-${CARD_ID}.webp`);
  const previewPath = path.join(OUT_DIR, `card-${CARD_ID}-grid-preview.webp`);
  const rawPath = path.join(OUT_DIR, `card-${CARD_ID}-raw.png`);

  await fs.writeFile(masterPath, masterBuf);
  await fs.writeFile(publicPath, masterBuf);
  await fs.writeFile(previewPath, previewBuf);
  await fs.writeFile(rawPath, rawOut);

  console.log(`  ✓ master   ${(masterBuf.length / 1024).toFixed(0)} KB → ${publicPath}`);
  console.log(`  ✓ preview  ${(previewBuf.length / 1024).toFixed(0)} KB → ${previewPath}`);
  console.log(`  ✓ raw      ${(rawOut.length / 1024).toFixed(0)} KB → ${rawPath}`);
  console.log(`\nDone. Don't forget to add ${CARD_ID} to src/app/data/cartoon-manifest.ts`);
  console.log(`(or set cartoonImageUrl on the card via admin panel).`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
