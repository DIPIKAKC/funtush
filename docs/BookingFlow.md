Booking Flow
Branch: `feature/ps/booking-flow`
End-to-end trekker booking flow: inquiry → OTP verification → agency response → payment webhook → confirmation.
---
Database Schema
Prisma models in `packages/database/prisma/schema.prisma`:
`Booking` — `id`, `agencyId`, `trekkerId`, `packageId`, `departureDateId`, `groupSize`, `totalPrice`, `status`, trekker contact fields, `assignedGuideId`, `rejectionReason`, `proposedDate`
`BookingAddOn` — `bookingId`, `addOnId`, `quantity`, `priceAtBooking` (price snapshot at time of booking)
`PaymentLink` — `id`, `bookingId`, `urlToken`, `amount`, `expiresAt`, `used`
`BookingStatus` enum — `INQUIRY → PENDING → CONFIRMED → PAYMENT_PENDING → PAID → ACTIVE → COMPLETED → CANCELLED` (plus `REJECTED`, `ALTERNATIVE_PROPOSED`)
---
Inquiry Submission
`POST /bookings/inquiry`
Trekker submits package, departure date, group size, add-ons, and contact details.
Validates package is `PUBLISHED` and agency is active
Validates departure date availability and slot capacity
Calculates `totalPrice` (base price + add-ons, with per-person multipliers)
Generates 6-digit OTP, stores inquiry data + OTP in Redis (15-min TTL)
Sends OTP to trekker's email
`POST /bookings/inquiry/verify-otp`
Validates OTP against Redis
Re-checks slot availability (in case it changed during the OTP window)
Creates `Booking` (status `INQUIRY`) + `BookingAddOn` rows
Sends trekker confirmation email ("Your inquiry has been submitted")
Sends agency alert email + in-app notification ("New Inquiry from...")
Clears Redis OTP/session data
Implementation: `apps/api/src/services/booking.service.ts` (`submitInquiry`, `verifyInquiryOtp`)
---
Agency Response
`GET /bookings?status={INQUIRY|CONFIRMED|ACTIVE|COMPLETED}`
Agency admin — paginated list of bookings filtered by status.
`PATCH /bookings/:id/accept`
Requires booking status `INQUIRY`
Atomic transaction:
`confirmSlotsForBooking` — increments `departureDate.bookedSlots` by `groupSize`, flips to `FULL` if sold out (re-validates capacity to prevent overbooking races)
Booking status → `CONFIRMED`
Creates `PaymentLink` with 48-hour `expiresAt`
Sends trekker email with payment link + push notification
`PATCH /bookings/:id/reject`
Requires status `INQUIRY` or `CONFIRMED`, requires `reason`
Booking status → `REJECTED`, `rejectionReason` saved
Sends trekker email + push notification
`PATCH /bookings/:id/propose-date`
Requires status `INQUIRY`
Booking status → `ALTERNATIVE_PROPOSED`, `proposedDate` saved
Sends trekker email + push notification
> Note: accept / reject / propose-date are mutually exclusive agency actions — there is no automatic chaining between them.
Implementation: `apps/api/src/services/booking.service.ts` (`getAgencyBookings`, `acceptBooking`, `rejectBooking`, `proposeAlternativeDate`)
Slot logic: `apps/api/src/services/departureDate.service.ts` (`confirmSlotsForBooking`)
---
Payment Webhook
`POST /webhooks/payment/:agencyId/{stripe|khalti|esewa|connectips}`
Per-gateway signature verification, then shared processing via `processConfirmedPayment()`.
Load booking with package, itinerary, agency, add-ons, payment link
Idempotency check — if already `PAID`, return early (safe for webhook retries)
Verify `amountPaid` matches `booking.totalPrice` (±0.01 tolerance)
Atomic transaction:
Booking status → `PAID`
`PaymentLink.used` → `true`
(slot count is not re-incremented here — already incremented at accept time)
Generate personalized booking confirmation PDF
Send trekker confirmation email with PDF attached
Send guide assignment email (stubbed — pending `Guide` model)
Gateway-specific notes
Stripe — raw body + `stripe-signature` header HMAC verification. Webhook router mounted before `express.json()`.
Khalti — server-side lookup via `pidx` against Khalti's epayment lookup API.
eSewa — base64-encoded JSON payload, HMAC-SHA256 signature over `signed_field_names`.
ConnectIPS — HMAC-SHA256 signature over a fixed field-order message string.
Implementation:
`apps/api/src/routes/payment.webhook.routes.ts` — per-gateway routes + signature checks
`apps/api/src/services/payment.service.ts` — `processConfirmedPayment`
`apps/api/src/lib/verifySignature.ts` — signature verification helpers
`apps/api/src/lib/generatePDF.ts` — booking confirmation PDF (pdfkit)
`apps/api/src/utils/email.ts` — `sendBookingConfirmationEmail`, `sendGuideAssignmentEmail`
Known TODO
Guide auto-assignment logic is stubbed in `processConfirmedPayment` pending a `Guide` Prisma model. `assignedGuideId` currently passes through whatever was already on the booking (typically `null`).
---
Testing
All flows tested end-to-end via Postman + a temporary direct-call script (`apps/api/src/test/testwebhook.ts`, calls `processConfirmedPayment` directly to bypass the need for real gateway credentials).
Flow	Status
Inquiry → OTP → INQUIRY
Agency accept → CONFIRMED + payment link
Reject → REJECTED + email
Propose-date → ALTERNATIVE_PROPOSED + email	
Webhook → PAID, idempotent, amount-verified	
Slot count correctness (no double-count)	
Confirmation email + PDF attachment	
Payment link expiry = 48h (verified via DB)	
Bugs found & fixed during testing
Slot double-counting — `processConfirmedPayment` was incrementing `bookedSlots` again on payment, even though `confirmSlotsForBooking` already does this at accept time. Fixed by removing the redundant increment from the webhook handler.
Email auth failure (`Missing credentials for "PLAIN"`) — Gmail App Password was missing/invalid in `.env`. Fixed by generating a new App Password (requires 2FA enabled on the Google account).
---
Open Items / Next Steps
`GET /pay/:token` — the actual payment page endpoint trekkers land on from the email link. Not built yet; `PaymentLink` data (token, amount, expiry, used flag) is already correct and ready to be consumed by this endpoint.
Guide model + auto-assignment — required for the guide assignment step in the payment webhook to function.
---
Environment Variables
```dotenv
# packages/database/.env
DATABASE_URL=postgresql://user:pass@localhost:5432/funtush?schema=public

# apps/api/.env
APP_URL=http://localhost:4000
EMAIL_USER=
EMAIL_PASS=    # Gmail App Password (requires 2FA enabled)

# Payment gateways
STRIPE_WEBHOOK_SECRET=
KHALTI_SECRET_KEY=
ESEWA_SECRET_KEY=
CONNECTIPS_SECRET_KEY=
CONNECTIPS_MERCHANT_ID=
CONNECTIPS_APP_ID=
CONNECTIPS_APP_NAME=
```
---
Useful Commands
```powershell
# Run dev server
pnpm run dev

# Run migrations
pnpm --filter @funtush/database db:migrate

# Seed test data (test agency, package, departure date, itinerary)
pnpm --filter @funtush/database db:seed

# Open Prisma Studio
pnpm --filter @funtush/database db:studio

# Run tests / lint across monorepo
pnpm test
pnpm lint
```