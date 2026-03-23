const {
  loadEnv,
  getNumberArg,
  createTmdbClient,
  mapWithConcurrency,
} = require("./lib/common");
const { createPool, applySchema } = require("./lib/ingest-db");
const { publishSiteSnapshot } = require("./lib/site-snapshots");

loadEnv();

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  const batchSize = getNumberArg("--batch-size", 200);
  const concurrency = getNumberArg("--concurrency", 4);
  const maxAttempts = getNumberArg("--max-attempts", 3);

  const tmdb = createTmdbClient();
  const pool = createPool();
  await applySchema(pool);

  const queueResult = await pool.query(
    `
      SELECT person_id, attempts
      FROM people_raw
      WHERE status IN ('pending', 'failed')
        AND attempts < $1
      ORDER BY popularity_export DESC NULLS LAST
      LIMIT $2
    `,
    [maxAttempts, batchSize],
  );
  const queue = queueResult.rows;

  if (!queue.length) {
    process.stdout.write("No people queued for hydration.\n");
    await pool.end();
    return;
  }

  process.stdout.write(`Hydrating ${queue.length} people (concurrency=${concurrency})...\n`);

  const runResult = await pool.query(
    "INSERT INTO ingest_runs (run_type, status, notes) VALUES ($1, 'running', $2) RETURNING id",
    ["hydrate-people", `batch_size=${batchSize};concurrency=${concurrency}`],
  );
  const runId = Number(runResult.rows[0].id);

  await pool.query(
    `
      UPDATE people_raw
      SET status = 'in_progress',
          attempts = attempts + 1,
          updated_at = NOW()
      WHERE person_id = ANY($1::bigint[])
    `,
    [queue.map((row) => Number(row.person_id))],
  );

  let successCount = 0;
  let failureCount = 0;
  const failures = [];

  try {
    const results = await mapWithConcurrency(queue, concurrency, async (row) => {
      const personId = Number(row.person_id);
      try {
        const [details, credits] = await Promise.all([
          tmdb(`/person/${personId}`, { language: "en-US" }),
          tmdb(`/person/${personId}/movie_credits`, { language: "en-US" }),
        ]);
        return { ok: true, personId, details, credits };
      } catch (error) {
        return {
          ok: false,
          personId,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    for (const result of results) {
      if (result.ok) {
        await commitPerson(pool, result);
        successCount += 1;
      } else {
        await pool.query(
          `
            UPDATE people_raw
            SET status = 'failed',
                last_error = $1,
                updated_at = NOW()
            WHERE person_id = $2
          `,
          [result.error, result.personId],
        );
        failureCount += 1;
        failures.push(`${result.personId}:${result.error}`);
      }
    }

    if (successCount > 0) {
      try {
        await publishSiteSnapshot(pool);
      } catch (error) {
        process.stderr.write(
          `Snapshot publish failed after hydrate batch: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    }

    const notes = `success=${successCount};failed=${failureCount}${failures.length ? `;errors=${failures.slice(0, 8).join("|")}` : ""}`;
    await pool.query(
      "UPDATE ingest_runs SET finished_at = NOW(), status = 'complete', notes = $1 WHERE id = $2",
      [notes, runId],
    );
    process.stdout.write(`Hydration finished. success=${successCount} failed=${failureCount}\n`);
  } catch (error) {
    await pool.query(
      "UPDATE ingest_runs SET finished_at = NOW(), status = 'failed', notes = $1 WHERE id = $2",
      [`error=${error instanceof Error ? error.message : String(error)}`, runId],
    );
    throw error;
  } finally {
    await pool.end();
  }
}

async function commitPerson(pool, record) {
  const { personId, details, credits } = record;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO people (
          person_id, name, known_for_department, profile_path, popularity, biography,
          birthday, deathday, gender, homepage, imdb_id, tmdb_json, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12::jsonb, NOW()
        )
        ON CONFLICT(person_id) DO UPDATE SET
          name = EXCLUDED.name,
          known_for_department = EXCLUDED.known_for_department,
          profile_path = EXCLUDED.profile_path,
          popularity = EXCLUDED.popularity,
          biography = EXCLUDED.biography,
          birthday = EXCLUDED.birthday,
          deathday = EXCLUDED.deathday,
          gender = EXCLUDED.gender,
          homepage = EXCLUDED.homepage,
          imdb_id = EXCLUDED.imdb_id,
          tmdb_json = EXCLUDED.tmdb_json,
          updated_at = NOW()
      `,
      [
        personId,
        details.name || `Person ${personId}`,
        details.known_for_department || null,
        details.profile_path || null,
        Number(details.popularity || 0),
        details.biography || null,
        details.birthday || null,
        details.deathday || null,
        details.gender || null,
        details.homepage || null,
        details.imdb_id || null,
        JSON.stringify(details),
      ],
    );

    await client.query("DELETE FROM person_movie_credits WHERE person_id = $1", [personId]);
    await upsertCredits(client, personId, credits.cast || [], "cast");
    await upsertCredits(client, personId, credits.crew || [], "crew");

    await client.query(
      `
        UPDATE people_raw
        SET status = 'complete',
            last_error = NULL,
            updated_at = NOW()
        WHERE person_id = $1
      `,
      [personId],
    );

    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failures
    }
    throw error;
  } finally {
    client.release();
  }
}

async function upsertCredits(client, personId, credits, creditType) {
  for (const credit of credits) {
    if (!credit || !Number.isFinite(credit.id)) {
      continue;
    }

    await client.query(
      `
        INSERT INTO movies (
          movie_id, title, original_title, release_date, adult, video, popularity,
          vote_average, vote_count, genre_ids_json, tmdb_json, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10::jsonb, $11::jsonb, NOW()
        )
        ON CONFLICT(movie_id) DO UPDATE SET
          title = EXCLUDED.title,
          original_title = EXCLUDED.original_title,
          release_date = EXCLUDED.release_date,
          adult = EXCLUDED.adult,
          video = EXCLUDED.video,
          popularity = EXCLUDED.popularity,
          vote_average = EXCLUDED.vote_average,
          vote_count = EXCLUDED.vote_count,
          genre_ids_json = EXCLUDED.genre_ids_json,
          tmdb_json = EXCLUDED.tmdb_json,
          updated_at = NOW()
      `,
      [
        Number(credit.id),
        credit.title || credit.original_title || `Movie ${credit.id}`,
        credit.original_title || null,
        credit.release_date || null,
        Boolean(credit.adult),
        Boolean(credit.video),
        Number(credit.popularity || 0),
        Number(credit.vote_average || 0),
        Number(credit.vote_count || 0),
        JSON.stringify(Array.isArray(credit.genre_ids) ? credit.genre_ids : []),
        JSON.stringify(credit),
      ],
    );

    await client.query(
      `
        INSERT INTO person_movie_credits (
          person_id, movie_id, credit_type, credit_id, department, job, character_name, billing_order, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, NOW()
        )
        ON CONFLICT (
          person_id,
          movie_id,
          credit_type,
          credit_id,
          job,
          character_name
        ) DO NOTHING
      `,
      [
        personId,
        Number(credit.id),
        creditType,
        credit.credit_id || null,
        credit.department || null,
        credit.job || null,
        credit.character || null,
        Number.isFinite(credit.order) ? Number(credit.order) : null,
      ],
    );
  }
}
