import { db } from "@funtush/database";

interface CreateBranchPayload {
    name: string;
    address: string;
    phone: string;
    whatsapp?: string;
    isHeadOffice?: boolean;
}

interface UpdateBranchPayload {
    name?: string;
    address?: string;
    phone?: string;
    whatsapp?: string;
    managerStaffId?: string;
    isHeadOffice?: boolean;
}

const BRANCH_LIMIT = {
    FREE: 1,
    SMALL: 1,
    MEDIUM: 3,
    LARGE: Infinity,
};

export const createBranchService = async (
    agencyUserId: string,
    data: CreateBranchPayload
) => {

    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser)
        throw new Error("Agency user not found");

    const agency = await db.agency.findUnique({
        where: {
            id: agencyUser.agencyId
        },
        select: {
            id: true,
            tier: {
                select: {
                    name: true
                }
            }
        }
    });

    if (!agency)
        throw new Error("Agency not found");

    const totalBranches = await db.branch.count({
        where: {
            agencyId: agency.id
        }
    });

    const tier = agency.tier.name as keyof typeof BRANCH_LIMIT;

    const limit = BRANCH_LIMIT[tier];

    if (totalBranches >= limit) {
        throw new Error(
            `Your ${tier} plan allows only ${limit} branch(es).`
        );
    }

<<<<<<< HEAD

    if (data.managerStaffId) {
        const manager = await db.agencyStaff.findFirst({
            where: {
                id: data.managerStaffId,
                agencyId: agency.id,
                isActive: true
            }
        });

        if (!manager)
            throw new Error("Manager does not belong to your agency.");
    }

=======
>>>>>>> origin/develop
    if (data.isHeadOffice === true) {
        const existing = await db.branch.findFirst({
            where: {
                agencyId: agency.id,
                isHeadOffice: true
            }
        });

        if (existing)
            throw new Error("Head office already exists.");
    }

    return await db.branch.create({
        data: {
            agencyId: agency.id,
            name: data.name,
            address: data.address,
            phone: data.phone,
            whatsapp: data.whatsapp,
<<<<<<< HEAD
            managerStaffId: data.managerStaffId,
=======
>>>>>>> origin/develop
            isHeadOffice: data.isHeadOffice ?? false
        }
    });

}

export const updateBranchService = async (
    agencyUserId: string,
    branchId: string,
    data: UpdateBranchPayload
) => {
    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser)
        throw new Error("Agency user not found");

    const branch = await db.branch.findFirst({
        where: {
            id: branchId,
            agencyId: agencyUser.agencyId
        }
    });

    if (!branch)
        throw new Error("Branch not found");

    if (data.managerStaffId) {
        const manager = await db.agencyStaff.findFirst({
            where: {
                id: data.managerStaffId,
                agencyId: agencyUser.agencyId,
                isActive: true
            }
        });

        if (!manager)
            throw new Error("Invalid manager");
    }

    if (data.isHeadOffice === true) {
        const existing = await db.branch.findFirst({
            where: {
                agencyId: agencyUser.agencyId,
                isHeadOffice: true,
                NOT: {
                    id: branch.id
                }
            }
        });

        if (existing)
            throw new Error("Another head office already exists.");
    }

    return await db.branch.update({
        where: {
            id: branch.id
        },
        data: {
            ...data
        }
    });
}

export const getBranchesService = async (
    agencyUserId: string
) => {

    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser)
        throw new Error("Agency user not found");

    return await db.branch.findMany({
        where: {
            agencyId: agencyUser.agencyId
        },
        select: {
            id: true,
            name: true,
            address: true,
            phone: true,
            whatsapp: true,
            isHeadOffice: true,
            managerStaff: {
                select: {
                    id: true
                }
            },
        },
        orderBy: {
            createdAt: "asc"
        }
    });
}

interface assignstaffpayload {
    branchId: string
}
interface assignguidepayload {
    branchId: string
}
interface assignpackagepayload {
    branchId: string
    shareAcrossAll: boolean
}

export const assignStaffToBranchService = async (
    agencyUserId: string,
    staffId: string,
    data: assignstaffpayload
) => {

    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser)
        throw new Error("Agency user not found");

    const staff = await db.agencyStaff.findFirst({
        where: {
            id: staffId,
            agencyId: agencyUser.agencyId
        }
    });

    if (!staff) {
        throw new Error("Staff not found");
    }

    if (data.branchId) {
        const branch = await db.branch.findFirst({
            where: {
                id: data.branchId,
                agencyId: agencyUser.agencyId
            }
        });

        if (!branch) {
            throw new Error("Branch not found");
        }
    }

    const updatedStaff = await db.agencyStaff.update({
        where: {
            id: staff.id
        },
        data: {
            managedBranches: {
                connect: [
                    { id: data.branchId }
                ]
            }
        },
        include: {
            managedBranches: {
                select: {
                    id: true,
                    name: true
                }
            }
        }
    });

    return updatedStaff;

}

export const assignGuideToBranchService = async (
    agencyUserId: string,
    guideId: string,
    data: assignguidepayload
) => {

    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
    if (!data.branchId) {
        throw new Error("Please select a branch.");
    }

    const branch = await db.branch.findFirst({
        where: {
            id: data.branchId,
            agencyId: agencyUser.agencyId
        },
        select: {
            id: true,
            name: true
        }
    });

    if (!branch) {
        throw new Error("Branch not found");
    }

    const guide = await db.guideProfile.findFirst({
        where: {
            id: guideId,
            agencyId: agencyUser.agencyId
        }
    });

    if (!guide) {
        throw new Error("Guide not found");
    }

    if (guide.branchId === data.branchId) {
        throw new Error("Guide is already assigned to this branch");
    }

    const updatedGuide = await db.guideProfile.update({
        where: {
            id: guide.id
        },
        data: {
            branchId: data.branchId
        },
        include: {
            branch: {
                select: {
                    id: true,
                    name: true
                }
            }
        }
    });

    const updatedBranch = await db.branch.findMany({
        where: {
            id: branch.id
        },
        select: {
            guides: true
        }
    });

    return {
        updatedGuide,
        updatedBranch
    };

    return {
        updatedGuide: updatedGuide,
        updatedBranch: updatedBranch
    };
>>>>>>> origin/develop
}

export const assignPackageToBranchService = async (
    agencyUserId: string,
    packageId: string,
    data: assignpackagepayload
) => {

    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser) {
        throw new Error("Agency user not found");
    }


    // Check package exists and belongs to agency
    const packageItem = await db.trekPackage.findFirst({
        where: {
            id: packageId,
        }
    });

    if (!packageItem) {
        throw new Error("Package not found");
    }

    if (packageItem.agencyId !== agencyUser.agencyId) {
        throw new Error("You cannot assign this package");
    }


    // Share package across all branches
    if (data.shareAcrossAll) {

        if (packageItem.availableToAllBranches === true) {
            throw new Error("Package is already available to all branches");
        }

        return await db.trekPackage.update({
            where: {
                id: packageItem.id
            },
            data: {
                availableToAllBranches: true,
                packageBranches: {
                    deleteMany: {}
                }
            },
            include: {
                packageBranches: {
                    include: {
                        branch: {
                            select: {
                                id: true,
                                name: true
                            }
                        }
                    }
                }
            }
        });
    }


    if (!data.branchId) {
        throw new Error("Please select at least one branch.");
    }


    // Validate branch belongs to same agency
    const branch = await db.branch.findFirst({
        where: {
            id: data.branchId,
            agencyId: agencyUser.agencyId
        },
        select: {
            id: true
        }
    });

    if (!branch) {
        throw new Error("Invalid branch");
    }

    // Check duplicate assignment
    const existingAssignment = await db.packageBranch.findUnique({
        where: {
            packageId_branchId: {
                packageId,
                branchId: data.branchId
            }
        }
    });

    if (existingAssignment) {
        throw new Error("Package already assigned");
    }


    // Assign package to branches
    return await db.trekPackage.update({
        where: {
            id: packageItem.id
        },
        data: {
            availableToAllBranches: false,

            packageBranches: {
                create: {
                    branch: {
                        connect: {
                            id: data.branchId
                        }
                    }
                }
            }
        },
        include: {
            packageBranches: {
                include: {
                    branch: {
                        select: {
                            id: true,
                            name: true
                        }
                    }
                }
            }
        }
    });
};


export const getBranchReportService = async (
    agencyUserId: string,
    branchId: string
) => {

    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser)
        throw new Error("Agency user not found");

    const branch = await db.branch.findFirst({
        where: {
            id: branchId,
            agencyId: agencyUser.agencyId
        },
        select: {
            id: true,
            name: true
        }
    });

    if (!branch)
        throw new Error("Branch not found");

    const totalBookings = await db.booking.count({
        where: {
            branchId
        }
    });

    const confirmedBookings = await db.booking.count({
        where: {
            branchId,
            status: "CONFIRMED"
        }
    });

    const cancelledBookings = await db.booking.count({
        where: {
            branchId,
            status: "CANCELLED"
        }
    });

    const inquiryBookings = await db.booking.count({
        where: {
            branchId,
            status: "INQUIRY"
        }
    });

    const topPackages = await db.booking.groupBy({
        by: ["packageId"],
        where: {
            branchId,
            status: "CONFIRMED"
        },
        _count: {
            packageId: true
        },
        orderBy: {
            _count: {
                packageId: "desc"
            }
        }
    });

    const customers = await db.booking.findMany({
        where: {
            branchId
        },
        distinct: ["trekkerId"],
        select: {
            trekkerId: true
        }
    });

    const revenue = await db.booking.aggregate({
        where: {
            branchId,
            status: "CONFIRMED"
        },
        _sum: {
            totalPrice: true
        },
        _avg: {
            totalPrice: true
        }
    });

    return {
        branch,
        totalBookings,
        confirmedBookings,
        cancelledBookings,
        inquiryBookings,
        totalRevenue: revenue._sum.totalPrice ?? 0,
        averageBookingValue: revenue._avg.totalPrice ?? 0,
        totalCustomers: customers.length,
        topPackages
    };
};

export const getConsolidatedFinanceService = async (
    agencyUserId: string
) => {

    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser)
        throw new Error("Agency user not found");

    const branches = await db.branch.findMany({
        where: {
            agencyId: agencyUser.agencyId
        },
        select: {
            id: true,
            name: true
        }
    });

    const branchReports = await Promise.all(
        branches.map(async (branch) => {

            const bookings = await db.booking.count({
                where: {
                    branchId: branch.id,
                    status: "CONFIRMED"
                }
            });

            const revenue = await db.booking.aggregate({
                where: {
                    branchId: branch.id,
                    status: "CONFIRMED"
                },
                _sum: {
                    totalPrice: true
                }
            });

            return {
                id: branch.id,
                name: branch.name,
                bookings,
                revenue: revenue._sum.totalPrice ?? 0
            };
        })
    );

    const totalBookings = branchReports.reduce(
        (sum, branch) => sum + branch.bookings,
        0
    );

    const totalRevenue = branchReports.reduce(
        (sum, branch) => sum + Number(branch.revenue),
        0
    );

    return {
        totalBranches: branches.length,
        totalBookings,
        totalRevenue,
        branches: branchReports
    };
};