// Dumps every mania difficulty in one or more beatmapsets, for picking
// Dan-course beatmap IDs. Usage: node tools/inspect-beatmapset.mjs <id> [id...]

import { getOsuConfig } from "../src/config.js";

const TOKEN_URL = "https://osu.ppy.sh/oauth/token";
const API_BASE = "https://osu.ppy.sh/api/v2";

async function getToken() {
  const config = getOsuConfig();
  if (!config) {
    console.error("OSU_CLIENT_ID/OSU_CLIENT_SECRET missing from .env");
    process.exit(1);
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "client_credentials",
      scope: "public"
    })
  });
  if (!res.ok) {
    console.error("token HTTP", res.status, await res.text());
    process.exit(1);
  }
  return (await res.json()).access_token;
}

const token = await getToken();

async function getBeatmapset(id) {
  const res = await fetch(`${API_BASE}/beatmapsets/${id}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });
  if (!res.ok) {
    console.log(`  (HTTP ${res.status} fetching set ${id})`);
    return null;
  }
  return res.json();
}

for (const id of process.argv.slice(2)) {
  const set = await getBeatmapset(id);
  if (!set) continue;

  console.log(`\n=== ${id}: ${set.artist} - ${set.title} (by ${set.creator}) ===`);
  const maniaDiffs = (set.beatmaps ?? [])
    .filter((b) => b.mode === "mania")
    .sort((a, b) => a.difficulty_rating - b.difficulty_rating);

  for (const b of maniaDiffs) {
    console.log(
      `  [${b.id}] "${b.version}" keys=${b.cs} sr=${b.difficulty_rating.toFixed(2)} ` +
        `combo=${b.max_combo} len=${b.total_length}s`
    );
  }
}
