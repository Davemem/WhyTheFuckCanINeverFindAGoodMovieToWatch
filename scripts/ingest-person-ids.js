const {
  loadEnv,
  getNumberArg,
  downloadLatestPersonExportTopByPopularity,
} = require("./lib/common");
const { createPool, applySchema } = require("./lib/ingest-db");

loadEnv();

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  const maxIds = getNumberArg("--max-ids", 100000);
  const pool = createPool();
  await applySchema(pool);

  const { stamp, rows: selected } = await downloadLatestPersonExportTopByPopularity(maxIds);

  process.stdout.write(`Queueing ${selected.length} people from export ${stamp}...\n`);

  const runResult = await pool.query(
    "INSERT INTO ingest_runs (run_type, status, notes) VALUES ($1, 'running', $2) RETURNING id",
    ["ingest-person-ids", `source_export=${stamp}`],
  );
  const runId = Number(runResult.rows[0].id);

  const upsertSql = `
    INSERT INTO people_raw (person_id, adult, popularity_export, source_export_date, status, attempts, last_error, queued_at, updated_at)
    SELECT
      x.person_id,
      x.adult,
      x.popularity_export,
      x.source_export_date,
      'pending',
      0,
      NULL,
      NOW(),
      NOW()
    FROM UNNEST(
      $1::bigint[],
      $2::boolean[],
      $3::double precision[],
      $4::text[]
    ) AS x(person_id, adult, popularity_export, source_export_date)
    ON CONFLICT(person_id) DO UPDATE SET
      adult = EXCLUDED.adult,
      popularity_export = EXCLUDED.popularity_export,
      source_export_date = EXCLUDED.source_export_date,
      status = CASE
        WHEN people_raw.status IN ('complete', 'pending') THEN people_raw.status
        ELSE 'pending'
      END,
      updated_at = NOW();
  `;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const chunkSize = 5000;
    for (let index = 0; index < selected.length; index += chunkSize) {
      const chunk = selected.slice(index, index + chunkSize);
      await client.query(upsertSql, [
        chunk.map((person) => Number(person.id)),
        chunk.map((person) => Boolean(person.adult)),
        chunk.map((person) => Number(person.popularity || 0)),
        chunk.map(() => stamp),
      ]);
    }
    await client.query("COMMIT");

    await pool.query(
      "UPDATE ingest_runs SET finished_at = NOW(), status = 'complete', notes = $1 WHERE id = $2",
      [`queued=${selected.length};source_export=${stamp}`, runId],
    );
    process.stdout.write(`Queued ${selected.length} person IDs.\n`);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    await pool.query(
      "UPDATE ingest_runs SET finished_at = NOW(), status = 'failed', notes = $1 WHERE id = $2",
      [`error=${error instanceof Error ? error.message : String(error)}`, runId],
    );
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
