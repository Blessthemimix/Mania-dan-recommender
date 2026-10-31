import test from "node:test";
import assert from "node:assert/strict";
import { fetchManiaTrackerSkills } from "../src/mania-tracker-api.js";

test("fetches and normalizes Mania Tracker's 4K RC and LN Dan estimates", async () => {
  const requestedUrls = [];
  const estimate = await fetchManiaTrackerSkills("19970192", {
    fetchImpl: async (url) => {
      requestedUrls.push(url);
      if (url.includes("/dan-evidence?")) {
        return {
          ok: true,
          json: async () => ({
            courseClear: url.includes("side=rc")
              ? {
                  courseName: "Dan ~ REFORM ~ FINAL-ETA",
                  level: "eta",
                  beatmapId: 2738787,
                  accuracy: 0.961324,
                  currency: "stable",
                  scoreId: null
                }
              : null
          })
        };
      }
      return {
        ok: true,
        json: async () => ({
          modes: [
            {
              keyCount: 7,
              dan: { rc: { label: "unrelated" } }
            },
            {
              keyCount: 4,
              analyzedPlays: 333,
              dan: {
                rc: {
                  label: "eta+",
                  rawDan: 17.4,
                  clearWindow: {
                    have: 78,
                    need: 80,
                    skills: { full: 3, total: 4 }
                  },
                  skillsets: {
                    jack: {
                      label: "9",
                      rawDan: 9.2,
                      clears: 1,
                      skillsetClear: { accuracy: 0.97, bar: 0.96 }
                    },
                    tech: { label: "10", rawDan: 10.1, clears: 10 }
                  }
                },
                ln: {
                  label: "16++",
                  clearWindow: { have: 18, need: 20 }
                }
              }
            }
          ]
        })
      };
    }
  });

  assert.deepEqual(requestedUrls.sort(), [
    "https://api.mania-tracker.com/api/profiles/19970192/dan-evidence?keys=4&side=ln&limit=1",
    "https://api.mania-tracker.com/api/profiles/19970192/dan-evidence?keys=4&side=rc&limit=1",
    "https://api.mania-tracker.com/api/profiles/19970192/skills"
  ]);
  assert.deepEqual(estimate, {
    analyzedPlays: 333,
    rc: {
      label: "eta+",
      rawDan: 17.4,
      skillsets: [
        {
          name: "jack",
          label: "9",
          rawDan: 9.2,
          clears: 1,
          clearStatus: "Tracker clear",
          clearWindow: null
        },
        {
          name: "tech",
          label: "10",
          rawDan: 10.1,
          clears: 10,
          clearStatus: null,
          clearWindow: null
        }
      ],
      clearWindow: {
        have: 78,
        need: 80,
        fullSkillsets: 3,
        totalSkillsets: 4
      }
    },
    ln: {
      label: "16++",
      rawDan: null,
      skillsets: [],
      clearWindow: {
        have: 18,
        need: 20,
        fullSkillsets: null,
        totalSkillsets: null
      }
    },
    courseClear: {
      rc: {
        courseName: "Dan ~ REFORM ~ FINAL-ETA",
        level: "eta",
        stableAccuracy: 0.961324,
        beatmapId: 2738787,
        scoreUrl: null
      },
      ln: null
    },
    courseClearUnverified: { rc: true, ln: false },
    courseClearUnavailable: false
  });
});

test("rejects unsuccessful Mania Tracker responses", async () => {
  await assert.rejects(
    fetchManiaTrackerSkills(123, {
      fetchImpl: async () => ({ ok: false, status: 503 })
    }),
    /HTTP 503/
  );
});

test("course-clear endpoint failures do not discard a valid skill estimate", async () => {
  const result = await fetchManiaTrackerSkills(123, {
    fetchImpl: async (url) => {
      if (url.endsWith("/skills")) {
        return {
          ok: true,
          json: async () => ({
            modes: [{
              keyCount: 4,
              dan: { rc: { label: "10-" }, ln: null }
            }]
          })
        };
      }
      return { ok: false, status: 503 };
    }
  });

  assert.equal(result.rc.label, "10-");
  assert.equal(result.courseClearUnavailable, true);
});

test("keeps a course clear only when the tracker provides a real osu! score id", async () => {
  const result = await fetchManiaTrackerSkills(124, {
    fetchImpl: async (url) => {
      if (url.endsWith("/skills")) {
        return {
          ok: true,
          json: async () => ({
            modes: [{ keyCount: 4, dan: { rc: { label: "10-" } } }]
          })
        };
      }
      return {
        ok: true,
        json: async () => ({
          courseClear: url.includes("side=rc")
            ? {
                courseName: "Dan ~ REFORM ~ FINAL-ETA",
                beatmapId: 2738787,
                accuracy: 0.9613,
                currency: "stable",
                scoreId: null,
                soloScoreId: null,
                legacyScoreId: null
              }
            : null
        })
      };
    }
  });

  assert.equal(result.courseClear.rc.scoreUrl, null);
  assert.equal(result.courseClear.rc.beatmapId, 2738787);
  assert.equal(result.courseClear.rc.stableAccuracy, 0.9613);
  assert.equal(result.courseClearUnverified.rc, true);
});

test("converts lazer hit statistics to stable accuracy for course-clear evidence", async () => {
  const result = await fetchManiaTrackerSkills(125, {
    fetchImpl: async (url) => {
      if (url.endsWith("/skills")) {
        return {
          ok: true,
          json: async () => ({
            modes: [{ keyCount: 4, dan: { rc: { label: "eta" } } }]
          })
        };
      }
      return {
        ok: true,
        json: async () => ({
          courseClear: url.includes("side=rc")
            ? {
                courseName: "Dan ~ REFORM ~ FINAL-ETA",
                beatmapId: 2738787,
                scoreId: 7663486169,
                isLazer: true,
                statistics: {
                  ok: 144,
                  meh: 17,
                  good: 992,
                  miss: 136,
                  great: 4010,
                  perfect: 10150
                }
              }
            : null
        })
      };
    }
  });

  assert.equal(result.courseClear.rc.scoreUrl, "https://osu.ppy.sh/scores/mania/7663486169");
  assert.ok(Math.abs(result.courseClear.rc.stableAccuracy - 0.96266209247632) < 1e-12);
  assert.equal(result.courseClearUnverified.rc, false);
});
