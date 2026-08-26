(function () {
  "use strict";

  var config = window.BTK_VOUCHER_CONFIG || {};
  var runtime = { generationToken: "", generated: false, expiresAt: "" };
  var elements = {
    status: document.getElementById("status-label"),
    lead: document.getElementById("lead-copy"),
    itemName: document.getElementById("item-name"),
    codeWrap: document.getElementById("voucher-code-wrap"),
    code: document.getElementById("voucher-code"),
    primary: document.getElementById("primary-button"),
    retry: document.getElementById("retry-button"),
    note: document.getElementById("setup-note"),
    expiry: document.getElementById("expiry-value")
  };

  function cleanBaseUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function setStatus(text, kind) {
    elements.status.textContent = text;
    elements.status.className = "status-label";
    if (kind) elements.status.classList.add("is-" + kind);
  }

  function setStep(name) {
    var order = ["access", "generate", "redeem"];
    var activeIndex = order.indexOf(name);
    document.querySelectorAll("[data-step]").forEach(function (node) {
      var nodeIndex = order.indexOf(node.getAttribute("data-step"));
      node.classList.toggle("active", nodeIndex === activeIndex);
      node.classList.toggle("complete", nodeIndex < activeIndex);
    });
  }

  function setNote(message, isError) {
    elements.note.textContent = message || "";
    elements.note.classList.toggle("is-error", Boolean(isError));
  }

  function setPrimary(label, disabled) {
    elements.primary.textContent = label;
    elements.primary.disabled = Boolean(disabled);
  }

  function showSetup() {
    setStatus("FRONTEND READY", "ready");
    setStep("access");
    elements.lead.textContent = "The page is ready. Secure voucher generation will be activated after the shortened link is connected.";
    elements.itemName.textContent = "Waiting for Bisaya Toolkit";
    setPrimary("ACTIVATION PENDING", true);
    setNote("Send the shortened link so the secure generator can be connected.", false);
    elements.expiry.textContent = String(config.voucherLifetimeMinutes || 15) + "m";
  }

  function showRedirect() {
    setStatus("ACCESS REQUIRED", "error");
    elements.lead.textContent = "Complete the secure link before generating a voucher.";
    elements.itemName.textContent = "Protected VIP item";
    setPrimary("OPEN SECURE LINK", false);
    setNote("Direct access and refreshed sessions return to the secure link.", false);
    elements.primary.onclick = redirectToShortLink;
  }

  function redirectToShortLink() {
    var target = String(config.shortLinkUrl || "").trim();
    if (!target) {
      showSetup();
      return;
    }
    window.location.replace(target);
  }

  function readEntryToken() {
    var url = new URL(window.location.href);
    var token = String(url.searchParams.get("entry") || "").trim();
    if (token) {
      url.searchParams.delete("entry");
      window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : "") + url.hash);
    }
    return token;
  }

  function fetchJson(path, body) {
    var controller = new AbortController();
    var timeout = window.setTimeout(function () { controller.abort(); }, Number(config.requestTimeoutMs) || 12000);

    return fetch(cleanBaseUrl(config.apiBaseUrl) + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal
    }).then(function (response) {
      window.clearTimeout(timeout);
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data && data.message ? data.message : "Request failed");
        return data;
      });
    }).catch(function (error) {
      window.clearTimeout(timeout);
      throw error;
    });
  }

  function validateExchange(data) {
    return Boolean(data && typeof data.generationToken === "string" && data.generationToken.length >= 20 && data.item && typeof data.item.name === "string" && data.item.name.length > 0);
  }

  function exchangeEntry(entryToken) {
    setStatus("VERIFYING");
    setStep("access");
    elements.lead.textContent = "Verifying your secure access…";
    setPrimary("PLEASE WAIT", true);
    setNote("Do not refresh this page while access is being checked.", false);

    fetchJson("/v1/gate/exchange", { entryToken: entryToken }).then(function (data) {
      if (!validateExchange(data)) throw new Error("Invalid verification response");
      runtime.generationToken = data.generationToken;
      runtime.expiresAt = data.expiresAt || "";
      elements.itemName.textContent = data.item.name;
      setStatus("ACCESS VERIFIED", "ready");
      setStep("generate");
      elements.lead.textContent = "Your access is verified. Generate one voucher for this VIP item.";
      setPrimary("GENERATE VOUCHER", false);
      setNote("Only one code can be generated from this session.", false);
      elements.primary.onclick = generateVoucher;
    }).catch(function () {
      showError("This access link is invalid, expired, or already used.", true);
    });
  }

  function validVoucher(data) {
    return Boolean(data && typeof data.code === "string" && /^[A-Z0-9-]{8,64}$/.test(data.code));
  }

  function generateVoucher() {
    if (!runtime.generationToken || runtime.generated) return;
    runtime.generated = true;
    setStatus("GENERATING");
    setPrimary("GENERATING…", true);
    setNote("Creating your device-bound voucher…", false);

    fetchJson("/v1/voucher/generate", { generationToken: runtime.generationToken }).then(function (data) {
      if (!validVoucher(data)) throw new Error("Invalid voucher response");
      runtime.generationToken = "";
      runtime.expiresAt = data.expiresAt || runtime.expiresAt;
      elements.code.textContent = data.code;
      elements.codeWrap.hidden = false;
      setStatus("VOUCHER CREATED", "ready");
      setStep("redeem");
      elements.lead.textContent = "Copy this code, return to Bisaya Toolkit, then redeem and apply your item.";
      setPrimary("COPY VOUCHER CODE", false);
      setNote(expiryMessage(runtime.expiresAt), false);
      elements.primary.onclick = copyVoucher;
    }).catch(function () {
      runtime.generated = false;
      showError("The voucher could not be generated. Please start a new secure-link session.", true);
    });
  }

  function expiryMessage(value) {
    if (!value) return "This voucher expires soon and can only be redeemed once.";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "This voucher expires soon and can only be redeemed once.";
    return "Expires at " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + ". Redeem it only on the requesting device.";
  }

  function fallbackCopy(value) {
    var area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    var copied = document.execCommand("copy");
    document.body.removeChild(area);
    return copied;
  }

  function copyVoucher() {
    var value = elements.code.textContent.trim();
    if (!value || value.indexOf("•") >= 0) return;
    var operation = navigator.clipboard && window.isSecureContext ? navigator.clipboard.writeText(value).then(function () { return true; }) : Promise.resolve(fallbackCopy(value));
    operation.then(function (copied) {
      if (!copied) throw new Error("Copy failed");
      setPrimary("CODE COPIED", true);
      setNote("Return to Bisaya Toolkit and paste the code to redeem your VIP item.", false);
    }).catch(function () {
      setNote("Press and hold the code above to copy it manually.", true);
    });
  }

  function showError(message, allowRestart) {
    setStatus("ACCESS ERROR", "error");
    setStep("access");
    elements.lead.textContent = "We could not continue this voucher session.";
    setPrimary("SESSION UNAVAILABLE", true);
    setNote(message, true);
    elements.retry.hidden = !allowRestart;
    elements.retry.onclick = redirectToShortLink;
  }

  function init() {
    elements.expiry.textContent = String(config.voucherLifetimeMinutes || 15) + "m";
    if (config.setupMode || !cleanBaseUrl(config.apiBaseUrl)) {
      showSetup();
      return;
    }
    var entryToken = readEntryToken();
    if (!entryToken) {
      redirectToShortLink();
      return;
    }
    exchangeEntry(entryToken);
  }

  init();
})();
