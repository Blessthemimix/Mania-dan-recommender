import test from "node:test";
import assert from "node:assert/strict";
import { ManiaTrackerMapProvider } from "../src/map-provider.js";
import { RecommendationEngine } from "../src/recommendation-engine.js";
import { UserProfile } from "../src/user-profile.js";
import { DanProgression } from "../src/dan-progression.js";

test("Mania Tracker map provider requests global 4K RC maps and flattens difficulties", async () => {
  const requestUrls = [];
  const provider = new ManiaTrackerMapProvider({
    pageSize: 20,
    fetchImpl: async (url) => {
      requestUrls.push(new URL(url));
      return {
        ok: true,
        json: async () => ({
          items: [{
            diffs: [{
              beatmapId: 123,
              title: "Test song",
              artist: "Tester",
              version: "4K",
              dan: { label: "10+", rawDan: 10.2 },
              danTiles: ["jack"],
              playCount: 1234
            }]
          }]
        })
      };
    }
  });

  const maps = await provider.listMaps({
    danMin: 9,
    danMax: 12,
    skills: ["jack", "speed", "jack"]
  });
  const requestUrl = requestUrls[0];
  assert.equal(requestUrls.length, 1);
  assert.equal(requestUrl.pathname, "/api/snapshots/maps-search");
  assert.equal(requestUrl.searchParams.get("country"), "GLOBAL");
  assert.equal(requestUrl.searchParams.get("keys"), "4");
  assert.equal(requestUrl.searchParams.get("danKeys"), "4");
  assert.equal(requestUrl.searchParams.get("danLn"), "0");
  assert.equal(requestUrl.searchParams.get("danMin"), "9");
  assert.equal(requestUrl.searchParams.get("danMax"), "12");
  assert.equal(requestUrl.searchParams.get("sort"), "length");
  assert.equal(requestUrl.searchParams.get("skills"), "jack,speed");
  assert.equal(maps[0].id, "bm-123");
  assert.equal(maps[0].title, "Tester - Test song 4K");
  assert.equal(maps[0].trackerRawDan, 10.2);
  assert.deepEqual(maps[0].danTiles, ["jack"]);
});

test("Mania Tracker map provider retries unsupported multi-skill filters individually", async () => {
  const requestedSkills = [];
  const provider = new ManiaTrackerMapProvider({
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      const skills = parsed.searchParams.get("skills");
      requestedSkills.push(skills);
      if (skills === "jack,speed") return { status: 503, ok: false };
      return {
        status: 200,
        ok: true,
        json: async () => ({
          items: [{
            beatmapId: skills === "jack" ? 111 : 222,
            title: `${skills} map`,
            artist: "Tester",
            version: "4K",
            dan: { label: "10", rawDan: 10 }
          }]
        })
      };
    }
  });

  const maps = await provider.listMaps({ skills: ["jack", "speed"] });
  assert.deepEqual(requestedSkills, ["jack,speed", "jack", "speed"]);
  assert.deepEqual(maps.map((map) => map.beatmapId), [111, 222]);
});

test("recommendations use Tracker skill estimates and verify candidates with the bot estimator", async () => {
  const profile = new UserProfile({ userId: "discord-user" });
  const requestedRanges = [];
  const estimatedBeatmaps = [];
  const engine = new RecommendationEngine({
    listMaps: async (range) => {
      requestedRanges.push(range);
      return [{
        id: "bm-123",
        beatmapId: 123,
        title: "Jack practice",
        danTiles: ["jack"],
        trackerRawDan: 10.2,
        trackerDanLabel: "10+",
        playCount: 100,
        source: "mania-tracker"
      }];
    }
  }, {
    getBeatmapFile: async (beatmapId) => {
      estimatedBeatmaps.push(beatmapId);
      return "mock beatmap";
    },
    estimateMap: () => ({
      supported: true,
      lnRatio: 0.1,
      label: "Reform 10th high",
      danLevel: DanProgression.getLevel("reform-10th-high")
    })
  });

  const results = await engine.recommend(profile, {
    limit: 3,
    trackerEstimate: {
      rc: {
        rawDan: 9.95,
        label: "10",
        skillsets: [{ name: "jack", rawDan: 9.9 }]
      }
    }
  });

  assert.deepEqual(estimatedBeatmaps, [123]);
  assert.equal(requestedRanges[0].danMin, 8);
  assert.equal(requestedRanges[0].danMax, 11);
  assert.deepEqual(requestedRanges[0].skills, ["jack"]);
  assert.equal(results.length, 1);
  assert.equal(results[0].danLevel, "Reform 10th High");
  assert.equal(results[0].estimatorLabel, "Reform 10th high");
  assert.equal(results[0].trackerDanLabel, "10+");
  assert.equal(results[0].focusSkill, "jack");
  assert.ok(Number.isFinite(results[0].score));
});
