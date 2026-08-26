"use strict";

const crypto = require("crypto");

class ApiError extends Error {
  constructor(statusCode, message, extra) {
    super(message);
    this.statusCode = statusCode;
    this.extra = extra || null;
  }
}

function envValue() {
  for (let i = 0; i < arguments.length; i += 1) {
    const value = String(process.env[arguments[i]] || "").trim();
    if (value) return value;
  }
  return "";
}

function config() {
  const redisUrl = envValue("UPSTASH_REDIS_REST_URL", "KV_REST_API_URL").replace(/\/+$/, "");
  const redisToken = envValue("UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN");
  const signingSecret = envValue("VOUCHER_SIGNING_SECRET");
  const shortLinkUrl = envValue("SHORT_LINK_URL") || "https://earn4link.in/IPuIw";
  const publicOrigin = envValue("PUBLIC_SITE_ORIGIN").replace(/\/+$/, "");
  const gateSeconds = Math.max(4, Math.min(60, Number(process.env.MIN_GATE_SECONDS || 8)));

  if (!redisUrl || !redisToken || signingSecret.length < 32) {
    throw new ApiError(503, "Voucher service is not configured yet.");
  }

  return {
    redisUrl,
    redisToken,
    signingSecret,
    shortLinkUrl,
    publicOrigin,
    gateSeconds
  };
}

function setCommonHeaders(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function sendJson(res, statusCode, payload, extraHeaders) {
  setCommonHeaders(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (extraHeaders) {
    Object.keys(extraHeaders).forEach((name) => res.setHeader(name, extraHeaders[name]));
  }
  res.end(JSON.stringify(payload));
}

function sendHtml(res, statusCode, title, message) {
  setCommonHeaders(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
      "<meta name=\"robots\" content=\"noindex,nofollow\"><title>" + escapeHtml(title) + "</title>" +
      "<style>body{min-height:100vh;margin:0;display:grid;place-items:center;background:#0d0e11;color:#eef3ee;font:15px system-ui;padding:24px;text-align:center}main{max-width:430px}h1{font-size:24px}p{color:#9da69f;line-height:1.6}</style></head>" +
      "<body><main><h1>" + escapeHtml(title) + "</h1><p>" + escapeHtml(message) + "</p></main></body></html>"
  );
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

async function readJson(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") {
    if (req.body.length > 12000) throw new ApiError(413, "Request is too large.");
    try { return JSON.parse(req.body || "{}"); } catch (_) { throw new ApiError(400, "Invalid JSON request."); }
  }

  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 12000) throw new ApiError(413, "Request is too large.");
  }
  try { return JSON.parse(text || "{}"); } catch (_) { throw new ApiError(400, "Invalid JSON request."); }
}

function requireMethod(req, method) {
  if (String(req.method || "").toUpperCase() !== method) {
    throw new ApiError(405, "Method not allowed.");
  }
}

async function redisCommand(args) {
  const settings = config();
  const response = await fetch(settings.redisUrl, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + settings.redisToken,
      "Content-Type": "application/json",
      "User-Agent": "bisaya-toolkit-voucher/1.0"
    },
    body: JSON.stringify(args)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new ApiError(503, "Voucher storage is temporarily unavailable.");
  }
  return data.result;
}

async function putJson(key, value, ttlSeconds, onlyIfMissing) {
  const args = ["SET", key, JSON.stringify(value), "EX", ttlSeconds];
  if (onlyIfMissing) args.push("NX");
  return redisCommand(args);
}

async function getJson(key) {
  const value = await redisCommand(["GET", key]);
  if (!value) return null;
  try { return JSON.parse(value); } catch (_) { return null; }
}

async function consumeJson(key) {
  const value = await redisCommand(["GETDEL", key]);
  if (!value) return null;
  try { return JSON.parse(value); } catch (_) { return null; }
}

async function rateLimit(key, limit, ttlSeconds) {
  const script = "local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]);end;return n";
  const count = Number(await redisCommand(["EVAL", script, 1, key, ttlSeconds]));
  return count <= limit;
}

function randomToken(bytes) {
  return crypto.randomBytes(bytes || 24).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function hmac(value) {
  return crypto.createHmac("sha256", config().signingSecret)
    .update(String(value || ""), "utf8").digest("hex");
}

function secureKey(prefix, value) {
  return "btk:" + prefix + ":" + hmac(value);
}

function signGateSession(sessionId) {
  return sessionId + "." + hmac("gate:" + sessionId);
}

function verifyGateSession(signedValue) {
  const value = String(signedValue || "");
  const splitAt = value.lastIndexOf(".");
  if (splitAt < 20) return "";
  const sessionId = value.slice(0, splitAt);
  const received = value.slice(splitAt + 1);
  const expected = hmac("gate:" + sessionId);
  if (received.length !== expected.length) return "";
  try {
    if (!crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))) return "";
  } catch (_) { return ""; }
  return sessionId;
}

function parseCookies(req) {
  const header = String((req.headers && req.headers.cookie) || "");
  const result = {};
  header.split(";").forEach((part) => {
    const index = part.indexOf("=");
    if (index < 1) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try { result[key] = decodeURIComponent(value); } catch (_) { result[key] = value; }
  });
  return result;
}

function gateCookie(value, maxAge) {
  return "btk_gate=" + encodeURIComponent(value || "") +
    "; Max-Age=" + Math.max(0, Number(maxAge || 0)) +
    "; Path=/; HttpOnly; Secure; SameSite=Lax";
}

function requestOrigin(req) {
  const settings = config();
  if (settings.publicOrigin) return settings.publicOrigin;
  const host = String((req.headers && (req.headers["x-forwarded-host"] || req.headers.host)) || "").split(",")[0].trim();
  if (!/^[a-z0-9.-]+(?::[0-9]{2,5})?$/i.test(host)) throw new ApiError(400, "Invalid host.");
  return "https://" + host;
}

function ipHash(req) {
  const forwarded = String((req.headers && req.headers["x-forwarded-for"]) || "").split(",")[0].trim();
  const remote = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "unknown";
  return hmac("ip:" + (forwarded || remote));
}

function validateDeviceHash(value) {
  const clean = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(clean)) throw new ApiError(400, "Invalid device binding.");
  return clean;
}

function validateItemId(value) {
  const clean = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_]{0,79}$/.test(clean)) throw new ApiError(400, "Invalid VIP item.");
  const allowlist = String(process.env.VIP_ITEM_IDS || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (allowlist.length && allowlist.indexOf(clean) < 0) throw new ApiError(403, "VIP item is not enabled.");
  return clean;
}

function cleanItemName(value) {
  const clean = String(value || "VIP Item").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return (clean || "VIP Item").slice(0, 100);
}

function validateEntryToken(value) {
  const clean = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{24,180}$/.test(clean)) throw new ApiError(400, "Invalid access token.");
  return clean;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function validateCode(value) {
  const code = normalizeCode(value);
  if (!/^BTK-[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/.test(code)) throw new ApiError(400, "Invalid voucher format.");
  return code;
}

function createVoucherCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(16);
  let value = "";
  for (let i = 0; i < bytes.length; i += 1) value += alphabet[bytes[i] & 31];
  return "BTK-" + value.match(/.{1,4}/g).join("-");
}

function handleError(res, error) {
  const status = error instanceof ApiError ? error.statusCode : 500;
  const message = error instanceof ApiError ? error.message : "Voucher service error.";
  const payload = Object.assign({ ok: false, message }, error && error.extra ? error.extra : {});
  sendJson(res, status, payload);
}

module.exports = {
  ApiError,
  cleanItemName,
  config,
  consumeJson,
  createVoucherCode,
  gateCookie,
  getJson,
  handleError,
  hmac,
  ipHash,
  normalizeCode,
  parseCookies,
  putJson,
  randomToken,
  rateLimit,
  readJson,
  redisCommand,
  requestOrigin,
  requireMethod,
  secureKey,
  sendHtml,
  sendJson,
  sha256,
  signGateSession,
  validateCode,
  validateDeviceHash,
  validateEntryToken,
  validateItemId,
  verifyGateSession
};
