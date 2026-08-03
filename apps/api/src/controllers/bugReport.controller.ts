import type { Request, Response } from "express";
import { submitBug, getAgencyBugs } from "../services/bugReport.service";

export const submitBugController = async (req: Request, res: Response) => {
  try {
    const agencyId = req.user!.agencyId!;
    const { title, description, stepsToReproduce, screenshotUrl } = req.body;

    const result = await submitBug(agencyId, {
      title,
      description,
      stepsToReproduce,
      screenshotUrl,
    });

    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to submit bug report";
    const status = message.includes("required") ? 400 : 500;
    return res.status(status).json({ success: false, message });
  }
};

export const getAgencyBugsController = async (req: Request, res: Response) => {
  try {
    const agencyId = req.user!.agencyId!;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const page = typeof req.query.page === "string" ? parseInt(req.query.page) : 1;
    const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit) : 20;

    const result = await getAgencyBugs(agencyId, status, page, limit);

    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch bug reports";
    return res.status(500).json({ success: false, message });
  }
};