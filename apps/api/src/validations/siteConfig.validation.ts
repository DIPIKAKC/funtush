/**
 * ── Request validation for the site-config endpoint (White-label week · Day 2)
 *
 * Same three-layer split Day 1 established, and it is worth restating because
 * Day 2 adds a layer that Day 1 did not need:
 *
 *   **This file (zod)** — *"is this request well-formed?"* Shape, types, string
 *   lengths, enum membership, URL safety. Needs no database and no other field.
 *
 *   **`siteConfig.service.ts`, tier rules** — *"is this agency allowed to?"*
 *   The popup is Medium+; the badge cannot be switched off on the trial. Needs a
 *   database read for the tier.
 *
 *   **`siteConfig.service.ts`, merged-state rules** — *"will the result make
 *   sense?"* You may not enable the top bar without any text in it. This one is
 *   new, and it cannot live in zod for a reason worth internalising: **this is a
 *   PATCH.** A request of `{"topBarEnabled": true}` is perfectly valid on its own
 *   and perfectly invalid if the stored `topBarText` is `null`. Zod only ever
 *   sees the request; the answer depends on the request *plus the row*. Any
 *   cross-field rule on a PATCH endpoint belongs after the row is loaded.
 *
 * Get that boundary wrong and you either reject legal requests (zod demanding a
 * field the row already has) or ship a live site with an empty announcement bar.
 */

import { z } from "zod";
import {
  MAX_POPUP_DELAY_SECONDS,
  MIN_POPUP_DELAY_SECONDS,
  POPUP_FREQUENCY_IDS,
  POPUP_TRIGGER_IDS,
  SITE_TEXT_LIMITS,
  TOP_BAR_BEHAVIOR_IDS,
  isSafeLinkUrl,
} from "../data/siteConfig";

/** Reused from Day 1's branding schema: `#RRGGBB`, six digits, no shorthand. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Text that will be rendered into a page.
 *
 * `<` and `>` are rejected; `&`, `'` and `"` are **not**.
 *
 * That asymmetry is deliberate and is the opposite of the rule Day 1 used for
 * the currency symbol. A currency glyph is four characters and an apostrophe in
 * one is always a mistake. An announcement is a sentence of English — "Don't
 * miss Everest Base Camp — 15% off" contains an apostrophe, an ampersand is
 * normal in "Bed & Breakfast", and rejecting them produces an infuriating form
 * that agencies work around by typing worse copy.
 *
 * Angle brackets are different: there is no sentence about a trek that needs
 * one, and they are the character that turns text into markup.
 *
 * **This is defence in depth, not the defence.** The renderer must still escape
 * these strings — this check makes an escaping bug survivable, it does not
 * excuse one. Saying so out loud matters, because a validator that is *believed*
 * to be the whole protection is how the escaping step gets skipped.
 */
function safeText(field: string, min: number, max: number) {
  return z
    .string()
    .trim()
    .min(min, `${field} must be at least ${min} characters`)
    .max(max, `${field} must be at most ${max} characters`)
    .refine((value) => !/[<>]/.test(value), {
      message: `${field} must not contain < or >`,
    });
}

/**
 * A link the public site will point visitors at.
 *
 * `.nullable()` on every optional text field in this schema, and here in
 * particular, is how an agency *removes* something. `{"topBarLinkUrl": null}`
 * means "make the bar unclickable again"; omitting the key means "leave it
 * alone". Day 1 learned this on `currencySymbol` — without `null` there is no
 * way to express "clear it", and agencies resort to typing a space.
 */
const linkUrl = z
  .string()
  .trim()
  .max(SITE_TEXT_LIMITS.url.max, `Link must be at most ${SITE_TEXT_LIMITS.url.max} characters`)
  .refine(isSafeLinkUrl, {
    message: "Link must be a full http:// or https:// URL",
  });

export const siteConfigUpdateSchema = z
  .object({
    /* ── Under construction ─────────────────────────────────────────────── */
    underConstruction: z.boolean().optional(),

    constructionHeadline: safeText(
      "Headline",
      SITE_TEXT_LIMITS.constructionHeadline.min,
      SITE_TEXT_LIMITS.constructionHeadline.max,
    )
      .nullable()
      .optional(),

    constructionMessage: safeText(
      "Message",
      SITE_TEXT_LIMITS.constructionMessage.min,
      SITE_TEXT_LIMITS.constructionMessage.max,
    )
      .nullable()
      .optional(),

    /* ── Top bar ────────────────────────────────────────────────────────── */
    topBarEnabled: z.boolean().optional(),

    topBarText: safeText(
      "Top bar text",
      SITE_TEXT_LIMITS.topBarText.min,
      SITE_TEXT_LIMITS.topBarText.max,
    )
      .nullable()
      .optional(),

    topBarBehavior: z.enum(TOP_BAR_BEHAVIOR_IDS as [string, ...string[]]).optional(),

    /**
     * `null` means "go back to inheriting the brand colour", which is a real and
     * common intention — an agency tries a red bar, dislikes it, and wants the
     * bar to track its brand colour again.
     */
    topBarBackgroundColor: z
      .string()
      .trim()
      .regex(HEX_COLOR, "Top bar colour must be a hex value like #0F766E")
      .transform((value) => value.toUpperCase())
      .nullable()
      .optional(),

    topBarLinkUrl: linkUrl.nullable().optional(),

    topBarDismissible: z.boolean().optional(),

    /* ── Popup modal ────────────────────────────────────────────────────── */
    popupEnabled: z.boolean().optional(),

    popupTitle: safeText("Popup title", SITE_TEXT_LIMITS.popupTitle.min, SITE_TEXT_LIMITS.popupTitle.max)
      .nullable()
      .optional(),

    popupBody: safeText("Popup body", SITE_TEXT_LIMITS.popupBody.min, SITE_TEXT_LIMITS.popupBody.max)
      .nullable()
      .optional(),

    popupCtaLabel: safeText(
      "Button label",
      SITE_TEXT_LIMITS.popupCtaLabel.min,
      SITE_TEXT_LIMITS.popupCtaLabel.max,
    )
      .nullable()
      .optional(),

    popupCtaUrl: linkUrl.nullable().optional(),

    popupTrigger: z.enum(POPUP_TRIGGER_IDS as [string, ...string[]]).optional(),

    /**
     * `.int()` before `.min()`. Without it `2.5` passes the range check and
     * reaches Prisma, which rejects a float for an `INTEGER` column with a
     * five-hundred-line error that mentions neither "delay" nor "seconds".
     * Catching it here costs one method call and produces a readable message.
     */
    popupDelaySeconds: z
      .number()
      .int("Delay must be a whole number of seconds")
      .min(MIN_POPUP_DELAY_SECONDS, `Delay must be at least ${MIN_POPUP_DELAY_SECONDS} seconds`)
      .max(MAX_POPUP_DELAY_SECONDS, `Delay must be at most ${MAX_POPUP_DELAY_SECONDS} seconds`)
      .optional(),

    popupFrequency: z.enum(POPUP_FREQUENCY_IDS as [string, ...string[]]).optional(),

    /* ── Funtush badge ──────────────────────────────────────────────────── */
    showFuntushBadge: z.boolean().optional(),
  })
  /**
   * Reject unknown keys rather than silently dropping them — the same
   * `.strict()` Day 1 added, for the same reason.
   *
   * It earns its keep twice as hard here. This endpoint has nineteen fields with
   * long, similar names (`topBarEnabled`, `topBarDismissible`, `popupEnabled`),
   * and zod's default behaviour on a typo is `200 OK` with nothing changed. On a
   * screen whose switches take a website offline, "it said it saved and it did
   * not" is the worst possible failure mode.
   */
  .strict();

export type SiteConfigUpdateInput = z.infer<typeof siteConfigUpdateSchema>;

/**
 * The keys that belong to the popup feature.
 *
 * Exported, and derived in one place, because the service asks "did this request
 * touch the popup at all?" to decide whether the Medium+ tier rule applies. If
 * that list were retyped inside the service, adding a twentieth popup field
 * later would add an ungated field, and nothing would fail — the hole would just
 * exist.
 */
export const POPUP_FIELDS = [
  "popupEnabled",
  "popupTitle",
  "popupBody",
  "popupCtaLabel",
  "popupCtaUrl",
  "popupTrigger",
  "popupDelaySeconds",
  "popupFrequency",
] as const satisfies readonly (keyof SiteConfigUpdateInput)[];
