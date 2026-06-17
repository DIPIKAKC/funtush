import { cacheGet, cacheSet } from "../services/redis.service";

/**
 * Report cache abstraction. Stores generated report URLs/keys so we don't
 * regenerate PDFs on every request. Backed by Redis (pointer) + S3 (file).
 *
 * In production the actual file bytes live in S3 for 24h; Redis holds the
 * pointer (S3 key + signed URL) so repeat requests are instant.
 */

const REPORT_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export interface CachedReport {
  s3Key:     string;
  url:       string;
  format:    "pdf" | "csv";
  generatedAt: string;
}

export function buildReportKey(
  agencyId: string,
  type: "monthly" | "annual",
  period: string,         // "2024-03" or "2024"
  format: "pdf" | "csv"
): string {
  return `report:${agencyId}:${type}:${period}:${format}`;
}

export async function getCachedReport(key: string): Promise<CachedReport | null> {
  return cacheGet<CachedReport>(key);
}

export async function setCachedReport(key: string, report: CachedReport): Promise<void> {
  await cacheSet(key, report, REPORT_TTL_SECONDS);
}

export { REPORT_TTL_SECONDS };
