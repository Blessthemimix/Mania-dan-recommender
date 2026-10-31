import { readFile } from "node:fs/promises";
import { DanProgression } from "./dan-progression.js";

const MANIA_TRACKER_API = "https://api.mania-tracker.com/api";

function validateMap(map) {
  if (!map || typeof map.id !== "string" || typeof map.title !== "string") {
    throw new TypeError("Each map must include string id and title fields.");
  }

  if (!DanProgression.getLevel(map.danLevelId)) {
    throw new Error(`Map ${map.id} has an unknown danLevelId.`);
  }

  return {
    ...map,
    rating: Number.isFinite(map.rating) ? map.rating : null
  };
}

export class JsonMapProvider {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async listMaps() {
    const content = await readFile(this.filePath, "utf8");
    const maps = JSON.parse(content);

    if (!Array.isArray(maps)) {
      throw new TypeError("Map data must be a JSON array.");
    }

    return maps.map(validateMap);
  }
}

export class ApiMapProvider {
  constructor(url, { headers = {} } = {}) {
    this.url = url;
    this.headers = headers;
  }

  async listMaps({ signal } = {}) {
    const response = await fetch(this.url, {
      headers: this.headers,
      signal
    });

    if (!response.ok) {
      throw new Error(`Map API returned HTTP ${response.status}.`);
    }

    const payload = await response.json();
    const maps = Array.isArray(payload) ? payload : payload.maps;

    if (!Array.isArray(maps)) {
      throw new TypeError("Map API response must contain a maps array.");
    }

    return maps.map(validateMap);
  }
}

export class ManiaTrackerMapProvider {
  constructor({
    apiBase = MANIA_TRACKER_API,
    fetchImpl = fetch,
    pageSize = 50
  } = {}) {
    this.apiBase = apiBase.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
    this.pageSize = pageSize;
  }

  async listMaps({ danMin, danMax, skills = [], signal } = {}) {
    const skillFilters = [...new Set(
      skills.filter((skill) => typeof skill === "string" && skill.length > 0)
    )];
    const skillBatches = [skillFilters];
    const mapsByBeatmapId = new Map();

    const requestMaps = async (skillBatch) => {
      const params = new URLSearchParams({
        country: "GLOBAL",
        sort: "length",
        dir: "desc",
        page: "0",
        pageSize: String(this.pageSize),
        keys: "4",
        danKeys: "4",
        danLn: "0"
      });
      if (Number.isFinite(danMin)) params.set("danMin", String(danMin));
      if (Number.isFinite(danMax)) params.set("danMax", String(danMax));
      if (skillBatch.length > 0) params.set("skills", skillBatch.join(","));

      const response = await this.fetchImpl(
        `${this.apiBase}/snapshots/maps-search?${params}`,
        { headers: { Accept: "application/json" }, signal }
      );
      if (response.status === 503 && skillBatch.length > 1) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`Mania Tracker map search failed with HTTP ${response.status}.`);
      }

      const payload = await response.json();
      if (!Array.isArray(payload.items)) {
        throw new TypeError("Mania Tracker map search response must contain an items array.");
      }
      return normalizeMapSearchItems(payload.items);
    };

    const addMaps = (maps) => {
      for (const map of maps) mapsByBeatmapId.set(map.beatmapId, map);
    };

    for (const skillBatch of skillBatches) {
      const maps = await requestMaps(skillBatch);
      if (maps) {
        addMaps(maps);
        continue;
      }

      for (const skill of skillBatch) addMaps(await requestMaps([skill]));
    }

    return [...mapsByBeatmapId.values()];
  }
}

function normalizeMapSearchItems(items) {
  return items.flatMap((entry) => {
    const difficulties = Array.isArray(entry.diffs) && entry.diffs.length > 0
      ? entry.diffs
      : [entry];
    return difficulties.flatMap((difficulty) => {
      const beatmapId = Number(difficulty.beatmapId);
      if (!Number.isSafeInteger(beatmapId) || beatmapId <= 0) return [];

      const title = [difficulty.artist, difficulty.title]
        .filter((part) => typeof part === "string" && part.length > 0)
        .join(" - ");
      return [{
        id: `bm-${beatmapId}`,
        beatmapId,
        title: `${title || "Unknown map"} ${difficulty.version ?? "[Unknown difficulty]"}`,
        artist: difficulty.artist ?? null,
        version: difficulty.version ?? null,
        status: difficulty.status ?? null,
        dan: difficulty.dan ?? null,
        trackerRawDan: Number.isFinite(difficulty.dan?.rawDan)
          ? difficulty.dan.rawDan
          : null,
        trackerDanLabel: typeof difficulty.dan?.label === "string"
          ? difficulty.dan.label
          : null,
        danTiles: Array.isArray(difficulty.danTiles) ? difficulty.danTiles : [],
        patterns: difficulty.patterns ?? {},
        msd: difficulty.msd ?? null,
        stars: Number.isFinite(difficulty.stars) ? difficulty.stars : null,
        bpm: Number.isFinite(difficulty.bpm) ? difficulty.bpm : null,
        length: Number.isFinite(difficulty.length) ? difficulty.length : null,
        playCount: Number.isFinite(difficulty.playCount) ? difficulty.playCount : 0,
        source: "mania-tracker"
      }];
    });
  });
}