"use strict";

const {
  ApiError,
  consumeJson,
  gateCookie,
  getJson,
  handleError,
  parseCookies,
  putJson,
  randomToken,
  requireMethod,
  secureKey,
  sendJson,
  verifyGateSession
} = require("../../server/lib/core");

module.exports = async function handler(req, res) {
  try {
    requireMethod(req, "POST");
    const cookies = parseCookies(req);
    const sessionId = verifyGateSession(cookies.btk_gate);
    if (!sessionId) throw new ApiError(401, "Secure-link session is missing or invalid.");

    const gateKey = secureKey("gate", sessionId);
    const pending = await getJson(gateKey);
    if (!pending) throw new ApiError(410, "Secure-link session expired.");

    const waitMs = Number(pending.notBefore || 0) - Date.now();
    if (waitMs > 0) {
      throw new ApiError(425, "Secure link is still being completed.", {
        retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000))
      });
    }

    const consumed = await consumeJson(gateKey);
    if (!consumed) throw new ApiError(410, "Secure-link session was already used.");

    const entryToken = randomToken(24);
    const stored = await putJson(
      secureKey("entry", entryToken),
      {
        deviceHash: consumed.deviceHash,
        itemId: consumed.itemId,
        itemName: consumed.itemName,
        completedAt: Date.now()
      },
      180,
      true
    );
    if (stored !== "OK") throw new ApiError(503, "Could not verify secure link.");

    sendJson(res, 200, { ok: true, entryToken, expiresInSeconds: 180 }, {
      "Set-Cookie": gateCookie("", 0)
    });
  } catch (error) {
    handleError(res, error);
  }
};
