"use strict";

const { OAuth2Client } = require("google-auth-library");

const GOOGLE_ISSUERS = new Set([
  "accounts.google.com",
  "https://accounts.google.com",
]);

const oauthClients = new Map();

function getGoogleOAuthClient(clientId) {
  const cacheKey = String(clientId || "");
  if (!oauthClients.has(cacheKey)) {
    oauthClients.set(cacheKey, new OAuth2Client(clientId));
  }

  return oauthClients.get(cacheKey);
}

async function verifyGoogleIdToken({ credential, clientId }) {
  if (!credential || typeof credential !== "string") {
    throw new Error("Missing Google credential");
  }

  if (!clientId) {
    throw new Error("Google sign-in is not configured");
  }

  const client = getGoogleOAuthClient(clientId);
  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: clientId,
  });
  const payload = ticket.getPayload();

  if (!payload) {
    throw new Error("Google token payload was empty");
  }

  if (!GOOGLE_ISSUERS.has(payload.iss)) {
    throw new Error("Google token issuer was invalid");
  }

  if (!payload.sub) {
    throw new Error("Google token subject was missing");
  }

  if (!payload.email) {
    throw new Error("Google token email was missing");
  }

  return {
    provider: "google",
    providerSubject: payload.sub,
    email: String(payload.email).trim().toLowerCase(),
    emailVerified: Boolean(payload.email_verified),
    displayName: typeof payload.name === "string" ? payload.name.trim() : "",
    avatarUrl: typeof payload.picture === "string" ? payload.picture.trim() : "",
    givenName: typeof payload.given_name === "string" ? payload.given_name.trim() : "",
    familyName: typeof payload.family_name === "string" ? payload.family_name.trim() : "",
    locale: typeof payload.locale === "string" ? payload.locale.trim() : "",
    hostedDomain: typeof payload.hd === "string" ? payload.hd.trim() : "",
    issuer: payload.iss,
    audience: payload.aud,
    profile: payload,
  };
}

module.exports = {
  verifyGoogleIdToken,
};
