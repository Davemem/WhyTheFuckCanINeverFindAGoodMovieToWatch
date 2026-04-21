"use strict";

const { getRequestOrigin } = require("./http");

function createAllowedOrigins(appBaseUrl, configuredOrigins = "") {
  const origins = new Set();

  addOriginIfValid(origins, appBaseUrl);
  String(configuredOrigins || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => addOriginIfValid(origins, value));

  return origins;
}

function isTrustedOriginRequest(req, allowedOrigins) {
  const requestOrigin = getRequestOrigin(req);
  if (!requestOrigin) {
    return false;
  }

  return allowedOrigins.has(requestOrigin);
}

function addOriginIfValid(target, value) {
  try {
    const parsed = new URL(value);
    target.add(parsed.origin);
  } catch {
    // Ignore invalid configured origins so a bad env value does not crash startup.
  }
}

module.exports = {
  createAllowedOrigins,
  isTrustedOriginRequest,
};
