/**
 * One-time migration: upload all cartoon banner webps from
 * public/cartoon-banners/ to Supabase Storage bucket "cartoon-banners".
 *
 * Run once:  node scripts/upload-cartoon-banners.mjs
 * Safe to re-run — already-uploaded files are skipped (upsert: false).
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const PROJECT_REF = "zkihnylrvdofdbnhmmoq";
// Secret key — read from the environment, NEVER hardcoded. Put it in a
// gitignored .env and run with:  node --env-file=.env scripts/upload-cartoon-banners.mjs
// Accepts the new-style secret key (sb_secret_…) or a legacy service_role key.
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY). " +
      "Add it to .env and run: node --env-file=.env scripts/upload-cartoon-banners.mjs",
  );
  process.exit(1);
}
const BUCKET = "cartoon-banners";
const STORAGE_BASE = `https://${PROJECT_REF}.supabase.co/storage/v1/object`;
const LOCAL_DIR = new URL("../public/cartoon-banners/", import.meta.url).pathname;

const CONCURRENCY = 8; // parallel uploads

async function uploadFile(filename) {
  const buf = await readFile(join(LOCAL_DIR, filename));
  const url = `${STORAGE_BASE}/${BUCKET}/${filename}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "image/webp",
      "x-upsert": "true",
    },
    body: buf,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${filename}: HTTP ${res.status} — ${text}`);
  }
}

async function main() {
  const files = (await readdir(LOCAL_DIR)).filter((f) => f.endsWith(".webp"));
  console.log(`Uploading ${files.length} webp files to ${BUCKET}…`);

  let done = 0;
  let failed = 0;
  const errors = [];

  // Process in batches of CONCURRENCY
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(uploadFile));
    for (const r of results) {
      if (r.status === "fulfilled") {
        done++;
      } else {
        failed++;
        errors.push(r.reason?.message ?? String(r.reason));
      }
    }
    const pct = Math.round(((i + batch.length) / files.length) * 100);
    process.stdout.write(`\r  ${done} uploaded, ${failed} failed — ${pct}%   `);
  }

  console.log(`\nDone. ${done} uploaded, ${failed} failed.`);
  if (errors.length) {
    console.error("Errors:");
    errors.forEach((e) => console.error(" •", e));
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
