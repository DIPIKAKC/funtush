/**
 * ── Brand identity controllers (White-label week · Day 1) ────────────────────
 *
 * Thin by design, like the mobile-week controllers: read the request, call the
 * service, shape the response. Every rule about *what is allowed* lives in
 * `branding.service.ts`; every rule about *what is well-formed* lives in
 * `validations/branding.validation.ts`.
 *
 * The one piece of genuine HTTP logic that belongs here is caching, and it
 * splits neatly in two:
 *
 *   - The **dashboard** reads (`/agencies/me/branding`, `/…/options`) are
 *     per-agency and behind auth → `private, no-store`. A settings screen must
 *     never show a stale value straight after a save.
 *   - The **public** read is anonymous, identical for every visitor to that
 *     site, and requested on every page view → `public`, short max-age, plus an
 *     ETag so a repeat visit is a 304 rather than a body.
 */

import type { Request, Response } from "express";
import {
  getAgencyBranding,
  getBrandingOptions,
  getPublicBrandingBySlug,
  updateAgencyBranding,
  brandingCssVariables,
  brandingStyleBlock,
  type BrandImageFiles,
} from "../services/branding.service";
import type { BrandingUpdateInput } from "../validations/branding.validation";

/** Dashboard reads: always fresh. */
const PRIVATE_NO_STORE = "private, no-store";

/**
 * Public site reads: 60 seconds.
 *
 * Short on purpose. Branding changes rarely, but when it does the agency is
 * usually staring at its own site hitting refresh, and "your new logo appears
 * within a minute" is a support answer people accept. An hour is not.
 */
const PUBLIC_SITE_CACHE = "public, max-age=60, stale-while-revalidate=600";

/** Turn a thrown service error into a status + message, with no stack leak. */
function respondWithError(res: Response, err: unknown, route: string): void {
  const status = (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(`[${route}]`, err);
  res.status(status).json({ success: false, message });
}

/**
 * `GET /agencies/me/branding` — the current theme for the settings screen.
 */
export async function getMyBranding(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = req.agencyId as string;
    if (!agencyId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const branding = await getAgencyBranding(agencyId);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({ success: true, data: branding });
  } catch (err) {
    respondWithError(res, err, "GET /agencies/me/branding");
  }
}

/**
 * `GET /agencies/me/branding/options` — the pickers.
 *
 * A separate endpoint rather than a blob nested inside the read above, because
 * the two have completely different change rates: the options are the same for
 * every agency on a tier and change on deploy, the theme changes on save. A
 * front-end can fetch the options once per session and the theme on every visit
 * to the screen.
 */
export async function getMyBrandingOptions(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = req.agencyId as string;
    if (!agencyId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const options = await getBrandingOptions(agencyId);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({ success: true, data: options });
  } catch (err) {
    respondWithError(res, err, "GET /agencies/me/branding/options");
  }
}

/**
 * `PATCH /agencies/me/branding` — the day's headline endpoint.
 *
 * Accepts `multipart/form-data` (fields + the `logo` / `favicon` files) or plain
 * JSON when no file is being changed. Multer leaves a JSON request untouched, so
 * one handler serves both without branching.
 *
 * PATCH and not PUT: an agency changing only its currency symbol should not have
 * to re-upload its logo, and PUT semantics say the body is the complete new
 * state.
 */
export async function patchMyBranding(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = req.agencyId as string;
    if (!agencyId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    // `validate(brandingUpdateSchema)` has already replaced `req.body` with the
    // parsed, trimmed, uppercased result — so this cast describes reality rather
    // than hoping for it.
    const input = req.body as BrandingUpdateInput;
    const files = (req.files ?? {}) as BrandImageFiles;

    const branding = await updateAgencyBranding(agencyId, input, files);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({
      success: true,
      message: "Branding updated",
      data: branding,
      // The variables the site will now render with, echoed back so the
      // settings screen can live-preview without a second request.
      cssVariables: brandingCssVariables(branding),
    });
  } catch (err) {
    respondWithError(res, err, "PATCH /agencies/me/branding");
  }
}

/**
 * `GET /site/:slug/branding` — what the white-label renderer calls.
 *
 * Public and unauthenticated: it is the theme of a public website, and a visitor
 * who has not logged in still needs the page to have the right colours. Nothing
 * private is in the payload — every field here is visible on the rendered page
 * anyway.
 *
 * `?format=css` returns the `:root { … }` block as `text/css` instead of JSON,
 * so a renderer can point a `<link rel="stylesheet">` straight at it when it
 * would rather not inline anything.
 */
export async function getSiteBranding(req: Request, res: Response): Promise<void> {
  try {
    const slug = String(req.params.slug ?? "").toLowerCase();
    if (!slug) {
      res.status(400).json({ success: false, message: "Site slug is required" });
      return;
    }

    const branding = await getPublicBrandingBySlug(slug);

    /**
     * The ETag keys on the row's `updatedAt`, which Prisma bumps on every save.
     * `"init"` covers an agency that has never saved — all of which share one
     * tag, which is correct: they all render the identical default theme.
     */
    const etag = `"brand-${slug}-${branding.updatedAt?.getTime() ?? "init"}"`;

    res.setHeader("Cache-Control", PUBLIC_SITE_CACHE);
    res.setHeader("ETag", etag);

    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }

    if (req.query.format === "css") {
      res.setHeader("Content-Type", "text/css; charset=utf-8");
      res.status(200).send(brandingStyleBlock(branding));
      return;
    }

    res.status(200).json({
      success: true,
      data: branding,
      cssVariables: brandingCssVariables(branding),
    });
  } catch (err) {
    respondWithError(res, err, "GET /site/:slug/branding");
  }
}
