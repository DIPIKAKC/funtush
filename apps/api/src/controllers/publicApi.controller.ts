import type { Request, Response } from "express";
import { listPublicPackages, listPublicBookings } from "../services/publicApi.service";

export const listPublicPackagesController = async (req: Request, res: Response) => {
  try {
    const agencyId = req.apiKeyAuth!.agencyId;
    const page = typeof req.query.page === "string" ? parseInt(req.query.page) : 1;
    const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit) : 20;
    const result = await listPublicPackages(agencyId, page, limit);
    return res.status(200).json({ success: true, data: result });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch packages" });
  }
};

export const listPublicBookingsController = async (req: Request, res: Response) => {
  try {
    const agencyId = req.apiKeyAuth!.agencyId;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const page = typeof req.query.page === "string" ? parseInt(req.query.page) : 1;
    const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit) : 20;
    const result = await listPublicBookings(agencyId, page, limit, status);
    return res.status(200).json({ success: true, data: result });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch bookings" });
  }
};