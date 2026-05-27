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
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpraWhueWxydmRvZmRibmhtbW9xIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzA3NzM1MSwiZXhwIjoyMDg4NjUzMzUxfQ.1EibWD6G0YYD1x1EgjntfUgNQ5jTtxduUB5YIX9_e2g";
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
