import { ActionCardData } from "../components/ActionCard";

import imgImage3   from "../../assets/2122e5681fca2a67fa8c21ce938335204646f5f3.png";
import imgImage4   from "../../assets/81cfc6786bc36ca734bbdefbda22c4ed8f215998.png";
import imgImage5   from "../../assets/83f5ff48d560ab0e0bf359f87c6066ed854f2614.jpg";
import imgImage6   from "../../assets/672f9df1a029464f302dfcd18d0af1213faee70d.jpg";
import imgImage13  from "../../assets/cfca6ec0f7d46bd37209105f50f378c7291dd60e.jpg";
import imgImage20  from "../../assets/3fc52741865fd1c68c6b1fa7e0dd59c90346bd31.jpg";
import imgImage34  from "../../assets/f757504534bf51b4afc042b9ec12280b63be51da.png";

// Pre-built figma asset map for the original hand-curated cards.
export const FIGMA_IMAGE_MAP: Record<string, string> = {
  imgImage3, imgImage4, imgImage5, imgImage6, imgImage13, imgImage20, imgImage34,
};

// Bulk-import every logo in src/assets/orgs/ as `org_<slug>` keys, where the
// slug matches the filename (without extension). Server-side seed cards use
// these keys as their `topImageKey`.
const orgGlob = import.meta.glob<string>("../../assets/orgs/*", {
  eager: true,
  import: "default",
});
export const ORG_IMAGE_MAP: Record<string, string> = {};
for (const [path, mod] of Object.entries(orgGlob)) {
  const fname = path.split("/").pop()!.replace(/\.[^.]+$/, "");
  ORG_IMAGE_MAP[`org_${fname}`] = mod;
}

// Combined map used by the resolver in App.tsx.
export const IMAGE_MAP: Record<string, string> = {
  ...FIGMA_IMAGE_MAP,
  ...ORG_IMAGE_MAP,
};

// ─── Static fallback cards ────────────────────────────────────────────────────
// Shown on first paint only if the /actions API fails; replaced by live data.
export const STATIC_CARDS: ActionCardData[] = [
  { id: 1, isFeatured: true, category: "BOOST", categoryColor: "#8a00e6", title: "Spread the Word about ResistAct", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community needs your help spreading awareness about ResistAct so we can build a stronger resistance network together.", boosts: 3020, spotsTotal: "Unlimited", authorName: "Ellen Meserow", authorRole: "ResistAct Founder", authorAvatar: imgImage34 },
  { id: 3, category: "FLASH MOB", categoryColor: "#ff00d5", title: "Join us in forming human RESIST", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community is forming a human 'RESIST' sign visible from above — join us!", location: "Boston, MA", boosts: 50, spotsTotal: 200, authorName: "Meg Jones", authorRole: "Franklin High School", topImage: imgImage6, authorAvatar: imgImage4 },
  { id: 5, category: "PROTEST", categoryColor: "#23297e", title: "Show Trump We Are United", description: "March on the Capitol with us to show Trump the size of the resistance. Spread the word about July 4th Patriotic Resistance March and bring all your friends and family!", location: "Washington DC", boosts: 2, spotsTotal: 10, authorName: "John Smith", authorRole: "MoveOn.org", topImage: imgImage13, authorAvatar: imgImage20 },
  { id: 13, category: "TRAINING", categoryColor: "#126d89", title: "Online ICE Rapid Response", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community has set up a rapid response network — join us.", location: "Austin, TX", boosts: 0, spotsTotal: 10, authorName: "Adam Jordan", authorRole: "Catholic Legal Immigration Network", authorLink: "https://www.cliniclegal.org/", topImage: imgImage5, authorAvatar: imgImage3 },
];
