/**
 * Tests the main booking workflow, including payment, cancellation,
 * guide assignment, check-in/check-out, and slot handling.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// Mock Prisma so these tests don't need a real database.
vi.mock("@funtush/database", () => {
    const booking = {
        findUnique: vi.fn(),
        update: vi.fn(),
    };
    const paymentLink = {
        findUnique: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
    };
    const trekDepartureDate = {
        findUnique: vi.fn(),
        update: vi.fn(),
    };
    const guideProfile = {
        findUnique: vi.fn(),
    };
    const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ booking, paymentLink, trekDepartureDate, guideProfile })
    );

    return {
        prisma: { booking, paymentLink, trekDepartureDate, guideProfile, $transaction },
        BookingStatus: {
            INQUIRY: "INQUIRY",
            CONFIRMED: "CONFIRMED",
            PAYMENT_PENDING: "PAYMENT_PENDING",
            REJECTED: "REJECTED",
            ALTERNATIVE_PROPOSED: "ALTERNATIVE_PROPOSED",
            PAID: "PAID",
            ACTIVE: "ACTIVE",
            COMPLETED: "COMPLETED",
            CANCELLED: "CANCELLED",
        },
    };
});

// Mock notifications, emails, and PDF generation to keep the tests focused on the service logic.
// Path must match the exact specifier booking.service.ts / payment.service.ts use to
// import notification.service.ts (the dotted FCM-push file, imported with a .js extension).
vi.mock("../../services/notification.service.js", () => ({
    notifyTrekker: vi.fn(),
    notifyAgencyAdmins: vi.fn(),
}));
vi.mock("../../lib/generatePDF", () => ({
    generateBookingConfirmationPDF: vi.fn(async () => Buffer.from("pdf")),
}));
vi.mock("../../utils/email", () => ({
    sendBookingAcceptedEmail: vi.fn(),
    sendBookingRejectedEmail: vi.fn(),
    sendBookingConfirmationEmail: vi.fn(),
    sendGuideAssignmentEmail: vi.fn(),
    sendAlternativeDateEmail: vi.fn(),
    sendInquiryConfirmationEmail: vi.fn(),
    sendAgencyInquiryAlertEmail: vi.fn(),
    sendOtpEmail: vi.fn(),
}));

import { prisma } from "@funtush/database";
import {
    acceptBooking,
    rejectBooking,
    confirmBooking,
    cancelBooking,
    getBookingById,
    assignGuide,
    checkInBooking,
    checkOutBooking,
} from "../../services/booking.service";

import { processConfirmedPayment, expireUnpaidBookings } from "../../services/payment.service";
import { releaseSlotsForBooking } from "../../services/departureDate.service";

type ReleaseSlotsTx = Parameters<typeof releaseSlotsForBooking>[0];

const AGENCY_ID = "agency-1";
const BOOKING_ID = "booking-1";
const DEPARTURE_ID = "departure-1";

function baseBooking(overrides: Record<string, unknown> = {}) {
    return {
        id: BOOKING_ID,
        agencyId: AGENCY_ID,
        departureDateId: DEPARTURE_ID,
        groupSize: 2,
        status: "INQUIRY",
        totalPrice: 1000,
        trekkerId: "trekker-1",
        trekkerEmail: "t@example.com",
        trekkerName: "Trekker",
        assignedGuideId: null,
        package: { title: "Everest Panorama Short Trek" },
        paymentLink: null,
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("acceptBooking", () => {
    it("moves INQUIRY -> PAYMENT_PENDING and creates a payment link", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking());
        (prisma.trekDepartureDate.findUnique as Mock).mockResolvedValue({
            id: DEPARTURE_ID,
            maxSlots: 10,
            bookedSlots: 0,
            status: "AVAILABLE",
        });

        const result = await acceptBooking(BOOKING_ID, AGENCY_ID);

        expect(result.status).toBe("PAYMENT_PENDING");
        expect(prisma.paymentLink.create).toHaveBeenCalled();
        expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("rejects if booking is not in INQUIRY state", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "CONFIRMED" }));

        await expect(acceptBooking(BOOKING_ID, AGENCY_ID)).rejects.toThrow(/INQUIRY/);
    });

    it("rejects if agency does not own the booking", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ agencyId: "other-agency" }));

        await expect(acceptBooking(BOOKING_ID, AGENCY_ID)).rejects.toThrow(/Unauthorized/);
    });
});

describe("processConfirmedPayment", () => {
    it("moves PAYMENT_PENDING -> PAID when amount matches", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(
            baseBooking({
                status: "PAYMENT_PENDING",
                paymentLink: { used: false },
                agency: { profile: null, name: "Agency", email: "a@example.com" },
                departureDate: { startDate: new Date() },
                package: { title: "Trek", durationDays: 10, itineraries: [] },
                addOns: [],
            })
        );

        await expect(processConfirmedPayment(BOOKING_ID, AGENCY_ID, 1000)).resolves.toBeUndefined();
        expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("throws on amount mismatch", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(
            baseBooking({
                status: "PAYMENT_PENDING",
                paymentLink: { used: false },
                agency: { profile: null, name: "Agency", email: "a@example.com" },
                departureDate: { startDate: new Date() },
                package: { title: "Trek", durationDays: 10, itineraries: [] },
                addOns: [],
            })
        );

        await expect(processConfirmedPayment(BOOKING_ID, AGENCY_ID, 500)).rejects.toThrow(/Amount mismatch/);
    });

    it("is idempotent — no-ops if payment link already used", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(
            baseBooking({ status: "PAID", paymentLink: { used: true } })
        );

        await expect(processConfirmedPayment(BOOKING_ID, AGENCY_ID, 1000)).resolves.toBeUndefined();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("throws if booking is not PAYMENT_PENDING", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(
            baseBooking({ status: "CONFIRMED", paymentLink: { used: false } })
        );

        await expect(processConfirmedPayment(BOOKING_ID, AGENCY_ID, 1000)).rejects.toThrow(/not awaiting payment/);
    });

    it("throws on agency mismatch", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(
            baseBooking({ agencyId: "other-agency", status: "PAYMENT_PENDING", paymentLink: { used: false } })
        );

        await expect(processConfirmedPayment(BOOKING_ID, AGENCY_ID, 1000)).rejects.toThrow(/Agency mismatch/);
    });
});

describe("confirmBooking", () => {
    it("moves PAID -> CONFIRMED", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "PAID" }));

        const result = await confirmBooking(BOOKING_ID, AGENCY_ID);

        expect(result.status).toBe("CONFIRMED");
    });

    it("rejects if booking is not PAID", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "PAYMENT_PENDING" }));

        await expect(confirmBooking(BOOKING_ID, AGENCY_ID)).rejects.toThrow(/PAID state/);
    });
});

describe("rejectBooking", () => {
    it("rejects an INQUIRY booking with a reason", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "INQUIRY" }));

        const result = await rejectBooking(BOOKING_ID, AGENCY_ID, "Not available");

        expect(result.status).toBe("REJECTED");
    });

    it("throws without a reason", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "INQUIRY" }));

        await expect(rejectBooking(BOOKING_ID, AGENCY_ID, "")).rejects.toThrow(/reason is required/);
    });

    it("throws if booking is CONFIRMED (no longer allowed post-fix)", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "CONFIRMED" }));

        await expect(rejectBooking(BOOKING_ID, AGENCY_ID, "reason")).rejects.toThrow(/cannot be rejected/);
    });
});

describe("cancelBooking", () => {
    it.each(["PAYMENT_PENDING", "PAID", "CONFIRMED", "ACTIVE"])(
        "cancels a booking in %s state and releases slots",
        async (status) => {
            (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status }));
            (prisma.trekDepartureDate.findUnique as Mock).mockResolvedValue({
                id: DEPARTURE_ID,
                maxSlots: 10,
                bookedSlots: 2,
                status: "AVAILABLE",
            });

            const result = await cancelBooking(BOOKING_ID, AGENCY_ID, "Customer request");

            expect(result.status).toBe("CANCELLED");
        }
    );

    it("throws for a non-cancellable state", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "INQUIRY" }));

        await expect(cancelBooking(BOOKING_ID, AGENCY_ID, "reason")).rejects.toThrow(/cannot be cancelled/);
    });

    it("throws without a reason", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "CONFIRMED" }));

        await expect(cancelBooking(BOOKING_ID, AGENCY_ID, "")).rejects.toThrow(/reason is required/);
    });
});

describe("expireUnpaidBookings", () => {
    it("cancels and releases slots for expired unpaid links", async () => {
        (prisma.paymentLink.findMany as Mock).mockResolvedValue([
            {
                id: "link-1",
                bookingId: BOOKING_ID,
                used: false,
                expiresAt: new Date(Date.now() - 1000),
                booking: baseBooking({ status: "PAYMENT_PENDING" }),
            },
        ]);
        (prisma.trekDepartureDate.findUnique as Mock).mockResolvedValue({
            id: DEPARTURE_ID,
            maxSlots: 10,
            bookedSlots: 2,
            status: "AVAILABLE",
        });

        await expireUnpaidBookings();

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("skips links whose booking already moved past PAYMENT_PENDING", async () => {
        (prisma.paymentLink.findMany as Mock).mockResolvedValue([
            {
                id: "link-1",
                bookingId: BOOKING_ID,
                used: false,
                expiresAt: new Date(Date.now() - 1000),
                booking: baseBooking({ status: "CONFIRMED" }),
            },
        ]);

        await expireUnpaidBookings();

        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
});

describe("getBookingById", () => {
    it("returns the booking when the agency owns it", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking());

        const result = await getBookingById(BOOKING_ID, AGENCY_ID);

        expect(result.id).toBe(BOOKING_ID);
    });

    it("throws not found on agency mismatch (does not leak existence)", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ agencyId: "other-agency" }));

        await expect(getBookingById(BOOKING_ID, AGENCY_ID)).rejects.toThrow(/not found/);
    });

    it("throws not found when booking does not exist", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(null);

        await expect(getBookingById(BOOKING_ID, AGENCY_ID)).rejects.toThrow(/not found/);
    });
});

describe("assignGuide", () => {
    it("assigns an active guide to a CONFIRMED booking", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "CONFIRMED" }));
        (prisma.guideProfile.findUnique as Mock).mockResolvedValue({
            agencyId: AGENCY_ID,
            guideRef: "guide-1",
            isActive: true,
        });

        const result = await assignGuide(BOOKING_ID, AGENCY_ID, "guide-1");

        expect(result.assignedGuideId).toBe("guide-1");
    });

    it("throws if booking is not CONFIRMED", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "PAID" }));

        await expect(assignGuide(BOOKING_ID, AGENCY_ID, "guide-1")).rejects.toThrow(/must be CONFIRMED/);
    });

    it("throws if guide is inactive or not found", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "CONFIRMED" }));
        (prisma.guideProfile.findUnique as Mock).mockResolvedValue(null);

        await expect(assignGuide(BOOKING_ID, AGENCY_ID, "ghost-guide")).rejects.toThrow(/not found or inactive/);
    });
});

describe("checkInBooking", () => {
    it("moves CONFIRMED -> ACTIVE when a guide is assigned", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(
            baseBooking({ status: "CONFIRMED", assignedGuideId: "guide-1" })
        );

        const result = await checkInBooking(BOOKING_ID, AGENCY_ID);

        expect(result.status).toBe("ACTIVE");
    });

    it("throws if no guide is assigned yet", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(
            baseBooking({ status: "CONFIRMED", assignedGuideId: null })
        );

        await expect(checkInBooking(BOOKING_ID, AGENCY_ID)).rejects.toThrow(/Assign a guide/);
    });

    it("throws if booking is not CONFIRMED", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(
            baseBooking({ status: "ACTIVE", assignedGuideId: "guide-1" })
        );

        await expect(checkInBooking(BOOKING_ID, AGENCY_ID)).rejects.toThrow(/must be CONFIRMED/);
    });
});

describe("checkOutBooking", () => {
    it("moves ACTIVE -> COMPLETED", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "ACTIVE" }));

        const result = await checkOutBooking(BOOKING_ID, AGENCY_ID);

        expect(result.status).toBe("COMPLETED");
    });

    it("throws if booking is not ACTIVE", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "CONFIRMED" }));

        await expect(checkOutBooking(BOOKING_ID, AGENCY_ID)).rejects.toThrow(/must be ACTIVE/);
    });
});

describe("releaseSlotsForBooking (direct)", () => {
    it("decrements bookedSlots and flips FULL -> AVAILABLE when capacity opens", async () => {
        const tx = {
            trekDepartureDate: {
                findUnique: vi.fn().mockResolvedValue({
                    id: DEPARTURE_ID,
                    maxSlots: 5,
                    bookedSlots: 5,
                    status: "FULL",
                }),
                update: vi.fn().mockResolvedValue({}),
            },
        } as unknown as ReleaseSlotsTx;

        await releaseSlotsForBooking(tx, DEPARTURE_ID, 2);

        expect(tx.trekDepartureDate.update).toHaveBeenCalledWith({
            where: { id: DEPARTURE_ID },
            data: { bookedSlots: 3, status: "AVAILABLE" },
        });
    });

    it("never drops bookedSlots below zero", async () => {
        const tx = {
            trekDepartureDate: {
                findUnique: vi.fn().mockResolvedValue({
                    id: DEPARTURE_ID,
                    maxSlots: 5,
                    bookedSlots: 1,
                    status: "AVAILABLE",
                }),
                update: vi.fn().mockResolvedValue({}),
            },
        } as unknown as ReleaseSlotsTx;

        await releaseSlotsForBooking(tx, DEPARTURE_ID, 5);

        expect(tx.trekDepartureDate.update).toHaveBeenCalledWith({
            where: { id: DEPARTURE_ID },
            data: { bookedSlots: 0, status: "AVAILABLE" },
        });
    });
});