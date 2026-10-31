import { getOsuApiKey } from "./config.js";

// osu! Legacy API v1 - simpler and more reliable than OAuth2 for read-only public data
const API_BASE = "https://osu.ppy.sh/api";
const MANIA_MODE = 3;

const beatmapCache = new Map();

function apiKey() {
  const key = getOsuApiKey();
  if (!key) {
    throw new Error(
      "osu! API is not configured. Set OSU_API_KEY in .env " +
      "(from https://osu.ppy.sh/home/account/edit -> Legacy API)."
    );
  }
  return key;
}

async function apiGet(endpoint, params = {}) {
  const url = new URL(`${API_BASE}/${endpoint}`);
  url.searchParams.set("k", apiKey());
  url.searchParams.set("m", String(MANIA_MODE));
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`osu! API ${endpoint} failed with HTTP ${response.status}`);
  }

  return response.json();
}

/** Resolves an osu! username to a mania user id. Returns null if not found. */
export async function lookupOsuUser(username) {
  const users = await apiGet("get_user", { u: username, type: "string" });
  if (!users || users.length === 0) return null;
  const u = users[0];
  return { id: Number(u.user_id), username: u.username };
}

/**
 * The best score a user has set on a beatmap (mania mode), or null if none.
 */
export async function getBestScore(beatmapId, osuUserId) {
  const scores = await apiGet("get_scores", { b: beatmapId, u: osuUserId, type: "id", limit: 1 });
  if (!scores || scores.length === 0) return null;

  const s = scores[0];
  return {
    passed: true, // legacy API only returns passed scores
    countMiss: Number(s.countmiss ?? 0),
    maxCombo: Number(s.maxcombo ?? 0),
    accuracy: null // can compute if needed
  };
}

function normalizeUserScores(scores) {
  return (scores ?? []).map((score) => {
    const count50 = Number(score.count50 ?? 0);
    const count100 = Number(score.count100 ?? 0);
    const count300 = Number(score.count300 ?? 0);
    const countMiss = Number(score.countmiss ?? 0);
    const countKatu = Number(score.countkatu ?? 0);
    const countGeki = Number(score.countgeki ?? 0);
    const total = count50 + count100 + count300 + countMiss + countKatu + countGeki;
    const accuracy = total > 0
      ? (count50 + 2 * count100 + 4 * countKatu + 6 * count300 + 6 * countGeki) / (6 * total)
      : null;

    return {
      scoreId: String(score.score_id),
      beatmapId: Number(score.beatmap_id),
      passed: score.rank !== "F",
      countMiss,
      maxCombo: Number(score.maxcombo ?? 0),
      mods: Number(score.enabled_mods ?? score.mods ?? 0),
      accuracy
    };
  }).filter((score) =>
    score.scoreId !== "undefined" &&
    Number.isFinite(score.beatmapId) &&
    Number.isFinite(score.countMiss) &&
    Number.isFinite(score.maxCombo)
  );
}

/** Best plays include older clears; unlike per-map lookups, this finds plays on unranked maps. */
export async function getUserBestScores(osuUserId) {
  const scores = await apiGet("get_user_best", {
    u: osuUserId,
    type: "id",
    limit: 100
  });
  return normalizeUserScores(scores);
}

/** Recent plays include unranked maps and failed attempts. */
export async function getUserRecentScores(osuUserId) {
  const scores = await apiGet("get_user_recent", {
    u: osuUserId,
    type: "id",
    limit: 50
  });
  return normalizeUserScores(scores);
}

const beatmapFileCache = new Map();
let beatmapFileQueue = Promise.resolve();
let lastBeatmapFileRequestAt = 0;

/** Downloads a beatmap's .osu file for the local difficulty estimator. */
export async function getBeatmapFile(beatmapId) {
  if (beatmapFileCache.has(beatmapId)) {
    return beatmapFileCache.get(beatmapId);
  }

  const request = beatmapFileQueue.then(async () => {
    const waitMs = 1000 - (Date.now() - lastBeatmapFileRequestAt);
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    lastBeatmapFileRequestAt = Date.now();
    const response = await fetch(`https://osu.ppy.sh/osu/${beatmapId}`);
    if (!response.ok) {
      throw new Error(`osu! beatmap download failed with HTTP ${response.status}`);
    }

    return response.text();
  });
  beatmapFileCache.set(beatmapId, request);
  beatmapFileQueue = request.catch(() => {});

  try {
    return await request;
  } catch (error) {
    beatmapFileCache.delete(beatmapId);
    throw error;
  }
}

/** Beatmap metadata needed for near-clear combo estimates. Cached per run. */
export async function getBeatmapInfo(beatmapId) {
  if (beatmapCache.has(beatmapId)) {
    return beatmapCache.get(beatmapId);
  }

  const maps = await apiGet("get_beatmaps", { b: beatmapId, limit: 1 });
  const info = (maps && maps.length > 0)
    ? { maxCombo: Number(maps[0].max_combo ?? 0) }
    : null;
  beatmapCache.set(beatmapId, info);
  return info;
}

/** List all mania difficulties in a beatmapset. */
export async function getBeatmapsetMaps(setId) {
  const maps = await apiGet("get_beatmaps", { s: setId });
  return (maps ?? []).map(m => ({
    beatmapId: Number(m.beatmap_id),
    version: m.version,
    starRating: parseFloat(m.difficultyrating ?? 0),
    maxCombo: Number(m.max_combo ?? 0),
    hitLength: Number(m.hit_length ?? 0),
    totalLength: Number(m.total_length ?? 0),
    cs: Number(m.diff_size ?? 4) // key count in mania
  }));
}
