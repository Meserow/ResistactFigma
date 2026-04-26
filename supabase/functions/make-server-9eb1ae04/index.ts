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
  { id: 1, isFeatured: true, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", timeCommitment: "Ongoing", title: "Spread the Word about ResistAct", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community needs your help spreading awareness about ResistAct so we can build a stronger resistance network together.", boosts: 3020, spotsTotal: "Unlimited", authorName: "Ellen Meserow", authorRole: "ResistAct Founder", authorAvatarKey: "imgImage34" },
  { id: 2, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person", timeCommitment: "Half day", title: "Make 1460 Orange Paper Chains", description: "Help trans kids survive the next 4 years by sending them paper chains with 365x4 links to will help them see that there will be an end to this persecution of them.", boosts: 500, spotsTotal: 1000, authorName: "Jo Jones", authorRole: "Citizen Activist", topImageKey: "imgImage12", authorAvatarKey: "imgImage" },
  { id: 3, category: "FLASH MOB", categoryColor: "#ff00d5", actionType: "In Person Group", timeCommitment: "< 1 hour", title: "Join us in forming human RESIST", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community is forming a human 'RESIST' sign visible from above — join us!", location: "Boston, MA", boosts: 50, spotsTotal: 200, authorName: "Meg Jones", authorRole: "Franklin High School", topImageKey: "imgImage6", authorAvatarKey: "imgImage4" },
  { id: 4, category: "FUNDING", categoryColor: "#127f05", actionType: "Online", timeCommitment: "Ongoing", title: "Help Me Launch Over Los Angeles", description: "I have the land to protect and the people to set up a massive Trump balloon over my house, but I need the funding to purchase it. Go to my GoFundMe and help me buy it!", isOnline: true, location: "Los Angeles, CA", boosts: 739, spotsTotal: "Unlimited", authorName: "Patrick Escarcega", authorRole: "Citizen Activist", topImageKey: "imgImage19", authorAvatarKey: "imgImage1" },
  { id: 5, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", timeCommitment: "Full day", title: "Show Trump We Are United", description: "March on the Capitol with us to show Trump the size of the resistance. Spread the word about July 4th Patriotic Resistance March and bring all your friends and family!", location: "Washington DC", boosts: 2, spotsTotal: 10, authorName: "John Smith", authorRole: "MoveOn.org", topImageKey: "imgImage13", authorAvatarKey: "imgImage20" },
  { id: 6, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", timeCommitment: "1–3 hours", title: "Here Let me Pray for You", description: "We are social media warriors who prove the religious left lives its values. Join us online to pray for our conservative brothers/sisters in Christ who have strayed from His teachings.", isOnline: true, boosts: 52, spotsTotal: 75, authorName: "McKenna Hartman", authorRole: "Citizen Activist", topImageKey: "imgImage7", authorAvatarKey: "imgImage16" },
  { id: 7, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", timeCommitment: "Ongoing", title: "Spread the Word about ResistAct", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community needs your help spreading awareness about ResistAct.", boosts: 3020, spotsTotal: "Unlimited", authorName: "Ellen Meserow", authorRole: "ResistAct Founder", topImageKey: "imgImage25", authorAvatarKey: "imgImage34" },
  { id: 8, category: "FLASH MOB", categoryColor: "#ff00d5", actionType: "In Person Group", timeCommitment: "1–3 hours", title: "Petition the Leftist Billionaires", description: "We need electronic billboards that show the daily price of eggs/gas since Trump took office. Another to show the Trump deficit versus Elon Musk's wealth. Another to show...", typeTag: "FLASH MOB", boosts: 5, spotsTotal: 10, authorName: "Nancie Kosnoff", authorRole: "Citizen Activist", topImageKey: "imgImage14", authorAvatarKey: "imgImage2" },
  { id: 9, category: "PETITION", categoryColor: "#05737f", actionType: "In Person", timeCommitment: "< 1 hour", title: "Stop Funding Fox", description: "MoveOn Civic Action has a long history of taking on Fox's lies. With actions taken by thousands of MoveOn members, we've been able to put pressure on cable providers to drop Fox News.", location: "Austin, TX", boosts: 5, spotsTotal: 10, authorName: "Meg Jones", authorRole: "Franklin High School", topImageKey: "imgImage21", authorAvatarKey: "imgImage4" },
  { id: 10, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", timeCommitment: "< 1 hour", title: "Towns Across America Blackout", description: "On Tuesday, April 22, 2025, we invite you to participate in a nationwide television blackout in protest of Trump's signing of the bill to defund Planned Parenthood.", location: "Austin, TX", boosts: 5, spotsTotal: 10, authorName: "Patrick Escarcega", authorRole: "Citizen Activist", topImageKey: "imgImage17", authorAvatarKey: "imgImage1" },
  { id: 11, category: "ART PIECE", categoryColor: "#896312", actionType: "In Person Group", timeCommitment: "Full day", title: "Puppets for March on Washington", description: "We are making effigies of Trump and his minions for the March on Washington on July 4th. Join in even if you can't attend — we will help the attendees get them!", location: "Austin, TX", boosts: 5, spotsTotal: 10, authorName: "John Smith", authorRole: "MoveOn.org", topImageKey: "imgImage8", authorAvatarKey: "imgImage20" },
  { id: 12, category: "FUNDING", categoryColor: "#127f05", actionType: "Online", timeCommitment: "Ongoing", title: "Help Fund my Elon Mural!", description: "I am making a mural to show Elon as a reincarnation of Adolf Hitler, using a real photo of Trump giving the Nazi salute! It will be in my community center's parking lot!", isOnline: true, boosts: 500, spotsTotal: "Unlimited", authorName: "McKenna Hartman", authorRole: "Citizen Activist", topImageKey: "imgImage10", authorAvatarKey: "imgImage16" },
  { id: 13, category: "TRAINING", categoryColor: "#126d89", actionType: "In Person Group", timeCommitment: "1–3 hours", title: "Online ICE Rapid Response", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community has set up a rapid response network — join us.", location: "Austin, TX", boosts: 5, spotsTotal: 10, authorName: "Adam Jordan", authorRole: "Catholic Legal Immigration Network", authorLink: "https://www.cliniclegal.org/", topImageKey: "imgImage5", authorAvatarKey: "imgImage3" },
  { id: 14, category: "FLASH MOB", categoryColor: "#ff00d5", actionType: "Online", timeCommitment: "< 1 hour", title: "Petition the Leftist Billionaires", description: "We need electronic billboards that show the daily price of eggs/gas since Trump took office. Another to show the Trump deficit versus Elon Musk's wealth. Another to show...", typeTag: "FLASH MOB", boosts: 500, spotsTotal: "Unlimited", authorName: "Nancie Kosnoff", authorRole: "Citizen Activist", topImageKey: "imgImage15", authorAvatarKey: "imgImage2" },
  { id: 15, category: "PETITION", categoryColor: "#05737f", actionType: "In Person", timeCommitment: "< 1 hour", title: "Stop Funding Fox", description: "MoveOn Civic Action has a long history of taking on Fox's lies. With actions taken by thousands of MoveOn members, we've been able to put pressure on cable providers.", location: "Austin, TX", boosts: 500, spotsTotal: "Unlimited", authorName: "Adam Jordan", authorRole: "Catholic Legal Immigration Network", authorLink: "https://www.cliniclegal.org/", topImageKey: "imgImage22", authorAvatarKey: "imgImage3" },
  { id: 16, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", timeCommitment: "< 1 hour", title: "Towns Across America Blackout", description: "On Tuesday, April 22, 2025, we invite you to participate in a nationwide television blackout in protest of Trump's signing of the bill to defund Planned Parenthood.", location: "Austin, TX", boosts: 500, spotsTotal: "Unlimited", authorName: "Nancie Kosnoff", authorRole: "Citizen Activist", topImageKey: "imgImage18", authorAvatarKey: "imgImage2" },
  { id: 17, category: "ART PIECE", categoryColor: "#896312", actionType: "In Person Group", timeCommitment: "Half day", title: "Puppets for March on Washington", description: "We are making effigies of Trump and his minions for the March on Washington on July 4th. Join in even if you can't attend — we will help the attendees get them!", location: "Austin, TX", boosts: 500, spotsTotal: "Unlimited", authorName: "Adam Jordan", authorRole: "Catholic Legal Immigration Network", authorLink: "https://www.cliniclegal.org/", topImageKey: "imgImage9", authorAvatarKey: "imgImage3" },
  { id: 18, category: "FUNDING", categoryColor: "#127f05", actionType: "Online", timeCommitment: "Ongoing", title: "Help Fund my Elon Mural!", description: "I am making a mural to show Elon as a reincarnation of Adolf Hitler, using a real photo of Trump giving the Nazi salute! It will be in my community center's parking lot!", isOnline: true, boosts: 500, spotsTotal: "Unlimited", authorName: "Nancie Kosnoff", authorRole: "Citizen Activist", topImageKey: "imgImage11", authorAvatarKey: "imgImage2" },
  { id: 19, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", timeCommitment: "< 1 hour", title: "SH*T Bag: Two Bags, One Movement", description: "Dog poop bags featuring Trump — made from plant-based materials (PBAT + PLA + Corn Starch), leak-proof, strong, traps odors, and 'resistant to hate.' Fair-trade and BSCI-compliant. Buy a pack and put it to good use.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Smolotov LLC", authorRole: "Resistance Merch", targetUrl: "https://www.smolotov.com/products/smolotov-unscented-leakproof-dog-poop-bags", topImageUrl: "https://www.smolotov.com/cdn/shop/files/4-Rolls_Box_Bag_2400px.jpg?v=1771553420&width=800" },
  { id: 1000, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Search any brand's political donations before you buy", description: "Search 7,000+ companies' political donation breakdowns.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Goods Unite Us", authorRole: "Movement Organization", targetUrl: "https://www.goodsuniteus.com/", topImageKey: "org_goods-unite-us" },
  { id: 1001, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Get the browser extension that flags MAGA-aligned brands", description: "Auto-flags brand political alignment as you shop online.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Progressive Shopper", authorRole: "Movement Organization", targetUrl: "https://progressiveshopper.com/", topImageKey: "org_progressive-shopper" },
  { id: 1002, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Use the Trump-tied retailers boycott list", description: "Long-running spreadsheet of Trump-tied retailers.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Grab Your Wallet", authorRole: "Movement Organization", targetUrl: "https://grabyourwallet.org/", topImageKey: "org_grab-your-wallet" },
  { id: 1003, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Join coordinated 24-hour economic blackouts", description: "Rotating-date economic blackouts; sign up for the next.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "The People's Union USA", authorRole: "Movement Organization", targetUrl: "https://thepeoplesunionusa.com/", topImageKey: "org_the-people-s-union-usa" },
  { id: 1004, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Sign the Tesla Takedown commitment", description: "Sell stock / lease, get on the Saturday protest map.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com/", topImageKey: "org_tesla-takedown" },
  { id: 1005, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Join the Latino-led economic blackout", description: "Latino-led economic non-spending campaign.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Latino Freeze Movement", authorRole: "Movement Organization", targetUrl: "https://www.latinofreeze.com/", topImageKey: "org_latino-freeze-movement" },
  { id: 1006, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Switch your spending to a Black-women-owned biz", description: "Directory to redirect spending.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Buy From a Black Woman", authorRole: "Movement Organization", targetUrl: "https://www.buyfromablackwoman.org/", topImageKey: "org_buy-from-a-black-woman" },
  { id: 1007, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Find a union-made replacement product", description: "Union-made + union-friendly product directory.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Union Plus", authorRole: "Movement Organization", targetUrl: "https://www.unionplus.org/", topImageKey: "org_union-plus" },
  { id: 1008, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Buy from a Native-owned business instead", description: "Native-owned biz directory + marketplace.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Beyond Buckskin", authorRole: "Movement Organization", targetUrl: "https://www.beyondbuckskin.com/", topImageKey: "org_beyond-buckskin" },
  { id: 1009, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "RSVP to the next Saturday Tesla Takedown", description: "Map of dealership protests + sign-up.", isOnline: false, boosts: 4, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com/", topImageKey: "org_tesla-takedown" },
  { id: 1010, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Subscribe to Free DC mobilization alerts", description: "DC anti-takeover mobilization list.", isOnline: false, boosts: 4, spotsTotal: "Unlimited", authorName: "Free DC", authorRole: "Movement Organization", targetUrl: "https://www.freedcnow.org/", topImageKey: "org_free-dc" },
  { id: 1011, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Become a Veterans for Peace member", description: "VFP contingents are protest-protective at any rally.", isOnline: false, boosts: 4, spotsTotal: "Unlimited", authorName: "Veterans for Peace", authorRole: "Movement Organization", targetUrl: "https://www.veteransforpeace.org/", topImageKey: "org_veterans-for-peace" },
  { id: 1012, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Join About Face: Veterans Against the War", description: "Post-9/11 vet org, more direct-action lean.", isOnline: false, boosts: 4, spotsTotal: "Unlimited", authorName: "About Face", authorRole: "Movement Organization", targetUrl: "https://aboutfaceveterans.org/", topImageKey: "org_about-face" },
  { id: 1013, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Find an ADAPT chapter (disability direct action)", description: "Decentralized disability rights direct-action network.", isOnline: false, boosts: 4, spotsTotal: "Unlimited", authorName: "ADAPT", authorRole: "Movement Organization", targetUrl: "https://adapt.org/", topImageKey: "org_adapt" },
  { id: 1014, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Find a Drag Story Hour to attend / livestream", description: "Public-event presence deters harassers.", isOnline: false, boosts: 4, spotsTotal: "Unlimited", authorName: "Drag Story Hour", authorRole: "Movement Organization", targetUrl: "https://www.dragstoryhour.org/", topImageKey: "org_drag-story-hour" },
  { id: 1015, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Sign up for Refuse Fascism action alerts", description: "Decentralized anti-fascist protest network.", isOnline: false, boosts: 4, spotsTotal: "Unlimited", authorName: "Refuse Fascism", authorRole: "Movement Organization", targetUrl: "https://refusefascism.org/", topImageKey: "org_refuse-fascism" },
  { id: 1016, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Sign up with Code Pink", description: "Women-led peace + civil-liberties.", isOnline: false, boosts: 4, spotsTotal: "Unlimited", authorName: "Code Pink", authorRole: "Movement Organization", targetUrl: "https://www.codepink.org/", topImageKey: "org_code-pink" },
  { id: 1017, category: "TRANSPORTATION", categoryColor: "#0a6e3f", actionType: "In Person Group", title: "Volunteer as a Practical Support driver (repro)", description: "Network of practical-support funds; drive abortion-seekers.", isOnline: false, boosts: 4, spotsTotal: "Unlimited", authorName: "Apiary for Practical Support", authorRole: "Movement Organization", targetUrl: "https://apiaryps.org/ps-volunteer", topImageKey: "org_apiary-for-practical-support" },
  { id: 1018, category: "TRANSPORTATION", categoryColor: "#0a6e3f", actionType: "In Person Group", title: "Sponsor + drive for refugees via Welcome.US", description: "Driving + logistics support for resettling families.", isOnline: false, boosts: 4, spotsTotal: "Unlimited", authorName: "Welcome.US", authorRole: "Movement Organization", targetUrl: "https://welcome.us/", topImageKey: "org_welcome-us" },
  { id: 1019, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Submit a tip (anonymous SecureDrop)", description: "Investigative outlet with strong follow-through.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "ProPublica", authorRole: "Movement Organization", targetUrl: "https://www.propublica.org/tips/", topImageKey: "org_propublica" },
  { id: 1020, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Submit a tip on criminal-justice / detention", description: "Criminal-justice + immigration newsroom.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "The Marshall Project", authorRole: "Movement Organization", targetUrl: "https://www.themarshallproject.org/", topImageKey: "org_the-marshall-project" },
  { id: 1021, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Submit a leak to The Intercept", description: "Surveillance / nat-sec leaks.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "The Intercept", authorRole: "Movement Organization", targetUrl: "https://theintercept.com/", topImageKey: "org_the-intercept" },
  { id: 1022, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Tell them about an ICE raid (NYC)", description: "NYC immigration-focused journalism.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Documented", authorRole: "Movement Organization", targetUrl: "https://www.mobilize.us/handsoffnyc/event/929506/", topImageKey: "org_handsoffnyc" },
  { id: 1023, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch a Black-community story", description: "Black-led national investigative.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Capital B", authorRole: "Movement Organization", targetUrl: "https://capitalbnews.org/", topImageKey: "org_capital-b" },
  { id: 1024, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch a gender + politics story", description: "Underreported repro / trans / gender angles.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "The 19th*", authorRole: "Movement Organization", targetUrl: "https://19thnews.org/", topImageKey: "org_the-19th" },
  { id: 1025, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch on local DA / sheriff / election admin", description: "They publish local-democracy stories from anywhere.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Bolts Magazine", authorRole: "Movement Organization", targetUrl: "https://boltsmag.org/", topImageKey: "org_bolts-magazine" },
  { id: 1026, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Send an investigative idea", description: "Funds investigative reporters.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Type Investigations", authorRole: "Movement Organization", targetUrl: "https://www.typeinvestigations.org/", topImageKey: "org_type-investigations" },
  { id: 1027, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch a war / civil-liberties story", description: "Ex-Intercept staff.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Drop Site News", authorRole: "Movement Organization", targetUrl: "https://www.dropsitenews.com/", topImageKey: "org_drop-site-news" },
  { id: 1028, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch a labor story (video)", description: "Worker-power video journalism.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "More Perfect Union", authorRole: "Movement Organization", targetUrl: "https://perfectunion.us/", topImageKey: "org_more-perfect-union" },
  { id: 1029, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Send a dark-money tip", description: "David Sirota's outfit; dark money + corruption.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "The Lever", authorRole: "Movement Organization", targetUrl: "https://www.levernews.com/", topImageKey: "org_the-lever" },
  { id: 1030, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Submit a campaign-finance tip", description: "Specialist on campaign-finance corruption.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Sludge", authorRole: "Movement Organization", targetUrl: "https://readsludge.com/", topImageKey: "org_sludge" },
  { id: 1031, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Report a press-freedom violation", description: "Log a press-freedom incident.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "U.S. Press Freedom Tracker", authorRole: "Movement Organization", targetUrl: "https://pressfreedomtracker.us/", topImageKey: "org_u-s-press-freedom-tracker" },
  { id: 1032, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Find your nearest chapter + meeting time", description: "Largest socialist org in the US.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "DSA (Democratic Socialists of America)", authorRole: "Movement Organization", targetUrl: "https://www.dsausa.org/", topImageKey: "org_dsa-democratic-socialists-of-america" },
  { id: 1033, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Apply to a virtual intro call", description: "White-organized solidarity work.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "SURJ (Showing Up for Racial Justice)", authorRole: "Movement Organization", targetUrl: "https://surj.org/", topImageKey: "org_surj-showing-up-for-racial-justice" },
  { id: 1034, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Sign up for a hub welcome call", description: "Climate-led; remote-friendly hubs.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Sunrise Movement", authorRole: "Movement Organization", targetUrl: "https://www.sunrisemovement.org/", topImageKey: "org_sunrise-movement" },
  { id: 1035, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "RSVP for next event (local + virtual)", description: "Electoral + issue work.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Working Families Party", authorRole: "Movement Organization", targetUrl: "https://workingfamilies.org/", topImageKey: "org_working-families-party" },
  { id: 1036, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Join virtual monthly mass assembly", description: "Moral revival + organizing.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Poor People's Campaign (Rev. Barber)", authorRole: "Movement Organization", targetUrl: "https://www.poorpeoplescampaign.org/", topImageKey: "org_poor-people-s-campaign-rev-barber" },
  { id: 1037, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Find your local circle", description: "Latinx organizing on immigration + abolition.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Mijente", authorRole: "Movement Organization", targetUrl: "https://mijente.net/", topImageKey: "org_mijente" },
  { id: 1038, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Find a local team", description: "Mom-led climate + community resilience.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Mothers Out Front", authorRole: "Movement Organization", targetUrl: "https://mothersoutfront.org/", topImageKey: "org_mothers-out-front" },
  { id: 1039, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Find a local group", description: "Progressive Jewish organizing.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Bend the Arc (Jewish progressive)", authorRole: "Movement Organization", targetUrl: "https://www.bendthearc.us/", topImageKey: "org_bend-the-arc-jewish-progressive" },
  { id: 1040, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Find a Catholic Worker House to visit", description: "Hospitality houses; many host weekly online discussions.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Catholic Worker movement", authorRole: "Movement Organization", targetUrl: "https://catholicworker.org/", topImageKey: "org_catholic-worker-movement" },
  { id: 1041, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Join a federal-worker organizing call", description: "Cross-agency coordination + mutual aid.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Federal Unionists Network", authorRole: "Movement Organization", targetUrl: "https://www.federalunionists.net/", topImageKey: "org_federal-unionists-network" },
  { id: 1042, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Migrate your X follows to Bluesky", description: "Free browser extension to find your X follows on Bluesky.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Sky Follower Bridge", authorRole: "Movement Organization", targetUrl: "https://skyfollowerbridge.com/", topImageKey: "org_sky-follower-bridge" },
  { id: 1043, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Make a Bluesky account", description: "Open-protocol social network.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Bluesky", authorRole: "Movement Organization", targetUrl: "https://bsky.app/", topImageKey: "org_bluesky" },
  { id: 1044, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Make a Mastodon account on a movement-aligned server", description: "Anti-fascist federated server.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Kolektiva (Mastodon)", authorRole: "Movement Organization", targetUrl: "https://kolektiva.social/", topImageKey: "org_kolektiva-mastodon" },
  { id: 1045, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Save a threatened page now", description: "One-click archive of .gov pages, articles, evidence.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Wayback Machine 'Save Page Now'", authorRole: "Movement Organization", targetUrl: "https://web.archive.org/save", topImageKey: "org_wayback-machine-save-page-now" },
  { id: 1046, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Make a Pixelfed account (federated Insta)", description: "No algorithm; activist-friendly image sharing.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Pixelfed", authorRole: "Movement Organization", targetUrl: "https://pixelfed.social/", topImageKey: "org_pixelfed" },
  { id: 1047, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Embroider + ship a Trump quote to the archive", description: "Diana Weymar's archive of embroidered Trump quotes.", isOnline: false, boosts: 4, spotsTotal: "Unlimited", authorName: "Tiny Pricks Project", authorRole: "Movement Organization", targetUrl: "https://www.tinypricksproject.com/", topImageKey: "org_tiny-pricks-project" },
  { id: 1048, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Knit a Welcome Blanket for a new immigrant", description: "40\"x40\" blanket + welcome note program.", isOnline: false, boosts: 4, spotsTotal: "Unlimited", authorName: "Welcome Blanket Project", authorRole: "Movement Organization", targetUrl: "https://www.welcomeblanket.org/", topImageKey: "org_welcome-blanket-project" },
  { id: 1049, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Knit a Pussyhat from updated patterns", description: "Patterns + protest mail-in info.", isOnline: false, boosts: 4, spotsTotal: "Unlimited", authorName: "Pussyhat Project", authorRole: "Movement Organization", targetUrl: "https://www.pussyhatproject.com/", topImageKey: "org_pussyhat-project" },
  { id: 1050, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Sign up for the postcard drop", description: "Hand-illustrated postcards to swing-district constituents.", isOnline: false, boosts: 4, spotsTotal: "Unlimited", authorName: "The Postcard Posse", authorRole: "Movement Organization", targetUrl: "https://thepostcardposse.org/", topImageKey: "org_the-postcard-posse" },
  { id: 1051, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Mail a handmade card to a detained migrant", description: "Letter-writing program connects you to a specific person.", isOnline: false, boosts: 4, spotsTotal: "Unlimited", authorName: "Freedom for Immigrants", authorRole: "Movement Organization", targetUrl: "https://www.freedomforimmigrants.org/", topImageKey: "org_freedom-for-immigrants" },
  { id: 1052, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign petitions to overturn Citizens United", description: "Constitutional amendment campaign.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Move to Amend", authorRole: "Movement Organization", targetUrl: "https://www.movetoamend.org/", topImageKey: "org_move-to-amend" },
  { id: 1053, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign current petitions", description: "Corporate accountability + judicial reform.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Public Citizen", authorRole: "Movement Organization", targetUrl: "https://www.citizen.org/", topImageKey: "org_public-citizen" },
  { id: 1054, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign democracy-reform petitions", description: "Voting rights, courts, ethics.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/", topImageKey: "org_common-cause" },
  { id: 1055, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign court-reform petitions", description: "SCOTUS / judicial accountability.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Demand Justice", authorRole: "Movement Organization", targetUrl: "https://demandjustice.org/", topImageKey: "org_demand-justice" },
  { id: 1056, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign media-reform petitions", description: "Disinformation, net neutrality.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Free Press", authorRole: "Movement Organization", targetUrl: "https://www.freepress.net/", topImageKey: "org_free-press" },
  { id: 1057, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign civil-rights petitions", description: "Civil rights, immigration, surveillance.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Center for Constitutional Rights", authorRole: "Movement Organization", targetUrl: "https://ccrjustice.org/", topImageKey: "org_center-for-constitutional-rights" },
  { id: 1058, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign Black-led racial-justice petitions", description: "Racial-justice campaign hub.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Color of Change", authorRole: "Movement Organization", targetUrl: "https://colorofchange.org/", topImageKey: "org_color-of-change" },
  { id: 1059, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign civil-liberties petitions", description: "Civil liberties + corporate accountability.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Demand Progress", authorRole: "Movement Organization", targetUrl: "https://demandprogress.org/", topImageKey: "org_demand-progress" },
  { id: 1060, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign AAPI petitions", description: "Asian American Pacific Islander campaigns.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "18MillionRising", authorRole: "Movement Organization", targetUrl: "https://www.18millionrising.org/actions/", topImageKey: "org_18millionrising" },
  { id: 1061, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign Christian-rooted petitions vs. Christian nationalism", description: "Christian-rooted campaigns.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Faithful America", authorRole: "Movement Organization", targetUrl: "https://www.faithfulamerica.org/", topImageKey: "org_faithful-america" },
  { id: 1062, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign anti-militarism petitions", description: "Foreign policy + military restraint.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Win Without War", authorRole: "Movement Organization", targetUrl: "https://winwithoutwar.org/", topImageKey: "org_win-without-war" },
  { id: 1063, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign petitions to close ICE facilities", description: "Petitions targeting specific ICE facilities.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Detention Watch Network", authorRole: "Movement Organization", targetUrl: "https://www.detentionwatchnetwork.org/", topImageKey: "org_detention-watch-network" },
  { id: 1064, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign the open letter against book bans", description: "Pledge from authors + librarians + readers.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Authors Against Book Bans", authorRole: "Movement Organization", targetUrl: "https://www.authorsagainstbookbans.com/", topImageKey: "org_authors-against-book-bans" },
  { id: 1065, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign Avaaz US-targeted petitions", description: "High signature volume; US-specific campaigns.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Avaaz", authorRole: "Movement Organization", targetUrl: "https://secure.avaaz.org/page/en/", topImageKey: "org_avaaz" },
  { id: 1066, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign current petitions (formerly PFAW)", description: "PFAW rebranded — live action list.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "People For (formerly People For the American Way)", authorRole: "Movement Organization", targetUrl: "https://www.peoplefor.org/", topImageKey: "org_people-for-formerly-people-for-the-american-way" },
  { id: 1067, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign children's-rights petitions", description: "Healthcare, gun violence, child poverty.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Children's Defense Fund", authorRole: "Movement Organization", targetUrl: "https://www.childrensdefense.org/", topImageKey: "org_children-s-defense-fund" },
  { id: 1068, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Become a SURJ member", description: "White-organized solidarity work.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Showing Up for Racial Justice", authorRole: "Movement Organization", targetUrl: "https://surj.org/", topImageKey: "org_showing-up-for-racial-justice" },
  { id: 1069, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Become a DSA member", description: "Largest socialist org in the US.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Democratic Socialists of America", authorRole: "Movement Organization", targetUrl: "https://www.dsausa.org/", topImageKey: "org_democratic-socialists-of-america" },
  { id: 1070, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Sunrise Movement", description: "Climate-led, youth-driven.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Sunrise Movement", authorRole: "Movement Organization", targetUrl: "https://www.sunrisemovement.org/", topImageKey: "org_sunrise-movement" },
  { id: 1071, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Mijente", description: "Latinx organizing; immigration + abolition.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Mijente", authorRole: "Movement Organization", targetUrl: "https://mijente.net/", topImageKey: "org_mijente" },
  { id: 1072, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join United We Dream", description: "Largest immigrant-youth-led network.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "United We Dream", authorRole: "Movement Organization", targetUrl: "https://unitedwedream.org/", topImageKey: "org_united-we-dream" },
  { id: 1073, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Bend the Arc", description: "Jewish anti-authoritarian organizing.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Bend the Arc (Jewish progressive)", authorRole: "Movement Organization", targetUrl: "https://www.bendthearc.us/", topImageKey: "org_bend-the-arc-jewish-progressive" },
  { id: 1074, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Jewish Voice for Peace", description: "Jewish anti-occupation + civil-liberties.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Jewish Voice for Peace", authorRole: "Movement Organization", targetUrl: "https://www.jewishvoiceforpeace.org/", topImageKey: "org_jewish-voice-for-peace" },
  { id: 1075, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join T'ruah (rabbinic human rights)", description: "Rabbis + cantors leading on immigration + dignity.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "T'ruah", authorRole: "Movement Organization", targetUrl: "https://truah.org/", topImageKey: "org_t-ruah" },
  { id: 1076, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Subscribe to FCNL action alerts (Quaker)", description: "Constituent-action alerts.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Friends Committee on National Legislation", authorRole: "Movement Organization", targetUrl: "https://www.fcnl.org/", topImageKey: "org_friends-committee-on-national-legislation" },
  { id: 1077, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Pax Christi USA (Catholic peace)", description: "Catholic peace + justice movement.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Pax Christi USA", authorRole: "Movement Organization", targetUrl: "https://paxchristiusa.org/", topImageKey: "org_pax-christi-usa" },
  { id: 1078, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a NETWORK action (Catholic social justice)", description: "Nuns-on-the-bus tradition.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "NETWORK Lobby", authorRole: "Movement Organization", targetUrl: "https://networklobby.org/", topImageKey: "org_network-lobby" },
  { id: 1079, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Hindus for Human Rights", description: "Counter to Hindu nationalism.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Hindus for Human Rights", authorRole: "Movement Organization", targetUrl: "https://www.hindusforhumanrights.org/", topImageKey: "org_hindus-for-human-rights" },
  { id: 1080, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a Sikh Coalition action", description: "Civil rights advocacy.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Sikh Coalition", authorRole: "Movement Organization", targetUrl: "https://www.sikhcoalition.org/", topImageKey: "org_sikh-coalition" },
  { id: 1081, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Become a Veterans for Peace member", description: "All-vet pacifist + civil-liberties.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Veterans for Peace", authorRole: "Movement Organization", targetUrl: "https://www.veteransforpeace.org/", topImageKey: "org_veterans-for-peace" },
  { id: 1082, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join About Face: Veterans Against the War", description: "Post-9/11 vet org.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "About Face", authorRole: "Movement Organization", targetUrl: "https://aboutfaceveterans.org/", topImageKey: "org_about-face" },
  { id: 1083, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Sign up with Code Pink", description: "Women-led peace + civil-liberties.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Code Pink", authorRole: "Movement Organization", targetUrl: "https://www.codepink.org/", topImageKey: "org_code-pink" },
  { id: 1084, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Volunteer with Mothers Out Front", description: "Mom-led climate org.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Mothers Out Front", authorRole: "Movement Organization", targetUrl: "https://mothersoutfront.org/", topImageKey: "org_mothers-out-front" },
  { id: 1085, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take an ADAPT action (disability rights)", description: "Disability-led direct-action network.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "ADAPT", authorRole: "Movement Organization", targetUrl: "https://adapt.org/", topImageKey: "org_adapt" },
  { id: 1086, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a Black Voters Matter action", description: "Black-led civic engagement.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Black Voters Matter", authorRole: "Movement Organization", targetUrl: "https://blackvotersmatterfund.org/", topImageKey: "org_black-voters-matter" },
  { id: 1087, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a Mi Familia Vota action", description: "Latino civic engagement.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Mi Familia Vota", authorRole: "Movement Organization", targetUrl: "https://www.mifamiliavota.org/", topImageKey: "org_mi-familia-vota" },
  { id: 1088, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a Climate Justice Alliance action", description: "Frontline community-led climate work.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Climate Justice Alliance", authorRole: "Movement Organization", targetUrl: "https://climatejusticealliance.org/", topImageKey: "org_climate-justice-alliance" },
  { id: 1089, category: "HOUSING", categoryColor: "#0a5b89", actionType: "In Person Group", title: "Find your local tenants union", description: "Federation of grassroots tenants unions.", isOnline: false, boosts: 4, spotsTotal: "Unlimited", authorName: "Autonomous Tenants Union Network (ATUN)", authorRole: "Movement Organization", targetUrl: "https://atun-rias.org/", topImageKey: "org_autonomous-tenants-union-network-atun" },
  { id: 1090, category: "HOUSING", categoryColor: "#0a5b89", actionType: "In Person Group", title: "Volunteer remotely on eviction-data mapping", description: "Data + mapping volunteer roles.", isOnline: false, boosts: 4, spotsTotal: "Unlimited", authorName: "Anti-Eviction Mapping Project", authorRole: "Movement Organization", targetUrl: "https://antievictionmap.com/", topImageKey: "org_anti-eviction-mapping-project" },
  { id: 1091, category: "HOUSING", categoryColor: "#0a5b89", actionType: "In Person Group", title: "Sponsor a refugee household", description: "Verified pathway; remote prep work.", isOnline: false, boosts: 4, spotsTotal: "Unlimited", authorName: "Welcome.US", authorRole: "Movement Organization", targetUrl: "https://welcome.us/", topImageKey: "org_welcome-us" },
  { id: 1092, category: "HOUSING", categoryColor: "#0a5b89", actionType: "In Person Group", title: "Make your city 'welcoming' for immigrants", description: "Process to certify as welcoming city.", isOnline: false, boosts: 4, spotsTotal: "Unlimited", authorName: "Welcoming America", authorRole: "Movement Organization", targetUrl: "https://welcomingamerica.org/", topImageKey: "org_welcoming-america" },
  { id: 1093, category: "HOUSING", categoryColor: "#0a5b89", actionType: "In Person Group", title: "Pressure your mayor on sanctuary policy", description: "Mayor coalition for immigrant-friendly cities.", isOnline: false, boosts: 4, spotsTotal: "Unlimited", authorName: "Cities for Action", authorRole: "Movement Organization", targetUrl: "https://www.citiesforaction.us/", topImageKey: "org_cities-for-action" },
  { id: 1094, category: "HOUSING", categoryColor: "#0a5b89", actionType: "In Person Group", title: "Volunteer to furnish + resettle refugee homes", description: "DC-based; replicable model + remote roles.", isOnline: false, boosts: 4, spotsTotal: "Unlimited", authorName: "Homes Not Borders", authorRole: "Movement Organization", targetUrl: "https://www.homesnotborders.org/", topImageKey: "org_homes-not-borders" },
  { id: 1095, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Get an organizer for your workplace", description: "Free organizer matching for non-union workers.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "EWOC (Emergency Workplace Organizing Committee)", authorRole: "Movement Organization", targetUrl: "https://workerorganizing.org/", topImageKey: "org_ewoc-emergency-workplace-organizing-committee" },
  { id: 1096, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Join the federal-worker network", description: "Federal-worker organizing + mutual aid.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Federal Unionists Network", authorRole: "Movement Organization", targetUrl: "https://www.federalunionists.net/", topImageKey: "org_federal-unionists-network" },
  { id: 1097, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Subscribe to independent labor media", description: "Independent labor media + training calendar.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Labor Notes", authorRole: "Movement Organization", targetUrl: "https://labornotes.org/", topImageKey: "org_labor-notes" },
  { id: 1098, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Start a workplace petition", description: "DIY workplace petition tool.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Coworker.org", authorRole: "Movement Organization", targetUrl: "https://home.coworker.org/", topImageKey: "org_coworker-org" },
  { id: 1099, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Take a UE solidarity action", description: "Independent rank-and-file union.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "UE (United Electrical Workers)", authorRole: "Movement Organization", targetUrl: "https://www.ueunion.org/", topImageKey: "org_ue-united-electrical-workers" },
  { id: 1100, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Apply for IWW membership", description: "All-trades radical union; remote onboarding.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Industrial Workers of the World", authorRole: "Movement Organization", targetUrl: "https://www.iww.org/", topImageKey: "org_industrial-workers-of-the-world" },
  { id: 1101, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Take an action with NDWA", description: "Domestic worker rights.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "National Domestic Workers Alliance", authorRole: "Movement Organization", targetUrl: "https://www.domesticworkers.org/", topImageKey: "org_national-domestic-workers-alliance" },
  { id: 1102, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Send solidarity to Starbucks Workers United", description: "Solidarity + petition tools.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Starbucks Workers United", authorRole: "Movement Organization", targetUrl: "https://sbworkersunited.org/", topImageKey: "org_starbucks-workers-united" },
  { id: 1103, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Take an Amazon Labor Union action", description: "Solidarity + petition tools.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Amazon Labor Union (IBT Local 1)", authorRole: "Movement Organization", targetUrl: "https://www.amazonlaborunion.org/", topImageKey: "org_amazon-labor-union-ibt-local-1" },
  { id: 1104, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Use the free legal hotline (workplace family rights)", description: "Workplace family + caregiving legal hotline.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "A Better Balance", authorRole: "Movement Organization", targetUrl: "https://www.abetterbalance.org/", topImageKey: "org_a-better-balance" },
  { id: 1105, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Take an action (formerly Fight for $15)", description: "Living-wage + sectoral organizing — successor to Fight for $15.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Fight For A Union", authorRole: "Movement Organization", targetUrl: "https://fightforaunion.org/", topImageKey: "org_fight-for-a-union" },
  { id: 1106, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Sign the moral covenant", description: "Poor people's commitment.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Repairers of the Breach (Rev. Barber)", authorRole: "Movement Organization", targetUrl: "https://breachrepairers.org/", topImageKey: "org_repairers-of-the-breach-rev-barber" },
  { id: 1107, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Subscribe to action alerts", description: "Christian justice action emails.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Sojourners", authorRole: "Movement Organization", targetUrl: "https://sojo.net/", topImageKey: "org_sojourners" },
  { id: 1108, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Subscribe to actions", description: "Christian-rooted action campaigns.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Faithful America", authorRole: "Movement Organization", targetUrl: "https://www.faithfulamerica.org/", topImageKey: "org_faithful-america" },
  { id: 1109, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Take an action", description: "Multi-faith advocacy.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Faith in Public Life", authorRole: "Movement Organization", targetUrl: "https://www.faithinpubliclife.org/", topImageKey: "org_faith-in-public-life" },
  { id: 1110, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Take a rabbinic action", description: "Rabbis + cantors mobilizing.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "T'ruah", authorRole: "Movement Organization", targetUrl: "https://truah.org/", topImageKey: "org_t-ruah" },
  { id: 1111, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Take an action", description: "Catholic peace movement.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Pax Christi USA", authorRole: "Movement Organization", targetUrl: "https://paxchristiusa.org/", topImageKey: "org_pax-christi-usa" },
  { id: 1112, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Subscribe to Quaker action alerts", description: "Constituent-action emails.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Friends Committee on National Legislation", authorRole: "Movement Organization", targetUrl: "https://www.fcnl.org/", topImageKey: "org_friends-committee-on-national-legislation" },
  { id: 1113, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Take an action", description: "Multi-faith leadership network.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Auburn Seminary", authorRole: "Movement Organization", targetUrl: "https://auburnseminary.org/", topImageKey: "org_auburn-seminary" },
  { id: 1114, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Take an action", description: "Civil-engagement actions.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Muslim Public Affairs Council (MPAC)", authorRole: "Movement Organization", targetUrl: "https://www.mpac.org/", topImageKey: "org_muslim-public-affairs-council-mpac" },
  { id: 1115, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Take an action", description: "Counter to Hindu nationalism in US politics.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Hindus for Human Rights", authorRole: "Movement Organization", targetUrl: "https://www.hindusforhumanrights.org/", topImageKey: "org_hindus-for-human-rights" },
  { id: 1116, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Take an action", description: "Civil rights advocacy.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Sikh Coalition", authorRole: "Movement Organization", targetUrl: "https://www.sikhcoalition.org/", topImageKey: "org_sikh-coalition" },
  { id: 1117, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Sign up as a volunteer attorney", description: "Pro bono lawyer matching.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "We the Action", authorRole: "Movement Organization", targetUrl: "https://wetheaction.org/", topImageKey: "org_we-the-action" },
  { id: 1118, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer as an attorney", description: "Largest pro bono civil-liberties network.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Lawyers for Good Government", authorRole: "Movement Organization", targetUrl: "https://www.lawyersforgoodgovernment.org/", topImageKey: "org_lawyers-for-good-government" },
  { id: 1119, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Find pro bono cases (formerly Pro Bono Net)", description: "Volunteer-attorney matching site.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Scale Justice (Pro Bono Net)", authorRole: "Movement Organization", targetUrl: "https://scalejustice.org/", topImageKey: "org_scale-justice-pro-bono-net" },
  { id: 1120, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer your tech skills", description: "Civic-tech projects + local brigades.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Code for America", authorRole: "Movement Organization", targetUrl: "https://codeforamerica.org/", topImageKey: "org_code-for-america" },
  { id: 1121, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Sign up as a tech volunteer", description: "Civic-tech volunteer matching.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "DemocracyLab", authorRole: "Movement Organization", targetUrl: "https://www.democracylab.org/", topImageKey: "org_democracylab" },
  { id: 1122, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer your professional skills", description: "Skill-based volunteering for nonprofits.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Catchafire", authorRole: "Movement Organization", targetUrl: "https://www.catchafire.org/", topImageKey: "org_catchafire" },
  { id: 1123, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer as a translator", description: "Translation work for migrants + asylum seekers.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Respond Crisis Translation", authorRole: "Movement Organization", targetUrl: "https://respondcrisistranslation.org/", topImageKey: "org_respond-crisis-translation" },
  { id: 1124, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer as a linguist", description: "Crisis-language equity volunteer.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "CLEAR Global", authorRole: "Movement Organization", targetUrl: "https://clearglobal.org/", topImageKey: "org_clear-global" },
  { id: 1125, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Take an action (physicians)", description: "Healthcare-access advocacy.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Doctors for America", authorRole: "Movement Organization", targetUrl: "https://www.doctorsforamerica.org/", topImageKey: "org_doctors-for-america" },
  { id: 1126, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Train as asylum-evaluation clinician", description: "Asylum Network: forensic + asylum clinician training.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Physicians for Human Rights", authorRole: "Movement Organization", targetUrl: "https://phr.org/", topImageKey: "org_physicians-for-human-rights" },
  { id: 1127, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Sign up to run for office (STEM)", description: "Scientist + engineer candidate pipeline.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "314 Action", authorRole: "Movement Organization", targetUrl: "https://314action.org/", topImageKey: "org_314-action" },
  { id: 1128, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer with Authors Against Book Bans", description: "Coalition against book bans.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Authors Against Book Bans", authorRole: "Movement Organization", targetUrl: "https://www.authorsagainstbookbans.com/", topImageKey: "org_authors-against-book-bans" },
  { id: 1129, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Join Concerned Archivists Alliance", description: "Archivists organizing to preserve federal records.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Concerned Archivists Alliance", authorRole: "Movement Organization", targetUrl: "https://concernedarchivists.org/", topImageKey: "org_concerned-archivists-alliance" },
  { id: 1130, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer on detained-immigrant cases", description: "Pro bono training + case signup.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Immigration Justice Campaign", authorRole: "Movement Organization", targetUrl: "https://immigrationjustice.us/", topImageKey: "org_immigration-justice-campaign" },
  { id: 1131, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Take the anti-coup civil-resistance pledge", description: "Public commitment to nonviolent resistance.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Choose Democracy", authorRole: "Movement Organization", targetUrl: "https://choosedemocracy.us/", topImageKey: "org_choose-democracy" },
  { id: 1132, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Take the bystander intervention pledge", description: "Free training + intervention commitment.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Right To Be (formerly Hollaback)", authorRole: "Movement Organization", targetUrl: "https://righttobe.org/", topImageKey: "org_right-to-be-formerly-hollaback" },
  { id: 1133, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Make daily-call habit", description: "Pre-written scripts; one set per weekday.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "5 Calls", authorRole: "Movement Organization", targetUrl: "https://5calls.org/", topImageKey: "org_5-calls" },
  { id: 1134, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Set up daily texts to your reps", description: "Text RESIST to 50409.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Resistbot", authorRole: "Movement Organization", targetUrl: "https://resist.bot/", topImageKey: "org_resistbot" },
  { id: 1135, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Carry KYR cards for ICE encounters", description: "Print + pocket Know-Your-Rights cards.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Immigrant Defense Project", authorRole: "Movement Organization", targetUrl: "https://www.immigrantdefenseproject.org/", topImageKey: "org_immigrant-defense-project" },
  { id: 1136, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Pledge to drive abortion-seekers", description: "Network of practical-support funds.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Apiary for Practical Support", authorRole: "Movement Organization", targetUrl: "https://apiaryps.org/", topImageKey: "org_apiary-for-practical-support" },
  { id: 1137, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Set election reminders for every contest", description: "All elections, every level — automatic alerts.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Vote.org", authorRole: "Movement Organization", targetUrl: "https://www.vote.org/", topImageKey: "org_vote-org" },
  { id: 1138, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send an SMS that becomes an email/fax to your reps", description: "Text RESIST to 50409.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Resistbot", authorRole: "Movement Organization", targetUrl: "https://resist.bot/", topImageKey: "org_resistbot" },
  { id: 1139, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send today's email script", description: "Pre-written email + call scripts.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "5 Calls", authorRole: "Movement Organization", targetUrl: "https://5calls.org/", topImageKey: "org_5-calls" },
  { id: 1140, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send email-your-rep", description: "Live action list with email tools.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/", topImageKey: "org_common-cause" },
  { id: 1141, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send email-your-rep", description: "Live action list.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Public Citizen", authorRole: "Movement Organization", targetUrl: "https://www.citizen.org/", topImageKey: "org_public-citizen" },
  { id: 1142, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send anti-militarism email", description: "Foreign policy email actions.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Win Without War", authorRole: "Movement Organization", targetUrl: "https://winwithoutwar.org/", topImageKey: "org_win-without-war" },
  { id: 1143, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send Christian-rooted email-your-rep", description: "Faith-rooted email tool.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Faithful America", authorRole: "Movement Organization", targetUrl: "https://www.faithfulamerica.org/", topImageKey: "org_faithful-america" },
  { id: 1144, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send Quaker constituent email", description: "Constituent-action email tool.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Friends Committee on National Legislation", authorRole: "Movement Organization", targetUrl: "https://www.fcnl.org/", topImageKey: "org_friends-committee-on-national-legislation" },
  { id: 1145, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email targeting specific ICE facilities", description: "Email actions targeting facility operators.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Detention Watch Network", authorRole: "Movement Organization", targetUrl: "https://www.detentionwatchnetwork.org/", topImageKey: "org_detention-watch-network" },
  { id: 1146, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email your school board re: book bans", description: "Pre-written templates.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Authors Against Book Bans", authorRole: "Movement Organization", targetUrl: "https://www.authorsagainstbookbans.com/", topImageKey: "org_authors-against-book-bans" },
  { id: 1147, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Sign up for a workshop", description: "Direct-action + facilitation skills.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Training for Change", authorRole: "Movement Organization", targetUrl: "https://www.trainingforchange.org/", topImageKey: "org_training-for-change" },
  { id: 1148, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Sign up for a training", description: "Direct-action training.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Ruckus Society", authorRole: "Movement Organization", targetUrl: "https://ruckus.org/", topImageKey: "org_ruckus-society" },
  { id: 1149, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Apply to a cohort", description: "Movement-strategy training for groups.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Wildfire Project", authorRole: "Movement Organization", targetUrl: "https://wildfireproject.org/", topImageKey: "org_wildfire-project" },
  { id: 1150, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Take a course", description: "Online classes for organizers; sliding scale.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "PeoplesHub", authorRole: "Movement Organization", targetUrl: "https://www.peopleshub.org/", topImageKey: "org_peopleshub" },
  { id: 1151, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Enroll in a free training", description: "Free virtual bystander intervention trainings.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Right To Be", authorRole: "Movement Organization", targetUrl: "https://righttobe.org/", topImageKey: "org_right-to-be" },
  { id: 1152, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Enroll in anti-coup training", description: "Free workshop calendar.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Choose Democracy", authorRole: "Movement Organization", targetUrl: "https://choosedemocracy.us/", topImageKey: "org_choose-democracy" },
  { id: 1153, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Enroll in programs", description: "Storied southern movement school.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Highlander Center", authorRole: "Movement Organization", targetUrl: "https://beta.highlandercenter.org/", topImageKey: "org_highlander-center" },
  { id: 1154, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Sign up for a curriculum", description: "Just-transition + ecological-justice education.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Movement Generation", authorRole: "Movement Organization", targetUrl: "https://movementgeneration.org/", topImageKey: "org_movement-generation" },
  { id: 1155, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Take an abolitionist study course", description: "Free curricula + reading groups.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Project NIA", authorRole: "Movement Organization", targetUrl: "https://project-nia.org/", topImageKey: "org_project-nia" },
  { id: 1156, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Sign up for a reading group", description: "Free abolitionist study materials.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Critical Resistance", authorRole: "Movement Organization", targetUrl: "https://criticalresistance.org/", topImageKey: "org_critical-resistance" },
  { id: 1157, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Apply to be a paid poll worker", description: "Direct application form.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Power the Polls", authorRole: "Movement Organization", targetUrl: "https://www.powerthepolls.org/", topImageKey: "org_power-the-polls" },
  { id: 1158, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Take a Know Your Rights training", description: "Live training calendar for ICE encounters.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Immigrant Defense Project", authorRole: "Movement Organization", targetUrl: "https://www.immigrantdefenseproject.org/", topImageKey: "org_immigrant-defense-project" },
  { id: 1159, category: "SPREAD POSITIVITY", categoryColor: "#d97706", actionType: "Online", title: "Sign up to write letters to isolated seniors", description: "Hand-written letters.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Letters Against Isolation", authorRole: "Movement Organization", targetUrl: "https://www.lettersagainstisolation.com/", topImageKey: "org_letters-against-isolation" },
  { id: 1160, category: "SPREAD POSITIVITY", categoryColor: "#d97706", actionType: "Online", title: "Sign up for kindness-toned voter postcards", description: "Hand-written voter outreach.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Postcards to Voters", authorRole: "Movement Organization", targetUrl: "https://postcardstovoters.org/", topImageKey: "org_postcards-to-voters" },
  { id: 1161, category: "SPREAD POSITIVITY", categoryColor: "#d97706", actionType: "Online", title: "Become a pen pal to a detained migrant", description: "Letter-writing program.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Freedom for Immigrants", authorRole: "Movement Organization", targetUrl: "https://www.freedomforimmigrants.org/", topImageKey: "org_freedom-for-immigrants" },
  { id: 1162, category: "SPREAD POSITIVITY", categoryColor: "#d97706", actionType: "Online", title: "Volunteer (LGBTQ youth digital crisis support)", description: "24/7 chat / text / phone volunteer signup.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "The Trevor Project", authorRole: "Movement Organization", targetUrl: "https://www.thetrevorproject.org/", topImageKey: "org_the-trevor-project" },
  { id: 1163, category: "SPREAD POSITIVITY", categoryColor: "#d97706", actionType: "Online", title: "Submit + read kindness practices", description: "Daily prompts + community board.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Random Acts of Kindness Foundation", authorRole: "Movement Organization", targetUrl: "https://www.randomactsofkindness.org/", topImageKey: "org_random-acts-of-kindness-foundation" },
  { id: 1164, category: "SPREAD POSITIVITY", categoryColor: "#d97706", actionType: "Online", title: "Practice rest-as-resistance prompts", description: "Free practice library.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "The Nap Ministry (Tricia Hersey)", authorRole: "Movement Organization", targetUrl: "https://thenapministry.com/", topImageKey: "org_the-nap-ministry-tricia-hersey" },
  { id: 1165, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Find + amplify your local mutual aid", description: "Map of US-wide mutual aid networks.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Mutual Aid Hub", authorRole: "Movement Organization", targetUrl: "https://www.mutualaidhub.org/", topImageKey: "org_mutual-aid-hub" },
  { id: 1166, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Boost a single Olive Branch family fund", description: "Family-by-family signal-boost queue.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Operation Olive Branch", authorRole: "Movement Organization", targetUrl: "https://operationolivebranch.org/", topImageKey: "org_operation-olive-branch" },
  { id: 1167, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Subscribe + share Capital B (Black-led)", description: "Boost coverage on socials.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Capital B", authorRole: "Movement Organization", targetUrl: "https://capitalbnews.org/", topImageKey: "org_capital-b" },
  { id: 1168, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Subscribe + share The 19th* (gender + politics)", description: "Boost coverage on socials.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "The 19th*", authorRole: "Movement Organization", targetUrl: "https://19thnews.org/", topImageKey: "org_the-19th" },
  { id: 1169, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Subscribe + share Documented (NYC immigration)", description: "Boost coverage on socials.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Documented", authorRole: "Movement Organization", targetUrl: "https://documentedny.com/", topImageKey: "org_documented" },
  { id: 1170, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Subscribe + share Indian Country Today", description: "Indigenous-led national news.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "ICT News", authorRole: "Movement Organization", targetUrl: "https://ictnews.org/", topImageKey: "org_ict-news" },
  { id: 1171, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Subscribe + share The Lever", description: "Dark-money + corruption.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "The Lever", authorRole: "Movement Organization", targetUrl: "https://www.levernews.com/", topImageKey: "org_the-lever" },
  { id: 1172, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Submit + share a press-freedom incident", description: "Submission form + amplification.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "U.S. Press Freedom Tracker", authorRole: "Movement Organization", targetUrl: "https://pressfreedomtracker.us/", topImageKey: "org_u-s-press-freedom-tracker" },
  { id: 1173, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", title: "Submit art to open calls", description: "Artist coalition open-call submission.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "For Freedoms", authorRole: "Movement Organization", targetUrl: "https://forfreedoms.org/", topImageKey: "org_for-freedoms" },
  { id: 1174, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", title: "Download free protest art", description: "Free downloadable posters.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Amplifier", authorRole: "Movement Organization", targetUrl: "https://amplifier.org/", topImageKey: "org_amplifier" },
  { id: 1175, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", title: "Download free anti-fascist posters", description: "Anti-fascist printmakers.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Justseeds Artists' Cooperative", authorRole: "Movement Organization", targetUrl: "https://justseeds.org/", topImageKey: "org_justseeds-artists-cooperative" },
  { id: 1176, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", title: "Download educational graphics", description: "Hand-drawn movement graphics, free.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Beehive Design Collective", authorRole: "Movement Organization", targetUrl: "https://beehivecollective.org/", topImageKey: "org_beehive-design-collective" },
  { id: 1177, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", title: "Submit an embroidery piece", description: "Embroider a Trump quote, ship to the archive.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Tiny Pricks Project", authorRole: "Movement Organization", targetUrl: "https://www.tinypricksproject.com/", topImageKey: "org_tiny-pricks-project" },
  { id: 1178, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", title: "Apply to programs", description: "Forum theater + virtual workshops.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Theatre of the Oppressed NYC", authorRole: "Movement Organization", targetUrl: "https://www.tonyc.nyc/", topImageKey: "org_theatre-of-the-oppressed-nyc" },
  { id: 1179, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", title: "Use the tactical-prank toolkit", description: "Step-by-step corporate-satire playbook.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "The Yes Men", authorRole: "Movement Organization", targetUrl: "https://theyesmen.org/", topImageKey: "org_the-yes-men" },
  { id: 1180, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", title: "Refer an artist at risk", description: "Solidarity support for persecuted artists.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Artists at Risk Connection (PEN America)", authorRole: "Movement Organization", targetUrl: "https://artistsatriskconnection.org/", topImageKey: "org_artists-at-risk-connection-pen-america" },
  { id: 1181, category: "ACT OF KINDNESS", categoryColor: "#0d8c6e", actionType: "Online", title: "Find your local mutual aid network", description: "Locator map; pick a neighbor to support.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Mutual Aid Hub", authorRole: "Movement Organization", targetUrl: "https://www.mutualaidhub.org/", topImageKey: "org_mutual-aid-hub" },
  { id: 1182, category: "ACT OF KINDNESS", categoryColor: "#0d8c6e", actionType: "Online", title: "Sponsor a refugee household", description: "Direct sponsorship pathway.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Welcome.US", authorRole: "Movement Organization", targetUrl: "https://welcome.us/", topImageKey: "org_welcome-us" },
  { id: 1183, category: "ACT OF KINDNESS", categoryColor: "#0d8c6e", actionType: "Online", title: "Become a pen pal to a detained migrant", description: "Letter-writing program.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Freedom for Immigrants", authorRole: "Movement Organization", targetUrl: "https://www.freedomforimmigrants.org/", topImageKey: "org_freedom-for-immigrants" },
  { id: 1184, category: "ACT OF KINDNESS", categoryColor: "#0d8c6e", actionType: "Online", title: "Write a political prisoner", description: "Updated address list + writing guidelines.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "NYC Anarchist Black Cross", authorRole: "Movement Organization", targetUrl: "https://nycabc.wordpress.com/", topImageKey: "org_nyc-anarchist-black-cross" },
  { id: 1185, category: "ACT OF KINDNESS", categoryColor: "#0d8c6e", actionType: "Online", title: "Volunteer as a Pickup Buddy (repro)", description: "Drive abortion-seekers home post-appointment.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Apiary for Practical Support", authorRole: "Movement Organization", targetUrl: "https://apiaryps.org/", topImageKey: "org_apiary-for-practical-support" },
  { id: 1186, category: "ACT OF KINDNESS", categoryColor: "#0d8c6e", actionType: "Online", title: "Volunteer as a translator for asylum seekers", description: "Document translation.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Respond Crisis Translation", authorRole: "Movement Organization", targetUrl: "https://respondcrisistranslation.org/", topImageKey: "org_respond-crisis-translation" },
  { id: 1187, category: "ACT OF KINDNESS", categoryColor: "#0d8c6e", actionType: "Online", title: "Find your Buy Nothing group", description: "Hyper-local gift-economy.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Buy Nothing Project", authorRole: "Movement Organization", targetUrl: "https://buynothingproject.org/", topImageKey: "org_buy-nothing-project" },
  { id: 1188, category: "BOOST FACTS", categoryColor: "#5a009e", actionType: "Online", title: "Subscribe to The 19th* newsletter", description: "Gender + politics; underreported repro/trans coverage.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "The 19th*", authorRole: "Movement Organization", targetUrl: "https://19thnews.org/", topImageKey: "org_the-19th" },
  { id: 1189, category: "BOOST FACTS", categoryColor: "#5a009e", actionType: "Online", title: "Subscribe to Capital B newsletter", description: "Black-led national investigative.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Capital B", authorRole: "Movement Organization", targetUrl: "https://capitalbnews.org/", topImageKey: "org_capital-b" },
  { id: 1190, category: "BOOST FACTS", categoryColor: "#5a009e", actionType: "Online", title: "Subscribe to Documented newsletter", description: "NYC immigration + workers' rights.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Documented", authorRole: "Movement Organization", targetUrl: "https://documentedny.com/", topImageKey: "org_documented" },
  { id: 1191, category: "BOOST FACTS", categoryColor: "#5a009e", actionType: "Online", title: "Subscribe to The Lever", description: "Dark-money + corruption.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "The Lever", authorRole: "Movement Organization", targetUrl: "https://www.levernews.com/", topImageKey: "org_the-lever" },
  { id: 1192, category: "BOOST FACTS", categoryColor: "#5a009e", actionType: "Online", title: "Subscribe to Sludge", description: "Campaign-finance corruption specialist.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Sludge", authorRole: "Movement Organization", targetUrl: "https://readsludge.com/", topImageKey: "org_sludge" },
  { id: 1193, category: "BOOST FACTS", categoryColor: "#5a009e", actionType: "Online", title: "Subscribe to Bolts Magazine", description: "Local DA / sheriff / election admin.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Bolts Magazine", authorRole: "Movement Organization", targetUrl: "https://boltsmag.org/", topImageKey: "org_bolts-magazine" },
  { id: 1194, category: "BOOST FACTS", categoryColor: "#5a009e", actionType: "Online", title: "Subscribe to Drop Site News", description: "Ex-Intercept staff; war + civil liberties.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Drop Site News", authorRole: "Movement Organization", targetUrl: "https://www.dropsitenews.com/", topImageKey: "org_drop-site-news" },
  { id: 1195, category: "BOOST FACTS", categoryColor: "#5a009e", actionType: "Online", title: "Subscribe to Type Investigations", description: "Funded investigative reporting.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Type Investigations", authorRole: "Movement Organization", targetUrl: "https://www.typeinvestigations.org/", topImageKey: "org_type-investigations" },
  { id: 1196, category: "BOOST FACTS", categoryColor: "#5a009e", actionType: "Online", title: "Subscribe to More Perfect Union", description: "Worker-power video journalism.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "More Perfect Union", authorRole: "Movement Organization", targetUrl: "https://perfectunion.us/", topImageKey: "org_more-perfect-union" },
  { id: 1197, category: "BOOST FACTS", categoryColor: "#5a009e", actionType: "Online", title: "Subscribe to Indian Country Today", description: "Indigenous-led national news.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "ICT News (Indian Country Today)", authorRole: "Movement Organization", targetUrl: "https://ictnews.org/", topImageKey: "org_ict-news-indian-country-today" },
  { id: 1198, category: "BOOST FACTS", categoryColor: "#5a009e", actionType: "Online", title: "Subscribe to Native News Online", description: "Daily Native news.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Native News Online", authorRole: "Movement Organization", targetUrl: "https://nativenewsonline.net/", topImageKey: "org_native-news-online" },
  { id: 1199, category: "BOOST FACTS", categoryColor: "#5a009e", actionType: "Online", title: "Subscribe to High Country News", description: "Western US, public lands, Indigenous focus.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "High Country News", authorRole: "Movement Organization", targetUrl: "https://www.hcn.org/", topImageKey: "org_high-country-news" },
  { id: 1200, category: "BOOST FACTS", categoryColor: "#5a009e", actionType: "Online", title: "Subscribe to Prism Reports", description: "BIPOC-led independent newsroom.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Prism Reports", authorRole: "Movement Organization", targetUrl: "https://prismreports.org/", topImageKey: "org_prism-reports" },
  { id: 1201, category: "BOOST FACTS", categoryColor: "#5a009e", actionType: "Online", title: "Subscribe to Disability Visibility Project", description: "Disability-community media + storytelling.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Disability Visibility Project", authorRole: "Movement Organization", targetUrl: "https://disabilityvisibilityproject.com/", topImageKey: "org_disability-visibility-project" },
  { id: 1202, category: "BOOST FACTS", categoryColor: "#5a009e", actionType: "Online", title: "Subscribe to Inkstick Media", description: "Foreign policy from a non-DC perspective.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Inkstick Media", authorRole: "Movement Organization", targetUrl: "https://inkstickmedia.com/", topImageKey: "org_inkstick-media" },
  { id: 1203, category: "BOOST FACTS", categoryColor: "#5a009e", actionType: "Online", title: "Read + share data", description: "Wealth-concentration data + analysis.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Inequality.org", authorRole: "Movement Organization", targetUrl: "https://inequality.org/", topImageKey: "org_inequality-org" },
  { id: 1204, category: "LETTER TO EDITOR", categoryColor: "#3f5c8c", actionType: "Online", title: "Sign up for op-ed training", description: "Training to land op-eds in major papers.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "The OpEd Project", authorRole: "Movement Organization", targetUrl: "https://www.theopedproject.org/", topImageKey: "org_the-oped-project" },
  { id: 1205, category: "LETTER TO EDITOR", categoryColor: "#3f5c8c", actionType: "Online", title: "Use weekly LTE prompts (formerly Sister District)", description: "State-targeted LTEs.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "States Win (FKA Sister District)", authorRole: "Movement Organization", targetUrl: "https://stateswin.org/", topImageKey: "org_states-win-fka-sister-district" },
  { id: 1206, category: "LETTER TO EDITOR", categoryColor: "#3f5c8c", actionType: "Online", title: "Use the Two-Minute Activist tool", description: "LTE templates + submission tools.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "AAUW", authorRole: "Movement Organization", targetUrl: "https://www.aauw.org/", topImageKey: "org_aauw" },
  { id: 1207, category: "LETTER TO EDITOR", categoryColor: "#3f5c8c", actionType: "Online", title: "Use the LTE writer tool", description: "Climate-focused with chapter targets.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Sierra Club", authorRole: "Movement Organization", targetUrl: "https://www.sierraclub.org/", topImageKey: "org_sierra-club" },
  { id: 1208, category: "LETTER TO EDITOR", categoryColor: "#3f5c8c", actionType: "Online", title: "Use LTE templates with verified statistics", description: "Templates with embedded stats.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Inequality.org", authorRole: "Movement Organization", targetUrl: "https://inequality.org/", topImageKey: "org_inequality-org" },
  { id: 1209, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Find a sliding-scale therapist ($40-$80/session)", description: "Sessions $40-$80 with vetted therapists.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Open Path Psychotherapy Collective", authorRole: "Movement Organization", targetUrl: "https://openpathcollective.org/", topImageKey: "org_open-path-psychotherapy-collective" },
  { id: 1210, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Find a culturally-affirming therapist", description: "Vetted-for-cultural-humility directory.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Inclusive Therapists", authorRole: "Movement Organization", targetUrl: "https://www.inclusivetherapists.com/", topImageKey: "org_inclusive-therapists" },
  { id: 1211, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Find a therapist (Therapy for Black Girls)", description: "Black-women-led directory.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Therapy for Black Girls", authorRole: "Movement Organization", targetUrl: "https://therapyforblackgirls.com/", topImageKey: "org_therapy-for-black-girls" },
  { id: 1212, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Find a therapist (Latinx Therapy)", description: "Latinx-focused directory.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Latinx Therapy", authorRole: "Movement Organization", targetUrl: "https://latinxtherapy.com/", topImageKey: "org_latinx-therapy" },
  { id: 1213, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Find a therapist (Asian Mental Health Collective)", description: "AAPI directory.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Asian Mental Health Collective", authorRole: "Movement Organization", targetUrl: "https://www.asianmhc.org/", topImageKey: "org_asian-mental-health-collective" },
  { id: 1214, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Find a therapist (South Asian Therapists)", description: "Specialized directory.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "South Asian Therapists", authorRole: "Movement Organization", targetUrl: "https://southasiantherapists.org/", topImageKey: "org_south-asian-therapists" },
  { id: 1215, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Call peer crisis line: 877-565-8860", description: "Trans-by-trans, no police.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Trans Lifeline", authorRole: "Movement Organization", targetUrl: "https://translifeline.org/", topImageKey: "org_trans-lifeline" },
  { id: 1216, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Reach via 24/7 chat / text / phone", description: "LGBTQ youth crisis line.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "The Trevor Project", authorRole: "Movement Organization", targetUrl: "https://www.thetrevorproject.org/", topImageKey: "org_the-trevor-project" },
  { id: 1217, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Call peer hotline / chat", description: "All-ages peer support.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "LGBT National Help Center", authorRole: "Movement Organization", targetUrl: "https://lgbthotline.org/", topImageKey: "org_lgbt-national-help-center" },
  { id: 1218, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Text HOME to 741741", description: "24/7 free trained counselor by text.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Crisis Text Line", authorRole: "Movement Organization", targetUrl: "https://www.crisistextline.org/", topImageKey: "org_crisis-text-line" },
  { id: 1219, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Subscribe to the Movement Memos podcast", description: "Anti-burnout movement podcast.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Truthout / Kelly Hayes", authorRole: "Movement Organization", targetUrl: "https://truthout.org/series/movement-memos/", topImageKey: "org_truthout-kelly-hayes" },
  { id: 1220, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Find a peer mental-health chapter", description: "Campus + online chapter network.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Active Minds", authorRole: "Movement Organization", targetUrl: "https://activeminds.org/", topImageKey: "org_active-minds" },
  { id: 1221, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Find a free virtual support group", description: "Family + peer groups, free, online.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "NAMI", authorRole: "Movement Organization", targetUrl: "https://www.nami.org/", topImageKey: "org_nami" },
  { id: 1222, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Apply to be a paid poll worker", description: "Direct application form.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Power the Polls", authorRole: "Movement Organization", targetUrl: "https://www.powerthepolls.org/", topImageKey: "org_power-the-polls" },
  { id: 1223, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Sign up to run for office (under 40, progressive)", description: "Candidate signup.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Run for Something", authorRole: "Movement Organization", targetUrl: "https://runforsomething.net/", topImageKey: "org_run-for-something" },
  { id: 1224, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Apply to candidate training (women)", description: "Free women's training calendar.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Vote Run Lead", authorRole: "Movement Organization", targetUrl: "https://voterunlead.org/", topImageKey: "org_vote-run-lead" },
  { id: 1225, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Apply to candidate training (Dem women)", description: "Pipeline application.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Emerge America", authorRole: "Movement Organization", targetUrl: "https://emergeamerica.org/", topImageKey: "org_emerge-america" },
  { id: 1226, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Apply to candidate training (Black women)", description: "Pipeline application.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Higher Heights for America", authorRole: "Movement Organization", targetUrl: "https://higherheightsforamerica.org/", topImageKey: "org_higher-heights-for-america" },
  { id: 1227, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Find / start a hyper-local gift-economy group", description: "Hyper-local gift-economy.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Buy Nothing Project", authorRole: "Movement Organization", targetUrl: "https://buynothingproject.org/", topImageKey: "org_buy-nothing-project" },
  { id: 1228, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Find a TimeBank near you", description: "Trade hours of skill instead of money.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "TimeBanks USA", authorRole: "Movement Organization", targetUrl: "https://www.timebanks.org/", topImageKey: "org_timebanks-usa" },
  { id: 1229, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Apply to be a foster-youth advocate", description: "Court-appointed special advocate.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "National CASA/GAL Association", authorRole: "Movement Organization", targetUrl: "https://nationalcasagal.org/", topImageKey: "org_national-casa-gal-association" },
  { id: 1230, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Save threatened gov pages with one click", description: "Internet Archive's preservation tool.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Wayback Machine 'Save Page Now'", authorRole: "Movement Organization", targetUrl: "https://web.archive.org/save", topImageKey: "org_wayback-machine-save-page-now" },
  { id: 1231, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Pick a banned book + read it", description: "Live, sortable list.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "PEN America banned-books list", authorRole: "Movement Organization", targetUrl: "https://pen.org/banned-books-list-2022/", topImageKey: "org_pen-america-banned-books-list" },
  { id: 1232, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Set election reminders (every contest)", description: "Automatic alerts for every level.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "Vote.org", authorRole: "Movement Organization", targetUrl: "https://www.vote.org/", topImageKey: "org_vote-org" },
  { id: 1233, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Find DOJ-accredited rep training", description: "Free certification to represent immigrants in EOIR proceedings.", isOnline: true, boosts: 4, spotsTotal: "Unlimited", authorName: "CLINIC (Catholic Legal Immigration Network)", authorRole: "Movement Organization", targetUrl: "https://www.cliniclegal.org/", topImageKey: "org_clinic-catholic-legal-immigration-network" },
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

    // Seed/refresh the org-action library (IDs 1000+) into KV. Bump the version
    // key (e.g. v2 → v3) whenever you've edited SEED_CARDS and want the live
    // feed to pick up the new title/url/image. Existing user activity (current
    // `boosts` count) is preserved — only metadata is overwritten.
    const orgsSeeded = await kv.get("seed:org-actions:v2");
    if (!orgsSeeded) {
      let count = 0;
      for (const card of SEED_CARDS) {
        if (card.id < 1000) continue;
        const existing = (await kv.get(`action:${card.id}`)) as any;
        const merged: any = { ...card };
        if (existing && typeof existing === "object") {
          // Preserve live engagement counters that users have moved.
          if (typeof existing.boosts === "number")        merged.boosts = existing.boosts;
          else if (typeof existing.spotsUsed === "number") merged.boosts = existing.spotsUsed;
        }
        await kv.set(`action:${card.id}`, merged);
        count++;
      }
      await kv.set("seed:org-actions:v2", true);
      console.log(`Re-seeded ${count} org-action cards (v2).`);
    }

    // One-time migration: any pre-rename card still using `spotsUsed` gets a
    // matching `boosts` field copied in (without removing spotsUsed, so an
    // older client deploy keeps working).
    const migratedBoosts = await kv.get("migrate:spotsused-to-boosts:v1");
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
      await kv.set("migrate:spotsused-to-boosts:v1", true);
      console.log(`Migrated ${migrated} cards from spotsUsed → boosts.`);
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
      boosts: 0,
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

    // Strip immutable fields. Admins can additionally set `boosts` directly
    // (used for moderation / corrections); non-admins cannot.
    const { id: _id, createdBy: _createdBy, createdAt: _createdAt,
            authorAvatarKey: _avatarKey, topImageKey: _topImageKey,
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