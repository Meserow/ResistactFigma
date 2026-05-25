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

// Categories within each row are kept ALPHABETIZED — easier to scan, and
// the user doesn't have to remember where a category sits in an arbitrary
// curated order. New categories: just drop them into the right group and
// re-sort the array (or rely on `Array#sort` at the call site — but the
// data here is the source of truth).
export const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    heading: "Make / Do",
    categories: ["Art/Performance Art", "Boycott", "Crafting", "Flash Mob", "Protest", "Video"],
  },
  {
    heading: "Reach Out",
    categories: ["Call/Write", "Email Campaign", "Letter to Editor", "Letter Writing", "Petition", "Social Media"],
  },
  {
    heading: "Show Up",
    categories: ["Bird-Dog", "Join a Group", "Labor", "Meeting", "Professional Skills", "Show Up", "Training", "Witness"],
  },
  {
    heading: "Care",
    categories: ["Act of Kindness", "Boost", "Mental Health", "Prayer", "Spread Positivity"],
  },
  {
    heading: "Money / Stuff",
    categories: ["Funding", "Housing", "Purchase", "Transportation"],
  },
  {
    heading: "Other",
    categories: ["News Story", "Other", "Personal Commitment"],
  },
];

/** Flat set of all categories listed in CATEGORY_GROUPS — useful for the
 *  runtime "did we miss one?" fallback so a category added to a card
 *  without being added here still shows up in the chip grid. */
export const KNOWN_CATEGORIES: Set<string> = new Set(
  CATEGORY_GROUPS.flatMap((g) => g.categories),
);
