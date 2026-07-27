import { Router } from "express";
import { assignGuideToBranch, assignPackageBranches, assignStaffToBranch, createBranch, getAgencyBranches, getBranchReportController, getConsolidatedFinanceController, updateBranch } from "src/controllers/branches.controller";
import { authenticateWithRefreshToken } from "src/middleware/refreshTokenAuthentication";

const router = Router();

router.route('/agencies/me/branches')
    .get(authenticateWithRefreshToken, getAgencyBranches)
    .post(createBranch);

router.route('/agencies/me/branches/:id')
    .patch(updateBranch);

router.route('/agencies/me/staff/:id/branch')
    .patch(authenticateWithRefreshToken, assignStaffToBranch);

router.route('/guides/:id/branch')
    .patch(authenticateWithRefreshToken, assignGuideToBranch);

router.route('/packages/:id/branches')
    .patch(authenticateWithRefreshToken, assignPackageBranches);

router.route('/agencies/me/branches/:id/report')
    .get(authenticateWithRefreshToken, getBranchReportController);

router.route('/agencies/me/finance/consolidated')
    .get(authenticateWithRefreshToken, getConsolidatedFinanceController);

export default router;