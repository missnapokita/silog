"use strict";

const {
  ApiError,
  handleError,
  ipHash,
  rateLimit,
  readJson,
  redisCommand,
  requireMethod,
  secureKey,
  sendJson,
  validateCode,
  validateDeviceHash,
  validateItemId
} = require("../../../server/lib/core");

module.exports = async function handler(req, res) {
  try {
    requireMethod(req, "POST");
    const body = await readJson(req);
    const code = validateCode(body.code);
    const deviceHash = validateDeviceHash(body.deviceHash);
    const itemId = validateItemId(body.itemId);
    const expectedPackage = String(process.env.ANDROID_APP_PACKAGE || "com.bisayatoolkit.ph");

    if (String(body.appPackage || "") !== expectedPackage) {
      throw new ApiError(403, "Unsupported app package.");
    }

    const deviceAllowed = await rateLimit(secureKey("rl-redeem-device", deviceHash), 30, 3600);
    const ipAllowed = await rateLimit(secureKey("rl-redeem-ip", ipHash(req)), 80, 3600);
    if (!deviceAllowed || !ipAllowed) throw new ApiError(429, "Too many redeem attempts. Try again later.");

    const script = [
      "local raw=redis.call('GET',KEYS[1])",
      "if not raw then return {0,'missing'} end",
      "local value=cjson.decode(raw)",
      "if value.deviceHash~=ARGV[1] then return {0,'device'} end",
      "if value.itemId~=ARGV[2] then return {0,'item'} end",
      "redis.call('DEL',KEYS[1])",
      "return {1,'authorized'}"
    ].join(";");

    const result = await redisCommand([
      "EVAL",
      script,
      1,
      secureKey("voucher", code),
      deviceHash,
      itemId
    ]);

    if (!Array.isArray(result) || Number(result[0]) !== 1) {
      throw new ApiError(410, "Voucher is invalid, expired, used, or for another device/item.");
    }

    sendJson(res, 200, {
      ok: true,
      authorized: true,
      itemId,
      redeemedAt: new Date().toISOString()
    });
  } catch (error) {
    handleError(res, error);
  }
};
