import { Router } from "express";
import { requireAdmin } from "../../middleware/requireAdmin.middleware.js";
import dashboardRouter from "./dashboard.route.js";
import agenciesRouter  from "./agencies.route.js";

const router = Router();


router.use(requireAdmin);

router.use("/dashboard", dashboardRouter);
router.use("/agencies",  agenciesRouter);

export default router;
