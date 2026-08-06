import type { Request, Response, NextFunction } from "express";
import { checkPublicApiRateLimit } from "../services/rateLimit.service";

export async function publicApiRateLimit(req: Request, res: Response, next: NextFunction) {
  const keyId = req.apiKeyAuth?.keyId;
  if (!keyId) {
    res.status(401).json({ success: false, message: "API key authentication required" });
    return;
  }

  const result = await checkPublicApiRateLimit(keyId, req.method, req.path);

  res.setHeader("X-RateLimit-Limit", result.limit.toString());
  res.setHeader("X-RateLimit-Remaining", result.remaining.toString());
  res.setHeader("X-RateLimit-Reset", result.resetInSec.toString());

  if (!result.allowed) {
    res.status(429).json({ success: false, message: "Rate limit exceeded" });
    return;
  }
  next();
}