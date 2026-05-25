// Generate a .webp sibling next to every .jpg/.jpeg/.png in public/.
//
// Why: ImageWithFallback emits a <picture><source srcSet="$basename.webp">
// for any root-rooted JPG/PNG. That assumption was silently broken because
// most public-folder images shipped without webp pairs — Chrome 404'd the
// webp source AND did not gracefully fall back to the <img>, rendering the
// gray placeholder. See changelog 1.2.12 for the visible-failure mode.
//
// This script keeps every public-folder JPG/PNG paired with a fresh webp so
// the optimization is safe to enable again.
//
// Behavior:
//   - Walks public/ recursively
//   - For each .jpg / .jpeg / .png, ensures a sibling .webp exists
//   - Skips when the .webp already exists AND is newer than the source
//   - Uses sharp() with quality 82 (good visual / good compression)
//   - Logs created/skipped counts at the end
//
// Run manually:
//   node scripts/generate-webp-siblings.mjs
//
// Or via build pipeline: wired into `prebuild` in package.json, so any
// `vite build` regenerates the missing siblings before the dist is sealed.

import { glob } from "glob";
import sharp from "sharp";
import { statSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "..", "public");
const WEBP_QUALITY = 82;

const sources = await glob("**/*.{jpg,jpeg,png,JPG,JPEG,PNG}", { cwd: PUBLIC_DIR });

let created = 0;
let skipped = 0;
let failed = 0;

for (const rel of sources) {
  const absSrc = resolve(PUBLIC_DIR, rel);
  const absWebp = absSrc.replace(/\.(jpe?g|png)$/i, ".webp");

  if (existsSync(absWebp)) {
    const srcMtime = statSync(absSrc).mtimeMs;
    const webpMtime = statSync(absWebp).mtimeMs;
    if (webpMtime >= srcMtime) {
      skipped++;
      continue;
    }
  }

  try {
    await sharp(absSrc).webp({ quality: WEBP_QUALITY }).toFile(absWebp);
    created++;
  } catch (err) {
    console.error(`✗ ${rel}: ${err.message}`);
    failed++;
  }
}

console.log(`webp siblings: ${created} created, ${skipped} already up-to-date, ${failed} failed (of ${sources.length} sources)`);
if (failed > 0) process.exit(1);
