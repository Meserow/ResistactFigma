// One-off, throwaway: generate the SAME cartoon banner at low / medium / high
// so we can eyeball whether `low` is good enough for the house comic style.
// Identical prompt + size; only the quality tier changes. A single large
// protagonist face is in the prompt on purpose — faces are where gpt-image-1's
// low tier is most likely to wobble, so that's the thing to judge.
//
// Run:
//   OPENAI_API_KEY=sk-... node scripts/quality-compare.mjs
//
// Outputs scripts/generated-card-art/qtest-<tier>.png (raw 1536×1024) and a
// matching .webp. Delete the whole qtest-* set when done — not a real card.

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "generated-card-art");
const GEN_SIZE = "1536x1024";
const TIERS = ["low", "medium", "high"];

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("Missing OPENAI_API_KEY env var");
  process.exit(1);
}

// Mirrors the house CARTOON_STYLE_PROMPT, trimmed to the visual style + one
// face-forward protagonist so the face/linework fidelity is what differs.
const PROMPT =
  "Create a clean modern comic-book illustration for a wide horizontal banner. " +
  "Clean black ink linework (refined, not heavy or grainy), flat colors with light gradient shading, subtle Ben-Day dot accents used sparingly on skin tones and sky. " +
  "Palette: cream/off-white background, warm orange (#ed6624), deep navy (#23297e), rich purple (#5a3e9e), sky blue. Optimistic, hopeful, vibrant. " +
  "SUBJECT: a single confident young protester — warm brown skin, short dark curls, mid-twenties — shown three-quarter view, head and shoulders filling the UPPER CENTER of the frame, calm determined expression, wearing an orange t-shirt, one fist raised. " +
  "BACKGROUND (lower and sides): a few smaller marchers and a rainbow flag against a soft cloud-and-sky-blue backdrop with light Ben-Day dots. Keep the protagonist's face the clear focal point. " +
  "Composition is a wide horizontal banner; keep the head near the top so it survives a narrow crop.";

async function genTier(tier) {
  console.log(`\n[${tier}] calling gpt-image-1 /generations at ${GEN_SIZE}...`);
  const t0 = Date.now();
  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: "gpt-image-1", prompt: PROMPT, size: GEN_SIZE, quality: tier, n: 1 }),
  });
  if (!r.ok) throw new Error(`[${tier}] OpenAI ${r.status}: ${(await r.text()).slice(0, 400)}`);
  const json = await r.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`[${tier}] no image data: ${JSON.stringify(json).slice(0, 300)}`);
  const raw = Buffer.from(b64, "base64");
  const webp = await sharp(raw).webp({ quality: 80 }).toBuffer();
  const rawPath = path.join(OUT_DIR, `qtest-${tier}.png`);
  const webpPath = path.join(OUT_DIR, `qtest-${tier}.webp`);
  await fs.writeFile(rawPath, raw);
  await fs.writeFile(webpPath, webp);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  ✓ ${tier}: raw ${(raw.length / 1024).toFixed(0)} KB, webp ${(webp.length / 1024).toFixed(0)} KB  (${secs}s)`);
  return { tier, rawKB: Math.round(raw.length / 1024), webpKB: Math.round(webp.length / 1024) };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const rows = [];
  for (const tier of TIERS) rows.push(await genTier(tier));
  console.log("\n=== summary (webp = what we'd actually store) ===");
  for (const r of rows) console.log(`  ${r.tier.padEnd(6)} raw ${String(r.rawKB).padStart(5)} KB   webp ${String(r.webpKB).padStart(4)} KB`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
