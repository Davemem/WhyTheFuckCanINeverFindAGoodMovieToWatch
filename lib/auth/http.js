"use strict";

async function readJsonBody(req, options = {}) {
  const maxBytes = Number(options.maxBytes || 1024 * 64);

  return await new Promise((resolve, reject) => {
    let raw = "";
    let received = 0;

    req.on("data", (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      raw += chunk;
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function getRequestOrigin(req) {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.trim()) {
    return origin.trim();
  }

  const referer = req.headers.referer;
  if (typeof referer === "string" && referer.trim()) {
    try {
      return new URL(referer).origin;
    } catch {
      return "";
    }
  }

  return "";
}

function getRequestIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  return req.socket?.remoteAddress || "";
}

module.exports = {
  readJsonBody,
  getRequestOrigin,
  getRequestIp,
};
