#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function loadDotEnv() {
  const envPath = path.join(process.cwd(), ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] || null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function runGit(args) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function resolveDeployUrl(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    return new URL(rawUrl);
  } catch {
    throw new Error(`Invalid Render deploy hook URL: ${rawUrl}`);
  }
}

function addCommitQuery(url, commit) {
  if (!commit) {
    return url.toString();
  }

  url.searchParams.set("ref", commit);
  return url.toString();
}

async function triggerDeploy(name, rawUrl, commit) {
  const deployUrl = resolveDeployUrl(rawUrl);

  if (!deployUrl) {
    return null;
  }

  const finalUrl = addCommitQuery(deployUrl, commit);
  const response = await fetch(finalUrl, { method: "POST" });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`${name} deploy failed (${response.status}): ${body || "no response body"}`);
  }

  return {
    name,
    status: response.status,
  };
}

async function main() {
  loadDotEnv();

  const branch = getArgValue("--branch") || runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const commit = getArgValue("--commit") || runGit(["rev-parse", "HEAD"]);
  const skipRemoteCheck = hasFlag("--skip-remote-check");

  if (!skipRemoteCheck) {
    const remoteCommit = runGit(["rev-parse", `origin/${branch}`]);

    if (remoteCommit !== commit) {
      throw new Error(
        [
          `Local HEAD (${commit}) does not match origin/${branch} (${remoteCommit}).`,
          "Push your latest commit first or rerun with --skip-remote-check if that mismatch is intentional.",
        ].join(" "),
      );
    }
  }

  const hookTargets = [
    {
      name: "web",
      url: process.env.RENDER_WEB_DEPLOY_HOOK_URL,
    },
    {
      name: "worker",
      url: process.env.RENDER_WORKER_DEPLOY_HOOK_URL,
    },
  ].filter((target) => target.url);

  if (hookTargets.length === 0) {
    throw new Error(
      "Set RENDER_WEB_DEPLOY_HOOK_URL and/or RENDER_WORKER_DEPLOY_HOOK_URL before running this script.",
    );
  }

  console.log(`Deploying commit ${commit} from ${branch} to Render...`);

  for (const target of hookTargets) {
    const result = await triggerDeploy(target.name, target.url, commit);
    if (result) {
      console.log(`Triggered ${target.name} deploy (${result.status}).`);
    }
  }

  console.log("Render deploy hook trigger complete.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
