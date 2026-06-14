## Booking Flow

End-to-end trekker booking flow: inquiry → OTP verification → agency response → payment webhook → confirmation.

---

### 1. Booking Inquiry Flow

#### 1.1 Submit Inquiry
**`POST /bookings/inquiry`**

Trekker submits package, departure date, group size, add-ons, and contact details.

**Validation**
- Package must be `PUBLISHED` and agency must be active
- Departure date availability and slot capacity must be confirmed

**Processing**
- Calculate `totalPrice` (base price + add-ons, with per-person multipliers)
- Generate 6-digit OTP
- Store inquiry data + OTP in Redis (15-min TTL)
- Send OTP to trekker's email

#### 1.2 Verify OTP
**`POST /bookings/inquiry/verify-otp`**

**Validation**
- Validate OTP against Redis
- Re-check slot availability (in case it changed during the OTP window)

**Processing**
- Create `Booking` (status `INQUIRY`) + `BookingAddOn` rows
- Send trekker confirmation email ("Your inquiry has been submitted")
- Send agency alert email + in-app notification ("New Inquiry from...")
- Clear Redis OTP/session data

#### Implementation
- `apps/api/src/services/booking.service.ts` → `submitInquiry`, `verifyInquiryOtp`

---

### 2. Agency Response

#### 2.1 List Bookings
**`GET /bookings?status={INQUIRY|CONFIRMED|ACTIVE|COMPLETED}`**

Agency admin — paginated list of bookings filtered by status.

#### 2.2 Accept Booking
**`PATCH /bookings/:id/accept`**

- Requires booking status `INQUIRY`

**Atomic transaction**
- `confirmSlotsForBooking` — increments `departureDate.bookedSlots` by `groupSize`, flips to `FULL` if sold out (re-validates capacity to prevent overbooking races)
- Booking status → `CONFIRMED`
- Creates `PaymentLink` with 48-hour `expiresAt`
- Sends trekker email with payment link + push notification

#### 2.3 Reject Booking
**`PATCH /bookings/:id/reject`**

- Requires status `INQUIRY` or `CONFIRMED`, requires `reason`
- Booking status → `REJECTED`, `rejectionReason` saved
- Sends trekker email + push notification

#### 2.4 Propose Alternative Date
**`PATCH /bookings/:id/propose-date`**

- Requires status `INQUIRY`
- Booking status → `ALTERNATIVE_PROPOSED`, `proposedDate` saved
- Sends trekker email + push notification

> **Note:** accept / reject / propose-date are mutually exclusive agency actions — there is no automatic chaining between them.

#### Implementation
- `apps/api/src/services/booking.service.ts` → `getAgencyBookings`, `acceptBooking`, `rejectBooking`, `proposeAlternativeDate`
- Slot logic: `apps/api/src/services/departureDate.service.ts` → `confirmSlotsForBooking`

---

### 3. Payment Webhook

#### 3.1 Webhook Endpoint
**`POST /webhooks/payment/:agencyId/{stripe|khalti|esewa|connectips}`**

Per-gateway signature verification, then shared processing via `processConfirmedPayment()`.

**Processing steps**
- Load booking with package, itinerary, agency, add-ons, payment link
- Idempotency check — if already `PAID`, return early (safe for webhook retries)
- Verify `amountPaid` matches `booking.totalPrice` (±0.01 tolerance)

**Atomic transaction**
- Booking status → `PAID`
- `PaymentLink.used` → `true`
- (slot count is not re-incremented here — already incremented at accept time)

**Post-transaction**
- Generate personalized booking confirmation PDF
- Send trekker confirmation email with PDF attached
- Send guide assignment email (stubbed — pending `Guide` model)

#### Implementation
- `apps/api/src/routes/payment.webhook.routes.ts` — per-gateway routes + signature checks
- `apps/api/src/services/payment.service.ts` → `processConfirmedPayment`
- `apps/api/src/lib/verifySignature.ts` — signature verification helpers
- `apps/api/src/lib/generatePDF.ts` — booking confirmation PDF (pdfkit)
- `apps/api/src/utils/email.ts` → `sendBookingConfirmationEmail`, `sendGuideAssignmentEmail`

---

### 4. Testing Summary

| Method | URL | What Was Tested | Outcome |
|---|---|---|---|
| `POST` | `/bookings/inquiry` | Submit inquiry → OTP generation/storage | Pass |
| `POST` | `/bookings/inquiry/verify-otp` | OTP verification → `Booking` created with status `INQUIRY` | Pass |
| `GET` | `/bookings?status=INQUIRY` | Agency fetches paginated bookings by status | Pass |
| `PATCH` | `/bookings/:id/accept` | Accept → status `CONFIRMED`, slot incremented, `PaymentLink` created (48h expiry), checked via Prisma Studio | Pass |
| `PATCH` | `/bookings/:id/reject` | Reject with reason → status `REJECTED` + email sent | Pass |
| `PATCH` | `/bookings/:id/propose-date` | Propose date → status `ALTERNATIVE_PROPOSED` + email sent | Pass |
| `POST` (direct call via `testwebhook.ts`) | `processConfirmedPayment` | Simulated payment → status `PAID`, idempotency check, amount verification, slot count correctness, PDF confirmation email | Pass |

### 5. Environment Variables

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

### 6. Useful Commands

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
