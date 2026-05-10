import { ActionCardData } from "../components/ActionCard";

import imgImage    from "../../assets/8845f14cf11ec3b7059898cd8adda5059833c2c7.png";
import imgImage1   from "../../assets/6dd4ba1639105589e2d4bcdd59e21ad50a4f0db2.jpg";
import imgImage2   from "../../assets/17ae6a615bc1a99b8cbc5240e532f4d9a2e76ba9.jpg";
import imgImage3   from "../../assets/2122e5681fca2a67fa8c21ce938335204646f5f3.png";
import imgImage4   from "../../assets/81cfc6786bc36ca734bbdefbda22c4ed8f215998.png";
import imgImage5   from "../../assets/83f5ff48d560ab0e0bf359f87c6066ed854f2614.jpg";
import imgImage6   from "../../assets/672f9df1a029464f302dfcd18d0af1213faee70d.jpg";
import imgImage7   from "../../assets/df2e72270a76b043f5ae0dab18876bdf49110ecf.jpg";
import imgImage8   from "../../assets/d7d24dcae11e3763828c0a43fac7fc22a50cef19.jpg";
import imgImage9   from "../../assets/985494e2d4efacbac6fe9eeab8b3bb05987c598b.jpg";
import imgImage10  from "../../assets/6fb5e9741ea7c952728321cc45c7b5643d390520.jpg";
import imgImage11  from "../../assets/5b1a9d6121b57c97b38ed951d385ab4fb571380c.jpg";
import imgImage12  from "../../assets/feb6ae285a92a2b1c606d3ef7402227e137292e9.jpg";
import imgImage13  from "../../assets/cfca6ec0f7d46bd37209105f50f378c7291dd60e.jpg";
import imgImage14  from "../../assets/77dc333618263389c5c551cb5201f1417ba52106.jpg";
import imgImage15  from "../../assets/f086c5ab52082a738351d7d2ac485a119b3fed97.jpg";
import imgImage16  from "../../assets/f55ceb9640e90e362c0b56f89883b2d57199d1a8.jpg";
import imgImage17  from "../../assets/f6b1f90b5d4a6453a308692cef5c384b793b5cbc.jpg";
import imgImage18  from "../../assets/8e3b35fdf8b10fb6307188626c720152ca6b1ae9.jpg";
import imgImage19  from "../../assets/2c8e6a99c675347c7cec3aea8f490848603746ed.jpg";
import imgImage20  from "../../assets/3fc52741865fd1c68c6b1fa7e0dd59c90346bd31.jpg";
import imgImage21  from "../../assets/50c8572422ebf0309458e2b1f0d4bea2e682d9f3.jpg";
import imgImage22  from "../../assets/50c8572422ebf0309458e2b1f0d4bea2e682d9f3.jpg";
import imgImage25  from "../../assets/0e573958d76815ca5260107ddbc78923948e1490.jpg";
import imgImage34  from "../../assets/f757504534bf51b4afc042b9ec12280b63be51da.png";

// Pre-built figma asset map for the original 18 hand-curated cards.
export const FIGMA_IMAGE_MAP: Record<string, string> = {
  imgImage, imgImage1, imgImage2, imgImage3, imgImage4, imgImage5, imgImage6,
  imgImage7, imgImage8, imgImage9, imgImage10, imgImage11, imgImage12, imgImage13,
  imgImage14, imgImage15, imgImage16, imgImage17, imgImage18, imgImage19, imgImage20,
  imgImage21, imgImage22, imgImage25, imgImage34,
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
// Shown immediately on first paint; replaced by live data from /actions on fetch.
export const STATIC_CARDS: ActionCardData[] = [
  { id: 1, isFeatured: true, category: "BOOST", categoryColor: "#8a00e6", title: "Spread the Word about ResistAct", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community needs your help spreading awareness about ResistAct so we can build a stronger resistance network together.", boosts: 3020, spotsTotal: "Unlimited", authorName: "Ellen Meserow", authorRole: "ResistAct Founder", authorAvatar: imgImage34 },
  { id: 2, category: "CRAFTING", categoryColor: "#c34e00", title: "Make 1460 Orange Paper Chains", description: "Help trans kids survive the next 4 years by sending them paper chains with 365x4 links to will help them see that there will be an end to this persecution of them.", boosts: 500, spotsTotal: 1000, authorName: "Jo Jones", authorRole: "Citizen Activist", topImage: imgImage12, authorAvatar: imgImage },
  { id: 3, category: "FLASH MOB", categoryColor: "#ff00d5", title: "Join us in forming human RESIST", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community is forming a human 'RESIST' sign visible from above — join us!", location: "Boston, MA", boosts: 50, spotsTotal: 200, authorName: "Meg Jones", authorRole: "Franklin High School", topImage: imgImage6, authorAvatar: imgImage4 },
  { id: 4, category: "IRREVERENCE", categoryColor: "#9333ea", title: "Help Me Launch Over Los Angeles", description: "I have the land to protect and the people to set up a massive Trump balloon over my house, but I need the funding to purchase it. Go to my GoFundMe and help me buy it!", isOnline: true, boosts: 739, spotsTotal: "Unlimited", authorName: "Patrick Escarcega", authorRole: "Citizen Activist", topImage: imgImage19, authorAvatar: imgImage1 },
  { id: 5, category: "PROTEST", categoryColor: "#23297e", title: "Show Trump We Are United", description: "March on the Capitol with us to show Trump the size of the resistance. Spread the word about July 4th Patriotic Resistance March and bring all your friends and family!", location: "Washington DC", boosts: 2, spotsTotal: 10, authorName: "John Smith", authorRole: "MoveOn.org", topImage: imgImage13, authorAvatar: imgImage20 },
  { id: 6, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", title: "Here Let me Pray for You", description: "We are social media warriors who prove the religious left lives its values. Join us online to pray for our conservative brothers/sisters in Christ who have strayed from His teachings.", isOnline: true, boosts: 52, spotsTotal: 75, authorName: "McKenna Hartman", authorRole: "Citizen Activist", topImage: imgImage7, authorAvatar: imgImage16 },
  { id: 7, category: "BOOST", categoryColor: "#8a00e6", title: "Spread the Word about ResistAct", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community needs your help spreading awareness about ResistAct.", boosts: 3020, spotsTotal: "Unlimited", authorName: "Ellen Meserow", authorRole: "ResistAct Founder", topImage: imgImage25, authorAvatar: imgImage34 },
  { id: 8, category: "FLASH MOB", categoryColor: "#ff00d5", title: "Petition the Leftist Billionaires", description: "We need electronic billboards that show the daily price of eggs/gas since Trump took office. Another to show the Trump deficit versus Elon Musk's wealth. Another to show...", typeTag: "FLASH MOB", boosts: 0, spotsTotal: 10, authorName: "Nancie Kosnoff", authorRole: "Citizen Activist", topImage: imgImage14, authorAvatar: imgImage2 },
  { id: 9, category: "PETITION", categoryColor: "#05737f", title: "Stop Funding Fox", description: "MoveOn Civic Action has a long history of taking on Fox's lies. With actions taken by thousands of MoveOn members, we've been able to put pressure on cable providers to drop Fox News.", location: "Austin, TX", boosts: 0, spotsTotal: 10, authorName: "Meg Jones", authorRole: "Franklin High School", topImage: imgImage21, authorAvatar: imgImage4 },
  { id: 10, category: "PROTEST", categoryColor: "#23297e", title: "Towns Across America Blackout", description: "On Tuesday, April 22, 2025, we invite you to participate in a nationwide television blackout in protest of Trump's signing of the bill to defund Planned Parenthood.", location: "Austin, TX", boosts: 0, spotsTotal: 10, authorName: "Patrick Escarcega", authorRole: "Citizen Activist", topImage: imgImage17, authorAvatar: imgImage1 },
  { id: 12, category: "IRREVERENCE", categoryColor: "#9333ea", title: "Help Fund my Elon Mural!", description: "I am making a mural to show Elon as a reincarnation of Adolf Hitler, using a real photo of Trump giving the Nazi salute! It will be in my community center's parking lot!", isOnline: true, boosts: 500, spotsTotal: "Unlimited", authorName: "McKenna Hartman", authorRole: "Citizen Activist", topImage: imgImage10, authorAvatar: imgImage16 },
  { id: 13, category: "TRAINING", categoryColor: "#126d89", title: "Online ICE Rapid Response", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community has set up a rapid response network — join us.", location: "Austin, TX", boosts: 0, spotsTotal: 10, authorName: "Adam Jordan", authorRole: "Catholic Legal Immigration Network", authorLink: "https://www.cliniclegal.org/", topImage: imgImage5, authorAvatar: imgImage3 },
  { id: 14, category: "FLASH MOB", categoryColor: "#ff00d5", title: "Petition the Leftist Billionaires", description: "We need electronic billboards that show the daily price of eggs/gas since Trump took office. Another to show the Trump deficit versus Elon Musk's wealth. Another to show...", typeTag: "FLASH MOB", boosts: 500, spotsTotal: "Unlimited", authorName: "Nancie Kosnoff", authorRole: "Citizen Activist", topImage: imgImage15, authorAvatar: imgImage2 },
  { id: 15, category: "PETITION", categoryColor: "#05737f", title: "Stop Funding Fox", description: "MoveOn Civic Action has a long history of taking on Fox's lies. With actions taken by thousands of MoveOn members, we've been able to put pressure on cable providers.", location: "Austin, TX", boosts: 500, spotsTotal: "Unlimited", authorName: "Adam Jordan", authorRole: "Catholic Legal Immigration Network", authorLink: "https://www.cliniclegal.org/", topImage: imgImage22, authorAvatar: imgImage3 },
  { id: 16, category: "PROTEST", categoryColor: "#23297e", title: "Towns Across America Blackout", description: "On Tuesday, April 22, 2025, we invite you to participate in a nationwide television blackout in protest of Trump's signing of the bill to defund Planned Parenthood.", location: "Austin, TX", boosts: 500, spotsTotal: "Unlimited", authorName: "Nancie Kosnoff", authorRole: "Citizen Activist", topImage: imgImage18, authorAvatar: imgImage2 },
  { id: 17, category: "IRREVERENCE", categoryColor: "#9333ea", title: "Puppets for March on Washington", description: "We are making effigies of Trump and his minions for the March on Washington on July 4th. Join in even if you can't attend — we will help the attendees get them!", location: "Austin, TX", boosts: 500, spotsTotal: "Unlimited", authorName: "Adam Jordan", authorRole: "Catholic Legal Immigration Network", authorLink: "https://www.cliniclegal.org/", topImage: imgImage9, authorAvatar: imgImage3 },
];
