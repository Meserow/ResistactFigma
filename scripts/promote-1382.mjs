// Promote the chosen card-1382 candidate to the live banner:
//   1. convert the picked PNG → webp (q80), write to public/cartoon-banners/
//   2. upsert it to Supabase Storage bucket "cartoon-banners/card-1382.webp"
//      (the URL the live site actually loads via cartoonUrlFor()).
//
// Run:  CAND=1 SUPABASE_SERVICE_KEY=... node scripts/promote-1382.mjs

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(__dirname, "generated-card-art");
const PUBLIC_DIR = path.join(REPO_ROOT, "public", "cartoon-banners");

const CAND = process.env.CAND ?? "1";
const PROJECT_REF = "zkihnylrvdofdbnhmmoq";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE_KEY) { console.error("Missing SUPABASE_SERVICE_KEY"); process.exit(1); }

async function main() {
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  const srcPng = path.join(OUT_DIR, `card-1382-cand-${CAND}.png`);
  const raw = await fs.readFile(srcPng);
  const webp = await sharp(raw).webp({ quality: 80 }).toBuffer();

  const publicPath = path.join(PUBLIC_DIR, "card-1382.webp");
  const masterPath = path.join(OUT_DIR, "card-1382.webp");
  await fs.writeFile(publicPath, webp);
  await fs.writeFile(masterPath, webp);
  console.log(`Wrote ${publicPath} (${(webp.length / 1024).toFixed(0)} KB)`);

  const url = `https://${PROJECT_REF}.supabase.co/storage/v1/object/cartoon-banners/card-1382.webp`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "image/webp",
      "x-upsert": "true",
    },
    body: webp,
  });
  if (!res.ok) throw new Error(`upload HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  console.log(`Uploaded to Supabase Storage: card-1382.webp (upsert)`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
