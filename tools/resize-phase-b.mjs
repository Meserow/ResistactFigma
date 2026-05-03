// Phase B: same as Phase A but for the remaining mid-tier files in public/.
import sharp from "sharp";
import { promises as fs } from "fs";
import path from "path";

const TARGETS = [
  "public/be-pretti-good-beanie.jpg",
  "public/mobilize-blackvoters.jpg",
  "public/goods-unite-us.png",
  "public/protest-hat-project.jpg",
  "public/moveon.png",
  "public/rock-the-vote-2.jpg",
  "public/facts/economy.jpg",
  "public/nokings.jpg",
  "public/nokings-event.jpg",
  "public/mobilize-handsoff.jpg",
  "public/mano-a-mano.png",
  "public/aclu-immigrants-rights.jpg",
  "public/facts/fact-health.jpg",
  "public/mayday-strong.jpg",
  "public/anglican-journal.jpg",
  "public/melt-the-ice-hat.jpg",
  "public/commoncause.jpg",
  "public/no-kings-march28.jpg",
  "public/indivisible-stop-save.jpg",
  "public/atac.jpg",
  "public/lwv.png",
  "public/techforcampaigns.jpg",
  "public/resist-bot.png",
  "public/facts/media-institutions.jpg",
];

const MAX_WIDTH = 1200;
const JPG_QUALITY = 82;
const BACKUP_ROOT = ".image-backup";

async function ensureDir(d) { await fs.mkdir(d, { recursive: true }); }

async function processOne(rel) {
  const abs = path.resolve(rel);
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat) return { file: rel, skipped: "not found" };
  const before = stat.size;
  const ext = path.extname(rel).toLowerCase();

  const backupPath = path.join(BACKUP_ROOT, rel);
  await ensureDir(path.dirname(backupPath));
  await fs.copyFile(abs, backupPath);

  const meta = await sharp(abs).metadata();
  let pipeline = sharp(abs).rotate();
  if (meta.width > MAX_WIDTH) {
    pipeline = pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });
  }
  let buf;
  if (ext === ".jpg" || ext === ".jpeg") {
    buf = await pipeline.jpeg({ quality: JPG_QUALITY, mozjpeg: true }).toBuffer();
  } else if (ext === ".png") {
    buf = await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer();
  } else throw new Error("ext " + ext);

  // Only replace if actually smaller (don't make things worse)
  if (buf.length < before) {
    await fs.writeFile(abs, buf);
  }
  const after = (await fs.stat(abs)).size;
  return {
    file: rel,
    beforeKB: Math.round(before / 1024),
    afterKB: Math.round(after / 1024),
    pctSaved: Math.round((1 - after / before) * 100),
    beforeDim: `${meta.width}x${meta.height}`,
    skipped: buf.length >= before ? "no improvement" : null,
  };
}

const results = [];
for (const t of TARGETS) {
  try {
    const r = await processOne(t);
    results.push(r);
    if (r.skipped) {
      console.log(`SKIP  ${r.beforeKB}KB  ${r.file}  (${r.skipped})`);
    } else {
      console.log(`${r.beforeKB.toString().padStart(5)}KB → ${r.afterKB.toString().padStart(5)}KB  (-${r.pctSaved}%)  ${r.file}`);
    }
  } catch (e) {
    console.error(`FAIL ${t}: ${e.message}`);
  }
}
const totalBefore = results.reduce((s, r) => s + (r.beforeKB || 0), 0);
const totalAfter = results.reduce((s, r) => s + (r.afterKB || 0), 0);
console.log(`\nTotal: ${totalBefore}KB → ${totalAfter}KB  (saved ${totalBefore - totalAfter}KB, ${Math.round((1 - totalAfter / totalBefore) * 100)}%)`);
