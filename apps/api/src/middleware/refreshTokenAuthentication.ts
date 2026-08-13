import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "@funtush/database";
import { jwtPayload } from "@funtush/auth";

export const authenticateWithRefreshToken = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const refreshToken = req.headers["x-refresh-token"] as string;

        if (!refreshToken) {
            return res.status(401).json({
                message: "Refresh token is required",
            });
        }

        // Verify JWT refresh token
        let decoded: jwtPayload;

        try {
            decoded = jwt.verify(
                refreshToken,
                process.env.JWT_REFRESH_SECRET as string
            ) as jwtPayload;
        } catch {
            return res.status(401).json({
                message: "Invalid or expired refresh token",
            });
        }

        if (!decoded.userId) {
            return res.status(401).json({
                message: "Invalid refresh token",
            });
        }

        // Find the agency user
        const agencyUser = await db.agencyUser.findFirst({
            where: {
                userId: decoded.userId,
            },
            select: {
                id: true,
                userId: true,
                agencyId: true,
                role: true,
            },
        });

        if (!agencyUser) {
            return res.status(401).json({
                message: "Agency user not found",
            });
        }

        if (!agencyUser.agencyId) {
            return res.status(401).json({
                message: "Agency not linked",
            });
        }

        // Attach authenticated information
        req.tenantId = agencyUser.id;
        req.agencyId = agencyUser.agencyId;

        req.user = {
            userId: decoded.userId,
            role: decoded.role,
            roleType: decoded.roleType,
        };

        return next();

    } catch (error) {
        console.error("Refresh token authentication error:", error);

        return res.status(500).json({
            message: "Internal server error",
        });
    }
};







// import { Request, Response, NextFunction } from "express";
// import { db } from "@funtush/database";
// import bcrypt from "bcrypt";

// // Middleware to authenticate via refresh token -> from registration
// export const authenticateWithRefreshToken = async (req: Request, res: Response, next: NextFunction) => {
//     try {

//         console.log("Authentication middleware called");
//         console.log(req.headers["x-refresh-token"]);

//         const refreshToken = req.headers['x-refresh-token'] as string;

//         if (!refreshToken) {
//             return res.status(401).json({ message: "Refresh token is required" });
//         }

//         const tokens = await db.refreshToken.findMany();

//         for (const t of tokens) {
//             const isValid = await bcrypt.compare(
//                 refreshToken,
//                 t.tokenHash
//             );

//             if (isValid) {
//                 // Look up the user by userId from token

//                 const agencyUser = await db.agencyUser.findFirst({
//                     where: {
//                         userId: t.userId,
//                     },
//                 });
//                 console.log("Agency user:", agencyUser);

//                 if (!agencyUser) {
//                     return res.status(401).json({ message: "User not found" });
//                 }

//                 // Attach only the user ID to the request
//                 req.agencyId = agencyUser.agencyId ?? undefined;
//                 req.user = {
//                     userId: t.userId,
//                     role: "STAFF",
//                     roleType: "TENANT"
//                 };
//                 req.tenantId = agencyUser.id;

//                 if (!agencyUser.agencyId) {
//                     return res.status(401).json({ message: "Agency not linked" });
//                 }

//                 console.log("Setting agencyId:", agencyUser.agencyId);
//                 console.log("Calling next()");
                

//                 return next();
//             }
//         }

//         return res.status(401).json({ message: "Invalid refresh token" });
//     } catch (error) {
//         console.error(error);
//         return res.status(500).json({ message: "Internal server error" });
//     }
// };











