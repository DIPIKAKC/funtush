import express from "express";
import {
  submitInquiryController,
  verifyInquiryOtpController,
  getAgencyBookingsController,
  acceptBookingController,
  rejectBookingController,
  proposeDateController,
} from "../controllers/booking.controller";
import { requireAuth, requireRole } from "@funtush/auth";

const router = express.Router();

// Public — trekker inquiry

// /bookings/inquiry
router.post("/inquiry", submitInquiryController);
// /bookings/inquiry/verify-otp
router.post("/inquiry/verify-otp", verifyInquiryOtpController);

// Agency — protected

// /agencies/me/bookings
router.get("/", requireAuth, requireRole(["AGENCY_ADMIN"]), getAgencyBookingsController);
// /agencies/me/bookings/:id/accept
router.patch("/:id/accept", requireAuth, requireRole(["AGENCY_ADMIN"]), acceptBookingController);
// /agencies/me/bookings/:id/reject
router.patch("/:id/reject", requireAuth, requireRole(["AGENCY_ADMIN"]), rejectBookingController);
// /agencies/me/bookings/:id/propose-date
router.patch("/:id/propose-date", requireAuth, requireRole(["AGENCY_ADMIN"]), proposeDateController);

export default router;