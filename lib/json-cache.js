"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

function createJsonCache({ directory, memory }) {
  const pending = new Map();
  const filename = (key) => path.join(directory, `${crypto.createHash("sha1").update(key).digest("hex")}.json`);

  async function read(key) {
    try {
      const entry = JSON.parse(await fs.readFile(filename(key), "utf8"));
      return Number.isFinite(entry?.expiresAt) && entry.expiresAt > Date.now() ? entry : null;
    } catch {
      return null;
    }
  }

  async function write(key, entry) {
    const destination = filename(key);
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(entry));
      await fs.rename(temporary, destination);
    } catch {
      // Caching is optional; a full or read-only disk must not fail a request.
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
  }

  async function getOrLoad(key, loader, ttlMs) {
    const cached = memory.get(key);
    if (cached?.expiresAt > Date.now()) return cached.value;
    if (pending.has(key)) return pending.get(key);

    const request = (async () => {
      const disk = await read(key);
      if (disk) {
        memory.set(key, disk);
        return disk.value;
      }
      const value = await loader();
      const entry = { value, expiresAt: Date.now() + ttlMs };
      memory.set(key, entry);
      await write(key, entry);
      return value;
    })();
    pending.set(key, request);
    try {
      return await request;
    } finally {
      pending.delete(key);
    }
  }

  return { read, write, getOrLoad };
}

module.exports = { createJsonCache };
