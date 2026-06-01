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
import type { LucideIcon } from "lucide-react";
import {
  HeartHandshake, Volume2, Palette, Ban, Phone, Scissors, Mail, Users,
  HandCoins, DoorOpen, House, Drama, UserPlus, HardHat, PenLine, Calendar,
  Brain, Newspaper, Lightbulb, Heart, FileSignature, Sparkles, Briefcase,
  Megaphone, Shirt, Footprints, Share2, GraduationCap, Car, Video, Eye, Tag,
} from "lucide-react";

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
    // "Irreverence" → creative expression (memes, satire, street theater).
    // "Amplify" → amplifying others' work is also a make/do action; lived
    // briefly in "Care" but felt out of place next to Mental Health/Prayer.
    // (Renamed from "Boost" June 2026 — the old name collided with the 🔥
    // boost engagement action. CATEGORY_ALIASES folds old data forward.)
    categories: ["Amplify", "Art/Performance Art", "Boycott", "Crafting", "Flash Mob", "Irreverence", "Protest", "Video"],
  },
  {
    heading: "Reach Out",
    categories: ["Email Campaign", "Letter Writing", "Petition", "Phone Calling", "Social Media"],
  },
  {
    // Renamed from "Show Up" — the heading collided with the "Show Up"
    // category button rendered inside this very group, which read as a
    // duplicate. "Get Involved" covers the same idea (active in-person/
    // participatory acts) without the naming clash.
    heading: "Get Involved",
    // "Host" → hosting an event is showing up from the organizer side.
    // "Transportation" → giving people rides to actions / canvasses /
    // hearings is showing up by enabling others' presence.
    categories: ["Host", "Join a Group", "Labor", "Meeting", "Professional Skills", "Show Up", "Training", "Transportation", "Witness"],
  },
  {
    heading: "Care",
    categories: ["Act of Kindness", "Mental Health", "Prayer"],
  },
  {
    heading: "Money / Stuff",
    categories: ["Funding", "Housing", "Represent"],
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
  "Amplify":             "#ed6624", // brand orange — energetic action (renamed from "Boost" June 2026)
  "Art/Performance Art": "#8b6f47", // warm sienna
  "Boycott":             "#7c2d12", // rust
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
  "Phone Calling":       "#b8326b", // muted rose-magenta (renamed from "Call" June 2026)
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

/** Canonical lucide icon for each category. Mirrors CATEGORY_COLORS so the
 *  navbar filter pills (and anywhere else that wants a glyph) stay in sync.
 *  Keys match the Title-Case forms emitted by normaliseCategory(). When you
 *  add a category, add its icon here too — the lookup falls back to a neutral
 *  tag glyph for anything missing, so a gap is graceful but not pretty. */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "Act of Kindness":     HeartHandshake,
  "Amplify":             Volume2,        // matches the brand-orange "amplify others" idea
  "Art/Performance Art": Palette,
  "Boycott":             Ban,
  "Crafting":            Scissors,
  "Email Campaign":      Mail,
  "Flash Mob":           Users,
  "Funding":             HandCoins,
  "Host":                DoorOpen,       // welcoming people in to an event
  "Housing":             House,
  "Irreverence":         Drama,          // theater masks — satire / street theater
  "Join a Group":        UserPlus,
  "Labor":               HardHat,
  "Letter Writing":      PenLine,
  "Meeting":             Calendar,
  "Mental Health":       Brain,
  "News Story":          Newspaper,
  "Other":               Lightbulb,
  "Personal Commitment": Heart,
  "Petition":            FileSignature,
  "Phone Calling":       Phone,          // renamed from "Call" June 2026
  "Prayer":              Sparkles,
  "Professional Skills": Briefcase,
  "Protest":             Megaphone,
  "Represent":           Shirt,          // wear the cause (renamed from "Purchase")
  "Show Up":             Footprints,     // in-person presence
  "Social Media":        Share2,
  "Training":            GraduationCap,
  "Transportation":      Car,
  "Video":               Video,
  "Witness":             Eye,
};

/** Lookup helper — returns the canonical icon for a category, falling back
 *  to a neutral tag glyph for any unrecognised category. */
export function iconForCategory(category: string | undefined | null): LucideIcon {
  return CATEGORY_ICONS[category ?? ""] ?? Tag;
}
