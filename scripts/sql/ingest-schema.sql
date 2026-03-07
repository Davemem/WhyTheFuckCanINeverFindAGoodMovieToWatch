CREATE TABLE IF NOT EXISTS ingest_runs (
  id BIGSERIAL PRIMARY KEY,
  run_type TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS people_raw (
  person_id BIGINT PRIMARY KEY,
  adult BOOLEAN,
  popularity_export DOUBLE PRECISION,
  source_export_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_people_raw_status ON people_raw(status, popularity_export DESC);
CREATE INDEX IF NOT EXISTS idx_people_raw_updated_at ON people_raw(updated_at);

CREATE TABLE IF NOT EXISTS people (
  person_id BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  known_for_department TEXT,
  profile_path TEXT,
  popularity DOUBLE PRECISION,
  biography TEXT,
  birthday TEXT,
  deathday TEXT,
  gender INTEGER,
  homepage TEXT,
  imdb_id TEXT,
  tmdb_json JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS movies (
  movie_id BIGINT PRIMARY KEY,
  title TEXT NOT NULL,
  original_title TEXT,
  release_date TEXT,
  adult BOOLEAN,
  video BOOLEAN,
  popularity DOUBLE PRECISION,
  vote_average DOUBLE PRECISION,
  vote_count INTEGER,
  genre_ids_json JSONB,
  tmdb_json JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS person_movie_credits (
  id BIGSERIAL PRIMARY KEY,
  person_id BIGINT NOT NULL REFERENCES people(person_id) ON DELETE CASCADE,
  movie_id BIGINT NOT NULL REFERENCES movies(movie_id) ON DELETE CASCADE,
  credit_type TEXT NOT NULL,
  credit_id TEXT,
  department TEXT,
  job TEXT,
  character_name TEXT,
  billing_order INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_person_movie_credit_unique
ON person_movie_credits (
  person_id,
  movie_id,
  credit_type,
  credit_id,
  job,
  character_name
);

CREATE INDEX IF NOT EXISTS idx_person_movie_credits_person ON person_movie_credits(person_id);
CREATE INDEX IF NOT EXISTS idx_person_movie_credits_movie ON person_movie_credits(movie_id);
