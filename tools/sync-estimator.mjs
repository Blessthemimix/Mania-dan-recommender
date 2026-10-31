// Vendors the osumania_map_analyser estimator (and everything it imports)
// into src/vendor/mania-analyser/, pinned to a fixed upstream commit.
//
// Usage: node tools/sync-estimator.mjs
//
// Upstream: https://github.com/LeoBlackMT/osumania_map_analyser (MIT, (c) 2026 Leo_Black)

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, posix } from "node:path";
import { fileURLToPath } from "node:url";

const COMMIT = "bc5e8c6f7801f58efaec22cb492a7aa9dd7e5945";
const UPSTREAM_ROOT = "ManiaMapAnalyser by Leo_Black/js";
const RAW_BASE = `https://raw.githubusercontent.com/LeoBlackMT/osumania_map_analyser/${COMMIT}`;

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = resolve(projectRoot, "src", "vendor", "mania-analyser");

// Entry points (paths relative to upstream js/).
const ENTRIES = [
  "estimator/sunnyEstimator.js",
  "estimator/danielEstimator.js",
  "estimator/mixedEstimator.js",
];

const IMPORT_RE = /["'](\.{1,2}\/[^"'\s]+\.(?:m?js|json))["']/g;

const seen = new Set();
const queue = [...ENTRIES];
const failed = [];

while (queue.length) {
  const rel = queue.shift();
  if (seen.has(rel)) continue;
  seen.add(rel);

  const url = `${RAW_BASE}/${encodeURI(`${UPSTREAM_ROOT}/${rel}`)}`;
  const res = await fetch(url);
  if (!res.ok) {
    failed.push(`${rel} (HTTP ${res.status})`);
    continue;
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const outPath = resolve(outRoot, ...rel.split("/"));
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, buf);

  const text = buf.toString("utf8");
  for (const match of text.matchAll(IMPORT_RE)) {
    const next = posix.normalize(posix.join(posix.dirname(rel), match[1]));
    if (!seen.has(next)) queue.push(next);
  }
}

console.log(`Fetched ${seen.size - failed.length} files into ${outRoot}`);
for (const rel of [...seen].sort()) console.log("  " + rel);
if (failed.length) {
  console.log("\nFailed:");
  for (const f of failed) console.log("  " + f);
  process.exitCode = 1;
}
