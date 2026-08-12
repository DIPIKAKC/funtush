/**
 * ── Navigation builder controllers (White-label week · Day 3) ────────────────
 *
 * Thin, like Day 1 and Day 2's: read the request, call the service, shape the
 * response. Every rule about *what is allowed* is in `navigation.service.ts`;
 * every rule about *what is well-formed* is in
 * `validations/navigation.validation.ts`.
 *
 * Cache policy mirrors Day 2's site-config controller rather than Day 1's
 * branding one: the header is content a visitor sees on every page, and its
 * blast radius is closer to "the top bar" than to "the logo" — a Book Now
 * button an agency just hid should not linger for a full minute of cache. The
 * same 15-second public cache Day 2 chose applies here for the same reason.
 */

import type { Request, Response } from "express";
import {
  getNavigation,
  getNavigationOptions,
  getPublicNavigationBySlug,
  updateNavigation,
} from "../services/navigation.service";
import type { NavigationUpdateInput } from "../validations/navigation.validation";
import { cacheTagHeaderValue } from "../data/staticPages";

/** Dashboard reads: always fresh. */
const PRIVATE_NO_STORE = "private, no-store";

/** Public site reads: see the file header for why this is 15s, matching Day 2. */
const PUBLIC_SITE_CACHE = "public, max-age=15, stale-while-revalidate=60";

/** Turn a thrown service error into a status + message, with no stack leak. */
function respondWithError(res: Response, err: unknown, route: string): void {
  const status = (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(`[${route}]`, err);
  res.status(status).json({ success: false, message });
}

/** `GET /agencies/me/navigation` — the settings screen's current menu. */
export async function getMyNavigation(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = req.agencyId as string;
    if (!agencyId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const navigation = await getNavigation(agencyId);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({ success: true, data: navigation });
  } catch (err) {
    respondWithError(res, err, "GET /agencies/me/navigation");
  }
}

/**
 * `GET /agencies/me/navigation/options` — link types, limits, and tier notes.
 *
 * Separate from the read above for Day 1's reason: these values are identical
 * for every agency on a tier and change on deploy; the menu itself changes on
 * save. A front-end fetches this once per session.
 */
export async function getMyNavigationOptions(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = req.agencyId as string;
    if (!agencyId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const options = await getNavigationOptions(agencyId);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({ success: true, data: options });
  } catch (err) {
    respondWithError(res, err, "GET /agencies/me/navigation/options");
  }
}

/**
 * `PATCH /agencies/me/navigation` — the day's headline endpoint.
 *
 * JSON only, no multipart: nothing here is a file upload.
 *
 * PATCH, not PUT, for Day 2's reason: a client that omits `bookNowHidden`
 * must not reset it to `false`. The one field that *is* a full replacement
 * when present — `items` — is still PATCH-shaped from the outside: omitting
 * the key leaves the stored menu untouched, exactly like every other field.
 * "Replace the whole array when you send it, don't touch it when you don't"
 * is a perfectly ordinary PATCH semantics for a list-valued field; it is only
 * unusual compared to Day 2's scalars, not compared to PATCH generally.
 */
export async function patchMyNavigation(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = req.agencyId as string;
    if (!agencyId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    // `validate(navigationUpdateSchema)` has already replaced `req.body` with
    // the parsed, trimmed result, so this cast describes reality rather than
    // hoping.
    const input = req.body as NavigationUpdateInput;

    // Day 4: receipt lifted out of `data`, as on Day 1's and Day 2's writes.
    const { regeneration, ...navigation } = await updateNavigation(agencyId, input);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({
      success: true,
      message: "Navigation updated",
      data: navigation,
      regeneration,
    });
  } catch (err) {
    respondWithError(res, err, "PATCH /agencies/me/navigation");
  }
}

/**
 * `GET /site/:slug/navigation` — what the white-label renderer calls to draw
 * the header on every page.
 *
 * Public and unauthenticated, exactly like Day 1's branding read and Day 2's
 * config read: this describes a public website, and an anonymous visitor's
 * first paint needs it. No `requireSiteLive` guard here either, and for the
 * same reason Day 2 left its config read unguarded — this is chrome that
 * renders on the coming-soon page too (a visitor should still be able to get
 * back Home), not page content the construction gate is meant to hide.
 */
export async function getNavigationBySlug(req: Request, res: Response): Promise<void> {
  try {
    const slug = String(req.params.slug ?? "").toLowerCase();
    if (!slug) {
      res.status(400).json({ success: false, message: "Site slug is required" });
      return;
    }

    const navigation = await getPublicNavigationBySlug(slug);

    /**
     * Same ETag trick as Day 1 and Day 2: key on the row's `updatedAt`, which
     * Prisma bumps on every save, so a repeat visit costs a 304 with no body.
     * `"init"` covers an agency that has never saved a custom menu — every
     * such agency renders the identical standard navigation, so sharing one
     * tag is correct.
     */
    const etag = `"navigation-${slug}-${navigation.updatedAt?.getTime() ?? "init"}"`;

    res.setHeader("Cache-Control", PUBLIC_SITE_CACHE);
    res.setHeader("ETag", etag);
    // Day 4: the purge label for this body. See `branding.controller.ts`.
    res.setHeader("Cache-Tag", cacheTagHeaderValue(slug, ["navigation"]));

    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }

    res.status(200).json({ success: true, data: navigation });
  } catch (err) {
    respondWithError(res, err, "GET /site/:slug/navigation");
  }
}
