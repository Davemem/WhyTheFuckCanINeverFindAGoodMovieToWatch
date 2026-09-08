"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const sourceDirectories = new Set(["lib", "scripts", "test", "test-support"]);
function check(directory, topLevel = false) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory() && (!topLevel || sourceDirectories.has(entry.name))) check(filename);
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const result = spawnSync(process.execPath, ["--check", filename], { stdio: "inherit" });
    if (result.error || result.status !== 0) process.exitCode = 1;
  }
}
check(root, true);
