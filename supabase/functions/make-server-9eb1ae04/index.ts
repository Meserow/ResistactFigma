import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv_store.ts";

const app = new Hono();

app.use('*', logger(console.log));

app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
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

async function getUser(token: string) {
  const { data: { user }, error } = await adminClient().auth.getUser(token);
  if (error || !user) return null;
  return user;
}

// On first login (any provider), create an approval record.
// First user ever → auto-approved admin. Everyone else → pending.
async function ensureApprovalRecord(user: any) {
  const existing = await kv.get(`user:approval:${user.id}`);
  if (existing) return existing as any;

  const adminSetup = await kv.get("admin:setup");
  const isFirst = !adminSetup;

  const record = {
    userId: user.id,
    email: user.email ?? "",
    name:
      user.user_metadata?.full_name ??
      user.user_metadata?.name ??
      user.email?.split("@")[0] ??
      "Resistor",
    avatar: user.user_metadata?.avatar_url ?? null,
    status: isFirst ? "approved" : "pending",
    isAdmin: isFirst,
    provider: user.app_metadata?.provider ?? "email",
    createdAt: new Date().toISOString(),
  };

  await kv.set(`user:approval:${user.id}`, record);
  if (isFirst) await kv.set("admin:setup", true);

  return record;
}

async function requireAdmin(token: string | undefined) {
  if (!token) return null;
  const user = await getUser(token);
  if (!user) return null;
  const record = await kv.get(`user:approval:${user.id}`) as any;
  if (!record?.isAdmin) return null;
  return { user, record };
}

// ─── Seed Ellen user ──────────────────────────────────────────────────────────
async function seedEllenUser() {
  const alreadySeeded = await kv.get("seed:ellen:v1");
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
      await kv.set("seed:ellen:v1", true);
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
    await kv.set("seed:ellen:v1", true);
    console.log("Seeded Ellen Escarcega as approved user.");
  } catch (err) {
    console.log("Error seeding Ellen:", err);
  }
}

// ─── Seed data ────────────────────────────────────────────────────────────────
const SEED_CARDS = [
  { id: 1, isFeatured: true, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", timeCommitment: "Ongoing", title: "Spread the Word about ResistAct", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community needs your help spreading awareness about ResistAct so we can build a stronger resistance network together.", spotsUsed: 3020, spotsTotal: "Unlimited", authorName: "Ellen Meserow", authorRole: "ResistAct Founder", authorAvatarKey: "imgImage34" },
  { id: 2, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person", timeCommitment: "Half day", title: "Make 1460 Orange Paper Chains", description: "Help trans kids survive the next 4 years by sending them paper chains with 365x4 links to will help them see that there will be an end to this persecution of them.", spotsUsed: 500, spotsTotal: 1000, authorName: "Jo Jones", authorRole: "Citizen Activist", topImageKey: "imgImage12", authorAvatarKey: "imgImage" },
  { id: 3, category: "FLASH MOB", categoryColor: "#ff00d5", actionType: "In Person Group", timeCommitment: "< 1 hour", title: "Join us in forming human RESIST", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community is forming a human 'RESIST' sign visible from above — join us!", location: "Boston, MA", spotsUsed: 50, spotsTotal: 200, authorName: "Meg Jones", authorRole: "Franklin High School", topImageKey: "imgImage6", authorAvatarKey: "imgImage4" },
  { id: 4, category: "FUNDING", categoryColor: "#127f05", actionType: "Online", timeCommitment: "Ongoing", title: "Help Me Launch Over Los Angeles", description: "I have the land to protect and the people to set up a massive Trump balloon over my house, but I need the funding to purchase it. Go to my GoFundMe and help me buy it!", isOnline: true, location: "Los Angeles, CA", spotsUsed: 739, spotsTotal: "Unlimited", authorName: "Patrick Escarcega", authorRole: "Citizen Activist", topImageKey: "imgImage19", authorAvatarKey: "imgImage1" },
  { id: 5, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", timeCommitment: "Full day", title: "Show Trump We Are United", description: "March on the Capitol with us to show Trump the size of the resistance. Spread the word about July 4th Patriotic Resistance March and bring all your friends and family!", location: "Washington DC", spotsUsed: 2, spotsTotal: 10, authorName: "John Smith", authorRole: "MoveOn.org", topImageKey: "imgImage13", authorAvatarKey: "imgImage20" },
  { id: 6, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", timeCommitment: "1–3 hours", title: "Here Let me Pray for You", description: "We are social media warriors who prove the religious left lives its values. Join us online to pray for our conservative brothers/sisters in Christ who have strayed from His teachings.", isOnline: true, spotsUsed: 52, spotsTotal: 75, authorName: "McKenna Hartman", authorRole: "Citizen Activist", topImageKey: "imgImage7", authorAvatarKey: "imgImage16" },
  { id: 7, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", timeCommitment: "Ongoing", title: "Spread the Word about ResistAct", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community needs your help spreading awareness about ResistAct.", spotsUsed: 3020, spotsTotal: "Unlimited", authorName: "Ellen Meserow", authorRole: "ResistAct Founder", topImageKey: "imgImage25", authorAvatarKey: "imgImage34" },
  { id: 8, category: "FLASH MOB", categoryColor: "#ff00d5", actionType: "In Person Group", timeCommitment: "1–3 hours", title: "Petition the Leftist Billionaires", description: "We need electronic billboards that show the daily price of eggs/gas since Trump took office. Another to show the Trump deficit versus Elon Musk's wealth. Another to show...", typeTag: "FLASH MOB", spotsUsed: 5, spotsTotal: 10, authorName: "Nancie Kosnoff", authorRole: "Citizen Activist", topImageKey: "imgImage14", authorAvatarKey: "imgImage2" },
  { id: 9, category: "PETITION", categoryColor: "#05737f", actionType: "In Person", timeCommitment: "< 1 hour", title: "Stop Funding Fox", description: "MoveOn Civic Action has a long history of taking on Fox's lies. With actions taken by thousands of MoveOn members, we've been able to put pressure on cable providers to drop Fox News.", location: "Austin, TX", spotsUsed: 5, spotsTotal: 10, authorName: "Meg Jones", authorRole: "Franklin High School", topImageKey: "imgImage21", authorAvatarKey: "imgImage4" },
  { id: 10, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", timeCommitment: "< 1 hour", title: "Towns Across America Blackout", description: "On Tuesday, April 22, 2025, we invite you to participate in a nationwide television blackout in protest of Trump's signing of the bill to defund Planned Parenthood.", location: "Austin, TX", spotsUsed: 5, spotsTotal: 10, authorName: "Patrick Escarcega", authorRole: "Citizen Activist", topImageKey: "imgImage17", authorAvatarKey: "imgImage1" },
  { id: 11, category: "ART PIECE", categoryColor: "#896312", actionType: "In Person Group", timeCommitment: "Full day", title: "Puppets for March on Washington", description: "We are making effigies of Trump and his minions for the March on Washington on July 4th. Join in even if you can't attend — we will help the attendees get them!", location: "Austin, TX", spotsUsed: 5, spotsTotal: 10, authorName: "John Smith", authorRole: "MoveOn.org", topImageKey: "imgImage8", authorAvatarKey: "imgImage20" },
  { id: 12, category: "FUNDING", categoryColor: "#127f05", actionType: "Online", timeCommitment: "Ongoing", title: "Help Fund my Elon Mural!", description: "I am making a mural to show Elon as a reincarnation of Adolf Hitler, using a real photo of Trump giving the Nazi salute! It will be in my community center's parking lot!", isOnline: true, spotsUsed: 500, spotsTotal: "Unlimited", authorName: "McKenna Hartman", authorRole: "Citizen Activist", topImageKey: "imgImage10", authorAvatarKey: "imgImage16" },
  { id: 13, category: "TRAINING", categoryColor: "#126d89", actionType: "In Person Group", timeCommitment: "1–3 hours", title: "Online ICE Rapid Response", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community has set up a rapid response network — join us.", location: "Austin, TX", spotsUsed: 5, spotsTotal: 10, authorName: "Adam Jordan", authorRole: "Catholic Legal Immigration Network", authorLink: "https://www.cliniclegal.org/", topImageKey: "imgImage5", authorAvatarKey: "imgImage3" },
  { id: 14, category: "FLASH MOB", categoryColor: "#ff00d5", actionType: "Online", timeCommitment: "< 1 hour", title: "Petition the Leftist Billionaires", description: "We need electronic billboards that show the daily price of eggs/gas since Trump took office. Another to show the Trump deficit versus Elon Musk's wealth. Another to show...", typeTag: "FLASH MOB", spotsUsed: 500, spotsTotal: "Unlimited", authorName: "Nancie Kosnoff", authorRole: "Citizen Activist", topImageKey: "imgImage15", authorAvatarKey: "imgImage2" },
  { id: 15, category: "PETITION", categoryColor: "#05737f", actionType: "In Person", timeCommitment: "< 1 hour", title: "Stop Funding Fox", description: "MoveOn Civic Action has a long history of taking on Fox's lies. With actions taken by thousands of MoveOn members, we've been able to put pressure on cable providers.", location: "Austin, TX", spotsUsed: 500, spotsTotal: "Unlimited", authorName: "Adam Jordan", authorRole: "Catholic Legal Immigration Network", authorLink: "https://www.cliniclegal.org/", topImageKey: "imgImage22", authorAvatarKey: "imgImage3" },
  { id: 16, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", timeCommitment: "< 1 hour", title: "Towns Across America Blackout", description: "On Tuesday, April 22, 2025, we invite you to participate in a nationwide television blackout in protest of Trump's signing of the bill to defund Planned Parenthood.", location: "Austin, TX", spotsUsed: 500, spotsTotal: "Unlimited", authorName: "Nancie Kosnoff", authorRole: "Citizen Activist", topImageKey: "imgImage18", authorAvatarKey: "imgImage2" },
  { id: 17, category: "ART PIECE", categoryColor: "#896312", actionType: "In Person Group", timeCommitment: "Half day", title: "Puppets for March on Washington", description: "We are making effigies of Trump and his minions for the March on Washington on July 4th. Join in even if you can't attend — we will help the attendees get them!", location: "Austin, TX", spotsUsed: 500, spotsTotal: "Unlimited", authorName: "Adam Jordan", authorRole: "Catholic Legal Immigration Network", authorLink: "https://www.cliniclegal.org/", topImageKey: "imgImage9", authorAvatarKey: "imgImage3" },
  { id: 18, category: "FUNDING", categoryColor: "#127f05", actionType: "Online", timeCommitment: "Ongoing", title: "Help Fund my Elon Mural!", description: "I am making a mural to show Elon as a reincarnation of Adolf Hitler, using a real photo of Trump giving the Nazi salute! It will be in my community center's parking lot!", isOnline: true, spotsUsed: 500, spotsTotal: "Unlimited", authorName: "Nancie Kosnoff", authorRole: "Citizen Activist", topImageKey: "imgImage11", authorAvatarKey: "imgImage2" },
  { id: 19, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", timeCommitment: "< 1 hour", title: "SH*T Bag: Two Bags, One Movement", description: "Dog poop bags featuring Trump — made from plant-based materials (PBAT + PLA + Corn Starch), leak-proof, strong, traps odors, and 'resistant to hate.' Fair-trade and BSCI-compliant. Buy a pack and put it to good use.", isOnline: true, spotsUsed: 0, spotsTotal: "Unlimited", authorName: "Smolotov LLC", authorRole: "Resistance Merch", targetUrl: "https://www.smolotov.com/products/smolotov-unscented-leakproof-dog-poop-bags", topImageUrl: "https://www.smolotov.com/cdn/shop/files/4-Rolls_Box_Bag_2400px.jpg?v=1771553420&width=800" },
];

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/make-server-9eb1ae04/health", (c) => c.json({ status: "ok" }));

// ─── AUTH: Register with email + password ─────────────────────────────────────
app.post("/make-server-9eb1ae04/auth/register", async (c) => {
  try {
    const { email, password, name } = await c.req.json<{ email: string; password: string; name: string }>();
    if (!email || !password || !name) return c.json({ error: "email, password and name are required" }, 400);

    const { data, error } = await adminClient().auth.admin.createUser({
      email,
      password,
      user_metadata: { name, full_name: name },
      // Auto-confirm — no email server configured
      email_confirm: true,
    });

    if (error) return c.json({ error: error.message }, 400);

    const approval = await ensureApprovalRecord(data.user);
    console.log(`Registered user ${email} — status: ${approval.status}`);
    return c.json({ approval });
  } catch (err) {
    console.log("Register error:", err);
    return c.json({ error: `Registration failed: ${err}` }, 500);
  }
});

// ─── AUTH: Status — verify JWT & return/create approval record ────────────────
app.get("/make-server-9eb1ae04/auth/status", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "No token provided" }, 401);

    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid or expired token" }, 401);

    const approval = await ensureApprovalRecord(user);
    return c.json({ approval });
  } catch (err) {
    console.log("Auth status error:", err);
    return c.json({ error: `Status check failed: ${err}` }, 500);
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
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return c.json({ users: list });
  } catch (err) {
    console.log("Admin users error:", err);
    return c.json({ error: `Failed to list users: ${err}` }, 500);
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

// ─── GET /actions ─────────────────────────────────────────────────────────────
app.get("/make-server-9eb1ae04/actions", async (c) => {
  try {
    const limit  = Math.min(Number(c.req.query("limit")  ?? 20), 100);
    const offset = Math.max(Number(c.req.query("offset") ?? 0),   0);

    // Seed Ellen user if not done yet
    await seedEllenUser();

    // One-time: remove fake placeholder seed cards (IDs 1–18) from the DB
    const fakePurged = await kv.get("cleanup:fake-seeds:v1");
    if (!fakePurged) {
      const fakeIds = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18];
      for (const id of fakeIds) await kv.del(`action:${id}`);
      await kv.set("cleanup:fake-seeds:v1", true);
      console.log("Purged fake seed cards 1–18.");
    }

    // One-time migrations for user-created cards
    const migrationV1 = await kv.get("migration:user-cards:v1");
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
      await kv.set("migration:user-cards:v1", true);
      console.log("User-card migration v1 complete.");
    }

    // Fetch ALL action:* cards from the KV store (real cards only after purge)
    const allActionCards = await kv.getByPrefix("action:");
    const seenIds = new Set<number>();
    const allCards: any[] = [];
    for (const card of allActionCards) {
      if (card && typeof card === "object" && typeof card.id === "number" && !seenIds.has(card.id)) {
        seenIds.add(card.id);
        allCards.push(card);
      }
    }

    // Also fetch user-created cards
    const userCardIds = (await kv.get("user-action:ids") ?? []) as number[];
    for (const id of userCardIds) {
      if (seenIds.has(id)) continue;
      const card = await kv.get(`user-action:${id}`);
      if (card && typeof card === "object") {
        seenIds.add(id);
        allCards.push(card);
      }
    }

    allCards.sort((a, b) => a.id - b.id);
    const total = allCards.length;
    const cards = allCards.slice(offset, offset + limit);

    console.log(`Returning ${cards.length} of ${total} action cards (offset=${offset}, limit=${limit}).`);
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
    const userCardIds = (await kv.get("user-action:ids") ?? []) as number[];
    for (const id of userCardIds) {
      if (seenIds.has(id)) continue;
      const card = await kv.get(`user-action:${id}`);
      if (card && typeof card === "object") { seenIds.add(id); allCards.push(card); }
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
    const usersCount = (users as any[]).filter((u) => u && typeof u === "object" && u.userId).length;

    console.log(`Stats: ${allCards.length} acts, ${citiesCount} cities, ${usersCount} users`);
    return c.json({ citiesCount, usersCount, actsCount: allCards.length });
  } catch (err) {
    console.log("Stats error:", err);
    return c.json({ error: `Failed to fetch stats: ${err}` }, 500);
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

    const { title, description, category, categoryColor, location, isOnline, spotsTotal, sponsor, link, vettingInfo, actionType } =
      await c.req.json<{
        title: string; description: string; category: string; categoryColor: string;
        location?: string; isOnline?: boolean; spotsTotal: number | "Unlimited";
        sponsor?: string; link?: string; vettingInfo?: string; actionType?: string;
      }>();

    if (!title || !description || !category) {
      return c.json({ error: "title, description and category are required" }, 400);
    }

    // Auto-increment ID starting at 100 to avoid collisions with seed data
    const currentIds = (await kv.get("user-action:ids") ?? []) as number[];
    const nextId = currentIds.length > 0 ? Math.max(...currentIds) + 1 : 100;

    const card = {
      id: nextId,
      category: category.toUpperCase(),
      categoryColor,
      title,
      description,
      location: location || undefined,
      isOnline: isOnline ?? false,
      actionType: actionType ?? (isOnline ? "Online" : "In Person Group"),
      sponsor: sponsor || undefined,
      link: link || undefined,
      vettingInfo: vettingInfo || undefined,
      spotsUsed: 0,
      spotsTotal,
      authorName: approval.name,
      authorRole: "Citizen Activist",
      authorAvatarKey: null,
      topImageKey: null,
      createdAt: new Date().toISOString(),
      createdBy: user.id,
    };

    await kv.set(`user-action:${nextId}`, card);
    await kv.set("user-action:ids", [...currentIds, nextId]);
    console.log(`User ${approval.name} created ASK #${nextId}: "${title}"`);
    return c.json({ card });
  } catch (err) {
    console.log("Create action error:", err);
    return c.json({ error: `Failed to create ASK: ${err}` }, 500);
  }
});

// ─── POST /actions/:id/act — increment spotsUsed, return updated card ─────────
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

    card.spotsUsed = Math.max(0, (card.spotsUsed ?? 0) + (delta ?? 1));
    await kv.set(`action:${id}`, card);

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

    // Strip immutable fields from the update payload
    const { id: _id, createdBy: _createdBy, spotsUsed: _spotsUsed,
            createdAt: _createdAt, authorAvatarKey: _avatarKey,
            topImageKey: _topImageKey, ...safeUpdates } = body;

    const updated = {
      ...card,
      ...safeUpdates,
      updatedAt: new Date().toISOString(),
      updatedBy: user.id,
    };

    await kv.set(cardKey, updated);
    console.log(`${approval.name} edited card #${id}: "${updated.title}"`);
    return c.json({ card: updated });
  } catch (err) {
    console.log("Edit card error:", err);
    return c.json({ error: `Failed to edit card: ${err}` }, 500);
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
      await kv.delete(`action:${id}`);
      console.log(`Admin ${admin.record.name} deleted seed card #${id}`);
      return c.json({ success: true });
    }

    // Try user-created card
    const userCard = await kv.get(`user-action:${id}`);
    if (userCard) {
      await kv.delete(`user-action:${id}`);
      const currentIds = (await kv.get("user-action:ids") ?? []) as number[];
      await kv.set("user-action:ids", currentIds.filter((x) => x !== id));
      console.log(`Admin ${admin.record.name} deleted user card #${id}`);
      return c.json({ success: true });
    }

    return c.json({ error: `Card ${id} not found` }, 404);
  } catch (err) {
    console.log("Delete card error:", err);
    return c.json({ error: `Failed to delete card: ${err}` }, 500);
  }
});

Deno.serve(app.fetch);