/**
 * ── Deterministic JSON, for fingerprinting ───────────────────────────────────
 *
 * `JSON.stringify` with object keys sorted at every level.
 *
 * Anything that hashes a data structure to detect change needs this. Plain
 * `JSON.stringify` preserves *insertion* order, so two objects holding identical
 * values produce different strings if their keys were written in a different
 * order — and a hash built on that reports a change where none happened.
 *
 * Arrays keep their order, deliberately. An itinerary is ordered (day 2 follows
 * day 1) and `police: ["102", "108"]` lists the preferred number first, so a
 * reordered array genuinely *is* a different value.
 *
 * Written on Mobile week · Day 2 inside `offlinePackage.service.ts`, lifted here
 * on Day 4 when `emergencyNumbers.service.ts` needed the same helper. That
 * mattered more than tidiness: `offlinePackage.service.ts` imports
 * `@funtush/database`, and the emergency number endpoint is specifically
 * designed to have no database dependency at all (see
 * `apps/api/src/data/emergencyNumbers.ts`). Importing the helper from there
 * would have quietly reintroduced one. The old file still re-exports the name,
 * so existing imports keep working.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);

  return `{${entries.join(",")}}`;
}
