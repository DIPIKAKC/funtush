import type { Request, Response, NextFunction } from "express";
import { authenticateApiKey } from "../services/apiKey.service";

declare global {
  namespace Express {
    interface Request {
      apiKeyAuth?: { agencyId: string; scope: "READ_ONLY" | "READ_WRITE"; keyId: string };
    }
  }
}

export async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const rawKey = req.headers["x-api-key"];
  if (!rawKey || typeof rawKey !== "string") {
    res.status(401).json({ success: false, message: "Missing X-Api-Key header" });
    return;
  }

  const result = await authenticateApiKey(rawKey);
  if (!result) {
    res.status(401).json({ success: false, message: "Invalid or revoked API key" });
    return;
  }

  req.apiKeyAuth = result;
  next();
}

export function requireWriteScope(req: Request, res: Response, next: NextFunction) {
  if (req.apiKeyAuth?.scope !== "READ_WRITE") {
    res.status(403).json({ success: false, message: "This API key does not have write access" });
    return;
  }
  next();
}