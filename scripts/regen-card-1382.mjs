// One-off: regenerate card 1382 ("Color Through Trump 2.0 with Fresh Prints'
// Anti-Trump Resistance Coloring Book").
//
// Why: the existing cartoon banner has misspelled headline text — it reads
// "COLORIG THRONGH" instead of "COLORING THROUGH". gpt-image-1 mangled the
// long slogan. This script re-runs the SAME comic scene via /edits (using the
// current banner as the style/composition reference) but pins the exact,
// correctly-spelled text. We generate N candidates in one run so we can read
// each and pick the one that actually spelled everything right.
//
// Generation only — does NOT upload. Inspect the candidates first, then the
// chosen webp gets uploaded to Supabase Storage separately.
//
// Run:
//   OPENAI_API_KEY=sk-... node scripts/regen-card-1382.mjs

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "generated-card-art");
const GEN_SIZE = "1536x1024";
const QUALITY = process.env.QUALITY ?? "high"; // high — text legibility matters here
const N = Number(process.env.N ?? "3");

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("Missing OPENAI_API_KEY env var");
  process.exit(1);
}

// Current live banner — used as the style/composition reference so the
// regenerated art keeps the look the user already approved.
const REF_URL =
  "https://zkihnylrvdofdbnhmmoq.supabase.co/storage/v1/object/public/cartoon-banners/card-1382.webp";

const PROMPT =
  "Recreate this comic-book illustration in the SAME style, palette, and composition — a cheerful person holding a colored pencil and an 'ANTI-TRUMP RESISTANCE COLORING' sign, with a big headline banner behind them, raised fists, clouds, cream/orange/navy palette, clean comic linework. " +
  "The ONLY change: FIX THE MISSPELLED TEXT. Render every word correctly and legibly. " +
  "The large headline banner must read EXACTLY, spelled correctly: \"COLORING THROUGH (EVEN MORE) TRUMP 2.0\". " +
  "The sign the person holds must read EXACTLY, spelled correctly: \"ANTI-TRUMP RESISTANCE COLORING\". " +
  "Double-check spelling: C-O-L-O-R-I-N-G (not COLORIG), T-H-R-O-U-G-H (not THRONGH). " +
  "Do not invent any other words, gibberish, or extra signage. Keep all other elements the same.";

async function downloadPng(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`ref download ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return await sharp(buf).png().toBuffer();
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log(`[1382] regenerating coloring-book banner — fixing misspelled headline`);
  console.log(`  quality=${QUALITY}  candidates=${N}  endpoint=/v1/images/edits\n`);

  const refPng = await downloadPng(REF_URL);
  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("prompt", PROMPT);
  form.append("size", GEN_SIZE);
  form.append("quality", QUALITY);
  form.append("n", String(N));
  form.append("image", new Blob([refPng], { type: "image/png" }), "card-1382.png");

  const r = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
  if (!r.ok) throw new Error(`OpenAI edits ${r.status}: ${(await r.text()).slice(0, 500)}`);
  const json = await r.json();
  const items = json?.data ?? [];
  if (!items.length) throw new Error(`No image data: ${JSON.stringify(json).slice(0, 300)}`);

  for (let i = 0; i < items.length; i++) {
    const raw = Buffer.from(items[i].b64_json, "base64");
    const candPath = path.join(OUT_DIR, `card-1382-cand-${i + 1}.png`);
    await fs.writeFile(candPath, raw);
    // also a small preview to eyeball grid legibility
    const prev = await sharp(raw).resize(416, 106, { fit: "cover", position: "attention" }).webp({ quality: 80 }).toBuffer();
    await fs.writeFile(path.join(OUT_DIR, `card-1382-cand-${i + 1}-grid.webp`), prev);
    console.log(`  ✓ candidate ${i + 1} → ${candPath} (${(raw.length / 1024).toFixed(0)} KB)`);
  }
  console.log(`\nDone. Inspect the candidates, then promote the chosen one to a webp + upload.`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
