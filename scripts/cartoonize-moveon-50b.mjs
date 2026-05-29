// One-off: cartoonize the MoveOn "$50 BILLION WAR" ad in the ResistAct
// style. Generates fresh via gpt-image-1 /v1/images/generations using a
// text description of the original ad.
//
// Run:
//   OPENAI_API_KEY=sk-... node scripts/cartoonize-moveon-50b.mjs

import fs from "node:fs/promises";
import sharp from "sharp";

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error("Missing OPENAI_API_KEY"); process.exit(1); }

const STYLE = `Create a clean modern comic-book illustration adapted for a wide horizontal banner.
Clean black ink linework (refined, not heavy), flat colors with light gradient shading, subtle Ben-Day dot accents used sparingly only on skin tones or sky.
Palette: cream/off-white background, warm orange (#ed6624), deep navy (#23297e), rich purple (#5a3e9e), sky blue, occasional muted teal. Vintage editorial protest-poster feel.
COMPOSITION — wide horizontal banner, subjects in the UPPER portion of the frame.
TEXT RULES — short real-word slogans are FINE on signs and posters ("$50 BILLION", "WAR", "NO IRAN WAR"). NEVER invent fake/nonsense words.`;

const SUBJECT = `A cartoon-style protest poster banner. Left side: huge bold red and cream block letters reading "$50 BILLION WAR" with a small jet silhouette and cartoon clouds tucked into the text.
Center: a stern middle-aged man in a navy suit and red tie, mouth open mid-shout, drawn as a comic-book caricature with a stylized face — clearly an angry war-pitch politician archetype, not a specific real person.
Right side: a classic American gas station price sign on a tall navy post, showing "REGULAR  4.56 / PLUS  5.04 / PREMIUM  5.40" in cream digits on a black panel.
Bottom band: cream-colored ribbon with bold navy text "WAR COSTS US AT THE PUMP" reading edge to edge.
Small "NO IRAN WAR" sticker badge in the bottom right corner.
Overall mood: protest-poster urgent but illustrative, not photoreal.`;

const prompt = `${STYLE}\n\nSubject: ${SUBJECT}`;

const r = await fetch("https://api.openai.com/v1/images/generations", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
  body: JSON.stringify({
    model: "gpt-image-1",
    prompt,
    size: "1536x1024",
    quality: "medium",
    n: 1,
  }),
});
if (!r.ok) { console.error(`OpenAI ${r.status}:`, (await r.text()).slice(0, 600)); process.exit(1); }
const json = await r.json();
const b64 = json?.data?.[0]?.b64_json;
if (!b64) { console.error("No image data"); process.exit(1); }

const buf = Buffer.from(b64, "base64");
const webp = await sharp(buf).webp({ quality: 80 }).toBuffer();
await fs.writeFile("/tmp/moveon-50b-war-cartoon.webp", webp);
console.log(`Saved /tmp/moveon-50b-war-cartoon.webp  (${(webp.length / 1024).toFixed(0)} KB)`);
