"use strict";

const {
  ApiError,
  config,
  consumeJson,
  gateCookie,
  handleError,
  putJson,
  requireMethod,
  secureKey,
  sendHtml,
  signGateSession
} = require("../../server/lib/core");

module.exports = async function handler(req, res) {
  try {
    requireMethod(req, "GET");
    const settings = config();
    const sessionId = String((req.query && req.query.sid) || "").trim();

    if (!/^[A-Za-z0-9_-]{24,180}$/.test(sessionId)) {
      throw new ApiError(400, "Invalid secure session.");
    }

    const pending = await consumeJson(secureKey("start", sessionId));
    if (!pending) {
      sendHtml(res, 410, "Session expired", "Return to Bisaya Toolkit and tap Get Now again.");
      return;
    }

    pending.startedAt = Date.now();
    pending.notBefore = Date.now() + settings.gateSeconds * 1000;

    const stored = await putJson(secureKey("gate", sessionId), pending, 900, true);
    if (stored !== "OK") throw new ApiError(503, "Could not start secure link.");

    res.statusCode = 302;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Location", settings.shortLinkUrl);
    res.setHeader("Set-Cookie", gateCookie(signGateSession(sessionId), 900));
    res.end();
  } catch (error) {
    if (error instanceof ApiError && error.statusCode < 500) {
      sendHtml(res, error.statusCode, "Secure link error", error.message);
      return;
    }
    handleError(res, error);
  }
};
