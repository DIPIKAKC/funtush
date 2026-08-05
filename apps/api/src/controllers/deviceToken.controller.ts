import type { Request, Response } from "express";
import {
  registerDeviceToken,
  unregisterDeviceToken,
} from "../services/deviceToken.service";

/**
 * ── Device registration controllers (Mobile week · Day 3) ────────────────────
 *
 * Thin, like Day 1's and Day 2's: read the request, call the service, shape the
 * HTTP response. Every rule about what a valid token is, and who may delete
 * which row, lives in `deviceToken.service.ts` — which is where the tests are.
 */

/** Turn a thrown service error into a status code + message, with no stack leak. */
function respondWithError(res: Response, err: unknown, route: string): void {
  const status = (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(`[${route}]`, err);
  res.status(status).json({ error: message });
}

/**
 * Read a field from either the JSON body or the query string.
 *
 * Needed because of `DELETE`. A DELETE request *may* carry a body per RFC 9110,
 * but plenty of HTTP stacks — including some React Native / OkHttp
 * configurations — quietly drop it. If the only way to unregister were a body,
 * logout would fail on exactly those clients and the phone would keep receiving
 * push after sign-out. Accepting `?fcmToken=` as well costs one helper and
 * removes that whole failure mode.
 *
 * Query values are `string | string[]` (Express parses `?a=1&a=2` into an
 * array), so take the first entry rather than handing an array to the service.
 */
function readField(req: Request, name: string): unknown {
  const body = req.body as Record<string, unknown> | undefined;
  const fromBody = body?.[name];
  if (fromBody !== undefined) return fromBody;

  const fromQuery = req.query[name];
  return Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
}

/**
 * Responses here must never be stored by anything.
 *
 * They echo a device identifier back to one specific signed-in user. It is not
 * a secret on its own, but there is no upside to caching a write endpoint's
 * reply and a clear downside to a proxy replaying one — so opt out explicitly
 * rather than relying on the default.
 */
function setNoStore(res: Response): void {
  res.set("Cache-Control", "no-store");
}

/**
 * `POST /mobile/register-device`
 *
 * Body: `{ "fcmToken": "...", "platform": "android" | "ios" | "web" }`
 *
 * Called on every app launch, not only at login — see `registerDeviceToken` for
 * why. Returns `201` the first time a token is seen and `200` when an existing
 * registration is refreshed, so the app (and anyone reading logs) can tell a new
 * install apart from a routine heartbeat.
 */
export async function registerDeviceController(req: Request, res: Response): Promise<void> {
  try {
    // `requireAuth` verified the JWT, so this id is trustworthy. The user id is
    // deliberately NOT read from the body: letting a client name the account a
    // token belongs to would let anyone subscribe their own phone to a stranger's
    // notifications.
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const device = await registerDeviceToken({
      userId,
      fcmToken: readField(req, "fcmToken"),
      platform: readField(req, "platform"),
    });

    setNoStore(res);
    res.status(device.created ? 201 : 200).json(device);
  } catch (err) {
    respondWithError(res, err, "POST /mobile/register-device");
  }
}

/**
 * `DELETE /mobile/register-device`
 *
 * Body or query: `{ "fcmToken": "..." }`
 *
 * Always `200` when the request itself is well-formed, even if the token was
 * already gone — the `removed` counter carries that detail. Logout must not be
 * able to fail because of a stale cache on the device.
 */
export async function unregisterDeviceController(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const result = await unregisterDeviceToken({
      userId,
      fcmToken: readField(req, "fcmToken"),
    });

    setNoStore(res);
    res.status(200).json(result);
  } catch (err) {
    respondWithError(res, err, "DELETE /mobile/register-device");
  }
}
