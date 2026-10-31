import { readFileSync } from "fs";
import { DanProgression } from "../src/dan-progression.js";

const courses = JSON.parse(readFileSync("data/dan-courses.json", "utf8"));
console.log(`Loaded ${courses.length} course entries.`);

const unknown = [];
const seen = new Set();
for (const c of courses) {
  if (!DanProgression.getLevel(c.danLevelId)) {
    unknown.push(c.danLevelId);
  }
  seen.add(c.danLevelId);
}

if (unknown.length) {
  console.error("UNKNOWN danLevelIds:", [...new Set(unknown)].join(", "));
  process.exit(1);
}

console.log(`All danLevelIds valid. Distinct tiers covered: ${seen.size}`);
console.log("RC tiers covered:", [...seen].filter(id => id.endsWith("-mid") && !id.startsWith("ln")).sort().join(", "));
console.log("LN tiers covered:", [...seen].filter(id => id.startsWith("ln")).sort().join(", "));
