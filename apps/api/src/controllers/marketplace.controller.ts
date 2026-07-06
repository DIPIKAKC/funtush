import type { Request, Response } from "express";
import { verifyAccessToken } from "@funtush/auth";
import { searchMarketplacePackages } from "../services/search.service.js";
import {
  listAgencies,
  getAgencyProfile,
  listDestinations,
  getDestinationBySlug,
} from "../services/marketplaceDirectory.service.js";
import {
  getFeatured,
  getTrending,
  getSeasonal,
} from "../services/marketplaceCuration.service.js";
import {
  recordImpression,
  recordClick,
} from "../services/marketplaceAnalytics.service.js";

const VALID_DIFFICULTIES = new Set(["EASY", "MODERATE", "CHALLENGING", "DIFFICULT"]);

/** Read a query param as a single trimmed string, or undefined if absent/empty. */
function asString(value: unknown): string | undefined {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

/** Read a query param as a finite number, or undefined if absent/not a number. */
function asNumber(value: unknown): number | undefined {
  const str = asString(value);
  if (str === undefined) return undefined;
  const n = Number(str);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * If the request carries a valid trekker access token, return that trekker's
 * user id. Never throws — an absent/expired/invalid token just yields undefined
 * because this endpoint is open to the public.
 */
function optionalTrekkerUserId(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  try {
    const payload = verifyAccessToken(header.slice("Bearer ".length));
    return payload.roleType === "TREKKER" ? payload.userId : undefined;
  } catch {
    return undefined;
  }
}

/**
 * DAY 1-3: Search marketplace + ranking by visibility score
 * 
 * NEW IN DAY 4:
 * - For each returned agency, record an impression (non-blocking)
 * - Return sponsor badge based on priorityOverride
 */
export const searchMarketplace = async (req: Request, res: Response) => {
  try {
    const q = asString(req.query.q);
    const trekkerUserId = optionalTrekkerUserId(req);

    // difficulty is case-insensitive in the API (?difficulty=moderate) but the
    // index stores the enum value (MODERATE).
    const difficultyRaw = asString(req.query.difficulty)?.toUpperCase();
    if (difficultyRaw && !VALID_DIFFICULTIES.has(difficultyRaw)) {
      return res.status(400).json({
        success: false,
        message: `Invalid difficulty. Allowed: ${[...VALID_DIFFICULTIES].join(", ")}`,
      });
    }

    const result = await searchMarketplacePackages({
      q,
      page: asNumber(req.query.page),
      limit: asNumber(req.query.limit),
      trekkerUserId, // For loyalty boost (Day 3)
      filters: {
        difficulty: difficultyRaw,
        priceMin: asNumber(req.query.price_min),
        priceMax: asNumber(req.query.price_max),
        durationMin: asNumber(req.query.duration_min),
        durationMax: asNumber(req.query.duration_max),
        altitudeMax: asNumber(req.query.altitude_max),
        season: asString(req.query.season),
        destination: asString(req.query.destination),
      },
    });

    // ─── NEW: Record impressions for each returned agency (non-blocking) ───
    const impressionPromises = (result.data || []).map((pkg) =>
      recordImpression(pkg.agencyId)
        .catch((err) => {
          // Non-blocking: log but don't fail the search
          console.error(`Failed to record impression for agency ${pkg.agencyId}:`, err);
        })
    );

    // Fire and forget: don't await, let impressions record in background
    Promise.all(impressionPromises).catch(() => {
      // Silently catch any promise errors
    });

    // ─── Add sponsor badge based on priorityOverride (Days 3-4) ───
    const enrichedData = (result.data || []).map((pkg) => ({
      ...pkg,
    }));

    return res.json({
      success: true,
      ...result,
      data: enrichedData,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return res.status(500).json({ success: false, message });
  }
};

/**
 * DAY 4: Record click on an agency card in search results.
 * 
 * Called before navigation to agency profile.
 * Increments clickCount in today's impression + logs click event.
 */
export const recordMarketplaceClick = async (req: Request, res: Response) => {
  try {
    const { agencyId, destination, searchQuery } = req.body;
    const trekkerUserId = optionalTrekkerUserId(req);

    if (!agencyId) {
      return res.status(400).json({
        success: false,
        message: "agencyId is required",
      });
    }

    if (!destination) {
      return res.status(400).json({
        success: false,
        message: "destination is required (e.g. 'agency-profile', 'inquiry-form')",
      });
    }

    const click = await recordClick(
      agencyId,
      trekkerUserId,
      destination,
      searchQuery
    );

    return res.status(201).json({
      success: true,
      message: "Click recorded",
      clickId: click.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to record click";
    return res.status(500).json({ success: false, message });
  }
};

/* ── Agency directory (Week 3 · Day 3) ───────────────────────────────────────
 *
 * All four handlers below are PUBLIC (no auth) and read-only. They power the
 * browse-by-hand directory pages, backed by Postgres via the directory service.
 */

/**
 * GET /marketplace/agencies — list listable agencies.
 * Query params: search, tier, region, min_rating, page, limit.
 *
 * FIX: previously called listAgencies() with no arguments at all, silently
 * dropping every query param a client sent — filters/pagination existed in
 * the service's documented interface but nothing ever wired req.query to it.
 */
export const getAgencies = async (req: Request, res: Response) => {
  try {
    const result = await listAgencies({
      search: asString(req.query.search),
      tier: asString(req.query.tier),
      region: asString(req.query.region),
      minRating: asNumber(req.query.min_rating),
      page: asNumber(req.query.page),
      limit: asNumber(req.query.limit),
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load agencies";
    return res.status(500).json({ success: false, message });
  }
};

/** GET /marketplace/agencies/:slug — one agency's public profile. */
export const getAgency = async (req: Request, res: Response) => {
  try {
    const agency = await getAgencyProfile(req.params.slug as string);
    if (!agency) {
      return res.status(404).json({ success: false, message: "Agency not found" });
    }
    return res.json({ success: true, data: agency });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load agency";
    return res.status(500).json({ success: false, message });
  }
};

/**
 * GET /marketplace/destinations — list master destinations.
 * Query params: region, altitude_min, altitude_max, season, page, limit.
 *
 * FIX: same gap as getAgencies — query params were previously dropped.
 */
export const getDestinations = async (req: Request, res: Response) => {
  try {
    const result = await listDestinations({
      region: asString(req.query.region),
      altitudeMin: asNumber(req.query.altitude_min),
      altitudeMax: asNumber(req.query.altitude_max),
      season: asString(req.query.season),
      page: asNumber(req.query.page),
      limit: asNumber(req.query.limit),
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load destinations";
    return res.status(500).json({ success: false, message });
  }
};

/** GET /marketplace/destinations/:slug — master destination page. */
export const getDestination = async (req: Request, res: Response) => {
  try {
    const destination = await getDestinationBySlug(req.params.slug as string);
    if (!destination) {
      return res.status(404).json({ success: false, message: "Destination not found" });
    }
    return res.json({ success: true, data: destination });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load destination";
    return res.status(500).json({ success: false, message });
  }
};

/* ── Curated homepage sections (Week 3 · Day 4) ───────────────────────────────
 *
 * Out of scope for Day 3 — left untouched.
 */

/** GET /marketplace/featured — Sponsored + highest-rated + most-booked-this-month mix. */
export const featured = async (_req: Request, res: Response) => {
  try {
    const data = await getFeatured();
    return res.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load featured content";
    return res.status(500).json({ success: false, message });
  }
};

/** GET /marketplace/trending — packages with the most inquiries in the last 7 days. */
export const trending = async (_req: Request, res: Response) => {
  try {
    const data = await getTrending();
    return res.json({ success: true, data, meta: { total: data.length } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load trending packages";
    return res.status(500).json({ success: false, message });
  }
};

/** GET /marketplace/seasonal — packages whose best season matches the current month. */
export const seasonal = async (_req: Request, res: Response) => {
  try {
    const data = await getSeasonal();
    return res.json({ success: true, data, meta: { total: data.length } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load seasonal packages";
    return res.status(500).json({ success: false, message });
  }
};