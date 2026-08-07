import { Router } from "express";
import { requireApiKey } from "../middleware/apiKeyAuth.middleware";
import { publicApiRateLimit } from "../middleware/publicApiRateLimit.middleware";
import { listPublicPackagesController, listPublicBookingsController } from "../controllers/publicApi.controller";

const router = Router();

router.get("/packages", requireApiKey, publicApiRateLimit, listPublicPackagesController);
router.get("/bookings", requireApiKey, publicApiRateLimit, listPublicBookingsController);

export default router;