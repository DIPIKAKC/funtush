/**
 * ── Regeneration controllers (White-label week · Day 4) ──────────────────────
 *
 * Two endpoints, and between them they are the answer to the second half of the
 * day's task: *"verify CDN cache invalidation fires precisely on save — no stale
 * branding ever served."*
 *
 * Verification needs somewhere to look. A purge that happens inside a background
 * promise, logs to stdout and leaves no trace is a purge nobody can confirm
 * happened — and "I saved it and nothing changed" is the single least
 * debuggable support ticket in a white-label product, because six independent
 * things could be wrong and none of them are visible from a browser.
 *
 *   - `GET /agencies/me/site/regeneration` — what was purged, when, how many
 *     attempts it took, and whether a renderer and CDN are even configured.
 *   - `POST /agencies/me/site/regeneration` — the "Republish site" button.
 *     Regenerates everything without changing any data.
 *
 * Thin, like Day 1–3's controllers: no rules live here.
 */

import type { Request, Response } from "express";
import { getAgencyBrandContext } from "../services/branding.service";
import {
  REGENERATION_HISTORY_LIMIT,
  getRegenerationCapabilities,
  getRegenerationHistory,
  queueRegeneration,
} from "../services/regeneration.service";
import { REGENERATION_SCOPES } from "../data/staticPages";

/** Dashboard reads: always fresh, as on Day 1–3. */
const PRIVATE_NO_STORE = "private, no-store";

/** Turn a thrown service error into a status + message, with no stack leak. */
function respondWithError(res: Response, err: unknown, route: string): void {
  const status = (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(`[${route}]`, err);
  res.status(status).json({ success: false, message });
}

/**
 * `GET /agencies/me/site/regeneration` — recent publishes for this agency.
 *
 * `capabilities` is the part that saves the support ticket. When an agency
 * reports "my logo didn't update", the first question is always whether the
 * platform is wired to a renderer and a CDN at all — and on a staging
 * environment, or a fresh production deploy where one environment variable was
 * missed, the answer is no. Reading that off an API response takes a second;
 * inferring it from an absence of purges takes an afternoon.
 *
 * The receipts also make the pipeline legible with **no CDN configured at all**:
 * `targets` is computed from the data, not from any response, so a developer on
 * a laptop can see the exact URLs and tags a real deploy would purge. That is
 * what makes this feature testable before it is deployable.
 */
export async function getMyRegenerations(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = req.agencyId as string;
    if (!agencyId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    // Clamped rather than trusted: `?limit=1000000` on an in-memory list is not
    // dangerous, but a route that accepts any number teaches clients to send any
    // number, and one day the list is not in memory.
    const requested = Number(req.query.limit);
    const limit =
      Number.isFinite(requested) && requested > 0
        ? Math.min(Math.floor(requested), REGENERATION_HISTORY_LIMIT)
        : REGENERATION_HISTORY_LIMIT;

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({
      success: true,
      data: {
        capabilities: getRegenerationCapabilities(),
        history: getRegenerationHistory(agencyId, limit),
      },
    });
  } catch (err) {
    respondWithError(res, err, "GET /agencies/me/site/regeneration");
  }
}

/**
 * `POST /agencies/me/site/regeneration` — republish the whole site.
 *
 * Every scope at once, because the button exists for the case where the agency
 * does not know what is stale — it just knows the site looks wrong. Making it
 * choose "branding or navigation?" would be asking the person with the least
 * information to make the diagnosis.
 *
 * **Nothing is written.** This is a POST rather than a GET because it has a side
 * effect (it makes the platform do work), not because it changes data, and that
 * distinction is why it is safe to press twice: two republishes produce the same
 * site, and the coalescing in `regeneration.service.ts` means an impatient
 * double-click costs one pipeline, not two.
 *
 * It sits behind `checkAgencyStatus` like the Day 1–3 writes: a LOCKED agency's
 * public site is not being served (Backend Guide §6), so republishing it is
 * work with no possible effect.
 */
export async function postMyRegeneration(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = req.agencyId as string;
    if (!agencyId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    // Reuses Day 1's context loader — it is the one place a missing agency turns
    // into a 404, and the one place the slug and mapped domain are read.
    const agency = await getAgencyBrandContext(agencyId);

    const regeneration = queueRegeneration({
      agencyId,
      slug: agency.slug,
      customDomain: agency.customDomain,
      scopes: REGENERATION_SCOPES,
      // No `version`: nothing was saved, so there is no row timestamp to
      // publish. The receipt falls back to "now", which is exactly right for a
      // republish — it is newer than every save that came before it.
    });

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    // 202 Accepted, not 200 OK: the work is queued, not finished. A 200 would
    // promise the caller that the site is already rebuilt, which is a promise
    // this endpoint deliberately does not make — it returns before the first
    // HTTP call to the CDN is even sent.
    res.status(202).json({
      success: true,
      message: "Site republish queued",
      regeneration,
    });
  } catch (err) {
    respondWithError(res, err, "POST /agencies/me/site/regeneration");
  }
}
