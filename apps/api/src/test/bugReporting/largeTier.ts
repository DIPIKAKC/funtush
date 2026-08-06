import { db } from "@funtush/database";

/**
 * ── Shared "LARGE tier" fixture for the API-key integration tests ────────────
 *
 * `apiKey.service.ts` gates API-key management on the agency's tier being named
 * exactly `"LARGE"` (see `LARGE_TIER` there), and `SubscriptionTier.name` is
 * `@unique` in the schema. Those two facts together mean **there can only ever
 * be one LARGE tier row in the database**, so no single test file can own it.
 *
 * Both `apiKey.service.test.ts` and `apiKey.integration.test.ts` need one, and
 * Vitest runs test files in parallel workers. The original setup in both files
 * was:
 *
 * ```ts
 * const largeTier = await db.subscriptionTier.findFirst({ where: { name: 'LARGE' } });
 * if (largeTier) {
 *   await db.agency.deleteMany({ where: { tierId: largeTier.id } });   // ← destructive
 *   await db.subscriptionTier.delete({ where: { id: largeTier.id } });
 * }
 * await db.subscriptionTier.create({ data: { name: 'LARGE', … } });
 * ```
 *
 * That has two separate problems:
 *
 * 1. **It races.** Whichever file runs second deletes the first file's tier and,
 *    with `deleteMany`, the first file's *agency* — which then fails every test
 *    in that file with "Agency not found". Sometimes the two `delete` calls race
 *    each other directly and one dies with "No record was found for a delete".
 *
 * 2. **It destroys real data.** `deleteMany({ where: { tierId } })` removes
 *    **every agency on the LARGE tier**, not just the test's own. On a seeded
 *    development database that silently deletes real fixtures — and the LARGE
 *    tier itself is created by `prisma/seed.ts`, so running the suite once wipes
 *    a seeded row that other tests and manual testing rely on.
 *
 * The fix is to stop treating a shared, unique, seeded row as file-private
 * state: **reuse it if it exists, create it only if it does not, and never
 * delete it.** Each test file still owns its own uniquely-id'd agency, which
 * nothing else touches, so the files no longer interfere at all.
 *
 * Leaving the row behind is deliberate. It is seed data, it is what the next run
 * expects to find, and deleting it is exactly the behaviour that broke the
 * suite.
 */

/** The tier name `apiKey.service.ts` checks for. Must match `LARGE_TIER` there. */
export const LARGE_TIER_NAME = "LARGE";

/**
 * Return the id of the LARGE subscription tier, creating it if it is missing.
 *
 * Safe to call from several test files at once, including concurrently.
 *
 * @param fallbackId id to use if this call is the one that creates the row.
 */
export async function ensureLargeTier(fallbackId: string): Promise<string> {
  const existing = await db.subscriptionTier.findUnique({
    where: { name: LARGE_TIER_NAME },
  });
  if (existing) return existing.id;

  try {
    const created = await db.subscriptionTier.create({
      data: {
        id: fallbackId,
        name: LARGE_TIER_NAME,
        maxStaff: 50,
        maxGuides: 25,
        monthlyPrice: 5000,
        features: JSON.stringify(["bugs", "api_keys"]),
      },
    });
    return created.id;
  } catch {
    // Another test file created the row between our read and our write. That is
    // not an error — it is the outcome we wanted. Re-read and use theirs.
    const raced = await db.subscriptionTier.findUnique({
      where: { name: LARGE_TIER_NAME },
    });
    if (!raced) throw new Error(`Could not find or create the ${LARGE_TIER_NAME} subscription tier`);
    return raced.id;
  }
}
