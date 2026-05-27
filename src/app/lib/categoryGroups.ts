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
    categories: ["Call", "Email Campaign", "Letter Writing", "Petition", "Social Media"],
  },
  {
    heading: "Show Up",
    categories: ["Join a Group", "Labor", "Meeting", "Professional Skills", "Show Up", "Training", "Witness"],
  },
  {
    heading: "Care",
    categories: ["Act of Kindness", "Boost", "Mental Health", "Prayer"],
  },
  {
    heading: "Money / Stuff",
    categories: ["Funding", "Housing", "Represent", "Transportation"],
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
 *  - the on-card category pill
 *  - the EditCardModal category dropdown
 *  Keys match the Title-Case forms emitted by normaliseCategory().
 *
 *  Palette is tuned to the cartoon-banner art: muted, vintage editorial
 *  tones rather than candy-bright web colors. The brand anchors
 *  (navy #23297e, orange #ed6624, purple #5a3e9e) appear repeatedly;
 *  greens are forest, reds are brick, teals are muted, magentas are
 *  rose. No more #ff00d5 hot pink. */
export const CATEGORY_COLORS: Record<string, string> = {
  "Act of Kindness":     "#4a7c59", // forest green
  "Art/Performance Art": "#8b6f47", // warm sienna
  "Boost":               "#ed6624", // brand orange — energetic action
  "Boycott":             "#7c2d12", // rust
  "Call":                "#b8326b", // muted rose-magenta
  "Crafting":            "#c34e00", // warm orange
  "Email Campaign":      "#b84545", // muted brick red
  "Flash Mob":           "#d4516a", // coral-pink (replaces hot pink)
  "Funding":             "#4a7c59", // forest green
  "Host":                "#b45309", // burnt orange
  "Housing":             "#8b6f47", // warm sienna
  "Irreverence":         "#b8326b", // muted rose (replaces hot pink)
  "Join a Group":        "#4a7d8a", // muted sky-teal
  "Labor":               "#4a7c59", // forest green
  // "Learn" merged into "Training" — kept off the list so the chip
  // disappears from the navbar. CATEGORY_ALIASES in App.tsx folds any
  // stored "Learn" category value forward at render time.
  "Letter Writing":      "#c34e00", // warm orange (absorbs Letter to Editor)
  "Meeting":             "#23297e", // brand navy
  "Mental Health":       "#7a4f8a", // muted purple-rose (replaces hot pink)
  "News Story":          "#8b6f47", // warm sienna
  "Other":               "#767574", // neutral gray
  "Personal Commitment": "#23297e", // brand navy
  "Petition":            "#3a6d80", // muted teal
  "Prayer":              "#5a3e9e", // brand purple
  "Professional Skills": "#3a6d80", // muted teal
  "Protest":             "#23297e", // brand navy
  "Represent":           "#b45309", // burnt orange (renamed from "Purchase" May 2026)
  "Show Up":             "#23297e", // brand navy (absorbs Bird-Dog)
  "Social Media":        "#b84545", // muted brick red
  // Spread Positivity merged into Act of Kindness (May 2026).
  "Training":            "#3a6d80", // muted teal (absorbs Learn)
  "Transportation":      "#3a6d80", // muted teal
  "Video":               "#b84545", // muted brick red
  "Witness":             "#767574", // neutral gray
};

/** Lookup helper — returns the canonical color for a category name or
 *  a sensible navy fallback (#23297e, ResistAct's base brand color) if
 *  the category isn't recognised. */
export function colorForCategory(category: string | undefined | null): string {
  return CATEGORY_COLORS[category ?? ""] ?? "#23297e";
}
