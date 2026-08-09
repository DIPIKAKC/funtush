/**
 * ── The navigation-builder option tables (White-label week · Day 3) ──────────
 *
 * Everything that is *policy* rather than *one agency's data* for the custom
 * menu and the Book Now button lives here, same idea as `brandTheme.ts` (Day 1)
 * and `siteConfig.ts` (Day 2):
 *
 *   - `allowsCustomNavigation(tier)` — the menu builder is Medium and Large
 *     only. Small (and the trial, which gets Small's feature set per Backend
 *     Guide §0.1) is **permanently** locked to `DEFAULT_NAVIGATION_ITEMS`, not
 *     merely defaulted to it — there is no code path that lets a Small-tier
 *     agency's write reach the items table at all.
 *   - `allowsBookNowCustomization(tier)` — same two tiers, kept as its own
 *     named constant even though the values are identical today. The reason is
 *     Day 2's: the day the platform decides "Book Now renaming is Large-only"
 *     while the menu builder stays Medium+, only one constant changes. Reusing
 *     one list for two features is how that day turns into a bug.
 *   - `isSafeInternalPath` — the internal-link half of the same problem Day 2
 *     solved for external links with `isSafeLinkUrl`, which this file imports
 *     rather than re-deciding.
 *
 * ⚠️ Like its Day 1 and Day 2 siblings, this file must not import from
 * `@funtush/database`. It is read by the validation layer (before any
 * database call) and by tests that run with no database at all.
 */

import type { TierName } from "./brandTheme";
import { SITE_TEXT_LIMITS, isSafeLinkUrl } from "./siteConfig";

/* ── 1. Tier rules ───────────────────────────────────────────────────────── */

/**
 * Tiers that may build a custom menu.
 *
 * Straight from the Day 3 task: *"Menu builder — Medium and Large tiers"* and
 * *"Small tier locked to the standard fixed navigation."* There is no trial
 * carve-out here the way Day 1 gave the trial Small's colour picker — the
 * trial sits on `FREE`, which is simply absent from this list, so it gets the
 * fixed nav exactly like Small.
 */
export const CUSTOM_NAVIGATION_TIERS: readonly TierName[] = ["MEDIUM", "LARGE"];

/** `true` when this tier may configure its own menu items. */
export function allowsCustomNavigation(tier: string): boolean {
  return CUSTOM_NAVIGATION_TIERS.includes(tier as TierName);
}

/**
 * Tiers that may rename or hide the Book Now button.
 *
 * A separate constant from `CUSTOM_NAVIGATION_TIERS` on purpose — see the file
 * header. Today's values happen to match the task ("Book Now button — rename
 * or hide (Medium and Large only)").
 */
export const BOOK_NOW_CUSTOMIZATION_TIERS: readonly TierName[] = ["MEDIUM", "LARGE"];

/** `true` when this tier may change the Book Now button's label or visibility. */
export function allowsBookNowCustomization(tier: string): boolean {
  return BOOK_NOW_CUSTOMIZATION_TIERS.includes(tier as TierName);
}

/* ── 2. Link types ───────────────────────────────────────────────────────── */

export type NavigationLinkTypeId = "INTERNAL" | "EXTERNAL";

export const NAVIGATION_LINK_TYPES = {
  INTERNAL: {
    id: "INTERNAL",
    label: "Page on your site",
    description: "A path on your own site, e.g. /packages or /about.",
  },
  EXTERNAL: {
    id: "EXTERNAL",
    label: "External link",
    description: "A full web address that leaves your site, e.g. a partner page.",
  },
} as const;

export const NAVIGATION_LINK_TYPE_IDS = Object.keys(NAVIGATION_LINK_TYPES) as NavigationLinkTypeId[];

/* ── 3. Menu shape limits ────────────────────────────────────────────────── */

/**
 * The task's own number: *"max 8 top-level items."* A header only has so much
 * width, and an agency that needs a ninth item needs a dropdown, not a wider
 * header.
 */
export const MAX_TOP_LEVEL_ITEMS = 8;

/**
 * Not named in the task, unlike the 8 above — this one exists for the same
 * reason Day 2 capped `popupDelaySeconds` at 120: the ceiling protects the
 * agency from itself. A dropdown is opened by hovering or tapping one menu
 * label; a 40-item dropdown is not a menu a visitor can use, it is the
 * agency's entire site map pasted into one column. Ten is generous for a
 * trekking agency's realistic dropdown (destinations, seasons, trip types)
 * and small enough that a write never creates an unusable page.
 */
export const MAX_DROPDOWN_ITEMS = 10;

/**
 * "Up to 2 levels deep" is enforced structurally, not by counting: a top-level
 * item's schema allows a `children` array, and a child item's schema does not.
 * There is no third level to reject because there is no field to put it in.
 * This constant exists only to say the number out loud in options responses
 * and error messages — the guarantee itself lives in the shape of the zod
 * schema, in `validations/navigation.validation.ts`.
 */
export const MAX_MENU_DEPTH = 2;

export const NAV_TEXT_LIMITS = {
  /** Menu labels are read in a header strip — a sentence does not fit one. */
  itemLabel: { min: 1, max: 30 },
  /** The Book Now button is even narrower than a menu label. */
  bookNowLabel: { min: 1, max: 24 },
} as const;

/** How long an internal path (`/packages`, not a full URL) may be. */
export const MAX_INTERNAL_PATH_LENGTH = 200;

/**
 * External link length ceiling, reused from Day 2 rather than re-picked: one
 * number for "how long is a URL allowed to be" across the whole white-label
 * feature set, not one per feature that happens to accept a link.
 */
export const MAX_EXTERNAL_URL_LENGTH = SITE_TEXT_LIMITS.url.max;

/* ── 4. Internal link safety ─────────────────────────────────────────────── */

/**
 * Characters allowed in an internal path, after the leading `/`. Covers
 * ordinary route segments, query strings and fragments (`/packages?season=
 * autumn#departures`) without ever admitting a character that changes what
 * the string *means* — no space, no angle bracket, no backslash.
 */
const INTERNAL_PATH_PATTERN = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#]*$/;

/**
 * `true` when `value` is safe to store as an `INTERNAL` navigation link.
 *
 * Three checks, each closing a distinct hole:
 *
 *   1. **Must start with a single `/`.** That is what "internal" means — a
 *      path on this site, not a URL to anywhere else.
 *   2. **Must not start with `//`.** `//evil.com/phish` *looks* like a path —
 *      it has no scheme — but a browser resolves a leading `//` as
 *      protocol-relative and treats what follows as a hostname. This is a
 *      well-known open-redirect trick specifically because reviewers read
 *      "starts with /" and stop looking.
 *   3. **Character whitelist, not a blocklist.** The same reasoning as Day 2's
 *      `isSafeLinkUrl`: enumerating the characters a path is allowed to have
 *      cannot miss a dangerous one the way enumerating characters to reject
 *      always eventually does.
 */
export function isSafeInternalPath(value: string): boolean {
  if (value.length > MAX_INTERNAL_PATH_LENGTH) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  return INTERNAL_PATH_PATTERN.test(value);
}

/** Re-exported so the validation layer has one place to import link safety from. */
export { isSafeLinkUrl };

/* ── 5. Defaults ─────────────────────────────────────────────────────────── */

/** The label the Book Now button carries until an agency renames it. */
export const DEFAULT_BOOK_NOW_LABEL = "Book Now";

/**
 * One entry of the platform's standard fixed navigation.
 *
 * Deliberately the same shape a stored top-level item resolves to
 * (`ResolvedNavigationItem` minus `children`, which the fixed nav never has —
 * see `defaultNavigationItems` in `services/navigation.service.ts`).
 */
export interface FixedNavigationItem {
  label: string;
  linkType: "INTERNAL";
  url: string;
  openInNewTab: false;
}

/**
 * The navigation every Small-tier and trial site renders, permanently, and
 * that every Medium/Large site renders until it opens the menu builder for
 * the first time (the same "no row ⇒ platform default" convention Day 1 and
 * Day 2 both use).
 *
 * Four items, matching the pages every white-label site already has per the
 * Backend Guide's core entities (§7): a home page, the package catalogue, an
 * about/profile page, and a way to reach the agency. Changing this list is a
 * product decision with the same weight as changing `BRAND_PALETTE` — it
 * changes what every unconfigured site on the platform looks like — so it
 * lives here as code, not as a database row an admin panel could edit
 * unreviewed.
 */
export const DEFAULT_NAVIGATION_ITEMS: readonly FixedNavigationItem[] = [
  { label: "Home", linkType: "INTERNAL", url: "/", openInNewTab: false },
  { label: "Packages", linkType: "INTERNAL", url: "/packages", openInNewTab: false },
  { label: "About", linkType: "INTERNAL", url: "/about", openInNewTab: false },
  { label: "Contact", linkType: "INTERNAL", url: "/contact", openInNewTab: false },
];
