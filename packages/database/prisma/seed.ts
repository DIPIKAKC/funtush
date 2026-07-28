import dotenv from "dotenv";

dotenv.config({ path: ".env" });
import bcrypt from "bcryptjs";
import { prisma, UserRole, RoleType } from "@funtush/database";

async function main() {
  const tiers = [
    {
      name: "FREE",
      maxStaff: 1,
      maxGuides: 2,
      monthlyPrice: 0,
      features: { marketplace: false, blog: false, ads: false }
    },
    {
      name: "SMALL",
      maxStaff: 3,
      maxGuides: 5,
      monthlyPrice: 29,
      features: { marketplace: true, blog: false, ads: false }
    },
    {
      name: "MEDIUM",
      maxStaff: 10,
      maxGuides: 20,
      monthlyPrice: 99,
      features: { marketplace: true, blog: true, ads: false }
    },
    {
      name: "LARGE",
      maxStaff: 50,
      maxGuides: 200,
      monthlyPrice: 299,
      features: { marketplace: true, blog: true, ads: true }
    }
  ];

  let freeTierId = "";

  for (const tier of tiers) {
    const createdTier = await prisma.subscriptionTier.upsert({
      where: { name: tier.name },
      update: tier,
      create: tier
    });

    if (tier.name === "FREE") {
      freeTierId = createdTier.id;
    }
  }

  const passwordHash = await bcrypt.hash("Test@123", 10);

  const users = [
    {
      email: "admin@funtush.com",
      role: UserRole.SUPER_ADMIN,
      roleType: RoleType.PLATFORM
    },
    {
      email: "agency@funtush.com",
      role: UserRole.AGENCY_ADMIN,
      roleType: RoleType.TENANT
    },
    {
      email: "test@auth.com",
      role: UserRole.STAFF,
      roleType: RoleType.TREKKER
    }
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        passwordHash,
        role: user.role,
        roleType: user.roleType
      },
      create: {
        email: user.email,
        passwordHash,
        role: user.role,
        roleType: user.roleType
      }
    });
  }

  const permissions = [
    { key: "USER_READ", description: "Read users" },
    { key: "USER_WRITE", description: "Write users" },
    { key: "AGENCY_READ", description: "Read agency" },
    { key: "AGENCY_WRITE", description: "Write agency" }
  ];

  for (const perm of permissions) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      update: {},
      create: perm
    });
  }

  // const freeTier = 
  await prisma.subscriptionTier.upsert({
    where: { name: "FREE" },
    update: {},
    create: {
      name: "FREE",
      maxStaff: 5,
      maxGuides: 5,
      monthlyPrice: 0,
      features: {}
    }
  });

  const testAgency = await prisma.agency.upsert({
    where: { email: "agency@funtush.com" },
    update: {},
    create: {
      name: "Default Agency",
      email: "agency@funtush.com",
      slug: "default-agency",
      tier: {
        connect: {
          id: freeTierId,
        },
      },
    }
  });


  await prisma.agencyStaff.upsert({
    where: { id: "10000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      agencyId: "a4d400b0-3b33-4bac-8cab-027e5e181c79",
      userId: "354d5ded-25b9-4bf1-be69-1325589771cf"
    }
  });

  await prisma.subscription.upsert({
    where: { id: "10000000-0000-0000-0000-000000000000" },
    update: {},
    create: {
      agencyId: "a4d400b0-3b33-4bac-8cab-027e5e181c79",
      tierId: "b6c1cc5d-c82c-4b01-89da-7223d7284b77"
    }
  });

  // Test package + departure date for E2E booking flow 
  const testPackage = await prisma.trekPackage.upsert({
    where: { slug: "everest-base-camp-test" },
    update: { status: "PUBLISHED" },
    create: {
      agencyId: testAgency.id,
      title: "Everest Base Camp Trek (Test)",
      slug: "everest-base-camp-test",
      description: "Test package for E2E booking flow testing.",
      durationDays: 14,
      pricePerPerson: 1200,
      difficulty: "CHALLENGING",
      maxGroupSize: 10,
      status: "PUBLISHED",
    },
  });
  
  const testPackage2 = await prisma.trekPackage.upsert({
    where: { slug: "abc-test" },
    update: { status: "PUBLISHED" },
    create: {
      agencyId: "a4d400b0-3b33-4bac-8cab-027e5e181c79",
      title: "ABC Trek (Test)",
      slug: "ABC-test",
      description: "Test package for E2E booking flow testing.",
      durationDays: 14,
      pricePerPerson: 1200,
      difficulty: "CHALLENGING",
      maxGroupSize: 10,
      status: "PUBLISHED",
    },
  });

  const departureDate = await prisma.trekDepartureDate.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: { bookedSlots: 0, status: "AVAILABLE" },
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      packageId: testPackage.id,
      startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      maxSlots: 10,
      bookedSlots: 0,
      status: "AVAILABLE",
    },
  });

  // Itinerary days for PDF generation test
  await prisma.trekItinerary.upsert({
    where: { id: "00000000-0000-0000-0000-000000000101" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000101",
      packageId: testPackage.id,
      dayNumber: 1,
      location: "Kathmandu to Lukla to Phakding",
      description: "Fly to Lukla, trek to Phakding.",
      altitudeM: 2610,
    },
  });

  await prisma.trekItinerary.upsert({
    where: { id: "00000000-0000-0000-0000-000000000102" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000102",
      packageId: testPackage.id,
      dayNumber: 2,
      location: "Phakding to Namche Bazaar",
      description: "Trek through pine forests to Namche Bazaar.",
      altitudeM: 3440,
    },
  });

  const testTrekker = await prisma.trekker.upsert({
    where: {
      userId: "00000000-0000-0000-0000-000000000301",
    },
    update: {},
    create: {
      user: {
        create: {
          email: "john@test.com",
          passwordHash,
          role: UserRole.STAFF,
          roleType: RoleType.TREKKER,
        },
      },
      fullName: "John Doe",
      phone: "1111111111",
      country: "Nepal",
      nationality: "Nepali",
      emergencyContactName: "Jane Doe",
      emergencyContactPhone: "9800000000",
      isEmailVerified: true,
      emailVerifiedAt: new Date(),
      isActive: true,
    },
  });

  const testBooking = await prisma.booking.upsert({
    where: { id: "00000000-0000-0000-0000-000000000111" },
    update: {},
    create:
    {
      agencyId: testAgency.id,
      trekkerId: testTrekker.id,
      packageId: testPackage.id,
      departureDateId: departureDate.id,
      groupSize: 7,
      totalPrice: 1700,
      status: "CONFIRMED",
      trekkerName: "John Doe",
      trekkerEmail: "john@test.com",
      trekkerPhone: "1111111111",
    },

  });

  const testReview = await prisma.review.upsert({
    where: { id: "00000000-0000-0000-0000-000000000222" },
    update: {},
    create:
    {
      agencyId: testAgency.id,
      bookingId: testBooking.id,
      trekkerId: testTrekker.id,
      assignedGuideId: "00000000-0000-0000-0000-000000000221",
      rating: 4,
      text: "Had a great time.",
      photos: [],
    },

  });


  console.log("seed completed");
  console.log("Test package ID:", testPackage.id);
  console.log("Test departure date ID:", departureDate.id);
  console.log("Test agency ID:", testPackage.agencyId);
  console.log("Test bookings ID:", testBooking.id);
  console.log("Test Review ID:", testReview.id);
}


main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });


// Seeded Super Admin: admin@funtush.com (password: ChangeMe123!)
