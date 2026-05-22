/**
 * UI grouping for the Quick Match Tool's "Skip these" chip grid.
 *
 * Categories are organised into themed buckets so the chip grid reads as
 * ~5 chips per row instead of 26 chips in a wall. The category names here
 * are the canonical Title-Case forms emitted by `normaliseCategory()` in
 * App.tsx — they match the strings stored on cards after server data
 * passes through `resolveCard`.
 *
 * Adding a category? Either drop it into one of the buckets below or rely
 * on the runtime fallback in MatchMeModal that sweeps any unknown
 * categories into a synthetic "Other" bucket so nothing goes missing.
 */
export interface CategoryGroup {
  heading: string;
  categories: string[];
}

export const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    heading: "Make / Do",
    categories: ["Crafting", "Art/Performance Art", "Flash Mob", "Protest"],
  },
  {
    heading: "Reach Out",
    categories: ["Petition", "Email Campaign", "Letter to Editor", "News Story", "Social Media"],
  },
  {
    heading: "Show Up",
    categories: ["Meeting", "Join a Group", "Training", "Professional Skills", "Labor"],
  },
  {
    heading: "Care",
    categories: ["Act of Kindness", "Mental Health", "Spread Positivity", "Prayer"],
  },
  {
    heading: "Money / Stuff",
    categories: ["Funding", "Purchase", "Boost", "Housing", "Transportation"],
  },
  {
    heading: "Other",
    categories: ["Boycott", "Personal Commitment", "Other"],
  },
];

/** Flat set of all categories listed in CATEGORY_GROUPS — useful for the
 *  runtime "did we miss one?" fallback so a category added to a card
 *  without being added here still shows up in the chip grid. */
export const KNOWN_CATEGORIES: Set<string> = new Set(
  CATEGORY_GROUPS.flatMap((g) => g.categories),
);
