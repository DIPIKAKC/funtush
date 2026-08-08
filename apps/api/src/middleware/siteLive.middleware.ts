/**
 * ── The under-construction gate (White-label week · Day 2) ───────────────────
 *
 * Bullet 1 of the day reads: *"Site Under Construction toggle — shows a
 * coming-soon page to visitors, dashboard stays functional."* This middleware is
 * the "shows a coming-soon page to **visitors**" half, and its whole reason to
 * exist is that a boolean the front-end reads is not a gate.
 *
 * If `underConstruction` were only a flag in a JSON response, the renderer would
 * draw a coming-soon page while `GET /site/acme/packages` cheerfully kept
 * serving the unfinished package list to anyone who opened dev-tools, a scraper,
 * or a stale cached bundle. A switch that turns a website off has to be enforced
 * by the thing that serves the website.
 *
 * ── Why 503 and not 404 ──
 *
 * 503 Service Unavailable means "this exists, it is temporarily not being
 * served, come back". 404 means "there is nothing here". The difference is not
 * pedantry — Google removes 404 URLs from its index within days, so an agency
 * that switches construction mode on for a weekend redesign would come back to a
 * site that has lost its search ranking, which is a genuinely expensive way to
 * be wrong. 503 plus `Retry-After` is the documented signal for exactly this
 * situation and search engines hold the URL.
 *
 * (Day 1 uses 404 for a `SUSPENDED` or `LOCKED` agency. That is not a
 * contradiction: a suspended account is *not coming back on a timer*, and the
 * platform also has no business confirming to a stranger that a named agency
 * exists but has stopped paying.)
 *
 * ── Why the dashboard is unaffected ──
 *
 * There is no clever exclusion list. This middleware only ever runs on public,
 * slug-addressed site routes, because those are the only routes it is mounted
 * on. The dashboard lives at `/agencies/me/*` behind `authenticateWithRefresh
 * Token`, and nothing here is attached to it. "Dashboard stays functional" is
 * achieved by *where the guard is mounted*, not by a condition inside it — which
 * is the version that cannot be broken by someone editing this file later.
 */

import type { Request, Response, NextFunction } from "express";
import { getSiteLiveness } from "../services/siteConfig.service";

/**
 * How long a visitor (or a crawler) is asked to wait before retrying, in
 * seconds.
 *
 * One hour. Long enough that a crawler does not hammer a site being rebuilt,
 * short enough that the site reappears in search results the same day it comes
 * back rather than at the end of a cache lifetime nobody remembers setting.
 */
const RETRY_AFTER_SECONDS = 3600;

/**
 * Block a public site route while the agency has construction mode on.
 *
 * Expects the agency's subdomain slug at `req.params.slug`, which is the shape
 * every `/site/:slug/...` route already has.
 *
 * The response body carries the coming-soon copy so a renderer that hits a
 * content route first — a deep link, a shared URL, a page reload — can draw the
 * right page from this response alone, with no follow-up request. A 503 with an
 * empty body would force every client into a second round trip just to find out
 * what to say.
 */
export async function requireSiteLive(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const slug = String(req.params.slug ?? "").toLowerCase();

    if (!slug) {
      res.status(400).json({ success: false, message: "Site slug is required" });
      return;
    }

    const liveness = await getSiteLiveness(slug);

    if (liveness.live) {
      next();
      return;
    }

    // Not live and no coming-soon copy ⇒ the agency does not exist, or is
    // suspended/locked. Day 1's rule: both look identical from outside.
    if (!liveness.comingSoon) {
      res.status(404).json({ success: false, message: "Site not found" });
      return;
    }

    res.setHeader("Retry-After", String(RETRY_AFTER_SECONDS));
    /**
     * `no-store`, deliberately, even though 503 is the one status a CDN would
     * love to cache. Construction mode is switched off by a human who then
     * immediately loads their own site; a cached 503 would show them the
     * coming-soon page for the length of the TTL and they would report the
     * toggle as broken.
     */
    res.setHeader("Cache-Control", "no-store");

    res.status(503).json({
      success: false,
      underConstruction: true,
      message: "This site is temporarily unavailable",
      comingSoon: liveness.comingSoon,
    });
  } catch (err) {
    /**
     * Fail **open**, not closed.
     *
     * If the liveness lookup itself fails — Postgres blipped — the choice is
     * between showing every visitor a coming-soon page for a site that is
     * perfectly live, or letting the request through to a handler that has its
     * own error handling. Taking a paying customer's website down because a
     * guard could not confirm it was up is the worse outcome by a wide margin,
     * and the handler behind this will fail on its own if the database is
     * genuinely gone.
     */
    console.error("[requireSiteLive] liveness check failed, allowing request", err);
    next();
  }
}
