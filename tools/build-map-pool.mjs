// Builds data/maps.json from a list of osu! beatmap IDs.
//
// Usage:
//   1. Put beatmap IDs (the number in osu.ppy.sh/b/<id>), one per line, in data/map-ids.txt
//      Lines starting with # are ignored.
//   2. npm run build:pool
//
// Each .osu file is downloaded once into .cache/osu/ and re-used on later runs.
// Only 4K maps that the estimator can place on the Dan scale are kept.
// WARNING: this overwrites data/maps.json.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { projectRoot, dataPaths } from "../src/config.js";
import { estimateMap } from "../src/map-estimator.js";

const idsPath = resolve(projectRoot, "data", "map-ids.txt");
const cacheDir = resolve(projectRoot, ".cache", "osu");
const DOWNLOAD_DELAY_MS = 1500;

if (!existsSync(idsPath)) {
  console.error(`Missing ${idsPath}. Create it with one beatmap ID per line.`);
  process.exit(1);
}

const ids = [
  ...new Set(
    (await readFile(idsPath, "utf8"))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
  )
];

await mkdir(cacheDir, { recursive: true });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function loadOsuFile(id) {
  const cached = resolve(cacheDir, `${id}.osu`);
  if (existsSync(cached)) {
    return readFile(cached, "utf8");
  }

  const response = await fetch(`https://osu.ppy.sh/osu/${id}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  await writeFile(cached, text, "utf8");
  await sleep(DOWNLOAD_DELAY_MS);
  return text;
}

function metadataValue(text, key) {
  return text.match(new RegExp(`^${key}:(.*)$`, "m"))?.[1].trim() ?? "";
}

const maps = [];
const skipped = [];

for (const id of ids) {
  try {
    const text = await loadOsuFile(id);
    const result = estimateMap(text);

    if (!result.supported) {
      skipped.push(`${id}: not a supported 4K map (${result.columnCount}K, ${result.label})`);
      continue;
    }

    const artist = metadataValue(text, "Artist");
    const title = metadataValue(text, "Title");
    const version = metadataValue(text, "Version");

    maps.push({
      id: `bm-${id}`,
      beatmapId: Number(id),
      title: `${artist} - ${title} [${version}]`.slice(0, 120),
      danLevelId: result.danLevel.id,
      estimate: result.label,
      numeric: result.numeric,
      algorithm: result.algorithm,
      rating: null
    });

    console.log(`${id}: ${result.label} -> ${result.danLevel.label}`);
  } catch (error) {
    skipped.push(`${id}: ${error.message}`);
  }
}

if (maps.length === 0) {
  console.error("No maps could be processed; data/maps.json was left untouched.");
  process.exit(1);
}

await writeFile(dataPaths.maps, `${JSON.stringify(maps, null, 2)}\n`, "utf8");
console.log(`\nWrote ${maps.length} maps to ${dataPaths.maps}`);

if (skipped.length) {
  console.log(`\nSkipped ${skipped.length}:`);
  for (const line of skipped) console.log(`  ${line}`);
}
