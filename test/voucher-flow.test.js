"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
process.env.VOUCHER_SIGNING_SECRET = "test-signing-secret-that-is-longer-than-32-characters";
process.env.PUBLIC_SITE_ORIGIN = "https://silog-three.vercel.app";
process.env.SHORT_LINK_URL = "https://earn4link.in/IPuIw";
process.env.ANDROID_APP_PACKAGE = "com.bisayatoolkit.ph";
process.env.MIN_GATE_SECONDS = "4";

const values = new Map();
const counters = new Map();

global.fetch = async function redisFetch(url, options) {
  assert.equal(url, "https://redis.test");
  const args = JSON.parse(options.body);
  const command = String(args[0]).toUpperCase();
  let result = null;

  if (command === "SET") {
    const key = String(args[1]);
    const onlyIfMissing = args.indexOf("NX") >= 0;
    if (!onlyIfMissing || !values.has(key)) {
      values.set(key, String(args[2]));
      result = "OK";
    }
  } else if (command === "GET") {
    result = values.has(String(args[1])) ? values.get(String(args[1])) : null;
  } else if (command === "GETDEL") {
    const key = String(args[1]);
    result = values.has(key) ? values.get(key) : null;
    values.delete(key);
  } else if (command === "DEL") {
    result = values.delete(String(args[1])) ? 1 : 0;
  } else if (command === "EVAL" && String(args[1]).indexOf("INCR") >= 0) {
    const key = String(args[3]);
    const next = (counters.get(key) || 0) + 1;
    counters.set(key, next);
    result = next;
  } else if (command === "EVAL") {
    const key = String(args[3]);
    const deviceHash = String(args[4]);
    const itemId = String(args[5]);
    const raw = values.get(key);
    if (!raw) {
      result = [0, "missing"];
    } else {
      const voucher = JSON.parse(raw);
      if (voucher.deviceHash !== deviceHash) result = [0, "device"];
      else if (voucher.itemId !== itemId) result = [0, "item"];
      else {
        values.delete(key);
        result = [1, "authorized"];
      }
    }
  } else {
    throw new Error("Unsupported test Redis command: " + command);
  }

  return { ok: true, json: async () => ({ result }) };
};

const startSession = require("../api/v1/session/start");
const startGate = require("../api/gate/start");
const completeGate = require("../api/gate/complete");
const exchangeGate = require("../api/v1/gate/exchange");
const generateVoucher = require("../api/v1/voucher/generate");
const redeemVoucher = require("../api/v1/voucher/redeem");

function makeRequest(method, body, extra) {
  return Object.assign({
    method,
    body: body || {},
    headers: {
      host: "silog-three.vercel.app",
      "x-forwarded-for": "203.0.113.8"
    },
    socket: { remoteAddress: "203.0.113.8" },
    query: {}
  }, extra || {});
}

function invoke(handler, req) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
      end(value) {
        let body = null;
        if (value) {
          try { body = JSON.parse(value); } catch (_) { body = String(value); }
        }
        resolve({ status: this.statusCode, headers, body });
      }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test("secure flow generates one device-bound, one-time voucher", async () => {
  const deviceHash = "a".repeat(64);
  const start = await invoke(startSession, makeRequest("POST", {
    deviceHash,
    itemId: "zilong_okarun",
    itemName: "Zilong × Okarun",
    appPackage: "com.bisayatoolkit.ph"
  }));
  assert.equal(start.status, 200);
  const sessionId = new URL(start.body.startUrl).searchParams.get("sid");
  assert.ok(sessionId);

  const gate = await invoke(startGate, makeRequest("GET", null, { query: { sid: sessionId } }));
  assert.equal(gate.status, 302);
  assert.equal(gate.headers.location, "https://earn4link.in/IPuIw");
  const cookie = String(gate.headers["set-cookie"]).split(";")[0];

  for (const [key, raw] of values.entries()) {
    if (key.indexOf("btk:gate:") === 0) {
      const record = JSON.parse(raw);
      record.notBefore = 0;
      values.set(key, JSON.stringify(record));
    }
  }

  const complete = await invoke(completeGate, makeRequest("POST", {}, {
    headers: { host: "silog-three.vercel.app", cookie, "x-forwarded-for": "203.0.113.8" }
  }));
  assert.equal(complete.status, 200);
  assert.ok(complete.body.entryToken);

  const exchange = await invoke(exchangeGate, makeRequest("POST", {
    entryToken: complete.body.entryToken
  }));
  assert.equal(exchange.status, 200);
  assert.equal(exchange.body.item.id, "zilong_okarun");

  const generated = await invoke(generateVoucher, makeRequest("POST", {
    generationToken: exchange.body.generationToken
  }));
  assert.equal(generated.status, 200);
  assert.match(generated.body.code, /^BTK-[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/);

  const secondGenerate = await invoke(generateVoucher, makeRequest("POST", {
    generationToken: exchange.body.generationToken
  }));
  assert.equal(secondGenerate.status, 410);

  const wrongDevice = await invoke(redeemVoucher, makeRequest("POST", {
    code: generated.body.code,
    deviceHash: "b".repeat(64),
    itemId: "zilong_okarun",
    appPackage: "com.bisayatoolkit.ph"
  }));
  assert.equal(wrongDevice.status, 410);

  const redeemed = await invoke(redeemVoucher, makeRequest("POST", {
    code: generated.body.code,
    deviceHash,
    itemId: "zilong_okarun",
    appPackage: "com.bisayatoolkit.ph"
  }));
  assert.equal(redeemed.status, 200);
  assert.equal(redeemed.body.authorized, true);

  const reused = await invoke(redeemVoucher, makeRequest("POST", {
    code: generated.body.code,
    deviceHash,
    itemId: "zilong_okarun",
    appPackage: "com.bisayatoolkit.ph"
  }));
  assert.equal(reused.status, 410);
});
