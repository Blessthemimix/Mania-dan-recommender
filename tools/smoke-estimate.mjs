// Usage:
//   node tools/smoke-estimate.mjs                  -> runs on a synthetic 4K stream map
//   node tools/smoke-estimate.mjs path\to\map.osu  -> runs on a real map

import { readFile } from "node:fs/promises";
import { estimateMap } from "../src/map-estimator.js";

function syntheticMap() {
  const lines = [
    "osu file format v14",
    "",
    "[General]",
    "Mode: 3",
    "",
    "[Metadata]",
    "Title:Synthetic",
    "Version:Smoke",
    "",
    "[Difficulty]",
    "HPDrainRate:8",
    "CircleSize:4",
    "OverallDifficulty:8",
    "ApproachRate:5",
    "SliderMultiplier:1.4",
    "SliderTickRate:1",
    "",
    "[TimingPoints]",
    "0,500,4,1,0,100,1,0",
    "",
    "[HitObjects]"
  ];

  const pattern = [0, 2, 1, 3, 0, 3, 1, 2];
  for (let i = 0; i < 2000; i += 1) {
    const column = pattern[i % pattern.length];
    const x = Math.floor((column * 512) / 4) + 64;
    lines.push(`${x},192,${1000 + i * 125},1,0,0:0:0:0:`);
  }

  return lines.join("\n");
}

const path = process.argv[2];
const osuText = path ? await readFile(path, "utf8") : syntheticMap();

console.log(JSON.stringify(estimateMap(osuText), null, 2));
