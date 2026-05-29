// One-off: regenerate card 201 ("Training from WAISN deportation-defense" —
// Washington Immigrant Solidarity Network).
//
// Why a dedicated script:
//   The original run fed picsum.photos/seed/ra201/800/450 (a deterministic-
//   random stock photo) to /edits. That seed happened to produce something
//   tangled and leaf-ish, which gpt-image-1 rendered as a giant pile of
//   GREEN BEANS. The card is about rapid-response training to document ICE
//   activity — there is no vegetable angle. Picsum-random source images
//   were a mistake for content cards where the subject matters.
//
//   This script switches to TEXT-TO-IMAGE (/generations) and pins the
//   subject explicitly on the actual Act: a community training scene with
//   a smartphone (abstract record dot, no text) and a small circle of
//   trainees. The verb of the Act is "Get trained to document," so the
//   composition centers a phone in a steady hand with attentive community
//   members around it.
//
//   Same no-text discipline as cards 1108/1303/MoveOn: phone screen shows
//   only a red record dot, no UI chrome, no clock, no titles. Notebooks
//   and whiteboards in the scene are BLANK.
//
// Run:
//   OPENAI_API_KEY=sk-... node scripts/regen-card-201.mjs

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
const CARD_ID = "201";

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
  "If a notebook, whiteboard, clipboard, phone screen, or sign appears, it must be BLANK or show only abstract iconography (a red recording dot, a simple geometric symbol). NEVER any readable letters or numbers. " +
  "Absolutely no vegetables, no produce, no green beans, no leaves or vines as a primary motif — this card is about people training each other, not gardening.";

const SUBJECT =
  "A warm community-training scene in a sunlit room. UPPER CENTER of the frame: a confident woman instructor (warm brown skin, dark hair pulled back, navy denim jacket over a cream shirt) standing and holding up a smartphone in her right hand at chest height, screen facing the viewer. The phone screen is a flat dark navy rectangle with a single small red recording dot in the corner — no text, no UI chrome, no time display, no app icons. Her left hand is open in a calm explaining gesture. " +
  "LOWER FOREGROUND (bottom third of frame): three attentive trainees seated on simple wooden chairs, viewed from a slight three-quarter angle so we see their backs and shoulders — one Black woman with short curly hair in a purple sweater, one older Latino man in a warm orange button-down, one young East Asian person in a teal shirt. Each holds a small BLANK notebook in their lap (no text, no lines, no logo). One is taking notes with a pencil. " +
  "BACKGROUND: a cream-colored interior wall with a single tall window showing pale sky-blue. Subtle Ben-Day dot accents on the wall and sky. A single potted plant in the corner with simple round leaves (NOT beans, NOT vines). " +
  "Mood: solidarity, calm focus, neighbors-teaching-neighbors. Hopeful and intimate. No protest signs, no megaphones, no enforcement officers — this is a peaceful training room, not a confrontation.";

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(PUBLIC_DIR, { recursive: true });

  const prompt = `${STYLE_PROMPT}\n\nSubject: ${SUBJECT}`;
  console.log(`[${CARD_ID}] regenerating "Training from WAISN deportation-defense"`);
  console.log(`  quality: ${QUALITY}`);
  console.log(`  endpoint: /v1/images/generations (text-to-image — replacing the green-bean original)\n`);

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
  console.log(`\nDone. Hard-refresh the browser (Cmd+Shift+R) — same filename, so cache may stick.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
