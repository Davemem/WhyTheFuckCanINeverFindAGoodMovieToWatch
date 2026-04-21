"use strict";

const crypto = require("node:crypto");

const CSRF_HEADER_NAME = "x-csrf-token";

function createCsrfToken(sessionToken, sessionSecret) {
  if (!sessionToken || !sessionSecret) {
    return "";
  }

  return crypto
    .createHmac("sha256", `${sessionSecret}:csrf`)
    .update(String(sessionToken))
    .digest("base64url");
}

function readCsrfTokenFromRequest(req) {
  const headerValue = req.headers[CSRF_HEADER_NAME];
  if (Array.isArray(headerValue)) {
    return String(headerValue[0] || "").trim();
  }
  return typeof headerValue === "string" ? headerValue.trim() : "";
}

function isValidCsrfToken(req, expectedToken) {
  const providedToken = readCsrfTokenFromRequest(req);
  if (!providedToken || !expectedToken) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(providedToken), Buffer.from(expectedToken));
  } catch {
    return false;
  }
}

module.exports = {
  CSRF_HEADER_NAME,
  createCsrfToken,
  isValidCsrfToken,
  readCsrfTokenFromRequest,
};
