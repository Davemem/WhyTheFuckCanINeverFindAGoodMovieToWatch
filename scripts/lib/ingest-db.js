const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

const { projectRoot } = require("./common");

const schemaPath = path.join(projectRoot, "scripts/sql/ingest-schema.sql");

function createPool() {
  const connectionString = process.env.DATABASE_URL || "";
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for Postgres ingestion.");
  }

  return new Pool({
    connectionString,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  });
}

async function applySchema(pool) {
  const sql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(sql);
}

function shouldUseSsl(connectionString) {
  try {
    const url = new URL(connectionString);
    if (url.searchParams.get("sslmode") === "disable") {
      return false;
    }
    return url.hostname !== "localhost" && url.hostname !== "127.0.0.1";
  } catch {
    return true;
  }
}

module.exports = {
  createPool,
  applySchema,
};
