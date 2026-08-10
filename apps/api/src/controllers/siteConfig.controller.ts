/**
 * ── Site configuration controllers (White-label week · Day 2) ────────────────
 *
 * Thin, like Day 1's: read the request, call the service, shape the response.
 * Every rule about *what is allowed* is in `siteConfig.service.ts`; every rule
 * about *what is well-formed* is in `validations/siteConfig.validation.ts`.
 *
 * The HTTP logic that genuinely belongs here is caching, and Day 2 has a wrinkle
 * Day 1 did not:
 *
 *   - Dashboard reads → `private, no-store`. Same as Day 1.
 *   - The public read → cacheable, **but for a much shorter time than branding.**
 *     Branding gets 60 seconds because a logo changes twice a year. This payload
 *     contains the switch that takes a website offline, and "my site is still up
 *     for another minute after I turned it off" is not something an agency in the
 *     middle of an emergency finds acceptable. 15 seconds is the compromise: it
 *     still absorbs the burst of requests a single page load produces, without
 *     making the off switch feel broken.
 */

import type { Request, Response } from "express";
import {
  getPublicSiteConfigBySlug,
  getSiteConfig,
  getSiteConfigOptions,
  updateSiteConfig,
} from "../services/siteConfig.service";
import type { SiteConfigUpdateInput } from "../validations/siteConfig.validation";

/** Dashboard reads: always fresh. */
const PRIVATE_NO_STORE = "private, no-store";

/** Public site reads: see the file header for why this is 15s and not 60s. */
const PUBLIC_SITE_CACHE = "public, max-age=15, stale-while-revalidate=60";

/** Turn a thrown service error into a status + message, with no stack leak. */
function respondWithError(res: Response, err: unknown, route: string): void {
  const status = (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(`[${route}]`, err);
  res.status(status).json({ success: false, message });
}

/** `GET /agencies/me/site-config` — the settings screen's current values. */
export async function getMySiteConfig(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = req.agencyId as string;
    if (!agencyId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const config = await getSiteConfig(agencyId);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({ success: true, data: config });
  } catch (err) {
    respondWithError(res, err, "GET /agencies/me/site-config");
  }
}

/**
 * `GET /agencies/me/site-config/options` — the pickers and the tier notes.
 *
 * Separate from the read above for Day 1's reason: the options are identical for
 * every agency on a tier and change on deploy, the values change on save. A
 * front-end fetches these once per session.
 */
export async function getMySiteConfigOptions(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = req.agencyId as string;
    if (!agencyId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const options = await getSiteConfigOptions(agencyId);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({ success: true, data: options });
  } catch (err) {
    respondWithError(res, err, "GET /agencies/me/site-config/options");
  }
}

/**
 * `PATCH /agencies/me/site-config` — the day's headline endpoint.
 *
 * JSON only, no multipart: unlike branding there is nothing to upload here, so
 * the route does not carry multer and a client cannot accidentally send one.
 *
 * PATCH and not PUT, for a sharper reason than Day 1's. With PUT, a client that
 * omits `underConstruction` is asking for it to be reset to the default — and
 * the default is `false`. A settings form with a bug in one section could
 * silently publish a site its owner had deliberately taken down. PATCH has no
 * such failure mode: what you do not send does not change.
 */
export async function patchMySiteConfig(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = req.agencyId as string;
    if (!agencyId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    // `validate(siteConfigUpdateSchema)` has already replaced `req.body` with the
    // parsed, trimmed result, so this cast describes reality rather than hoping.
    const input = req.body as SiteConfigUpdateInput;

    const config = await updateSiteConfig(agencyId, input);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({
      success: true,
      message: "Site configuration updated",
      data: config,
    });
  } catch (err) {
    respondWithError(res, err, "PATCH /agencies/me/site-config");
  }
}

/**
 * `GET /site/:slug/config` — what the white-label renderer calls on every page.
 *
 * Public and unauthenticated, exactly like Day 1's branding read: this describes
 * a public website, and an anonymous visitor's first paint needs it.
 *
 * **This endpoint answers 200 even when the site is under construction.** That
 * looks wrong for about five seconds and is then obviously right: this is the
 * endpoint whose entire job is to tell the renderer *which page to draw*. A 503
 * here would mean the renderer could not find out that it should draw the
 * coming-soon page. The 503 belongs on the content routes, and that is exactly
 * where `requireSiteLive` puts it.
 */
export async function getSiteConfigBySlug(req: Request, res: Response): Promise<void> {
  try {
    const slug = String(req.params.slug ?? "").toLowerCase();
    if (!slug) {
      res.status(400).json({ success: false, message: "Site slug is required" });
      return;
    }

    const config = await getPublicSiteConfigBySlug(slug);

    /**
     * Same ETag trick as Day 1: key on the row's `updatedAt`, which Prisma bumps
     * on every save, so a repeat visit costs a 304 with no body. `"init"` covers
     * an agency that has never saved — they all render the identical default
     * (live site, no bar, no popup), so sharing one tag is correct.
     */
    const etag = `"siteconfig-${slug}-${config.updatedAt?.getTime() ?? "init"}"`;

    res.setHeader("Cache-Control", PUBLIC_SITE_CACHE);
    res.setHeader("ETag", etag);

    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }

    res.status(200).json({ success: true, data: config });
  } catch (err) {
    respondWithError(res, err, "GET /site/:slug/config");
  }
}
