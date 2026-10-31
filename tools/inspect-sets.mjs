import { getOsuApiKey } from "../src/config.js";

async function getSet(setId) {
  const url = `https://osu.ppy.sh/api/get_beatmaps?k=${getOsuApiKey()}&s=${setId}&limit=50`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  return r.json();
}

const SET_IDS = [
  1575457, 2341589, 2341590, 2458391, 2455713, 2454019, 2451651,
  2234779, 1156299,
  2317095, 2316993, 2316976, 2320002,
  2340696, 2243057, 1116467,
  891164, 891157, 891152, 891143
];

for (const setId of SET_IDS) {
  const maps = await getSet(setId);
  if (!maps || maps.length === 0) { console.log(`SET ${setId}: EMPTY`); continue; }
  const mania = maps.filter(m => m.mode === "3");
  console.log(`\nSET ${setId}:`);
  if (mania.length === 0) {
    console.log(`  (mode=${maps[0].mode}, not mania?) versions: ${maps.map(m=>m.version).join(", ")}`);
  }
  for (const m of mania) {
    console.log(`  [${m.beatmap_id}] "${m.version}" cs=${m.diff_size} sr=${parseFloat(m.difficultyrating).toFixed(2)} combo=${m.max_combo} len=${m.hit_length}s`);
  }
}
