import type { Request, Response } from "express";
import { createApiKey, listApiKeys, revokeApiKey, ApiKeyError } from "../services/apiKey.service";

export const createApiKeyController = async (req: Request, res: Response) => {
  try {
    const agencyId = req.user!.agencyId!;
    const { name, scope } = req.body;
    const result = await createApiKey(agencyId, name, scope ?? "READ_ONLY");
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    return res.status(500).json({ success: false, message: "Failed to create API key" });
  }
};

export const listApiKeysController = async (req: Request, res: Response) => {
  try {
    const agencyId = req.user!.agencyId!;
    const result = await listApiKeys(agencyId);
    return res.status(200).json({ success: true, data: result });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch API keys" });
  }
};

export const revokeApiKeyController = async (req: Request, res: Response) => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
    const agencyId = req.user!.agencyId!;
    const result = await revokeApiKey(id, agencyId);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    return res.status(500).json({ success: false, message: "Failed to revoke API key" });
  }
};