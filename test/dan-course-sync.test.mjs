import test from "node:test";
import assert from "node:assert/strict";
import { UserProfile } from "../src/user-profile.js";
import { syncProfileFromOsu } from "../src/dan-course-sync.js";

const courses = [
  { danLevelId: "reform-3rd-mid", beatmapId: 1, isCourseClear: true },
  { danLevelId: "alpha-low", beatmapId: 2, isCourseClear: true },
  { danLevelId: "thaumiel-eta-mid", beatmapId: 2738787, isCourseClear: true }
];

function score(scoreId, beatmapId, overrides = {}) {
  return {
    scoreId,
    beatmapId,
    passed: true,
    countMiss: 0,
    maxCombo: 500,
    accuracy: 0.99,
    ...overrides
  };
}

function sync(profile, overrides = {}, courseList = courses) {
  return syncProfileFromOsu(profile, courseList, {
    fetchBestScores: async () => [],
    fetchRecentScores: async () => [],
    fetchBeatmap: async () => ({ maxCombo: 800 }),
    ...overrides
  });
}

test("unlinked profiles and empty course lists are a no-op", async () => {
  const profile = new UserProfile({ userId: "u1" });
  assert.deepEqual(
    await syncProfileFromOsu(profile, courses),
    { checked: 0, updated: 0, clearsReconciled: 0 }
  );
  assert.deepEqual(
    await syncProfileFromOsu(new UserProfile({ userId: "u2", osuUserId: 5 }), []),
    { checked: 0, updated: 0, clearsReconciled: 0 }
  );
});

test("a pass on a single Dan chart is not treated as a completed course", async () => {
  const profile = new UserProfile({ userId: "u1", osuUserId: 5, osuUsername: "x" });
  const result = await sync(
    profile,
    { fetchRecentScores: async () => [score("eta-score", 2738787)] },
    [{ danLevelId: "thaumiel-eta-mid", beatmapId: 2738787 }]
  );

  assert.equal(result.updated, 0);
  assert.equal(result.trackedScores, 1);
  assert.equal(profile.highestClearedLevel("rc"), null);
});

test("only explicitly identified full-course maps can create automatic course clears", async () => {
  const profile = new UserProfile({ userId: "u1", osuUserId: 5, osuUsername: "x" });
  const result = await syncProfileFromOsu(profile, [
    { danLevelId: "thaumiel-eta-mid", beatmapId: 2738787, isCourseClear: true }
  ], {
    fetchBestScores: async () => [],
    fetchRecentScores: async () => [score("eta-course-score", 2738787)]
  });

  assert.equal(result.updated, 1);
  assert.equal(profile.highestClearedLevel("rc").id, "thaumiel-eta-mid");
});

test("an RC course score with misses clears when stable accuracy meets 96 percent", async () => {
  const profile = new UserProfile({ userId: "u1", osuUserId: 5, osuUsername: "x" });
  await syncProfileFromOsu(profile, courses, {
    fetchBestScores: async () => [],
    fetchRecentScores: async () => [
      score("eta-course-score", 2738787, { countMiss: 136, accuracy: 0.9627 })
    ]
  });

  assert.equal(profile.highestClearedLevel("rc").id, "thaumiel-eta-mid");
  assert.equal(profile.nearClears.length, 0);
});

test("RC course scores below 96 percent stable accuracy do not clear even with zero misses", async () => {
  const profile = new UserProfile({ userId: "u1", osuUserId: 5, osuUsername: "x" });
  await syncProfileFromOsu(profile, courses, {
    fetchBestScores: async () => [],
    fetchRecentScores: async () => [
      score("eta-course-score", 2738787, { countMiss: 0, accuracy: 0.9599 })
    ]
  });

  assert.equal(profile.highestClearedLevel("rc"), null);
});

test("LN course scores require 97 percent stable accuracy", async () => {
  const courseList = [{
    danLevelId: "ln-1st-dan-mid",
    beatmapId: 9999,
    isCourseClear: true
  }];
  const lowAccuracy = new UserProfile({ userId: "u1", osuUserId: 5, osuUsername: "x" });
  await syncProfileFromOsu(lowAccuracy, courseList, {
    fetchBestScores: async () => [],
    fetchRecentScores: async () => [
      score("ln-below-bar", 9999, { countMiss: 20, accuracy: 0.9699 })
    ]
  });
  assert.equal(lowAccuracy.highestClearedLevel("ln"), null);

  const atThreshold = new UserProfile({ userId: "u2", osuUserId: 6, osuUsername: "y" });
  await syncProfileFromOsu(atThreshold, courseList, {
    fetchBestScores: async () => [],
    fetchRecentScores: async () => [
      score("ln-at-bar", 9999, { countMiss: 20, accuracy: 0.97 })
    ]
  });
  assert.equal(atThreshold.highestClearedLevel("ln").id, "ln-1st-dan-mid");
});

test("reconciles old chart-derived Dan clears as unverified", async () => {
  const profile = new UserProfile({
    userId: "u1",
    osuUserId: 5,
    clearedLevels: ["thaumiel-eta-mid"],
    verifiedCourseClearLevels: ["thaumiel-eta-mid"]
  });
  const result = await sync(
    profile,
    {},
    [{ danLevelId: "thaumiel-eta-mid", beatmapId: 2738787 }]
  );

  assert.equal(result.clearsReconciled, 1);
  assert.equal(profile.highestClearedLevel("rc"), null);
  assert.deepEqual([...profile.legacyClearedLevels], ["thaumiel-eta-mid"]);
});

test("top scores are estimated from beatmap files without being presented as course clears", async () => {
  const profile = new UserProfile({ userId: "u1", osuUserId: 5, osuUsername: "x" });
  let estimatorOptions;
  const result = await sync(profile, {
    fetchBestScores: async () => [score("top-1", 9001)],
    fetchMapFile: async (beatmapId) => `map ${beatmapId}`,
    estimateMap: (_mapText, options) => {
      estimatorOptions = options;
      return {
        supported: true,
        lnRatio: 0.1,
        label: "Alpha mid",
        danLevel: { id: "alpha-mid" }
      };
    }
  });

  assert.equal(result.estimatedMaps, 1);
  assert.deepEqual(estimatorOptions, { speedRate: 1 });
  assert.equal(profile.estimatedMapScores[0].danLevelId, "alpha-mid");
  assert.equal(profile.estimatedMapScores[0].speedRate, 1);
  assert.equal(profile.highestEstimatedMapLevel("rc").id, "alpha-mid");
  assert.equal(profile.clearedLevels.has("alpha-mid"), false);
});

test("top-play estimates apply Half Time rate and refresh an old unmodded estimate", async () => {
  const profile = new UserProfile({
    userId: "u1",
    osuUserId: 5,
    osuUsername: "x",
    estimatedMapScores: [{
      beatmapId: 9001,
      scoreId: "top-ht",
      danLevelId: "gamma-low",
      label: "Gamma low",
      accuracy: 0.99,
      scoreUrl: "https://osu.ppy.sh/scores/mania/top-ht"
    }]
  });
  let estimatorOptions;
  const result = await sync(profile, {
    fetchBestScores: async () => [score("top-ht", 9001, { mods: 1 << 8 })],
    fetchMapFile: async () => "HT map",
    estimateMap: (_mapText, options) => {
      estimatorOptions = options;
      return {
        supported: true,
        lnRatio: 0.1,
        label: "Reform 7 mid",
        danLevel: { id: "reform-7th-mid" }
      };
    }
  });

  assert.equal(result.estimatedMaps, 1);
  assert.deepEqual(estimatorOptions, { speedRate: 0.75 });
  assert.equal(profile.estimatedMapScores[0].danLevelId, "reform-7th-mid");
  assert.equal(profile.estimatedMapScores[0].speedRate, 0.75);
});

test("top-play estimates apply Double Time and do not rescan unchanged scores", async () => {
  const profile = new UserProfile({ userId: "u1", osuUserId: 5, osuUsername: "x" });
  let estimatorCalls = 0;
  const options = {
    fetchBestScores: async () => [score("top-dt", 9001, { mods: (1 << 6) | (1 << 9) })],
    fetchMapFile: async () => "DT map",
    estimateMap: (_mapText, estimateOptions) => {
      estimatorCalls += 1;
      assert.deepEqual(estimateOptions, { speedRate: 1.5 });
      return {
        supported: true,
        lnRatio: 0.1,
        label: "Delta high",
        danLevel: { id: "delta-high" }
      };
    }
  };

  await sync(profile, options);
  const second = await sync(profile, options);

  assert.equal(second.estimatedMaps, 0);
  assert.equal(estimatorCalls, 1);
  assert.equal(profile.estimatedMapScores[0].speedRate, 1.5);
});

test("top plays below the RC pass accuracy bar are not estimated", async () => {
  const profile = new UserProfile({ userId: "u1", osuUserId: 5, osuUsername: "x" });
  let downloaded = false;
  const result = await sync(profile, {
    fetchBestScores: async () => [score("top-low-acc", 9002, { accuracy: 0.959 })],
    fetchMapFile: async () => {
      downloaded = true;
      return "map";
    }
  });

  assert.equal(result.estimatedMaps, 0);
  assert.equal(downloaded, false);
});

test("LN chart estimates are excluded from the RC top-play estimate", async () => {
  const profile = new UserProfile({ userId: "u1", osuUserId: 5, osuUsername: "x" });
  const result = await sync(profile, {
    fetchBestScores: async () => [score("top-ln", 9003)],
    fetchMapFile: async () => "LN map",
    estimateMap: (_mapText, options) => {
      assert.deepEqual(options, { speedRate: 1 });
      return {
        supported: true,
        lnRatio: 0.5,
        label: "LN 14",
        danLevel: { id: "alpha-mid" }
      };
    }
  });

  assert.equal(result.estimatedMaps, 1);
  assert.equal(profile.estimatedMapScores[0].danLevelId, null);
  assert.equal(profile.highestEstimatedMapLevel("rc"), null);
});

test("a score found in both feeds is processed only once", async () => {
  const profile = new UserProfile({ userId: "u1", osuUserId: 5, osuUsername: "x" });
  const sameScore = score("score-1", 1, { accuracy: null });
  const result = await sync(profile, {
    fetchBestScores: async () => [sameScore],
    fetchRecentScores: async () => [sameScore]
  });

  assert.equal(result.updated, 1);
  assert.equal(result.trackedScores, 1);
});

test("a failed play records one near-clear and is not duplicated on the next sync", async () => {
  const profile = new UserProfile({ userId: "u1", osuUserId: 5, osuUsername: "x" });
  const fetchRecentScores = async () => [
    score("fail-1", 1, { passed: false, countMiss: 9, maxCombo: 400 })
  ];

  const first = await sync(profile, { fetchRecentScores });
  const second = await sync(profile, { fetchRecentScores });

  assert.equal(first.updated, 1);
  assert.equal(first.trackedScores, 1);
  assert.equal(second.updated, 0);
  assert.equal(second.trackedScores, 0);
  assert.equal(profile.nearClears.length, 1);
  assert.equal(profile.nearClears[0].completion, 0.5);
});

test("a full-course pass meeting the stable accuracy bar counts as a clear", async () => {
  const profile = new UserProfile({ userId: "u1", osuUserId: 5, osuUsername: "x" });
  await sync(profile, {
    fetchRecentScores: async () => [
      score("score-2", 2, { countMiss: 136, accuracy: 0.96 })
    ]
  });
  assert.ok(profile.clearedLevels.has("alpha-low"));
});

test("an already-cleared level isn't counted as updated again", async () => {
  const profile = new UserProfile({
    userId: "u1",
    osuUserId: 5,
    osuUsername: "x",
    clearedLevels: ["reform-3rd-mid"],
    verifiedCourseClearLevels: ["reform-3rd-mid"]
  });
  const result = await sync(profile, {
    fetchRecentScores: async () => [score("score-3", 1)]
  });

  assert.equal(result.updated, 0);
  assert.equal(result.trackedScores, 1);
});

test("a failed best-score fetch doesn't prevent recent scores from syncing", async () => {
  const profile = new UserProfile({ userId: "u1", osuUserId: 5, osuUsername: "x" });
  const result = await sync(profile, {
    fetchBestScores: async () => {
      throw new Error("boom");
    },
    fetchRecentScores: async () => [score("score-4", 2)]
  });

  assert.equal(result.updated, 1);
  assert.ok(profile.clearedLevels.has("alpha-low"));
});

test("tracked score IDs survive profile serialization", () => {
  const profile = new UserProfile({ userId: "u1" });
  profile.recordOsuScore("score-5");

  const restored = new UserProfile(profile.toJSON());
  assert.equal(restored.recordOsuScore("score-5"), false);
});
