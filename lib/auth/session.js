"use strict";

const crypto = require("node:crypto");
const { parseCookies, serializeCookie } = require("./cookies");

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const LAST_SEEN_UPDATE_MS = 1000 * 60 * 15;
const EXPIRED_SESSION_CLEANUP_INTERVAL_MS = 1000 * 60 * 15;
let lastExpiredSessionCleanupAt = 0;

function createSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashSessionToken(token, secret) {
  return crypto.createHmac("sha256", secret).update(token).digest("hex");
}

function readSessionTokenFromRequest(req, cookieName) {
  const cookies = parseCookies(req.headers.cookie || "");
  return cookies[cookieName] || "";
}

function buildSessionCookie(cookieName, token, options = {}) {
  const secure = options.secure !== false;
  return serializeCookie(cookieName, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure,
    path: "/",
    maxAge: Math.floor((options.ttlMs || SESSION_TTL_MS) / 1000),
  });
}

function buildClearedSessionCookie(cookieName, options = {}) {
  const secure = options.secure !== false;
  return serializeCookie(cookieName, "", {
    httpOnly: true,
    sameSite: "Lax",
    secure,
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}

async function createUserSession({ queryDb, userId, sessionSecret, ipAddress, userAgent }) {
  await cleanupExpiredSessions({ queryDb }).catch(() => {});
  const token = createSessionToken();
  const sessionTokenHash = hashSessionToken(token, sessionSecret);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const result = await queryDb(
    `
      INSERT INTO user_sessions (
        user_id,
        session_token_hash,
        expires_at,
        ip_address,
        user_agent
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, user_id, expires_at, created_at, last_seen_at
    `,
    [userId, sessionTokenHash, expiresAt.toISOString(), ipAddress || null, userAgent || null],
  );

  return {
    token,
    session: result.rows[0] || null,
  };
}

async function revokeSessionByToken({ queryDb, token, sessionSecret }) {
  if (!token) {
    return false;
  }

  const sessionTokenHash = hashSessionToken(token, sessionSecret);
  const result = await queryDb(
    `
      UPDATE user_sessions
      SET revoked_at = NOW()
      WHERE session_token_hash = $1
        AND revoked_at IS NULL
      RETURNING id
    `,
    [sessionTokenHash],
  );

  return Boolean(result.rows[0]);
}

async function listUserSessions({ queryDb, userId, currentSessionId = null }) {
  const result = await queryDb(
    `
      SELECT
        id,
        expires_at,
        created_at,
        last_seen_at,
        ip_address,
        user_agent
      FROM user_sessions
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND expires_at > NOW()
      ORDER BY
        CASE WHEN id = $2 THEN 0 ELSE 1 END,
        last_seen_at DESC,
        created_at DESC
    `,
    [userId, currentSessionId],
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    isCurrent: Number(row.id) === Number(currentSessionId),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    ipAddress: row.ip_address || "",
    userAgent: row.user_agent || "",
  }));
}

async function revokeUserSessionById({ queryDb, userId, sessionId }) {
  const normalizedSessionId = Number(sessionId);
  if (!Number.isInteger(normalizedSessionId) || normalizedSessionId <= 0) {
    throw new Error("A valid session id is required.");
  }

  const result = await queryDb(
    `
      UPDATE user_sessions
      SET revoked_at = NOW()
      WHERE id = $1
        AND user_id = $2
        AND revoked_at IS NULL
      RETURNING id
    `,
    [normalizedSessionId, userId],
  );

  return Boolean(result.rows[0]);
}

async function revokeOtherUserSessions({ queryDb, userId, currentSessionId }) {
  const normalizedCurrentSessionId = Number(currentSessionId);
  if (!Number.isInteger(normalizedCurrentSessionId) || normalizedCurrentSessionId <= 0) {
    throw new Error("A valid current session id is required.");
  }

  const result = await queryDb(
    `
      UPDATE user_sessions
      SET revoked_at = NOW()
      WHERE user_id = $1
        AND id <> $2
        AND revoked_at IS NULL
      RETURNING id
    `,
    [userId, normalizedCurrentSessionId],
  );

  return result.rows.length;
}

async function getAuthContextFromRequest({
  req,
  queryDb,
  sessionCookieName,
  sessionSecret,
}) {
  const token = readSessionTokenFromRequest(req, sessionCookieName);
  const anonymousState = {
    isAuthenticated: false,
    sessionToken: token || "",
    session: null,
    user: null,
  };

  if (!token || !queryDb || !sessionSecret) {
    return anonymousState;
  }

  const sessionTokenHash = hashSessionToken(token, sessionSecret);
  await cleanupExpiredSessions({ queryDb }).catch(() => {});
  const result = await queryDb(
    `
      SELECT
        s.id AS session_id,
        s.user_id,
        s.expires_at,
        s.created_at AS session_created_at,
        s.last_seen_at,
        u.email,
        u.display_name,
        u.avatar_url,
        u.email_verified,
        u.created_at AS user_created_at,
        u.updated_at AS user_updated_at,
        u.last_login_at
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.session_token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
      LIMIT 1
    `,
    [sessionTokenHash],
  );

  const row = result.rows[0];
  if (!row) {
    queryDb(
      `
        UPDATE user_sessions
        SET revoked_at = COALESCE(revoked_at, NOW())
        WHERE session_token_hash = $1
          AND expires_at <= NOW()
      `,
      [sessionTokenHash],
    ).catch(() => {});
    return anonymousState;
  }

  if (shouldRefreshLastSeen(row.last_seen_at)) {
    queryDb(
      `
        UPDATE user_sessions
        SET last_seen_at = NOW()
        WHERE id = $1
      `,
      [row.session_id],
    ).catch(() => {});
  }

  return {
    isAuthenticated: true,
    sessionToken: token,
    session: {
      id: Number(row.session_id),
      userId: Number(row.user_id),
      expiresAt: row.expires_at,
      createdAt: row.session_created_at,
      lastSeenAt: row.last_seen_at,
    },
    user: {
      id: Number(row.user_id),
      email: row.email,
      displayName: row.display_name || row.email,
      avatarUrl: row.avatar_url || "",
      emailVerified: Boolean(row.email_verified),
      createdAt: row.user_created_at,
      updatedAt: row.user_updated_at,
      lastLoginAt: row.last_login_at,
    },
  };
}

async function cleanupExpiredSessions({ queryDb, now = Date.now() }) {
  if (!queryDb) {
    return false;
  }

  if (now - lastExpiredSessionCleanupAt < EXPIRED_SESSION_CLEANUP_INTERVAL_MS) {
    return false;
  }

  lastExpiredSessionCleanupAt = now;
  await queryDb(
    `
      UPDATE user_sessions
      SET revoked_at = COALESCE(revoked_at, NOW())
      WHERE expires_at <= NOW()
        AND revoked_at IS NULL
    `,
  );
  return true;
}

function shouldRefreshLastSeen(lastSeenAt) {
  if (!lastSeenAt) {
    return true;
  }

  const lastSeenTime = new Date(lastSeenAt).getTime();
  return !Number.isFinite(lastSeenTime) || Date.now() - lastSeenTime >= LAST_SEEN_UPDATE_MS;
}

module.exports = {
  SESSION_TTL_MS,
  createUserSession,
  getAuthContextFromRequest,
  revokeSessionByToken,
  listUserSessions,
  revokeOtherUserSessions,
  revokeUserSessionById,
  buildSessionCookie,
  buildClearedSessionCookie,
  createSessionToken,
  hashSessionToken,
  readSessionTokenFromRequest,
  cleanupExpiredSessions,
};
