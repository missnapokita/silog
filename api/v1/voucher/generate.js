"use strict";

const {
  ApiError,
  consumeJson,
  createVoucherCode,
  handleError,
  putJson,
  rateLimit,
  readJson,
  redisCommand,
  requireMethod,
  secureKey,
  sendJson,
  validateEntryToken
} = require("../../../server/lib/core");

module.exports = async function handler(req, res) {
  try {
    requireMethod(req, "POST");
    const body = await readJson(req);
    const generationToken = validateEntryToken(body.generationToken);
    const generation = await consumeJson(secureKey("generation", generationToken));
    if (!generation) throw new ApiError(410, "Generation session is expired or already used.");

    const dailyAllowed = await rateLimit(
      secureKey("rl-generate-day", generation.deviceHash),
      Number(process.env.MAX_VOUCHERS_PER_DEVICE_DAY || 5),
      86400
    );
    if (!dailyAllowed) throw new ApiError(429, "Daily voucher limit reached for this device.");

    const activeKey = secureKey("active", generation.deviceHash + ":" + generation.itemId);
    const activeStored = await redisCommand(["SET", activeKey, "1", "EX", 900, "NX"]);
    if (activeStored !== "OK") {
      throw new ApiError(429, "An active voucher already exists for this device and item.");
    }

    let code = "";
    let stored = null;
    const now = Date.now();
    const expiresAt = new Date(now + 900000).toISOString();

    for (let attempt = 0; attempt < 3 && stored !== "OK"; attempt += 1) {
      code = createVoucherCode();
      stored = await putJson(
        secureKey("voucher", code),
        {
          deviceHash: generation.deviceHash,
          itemId: generation.itemId,
          itemName: generation.itemName,
          issuedAt: now,
          expiresAt
        },
        900,
        true
      );
    }

    if (stored !== "OK") {
      await redisCommand(["DEL", activeKey]);
      throw new ApiError(503, "Could not create a unique voucher.");
    }

    sendJson(res, 200, {
      ok: true,
      code,
      expiresAt,
      item: { id: generation.itemId, name: generation.itemName }
    });
  } catch (error) {
    handleError(res, error);
  }
};
