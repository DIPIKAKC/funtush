/**
 * TEMPORARY TEST SCRIPT — Day 5 Testing
 *
 * Simulates what happens AFTER a real payment gateway webhook verifies its
 * signature and calls processConfirmedPayment(). This lets us test:
 *   - amount verification
 *   - booking status → PAID
 *   - payment link marked used
 *   - PDF generation
 *   - confirmation email sent
 *
 * USAGE:
 *   1. Edit BOOKING_ID, AGENCY_ID, AMOUNT_PAID below to match your test data
 *   2. Run: pnpm tsx test-webhook.ts   (from apps/api directory)
 *   3. Delete this file once testing is done
 */

import { processConfirmedPayment } from "../services/payment.service";
import { prisma } from "@funtush/database";

const BOOKING_ID = "99f32a55-28a1-46cb-b2ae-b713f87c5008";
const AGENCY_ID = "88c02ac1-f3f4-4b4e-a354-cdfccd68584b";
const AMOUNT_PAID = 1200;

async function main() {
  console.log("── BEFORE ──────────────────────────────");
  const before = await prisma.booking.findUnique({
    where: { id: BOOKING_ID },
    include: { paymentLink: true, departureDate: true },
  });
  console.log("Booking status:", before?.status);
  console.log("Payment link used:", before?.paymentLink?.used);
  console.log("Departure bookedSlots:", before?.departureDate.bookedSlots);
  console.log("Booking totalPrice:", before?.totalPrice.toString());

  console.log("\n── RUNNING processConfirmedPayment ──────");
  await processConfirmedPayment(BOOKING_ID, AGENCY_ID, AMOUNT_PAID);
  console.log("Done — no errors thrown.");

  console.log("\n── AFTER ───────────────────────────────");
  const after = await prisma.booking.findUnique({
    where: { id: BOOKING_ID },
    include: { paymentLink: true, departureDate: true },
  });
  console.log("Booking status:", after?.status);
  console.log("Payment link used:", after?.paymentLink?.used);
  console.log("Departure bookedSlots:", after?.departureDate.bookedSlots);
  console.log("\nCheck your email for the booking confirmation with PDF attached.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("ERROR:", e);
    await prisma.$disconnect();
    process.exit(1);
  });

