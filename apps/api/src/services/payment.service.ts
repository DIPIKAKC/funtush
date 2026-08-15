import { prisma, type Prisma, BookingStatus } from "@funtush/database";
import { generateBookingConfirmationPDF } from "../lib/generatePDF";
import { sendBookingConfirmationEmail, sendGuideAssignmentEmail } from "../utils/email";
import { notifyAgencyAdmins, notifyTrekker } from "./notification.service";
import { releaseSlotsForBooking } from "./departureDate.service";

export async function processConfirmedPayment(
  bookingId: string,
  agencyId: string,
  amountPaid: number
): Promise<void> {

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      package: {
        include: {
          itineraries: { orderBy: { dayNumber: "asc" } },
        },
      },
      departureDate: true,
      agency: {
        include: {
          profile: true,
        },
      },
      addOns: {
        include: { addOn: true },
      },
      paymentLink: true,
    },
  });

  if (!booking) throw new Error(`Booking ${bookingId} not found`);
  if (booking.agencyId !== agencyId) throw new Error("Agency mismatch on booking");

  //  gateways retry webhooks.
  if (booking.paymentLink?.used) return;

  // Only PAYMENT_PENDING bookings can be marked paid — blocks a late/duplicate
  // webhook from overwriting a booking that moved on (CONFIRMED) or died (CANCELLED).
  if (booking.status !== BookingStatus.PAYMENT_PENDING) {
    throw new Error(`Booking ${bookingId} is not awaiting payment`);
  }

  // Reconcile gateway amount against what we actually billed.
  const expectedAmount = Number(booking.totalPrice);
  if (Math.abs(amountPaid - expectedAmount) > 0.01) {
    throw new Error(
      `Amount mismatch: expected ${expectedAmount}, received ${amountPaid}`
    );
  }

  // Guide auto-assignment — stub until the Guide model exists.
  // const guide = await prisma.guide.findFirst({ where: { agencyId, isAutoAssign: true, isAvailable: true } });
  const assignedGuideId: string | null = booking.assignedGuideId ?? null;
  const assignedGuideName: string | null = null;
  const assignedGuidePhone: string | null = null;
  const assignedGuideEmail: string | null = null;

  // Atomic DB update — booking PAID + slot decrement 
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.PAID,
        assignedGuideId,
        updatedAt: new Date(),
      },
    });

    await tx.paymentLink.update({
      where: { bookingId },
      data: { used: true },
    });

  });

  // Generate booking confirmation PDF with all details
  const agencyProfile = booking.agency.profile;

  const pdfBuffer = await generateBookingConfirmationPDF({
    bookingId: booking.id,
    trekkerName: booking.trekkerName,
    trekkerEmail: booking.trekkerEmail,
    trekkerPhone: booking.trekkerPhone,
    packageTitle: booking.package.title,
    agencyName: booking.agency.name,
    agencyEmail: booking.agency.email,
    agencyPhone: agencyProfile?.phone
      ? JSON.stringify(agencyProfile.phone)
      : booking.agency.email,
    departureDate: booking.departureDate.startDate,
    durationDays: booking.package.durationDays,
    groupSize: booking.groupSize,
    totalPrice: Number(booking.totalPrice),
    currency: "USD",
    assignedGuideName,
    assignedGuidePhone,
    paidAt: new Date(),
    addOns: booking.addOns.map((a: typeof booking.addOns[number]) => ({
      name: a.addOn.name,
      quantity: a.quantity,
      price: Number(a.priceAtBooking),
    })),
    itinerary: booking.package.itineraries.map((i: typeof booking.package.itineraries[number]) => ({
      dayNumber: i.dayNumber,
      location: i.location ?? "",
      description: i.description ?? "",
    })),
  });

  // Send confirmation email to trekker with PDF attachment
  await sendBookingConfirmationEmail(
    booking.trekkerEmail,
    booking.trekkerName,
    booking.package.title,
    booking.departureDate.startDate,
    booking.id,
    assignedGuideName,
    pdfBuffer
  );

  // Send assignment notification to guide 
  if (assignedGuideEmail && assignedGuideName) {
    await sendGuideAssignmentEmail(
      assignedGuideEmail,
      assignedGuideName,
      booking.package.title,
      booking.departureDate.startDate,
      booking.trekkerName,
      booking.trekkerPhone,
      booking.trekkerCountry ?? null,
      booking.groupSize,
      booking.id
    );
  }
  
// inform the agency payment is done — agency need to call confirmBooking.
  await notifyAgencyAdmins(agencyId, {
    title: "Payment Received",
    body: `Payment received for ${booking.package.title}. Please confirm the booking.`,
    data: { bookingId, type: "PAYMENT_RECEIVED", link: `/dashboard/bookings/${bookingId}` },
  });
}

// Releases slots + cancels bookings whose 48h payment window expired unpaid.
// Called on a schedule (see jobs/expireUnpaidBookings.job.ts).
export async function expireUnpaidBookings() {
  const expiredLinks = await prisma.paymentLink.findMany({
    where: { used: false, expiresAt: { lt: new Date() } },
    include: { booking: true },
  });

  for (const link of expiredLinks) {
    if (link.booking.status !== "PAYMENT_PENDING") continue;

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await releaseSlotsForBooking(tx, link.booking.departureDateId, link.booking.groupSize);
      await tx.booking.update({
        where: { id: link.bookingId },
        data: { status: "CANCELLED", rejectionReason: "Payment window expired" },
      });
    });

    if (link.booking.trekkerId) {
      await notifyTrekker(link.booking.trekkerId, {
        title: "Booking Expired",
        body: "Your payment window expired and the booking was cancelled.",
        data: { bookingId: link.bookingId, type: "BOOKING_EXPIRED", link: `/bookings/${link.bookingId}` },
      });
    }
  }
}

