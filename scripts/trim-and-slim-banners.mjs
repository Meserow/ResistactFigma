// One-shot: back up every cartoon banner in public/cartoon-banners/, then
// trim its solid-color edges (sharp.trim) and resize down to 1024 wide.
// Result: ~50% smaller files on average + the cartoon content fills the
// full frame (no wasted beige border).
//
// Run:
//   node scripts/trim-and-slim-banners.mjs
//
// Idempotent-ish: if a backup of a given card already exists, the script
// trusts the BACKUP as the source-of-truth original. This lets you rerun
// safely — the second pass operates on the original master, not on a
// previously-slimmed file (which would compound quality loss).

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(REPO_ROOT, "public", "cartoon-banners");
const BACKUP_DIR = path.join(__dirname, "cartoon-banners-backup");

const TRIM_THRESHOLD = 25; // sharp.trim tolerance — cream/beige varies a bit
const TARGET_WIDTH = 1024;
const WEBP_QUALITY = 80;

async function main() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });

  const files = (await fs.readdir(PUBLIC_DIR)).filter((f) => /^card-\d+\.webp$/.test(f));
  console.log(`Found ${files.length} card banners in ${PUBLIC_DIR}`);
  console.log(`Backup dir: ${BACKUP_DIR}`);
  console.log("");

  let processed = 0;
  let failed = 0;
  let origTotal = 0;
  let newTotal = 0;

  for (const file of files) {
    const livePath = path.join(PUBLIC_DIR, file);
    const backupPath = path.join(BACKUP_DIR, file);

    try {
      // 1. Ensure a backup exists. If it does, use it as source — the live
      //    file may have already been slimmed in an interrupted earlier
      //    run, and we don't want to compound the resize/trim.
      const backupExists = await fs.access(backupPath).then(() => true).catch(() => false);
      let srcBuf;
      if (backupExists) {
        srcBuf = await fs.readFile(backupPath);
      } else {
        srcBuf = await fs.readFile(livePath);
        await fs.writeFile(backupPath, srcBuf);
      }
      const origSize = srcBuf.length;
      origTotal += origSize;

      // 2. Trim solid-color borders + resize to 1024 wide. sharp's pipeline
      //    handles both in one pass.
      const newBuf = await sharp(srcBuf)
        .trim({ threshold: TRIM_THRESHOLD })
        .resize(TARGET_WIDTH, null)
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
      await fs.writeFile(livePath, newBuf);
      newTotal += newBuf.length;
      processed++;

      if (processed % 100 === 0) {
        console.log(`  ${processed}/${files.length} done — saved ${((origTotal - newTotal) / 1024 / 1024).toFixed(1)} MB so far`);
      }
    } catch (err) {
      console.error(`  ✗ ${file}: ${err.message}`);
      failed++;
    }
  }

  console.log("");
  console.log(`Done.`);
  console.log(`  Processed:    ${processed}`);
  console.log(`  Failed:       ${failed}`);
  console.log(`  Total before: ${(origTotal / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Total after:  ${(newTotal / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Saved:        ${((origTotal - newTotal) / 1024 / 1024).toFixed(1)} MB (${((1 - newTotal / origTotal) * 100).toFixed(0)}%)`);
  console.log(`  Backups at:   ${BACKUP_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
