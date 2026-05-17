// Phase C: generate a sibling .webp for every JPG/PNG in public/ (and
// public/facts/) that's >25 KB, so <picture> can serve WebP to supporting
// browsers (typically 25–50% smaller than the JPG).
import sharp from "sharp";
import { promises as fs } from "fs";
import path from "path";
import { glob } from "glob";

const ROOTS = [
  "public/*.jpg", "public/*.png",
  "public/facts/*.jpg", "public/facts/*.png",
  // Smacks meme PNGs — these are the heaviest files in the repo (1.5–3MB
  // each). WebP at quality 82 typically drops them to 150–400KB without
  // visible quality loss.
  "public/Smacks/*.png", "public/Smacks/*.jpg",
];
const MIN_BYTES = 0;
const QUALITY = 82;

let made = 0, skipped = 0, savedKB = 0;
const tooSmall = [];

for (const pattern of ROOTS) {
  const files = await glob(pattern, { nodir: true });
  for (const f of files) {
    const stat = await fs.stat(f);
    if (stat.size < MIN_BYTES) { tooSmall.push(f); continue; }
    const out = f.replace(/\.(jpg|jpeg|png)$/i, ".webp");
    const outStat = await fs.stat(out).catch(() => null);
    if (outStat) { skipped++; continue; }
    try {
      await sharp(f).rotate().webp({ quality: QUALITY }).toFile(out);
      const after = (await fs.stat(out)).size;
      const saved = stat.size - after;
      savedKB += Math.max(0, saved) / 1024;
      console.log(`  ${Math.round(stat.size/1024).toString().padStart(4)}KB → ${Math.round(after/1024).toString().padStart(4)}KB  ${path.basename(out)}`);
      made++;
    } catch (e) {
      console.error(`FAIL ${f}: ${e.message}`);
    }
  }
}
console.log(`\n${made} webp generated, ${skipped} already existed, ${tooSmall.length} below ${MIN_BYTES} bytes (skipped).`);
console.log(`Estimated bandwidth saved when WebP is served: ${Math.round(savedKB)} KB total.`);
