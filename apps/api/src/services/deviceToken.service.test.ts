import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the device token service (Mobile week · Day 3).
 *
 * `@funtush/database` is replaced with hand-written spies, so these run with no
 * Postgres and no network. What they assert is the behaviour push delivery
 * actually depends on: that a rotated token replaces the old row, that a shared
 * device is reassigned rather than duplicated, that nobody can unregister
 * somebody else's phone, and that raw tokens never appear in a return value.
 */

const deviceTokenFindUnique = vi.fn();
const deviceTokenUpsert = vi.fn();
const deviceTokenFindMany = vi.fn();
const deviceTokenDeleteMany = vi.fn();
const deviceTokenCount = vi.fn();

vi.mock("@funtush/database", () => ({
  db: {
    deviceToken: {
      findUnique: (...a: unknown[]) => deviceTokenFindUnique(...a),
      upsert: (...a: unknown[]) => deviceTokenUpsert(...a),
      findMany: (...a: unknown[]) => deviceTokenFindMany(...a),
      deleteMany: (...a: unknown[]) => deviceTokenDeleteMany(...a),
      count: (...a: unknown[]) => deviceTokenCount(...a),
    },
  },
}));

import {
  DEVICE_PLATFORMS,
  MAX_DEVICES_PER_USER,
  MIN_TOKEN_LENGTH,
  MAX_TOKEN_LENGTH,
  STALE_TOKEN_DAYS,
  normalizePlatform,
  normalizeFcmToken,
  maskToken,
  registerDeviceToken,
  enforceDeviceLimit,
  unregisterDeviceToken,
  listUserDeviceTokens,
  pruneInvalidTokens,
  pruneStaleTokens,
} from "./deviceToken.service";

/** A token shaped like a real FCM one: long, no whitespace. */
const TOKEN = `fMEP0vJqS0${"a".repeat(140)}z1b2c3`;
const NOW = new Date("2026-08-03T09:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();

  deviceTokenFindUnique.mockResolvedValue(null);
  deviceTokenUpsert.mockResolvedValue({
    id: "device-1",
    platform: "ANDROID",
    lastActiveAt: NOW,
  });
  // One device registered → comfortably under the cap, so no eviction.
  deviceTokenFindMany.mockResolvedValue([{ id: "device-1" }]);
  deviceTokenDeleteMany.mockResolvedValue({ count: 1 });
  deviceTokenCount.mockResolvedValue(0);
});

/* ── normalizePlatform ───────────────────────────────────────────────────── */

describe("normalizePlatform", () => {
  it("accepts what React Native's Platform.OS actually returns", () => {
    expect(normalizePlatform("ios")).toBe("IOS");
    expect(normalizePlatform("android")).toBe("ANDROID");
    expect(normalizePlatform("web")).toBe("WEB");
  });

  it("trims and uppercases", () => {
    expect(normalizePlatform("  Android  ")).toBe("ANDROID");
  });

  it("rejects anything that is not a known platform", () => {
    expect(normalizePlatform("windows-phone")).toBeNull();
    expect(normalizePlatform("")).toBeNull();
    expect(normalizePlatform(undefined)).toBeNull();
    expect(normalizePlatform(42)).toBeNull();
    expect(normalizePlatform(["ios"])).toBeNull();
  });

  it("covers every value the enum declares", () => {
    for (const platform of DEVICE_PLATFORMS) {
      expect(normalizePlatform(platform.toLowerCase())).toBe(platform);
    }
  });
});

/* ── normalizeFcmToken ───────────────────────────────────────────────────── */

describe("normalizeFcmToken", () => {
  it("accepts a realistic token unchanged", () => {
    expect(normalizeFcmToken(TOKEN)).toBe(TOKEN);
  });

  it("trims copy-paste whitespace around the edges", () => {
    expect(normalizeFcmToken(`\n  ${TOKEN}\t`)).toBe(TOKEN);
  });

  it("rejects a token with whitespace inside rather than silently repairing it", () => {
    // A repaired token would look valid and never deliver — a failure that only
    // shows up days later, in the field.
    const split = `${TOKEN.slice(0, 40)} ${TOKEN.slice(40)}`;
    expect(normalizeFcmToken(split)).toBeNull();
  });

  it("rejects tokens outside the sanity bounds", () => {
    expect(normalizeFcmToken("")).toBeNull();
    expect(normalizeFcmToken("x".repeat(MIN_TOKEN_LENGTH - 1))).toBeNull();
    expect(normalizeFcmToken("x".repeat(MAX_TOKEN_LENGTH + 1))).toBeNull();
  });

  it("accepts exactly the boundary lengths", () => {
    expect(normalizeFcmToken("x".repeat(MIN_TOKEN_LENGTH))).toHaveLength(MIN_TOKEN_LENGTH);
    expect(normalizeFcmToken("x".repeat(MAX_TOKEN_LENGTH))).toHaveLength(MAX_TOKEN_LENGTH);
  });

  it("rejects non-strings", () => {
    expect(normalizeFcmToken(null)).toBeNull();
    expect(normalizeFcmToken({ token: TOKEN })).toBeNull();
  });
});

/* ── maskToken ───────────────────────────────────────────────────────────── */

describe("maskToken", () => {
  it("keeps only the last six characters", () => {
    expect(maskToken(TOKEN)).toBe(`…${TOKEN.slice(-6)}`);
  });

  it("never contains enough of the token to push to the device", () => {
    expect(maskToken(TOKEN)).not.toContain(TOKEN.slice(0, 20));
  });
});

/* ── registerDeviceToken ─────────────────────────────────────────────────── */

describe("registerDeviceToken", () => {
  it("rejects a call with no authenticated user", async () => {
    await expect(
      registerDeviceToken({ userId: "", fcmToken: TOKEN, platform: "android" })
    ).rejects.toMatchObject({ status: 401 });
    expect(deviceTokenUpsert).not.toHaveBeenCalled();
  });

  it("400s an unusable token before touching the database", async () => {
    await expect(
      registerDeviceToken({ userId: "user-1", fcmToken: "short", platform: "android" })
    ).rejects.toMatchObject({ status: 400 });
    expect(deviceTokenUpsert).not.toHaveBeenCalled();
  });

  it("400s an unknown platform and names the valid ones", async () => {
    await expect(
      registerDeviceToken({ userId: "user-1", fcmToken: TOKEN, platform: "symbian" })
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("ANDROID") });
    expect(deviceTokenUpsert).not.toHaveBeenCalled();
  });

  it("upserts on the token, not on the user", async () => {
    await registerDeviceToken({ userId: "user-1", fcmToken: TOKEN, platform: "android" });

    const args = deviceTokenUpsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.where).toEqual({ fcmToken: TOKEN });
  });

  it("reassigns an existing token to whoever is signed in now", async () => {
    // The shared-tablet case: same installation, new user.
    await registerDeviceToken({ userId: "user-2", fcmToken: TOKEN, platform: "ios" });

    const args = deviceTokenUpsert.mock.calls[0]![0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(args.create).toMatchObject({ userId: "user-2", fcmToken: TOKEN, platform: "IOS" });
    // The line that matters: the update moves ownership.
    expect(args.update).toMatchObject({ userId: "user-2", platform: "IOS" });
    expect(args.update.lastActiveAt).toBeInstanceOf(Date);
  });

  it("stores the normalised platform, not the raw string", async () => {
    await registerDeviceToken({ userId: "user-1", fcmToken: TOKEN, platform: "  iOS " });

    const args = deviceTokenUpsert.mock.calls[0]![0] as { create: { platform: string } };
    expect(args.create.platform).toBe("IOS");
  });

  it("reports created:true for a token the server has never seen", async () => {
    deviceTokenFindUnique.mockResolvedValue(null);

    const result = await registerDeviceToken({
      userId: "user-1",
      fcmToken: TOKEN,
      platform: "android",
    });

    expect(result.created).toBe(true);
  });

  it("reports created:false when an existing registration is refreshed", async () => {
    deviceTokenFindUnique.mockResolvedValue({ id: "device-1" });

    const result = await registerDeviceToken({
      userId: "user-1",
      fcmToken: TOKEN,
      platform: "android",
    });

    expect(result.created).toBe(false);
  });

  it("never returns the raw token — only a masked preview", async () => {
    const result = await registerDeviceToken({
      userId: "user-1",
      fcmToken: TOKEN,
      platform: "android",
    });

    expect(result.tokenPreview).toBe(maskToken(TOKEN));
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("returns a serialisable ISO timestamp and the device count", async () => {
    const result = await registerDeviceToken({
      userId: "user-1",
      fcmToken: TOKEN,
      platform: "android",
    });

    expect(result).toMatchObject({
      deviceId: "device-1",
      platform: "ANDROID",
      lastActiveAt: NOW.toISOString(),
      deviceCount: 1,
    });
  });
});

/* ── enforceDeviceLimit ──────────────────────────────────────────────────── */

describe("enforceDeviceLimit", () => {
  it("leaves a normal user alone", async () => {
    deviceTokenFindMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);

    expect(await enforceDeviceLimit("user-1")).toBe(2);
    expect(deviceTokenDeleteMany).not.toHaveBeenCalled();
  });

  it("does not delete at exactly the cap", async () => {
    deviceTokenFindMany.mockResolvedValue(
      Array.from({ length: MAX_DEVICES_PER_USER }, (_, i) => ({ id: `d${i}` }))
    );

    expect(await enforceDeviceLimit("user-1")).toBe(MAX_DEVICES_PER_USER);
    expect(deviceTokenDeleteMany).not.toHaveBeenCalled();
  });

  it("evicts the least recently active devices once over the cap", async () => {
    // Ordered newest-active first by the query, so the tail is the stale end.
    deviceTokenFindMany.mockResolvedValue(
      Array.from({ length: MAX_DEVICES_PER_USER + 3 }, (_, i) => ({ id: `d${i}` }))
    );

    expect(await enforceDeviceLimit("user-1")).toBe(MAX_DEVICES_PER_USER);
    expect(deviceTokenDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["d10", "d11", "d12"] } },
    });
  });

  it("asks for the rows in a deterministic order", async () => {
    await enforceDeviceLimit("user-1");

    expect(deviceTokenFindMany.mock.calls[0]![0]).toMatchObject({
      where: { userId: "user-1" },
      orderBy: [{ lastActiveAt: "desc" }, { createdAt: "desc" }],
    });
  });
});

/* ── unregisterDeviceToken ───────────────────────────────────────────────── */

describe("unregisterDeviceToken", () => {
  it("rejects a call with no authenticated user", async () => {
    await expect(unregisterDeviceToken({ userId: "", fcmToken: TOKEN })).rejects.toMatchObject({
      status: 401,
    });
    expect(deviceTokenDeleteMany).not.toHaveBeenCalled();
  });

  it("400s when no token was supplied", async () => {
    await expect(
      unregisterDeviceToken({ userId: "user-1", fcmToken: undefined })
    ).rejects.toMatchObject({ status: 400 });
    expect(deviceTokenDeleteMany).not.toHaveBeenCalled();
  });

  it("scopes the delete to the caller, so nobody can silence another phone", async () => {
    await unregisterDeviceToken({ userId: "user-1", fcmToken: TOKEN });

    expect(deviceTokenDeleteMany).toHaveBeenCalledWith({
      where: { fcmToken: TOKEN, userId: "user-1" },
    });
  });

  it("reports how many rows it removed", async () => {
    deviceTokenDeleteMany.mockResolvedValue({ count: 1 });
    deviceTokenCount.mockResolvedValue(2);

    expect(await unregisterDeviceToken({ userId: "user-1", fcmToken: TOKEN })).toEqual({
      removed: 1,
      deviceCount: 2,
    });
  });

  it("succeeds when the token was already gone — logout must not fail", async () => {
    deviceTokenDeleteMany.mockResolvedValue({ count: 0 });
    deviceTokenCount.mockResolvedValue(0);

    await expect(
      unregisterDeviceToken({ userId: "user-1", fcmToken: TOKEN })
    ).resolves.toEqual({ removed: 0, deviceCount: 0 });
  });
});

/* ── read paths used by the push sender ──────────────────────────────────── */

describe("listUserDeviceTokens", () => {
  it("returns raw tokens, newest-active first", async () => {
    deviceTokenFindMany.mockResolvedValue([
      { fcmToken: "token-new", platform: "IOS" },
      { fcmToken: "token-old", platform: "ANDROID" },
    ]);

    const tokens = await listUserDeviceTokens("user-1");

    expect(tokens).toEqual([
      { fcmToken: "token-new", platform: "IOS" },
      { fcmToken: "token-old", platform: "ANDROID" },
    ]);
    expect(deviceTokenFindMany.mock.calls[0]![0]).toMatchObject({
      where: { userId: "user-1" },
      orderBy: { lastActiveAt: "desc" },
    });
  });

  it("returns an empty list rather than throwing when a user has no devices", async () => {
    deviceTokenFindMany.mockResolvedValue([]);
    expect(await listUserDeviceTokens("user-1")).toEqual([]);
  });
});

describe("pruneInvalidTokens", () => {
  it("deletes exactly the tokens Firebase reported dead", async () => {
    deviceTokenDeleteMany.mockResolvedValue({ count: 2 });

    expect(await pruneInvalidTokens(["dead-1", "dead-2"])).toBe(2);
    expect(deviceTokenDeleteMany).toHaveBeenCalledWith({
      where: { fcmToken: { in: ["dead-1", "dead-2"] } },
    });
  });

  it("short-circuits on an empty list instead of issuing a matches-nothing delete", async () => {
    expect(await pruneInvalidTokens([])).toBe(0);
    expect(deviceTokenDeleteMany).not.toHaveBeenCalled();
  });
});

describe("pruneStaleTokens", () => {
  it("cuts off at Firebase's own staleness threshold", async () => {
    deviceTokenDeleteMany.mockResolvedValue({ count: 5 });

    expect(await pruneStaleTokens(NOW)).toBe(5);

    const args = deviceTokenDeleteMany.mock.calls[0]![0] as {
      where: { lastActiveAt: { lt: Date } };
    };
    const expected = new Date(NOW.getTime() - STALE_TOKEN_DAYS * 24 * 60 * 60 * 1000);
    expect(args.where.lastActiveAt.lt.toISOString()).toBe(expected.toISOString());
  });
});
