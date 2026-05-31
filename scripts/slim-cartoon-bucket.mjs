/**
 * Slim the cartoon-banners CDN bucket — three explicit phases, run in order:
 *
 *   node scripts/slim-cartoon-bucket.mjs backup   # 1. download every original → cartoon-banners-backup/
 *   node scripts/slim-cartoon-bucket.mjs slim      # 2. resize each to 800px/q60 → cartoon-banners-slim/
 *   node scripts/slim-cartoon-bucket.mjs upload     # 3. overwrite the bucket with the slimmed files
 *
 * Why: cartoons are served RAW (no per-view transform, to stay under Supabase's
 * image-transform allowance). But the stored originals are 1536px ~200 KB each,
 * ~4× the display size. Slimming them once at rest to 800px/q60 (~50 KB) gives a
 * fast feed AND zero transformations.
 *
 * Safety: phase 1 is a full local backup of the ONLY complete copy of the
 * cartoons (they live only in the bucket). Phase 3 overwrites in place; if
 * anything looks wrong, re-upload from cartoon-banners-backup/ to restore.
 *
 * All phases are resumable — already-done files are skipped — so a re-run after
 * an interruption only does what's left.
 */

import { readFile, writeFile, readdir, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const PROJECT_REF = "zkihnylrvdofdbnhmmoq";
const BUCKET = "cartoon-banners";
const PUBLIC_BASE = `https://${PROJECT_REF}.supabase.co/storage/v1/object/public/${BUCKET}`;
const LIST_URL = `https://${PROJECT_REF}.supabase.co/storage/v1/object/list/${BUCKET}`;
const UPLOAD_BASE = `https://${PROJECT_REF}.supabase.co/storage/v1/object/${BUCKET}`;

const BACKUP_DIR = join(REPO_ROOT, "cartoon-banners-backup");
const SLIM_DIR = join(REPO_ROOT, "cartoon-banners-slim");

const TARGET_WIDTH = 800; // matches the width the per-view transform used
const QUALITY = 60;
const CONCURRENCY = 8;

// Read the service-role key from the existing uploader so the secret lives in
// exactly one place in the repo (don't duplicate it here).
async function serviceKey() {
  const src = await readFile(join(__dirname, "upload-cartoon-banners.mjs"), "utf8");
  const m = src.match(/eyJ[A-Za-z0-9._-]{40,}/);
  if (!m) throw new Error("Could not find service-role key in upload-cartoon-banners.mjs");
  return m[0];
}

// Run async fn over items with a fixed concurrency cap.
async function pool(items, fn) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx).catch((e) => ({ __err: e?.message ?? String(e) }));
    }
  });
  await Promise.all(workers);
  return results;
}

async function exists(p) {
  try { const s = await stat(p); return s.size > 0; } catch { return false; }
}

// List every object in the bucket (paginated).
async function listBucket(key) {
  const names = [];
  let offset = 0;
  const limit = 100;
  for (;;) {
    const r = await fetch(LIST_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: "", limit, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!r.ok) throw new Error(`list ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const batch = await r.json();
    const webps = batch.filter((o) => o.name && o.name.endsWith(".webp"));
    names.push(...webps.map((o) => o.name));
    if (batch.length < limit) break;
    offset += limit;
  }
  return names;
}

async function phaseBackup() {
  await mkdir(BACKUP_DIR, { recursive: true });
  const key = await serviceKey();
  console.log("Listing bucket…");
  const names = await listBucket(key);
  console.log(`  ${names.length} webp objects in ${BUCKET}`);

  let done = 0, skipped = 0, failed = 0;
  const results = await pool(names, async (name) => {
    const dest = join(BACKUP_DIR, name);
    if (await exists(dest)) { skipped++; return; }
    const r = await fetch(`${PUBLIC_BASE}/${name}?v=1`);
    if (!r.ok) throw new Error(`${name}: ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    await writeFile(dest, buf);
    done++;
    if ((done + skipped) % 50 === 0) process.stdout.write(`\r  downloaded ${done}, skipped ${skipped}…   `);
  });
  results.forEach((x) => { if (x && x.__err) { failed++; console.error("\n  ✗", x.__err); } });
  console.log(`\nBackup done. ${done} downloaded, ${skipped} already present, ${failed} failed → ${BACKUP_DIR}`);
  if (failed) process.exit(1);
}

async function phaseSlim() {
  await mkdir(SLIM_DIR, { recursive: true });
  const files = (await readdir(BACKUP_DIR)).filter((f) => f.endsWith(".webp"));
  if (!files.length) throw new Error("No files in backup dir — run the backup phase first.");
  console.log(`Slimming ${files.length} files to ${TARGET_WIDTH}px / q${QUALITY}…`);

  let done = 0, skipped = 0, failed = 0, inBytes = 0, outBytes = 0;
  const results = await pool(files, async (name) => {
    const src = join(BACKUP_DIR, name);
    const dest = join(SLIM_DIR, name);
    if (await exists(dest)) { skipped++; return; }
    const buf = await readFile(src);
    const out = await sharp(buf)
      .resize(TARGET_WIDTH, null, { withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toBuffer();
    await writeFile(dest, out);
    inBytes += buf.length; outBytes += out.length; done++;
  });
  results.forEach((x) => { if (x && x.__err) { failed++; console.error("  ✗", x.__err); } });
  const avgIn = done ? (inBytes / done / 1024).toFixed(0) : "—";
  const avgOut = done ? (outBytes / done / 1024).toFixed(0) : "—";
  console.log(`Slim done. ${done} slimmed, ${skipped} already done, ${failed} failed.`);
  console.log(`  avg ${avgIn} KB → ${avgOut} KB per banner → ${SLIM_DIR}`);
  if (failed) process.exit(1);
}

async function phaseUpload() {
  const key = await serviceKey();
  const files = (await readdir(SLIM_DIR)).filter((f) => f.endsWith(".webp"));
  if (!files.length) throw new Error("No files in slim dir — run the slim phase first.");
  console.log(`Uploading ${files.length} slimmed files to ${BUCKET} (overwrite)…`);

  let done = 0, failed = 0;
  const results = await pool(files, async (name) => {
    const buf = await readFile(join(SLIM_DIR, name));
    const r = await fetch(`${UPLOAD_BASE}/${name}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "image/webp", "x-upsert": "true" },
      body: buf,
    });
    if (!r.ok) throw new Error(`${name}: ${r.status} — ${(await r.text().catch(() => "")).slice(0, 120)}`);
    done++;
    if (done % 50 === 0) process.stdout.write(`\r  uploaded ${done}…   `);
  });
  results.forEach((x) => { if (x && x.__err) { failed++; console.error("\n  ✗", x.__err); } });
  console.log(`\nUpload done. ${done} uploaded, ${failed} failed.`);
  if (failed) process.exit(1);
}

const phase = process.argv[2];
const fns = { backup: phaseBackup, slim: phaseSlim, upload: phaseUpload };
if (!fns[phase]) {
  console.error("Usage: node scripts/slim-cartoon-bucket.mjs <backup|slim|upload>");
  process.exit(1);
}
fns[phase]().catch((e) => { console.error("Fatal:", e); process.exit(1); });
