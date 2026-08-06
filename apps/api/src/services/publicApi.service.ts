import { prisma } from "../packages/database/prisma";

export async function listPublicPackages(agencyId: string, page = 1, limit = 20) {
    const where = { agencyId, status: "PUBLISHED" as const };

    const [items, total] = await Promise.all([
        prisma.trekPackage.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
            select: {
                id: true,
                title: true,
                description: true,
                pricePerPerson: true,
                durationDays: true,
                difficulty: true,
                status: true,
                createdAt: true,
            },
        }),
        prisma.trekPackage.count({ where }),
    ]);

    return { items, total, page, limit };
}

export async function listPublicBookings(agencyId: string, page = 1, limit = 20, status?: string) {
    const where = { agencyId, ...(status ? { status: status as any } : {}) };

    const [items, total] = await Promise.all([
        prisma.booking.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
            select: {
                id: true,
                status: true,
                groupSize: true,
                totalPrice: true,
                packageId: true,
                createdAt: true,
            },
        }),
        prisma.booking.count({ where }),
    ]);

    return { items, total, page, limit };
}