import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { JsonMapProvider } from "./map-provider.js";
import { JsonProfileStore } from "./json-profile-store.js";
import { RecommendationEngine } from "./recommendation-engine.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const userId = process.env.USER_ID ?? "demo-user";

const profileStore = new JsonProfileStore(
  resolve(projectRoot, "data", "profiles.json")
);
const mapProvider = new JsonMapProvider(
  resolve(projectRoot, "data", "maps.json")
);

const profile = await profileStore.load(userId);
const engine = new RecommendationEngine(mapProvider, {
  maxLevelsAbove: 5,
  targetLevelsAbove: 1.25
});

const recommendations = await engine.recommend(profile, { limit: 10 });

console.log(`Recommendations for ${userId}:`);
for (const map of recommendations) {
  console.log(
    `${map.danLevel} | ${map.title} | score ${map.score} | ${map.id}`
  );
}

await profileStore.save(profile);