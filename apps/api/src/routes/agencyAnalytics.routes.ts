import express from "express";
import {
  getAgencyMarketplacePerformance,
  getAgencyMarketplaceConversionsData,
  getTopMarketplaceAgencies,
  requireAgencyAuth,
} from "../controllers/agencyAnalytics.controller.js";
import { authenticateWithRefreshToken} from "../middleware/refreshTokenAuthentication.js";

const router = express.Router();


router.get(
  "/agencies/me/marketplace/impressions",
  authenticateWithRefreshToken,
  requireAgencyAuth,
  getAgencyMarketplacePerformance
);


//  GET /agencies/me/marketplace/conversions?window_hours=24
router.get(
  "/agencies/me/marketplace/conversions",
  authenticateWithRefreshToken,
  requireAgencyAuth,
  getAgencyMarketplaceConversionsData
);

//  Admin dashboards 

router.get(
  "/admin/marketplace/top-agencies",
  authenticateWithRefreshToken,
  getTopMarketplaceAgencies
);

export default router;