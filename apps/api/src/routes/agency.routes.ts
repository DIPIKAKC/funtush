import express from "express";
import { registerAgency } from "../controllers/agency.controller.js";

const router = express.Router();

router.route("/register")
  .post(registerAgency);

export default router;