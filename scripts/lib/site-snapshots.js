async function publishSiteSnapshot(pool) {
  const [actorsRanked, directorsRanked, producersRanked, counts] = await Promise.all([
    fetchRankedPeople(pool, "actors", 500),
    fetchRankedPeople(pool, "directors", 500),
    fetchRankedPeople(pool, "producers", 500),
    fetchCounts(pool),
  ]);

  const actorsTop10 = buildSuggestedPool(actorsRanked, 10, 2);
  const directorsTop10 = buildSuggestedPool(directorsRanked, 10, 2);
  const producersTop10 = buildSuggestedPool(producersRanked, 10, 2);
  const actorsBrowse = buildSuggestedPool(actorsRanked, 50, 10);
  const directorsBrowse = buildSuggestedPool(directorsRanked, 50, 10);
  const producersBrowse = buildSuggestedPool(producersRanked, 50, 10);
  const placeholderPools = {
    actors: actorsRanked.map((person) => person.name).filter(Boolean),
    directors: directorsRanked.map((person) => person.name).filter(Boolean),
    producers: producersRanked.map((person) => person.name).filter(Boolean),
  };
  const actorsTop5 = actorsTop10.slice(0, 5);

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
          COUNT(DISTINCT m.movie_id)::int AS credit_count,
          ROUND((
            SUM(COALESCE(m.vote_average, 0) * GREATEST(COALESCE(m.vote_count, 0), 1))
            / NULLIF(SUM(GREATEST(COALESCE(m.vote_count, 0), 1)), 0)
          )::numeric, 1) AS score
        FROM people p
        JOIN person_movie_credits pmc ON pmc.person_id = p.person_id
        JOIN movies m ON m.movie_id = pmc.movie_id
        WHERE ${roleFilter}
        GROUP BY p.person_id, p.name, p.known_for_department, p.profile_path, p.popularity
        ORDER BY score DESC NULLS LAST, credit_count DESC NULLS LAST, popularity DESC NULLS LAST, p.name ASC
        LIMIT $1
      )
      SELECT
        r.id,
        r.name,
        r.department,
        r.profile_path,
        r.popularity,
        r.credit_count,
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
      ORDER BY r.score DESC NULLS LAST, r.credit_count DESC NULLS LAST, r.popularity DESC NULLS LAST, r.name ASC
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
      creditCount: Number(row.credit_count || 0),
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

function buildSuggestedPool(people, limit, wildcardCount = 2) {
  const ranked = [...people];
  const preferred = ranked.filter((person) => {
    const score = Number(person.score);
    return Number.isFinite(score) && score >= 7 && score <= 9.5 && Number(person.creditCount || 0) >= 2;
  });
  const wildcards = ranked.filter((person) => !preferred.some((candidate) => candidate.id === person.id));
  const preferredTarget = Math.max(0, limit - Math.min(wildcardCount, limit));
  const result = [...preferred.slice(0, preferredTarget)];

  for (const person of wildcards) {
    if (result.length >= limit) {
      break;
    }
    result.push(person);
  }

  if (result.length < limit) {
    for (const person of preferred.slice(preferredTarget)) {
      if (result.length >= limit || result.some((candidate) => candidate.id === person.id)) {
        continue;
      }
      result.push(person);
    }
  }

  return result.slice(0, limit);
}

module.exports = {
  publishSiteSnapshot,
};
