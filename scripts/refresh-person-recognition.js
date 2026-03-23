const {
  loadEnv,
  getNumberArg,
  createTmdbClient,
} = require("./lib/common");
const { createPool, applySchema } = require("./lib/ingest-db");

loadEnv();

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  const popularPages = getNumberArg("--popular-pages", 20);
  const trendingPages = getNumberArg("--trending-pages", 10);

  const tmdb = createTmdbClient();
  const pool = createPool();
  await applySchema(pool);

  const runResult = await pool.query(
    "INSERT INTO ingest_runs (run_type, status, notes) VALUES ($1, 'running', $2) RETURNING id",
    ["refresh-person-recognition", `popular_pages=${popularPages};trending_pages=${trendingPages}`],
  );
  const runId = Number(runResult.rows[0].id);

  try {
    const recognitionMap = new Map();

    await ingestPopular(tmdb, popularPages, recognitionMap);
    await ingestTrending(tmdb, trendingPages, recognitionMap);

    const rows = [...recognitionMap.values()]
      .map((entry) => ({
        personId: entry.personId,
        popularRank: entry.popularRank ?? null,
        trendingRank: entry.trendingRank ?? null,
        recognitionScore: buildRecognitionScore(entry),
        sourceJson: JSON.stringify({
          popularRank: entry.popularRank ?? null,
          trendingRank: entry.trendingRank ?? null,
          popularity: entry.popularity ?? 0,
          knownForDepartment: entry.knownForDepartment || null,
          name: entry.name || null,
        }),
      }))
      .filter((entry) => Number.isFinite(entry.personId));

    await pool.query("DELETE FROM person_recognition");

    const chunkSize = 1000;
    for (let index = 0; index < rows.length; index += chunkSize) {
      const chunk = rows.slice(index, index + chunkSize);
      await pool.query(
        `
          INSERT INTO person_recognition (
            person_id, popular_rank, trending_rank, recognition_score, source_json, updated_at
          )
          SELECT
            x.person_id,
            x.popular_rank,
            x.trending_rank,
            x.recognition_score,
            x.source_json::jsonb,
            NOW()
          FROM UNNEST(
            $1::bigint[],
            $2::integer[],
            $3::integer[],
            $4::double precision[],
            $5::text[]
          ) AS x(person_id, popular_rank, trending_rank, recognition_score, source_json)
          ON CONFLICT (person_id) DO UPDATE SET
            popular_rank = EXCLUDED.popular_rank,
            trending_rank = EXCLUDED.trending_rank,
            recognition_score = EXCLUDED.recognition_score,
            source_json = EXCLUDED.source_json,
            updated_at = NOW()
        `,
        [
          chunk.map((entry) => entry.personId),
          chunk.map((entry) => entry.popularRank),
          chunk.map((entry) => entry.trendingRank),
          chunk.map((entry) => entry.recognitionScore),
          chunk.map((entry) => entry.sourceJson),
        ],
      );
    }

    await pool.query(
      "UPDATE ingest_runs SET finished_at = NOW(), status = 'complete', notes = $1 WHERE id = $2",
      [`rows=${rows.length};popular_pages=${popularPages};trending_pages=${trendingPages}`, runId],
    );
    process.stdout.write(`Refreshed person recognition. rows=${rows.length}\n`);
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

async function ingestPopular(tmdb, pageCount, recognitionMap) {
  for (let page = 1; page <= pageCount; page += 1) {
    const payload = await tmdb("/person/popular", {
      language: "en-US",
      page,
    });

    (payload.results || []).forEach((person, index) => {
      const personId = Number(person.id);
      if (!Number.isFinite(personId)) {
        return;
      }
      const rank = (page - 1) * 20 + index + 1;
      const current = recognitionMap.get(personId) || {
        personId,
        name: person.name || null,
        knownForDepartment: person.known_for_department || null,
        popularity: Number(person.popularity || 0),
      };
      current.popularRank = rank;
      current.popularity = Math.max(Number(current.popularity || 0), Number(person.popularity || 0));
      recognitionMap.set(personId, current);
    });
  }
}

async function ingestTrending(tmdb, pageCount, recognitionMap) {
  for (let page = 1; page <= pageCount; page += 1) {
    const payload = await tmdb("/trending/person/week", {
      language: "en-US",
      page,
    });

    (payload.results || []).forEach((person, index) => {
      const personId = Number(person.id);
      if (!Number.isFinite(personId)) {
        return;
      }
      const rank = (page - 1) * 20 + index + 1;
      const current = recognitionMap.get(personId) || {
        personId,
        name: person.name || null,
        knownForDepartment: person.known_for_department || null,
        popularity: Number(person.popularity || 0),
      };
      current.trendingRank = rank;
      current.popularity = Math.max(Number(current.popularity || 0), Number(person.popularity || 0));
      recognitionMap.set(personId, current);
    });
  }
}

function buildRecognitionScore(entry) {
  const popularScore = entry.popularRank ? Math.max(0, 1000 - entry.popularRank) : 0;
  const trendingScore = entry.trendingRank ? Math.max(0, 600 - entry.trendingRank) : 0;
  const popularityScore = Math.log10(Number(entry.popularity || 0) + 10) * 30;
  return Number((popularScore + trendingScore + popularityScore).toFixed(3));
}
