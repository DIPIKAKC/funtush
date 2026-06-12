import { Router } from "express";
import { getAgencyCustomers } from "src/controllers/agencyCustomer.controller.js";

const router = Router();

router.route('/agencies/me/customers')
    .get(getAgencyCustomers);

export default router;