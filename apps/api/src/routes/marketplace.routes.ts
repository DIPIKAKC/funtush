import express from "express";
import {
  searchMarketplace,
  getAgencies,
  getAgency,
  getDestinations,
  getDestination,
} from "../controllers/marketplace.controller.js";

/**
 * Public marketplace routes (Week 3 · Day 2).
 *
 * No auth middleware: the marketplace is open to the public. The controller
 * still *optionally* reads a Bearer token to personalize results for logged-in
 * trekkers, but a request without one is perfectly valid.
 */
const router = express.Router();

// GET /marketplace/packages            → all published packages, ranked by visibility score
// GET /marketplace/packages?q=everest&difficulty=moderate&price_max=1500 → full-text + filters
router.get("/packages", searchMarketplace);

// ── Agency directory (Day 3) ────────────────────────────────────────────────
// GET /marketplace/agencies            → all agencies with tier, rating, top destination tags
// GET /marketplace/agencies/:slug      → public agency profile (packages, reviews, badges)
router.get("/agencies", getAgencies);
router.get("/agencies/:slug", getAgency);

// ── Destination directory (Day 3) ──────────────────────────────────────────
// GET /marketplace/destinations        → all master destinations with package count
// GET /marketplace/destinations/:slug  → master destination page (agencies operating there)
router.get("/destinations", getDestinations);
router.get("/destinations/:slug", getDestination);

export default router;
