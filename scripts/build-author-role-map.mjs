// Builds + validates the author → role reclassification map for the
// "Movement Organization" catch-all cleanup. Cross-checks coverage against
// reports/movement-org-authors.json. Authors NOT in the map keep their
// current role (safe no-op). Run: node scripts/build-author-role-map.mjs
import fs from "node:fs";

// Controlled vocabulary (concise, accurate author descriptors):
//   Advocacy Org · Grassroots Network · Independent Newsroom · Civic Tech Tool
//   Faith Group · Labor Org · Mutual Aid Network · Legal Aid Org · Climate Org
//   Immigrant Rights Org · Direct Action Group · Training Org
//   Mental Health Resource · Artist Collective · Independent Creator
//   Voting Rights Org · Civil Rights Org · Business Directory
// Genuine member-based movement orgs intentionally KEEP "Movement Organization".

export const ROLE_BY_AUTHOR = {
  // ── Advocacy orgs (issue advocacy / petitions / lobbying) ──
  "Common Cause": "Advocacy Org",
  "Common Cause Oregon": "Advocacy Org",
  "Public Citizen": "Advocacy Org",
  "Demand Justice": "Advocacy Org",
  "Demand Progress": "Advocacy Org",
  "Free Press": "Advocacy Org",
  "Color of Change": "Advocacy Org",
  "Children's Defense Fund": "Advocacy Org",
  "Win Without War": "Advocacy Org",
  "Detention Watch Network": "Advocacy Org",
  "Avaaz": "Advocacy Org",
  "Move to Amend": "Advocacy Org",
  "People For (formerly People For the American Way)": "Advocacy Org",
  "18MillionRising": "Advocacy Org",
  "Inequality.org": "Advocacy Org",
  "AAUW": "Advocacy Org",
  "Popular Democracy": "Advocacy Org",
  "Doctors for America": "Advocacy Org",
  "Concerned Archivists Alliance": "Advocacy Org",
  "Authors Against Book Bans": "Advocacy Org",
  "Artists at Risk Connection (PEN America)": "Advocacy Org",
  "PEN America banned-books list": "Advocacy Org",
  "U.S. Press Freedom Tracker": "Advocacy Org",
  "Critical Resistance": "Advocacy Org",

  // ── Civil rights orgs ──
  "Center for Constitutional Rights": "Civil Rights Org",
  "Sikh Coalition": "Civil Rights Org",

  // ── Grassroots networks (mass-membership / local chapters / mobilization) ──
  "Indivisible": "Grassroots Network",
  "Southend Indivisible": "Grassroots Network",
  "Seattle Indivisible": "Grassroots Network",
  "Indivisible Bellevue": "Grassroots Network",
  "Indivisible Eastside": "Grassroots Network",
  "Indivisible DC": "Grassroots Network",
  "Indivisible Fremont": "Grassroots Network",
  "Indivisible Fremont CA": "Grassroots Network",
  "Indivisible Gaithersburg": "Grassroots Network",
  "Indivisible Greater Vancouver": "Grassroots Network",
  "Indivisible Greater West Loop": "Grassroots Network",
  "Indivisible Harlem": "Grassroots Network",
  "Indivisible Highlands and Beyond": "Grassroots Network",
  "Indivisible Los Angeles": "Grassroots Network",
  "Indivisible NELA": "Grassroots Network",
  "Indivisible NEO": "Grassroots Network",
  "Indivisible NY": "Grassroots Network",
  "Indivisible Volunteer": "Grassroots Network",
  "Indivisible Westside LA": "Grassroots Network",
  "Indivisible Westside Los Angeles": "Grassroots Network",
  "Indivisible Yolo": "Grassroots Network",
  "Portland District 2 Neighbors Indivisible": "Grassroots Network",
  "SW Indivisible Resistance": "Grassroots Network",
  "South Snohomish County Indivisible": "Grassroots Network",
  "Washington Indivisible Network": "Grassroots Network",
  "50501 Movement": "Grassroots Network",
  "50501 Affiliate": "Grassroots Network",
  "50501 state chapters": "Grassroots Network",
  "Joplin 50501": "Grassroots Network",
  "No Kings (50501-aligned)": "Grassroots Network",
  "Tesla Takedown": "Grassroots Network",
  "Tesla Takedown Boston": "Grassroots Network",
  "Sunrise Solidarity / Coalition Against Project 2025": "Grassroots Network",
  "De-ICE Citizens Bank": "Grassroots Network",
  "De-ICE Citizens Bank Coalition": "Grassroots Network",
  "Resist And Defend": "Grassroots Network",
  "She Is Me": "Grassroots Network",
  "Central Illinois Iron Front": "Grassroots Network",
  "Citizens Against Tyranny Network": "Grassroots Network",
  "ICE Out For Good": "Grassroots Network",
  "Chinga La Migra Crew": "Grassroots Network",
  "Cat Ladies for America": "Grassroots Network",
  "Biggest Little Action Group": "Grassroots Network",
  "Fort Myers Visibility Brigade": "Grassroots Network",
  "PDX Car Caravan Protest": "Grassroots Network",
  "Aida 4 LA": "Grassroots Network",
  "Shut The Flock Off BLoNo/MC": "Grassroots Network",
  "Swing Left / Target Majority NYC": "Grassroots Network",
  "The Wolves": "Grassroots Network",
  "Latino Freeze Movement": "Grassroots Network",
  "The People's Union USA": "Grassroots Network",
  "Songs for Liberation": "Grassroots Network",
  "Postcards to Voters": "Grassroots Network",
  "Free DC": "Grassroots Network",

  // ── Independent newsrooms (journalism) ──
  "ProPublica": "Independent Newsroom",
  "The Marshall Project": "Independent Newsroom",
  "The Intercept": "Independent Newsroom",
  "Capital B": "Independent Newsroom",
  "The 19th*": "Independent Newsroom",
  "Bolts Magazine": "Independent Newsroom",
  "Drop Site News": "Independent Newsroom",
  "More Perfect Union": "Independent Newsroom",
  "Type Investigations": "Independent Newsroom",
  "Sludge": "Independent Newsroom",
  "The Lever": "Independent Newsroom",
  "Documented": "Independent Newsroom",
  "Inkstick Media": "Independent Newsroom",
  "Truthout / Kelly Hayes": "Independent Newsroom",
  "Labor Notes": "Independent Newsroom",

  // ── Civic tech tools / platforms ──
  "5 Calls": "Civic Tech Tool",
  "Resistbot": "Civic Tech Tool",
  "Vote.org": "Civic Tech Tool",
  "Wayback Machine 'Save Page Now'": "Civic Tech Tool",
  "Goods Unite Us": "Civic Tech Tool",
  "Grab Your Wallet": "Civic Tech Tool",
  "Progressive Shopper": "Civic Tech Tool",
  "Sky Follower Bridge": "Civic Tech Tool",
  "Bluesky": "Civic Tech Tool",
  "Pixelfed": "Civic Tech Tool",
  "Kolektiva (Mastodon)": "Civic Tech Tool",
  "Catchafire": "Civic Tech Tool",
  "CLEAR Global": "Civic Tech Tool",
  "Code for America": "Civic Tech Tool",
  "DemocracyLab": "Civic Tech Tool",

  // ── Faith groups ──
  "Faithful America": "Faith Group",
  "Friends Committee on National Legislation": "Faith Group",
  "Pax Christi USA": "Faith Group",
  "T'ruah": "Faith Group",
  "Auburn Seminary": "Faith Group",
  "Hindus for Human Rights": "Faith Group",
  "NETWORK Lobby": "Faith Group",
  "Sojourners": "Faith Group",
  "Repairers of the Breach (Rev. Barber)": "Faith Group",
  "Faith in Public Life": "Faith Group",
  "Poor People's Campaign (Rev. Barber)": "Faith Group",
  "Jewish Voice for Peace": "Faith Group",
  "Bend the Arc (Jewish progressive)": "Faith Group",

  // ── Labor orgs / unions ──
  "Federal Unionists Network": "Labor Org",
  "EWOC (Emergency Workplace Organizing Committee)": "Labor Org",
  "Coworker.org": "Labor Org",
  "Fight For A Union": "Labor Org",
  "Industrial Workers of the World": "Labor Org",
  "National Domestic Workers Alliance": "Labor Org",
  "Starbucks Workers United": "Labor Org",
  "UE (United Electrical Workers)": "Labor Org",
  "Amazon Labor Union (IBT Local 1)": "Labor Org",

  // ── Mutual aid / bail funds ──
  "Mutual Aid Hub": "Mutual Aid Network",
  "National Bail Fund Network": "Mutual Aid Network",
  "Operation Olive Branch": "Mutual Aid Network",

  // ── Legal aid orgs ──
  "CLINIC (Catholic Legal Immigration Network)": "Legal Aid Org",
  "Immigration Justice Campaign": "Legal Aid Org",
  "Lawyers for Good Government": "Legal Aid Org",
  "We the Action": "Legal Aid Org",
  "Scale Justice (Pro Bono Net)": "Legal Aid Org",
  "Immigrant Defense Project": "Legal Aid Org",
  "Physicians for Human Rights": "Legal Aid Org",
  "RAICES Texas": "Legal Aid Org",
  "A Better Balance": "Legal Aid Org",

  // ── Climate orgs ──
  "Sunrise Movement": "Climate Org",
  "Mothers Out Front": "Climate Org",
  "Climate Justice Alliance": "Climate Org",
  "Movement Generation": "Climate Org",
  "Sierra Club": "Climate Org",

  // ── Immigrant rights orgs ──
  "United We Dream": "Immigrant Rights Org",
  "Mijente": "Immigrant Rights Org",
  "Welcome.US": "Immigrant Rights Org",
  "Homes Not Borders": "Immigrant Rights Org",
  "Welcoming America": "Immigrant Rights Org",
  "Cities for Action": "Immigrant Rights Org",
  "Freedom for Immigrants": "Immigrant Rights Org",
  "El Refugio": "Immigrant Rights Org",
  "First Friends of NJ and NY": "Immigrant Rights Org",
  "National Day Laborer Organizing Network": "Immigrant Rights Org",
  "CASA": "Immigrant Rights Org",
  "CHIRLA / LA Rapid Response Network": "Immigrant Rights Org",
  "La Resistencia": "Immigrant Rights Org",
  "Respond Crisis Translation": "Immigrant Rights Org",

  // ── Direct action groups ──
  "Code Pink": "Direct Action Group",
  "ADAPT": "Direct Action Group",
  "About Face": "Direct Action Group",
  "Veterans for Peace": "Direct Action Group",
  "Refuse Fascism": "Direct Action Group",

  // ── Training orgs (organizer / candidate / skills training) ──
  "Training for Change": "Training Org",
  "Highlander Center": "Training Org",
  "PeoplesHub": "Training Org",
  "Wildfire Project": "Training Org",
  "Right To Be": "Training Org",
  "Project NIA": "Training Org",
  "Choose Democracy": "Training Org",
  "Emerge America": "Training Org",
  "Higher Heights for America": "Training Org",
  "Run for Something": "Training Org",
  "Vote Run Lead": "Training Org",
  "314 Action": "Training Org",
  "Power the Polls": "Training Org",
  "The OpEd Project": "Training Org",
  "Ruckus Society": "Training Org",

  // ── Mental health resources ──
  "Crisis Text Line": "Mental Health Resource",
  "Trans Lifeline": "Mental Health Resource",
  "NAMI": "Mental Health Resource",
  "Active Minds": "Mental Health Resource",
  "LGBT National Help Center": "Mental Health Resource",
  "The Trevor Project": "Mental Health Resource",
  "The Nap Ministry (Tricia Hersey)": "Mental Health Resource",

  // ── Artist collectives / craftivists ──
  "Amplifier": "Artist Collective",
  "Beehive Design Collective": "Artist Collective",
  "Justseeds Artists' Cooperative": "Artist Collective",
  "Tiny Pricks Project": "Artist Collective",
  "The Yes Men": "Artist Collective",
  "Theatre of the Oppressed NYC": "Artist Collective",
  "Craftivist Collective": "Artist Collective",
  "Pussyhat Project": "Artist Collective",
  "Welcome Blanket Project": "Artist Collective",
  "The Postcard Posse": "Artist Collective",
  "Secret Handshake": "Artist Collective",
  "Resistance Knitters": "Artist Collective",

  // ── Independent creators / political media ──
  "Really American": "Independent Creator",
  "The Lincoln Project": "Independent Creator",
  "MeidasTouch Network": "Independent Creator",

  // ── Voting rights orgs ──
  "Black Voters Matter": "Voting Rights Org",
  "Mi Familia Vota": "Voting Rights Org",
  "States Win (FKA Sister District)": "Voting Rights Org",

  // ── Reproductive rights ──
  "Abortion Access Front": "Advocacy Org",
  "Apiary for Practical Support": "Mutual Aid Network",

  // ── LGBTQ ──
  "Drag Story Hour": "Grassroots Network",

  // ── Business directories ──
  "Beyond Buckskin": "Business Directory",
  "Buy From a Black Woman": "Business Directory",

  // ── Added in :v2 from live harvested cards (not in SEED_CARDS sample) ──
  "Swing Left": "Grassroots Network",
  "Third Act": "Advocacy Org",
  "Mobilize.us": "Civic Tech Tool",
  "Action Network": "Civic Tech Tool",
  "Political Revolution": "Grassroots Network",
  "50501 Joplin": "Grassroots Network",
  "50501 Chicago": "Grassroots Network",
  "50501 Joplin / Citizens Against Tyranny Network": "Grassroots Network",
  "50501 / Indivisible Houston": "Grassroots Network",
  "50501 Movement / Activist Handbook": "Grassroots Network",
  "Viterbo Pallazola / 50501 affiliate": "Grassroots Network",
  "Epstein Protest Walk DC": "Grassroots Network",
  "Tesla Takedown / Dissent Pins": "Grassroots Network",
  "Indivisible Long Beach": "Grassroots Network",
  "Mesa Valley Indivisible": "Grassroots Network",
  "Desert Democracy": "Grassroots Network",
  "Indivisible San Francisco": "Grassroots Network",
  "Indivisible Palo Alto Plus": "Grassroots Network",
  "Indivisible North County San Diego": "Grassroots Network",
  "Indivisible volunteer": "Grassroots Network",
  "No Kings NYC": "Grassroots Network",
  "No Kings DC": "Grassroots Network",
  "Target Majority NYC": "Grassroots Network",
  "ICE Out of LA coalition": "Immigrant Rights Org",
  "Immigrant Legal Resource Center": "Legal Aid Org",
  "Center for Reproductive Rights": "Legal Aid Org",
  "Local Progress": "Advocacy Org",
  "Nonviolence International": "Advocacy Org",
  "Democratic Attorneys General Association": "Advocacy Org",
  "Faith in Action": "Faith Group",
  "MoveOn": "MoveOn.org Political Action",

  // ── Genuine member-based movement orgs: KEEP "Movement Organization" ──
  // DSA, Working Families Party, SURJ, Showing Up for Racial Justice, etc.
  // (left unmapped on purpose — see residual list in the report)
};

// ---- Coverage report ----
const authors = JSON.parse(fs.readFileSync("reports/movement-org-authors.json", "utf8"));
const KEEP = new Set([
  "Democratic Socialists of America",
  "DSA (Democratic Socialists of America)",
  "Working Families Party",
  "SURJ (Showing Up for Racial Justice)",
  "Showing Up for Racial Justice",
  "Veterans for Peace",
]);
const dist = {}; const residual = [];
let changed = 0, totalCards = 0;
for (const a of authors) {
  totalCards += a.count;
  const role = ROLE_BY_AUTHOR[a.name];
  if (role) { dist[role] = (dist[role] || 0) + a.count; changed += a.count; }
  else { residual.push(a); dist["Movement Organization (kept)"] = (dist["Movement Organization (kept)"] || 0) + a.count; }
}
console.log(`Total Movement-Org cards: ${totalCards}`);
console.log(`Cards reclassified:       ${changed}`);
console.log(`Cards kept as Movement Org: ${totalCards - changed} (${residual.length} authors)\n`);
console.log("=== New role distribution ===");
Object.entries(dist).sort((x, y) => y[1] - x[1]).forEach(([k, v]) => console.log(String(v).padStart(4), k));
console.log("\n=== Residual authors kept as 'Movement Organization' ===");
residual.sort((x, y) => y.count - x.count).forEach(a => console.log(String(a.count).padStart(3), a.name));
fs.writeFileSync("reports/author-role-map.json", JSON.stringify(ROLE_BY_AUTHOR, null, 2));
