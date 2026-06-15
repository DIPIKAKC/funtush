import { Router } from "express";
import type { Request, Response } from "express";
import {
  buildReportData,
  monthRange,
  yearRange,
  monthLabel,
  toCSV,
  toPDF,
} from "../../services/report.service";
import {
  buildReportKey,
  getCachedReport,
  setCachedReport,
} from "../../lib/reportCache";

const router = Router();

type Format = "pdf" | "csv";

function parseFormat(q: unknown): Format {
  return q === "csv" ? "csv" : "pdf";
}

/**
 * GET /agencies/me/reports/monthly?month=2024-03&format=pdf|csv
 */
router.get("/monthly", async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const month = req.query.month as string | undefined;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      res.status(400).json({ error: "month query param required (YYYY-MM)" });
      return;
    }
    const format = parseFormat(req.query.format);
    const cacheKey = buildReportKey(agencyId, "monthly", month, format);

    // Return cached pointer if present (24h S3 cache)
    const cached = await getCachedReport(cacheKey);
    if (cached) { res.json({ cached: true, ...cached }); return; }

    const range = monthRange(month);
    const data  = await buildReportData(agencyId, range, monthLabel(month));

    if (format === "csv") {
      const csv = toCSV(data);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="report-${month}.csv"`);
      res.send(csv);
      await setCachedReport(cacheKey, {
        s3Key: `reports/${agencyId}/monthly/${month}.csv`,
        url:   "",
        format: "csv",
        generatedAt: data.generatedAt,
      });
      return;
    }

    const pdf = await toPDF(data);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="report-${month}.pdf"`);
    res.send(pdf);
    await setCachedReport(cacheKey, {
      s3Key: `reports/${agencyId}/monthly/${month}.pdf`,
      url:   "",
      format: "pdf",
      generatedAt: data.generatedAt,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[GET /agencies/me/reports/monthly]", err);
    res.status(400).json({ error: msg });
  }
});

/**
 * GET /agencies/me/reports/annual?year=2024&format=pdf|csv
 */
router.get("/annual", async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const year = req.query.year as string | undefined;
    if (!year || !/^\d{4}$/.test(year)) {
      res.status(400).json({ error: "year query param required (YYYY)" });
      return;
    }
    const format = parseFormat(req.query.format);
    const cacheKey = buildReportKey(agencyId, "annual", year, format);

    const cached = await getCachedReport(cacheKey);
    if (cached) { res.json({ cached: true, ...cached }); return; }

    const range = yearRange(year);
    const data  = await buildReportData(agencyId, range, year);

    if (format === "csv") {
      const csv = toCSV(data);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="report-${year}.csv"`);
      res.send(csv);
      await setCachedReport(cacheKey, {
        s3Key: `reports/${agencyId}/annual/${year}.csv`,
        url:   "",
        format: "csv",
        generatedAt: data.generatedAt,
      });
      return;
    }

    const pdf = await toPDF(data);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="report-${year}.pdf"`);
    res.send(pdf);
    await setCachedReport(cacheKey, {
      s3Key: `reports/${agencyId}/annual/${year}.pdf`,
      url:   "",
      format: "pdf",
      generatedAt: data.generatedAt,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[GET /agencies/me/reports/annual]", err);
    res.status(400).json({ error: msg });
  }
});

export default router;
