"use strict";

const {
  ApiError,
  cleanItemName,
  handleError,
  ipHash,
  putJson,
  randomToken,
  rateLimit,
  readJson,
  requestOrigin,
  requireMethod,
  secureKey,
  sendJson,
  validateDeviceHash,
  validateItemId
} = require("../../../server/lib/core");

module.exports = async function handler(req, res) {
  try {
    requireMethod(req, "POST");
    const body = await readJson(req);
    const deviceHash = validateDeviceHash(body.deviceHash);
    const itemId = validateItemId(body.itemId);
    const itemName = cleanItemName(body.itemName);
    const expectedPackage = String(process.env.ANDROID_APP_PACKAGE || "com.bisayatoolkit.ph");

    if (String(body.appPackage || "") !== expectedPackage) {
      throw new ApiError(403, "Unsupported app package.");
    }

    const deviceAllowed = await rateLimit(secureKey("rl-session-device", deviceHash), 8, 3600);
    const ipAllowed = await rateLimit(secureKey("rl-session-ip", ipHash(req)), 30, 3600);
    if (!deviceAllowed || !ipAllowed) throw new ApiError(429, "Too many voucher requests. Try again later.");

    const sessionId = randomToken(24);
    const stored = await putJson(
      secureKey("start", sessionId),
      { deviceHash, itemId, itemName, createdAt: Date.now() },
      600,
      true
    );

    if (stored !== "OK") throw new ApiError(503, "Could not create voucher session.");

    sendJson(res, 200, {
      ok: true,
      startUrl: requestOrigin(req) + "/api/gate/start?sid=" + encodeURIComponent(sessionId),
      expiresInSeconds: 600
    });
  } catch (error) {
    handleError(res, error);
  }
};
