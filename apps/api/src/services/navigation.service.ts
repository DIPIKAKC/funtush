/**
 * ── Navigation builder service (White-label week · Day 3) ────────────────────
 *
 * Owns everything behind `PATCH /agencies/me/navigation` and the public read
 * the white-label renderer performs on every page view to draw the header.
 *
 * Mirrors `siteConfig.service.ts` deliberately — tier rules run before
 * anything is written, resolution turns nullable-everything database rows
 * into something a renderer can use with no `??` of its own, and every
 * function is keyed by an `agencyId` from the session (Backend Guide §4),
 * never from the request body.
 *
 * The one place this file earns its own read, rather than being "Day 2 again
 * with different field names": **`items` is a tree, and the write is a full
 * replacement, not a merge.** Day 2's PATCH had to reconcile a request against
 * a stored row field by field. Day 3's `items`, when the client sends it, does
 * not get reconciled with anything — it *becomes* the stored menu, in that
 * order. That is what "drag-and-drop reorder" means from the server's side:
 * there is no reorder operation, only a replace operation the client happens
 * to call after reordering client-side.
 */

import { db } from "@funtush/database";
import { httpError } from "../utils/httpError";
import {
  DEFAULT_BOOK_NOW_LABEL,
  DEFAULT_NAVIGATION_ITEMS,
  MAX_DROPDOWN_ITEMS,
  MAX_MENU_DEPTH,
  MAX_TOP_LEVEL_ITEMS,
  NAVIGATION_LINK_TYPES,
  allowsBookNowCustomization,
  allowsCustomNavigation,
  type NavigationLinkTypeId,
} from "../data/navigation";
import type { NavigationUpdateInput } from "../validations/navigation.validation";
import { getAgencyBrandContext } from "./branding.service";

/* ── Types ───────────────────────────────────────────────────────────────── */

/** One row of `agency_navigation_items`, as Prisma returns it. */
export interface NavigationItemRow {
  id: string;
  parentId: string | null;
  label: string;
  linkType: NavigationLinkTypeId;
  url: string;
  openInNewTab: boolean;
  position: number;
}

/** The subset of an `agency_navigation` row (plus its items) this module reads. */
export interface NavigationRecordRow {
  bookNowLabel: string | null;
  bookNowHidden: boolean;
  items: NavigationItemRow[];
  updatedAt: Date;
}

/** One rendered menu entry with no further children — a dropdown row, or a leaf. */
export interface ResolvedNavigationLeaf {
  label: string;
  linkType: NavigationLinkTypeId;
  url: string;
  openInNewTab: boolean;
}

/** One rendered top-level menu entry, dropdown included. */
export interface ResolvedNavigationItem extends ResolvedNavigationLeaf {
  children: ResolvedNavigationLeaf[];
}

/** The Book Now button, ready to render. */
export interface ResolvedBookNowButton {
  label: string;
  hidden: boolean;
}

/**
 * What the public renderer receives.
 *
 * `isCustom` tells the renderer (and the dashboard) whether `items` is the
 * agency's own menu or the platform's standard fixed navigation — the same
 * "whole object, not a flag the caller must remember to check" shape Day 2
 * used for `topBar`/`popup`. A front-end that wants to show "using the
 * standard menu" copy reads one boolean instead of re-deriving the tier rule
 * itself.
 */
export interface ResolvedNavigation {
  items: ResolvedNavigationItem[];
  bookNow: ResolvedBookNowButton;
  isCustom: boolean;
  updatedAt: Date | null;
}

/** What the dashboard settings screen receives: raw values plus capabilities. */
export interface EditableNavigation {
  tier: string;
  /** The agency's own stored menu, empty when it has never built one. */
  items: ResolvedNavigationItem[];
  /** Raw stored value — `null` means "never renamed", not "hidden". */
  bookNowLabel: string | null;
  bookNowHidden: boolean;
  capabilities: {
    customNavigation: boolean;
    bookNowCustomization: boolean;
  };
  /** What actually renders right now, tier rule already applied. */
  effectiveNavigation: ResolvedNavigation;
  updatedAt: Date | null;
}

/* ── 1. Tier rules ───────────────────────────────────────────────────────── */

/**
 * Refuse a menu edit from a tier that does not have the builder.
 *
 * The check is "did the request *send* `items` at all", not "does the sent
 * menu differ from the fixed default" — mirroring Day 2's `assertPopupAllowed`
 * rather than its badge rule. A menu has no single "forced" value worth
 * comparing against the way a boolean does; enumerating "is this array equal
 * to `DEFAULT_NAVIGATION_ITEMS`" would be more code for a case that amounts to
 * a Small-tier agency coincidentally re-submitting the four default links,
 * which nothing generates on its own.
 *
 * 403, not 400: this is a well-formed request the tier is not entitled to
 * make, the same distinction Day 1 and Day 2 both draw.
 */
export function assertCustomNavigationAllowed(tier: string, input: NavigationUpdateInput): void {
  if (input.items === undefined) return;
  if (allowsCustomNavigation(tier)) return;

  throw httpError(
    403,
    "Custom navigation menus are available on the Medium and Large plans. Upgrade to build your own menu.",
  );
}

/**
 * Refuse a Book Now change from a tier that must keep the default button.
 *
 * Unlike the menu check above, this one *does* carry Day 2's badge-style
 * carve-out: a value that agrees with the forced state is let through rather
 * than refused, because a "save the whole form" client sends every field
 * every time, and a boolean (or a label with one obvious default) is cheap to
 * compare exactly — unlike a whole menu tree.
 */
export function assertBookNowChangeAllowed(tier: string, input: NavigationUpdateInput): void {
  if (allowsBookNowCustomization(tier)) return;

  const labelAgrees =
    input.bookNowLabel === undefined ||
    input.bookNowLabel === null ||
    input.bookNowLabel === DEFAULT_BOOK_NOW_LABEL;
  const hiddenAgrees = input.bookNowHidden === undefined || input.bookNowHidden === false;

  if (labelAgrees && hiddenAgrees) return;

  throw httpError(
    403,
    "Renaming or hiding the Book Now button is available on the Medium and Large plans.",
  );
}

/* ── 2. Building a tree out of a flat list ──────────────────────────────── */

/**
 * Turn the flat list Postgres returns into the two-level tree the renderer
 * wants.
 *
 * A pure function of its argument — it sorts by `position` itself rather than
 * trusting the caller's `orderBy`, so a test (or a future caller) can hand it
 * rows in any order and still get a correct tree. The cost is one extra sort
 * over at most a few dozen rows, which is free at this size.
 */
export function buildItemTree(rows: readonly NavigationItemRow[]): ResolvedNavigationItem[] {
  const childrenByParent = new Map<string, NavigationItemRow[]>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    const siblings = childrenByParent.get(row.parentId) ?? [];
    siblings.push(row);
    childrenByParent.set(row.parentId, siblings);
  }

  const toLeaf = (row: NavigationItemRow): ResolvedNavigationLeaf => ({
    label: row.label,
    linkType: row.linkType,
    url: row.url,
    openInNewTab: row.openInNewTab,
  });

  return rows
    .filter((row) => row.parentId === null)
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((row) => ({
      ...toLeaf(row),
      children: (childrenByParent.get(row.id) ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map(toLeaf),
    }));
}

/** The platform's standard fixed navigation, in the same shape a stored menu resolves to. */
export function defaultNavigationItems(): ResolvedNavigationItem[] {
  return DEFAULT_NAVIGATION_ITEMS.map((item) => ({ ...item, children: [] }));
}

/* ── 3. Resolution — row + tier → what renders ───────────────────────────── */

/**
 * Build the Book Now button, or fall back to the forced default.
 *
 * Checked on the read path, not only the write path — the same downgrade
 * argument Day 2 made for the popup. An agency that renamed the button to
 * "Reserve Your Trek" and then dropped from Large to Small must see "Book Now"
 * again immediately, with the customization preserved (not deleted) in case
 * it upgrades back.
 */
export function resolveBookNow(tier: string, row: NavigationRecordRow | null): ResolvedBookNowButton {
  if (!allowsBookNowCustomization(tier)) {
    return { label: DEFAULT_BOOK_NOW_LABEL, hidden: false };
  }

  return {
    label: row?.bookNowLabel?.trim() || DEFAULT_BOOK_NOW_LABEL,
    hidden: row?.bookNowHidden ?? false,
  };
}

/**
 * Turn a (possibly missing) row into exactly what the renderer should draw.
 *
 * Three cases collapse into the same "standard nav" outcome, and that overlap
 * is intentional rather than three separate code paths that could drift:
 *
 *   1. The tier does not have the builder (Small, the trial).
 *   2. The tier has the builder but has never saved a menu (no row).
 *   3. The tier has the builder, has a row, but saved zero items (cleared
 *      its menu entirely rather than editing it).
 *
 * All three mean "there is nothing of the agency's own to show", so all three
 * render the platform default — the same "no row ⇒ platform default" rule
 * Day 1 and Day 2 both use, extended to "no *items*" for the tree case.
 */
export function resolveNavigation(tier: string, row: NavigationRecordRow | null): ResolvedNavigation {
  const bookNow = resolveBookNow(tier, row);
  const updatedAt = row?.updatedAt ?? null;

  if (!allowsCustomNavigation(tier)) {
    return { items: defaultNavigationItems(), bookNow, isCustom: false, updatedAt };
  }

  const items = row ? buildItemTree(row.items) : [];
  if (items.length === 0) {
    return { items: defaultNavigationItems(), bookNow, isCustom: false, updatedAt };
  }

  return { items, bookNow, isCustom: true, updatedAt };
}

/* ── 4. Reads ────────────────────────────────────────────────────────────── */

/** Load an agency's navigation row plus its items in one query, or `null`. */
async function loadNavigationRow(agencyId: string): Promise<NavigationRecordRow | null> {
  const row = await db.agencyNavigation.findUnique({
    where: { agencyId },
    include: { items: { orderBy: { position: "asc" } } },
  });

  if (!row) return null;

  return {
    bookNowLabel: row.bookNowLabel,
    bookNowHidden: row.bookNowHidden,
    items: row.items as NavigationItemRow[],
    updatedAt: row.updatedAt,
  };
}

/**
 * The dashboard read.
 *
 * Returns the **raw stored menu**, not only the resolved one, for Day 2's
 * reason: a Medium agency that drops to Small must still see the menu it
 * built in its settings screen (greyed out, with an upgrade prompt), not an
 * empty builder that looks like its work vanished. `effectiveNavigation` is
 * what the public site currently shows; `items` is what is saved.
 */
export async function getNavigation(agencyId: string): Promise<EditableNavigation> {
  const agency = await getAgencyBrandContext(agencyId);
  const row = await loadNavigationRow(agencyId);

  return {
    tier: agency.tier,
    items: row ? buildItemTree(row.items) : [],
    bookNowLabel: row?.bookNowLabel ?? null,
    bookNowHidden: row?.bookNowHidden ?? false,
    capabilities: {
      customNavigation: allowsCustomNavigation(agency.tier),
      bookNowCustomization: allowsBookNowCustomization(agency.tier),
    },
    effectiveNavigation: resolveNavigation(agency.tier, row),
    updatedAt: row?.updatedAt ?? null,
  };
}

/** Everything the settings screen needs to draw the builder's chrome. */
export async function getNavigationOptions(agencyId: string) {
  const agency = await getAgencyBrandContext(agencyId);

  return {
    tier: agency.tier,
    linkTypes: Object.values(NAVIGATION_LINK_TYPES),
    limits: {
      maxTopLevelItems: MAX_TOP_LEVEL_ITEMS,
      maxDropdownItems: MAX_DROPDOWN_ITEMS,
      maxDepth: MAX_MENU_DEPTH,
    },
    capabilities: {
      customNavigation: allowsCustomNavigation(agency.tier),
      bookNowCustomization: allowsBookNowCustomization(agency.tier),
    },
    notes: {
      customNavigation: allowsCustomNavigation(agency.tier)
        ? "Build your own menu — up to 8 top-level items, each with an optional dropdown."
        : "Custom menus are available on the Medium and Large plans. Your site uses the standard navigation.",
      bookNow: allowsBookNowCustomization(agency.tier)
        ? "Rename or hide the Book Now button."
        : "Renaming or hiding the Book Now button is available on the Medium and Large plans.",
    },
  };
}

/**
 * The public read — what the white-label renderer calls to draw the header.
 *
 * A `SUSPENDED` or `LOCKED` agency gets a **404**, matching Day 1 and Day 2
 * exactly: 403 would confirm the agency exists but is not paying, which is
 * nobody else's business.
 */
export async function getPublicNavigationBySlug(
  slug: string,
): Promise<ResolvedNavigation & { agencySlug: string }> {
  const agency = await db.agency.findUnique({
    where: { slug },
    select: {
      slug: true,
      status: true,
      tier: { select: { name: true } },
      navigation: {
        include: { items: { orderBy: { position: "asc" } } },
      },
    },
  });

  if (!agency) throw httpError(404, "Site not found");
  if (agency.status === "SUSPENDED" || agency.status === "LOCKED") {
    throw httpError(404, "Site not found");
  }

  const tier = agency.tier?.name ?? "FREE";

  const row: NavigationRecordRow | null = agency.navigation
    ? {
        bookNowLabel: agency.navigation.bookNowLabel,
        bookNowHidden: agency.navigation.bookNowHidden,
        items: agency.navigation.items as NavigationItemRow[],
        updatedAt: agency.navigation.updatedAt,
      }
    : null;

  return { ...resolveNavigation(tier, row), agencySlug: agency.slug };
}

/* ── 5. The write ────────────────────────────────────────────────────────── */

/**
 * Apply a navigation PATCH.
 *
 * Sequence, and why:
 *
 *   1. Reject an empty patch — the same client-bug guard Day 2 uses.
 *   2. Tier rules (403s) before any database write.
 *   3. One transaction: upsert the settings row (Book Now fields), and — only
 *      if the request sent `items` — delete every stored item and recreate
 *      the new list from scratch.
 *
 * **Why delete-then-recreate instead of diffing against stored rows by id?**
 * Because the request does not carry ids. The client's whole job on this
 * screen is "here is my menu, in its final order" — that is what dragging and
 * dropping produces — so there is nothing to reconcile against; the incoming
 * array simply *is* the new state. Diffing would need the client to track
 * server-assigned ids through a drag operation for no benefit, since the
 * bounded size here (at most `MAX_TOP_LEVEL_ITEMS` × `MAX_DROPDOWN_ITEMS`,
 * comfortably under 100 rows) makes "delete a few dozen rows, insert a few
 * dozen rows" cheap enough that optimising it would be solving a performance
 * problem this endpoint does not have.
 *
 * Children are created after their parent so the child's `parentId` can be the
 * real database id — there is no way to know that id before the parent's
 * `create` returns.
 */
export async function updateNavigation(
  agencyId: string,
  input: NavigationUpdateInput,
): Promise<EditableNavigation> {
  const agency = await getAgencyBrandContext(agencyId);

  if (Object.keys(input).length === 0) {
    throw httpError(400, "No navigation fields provided to update");
  }

  assertCustomNavigationAllowed(agency.tier, input);
  assertBookNowChangeAllowed(agency.tier, input);

  const bookNowData: Record<string, unknown> = {};
  if (input.bookNowLabel !== undefined) bookNowData.bookNowLabel = input.bookNowLabel;
  if (input.bookNowHidden !== undefined) bookNowData.bookNowHidden = input.bookNowHidden;

  await db.$transaction(async (tx) => {
    const navigation = await tx.agencyNavigation.upsert({
      where: { agencyId },
      update: bookNowData,
      create: { agencyId, ...bookNowData },
    });

    if (input.items === undefined) return;

    await tx.agencyNavigationItem.deleteMany({ where: { navigationId: navigation.id } });

    for (const [index, item] of input.items.entries()) {
      const parent = await tx.agencyNavigationItem.create({
        data: {
          navigationId: navigation.id,
          label: item.label,
          // zod's `z.enum(NAVIGATION_LINK_TYPE_IDS as [string, ...string[]])`
          // widens `linkType` to `string` — the same trade-off Day 2's
          // `topBarBehavior` schema makes. The cast is safe: zod already
          // rejected anything outside `NAVIGATION_LINK_TYPE_IDS`, which is
          // exactly `NavigationLinkTypeId`'s two members.
          linkType: item.linkType as NavigationLinkTypeId,
          url: item.url,
          openInNewTab: item.openInNewTab ?? false,
          position: index,
        },
      });

      for (const [childIndex, child] of (item.children ?? []).entries()) {
        await tx.agencyNavigationItem.create({
          data: {
            navigationId: navigation.id,
            parentId: parent.id,
            label: child.label,
            linkType: child.linkType as NavigationLinkTypeId,
            url: child.url,
            openInNewTab: child.openInNewTab ?? false,
            position: childIndex,
          },
        });
      }
    }
  });

  return getNavigation(agencyId);
}
