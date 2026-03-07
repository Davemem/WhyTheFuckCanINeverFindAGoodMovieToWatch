const { execFile } = require("node:child_process");
const path = require("node:path");
const { loadEnv, getNumberArg } = require("./lib/common");
const { createPool, applySchema } = require("./lib/ingest-db");

loadEnv();

const projectRoot = path.resolve(__dirname, "..");

const ingestEveryHours = getNumberArg("--ingest-every-hours", 24);
const pollSeconds = getNumberArg("--poll-seconds", 30);
const hydrateBatchSize = getNumberArg("--batch-size", 500);
const hydrateConcurrency = getNumberArg("--concurrency", 6);
const hydrateMaxAttempts = getNumberArg("--max-attempts", 4);
const ingestMaxIds = getNumberArg("--max-ids", 100000);

let nextIngestAt = 0;

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  process.stdout.write("Starting automatic people pipeline worker...\n");
  const pool = createPool();
  await applySchema(pool);
  await pool.end();

  nextIngestAt = Date.now();

  while (true) {
    try {
      if (Date.now() >= nextIngestAt) {
        const ingestArgs = [`--max-ids=${ingestMaxIds}`];
        await runScript("ingest-person-ids.js", ingestArgs);
        nextIngestAt = Date.now() + ingestEveryHours * 60 * 60 * 1000;
        process.stdout.write(
          `Next ingest scheduled in ${ingestEveryHours} hour(s) at ${new Date(nextIngestAt).toISOString()}\n`,
        );
      }

      const pendingCount = await countPending();
      if (pendingCount > 0) {
        process.stdout.write(`Pending queue: ${pendingCount}. Running hydrate batch...\n`);
        await runScript("hydrate-people.js", [
          `--batch-size=${hydrateBatchSize}`,
          `--concurrency=${hydrateConcurrency}`,
          `--max-attempts=${hydrateMaxAttempts}`,
        ]);
        continue;
      }

      process.stdout.write(`Queue empty. Sleeping ${pollSeconds}s...\n`);
      await sleep(pollSeconds * 1000);
    } catch (error) {
      process.stderr.write(
        `Worker cycle failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      await sleep(Math.max(10, pollSeconds) * 1000);
    }
  }
}

function runScript(scriptName, args = []) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(projectRoot, "scripts", scriptName);
    const child = execFile("node", [scriptPath, ...args], { cwd: projectRoot });

    child.stdout.on("data", (chunk) => {
      process.stdout.write(String(chunk));
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(String(chunk));
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${scriptName} exited with code ${code}`));
    });
  });
}

async function countPending() {
  const pool = createPool();
  try {
    const result = await pool.query(
      `
        SELECT COUNT(*)::bigint AS total
        FROM people_raw
        WHERE status IN ('pending', 'failed')
          AND attempts < $1
      `,
      [hydrateMaxAttempts],
    );
    return Number(result.rows[0]?.total || 0);
  } finally {
    await pool.end();
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
