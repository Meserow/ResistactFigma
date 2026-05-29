// One-off: cartoonize the user-supplied MoveOn "$50 BILLION WAR" ad via
// gpt-image-1 /v1/images/edits — image-to-image style transfer from the
// real reference. Output keeps the original composition + faces; restyles
// into the ResistAct cartoon look.
//
// Run:
//   OPENAI_API_KEY=sk-... node scripts/cartoonize-moveon-50b-edits.mjs

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error("Missing OPENAI_API_KEY"); process.exit(1); }

const REF_PATH = path.join(os.homedir(), "Desktop", "50billion.jpg");

const STYLE = `Restyle this reference image as a clean modern comic-book illustration adapted for a wide horizontal banner.
Keep the original composition and the key elements: the "$50 BILLION WAR" red block letters with a small jet and cloud, the shouting middle-aged politician in suit and tie, the gas-station price sign showing "REGULAR 4.56 / PLUS 5.04 / PREMIUM 5.40", the "WAR COSTS US AT THE PUMP" headline strip across the bottom, and the "NO IRAN WAR" badge.
Apply: clean black ink linework (refined, not heavy), flat colors with light gradient shading, subtle Ben-Day dot accents used sparingly on skin tones or sky.
Palette swap: trade the original solid-black background for cream/off-white (#fff8f3). Keep red-orange (#ed6624) for the "$50 BILLION WAR" letters, deep navy (#23297e) for the suit and headline strip, sky blue for clouds.
COMPOSITION — wide horizontal banner, main subject (politician's face) in the upper portion of the frame.
TEXT RULES — preserve the real-word slogans verbatim ("$50 BILLION", "WAR", "NO IRAN WAR", "WAR COSTS US AT THE PUMP", "REGULAR 4.56", "PLUS 5.04", "PREMIUM 5.40"). NEVER invent fake or nonsense words.`;

console.log(`Reading reference image: ${REF_PATH}`);
const refBuf = await fs.readFile(REF_PATH);
console.log(`  ${(refBuf.length / 1024).toFixed(0)} KB original`);

const pngBuf = await sharp(refBuf).png().toBuffer();
console.log(`  normalized to PNG (${(pngBuf.length / 1024).toFixed(0)} KB)`);

const form = new FormData();
form.append("model", "gpt-image-1");
form.append("prompt", STYLE);
form.append("size", "1536x1024");
form.append("quality", "medium");
form.append("n", "1");
form.append("image", new Blob([pngBuf], { type: "image/png" }), "50billion.png");

console.log(`Calling gpt-image-1 /edits at 1536×1024, medium quality...`);
const r = await fetch("https://api.openai.com/v1/images/edits", {
  method: "POST",
  headers: { Authorization: `Bearer ${API_KEY}` },
  body: form,
});
if (!r.ok) { console.error(`OpenAI ${r.status}:`, (await r.text()).slice(0, 600)); process.exit(1); }
const json = await r.json();
const b64 = json?.data?.[0]?.b64_json;
if (!b64) { console.error("No image data"); process.exit(1); }

const outBuf = Buffer.from(b64, "base64");
const webp = await sharp(outBuf).webp({ quality: 80 }).toBuffer();
const outPath = "/tmp/moveon-50b-war-edits.webp";
await fs.writeFile(outPath, webp);
console.log(`\nSaved ${outPath}  (${(webp.length / 1024).toFixed(0)} KB)`);
