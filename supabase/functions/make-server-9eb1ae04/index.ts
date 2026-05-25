import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import * as kv from "./kv_store.ts";

const app = new Hono();

app.use('*', logger(console.log));

app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "X-Admin-Import-Token"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// ─── Auth helpers ──────────────────────────────────────────────────────────────
function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// In-memory debounce for the last-seen side-effect write below. Cuts KV writes
// to ~1/user/minute/instance even under heavy clicking. Lives in module scope;
// cleared on cold start. With multiple instances each may write once per
// window — acceptable since this powers "online now" display only.
const LAST_SEEN_DEBOUNCE_MS = 60_000;
const lastSeenCache = new Map<string, number>();

async function getUser(token: string) {
  const { data: { user }, error } = await adminClient().auth.getUser(token);
  if (error || !user) return null;
  // Presence signal — piggybacks on every authenticated request so we don't
  // need a client-side heartbeat. Fire-and-forget; never block the request.
  const now = Date.now();
  const last = lastSeenCache.get(user.id) ?? 0;
  if (now - last >= LAST_SEEN_DEBOUNCE_MS) {
    lastSeenCache.set(user.id, now);
    kv.set(`user:last-seen:${user.id}`, new Date(now).toISOString()).catch(() => {});
  }
  return user;
}

// Hardcoded admin allowlist. Admin status is granted ONLY to these emails.
// The previous "first user ever wins" pattern was unsafe — any KV reset
// would let the next signup self-promote to admin.
const ADMIN_EMAILS: ReadonlySet<string> = new Set([
  "ellen@meserow.com",
  "mikep@meserow.com",
  "patrick@meserow.com",
  "hank@meserow.com",
]);

function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.has(email.toLowerCase().trim());
}

// On every login, ensure the approval record reflects the current allowlist.
// Allowlisted emails → approved + admin. Everyone else → pending (or whatever
// status they already have, but never admin). Re-validating existing records
// auto-demotes any account that was promoted under the old buggy logic.
async function ensureApprovalRecord(user: any) {
  const allowedAdmin = isAdminEmail(user.email);
  const existing = await kv.get(`user:approval:${user.id}`) as any;

  if (existing) {
    const correctedAdmin = allowedAdmin;
    const correctedStatus = allowedAdmin ? "approved" : existing.status;
    if (existing.isAdmin !== correctedAdmin || existing.status !== correctedStatus) {
      const updated = { ...existing, isAdmin: correctedAdmin, status: correctedStatus };
      await kv.set(`user:approval:${user.id}`, updated);
      return updated;
    }
    return existing;
  }

  const record = {
    userId: user.id,
    email: user.email ?? "",
    name:
      user.user_metadata?.full_name ??
      user.user_metadata?.name ??
      user.email?.split("@")[0] ??
      "Resistor",
    avatar: user.user_metadata?.avatar_url ?? null,
    status: allowedAdmin ? "approved" : "pending",
    isAdmin: allowedAdmin,
    provider: user.app_metadata?.provider ?? "email",
    createdAt: new Date().toISOString(),
  };

  await kv.set(`user:approval:${user.id}`, record);
  return record;
}

async function requireAdmin(token: string | undefined) {
  if (!token) return null;
  const user = await getUser(token);
  if (!user) return null;
  // Defense in depth: require the email to be on the allowlist regardless
  // of what's in the KV record. Even if a record's isAdmin flag is corrupted
  // or stale, only allowlisted emails can perform admin actions.
  if (!isAdminEmail(user.email)) return null;
  const record = await kv.get(`user:approval:${user.id}`) as any;
  if (!record?.isAdmin) return null;
  return { user, record };
}

// Sweep every approval record and reconcile isAdmin/status with the
// allowlist. Demotes anyone who shouldn't be admin (cleaning up records
// promoted by the old "first user wins" bug) and promotes any allowlisted
// account that hasn't been marked admin yet.
async function sweepAdminAllowlist(): Promise<{ demoted: string[]; promoted: string[]; total: number }> {
  const records = await kv.getByPrefix("user:approval:") as any[];
  const demoted: string[] = [];
  const promoted: string[] = [];
  for (const r of records) {
    if (!r || typeof r !== "object" || !r.userId) continue;
    const allowed = isAdminEmail(r.email);
    const correctedAdmin = allowed;
    const correctedStatus = allowed ? "approved" : r.status;
    if (r.isAdmin === correctedAdmin && r.status === correctedStatus) continue;
    const updated = { ...r, isAdmin: correctedAdmin, status: correctedStatus };
    await kv.set(`user:approval:${r.userId}`, updated);
    if (r.isAdmin && !correctedAdmin) demoted.push(r.email);
    else if (!r.isAdmin && correctedAdmin) promoted.push(r.email);
  }
  return { demoted, promoted, total: records.length };
}

// Run the sweep once after deploy. Gated by a KV flag so it doesn't run on
// every request. Bumping the version suffix forces a re-run.
const ADMIN_SWEEP_VERSION = "v1";
async function sweepAdminAllowlistOnce() {
  const flagKey = `admin:sweep:allowlist:${ADMIN_SWEEP_VERSION}`;
  const alreadyDone = await kv.get(flagKey);
  if (alreadyDone) return;
  try {
    const result = await sweepAdminAllowlist();
    console.log(
      `Admin allowlist sweep (${ADMIN_SWEEP_VERSION}): scanned ${result.total} records — ` +
      `demoted ${result.demoted.length} [${result.demoted.join(", ")}], ` +
      `promoted ${result.promoted.length} [${result.promoted.join(", ")}]`
    );
    await kv.set(flagKey, true);
  } catch (err) {
    console.log("Admin allowlist sweep failed:", err);
  }
}

// ─── Seed Ellen user ──────────────────────────────────────────────────────────
async function seedEllenUser() {
  const alreadySeeded = await getMigrationFlag("seed:ellen:v1");
  if (alreadySeeded) return;
  try {
    const { data, error } = await adminClient().auth.admin.createUser({
      email: "ellen@meserow.com",
      password: "Resist!2026",
      user_metadata: { name: "Ellen Escarcega", full_name: "Ellen Escarcega" },
      email_confirm: true,
    });
    if (error) {
      console.log("Ellen seed note (may already exist):", error.message);
      await setMigrationFlag("seed:ellen:v1");
      return;
    }
    const ellenRecord = {
      userId: data.user.id,
      email: "ellen@meserow.com",
      name: "Ellen Escarcega",
      avatar: null,
      status: "approved",
      isAdmin: false,
      provider: "email",
      createdAt: new Date().toISOString(),
    };
    await kv.set(`user:approval:${data.user.id}`, ellenRecord);
    await setMigrationFlag("seed:ellen:v1");
    console.log("Seeded Ellen Escarcega as approved user.");
  } catch (err) {
    console.log("Error seeding Ellen:", err);
  }
}

// ─── User-action card insertion safety contract ─────────────────────────────
// Edge function instances can run migrations concurrently during deploy or
// cold-start. The `user-action:ids` index is a JSON array maintained by
// read-modify-write — naive code (read currentIds, push, write back) is
// last-write-wins, which has previously dropped or duplicated cards (see
// migrations dedup-restore-race:v1, restore-tom-morello:v1,
// restore-lost-batch1:v1, heal-user-action-ids:v1 for the forensic trail).
//
// Any migration that adds new user-action cards MUST go through
// appendUserActionCards(). The /actions handler also runs an unconditional
// heal once per warm process (see healUserActionIdsRunInProcess) as a
// final safety net, but the helper itself makes per-card writes race-safe:
//
//   1. Idempotent on re-run — if a card with the same id+title already
//      exists, it's skipped (and just re-indexed if missing from the list).
//   2. Collision-bumping — if a card with the same id but a different
//      title already exists (another instance got there first using the
//      same base+i id allocator), the helper picks the next free id
//      instead of overwriting.
//   3. Per-card index commit — re-reading and writing user-action:ids
//      after each card narrows the race window from "whole migration" to
//      a single card, so a concurrent migration in another instance can
//      shadow at most one id, not the entire batch.
//   4. Post-loop reconciliation — one final re-read and set-union with
//      everything we wrote, catching any concurrent writes that landed
//      during the loop.
//
// The function mutates each input card's `id` field in place when bumped.
async function appendUserActionCards(newCards: any[]): Promise<number[]> {
  const writtenIds: number[] = [];
  let liveIds = ((await kv.get("user-action:ids")) ?? []) as number[];
  let liveSet = new Set<number>(liveIds);

  for (const card of newCards) {
    let targetId = card.id;
    const existing: any = await kv.get(`user-action:${targetId}`);

    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
      if (existing.title === card.title) {
        if (!liveSet.has(targetId)) {
          liveIds = [...liveIds, targetId];
          liveSet.add(targetId);
          await kv.set("user-action:ids", liveIds);
        }
        writtenIds.push(targetId);
        continue;
      }
      let nextId = Math.max(...(liveIds.length ? liveIds : [targetId]), targetId) + 1;
      while (liveSet.has(nextId) || (await kv.get(`user-action:${nextId}`))) {
        nextId++;
      }
      targetId = nextId;
      card.id = nextId;
    }

    await kv.set(`user-action:${targetId}`, card);

    const current = ((await kv.get("user-action:ids")) ?? []) as number[];
    if (!current.includes(targetId)) {
      const merged = [...current, targetId];
      await kv.set("user-action:ids", merged);
      liveIds = merged;
      liveSet = new Set(merged);
    } else {
      liveIds = current;
      liveSet = new Set(current);
    }
    writtenIds.push(targetId);
  }

  const final = ((await kv.get("user-action:ids")) ?? []) as number[];
  const finalSet = new Set(final);
  let changed = false;
  for (const id of writtenIds) {
    if (!finalSet.has(id)) {
      finalSet.add(id);
      final.push(id);
      changed = true;
    }
  }
  if (changed) await kv.set("user-action:ids", final);

  return writtenIds;
}

// Module-level flag: once per warm process, the /actions handler walks
// every user-action:* record and reconciles user-action:ids. Cold-starts
// align with deploys (the race window for migrations), so this catches
// any drift introduced by the previous deploy.
let healUserActionIdsRunInProcess = false;

// PERF: Module-level cache for migration/cleanup/seed flags. These keys
// are write-once (set to `true` after a one-time migration runs) but
// were being re-read on every /actions request — ~41 sequential KV
// round-trips, ~3-4 seconds of pure flag-check overhead per request.
// On Supabase Edge Functions, fresh isolates often serve each request,
// so the cache is reseeded per request via warmMigrationFlagCache() — a
// single mget batch that reads all 41 flags in one round-trip (~100ms
// vs ~4s sequential). Once the cache is warm, every getMigrationFlag()
// is a Set.has lookup.
const migrationFlagCache = new Set<string>();

// All known migration/cleanup/seed flag keys. Kept in sync with the
// strings passed to getMigrationFlag()/setMigrationFlag() in this file.
// If you add a new migration, add its key here so the warm-up batch
// picks it up — otherwise it'll fall back to an individual kv.get on
// first reference (still correct, just one extra round-trip).
const KNOWN_MIGRATION_FLAG_KEYS: readonly string[] = [
  "cleanup:backfill-images-1245:v1",
  "cleanup:blaire-substack-desc:v1",
  "cleanup:clear-stray-offtopic:v1",
  "cleanup:dropped-seeds:v1",
  "cleanup:fake-seeds:v1",
  "cleanup:fix-quickaction-mistags:v1",
  "cleanup:link-to-targeturl:v1",
  "cleanup:purge-fake-seeds:v2",
  "cleanup:reapprove-beanie:v1",
  "cleanup:recategorize-call-cards:v1",
  "cleanup:cw-redistribute:v1",
  "cleanup:boost-color-merge:v1",
  "cleanup:personal-commitment-color:v1",
  "cleanup:category-outliers-2026-05:v1",
  "cleanup:reset-boosts-5:v1",
  "cleanup:reset-boosts-5:v3",
  "cleanup:retire-past-dated-2026-05:v1",
  "cleanup:set-boosts-1-950:v1",
  "cleanup:tiktok-youtube-rekey:v1",
  "migrate:spotsused-to-boosts:v1",
  "migration:admin-approved:v1",
  "migration:approved-without-image-cleanup:v1",
  "migration:cancel-your-10min:v1",
  "migration:common-cause-actions:v1",
  "migration:creators-import-2026-05-batch2:v1",
  "migration:dedup-psy-race:v1",
  "migration:dedup-restore-race:v1",
  "migration:demote-missing-url-or-image:v1",
  "migration:etsy-creators-import-2026-05:v1",
  "migration:event-dates:v1",
  "migration:fix-regional-search-urls:v1",
  "migration:fix-yarn-sisters-url:v1",
  "migration:mobilize-actions-v2:v1",
  "migration:mobilize-local-actions:v1",
  "migration:no-image-review:v1",
  "migration:nourl-review:v1",
  "migration:petitions-10min:v1",
  "migration:portland-seattle-yolo-import-2026-05:v1",
  "migration:reset-boosts:v1",
  "migration:resistbot-citizens-united:v1",
  "migration:resistbot-citizens-united:v2",
  "migration:restore-lost-batch1:v1",
  "migration:restore-tom-morello:v1",
  "migration:tsv-batch-2026-05-17:v1",
  "migration:user-cards:v1",
  "seed:ellen:v1",
  "seed:org-actions:v26",
  "seed:receipts:v2",
];

// Tracks whether warmMigrationFlagCache() has run in this isolate. On
// long-lived warm isolates this saves the batch read on subsequent
// requests; on fresh isolates it runs once per request lifecycle.
let migrationCacheWarmed = false;

async function warmMigrationFlagCache(): Promise<void> {
  if (migrationCacheWarmed) return;
  // Single batch read: `SELECT key, value WHERE key IN (...)` returns
  // one row per existing key. Bypassing kv.mget here because that helper
  // returns values only (no keys), so we can't tell which key each value
  // belongs to under Postgres's unordered IN-result. One round-trip
  // replaces what was ~41 sequential gets (~4s → ~100ms on cold isolates).
  try {
    const client = adminClient();
    const { data, error } = await client
      .from("kv_store_9eb1ae04")
      .select("key, value")
      .in("key", [...KNOWN_MIGRATION_FLAG_KEYS]);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<{ key: string; value: unknown }>) {
      if (row.value === true) migrationFlagCache.add(row.key);
    }
  } catch (err) {
    // Don't fail the whole request if warm-up fails — getMigrationFlag
    // will fall back to individual reads (slower but correct).
    console.log("warmMigrationFlagCache failed (falling back to lazy reads):", err);
  }
  migrationCacheWarmed = true;
}

async function getMigrationFlag(key: string): Promise<boolean> {
  if (migrationFlagCache.has(key)) return true;
  const val = await kv.get(key);
  if (val === true) migrationFlagCache.add(key);
  return val === true;
}
async function setMigrationFlag(key: string): Promise<void> {
  await kv.set(key, true);
  migrationFlagCache.add(key);
}

// PERF: in-process cache for the assembled /actions card list. Short TTL
// trades a few seconds of stale-write visibility for ~5× lower latency
// on warm requests, which is the right tradeoff for a feed that's
// already eventual-consistent (admin approvals, boost counts, etc.).
const ACTIONS_CACHE_TTL_MS = 15_000;
let actionsCache: { cards: any[]; ts: number } | null = null;
function invalidateActionsCache(): void {
  actionsCache = null;
}

// ─── Seed data ────────────────────────────────────────────────────────────────
const SEED_CARDS = [
  { id: 1, isFeatured: true, pinToTop: true, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", timeCommitment: "Ongoing", title: "Spread the Word about ResistAct", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community needs your help spreading awareness about ResistAct so we can build a stronger resistance network together.", boosts: 950, spotsTotal: "Unlimited", authorName: "Ellen Meserow", authorRole: "ResistAct Founder", authorAvatarKey: "imgImage34" },
  { id: 19, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", timeCommitment: "< 1 hour", title: "SH*T Bag: Two Bags, One Movement", description: "Dog poop bags featuring Trump — made from plant-based materials (PBAT + PLA + Corn Starch), leak-proof, strong, traps odors, and 'resistant to hate.' Fair-trade and BSCI-compliant. Buy a pack and put it to good use.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Smolotov LLC", authorRole: "Resistance Merch", targetUrl: "https://www.smolotov.com/products/smolotov-unscented-leakproof-dog-poop-bags", topImageUrl: "https://www.smolotov.com/cdn/shop/files/4-Rolls_Box_Bag_2400px.jpg?v=1771553420&width=800", toneOverride: { energy: 1 } },
  { id: 1000, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Search any brand's political donations before you buy", description: "Search 7,000+ companies' political donations before you buy. Stop accidentally funding the people deporting your neighbors.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Goods Unite Us", authorRole: "Movement Organization", targetUrl: "https://www.goodsuniteus.com/", topImageKey: "org_goods-unite-us" },
  { id: 1001, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Get the browser extension that flags MAGA-aligned brands", description: "Browser extension auto-flags MAGA-aligned brands as you shop. Make every checkout a small political choice.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Progressive Shopper", authorRole: "Movement Organization", targetUrl: "https://progressiveshopper.com/", topImageKey: "org_progressive-shopper" },
  { id: 1002, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Use the Trump-tied retailers boycott list", description: "Spreadsheet of every retailer carrying Trump-family products. Pull up before you shop — names update weekly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Grab Your Wallet", authorRole: "Movement Organization", targetUrl: "https://grabyourwallet.org/", topImageKey: "org_grab-your-wallet" },
  { id: 1003, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Join coordinated 24-hour economic blackouts", description: "Coordinated 24-hour buy-nothing blackouts that hit corporate dailies. Sign up for the next date.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The People's Union USA", authorRole: "Movement Organization", targetUrl: "https://thepeoplesunionusa.com/", topImageKey: "org_the-people-s-union-usa" },
  { id: 1004, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Sign the Tesla Takedown commitment", description: "Sell Tesla stock, dump the lease, and join Saturday dealership protests. Hits Musk where it actually hurts.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com/", topImageKey: "org_tesla-takedown" },
  { id: 1005, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Join the Latino-led economic blackout", description: "Latino-led campaign to freeze spending in protest of mass-deportation policies. Sign up for the calendar.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Latino Freeze Movement", authorRole: "Movement Organization", targetUrl: "https://www.latinofreeze.com/", topImageKey: "org_latino-freeze-movement", amplifiesGroups: ["immigrant"] },
  { id: 1006, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Switch your spending to a Black-women-owned biz", description: "Directory of Black-women-owned businesses to swap your usual orders into. Buy here instead of Amazon.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Buy From a Black Woman", authorRole: "Movement Organization", targetUrl: "https://www.buyfromablackwoman.org/", topImageKey: "org_buy-from-a-black-woman", amplifiesGroups: ["woman"] },
  { id: 1007, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Buy Anti-Trump Merch from Individual Makers", description: "Handmade anti-Trump shirts, signs, stickers, and pins from independent Etsy sellers — your dollars go to indie creators, not corporate retailers.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Etsy (Anti-Trump Market)", authorRole: "Indie Makers Marketplace", targetUrl: "https://www.etsy.com/market/anti_trump", topImageKey: "org_anti-trump-merch", toneOverride: { energy: 1 }, firstTimerFriendly: true },
  { id: 1008, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Buy from a Native-owned business instead", description: "Native-owned business directory + marketplace. Trump's land-grab and pipeline pushes hit these communities first.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Beyond Buckskin", authorRole: "Movement Organization", targetUrl: "https://www.beyondbuckskin.com/", topImageKey: "org_beyond-buckskin" },
  { id: 1009, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "RSVP to the next Saturday Tesla Takedown", description: "Live map of Tesla dealership protests near you. Saturday actions only — no commitment required.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com/", topImageKey: "org_tesla-takedown" },
  { id: 1010, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Subscribe to Free DC mobilization alerts", description: "DC-area mobilization alerts for protests, court days, and federal-building actions. Subscribe and show up.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Free DC", authorRole: "Movement Organization", targetUrl: "https://freedcproject.org/sign-up", topImageKey: "org_free-dc", toneOverride: { energy: 1 } },
  { id: 1011, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Become a Veterans for Peace member", description: "Vets in service insignia deter cops and counter-protesters at rallies. Be the visible spine of your local march.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Veterans for Peace", authorRole: "Movement Organization", targetUrl: "https://www.veteransforpeace.org/", topImageKey: "org_veterans-for-peace" },
  { id: 1012, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Join About Face: Veterans Against the War", description: "Post-9/11 vets organizing direct action against US wars. More aggressive than VFP — for vets ready to risk arrest.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "About Face", authorRole: "Movement Organization", targetUrl: "https://aboutfaceveterans.org/", topImageKey: "org_about-face" },
  { id: 1013, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Find an ADAPT chapter (disability direct action)", description: "Disability-led direct action — sit-ins, building takeovers, hill visits. Find or start a chapter; remote roles available.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "ADAPT", authorRole: "Movement Organization", targetUrl: "https://adapt.org/", topImageKey: "org_adapt", amplifiesGroups: ["disabled"] },
  { id: 1014, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Find a Drag Story Hour to attend / livestream", description: "Show up to a Drag Story Hour to protect performers from Proud Boys harassment. Adults present = events go forward.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Drag Story Hour", authorRole: "Movement Organization", targetUrl: "https://www.dragstoryhour.org/", topImageKey: "org_drag-story-hour", amplifiesGroups: ["lgbtq"] },
  { id: 1015, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Sign up for Refuse Fascism action alerts", description: "Anti-fascist protest network with simple action alerts. Stand against Trump's authoritarian playbook publicly.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Refuse Fascism", authorRole: "Movement Organization", targetUrl: "https://refusefascism.org/", topImageKey: "org_refuse-fascism", toneOverride: { energy: 1 } },
  { id: 1016, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Sign up with Code Pink", description: "Code Pink runs the disruptive bird-dog actions you see in Senate hearings. Get alerts for the next DC pop-up.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Code Pink", authorRole: "Movement Organization", targetUrl: "https://www.codepink.org/", topImageKey: "org_code-pink", toneOverride: { energy: 1 } },
  { id: 1017, category: "TRANSPORTATION", categoryColor: "#0a6e3f", actionType: "In Person Group", title: "Volunteer as a Practical Support driver (repro)", description: "Drive abortion-seekers to/from clinics and overnight stays. Trump's national-ban push makes practical support life-saving.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Apiary for Practical Support", authorRole: "Movement Organization", targetUrl: "https://apiaryps.org/ps-volunteer", topImageKey: "org_apiary-for-practical-support", amplifiesGroups: ["repro", "woman"] },
  { id: 1018, category: "TRANSPORTATION", categoryColor: "#0a6e3f", actionType: "In Person Group", title: "Sponsor + drive for refugees via Welcome.US", description: "Drive refugees to appointments, IKEA runs, school. Trump cut admissions but families already here need community.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Welcome.US", authorRole: "Movement Organization", targetUrl: "https://welcome.us/", topImageKey: "org_welcome-us", amplifiesGroups: ["immigrant"] },
  { id: 1019, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Submit a tip (anonymous SecureDrop)", description: "Submit a tip via SecureDrop. ProPublica turns insider docs into pressure that has fired federal officials.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "ProPublica", authorRole: "Movement Organization", targetUrl: "https://www.propublica.org/tips/", topImageKey: "org_propublica" },
  { id: 1020, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Submit a tip on criminal-justice / detention", description: "Tip line for prison conditions, ICE detention abuses, and prosecutor misconduct. Their reporting changes laws.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Marshall Project", authorRole: "Movement Organization", targetUrl: "https://www.themarshallproject.org/", topImageKey: "org_the-marshall-project" },
  { id: 1021, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Submit a leak to The Intercept", description: "Submit national-security leaks via SecureDrop. Intercept broke Snowden — they protect sources better than most.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Intercept", authorRole: "Movement Organization", targetUrl: "https://theintercept.com/", topImageKey: "org_the-intercept" },
  { id: 1022, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Tell them about an ICE raid (NYC)", description: "NYC tip line for ICE raids and immigration enforcement. Real-time alerts go to neighborhood networks.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Documented", authorRole: "Movement Organization", targetUrl: "https://www.mobilize.us/handsoffnyc/event/929506/", topImageKey: "org_handsoffnyc", amplifiesGroups: ["immigrant"] },
  { id: 1023, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch a Black-community story", description: "Pitch a Black-community story to a Black-led investigative newsroom. Coverage that mainstream outlets miss.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Capital B", authorRole: "Movement Organization", targetUrl: "https://capitalbnews.org/", topImageKey: "org_capital-b" },
  { id: 1024, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch a gender + politics story", description: "Pitch a story on abortion access, trans healthcare bans, or gender + politics. They cover what AP won't.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The 19th*", authorRole: "Movement Organization", targetUrl: "https://19thnews.org/", topImageKey: "org_the-19th", amplifiesGroups: ["woman", "repro", "lgbtq"] },
  { id: 1025, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch on local DA / sheriff / election admin", description: "Pitch on your local DA, sheriff, or election admin. MAGA's takeover happens at county level — Bolts covers it nationally.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Bolts Magazine", authorRole: "Movement Organization", targetUrl: "https://boltsmag.org/", topImageKey: "org_bolts-magazine" },
  { id: 1026, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Send an investigative idea", description: "Pitch an investigative idea; they fund the reporter to chase it. Best route for a freelancer with a real lead.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Type Investigations", authorRole: "Movement Organization", targetUrl: "https://www.typeinvestigations.org/", topImageKey: "org_type-investigations" },
  { id: 1027, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch a war / civil-liberties story", description: "Pitch ex-Intercept reporters on US wars and civil liberties. Fewer institutional constraints, more aggressive coverage.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Drop Site News", authorRole: "Movement Organization", targetUrl: "https://www.dropsitenews.com/", topImageKey: "org_drop-site-news" },
  { id: 1028, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch a labor story (video)", description: "Pitch a labor story for video — strikes, union drives, wage theft. Their content goes viral on TikTok and IG.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "More Perfect Union", authorRole: "Movement Organization", targetUrl: "https://perfectunion.us/", topImageKey: "org_more-perfect-union" },
  { id: 1029, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Send a dark-money tip", description: "Tip Sirota's team on dark money or corporate corruption. They've forced multiple federal investigations.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Lever", authorRole: "Movement Organization", targetUrl: "https://www.levernews.com/", topImageKey: "org_the-lever" },
  { id: 1030, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Submit a campaign-finance tip", description: "Tip on a campaign-finance violation or shadow donor. Sludge specializes in unmasking who's actually paying for what.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sludge", authorRole: "Movement Organization", targetUrl: "https://readsludge.com/", topImageKey: "org_sludge" },
  { id: 1031, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Report a press-freedom violation", description: "Report any arrest, equipment seizure, or assault on a journalist. Trump-era press attacks need a public record.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "U.S. Press Freedom Tracker", authorRole: "Movement Organization", targetUrl: "https://pressfreedomtracker.us/submit-incident/", topImageKey: "org_u-s-press-freedom-tracker", amplifiesGroups: ["journalist"] },
  { id: 1032, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Find your nearest chapter + meeting time", description: "Find your nearest DSA chapter and meeting time. Local chapters run mutual aid, tenant work, and electoral campaigns.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "DSA (Democratic Socialists of America)", authorRole: "Movement Organization", targetUrl: "https://www.dsausa.org/", topImageKey: "org_dsa-democratic-socialists-of-america" },
  { id: 1033, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Apply to a virtual intro call", description: "White-led solidarity for Black, brown, and Indigenous-led campaigns. Apply for the virtual intro to start showing up.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "SURJ (Showing Up for Racial Justice)", authorRole: "Movement Organization", targetUrl: "https://surj.org/", topImageKey: "org_surj-showing-up-for-racial-justice" },
  { id: 1034, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Sign up for a hub welcome call", description: "Youth-led climate org with remote-friendly local hubs. Sign up for a welcome call to find your role this season.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sunrise Movement", authorRole: "Movement Organization", targetUrl: "https://www.sunrisemovement.org/", topImageKey: "org_sunrise-movement" },
  { id: 1035, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "RSVP for next event (local + virtual)", description: "RSVP to the next local + virtual event. WFP runs electoral campaigns and issue ballot fights state by state.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Working Families Party", authorRole: "Movement Organization", targetUrl: "https://workingfamilies.org/", topImageKey: "org_working-families-party" },
  { id: 1036, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Join virtual monthly mass assembly", description: "Rev. Barber's monthly mass assembly fuses faith and policy. Join virtually to plug into Poor People's organizing nationally.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Poor People's Campaign (Rev. Barber)", authorRole: "Movement Organization", targetUrl: "https://www.poorpeoplescampaign.org/", topImageKey: "org_poor-people-s-campaign-rev-barber" },
  { id: 1037, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Find your local circle", description: "Latinx-led organizing focused on immigration defense and abolition. Find your local circle.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mijente", authorRole: "Movement Organization", targetUrl: "https://mijente.net/", topImageKey: "org_mijente", amplifiesGroups: ["immigrant"] },
  { id: 1038, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Find a local team", description: "Mom-led climate org with neighborhood teams. Find a local team — work fits around school pickups and naptime.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mothers Out Front", authorRole: "Movement Organization", targetUrl: "https://mothersoutfront.org/", topImageKey: "org_mothers-out-front", amplifiesGroups: ["woman"] },
  { id: 1039, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Find a local group", description: "Progressive Jewish organizing against Christian nationalism and authoritarianism. Find a local group.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Bend the Arc (Jewish progressive)", authorRole: "Movement Organization", targetUrl: "https://www.bendthearc.us/", topImageKey: "org_bend-the-arc-jewish-progressive" },
  { id: 1041, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Join a federal-worker organizing call", description: "Federal-worker organizing call. Trump's purges and RIFs are coordinated — cross-agency response has to be too.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Federal Unionists Network", authorRole: "Movement Organization", targetUrl: "https://www.federalunionists.net/", topImageKey: "org_federal-unionists-network", amplifiesGroups: ["fedWorker"] },
  { id: 1042, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Migrate your X follows to Bluesky", description: "Free extension finds your X follows on Bluesky in one click. Bring your network when you ditch Musk's platform.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sky Follower Bridge", authorRole: "Movement Organization", targetUrl: "https://skyfollowerbridge.com/", topImageKey: "org_sky-follower-bridge", imageContain: true },
  { id: 1043, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Make a Bluesky account", description: "Make a Bluesky account. No algorithm tilt, no Musk, no Meta — where activist Twitter rebuilt itself.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Bluesky", authorRole: "Movement Organization", targetUrl: "https://bsky.app/", topImageKey: "org_bluesky" },
  { id: 1044, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Make a Mastodon account on a movement-aligned server", description: "Mastodon account on an anti-fascist server. Federated, no corporate owner, harder to deplatform leftists.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Kolektiva (Mastodon)", authorRole: "Movement Organization", targetUrl: "https://kolektiva.social/", topImageKey: "org_kolektiva-mastodon" },
  { id: 1045, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Save a threatened page now", description: "One-click archive of any URL — .gov pages, news, evidence. Scrub-proof your sources before they vanish.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Wayback Machine 'Save Page Now'", authorRole: "Movement Organization", targetUrl: "https://web.archive.org/save", topImageKey: "org_wayback-machine-save-page-now" },
  { id: 1046, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Make a Pixelfed account (federated Insta)", description: "Federated photo-sharing, no algorithm. Activist-friendly Insta alternative with no Meta tracking or shadowban.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Pixelfed", authorRole: "Movement Organization", targetUrl: "https://pixelfed.social/", topImageKey: "org_pixelfed" },
  { id: 1047, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Embroider + ship a Trump quote to the archive", description: "Embroider a Trump quote and ship it to the archive. Group exhibitions, gallery shows, permanent record.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Tiny Pricks Project", authorRole: "Movement Organization", targetUrl: "https://www.tinypricksproject.com/", topImageKey: "org_tiny-pricks-project" },
  { id: 1048, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Knit a Welcome Blanket for a new immigrant", description: "Knit a 40\" blanket with a welcome note. Each is hand-delivered to a newly-arrived immigrant family.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Welcome Blanket Project", authorRole: "Movement Organization", targetUrl: "https://www.welcomeblanket.org/", topImageKey: "org_welcome-blanket-project", amplifiesGroups: ["immigrant"] },
  { id: 1049, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Knit a Pussyhat from updated patterns", description: "Knit a Pussyhat from updated patterns or mail one in for the next march. Visible cohort = visible resistance.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Pussyhat Project", authorRole: "Movement Organization", targetUrl: "https://www.pussyhatproject.com/", topImageKey: "org_pussyhat-project", amplifiesGroups: ["woman"] },
  { id: 1050, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Sign up for the postcard drop", description: "Hand-illustrate postcards to swing-district voters. Personal mail still cuts through algorithm-poisoned discourse.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "The Postcard Posse", authorRole: "Movement Organization", targetUrl: "https://thepostcardposse.org/", topImageKey: "org_the-postcard-posse" },
  { id: 1051, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Mail a handmade card to a detained migrant", description: "Mail handmade cards to a specific person in ICE detention. Mail breaks isolation; signals 'someone's watching'.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Freedom for Immigrants", authorRole: "Movement Organization", targetUrl: "https://www.freedomforimmigrants.org/", topImageKey: "org_freedom-for-immigrants", amplifiesGroups: ["immigrant"] },
  { id: 1052, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign petitions to overturn Citizens United", description: "Sign petitions for the constitutional amendment overturning Citizens United. Long fight; needs persistent pressure.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Move to Amend", authorRole: "Movement Organization", targetUrl: "https://www.movetoamend.org/", topImageKey: "org_move-to-amend" },
  { id: 1053, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign current petitions", description: "Sign petitions on corporate accountability and judicial reform. Their pressure has produced FTC and SEC actions.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Public Citizen", authorRole: "Movement Organization", targetUrl: "https://www.citizen.org/", topImageKey: "org_public-citizen" },
  { id: 1054, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Demand fair maps — end partisan gerrymandering", description: "Sign for independent redistricting. Gerrymandered maps let MAGA hold state legislatures with 30% of voters.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/tell-congress-we-demand-fair-maps/", topImageKey: "org_common-cause" },
  { id: 1055, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign court-reform petitions", description: "Sign court-reform petitions. Demand Justice drove the SCOTUS-expansion conversation — momentum keeps it alive.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Demand Justice", authorRole: "Movement Organization", targetUrl: "https://demandjustice.org/", topImageKey: "org_demand-justice" },
  { id: 1056, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign media-reform petitions", description: "Sign petitions on platform disinfo, net neutrality, and FCC oversight. Trump's FCC is gutting consumer protections.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Free Press", authorRole: "Movement Organization", targetUrl: "https://www.freepress.net/", topImageKey: "org_free-press" },
  { id: 1057, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign civil-rights petitions", description: "Sign petitions on ICE detention and warrantless surveillance. CCR wins these in court — your name builds standing.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Center for Constitutional Rights", authorRole: "Movement Organization", targetUrl: "https://ccrjustice.org/", topImageKey: "org_center-for-constitutional-rights" },
  { id: 1058, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign Black-led racial-justice petitions", description: "Sign Black-led racial-justice petitions — police accountability, voting rights, corporate equity. CoC moves money.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Color of Change", authorRole: "Movement Organization", targetUrl: "https://colorofchange.org/", topImageKey: "org_color-of-change" },
  { id: 1059, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign civil-liberties petitions", description: "Sign civil-liberties petitions on surveillance, big-tech, and antitrust. Their email pressure flips swing senators.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Demand Progress", authorRole: "Movement Organization", targetUrl: "https://demandprogress.org/", topImageKey: "org_demand-progress" },
  { id: 1060, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign AAPI petitions", description: "Sign AAPI campaigns on hate-crime response, immigration, and voting access. Trump's anti-Asian rhetoric needs counter-pressure.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "18MillionRising", authorRole: "Movement Organization", targetUrl: "https://www.18millionrising.org/actions/", topImageKey: "org_18millionrising" },
  { id: 1061, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign Christian-rooted petitions vs. Christian nationalism", description: "Sign Christian petitions against Christian nationalism. The right's loudest base needs visible religious dissent — that's you.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Faithful America", authorRole: "Movement Organization", targetUrl: "https://www.faithfulamerica.org/", topImageKey: "org_faithful-america" },
  { id: 1062, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign anti-militarism petitions", description: "Sign anti-war petitions targeting the Pentagon budget and weapons sales. Restrain Trump's foreign-policy improv.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Win Without War", authorRole: "Movement Organization", targetUrl: "https://winwithoutwar.org/", topImageKey: "org_win-without-war" },
  { id: 1063, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign petitions to close ICE facilities", description: "Sign petitions targeting specific ICE detention facilities for closure. Local fights, federal pressure.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Detention Watch Network", authorRole: "Movement Organization", targetUrl: "https://www.detentionwatchnetwork.org/", topImageKey: "org_detention-watch-network", amplifiesGroups: ["immigrant"] },
  { id: 1064, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign the open letter against book bans", description: "Sign the open letter against book bans. Names from authors, librarians, and readers create local-news pressure.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Authors Against Book Bans", authorRole: "Movement Organization", targetUrl: "https://www.authorsagainstbookbans.com/", topImageKey: "org_authors-against-book-bans", amplifiesGroups: ["libraryWorker", "educator", "student"] },
  { id: 1065, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign Avaaz US-targeted petitions", description: "Sign Avaaz US-targeted petitions. High signature volume amplifies pressure on Congress and corporations.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Avaaz", authorRole: "Movement Organization", targetUrl: "https://secure.avaaz.org/page/en/", topImageKey: "org_avaaz" },
  { id: 1066, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign the petition to protect voting rights in the Senate", description: "Tell your senators to defend voting rights against the assault on free and fair elections. People For's open call to action.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "People For (formerly People For the American Way)", authorRole: "Movement Organization", targetUrl: "https://www.peoplefor.org/urge-senate-protect-voting-rights", topImageKey: "org_people-for-formerly-people-for-the-american-way" },
  { id: 1067, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign children's-rights petitions", description: "Sign petitions on child healthcare, gun violence, and poverty programs. Trump's budget cuts hit kids first.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Children's Defense Fund", authorRole: "Movement Organization", targetUrl: "https://www.childrensdefense.org/", topImageKey: "org_children-s-defense-fund" },
  { id: 1068, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Become a SURJ member", description: "Become a SURJ member to organize white people for racial justice. Apply for the virtual intro call.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Showing Up for Racial Justice", authorRole: "Movement Organization", targetUrl: "https://surj.org/", topImageKey: "org_showing-up-for-racial-justice" },
  { id: 1069, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Become a DSA member", description: "DSA chapters run mutual aid, electoral, and tenant work in nearly every metro. Joining locally finds the doers near you.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Democratic Socialists of America", authorRole: "Movement Organization", targetUrl: "https://www.dsausa.org/", topImageKey: "org_democratic-socialists-of-america" },
  { id: 1070, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Sunrise Movement", description: "Climate-led, youth-driven org. Join Sunrise to organize for the Green New Deal and climate accountability.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sunrise Movement", authorRole: "Movement Organization", targetUrl: "https://www.sunrisemovement.org/", topImageKey: "org_sunrise-movement" },
  { id: 1071, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Mijente", description: "Latinx organizing for immigration defense and abolition. Local circles plug you in to immediate work.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mijente", authorRole: "Movement Organization", targetUrl: "https://mijente.net/", topImageKey: "org_mijente", amplifiesGroups: ["immigrant"] },
  { id: 1072, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join United We Dream", description: "Largest immigrant-youth-led network in the country. Plug into ICE response, deportation defense, and policy work.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "United We Dream", authorRole: "Movement Organization", targetUrl: "https://unitedwedream.org/", topImageKey: "org_united-we-dream", amplifiesGroups: ["immigrant"] },
  { id: 1073, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Bend the Arc", description: "Jewish anti-authoritarian organizing. Join to find Jewish-led action against Christian nationalism near you.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Bend the Arc (Jewish progressive)", authorRole: "Movement Organization", targetUrl: "https://www.bendthearc.us/", topImageKey: "org_bend-the-arc-jewish-progressive" },
  { id: 1074, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Jewish Voice for Peace", description: "Jewish-led anti-occupation and civil-liberties organizing. Local chapters in 70+ cities.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Jewish Voice for Peace", authorRole: "Movement Organization", targetUrl: "https://www.jewishvoiceforpeace.org/", topImageKey: "org_jewish-voice-for-peace" },
  { id: 1075, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join T'ruah (rabbinic human rights)", description: "Rabbinic human rights org. Rabbis + cantors lead immigration defense, anti-Christian-nationalism, and dignity work.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "T'ruah", authorRole: "Movement Organization", targetUrl: "https://truah.org/", topImageKey: "org_t-ruah" },
  { id: 1076, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Subscribe to FCNL action alerts (Quaker)", description: "Quaker action alerts for constituent calls and emails. Pacifist-rooted, focused on Pentagon budget and immigration.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Friends Committee on National Legislation", authorRole: "Movement Organization", targetUrl: "https://www.fcnl.org/", topImageKey: "org_friends-committee-on-national-legislation" },
  { id: 1077, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Pax Christi USA (Catholic peace)", description: "Catholic peace + justice movement. Join for nonviolence training and faith-rooted resistance to militarism.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Pax Christi USA", authorRole: "Movement Organization", targetUrl: "https://paxchristiusa.org/", topImageKey: "org_pax-christi-usa" },
  { id: 1078, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a NETWORK action (Catholic social justice)", description: "Catholic social-justice lobby. Take action on healthcare, immigration, and the federal budget — nuns lead this.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NETWORK Lobby", authorRole: "Movement Organization", targetUrl: "https://networklobby.org/", topImageKey: "org_network-lobby" },
  { id: 1080, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a Sikh Coalition action", description: "Sikh civil-rights advocacy. Take action on hate-crime response, religious-discrimination, and racial profiling.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sikh Coalition", authorRole: "Movement Organization", targetUrl: "https://www.sikhcoalition.org/", topImageKey: "org_sikh-coalition" },
  { id: 1084, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Volunteer with Mothers Out Front", description: "Volunteer with Mothers Out Front. Mom-led climate org with flexible roles around school and family schedules.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mothers Out Front", authorRole: "Movement Organization", targetUrl: "https://mothersoutfront.org/", topImageKey: "org_mothers-out-front", amplifiesGroups: ["woman"] },
  { id: 1085, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take an ADAPT action (disability rights)", description: "Take an ADAPT action — disability-led direct action against Medicaid cuts and institutionalization.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "ADAPT", authorRole: "Movement Organization", targetUrl: "https://adapt.org/", topImageKey: "org_adapt", amplifiesGroups: ["disabled"] },
  { id: 1086, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a Black Voters Matter action", description: "Take a Black Voters Matter action. Voter-protection fights happen at county and state level — they target there.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Black Voters Matter", authorRole: "Movement Organization", targetUrl: "https://blackvotersmatterfund.org/", topImageKey: "org_black-voters-matter" },
  { id: 1087, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a Mi Familia Vota action", description: "Take a Mi Familia Vota action. Latino civic engagement — voter registration and protection in swing states.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mi Familia Vota", authorRole: "Movement Organization", targetUrl: "https://www.mifamiliavota.org/", topImageKey: "org_mi-familia-vota", amplifiesGroups: ["immigrant"] },
  { id: 1088, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a Climate Justice Alliance action", description: "Take a Climate Justice Alliance action. Frontline community-led climate fights — pipelines, refineries, evictions.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Climate Justice Alliance", authorRole: "Movement Organization", targetUrl: "https://climatejusticealliance.org/", topImageKey: "org_climate-justice-alliance" },
  { id: 1091, category: "HOUSING", categoryColor: "#0a5b89", actionType: "In Person Group", title: "Sponsor a refugee household", description: "Sponsor a refugee household through a verified federal pathway. Remote prep work counts.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Welcome.US", authorRole: "Movement Organization", targetUrl: "https://welcome.us/", topImageKey: "org_welcome-us", amplifiesGroups: ["immigrant"] },
  { id: 1092, category: "HOUSING", categoryColor: "#0a5b89", actionType: "In Person Group", title: "Make your city 'welcoming' for immigrants", description: "Push your city to certify as a 'welcoming city' for immigrants. Public commitment makes ICE cooperation costly.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Welcoming America", authorRole: "Movement Organization", targetUrl: "https://welcomingamerica.org/", topImageKey: "org_welcoming-america", amplifiesGroups: ["immigrant"] },
  { id: 1093, category: "HOUSING", categoryColor: "#0a5b89", actionType: "In Person Group", title: "Pressure your mayor on sanctuary policy", description: "Pressure your mayor to join the immigrant-friendly cities coalition. Mayoral commitments slow ICE locally.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Cities for Action", authorRole: "Movement Organization", targetUrl: "https://www.citiesforaction.us/", topImageKey: "org_cities-for-action", amplifiesGroups: ["immigrant"] },
  { id: 1094, category: "HOUSING", categoryColor: "#0a5b89", actionType: "In Person Group", title: "Volunteer to furnish + resettle refugee homes", description: "Furnish + resettle refugee homes — physical setup or remote logistics. Trump's cuts mean more families with less support.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Homes Not Borders", authorRole: "Movement Organization", targetUrl: "https://www.homesnotborders.org/", topImageKey: "org_homes-not-borders", amplifiesGroups: ["immigrant"] },
  { id: 1095, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Get an organizer for your workplace", description: "Free organizer helps you unionize your workplace, confidentially. Trump's NLRB is gutted — build power directly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "EWOC (Emergency Workplace Organizing Committee)", authorRole: "Movement Organization", targetUrl: "https://workerorganizing.org/", topImageKey: "org_ewoc-emergency-workplace-organizing-committee", amplifiesGroups: ["unionWorker", "lowIncome"] },
  { id: 1096, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Join the federal-worker network", description: "Join the federal-worker network. Trump's RIFs and Schedule F purges need cross-agency mutual aid + organizing.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Federal Unionists Network", authorRole: "Movement Organization", targetUrl: "https://www.federalunionists.net/", topImageKey: "org_federal-unionists-network", amplifiesGroups: ["fedWorker", "unionWorker"] },
  { id: 1097, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Subscribe to independent labor media", description: "Subscribe to indie labor media + training calendar. Best source for what's happening in shops outside the big unions.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Labor Notes", authorRole: "Movement Organization", targetUrl: "https://labornotes.org/", topImageKey: "org_labor-notes", amplifiesGroups: ["unionWorker"] },
  { id: 1098, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Start a workplace petition", description: "Host a workplace petition — raises, anti-ICE-cooperation pledges. Public petitions force the boss to acknowledge.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Coworker.org", authorRole: "Movement Organization", targetUrl: "https://home.coworker.org/", topImageKey: "org_coworker-org", amplifiesGroups: ["unionWorker", "lowIncome"] },
  { id: 1099, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Take a UE solidarity action", description: "Solidarity action with UE — independent rank-and-file union. Often the most aggressive on contract fights.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "UE (United Electrical Workers)", authorRole: "Movement Organization", targetUrl: "https://www.ueunion.org/", topImageKey: "org_ue-united-electrical-workers", amplifiesGroups: ["unionWorker"] },
  { id: 1100, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Apply for IWW membership", description: "Apply for IWW membership. All-trades radical union; remote onboarding. Best fit if your shop won't tolerate the bigs.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Industrial Workers of the World", authorRole: "Movement Organization", targetUrl: "https://www.iww.org/", topImageKey: "org_industrial-workers-of-the-world", amplifiesGroups: ["unionWorker", "lowIncome"] },
  { id: 1101, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Sign on to a National Domestic Workers Alliance campaign", description: "Sign on to NDWA campaigns. Domestic workers (housekeepers, nannies, caregivers) organizing for federal protections.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "National Domestic Workers Alliance", authorRole: "Movement Organization", targetUrl: "https://www.domesticworkers.org/", topImageKey: "org_national-domestic-workers-alliance", amplifiesGroups: ["woman", "immigrant", "lowIncome"] },
  { id: 1102, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Send solidarity to Starbucks Workers United", description: "Send solidarity to Starbucks workers fighting union-busting. Their store-by-store wins set the precedent for service work.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Starbucks Workers United", authorRole: "Movement Organization", targetUrl: "https://sbworkersunited.org/", topImageKey: "org_starbucks-workers-united", amplifiesGroups: ["unionWorker", "lowIncome"] },
  { id: 1103, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Take an Amazon Labor Union action", description: "Take an Amazon Labor Union action. The hardest org fight in the country — solidarity dollars and petitions matter.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Amazon Labor Union (IBT Local 1)", authorRole: "Movement Organization", targetUrl: "https://www.amazonlaborunion.org/", topImageKey: "org_amazon-labor-union-ibt-local-1", amplifiesGroups: ["unionWorker", "lowIncome"] },
  { id: 1104, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Use the free legal hotline (workplace family rights)", description: "Free legal hotline for workplace family + caregiving rights. Use if you're being denied FMLA, pumping breaks, or accommodations.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "A Better Balance", authorRole: "Movement Organization", targetUrl: "https://www.abetterbalance.org/", topImageKey: "org_a-better-balance", amplifiesGroups: ["woman", "lowIncome"] },
  { id: 1105, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Sign on to a Fight For A Union worker campaign", description: "Successor to Fight for $15. Sign on to a sectoral campaign for living wages and a real union, not just minimums.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Fight For A Union", authorRole: "Movement Organization", targetUrl: "https://fightforaunion.org/", topImageKey: "org_fight-for-a-union", amplifiesGroups: ["unionWorker", "lowIncome"] },
  { id: 1106, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Sign the moral covenant", description: "Sign Rev. Barber's moral covenant. Poor people's commitment to anti-poverty action grounded in faith and policy.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Repairers of the Breach (Rev. Barber)", authorRole: "Movement Organization", targetUrl: "https://breachrepairers.org/", topImageKey: "org_repairers-of-the-breach-rev-barber" },
  { id: 1107, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Subscribe to action alerts", description: "Subscribe to Sojourners' Christian-justice action alerts. Progressive Christian voice in DC policy fights.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sojourners", authorRole: "Movement Organization", targetUrl: "https://sojo.net/", topImageKey: "org_sojourners" },
  { id: 1108, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Subscribe to actions", description: "Subscribe to Faithful America's Christian-rooted campaigns against Christian nationalism. Visible religious dissent.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Faithful America", authorRole: "Movement Organization", targetUrl: "https://www.faithfulamerica.org/", topImageKey: "org_faithful-america" },
  { id: 1109, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Sign on to a Faith in Public Life advocacy action", description: "Sign on to multi-faith advocacy actions. Coalition lobbying that fuses Christian, Jewish, Muslim, and Hindu progressives.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Faith in Public Life", authorRole: "Movement Organization", targetUrl: "https://www.faithinpubliclife.org/", topImageKey: "org_faith-in-public-life" },
  { id: 1110, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Take a rabbinic action", description: "Take a rabbinic action. Rabbis and cantors organize on immigration, occupation, and Christian nationalism.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "T'ruah", authorRole: "Movement Organization", targetUrl: "https://truah.org/", topImageKey: "org_t-ruah" },
  { id: 1111, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Sign on to a Pax Christi USA peace action", description: "Sign Pax Christi USA peace actions. Catholic-rooted resistance to militarism and the Pentagon budget.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Pax Christi USA", authorRole: "Movement Organization", targetUrl: "https://paxchristiusa.org/", topImageKey: "org_pax-christi-usa" },
  { id: 1112, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Subscribe to Quaker action alerts", description: "Subscribe to Quaker constituent-action emails. Pacifist-rooted, focused on Pentagon and immigration policy.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Friends Committee on National Legislation", authorRole: "Movement Organization", targetUrl: "https://www.fcnl.org/", topImageKey: "org_friends-committee-on-national-legislation" },
  { id: 1113, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Sign on to an Auburn Seminary faith-leader campaign", description: "Sign on to faith-leader campaigns. Auburn trains multi-faith clergy in social justice and movement leadership.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Auburn Seminary", authorRole: "Movement Organization", targetUrl: "https://auburnseminary.org/", topImageKey: "org_auburn-seminary" },
  { id: 1115, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Sign on to a Hindus for Human Rights action", description: "Counter Hindu nationalism in US politics. Sign on as a Hindu or ally; Modi's allies have major Trump-admin ties.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Hindus for Human Rights", authorRole: "Movement Organization", targetUrl: "https://www.hindusforhumanrights.org/", topImageKey: "org_hindus-for-human-rights" },
  { id: 1116, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Sign on to a Sikh Coalition civil-rights action", description: "Sign Sikh Coalition civil-rights actions. Hate-crime response, religious-discrimination, and racial-profiling work.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sikh Coalition", authorRole: "Movement Organization", targetUrl: "https://www.sikhcoalition.org/", topImageKey: "org_sikh-coalition" },
  { id: 1117, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Sign up as a volunteer attorney", description: "Sign up as a volunteer attorney. Match takes 20 minutes; cases include immigrants, election workers, federal whistleblowers.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "We the Action", authorRole: "Movement Organization", targetUrl: "https://wetheaction.org/", topImageKey: "org_we-the-action", amplifiesGroups: ["lawyer", "immigrant", "electionWorker", "whistleblower"] },
  { id: 1118, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer as an attorney", description: "Hours go to immigrants and federal workers fighting Trump-era retaliation. Lawyers especially — 20-min match.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Lawyers for Good Government", authorRole: "Movement Organization", targetUrl: "https://www.lawyersforgoodgovernment.org/", topImageKey: "org_lawyers-for-good-government", amplifiesGroups: ["lawyer", "immigrant", "fedWorker"] },
  { id: 1119, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Find pro bono cases (formerly Pro Bono Net)", description: "Find pro bono cases. Volunteer-attorney matching for civil-legal cases — most need procedural help, not litigation.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Scale Justice (Pro Bono Net)", authorRole: "Movement Organization", targetUrl: "https://scalejustice.org/", topImageKey: "org_scale-justice-pro-bono-net", amplifiesGroups: ["lawyer"] },
  { id: 1120, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer your tech skills", description: "Volunteer your tech skills. Local brigades build tools for governments and nonprofits — replace shitty .gov UX.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Code for America", authorRole: "Movement Organization", targetUrl: "https://codeforamerica.org/", topImageKey: "org_code-for-america" },
  { id: 1121, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Sign up as a tech volunteer", description: "Sign up as a tech volunteer. Project matching for devs, designers, and PMs supporting democracy-org tooling.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "DemocracyLab", authorRole: "Movement Organization", targetUrl: "https://www.democracylab.org/", topImageKey: "org_democracylab" },
  { id: 1122, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer your professional skills", description: "Volunteer your professional skills (design, marketing, ops, finance) to nonprofits. 1–10 hour bites; remote-friendly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Catchafire", authorRole: "Movement Organization", targetUrl: "https://www.catchafire.org/", topImageKey: "org_catchafire" },
  { id: 1123, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer as a translator", description: "Volunteer as a translator for asylum cases. Crisis-language work — hours can save someone from deportation.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Respond Crisis Translation", authorRole: "Movement Organization", targetUrl: "https://respondcrisistranslation.org/", topImageKey: "org_respond-crisis-translation", imageContain: true, amplifiesGroups: ["immigrant"] },
  { id: 1124, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer as a linguist", description: "Volunteer as a linguist for crisis-response work. Less-resourced languages especially needed for refugee work.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "CLEAR Global", authorRole: "Movement Organization", targetUrl: "https://clearglobal.org/", topImageKey: "org_clear-global", amplifiesGroups: ["immigrant"] },
  { id: 1125, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Sign on to a Doctors for America healthcare campaign", description: "Sign on to Doctors for America campaigns. Medical voices that move members of Congress on Medicaid + ACA.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Doctors for America", authorRole: "Movement Organization", targetUrl: "https://www.doctorsforamerica.org/", topImageKey: "org_doctors-for-america" },
  { id: 1126, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Train as asylum-evaluation clinician", description: "Train as an asylum-evaluation clinician. Forensic medical exams for asylum cases — without one, deportation odds spike.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Physicians for Human Rights", authorRole: "Movement Organization", targetUrl: "https://phr.org/", topImageKey: "org_physicians-for-human-rights", amplifiesGroups: ["immigrant"] },
  { id: 1127, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Sign up to run for office (STEM)", description: "Sign up to run for office (STEM). Trump's anti-science agenda needs scientists in office — they'll train you.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "314 Action", authorRole: "Movement Organization", targetUrl: "https://314action.org/", topImageKey: "org_314-action", amplifiesGroups: ["scientist"] },
  { id: 1128, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer with Authors Against Book Bans", description: "Volunteer with Authors Against Book Bans. Authors, librarians, readers showing up at school-board meetings.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Authors Against Book Bans", authorRole: "Movement Organization", targetUrl: "https://www.authorsagainstbookbans.com/", topImageKey: "org_authors-against-book-bans", amplifiesGroups: ["libraryWorker", "educator"] },
  { id: 1129, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Join Concerned Archivists Alliance", description: "Archivists organizing to preserve federal records as Trump scrubs them. Need archivists, devs, and metadata pros.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Concerned Archivists Alliance", authorRole: "Movement Organization", targetUrl: "https://concernedarchivists.wordpress.com/", topImageKey: "org_concerned-archivists-alliance", amplifiesGroups: ["libraryWorker", "scientist"] },
  { id: 1130, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer on detained-immigrant cases", description: "Volunteer on detained-immigrant cases. Free training + case match. Pro bono representation triples release odds.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Immigration Justice Campaign", authorRole: "Movement Organization", targetUrl: "https://immigrationjustice.us/", topImageKey: "org_immigration-justice-campaign", amplifiesGroups: ["immigrant"] },
  { id: 1131, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Take the anti-coup civil-resistance pledge", description: "Take the anti-coup civil-resistance pledge. Public commitment to nonviolent action if Trump refuses to leave office.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Choose Democracy", authorRole: "Movement Organization", targetUrl: "https://choosedemocracy.us/", topImageKey: "org_choose-democracy" },
  { id: 1133, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Make daily-call habit", description: "Daily script + your reps' direct lines. Two minutes a weekday is what stopped 2017's ACA repeal — same model works.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "5 Calls", authorRole: "Movement Organization", targetUrl: "https://5calls.org/", topImageKey: "org_5-calls" },
  { id: 1134, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Set up daily texts to your reps", description: "Text RESIST to 50409. Resistbot turns your text into emails, faxes, or letters to your reps — daily takes seconds.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Resistbot", authorRole: "Movement Organization", targetUrl: "https://resist.bot/", topImageKey: "org_resistbot", firstTimerFriendly: true },
  { id: 1135, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Carry KYR cards for ICE encounters", description: "Print + carry Know-Your-Rights cards. Pull one out if ICE approaches — works for citizen and non-citizen alike.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Immigrant Defense Project", authorRole: "Movement Organization", targetUrl: "https://www.immigrantdefenseproject.org/", topImageKey: "org_immigrant-defense-project", amplifiesGroups: ["immigrant"] },
  { id: 1137, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Set election reminders for every contest", description: "Reminders for every contest — primaries, school board, judges. Off-cycle elections are where MAGA quietly stacks boards.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Vote.org", authorRole: "Movement Organization", targetUrl: "https://www.vote.org/", topImageKey: "org_vote-org" },
  { id: 1138, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send an SMS that becomes an email/fax to your reps", description: "Text turns into emails or faxes to your reps. Resistbot is the laziest possible way to keep contacting them.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Resistbot", authorRole: "Movement Organization", targetUrl: "https://resist.bot/", topImageKey: "org_resistbot", firstTimerFriendly: true },
  { id: 1139, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send today's email script", description: "Send today's email script to your reps. 5 Calls' staff write the message; you spend 90 seconds personalizing.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "5 Calls", authorRole: "Movement Organization", targetUrl: "https://5calls.org/", topImageKey: "org_5-calls" },
  { id: 1140, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: reject mass government surveillance", description: "Email your reps to oppose surveillance expansion. Trump's DHS uses these tools to track immigrants, journalists, and protesters.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/tell-congress-reject-mass-government-surveillance/", topImageKey: "org_common-cause", firstTimerFriendly: true },
  { id: 1141, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send email-your-rep", description: "Email-your-rep on consumer protection and corporate accountability fights. Their tracker is updated weekly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Public Citizen", authorRole: "Movement Organization", targetUrl: "https://www.citizen.org/", topImageKey: "org_public-citizen" },
  { id: 1142, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send anti-militarism email", description: "Send an anti-militarism email to your reps. Win Without War targets Pentagon budget votes specifically.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Win Without War", authorRole: "Movement Organization", targetUrl: "https://winwithoutwar.org/", topImageKey: "org_win-without-war" },
  { id: 1143, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send Christian-rooted email-your-rep", description: "Send a Christian-rooted email-your-rep. Religious framing changes which Republicans actually engage.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Faithful America", authorRole: "Movement Organization", targetUrl: "https://www.faithfulamerica.org/", topImageKey: "org_faithful-america" },
  { id: 1144, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send Quaker constituent email", description: "Send a Quaker constituent email. FCNL writes the script; email lands at your senator's office in seconds.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Friends Committee on National Legislation", authorRole: "Movement Organization", targetUrl: "https://www.fcnl.org/", topImageKey: "org_friends-committee-on-national-legislation" },
  { id: 1145, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email targeting specific ICE facilities", description: "Email actions against specific ICE facility operators. Detention Watch identifies who to pressure for closures.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Detention Watch Network", authorRole: "Movement Organization", targetUrl: "https://www.detentionwatchnetwork.org/", topImageKey: "org_detention-watch-network", amplifiesGroups: ["immigrant"] },
  { id: 1146, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email your school board re: book bans", description: "Email your school board against book bans. Pre-written templates work — boards capitulate when pressure hits.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Authors Against Book Bans", authorRole: "Movement Organization", targetUrl: "https://www.authorsagainstbookbans.com/", topImageKey: "org_authors-against-book-bans", amplifiesGroups: ["libraryWorker", "educator", "student"] },
  { id: 1147, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Sign up for a workshop", description: "Workshops most arrest-action groups send people through. Get de-escalation and jail-support before you need them.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Training for Change", authorRole: "Movement Organization", targetUrl: "https://www.trainingforchange.org/", topImageKey: "org_training-for-change" },
  { id: 1148, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Sign up for a training", description: "Direct-action training. Ruckus prepared protesters at Standing Rock and Occupy. Sign up for a workshop.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Ruckus Society", authorRole: "Movement Organization", targetUrl: "https://ruckus.org/", topImageKey: "org_ruckus-society" },
  { id: 1149, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Apply to a cohort", description: "Apply with your group for movement-strategy training. Best for orgs that need help going from reactive to strategic.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Wildfire Project", authorRole: "Movement Organization", targetUrl: "https://wildfireproject.org/", topImageKey: "org_wildfire-project" },
  { id: 1150, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Take a course", description: "Take an organizer course. Sliding-scale tuition; classes on de-escalation, racial justice, and base-building.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "PeoplesHub", authorRole: "Movement Organization", targetUrl: "https://www.peopleshub.org/", topImageKey: "org_peopleshub" },
  { id: 1151, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Enroll in a free training", description: "Learn what to actually do when ICE detains a neighbor or a Nazi accosts someone on transit. Free, 60–90 min.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Right To Be", authorRole: "Movement Organization", targetUrl: "https://righttobe.org/", topImageKey: "org_right-to-be" },
  { id: 1152, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Enroll in anti-coup training", description: "Enroll in anti-coup training. Free workshop calendar — what to do if Trump refuses a peaceful transfer of power.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Choose Democracy", authorRole: "Movement Organization", targetUrl: "https://choosedemocracy.us/", topImageKey: "org_choose-democracy" },
  { id: 1153, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Enroll in programs", description: "Storied southern movement school — MLK and Rosa Parks trained here. Apply for residential or virtual programs.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Highlander Center", authorRole: "Movement Organization", targetUrl: "https://beta.highlandercenter.org/", topImageKey: "org_highlander-center" },
  { id: 1154, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Sign up for a curriculum", description: "Sign up for just-transition + ecological-justice curriculum. Climate work that connects to labor and racial justice.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Movement Generation", authorRole: "Movement Organization", targetUrl: "https://movementgeneration.org/", topImageKey: "org_movement-generation" },
  { id: 1155, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Take an abolitionist study course", description: "Take an abolitionist study course. Free curricula; reading groups online and in cities. Replaces police 101 with care 101.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Project NIA", authorRole: "Movement Organization", targetUrl: "https://project-nia.org/", topImageKey: "org_project-nia" },
  { id: 1156, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Sign up for a reading group", description: "Sign up for an abolitionist reading group. Critical Resistance is OG abolition — Angela Davis co-founded it.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Critical Resistance", authorRole: "Movement Organization", targetUrl: "https://criticalresistance.org/", topImageKey: "org_critical-resistance" },
  { id: 1157, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Apply to be a paid poll worker", description: "Apply to be a paid poll worker. Local elections are short on workers; you get paid + protect access for hours of your day.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Power the Polls", authorRole: "Movement Organization", targetUrl: "https://www.powerthepolls.org/", topImageKey: "org_power-the-polls", amplifiesGroups: ["electionWorker"] },
  { id: 1158, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Take a Know Your Rights training", description: "Take a Know Your Rights training for ICE encounters. Live calendar; bring your block, household, or workplace.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Immigrant Defense Project", authorRole: "Movement Organization", targetUrl: "https://www.immigrantdefenseproject.org/", topImageKey: "org_immigrant-defense-project", amplifiesGroups: ["immigrant"] },
  { id: 1160, category: "SPREAD POSITIVITY", categoryColor: "#d97706", actionType: "Online", title: "Sign up for kindness-toned voter postcards", description: "Write hand-written postcards to swing-state voters. Personal mail still cuts through algorithm-fried discourse.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Postcards to Voters", authorRole: "Movement Organization", targetUrl: "https://postcardstovoters.org/", topImageKey: "org_postcards-to-voters" },
  { id: 1161, category: "SPREAD POSITIVITY", categoryColor: "#d97706", actionType: "Online", title: "Become a pen pal to a detained migrant", description: "Become a pen pal to a detained migrant. Mail breaks isolation in ICE detention; bilingual letters welcome.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Freedom for Immigrants", authorRole: "Movement Organization", targetUrl: "https://www.freedomforimmigrants.org/", topImageKey: "org_freedom-for-immigrants", amplifiesGroups: ["immigrant"], firstTimerFriendly: true },
  { id: 1162, category: "SPREAD POSITIVITY", categoryColor: "#d97706", actionType: "Online", title: "Volunteer (LGBTQ youth digital crisis support)", description: "Volunteer for LGBTQ youth digital crisis support. 24/7 chat/text/phone — paid training, ongoing support.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Trevor Project", authorRole: "Movement Organization", targetUrl: "https://www.thetrevorproject.org/", topImageKey: "org_the-trevor-project", amplifiesGroups: ["lgbtq"] },
  { id: 1164, category: "SPREAD POSITIVITY", categoryColor: "#d97706", actionType: "Online", title: "Practice rest-as-resistance prompts", description: "Practice rest-as-resistance prompts. Tricia Hersey's free library — burnout is the goal of fascism, sleep counters it.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Nap Ministry (Tricia Hersey)", authorRole: "Movement Organization", targetUrl: "https://thenapministry.wordpress.com/", topImageKey: "org_the-nap-ministry-tricia-hersey" },
  { id: 1165, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Find + amplify your local mutual aid", description: "Find + amplify your local mutual aid network. Map of US-wide groups — money, supplies, people on the ground.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mutual Aid Hub", authorRole: "Movement Organization", targetUrl: "https://www.mutualaidhub.org/", topImageKey: "org_mutual-aid-hub" },
  { id: 1166, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Boost a single Olive Branch family fund", description: "Boost a single Palestinian family's GoFundMe from a vetted queue. Direct, traceable, no big-org skim.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Operation Olive Branch", authorRole: "Movement Organization", targetUrl: "https://linktr.ee/opolivebranch", topImageKey: "org_operation-olive-branch" },
  { id: 1167, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Subscribe + share Capital B (Black-led)", description: "Subscribe + share Capital B coverage. Black-led investigative work that mainstream outlets don't cover.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Capital B", authorRole: "Movement Organization", targetUrl: "https://capitalbnews.org/", topImageKey: "org_capital-b" },
  { id: 1168, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Subscribe + share The 19th* (gender + politics)", description: "Subscribe + share The 19th. Gender + politics reporting on abortion, trans rights, and women's health under Trump.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The 19th*", authorRole: "Movement Organization", targetUrl: "https://19thnews.org/", topImageKey: "org_the-19th", amplifiesGroups: ["woman", "repro", "lgbtq"] },
  { id: 1169, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Subscribe + share Documented (NYC immigration)", description: "Subscribe + share Documented. NYC immigration-focused journalism that hits ICE operations in real time.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Documented", authorRole: "Movement Organization", targetUrl: "https://documentedny.com/", topImageKey: "org_documented", amplifiesGroups: ["immigrant"] },
  { id: 1171, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Subscribe + share The Lever", description: "Subscribe + share The Lever. Sirota's outfit on dark money and corporate corruption — best independent reporting.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Lever", authorRole: "Movement Organization", targetUrl: "https://www.levernews.com/", topImageKey: "org_the-lever" },
  { id: 1172, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Submit + share a press-freedom incident", description: "Submit + share press-freedom incidents. Public record of every press attack — fuels lawsuits and policy fights.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "U.S. Press Freedom Tracker", authorRole: "Movement Organization", targetUrl: "https://pressfreedomtracker.us/", topImageKey: "org_u-s-press-freedom-tracker", amplifiesGroups: ["journalist"] },
  { id: 1174, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Download free protest art", description: "Download free protest art. Pro-grade posters from Shepard Fairey and others; print at home for any march.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Amplifier", authorRole: "Movement Organization", targetUrl: "https://amplifier.org/", topImageKey: "org_amplifier" },
  { id: 1175, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Download free anti-fascist posters", description: "Download free anti-fascist posters. Co-op of printmakers; high-quality designs for protests, walls, and zines.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Justseeds Artists' Cooperative", authorRole: "Movement Organization", targetUrl: "https://justseeds.org/", topImageKey: "org_justseeds-artists-cooperative" },
  { id: 1176, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Download educational graphics", description: "Download educational graphics. Hand-drawn movement art — climate, mining, Trump-era issues. Free to print.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Beehive Design Collective", authorRole: "Movement Organization", targetUrl: "https://beehivecollective.org/", topImageKey: "org_beehive-design-collective" },
  { id: 1177, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Submit an embroidery piece", description: "Embroider a Trump quote and ship to the project archive. Permanent record + group-show exhibitions.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Tiny Pricks Project", authorRole: "Movement Organization", targetUrl: "https://www.tinypricksproject.com/", topImageKey: "org_tiny-pricks-project" },
  { id: 1178, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Apply to programs", description: "Apply for forum theater + virtual workshops. Boal's method for rehearsing political action — practice the protest.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Theatre of the Oppressed NYC", authorRole: "Movement Organization", targetUrl: "https://www.tonyc.nyc/", topImageKey: "org_theatre-of-the-oppressed-nyc" },
  { id: 1179, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Use the tactical-prank toolkit", description: "Use the Yes Men's tactical-prank toolkit. Step-by-step satire playbook — they impersonated execs to expose climate lies.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Yes Men", authorRole: "Movement Organization", targetUrl: "https://theyesmen.org/", topImageKey: "org_the-yes-men" },
  { id: 1180, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Refer an artist at risk", description: "Refer an artist at risk. Solidarity for persecuted artists — visa, legal, and relocation support during crackdowns.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Artists at Risk Connection (PEN America)", authorRole: "Movement Organization", targetUrl: "https://artistsatriskconnection.org/", topImageKey: "org_artists-at-risk-connection-pen-america" },
  { id: 1181, category: "ACT OF KINDNESS", categoryColor: "#0d8c6e", actionType: "Online", title: "Find your local mutual aid network", description: "Find your local mutual aid network. Pick one neighbor to support this week — money, food, rides, anything.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mutual Aid Hub", authorRole: "Movement Organization", targetUrl: "https://www.mutualaidhub.org/", topImageKey: "org_mutual-aid-hub" },
  { id: 1186, category: "ACT OF KINDNESS", categoryColor: "#0d8c6e", actionType: "Online", title: "Volunteer as a translator for asylum seekers", description: "Translate documents for asylum seekers. Hours of your time can prevent a deportation; bilingual = high-value.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Respond Crisis Translation", authorRole: "Movement Organization", targetUrl: "https://respondcrisistranslation.org/", topImageKey: "org_respond-crisis-translation", imageContain: true, amplifiesGroups: ["immigrant"] },
  { id: 1192, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Boost Sludge's dark-money & GOP-donor reporting", description: "Subscribe to Sludge and share their campaign-finance investigations on social. Counter dark-money disinfo with sourced reporting.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sludge", authorRole: "Movement Organization", targetUrl: "https://readsludge.com/", topImageKey: "org_sludge" },
  { id: 1193, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Boost Bolts Magazine's local-democracy reporting", description: "Subscribe to Bolts and share their local DA, sheriff, and election-admin coverage. Local democracy is where Trump-era threats land first.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Bolts Magazine", authorRole: "Movement Organization", targetUrl: "https://boltsmag.org/", topImageKey: "org_bolts-magazine" },
  { id: 1194, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Boost Drop Site News on Trump's wars & civil liberties", description: "Subscribe to Drop Site (ex-Intercept staff) and share their war and civil-liberties coverage. Counter the war-machine narrative.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Drop Site News", authorRole: "Movement Organization", targetUrl: "https://www.dropsitenews.com/", topImageKey: "org_drop-site-news" },
  { id: 1196, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Boost More Perfect Union's worker-power journalism", description: "Subscribe to More Perfect Union and share their worker-power video reporting. Anti-corporate journalism that hits Trump donors directly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "More Perfect Union", authorRole: "Movement Organization", targetUrl: "https://perfectunion.us/", topImageKey: "org_more-perfect-union" },
  { id: 1202, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Boost Inkstick's anti-war foreign-policy reporting", description: "Subscribe to Inkstick and share their non-DC foreign policy coverage. Counter the bipartisan war-and-empire consensus.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Inkstick Media", authorRole: "Movement Organization", targetUrl: "https://inkstickmedia.com/", topImageKey: "org_inkstick-media" },
  { id: 1203, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Read + share data", description: "Read + share wealth-concentration data. Inequality.org has the charts that make 'eat the rich' arguments concrete.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Inequality.org", authorRole: "Movement Organization", targetUrl: "https://inequality.org/", topImageKey: "org_inequality-org" },
  { id: 1204, category: "LETTER TO EDITOR", categoryColor: "#3f5c8c", actionType: "Online", title: "Sign up for op-ed training", description: "Sign up for op-ed training. They've placed thousands of underrepresented voices in major papers — works.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The OpEd Project", authorRole: "Movement Organization", targetUrl: "https://www.theopedproject.org/", topImageKey: "org_the-oped-project" },
  { id: 1205, category: "LETTER TO EDITOR", categoryColor: "#3f5c8c", actionType: "Online", title: "Use weekly LTE prompts (formerly Sister District)", description: "Use weekly LTE prompts targeting state-level fights. Coordinated submissions to district papers move ratings.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "States Win (FKA Sister District)", authorRole: "Movement Organization", targetUrl: "https://stateswin.org/", topImageKey: "org_states-win-fka-sister-district" },
  { id: 1206, category: "LETTER TO EDITOR", categoryColor: "#3f5c8c", actionType: "Online", title: "Use the Two-Minute Activist tool", description: "Use AAUW's two-minute activist tool. LTE templates + submission. Women's-org muscle behind every signature.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "AAUW", authorRole: "Movement Organization", targetUrl: "https://www.aauw.org/", topImageKey: "org_aauw", amplifiesGroups: ["woman"] },
  { id: 1207, category: "LETTER TO EDITOR", categoryColor: "#3f5c8c", actionType: "Online", title: "Use the LTE writer tool", description: "Use Sierra Club's LTE writer. Climate-focused, chapter-targeted, gets published in regional papers regularly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sierra Club", authorRole: "Movement Organization", targetUrl: "https://www.sierraclub.org/", topImageKey: "org_sierra-club" },
  { id: 1208, category: "LETTER TO EDITOR", categoryColor: "#3f5c8c", actionType: "Online", title: "Use LTE templates with verified statistics", description: "Use Inequality.org's LTE templates with verified stats. Drop the chart links and let editors do the rest.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Inequality.org", authorRole: "Movement Organization", targetUrl: "https://inequality.org/", topImageKey: "org_inequality-org" },
  { id: 1215, category: "Call", categoryColor: "#c2185b", actionType: "Online", title: "Call peer crisis line: 877-565-8860", description: "Trans peer crisis line: 877-565-8860. No police dispatch, no involuntary holds. Save the number for your friends.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Trans Lifeline", authorRole: "Movement Organization", targetUrl: "https://translifeline.org/", topImageKey: "org_trans-lifeline", amplifiesGroups: ["lgbtq"] },
  { id: 1216, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Reach via 24/7 chat / text / phone", description: "LGBTQ youth crisis line — 24/7 chat, text, phone. Save it; share it with any kid in your life feeling targeted.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Trevor Project", authorRole: "Movement Organization", targetUrl: "https://www.thetrevorproject.org/", topImageKey: "org_the-trevor-project", amplifiesGroups: ["lgbtq"] },
  { id: 1217, category: "Call", categoryColor: "#c2185b", actionType: "Online", title: "Call peer hotline / chat", description: "Peer hotline + chat for LGBTQ folks of any age. Calm peer support, not crisis — for the bad-day moments.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "LGBT National Help Center", authorRole: "Movement Organization", targetUrl: "https://lgbthotline.org/", topImageKey: "org_lgbt-national-help-center", amplifiesGroups: ["lgbtq"] },
  { id: 1218, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Text HOME to 741741", description: "Trained counselor 24/7 — free, anonymous, no police dispatch. Save it now; share with anyone queer, trans, or targeted.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Crisis Text Line", authorRole: "Movement Organization", targetUrl: "https://www.crisistextline.org/", topImageKey: "org_crisis-text-line", amplifiesGroups: ["lgbtq"] },
  { id: 1219, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Subscribe to the Movement Memos podcast", description: "Subscribe to Kelly Hayes' podcast. Anti-burnout, abolitionist, movement-stamina lessons — keep going for the long fight.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Truthout / Kelly Hayes", authorRole: "Movement Organization", targetUrl: "https://truthout.org/series/movement-memos/", topImageKey: "org_truthout-kelly-hayes" },
  { id: 1220, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Find a peer mental-health chapter", description: "Find a peer mental-health chapter. Campus + online network — good fit for college students or new grads.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Active Minds", authorRole: "Movement Organization", targetUrl: "https://activeminds.org/", topImageKey: "org_active-minds" },
  { id: 1221, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Find a free virtual support group", description: "Find a free virtual support group. Family + peer mental-health support; weekly, online, no insurance needed.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAMI", authorRole: "Movement Organization", targetUrl: "https://www.nami.org/", topImageKey: "org_nami" },
  { id: 1223, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Sign up to run for office (under 40, progressive)", description: "Sign up to run for office. Under 40, progressive — they handle the hard parts, you focus on the door knocks.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Run for Something", authorRole: "Movement Organization", targetUrl: "https://runforsomething.net/", topImageKey: "org_run-for-something" },
  { id: 1224, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Apply to candidate training (women)", description: "Apply for free women's candidate training. They've run thousands of women — training is rigorous, free, ongoing.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Vote Run Lead", authorRole: "Movement Organization", targetUrl: "https://voterunlead.org/", topImageKey: "org_vote-run-lead", amplifiesGroups: ["woman"] },
  { id: 1225, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Apply to candidate training (Dem women)", description: "Apply to candidate training for Democratic women. Six-month program; alumni include 1,200+ elected officials.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Emerge America", authorRole: "Movement Organization", targetUrl: "https://emergeamerica.org/", topImageKey: "org_emerge-america", amplifiesGroups: ["woman"] },
  { id: 1226, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Apply to candidate training (Black women)", description: "Apply to Black women's candidate training. Pipeline org for the most underrepresented group in elected office.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Higher Heights for America", authorRole: "Movement Organization", targetUrl: "https://higherheightsforamerica.org/", topImageKey: "org_higher-heights-for-america", amplifiesGroups: ["woman"] },
  { id: 1230, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Save threatened gov pages with one click", description: "One-click archive of any threatened gov page. Save before Trump's admin scrubs it — works on any URL.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Wayback Machine 'Save Page Now'", authorRole: "Movement Organization", targetUrl: "https://web.archive.org/save", topImageKey: "org_wayback-machine-save-page-now" },
  { id: 1231, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Pick a banned book + read it", description: "Pick a banned book + read it. Live, sortable list — read what they don't want in school libraries.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "PEN America banned-books list", authorRole: "Movement Organization", targetUrl: "https://pen.org/banned-books-list-2022/", topImageKey: "org_pen-america-banned-books-list" },
  { id: 1232, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Set election reminders (every contest)", description: "Set election reminders for every contest. Off-cycle elections (judges, school boards) are where MAGA quietly stacks boards.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Vote.org", authorRole: "Movement Organization", targetUrl: "https://www.vote.org/", topImageKey: "org_vote-org" },
  { id: 1233, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Find DOJ-accredited rep training", description: "Free DOJ-accredited rep training. Trump's mass deportation needs more accredited reps — non-lawyers can do this.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "CLINIC (Catholic Legal Immigration Network)", authorRole: "Movement Organization", targetUrl: "https://www.cliniclegal.org/", topImageKey: "org_clinic-catholic-legal-immigration-network", amplifiesGroups: ["immigrant"] },
  // MoveOn front-page petitions — https://front.moveon.org/petitions/
  { id: 1234, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Mandate that ICE agents show their face and identification", description: "Demand Congress require immigration agents to display agency ID and name badges, like other law enforcement.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MoveOn", authorRole: "Movement Organization", targetUrl: "https://sign.moveon.org/petitions/unmask-ice", topImageKey: "org_moveon", amplifiesGroups: ["immigrant"] },
  { id: 1235, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Keep the U.S. out of forever wars", description: "Oppose U.S. military action in Iran. Tell Congress to prevent another Middle Eastern war.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MoveOn", authorRole: "Movement Organization", targetUrl: "https://sign.moveon.org/petitions/no-war-with-iran-18", topImageKey: "org_moveon" },
  { id: 1236, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Do not cooperate with ICE", description: "Tell mayors and local officials to refuse cooperation with ICE and protect their residents.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MoveOn", authorRole: "Movement Organization", targetUrl: "https://sign.moveon.org/petitions/do-not-cooperate-with-ice", topImageKey: "org_moveon", amplifiesGroups: ["immigrant"] },
  { id: 1237, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Pam Bondi must go", description: "Demand Attorney General Pam Bondi resign or be impeached over her DOJ agenda.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MoveOn", authorRole: "Movement Organization", targetUrl: "https://sign.moveon.org/petitions/pam-bondi-must-go", topImageKey: "org_moveon" },
  { id: 1238, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "No warehouses for ICE detention centers", description: "Block ICE's $38B push to convert warehouses into immigration detention facilities.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MoveOn", authorRole: "Movement Organization", targetUrl: "https://sign.moveon.org/petitions/no-warehouses-for-ice-detention-centers", topImageKey: "org_moveon", amplifiesGroups: ["immigrant"] },

  // Common Cause direct-action campaigns — https://www.commoncause.org/take-action/
  { id: 1239, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Save the USPS and mail-in voting", description: "Sign to defend USPS from privatization. Mail-in voting and rural delivery die together — voter suppression by infrastructure.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/save-the-us-postal-service/", topImageKey: "org_common-cause" },
  { id: 1240, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Defend the SPLC against right-wing attacks", description: "Sign to defend the Southern Poverty Law Center. Trump-aligned groups are using lawfare to discredit hate-tracking research.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/defend-the-splc-and-our-civil-rights/", topImageKey: "org_common-cause" },
  { id: 1241, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Hold Trump's DOJ lawyers accountable", description: "Email state bars asking for ethics review of DOJ lawyers advancing Trump's anti-democracy agenda. Bar discipline is a real lever.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/hold-trumps-doj-lawyers-accountable/", topImageKey: "org_common-cause" },
  { id: 1242, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Reject Trump's $10B presidential cash grab", description: "Email Congress to block Trump's $10B presidential allowance push. Funnels public money toward MAGA-aligned contractors.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/reject-trumps-10-billion-cash-grab/", topImageKey: "org_common-cause" },
  { id: 1243, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Pledge to be the change in your community", description: "Take Common Cause's pledge — vote in every election, recruit one neighbor, follow at least one local race. Habit beats vibes.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/take-the-pledge-be-the-change/", topImageKey: "org_common-cause" },
  { id: 1244, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Remove Trump from office", description: "Sign Common Cause's call for impeachment based on documented abuses. Petition pressure feeds the political will needed.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/remove-trump-from-office-now-2/", topImageKey: "org_common-cause" },

  // ── 50501 Movement, Tesla Takedown, Indivisible, satire creators batch ──
  // (Imported from resistact_new_cards_FINAL.csv — author-set tone vectors,
  // categories canonicalized, locations mapped to LOCATION_OPTIONS, amplifies
  // groups set where the action explicitly serves a vulnerable group.)
  { id: 1245, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Vote YES on War Powers Resolution to stop Trump's Iran war", description: "Action Network letter from 50501. Tells your Congressperson to vote YES on the War Powers Resolution to block Trump's unauthorized military escalation against Iran. Pre-written, edits encouraged.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "50501 Movement", authorRole: "Movement Organization", targetUrl: "https://actionnetwork.org/letters/e8187bd3c13d6812ad7e41897d096f8d3ae76f60", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1246, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Help count the crowd at your next protest", description: "50501's We Count tool — submit headcounts and photos from rallies you attend so accurate turnout numbers reach press and Congress instead of MAGA's lowballed counts.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "50501 Movement", authorRole: "Movement Organization", targetUrl: "https://bit.ly/m/WeCount", toneOverride: { anger: 1, comedy: 0, subversion: 1, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1247, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Join the No Kings Twitch organizing stream", description: "50501's recurring Twitch livestream — strategy briefings, training, and community check-ins for the No Kings campaign. Watch live or follow for replays.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "50501 Movement", authorRole: "Movement Organization", targetUrl: "https://twitch.tv/50501movement", toneOverride: { anger: 1, comedy: 1, subversion: 1, hope: 2, energy: 0 }, adminApproved: false },
  { id: 1248, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Take 50501's Marching 101 protest training", description: "Self-paced first-time-protester guide from 50501 — what to wear, what to bring, how to stay safe in a crowd, what to do if police escalate. Read once before your first march.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "50501 Movement", authorRole: "Movement Organization", targetUrl: "https://linktr.ee/FiftyFiftyOneMovement", toneOverride: { anger: 1, comedy: 0, subversion: 1, hope: 2, energy: 1 }, firstTimerFriendly: true },
  { id: 1249, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Read 50501's Digital Safety primer for activists", description: "Quick guide from 50501 on locking down your phone, secure messaging, and metadata hygiene before joining protests. Trump-era surveillance is real — don't make it easy.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "50501 Movement", authorRole: "Movement Organization", targetUrl: "https://linktr.ee/FiftyFiftyOneMovement", toneOverride: { anger: 1, comedy: 0, subversion: 1, hope: 2, energy: 0 }, firstTimerFriendly: true },
  { id: 1250, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Use 50501's Virtual Actions guide if you can't show up in person", description: "Disabled, immunocompromised, working two jobs? 50501's virtual-actions guide is a curated list of from-home protest contributions — phone banking, postcard writing, social amplification, doxx-defense.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "50501 Movement", authorRole: "Movement Organization", targetUrl: "https://linktr.ee/FiftyFiftyOneMovement", toneOverride: { anger: 1, comedy: 0, subversion: 0, hope: 2, energy: 0 }, amplifiesGroups: ["disabled"], adminApproved: false },
  { id: 1251, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Sell your Tesla", description: "Tesla Takedown's headline ask — divest from Musk's company. Trade in, sell to a dealer, or post on Bring-A-Trailer. Every sale chips at the Musk valuation that funds his political project.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com", topImageKey: "org_tesla-takedown", toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 1, energy: 2 }, firstTimerFriendly: true },
  { id: 1252, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Dump your TSLA stock", description: "Tesla Takedown asks anyone holding Tesla shares — directly, in a 401(k), or via index funds — to divest. Switch to a Musk-free ETF; pressure your fund manager.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com", topImageKey: "org_tesla-takedown", toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 1, energy: 2 }, firstTimerFriendly: true },
  { id: 1253, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Find a Tesla Takedown protest near you", description: "Map and calendar of weekly Tesla showroom protests across the US. Pick the closest, RSVP, show up. Peaceful, sign-holding, First Amendment.", location: "National", boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com", topImageKey: "org_tesla-takedown", toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 1, energy: 3 }, adminApproved: false },
  { id: 1254, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Plan a Tesla Takedown protest in your city", description: "No protest in your area yet? Tesla Takedown has a host-an-action toolkit — permits, sign templates, safety protocol, comms scripts. Pick a Saturday and start a chapter.", location: "Multi-state", boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com", topImageKey: "org_tesla-takedown", toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 2, energy: 3 }, adminApproved: false },
  { id: 1255, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Push your city to pass a Tesla divestment resolution", description: "Tesla Takedown's City Resolutions track helps you draft and pass a municipal resolution to drop Tesla from city fleets and pension exposure. Templates + sample testimony included.", location: "Multi-state", boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com/city-resolutions", topImageKey: "org_tesla-takedown", toneOverride: { anger: 2, comedy: 0, subversion: 1, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1256, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Share your 'I sold my Tesla' story", description: "Tesla Takedown collects defection testimonies — short written or video stories about why you ditched the car. They use them in press, social, and recruitment.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com/share-your-story", topImageKey: "org_tesla-takedown", toneOverride: { anger: 2, comedy: 1, subversion: 1, hope: 1, energy: 1 }, firstTimerFriendly: true },
  { id: 1257, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Republican Reps: Not One Penny More for ICE Brutality", description: "Indivisible action — pre-written email to Republican members of Congress demanding they vote against any new ICE funding. Editable script.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://act.indivisible.org/sign/tell-your-republican-members-of-congress-not-one-penny-more-for-ice/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/04/260429_No-Money-for-ICE_Email-R-MoC-500x319.png", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], firstTimerFriendly: true },
  { id: 1258, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Call your Republican Rep: Stop Bankrolling ICE Brutality", description: "Indivisible script + your Rep's number. 60-second call demanding they oppose ICE funding expansion. Currently flagged TRENDING NOW on Indivisible's action board.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/gop-house-stop-bankrolling-ice/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/04/260429_No-Money-for-ICE_Call-R-Rep-500x319.png", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1259, category: "Call", categoryColor: "#c2185b", actionType: "Online", title: "Call your Republican Senator: Stop Bankrolling ICE Brutality", description: "Indivisible's Senate-side companion call. Same ask: vote no on more ICE money. Senate phone numbers + script provided.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/gop-senate-stop-ice-brutality/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/04/260429_No-Money-for-ICE_Call-R-Senator-500x319.png", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1260, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Democrats: Fiercely Oppose the New GOP ICE Funding Push", description: "Indivisible action targeting Democratic Reps — telling your own party to actually fight, not just vote no quietly. Anti-rollover messaging.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://act.indivisible.org/sign/urge-democrats-fiercely-oppose-new-gop-effort-shovel-billions-more-dollars-ice-and-border-patrol/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/04/260429_No-Money-for-ICE_Email-D-MoC-500x319.png", toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1261, category: "Call", categoryColor: "#c2185b", actionType: "Online", title: "Call your Senator: Oppose Warrantless AI Mass Surveillance", description: "Indivisible action against AI-driven mass-surveillance authorities being added to spending bills. Script + Senate switchboard.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/tell-your-senators-oppose-warrantless-ai-mass-surveillance/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/04/240409_FISA-CTA-2_1240x790-500x319.png", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant", "journalist"], adminApproved: false },
  { id: 1262, category: "Call", categoryColor: "#c2185b", actionType: "Online", title: "Call your Rep: Oppose Warrantless AI Mass Surveillance", description: "Indivisible House-side companion. Same ask, House script.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/tell-representatives-no-to-ai-warrantless-mass-surveillance/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/04/240409_FISA-CTA-2_1240x790-500x319.png", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant", "journalist"], adminApproved: false },
  { id: 1263, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Congress: Reject the Deportation & Detention Agenda", description: "Indivisible omnibus action against the Trump deportation expansion package — email your Reps and Senators with one click.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://act.indivisible.org/sign/reject-the-deportation-and-detention-agenda/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/03/260309_No-More-Detention-Centers-blue_1240x790-500x319.jpg", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], firstTimerFriendly: true },
  { id: 1264, category: "Call", categoryColor: "#c2185b", actionType: "Online", title: "Call your Senators: End the Illegal War on Iran", description: "Indivisible Senate call companion. Phone is louder than email — staff log calls separately.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/no-war-iran-senate/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/02/250618_1200-x-600_No-War-with-Iran-500x281.png", toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1265, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person", title: "Make a 'No Kings' protest sign and bring it to your next rally", description: "#NoKings has 271K+ posts on TikTok — creators sharing sign templates, slogans, and crowd footage. Make your own using their templates and tag #NoKings to amplify.", location: "National", boosts: 0, spotsTotal: "Unlimited", authorName: "No Kings (50501-aligned)", authorRole: "Movement Organization", targetUrl: "https://www.tiktok.com/tag/nokings", toneOverride: { anger: 2, comedy: 1, subversion: 1, hope: 2, energy: 2 }, firstTimerFriendly: true },
  { id: 1266, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Film a '50501 [your state]' intro reel", description: "TikTok pattern: short intro videos like 'We Are 50501 Georgia' from state chapters. Film one for your state, post on TikTok and Reels, link to your chapter's signup. Recruitment in 30 seconds.", location: "National", boosts: 0, spotsTotal: "Unlimited", authorName: "50501 state chapters", authorRole: "Movement Organization", targetUrl: "https://www.tiktok.com/tag/50501", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 1, comedy: 1, subversion: 2, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1267, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Stitch or duet a Trump clip with your counter-narrative", description: "TikTok's stitch/duet format is being used to debunk and ridicule Trump quotes in real time. Pick a clip, add 30 seconds of your own context or mockery, post with #Resist or #50501.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Independent creators", authorRole: "Citizen Activist", targetUrl: "https://www.tiktok.com/tag/50501", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 2, comedy: 3, subversion: 2, hope: 1, energy: 1 }, firstTimerFriendly: true },
  { id: 1268, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Follow @teslatakedown on Instagram for weekly action drops", description: "Their IG posts the next Saturday's protest list, sign templates, and creator-made meme content. Lowest-effort way to plug into a national protest schedule.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.instagram.com/teslatakedown/", topImageKey: "org_tesla-takedown", toneOverride: { anger: 1, comedy: 0, subversion: 1, hope: 1, energy: 0 }, firstTimerFriendly: true },
  { id: 1269, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Submit your protest photo to a 50501 chapter highlight", description: "Instagram chapters like @50501movement run 'NO KINGS', 'May Day', 'DEFENSE' photo highlights from contributors. Tag your chapter; visibility builds the cohort.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "50501 Movement", authorRole: "Movement Organization", targetUrl: "https://www.instagram.com/50501movement/", toneOverride: { anger: 1, comedy: 0, subversion: 1, hope: 2, energy: 0 }, adminApproved: false },
  { id: 1270, category: "MEETING", categoryColor: "#5a3e9e", actionType: "In Person Group", title: "50501 Joplin / Citizens Against Tyranny — monthly meeting", description: "Sat May 16, 2:00 PM. Joplin, MO. 50501 Joplin and Citizens Against Tyranny Network's monthly chapter meeting. Local organizing in deep-red Missouri.", location: "Missouri", eventDate: "2026-05-16", boosts: 0, spotsTotal: "Unlimited", authorName: "Citizens Against Tyranny Network", authorRole: "Movement Organization", targetUrl: "https://events.pol-rev.com/", toneOverride: { anger: 2, comedy: 0, subversion: 1, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1271, category: "MEETING", categoryColor: "#5a3e9e", actionType: "In Person Group", title: "BloNo IL community meeting & cookout (Central IL Iron Front)", description: "Sun May 17, 2:00 PM. Bloomington, IL. Central Illinois Iron Front community meeting + cookout. Antifascist organizing meets potluck. Bring a side dish.", location: "Illinois", eventDate: "2026-05-17", boosts: 0, spotsTotal: "Unlimited", authorName: "Central Illinois Iron Front", authorRole: "Movement Organization", targetUrl: "https://events.pol-rev.com/", toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 3, energy: 1 }, adminApproved: false },
  { id: 1272, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "We The People of Ohio — Constitution day in Mentor", description: "Sun May 17, 8:00 AM. Mentor, OH. Constitution-themed visibility action. Peaceful, free, family-friendly. Hosted by Kathy.", location: "Ohio", eventDate: "2026-05-17", boosts: 0, spotsTotal: "Unlimited", authorName: "Mentor OH locals", authorRole: "Citizen Activist", targetUrl: "https://events.pol-rev.com/", toneOverride: { anger: 2, comedy: 0, subversion: 1, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1273, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Subscribe to MeidasTouch on YouTube", description: "2.7M followers on TikTok, even bigger on YouTube. Daily anti-Trump news takedowns. Subscribe so the algorithm pushes their content to your feed and others'.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MeidasTouch Network", authorRole: "Movement Organization", targetUrl: "https://www.youtube.com/@MeidasTouch", topImageKey: "org_youtube", imageContain: true, toneOverride: { anger: 2, comedy: 2, subversion: 1, hope: 1, energy: 0 }, adminApproved: false },
  { id: 1274, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Share MeidasTouch's latest Trump takedown clip", description: "Pick a recent MeidasTouch reel — the punchier the better — and share it on your story or repost. Their model is reach-driven; sharing is the action.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MeidasTouch Network", authorRole: "Movement Organization", targetUrl: "https://www.tiktok.com/@meidastouch", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 2, comedy: 2, subversion: 1, hope: 1, energy: 0 }, adminApproved: false },
  { id: 1275, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Listen to Lizz Winstead's Feminist Buzzkills podcast", description: "Daily Show co-creator Lizz Winstead's weekly comedy podcast about abortion rights, post-Roe America, and the fight against the Christian right. Subscribe wherever you get podcasts.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Abortion Access Front", authorRole: "Movement Organization", targetUrl: "https://aafront.org/feminist-buzzkills-live/", toneOverride: { anger: 2, comedy: 3, subversion: 2, hope: 2, energy: 0 }, amplifiesGroups: ["repro", "woman"], adminApproved: false },
  { id: 1276, category: "FUNDING", categoryColor: "#127f05", actionType: "Online", title: "Donate to Abortion Access Front", description: "Lizz Winstead's org — comedy meets clinic defense. Road trips to abortion clinics, destigmatizing comedy shows, post-Dobbs clinic-side support.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Abortion Access Front", authorRole: "Movement Organization", targetUrl: "https://aafront.org/donate/", toneOverride: { anger: 3, comedy: 2, subversion: 2, hope: 2, energy: 1 }, amplifiesGroups: ["repro", "woman"], adminApproved: false },
  { id: 1277, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Watch and share a Blaire Erskine satire video", description: "Blaire Erskine's deadpan-news-anchor satire reels (1.1M TikTok likes) skewer MAGA talking points one fake interview at a time. Pick one, share it, tag a relative who needs it.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Blaire Erskine", authorRole: "Citizen Activist", targetUrl: "https://www.tiktok.com/@blaireerskine", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 1, energy: 0 }, adminApproved: false },
  { id: 1278, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Subscribe to Blaire Erskine's Substack", description: "The newsletter version of Blaire Erskine's deadpan-news-anchor MAGA satire — bonus fake interviews skewering Trump talking points, behind-the-scenes on her viral TikTok reels, no algorithm gating. Direct to your inbox.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Blaire Erskine", authorRole: "Citizen Activist", targetUrl: "https://blaireerskine.substack.com/", toneOverride: { anger: 1, comedy: 3, subversion: 1, hope: 1, energy: 0 }, adminApproved: false },
  { id: 1279, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Subscribe to The Lincoln Project's video drops", description: "Republicans-against-Trump satirical attack ads. Subscribe on YouTube and follow on TikTok/IG for the new releases — they're shareable weapons against MAGA relatives.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Lincoln Project", authorRole: "Movement Organization", targetUrl: "https://www.youtube.com/@LincolnProject", topImageKey: "org_youtube", imageContain: true, toneOverride: { anger: 3, comedy: 3, subversion: 2, hope: 1, energy: 0 }, adminApproved: false },
  { id: 1280, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Use a satire creator's audio to make your own anti-Trump TikTok", description: "TikTok's audio-reuse mechanic is a force multiplier. Pick a viral political satire audio (MeidasTouch, Lizz Winstead, Blaire Erskine), film a 15-second take with your local angle, post.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Independent creators", authorRole: "Citizen Activist", targetUrl: "https://www.tiktok.com/discover/political-satire", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1281, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Comment-bomb viral Trump videos with action links", description: "TikTok and IG comment sections on Trump-aligned content reach undecided/curious viewers. Drop a clean comment with a link to a 5Calls script or local action — short, no insult, just info. Action over rage.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Independent creators", authorRole: "Citizen Activist", targetUrl: "https://www.tiktok.com/tag/50501", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 1, comedy: 1, subversion: 3, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1282, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Congress: No to Warrantless AI Mass Surveillance", description: "One-click Indivisible email to your full Congressional delegation. Demands they strip warrantless AI surveillance provisions from spending bills before they pass.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://act.indivisible.org/sign/tell-congress-say-no-warrantless-ai-mass-surveillance/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/04/240409_FISA-CTA_1240x790-500x319.png", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant", "journalist"], adminApproved: false },
  { id: 1283, category: "Call", categoryColor: "#c2185b", actionType: "Online", title: "Call your Senators: Block the Deportation & Detention Expansion", description: "Call your Senators and demand they publicly oppose new ICE detention centers and the mass deportation expansion. Indivisible script + direct Senate numbers included.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/deportation-detention-agenda-senate/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/03/260309_No-More-Detention-Centers-red_sen_1240x790-500x319.jpg", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1284, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Call your Rep: Reject the Deportation & Detention Agenda", description: "Call your House Representative to block Trump's mass deportation and detention expansion. Indivisible call script and Rep phone numbers provided.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/deportation-detention-agenda-house/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/03/260309_No-More-Detention-Centers-blue_rep_1240x790-500x319.jpg", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1285, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Congress: Stop Trump's Illegal War on Iran", description: "One-click Indivisible email to your full delegation invoking the War Powers Act. Demands Congress vote to halt Trump's unauthorized military escalation against Iran.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://act.indivisible.org/sign/no-iran-war/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/02/260224_1200-x-600_No-War-with-Iran-500x281.png", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1286, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Call your Rep: End the Illegal War on Iran", description: "Call your House Representative to demand a vote to end Trump's unauthorized war on Iran. Indivisible script + direct House phone numbers.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/no-war-iran-house/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/02/260224_1200-x-600_No-War-with-Iran-500x281.png", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1287, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Congress: Kill the GOP Voter Suppression Bills", description: "Email your full delegation to stop the SAVE Act and MEGA Act — GOP bills that would purge millions of eligible voters before the 2026 elections. One-click Indivisible action.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://act.indivisible.org/sign/stop-gops-new-voter-suppression-legislation/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/02/260206_SAVE-MEGA-Act_Email-MoC-500x319.png", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1288, category: "Call", categoryColor: "#c2185b", actionType: "Online", title: "Call your Senators: Vote NO on GOP Voter Suppression", description: "Call your Senators to vote against the SAVE Act and MEGA Act — Republican bills that would gut voter registration and purge eligible voters before 2026. Indivisible script included.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/stop-save-senate/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/02/260206_SAVE-MEGA-Act_Call-Sen-500x319.png", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1289, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email your Governor: Stop the Redistricting Coup", description: "Republicans are redrawing congressional maps mid-decade to lock in House control before 2026. Email your governor demanding they commit to fair redistricting — not partisan gerrymandering.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/campaigns/redistricting-coup-underway/", topImageUrl: "https://indivisible.org/wp-content/uploads/2025/11/The-Redistricting-Coup-is-Underway-500x281.png", toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1290, category: "Call", categoryColor: "#c2185b", actionType: "Online", title: "Call Democratic Senators: Block Trump's Crypto Corruption Bill", description: "Call your Democratic Senators to oppose the CLARITY Act — Trump's crypto deregulation bill that strips SEC authority and enables his own crypto-corruption schemes. Indivisible script provided.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/stop-trumps-crypto-corruption/", topImageUrl: "https://indivisible.org/wp-content/uploads/2025/12/crypto_corruption-500x500.jpg", toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 1, energy: 1 }, adminApproved: false },

  // ── NAACP (added 2026-05-14) ──────────────────────────────────────────────────
  { id: 1291, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Congress: Reject Harmful Cuts to Social Safety Net Programs", description: "Congress is moving to eliminate healthcare for 11.8 million people, slash one-third of the SNAP budget ($300B), and gut Social Security, Medicare, Medicaid, and Veterans benefits — all to fund tax breaks for the wealthy. The NAACP calls it un-American. Email your reps to vote NO.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://naacp.org/actions/tell-congress-reject-harmful-funding-cuts", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/iStock-1281545908.jpg.webp?itok=uA1GiwQi", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1292, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Call Your Senator: Vote NO on the SAVE Act Voter Suppression Bill", description: "The SAVE Act would disenfranchise 21 million Americans — married women whose ID names differ from voter rolls, elderly without current IDs, students with mismatched addresses. Voter suppression disguised as protection. Call the Capitol Switchboard and demand your senator vote no.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://naacp.org/actions/tell-congress-vote-no-save-act", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/JKnight_220923_0709%20%281%29.jpg.webp", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1293, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: No New Funding for ICE", description: "ICE agents are killing and terrorizing communities with zero accountability. The NAACP is demanding Congress cut ICE funding, strip agent immunity, remove DHS Secretary Kristi Noem, and end federal-local law enforcement collusion. Contact your representatives now.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://naacp.org/actions/tell-congress-no-new-funding-ice", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/Untitled-7.jpg.webp", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1294, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Report a Dirty AI Data Center Being Built Near You", description: "AI data centers are being built in Black and low-income communities, burning fuels that emit cancer-causing chemicals. The NAACP is mapping where they're going. Report any planned or proposed data center in your area — your tip fuels national advocacy and local strategy.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://forms.office.com/r/0BjBrg6TJU", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/64d27f8d3d504e5ad0833726_hdr-data-center-types.jpg.webp", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1295, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "No Healthcare, No Vote: Demand Congress Protect ACA Tax Credits", description: "Nearly 24 million Americans will lose ACA health coverage if enhanced premium tax credits expire. The NAACP is calling on Congress to extend them — because healthcare is a right, not a privilege. Email your representative before the deadline.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://naacp.org/actions/no-healthcare-no-vote", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/iStock-1287924870.jpg.webp?itok=Gzy0cAK2", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1296, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign the NAACP Petition: Protect Black Workers", description: "Black unemployment hit 7.2% in 2025 — nearly double the national rate — driven by mass federal job cuts and DEI rollbacks that targeted Black workers in healthcare, education, and public service. The NAACP demands a moratorium on targeted layoffs and an immediate pause on DEI dismantling. Sign now.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://naacp.org/actions/protect-black-workers", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/iStock-1196015209.jpg.webp", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1297, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Stop Elon Musk's xAI from Poisoning Black Communities", description: "Musk's xAI installed unpermitted gas turbines in Boxtown, Tennessee — a predominantly Black neighborhood — generating cancer-causing pollution equal to a full power plant. Email Congress directly to demand accountability and protect communities from Big Tech's AI expansion.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://support.naacp.org/a/tell-congress-to-protect-our-communities-from-ai-data-center-operations", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/environmental-justice.jpg.webp?itok=a8N4Y7-k", toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1298, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: Pass the John R. Lewis Voting Rights Advancement Act", description: "The JLVRAA restores federal oversight of states with discriminatory voting histories, protects ballot access for communities of color, and guarantees equal voting rights for every citizen. Reject the SAVE Act. Advance the JLVRAA. Voting rights are American rights — contact Congress now.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://naacp.org/actions/tell-congress-protect-our-voting-rights", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/iStock-1202146507.jpg.webp?itok=57dCxKlE", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1299, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Share Your Story: How Federal Budget Cuts Are Hurting Your Family", description: "Congress is slashing Medicaid and SNAP while handing tax breaks to billionaires. The NAACP needs your story — how would losing healthcare, food assistance, or housing support affect you or someone you love? Personal testimonies shift congressional votes. Two minutes to submit.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://support.naacp.org/a/budget-and-tax-stories", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/GettyImages-844235780-cropped.jpg.webp", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 1, energy: 0 }, firstTimerFriendly: true, adminApproved: false },
  { id: 1301, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Your Senator: Kill the 'Kill Nonprofits' Bill (H.R. 9495)", description: "H.R. 9495 lets the government strip tax-exempt status from any nonprofit it labels 'terrorist supporting' — meaning the NAACP, ACLU, Planned Parenthood, any org that criticizes the administration. This is the infrastructure for silencing civil society. Email your senator to stop it.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://naacp.org/actions/oppose-hr-9495-protect-nonprofit-organizations", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/pexels-life-matters-4613879-%281%29.jpg.webp?itok=G50qUJOv", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },

  // ── Dissent Pins resistance merch ─────────────────────────────────────────────
  { id: 1302, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Slap a 'No War Is Holy' Sticker on Your Car (or Laptop)", description: "Tired of hearing Trump claim divine favor for his wars? This UV-laminated bumper sticker (5.25″ × 3″) pushes back on the gospel of holy wars. Weather-resistant for indoor or outdoor use — sticker or car magnet. From Dissent Pins.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Dissent Pins", authorRole: "Resistance Merch", authorLink: "https://dissentpins.com/", targetUrl: "https://dissentpins.com/collections/best-sellers/products/no-war-is-holy-bumper-sticker", topImageUrl: "https://dissentpins.com/cdn/shop/files/NoWarIsHolyStickerMock-up_2000x2000.jpg?v=1776273173", toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1303, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Buy a Fifth Amendment Sticker — 50% to Immigrant Rights Orgs", description: "The Fifth Amendment protects everyone in the U.S. — citizens and non-citizens alike. Show it. 50% of profits go directly to immigrant rights organizations doing legal defense and community education, including Hands Off NYC, Illinois Coalition for Immigrant Rights, and Portland Immigrant Rights Coalition. 8.3″ wide, UV-laminated.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Dissent Pins", authorRole: "Resistance Merch", authorLink: "https://dissentpins.com/", targetUrl: "https://dissentpins.com/collections/best-sellers/products/fifth-amendment-bumper-sticker", topImageUrl: "https://dissentpins.com/cdn/shop/files/FifthAmendmentBumperSticker_1500x1500.png?v=1752677646", toneOverride: { anger: 2, comedy: 0, subversion: 1, hope: 2, energy: 1 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1304, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Buy an Abolish ICE Liberty Sticker — 50% to Immigrant Rights Orgs", description: "Show solidarity with neighbors under threat from ICE enforcement. 50% of profits fund five immigrant rights organizations doing legal defense and community education. UV-laminated sticker (6.5″ × 4.4″) or car magnet.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Dissent Pins", authorRole: "Resistance Merch", authorLink: "https://dissentpins.com/", targetUrl: "https://dissentpins.com/collections/best-sellers/products/abolish-ice-liberty-bumper-sticker-or-car-magnet", topImageUrl: "https://dissentpins.com/cdn/shop/files/AbolishICELibertycarmagnetonblue2000x2000_2000x2000.jpg?v=1766517162", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 2 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1305, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Buy a FCK ICE Tee — 100% to Immigrant Defense Funds", description: "Wear your resistance and fund it. 100% of profits go directly to Minnesota Immigrant Rapid Response Fund, Immigrant Law Center of Minnesota, and UNIDOSMN. Light blue, 100% cotton, sizes XS–4XL. Made with Vermont-based New Duds.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Dissent Pins", authorRole: "Resistance Merch", authorLink: "https://dissentpins.com/", targetUrl: "https://dissentpins.com/collections/best-sellers/products/fckice-tshirt", topImageUrl: "https://dissentpins.com/cdn/shop/files/FCKICEHoodieUGCJoinbrandsDanTinklerMar202612000x2000_1024x.jpg?v=1773673949", toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 2, energy: 2 }, amplifiesGroups: ["immigrant"], adminApproved: false },

  // ── Religious Action Center of Reform Judaism — Legislative Action Center ───
  { id: 1306, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: Pass the Environmental Justice for All Act", description: "Reform Jewish constituent email backing the A. Donald McEachin Environmental Justice for All Act (S. 919 / H.R. 1705). Forces federal agencies to weigh environmental and health impacts on Black, brown, low-income, and Indigenous communities before approving permits — the people Trump's deregulation hits first. One click sends to your delegation.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "RAC of Reform Judaism", authorRole: "RAC", authorLink: "https://rac.org/", targetUrl: "https://www.votervoice.net/URJ/campaigns/97971/respond", topImageUrl: "https://rac.org/sites/default/files/styles/page_header/public/2025-10/Hands%20cradling%20Earth.png?itok=6LiFeyEf", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1307, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: Pass the FAMILY Act for Paid Family + Medical Leave", description: "Reform Jewish constituent email backing the FAMILY Act — paid family and medical leave for every worker in America. The U.S. is the only wealthy country without it. One click sends to your Reps and Senators.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "RAC of Reform Judaism", authorRole: "RAC", authorLink: "https://rac.org/", targetUrl: "https://www.votervoice.net/URJ/campaigns/97797/respond", topImageUrl: "https://rac.org/sites/default/files/styles/page_header/public/2025-10/Coins%20stack%20with%20balance%20scale.png?itok=LoJBbP7S", toneOverride: { anger: 1, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1308, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: Close Loopholes, Ban Assault Weapons, Fund Violence Intervention", description: "Reform Jewish action backing eight gun-violence-prevention measures — universal background checks, an assault weapons ban, safe storage, community violence intervention funding, and more. Faith voices move members who tune out everyone else. One-click email.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "RAC of Reform Judaism", authorRole: "RAC", authorLink: "https://rac.org/", targetUrl: "https://www.votervoice.net/URJ/Campaigns/97975/Respond", topImageUrl: "https://rac.org/sites/default/files/styles/page_header/public/2025-10/keep%20our%20schools%20safe%20sign.png?itok=V9BPpWTZ", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1309, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: Mandate Hate Crime Reporting (IRPHA)", description: "Reform Jewish ask to pass the bipartisan Improving Reporting to Prevent Hate Act — requires local law enforcement to actually report hate crimes to the FBI. Reporting is voluntary right now, which is why federal hate-crime data is unusable. One-click constituent email.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "RAC of Reform Judaism", authorRole: "RAC", authorLink: "https://rac.org/", targetUrl: "https://www.votervoice.net/URJ/campaigns/115231/respond", topImageUrl: "https://rac.org/sites/default/files/styles/page_header/public/2025-10/memorial%20candle.png?itok=F95veFJk", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1310, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Urge Congress: Pass the West Bank Violence Prevention Act", description: "Reform Jewish-led ask for U.S. sanctions on Israeli settlers and entities driving violence against Palestinians in the West Bank. Jewish constituents pushing this carries weight Trump and Netanyahu can't deflect. One-click email to your full delegation.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "RAC of Reform Judaism", authorRole: "RAC", authorLink: "https://rac.org/", targetUrl: "https://www.votervoice.net/URJ/campaigns/131611/respond", topImageUrl: "https://rac.org/sites/default/files/styles/page_header/public/2025-10/Jerusalem%20Day%20celebrations.png?itok=2n1dkw_y", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1311, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Your State Legislators: Protect LGBTQ+ People in Your State", description: "Reform Jewish state-level email pushing back on the 500+ anti-LGBTQ+ bills introduced in 2024. Targets your Governor and state legislators with a faith-rooted framing on equal protection — the message that lands in red and purple statehouses when nothing else does.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "RAC of Reform Judaism", authorRole: "RAC", authorLink: "https://rac.org/", targetUrl: "https://www.votervoice.net/URJ/campaigns/98070/respond", topImageUrl: "https://rac.org/sites/default/files/styles/page_header/public/2025-10/Young%20woman%20waving%20LGBTQ%2Bflag.png?itok=DIxOv-AP", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 2, energy: 1 }, amplifiesGroups: ["lgbtq"], adminApproved: false },
  { id: 1312, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: Pass H.R. 40 — Commission to Study Reparations", description: "Reform Jewish constituent email urging passage of H.R. 40 / S. 40 — establishes a federal Commission to Study and Develop Reparation Proposals for African Americans. Doesn't pay reparations; it produces the official record that makes them possible. Jewish memory in service of Black liberation.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "RAC of Reform Judaism", authorRole: "RAC", authorLink: "https://rac.org/", targetUrl: "https://www.votervoice.net/URJ/campaigns/97892/respond", topImageUrl: "https://rac.org/sites/default/files/styles/page_header/public/2025-11/RAC%20header%20-%20Reparations.png?itok=gCQMs0dl", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },

  // ── Etsy anti-Trump merch (indie makers) ──────────────────────────────────
  // og:image URLs scraped from each listing's product page. Etsy CDN images
  // are stable but the listings themselves can be pulled by sellers — if a
  // card 404s the link, the admin panel can swap the targetUrl without
  // touching the image.
  { id: 1313, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Buy the \"Waiting for the Big Beautiful Obituary\" Anti-Trump Tee", description: "Subtle FDT tee that flips Trump's \"big, beautiful\" branding into the obituary nobody's writing yet. Anti-MAGA, V-neck option, the kind of shirt that gets a knowing nod at the protest and a long stare in the suburbs. Indie maker (TeeTaniumCo) ships from Raleigh, NC.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "TeeTaniumCo (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/TeeTaniumCo", targetUrl: "https://www.etsy.com/listing/4484525481/anti-trump-tee-waiting-for-big-beautiful", topImageUrl: "https://i.etsystatic.com/46711686/r/il/38bf26/7886752294/il_1080xN.7886752294_gy8z.jpg", toneOverride: { anger: 2, comedy: 2, subversion: 2, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1314, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Slap a \"When It Happens\" Anti-Trump Wine Label on the Bottle", description: "Custom champagne / wine label sticker for the bottle you're saving for the day Trump is finally out. Subtle FDT, Democrat-gift-grade, makes any cabinet shelf into a countdown clock. Stick it now, pop it later — UncorkedLabels ships from Ocoee, FL.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "UncorkedLabels (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/UncorkedLabels", targetUrl: "https://www.etsy.com/listing/4357310155/anti-trump-custom-wine-label-funny", topImageUrl: "https://i.etsystatic.com/45057606/r/il/171012/7696003810/il_1080xN.7696003810_4ugp.jpg", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1315, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Buy the \"President and Dumb Should Be Different People\" Tee", description: "Anti-Trump slogan tee that says the quiet part out loud. Wearable irreverence for anyone tired of pretending we're still doing the diplomatic-disagreement thing about this presidency. TeeGeekBoutique ships from San Jose, CA.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "TeeGeekBoutique (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/TeeGeekBoutique", targetUrl: "https://www.etsy.com/listing/4469069065/anti-trump-tee-president-and-dumb-should", topImageUrl: "https://i.etsystatic.com/46736936/r/il/c5a9ce/7834235639/il_1080xN.7834235639_6k7m.jpg", toneOverride: { anger: 2, comedy: 2, subversion: 2, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1316, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Buy the \"Go Back, We Screwed Up\" Trump Evolution Tee", description: "The evolution-of-man cartoon, except the last frame is an apology. \"Go back, we screwed up.\" Vote-blue, Kamala-friendly, pure billboard energy on a t-shirt. PrintfulApparelUS ships from Stafford, TX.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "PrintfulApparelUS (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/PrintfulApparelUS", targetUrl: "https://www.etsy.com/listing/1797660855/anti-trump-tshirt-go-back-we-screwed-up", topImageUrl: "https://i.etsystatic.com/53712756/r/il/57fd0e/6288678088/il_1080xN.6288678088_ll21.jpg", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 2, energy: 1 }, adminApproved: false },

  // ── Spreadsheet batch (May 17): 19 new cards from anti-ICE / detention /
  // anti-Iran-war / Tesla-divest sources. 7 of the original 26 rows were
  // skipped as exact-URL or generic-URL duplicates of existing cards.
  // All start as adminApproved:false so the admin can eyeball before publish.
  { id: 1317, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Divest your portfolio (and your funds) from Tesla", description: "Tesla Takedown's divestment guide walks you through identifying which of your index funds, ETFs, and retirement accounts hold TSLA — and how to move them. Close the financial faucet on Musk and DOGE.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", authorLink: "https://www.teslatakedown.com/", targetUrl: "https://www.teslatakedown.com/divest", topImageKey: "org_tesla-takedown", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1318, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "In Person Group", title: "Adopt-A-School: deter ICE raids at your neighborhood school", description: "NDLON's Adopt-A-School program assigns volunteers to be physically present at school drop-off and pick-up to deter ICE agents from snatching kids and parents. Sign up by zip — Seattle pilot is live; program expanding.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "Multi-State", authorName: "National Day Laborer Organizing Network", authorRole: "Movement Organization", authorLink: "https://ndlon.org/", targetUrl: "https://www.mobilize.us/mobilize/event/942116/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/organization/signal-2026-01-21-45558%E2%80%AFPM_20260123222132428157.png?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 3, energy: 3 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1319, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "In Person Group", title: "Adopt-A-Corner: stand watch at a known ICE pickup spot", description: "NDLON's Adopt-A-Corner rapid-response program assigns volunteers to monitor and disrupt ICE pickup locations (Home Depots, day-laborer corners, transit stops). Long-running commitment — open through Jan 2029.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "Multi-State", authorName: "National Day Laborer Organizing Network", authorRole: "Movement Organization", authorLink: "https://ndlon.org/", targetUrl: "https://www.mobilize.us/mobilize/event/856822/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/organization/Adopt%20a%20Corner%20Mobilize%20Group%20Graphic_20250807185842207845.png?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 3, energy: 3 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1320, category: "TRAINING", categoryColor: "#126d89", actionType: "In Person Group", title: "Volunteer Training: Rapid Response to ICE Actions (Fremont CA)", description: "Three-hour training to join the Bay Area rapid-response phone tree — verify ICE sightings, deploy verifiers, document violations. Wed May 20, 6pm, Fremont CA.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "California", authorName: "Indivisible Fremont", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/", targetUrl: "https://www.mobilize.us/mobilize/event/943590/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/event/ACELIP%20training%20image%20A_20251031044153435196.png?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 3 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1321, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Federal Building Fridays: weekly anti-Trump regime protest (Seattle)", description: "Weekly Friday lunchtime protest at the Henry M. Jackson Federal Building in downtown Seattle targeting the Trump regime broadly — ICE, DOGE cuts, Iran war, RIFs. Hosted by Southend Indivisible.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "Washington", authorName: "Southend Indivisible", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/", targetUrl: "https://www.mobilize.us/mobilize/event/944909/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/event/IMG_4009%20%281%29_20251222215412756888.JPG?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 3, comedy: 1, subversion: 1, hope: 2, energy: 3 }, adminApproved: false },
  { id: 1322, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "NO ICE Expansion: tell Sabey Corp to cancel new ICE lease (Tukwila WA)", description: "Picket Sabey Corp's Tukwila campus to demand they cancel the lease they just signed with ICE for a new processing office. Recurring Wednesdays — May 20, Jun 3, and on.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "Washington", authorName: "Southend Indivisible", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/", targetUrl: "https://www.mobilize.us/mobilize/event/933915/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/event/All%20Sabey%20protests_20260406081542745590.png?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 3 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1323, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Honk-and-Wave rallies to protest Trump regime corruption", description: "Virtual + IRL drive-by honk-and-wave rallies coordinated by Indivisible Highlands and Beyond targeting Trump regime corruption. Distributed format — join from anywhere with a sign and a road.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "Multi-State", authorName: "Indivisible Highlands and Beyond", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/", targetUrl: "https://www.mobilize.us/mobilize/event/950956/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/event/photo-3623_singular_display_fullPicture_20260506164538825158.jpeg?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 2, comedy: 2, subversion: 1, hope: 2, energy: 3 }, adminApproved: false },
  { id: 1324, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "In Person Group", title: "De-ICE Citizens Bank: National Day of Action (Jun 6)", description: "Boycott + picket Citizens Bank branches nationwide for financing GEO Group and CoreCivic ICE detention contracts. National Day of Action coordinated by the De-ICE Citizens Bank Coalition — Sat Jun 6, 11am locally.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "Multi-State", authorName: "De-ICE Citizens Bank Coalition", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/", targetUrl: "https://www.mobilize.us/mobilize/event/953075/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/organization/RSVP%20now_20260505235325939806.jpeg?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 3 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1325, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "In Person Group", title: "Hands Off NYC: small-business canvass for immigrant safety (NYC)", description: "Indivisible Harlem canvass of Harlem and uptown small businesses, distributing Know Your Rights materials and ICE-watch info to immigrant-employee-heavy storefronts. Wed May 20, 10am, plus more dates.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "New York", authorName: "Indivisible Harlem", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/", targetUrl: "https://www.mobilize.us/mobilize/event/838849/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/event/welcome%20us%20image_20251011175816920835.png?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 2, comedy: 0, subversion: 2, hope: 3, energy: 3 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1326, category: "TRAINING", categoryColor: "#126d89", actionType: "In Person Group", title: "ICE Out for Good: Know-Your-Rights canvass in Greenwich Village", description: "Volunteers distribute Know-Your-Rights cards to ICE-targeted immigrants and the lawyers who serve them around Greenwich Village. Fri May 29, 3pm, NYC.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "New York", authorName: "ICE Out For Good", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/", targetUrl: "https://www.mobilize.us/mobilize/event/956018/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/organization/ICE%20out%20for%20GOOD%20wordmark_16x9_20260108201816461490.png?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 3 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1327, category: "MEETING", categoryColor: "#5a3e9e", actionType: "In Person Group", title: "NELA Alliance for Democracy: monthly meeting (Northeast LA)", description: "Northeast Los Angeles Alliance for Democracy monthly anti-Trump organizing meeting — coordination on rapid response, voter ed, ICE watch. Thu May 28, 7pm, recurring.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "California", authorName: "Indivisible NELA", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/", targetUrl: "https://www.mobilize.us/mobilize/event/771218/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/event/NELAAforD%20mobilize%20program%20MONTHLY%20NELA%20Meeting%20in-person_20250818155924620096.jpg?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 2, comedy: 0, subversion: 1, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1328, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "In Person Group", title: "Boycott Home Depot for cooperating with ICE raids (LA)", description: "LA Indivisible community-support + Home Depot boycott action targeting Home Depot's pattern of allowing ICE raids on day-laborer corners outside its stores. Sun Jun 28, 12pm, recurring.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "California", authorName: "Indivisible Los Angeles", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/", targetUrl: "https://www.mobilize.us/mobilize/event/881851/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/organization/Mobilize%20Generalized%20Indivisible%20Event%20Campaign%20Image%201_20231214173802957298.png?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 3 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1329, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "NO WARS! Take Back Our Streets: Venice + Santa Monica weekly", description: "Indivisible Westside LA weekly anti-Trump-Iran-war street protest in Venice and Santa Monica. Thu May 21, 4pm, recurring weekly.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "California", authorName: "Indivisible Westside LA", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/", targetUrl: "https://www.mobilize.us/mobilize/event/893106/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/event/Screenshot%202026-03-18%20at%207.45.45%E2%80%AFPM_20260319040316650650.PNG?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 2, energy: 3 }, adminApproved: false },
  { id: 1330, category: "TRANSPORTATION", categoryColor: "#0a6e3f", actionType: "In Person Group", title: "Visit and accompany detained immigrants at Stewart Detention Center", description: "El Refugio runs hospitality, visitation, and advocacy for immigrants detained at Stewart Detention Center in Lumpkin GA — the largest ICE detention site in the U.S. Drive down, sit with someone whose family is hours away.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "Georgia", authorName: "El Refugio", authorRole: "Movement Organization", authorLink: "https://elrefugiostewart.org/", targetUrl: "https://elrefugiostewart.org/en/volunteers", topImageUrl: "http://static1.squarespace.com/static/5dedd42f60df274331bcd16b/t/63c0b458f5504e510924fa38/1673573464429/El+Refugio+logo+png+version_updated.png?format=1500w", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 3, energy: 2 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1331, category: "TRANSPORTATION", categoryColor: "#0a6e3f", actionType: "In Person Group", title: "Volunteer for visitation at Elizabeth Detention Center (NJ)", description: "First Friends of NJ & NY runs an ongoing visitation program at Elizabeth Detention Center (NJ) and Orange County Correctional (NY) — apply to visit, write letters, or run the hotline.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "New Jersey", authorName: "First Friends of NJ and NY", authorRole: "Movement Organization", authorLink: "https://firstfriendsnjny.org/", targetUrl: "https://firstfriendsnjny.org/volunteer/", topImageUrl: "http://jonaswebsitedesign.com/firstfriends/wp-content/uploads/2020/09/ff-web-logo.png", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 3, energy: 2 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1332, category: "FUNDING", categoryColor: "#127f05", actionType: "Online", title: "Donate to RAICES — free legal defense for ICE detainees (TX)", description: "RAICES Texas provides free or low-cost legal representation for immigrants in detention (Karnes, Dilley, Pearsall) and just filed a habeas/class-action against ICE for unlawful detention. Most ICE-detained people face deportation court without a lawyer.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", location: "Texas", authorName: "RAICES Texas", authorRole: "Movement Organization", authorLink: "https://raicestexas.org/", targetUrl: "https://raicestexas.org/?form=unite-against-hate", topImageUrl: "http://static1.squarespace.com/static/63b4656c9f96340195a2ff05/t/66c434381f80aa0d1a602193/1724134456615/raices_social.png?format=1500w", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 3, energy: 2 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1333, category: "FUNDING", categoryColor: "#127f05", actionType: "Online", title: "Donate to the NBFN Immigration Bond Freedom Fund", description: "One donation, distributed by the National Bail Fund Network to community-led immigration bail funds nationwide — buys release for immigrants caught in Trump's deportation surge.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "National Bail Fund Network", authorRole: "Movement Organization", authorLink: "https://www.communityjusticeexchange.org/en/nbfn-directory", targetUrl: "https://secure.actblue.com/donate/immbondfreedom", topImageUrl: "https://images.squarespace-cdn.com/content/v1/60db97fe88031352b829d032/1625004042861-LZNYQYNOB9ZPQ817266J/NBFNlogo_3x2.7.jpg", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 3, energy: 2 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1334, category: "FUNDING", categoryColor: "#127f05", actionType: "Online", title: "Donate to the NBFN Pretrial Bail Freedom Fund", description: "NBFN's pretrial freedom fund pools donations across 90+ local bail funds to free people held pretrial — disproportionately Black, Brown, poor, and increasingly people swept up at Trump-era protests.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "National Bail Fund Network", authorRole: "Movement Organization", authorLink: "https://www.communityjusticeexchange.org/en/nbfn-directory", targetUrl: "https://secure.actblue.com/donate/pretrialfreedom", topImageUrl: "https://images.squarespace-cdn.com/content/v1/60db97fe88031352b829d032/1625004042861-LZNYQYNOB9ZPQ817266J/NBFNlogo_3x2.7.jpg", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1335, category: "FUNDING", categoryColor: "#127f05", actionType: "Online", title: "Donate to NDLON's Immigrant Defense Fund", description: "NDLON's Immigrant Defense Fund underwrites legal defense, organizing, and rapid-response infrastructure for day-laborer and immigrant-worker communities under Trump-administration raids.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "National Day Laborer Organizing Network", authorRole: "Movement Organization", authorLink: "https://ndlon.org/", targetUrl: "https://ndlon.org/donate/", topImageUrl: "https://ndlon.org/wp-content/uploads/2018/04/Facebook-OG-Image.png", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 3, energy: 2 }, amplifiesGroups: ["immigrant"], adminApproved: false },

  // ── Grassroots-Fun spreadsheet batch (May 17): 21 irreverent / crafty
  // protest objects + content-creator boost cards. 1 row (UncorkedLabels wine
  // label) skipped as duplicate of 1314. Etsy product images scraped via
  // Chrome; TikTok cards reuse the local org_tiktok asset; the 3 Instagram
  // cards land image-less (the no-image-review guard keeps them off the
  // public feed until an admin uploads a header).
  { id: 1336, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Burn a \"Smells Like F*ck Trump\" Soy Candle", description: "A scented soy candle whose label is a cathartic anti-Trump joke — light it, sniff it, dare guests not to ask. Great gateway for liberal-leaning fence-sitters who want a subtle protest object at home.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Luminva (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/Luminva", targetUrl: "https://www.etsy.com/listing/1822852555/smells-like-fck-trump-candle-not-my", topImageUrl: "https://i.etsystatic.com/24115390/r/il/afc632/6462657815/il_1080xN.6462657815_dk11.jpg", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1337, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Light the \"Light Me When He's Dead\" No Kings Candle", description: "A pitch-dark soy candle satire built around the No Kings movement — buy it now, light it… eventually. Bestseller-level demand suggests strong cohort signal.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Independent (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/", targetUrl: "https://www.etsy.com/listing/4435012382/light-me-when-hes-dead-candle-o-no-kings", topImageUrl: "https://i.etsystatic.com/62168565/r/il/2b42c2/7563999026/il_1080xN.7563999026_2vho.jpg", toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1338, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Wear the \"Waiting for the Big Beautiful Obituary\" Shirt (MeloraTShirts)", description: "Subtle anti-MAGA dark-satire tee referencing Trump's \"big beautiful bill\" rhetoric. Conversation-starter without being explicit; reads as a soft FDT to people who get it.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MeloraTShirts (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/MeloraTShirts", targetUrl: "https://www.etsy.com/listing/4438139548/anti-trump-t-shirt-waiting-for-big", topImageUrl: "https://i.etsystatic.com/54455758/r/il/1c1a6e/7630931827/il_1080xN.7630931827_t1zw.jpg", toneOverride: { anger: 2, comedy: 3, subversion: 2, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1339, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Stick a \"Let's Go Blood Clot\" Anti-Dictator Sticker Anywhere", description: "Set of 5 vinyl glossy stickers leaning into the dictator-health-rumor news cycle. Water-resistant, ready for laptops, car bumpers, gas pumps.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "YaBoiHatesTikTok (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/YaBoiHatesTikTok", targetUrl: "https://www.etsy.com/listing/4361557773/lets-go-blood-clot-set-of-5-vinyl-glossy", topImageUrl: "https://i.etsystatic.com/25456288/r/il/aa26ef/7206475637/il_1080xN.7206475637_dge1.jpg", toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1340, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Wear a 3D-Printed \"FUCK TRUMP\" Lapel Pin from a Maker Shop", description: "Tiny 3D-printed handmade pin — wear it everywhere. Independent maker, recyclable PLA plastic, unmistakable to anyone who reads it up close.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "WokeandBespokeShop (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/WokeandBespokeShop", targetUrl: "https://www.etsy.com/listing/1822887706/fuck-trump-small-lapel-pin-3d-printed-in", topImageUrl: "https://i.etsystatic.com/14701224/r/il/0b4fd9/6531386599/il_1080xN.6531386599_p1lz.jpg", toneOverride: { anger: 2, comedy: 2, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1341, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Pin the Decode-the-Numbers \"86 47\" Anti-Trump Button", description: "Numeric subversive code pin — 86 47 means \"get rid of #47.\" Plausibly deniable in mixed company, decodable by the in-group. Subversion-by-cipher.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "ButtonRepublic (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/ButtonRepublic", targetUrl: "https://www.etsy.com/listing/4484781251/anti-trump-protest-buttons-impeach-trump", topImageUrl: "https://i.etsystatic.com/21374020/r/il/046821/7998550050/il_1080xN.7998550050_g7up.jpg", toneOverride: { anger: 1, comedy: 2, subversion: 3, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1342, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Pin: Grumpy Cat with Mug Says \"First Of All, Fuck Trump\"", description: "A cat-holding-coffee-mug pin that opens any conversation with the right energy. Independent maker, sized for jackets and tote bags.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "AntiTrumpResistance (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/AntiTrumpResistance", targetUrl: "https://www.etsy.com/listing/4343898613/first-of-all-fuck-trump-pins-buttons", topImageUrl: "https://i.etsystatic.com/57506905/r/il/65b55e/7066739838/il_1080xN.7066739838_e6ji.jpg", toneOverride: { anger: 2, comedy: 3, subversion: 2, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1343, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Wear an \"Epstein Files Protest\" Pin", description: "Pin specifically calling out the Trump–Epstein files coverup; pairs with the broader Epstein-truth subway-poster and walk campaigns.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "KindSpeech (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/KindSpeech", targetUrl: "https://www.etsy.com/listing/4495679448/anti-trump-epstein-button-anti-trump", topImageUrl: "https://i.etsystatic.com/51124327/r/il/b53f82/7958667724/il_1080xN.7958667724_rk6i.jpg", toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1344, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Stick the \"RESIST\" Decal Built from the Tesla T Badge", description: "Decal that hijacks the Tesla \"T\" badge to spell RESIST — most punishing on the cars Elon expects to be brand ambassadors. Great for Tesla Takedown rally signage and laptop stickers.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Independent (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/", targetUrl: "https://www.etsy.com/listing/4298432541/resist-decal-using-tesla-t-badge-resis", topImageUrl: "https://i.etsystatic.com/56118203/r/il/056da6/6827047560/il_1080xN.6827047560_ax1w.jpg", toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1345, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Magnet: \"I Bought This Before We Knew Elon Was Crazy\"", description: "A car magnet that lets reluctant Tesla owners distance themselves from Musk without giving up the car. Funny, self-deprecating, and immediately legible at a parking lot.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Independent (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/", targetUrl: "https://www.etsy.com/listing/1848107294/i-bought-this-before-we-knew-elon-was", topImageUrl: "https://i.etsystatic.com/56939346/r/il/b5204b/6585705442/il_1080xN.6585705442_57j5.jpg", toneOverride: { anger: 1, comedy: 3, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1346, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Burn the \"Peace President, My Ass!\" Soy Candle", description: "Blood-orange-scented soy candle directly mocking Trump's self-styled \"peace president\" branding over the Iran strikes. The label IS the protest.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Independent (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/", targetUrl: "https://www.etsy.com/listing/4481440997/the-peace-president-my-ass-exclusive", topImageUrl: "https://i.etsystatic.com/14878984/r/il/9fbd21/7915610157/il_1080xN.7915610157_kfcd.jpg", toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1347, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Pin: \"Trump Is The Worst President Since Trump\"", description: "A perfectly recursive button that does its own joke. Independent button maker, low-stakes purchase, very rewardingly absurd.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "ShopImpressiveThings (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/ShopImpressiveThings", targetUrl: "https://www.etsy.com/listing/4319736881/trump-is-the-worst-president-since-trump", topImageUrl: "https://i.etsystatic.com/57450745/r/il/e1c078/6935784130/il_1080xN.6935784130_18ir.jpg", toneOverride: { anger: 2, comedy: 3, subversion: 2, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1348, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Sticker Set: \"Hold Trump Accountable — Tired Democrat Activist\"", description: "Self-aware sticker/pin for the exhausted-but-still-showing-up cohort. Independent button shop, taps the \"this is hard but I'm doing it\" energy that drives sustained engagement.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "OneHorseShyHandmade (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/OneHorseShyHandmade", targetUrl: "https://www.etsy.com/listing/1181078926/hold-trump-accountable-pin-button-tired", topImageUrl: "https://i.etsystatic.com/7045127/r/il/4449b9/7588514985/il_1080xN.7588514985_jy7k.jpg", toneOverride: { anger: 2, comedy: 2, subversion: 1, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1349, category: "SPREAD POSITIVITY", categoryColor: "#d97706", actionType: "Online", title: "Boost Randy Rainbow's Anti-Trump Musical Parodies on TikTok", description: "Randy Rainbow's weekly Trump-skewering musical parodies (Rent, Sound of Music) translate political fury into shareable joyful satire. Pick the freshest one and share to your story.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Randy Rainbow", authorRole: "Independent Creator", authorLink: "https://www.tiktok.com/@randyrainbowofficial", targetUrl: "https://www.tiktok.com/@randyrainbowofficial", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 1, comedy: 3, subversion: 3, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1350, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Play \"Secret Handshake\" — the satirical browser game mocking Trump's Iran war", description: "Activist group \"Secret Handshake\" released a satirical browser-style video game lampooning Trump's handling of the Iran strikes — featured on Rachel Maddow. Share it, play it, post your high score.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Secret Handshake", authorRole: "Movement Organization", authorLink: "https://www.tiktok.com/@msnow", targetUrl: "https://www.tiktok.com/@msnow", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1351, category: "FLASH MOB", categoryColor: "#ff00d5", actionType: "In Person Group", title: "Sing With \"Songs for Liberation\" Outside an ICE Facility", description: "Coalition of ministers and singers running coordinated protest-hymn flash mobs at ICE facilities (Chicago, Twin Cities). Find a local chapter via #SongsForLiberation or join a sing-along where you live.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "National", authorName: "Songs for Liberation", authorRole: "Movement Organization", authorLink: "https://www.tiktok.com/tag/protestsong", targetUrl: "https://www.tiktok.com/tag/protestsong", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 3, energy: 3 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1352, category: "SPREAD POSITIVITY", categoryColor: "#d97706", actionType: "Online", title: "Spread the \"TACO\" Meme — Trump Always Chickens Out", description: "FT's Robert Armstrong coined \"TACO\" (Trump Always Chickens Out) for the tariff-threaten-then-retreat pattern. Make stickers, post taco emojis under tariff threats, mock the pattern publicly so it sticks.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Independent creators", authorRole: "Citizen Activist", authorLink: "https://www.tiktok.com/tag/trumpparody", targetUrl: "https://www.tiktok.com/tag/trumpparody", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 1, comedy: 3, subversion: 3, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1353, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Stage or Boost the \"Trump Parody Opera\" — Hamburg Premiere", description: "An actual Trump-parody opera premiering in Hamburg, Germany. Boost the trailer, organize a watch party, or write a reaction post — turn an opera into resistance content.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Really American", authorRole: "Movement Organization", authorLink: "https://www.tiktok.com/@reallyamerican", targetUrl: "https://www.tiktok.com/@reallyamerican", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 1, comedy: 3, subversion: 3, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1354, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Cross-Stitch a Resistance Slogan with Subversive Cross Stitch", description: "Use Subversive Cross Stitch's pattern catalog (Julie Jackson's shop has been doing this since the 2010s) to make a Trump-era cross-stitch — frame it, gift it, post the WIP. Distinct from the existing TikTok stitch/duet card — this is literal needlework, not video stitching.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Subversive Cross Stitch", authorRole: "Independent Creator", authorLink: "https://www.instagram.com/subversivecrossstitch/", targetUrl: "https://www.instagram.com/subversivecrossstitch/", topImageUrl: "https://scontent.cdninstagram.com/v/t51.2885-19/199306322_514541513021942_7756897236030600423_n.jpg?stp=dst-jpg_s100x100_tt6&_nc_cat=103&ccb=7-5&_nc_sid=bf7eb4&_nc_ohc=LqyEUHic0_gQ7kNvwHUIZNi&_nc_oc=Adpod_8XEKCikLOFo89IHj5IC2tTzXfMHQA0HiBGP5zknuB9GWDEnyd2ADBOc-D3Qsk&_nc_zt=24&_nc_ht=scontent.cdninstagram.com&_nc_ss=73689&oh=00_Af7KBs3ih9nt1fcALCR84OacWLaLeL8sWJ6VtjZDa0st6g&oe=6A0FBB20", toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1355, category: "CRAFTING", categoryColor: "#c34e00", actionType: "Online", title: "Stitch Along with Badass Cross Stitch's Anti-Trump Patterns", description: "Shannon Downey's @badasscrossstitch runs free-pattern drops + group stitch-ins targeting MAGA-era issues. Download a current pattern, finish a piece, and post it.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Badass Cross Stitch", authorRole: "Independent Creator", authorLink: "https://www.instagram.com/badasscrossstitch/", targetUrl: "https://www.instagram.com/badasscrossstitch/", topImageUrl: "https://scontent.cdninstagram.com/v/t51.2885-19/15043801_336957816688365_8365540907474223104_a.jpg?stp=dst-jpg_s100x100_tt6&_nc_cat=109&ccb=7-5&_nc_sid=bf7eb4&_nc_ohc=34iJMqqlsSgQ7kNvwFsZ_Ck&_nc_oc=AdouHfIFvB626TQQU_h-VIKMfXIo9UqAB3Z0NdDZXIO8DaEgrCy5mpsi2Mm7TpzW33c&_nc_zt=24&_nc_ht=scontent.cdninstagram.com&_nc_ss=70689&oh=00_Af6myQ9P9IwK-3HEmui9QiOoNAHzR7wnTmhdBfRoI9XDsQ&oe=6A0F92ED", toneOverride: { anger: 2, comedy: 2, subversion: 2, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1356, category: "CRAFTING", categoryColor: "#c34e00", actionType: "Online", title: "Make a Craftivist Collective \"Gentle Protest\" Mini-Banner", description: "The Craftivist Collective publishes \"gentle protest\" mini-banner tutorials — small, embroidered statements you leave in public space. Pick a Trump-era theme and leave one.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Craftivist Collective", authorRole: "Movement Organization", authorLink: "https://www.instagram.com/craftivist_collective/", targetUrl: "https://www.instagram.com/craftivist_collective/", topImageUrl: "https://static.cdninstagram.com/rsrc.php/v4/yD/r/R0fBIMurK8v.png", toneOverride: { anger: 1, comedy: 2, subversion: 2, hope: 3, energy: 2 }, adminApproved: false },

  // ── Grassroots-Fun batch addendum (May 17, second paste): 5 net-new cards.
  // The other 19 rows in the second paste were already in the database from
  // the previous batch (1336–1356) — silently skipped as exact dupes.
  { id: 1357, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Browse Dissent Pins — Including the \"Swastikar\" Tesla Pin", description: "Independent pin maker with a full catalog of Trump/MAGA-era dissent pins, including the now-famous \"Swastikar\" pin riffing on the Tesla logo. Wholesale and ACLU collabs available — browse the full collection.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Dissent Pins", authorRole: "Resistance Merch", authorLink: "https://dissentpins.com/", targetUrl: "https://dissentpins.com/collections/", topImageUrl: "https://cdn.shopify.com/s/files/1/1746/4337/files/Stand_With_Ukraine_Pin_on_denim_1200x628_2e311cf1-9d19-432d-85f8-cafbd9866161.jpg?v=1738503135", toneOverride: { anger: 2, comedy: 2, subversion: 3, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1358, category: "CRAFTING", categoryColor: "#c34e00", actionType: "Online", title: "Join the Resistance Knitters Bluesky Group", description: "Active craftivist knitting group that fought during Trump 1.0 on FB and is now organizing on Bluesky — knits hats and protest objects, shares patterns, surfaces fact-based news. Plug into the community and pick a project.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Resistance Knitters", authorRole: "Independent Creator", authorLink: "https://bsky.app/profile/resistanceknitters.bsky.social", targetUrl: "https://bsky.app/profile/resistanceknitters.bsky.social", topImageUrl: "https://cdn.bsky.app/img/banner/plain/did:plc:fldpue6iblblysw6tk4eptvz/bafkreidr2rhwv7nanxglbw3fxf76l37rwopjqixbue5nuivbnzsfe4wqkq", toneOverride: { anger: 1, comedy: 2, subversion: 2, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1359, category: "CRAFTING", categoryColor: "#c34e00", actionType: "Online", title: "Stitch Feline and Floss's Free Anti-ICE Cross Stitch Pattern", description: "Feline and Floss publishes free cross-stitch patterns on Ko-fi — current drop is explicitly anti-ICE/Fuck ICE. Download, stitch, frame, gift, repeat.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Feline and Floss", authorRole: "Independent Creator", authorLink: "https://ko-fi.com/felineandfloss", targetUrl: "https://ko-fi.com/felineandfloss", topImageUrl: "https://storage.ko-fi.com/cdn/generated/lyflmrusgjymi/2026-05-11_rest-973b09129414d2335f7e561b753bf0ee-v4e73jqn.jpg", toneOverride: { anger: 2, comedy: 2, subversion: 3, hope: 2, energy: 2 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1360, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Color Your Way Through Trump 2.0 with Fresh Prints' Anti-Trump Resistance Coloring Book", description: "Indie coloring book full of anti-Trump pages — calming, shareable craft for tense news days. Pages are also sold as standalone prints.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "FreshPrintsHandmade (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/FreshPrintsHandmade", targetUrl: "https://freshprintshandmade.etsy.com", topImageUrl: "https://i.etsystatic.com/56615728/r/isla/b30f8f/74796492/isla_500x500.74796492_b2qer1xw.jpg", toneOverride: { anger: 1, comedy: 2, subversion: 2, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1361, category: "FLASH MOB", categoryColor: "#ff00d5", actionType: "In Person Group", title: "Join a \"Honk to Dump Trump\" + \"Trump ❤️ Epstein\" Banner Drop", description: "Indivisible chapters are running overpass banner drops with the \"Honk to Dump Trump\" and \"Trump ❤️ Epstein\" twin-banner format. Search your local Indivisible chapter for the next slot.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "National", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://www.mobilize.us/indivisible/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/organization_social/Indivisible%20Protest_20220613182827829964.png?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 2, comedy: 2, subversion: 3, hope: 2, energy: 3 }, adminApproved: false },

  // ── Grassroots-Fun batch 3 (May 17): 12 net-new cards. 9 rows from the
  // user's paste were exact-URL duplicates of cards already in the database
  // and were silently skipped.
  { id: 1362, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Pin: \"Unpaid Protester, Hating For Free\"", description: "A 2.25\" pin for tired-but-still-fighting Democrats: \"Unpaid Protester, Hating For Free.\" Wear it to the next No Kings rally or pin it on a tote.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "HUGRco (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/HUGRco", targetUrl: "https://www.etsy.com/listing/4463726967/not-paid-hate-for-free-anti-trump-pin", topImageUrl: "https://i.etsystatic.com/36342593/r/il/f41707/7817044311/il_1080xN.7817044311_smdg.jpg", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1363, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Pin: \"Crows Against Kings\" — Corvid Solidarity for No Kings Era", description: "Hand-illustrated pinback button of a flock of crows ganging up on a tossed crown — corvid solidarity for the No Kings era. Wear it loud or tuck it on a denim jacket.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "PencilIsland (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/PencilIsland", targetUrl: "https://www.etsy.com/listing/4366381414/crows-against-kings-pinback-button-no", topImageUrl: "https://i.etsystatic.com/14793879/r/il/198027/7703767710/il_1080xN.7703767710_siqr.jpg", toneOverride: { anger: 1, comedy: 2, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1364, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Retro \"Suburban Housewives Against Trump\" Buttons", description: "A 1950s-inspired button reclaiming the \"suburban housewife\" trope Trump kept campaigning to — wear it to a knit-in, pin it on a tote, or hand them out at PTA.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "CafeChaCha (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/CafeChaCha", targetUrl: "https://www.etsy.com/listing/855158042/retro-suburban-housewives-against-trump", topImageUrl: "https://i.etsystatic.com/8327952/r/il/e051fb/2520953040/il_1080xN.2520953040_rqb8.jpg", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 1, energy: 2 }, amplifiesGroups: ["woman"], adminApproved: false },
  { id: 1365, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Pin: \"86 47\" Botanical (Subtle Anti-Trump)", description: "Botanical-illustrated take on the \"86 47\" anti-Trump number code — subtle enough for the office, sharp enough to be unmistakable to anyone who knows.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "BlueWaveInk (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/BlueWaveInk", targetUrl: "https://www.etsy.com/listing/4306542331/8647-floral-button-subtle-anti-trump-pin", topImageUrl: "https://i.etsystatic.com/22550025/r/il/fd0b03/6915660471/il_1080xN.6915660471_ken4.jpg", toneOverride: { anger: 1, comedy: 2, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1366, category: "CRAFTING", categoryColor: "#c34e00", actionType: "Online", title: "Stitch the \"Abolish ICE\" Pin (Shannon Downey Tutorial)", description: "Free DIY needlepoint tutorial from craftivist Shannon Downey for stitching your own Abolish ICE pin — turn rage at the deportation raids into something you can pin on a denim jacket.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Badass Cross Stitch (Shannon Downey)", authorRole: "Independent Creator", authorLink: "https://linktr.ee/BadassCrossStitch", targetUrl: "https://linktr.ee/BadassCrossStitch", topImageUrl: "https://linktr.ee/og/image/BadassCrossStitch.jpg", toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 2, energy: 2 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1367, category: "CRAFTING", categoryColor: "#c34e00", actionType: "Online", title: "Stitch Your Own Anti-Trump Voodoo Doll (Free Pattern)", description: "Cathartic free needlepoint pattern from Shannon Downey — stitch a tiny effigy and stick the pins yourself. Therapy plus craftivism.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Badass Cross Stitch (Shannon Downey)", authorRole: "Independent Creator", authorLink: "https://linktr.ee/BadassCrossStitch", targetUrl: "https://linktr.ee/BadassCrossStitch", topImageUrl: "https://linktr.ee/og/image/BadassCrossStitch.jpg", toneOverride: { anger: 3, comedy: 3, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1368, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join the Joyful Menace Society", description: "Shannon Downey's monthly craftivist community: stitch-along assignments, harm-reduction zines, and a low-key plan for menacing the regime with fabric.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Badass Cross Stitch (Shannon Downey)", authorRole: "Independent Creator", authorLink: "https://linktr.ee/BadassCrossStitch", targetUrl: "https://linktr.ee/BadassCrossStitch", topImageUrl: "https://linktr.ee/og/image/BadassCrossStitch.jpg", toneOverride: { anger: 1, comedy: 2, subversion: 2, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1369, category: "SPREAD POSITIVITY", categoryColor: "#d97706", actionType: "Online", title: "Make a \"Yay!\" Flag for Your Window", description: "Sew or paper-craft a Yay! flag to celebrate every protest, court win, or canceled deportation — tiny visible joy in the windows of a fascist-curious neighborhood.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Badass Cross Stitch (Shannon Downey)", authorRole: "Independent Creator", authorLink: "https://linktr.ee/BadassCrossStitch", targetUrl: "https://linktr.ee/BadassCrossStitch", topImageUrl: "https://linktr.ee/og/image/BadassCrossStitch.jpg", toneOverride: { anger: 0, comedy: 2, subversion: 1, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1370, category: "CRAFTING", categoryColor: "#c34e00", actionType: "Online", title: "Free \"No Kings\" Cross-Stitch PDF", description: "Free instant-download No Kings cross-stitch pattern from the OG snarky-sampler shop — stitch one for your kitchen wall before the next No Kings Day.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Subversive Cross Stitch (Julie Jackson)", authorRole: "Independent Creator", authorLink: "https://linktr.ee/subversivecrossstitch", targetUrl: "https://linktr.ee/subversivecrossstitch", topImageUrl: "https://linktr.ee/og/image/subversivecrossstitch.jpg", toneOverride: { anger: 1, comedy: 2, subversion: 3, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1371, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Watch & Share: Tom Morello Sings \"This Land Is Your Land\" at NYC Anti-ICE Protest", description: "Tom Morello broke out the Woody Guthrie at a Hands Off NYC rally against ICE raids — share the clip to keep this protest's song alive in the algorithm.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Consequence Sound (via Tom Morello)", authorRole: "Independent Creator", authorLink: "https://www.tiktok.com/@consequence", targetUrl: "https://www.tiktok.com/@consequence/video/7639124680695106829", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 3, energy: 3 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1372, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Boost This Hour Has 22 Minutes' Trump Book Sketch", description: "Canadian sketch show 22 Minutes is gleefully roasting Trump from across the border — re-post their parody bits so more people hear the laugh-from-Canada take on MAGA.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "This Hour Has 22 Minutes", authorRole: "Independent Creator", authorLink: "https://www.tiktok.com/@thishourhas22minutes", targetUrl: "https://www.tiktok.com/@thishourhas22minutes/video/7576736715587472660", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1373, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Re-Share the Iranian Embassy AI Memes Mocking Trump", description: "Iranian embassies are flooding social with AI-generated memes ridiculing Trump's war posture — a strange-bedfellows trolling moment worth reposting for the absurdity alone.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "CNN (reporting on Iranian embassies)", authorRole: "Independent Creator", authorLink: "https://www.tiktok.com/@cnn", targetUrl: "https://www.tiktok.com/@cnn/video/7628912004643753230", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 1, comedy: 3, subversion: 3, hope: 0, energy: 2 }, adminApproved: false },
  { id: 1375, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Wear a \"Cleanup on Aisle 47\" Anti-Trump Pin", description: "A punchy pinback button that calls out the disaster Trump's making — perfect for grocery runs, town halls, or anywhere you want to make strangers smile and nod knowingly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "JennXStuff (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/JennXStuff", targetUrl: "https://www.etsy.com/shop/JennXStuff", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1376, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Wear a \"TACO TACO Man\" Anti-Trump Button / Keychain", description: "Trump ranted about \"tacos\" at a rally and the internet turned it into resistance merch. Clip the keychain to your bag or wear the button — every time someone asks, you get to explain.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "EpicWaresGifts (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/EpicWaresGifts", targetUrl: "https://www.etsy.com/shop/EpicWaresGifts", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1377, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Wear an \"Impeach Noem\" 2.25\" Pin", description: "Kristi Noem bragged about shooting her dog. This pin keeps the pressure on — wear it to anything where her future political ambitions might come up.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "IntoTheEyeMerch (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/IntoTheEyeMerch", targetUrl: "https://www.etsy.com/shop/IntoTheEyeMerch", toneOverride: { anger: 2, comedy: 2, subversion: 2, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1378, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Slap an Anti-Trump Champagne Label on the Bottle for \"When He Drops\"", description: "A custom champagne label designed for the future celebration — bring a bottle to your next resistance gathering and save it for the toast. Subversive, bubbly, and completely legal.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "UncorkedLabels (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/UncorkedLabels", targetUrl: "https://www.etsy.com/shop/UncorkedLabels", toneOverride: { anger: 0, comedy: 3, subversion: 3, hope: 3, energy: 1 }, adminApproved: false },
  { id: 1379, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Wear an \"It's Like a Coup With Morons\" Pin", description: "Five words that perfectly summarize the whole situation. Slap it on your lapel and let strangers do a double-take before they start nodding in agreement.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "AntiTrumpResistance (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/AntiTrumpResistance", targetUrl: "https://www.etsy.com/shop/AntiTrumpResistance", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1380, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Stick a \"Mars Can Keep Him\" Anti-Elon Bumper Sticker on Your Car", description: "Elon bought himself a rocket ship and a government department. This sticker offers one suggestion for what to do with both. Slap it on your bumper before the next Tesla protest.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "TacoDogDesign (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/TacoDogDesign", targetUrl: "https://www.etsy.com/shop/TacoDogDesign", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1381, category: "CRAFTING", categoryColor: "#c34e00", actionType: "Online", title: "Stitch the Free #FuckICE Cross-Stitch Pattern from Feline & Floss", description: "Free cross-stitch pattern from Feline & Floss — stitch it into a jacket patch, a protest banner, or your own wall. Download it on Ko-fi and start stitching.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Feline & Floss (Ko-fi)", authorRole: "Independent Creator", authorLink: "https://ko-fi.com/felineandfloss", targetUrl: "https://ko-fi.com/felineandfloss", topImageUrl: "https://cdn.bsky.app/img/avatar/plain/did:plc:v2hwso5qpqpdftob6yy6raqp/bafkreifjzru5aul65nfqbsaj3bowcj3jwkwudd5obyqbewcn3tghg2vjvq", toneOverride: { anger: 2, comedy: 2, subversion: 3, hope: 2, energy: 1 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1382, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Color Through Trump 2.0 with Fresh Prints' Anti-Trump Resistance Coloring Book", description: "A full coloring book for working through your feelings about the MAGA era with colored pencils. Great for kids and adults who need a break from their phones.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Fresh Prints Design (Etsy)", authorRole: "Independent Creator", authorLink: "https://www.etsy.com/shop/FreshPrintsDesign", targetUrl: "https://www.etsy.com/shop/FreshPrintsDesign", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 3, energy: 1 }, adminApproved: false },
  { id: 1383, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Build (and Whack) a Trumpiñata with Carlyn Yandle's Collaborative How-To", description: "Artist Carlyn Yandle's step-by-step guide to building a Trump piñata — perfect for a protest prep party, a neighborhood block gathering, or just your living room ceiling.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Carlyn Yandle (Substack)", authorRole: "Independent Creator", authorLink: "https://carlynyandle.substack.com", targetUrl: "https://carlynyandle.substack.com", topImageUrl: "https://cdn.bsky.app/img/avatar/plain/did:plc:isenjin5dqu44uf5wtwar7ao/bafkreicgdbk6l6xbl2ixks2iyixv2yj3jh6rewwdurjuvvlxobg7776eoi", toneOverride: { anger: 1, comedy: 3, subversion: 3, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1384, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Follow BAD Stitch on Bluesky for Subversive Anti-Trump Cross-Stitch", description: "Amanda DeLong's BAD Stitch account drops regular anti-Trump cross-stitch patterns and finished pieces — follow for pattern releases, technique tips, and craftivism community.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "BAD Stitch / Amanda DeLong (Bluesky)", authorRole: "Independent Creator", authorLink: "https://bsky.app/profile/badstitch.bsky.social", targetUrl: "https://bsky.app/profile/badstitch.bsky.social", topImageUrl: "https://cdn.bsky.app/img/avatar/plain/did:plc:exbra7bwy7faa2fzlwoum6f7/bafkreiattgw5eh3xx6x2yiojeq4lh724ixzy7ancwkozzj5vlp6zbpvmaq", toneOverride: { anger: 2, comedy: 2, subversion: 2, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1385, category: "SPREAD POSITIVITY", categoryColor: "#d97706", actionType: "Online", title: "Boost \"Pardon Me, Mr. Trump!\" — mockpolitrick's Parody Song About Trump's Pardon Spree", description: "A pitch-perfect parody of Trump's pardon party — mockpolitrick nails the absurdity and the tune is genuinely catchy. Share the TikTok to get it into someone else's algorithm today.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "mockpolitrick (TikTok)", authorRole: "Independent Creator", authorLink: "https://www.tiktok.com/@mockpolitrick", targetUrl: "https://www.tiktok.com/@mockpolitrick", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1386, category: "CRAFTING", categoryColor: "#c34e00", actionType: "Online", title: "Download Free Craftivism Patterns from The Morning Crafter", description: "The Morning Crafter drops free downloadable cross-stitch and embroidery patterns with a resistance bent — follow the TikTok and grab the pattern packs to stitch something political.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Morning Crafter (TikTok)", authorRole: "Independent Creator", authorLink: "https://www.tiktok.com/@themorningcrafter", targetUrl: "https://www.tiktok.com/@themorningcrafter", topImageUrl: "https://cdn.bsky.app/img/avatar/plain/did:plc:qxnyueeraquon7hdvjfhcbn3/bafkreiaze4uc4smf6hfzgbskhb5xnoxedbgplvz2ic7nxmldp3ctos4bmu", toneOverride: { anger: 1, comedy: 2, subversion: 2, hope: 3, energy: 1 }, adminApproved: false },
  { id: 1387, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Stick a \"Swasticar\" Sticker Sheet on Your Laptop, Water Bottle, and Car", description: "FedUpStudio's \"Swasticar\" sticker sheet calls out the visual parallel people keep spotting at Tesla lots and Musk events. Cover your gear in it and let it do the talking.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "FedUpStudio (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/FedUpStudio", targetUrl: "https://www.etsy.com/shop/FedUpStudio", toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1388, category: "PURCHASE", categoryColor: "#b45309", actionType: "Online", title: "Hang a \"Things I Trust More Than Donald Trump\" Banner from Your Porch", description: "A porch banner for the long game — hang it outside and let the whole neighborhood know exactly where you stand. Ships via PrintingUSA on Etsy.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "PrintingUSA (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/PrintingUSA", targetUrl: "https://www.etsy.com/shop/PrintingUSA", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1389, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Drop a \"Nikola Protests Tesla\" Banner Alongside the Tesla T Party", description: "Independent artist Bruce S. is making protest banners for Tesla T Party demonstrations — follow on Bluesky to coordinate a drop at a Tesla dealership near you and add some visual flair to the picket line.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Bruce S. (Bluesky)", authorRole: "Independent Creator", authorLink: "https://bsky.app/search?q=nikola+protests+tesla", targetUrl: "https://bsky.app/search?q=nikola+protests+tesla", topImageKey: "org_tesla-takedown", imageContain: true, toneOverride: { anger: 2, comedy: 2, subversion: 3, hope: 2, energy: 2 }, adminApproved: false },
];

// ─── Seed receipts (The Smacks) ───────────────────────────────────────────────
// IDs start at 5001 to avoid collisions with admin-created receipts.
// Bump seed:receipts version key whenever you add/edit entries here.
// SEED_RECEIPTS is only needed for smacks that require KV-side metadata
// (e.g. server-controlled hiding, boost counts seeded at a specific value).
// Static smacks that are always visible live in STATIC_SMACKS in SmacksPage.tsx.
// IDs must not overlap with STATIC_SMACKS (5001–5031); use 5500+ here.
const SEED_RECEIPTS: Array<{
  id: number; title: string; tags: string[];
  imageUrl: string; caption?: string; adminApproved: boolean;
}> = [];

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/make-server-9eb1ae04/health", (c) => c.json({ status: "ok" }));

// ─── AUTH: Status — verify JWT & return/create approval record ────────────────
app.get("/make-server-9eb1ae04/auth/status", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "No token provided" }, 401);

    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid or expired token" }, 401);

    // First /auth/status call after deploy reconciles all existing records
    // against the admin allowlist. Cheap on subsequent calls (just a flag read).
    await sweepAdminAllowlistOnce();

    const approval = await ensureApprovalRecord(user);

    // Update visit streak server-side so it persists across devices/browsers.
    const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
    const streakKv = await kv.get(`streak:${user.id}`) as { count: number; lastVisit: string } | null;
    let streakCount = 1;
    if (!streakKv) {
      await kv.set(`streak:${user.id}`, { count: 1, lastVisit: todayKey });
    } else if (streakKv.lastVisit === todayKey) {
      streakCount = streakKv.count;
    } else {
      const [ay, am, ad] = streakKv.lastVisit.split("-").map(Number);
      const [by, bm, bd] = todayKey.split("-").map(Number);
      const gap = Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
      streakCount = gap === 1 ? streakKv.count + 1 : 1;
      await kv.set(`streak:${user.id}`, { count: streakCount, lastVisit: todayKey });
    }

    return c.json({ approval, streak: streakCount });
  } catch (err) {
    console.log("Auth status error:", err);
    return c.json({ error: `Status check failed: ${err}` }, 500);
  }
});

// ─── ADMIN: Manually re-run the allowlist sweep ───────────────────────────────
app.post("/make-server-9eb1ae04/admin/sweep", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const result = await sweepAdminAllowlist();
    console.log(
      `Admin ${admin.record.name} ran allowlist sweep: ` +
      `${result.demoted.length} demoted, ${result.promoted.length} promoted`
    );
    return c.json(result);
  } catch (err) {
    return c.json({ error: `Sweep failed: ${err}` }, 500);
  }
});

// ─── ADMIN: Sync Supabase auth users → KV approval records ───────────────────
// Lists every Supabase auth user and seeds a pending KV record for anyone who
// signed up but whose /auth/status call never completed (network blip, cold
// start, etc.). Safe to run repeatedly — skips users who already have a record.
app.post("/make-server-9eb1ae04/admin/sync-auth-users", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const sb = adminClient();

    // Fetch all Supabase auth users (up to 1000)
    const { data: authData, error: authErr } = await sb.auth.admin.listUsers({ perPage: 1000 });
    if (authErr) return c.json({ error: `Failed to list auth users: ${authErr.message}` }, 500);
    const authUsers = authData?.users ?? [];

    // Fetch existing KV records
    const existing = await kv.getByPrefix("user:approval:") as any[];
    const knownIds = new Set(existing.filter(Boolean).map((r: any) => r.userId));

    const seeded: { email: string; name: string }[] = [];
    const alreadyHad: number = knownIds.size;

    for (const u of authUsers) {
      if (knownIds.has(u.id)) continue;
      const record = {
        userId: u.id,
        email: u.email ?? "",
        name:
          u.user_metadata?.full_name ??
          u.user_metadata?.name ??
          u.email?.split("@")[0] ??
          "Resistor",
        avatar: u.user_metadata?.avatar_url ?? null,
        status: isAdminEmail(u.email) ? "approved" : "pending",
        isAdmin: isAdminEmail(u.email),
        provider: u.app_metadata?.provider ?? "email",
        createdAt: u.created_at ?? new Date().toISOString(),
      };
      await kv.set(`user:approval:${u.id}`, record);
      seeded.push({ email: record.email, name: record.name });
    }

    console.log(`Auth sync by ${admin.record.name}: ${authUsers.length} auth users, ${alreadyHad} already in KV, ${seeded.length} seeded`);
    return c.json({ authTotal: authUsers.length, alreadyHad, seeded });
  } catch (err) {
    return c.json({ error: `Sync failed: ${err}` }, 500);
  }
});

// ─── ADMIN: Scan all KV cards for truncated descriptions ─────────────────────
app.get("/make-server-9eb1ae04/admin/scan-truncated", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const truncated: { id: number; store: string; title: string; description: string; targetUrl?: string }[] = [];

    // Scan action: (seed) cards
    const actionEntries = await kv.getByPrefix("action:");
    for (const card of actionEntries as any[]) {
      if (card && typeof card.description === "string" && card.description.trimEnd().endsWith("...")) {
        truncated.push({ id: card.id, store: "action", title: card.title, description: card.description, targetUrl: card.targetUrl });
      }
    }

    // Scan user-action: (submitted) cards
    const userActionEntries = await kv.getByPrefix("user-action:");
    for (const card of userActionEntries as any[]) {
      if (card && typeof card.description === "string" && card.description.trimEnd().endsWith("...")) {
        truncated.push({ id: card.id, store: "user-action", title: card.title, description: card.description, targetUrl: card.targetUrl });
      }
    }

    truncated.sort((a, b) => a.id - b.id);
    return c.json({ count: truncated.length, cards: truncated });
  } catch (err) {
    return c.json({ error: `Scan failed: ${err}` }, 500);
  }
});

// ─── ADMIN: Patch a card's description in KV (for fixing truncated descriptions) ──
app.post("/make-server-9eb1ae04/admin/fix-description", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const body = await c.req.json().catch(() => null);
    if (!body || !body.id || !body.description) {
      return c.json({ error: "Required: id (number) and description (string)" }, 400);
    }

    const id = Number(body.id);
    let key = `action:${id}`;
    let existing: any = await kv.get(key);
    if (!existing) {
      key = `user-action:${id}`;
      existing = await kv.get(key);
    }
    if (!existing) return c.json({ error: `Card ${id} not found in KV` }, 404);

    await kv.set(key, { ...existing, description: String(body.description) });
    console.log(`Admin ${admin.record.name} fixed description for card ${id}`);
    return c.json({ ok: true, id, key });
  } catch (err) {
    return c.json({ error: `Fix failed: ${err}` }, 500);
  }
});

// ─── ADMIN: Approved cards missing a targetUrl ───────────────────────────────
// ─── ADMIN: User-submitted cards missing a targetUrl ─────────────────────────
// Returns user-action cards that have no targetUrl so the admin can find and
// add the correct action link. authorLink (author homepage) is shown for
// context but is a separate field.
app.get("/make-server-9eb1ae04/admin/actions/missing-url", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const results: any[] = [];
    const userCardIds = (await kv.get("user-action:ids") ?? []) as number[];
    for (const id of userCardIds) {
      const card = await kv.get(`user-action:${id}`) as any;
      if (card && typeof card === "object" && !card.targetUrl && !card.pinToTop) {
        results.push({
          id: card.id,
          title: card.title,
          category: card.category,
          authorName: card.authorName,
          authorLink: card.authorLink ?? null,
          adminApproved: card.adminApproved,
        });
      }
    }
    results.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
    return c.json({ count: results.length, cards: results });
  } catch (err) {
    return c.json({ error: `Failed: ${err}` }, 500);
  }
});

app.get("/make-server-9eb1ae04/admin/actions/no-url", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    // Despite the endpoint name, this returns cards missing EITHER:
    //   • an action link (`targetUrl`), OR
    //   • a top image (no `topImageUrl` AND no `topImageKey`).
    // Both kinds need admin attention before they're really publishable —
    // a card with no URL has no action to take, and a card with no image
    // looks broken in the feed grid. Grouping them in the same admin tab
    // keeps the "things to fix" surface small.
    const isMissing = (card: any) => {
      if (!card || typeof card !== "object") return false;
      if (card.adminApproved !== true) return false;
      const noUrl = !card.targetUrl;
      const noImage = !card.topImageUrl && !card.topImageKey;
      return noUrl || noImage;
    };

    const missing: any[] = [];

    for (const card of (await kv.getByPrefix("action:")) as any[]) {
      if (isMissing(card) && !card.pinToTop) {
        missing.push({ ...card, _store: "action" });
      }
    }

    const userCardIds = (await kv.get("user-action:ids") ?? []) as number[];
    for (const id of userCardIds) {
      const card = await kv.get(`user-action:${id}`) as any;
      if (isMissing(card)) {
        missing.push({ ...card, _store: "user-action" });
      }
    }

    missing.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    return c.json({ cards: missing });
  } catch (err) {
    return c.json({ error: `Failed to fetch no-url cards: ${err}` }, 500);
  }
});

// ─── ADMIN: List all users ─────────────────────────────────────────────────────
app.get("/make-server-9eb1ae04/admin/users", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const users = await kv.getByPrefix("user:approval:");
    const list = (users as any[]).filter((u) => u && typeof u === "object" && u.userId);

    // One direct table scan over the complete:* prefix avoids N round-trips
    // and exposes the key (the kv helper hides it). Build per-user totals
    // and the most-recent completedAt so the admin list can show a tier chip
    // + "active 3 days ago" inline without a follow-up request.
    const sb = adminClient();
    const { data: completionRows } = await sb
      .from("kv_store_9eb1ae04")
      .select("key, value")
      .like("key", "complete:%");

    const totalByUser:      Record<string, number> = {};
    const lastActiveByUser: Record<string, string> = {};
    for (const row of completionRows ?? []) {
      // Key format: `complete:{userId}:{actionId}`
      const parts = String(row.key).split(":");
      if (parts.length < 3) continue;
      const uid = parts[1];
      totalByUser[uid] = (totalByUser[uid] ?? 0) + 1;
      const t = row.value?.completedAt;
      if (t && (!lastActiveByUser[uid] || String(t).localeCompare(lastActiveByUser[uid]) > 0)) {
        lastActiveByUser[uid] = String(t);
      }
    }

    // Fetch email consent from auth user metadata (stored at sign-up).
    const consentByUser: Record<string, boolean | null> = {};
    try {
      const { data: authUsers } = await sb.auth.admin.listUsers({ perPage: 1000 });
      for (const u of authUsers?.users ?? []) {
        consentByUser[u.id] = u.user_metadata?.emailConsent ?? null;
      }
    } catch { /* non-fatal — consent column stays null */ }

    const enriched = list.map((u) => ({
      ...u,
      totalActions: totalByUser[u.userId] ?? 0,
      lastActiveAt: lastActiveByUser[u.userId] ?? null,
      emailConsent: consentByUser[u.userId] ?? null,
    }));

    // Sort by last-active DESC by default; users with no activity fall to the
    // bottom but stay in original signup order.
    enriched.sort((a, b) => {
      if (a.lastActiveAt && b.lastActiveAt) return b.lastActiveAt.localeCompare(a.lastActiveAt);
      if (a.lastActiveAt) return -1;
      if (b.lastActiveAt) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return c.json({ users: enriched });
  } catch (err) {
    console.log("Admin users error:", err);
    return c.json({ error: `Failed to list users: ${err}` }, 500);
  }
});

// ─── ADMIN: Who's online right now ────────────────────────────────────────────
// Reads `user:last-seen:*` (written by `getUser` on every authenticated
// request) and joins with `user:approval:{userId}` for display fields.
// "Online" = last-seen within `windowMinutes` (default 1440 = 24h). Cap is
// 1 week (10 080 min) so an admin can scan recent-but-not-current activity.
app.get("/make-server-9eb1ae04/admin/online-users", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const windowMinutes = Math.max(1, Math.min(10_080, parseInt(c.req.query("windowMinutes") ?? "1440", 10) || 1440));
    const cutoffMs = Date.now() - windowMinutes * 60_000;

    const sb = adminClient();
    const { data: rows } = await sb
      .from("kv_store_9eb1ae04")
      .select("key, value")
      .like("key", "user:last-seen:%");

    const online: Array<{ userId: string; lastSeenAt: string }> = [];
    for (const row of rows ?? []) {
      const userId = String(row.key).slice("user:last-seen:".length);
      const iso = typeof row.value === "string" ? row.value : row.value?.at;
      if (!iso) continue;
      const ms = Date.parse(iso);
      if (isNaN(ms) || ms < cutoffMs) continue;
      online.push({ userId, lastSeenAt: iso });
    }

    // Hydrate with display fields from the approval record.
    const enriched = await Promise.all(online.map(async (entry) => {
      const record = await kv.get(`user:approval:${entry.userId}`) as any;
      return {
        userId: entry.userId,
        lastSeenAt: entry.lastSeenAt,
        name: record?.name ?? "Resistor",
        email: record?.email ?? "",
        avatar: record?.avatar ?? null,
        isAdmin: !!record?.isAdmin,
        status: record?.status ?? "pending",
      };
    }));

    enriched.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    return c.json({ users: enriched, windowMinutes, count: enriched.length });
  } catch (err) {
    console.log("Admin online-users error:", err);
    return c.json({ error: `Failed to list online users: ${err}` }, 500);
  }
});

// ─── ADMIN: Approve user ──────────────────────────────────────────────────────
app.post("/make-server-9eb1ae04/admin/approve/:userId", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const targetId = c.req.param("userId");
    const record = await kv.get(`user:approval:${targetId}`) as any;
    if (!record) return c.json({ error: "User not found" }, 404);

    record.status = "approved";
    record.approvedBy = admin.user.id;
    record.approvedAt = new Date().toISOString();
    await kv.set(`user:approval:${targetId}`, record);
    console.log(`Admin approved user ${record.email}`);
    return c.json({ user: record });
  } catch (err) {
    return c.json({ error: `Approval failed: ${err}` }, 500);
  }
});

// ─── ADMIN: Reject user ───────────────────────────────────────────────────────
app.post("/make-server-9eb1ae04/admin/reject/:userId", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const targetId = c.req.param("userId");
    const record = await kv.get(`user:approval:${targetId}`) as any;
    if (!record) return c.json({ error: "User not found" }, 404);

    record.status = "rejected";
    record.rejectedBy = admin.user.id;
    record.rejectedAt = new Date().toISOString();
    await kv.set(`user:approval:${targetId}`, record);
    console.log(`Admin rejected user ${record.email}`);
    return c.json({ user: record });
  } catch (err) {
    return c.json({ error: `Rejection failed: ${err}` }, 500);
  }
});

// ─── GET /matcher-config — public read of admin-tuned matcher knobs ──────────
// Public so the matcher on every client can pick up the latest tuning without
// each user having to be an admin. Returns null when no admin override exists.
app.get("/make-server-9eb1ae04/matcher-config", async (c) => {
  try {
    const config = await kv.get("matcher-config:v1");
    return c.json({ config: config ?? null });
  } catch (err) {
    console.log("matcher-config read error:", err);
    return c.json({ config: null });
  }
});

// ─── PUT /admin/matcher-config — write tuned config ──────────────────────────
app.put("/make-server-9eb1ae04/admin/matcher-config", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const body = await c.req.json<{ categoryTone?: Record<string, Record<string, number>> }>();
    if (!body || typeof body !== "object") {
      return c.json({ error: "Invalid body" }, 400);
    }
    const config = {
      categoryTone: body.categoryTone ?? {},
      updatedAt: new Date().toISOString(),
      updatedBy: admin.email ?? admin.id,
    };
    await kv.set("matcher-config:v1", config);
    console.log(`Admin ${admin.email} updated matcher-config`);
    return c.json({ config });
  } catch (err) {
    console.log("matcher-config write error:", err);
    return c.json({ error: `Failed to save: ${err}` }, 500);
  }
});

// ─── DELETE /admin/matcher-config — reset to defaults ────────────────────────
app.delete("/make-server-9eb1ae04/admin/matcher-config", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);
    await kv.del("matcher-config:v1");
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: `Reset failed: ${err}` }, 500);
  }
});

// ─── GET /actions ─────────────────────────────────────────────────────────────
app.get("/make-server-9eb1ae04/actions", async (c) => {
  try {
    // Cap raised from 100 → 2000 so the client can drain the whole catalog
    // (~600 cards as of May 2026, with room to grow) in a single request.
    // The server already loads ALL cards into `allCards` before slicing
    // (see further down), so paginating buys us nothing on the server side
    // — it only adds 5+ round-trip latencies on the client's initial sync.
    // 2000 keeps a hard ceiling so a malformed client can't ask for
    // millions and OOM the function.
    const limit  = Math.min(Number(c.req.query("limit")  ?? 20), 2000);
    const offset = Math.max(Number(c.req.query("offset") ?? 0),   0);

    // PERF: warm the migration-flag cache in a single batch read so the
    // ~41 individual getMigrationFlag() calls in the migration blocks
    // below are all Set lookups (instant) instead of separate KV
    // round-trips (~100ms each = ~4 seconds total on cold isolates).
    await warmMigrationFlagCache();

    // Seed Ellen user if not done yet
    await seedEllenUser();

    // One-time: remove fake placeholder seed cards (IDs 1–18) from the DB
    const fakePurged = await getMigrationFlag("cleanup:fake-seeds:v1");
    if (!fakePurged) {
      const fakeIds = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18];
      for (const id of fakeIds) await kv.del(`action:${id}`);
      await setMigrationFlag("cleanup:fake-seeds:v1");
      console.log("Purged fake seed cards 1–18.");
    }

    // One-time: re-purge the placeholder seed cards (ids 2–17 minus 11) that
    // were re-seeded after the v1 cleanup ran. SEED_CARDS no longer references
    // them, so deleting their KV records is final — they won't reappear.
    const fakePurgedV2 = await getMigrationFlag("cleanup:purge-fake-seeds:v2");
    if (!fakePurgedV2) {
      const ids = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17];
      for (const id of ids) await kv.del(`action:${id}`);
      await setMigrationFlag("cleanup:purge-fake-seeds:v2");
      console.log(`Purged ${ids.length} fake seed cards (v2): ${ids.join(", ")}`);
    }

    // One-time: remove dropped seed cards. Add new IDs to the array and bump
    // the version key whenever you delete cards from SEED_CARDS.
    const droppedPurged = await getMigrationFlag("cleanup:dropped-seeds:v1");
    if (!droppedPurged) {
      const droppedIds = [1136, 1185]; // Apiary repro-pledge duplicates
      for (const id of droppedIds) await kv.del(`action:${id}`);
      await setMigrationFlag("cleanup:dropped-seeds:v1");
      console.log(`Purged ${droppedIds.length} dropped seed cards.`);
    }

    // One-time: zero out boosts on the early seed cards that started with
    // `boosts: 5` placeholder values. These were carry-over from the original
    // Figma demo data. Live data writes get preserved on re-seed via the
    // merge logic below, so the seed file alone can't clear them.
    const boostsResetDone = await getMigrationFlag("cleanup:reset-boosts-5:v1");
    if (!boostsResetDone) {
      const resetIds = [8, 9, 10, 13];
      for (const id of resetIds) {
        const existing = (await kv.get(`action:${id}`)) as any;
        if (existing && typeof existing === "object") {
          await kv.set(`action:${id}`, { ...existing, boosts: 0 });
        }
      }
      await setMigrationFlag("cleanup:reset-boosts-5:v1");
      console.log(`Reset boosts to 0 on ${resetIds.length} demo cards.`);
    }

    // One-time: rewrite Blaire Erskine Substack description (id 1278). The
    // CSV-imported version was vague about why users would subscribe; the
    // updated copy makes the anti-MAGA satire connection explicit so admins
    // and users can immediately see why it's on-topic.
    const blaireUpdated = await getMigrationFlag("cleanup:blaire-substack-desc:v1");
    if (!blaireUpdated) {
      const newDesc = "The newsletter version of Blaire Erskine's deadpan-news-anchor MAGA satire — bonus fake interviews skewering Trump talking points, behind-the-scenes on her viral TikTok reels, no algorithm gating. Direct to your inbox.";
      for (const prefix of ["action:", "user-action:"]) {
        const existing = (await kv.get(`${prefix}1278`)) as any;
        if (existing && typeof existing === "object") {
          await kv.set(`${prefix}1278`, { ...existing, description: newDesc });
        }
      }
      await setMigrationFlag("cleanup:blaire-substack-desc:v1");
      console.log("Updated Blaire Erskine Substack description (id 1278).");
    }

    // One-time: clear stray `notOnTopic` flags on cards 265/266/267 (Apple/
    // Google subscription cancellations). These were flagged by a stray
    // human click in a past admin session — the rest of the cancel-subs
    // cluster (Amazon/Microsoft/Xbox/etc.) was approved cleanly. Going
    // forward the off-topic badge is AI-set only.
    const strayFlagsCleared = await getMigrationFlag("cleanup:clear-stray-offtopic:v1");
    if (!strayFlagsCleared) {
      const ids = [265, 266, 267];
      for (const id of ids) {
        for (const prefix of ["user-action:", "action:"]) {
          const existing = (await kv.get(`${prefix}${id}`)) as any;
          if (existing && typeof existing === "object" && existing.notOnTopic === true) {
            const cleared = { ...existing };
            delete cleared.notOnTopic;
            await kv.set(`${prefix}${id}`, cleared);
          }
        }
      }
      await setMigrationFlag("cleanup:clear-stray-offtopic:v1");
      console.log(`Cleared stray notOnTopic flags on ${ids.length} cards.`);
    }

    // One-time: backfill `topImageUrl` on the 37 CSV-imported cards (IDs
    // 1245–1281) using og:image URLs scraped from each card's targetUrl host.
    // Tesla cards are skipped — they already use the local `org_tesla-takedown`
    // asset. TikTok / Twitch / Pol-Rev pages don't expose og:image, so they
    // borrow the 50501 / brand-equivalent image as a sensible fallback.
    const imagesBackfillDone = await getMigrationFlag("cleanup:backfill-images-1245:v1");
    if (!imagesBackfillDone) {
      const FIFTY = "https://linktr.ee/og/image/fiftyfiftyonemovement.jpg";
      const INDIV = "https://indivisible.org/wp-content/uploads/2026/01/indivisible_logo_dark_fill.png";
      const MEIDAS = "https://yt3.googleusercontent.com/7N7yfRN_fPIuDvW2MxnaD3kHDZqxun0_owwvdr06EsFC-6sV3XIA36ChpolKIFzCbkmh97KJuLM=s900-c-k-c0x00ffffff-no-rj";
      const TLP = "https://lincolnproject.us/wp-content/uploads/2021/09/TLP-Social-Share-1.png";
      const AAF1 = "https://www.aafront.org/wp-content/uploads/2019/07/AAF.jpg";
      const AAF2 = "https://www.aafront.org/wp-content/uploads/2023/05/OpSave-fun-Group-1-e1684764862613.jpg";
      const BLAIRE = "https://substackcdn.com/image/fetch/$s_!mBb4!,f_auto,q_auto:best,fl_progressive:steep/https%3A%2F%2Fblaireerskine.substack.com%2Ftwitter%2Fsubscribe-card.jpg";
      const imageMap: Record<number, string> = {
        1245: FIFTY, 1246: FIFTY, 1247: FIFTY, 1248: FIFTY, 1249: FIFTY, 1250: FIFTY,
        // 1251–1256: Tesla cards already use org_tesla-takedown — skip.
        1257: INDIV, 1258: INDIV, 1259: INDIV, 1260: INDIV,
        1261: INDIV, 1262: INDIV, 1263: INDIV, 1264: INDIV,
        1265: FIFTY, 1266: FIFTY, 1267: FIFTY,
        // 1268: Tesla IG — already on org_tesla-takedown — skip.
        1269: FIFTY,
        1270: FIFTY, 1271: FIFTY, 1272: FIFTY,
        1273: MEIDAS, 1274: MEIDAS,
        1275: AAF1, 1276: AAF2,
        1277: BLAIRE, 1278: BLAIRE,
        1279: TLP,
        1280: FIFTY, 1281: FIFTY,
      };
      let imageBackfillCount = 0;
      for (const [idStr, url] of Object.entries(imageMap)) {
        const id = Number(idStr);
        for (const prefix of ["action:", "user-action:"]) {
          const existing = (await kv.get(`${prefix}${id}`)) as any;
          if (existing && typeof existing === "object") {
            await kv.set(`${prefix}${id}`, { ...existing, topImageUrl: url });
            imageBackfillCount++;
          }
        }
      }
      await setMigrationFlag("cleanup:backfill-images-1245:v1");
      console.log(`Backfilled topImageUrl on ${imageBackfillCount} new cards.`);
    }

    // One-time: clear the previously-backfilled topImageUrl on TikTok/YouTube
    // cards so the new local SVG logos (org_tiktok / org_youtube, with
    // imageContain) take over. The resolver prefers topImageUrl over
    // topImageKey, so we must null it explicitly.
    const tiktokYoutubeRekeyDone = await getMigrationFlag("cleanup:tiktok-youtube-rekey:v1");
    if (!tiktokYoutubeRekeyDone) {
      const idsToRekey = [1266, 1267, 1273, 1274, 1279, 1280, 1281];
      let cleared = 0;
      for (const id of idsToRekey) {
        for (const prefix of ["action:", "user-action:"]) {
          const existing = (await kv.get(`${prefix}${id}`)) as any;
          if (existing && typeof existing === "object" && existing.topImageUrl) {
            const { topImageUrl: _, ...rest } = existing;
            await kv.set(`${prefix}${id}`, rest);
            cleared++;
          }
        }
      }
      await setMigrationFlag("cleanup:tiktok-youtube-rekey:v1");
      console.log(`Cleared topImageUrl on ${cleared} TikTok/YouTube cards (rekeyed to local SVGs).`);
    }

    // One-time: zero out placeholder `boosts: 5` on the second batch — admin-
    // added cards (IDs 2000+) that shipped with a default-5 value. These live
    // under `user-action:` (not `action:`) since they came through the user-
    // submission flow. v3 since v2 wrote to the wrong prefix.
    const boostsResetV3Done = await getMigrationFlag("cleanup:reset-boosts-5:v3");
    if (!boostsResetV3Done) {
      const resetIds = [2002, 2003, 2004, 2005, 2006];
      for (const id of resetIds) {
        // Try both prefixes so this works regardless of where the card lives.
        for (const prefix of ["user-action:", "action:"]) {
          const existing = (await kv.get(`${prefix}${id}`)) as any;
          if (existing && typeof existing === "object") {
            await kv.set(`${prefix}${id}`, { ...existing, boosts: 0 });
          }
        }
      }
      await setMigrationFlag("cleanup:reset-boosts-5:v3");
      console.log(`Reset boosts to 0 on ${resetIds.length} admin-added cards.`);
    }

    // Seed/refresh the org-action library (IDs 1000+) into KV. Bump the version
    // key (e.g. v4 → v5) whenever you've edited SEED_CARDS and want the live
    // feed to pick up the new title/url/image. Existing user activity (`boosts`)
    // and admin curation flags (`quickAction`) are preserved across re-seeds —
    // only seed-managed metadata (title/desc/url/image) is overwritten.
    // One-time: set boosts = 950 on the pinned Spread the Word card.
    const boostsFixed1 = await getMigrationFlag("cleanup:set-boosts-1-950:v1");
    if (!boostsFixed1) {
      const card1 = await kv.get("action:1") as any;
      if (card1 && typeof card1 === "object") {
        await kv.set("action:1", { ...card1, boosts: 950 });
      }
      await setMigrationFlag("cleanup:set-boosts-1-950:v1");
      console.log("Set boosts = 950 on action:1 (Spread the Word).");
    }

    const orgsSeeded = await getMigrationFlag("seed:org-actions:v26");
    if (!orgsSeeded) {
      // Mark the seed as done UP FRONT — if the request times out partway
      // through the 260-card loop, the next request still skips the loop
      // instead of dying again. The cards already written stay; missing ones
      // get filled in on the next version bump.
      await setMigrationFlag("seed:org-actions:v26");
      let count = 0;
      for (const card of SEED_CARDS) {
        // Seed every card in SEED_CARDS (no longer skipping ids <1000).
        // The pre-1000 design placeholders were purged via the fake-seeds
        // cleanups; the only pre-1000 IDs left in SEED_CARDS are real
        // (id 1 = pinned ResistAct intro, id 19 = Smolotov merch).
        const existing = (await kv.get(`action:${card.id}`)) as any;
        // Default to approved, but let the card itself override (e.g. CSV
        // imports can ship with `adminApproved: false` so they land in the
        // admin review queue instead of going live unreviewed).
        const merged: any = { adminApproved: true, ...card };
        if (existing && typeof existing === "object") {
          // Preserve live engagement counters that users have moved.
          if (typeof existing.boosts === "number")        merged.boosts = existing.boosts;
          else if (typeof existing.spotsUsed === "number") merged.boosts = existing.spotsUsed;
          if (typeof existing.completions === "number")   merged.completions = existing.completions;
          // Preserve admin-curation flags that aren't owned by the seed.
          if (existing.quickAction === true) merged.quickAction = true;
          // Preserve eventDate if admin has set one manually.
          if (existing.eventDate) merged.eventDate = existing.eventDate;
          // Preserve custom topImageUrl so admin-uploaded images survive re-seeds.
          if (existing.topImageUrl && !card.topImageUrl) merged.topImageUrl = existing.topImageUrl;
          // Never demote a card the admin has already approved — re-seeding
          // should never send an approved card back to the pending queue.
          if (existing.adminApproved === true) merged.adminApproved = true;
        }
        await kv.set(`action:${card.id}`, merged);
        count++;
      }
      console.log(`Re-seeded ${count} org-action cards (v25).`);
    }

    // One-time migration: any pre-rename card still using `spotsUsed` gets a
    // matching `boosts` field copied in (without removing spotsUsed, so an
    // older client deploy keeps working).
    const migratedBoosts = await getMigrationFlag("migrate:spotsused-to-boosts:v1");
    if (!migratedBoosts) {
      let migrated = 0;
      for (const c of (await kv.getByPrefix("action:")) as any[]) {
        if (!c || typeof c !== "object") continue;
        if (typeof c.boosts === "number") continue;
        if (typeof c.spotsUsed === "number") {
          c.boosts = c.spotsUsed;
          await kv.set(`action:${c.id}`, c);
          migrated++;
        }
      }
      for (const c of (await kv.getByPrefix("user-action:")) as any[]) {
        if (!c || typeof c !== "object") continue;
        if (typeof c.boosts === "number") continue;
        if (typeof c.spotsUsed === "number") {
          c.boosts = c.spotsUsed;
          await kv.set(`user-action:${c.id}`, c);
          migrated++;
        }
      }
      await setMigrationFlag("migrate:spotsused-to-boosts:v1");
      console.log(`Migrated ${migrated} cards from spotsUsed → boosts.`);
    }

    // One-time migration: zero out boosts on all org seed cards (id >= 1000)
    // that were incorrectly seeded with boosts: 4.
    const boostsZeroed = await getMigrationFlag("migration:reset-boosts:v1");
    if (!boostsZeroed) {
      let zeroed = 0;
      for (const card of (await kv.getByPrefix("action:")) as any[]) {
        if (card && typeof card === "object" && typeof card.id === "number" && card.id >= 1000) {
          card.boosts = 0;
          await kv.set(`action:${card.id}`, card);
          zeroed++;
        }
      }
      await setMigrationFlag("migration:reset-boosts:v1");
      console.log(`Reset boosts to 0 on ${zeroed} org seed cards.`);
    }

    // One-time migration: set adminApproved on all action cards.
    // Cards with images (topImageKey or topImageUrl) get adminApproved: true,
    // EXCEPT for the batch added in action:1251–1271 which need admin review.
    // All user-created cards without adminApproved also get flagged as false.
    const adminApprovedMigrated = await getMigrationFlag("migration:admin-approved:v1");
    if (!adminApprovedMigrated) {
      let approved = 0, flagged = 0;
      for (const card of (await kv.getByPrefix("action:")) as any[]) {
        if (!card || typeof card !== "object" || typeof card.id !== "number") continue;
        const id = card.id as number;
        if (id >= 1251 && id <= 1271) {
          card.adminApproved = false;
          await kv.set(`action:${id}`, card);
          flagged++;
        } else if (card.topImageKey || (card.topImageUrl && card.topImageUrl.length > 0)) {
          card.adminApproved = true;
          await kv.set(`action:${id}`, card);
          approved++;
        }
      }
      // Also flag existing user-created cards as pending if not yet approved
      const userCardIds2 = (await kv.get("user-action:ids") ?? []) as number[];
      for (const uid of userCardIds2) {
        const ucard = await kv.get(`user-action:${uid}`) as any;
        if (ucard && typeof ucard === "object" && ucard.adminApproved === undefined) {
          ucard.adminApproved = false;
          await kv.set(`user-action:${uid}`, ucard);
          flagged++;
        }
      }
      await setMigrationFlag("migration:admin-approved:v1");
      console.log(`Admin-approved migration: ${approved} approved, ${flagged} flagged pending.`);
    }

    // One-time migration: set eventDate on the pol-rev event cards.
    const eventDatesMigrated = await getMigrationFlag("migration:event-dates:v1");
    if (!eventDatesMigrated) {
      const dates: Record<number, string> = {
        1252: "2026-07-04",
        1253: "2026-06-13",
        1254: "2026-06-10",
        1255: "2026-05-25",
        1256: "2026-05-20",
        1257: "2026-05-17",
        1258: "2026-05-17",
        1259: "2026-05-13",
        1260: "2026-05-12",
        1261: "2026-05-09",
      };
      for (const [idStr, date] of Object.entries(dates)) {
        const evCard = await kv.get(`action:${idStr}`) as any;
        if (evCard && typeof evCard === "object") {
          evCard.eventDate = date;
          await kv.set(`action:${idStr}`, evCard);
        }
      }
      await setMigrationFlag("migration:event-dates:v1");
      console.log("Event-dates migration complete.");
    }

    // One-time migrations for user-created cards (from origin/develop)
    const migrationV1 = await getMigrationFlag("migration:user-cards:v1");
    if (!migrationV1) {
      console.log("Running user-card migration v1...");
      const card30 = await kv.get("user-action:30") as any;
      if (card30 && typeof card30 === "object") {
        card30.title = "Baby Trump Balloon";
        card30.targetUrl = "https://www.amazon.com/Jumbo-Orange-Baby-Blimp-Inflatable/dp/B07FQ7TFMH/";
        card30.description = "Show your resistance with this giant 47.2-inch inflatable orange Baby Trump balloon! Perfect for protests, marches, and rooftop displays. Makes a powerful visual statement — buy one and fly it high to show Trump the resistance won't be silenced.";
        await kv.set("user-action:30", card30);
        console.log("Migrated card 30: Baby Trump Balloon");
      }
      await setMigrationFlag("migration:user-cards:v1");
      console.log("User-card migration v1 complete.");
    }

    // One-time: mark user-submitted cards (user-action:*) that have NO
    // targetUrl as unapproved so the admin can review and add the correct
    // action link. authorLink (author homepage) is a separate field and is
    // intentionally NOT used as a substitute here.
    const noUrlReviewDone = await getMigrationFlag("migration:nourl-review:v1");
    if (!noUrlReviewDone) {
      let marked = 0;
      const userCardIds3 = (await kv.get("user-action:ids") ?? []) as number[];
      for (const id of userCardIds3) {
        const card = await kv.get(`user-action:${id}`) as any;
        if (card && typeof card === "object" && !card.targetUrl && !card.pinToTop) {
          await kv.set(`user-action:${id}`, { ...card, adminApproved: false });
          marked++;
        }
      }
      await setMigrationFlag("migration:nourl-review:v1");
      console.log(`nourl-review: marked ${marked} user-submitted cards without a targetUrl as unapproved.`);
    }

    // One-time: re-approve the "Be Pretti Good" memorial beanie card.
    // The nourl-review migration flagged it because it has no targetUrl
    // (it's a crafting card with no external link), but it was previously
    // approved and should stay live.
    const beanieReapproved = await getMigrationFlag("cleanup:reapprove-beanie:v1");
    if (!beanieReapproved) {
      let reapproved = 0;
      for (const c of (await kv.getByPrefix("user-action:")) as any[]) {
        if (!c || typeof c !== "object" || typeof c.id !== "number") continue;
        if (typeof c.title === "string" && c.title.toLowerCase().includes("pretti good")) {
          await kv.set(`user-action:${c.id}`, { ...c, adminApproved: true });
          reapproved++;
          console.log(`Re-approved beanie card user-action:${c.id}: "${c.title}"`);
        }
      }
      await setMigrationFlag("cleanup:reapprove-beanie:v1");
      console.log(`Beanie re-approval migration: ${reapproved} cards updated.`);
    }

    // One-time: backfill `targetUrl` on user-submitted cards that were saved
    // with a `link` field instead. The create endpoint previously stored the
    // AskFlow URL as `link`; everything else (admin panel, nourl-review,
    // EditCardModal) reads `targetUrl`. Rename the field in place.
    const linkToTargetUrlDone = await getMigrationFlag("cleanup:link-to-targeturl:v1");
    if (!linkToTargetUrlDone) {
      let fixed = 0;
      for (const c of (await kv.getByPrefix("user-action:")) as any[]) {
        if (!c || typeof c !== "object" || typeof c.id !== "number") continue;
        if (c.link && !c.targetUrl) {
          const { link: linkVal, ...rest } = c;
          await kv.set(`user-action:${c.id}`, { ...rest, targetUrl: linkVal });
          fixed++;
        }
      }
      await setMigrationFlag("cleanup:link-to-targeturl:v1");
      console.log(`link→targetUrl migration: fixed ${fixed} user-submitted cards.`);
    }

    // One-time: any card with no image (no topImageUrl, no topImageKey, no
    // topImage) gets adminApproved:false so it lands in the admin review queue
    // instead of leaking to anon users. The create endpoint requires an image
    // up front; this migration cleans up cards admitted before that rule.
    const noImageReviewDone = await getMigrationFlag("migration:no-image-review:v1");
    if (!noImageReviewDone) {
      let demoted = 0;
      for (const prefix of ["action:", "user-action:"]) {
        for (const c of (await kv.getByPrefix(prefix)) as any[]) {
          if (!c || typeof c !== "object" || typeof c.id !== "number") continue;
          const hasImage = Boolean(c.topImageUrl) || Boolean(c.topImageKey) || Boolean(c.topImage);
          if (hasImage) continue;
          if (c.adminApproved === false) continue; // already in the review queue
          await kv.set(`${prefix}${c.id}`, { ...c, adminApproved: false });
          demoted++;
        }
      }
      await setMigrationFlag("migration:no-image-review:v1");
      console.log(`No-image review migration: demoted ${demoted} cards to adminApproved=false.`);
    }

    // One-time: bulk-mark PETITION cards as "5–10 minutes" and strip any
    // `quickAction: true` so the matcher classifies them as the new `10min`
    // bucket (not `5min` via the quickAction shortcut). Touches both `action:*`
    // (org seeds) and `user-action:*` (admin-added / user-submitted).
    const petitions10minDone = await getMigrationFlag("migration:petitions-10min:v1");
    if (!petitions10minDone) {
      let updated = 0;
      for (const prefix of ["action:", "user-action:"]) {
        for (const c of (await kv.getByPrefix(prefix)) as any[]) {
          if (!c || typeof c !== "object" || typeof c.id !== "number") continue;
          const cat = String(c.category ?? "").toUpperCase();
          if (cat !== "PETITION") continue;
          const next: any = { ...c, timeCommitment: "5–10 minutes" };
          if (next.quickAction === true) delete next.quickAction;
          await kv.set(`${prefix}${c.id}`, next);
          updated++;
        }
      }
      await setMigrationFlag("migration:petitions-10min:v1");
      console.log(`Petitions 10-min migration: updated ${updated} cards.`);
    }

    // ── Self-heal user-action:ids ──────────────────────────────────────────────
    // Scans every `user-action:*` KV record and ensures its id is in
    // `user-action:ids`. Runs once per warm process (not once globally) —
    // cold-starts coincide with deploys, which is the race window for the
    // migration block below, so this catches any drift the previous
    // deploy's migrations may have introduced. Idempotent (set union).
    if (!healUserActionIdsRunInProcess) {
      const currentIds = ((await kv.get("user-action:ids")) ?? []) as number[];
      const idSet = new Set<number>(currentIds);
      let restored = 0;
      for (const c of (await kv.getByPrefix("user-action:")) as any[]) {
        if (!c || typeof c !== "object" || typeof c.id !== "number") continue;
        if (idSet.has(c.id)) continue;
        idSet.add(c.id);
        currentIds.push(c.id);
        restored++;
      }
      if (restored > 0) {
        currentIds.sort((a, b) => a - b);
        await kv.set("user-action:ids", currentIds);
      }
      healUserActionIdsRunInProcess = true;
      if (restored > 0) {
        console.log(`Heal user-action:ids: restored ${restored} orphaned card refs.`);
      }
    }

    // Dedup the restore-lost-batch1 race: two function instances both ran the
    // restore migration before either set the gate, so 2150/2151 are duplicates
    // of 2148/2149 (same title/authorName/url). Delete the higher ids and
    // remove from user-action:ids. Idempotent — deleting a non-existent record
    // is a no-op and filter on a missing id is a no-op.
    const dedupBatchRepairDone = await getMigrationFlag("migration:dedup-restore-race:v1");
    if (!dedupBatchRepairDone) {
      const idsToRemove = [2150, 2151];
      for (const id of idsToRemove) {
        await kv.del(`user-action:${id}`);
      }
      const currentIds = ((await kv.get("user-action:ids")) ?? []) as number[];
      await kv.set("user-action:ids", currentIds.filter((id) => !idsToRemove.includes(id)));
      await setMigrationFlag("migration:dedup-restore-race:v1");
      console.log(`Dedup restore-race: removed ${idsToRemove.length} duplicate cards.`);
    }

    // Restore Hartford Yarn Works + Morning Crafter — batch-1 migration logged
    // them in user-action:ids but the actual KV records never persisted (the
    // first repair pass's getByPrefix scan found 0 of them). Re-create at new
    // ids and append to user-action:ids.
    const restoreLostBatch1Done = await getMigrationFlag("migration:restore-lost-batch1:v1");
    if (!restoreLostBatch1Done) {
      const baseIds = ((await kv.get("user-action:ids")) ?? []) as number[];
      const startId = Math.max(...baseIds, 1305) + 1;
      const now = new Date().toISOString();
      const lost = [
        {
          category: "CRAFTING", categoryColor: "#c34e00",
          title: `Order a Subversive Cross-Stitch Kit from Hartford Yarn Works`,
          description: `Hartford Yarn Works just restocked their subversive cross-stitch kits (plus their book and new styles) — turn rage at Trump/MAGA into hours of meditative stabby thread-work.`,
          authorName: "Hartford Yarn Works", authorRole: "Independent shop",
          authorLink: "https://bsky.app/profile/hartfordyarnworks.bsky.social",
          targetUrl: "https://hartfordyarnworks.com/",
          toneOverride: { anger: 2, comedy: 2, subversion: 3, hope: 2, energy: 2 },
        },
        {
          category: "CRAFTING", categoryColor: "#c34e00",
          title: `Stitch along with The Morning Crafter's free anti-Trump-era craftivism patterns`,
          description: `@the_morningcrafter releases free craftivism patterns on TikTok (kept off Etsy, free on her site) for people compelled to make things while resisting Trump.`,
          authorName: "The Morning Crafter", authorRole: "TikTok creator",
          authorLink: "https://www.tiktok.com/@the_morningcrafter",
          targetUrl: "https://www.tiktok.com/@the_morningcrafter",
          toneOverride: { anger: 1, comedy: 2, subversion: 2, hope: 3, energy: 2 },
        },
      ];
      const cards = lost.map((c, i) => ({
        id: startId + i,
        category: c.category,
        categoryColor: c.categoryColor,
        actionType: "Online",
        isOnline: true,
        timeCommitment: "5–10 minutes",
        title: c.title,
        description: c.description,
        spotsTotal: "Unlimited",
        boosts: 0,
        authorName: c.authorName,
        authorRole: c.authorRole,
        authorLink: c.authorLink,
        targetUrl: c.targetUrl,
        toneOverride: c.toneOverride,
        adminApproved: true,
        createdAt: now,
      }));
      const placed = await appendUserActionCards(cards);
      await setMigrationFlag("migration:restore-lost-batch1:v1");
      console.log(`Restored ${placed.length} lost batch-1 cards (ids ${placed.join(", ")}).`);
    }

    // Restore Tom Morello — overwritten at id 2132 by batch-2 migration when
    // it read a stale (already-corrupted) user-action:ids and computed
    // base = 2131. Re-create at the next free id.
    const restoreTomMorelloDone = await getMigrationFlag("migration:restore-tom-morello:v1");
    if (!restoreTomMorelloDone) {
      const currentIds = ((await kv.get("user-action:ids")) ?? []) as number[];
      const card: any = {
        id: Math.max(...currentIds, 1305) + 1,
        category: "SPREAD POSITIVITY",
        categoryColor: "#d97706",
        actionType: "Online",
        isOnline: true,
        timeCommitment: "5–10 minutes",
        title: `Reshare Tom Morello's "This Land is Your Land" at Hands Off NYC anti-ICE protest`,
        description: `Tom Morello covered Woody Guthrie's "This Land is Your Land" at a Hands Off NYC protest against Trump-era ICE abuses targeting immigrant New Yorkers — share the clip as a singalong for your own local action.`,
        spotsTotal: "Unlimited",
        boosts: 0,
        authorName: "Consequence / Tom Morello",
        authorRole: "TikTok creator",
        authorLink: "https://www.tiktok.com/@consequence",
        targetUrl: "https://www.tiktok.com/@consequence",
        toneOverride: { anger: 2, comedy: 0, subversion: 2, hope: 3, energy: 3 },
        adminApproved: true,
        createdAt: new Date().toISOString(),
      };
      const [placedId] = await appendUserActionCards([card]);
      await setMigrationFlag("migration:restore-tom-morello:v1");
      console.log(`Restored Tom Morello card at id ${placedId}.`);
    }

    // One-time (batch 2): 15 more creator-shop / regional-brigade / parody-song
    // imports. 6 images auto-fetched (3 Bluesky brigade banners + 3 YouTube
    // thumbnails); the 7 Etsy + 2 TikTok cards land image-less and need images
    // attached via Admin → Edit.
    const creatorsBatch2Done = await getMigrationFlag("migration:creators-import-2026-05-batch2:v1");
    if (!creatorsBatch2Done) {
      type NewCard2 = {
        category: string;
        categoryColor: string;
        title: string;
        description: string;
        authorName: string;
        authorRole: string;
        authorLink: string;
        targetUrl: string;
        toneOverride: { anger: number; comedy: number; subversion: number; hope: number; energy: number };
        sourceImageUrl?: string;
        // In-person fields — only set for the 3 banner brigades.
        location?: string;
        isOnline?: boolean;
        actionType?: string;
      };
      const incoming2: NewCard2[] = [
        // ── Etsy (7) — image-less; auto-blocked by Etsy 429 ──
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Pin the "Cuts May Be Necessary" French Revolution Guillotine Anti-Trump Button`,
          description: `A 1.25" guillotine pinback button captioned "Cuts May Be Necessary" — Eat-the-Rich Reign-of-Terror cosplay aimed straight at Trump's oligarch class. Wear it to rallies for maximum scowl-from-MAGA-uncles.`,
          authorName: "CherryRevolutionary", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/CherryRevolutionary",
          targetUrl: "https://www.etsy.com/listing/4324513102/french-revolution-guillotine-pin-button",
          toneOverride: { anger: 2, comedy: 2, subversion: 3, hope: 1, energy: 2 } },
        { category: "ART PIECE", categoryColor: "#896312",
          title: `Wave the "NOPE to Fascism" Big-Face Trump Cutout Protest Sign`,
          description: `A pre-printed jumbo Trump-face cutout on a stick captioned "NOPE TO FASCISM." Holds itself above the crowd at any anti-Trump rally — instant photo-op gold and zero arts-and-crafts night required.`,
          authorName: "CaliSunshineInk", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/CaliSunshineInk",
          targetUrl: "https://www.etsy.com/listing/1886630209/anti-trump-protest-sign-nope-to-fascism",
          toneOverride: { anger: 2, comedy: 3, subversion: 2, hope: 1, energy: 3 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Pin the "Resist Bear — Only You Can Prevent Fascism Park" Smokey Pin`,
          description: `Smokey Bear gets a glow-up: this pin/magnet swaps "Forest Fires" for "Fascism Park," with Smokey holding a RESIST shovel. Quiet-but-direct lapel flair against the Trump regime for backpacks, jackets, and tote bags.`,
          authorName: "FracturedLullabies", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/FracturedLullabies",
          targetUrl: "https://www.etsy.com/listing/4399942126/resist-bear-button-protest-pin-magnet",
          toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 2, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Wear the Latin "Praeses Noster Stultus Est" Subtle Anti-Trump Tee`,
          description: `A Roman-eagle classical satire shirt that reads "Praeses Noster Stultus Est" — Latin for "Our President Is Stupid." Office-safe until anyone Googles it; then it's a brutal Trump-is-an-idiot tee.`,
          authorName: "CageyDesignsShop", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/CageyDesignsShop",
          targetUrl: "https://www.etsy.com/listing/1882733793/latin-subtle-anti-trump-shirt-trump-is",
          toneOverride: { anger: 1, comedy: 3, subversion: 3, hope: 1, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Plant the "Sorry for Being Weird Through Our First Dictatorship" Yard Sign`,
          description: `Apologetic lawn sign with metal H-stake reading "Sorry For Being Weird Through Our First Dictatorship" — passive-aggressive welcome to your MAGA neighbors and a daily Trump-era reminder for the cul-de-sac.`,
          authorName: "MojoSticker", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/MojoSticker",
          targetUrl: "https://www.etsy.com/listing/4372513055/sorry-being-weird-first-dictatorship",
          toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 1, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Slap the "Leopards Eating People's Faces Party" Anti-Trump Bumper Sticker`,
          description: `The Twitter meme made physical — show every Trump-voter-regret driver behind you the slogan that named them. "Leopards Ate My Face" lore on the freeway, sized for car/laptop/dumpster.`,
          authorName: "SpatulaCityShirts", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/SpatulaCityShirts",
          targetUrl: "https://www.etsy.com/listing/1822104455/i-support-the-leopards-eating-peoples",
          toneOverride: { anger: 1, comedy: 3, subversion: 3, hope: 0, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Hang the "Things I Trust More Than Donald Trump" Outdoor Banner`,
          description: `A hemmed, grommeted, weatherproof full-size protest banner listing (the very long list of) things more trustworthy than Trump. Built to drop over highways, hang at rallies, or hoist above your fence.`,
          authorName: "PrintingUSA", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/PrintingUSA",
          targetUrl: "https://www.etsy.com/listing/1765811950/things-i-trust-more-than-donald-trump",
          toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 1, energy: 3 } },

        // ── Bluesky banner brigades (3) — regional / in-person ──
        { category: "FLASH MOB", categoryColor: "#ff00d5",
          title: `Join the Indivisible Memphis Banner Brigade — Weekly Anti-Trump Highway Visibility Drops`,
          description: `Indivisible Memphis Banner Brigade meets on the Shady Grove Rd. overpass above I-240 (parking on Ransom Lane) for No Kings / anti-Trump banner drops over rush-hour commuters. Bring a sign — your presence is your power.`,
          authorName: "Indivisible Memphis Banner Brigade", authorRole: "Volunteer brigade",
          authorLink: "https://bsky.app/profile/indivisiblememphis.bsky.social",
          targetUrl: "https://bsky.app/profile/indivisiblememphis.bsky.social",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 3, energy: 3 },
          sourceImageUrl: "https://cdn.bsky.app/img/banner/plain/did:plc:iiuocx5en26ntjbkmnoqhxpm/bafkreidruinb5m2sdonj7btamou6nkfq24rwrjpoyvkpaorpssjxlnzboa",
          location: "Tennessee", isOnline: false, actionType: "In Person Group" },
        { category: "FLASH MOB", categoryColor: "#ff00d5",
          title: `Volunteer with the Hartford Visibility Brigade (CT 50501) — Banner-Drop Brigade`,
          description: `Hartford-area CT 50501 volunteers run weekly banner-drop ops with No War / Release the Files / ICE OUT / Trump Must Go boards. Email HartfordVB@proton.me to get the schedule — more volunteers means longer messages over more bridges.`,
          authorName: "CT 50501 Hartford Visibility Brigade", authorRole: "Volunteer brigade",
          authorLink: "https://bsky.app/profile/byrneout44.bsky.social",
          targetUrl: "https://bsky.app/profile/byrneout44.bsky.social",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 3, energy: 3 },
          sourceImageUrl: "https://cdn.bsky.app/img/banner/plain/did:plc:5yxegpvvhahv5bai3lx7fkon/bafkreicqgdqhnqjhwcneha5uxh7zfkniw2yfvyu6uzlevvom4nksxp5zwm",
          location: "Connecticut", isOnline: false, actionType: "In Person Group" },
        { category: "FLASH MOB", categoryColor: "#ff00d5",
          title: `Join the SoCal #BridgeBrigade #8647 Banner-Drop Crew (Alhambra, Greater LA)`,
          description: `Greater-LA banner-drop network organizing recurring "86 47" Trump-themed overpass actions in and around Alhambra. Follow @victormswmsg for the next bridge call — bring fabric paint, zip ties, and a friend with a camera.`,
          authorName: "SoCal Bridge Brigade", authorRole: "Volunteer brigade",
          authorLink: "https://bsky.app/profile/victormswmsg.bsky.social",
          targetUrl: "https://bsky.app/profile/victormswmsg.bsky.social",
          toneOverride: { anger: 2, comedy: 2, subversion: 2, hope: 2, energy: 3 },
          sourceImageUrl: "https://cdn.bsky.app/img/banner/plain/did:plc:co3do5kd5o4veaw46x3dnuno/bafkreieek2rig6gazr2qlkoiro7yvwswxwyvi5m6bxpyz5uxycmthcs35u",
          location: "California", isOnline: false, actionType: "In Person Group" },

        // ── YouTube parody songs (3) — og:image thumbnail available ──
        { category: "SPREAD POSITIVITY", categoryColor: "#d97706",
          title: `Boost the Marsh Family's "Bohemian Trumpsody" — Anti-Trump Queen Parody`,
          description: `The viral British family that recut Les Mis in lockdown is back, this time turning "Bohemian Rhapsody" into a full-throated anti-Trump anthem. Share with the MAGA uncle who blocks every news article — he'll watch a Queen parody.`,
          authorName: "Marsh Family", authorRole: "Independent creator",
          authorLink: "https://www.youtube.com/watch?v=YY_8WzcHqMQ",
          targetUrl: "https://www.youtube.com/watch?v=YY_8WzcHqMQ",
          toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 2, energy: 3 },
          sourceImageUrl: "https://i.ytimg.com/vi/YY_8WzcHqMQ/maxresdefault.jpg" },
        { category: "SPREAD POSITIVITY", categoryColor: "#d97706",
          title: `Share Parody Project's "Springtime for Elon" — Mel Brooks-Style Musk Salute Takedown`,
          description: `A pitch-perfect "Springtime for Hitler" rewrite about Elon's inauguration arm-salute and the Trump-Musk era. Mel Brooks energy aimed at DOGE — send to anyone still pretending the salute meant nothing.`,
          authorName: "Parody Project (Don Caron / Patrick Fitzgerald)", authorRole: "Independent creator",
          authorLink: "https://www.youtube.com/watch?v=OvfIneIoAWw",
          targetUrl: "https://www.youtube.com/watch?v=OvfIneIoAWw",
          toneOverride: { anger: 1, comedy: 3, subversion: 3, hope: 1, energy: 3 },
          sourceImageUrl: "https://i.ytimg.com/vi/OvfIneIoAWw/maxresdefault.jpg" },
        { category: "SPREAD POSITIVITY", categoryColor: "#d97706",
          title: `Share "Take Me Home, Epstein Files" — John Denver Country-Roads Trump Parody`,
          description: `Patrick Fitzgerald's wistful Country-Roads recut about the Epstein Files Trump refuses to release. Less screaming, more wholesome Appalachian guilt — engineered to stick in MAGA brains for days.`,
          authorName: "Patrick Fitzgerald (Parody Project)", authorRole: "Independent creator",
          authorLink: "https://youtu.be/i9us52Edntw",
          targetUrl: "https://youtu.be/i9us52Edntw",
          toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 },
          sourceImageUrl: "https://i.ytimg.com/vi/i9us52Edntw/maxresdefault.jpg" },

        // ── TikTok creators (2) — image-less; JS-rendered ──
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Follow @justtryingtohackett on TikTok — Resistance Craftivism Community`,
          description: `TikTok's most active anti-Trump craftivism account: she runs book-club picks, raffles tied to community-org donations, and weekly "John Lewis necessary trouble" stitching prompts for the resistance.`,
          authorName: "Just Trying to Hackett (Independent)", authorRole: "TikTok creator",
          authorLink: "https://www.tiktok.com/@justtryingtohackett",
          targetUrl: "https://www.tiktok.com/@justtryingtohackett",
          toneOverride: { anger: 1, comedy: 2, subversion: 2, hope: 3, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Take Action with Spellbound Stitchery's Donate-to-Enter Craftivism Raffles`,
          description: `Cross-stitch and needlepoint creator running raffles where entries are earned via donations to anti-Trump and immigrant-defense community orgs. Slow stitches, fast subversion — and your money goes to the front lines.`,
          authorName: "Spellbound Stitchery (Independent)", authorRole: "TikTok creator",
          authorLink: "https://www.tiktok.com/@spellboundstitchery",
          targetUrl: "https://www.tiktok.com/@spellboundstitchery",
          toneOverride: { anger: 0, comedy: 1, subversion: 2, hope: 3, energy: 1 } },
      ];

      async function importImage2(srcUrl: string): Promise<string> {
        try {
          const res = await fetch(srcUrl, { headers: { "User-Agent": "Mozilla/5.0 ResistActMigration" } });
          if (!res.ok) { console.log(`Image fetch ${res.status} for ${srcUrl}`); return srcUrl; }
          const contentType = res.headers.get("content-type") ?? "image/jpeg";
          const buf = await res.arrayBuffer();
          const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : contentType.includes("gif") ? "gif" : "jpg";
          const key = `creators-batch2-${crypto.randomUUID()}.${ext}`;
          const supabase = adminClient();
          const BUCKET = "action-images";
          const { error: upErr } = await supabase.storage.from(BUCKET).upload(key, buf, { contentType, upsert: false });
          if (upErr) { console.log(`Image upload failed for ${srcUrl}:`, upErr.message); return srcUrl; }
          const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(key);
          return urlData.publicUrl;
        } catch (err) {
          console.log(`Image error for ${srcUrl}:`, err);
          return srcUrl;
        }
      }

      const currentIds2 = ((await kv.get("user-action:ids")) ?? []) as number[];
      const base2 = Math.max(...(currentIds2.length ? currentIds2 : [1305]), 1305);
      const now2 = new Date().toISOString();
      const cards2: any[] = [];
      for (let i = 0; i < incoming2.length; i++) {
        const c = incoming2[i];
        const topImageUrl = c.sourceImageUrl ? await importImage2(c.sourceImageUrl) : undefined;
        cards2.push({
          id: base2 + 1 + i,
          category: c.category,
          categoryColor: c.categoryColor,
          actionType: c.actionType ?? "Online",
          isOnline: c.isOnline ?? true,
          timeCommitment: "5–10 minutes",
          title: c.title,
          description: c.description,
          spotsTotal: "Unlimited",
          boosts: 0,
          authorName: c.authorName,
          authorRole: c.authorRole,
          authorLink: c.authorLink,
          targetUrl: c.targetUrl,
          ...(c.location ? { location: c.location } : {}),
          ...(topImageUrl ? { topImageUrl } : {}),
          toneOverride: c.toneOverride,
          adminApproved: true,
          createdAt: now2,
        });
      }
      const placed2 = await appendUserActionCards(cards2);
      await setMigrationFlag("migration:creators-import-2026-05-batch2:v1");
      console.log(`Creators batch 2 import: added ${placed2.length} cards (ids ${placed2.join(", ")}).`);
    }

    // Fix search-style targetUrls on 4 regional event cards. Originally
    // imported with mobilize.us search-results URLs (effectively useless as
    // an action link); update to each org's actual Mobilize organizer page.
    const fixRegionalUrlsDone = await getMigrationFlag("migration:fix-regional-search-urls:v1");
    if (!fixRegionalUrlsDone) {
      const updates: Record<number, string> = {
        2150: "https://www.mobilize.us/commoncause/",
        2151: "https://www.mobilize.us/swindivisibleresistance/",
        2152: "https://www.mobilize.us/southsnohomishcountyindivisible/",
        2156: "https://www.mobilize.us/indivisibleyolo/",
      };
      let updated = 0;
      for (const [idStr, url] of Object.entries(updates)) {
        const id = Number(idStr);
        const existing = await kv.get(`user-action:${id}`) as any;
        if (existing && typeof existing === "object") {
          await kv.set(`user-action:${id}`, { ...existing, targetUrl: url, authorLink: url });
          updated++;
        }
      }
      await setMigrationFlag("migration:fix-regional-search-urls:v1");
      console.log(`Fixed regional search URLs: updated ${updated} cards.`);
    }

    // Fix Yarn Sisters card (2130) — Facebook search URL replaced with the
    // Guardian's craft topic page (where the "Weapons of Mass Construction"
    // craftivism feature lives).
    const fixYarnSistersDone = await getMigrationFlag("migration:fix-yarn-sisters-url:v1");
    if (!fixYarnSistersDone) {
      const url = "https://www.theguardian.com/lifeandstyle/craft";
      const existing = await kv.get("user-action:2130") as any;
      if (existing && typeof existing === "object") {
        await kv.set("user-action:2130", { ...existing, targetUrl: url, authorLink: url });
      }
      await setMigrationFlag("migration:fix-yarn-sisters-url:v1");
      console.log(`Fixed Yarn Sisters URL on card 2130.`);
    }

    // Dedup the portland-seattle-yolo race: ids 2153/2154/2155 are duplicates
    // of 2150/2151/2152 (Knit/STARVE/Singing) — two function instances both
    // ran the import before either set the gate. Delete the higher ids.
    const dedupPSYDone = await getMigrationFlag("migration:dedup-psy-race:v1");
    if (!dedupPSYDone) {
      const idsToRemove = [2153, 2154, 2155];
      for (const id of idsToRemove) {
        await kv.del(`user-action:${id}`);
      }
      const currentIds = ((await kv.get("user-action:ids")) ?? []) as number[];
      await kv.set("user-action:ids", currentIds.filter((id) => !idsToRemove.includes(id)));
      await setMigrationFlag("migration:dedup-psy-race:v1");
      console.log(`Dedup PSY race: removed ${idsToRemove.length} duplicate cards.`);
    }

    // Portland/Seattle/Yolo regional event import — 4 cards. All in-person
    // events at mobilize.us search URLs (no stable og:image), so they land
    // adminApproved=false for the admin queue. Race-safer pattern: dedup
    // against existing user-action records by lowercase title + targetUrl,
    // per-card kv.get existence check before insert, and a re-read-then-union
    // write to user-action:ids so concurrent runs can't drop or duplicate ids.
    const portlandSeattleYoloDone = await getMigrationFlag("migration:portland-seattle-yolo-import-2026-05:v1");
    if (!portlandSeattleYoloDone) {
      type RegionalCard = {
        category: string;
        categoryColor: string;
        title: string;
        description: string;
        location: string;
        authorName: string;
        authorRole: string;
        targetUrl: string;
        toneOverride: { anger: number; comedy: number; subversion: number; hope: number; energy: number };
        amplifiesGroups?: string[];
      };
      const incomingRegional: RegionalCard[] = [
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Knit in Protest of ICE — Portland`,
          description: `Bring your needles and your fury to Common Cause Oregon's Knitting in Protest of ICE — a quiet, weekly visibility action outside the Portland federal building where knitters glare at Trump's deportation machine while making hats for detained families. Funny, hands-busy, low-confrontation, high-photo-op.`,
          location: "Oregon",
          authorName: "Common Cause Oregon", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/?q=ICE+raid",
          toneOverride: { anger: 2, comedy: 3, subversion: 2, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
        },
        { category: "PROTEST", categoryColor: "#23297e",
          title: `STARVE FASCISM — Portland`,
          description: `SW Indivisible Resistance's blunt-named Saturday rally (May 30, Portland) targeting Trump-administration funding flows: divest, boycott Trump-friendly corporates, cut off Project 2025 donors. Big sign-painting party an hour before kickoff.`,
          location: "Oregon",
          authorName: "SW Indivisible Resistance", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/?q=ICE+raid",
          toneOverride: { anger: 3, comedy: 2, subversion: 3, hope: 2, energy: 3 },
        },
        { category: "ART PIECE", categoryColor: "#896312",
          title: `Singing Resistance in Edmonds (WA)`,
          description: `South Snohomish County Indivisible hosts a monthly Singing Resistance — anti-Trump protest songs on a downtown sidewalk, Mon Jun 8 at 4pm. Bring kazoos, bring lyric sheets, bring grandma. Local, joyful, irritating to the right people.`,
          location: "Washington",
          authorName: "South Snohomish County Indivisible", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/?q=ICE",
          toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 3, energy: 2 },
        },
        { category: "PROTEST", categoryColor: "#23297e",
          title: `Disappeared in America Visibility Event — Yolo CA`,
          description: `Indivisible Yolo's first-Wednesday-of-the-month silent vigil naming and showing photos of people the Trump-Biden ICE pipeline has disappeared into detention. Woodland and West Sacramento locations. Bring a printed name card from the linked spreadsheet.`,
          location: "California",
          authorName: "Indivisible Yolo", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/?q=deportation",
          toneOverride: { anger: 2, comedy: 0, subversion: 3, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
        },
      ];

      // Dedup against existing user-action:* records by (lowercase trimmed title) and targetUrl.
      const existingPS = (await kv.getByPrefix("user-action:")) as any[];
      const seenTitlesPS = new Set<string>();
      const seenUrlsPS = new Set<string>();
      for (const c of existingPS) {
        if (!c || typeof c !== "object") continue;
        if (typeof c.title === "string") seenTitlesPS.add(c.title.toLowerCase().trim());
        if (typeof c.targetUrl === "string") seenUrlsPS.add(c.targetUrl);
      }
      const freshPS = incomingRegional.filter((c) =>
        !seenTitlesPS.has(c.title.toLowerCase().trim())
      );

      const currentIdsPS = ((await kv.get("user-action:ids")) ?? []) as number[];
      const startIdPS = Math.max(...currentIdsPS, 1305) + 1;
      const nowPS = new Date().toISOString();
      const cardsPS = freshPS.map((c, i) => ({
        id: startIdPS + i,
        category: c.category,
        categoryColor: c.categoryColor,
        actionType: "In Person Group",
        isOnline: false,
        timeCommitment: "1–3 hours",
        title: c.title,
        description: c.description,
        location: c.location,
        spotsTotal: "Unlimited",
        boosts: 0,
        authorName: c.authorName,
        authorRole: c.authorRole,
        authorLink: c.targetUrl,
        targetUrl: c.targetUrl,
        toneOverride: c.toneOverride,
        ...(c.amplifiesGroups ? { amplifiesGroups: c.amplifiesGroups } : {}),
        adminApproved: false,
        createdAt: nowPS,
      }));
      const placedPS = await appendUserActionCards(cardsPS);
      await setMigrationFlag("migration:portland-seattle-yolo-import-2026-05:v1");
      console.log(`Portland/Seattle/Yolo regional import: added ${placedPS.length} cards (ids ${placedPS.join(", ")}).`);
    }

    // Retroactive sweep: demote any approved card missing a targetUrl OR an
    // image (no topImageUrl + no topImageKey + no topImage). Skips pinToTop
    // cards so the Spread-the-Word pin can't be accidentally demoted. Cards
    // already adminApproved=false are left alone (they're already in the queue).
    const demoteMissingDone = await getMigrationFlag("migration:demote-missing-url-or-image:v1");
    if (!demoteMissingDone) {
      let demoted = 0;
      const sample: string[] = [];
      for (const prefix of ["action:", "user-action:"]) {
        for (const c of (await kv.getByPrefix(prefix)) as any[]) {
          if (!c || typeof c !== "object" || typeof c.id !== "number") continue;
          if (c.adminApproved === false) continue;
          if (c.pinToTop) continue;
          const hasUrl = Boolean(c.targetUrl);
          const hasImage = Boolean(c.topImageUrl) || Boolean(c.topImageKey) || Boolean(c.topImage);
          if (hasUrl && hasImage) continue;
          await kv.set(`${prefix}${c.id}`, { ...c, adminApproved: false });
          demoted++;
          if (sample.length < 20) sample.push(`${prefix}${c.id} (url:${hasUrl},img:${hasImage})`);
        }
      }
      await setMigrationFlag("migration:demote-missing-url-or-image:v1");
      console.log(`Demote missing url/image: demoted ${demoted} cards. Sample: ${sample.join("; ")}`);
    }

    // One-time: import 16 Etsy/Bluesky/TikTok creator-shop cards. 4 have
    // source images we can fetch (Bluesky public API + CrimethInc CDN); the
    // other 12 land without a header image (Etsy 429s scrapers, TikTok needs
    // JS, Facebook search URL has no stable asset) and need images attached
    // via Admin → Edit. All inserted with adminApproved=true.
    const etsyCreatorsImportDone = await getMigrationFlag("migration:etsy-creators-import-2026-05:v1");
    if (!etsyCreatorsImportDone) {
      type NewCard = {
        category: string;
        categoryColor: string;
        title: string;
        description: string;
        authorName: string;
        authorRole: string;
        authorLink: string;
        targetUrl: string;
        toneOverride: { anger: number; comedy: number; subversion: number; hope: number; energy: number };
        sourceImageUrl?: string;
      };
      const incoming: NewCard[] = [
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Wear the "No Kings" Anti-Trump Protest Pin Button Set`,
          description: `Pack of anti-fascism "No Kings" pin buttons from indie Etsy shop CraftedVibeStudioCo — wear them stacked on a jacket or hand them out at the next visibility brigade.`,
          authorName: "CraftedVibeStudioCo", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/CraftedVibeStudioCo",
          targetUrl: "https://www.etsy.com/listing/4505083806/anti-trump-protest-pin-button-set",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 2, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Slap FendywitchDesigns' witchy "MAGA Parody" anti-Trump vinyl sticker on everything`,
          description: `Hand-drawn parody sticker mocking MAGA from a witchy/pagan/environmentalist angle — sticks on laptops, water bottles, lamp posts, your neighbor's mailbox.`,
          authorName: "FendywitchDesigns", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/FendywitchDesigns",
          targetUrl: "https://www.etsy.com/listing/742494439/maga-parody-vinyl-sticker-anti-trump",
          toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Sport the "Is He Dead Yet?" Black Cat Dad Hat (subtle FDT)`,
          description: `Deadpan grumpy-cat dad hat reading "Is He Dead Yet?" — a sotto-voce FDT statement disguised as a cat hat, wearable at family dinners and PTA meetings alike.`,
          authorName: "ElifGiftsUs", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/ElifGiftsUs",
          targetUrl: "https://www.etsy.com/listing/4506217910/is-he-dead-yet-black-cat-hat-anti-trump",
          toneOverride: { anger: 3, comedy: 3, subversion: 3, hope: 1, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Pin a "Stop Project 2025" 1.25" Button or Magnet`,
          description: `Tiny but mighty 1.25-inch button or magnet calling out Project 2025 — pin it on your tote, stick it on your fridge, hand them out at neighborhood meetings.`,
          authorName: "ButtonRepublic", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/ButtonRepublic",
          targetUrl: "https://www.etsy.com/listing/1856171148/stop-project-2025-pin-anti-trump",
          toneOverride: { anger: 2, comedy: 0, subversion: 2, hope: 2, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Stick an "ICE OUT" Magnet or Bumper Decal on your car`,
          description: `Bold "ICE OUT" car magnet / bumper sticker calling for ICE abolition under Trump — turns every traffic jam into a visibility action.`,
          authorName: "DaisyBlueDesignsCo", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/DaisyBlueDesignsCo",
          targetUrl: "https://www.etsy.com/listing/4442526838/ice-out-magnet-or-decal-anti-ice-protest",
          toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 1, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Wear the "No Kings — Republican Oligarchy" Anti-MAGA Pin`,
          description: `Bold "No Kings / Republican Oligarchy" resist button — a conversation-starter at school pickup, the office, or the next protest line.`,
          authorName: "BewitchingBetties", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/BewitchingBetties",
          targetUrl: "https://www.etsy.com/listing/4329164263/no-kings-button-pin-anti-trump-pin",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 2, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Order a Subversive Cross-Stitch Kit from Hartford Yarn Works`,
          description: `Hartford Yarn Works just restocked their subversive cross-stitch kits (plus their book and new styles) — turn rage at Trump/MAGA into hours of meditative stabby thread-work.`,
          authorName: "Hartford Yarn Works", authorRole: "Independent shop",
          authorLink: "https://bsky.app/profile/hartfordyarnworks.bsky.social",
          targetUrl: "https://hartfordyarnworks.com/",
          toneOverride: { anger: 2, comedy: 2, subversion: 3, hope: 2, energy: 2 } },
        { category: "SOCIAL MEDIA", categoryColor: "#e44b4b",
          title: `Boost Eric Champnella's "Donny / 8647 Ain't a Crime" Trump parody song`,
          description: `Eric Champnella's parody of Tommy Tutone's "Jenny/867-5309" recasts it as "Donny / 8647 Ain't a Crime" — a singable response to Trump DOJ's bogus seashell charges against Comey. Reshare widely.`,
          authorName: "Eric Champnella", authorRole: "Bluesky creator",
          authorLink: "https://bsky.app/profile/echamp.bsky.social",
          targetUrl: "https://bsky.app/profile/echamp.bsky.social",
          toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 },
          sourceImageUrl: "https://cdn.bsky.app/img/banner/plain/did:plc:aixsk56es7lwhmva54ghdqdi/bafkreihjgwu6jssrvn6zvjvb5baphrgofnzjoz2hm3aduxsjfl5getozcq" },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Print + share Emily K's "One Simple Act" anti-fascism zine`,
          description: `Artist Emily K's printable zine "One Simple Act" gives concrete small steps for resisting fascism — print at home, fold, leave stacks in coffee shops, laundromats, and libraries.`,
          authorName: "Art by Emily K", authorRole: "Bluesky creator",
          authorLink: "https://bsky.app/profile/museum.of.emilyk.art",
          targetUrl: "https://bsky.app/profile/museum.of.emilyk.art",
          toneOverride: { anger: 1, comedy: 1, subversion: 3, hope: 3, energy: 2 },
          sourceImageUrl: "https://cdn.bsky.app/img/banner/plain/did:plc:l2bvlovg53aahtytp32r7mqe/bafkreih2ijenpyxetgtwo6z6zzagw5tqjedegymcqlelpjkbkkgilgr63i" },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Print + distribute CrimethInc's Security Culture zine for the Trump era`,
          description: `CrimethInc's printable zine on security culture for activists organizing under Trump's pledged federal-agency attacks on anti-fascists — print, staple, leave in spaces where organizers gather.`,
          authorName: "CrimethInc. Ex-Workers' Collective", authorRole: "Bluesky creator",
          authorLink: "https://bsky.app/profile/crimethinc.com",
          targetUrl: "https://crimethinc.com/zines",
          toneOverride: { anger: 2, comedy: 1, subversion: 3, hope: 2, energy: 2 },
          sourceImageUrl: "https://cdn.crimethinc.com/assets/share/crimethinc-site-share.png" },
        { category: "ART/PERFORMANCE ART", categoryColor: "#896312",
          title: `Boost First Amendment Troop's "ResistDance" Lincoln Memorial / Kennedy Center protest dance`,
          description: `Twelve teen dancers staged "ResistDance" / "Resistadance vs Redaction" at the Lincoln Memorial and Kennedy Center — leotards displayed Jane Doe 4's Epstein-file testimony as protest against Trump-era redactions. Share the TikTok.`,
          authorName: "First Amendment Troop", authorRole: "TikTok creator",
          authorLink: "https://www.tiktok.com/@firstamendmenttroop",
          targetUrl: "https://www.tiktok.com/@firstamendmenttroop",
          toneOverride: { anger: 3, comedy: 1, subversion: 3, hope: 3, energy: 3 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Stitch along with The Morning Crafter's free anti-Trump-era craftivism patterns`,
          description: `@the_morningcrafter releases free craftivism patterns on TikTok (kept off Etsy, free on her site) for people compelled to make things while resisting Trump.`,
          authorName: "The Morning Crafter", authorRole: "TikTok creator",
          authorLink: "https://www.tiktok.com/@the_morningcrafter",
          targetUrl: "https://www.tiktok.com/@the_morningcrafter",
          toneOverride: { anger: 1, comedy: 2, subversion: 2, hope: 3, energy: 2 } },
        { category: "SPREAD POSITIVITY", categoryColor: "#d97706",
          title: `Share This Hour Has 22 Minutes' "A New Book by Donald Trump" sketch`,
          description: `CBC's This Hour Has 22 Minutes dropped a deadpan sketch-comedy parody of "A New Book by Donald Trump." Reshare to fill a feed with something that lands a laugh AND a punchline.`,
          authorName: "This Hour Has 22 Minutes (CBC)", authorRole: "TikTok creator",
          authorLink: "https://www.tiktok.com/@thishourhas22minutes",
          targetUrl: "https://www.tiktok.com/@thishourhas22minutes",
          toneOverride: { anger: 0, comedy: 3, subversion: 2, hope: 2, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Boost Yarn Sisters / Guardian "Weapons of Mass Construction" anti-Trump craftivism feature`,
          description: `Yarn Sisters' FB community is amplifying the Guardian feature on US craftivists fighting Trump with yarn — embroidered pistols, slogan quilts, knitted protest banners. Share, then pick up a needle.`,
          authorName: "Yarn Sisters (Facebook community)", authorRole: "Facebook community",
          authorLink: "https://www.facebook.com/search/top/?q=craftivism%20trump",
          targetUrl: "https://www.facebook.com/search/top/?q=craftivism%20trump",
          toneOverride: { anger: 1, comedy: 2, subversion: 3, hope: 3, energy: 2 } },
        { category: "ART/PERFORMANCE ART", categoryColor: "#896312",
          title: `Drop a "Tesla T Party" Anti-Musk Protest Banner (Bruce S.'s craftivist template)`,
          description: `Bruce S. (@bmschech.bsky.social) is circulating "Tesla T Party" protest-art and banner-drop visuals tying Musk-DOGE to anti-Trump street action — DIY-replicable for your own bridge or overpass.`,
          authorName: "Bruce S. / ActivistArt", authorRole: "Bluesky creator",
          authorLink: "https://bsky.app/profile/bmschech.bsky.social",
          targetUrl: "https://bsky.app/profile/bmschech.bsky.social",
          toneOverride: { anger: 2, comedy: 2, subversion: 3, hope: 2, energy: 2 },
          sourceImageUrl: "https://cdn.bsky.app/img/avatar/plain/did:plc:ptzl2hqpetxgk2xnudzsbiim/bafkreibqplcarfena2hbirjlrh47jeiav3gj3ws5cc6cmojh27xnrq2isu" },
        { category: "SPREAD POSITIVITY", categoryColor: "#d97706",
          title: `Reshare Tom Morello's "This Land is Your Land" at Hands Off NYC anti-ICE protest`,
          description: `Tom Morello covered Woody Guthrie's "This Land is Your Land" at a Hands Off NYC protest against Trump-era ICE abuses targeting immigrant New Yorkers — share the clip as a singalong for your own local action.`,
          authorName: "Consequence / Tom Morello", authorRole: "TikTok creator",
          authorLink: "https://www.tiktok.com/@consequence",
          targetUrl: "https://www.tiktok.com/@consequence",
          toneOverride: { anger: 2, comedy: 0, subversion: 2, hope: 3, energy: 3 } },
      ];

      // Helper: fetch external image, upload to the action-images bucket, return
      // the stable Supabase public URL. Falls back to the external URL on error
      // so the card still shows *something* — admin can re-upload via Edit.
      async function importImage(srcUrl: string): Promise<string> {
        try {
          const res = await fetch(srcUrl, { headers: { "User-Agent": "Mozilla/5.0 ResistActMigration" } });
          if (!res.ok) { console.log(`Image fetch ${res.status} for ${srcUrl}`); return srcUrl; }
          const contentType = res.headers.get("content-type") ?? "image/jpeg";
          const buf = await res.arrayBuffer();
          const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : contentType.includes("gif") ? "gif" : "jpg";
          const key = `etsy-creators-import-${crypto.randomUUID()}.${ext}`;
          const supabase = adminClient();
          const BUCKET = "action-images";
          const { error: upErr } = await supabase.storage.from(BUCKET).upload(key, buf, { contentType, upsert: false });
          if (upErr) { console.log(`Image upload failed for ${srcUrl}:`, upErr.message); return srcUrl; }
          const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(key);
          return urlData.publicUrl;
        } catch (err) {
          console.log(`Image error for ${srcUrl}:`, err);
          return srcUrl;
        }
      }

      const currentIds = ((await kv.get("user-action:ids")) ?? []) as number[];
      const base = Math.max(...(currentIds.length ? currentIds : [1305]), 1305);
      const nowIso = new Date().toISOString();
      const cardsEtsy: any[] = [];
      for (let i = 0; i < incoming.length; i++) {
        const c = incoming[i];
        const topImageUrl = c.sourceImageUrl ? await importImage(c.sourceImageUrl) : undefined;
        cardsEtsy.push({
          id: base + 1 + i,
          category: c.category,
          categoryColor: c.categoryColor,
          actionType: "Online",
          isOnline: true,
          timeCommitment: "5–10 minutes",
          title: c.title,
          description: c.description,
          spotsTotal: "Unlimited",
          boosts: 0,
          authorName: c.authorName,
          authorRole: c.authorRole,
          authorLink: c.authorLink,
          targetUrl: c.targetUrl,
          ...(topImageUrl ? { topImageUrl } : {}),
          toneOverride: c.toneOverride,
          // Only auto-approve if we actually resolved an image. Image-less
          // cards must go through the manual Admin → Edit → upload-image →
          // Approve flow, same as any other pending card. This makes the
          // migration safe to re-run on a fresh KV without recreating the
          // approved-without-image situation.
          adminApproved: !!topImageUrl,
          createdAt: nowIso,
        });
      }
      const placedEtsy = await appendUserActionCards(cardsEtsy);
      await setMigrationFlag("migration:etsy-creators-import-2026-05:v1");
      console.log(`Etsy creators import: added ${placedEtsy.length} cards (ids ${placedEtsy.join(", ")}).`);
    }

    // One-time: defensive cleanup for approved-without-image cards.
    //
    // The etsy-creators import on 2026-05 hard-coded adminApproved=true for
    // all 25 cards, including 12 that landed without a header image (Etsy
    // 429s scrapers, TikTok needs JS, etc). The approval-time image gate in
    // /admin/approve-action/:id was bypassed because those cards were
    // written directly to KV from inside the migration.
    //
    // This migration walks every action:* and user-action:* record and, for
    // any record with adminApproved=true but no topImage* field, flips
    // adminApproved back to false so the card re-appears in Admin → Pending.
    // From there an admin can upload an image and approve through the proper
    // gate, or delete the card.
    //
    // The PUT-leak and migration source-code holes are closed in this same
    // release, so this cleanup is one-shot — bad state can't recur.
    const approvedNoImageCleanupDone = await getMigrationFlag("migration:approved-without-image-cleanup:v1");
    if (!approvedNoImageCleanupDone) {
      let flipped = 0;
      const flippedIds: number[] = [];
      for (const prefix of ["action:", "user-action:"]) {
        for (const c of (await kv.getByPrefix(prefix)) as any[]) {
          if (!c || typeof c !== "object" || typeof c.id !== "number") continue;
          if (c.adminApproved !== true) continue;
          const hasImage = Boolean(c.topImageUrl) || Boolean(c.topImageKey) || Boolean(c.topImage);
          if (hasImage) continue;
          await kv.set(`${prefix}${c.id}`, { ...c, adminApproved: false });
          flipped++;
          flippedIds.push(c.id);
        }
      }
      await setMigrationFlag("migration:approved-without-image-cleanup:v1");
      console.log(`Approved-without-image cleanup: flipped ${flipped} cards back to pending. IDs: ${flippedIds.join(", ")}`);
    }

    // One-time: import a curated batch from the 2026-05-17 TSV scout output.
    //
    // Source: 27-row spreadsheet of Indivisible / Mobilize / Pol-Rev / Etsy
    // candidates. Manually filtered against existing seed-card URLs and
    // the rules "direct campaign link, harvestable og:image, authorLink ≠
    // targetUrl, no dupes." 20 of the 27 rows were rejected at this stage
    // (existing-card URL collision, homepage-only links, or source_url
    // identical to targetUrl). The surviving 7 rows had their og:image
    // harvested on 2026-05-17 via raw HTML scrape — links below are the
    // live og:image URLs at that scrape time.
    //
    // Cards land with adminApproved=false so they surface in Admin → Pending
    // for one-click approval (which will pass the image gate because we set
    // topImageUrl). The existingUrls pre-check is belt-and-suspenders against
    // URL collision even though we hand-verified.
    const tsvBatch2026May17Done = await getMigrationFlag("migration:tsv-batch-2026-05-17:v1");
    if (!tsvBatch2026May17Done) {
      type TsvCard = {
        category: string;
        categoryColor: string;
        title: string;
        description: string;
        targetUrl: string;
        topImageUrl: string;
        authorName: string;
        authorRole: string;
        authorLink: string;
        isOnline: boolean;
        actionType: string;
        location?: string;
        eventDate?: string;
        toneOverride: { anger: number; comedy: number; subversion: number; hope: number; energy: number };
        amplifiesGroups?: string[];
        timeCommitment?: string;
      };
      const tsvIncoming: TsvCard[] = [
        // Row 2 — Indivisible call to block insurrection slush fund
        { category: "PETITION", categoryColor: "#05737f",
          title: "Tell Senators to Block Trump's $1.8B Insurrection Slush Fund",
          description: "Indivisible call-tool: tell your senator to block Trump's $1.8 billion proposal to pay out the Jan 6 insurrectionists. 5-minute call script with your reps' direct lines.",
          targetUrl: "https://indivisible.org/actions/senate-no-payouts-for-insurrectionists/",
          topImageUrl: "https://indivisible.org/wp-content/uploads/2026/05/260522_No-Payouts-for-Insurrectionists_1.jpg",
          authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/",
          isOnline: true, actionType: "Online", timeCommitment: "5–10 minutes",
          toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 2, energy: 2 } },
        // Row 6 — Indivisible petition to end Trump's Cuba blockade
        { category: "PETITION", categoryColor: "#05737f",
          title: "Demand Your Senator End Trump's Blockade on Cuba",
          description: "Indivisible call script targeting Trump's tightened Cuba blockade — humanitarian crisis Trump created by reversing Biden-era easements. 4-minute action.",
          targetUrl: "https://indivisible.org/actions/demand-your-senator-end-trumps-blockade-on-cuba/",
          topImageUrl: "https://indivisible.org/wp-content/uploads/2026/05/250519_End-Trump-s-Blockade-on-Cuba_3.png",
          authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/",
          isOnline: true, actionType: "Online", timeCommitment: "5–10 minutes",
          toneOverride: { anger: 2, comedy: 0, subversion: 1, hope: 2, energy: 2 } },
        // Row 8 — Seattle Indivisible NO WAR. NO KINGS rally
        { category: "PROTEST", categoryColor: "#23297e",
          title: "NO WAR. NO KINGS: U Village — Seattle (May 30)",
          description: "Seattle Indivisible's Saturday anti-Trump / anti-Iran-war visibility action at University Village. Recurring NO KINGS protest series targeting Trump's executive overreach.",
          targetUrl: "https://www.mobilize.us/mobilize/event/822442/",
          topImageUrl: "https://mobilizeamerica.imgix.net/uploads/event/Image_20260304193116846523.jpeg?w=1200&h=628&fit=crop&bg=FFF",
          authorName: "Seattle Indivisible", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/",
          isOnline: false, actionType: "In Person Group", location: "Washington", eventDate: "2026-05-30",
          toneOverride: { anger: 2, comedy: 1, subversion: 1, hope: 3, energy: 3 } },
        // Row 9 — Southend Indivisible ICE HQ Tukwila visibility action
        { category: "PROTEST", categoryColor: "#23297e",
          title: "Protest ICE Terror at ICE HQ — Tukwila WA (May 29)",
          description: "Southend Indivisible's Friday-morning visibility action outside ICE Seattle HQ in Tukwila, targeting Trump's deportation surge and the ICE office expansion in WA.",
          targetUrl: "https://www.mobilize.us/mobilize/event/944899/",
          topImageUrl: "https://mobilizeamerica.imgix.net/uploads/event/IMG_5533%20%281%29_20260203035337181451.jpeg?w=1200&h=628&fit=crop&bg=FFF",
          authorName: "Southend Indivisible", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/",
          isOnline: false, actionType: "In Person Group", location: "Washington", eventDate: "2026-05-29",
          toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 2, energy: 3 }, amplifiesGroups: ["immigrant"] },
        // Row 14 — Tesla Takedown Boston combined rally
        { category: "PROTEST", categoryColor: "#23297e",
          title: "Trump Takedown — Boston (Jun 13)",
          description: "Tesla Takedown Boston's June 13 in-person action combining Tesla Takedown, Trump Takedown, and No Kings messaging into a single anti-Musk/anti-Trump rally.",
          targetUrl: "https://events.pol-rev.com/events/7fa8eece-013c-4d77-a25f-3f2a87f27e99",
          topImageUrl: "https://events.pol-rev.com/media/d6798d55fcaf4dcebc496f7a3bdd0ddca7450d85c00c6852ae31942e9b8e9975.png?name=boycott%20tmobile.png",
          authorName: "Tesla Takedown Boston", authorRole: "Movement Organization", authorLink: "https://events.pol-rev.com/",
          isOnline: false, actionType: "In Person Group", location: "Massachusetts", eventDate: "2026-06-13",
          toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 2, energy: 3 } },
        // Row 15 — She Is Me Epstein Files protest walk interest meeting
        { category: "MEETING", categoryColor: "#5a3e9e",
          title: "Interest Meeting for Epstein Protest Walk DC (Jun 10)",
          description: "She Is Me's interest meeting for a planned Epstein Files protest walk in DC, targeting Trump's refusal to release the Epstein client list. Camden County NJ for the meeting.",
          targetUrl: "https://events.pol-rev.com/events/308acc70-547b-4c1b-a606-0584dee69852",
          topImageUrl: "https://events.pol-rev.com/media/16de76e41e2952aca18f20568acba37d294065efaa514b9e7e4357b4b8c18183.jpg?name=1000002421.jpg",
          authorName: "She Is Me", authorRole: "Movement Organization", authorLink: "https://events.pol-rev.com/",
          isOnline: false, actionType: "In Person Group", location: "New Jersey", eventDate: "2026-06-10",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 2, energy: 2 } },
        // Row 21 — Resist And Defend banner drop Corte Madera
        { category: "PROTEST", categoryColor: "#23297e",
          title: "Protect Immigrants Banner Drop — Corte Madera CA (May 28)",
          description: "Resist And Defend's Thursday-afternoon banner-drop action over a Corte Madera overpass — fast, high-visibility anti-Trump-deportation signage for commuter eyes.",
          targetUrl: "https://www.mobilize.us/mobilize/event/933855/",
          topImageUrl: "https://mobilizeamerica.imgix.net/uploads/event/tamalpais_20260406004508465116.jpg?w=1200&h=628&fit=crop&bg=FFF",
          authorName: "Resist And Defend", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/",
          isOnline: false, actionType: "In Person Group", location: "California", eventDate: "2026-05-28",
          toneOverride: { anger: 2, comedy: 0, subversion: 2, hope: 2, energy: 3 }, amplifiesGroups: ["immigrant"] },
      ];

      // Build a set of every existing card URL across both stores so we can
      // skip any TSV row whose targetUrl already lives in the catalog. This
      // is belt-and-suspenders — we hand-checked when assembling the list.
      const existingUrls = new Set<string>();
      for (const prefix of ["action:", "user-action:"]) {
        for (const c of (await kv.getByPrefix(prefix)) as any[]) {
          if (c && typeof c === "object" && typeof c.targetUrl === "string") {
            existingUrls.add(normalizeBulkImportUrl(c.targetUrl));
          }
        }
      }

      const currentIds = ((await kv.get("user-action:ids")) ?? []) as number[];
      const baseId = Math.max(...(currentIds.length ? currentIds : [1335]), 1335);
      const nowIso = new Date().toISOString();
      const newIds = [...currentIds];
      let added = 0;
      const skippedDupes: string[] = [];

      for (let i = 0; i < tsvIncoming.length; i++) {
        const c = tsvIncoming[i];
        if (existingUrls.has(normalizeBulkImportUrl(c.targetUrl))) {
          skippedDupes.push(c.title);
          continue;
        }
        const id = baseId + 1 + added;
        const card: any = {
          id,
          category: c.category,
          categoryColor: c.categoryColor,
          actionType: c.actionType,
          isOnline: c.isOnline,
          title: c.title,
          description: c.description,
          spotsTotal: "Unlimited",
          boosts: 0,
          authorName: c.authorName,
          authorRole: c.authorRole,
          authorLink: c.authorLink,
          targetUrl: c.targetUrl,
          topImageUrl: c.topImageUrl,
          toneOverride: c.toneOverride,
          ...(c.location ? { location: c.location } : {}),
          ...(c.eventDate ? { eventDate: c.eventDate } : {}),
          ...(c.amplifiesGroups ? { amplifiesGroups: c.amplifiesGroups } : {}),
          ...(c.timeCommitment ? { timeCommitment: c.timeCommitment } : {}),
          // Land as pending so the admin reviews each before going live —
          // the rule we hardened earlier ("bulk-write paths must not auto-
          // approve") applies here too. The approve endpoint's image gate
          // will pass because we set topImageUrl, so this is a one-click
          // approval from Admin → Pending.
          adminApproved: false,
          createdAt: nowIso,
          createdBy: "tsv-batch-2026-05-17",
        };
        await kv.set(`user-action:${id}`, card);
        newIds.push(id);
        added++;
      }

      if (added > 0) {
        await kv.set("user-action:ids", newIds);
      }
      await setMigrationFlag("migration:tsv-batch-2026-05-17:v1");
      console.log(`TSV batch 2026-05-17 import: added ${added} cards.${skippedDupes.length ? ` Skipped (URL dupes): ${skippedDupes.join("; ")}` : ""}`);
    }

    // One-time: bulk-mark "Cancel your …" boycott cards as "5–10 minutes".
    // They were stored as "Ongoing" but the actual cancel step is a few clicks.
    const cancelYour10minDone = await getMigrationFlag("migration:cancel-your-10min:v1");
    if (!cancelYour10minDone) {
      let updated = 0;
      for (const prefix of ["action:", "user-action:"]) {
        for (const c of (await kv.getByPrefix(prefix)) as any[]) {
          if (!c || typeof c !== "object" || typeof c.id !== "number") continue;
          if (typeof c.title !== "string") continue;
          if (!/^cancel your/i.test(c.title)) continue;
          await kv.set(`${prefix}${c.id}`, { ...c, timeCommitment: "5–10 minutes" });
          updated++;
        }
      }
      await setMigrationFlag("migration:cancel-your-10min:v1");
      console.log(`Cancel-your 10-min migration: updated ${updated} cards.`);
    }

    // Seed The Smacks receipts. Bump the version key whenever SEED_RECEIPTS changes.
    const receiptsSeeded = await getMigrationFlag("seed:receipts:v2");
    if (!receiptsSeeded) {
      await setMigrationFlag("seed:receipts:v2");
      const existingIds = ((await kv.get("receipt:ids")) ?? []) as number[];
      const idSet = new Set(existingIds);
      const newIds = [...existingIds];
      for (const r of SEED_RECEIPTS) {
        const existing = (await kv.get(`receipt:${r.id}`)) as any;
        const merged: any = { boosts: 0, createdAt: new Date().toISOString(), ...r };
        if (existing && typeof existing === "object") {
          if (typeof existing.boosts === "number") merged.boosts = existing.boosts;
        }
        await kv.set(`receipt:${r.id}`, merged);
        if (!idSet.has(r.id)) { idSet.add(r.id); newIds.push(r.id); }
      }
      await kv.set("receipt:ids", newIds);
      console.log(`Seeded ${SEED_RECEIPTS.length} receipts into The Smacks.`);
    }

    // One-time: add three Common Cause actions as approved user-action cards.
    const commonCauseDone = await getMigrationFlag("migration:common-cause-actions:v1");
    if (!commonCauseDone) {
      const currentIds = ((await kv.get("user-action:ids")) ?? []) as number[];
      const base = Math.max(...(currentIds.length ? currentIds : [1305]), 1305);
      const now = new Date().toISOString();
      const newCards = [
        {
          id: base + 1,
          category: "PETITION",
          categoryColor: "#05737f",
          actionType: "Online",
          isOnline: true,
          timeCommitment: "5–10 minutes",
          title: "Reject Trump’s “War First, People Last” budget",
          description: "Trump’s $1.5 trillion budget slashes food assistance, healthcare, and education while boosting Pentagon spending. Tell Congress to reject it.",
          spotsTotal: "Unlimited",
          boosts: 0,
          authorName: "Common Cause",
          authorRole: "Movement Organization",
          targetUrl: "https://www.commoncause.org/actions/reject-trumps-1-5-trillion-war-first-people-last-budget/",
          topImageKey: "org_common-cause",
          adminApproved: true,
          createdAt: now,
        },
        {
          id: base + 2,
          category: "PETITION",
          categoryColor: "#05737f",
          actionType: "Online",
          isOnline: true,
          timeCommitment: "5–10 minutes",
          title: "Reject funding for ICE and Trump’s ballroom",
          description: "Congress is being asked to fund mass deportations and Trump’s private ballroom in the same bill. Tell your reps to vote no.",
          spotsTotal: "Unlimited",
          boosts: 0,
          authorName: "Common Cause",
          authorRole: "Movement Organization",
          targetUrl: "https://www.commoncause.org/actions/reject-funding-for-ice-and-trumps-ballroom/",
          topImageKey: "org_common-cause",
          adminApproved: true,
          createdAt: now,
        },
        {
          id: base + 3,
          category: "PETITION",
          categoryColor: "#05737f",
          actionType: "Online",
          isOnline: true,
          timeCommitment: "5–10 minutes",
          title: "Tell Congress: block Trump’s mail voting executive order",
          description: "Trump’s executive order targets mail voting — a cornerstone of election access. Urge Congress to push back before this takes effect.",
          spotsTotal: "Unlimited",
          boosts: 0,
          authorName: "Common Cause",
          authorRole: "Movement Organization",
          targetUrl: "https://www.commoncause.org/actions/tell-congress-block-trumps-mail-voting-eo/",
          topImageKey: "org_common-cause",
          adminApproved: true,
          createdAt: now,
          amplifiesGroups: ["voter"],
        },
      ];
      const placedCC = await appendUserActionCards(newCards);
      await setMigrationFlag("migration:common-cause-actions:v1");
      console.log(`Added ${placedCC.length} Common Cause action cards (ids ${placedCC.join(", ")}).`);
    }

    // One-time migration: add local/Mobilize action cards sourced from spreadsheet
    const mobilizeLocalDone = await getMigrationFlag("migration:mobilize-local-actions:v1");
    if (!mobilizeLocalDone) {
      const currentIds = ((await kv.get("user-action:ids")) ?? []) as number[];
      const base = Math.max(...(currentIds.length ? currentIds : [1400]), 1400);
      const now = new Date().toISOString();
      const newCards = [
        {
          id: base + 1,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "1–3 hours",
          title: "Sabey Corp: Cancel Your New ICE Office Lease",
          description: "Trump's $45B ICE expansion requires private landlords to take the contracts — Sabey Corp signed a new Tukwila WA lease. Indivisible Southend rallies outside the property every other Wednesday, 4pm PDT. Show up, make the lease politically toxic.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Southend Indivisible", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/952561/",
          toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 2, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 2,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "1–3 hours",
          title: "Eastside Bucket Drum for Democracy",
          description: "Indivisible Bellevue's weekly Saturday bucket drum protest — bring a 5-gallon bucket and sticks, make noise outside the Bellevue federal-office corridor against Trump regime corruption and ICE escalation.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible Bellevue", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/954905/",
          eventDate: "2026-05-23",
          toneOverride: { anger: 2, comedy: 3, subversion: 2, hope: 2, energy: 3 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 3,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "1–3 hours",
          title: "Federal Building Fridays — Protest Trump Regime",
          description: "Recurring Friday 11:30am PDT protest at the Seattle Federal Building organized by Southend Indivisible. Visibility against Trump-administration corruption, ICE raids, and rule-of-law violations.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Southend Indivisible", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/944909/",
          toneOverride: { anger: 3, comedy: 1, subversion: 1, hope: 2, energy: 2 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 4,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "1–3 hours",
          title: "Good Trouble — John Lewis Bridge #TeslaTakedownTuesday Northgate",
          description: "Tuesday morning 9am PDT Tesla Takedown overpass action at the John Lewis Memorial Bridge in Seattle's Northgate. Anti-Musk-DOGE signage. Pairs Lewis legacy with anti-Trump-administration messaging.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Seattle Indivisible", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/810382/",
          toneOverride: { anger: 2, comedy: 2, subversion: 2, hope: 2, energy: 3 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 5,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Delaware",
          timeCommitment: "1–3 hours",
          title: "Honk and Wave Rallies vs. Trump Regime Corruption — Wilmington DE",
          description: "Indivisible Highlands and Beyond runs a Thursday 4:30pm EDT honk-and-wave rally in Wilmington DE specifically calling out Trump administration corruption, ICE expansion, and authoritarian creep. Low-barrier visibility action.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible Highlands and Beyond", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/950956/",
          toneOverride: { anger: 3, comedy: 1, subversion: 1, hope: 2, energy: 2 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 6,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "California",
          timeCommitment: "1–3 hours",
          title: "Citrus Heights Resists ICE!",
          description: "Sunrise Solidarity + Coalition Against Project 2025 host a Saturday 10am PDT visibility rally in Citrus Heights CA explicitly opposing ICE raids and Project 2025 implementation. Every Saturday.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Sunrise Solidarity / Coalition Against Project 2025", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/892133/",
          toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 2, energy: 3 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 7,
          category: "EMAIL CAMPAIGN", categoryColor: "#c2185b",
          actionType: "Online", isOnline: true,
          timeCommitment: "5–10 minutes",
          title: "Sign up for Washington for All's ICE Mobilization Alerts",
          description: "Washington Indivisible Network's text/email alert list — 12,000+ supporters get pinged when ICE moves in Washington State so volunteers can deploy as legal observers and family-notification callers against Trump's mass deportation operation.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Washington Indivisible Network", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/868208/",
          toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 8,
          category: "MEETING", categoryColor: "#5a3e9e",
          actionType: "In Person Group", isOnline: false, location: "Illinois",
          timeCommitment: "1–3 hours",
          title: "BloNo IL — Shut the Flock Off In-Person Meeting",
          description: "Bloomington-Normal organizing meeting to campaign against Flock ALPR camera-surveillance network that Trump-administration ICE uses for warrantless tracking. Anti-surveillance organizing as direct counter-infrastructure to deportation raids.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Shut The Flock Off BLoNo/MC", authorRole: "Movement Organization",
          targetUrl: "https://events.pol-rev.com/",
          eventDate: "2026-05-20",
          toneOverride: { anger: 3, comedy: 1, subversion: 3, hope: 2, energy: 2 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 9,
          category: "JOIN A GROUP", categoryColor: "#9c2779",
          actionType: "In Person Group", isOnline: false, location: "New York",
          timeCommitment: "1–3 hours",
          title: "ICE Out For Good — Know Your Rights Canvass, Greenwich Village NYC",
          description: "Friday canvass in Greenwich Village to hand Know Your Rights red cards to immigrant workers and document ICE lawyers' walking routes. Trump-era ICE buildout meets street-level legal-education counter-pressure. Volunteer-organized via Indivisible.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible NY", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/956018/",
          eventDate: "2026-05-29",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 10,
          category: "JOIN A GROUP", categoryColor: "#9c2779",
          actionType: "In Person Group", isOnline: false, location: "New York",
          timeCommitment: "1–3 hours",
          title: "Know Your Rights Canvass — South Bronx",
          description: "Saturday canvass in the South Bronx with Target Majority NYC and Swing Left — direct neighborhood outreach to protect immigrants and workers from Trump-era ICE raids. Recurring Saturday action.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Swing Left / Target Majority NYC", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/859108/",
          eventDate: "2026-05-23",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 11,
          category: "MENTAL HEALTH", categoryColor: "#6b5b95",
          actionType: "Online", isOnline: true,
          timeCommitment: "1–3 hours",
          title: "Cat-Lady-Palooza Twooza: Revenge of the Cat Ladies",
          description: "Free live virtual event from Cat Ladies for America — reclaiming Vance's slur, weaponizing it into an anti-MAGA fundraising spectacle. Comedy, music, organizing announcements. RSVP now.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Cat Ladies for America", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/945793/",
          eventDate: "2026-09-13",
          toneOverride: { anger: 1, comedy: 3, subversion: 3, hope: 3, energy: 3 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 12,
          category: "JOIN A GROUP", categoryColor: "#9c2779",
          actionType: "In Person Group", isOnline: false, location: "New York",
          timeCommitment: "1–3 hours",
          title: "Hands Off NYC Small Business Canvass for Immigrant Safety",
          description: "Canvass with Indivisible Harlem + Neighbors United for Immigrant Safety. Visit small businesses in immigrant-heavy NYC neighborhoods with sanctuary-policy materials and Know Your Rights packets. Direct counter-organizing against Trump deportation raids.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible Harlem", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/838849/",
          eventDate: "2026-05-20",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 13,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "California",
          timeCommitment: "1–3 hours",
          title: "Venice & Santa Monica NO WARS! Weekly Protest",
          description: "Indivisible Westside LA's weekly Thursday 4pm PDT visibility action in Venice/Santa Monica targeting Trump's Iran escalation and broader Middle East military buildup.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible Westside Los Angeles", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/893106/",
          toneOverride: { anger: 3, comedy: 1, subversion: 1, hope: 2, energy: 2 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 14,
          category: "CRAFTING", categoryColor: "#c34e00",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "1–3 hours",
          title: "Whistle Kit Making Party — Indivisible Eastside Redmond",
          description: "Crafting party in Redmond WA to assemble emergency whistle kits for neighbors to use when ICE is spotted. Practical mutual-aid prep dressed up as a party.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible Eastside", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/877951/",
          eventDate: "2026-05-19",
          toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 15,
          category: "SPREAD POSITIVITY", categoryColor: "#d97706",
          actionType: "In Person Group", isOnline: false, location: "Illinois",
          timeCommitment: "1–3 hours",
          title: "We The People: Popsicle & Ice Cream Social — Chicago",
          description: "Indivisible Greater West Loop's block party: free popsicles + ice cream + voter-protection sign-ups + Know Your Rights info against Trump-era ICE raids. Pun-titled summer recruitment event.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible Greater West Loop", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/952624/",
          eventDate: "2026-06-06",
          toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 3, energy: 2 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 16,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington, DC",
          timeCommitment: "1–3 hours",
          title: "Petworth ICE Out: No Cooperation With the Occupation",
          description: "DC visibility action in Petworth — explicit anti-ICE messaging framing Trump's deportation campaign as occupation. Indivisible DC volunteer-organized. Recurring monthly.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible DC", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/955498/",
          eventDate: "2026-06-07",
          toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 2, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 17,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Maryland",
          timeCommitment: "1–3 hours",
          title: "Bad Ass Bridge Brigade Overpass Wave — Gaithersburg MD",
          description: "DC-metro overpass wave with Indivisible Gaithersburg. Anti-Trump-corruption signage on commuter bridges. Visibility builds across MD/DC commuters.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible Gaithersburg", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/853172/",
          eventDate: "2026-05-19",
          toneOverride: { anger: 2, comedy: 2, subversion: 1, hope: 2, energy: 2 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 18,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Florida",
          timeCommitment: "Ongoing",
          title: "Krome Vigil with Chinga La Migra — Miami",
          description: "Chinga La Migra crew runs ongoing demonstrations and candlelight vigils at Krome Service Processing Center — the Miami ICE detention site where Trump-era overcrowding has produced documented medical neglect. Show up; in-person presence shifts press coverage.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Chinga La Migra Crew", authorRole: "Movement Organization",
          targetUrl: "https://www.instagram.com/chingalamigracrew/",
          toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 19,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "Ongoing",
          title: "Join La Resistencia Evening Vigils at Northwest ICE Processing Center",
          description: "La Resistencia runs frequent evening vigils outside the GEO-Group-run Tacoma facility — especially during hunger strikes and deportation-flight observations. Bring candles, witness names of people detained under Trump's expanded enforcement.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "La Resistencia", authorRole: "Movement Organization",
          targetUrl: "https://laresistencianw.org/",
          toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 20,
          category: "EMAIL CAMPAIGN", categoryColor: "#c2185b",
          actionType: "Online", isOnline: true,
          timeCommitment: "5–10 minutes",
          title: "Tell Tacoma City Council: Revoke NWDC's Business License",
          description: "La Resistencia's pressure campaign — Washington State health inspectors are still being denied entry to NWDC. Email Tacoma councilmembers to revoke the facility's business license.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "La Resistencia", authorRole: "Movement Organization",
          targetUrl: "https://laresistencianw.org/",
          toneOverride: { anger: 3, comedy: 0, subversion: 3, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 21,
          category: "JOIN A GROUP", categoryColor: "#9c2779",
          actionType: "In Person Group", isOnline: false, location: "California",
          timeCommitment: "Ongoing",
          title: "Volunteer for LA Rapid Response Network ICE Hotline",
          description: "CHIRLA's LA Rapid Response Network needs more dispatchers and verifiers — when neighbors call the hotline reporting ICE activity, RRN volunteers verify, document, and notify families. Direct counter-infrastructure to Trump's deportation surge.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "CHIRLA / LA Rapid Response Network", authorRole: "Movement Organization",
          targetUrl: "https://www.chirla.org/",
          toneOverride: { anger: 2, comedy: 0, subversion: 3, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 22,
          category: "FUNDING", categoryColor: "#127f05",
          actionType: "Online", isOnline: true, location: "Multi-State",
          timeCommitment: "5–10 minutes",
          title: "Donate to CASA — Frontline Defense for MD/VA/PA Immigrants",
          description: "CASA defends immigrants across Maryland, Virginia, and Pennsylvania with deportation defense legal teams, member organizing, and Know Your Rights clinics. Recurring donations fund the lawyers who fight Trump-era ICE detentions case-by-case.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "CASA", authorRole: "Movement Organization",
          targetUrl: "https://wearecasa.org/",
          toneOverride: { anger: 2, comedy: 0, subversion: 2, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
      ];
      const placedML = await appendUserActionCards(newCards);
      await setMigrationFlag("migration:mobilize-local-actions:v1");
      console.log(`Added ${placedML.length} local/Mobilize action cards (ids ${placedML.join(", ")}).`);
    }

    // One-time migration: add second batch of Mobilize/50501 action cards
    const mobilizeV2Done = await getMigrationFlag("migration:mobilize-actions-v2:v1");
    if (!mobilizeV2Done) {
      const currentIds = ((await kv.get("user-action:ids")) ?? []) as number[];
      const base = Math.max(...(currentIds.length ? currentIds : [1500]), 1500);
      const now = new Date().toISOString();
      const newCards = [
        {
          id: base + 1,
          category: "EMAIL CAMPAIGN", categoryColor: "#c2185b",
          actionType: "Online", isOnline: true,
          timeCommitment: "5–10 minutes",
          title: "Vote YES on War Powers Resolution to Stop Trump's Iran War",
          description: "50501 letter campaign urging your member of Congress to vote YES on the War Powers Resolution blocking Trump's unauthorized military escalation against Iran. Targets the actual upcoming roll-call vote.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "50501 Movement", authorRole: "Movement Organization",
          targetUrl: "https://actionnetwork.org/letters/e8187bd3c13d6812ad7e41897d096f8d3ae76f60",
          toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 3 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 2,
          category: "JOIN A GROUP", categoryColor: "#9c2779",
          actionType: "Online", isOnline: true,
          timeCommitment: "5–10 minutes",
          title: "Plug into 50501's Virtual Actions Hub",
          description: "50501's central page for digital direct actions you can do from home — signal-boost campaigns, virtual call days, and online resistance against the Trump administration. One-stop entry point that updates weekly.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "50501 Movement", authorRole: "Movement Organization",
          targetUrl: "https://www.fiftyfifty.one/virtual-actions",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 2, energy: 2 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 3,
          category: "PETITION", categoryColor: "#7b3f00",
          actionType: "Online", isOnline: true,
          timeCommitment: "5–10 minutes",
          title: "Tell Republicans: Not One Penny More for ICE Brutality",
          description: "Indivisible petition to GOP Members of Congress demanding they stop funding Trump's ICE brutality — targeted at GOP votes on the upcoming appropriations bill.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible", authorRole: "Movement Organization",
          targetUrl: "https://act.indivisible.org/sign/tell-your-republican-members-of-congress-not-one-penny-more-for-ice/",
          toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 3 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 4,
          category: "EMAIL CAMPAIGN", categoryColor: "#c2185b",
          actionType: "Online", isOnline: true,
          timeCommitment: "5–10 minutes",
          title: "Urge Democrats to Oppose Shoveling Billions More to ICE",
          description: "Indivisible action urging Democratic members of Congress to fiercely oppose the new GOP push to dump billions more into ICE and Border Patrol expansion under Trump's deportation surge.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible", authorRole: "Movement Organization",
          targetUrl: "https://act.indivisible.org/sign/urge-democrats-fiercely-oppose-new-gop-effort-shovel-billions-more-dollars-ice-and-border-patrol/",
          toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 3 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 5,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Massachusetts",
          timeCommitment: "1–3 hours",
          title: "NO KINGS, STOP WAR WITH IRAN — 4th of July Standout, Beverly MA",
          description: "July 4 Beverly MA standout combining No Kings anti-Trump messaging with anti-Iran-war demand. Held by local 50501-aligned organizers on Independence Day for maximum visibility.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "50501 Affiliate", authorRole: "Movement Organization",
          targetUrl: "https://events.pol-rev.com/events/6d4fbb73-d6b4-44d5-8379-37338fece86d",
          eventDate: "2026-07-04",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 2, energy: 3 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 6,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Missouri",
          timeCommitment: "1–3 hours",
          title: "TOGETHER ACROSS JOPLIN — Hands Across America 2.0",
          description: "50501 Joplin MO chapter organizing a Hands-Across-America-style human chain action themed around mutual aid and standing together against the Trump administration. Bring a friend, bring snacks.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Joplin 50501", authorRole: "Movement Organization",
          targetUrl: "https://events.pol-rev.com/events/2e05238c-3a49-4c94-b91e-53255de8c71e",
          eventDate: "2026-05-25",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 3, energy: 3 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 7,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Florida",
          timeCommitment: "1–3 hours",
          title: "All of U.S. 250 — Fort Myers Visibility Brigade Standout",
          description: "Fort Myers Visibility Brigade standout at U.S. 250 — visibility action against the Trump administration with handmade signs, banners and honk-and-wave. Recurring brigade format.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Fort Myers Visibility Brigade", authorRole: "Movement Organization",
          targetUrl: "https://events.pol-rev.com/events/787666e6-592e-43e5-85f9-0cf0131663d2",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 2, energy: 2 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 8,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "1–3 hours",
          title: "NO KINGS. NO OLIGARCHS: Seattle Yesler Overpass Banner Drop",
          description: "Seattle Indivisible Tuesday-morning overpass banner action at the Yesler Way overpass denouncing Trump and the oligarchy he leads. Recurring slot, drop in any week.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Seattle Indivisible", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/791326/",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 2, energy: 2 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 9,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "1–3 hours",
          title: "NO ICE EXPANSION: Rally at Sabey Corp HQ (Tukwila WA)",
          description: "Southend Indivisible rally at Sabey Corp HQ demanding they cancel the new office lease they signed with ICE. Direct corporate pressure to deny ICE the physical space to expand operations.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Southend Indivisible", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/933915/",
          toneOverride: { anger: 3, comedy: 1, subversion: 3, hope: 2, energy: 3 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 10,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "1–3 hours",
          title: "Protest ICE Terror at ICE HQ — Tukwila WA Friday Morning Rally",
          description: "Recurring Friday-morning protest outside the Seattle-area ICE HQ in Tukwila, organized by Southend Indivisible. Direct sustained pressure on the agency carrying out Trump's mass deportation surge.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Southend Indivisible", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/944898/",
          toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 3 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 11,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "New York",
          timeCommitment: "1–3 hours",
          title: "De-ICE Citizens Bank Yonkers — National Day of Action",
          description: "National Day of Action targeting Citizens Bank in Yonkers for its banking relationship with ICE detention contractors. Boycott + on-site rally combo at 2195 Central Park Ave.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "De-ICE Citizens Bank", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/954480/",
          eventDate: "2026-06-06",
          toneOverride: { anger: 3, comedy: 1, subversion: 3, hope: 2, energy: 3 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 12,
          category: "JOIN A GROUP", categoryColor: "#9c2779",
          actionType: "In Person Group", isOnline: false, location: "California",
          timeCommitment: "1–3 hours",
          title: "Aida4LA Canvassing — LA Immigrant Defense Brigade",
          description: "Daily morning canvass with Aida4LA in Los Angeles, signing up residents for ICE-watch deployment alerts and door-knocking on Trump's deportation policies. Multiple shifts per week.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Aida 4 LA", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/932835/",
          toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 3 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 13,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Oregon",
          timeCommitment: "1–3 hours",
          title: "PDX Car Caravan Protest: Flag Day / DJT's Unhappy Birthday Party",
          description: "Portland car-caravan protest framed as Trump's unhappy-birthday party — rolling visibility action with decorated cars, satirical signage, and a parade route through the city.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "PDX Car Caravan Protest", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/916101/",
          eventDate: "2026-06-14",
          toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 2, energy: 3 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 14,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Oregon",
          timeCommitment: "1–3 hours",
          title: "Stand Together — Boycott Bezos, ICE Out, No War, NO KINGS! (Portland)",
          description: "Portland District 2 Neighbors Indivisible recurring Sunday rally combining four targets: boycott Bezos, ICE out, no war on Iran, no kings. Multi-issue intersectional anti-Trump action.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Portland District 2 Neighbors Indivisible", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/950119/",
          toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 2, energy: 3 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 15,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "1–3 hours",
          title: "Banners Over I-5: No War In Iran (Vancouver WA)",
          description: "Indivisible Greater Vancouver freeway-overpass banner drop on I-5 demanding no war with Iran. High-visibility weekday rush-hour action against Trump's military escalation.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible Greater Vancouver", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/823132/",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 2, energy: 2 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 16,
          category: "TRAINING", categoryColor: "#1a6b3c",
          actionType: "In Person Group", isOnline: false, location: "California",
          timeCommitment: "1–3 hours",
          title: "Volunteer Training: Rapid Response to ICE Actions (Fremont CA)",
          description: "Indivisible Fremont's volunteer training on how to respond when ICE shows up — legal observer protocols, recording, hotline workflow, and de-escalation. Mandatory for new rapid-response volunteers.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible Fremont CA", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/943590/",
          toneOverride: { anger: 2, comedy: 0, subversion: 2, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 17,
          category: "TRAINING", categoryColor: "#1a6b3c",
          actionType: "Online", isOnline: true,
          timeCommitment: "1–3 hours",
          title: "BLAG: \"CommUNITY Melts ICE\" — Panel with Twin Cities Organizers",
          description: "Biggest Little Action Group hosts a virtual panel with Wes Burdine and Twin Cities organizers on how communities can \"melt ICE\" — practical chapter-organizing strategies, mass mobilization, and direct action against Trump's deportation infrastructure.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Biggest Little Action Group", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/951961/",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 3, energy: 3 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 18,
          category: "JOIN A GROUP", categoryColor: "#9c2779",
          actionType: "Online", isOnline: true, location: "Multi-State",
          timeCommitment: "Ongoing",
          title: "NDLON Adopt-A-School: ICE Watch at K-12 Schools",
          description: "National Day Laborer Organizing Network's program assigning volunteer 'adopters' to specific schools to maintain ICE-presence watch at student arrival/dismissal. Direct response to Trump-administration ICE raids at K-12 schools.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "National Day Laborer Organizing Network", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/942116/",
          toneOverride: { anger: 2, comedy: 0, subversion: 3, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 19,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "California",
          timeCommitment: "1–3 hours",
          title: "Tesla Takedown — Stanford Mall, Palo Alto",
          description: "The Wolves' recurring Saturday Tesla Takedown action at the Stanford Shopping Center Tesla showroom — Bay Area location targeting Musk-DOGE and the Trump administration's tech-billionaire alliance.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "The Wolves", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/879712/",
          toneOverride: { anger: 2, comedy: 2, subversion: 2, hope: 2, energy: 3 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 20,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington, DC",
          timeCommitment: "1–3 hours",
          title: "Let's Get Free! March & Concert — Washington DC",
          description: "Popular Democracy's July 9 march and concert in Washington DC demanding freedom from Trump's deportation, detention, and policing surge. Mass mobilization with cultural programming.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Popular Democracy", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/942279/",
          eventDate: "2026-07-09",
          toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 3, energy: 3 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 21,
          category: "JOIN A GROUP", categoryColor: "#9c2779",
          actionType: "In Person Group", isOnline: false, location: "Georgia",
          timeCommitment: "Ongoing",
          title: "Volunteer with El Refugio at Stewart Detention Center (Lumpkin GA)",
          description: "El Refugio provides hospitality and visitation to immigrants detained at Stewart Detention Center — one of the largest ICE facilities in Trump's expanded detention system. Shifts include visiting detained people, hosting families, and accompaniment.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "El Refugio", authorRole: "Movement Organization",
          targetUrl: "https://elrefugiostewart.org/en/volunteers",
          toneOverride: { anger: 2, comedy: 0, subversion: 2, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 22,
          category: "JOIN A GROUP", categoryColor: "#9c2779",
          actionType: "Online", isOnline: true,
          timeCommitment: "Ongoing",
          title: "#NoTechForIce: Join Mijente's Tech-Worker Campaign",
          description: "Mijente's flagship campaign pressuring tech companies (Palantir, Amazon, Microsoft) to stop building surveillance and ICE tooling that powers Trump's deportation machine. Sign on as a tech worker, student, or ally.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Mijente", authorRole: "Movement Organization",
          targetUrl: "https://mijente.net/notechforice/",
          toneOverride: { anger: 3, comedy: 0, subversion: 3, hope: 2, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 23,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "1–3 hours",
          title: "NO WAR. NO KINGS: Tacoma Rally",
          description: "Seattle Indivisible regional rally in Tacoma combining No-Kings anti-Trump messaging with anti-Iran-war demands. Covers the Pierce County / South Sound corridor.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Seattle Indivisible", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/795854/",
          eventDate: "2026-05-23",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 2, energy: 2 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 24,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "1–3 hours",
          title: "Spot Protests — Seattle Wedgwood (Recurring)",
          description: "Volunteer-organized recurring Saturday corner-protest in the Seattle Wedgwood neighborhood targeting the Trump administration. Drop-in slot every weekend, low barrier to entry.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible Volunteer", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/939498/",
          toneOverride: { anger: 2, comedy: 0, subversion: 2, hope: 2, energy: 2 },
          adminApproved: false, createdAt: now,
        },
      ];
      const placedMv2 = await appendUserActionCards(newCards);
      await setMigrationFlag("migration:mobilize-actions-v2:v1");
      console.log(`Added ${placedMv2.length} Mobilize/50501 action cards (v2) (ids ${placedMv2.join(", ")}).`);
    }

    // One-time migration: add Resistbot "Empower States to Undo Citizens United" petition card
    const resistbotCitizensDone = await getMigrationFlag("migration:resistbot-citizens-united:v1");
    if (!resistbotCitizensDone) {
      const card = {
        id: 1374,
        category: "EMAIL CAMPAIGN",
        categoryColor: "#c2185b",
        actionType: "Online",
        title: "Sign: Empower States to Undo Citizens United",
        description: "States don't need the Supreme Court or Congress to fight Citizens United — they can limit corporate spending in elections right now by amending state constitutions and corporate charter laws. Montana's Transparent Elections Initiative shows how. Text SIGN PKFEPT to 50409 or sign via Resistbot to urge your governor and legislature to follow.",
        isOnline: true,
        boosts: 8,
        spotsTotal: "Unlimited",
        authorName: "Resistbot",
        authorRole: "Civic Action Platform",
        authorLink: "https://resist.bot/",
        targetUrl: "https://resist.bot/petitions/PKFEPT",
        timeCommitment: "< 5 minutes",
        quickAction: true,
        firstTimerFriendly: true,
        adminApproved: true,
        createdAt: new Date().toISOString(),
      };
      await kv.set(`action:${card.id}`, card);
      await setMigrationFlag("migration:resistbot-citizens-united:v1");
      console.log("Added Resistbot Citizens United petition card (id 1374).");
    }

    // v2: update description to mention Hawaii's success
    const resistbotCitizensV2Done = await getMigrationFlag("migration:resistbot-citizens-united:v2");
    if (!resistbotCitizensV2Done) {
      const existing: any = await kv.get("action:1374");
      if (existing) {
        existing.description = "Hawaii just did it — became the first state to pass legislation rolling back Citizens United. Now we need every state to follow. Text SIGN PKFEPT to 50409 or sign via Resistbot to urge your governor and legislature to use state authority to limit corporate spending in elections. Montana's Transparent Elections Initiative showed the way. Hawaii proved it works. Let's go.";
        await kv.set("action:1374", existing);
      }
      await setMigrationFlag("migration:resistbot-citizens-united:v2");
      console.log("Updated Resistbot Citizens United card with Hawaii success (id 1374).");
    }

    // One-time cleanup: retire cards whose described date has already passed
    // (audit run 2026-05-22). Sierra Club South Coast and Adopt-A-Corner are
    // intentionally kept — Sierra Club is still actively campaigning on the same
    // URL, and Adopt-A-Corner runs through Jan 2029 (the "Jan 20" in the
    // description was a program kickoff, not a deadline).
    // ── Fix mis-tagged quickAction flags (audit 2026-05-24) ────────────────
    // These 15 cards had quickAction: true but their actions aren't actually
    // 5-min (CRAFTING / joining a federation / in-person social events / etc).
    // Clearing the flag drops them out of the "5 Minutes Max" filter; their
    // timeCommitment falls back to the category default in timeBucketFor().
    // PURCHASE cards (1304, 1313, 1337) are intentionally NOT in this list —
    // buying a sticker / shirt / candle is genuinely a 5-min checkout flow.
    // Audit source: reports/audit-2026-05-24.md
    // One-time: recategorize 11 phone-call cards from their mixed homes
    // (EMAIL CAMPAIGN / MENTAL HEALTH / TRAINING / Petition) into the
    // unified "Call" bucket (renamed from "Call/Write" — the bucket only
    // ever held phone-call actions) with the pink #c2185b swatch. The 9
    // seed-card entries are also updated in SEED_CARDS — this migration
    // covers live KV writes (boosts, approvals, edits) that would
    // otherwise win the merge and keep the old category.
    const recatCallDone = await getMigrationFlag("cleanup:recategorize-call-cards:v1");
    if (!recatCallDone) {
      const ids = [125, 133, 1215, 1217, 1259, 1261, 1262, 1264, 1283, 1288, 1290];
      let updated = 0;
      for (const id of ids) {
        for (const prefix of ["action:", "user-action:"]) {
          const existing = (await kv.get(`${prefix}${id}`)) as any;
          if (existing && typeof existing === "object") {
            await kv.set(`${prefix}${id}`, {
              ...existing,
              category: "Call",
              categoryColor: "#c2185b",
            });
            updated++;
            break;
          }
        }
      }
      await setMigrationFlag("cleanup:recategorize-call-cards:v1");
      console.log(`Recategorized ${updated} of ${ids.length} call cards to Call.`);
    }

    // One-time: redistribute the 19 catch-all gray CALL/WRITE cards into
    // their proper buckets. Most were social-media posts / TikTok films /
    // quote-tweets that got mis-bucketed. See changelog 1.2.50 for details.
    const cwRedistributeDone = await getMigrationFlag("cleanup:cw-redistribute:v1");
    if (!cwRedistributeDone) {
      const moves: Array<[number, string, string]> = [
        // [id, new category, new color]
        // → Social Media (#e44b4b): posts, threads, tweets, films, stitches
        [2331, "Social Media",    "#e44b4b"],
        [2334, "Social Media",    "#e44b4b"],
        [2336, "Social Media",    "#e44b4b"],
        [2343, "Social Media",    "#e44b4b"],
        [2353, "Social Media",    "#e44b4b"],
        [2354, "Social Media",    "#e44b4b"],
        [2360, "Social Media",    "#e44b4b"],
        [2362, "Social Media",    "#e44b4b"],
        [2373, "Social Media",    "#e44b4b"],
        [2377, "Social Media",    "#e44b4b"],
        [2383, "Social Media",    "#e44b4b"],
        // → Letter Writing (#2d7a6b): postcards + formal public comments
        [2255, "Letter Writing",  "#2d7a6b"],
        [2257, "Letter Writing",  "#2d7a6b"],
        [2301, "Letter Writing",  "#2d7a6b"],
        [2312, "Letter Writing",  "#2d7a6b"],
        // → Letter to Editor (#3f5c8c)
        [2297, "Letter to Editor","#3f5c8c"],
        // → Call (#c2185b): the actual call actions + text-bank shift
        // (Category renamed from "Call/Write" — the bucket only ever held
        // phone-call actions; letter-writing has its own category.)
        [2240, "Call",            "#c2185b"],
        [2280, "Call",            "#c2185b"],
        [2316, "Call",            "#c2185b"],
      ];
      let updated = 0;
      for (const [id, category, categoryColor] of moves) {
        for (const prefix of ["action:", "user-action:"]) {
          const existing = (await kv.get(`${prefix}${id}`)) as any;
          if (existing && typeof existing === "object") {
            await kv.set(`${prefix}${id}`, { ...existing, category, categoryColor });
            updated++;
            break;
          }
        }
      }
      await setMigrationFlag("cleanup:cw-redistribute:v1");
      console.log(`Redistributed ${updated} of ${moves.length} gray CALL/WRITE cards.`);
    }

    // One-time: merge the BOOST color split. 72 bulk-imported Bluesky
    // "Follow & boost @handle" cards landed with #3f3f3f (gray) instead of
    // #8a00e6 (purple) used by the original BOOST newsroom-amplification
    // cards. Same concept, just import drift. Scans all action/user-action
    // records since the affected IDs aren't in SEED_CARDS.
    const boostColorMergeDone = await getMigrationFlag("cleanup:boost-color-merge:v1");
    if (!boostColorMergeDone) {
      let updated = 0;
      for (const prefix of ["action:", "user-action:"]) {
        const all = (await kv.getByPrefix(prefix)) as any[];
        for (const card of all) {
          if (
            card && typeof card === "object" &&
            typeof card.id === "number" &&
            (card.category === "BOOST" || card.category === "Boost") &&
            card.categoryColor === "#3f3f3f"
          ) {
            await kv.set(`${prefix}${card.id}`, { ...card, categoryColor: "#8a00e6" });
            updated++;
          }
        }
      }
      await setMigrationFlag("cleanup:boost-color-merge:v1");
      console.log(`Merged ${updated} gray BOOST cards to purple #8a00e6.`);
    }

    // One-time: reconcile the PERSONAL COMMITMENT color drift. 4 cards
    // landed with #23297e (Protest blue) instead of the canonical #5e1f7a
    // (per BULK_IMPORT_CATEGORY_COLORS). Source SEED_CARDS already updated.
    const pcColorDone = await getMigrationFlag("cleanup:personal-commitment-color:v1");
    if (!pcColorDone) {
      let updated = 0;
      for (const prefix of ["action:", "user-action:"]) {
        const all = (await kv.getByPrefix(prefix)) as any[];
        for (const card of all) {
          if (
            card && typeof card === "object" &&
            typeof card.id === "number" &&
            (card.category === "PERSONAL COMMITMENT" || card.category === "Personal Commitment") &&
            card.categoryColor === "#23297e"
          ) {
            await kv.set(`${prefix}${card.id}`, { ...card, categoryColor: "#5e1f7a" });
            updated++;
          }
        }
      }
      await setMigrationFlag("cleanup:personal-commitment-color:v1");
      console.log(`Reconciled ${updated} Personal Commitment cards to #5e1f7a.`);
    }

    // One-time: fix 8 singleton category-color outliers and mis-categorizations
    // discovered during the 2026-05-25 color audit. Each is a one-off drift
    // from import or a mis-bucketed card.
    const outliersDone = await getMigrationFlag("cleanup:category-outliers-2026-05:v1");
    if (!outliersDone) {
      const fixes: Array<[number, string, string]> = [
        // [id, category, categoryColor]
        [ 230, "Meeting",             "#5a3e9e"], // was MEETING/#23297e (Protest blue) — color drift
        [ 237, "Join a Group",        "#9c2779"], // was JOIN A GROUP/#0891b2 — color drift
        [ 238, "Email Campaign",      "#c2185b"], // was EMAIL CAMPAIGN/#e44b4b (Social red) — color drift
        [1233, "Professional Skills", "#1f635c"], // was PROFESSIONAL SKILLS/#126d89 — color drift (canonical color in SEED_CARDS already fixed)
        [2033, "Join a Group",        "#9c2779"], // was PRAYER/#8a00e6 — Faith in Action federation is a group, not a prayer act
        [2034, "Join a Group",        "#9c2779"], // was LETTER WRITING/#3f3f3f — leading a divestment resolution campaign
        [2109, "Training",            "#126d89"], // was TRAINING/#1a6b3c — color drift
        [2365, "Social Media",        "#e44b4b"], // was Video/#e44b4b — lone "Video" category folded into Social Media
      ];
      let updated = 0;
      for (const [id, category, categoryColor] of fixes) {
        for (const prefix of ["action:", "user-action:"]) {
          const existing = (await kv.get(`${prefix}${id}`)) as any;
          if (existing && typeof existing === "object") {
            await kv.set(`${prefix}${id}`, { ...existing, category, categoryColor });
            updated++;
            break;
          }
        }
      }
      await setMigrationFlag("cleanup:category-outliers-2026-05:v1");
      console.log(`Fixed ${updated} of ${fixes.length} category/color outliers.`);
    }

    const fixQuickActionMistagsDone = await getMigrationFlag("cleanup:fix-quickaction-mistags:v1");
    if (!fixQuickActionMistagsDone) {
      const idsToFix = [31, 55, 128, 285, 315, 1010, 1076, 1097, 1265, 1269, 1302, 1334, 2033, 2035, 2085];
      let fixed = 0;
      for (const id of idsToFix) {
        for (const prefix of ["action:", "user-action:"]) {
          const existing = (await kv.get(`${prefix}${id}`)) as any;
          if (existing && typeof existing === "object" && existing.quickAction === true) {
            await kv.set(`${prefix}${id}`, { ...existing, quickAction: false });
            fixed++;
            break; // a given id lives in exactly one of the two stores
          }
        }
      }
      await setMigrationFlag("cleanup:fix-quickaction-mistags:v1");
      console.log(`Cleared mis-tagged quickAction on ${fixed} of ${idsToFix.length} cards: ${idsToFix.join(", ")}`);
    }

    const retirePastDatedDone = await getMigrationFlag("cleanup:retire-past-dated-2026-05:v1");
    if (!retirePastDatedDone) {
      const retireTitles = new Set([
        "Trans Peoria Community Potluck",
        "Use Ethical Consumer's Trump-boycott guide",
        "Sign the NAACP 25th Amendment petition",
        "Citrus Heights Resists ICE!",
        "Citrus Heights Resists ICE! (Coalition Against Project 2025)",
        "Pretrial Fairness Under Threat — Teach-In",
        "Sign MoveOn's No Unauthorized War with Iran petition",
      ]);

      const removed: { key: string; id: number; title: string }[] = [];

      for (const card of (await kv.getByPrefix("action:")) as any[]) {
        if (card && typeof card === "object" && retireTitles.has(card.title) && typeof card.id === "number") {
          await kv.del(`action:${card.id}`);
          removed.push({ key: `action:${card.id}`, id: card.id, title: card.title });
        }
      }

      const removedUserIds: number[] = [];
      for (const card of (await kv.getByPrefix("user-action:")) as any[]) {
        if (card && typeof card === "object" && retireTitles.has(card.title) && typeof card.id === "number") {
          await kv.del(`user-action:${card.id}`);
          removed.push({ key: `user-action:${card.id}`, id: card.id, title: card.title });
          removedUserIds.push(card.id);
        }
      }
      if (removedUserIds.length > 0) {
        const userIds = ((await kv.get("user-action:ids")) ?? []) as number[];
        await kv.set("user-action:ids", userIds.filter((x) => !removedUserIds.includes(x)));
      }

      await setMigrationFlag("cleanup:retire-past-dated-2026-05:v1");
      console.log(`Retired ${removed.length} past-dated cards:`, removed);
    }

    // One-time: rename the "Call/Write" category to "Call". The bucket only
    // ever contained phone-call actions (letter-writing has its own
    // Letter Writing / Letter to Editor categories), so the slash label was
    // misleading. Scans every action: and user-action: record and updates
    // category in place; color stays #c2185b. SEED_CARDS were already
    // updated in the same commit, and the client-side normaliseCategory()
    // alias folds any leftover "Call/Write" strings forward at render time.
    const renameCallWriteDone = await getMigrationFlag("cleanup:rename-call-write-to-call:v1");
    if (!renameCallWriteDone) {
      let updated = 0;
      for (const prefix of ["action:", "user-action:"]) {
        const all = (await kv.getByPrefix(prefix)) as any[];
        for (const card of all) {
          if (
            card && typeof card === "object" &&
            typeof card.id === "number" &&
            card.category === "Call/Write"
          ) {
            await kv.set(`${prefix}${card.id}`, { ...card, category: "Call" });
            updated++;
          }
        }
      }
      await setMigrationFlag("cleanup:rename-call-write-to-call:v1");
      console.log(`Renamed ${updated} cards: Call/Write → Call.`);
    }

    // One-time: un-approve every card whose authorLink points to the same
    // place as targetUrl. These are "go follow / boost the author" cards
    // where the action is just visiting the author's own profile — a soft
    // boost-only pattern that crept past approval. Flipping adminApproved
    // back to false pulls them out of the public feed and back into
    // admin review so the team can decide which ones earn their slot
    // (per the 10% boost-only cap in docs/INBOX_IMPORT.md).
    //
    // URL match is normalized: trim, lowercase, strip a single trailing
    // slash, and ignore http vs https. This catches near-duplicates like
    // https://x.com vs https://x.com/ or HTTP vs HTTPS variants without
    // false-positiving on different paths or query strings.
    const unapproveSelfLinkDone = await getMigrationFlag("cleanup:unapprove-self-link-cards:v1");
    if (!unapproveSelfLinkDone) {
      const normalizeUrl = (u: unknown): string => {
        if (typeof u !== "string") return "";
        let s = u.trim().toLowerCase();
        if (!s) return "";
        s = s.replace(/^https?:\/\//, "");
        if (s.endsWith("/")) s = s.slice(0, -1);
        return s;
      };
      let unapproved = 0;
      const flippedIds: number[] = [];
      for (const prefix of ["action:", "user-action:"]) {
        const all = (await kv.getByPrefix(prefix)) as any[];
        for (const card of all) {
          if (!card || typeof card !== "object" || typeof card.id !== "number") continue;
          if (card.adminApproved === false) continue; // already pending — skip
          const a = normalizeUrl(card.authorLink);
          const t = normalizeUrl(card.targetUrl);
          if (!a || !t) continue;
          if (a !== t) continue;
          await kv.set(`${prefix}${card.id}`, {
            ...card,
            adminApproved: false,
            updatedAt: new Date().toISOString(),
            updatedBy: "cleanup:unapprove-self-link",
          });
          flippedIds.push(card.id);
          unapproved++;
        }
      }
      await setMigrationFlag("cleanup:unapprove-self-link-cards:v1");
      console.log(`Un-approved ${unapproved} self-link cards (authorLink ≈ targetUrl). IDs: ${flippedIds.join(", ")}`);
    }

    // PERF: in-process cache + parallel KV reads. The catalog (~600 cards)
    // changes infrequently relative to read traffic (admins approve cards
    // every few minutes; boosts trickle; user submissions are sparse), so
    // a short TTL (15s) cache eliminates almost all KV round-trips on warm
    // requests. Cache is explicitly invalidated by mutation endpoints below.
    const now = Date.now();
    let assembled: any[];
    let cacheStatus: "hit" | "miss" = "miss";
    const tStart = Date.now();
    if (actionsCache && (now - actionsCache.ts) < ACTIONS_CACHE_TTL_MS) {
      assembled = actionsCache.cards;
      cacheStatus = "hit";
      console.log(`/actions cache hit (age ${now - actionsCache.ts}ms)`);
    } else {
      // PERF: parallelize the three independent KV reads (was sequential).
      const tKvStart = Date.now();
      const [allActionCardsRaw, userCardIdsRaw, userActionRecordsRaw] = await Promise.all([
        kv.getByPrefix("action:"),
        kv.get("user-action:ids"),
        kv.getByPrefix("user-action:"),
      ]);
      console.log(`/actions KV fetch took ${Date.now() - tKvStart}ms`);

      const seenIds = new Set<number>();
      assembled = [];
      for (const card of allActionCardsRaw as any[]) {
        if (card && typeof card === "object" && typeof card.id === "number" && !seenIds.has(card.id)) {
          seenIds.add(card.id);
          assembled.push(card);
        }
      }

      const userCardIds = (userCardIdsRaw ?? []) as number[];
      const userCardIdSet = new Set(userCardIds);
      for (const card of userActionRecordsRaw as any[]) {
        if (!card || typeof card !== "object" || typeof card.id !== "number") continue;
        if (!userCardIdSet.has(card.id)) continue;
        if (seenIds.has(card.id)) continue;
        seenIds.add(card.id);
        assembled.push(card);
      }

      assembled.sort((a, b) => a.id - b.id);
      actionsCache = { cards: assembled, ts: now };
    }

    const total = assembled.length;
    const cards = assembled.slice(offset, offset + limit);

    console.log(`Returning ${cards.length} of ${total} action cards (offset=${offset}, limit=${limit}, cache=${cacheStatus}, total handler ${Date.now() - tStart}ms).`);
    c.header("X-Cache", cacheStatus);
    c.header("X-Handler-Ms", String(Date.now() - tStart));
    return c.json({ cards, total });
  } catch (err) {
    console.log("Error in GET /actions:", err);
    return c.json({ error: `Failed to fetch actions: ${err}` }, 500);
  }
});

// ─── GET /stats — live city count + user count ────────────────────────────────
app.get("/make-server-9eb1ae04/stats", async (c) => {
  try {
    // Gather all cards
    const seenIds = new Set<number>();
    const allCards: any[] = [];
    for (const card of await kv.getByPrefix("action:")) {
      if (card && typeof card === "object" && typeof card.id === "number" && !seenIds.has(card.id)) {
        seenIds.add(card.id); allCards.push(card);
      }
    }
    // PERF: single batch fetch (was a per-id loop with ~450 sequential round-trips)
    const userCardIds = (await kv.get("user-action:ids") ?? []) as number[];
    const userCardIdSet = new Set(userCardIds);
    const userActionRecords = (await kv.getByPrefix("user-action:")) as any[];
    for (const card of userActionRecords) {
      if (!card || typeof card !== "object" || typeof card.id !== "number") continue;
      if (!userCardIdSet.has(card.id)) continue;
      if (seenIds.has(card.id)) continue;
      seenIds.add(card.id);
      allCards.push(card);
    }

    // Distinct non-empty locations = cities
    const cities = new Set<string>();
    for (const card of allCards) {
      if (card.location && typeof card.location === "string" && card.location.trim()) {
        cities.add(card.location.trim());
      }
    }
    const citiesCount = cities.size;

    // Count approved/pending/all users
    const users = await kv.getByPrefix("user:approval:");
    const validUsers = (users as any[]).filter((u) => u && typeof u === "object" && u.userId);
    const usersCount = validUsers.length;
    const pendingUsersCount = validUsers.filter((u) => u.status === "pending").length;

    const pendingActsCount = allCards.filter((c: any) => c.adminApproved === false).length;

    // Active user-submitted flags awaiting admin review. Cheap — just a
    // prefix scan since dismissed flags are deleted, not flagged.
    const flagsCount = ((await kv.getByPrefix("flag:")) as any[])
      .filter((f) => f && typeof f === "object" && f.id).length;

    const siteUpdating = (await kv.get("system:site-updating")) === true;

    console.log(`Stats: ${allCards.length} acts (${pendingActsCount} pending), ${citiesCount} cities, ${usersCount} users (${pendingUsersCount} pending), ${flagsCount} flags`);
    return c.json({ citiesCount, usersCount, pendingUsersCount, pendingActsCount, flagsCount, actsCount: allCards.length, siteUpdating });
  } catch (err) {
    console.log("Stats error:", err);
    return c.json({ error: `Failed to fetch stats: ${err}` }, 500);
  }
});

// ─── GET /me/preferences ──────────────────────────────────────────────────────
// Returns the signed-in user's stored match-me preferences (or null if none).
app.get("/make-server-9eb1ae04/me/preferences", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid token" }, 401);
    const prefs = await kv.get(`user:preferences:${user.id}`);
    return c.json({ preferences: prefs ?? null });
  } catch (err) {
    console.log("Get preferences error:", err);
    return c.json({ error: `Failed to load preferences: ${err}` }, 500);
  }
});

// ─── PUT /me/preferences ──────────────────────────────────────────────────────
// Stores the user's match-me prefs as-is. Shape validation happens client-side
// when the prefs are read back via loadPreferences(); duplicating it here would
// just couple the schema to the server.
app.put("/make-server-9eb1ae04/me/preferences", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid token" }, 401);
    const body = await c.req.json();
    if (!body || typeof body !== "object") {
      return c.json({ error: "Body must be an object" }, 400);
    }
    await kv.set(`user:preferences:${user.id}`, {
      ...body,
      userId: user.id,
      updatedAt: new Date().toISOString(),
    });
    return c.json({ success: true });
  } catch (err) {
    console.log("Save preferences error:", err);
    return c.json({ error: `Failed to save preferences: ${err}` }, 500);
  }
});

// ─── GET /me/bookmarks ────────────────────────────────────────────────────────
app.get("/make-server-9eb1ae04/me/bookmarks", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid token" }, 401);
    const bookmarks = (await kv.get(`user-bookmarks:${user.id}`)) ?? [];
    return c.json({ bookmarks });
  } catch (err) {
    return c.json({ error: `Failed to load bookmarks: ${err}` }, 500);
  }
});

// ─── PUT /me/bookmarks — bulk replace ────────────────────────────────────────
app.put("/make-server-9eb1ae04/me/bookmarks", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid token" }, 401);
    const body = await c.req.json().catch(() => null);
    const ids = Array.isArray(body?.ids) ? body.ids.filter((id: any) => typeof id === "number") : [];
    await kv.set(`user-bookmarks:${user.id}`, ids);
    return c.json({ ok: true, count: ids.length });
  } catch (err) {
    return c.json({ error: `Failed to save bookmarks: ${err}` }, 500);
  }
});

// ─── POST /share-invite — send email invites to friends ──────────────────────
app.post("/make-server-9eb1ae04/share-invite", async (c) => {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return c.json({ error: "Email service not configured" }, 503);

  try {
    const { emails, note } = await c.req.json<{ emails: string[]; note?: string }>();
    if (!Array.isArray(emails) || emails.length === 0) {
      return c.json({ error: "No email addresses provided" }, 400);
    }

    const siteUrl = "https://resistact.us";
    const defaultMsg = `I've been using ResistAct to find small, doable actions every day to push back on what's happening in America. Check it out — new actions every day, pick what fits your schedule and mood!\n\n${siteUrl}`;
    const body = note ? `${note}` : defaultMsg;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "ResistAct <noreply@resistact.us>",
        to: emails,
        subject: "Actions you can take today — ResistAct",
        text: body,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.log("Resend error:", err);
      return c.json({ error: "Failed to send" }, 500);
    }

    return c.json({ ok: true });
  } catch (err) {
    console.log("Share invite error:", err);
    return c.json({ error: `Failed: ${err}` }, 500);
  }
});

// ─── POST /notifications — save ACTer notification preferences ─────────────────
app.post("/make-server-9eb1ae04/notifications", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid token" }, 401);

    const prefs = await c.req.json();
    await kv.set(`user:notifications:${user.id}`, {
      ...prefs,
      userId: user.id,
      updatedAt: new Date().toISOString(),
    });
    console.log(`Saved notification prefs for ${user.email}`);
    return c.json({ success: true });
  } catch (err) {
    console.log("Notifications error:", err);
    return c.json({ error: `Failed to save preferences: ${err}` }, 500);
  }
});

// ─── Relevance checker ────────────────────────────────────────────────────────
// Heuristic scan of a submitted card's text. Returns true if the content looks
// clearly off-topic for an anti-Trump / MAGA-resistance site.
// Logic: award points for resistance signals, penalise for red-flag signals.
// If red flags outweigh resistance signals by enough, flag as not-on-topic.
// ─── URL safety validator ────────────────────────────────────────────────────
// Public-feed cards expose targetUrl / authorLink / topImageUrl through
// <a href> and <img src>. React auto-escapes text content, but it CANNOT
// neutralize an `href="javascript:..."` — clicking the link would run the
// payload as the victim's browser. We reject any non-http(s)/mailto scheme
// on submission, edit, AND admin approval so dirty data can't slip through
// any path.
//
// Returns { ok: true } for empty / null / undefined (URLs are optional);
// returns { ok: false, reason } for any URL with a disallowed scheme.
function validateSubmittedUrl(value: unknown, field: string): { ok: true } | { ok: false; reason: string } {
  if (value == null) return { ok: true };
  const raw = String(value).trim();
  if (raw === "") return { ok: true };

  // Allow protocol-relative (//host/path) — browsers infer http(s) at runtime.
  if (raw.startsWith("//")) return { ok: true };
  // Allow site-relative paths.
  if (raw.startsWith("/") || raw.startsWith("./") || raw.startsWith("../")) return { ok: true };

  // Anything with a scheme prefix must match the allowlist. Note: scheme
  // matching is case-insensitive AND tolerates whitespace + tab control
  // chars between letters ("java\tscript:") because some browsers do too.
  const schemeMatch = raw.match(/^\s*([a-zA-Z][a-zA-Z0-9+.\-]*)\s*:/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    const ALLOWED = new Set(["http", "https", "mailto", "sms", "tel"]);
    if (!ALLOWED.has(scheme)) {
      return { ok: false, reason: `${field}: \"${scheme}:\" URLs are not allowed.` };
    }
    return { ok: true };
  }

  // No scheme + not a relative path → treat as bare host (e.g. "example.com").
  // Browsers will follow it as http://example.com, which is safe.
  return { ok: true };
}

function looksOffTopic(title: string, description: string, category: string): boolean {
  const text = `${title} ${description} ${category}`.toLowerCase();

  // Categories that are inherently resistance-adjacent — never flag these.
  const onTopicCategories = [
    "protest", "boycott", "petition", "letter", "email campaign",
    "social media", "flash mob", "funding", "training", "meeting",
    "join a group", "news story", "labor", "legal", "professional skills",
    "mental health", "prayer", "boost", "spread positivity", "crafting",
    "transportation", "housing", "other", "irreverence", "personal commitment",
  ];
  if (onTopicCategories.some((c) => category.toLowerCase().includes(c))) return false;

  // Resistance / political relevance signals — each adds 1 point.
  const resistanceTerms = [
    "trump", "maga", "resist", "resistance", "protest", "boycott",
    "fascis", "authoritar", "democrat", "republican", "congress", "senate",
    "legislat", "vote", "election", "policy", "civil rights", "immigrant",
    "deportat", "abortion", "repro", "lgbtq", "trans", "climate", "union",
    "labor rights", "worker", "petition", "rally", "march", "activist",
    "organiz", "campaign", "movement", "solidarity", "justice", "equity",
    "inequality", "discrimination", "rights", "freedom", "constitution",
    "executive order", "white house", "administration", "government",
    "federal", "supreme court", "aclu", "indivisible", "50501",
  ];

  // Strong off-topic red flags — each adds 2 penalty points.
  const redFlagTerms = [
    "crypto", "bitcoin", "nft", "forex", "trading", "stock tip",
    "weight loss", "diet pill", "supplement", "mlm", "multi-level",
    "make money", "earn money", "passive income", "side hustle",
    "adult content", "casino", "gambling", "lottery",
    "buy now", "limited time offer", "discount code", "promo code",
    "follow me", "subscribe to my", "check out my channel",
  ];

  const resistanceScore = resistanceTerms.filter((t) => text.includes(t)).length;
  const redFlagScore = redFlagTerms.filter((t) => text.includes(t)).length * 2;

  // Flag as off-topic only if red flags dominate AND there are no resistance signals.
  return redFlagScore > 0 && resistanceScore === 0;
}

// ─── POST /actions/create — submit a new user-created ASK ─────────────────────
app.post("/make-server-9eb1ae04/actions/create", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid token" }, 401);

    const approval = await kv.get(`user:approval:${user.id}`) as any;
    if (!approval || approval.status !== "approved") {
      return c.json({ error: "Your account must be approved before posting." }, 403);
    }

    const { title, description, category, categoryColor, location, isOnline, spotsTotal, sponsor, link, targetUrl: targetUrlField, authorName: reqAuthorName, authorRole: reqAuthorRole, authorLink, vettingInfo, actionType, timeCommitment, quickAction, topImageUrl, imageContain, toneOverride, amplifiesGroups } =
      await c.req.json<{
        title: string; description: string; category: string; categoryColor: string;
        location?: string; isOnline?: boolean; spotsTotal: number | "Unlimited";
        sponsor?: string; link?: string; targetUrl?: string;
        authorName?: string; authorRole?: string; authorLink?: string;
        vettingInfo?: string; actionType?: string;
        timeCommitment?: string; quickAction?: boolean;
        topImageUrl?: string | null; imageContain?: boolean;
        toneOverride?: { anger?: number; comedy?: number; subversion?: number; care?: number; hope?: number; energy?: number };
        amplifiesGroups?: string[];
      }>();

    if (!title || !description || !category) {
      return c.json({ error: "title, description and category are required" }, 400);
    }

    // URL safety — block javascript:/data:/file:/vbscript: schemes on any
    // user-facing link or image. React doesn't escape `href=` or `src=`, so
    // these are the only XSS vector once admins approve a card.
    for (const [field, value] of [
      ["targetUrl", targetUrlField ?? link],
      ["authorLink", authorLink],
      ["topImageUrl", topImageUrl],
    ] as Array<[string, unknown]>) {
      const check = validateSubmittedUrl(value, field);
      if (!check.ok) return c.json({ error: check.reason }, 400);
    }

    // Auto-increment ID, always staying above the max seed card ID (1301)
    // to avoid collisions between user-submitted cards and seed cards
    const currentIds = (await kv.get("user-action:ids") ?? []) as number[];
    const nextId = Math.max(...currentIds, 1305) + 1;

    const offTopic = looksOffTopic(title, description, category);

    const card = {
      id: nextId,
      category: category.toUpperCase(),
      categoryColor,
      title,
      description,
      location: location || undefined,
      isOnline: isOnline ?? false,
      actionType: actionType ?? (isOnline ? "Online" : "In Person Group"),
      timeCommitment: timeCommitment || undefined,
      quickAction: quickAction === true ? true : undefined,
      sponsor: sponsor || undefined,
      targetUrl: targetUrlField || link || undefined,
      authorLink: authorLink || undefined,
      vettingInfo: vettingInfo || undefined,
      boosts: 0,
      spotsTotal,
      authorName: reqAuthorName || approval.name,
      authorRole: reqAuthorRole || "Citizen Activist",
      authorAvatarKey: null,
      topImageKey: null,
      topImageUrl: topImageUrl || null,
      imageContain: imageContain === true ? true : undefined,
      adminApproved: false,
      ...(offTopic ? { notOnTopic: true } : {}),
      createdAt: new Date().toISOString(),
      createdBy: user.id,
      toneOverride: toneOverride && Object.keys(toneOverride).length > 0 ? toneOverride : undefined,
      amplifiesGroups: Array.isArray(amplifiesGroups) && amplifiesGroups.length > 0 ? amplifiesGroups : undefined,
    };

    await kv.set(`user-action:${nextId}`, card);
    await kv.set("user-action:ids", [...currentIds, nextId]);
    invalidateActionsCache();
    console.log(`User ${approval.name} created ASK #${nextId}: "${title}"${offTopic ? " [AUTO-FLAGGED: off-topic]" : ""}`);
    return c.json({ card });
  } catch (err) {
    console.log("Create action error:", err);
    return c.json({ error: `Failed to create ASK: ${err}` }, 500);
  }
});

// ─── POST /actions/:id/complete — increment completions counter ───────────
// Self-reported "I did this" — anonymous (deduped client-side via localStorage)
// or authenticated (also writes a per-user record for the scoreboard).
app.post("/make-server-9eb1ae04/actions/:id/complete", async (c) => {
  try {
    const id = Number(c.req.param("id"));
    const { delta } = await c.req.json<{ delta: number }>();

    let card = await kv.get(`action:${id}`) as any;

    if (!card) {
      const seedCard = SEED_CARDS.find((s) => s.id === id);
      if (!seedCard) return c.json({ error: `Unknown card id ${id}` }, 404);
      card = { ...seedCard };
      await kv.set(`action:${id}`, card);
    }

    const current = typeof card.completions === "number" ? card.completions : 0;
    card.completions = Math.max(0, current + (delta ?? 1));
    await kv.set(`action:${id}`, card);

    // If a real user is signed in (anon-key tokens won't resolve to a user),
    // persist a per-user record so the scoreboard can aggregate by category.
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (token) {
      const user = await getUser(token);
      if (user) {
        const userKey = `complete:${user.id}:${id}`;
        if ((delta ?? 1) > 0) {
          await kv.set(userKey, {
            actionId: id,
            category: card.category ?? "OTHER",
            completedAt: new Date().toISOString(),
          });
        } else {
          await kv.del(userKey);
        }
      }
    }

    return c.json({ card });
  } catch (err) {
    console.log("Error updating completion count:", err);
    return c.json({ error: `Failed to update completion: ${err}` }, 500);
  }
});

// ─── GET /me/completions — scoreboard for the signed-in user ──────────────
app.get("/make-server-9eb1ae04/me/completions", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid or expired token" }, 401);

    const records = (await kv.getByPrefix(`complete:${user.id}:`)) as any[];
    const byCategory: Record<string, number> = {};
    const completedIds: number[] = [];
    for (const r of records ?? []) {
      if (!r) continue;
      const cat = (r.category ?? "OTHER").toString().toUpperCase();
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      if (typeof r.actionId === "number") completedIds.push(r.actionId);
    }
    return c.json({
      total: records?.length ?? 0,
      byCategory,
      completedIds,
    });
  } catch (err) {
    console.log("Error fetching completions:", err);
    return c.json({ error: `Failed: ${err}` }, 500);
  }
});

// ─── ADMIN: GET /admin/users/:id/activity — full activity dashboard ────────
// Returns the same shape as /me/completions (total, byCategory, completedIds)
// plus the user's approval record AND a reverse-chronological list of their
// last N completions enriched with the action title. The client computes the
// tier from `total` via getUserTier() — keeps the math in one place.
app.get("/make-server-9eb1ae04/admin/users/:id/activity", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const targetId = c.req.param("id");
    const approval = await kv.get(`user:approval:${targetId}`) as any;
    if (!approval) return c.json({ error: "User not found" }, 404);

    const records = ((await kv.getByPrefix(`complete:${targetId}:`)) ?? []) as any[];

    // Aggregate the counts.
    const byCategory: Record<string, number> = {};
    const completedIds: number[] = [];
    for (const r of records) {
      if (!r) continue;
      const cat = (r.category ?? "OTHER").toString().toUpperCase();
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      if (typeof r.actionId === "number") completedIds.push(r.actionId);
    }

    // Build the recent-activity timeline (last 50). Resolve action titles by
    // doing a single batch fetch — most cards live under `action:*` but a
    // handful are user-submitted under `user-action:*`, so try both.
    const sorted = [...records]
      .filter((r) => r?.completedAt)
      .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
      .slice(0, 50);

    const timeline = await Promise.all(sorted.map(async (r) => {
      let card = await kv.get(`action:${r.actionId}`) as any;
      if (!card) card = await kv.get(`user-action:${r.actionId}`) as any;
      return {
        actionId: r.actionId,
        category: r.category ?? "OTHER",
        completedAt: r.completedAt,
        title: card?.title ?? `Action #${r.actionId}`,
        targetUrl: card?.targetUrl ?? null,
      };
    }));

    const lastActiveAt = sorted[0]?.completedAt ?? null;

    return c.json({
      user: approval,
      total: records.length,
      byCategory,
      completedIds,
      lastActiveAt,
      timeline,
    });
  } catch (err) {
    console.log("Admin user activity error:", err);
    return c.json({ error: `Failed: ${err}` }, 500);
  }
});

// ─── GET /me/boosts — card IDs this user has boosted ─────────────────────────
app.get("/make-server-9eb1ae04/me/boosts", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid or expired token" }, 401);

    const records = (await kv.getByPrefix(`boost:${user.id}:`)) as any[];
    const boostedIds: number[] = (records ?? [])
      .filter(Boolean)
      .map((r: any) => r.actionId)
      .filter((id: unknown) => typeof id === "number");

    return c.json({ boostedIds });
  } catch (err) {
    return c.json({ error: `Failed: ${err}` }, 500);
  }
});

// ─── POST /actions/:id/act — increment boosts, return updated card ─────────
app.post("/make-server-9eb1ae04/actions/:id/act", async (c) => {
  try {
    const id = Number(c.req.param("id"));
    const { delta } = await c.req.json<{ delta: number }>();

    let card = await kv.get(`action:${id}`) as any;

    // Card missing (e.g. Act clicked before GET /actions seeded) — seed it now
    if (!card) {
      const seedCard = SEED_CARDS.find((s) => s.id === id);
      if (!seedCard) return c.json({ error: `Unknown card id ${id}` }, 404);
      card = { ...seedCard };
      await kv.set(`action:${id}`, card);
      console.log(`Lazily seeded card ${id} from Act handler.`);
    }

    const current = (typeof card.boosts === "number" ? card.boosts
                   : typeof card.spotsUsed === "number" ? card.spotsUsed
                   : 0);
    card.boosts = Math.max(0, current + (delta ?? 1));
    delete card.spotsUsed;
    await kv.set(`action:${id}`, card);

    // Track per-user boost so the matcher can personalise results.
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (token) {
      const user = await getUser(token);
      if (user) {
        const boostKey = `boost:${user.id}:${id}`;
        if ((delta ?? 1) > 0) {
          await kv.set(boostKey, { actionId: id, boostedAt: new Date().toISOString() });
        } else {
          await kv.del(boostKey);
        }
      }
    }

    return c.json({ card });
  } catch (err) {
    console.log("Error updating act count:", err);
    return c.json({ error: `Failed to update act: ${err}` }, 500);
  }
});

// ─── PUT /actions/:id — edit a card (admin or original author) ────────────────
app.put("/make-server-9eb1ae04/actions/:id", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);

    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid or expired token" }, 401);

    const approval = await kv.get(`user:approval:${user.id}`) as any;
    if (!approval || approval.status !== "approved") {
      return c.json({ error: "Your account must be approved to edit acts." }, 403);
    }

    const id = Number(c.req.param("id"));

    // Try seed card first, then user-created card
    let cardKey = `action:${id}`;
    let card = await kv.get(cardKey) as any;
    if (!card) {
      cardKey = `user-action:${id}`;
      card = await kv.get(cardKey) as any;
    }
    if (!card) return c.json({ error: `Card ${id} not found` }, 404);

    // Permission: admin can edit any card; others can only edit cards they created
    const isAdmin = approval.isAdmin === true;
    const isAuthor = card.createdBy && card.createdBy === user.id;
    if (!isAdmin && !isAuthor) {
      return c.json({ error: "You can only edit acts you created." }, 403);
    }

    const body = await c.req.json();

    // URL safety on edit too — admins are usually trustworthy but the QA
    // probe showed this is exactly the kind of field a careless paste could
    // poison. Validate every URL-bearing field present in the body.
    for (const field of ["targetUrl", "authorLink", "topImageUrl"]) {
      if (body[field] !== undefined) {
        const check = validateSubmittedUrl(body[field], field);
        if (!check.ok) return c.json({ error: check.reason }, 400);
      }
    }

    // Strip immutable fields. Admins can additionally set `boosts` directly
    // (used for moderation / corrections); non-admins cannot.
    //
    // SECURITY: `adminApproved` is also stripped here. Approval has a hard
    // image-presence requirement (enforced in /admin/approve-action/:id), and
    // the PUT endpoint has no such check — so accepting `adminApproved: true`
    // in a free-form edit body was a bypass for the image rule. Approval
    // must go through /admin/approve-action/:id only.
    const { id: _id, createdBy: _createdBy, createdAt: _createdAt,
            authorAvatarKey: _avatarKey, topImageKey: _topImageKey,
            adminApproved: _adminApproved,
            boosts: bodyBoosts, ...safeUpdates } = body;

    const updated: any = {
      ...card,
      ...safeUpdates,
      updatedAt: new Date().toISOString(),
      updatedBy: user.id,
    };
    if (isAdmin && typeof bodyBoosts === "number") {
      updated.boosts = Math.max(0, Math.floor(bodyBoosts));
      delete updated.spotsUsed;
    }

    await kv.set(cardKey, updated);
    invalidateActionsCache();
    console.log(`${approval.name} edited card #${id}: "${updated.title}"`);
    return c.json({ card: updated });
  } catch (err) {
    console.log("Edit card error:", err);
    return c.json({ error: `Failed to edit card: ${err}` }, 500);
  }
});

// ─── GET /admin/actions/pending — cards awaiting approval ────────────────────
app.get("/make-server-9eb1ae04/admin/actions/pending", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const pending: any[] = [];

    // Check all action: cards
    for (const card of (await kv.getByPrefix("action:")) as any[]) {
      if (card && typeof card === "object" && card.adminApproved !== true) {
        pending.push({ ...card, _store: "action" });
      }
    }

    // Check all user-created cards
    const userCardIds = (await kv.get("user-action:ids") ?? []) as number[];
    for (const id of userCardIds) {
      const card = await kv.get(`user-action:${id}`) as any;
      if (card && typeof card === "object" && card.adminApproved !== true) {
        pending.push({ ...card, _store: "user-action" });
      }
    }

    pending.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    console.log(`Admin ${admin.record.name} fetched ${pending.length} pending cards.`);
    return c.json({ cards: pending });
  } catch (err) {
    console.log("Pending actions error:", err);
    return c.json({ error: `Failed to fetch pending cards: ${err}` }, 500);
  }
});

// ─── POST /admin/approve-action/:id — approve a card ─────────────────────────
app.post("/make-server-9eb1ae04/admin/approve-action/:id", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const id = Number(c.req.param("id"));

    // Try seed card first, then user-created card
    let cardKey = `action:${id}`;
    let card = await kv.get(cardKey) as any;
    if (!card) {
      cardKey = `user-action:${id}`;
      card = await kv.get(cardKey) as any;
    }
    if (!card) return c.json({ error: `Card ${id} not found` }, 404);

    // Hard rule: a card cannot be approved without an image. Imageless cards
    // render as half-blank tiles in the public feed and look broken — admins
    // must upload one before they can flip approval on.
    const hasImage = Boolean(card.topImageUrl) || Boolean(card.topImageKey) || Boolean(card.topImage);
    if (!hasImage) {
      return c.json({ error: "Card has no image. Upload a header image before approving." }, 400);
    }

    // Defense-in-depth: even if dirty URLs slipped past create-time validation
    // (older records pre-dating that guard), block them here at the last gate
    // before the card goes public.
    for (const field of ["targetUrl", "authorLink", "topImageUrl"]) {
      const check = validateSubmittedUrl(card[field], field);
      if (!check.ok) return c.json({ error: `${check.reason} Edit the card to fix it before approving.` }, 400);
    }

    card.adminApproved = true;
    card.approvedBy = admin.user.id;
    card.approvedAt = new Date().toISOString();
    // Approval implies the admin disagrees with any off-topic signal — clear
    // it so the card doesn't carry a stale "NOT ON TOPIC" badge into live.
    if (card.notOnTopic) delete card.notOnTopic;
    await kv.set(cardKey, card);
    invalidateActionsCache();
    console.log(`Admin ${admin.record.name} approved card #${id}: "${card.title}"`);
    return c.json({ card });
  } catch (err) {
    return c.json({ error: `Approval failed: ${err}` }, 500);
  }
});

// ─── POST /admin/bulk-import — cron-driven import from co-work scout output ──
// Auth: shared static token in Deno env `ADMIN_IMPORT_TOKEN` (not a user JWT)
// so a scheduled remote agent can post without impersonating a user.
// Cards land in user-action storage with `adminApproved: false`, surfacing
// in the AdminPanel "Pending" tab for manual one-click approval.
const BULK_IMPORT_CATEGORY_COLORS: Record<string, string> = {
  "ACT OF KINDNESS": "#0d8c6e",
  "ART PIECE": "#896312",
  "BIRD-DOG": "#3f3f3f",
  "BOOST": "#8a00e6",
  "BOYCOTT": "#7a1f7a",
  "CALL/WRITE": "#c2185b",
  "CRAFTING": "#c34e00",
  "EMAIL CAMPAIGN": "#c2185b",
  "FLASH MOB": "#ff00d5",
  "FUNDING": "#127f05",
  "HOST": "#3f3f3f",
  "HOUSING": "#0a5b89",
  "IRREVERENCE": "#9333ea",
  "JOIN A GROUP": "#9c2779",
  "LABOR": "#a83f1c",
  "LEARN": "#3f3f3f",
  "LETTER TO EDITOR": "#3f5c8c",
  "LETTER WRITING": "#2d7a6b",
  "MEETING": "#5a3e9e",
  "MENTAL HEALTH": "#6b5b95",
  "NEWS STORY": "#3b4a73",
  "OTHER": "#3f3f3f",
  "PERSONAL COMMITMENT": "#5e1f7a",
  "PETITION": "#05737f",
  "PRAYER": "#7d6321",
  "PROFESSIONAL SKILLS": "#1f635c",
  "PROTEST": "#23297e",
  "PURCHASE": "#b45309",
  "SHOW UP": "#3f3f3f",
  "SOCIAL MEDIA": "#e44b4b",
  "SPREAD POSITIVITY": "#d97706",
  "TRAINING": "#126d89",
  "TRANSPORTATION": "#0a6e3f",
  "WITNESS": "#3f3f3f",
};

function normalizeBulkImportUrl(u: string): string {
  if (!u) return "";
  try {
    const p = new URL(u);
    return (p.hostname + p.pathname).toLowerCase().replace(/\/+$/, "");
  } catch {
    return u.toLowerCase().trim();
  }
}

// Fingerprint on (normalized URL + lowercased title) so a batch with many
// distinct events linking to the same aggregator hub (e.g. 13 rallies all
// pointing at mobilize.us/?q=tesla+takedown) doesn't dedupe-collide. Same
// URL + same title = real dupe; same URL + different titles = different
// events that share a hub page.
async function bulkImportFingerprint(targetUrl: string, title: string): Promise<string> {
  const key = `${normalizeBulkImportUrl(targetUrl)}::${title.toLowerCase().trim()}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

app.post("/make-server-9eb1ae04/admin/bulk-import", async (c) => {
  try {
    // Static admin token in a custom header, NOT Authorization — the Edge
    // Function gateway validates the Authorization header as a Supabase JWT
    // (anon key) before our handler runs, so we can't use it for our token.
    const token = c.req.header("X-Admin-Import-Token");
    const expected = Deno.env.get("ADMIN_IMPORT_TOKEN");
    if (!expected) return c.json({ error: "ADMIN_IMPORT_TOKEN not configured on server" }, 500);
    if (!token || token !== expected) return c.json({ error: "Forbidden" }, 403);

    const body = await c.req.json<{ cards?: any[]; sourceBatch?: string }>();
    const cards = Array.isArray(body.cards) ? body.cards : [];
    if (cards.length === 0) return c.json({ error: "cards array required" }, 400);

    const currentIds = (await kv.get("user-action:ids") ?? []) as number[];
    let nextId = Math.max(...currentIds, 1271) + 1;
    const updatedIds = [...currentIds];

    const created: { id: number; title: string }[] = [];
    const skipped: { title: string; reason: string; existingId?: number }[] = [];
    const errors: { title: string; error: string }[] = [];

    for (const raw of cards) {
      try {
        const title = String(raw.title ?? "").trim();
        const description = String(raw.description ?? "").trim();
        const rawCategory = String(raw.category ?? "").trim().toUpperCase();
        const targetUrl = String(raw.targetUrl ?? "").trim();

        if (!title || !description || !rawCategory) {
          errors.push({ title: title || "(no title)", error: "title, description, category required" });
          continue;
        }
        const categoryColor = BULK_IMPORT_CATEGORY_COLORS[rawCategory] ?? BULK_IMPORT_CATEGORY_COLORS.OTHER;

        if (targetUrl) {
          const fp = await bulkImportFingerprint(targetUrl, title);
          const existing = await kv.get(`bulk-import:fp:${fp}`) as any;
          if (existing?.id) {
            skipped.push({ title, reason: "duplicate (url+title)", existingId: existing.id });
            continue;
          }
        }

        const isOnline = raw.isOnline === true ||
          (typeof raw.location === "string" && raw.location.toLowerCase() === "online");
        const location = isOnline ? undefined : (raw.location ? String(raw.location).trim() : undefined);

        const id = nextId++;
        const card: any = {
          id,
          category: rawCategory,
          categoryColor,
          title,
          description,
          location,
          isOnline,
          actionType: isOnline ? "Online" : "In Person Group",
          boosts: 0,
          spotsTotal: raw.spotsTotal ?? "Unlimited",
          authorName: String(raw.authorName ?? "Unknown").trim(),
          authorRole: String(raw.authorRole ?? "Movement Organization").trim(),
          targetUrl: targetUrl || undefined,
          topImageKey: null,
          topImageUrl: raw.topImageUrl ?? null,
          adminApproved: false,
          createdAt: new Date().toISOString(),
          createdBy: "bulk-import",
          importSource: body.sourceBatch ?? "co-work",
          sourceUrl: raw.sourceUrl ?? undefined,
          eventDate: raw.eventDate ?? undefined,
          vettingInfo: raw.vettingInfo ?? undefined,
          toneOverride: (raw.toneOverride && typeof raw.toneOverride === "object" && Object.keys(raw.toneOverride).length > 0)
            ? raw.toneOverride : undefined,
          amplifiesGroups: Array.isArray(raw.amplifiesGroups) && raw.amplifiesGroups.length > 0
            ? raw.amplifiesGroups : undefined,
        };

        await kv.set(`user-action:${id}`, card);
        updatedIds.push(id);
        if (targetUrl) {
          const fp = await bulkImportFingerprint(targetUrl, title);
          await kv.set(`bulk-import:fp:${fp}`, { id, importedAt: card.createdAt, targetUrl: normalizeBulkImportUrl(targetUrl), title });
        }
        created.push({ id, title });
      } catch (rowErr) {
        errors.push({ title: String(raw.title ?? "(unknown)"), error: String(rowErr) });
      }
    }

    if (created.length > 0) {
      await kv.set("user-action:ids", updatedIds);
    }

    console.log(`bulk-import: created=${created.length} skipped=${skipped.length} errors=${errors.length} (source: ${body.sourceBatch ?? "co-work"})`);
    return c.json({ created, skipped, errors });
  } catch (err) {
    console.log("Bulk import error:", err);
    return c.json({ error: `Bulk import failed: ${err}` }, 500);
  }
});

// ─── POST /admin/bulk-update-time-commitment — audit-driven time fixes ───────
// Same auth pattern as bulk-import (static admin token, NOT a user JWT). Built
// for the 2026-05-17 time-commitment audit and reusable for future passes.
// Only `timeCommitment` and `quickAction` are touched; everything else on the
// card is preserved. Supports dryRun:true to preview without writing.
const VALID_TIME_COMMITMENTS = new Set([
  "< 1 hour", "5–10 minutes", "1–3 hours", "Full day", "Ongoing",
]);

app.post("/make-server-9eb1ae04/admin/bulk-update-time-commitment", async (c) => {
  try {
    const token = c.req.header("X-Admin-Import-Token");
    const expected = Deno.env.get("ADMIN_IMPORT_TOKEN");
    if (!expected) return c.json({ error: "ADMIN_IMPORT_TOKEN not configured on server" }, 500);
    if (!token || token !== expected) return c.json({ error: "Forbidden" }, 403);

    const body = await c.req.json<{ updates?: any[]; dryRun?: boolean }>();
    const updates = Array.isArray(body.updates) ? body.updates : [];
    const dryRun = body.dryRun === true;
    if (updates.length === 0) return c.json({ error: "updates array required" }, 400);

    const updated: any[] = [];
    const notFound: any[] = [];
    const errors:   any[] = [];

    for (const u of updates) {
      try {
        const id = Number(u.id);
        const tc = String(u.timeCommitment ?? "");
        const qa = u.quickAction === true;
        if (!Number.isFinite(id)) { errors.push({ id: u.id, error: "id must be a number" }); continue; }
        if (!VALID_TIME_COMMITMENTS.has(tc)) {
          errors.push({ id, error: `invalid timeCommitment: "${tc}"` }); continue;
        }

        let cardKey = `action:${id}`;
        let card = await kv.get(cardKey) as any;
        if (!card) {
          cardKey = `user-action:${id}`;
          card = await kv.get(cardKey) as any;
        }
        if (!card) { notFound.push({ id }); continue; }

        const before = { timeCommitment: card.timeCommitment ?? null, quickAction: card.quickAction ?? null };
        const after  = { timeCommitment: tc, quickAction: qa };

        if (!dryRun) {
          await kv.set(cardKey, {
            ...card,
            timeCommitment: tc,
            quickAction: qa,
            updatedAt: new Date().toISOString(),
            updatedBy: "bulk-update-time",
          });
        }
        updated.push({ id, title: card.title, before, after });
      } catch (rowErr) {
        errors.push({ id: u?.id, error: String(rowErr) });
      }
    }

    console.log(`bulk-update-time: updated=${updated.length} notFound=${notFound.length} errors=${errors.length} dryRun=${dryRun}`);
    return c.json({ updated, notFound, errors, dryRun });
  } catch (err) {
    console.log("Bulk update time error:", err);
    return c.json({ error: `Bulk update failed: ${err}` }, 500);
  }
});

// ─── POST /admin/flag-off-topic/:id — mark a card as not-on-topic ────────────
app.post("/make-server-9eb1ae04/admin/flag-off-topic/:id", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const id = Number(c.req.param("id"));

    let cardKey = `action:${id}`;
    let card = await kv.get(cardKey) as any;
    if (!card) {
      cardKey = `user-action:${id}`;
      card = await kv.get(cardKey) as any;
    }
    if (!card) return c.json({ error: `Card ${id} not found` }, 404);

    card.adminApproved = false;
    card.notOnTopic = true;
    card.flaggedBy = admin.user.id;
    card.flaggedAt = new Date().toISOString();
    await kv.set(cardKey, card);
    invalidateActionsCache();
    console.log(`Admin ${admin.record.name} flagged card #${id} as off-topic: "${card.title}"`);
    return c.json({ card });
  } catch (err) {
    return c.json({ error: `Flag failed: ${err}` }, 500);
  }
});

// ─── POST /admin/unflag-off-topic/:id — clear a not-on-topic flag ────────────
app.post("/make-server-9eb1ae04/admin/unflag-off-topic/:id", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const id = Number(c.req.param("id"));

    let cardKey = `action:${id}`;
    let card = await kv.get(cardKey) as any;
    if (!card) {
      cardKey = `user-action:${id}`;
      card = await kv.get(cardKey) as any;
    }
    if (!card) return c.json({ error: `Card ${id} not found` }, 404);

    delete card.notOnTopic;
    delete card.flaggedBy;
    delete card.flaggedAt;
    await kv.set(cardKey, card);
    invalidateActionsCache();
    console.log(`Admin ${admin.record.name} cleared off-topic flag on card #${id}: "${card.title}"`);
    return c.json({ card });
  } catch (err) {
    return c.json({ error: `Unflag failed: ${err}` }, 500);
  }
});

// ─── POST /actions/upload-image — upload to Supabase Storage, return URL ─────
// Any authenticated user can upload. Approval is checked when the card is
// submitted, not at image upload time — new users need to upload a photo
// before their account is approved.
app.post("/make-server-9eb1ae04/actions/upload-image", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);

    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid or expired token" }, 401);

    const body = await c.req.parseBody();
    const file = body.file;
    if (!file || typeof file === "string") {
      return c.json({ error: "No file provided." }, 400);
    }

    // Type + size checks
    if (!file.type?.startsWith("image/")) {
      return c.json({ error: "File must be an image." }, 400);
    }
    const MAX_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      return c.json({ error: "Image too large (max 5 MB)." }, 400);
    }

    const supabase = adminClient();
    const BUCKET = "action-images";

    // Idempotently ensure the bucket exists and is public.
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.some((b) => b.name === BUCKET)) {
      const { error: createErr } = await supabase.storage.createBucket(BUCKET, { public: true });
      if (createErr) {
        console.log("Bucket creation error:", createErr);
        return c.json({ error: `Storage setup failed: ${createErr.message}` }, 500);
      }
    }

    const ext = (file.name?.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const key = `${crypto.randomUUID()}.${ext}`;
    const buf = await file.arrayBuffer();

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(key, buf, { contentType: file.type, upsert: false });
    if (upErr) {
      console.log("Upload error:", upErr);
      return c.json({ error: `Upload failed: ${upErr.message}` }, 500);
    }

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(key);
    return c.json({ url: urlData.publicUrl });
  } catch (err) {
    console.log("upload-image error:", err);
    return c.json({ error: `Upload error: ${err}` }, 500);
  }
});

// ─── POST /admin/actions/:id/recompress-image — shrink a stored card image ───
// Admin-only. Fetches the card's current `topImageUrl` (must be a Supabase
// storage URL we host), resizes to max 1200px width if larger, re-encodes in
// the same format (PNG or JPEG), uploads the new bytes, and updates the card.
// Skips WebP/AVIF/GIF inputs (imagescript can't decode them or they're already
// optimized). Returns the size before/after.
const RECOMPRESS_MAX_WIDTH = 1200;
const STORAGE_PREFIX = "zkihnylrvdofdbnhmmoq.supabase.co/storage";
app.post("/make-server-9eb1ae04/admin/actions/:id/recompress-image", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const idStr = c.req.param("id");
    const id = Number(idStr);
    if (!Number.isFinite(id)) return c.json({ error: "Invalid id" }, 400);

    // Find the card — try user-action first (more recent), then action.
    let prefix = "user-action:";
    let card = (await kv.get(`${prefix}${id}`)) as any;
    if (!card) {
      prefix = "action:";
      card = (await kv.get(`${prefix}${id}`)) as any;
    }
    if (!card) return c.json({ error: `Card ${id} not found` }, 404);

    const url = card.topImageUrl;
    if (!url) return c.json({ error: "Card has no topImageUrl to recompress" }, 400);
    if (!url.includes(STORAGE_PREFIX)) {
      return c.json({ error: "Can only recompress images hosted in our own Supabase storage" }, 400);
    }

    // Fetch the existing image.
    const res = await fetch(url);
    if (!res.ok) return c.json({ error: `Image fetch failed (${res.status})` }, 502);
    const oldBuf = new Uint8Array(await res.arrayBuffer());
    const oldSize = oldBuf.length;
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();

    // Format filter: imagescript handles PNG + JPEG. Skip everything else.
    let format: "png" | "jpeg";
    if (contentType.includes("png")) format = "png";
    else if (contentType.includes("jpeg") || contentType.includes("jpg")) format = "jpeg";
    else {
      return c.json({
        skipped: true,
        reason: `Unsupported content type for recompression: ${contentType || "unknown"}`,
        oldSize,
      });
    }

    // Decode + optionally resize.
    const img = await Image.decode(oldBuf);
    const origWidth = img.width;
    const origHeight = img.height;
    let processed = img;
    if (origWidth > RECOMPRESS_MAX_WIDTH) {
      processed = img.resize(RECOMPRESS_MAX_WIDTH, Image.RESIZE_AUTO);
    }

    // Re-encode in the same format.
    let newBuf: Uint8Array;
    let ext: string;
    let mime: string;
    if (format === "png") {
      newBuf = await processed.encode();
      ext = "png";
      mime = "image/png";
    } else {
      newBuf = await processed.encodeJPEG(85);
      ext = "jpg";
      mime = "image/jpeg";
    }

    if (newBuf.length >= oldSize) {
      return c.json({
        skipped: true,
        reason: "Recompressed bytes not smaller than original — leaving as-is.",
        oldSize,
        newSize: newBuf.length,
        originalWidth: origWidth,
        originalHeight: origHeight,
      });
    }

    // Upload + update card.
    const supabase = adminClient();
    const BUCKET = "action-images";
    const key = `recompressed-${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(key, newBuf, { contentType: mime, upsert: false });
    if (upErr) return c.json({ error: `Upload failed: ${upErr.message}` }, 500);
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(key);
    const newUrl = urlData.publicUrl;

    await kv.set(`${prefix}${id}`, { ...card, topImageUrl: newUrl });
    console.log(`Admin ${admin.record.name} recompressed card #${id}: ${oldSize} → ${newBuf.length} bytes (${origWidth}x${origHeight} → ${processed.width}x${processed.height})`);

    return c.json({
      success: true,
      oldSize,
      newSize: newBuf.length,
      savings: oldSize - newBuf.length,
      savingsPct: Math.round(100 * (1 - newBuf.length / oldSize)),
      originalWidth: origWidth,
      originalHeight: origHeight,
      newWidth: processed.width,
      newHeight: processed.height,
      newUrl,
    });
  } catch (err) {
    console.log("Recompress error:", err);
    return c.json({ error: `Recompress failed: ${err}` }, 500);
  }
});

// ─── GET /admin/actions/big-images — list cards whose image is oversized ─────
// Admin-only. Iterates all cards (both stores), HEADs each Supabase storage
// URL, returns those with content-length above `threshold` (default 500_000).
// Slower than a normal list because of N HEAD requests; the admin UI calls it
// on-demand when the operator opens the "Big images" tab.
app.get("/make-server-9eb1ae04/admin/actions/big-images", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const threshold = Math.max(1024, Number(c.req.query("threshold") ?? 500_000));

    // Collect every card from both stores.
    const cards: any[] = [];
    for (const c2 of (await kv.getByPrefix("action:")) as any[]) {
      if (c2 && typeof c2 === "object" && typeof c2.id === "number") cards.push({ ...c2, _store: "action" });
    }
    const userIds = ((await kv.get("user-action:ids")) ?? []) as number[];
    for (const id of userIds) {
      const cc = (await kv.get(`user-action:${id}`)) as any;
      if (cc && typeof cc === "object" && typeof cc.id === "number") cards.push({ ...cc, _store: "user-action" });
    }

    // HEAD each Supabase storage URL in parallel batches.
    const candidates = cards.filter((c2) => typeof c2.topImageUrl === "string" && c2.topImageUrl.includes(STORAGE_PREFIX));
    const big: any[] = [];
    const BATCH = 12;
    for (let i = 0; i < candidates.length; i += BATCH) {
      const slice = candidates.slice(i, i + BATCH);
      const results = await Promise.all(slice.map(async (c2) => {
        try {
          const r = await fetch(c2.topImageUrl, { method: "HEAD" });
          if (!r.ok) return null;
          const size = Number(r.headers.get("content-length") ?? "0");
          const ct = r.headers.get("content-type") ?? "?";
          return { card: c2, size, contentType: ct };
        } catch {
          return null;
        }
      }));
      for (const r of results) {
        if (r && r.size >= threshold) {
          big.push({
            id: r.card.id,
            title: r.card.title,
            authorName: r.card.authorName,
            topImageUrl: r.card.topImageUrl,
            size: r.size,
            contentType: r.contentType,
            _store: r.card._store,
          });
        }
      }
    }
    big.sort((a, b) => b.size - a.size);
    return c.json({ cards: big, threshold, total: big.length });
  } catch (err) {
    console.log("Big-images error:", err);
    return c.json({ error: `Failed to list big images: ${err}` }, 500);
  }
});

// ─── GET /admin/actions/url-equals-authorlink — same-URL audit ───────────────
// Admin-only. Lists every card where `targetUrl` and `authorLink` resolve to
// the same URL after a light normalization (lowercase, trailing slash dropped).
// Usually means the bulk-importer pointed both fields at the same source page
// and there's no distinct creator / "more from this author" link to surface.
app.get("/make-server-9eb1ae04/admin/actions/url-equals-authorlink", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const norm = (u: unknown): string => {
      if (typeof u !== "string") return "";
      const t = u.trim().toLowerCase();
      if (!t) return "";
      try {
        const p = new URL(t);
        return (p.hostname + p.pathname + p.search).replace(/\/+$/, "");
      } catch {
        return t.replace(/\/+$/, "");
      }
    };

    const matches: any[] = [];

    const consider = (cc: any, store: string) => {
      if (!cc || typeof cc !== "object" || typeof cc.id !== "number") return;
      const t = norm(cc.targetUrl);
      const a = norm(cc.authorLink);
      if (!t || !a) return;
      if (t !== a) return;
      matches.push({
        id: cc.id,
        title: cc.title,
        authorName: cc.authorName,
        targetUrl: cc.targetUrl,
        authorLink: cc.authorLink,
        adminApproved: cc.adminApproved,
        _store: store,
      });
    };

    for (const cc of (await kv.getByPrefix("action:")) as any[]) consider(cc, "action");
    const userIds = ((await kv.get("user-action:ids")) ?? []) as number[];
    for (const id of userIds) {
      const cc = (await kv.get(`user-action:${id}`)) as any;
      consider(cc, "user-action");
    }

    matches.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    return c.json({ total: matches.length, cards: matches });
  } catch (err) {
    console.log("url-equals-authorlink error:", err);
    return c.json({ error: `Audit failed: ${err}` }, 500);
  }
});

// ─── GET /admin/actions/broken-images — list cards whose topImageUrl 404s ────
// Admin-only. Walks every card from both stores, HEADs each `topImageUrl`. For
// root-relative paths (e.g. "/people-power-united.jpg") prepends `origin`
// (default https://resistact.org) so we can verify the file is actually being
// served by the frontend. Slow (N HEAD requests); the admin UI calls it
// on-demand. Returns cards whose check returned non-2xx or network error.
const DEFAULT_FRONTEND_ORIGIN = "https://resistact.org";
app.get("/make-server-9eb1ae04/admin/actions/broken-images", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const originRaw = c.req.query("origin") || DEFAULT_FRONTEND_ORIGIN;
    if (!/^https?:\/\//.test(originRaw)) return c.json({ error: "origin must start with http(s)://" }, 400);
    const origin = originRaw.replace(/\/$/, "");

    // Collect all cards.
    const cards: any[] = [];
    for (const cc of (await kv.getByPrefix("action:")) as any[]) {
      if (cc && typeof cc === "object" && typeof cc.id === "number") cards.push({ ...cc, _store: "action" });
    }
    const userIds = ((await kv.get("user-action:ids")) ?? []) as number[];
    for (const id of userIds) {
      const cc = (await kv.get(`user-action:${id}`)) as any;
      if (cc && typeof cc === "object" && typeof cc.id === "number") cards.push({ ...cc, _store: "user-action" });
    }

    const candidates = cards.filter((cc) => typeof cc.topImageUrl === "string" && cc.topImageUrl.length > 0);
    const broken: any[] = [];
    const BATCH = 12;
    for (let i = 0; i < candidates.length; i += BATCH) {
      const slice = candidates.slice(i, i + BATCH);
      const results = await Promise.all(slice.map(async (cc) => {
        const raw = cc.topImageUrl as string;
        const url = raw.startsWith("/") ? `${origin}${raw}` : raw;
        try {
          const r = await fetch(url, { method: "HEAD" });
          if (r.ok) return null;
          return { card: cc, status: r.status, fullUrl: url, error: null };
        } catch (e) {
          return { card: cc, status: 0, fullUrl: url, error: String(e) };
        }
      }));
      for (const r of results) if (r) broken.push(r);
    }

    broken.sort((a, b) => (a.card.id ?? 0) - (b.card.id ?? 0));
    return c.json({
      origin,
      scanned: candidates.length,
      total: broken.length,
      cards: broken.map((b) => ({
        id: b.card.id,
        title: b.card.title,
        authorName: b.card.authorName,
        topImageUrl: b.card.topImageUrl,
        fullUrl: b.fullUrl,
        status: b.status,
        error: b.error,
        adminApproved: b.card.adminApproved,
        _store: b.card._store,
      })),
    });
  } catch (err) {
    console.log("Broken-images error:", err);
    return c.json({ error: `Failed to scan broken images: ${err}` }, 500);
  }
});

// ─── DELETE /actions/:id — admin-only card removal ────────────────────────────
app.delete("/make-server-9eb1ae04/actions/:id", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const id = Number(c.req.param("id"));

    // Try seed card first
    const seedCard = await kv.get(`action:${id}`);
    if (seedCard) {
      await kv.del(`action:${id}`);
      invalidateActionsCache();
      console.log(`Admin ${admin.record.name} deleted seed card #${id}`);
      return c.json({ success: true });
    }

    // Try user-created card
    const userCard = await kv.get(`user-action:${id}`);
    if (userCard) {
      await kv.del(`user-action:${id}`);
      const currentIds = (await kv.get("user-action:ids") ?? []) as number[];
      await kv.set("user-action:ids", currentIds.filter((x) => x !== id));
      invalidateActionsCache();
      console.log(`Admin ${admin.record.name} deleted user card #${id}`);
      return c.json({ success: true });
    }

    return c.json({ error: `Card ${id} not found` }, 404);
  } catch (err) {
    console.log("Delete card error:", err);
    return c.json({ error: `Failed to delete card: ${err}` }, 500);
  }
});

// ─── POST /feedback — collect beta user feedback ─────────────────────────────
app.post("/make-server-9eb1ae04/feedback", async (c) => {
  try {
    const body = await c.req.json();
    const { type, message, email, name } = body;
    if (!message?.trim()) return c.json({ error: "Message required" }, 400);

    const id = Date.now();
    const cleanType = type || "general";
    const cleanMessage = String(message).trim().slice(0, 5000);
    const cleanEmail = email ? String(email).trim().slice(0, 200) : null;
    const cleanName = name ? String(name).trim().slice(0, 200) : null;
    const createdAt = new Date().toISOString();

    const entry = {
      id,
      type: cleanType,
      message: cleanMessage,
      email: cleanEmail,
      name: cleanName,
      createdAt,
      userAgent: c.req.header("user-agent")?.slice(0, 300) ?? null,
    };

    // Always store in KV
    await kv.set(`feedback:${id}`, entry);
    const ids = ((await kv.get("feedback:ids")) ?? []) as number[];
    await kv.set("feedback:ids", [...ids, id]);

    // Send email notification via Resend
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      const from = cleanName || cleanEmail || "Anonymous";
      const typeLabels: Record<string, string> = {
        bug: "Bug report",
        feature: "Feature request",
        general: "General feedback",
        other: "Other",
      };
      const typeLabel = typeLabels[cleanType] ?? cleanType;
      const emailBody = [
        `Type: ${typeLabel}`,
        cleanName  ? `Name: ${cleanName}`   : null,
        cleanEmail ? `Email: ${cleanEmail}` : null,
        ``,
        cleanMessage,
        ``,
        `Submitted: ${createdAt}`,
      ].filter((l) => l !== null).join("\n");

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "ResistAct <noreply@resistact.us>",
          to: ["ellen@meserow.com"],
          subject: `ResistAct Feedback from ${from}`,
          text: emailBody,
        }),
      }).catch((err) => console.log("Feedback email error:", err));
    }

    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: `Failed: ${err}` }, 500);
  }
});

// ─── GET /admin/feedback — view all feedback submissions ─────────────────────
app.get("/make-server-9eb1ae04/admin/feedback", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const ids = ((await kv.get("feedback:ids")) ?? []) as number[];
    const entries = await Promise.all(ids.map((id) => kv.get(`feedback:${id}`)));
    return c.json(entries.filter(Boolean).reverse());
  } catch (err) {
    return c.json({ error: `Failed: ${err}` }, 500);
  }
});

// ─── URL health: probe every card's targetUrl, flag the broken ones ──────────
// scan endpoint is cron-triggered (static token, same pattern as bulk-import);
// viewer is admin JWT. Result blob lives at kv key `url-health:last-scan` so
// follow-up calls overwrite the previous report rather than accumulating.
type UrlHealthEntry = {
  id: number;
  store: "action" | "user-action";
  title: string;
  targetUrl: string;
  status: number | null;
  ok: boolean;
  error?: string;
  checkedAt: string;
};

async function probeUrl(url: string, timeoutMs: number): Promise<{ status: number | null; ok: boolean; error?: string }> {
  const ua = "ResistActUrlHealthBot/1.0 (+https://resistact.org)";
  const tryFetch = async (method: "HEAD" | "GET"): Promise<Response> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method,
        redirect: "follow",
        signal: ctrl.signal,
        headers: method === "GET"
          ? { "User-Agent": ua, "Range": "bytes=0-0", "Accept": "*/*" }
          : { "User-Agent": ua, "Accept": "*/*" },
      });
    } finally {
      clearTimeout(t);
    }
  };

  try {
    let res = await tryFetch("HEAD");
    // Many sites (Cloudflare, Facebook) return 403/405 for HEAD — fall back to a single-byte GET.
    if (res.status === 403 || res.status === 405 || res.status === 501) {
      res = await tryFetch("GET");
    }
    return { status: res.status, ok: res.status >= 200 && res.status < 400 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: null, ok: false, error: msg.slice(0, 200) };
  }
}

app.post("/make-server-9eb1ae04/admin/url-health/scan", async (c) => {
  try {
    // Static token (same scheme as bulk-import) so a scheduled remote agent can post.
    const token = c.req.header("X-Admin-Import-Token");
    const expected = Deno.env.get("ADMIN_IMPORT_TOKEN");
    if (!expected) return c.json({ error: "ADMIN_IMPORT_TOKEN not configured on server" }, 500);
    if (!token || token !== expected) return c.json({ error: "Forbidden" }, 403);

    const body = await c.req.json<{ offset?: number; limit?: number; timeoutMs?: number; concurrency?: number }>().catch(() => ({}));
    const offset = Math.max(0, Number(body.offset) || 0);
    const limit = Math.min(1000, Math.max(1, Number(body.limit) || 250));
    const timeoutMs = Math.min(15000, Math.max(1000, Number(body.timeoutMs) || 6000));
    const concurrency = Math.min(32, Math.max(1, Number(body.concurrency) || 16));

    // Gather every card that has a targetUrl, across both seed and user-submitted stores.
    const targets: { id: number; store: "action" | "user-action"; title: string; targetUrl: string }[] = [];
    for (const card of (await kv.getByPrefix("action:")) as any[]) {
      if (card && typeof card === "object" && typeof card.id === "number" && typeof card.targetUrl === "string" && card.targetUrl.startsWith("http")) {
        targets.push({ id: card.id, store: "action", title: card.title ?? "", targetUrl: card.targetUrl });
      }
    }
    for (const card of (await kv.getByPrefix("user-action:")) as any[]) {
      if (card && typeof card === "object" && typeof card.id === "number" && typeof card.targetUrl === "string" && card.targetUrl.startsWith("http")) {
        targets.push({ id: card.id, store: "user-action", title: card.title ?? "", targetUrl: card.targetUrl });
      }
    }
    targets.sort((a, b) => a.id - b.id);

    const slice = targets.slice(offset, offset + limit);
    const results: UrlHealthEntry[] = [];
    const checkedAt = new Date().toISOString();

    // Bounded concurrency: walk a shared queue with N workers.
    let cursor = 0;
    const worker = async () => {
      while (true) {
        const i = cursor++;
        if (i >= slice.length) return;
        const t = slice[i];
        const r = await probeUrl(t.targetUrl, timeoutMs);
        results.push({ id: t.id, store: t.store, title: t.title, targetUrl: t.targetUrl, status: r.status, ok: r.ok, error: r.error, checkedAt });
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    // Merge with the previous run so paginated scans build up one coherent report.
    // Replace any entries with the same (store, id) — the latest check wins.
    const prev = ((await kv.get("url-health:last-scan")) as any) ?? null;
    const carryover: UrlHealthEntry[] = (offset > 0 && prev?.entries) ? prev.entries : [];
    const seen = new Set(results.map((r) => `${r.store}:${r.id}`));
    const merged = [...results, ...carryover.filter((e) => !seen.has(`${e.store}:${e.id}`))];

    const broken = merged.filter((e) => !e.ok);
    const summary = {
      scannedAt: prev?.scannedAt && offset > 0 ? prev.scannedAt : checkedAt,
      lastBatchAt: checkedAt,
      totalCards: targets.length,
      processedInBatch: slice.length,
      brokenCount: broken.length,
      okCount: merged.length - broken.length,
      nextOffset: offset + slice.length < targets.length ? offset + slice.length : null,
      entries: merged,
    };
    await kv.set("url-health:last-scan", summary);

    console.log(`url-health: batch [${offset}, ${offset + slice.length}) of ${targets.length} — ${broken.length} broken across full report`);
    return c.json({
      scannedAt: summary.scannedAt,
      lastBatchAt: summary.lastBatchAt,
      totalCards: summary.totalCards,
      processedInBatch: summary.processedInBatch,
      brokenCount: summary.brokenCount,
      okCount: summary.okCount,
      nextOffset: summary.nextOffset,
    });
  } catch (err) {
    console.log("url-health scan error:", err);
    return c.json({ error: `URL health scan failed: ${err}` }, 500);
  }
});

app.get("/make-server-9eb1ae04/admin/url-health", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const report = ((await kv.get("url-health:last-scan")) as any) ?? null;
    if (!report) return c.json({ scannedAt: null, broken: [], okCount: 0, totalCards: 0 });

    const onlyBroken = c.req.query("onlyBroken") !== "false";
    const entries: UrlHealthEntry[] = report.entries ?? [];
    const filtered = onlyBroken ? entries.filter((e) => !e.ok) : entries;
    filtered.sort((a, b) => (a.status ?? 999) - (b.status ?? 999) || a.id - b.id);

    return c.json({
      scannedAt: report.scannedAt,
      lastBatchAt: report.lastBatchAt,
      totalCards: report.totalCards,
      brokenCount: report.brokenCount,
      okCount: report.okCount,
      nextOffset: report.nextOffset,
      cards: filtered,
    });
  } catch (err) {
    return c.json({ error: `Failed: ${err}` }, 500);
  }
});

// ─── POST /actions/:id/flag ──────────────────────────────────────────────────
// Lets any visitor (anonymous or signed-in) flag an act for admin review.
// Stored under `flag:<flagId>` so kv.getByPrefix("flag:") can list them.
// reason: one of the radio choices on the modal; detail: optional free-text.
app.post("/make-server-9eb1ae04/actions/:id/flag", async (c) => {
  try {
    const cardId = Number(c.req.param("id"));
    if (!Number.isFinite(cardId)) return c.json({ error: "Invalid card id" }, 400);

    const body = await c.req.json<{ reason?: string; detail?: string }>().catch(() => ({}));
    const reason = (body.reason ?? "other").toString().slice(0, 64);
    const detail = (body.detail ?? "").toString().slice(0, 500);

    // Confirm the card exists in either the seed-card pool or the user-submitted
    // pool. Don't return 404 to the user even if it doesn't — a flag on a stale
    // card id is still useful signal — but tag it on the record.
    const seedCard = await kv.get(`action:${cardId}`);
    const userCard = seedCard ? null : await kv.get(`user-action:${cardId}`);
    const cardTitle = (seedCard as any)?.title ?? (userCard as any)?.title ?? null;

    // Optional reporter info from auth token (works for both anon-key and user JWTs).
    let reporterId: string | null = null;
    let reporterName: string | null = null;
    let reporterEmail: string | null = null;
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (token) {
      const user = await getUser(token);
      if (user) {
        reporterId = user.id;
        reporterEmail = user.email ?? null;
        const approval = (await kv.get(`user:approval:${user.id}`)) as any;
        reporterName = approval?.name ?? null;
      }
    }

    const flagId = `${Date.now()}-${Math.floor(Math.random() * 10_000).toString().padStart(4, "0")}`;
    const record = {
      id: flagId,
      cardId,
      cardTitle,
      reason,
      detail,
      reporterId,
      reporterName,
      reporterEmail,
      createdAt: new Date().toISOString(),
    };
    await kv.set(`flag:${flagId}`, record);
    console.log(`Flag filed on card ${cardId} ("${cardTitle ?? "unknown"}") by ${reporterEmail ?? "anonymous"}: ${reason}`);
    return c.json({ ok: true, flagId });
  } catch (err) {
    console.log("Flag submit error:", err);
    return c.json({ error: `Failed to submit flag: ${err}` }, 500);
  }
});

// ─── GET /admin/flags ────────────────────────────────────────────────────────
// Admin-only: returns all undismissed flags, newest first.
app.get("/make-server-9eb1ae04/admin/flags", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Admin only" }, 403);

    const flags = (await kv.getByPrefix("flag:")) as any[];
    const valid = flags.filter((f) => f && typeof f === "object" && f.id);
    valid.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    return c.json({ flags: valid });
  } catch (err) {
    console.log("List flags error:", err);
    return c.json({ error: `Failed to list flags: ${err}` }, 500);
  }
});

// ─── DELETE /admin/flags/:id — dismiss a single flag ─────────────────────────
app.delete("/make-server-9eb1ae04/admin/flags/:id", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Admin only" }, 403);

    const flagId = c.req.param("id");
    await kv.del(`flag:${flagId}`);
    return c.json({ ok: true });
  } catch (err) {
    console.log("Dismiss flag error:", err);
    return c.json({ error: `Failed to dismiss flag: ${err}` }, 500);
  }
});

// ─── POST /receipts/:id/boost — toggle-boost a receipt (no auth required) ────
app.post("/make-server-9eb1ae04/receipts/:id/boost", async (c) => {
  try {
    const id = Number(c.req.param("id"));
    const { delta } = await c.req.json<{ delta: number }>();
    const receipt = (await kv.get(`receipt:${id}`)) as any;
    if (!receipt) return c.json({ error: `Receipt ${id} not found` }, 404);
    receipt.boosts = Math.max(0, (receipt.boosts ?? 0) + (delta ?? 1));
    await kv.set(`receipt:${id}`, receipt);
    return c.json({ boosts: receipt.boosts });
  } catch (err) {
    return c.json({ error: `Boost failed: ${err}` }, 500);
  }
});

// ─── GET /receipts — public list of approved receipts (admin sees all) ───────
app.get("/make-server-9eb1ae04/receipts", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    let isAdmin = false;
    if (token) {
      const admin = await requireAdmin(token).catch(() => null);
      isAdmin = !!admin;
    }

    const receiptIds = ((await kv.get("receipt:ids")) ?? []) as number[];
    const receipts: any[] = [];
    for (const id of receiptIds) {
      const r = (await kv.get(`receipt:${id}`)) as any;
      if (!r) continue;
      if (!isAdmin && r.adminApproved !== true) continue;
      receipts.push(r);
    }
    // Newest first
    receipts.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    // Return hidden IDs so the client can suppress static (hardcoded) smacks
    // that admins have deleted — those aren't in KV so can't be removed server-
    // side, but we can track which ones to hide.
    const hiddenIds = ((await kv.get("smacks:hidden")) ?? []) as number[];
    return c.json({ receipts, hiddenIds });
  } catch (err) {
    return c.json({ error: `Failed to fetch receipts: ${err}` }, 500);
  }
});

// ─── POST /receipts/submit — approved user submits a receipt for review ──────
app.post("/make-server-9eb1ae04/receipts/submit", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid or expired token" }, 401);
    const approval = await kv.get(`user:approval:${user.id}`) as any;
    if (!approval || approval.status !== "approved") {
      return c.json({ error: "Account not approved" }, 403);
    }

    const body = await c.req.json<{
      title?: string;
      caption?: string;
      imageUrl: string;
      sourceUrl?: string;
      sourceLabel?: string;
      tags?: string[];
    }>();
    if (!body.imageUrl) return c.json({ error: "imageUrl is required" }, 400);

    const ids = ((await kv.get("receipt:ids")) ?? []) as number[];
    const newId = ids.length > 0 ? Math.max(...ids) + 1 : 1;
    const receipt = {
      id: newId,
      title: body.title ?? "",
      caption: body.caption ?? "",
      imageUrl: body.imageUrl,
      sourceUrl: body.sourceUrl ?? "",
      sourceLabel: body.sourceLabel ?? "",
      tags: body.tags ?? [],
      adminApproved: false,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    };
    await kv.set(`receipt:${newId}`, receipt);
    await kv.set("receipt:ids", [...ids, newId]);
    console.log(`User ${approval.name} submitted receipt #${newId}: "${receipt.title}" (pending review)`);
    return c.json({ receipt }, 201);
  } catch (err) {
    return c.json({ error: `Failed to submit receipt: ${err}` }, 500);
  }
});

// ─── POST /admin/receipts/create — admin adds a receipt ──────────────────────
app.post("/make-server-9eb1ae04/admin/receipts/create", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const body = await c.req.json<{
      title?: string;
      caption?: string;
      imageUrl: string;
      sourceUrl?: string;
      sourceLabel?: string;
      tags?: string[];
    }>();

    if (!body.imageUrl) return c.json({ error: "imageUrl is required" }, 400);

    // Allocate a new ID
    const ids = ((await kv.get("receipt:ids")) ?? []) as number[];
    const newId = ids.length > 0 ? Math.max(...ids) + 1 : 1;
    const receipt = {
      id: newId,
      title: body.title ?? "",
      caption: body.caption ?? "",
      imageUrl: body.imageUrl,
      sourceUrl: body.sourceUrl ?? "",
      sourceLabel: body.sourceLabel ?? "",
      tags: body.tags ?? [],
      adminApproved: true,
      createdBy: admin.user.id,
      createdAt: new Date().toISOString(),
    };
    await kv.set(`receipt:${newId}`, receipt);
    await kv.set("receipt:ids", [...ids, newId]);
    console.log(`Admin ${admin.record.name} created receipt #${newId}: "${receipt.title}"`);
    return c.json({ receipt }, 201);
  } catch (err) {
    return c.json({ error: `Failed to create receipt: ${err}` }, 500);
  }
});

// ─── PUT /admin/receipts/:id — admin edits a receipt's text fields ───────────
// Static smacks (id ≥ 5000 in src/app/components/SmacksPage.tsx) are hardcoded
// in the client and CAN'T be edited through this endpoint — they live in code,
// not KV. Only KV-stored receipts (id < 5000) are mutable. The client gates
// the pencil button accordingly.
app.put("/make-server-9eb1ae04/admin/receipts/:id", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const id = Number(c.req.param("id"));
    const existing = (await kv.get(`receipt:${id}`)) as any;
    if (!existing) return c.json({ error: `Receipt ${id} not found` }, 404);

    const body = await c.req.json<{
      title?: string;
      caption?: string;
      imageUrl?: string;
      sourceUrl?: string;
      sourceLabel?: string;
      tags?: string[];
    }>();

    // Whitelist editable fields — don't let an admin overwrite id, createdAt,
    // createdBy, or the approval state through this endpoint.
    const updated = {
      ...existing,
      ...(body.title       !== undefined && { title: body.title }),
      ...(body.caption     !== undefined && { caption: body.caption }),
      ...(body.imageUrl    !== undefined && { imageUrl: body.imageUrl }),
      ...(body.sourceUrl   !== undefined && { sourceUrl: body.sourceUrl }),
      ...(body.sourceLabel !== undefined && { sourceLabel: body.sourceLabel }),
      ...(Array.isArray(body.tags) && { tags: body.tags }),
      updatedBy: admin.user.id,
      updatedAt: new Date().toISOString(),
    };
    await kv.set(`receipt:${id}`, updated);
    console.log(`Admin ${admin.record.name} edited receipt #${id}: "${updated.title}"`);
    return c.json({ receipt: updated });
  } catch (err) {
    return c.json({ error: `Edit failed: ${err}` }, 500);
  }
});

// ─── POST /admin/approve-receipt/:id — approve a pending receipt ──────────────
app.post("/make-server-9eb1ae04/admin/approve-receipt/:id", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const id = Number(c.req.param("id"));
    const receipt = (await kv.get(`receipt:${id}`)) as any;
    if (!receipt) return c.json({ error: `Receipt ${id} not found` }, 404);

    receipt.adminApproved = true;
    receipt.approvedBy = admin.user.id;
    receipt.approvedAt = new Date().toISOString();
    await kv.set(`receipt:${id}`, receipt);
    console.log(`Admin ${admin.record.name} approved receipt #${id}: "${receipt.title}"`);
    return c.json({ receipt });
  } catch (err) {
    return c.json({ error: `Approval failed: ${err}` }, 500);
  }
});

// ─── POST /admin/site-updating — toggle the "site updating" banner ────────────
app.post("/make-server-9eb1ae04/admin/site-updating", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const body = await c.req.json().catch(() => ({}));
    const enabled = body.enabled === true;
    await kv.set("system:site-updating", enabled);
    console.log(`Admin ${admin.record.name} set site-updating = ${enabled}`);
    return c.json({ siteUpdating: enabled });
  } catch (err) {
    return c.json({ error: `Toggle failed: ${err}` }, 500);
  }
});

// ─── DELETE /admin/receipts/:id — delete a receipt ───────────────────────────
app.delete("/make-server-9eb1ae04/admin/receipts/:id", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const id = Number(c.req.param("id"));
    const receipt = await kv.get(`receipt:${id}`);
    if (!receipt) return c.json({ error: `Receipt ${id} not found` }, 404);

    await kv.del(`receipt:${id}`);
    const ids = ((await kv.get("receipt:ids")) ?? []) as number[];
    await kv.set("receipt:ids", ids.filter((x) => x !== id));
    // Also record in the persistent hidden set so the client suppresses it
    // across all devices (same mechanism used for static/hardcoded smacks).
    const hidden = ((await kv.get("smacks:hidden")) ?? []) as number[];
    if (!hidden.includes(id)) await kv.set("smacks:hidden", [...hidden, id]);
    console.log(`Admin ${admin.record.name} deleted receipt #${id}`);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: `Delete failed: ${err}` }, 500);
  }
});

// ─── POST /admin/receipts/hide/:id — hide a static (hardcoded) smack ─────────
// Static smacks live only in client-side code (id ≥ 5000) and can't be
// removed from KV. This endpoint records the admin's intent to hide them
// persistently so the client can suppress them on all devices.
app.post("/make-server-9eb1ae04/admin/receipts/hide/:id", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const id = Number(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid id" }, 400);
    const hidden = ((await kv.get("smacks:hidden")) ?? []) as number[];
    if (!hidden.includes(id)) await kv.set("smacks:hidden", [...hidden, id]);
    console.log(`Admin ${admin.record.name} hid static smack #${id}`);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: `Hide failed: ${err}` }, 500);
  }
});

Deno.serve(app.fetch);