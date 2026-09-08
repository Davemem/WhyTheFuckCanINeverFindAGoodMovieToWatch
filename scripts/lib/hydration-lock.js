"use strict";

// A session lock is released by Postgres if the worker dies. The next worker
// can then reclaim its unfinished batch without stealing a live worker's work.
const HYDRATION_LOCK_ID = 621725201;

async function withHydrationLock(pool, run) {
  const client = await pool.connect();
  let locked = false;
  try {
    const result = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [HYDRATION_LOCK_ID]);
    locked = result.rows[0]?.locked === true;
    if (!locked) return false;
    await client.query(`
      UPDATE people_raw
      SET status = 'pending', attempts = GREATEST(0, attempts - 1), updated_at = NOW()
      WHERE status = 'in_progress'
    `);
    await run();
    return true;
  } finally {
    if (locked) {
      await client.query("SELECT pg_advisory_unlock($1)", [HYDRATION_LOCK_ID]).catch(() => {});
    }
    // Destroy this dedicated connection, including if unlock failed.
    client.release(true);
  }
}

module.exports = { withHydrationLock };
