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
    categories: ["Call", "Email Campaign", "Letter to Editor", "Letter Writing", "Petition", "Social Media"],
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

/** Canonical color for each category. Used by:
 *  - the per-card categoryColor when a seed/import doesn't supply one
 *  - the Navbar filter-chip background when the user toggles it ON
 *  - the EditCardModal category dropdown
 *  Keys match the Title-Case forms emitted by normaliseCategory(). */
export const CATEGORY_COLORS: Record<string, string> = {
  "Act of Kindness":     "#127f05",
  "Art/Performance Art": "#896312",
  "Bird-Dog":            "#5a3e9e",
  "Boost":               "#8a00e6",
  "Boycott":             "#7c2d12",
  "Call":                "#c2185b",
  "Crafting":            "#c34e00",
  "Email Campaign":      "#e44b4b",
  "Flash Mob":           "#ff00d5",
  "Funding":             "#127f05",
  "Host":                "#b45309",
  "Housing":             "#896312",
  "Irreverence":         "#ff00d5",
  "Join a Group":        "#0891b2",
  "Labor":               "#127f05",
  "Learn":               "#126d89",
  "Letter to Editor":    "#c34e00",
  "Letter Writing":      "#c34e00",
  "Meeting":             "#23297e",
  "Mental Health":       "#ff00d5",
  "News Story":          "#896312",
  "Other":               "#767574",
  "Personal Commitment": "#23297e",
  "Petition":            "#05737f",
  "Prayer":              "#8a00e6",
  "Professional Skills": "#126d89",
  "Protest":             "#23297e",
  "Purchase":            "#b45309",
  "Show Up":             "#23297e",
  "Social Media":        "#e44b4b",
  "Spread Positivity":   "#8a00e6",
  "Training":            "#126d89",
  "Transportation":      "#126d89",
  "Video":               "#e44b4b",
  "Witness":             "#767574",
};

/** Lookup helper — returns the canonical color for a category name or
 *  a sensible navy fallback (#23297e, ResistAct's base brand color) if
 *  the category isn't recognised. */
export function colorForCategory(category: string | undefined | null): string {
  return CATEGORY_COLORS[category ?? ""] ?? "#23297e";
}
