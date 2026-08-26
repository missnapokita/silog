"use strict";

const {
  ApiError,
  consumeJson,
  handleError,
  putJson,
  randomToken,
  readJson,
  requireMethod,
  secureKey,
  sendJson,
  validateEntryToken
} = require("../../../server/lib/core");

module.exports = async function handler(req, res) {
  try {
    requireMethod(req, "POST");
    const body = await readJson(req);
    const entryToken = validateEntryToken(body.entryToken);
    const entry = await consumeJson(secureKey("entry", entryToken));
    if (!entry) throw new ApiError(410, "Access token is expired or already used.");

    const generationToken = randomToken(24);
    const expiresAt = new Date(Date.now() + 180000).toISOString();
    const stored = await putJson(
      secureKey("generation", generationToken),
      {
        deviceHash: entry.deviceHash,
        itemId: entry.itemId,
        itemName: entry.itemName,
        issuedAt: Date.now()
      },
      180,
      true
    );
    if (stored !== "OK") throw new ApiError(503, "Could not prepare voucher generation.");

    sendJson(res, 200, {
      ok: true,
      generationToken,
      expiresAt,
      item: { id: entry.itemId, name: entry.itemName }
    });
  } catch (error) {
    handleError(res, error);
  }
};
