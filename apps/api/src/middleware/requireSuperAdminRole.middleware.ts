import type { Request, Response, NextFunction } from "express";

/**
 * Verifies the authenticated user (req.user, set by @funtush/auth's
 * requireAuth) is platform staff with approval authority.
*/
export function requireSuperAdminRole(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const user = req.user;

  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const allowedRoles = ["SUPER_ADMIN", "PLATFORM_ADMIN"] as const;

  if (user.roleType !== "PLATFORM" || !allowedRoles.includes(user.role as typeof allowedRoles[number])) {
    res.status(403).json({ error: "Requires platform admin privileges" });
    return;
  }

  next();
}