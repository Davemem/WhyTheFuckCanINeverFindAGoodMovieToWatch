async function publishSiteSnapshot(pool) {
  const [
    actorsTop5,
    actorsTop10,
    directorsTop10,
    producersTop10,
    actorsBrowse,
    directorsBrowse,
    producersBrowse,
    placeholderPools,
    counts,
  ] = await Promise.all([
    fetchRankedPeople(pool, "actors", 5),
    fetchRankedPeople(pool, "actors", 10),
    fetchRankedPeople(pool, "directors", 10),
    fetchRankedPeople(pool, "producers", 10),
    fetchRankedPeople(pool, "actors", 120),
    fetchRankedPeople(pool, "directors", 120),
    fetchRankedPeople(pool, "producers", 120),
    fetchPlaceholderPools(pool),
    fetchCounts(pool),
  ]);

  const payload = {
    actorsTop5,
    actorsTop10,
    directorsTop10,
    producersTop10,
    actorsBrowse,
    directorsBrowse,
    producersBrowse,
    placeholderPools,
    counts,
  };

  await pool.query(
    `
      INSERT INTO site_snapshots (snapshot_key, payload, generated_at)
      VALUES ('home_v1', $1::jsonb, NOW())
      ON CONFLICT (snapshot_key) DO UPDATE SET
        payload = EXCLUDED.payload,
        generated_at = NOW()
    `,
    [JSON.stringify(payload)],
  );

  return payload;
}

async function fetchPlaceholderPools(pool) {
  const [actors, directors, producers] = await Promise.all([
    fetchRankedPeople(pool, "actors", 500),
    fetchRankedPeople(pool, "directors", 500),
    fetchRankedPeople(pool, "producers", 500),
  ]);

  return {
    actors: actors.map((person) => person.name).filter(Boolean),
    directors: directors.map((person) => person.name).filter(Boolean),
    producers: producers.map((person) => person.name).filter(Boolean),
  };
}

async function fetchCounts(pool) {
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(DISTINCT pmc.person_id) FROM person_movie_credits pmc WHERE pmc.credit_type = 'cast')::int AS actors_count,
      (SELECT COUNT(DISTINCT pmc.person_id) FROM person_movie_credits pmc WHERE pmc.credit_type = 'crew' AND pmc.job = 'Director')::int AS directors_count,
      (SELECT COUNT(DISTINCT pmc.person_id) FROM person_movie_credits pmc WHERE pmc.credit_type = 'crew' AND pmc.job ILIKE '%producer%')::int AS producers_count
  `);

  return {
    actors: Number(result.rows[0]?.actors_count || 0),
    directors: Number(result.rows[0]?.directors_count || 0),
    producers: Number(result.rows[0]?.producers_count || 0),
  };
}

async function fetchRankedPeople(pool, role, limit) {
  const roleFilter = roleToSqlFilter(role, "pmc");
  const knownForRoleFilter = roleToSqlFilter(role, "pmc2");
  const result = await pool.query(
    `
      WITH ranked AS (
        SELECT
          p.person_id AS id,
          p.name,
          COALESCE(p.known_for_department, 'Person') AS department,
          p.profile_path,
          COALESCE(p.popularity, 0) AS popularity,
          ROUND((
            SUM(COALESCE(m.vote_average, 0) * GREATEST(COALESCE(m.vote_count, 0), 1))
            / NULLIF(SUM(GREATEST(COALESCE(m.vote_count, 0), 1)), 0)
          )::numeric, 1) AS score
        FROM people p
        JOIN person_movie_credits pmc ON pmc.person_id = p.person_id
        JOIN movies m ON m.movie_id = pmc.movie_id
        WHERE ${roleFilter}
        GROUP BY p.person_id, p.name, p.known_for_department, p.profile_path, p.popularity
        ORDER BY score DESC NULLS LAST, popularity DESC NULLS LAST, p.name ASC
        LIMIT $1
      )
      SELECT
        r.id,
        r.name,
        r.department,
        r.profile_path,
        r.popularity,
        r.score,
        COALESCE((
          SELECT ARRAY(
            SELECT m2.title
            FROM person_movie_credits pmc2
            JOIN movies m2 ON m2.movie_id = pmc2.movie_id
            WHERE pmc2.person_id = r.id AND ${knownForRoleFilter}
            GROUP BY m2.movie_id, m2.title, m2.vote_average, m2.vote_count
            ORDER BY m2.vote_average DESC NULLS LAST, m2.vote_count DESC NULLS LAST
            LIMIT 3
          )
        ), ARRAY[]::text[]) AS known_for
      FROM ranked r
      ORDER BY r.score DESC NULLS LAST, r.popularity DESC NULLS LAST, r.name ASC
    `,
    [limit],
  );

  return result.rows.map((row) => {
    const score = Number.isFinite(Number(row.score)) ? Number(row.score) : null;
    return {
      id: Number(row.id),
      name: row.name,
      department: row.department || "Person",
      score,
      popularity: Number(row.popularity || 0),
      knownFor: Array.isArray(row.known_for) ? row.known_for.filter(Boolean).slice(0, 3) : [],
      profileUrl: row.profile_path ? `https://image.tmdb.org/t/p/w500${row.profile_path}` : "",
      ratingLabel: score ? `Career score ${score.toFixed(1)}` : "Known-for score unavailable",
    };
  });
}

function roleToSqlFilter(role, alias) {
  if (role === "actors") {
    return `${alias}.credit_type = 'cast'`;
  }
  if (role === "directors") {
    return `${alias}.credit_type = 'crew' AND ${alias}.job = 'Director'`;
  }
  return `${alias}.credit_type = 'crew' AND ${alias}.job ILIKE '%producer%'`;
}

module.exports = {
  publishSiteSnapshot,
};
