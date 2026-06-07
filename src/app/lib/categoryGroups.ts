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
  MessageSquare, HandHelping,
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
    categories: ["Amplify", "Art", "Boycott", "Crafting", "Flash Mob", "Irreverence", "Protest", "Video"],
  },
  {
    heading: "Reach Out",
    categories: ["Email", "Petition", "Phoning", "Social Media", "Texting", "Writing"],
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
    categories: ["Group", "Host", "Labor", "Meeting", "Show Up", "Skills", "Training", "Transport", "Volunteer", "Witness"],
  },
  {
    heading: "Care",
    categories: ["Kindness", "Mental Health", "Prayer"],
  },
  {
    heading: "Money / Stuff",
    categories: ["Funding", "Housing", "Represent"],
  },
  {
    heading: "Other",
    categories: ["Commitment", "News Story"],
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
  "Kindness":            "#4a7c59", // forest green (renamed from "Act of Kindness")
  "Amplify":             "#5a3e9e", // brand purple — distinct from the brand-orange CTA color (was #ed6624)
  "Art":                 "#8b6f47", // warm sienna (renamed from "Art/Performance Art")
  "Boycott":             "#7c2d12", // rust
  "Crafting":            "#c34e00", // warm orange
  "Email":               "#b84545", // muted brick red (renamed from "Email Campaign")
  "Flash Mob":           "#d4516a", // coral-pink (replaces hot pink)
  "Funding":             "#4a7c59", // forest green
  "Host":                "#b45309", // burnt orange
  "Housing":             "#8b6f47", // warm sienna
  "Irreverence":         "#b8326b", // muted rose (replaces hot pink)
  "Group":               "#4a7d8a", // muted sky-teal (renamed from "Join a Group" June 2026)
  "Labor":               "#4a7c59", // forest green
  // "Learn" merged into "Training" — kept off the list so the chip
  // disappears from the navbar. CATEGORY_ALIASES in App.tsx folds any
  // stored "Learn" category value forward at render time.
  "Writing":             "#c34e00", // warm orange (renamed from "Letter Writing"; absorbs Letter to Editor)
  "Meeting":             "#23297e", // brand navy
  "Mental Health":       "#7a4f8a", // muted purple-rose (replaces hot pink)
  "News Story":          "#8b6f47", // warm sienna
  "Other":               "#767574", // neutral gray
  "Commitment":          "#23297e", // brand navy (renamed from "Personal Commitment" June 2026)
  "Petition":            "#3a6d80", // muted teal
  "Phoning":             "#b8326b", // muted rose-magenta (renamed from "Phone Calling"/"Call")
  "Prayer":              "#5a3e9e", // brand purple
  "Skills":              "#3a6d80", // muted teal (renamed from "Professional Skills")
  "Protest":             "#23297e", // brand navy
  "Represent":           "#b45309", // burnt orange (renamed from "Purchase" May 2026)
  "Show Up":             "#23297e", // brand navy (absorbs Bird-Dog)
  "Social Media":        "#b84545", // muted brick red
  // Spread Positivity merged into Act of Kindness (May 2026).
  "Texting":             "#2f6fa8", // muted blue — out of the green/teal family so it doesn't read like "done" (was #2f7d6b)
  "Training":            "#3a6d80", // muted teal (absorbs Learn)
  "Transport":           "#3a6d80", // muted teal (renamed from "Transportation")
  "Video":               "#b84545", // muted brick red
  "Volunteer":           "#4a7c59", // forest green — hands-on community help
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
  "Kindness":            HeartHandshake,
  "Amplify":             Volume2,        // matches the brand-orange "amplify others" idea
  "Art":                 Palette,
  "Boycott":             Ban,
  "Crafting":            Scissors,
  "Email":               Mail,
  "Flash Mob":           Users,
  "Funding":             HandCoins,
  "Host":                DoorOpen,       // welcoming people in to an event
  "Housing":             House,
  "Irreverence":         Drama,          // theater masks — satire / street theater
  "Group":               UserPlus,
  "Labor":               HardHat,
  "Writing":             PenLine,
  "Meeting":             Calendar,
  "Mental Health":       Brain,
  "News Story":          Newspaper,
  "Other":               Lightbulb,
  "Commitment":          Heart,
  "Petition":            FileSignature,
  "Phoning":             Phone,          // renamed from "Phone Calling"/"Call"
  "Prayer":              Sparkles,
  "Skills":              Briefcase,
  "Protest":             Megaphone,
  "Represent":           Shirt,          // wear the cause (renamed from "Purchase")
  "Show Up":             Footprints,     // in-person presence
  "Social Media":        Share2,
  "Texting":             MessageSquare,  // SMS / text banking
  "Training":            GraduationCap,
  "Transport":           Car,
  "Video":               Video,
  "Volunteer":           HandHelping,    // offering hands-on help
  "Witness":             Eye,
};

/** Lookup helper — returns the canonical icon for a category, falling back
 *  to a neutral tag glyph for any unrecognised category. */
export function iconForCategory(category: string | undefined | null): LucideIcon {
  return CATEGORY_ICONS[category ?? ""] ?? Tag;
}
