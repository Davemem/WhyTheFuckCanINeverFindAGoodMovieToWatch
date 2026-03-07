const { loadEnv } = require("./lib/common");
const { createPool, applySchema } = require("./lib/ingest-db");

loadEnv();

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  const pool = createPool();
  try {
    await applySchema(pool);
    process.stdout.write("Initialized Postgres ingestion schema.\n");
  } finally {
    await pool.end();
  }
}
