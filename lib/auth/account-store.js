"use strict";

async function getUserAccountOverview({ queryDb, userId }) {
  const result = await queryDb(
    `
      SELECT
        (SELECT COUNT(*)::int FROM user_saved_titles WHERE user_id = $1) AS saved_titles_count,
        (SELECT COUNT(*)::int FROM user_saved_people WHERE user_id = $1) AS saved_people_count,
        (SELECT COUNT(*)::int
         FROM user_sessions
         WHERE user_id = $1
           AND revoked_at IS NULL
           AND expires_at > NOW()) AS active_sessions_count
    `,
    [userId],
  );

  const row = result.rows[0] || {};
  return {
    savedTitlesCount: Number(row.saved_titles_count || 0),
    savedPeopleCount: Number(row.saved_people_count || 0),
    activeSessionsCount: Number(row.active_sessions_count || 0),
  };
}

module.exports = {
  getUserAccountOverview,
};
