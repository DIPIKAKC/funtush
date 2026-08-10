/**
 * ── Request validation for the navigation endpoint (White-label week · Day 3)
 *
 * Same split Day 1 and Day 2 established:
 *
 *   **This file (zod)** — *"is this request well-formed?"* Shape, string
 *   lengths, and — the one genuinely per-item rule — whether `url` matches
 *   what `linkType` says it should look like. That check needs no database
 *   and no other field outside the one item, so it belongs here, not in the
 *   service.
 *
 *   **`navigation.service.ts`** — *"is this agency allowed to?"* The menu
 *   builder and the Book Now button are Medium/Large only. Needs a database
 *   read for the tier, so it cannot live in zod.
 *
 * Day 3 has **no merged-state layer**, and that absence is worth explaining
 * rather than leaving unexplained, because Day 2 needed one and a reader who
 * just finished that file will expect this one too. Day 2's `topBarEnabled`
 * depended on whatever `topBarText` was *already stored* — a classic PATCH
 * problem. Day 3's `items`, when sent, is not a field that depends on stored
 * state: it **is** the new menu, in full, in its new order — that is what
 * drag-and-drop reorder means on the wire. There is nothing to merge a
 * complete replacement with. `bookNowLabel`/`bookNowHidden` are ordinary
 * independent scalars with no coherence rule between them at all. So the
 * three-layer shape Day 2 needed collapses back to two layers here, and that
 * is a fact about the feature, not a corner someone cut.
 */

import { z } from "zod";
import {
  MAX_DROPDOWN_ITEMS,
  MAX_EXTERNAL_URL_LENGTH,
  MAX_TOP_LEVEL_ITEMS,
  NAVIGATION_LINK_TYPE_IDS,
  NAV_TEXT_LIMITS,
  isSafeInternalPath,
  isSafeLinkUrl,
} from "../data/navigation";

/**
 * A menu label, trimmed, bounded, and free of markup characters.
 *
 * Reuses the reasoning Day 2's `safeText` documented rather than the function
 * itself — that one lives unexported inside `siteConfig.validation.ts`, and a
 * cross-import for four lines of regex is not worth the coupling. `<` and `>`
 * are rejected for the same reason as every other rendered string in the
 * white-label feature: this is defence in depth, not the defence — the
 * renderer must still escape whatever it prints.
 */
function safeLabel(field: string, min: number, max: number) {
  return z
    .string()
    .trim()
    .min(min, `${field} must be at least ${min} character(s)`)
    .max(max, `${field} must be at most ${max} characters`)
    .refine((value) => !/[<>]/.test(value), {
      message: `${field} must not contain < or >`,
    });
}

/**
 * Check that `url` is the shape `linkType` promises, and attach the error to
 * `url` specifically — not to the item as a whole — so a form can put the
 * message under the field the agency actually needs to fix.
 *
 * Shared between the top-level and child item schemas below rather than
 * written twice: the day this rule gets a third case (a third link type),
 * only one function needs to learn it.
 */
function checkLinkMatchesType(
  item: { linkType: string; url: string },
  ctx: z.RefinementCtx,
): void {
  if (item.linkType === "INTERNAL") {
    if (!isSafeInternalPath(item.url)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "Internal links must start with / and point to a page on your own site, e.g. /packages",
      });
    }
    return;
  }

  if (item.url.length > MAX_EXTERNAL_URL_LENGTH || !isSafeLinkUrl(item.url)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["url"],
      message: "External links must be a full http:// or https:// address",
    });
  }
}

/** Fields shared by a top-level item and a dropdown (child) item. */
const itemBaseShape = {
  label: safeLabel("Menu item label", NAV_TEXT_LIMITS.itemLabel.min, NAV_TEXT_LIMITS.itemLabel.max),
  linkType: z.enum(NAVIGATION_LINK_TYPE_IDS as [string, ...string[]]),
  /**
   * Not `.url()` — an internal path like `/packages` is not a URL by zod's
   * (or the WHATWG's) definition, and `linkType` decides which shape applies.
   * `checkLinkMatchesType` does the real validation below.
   */
  url: z.string().trim().min(1, "Link is required"),
  openInNewTab: z.boolean().optional(),
};

/**
 * A dropdown entry. Note what is *absent*: there is no `children` field here.
 * That omission is the entire enforcement of "up to 2 levels deep" — a child
 * item's schema has no field to put a grandchild in, so the parser rejects a
 * third level as an unrecognised key (`.strict()`, below) rather than the
 * service having to walk a tree and count.
 */
const childItemSchema = z.object(itemBaseShape).strict().superRefine(checkLinkMatchesType);

/** A top-level menu item — everything a child has, plus an optional dropdown. */
const topLevelItemSchema = z
  .object({
    ...itemBaseShape,
    children: z
      .array(childItemSchema)
      .max(MAX_DROPDOWN_ITEMS, `A dropdown may have at most ${MAX_DROPDOWN_ITEMS} items`)
      .optional(),
  })
  .strict()
  .superRefine(checkLinkMatchesType);

export const navigationUpdateSchema = z
  .object({
    /**
     * The whole menu, in its final order. Present ⇒ replace every stored item
     * with this list. Absent ⇒ leave the stored menu untouched — the same
     * "a key you did not send does not change anything" PATCH rule Day 2
     * established, applied to a list instead of a scalar.
     */
    items: z
      .array(topLevelItemSchema)
      .max(MAX_TOP_LEVEL_ITEMS, `A menu may have at most ${MAX_TOP_LEVEL_ITEMS} top-level items`)
      .optional(),

    /** `null` clears a custom label back to the platform default, "Book Now". */
    bookNowLabel: safeLabel(
      "Book Now label",
      NAV_TEXT_LIMITS.bookNowLabel.min,
      NAV_TEXT_LIMITS.bookNowLabel.max,
    )
      .nullable()
      .optional(),

    bookNowHidden: z.boolean().optional(),
  })
  /**
   * Reject unknown keys, same reason as Day 1 and Day 2: zod's default is to
   * silently drop a misspelled key and answer `200 OK` with nothing changed,
   * which on a screen that edits a public site's navigation is exactly the
   * failure mode nobody notices until a customer asks where their menu went.
   */
  .strict();

export type NavigationItemInput = z.infer<typeof topLevelItemSchema>;
export type NavigationChildItemInput = z.infer<typeof childItemSchema>;
export type NavigationUpdateInput = z.infer<typeof navigationUpdateSchema>;
