import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const projectRoot = resolve(import.meta.dirname, "..");

if (existsSync(resolve(projectRoot, ".env"))) {
  process.loadEnvFile(resolve(projectRoot, ".env"));
}

export function getDiscordConfig() {
  const token = process.env.DISCORD_TOKEN?.trim();
  const appId = process.env.DISCORD_APP_ID?.trim();
  const guildId = process.env.DISCORD_GUILD_ID?.trim() || null;

  if (!token || !appId) {
    throw new Error(
      "Missing DISCORD_TOKEN or DISCORD_APP_ID. Copy .env.example to .env and fill them in."
    );
  }

  return { token, appId, guildId };
}

export const dataPaths = {
  maps: resolve(projectRoot, "data", "maps.json"),
  profiles: resolve(projectRoot, "data", "profiles.json"),
  danCourses: resolve(projectRoot, "data", "dan-courses.json")
};

/** Returns null when OSU_API_KEY isn't set � osu! tracking is optional. */
export function getOsuApiKey() {
  return process.env.OSU_API_KEY?.trim() || null;
}