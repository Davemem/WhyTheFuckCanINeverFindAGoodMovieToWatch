"use strict";

function buildAuthUserProfile(googleIdentity) {
  return {
    email: googleIdentity.email,
    displayName: googleIdentity.displayName || googleIdentity.email,
    avatarUrl: googleIdentity.avatarUrl || "",
    emailVerified: Boolean(googleIdentity.emailVerified),
  };
}

async function findOrCreateUserFromGoogleIdentity({ dbClient, googleIdentity }) {
  if (googleIdentity.emailVerified !== true) {
    throw new Error("A verified Google email is required");
  }
  const normalizedProfile = buildAuthUserProfile(googleIdentity);

  // Serialize first sign-ins for this subject inside the caller's transaction.
  await dbClient.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `${googleIdentity.provider}:${googleIdentity.providerSubject}`,
  ]);

  const existingIdentityResult = await dbClient.query(
    `
      SELECT
        u.id,
        u.email,
        u.display_name,
        u.avatar_url,
        u.email_verified,
        u.created_at,
        u.updated_at,
        u.last_login_at
      FROM user_identities ui
      JOIN users u ON u.id = ui.user_id
      WHERE ui.provider = $1
        AND ui.provider_subject = $2
      LIMIT 1
    `,
    [googleIdentity.provider, googleIdentity.providerSubject],
  );

  let userId = existingIdentityResult.rows[0]?.id || null;

  if (!userId) {
    const existingUserResult = await dbClient.query(
      `
        SELECT id
        FROM users
        WHERE email = $1
        LIMIT 1
      `,
      [normalizedProfile.email],
    );
    if (existingUserResult.rows[0]) {
      throw new Error("This email is already associated with another sign-in identity.");
    }
  }

  const userResult = userId
    ? await dbClient.query(
        `
          UPDATE users
          SET
            email = $2,
            display_name = $3,
            avatar_url = $4,
            email_verified = users.email_verified OR $5,
            updated_at = NOW(),
            last_login_at = NOW()
          WHERE id = $1
          RETURNING
            id,
            email,
            display_name,
            avatar_url,
            email_verified,
            created_at,
            updated_at,
            last_login_at
        `,
        [
          userId,
          normalizedProfile.email,
          normalizedProfile.displayName,
          normalizedProfile.avatarUrl || null,
          normalizedProfile.emailVerified,
        ],
      )
    : await dbClient.query(
        `
          INSERT INTO users (
            email,
            display_name,
            avatar_url,
            email_verified,
            last_login_at
          )
          VALUES ($1, $2, $3, $4, NOW())
          RETURNING
            id,
            email,
            display_name,
            avatar_url,
            email_verified,
            created_at,
            updated_at,
            last_login_at
        `,
        [
          normalizedProfile.email,
          normalizedProfile.displayName,
          normalizedProfile.avatarUrl || null,
          normalizedProfile.emailVerified,
        ],
      );

  const user = userResult.rows[0];

  await dbClient.query(
    `
      INSERT INTO user_identities (
        user_id,
        provider,
        provider_subject,
        provider_email,
        profile_json
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (provider, provider_subject) DO UPDATE
      SET
        user_id = EXCLUDED.user_id,
        provider_email = EXCLUDED.provider_email,
        profile_json = EXCLUDED.profile_json,
        updated_at = NOW()
    `,
    [
      user.id,
      googleIdentity.provider,
      googleIdentity.providerSubject,
      normalizedProfile.email,
      JSON.stringify(googleIdentity.profile || {}),
    ],
  );

  return normalizeAuthUser(user);
}

function normalizeAuthUser(row) {
  return {
    id: Number(row.id),
    email: row.email,
    displayName: row.display_name || row.email,
    avatarUrl: row.avatar_url || "",
    emailVerified: Boolean(row.email_verified),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

module.exports = {
  findOrCreateUserFromGoogleIdentity,
  normalizeAuthUser,
};
