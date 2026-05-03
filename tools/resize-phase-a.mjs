// Phase A image resizer: shrink the worst-offending images to a sensible
// size for card thumbnails. Backs up originals to .image-backup/ first.
import sharp from "sharp";
import { promises as fs } from "fs";
import path from "path";

const TARGETS = [
  "public/no-kings-utah.jpg",
  "public/no-kings-sf.jpg",
  "public/aclu.jpg",
  "public/fact-immigration (1).jpg",
  "public/crosscultural-boycott.png",
  "public/mobilize-indivisible.png",
  "public/mobilize-wa4all.png",
  "public/poynter-mediawise.png",
  "public/sierra-club-angeles.jpg",
  "public/amherst-indy-resources.jpg",
  "public/mv4a-project.jpg",
  "public/impeach-trump-again.jpg",
  "public/episcopal-citymission.png",
  "public/project-218.png",
  "public/paramountplus.png",
  "public/19aid-chicago.png",
  "public/raices-texas.png",
  "public/facts/work-wages-education.jpg",
  "public/facts/energy-climate.jpg",
  "public/facts/health-covid.jpg",
];

const MAX_WIDTH = 1200;
const JPG_QUALITY = 85;
const BACKUP_ROOT = ".image-backup";

async function ensureDir(d) {
  await fs.mkdir(d, { recursive: true });
}

async function processOne(rel) {
  const abs = path.resolve(rel);
  const stat = await fs.stat(abs);
  const beforeBytes = stat.size;

  const ext = path.extname(rel).toLowerCase();
  const backupPath = path.join(BACKUP_ROOT, rel);
  await ensureDir(path.dirname(backupPath));
  await fs.copyFile(abs, backupPath);

  const img = sharp(abs);
  const meta = await img.metadata();
  const beforeDim = `${meta.width}x${meta.height}`;

  let pipeline = sharp(abs).rotate();
  if (meta.width > MAX_WIDTH) {
    pipeline = pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });
  }

  let outputBuffer;
  if (ext === ".jpg" || ext === ".jpeg") {
    outputBuffer = await pipeline.jpeg({ quality: JPG_QUALITY, mozjpeg: true }).toBuffer();
  } else if (ext === ".png") {
    outputBuffer = await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer();
  } else {
    throw new Error(`Unsupported extension: ${ext}`);
  }

  await fs.writeFile(abs, outputBuffer);
  const afterStat = await fs.stat(abs);
  const after = sharp(abs);
  const afterMeta = await after.metadata();
  const afterDim = `${afterMeta.width}x${afterMeta.height}`;

  return {
    file: rel,
    beforeKB: Math.round(beforeBytes / 1024),
    afterKB: Math.round(afterStat.size / 1024),
    beforeDim,
    afterDim,
    pctSaved: Math.round((1 - afterStat.size / beforeBytes) * 100),
  };
}

const results = [];
for (const t of TARGETS) {
  try {
    const r = await processOne(t);
    results.push(r);
    console.log(
      `${r.beforeKB.toString().padStart(5)}KB → ${r.afterKB.toString().padStart(5)}KB  (-${r.pctSaved}%)  ${r.beforeDim.padEnd(11)} → ${r.afterDim.padEnd(11)}  ${r.file}`,
    );
  } catch (e) {
    console.error(`FAILED ${t}: ${e.message}`);
  }
}

const totalBefore = results.reduce((s, r) => s + r.beforeKB, 0);
const totalAfter = results.reduce((s, r) => s + r.afterKB, 0);
console.log(`\nTotal: ${totalBefore} KB → ${totalAfter} KB  (saved ${totalBefore - totalAfter} KB, ${Math.round((1 - totalAfter / totalBefore) * 100)}%)`);
console.log(`Originals backed up to ./${BACKUP_ROOT}/`);
