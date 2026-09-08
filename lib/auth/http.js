"use strict";

async function readJsonBody(req, options = {}) {
  const maxBytes = Number(options.maxBytes || 1024 * 64);

  return await new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let oversized = false;

    req.on("data", (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        oversized = true;
        chunks.length = 0;
        reject(Object.assign(new Error("Request body too large"), { statusCode: 413 }));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });

    req.on("end", () => {
      if (oversized) return;
      if (!received) {
        resolve({});
        return;
      }

      try {
        // Decode once: a UTF-8 character may span network chunks.
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error("A JSON object is required");
        }
        resolve(value);
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
    req.on("aborted", () => reject(new Error("Request aborted")));
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
