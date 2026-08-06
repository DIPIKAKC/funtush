import { NextFunction, Request, Response } from "express";
import { db } from "@funtush/database";

export const tierGate =
    (allowedTiers: string[]) =>
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const agencyUserId = req.tenantId as string;

                if (!agencyUserId) {
                    return res.status(401).json({
                        success: false,
                        message: "Unauthorized",
                    });
                }
                const agencyUser = await db.agencyUser.findUnique({
                    where: {
                        id: agencyUserId,
                    },
                    select: {
                        agencyId: true,
                    },
                });

                if (!agencyUser) {
                    throw new Error("Agency user not found.");
                }

                const agency = await db.agency.findUnique({
                    where: {
                        id: agencyUser.agencyId,
                    },
                    include: {
                        tier: {
                            select: {
                                name: true
                            }
                        }
                    },
                });

                if (!agency) {
                    throw new Error("Agency not found.");
                }

                const tier =
                    agency.tier.name ?? "FREE";

                if (!allowedTiers.includes(tier)) {
                    return res.status(403).json({
                        success: false,
                        message: `This feature is available only for ${allowedTiers.join(
                            ", "
                        )} plans.`,
                    });
                }

                next();
            } catch (error) {
                next(error);
            }
        };