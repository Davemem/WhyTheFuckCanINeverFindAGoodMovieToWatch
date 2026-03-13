const { loadEnv } = require("./lib/common");
const { createPool, applySchema } = require("./lib/ingest-db");
const { publishSiteSnapshot } = require("./lib/site-snapshots");

loadEnv();

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  const pool = createPool();
  await applySchema(pool);

  try {
    const payload = await publishSiteSnapshot(pool);

    process.stdout.write(
      `Published site snapshot. actors5=${payload.actorsTop5.length} actors10=${payload.actorsTop10.length} directors10=${payload.directorsTop10.length} producers10=${payload.producersTop10.length}\n`,
    );
  } finally {
    await pool.end();
  }
}
