#!/usr/bin/env node
/**
 * Targeted cartoon-banner generation for the Mobilize-import batch
 * (cards 2412–2532). Unlike generate-card-art.mjs (which sweeps the whole
 * live feed), this drives off an explicit input file so it ONLY touches the
 * new cards — no risk of regenerating existing banners.
 *
 * Input:  /tmp/gen_input.json  = [{ id, title, description }, ...]
 * Output: public/cartoon-banners/card-<id>.webp  (what the site serves)
 *         scripts/generated-card-art/card-<id>.webp  (dev review copy)
 *         appends each finished id to /tmp/done_ids.txt
 *
 * These cards have NO reference image, so every one uses the text-to-image
 * (/v1/images/generations) endpoint with title + description as the subject.
 * Style prompt mirrors generate-card-art.mjs / CARTOON_STYLE_PROMPT.
 *
 * Run:
 *   OPENAI_API_KEY=sk-... QUALITY=medium LIMIT=1 node scripts/gen-mobilize-art.mjs
 *   (LIMIT/OFFSET let you smoke-test a slice before the full run.)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(__dirname, "generated-card-art");
const PUBLIC_DIR = path.join(REPO_ROOT, "public", "cartoon-banners");
const INPUT = process.env.INPUT ?? "/tmp/gen_input.json";
const DONE_LOG = process.env.DONE_LOG ?? "/tmp/done_ids.txt";

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error("Missing OPENAI_API_KEY"); process.exit(1); }
const QUALITY = process.env.QUALITY ?? "medium";
const GEN_SIZE = "1536x1024";
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
const OFFSET = process.env.OFFSET ? Number(process.env.OFFSET) : 0;

const STYLE_PROMPT =
  "Create a clean modern comic-book illustration for a wide horizontal banner. " +
  "POLITICAL STANCE — NON-NEGOTIABLE: this is an anti-Trump, pro-democracy resistance platform. The image MUST read as OPPOSING Trump/MAGA. Sympathetic characters are everyday people RESISTING — activists, organizers, neighbors taking civic action. NEVER depict anyone wearing or celebrating pro-Trump/MAGA gear. If Trump/ICE/MAGA appear, they must be in a clearly critical/oppositional framing (on a sign being rejected, crossed out) — never glorified. When in doubt, leave Trump out and show the positive civic action. " +
  "Apply: clean black ink linework (refined, not heavy or grainy), flat colors with light gradient shading, subtle Ben-Day dot accents used sparingly only on skin tones or sky. " +
  "Palette: cream/off-white background foundation, warm orange (#ed6624) and soft red accents, deep navy (#23297e) and rich purple (#5a3e9e) for structure, sky blue for openness, occasional muted teal or green. Optimistic, hopeful, vibrant — not dark. " +
  "COMPOSITION — wide horizontal banner. Place the main subject (especially any face/head) in the UPPER portion so it survives cropping to a narrow strip. " +
  "TEXT RULES — short real-word slogans on signs are fine (RESIST, NO ICE, NO KINGS, VOTE NO, etc.). NEVER invent fake/nonsense words, gibberish, fake place names, or fake logos. NEVER paint the card's own title into the image. If you can't think of a real accurate word, leave the sign blank or off-frame.";

async function genOne(card) {
  const desc = (card.description ?? "").trim().slice(0, 280);
  const prompt = `${STYLE_PROMPT}\n\nSubject: ${card.title}.\nContext: ${desc}`;
  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: "gpt-image-1", prompt, size: GEN_SIZE, quality: QUALITY, n: 1 }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`no image data: ${JSON.stringify(j).slice(0, 200)}`);
  const webp = await sharp(Buffer.from(b64, "base64")).webp({ quality: 80 }).toBuffer();
  await fs.writeFile(path.join(PUBLIC_DIR, `card-${card.id}.webp`), webp);
  await fs.writeFile(path.join(OUT_DIR, `card-${card.id}.webp`), webp);
  await fs.appendFile(DONE_LOG, `${card.id}\n`);
  return webp.length;
}

const all = JSON.parse(await fs.readFile(INPUT, "utf8"));
await fs.mkdir(OUT_DIR, { recursive: true });
await fs.mkdir(PUBLIC_DIR, { recursive: true });
const slice = all.slice(OFFSET, OFFSET + LIMIT);
console.log(`Generating ${slice.length} of ${all.length} (offset ${OFFSET}, quality ${QUALITY})`);

let ok = 0, fail = 0;
for (let i = 0; i < slice.length; i++) {
  const c = slice[i];
  try {
    const bytes = await genOne(c);
    ok++;
    console.log(`[${i + 1}/${slice.length}] OK  ${c.id}  ${(bytes / 1024).toFixed(0)}KB  ${c.title.slice(0, 60)}`);
  } catch (e) {
    fail++;
    console.log(`[${i + 1}/${slice.length}] FAIL ${c.id}  ${String(e.message).slice(0, 120)}`);
  }
}
console.log(`\nDone. ok=${ok} fail=${fail}`);
