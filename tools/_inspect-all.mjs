import { getOsuConfig } from "../src/config.js";

const cfg = getOsuConfig();
const r = await fetch("https://osu.ppy.sh/oauth/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "client_credentials", scope: "public" })
});
const token = (await r.json()).access_token;

const ids = [891143,891152,891157,891164,1116467,1156299,1575457,2234779,2243057,2316976,2316993,2317095,2320002,2340696,2341589,2341590,2451651,2454019,2455713,2458391];

for (const id of ids) {
  const res = await fetch(`https://osu.ppy.sh/api/v2/beatmapsets/${id}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });
  if (!res.ok) { console.log(`${id} -> HTTP ${res.status}`); continue; }
  const s = await res.json();
  const all = (s.beatmaps ?? []).filter(b => b.mode === "mania").sort((a, b) => a.difficulty_rating - b.difficulty_rating);
  if (all.length === 0) { console.log(`${id} "${s.title}" | NO mania diffs`); continue; }
  console.log(`\n=== ${id}: ${s.title} (by ${s.creator}) ===`);
  for (const b of all) {
    console.log(`  [${b.id}] "${b.version}" keys=${b.cs} sr=${b.difficulty_rating.toFixed(2)} combo=${b.max_combo} len=${b.total_length}s`);
  }
}
