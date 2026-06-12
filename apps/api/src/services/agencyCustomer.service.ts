import { BookingStatus, db, Prisma } from "@funtush/database"


interface customersQuery {
    page?: number;
    limit?: number;
    search?: string;
    customerType?: "repeat" | "new";
    destination?: string;
    bookingStatus?: BookingStatus;
    sortBy?: "lastBookingDate" | "totalBookings" | "totalSpending";
    sortOrder?: "asc" | "desc";
}

export const agencyCustomerListService = async (agencyId: string, query: customersQuery,) => {

    const {
        page = 1,
        limit = 20,
        search,
        destination,
        bookingStatus,
        customerType,
        sortBy = "lastBookingDate",
        sortOrder = "desc",
    } = query;


 const bookingWhere: Prisma.BookingWhereInput = {
    agencyId,
  };

  if (bookingStatus) {
    bookingWhere.status = bookingStatus;
  }

  if (destination) {
  bookingWhere.package = {
    destinations: {
      some: {
        id: destination,
      },
    },
  };
}

  /**
   * STEP 1
   * Aggregate bookings by trekker
   */
  const groupedCustomers = await db.booking.groupBy({
    by: ["trekkerId"],

    where: bookingWhere,

    _count: {
      id: true,
    },

    _sum: {
      totalPrice: true,
    },

    _max: {
      createdAt: true,
    },
  });

  if (!groupedCustomers.length) {
    return {
      data: [],
      meta: {
        page,
        limit,
        total: 0,
        totalPages: 0,
      },
    };
  }

  /**
   * STEP 2
   * Fetch trekker details
   */
  const trekkerIds = groupedCustomers.map(
    (customer) => customer.trekkerId,
  );

  const trekkers = await db.trekker.findMany({
    where: {
      id: {
        in: trekkerIds,
      },
    },

    select: {
      id: true,
      fullName: true,
      phone: true,
      country: true,

      user: {
        select: {
          email: true,
        },
      },
    },
  });

  const trekkerMap = new Map(
    trekkers.map((trekker) => [trekker.id, trekker]),
  );

  /**
   * STEP 3
   * Merge aggregation + trekker details
   */
  let customers = groupedCustomers.map((customer) => {
    const trekker = trekkerMap.get(customer.trekkerId);

    const totalBookings = customer._count.id;

    return {
      trekkerId: customer.trekkerId,

      fullName: trekker?.fullName ?? null,
      email: trekker?.user.email ?? null,
      phone: trekker?.phone ?? null,
      country: trekker?.country ?? null,

      totalBookings,

      totalSpending: Number(
        customer._sum.totalPrice ?? 0,
      ),

      lastBookingDate: customer._max.createdAt,

      repeatVisitor: totalBookings > 1,
    };
  });

  /**
   * STEP 4
   * Search
   */
  if (search?.trim()) {
    const keyword = search.toLowerCase();

    customers = customers.filter((customer) => {
      return (
        customer.fullName
          ?.toLowerCase()
          .includes(keyword) ||
        customer.email
          ?.toLowerCase()
          .includes(keyword) ||
        customer.phone
          ?.toLowerCase()
          .includes(keyword)
      );
    });
  }

  /**
   * STEP 5
   * Repeat / New filter
   */
  if (customerType === "repeat") {
    customers = customers.filter(
      (customer) => customer.repeatVisitor,
    );
  }

  if (customerType === "new") {
    customers = customers.filter(
      (customer) => !customer.repeatVisitor,
    );
  }

  /**
   * STEP 6
   * Sorting
   */
  customers.sort((a, b) => {
    let result = 0;

    switch (sortBy) {
      case "totalBookings":
        result =
          a.totalBookings - b.totalBookings;
        break;

      case "totalSpending":
        result =
          a.totalSpending - b.totalSpending;
        break;

      case "lastBookingDate":
      default:
        result =
          new Date(
            a.lastBookingDate ?? 0,
          ).getTime() -
          new Date(
            b.lastBookingDate ?? 0,
          ).getTime();
    }

    return sortOrder === "asc"
      ? result
      : result * -1;
  });

  /**
   * STEP 7
   * Pagination
   */
  const total = customers.length;

  const start = (page - 1) * limit;

  const paginatedCustomers = customers.slice(
    start,
    start + limit,
  );

  return {
    data: paginatedCustomers,

    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
    
//     const bookings = await db.booking.findMany({

//         where: {
//             agencyId,

//             ...(bookingStatus && {
//                 status: bookingStatus,
//             }),

//             ...(search && {
//                 OR: [
//                     {
//                         trekker: {
//                             fullName: {
//                                 contains: search,
//                                 mode: "insensitive",
//                             },
//                             phone: {
//                                 contains: search,
//                                 mode: "insensitive",
//                             },
//                             user: {
//                                 email: {
//                                     contains: search,
//                                     mode: "insensitive",
//                                 },
//                             },
//                         },
//                     },
//                 ],
//             }),


//             ...(destination && {
//                 package: {
//                     destinations: {
//                         some: {
//                             name: {
//                                 contains: destination,
//                                 mode: "insensitive",
//                             },
//                         },
//                     },
//                 },
//             }),
//         },
//     });

//     const grouped = await db.booking.groupBy({
//         by: ["trekkerId"],

//         where

//             _count: {
//                 id: true,
//             },

//             _sum: {
//                 totalPrice: true,
//             },

//             _max: {
//                 createdAt: true,
//             },

//             _min: {
//                 createdAt: true,
//             },
        
//     });


//     let customers = grouped;

//     if (customerType === "repeat") {
//         customers = customers.filter(
//             (customer) => customer._count.id > 1,
//         );
//     }

//     if (customerType === "new") {
//         customers = customers.filter(
//             (customer) => customer._count.id === 1,
//         );
//     }

//     customers.sort((a, b) => {
//         let comparison = 0;

//         switch (sortBy) {
//             case "totalBookings":
//                 comparison =
//                     a._count.id - b._count.id;
//                 break;

//             case "totalSpending":
//                 comparison =
//                     Number(a._sum.totalPrice ?? 0) -
//                     Number(b._sum.totalPrice ?? 0);
//                 break;

//             default:
//                 comparison =
//                     (a._max.createdAt?.getTime() ?? 0) -
//                     (b._max.createdAt?.getTime() ?? 0);
//         }

//         return sortOrder === "asc"
//             ? comparison
//             : -comparison;
//     });

//     const total = customers.length;

//     const paginatedCustomers = customers.slice(
//         (page - 1) * limit,
//         page * limit,
//     );

//     const trekkerIds = paginatedCustomers.map(
//         (customer) => customer.trekkerId,
//     );

//     const trekkers = await db.trekker.findMany({
//         where: {
//             id: {
//                 in: trekkerIds,
//             },
//         },

//         include: {
//             user: {
//                 select: {
//                     email: true,
//                 },
//             },
//         },
//     });

//     const trekkerMap = new Map(
//         trekkers.map((trekker) => [
//             trekker.id,
//             trekker,
//         ]),
//     );

//     const latestBookings = await db.booking.findMany({
//         where: {
//             agencyId,
//             trekkerId: {
//                 in: trekkerIds,
//             },
//         },

//         orderBy: {
//             createdAt: "desc",
//         },

//         select: {
//             trekkerId: true,
//             status: true,
//         },
//     });

//     const latestStatusMap = new Map<
//         string,
//         BookingStatus
//     >();

//     for (const booking of latestBookings) {
//         if (!latestStatusMap.has(booking.trekkerId)) {
//             latestStatusMap.set(
//                 booking.trekkerId,
//                 booking.status,
//             );
//         }
//     }

//     const data = paginatedCustomers.map((customer) => {
//         const trekker = trekkerMap.get(
//             customer.trekkerId,
//         );

//         return {
//             trekkerId: customer.trekkerId,

//             fullName: trekker?.fullName,
//             email: trekker?.user.email,
//             phone: trekker?.phone,

//             totalBookings: customer._count.id,

//             totalSpending: Number(
//                 customer._sum.totalPrice ?? 0,
//             ),

//             firstBookingDate:
//                 customer._min.createdAt,

//             lastBookingDate:
//                 customer._max.createdAt,

//             latestBookingStatus:
//                 latestStatusMap.get(
//                     customer.trekkerId,
//                 ) ?? null,

//             repeatVisitor:
//                 customer._count.id > 1,
//         };
//     });


//     return {
//         data,
//         meta: {
//             page,
//             limit,
//             total,
//             totalPages: Math.ceil(total / limit),
//         },
//     };

// }

