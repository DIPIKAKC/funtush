/**
 * ── Shared pagination helpers (Mobile week · Day 1) ──────────────────────────
 *
 * The mobile plan says "pagination everywhere". Rather than re-writing the same
 * `page`/`limit` parsing in every route, this module owns it in one place:
 *
 *   - `parsePagination()` turns raw, untrusted query-string values into a safe
 *     `{ page, limit, skip, take }` object we can hand straight to Prisma.
 *   - `buildMeta()` turns a row count into the `{ total, page, limit, pages }`
 *     envelope the rest of the API already returns (see
 *     `marketplaceDirectory.service.ts`), so mobile clients see one shape.
 *
 * Why clamp the limit at all? A phone on a 2G connection asking for
 * `?limit=100000` would try to pull the whole table over the wire. Clamping is
 * both a bandwidth guard and a cheap denial-of-service guard.
 */

/** Rows per page when the client does not ask for a specific size. */
export const DEFAULT_PAGE_SIZE = 10;

/** Hard ceiling on rows per page — a client can never ask for more than this. */
export const MAX_PAGE_SIZE = 50;

/** A validated, ready-for-Prisma pagination request. */
export interface PageRequest {
  /** 1-based page number. */
  page: number;
  /** Rows per page, already clamped to `[1, maxLimit]`. */
  limit: number;
  /** Rows to skip — Prisma's `skip`. */
  skip: number;
  /** Rows to fetch — Prisma's `take`. Always equal to `limit`. */
  take: number;
}

/** The pagination envelope returned to clients alongside `data`. */
export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

/** A paginated response body: the rows plus the envelope describing them. */
export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

/**
 * Coerce one query-string value into a positive integer, or `undefined`.
 *
 * Express hands us `string | string[] | ParsedQs | undefined` for every query
 * param, and users can send anything ("abc", "-3", "1.7", "?page=1&page=2").
 * Everything that is not a clean positive integer becomes `undefined`, which
 * makes the caller fall back to its default.
 */
function toPositiveInt(value: unknown): number | undefined {
  // "?page=1&page=2" arrives as an array — take the first value only.
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" && typeof raw !== "number") return undefined;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined; // "abc", "", Infinity

  const floored = Math.floor(parsed); // 1.7 → 1
  return floored > 0 ? floored : undefined; // 0 and negatives are invalid
}

export interface PaginationOptions {
  /** Page size used when the client sends no `limit`. Defaults to 10. */
  defaultLimit?: number;
  /** Largest page size a client may request. Defaults to 50. */
  maxLimit?: number;
}

/**
 * Read `page` and `limit` out of an Express `req.query` and make them safe.
 *
 * @example
 *   parsePagination({ page: "2", limit: "5" })
 *   // → { page: 2, limit: 5, skip: 5, take: 5 }
 */
export function parsePagination(
  query: Record<string, unknown> | undefined,
  options: PaginationOptions = {}
): PageRequest {
  const defaultLimit = options.defaultLimit ?? DEFAULT_PAGE_SIZE;
  const maxLimit = options.maxLimit ?? MAX_PAGE_SIZE;

  const page = toPositiveInt(query?.page) ?? 1;
  const requested = toPositiveInt(query?.limit) ?? defaultLimit;
  const limit = Math.min(requested, maxLimit);

  return { page, limit, skip: (page - 1) * limit, take: limit };
}

/**
 * Build the `meta` envelope from a total row count.
 *
 * `pages` is the number of pages the client can walk through; it is 0 when
 * there are no rows at all, so a client can test `meta.pages === 0` for "empty".
 */
export function buildMeta(total: number, page: number, limit: number): PageMeta {
  return {
    total,
    page,
    limit,
    pages: limit > 0 ? Math.ceil(total / limit) : 0,
  };
}

/** Convenience wrapper: rows + meta in the standard response shape. */
export function paginate<T>(data: T[], total: number, request: PageRequest): Paginated<T> {
  return { data, meta: buildMeta(total, request.page, request.limit) };
}
