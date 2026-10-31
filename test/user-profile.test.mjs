import test from "node:test";
import assert from "node:assert/strict";
import { UserProfile } from "../src/user-profile.js";

test("legacy single-map clears are retained as unverified, not active Dan clears", () => {
  const profile = new UserProfile({
    userId: "u1",
    clearedLevels: ["reform-9th-low"]
  });

  assert.equal(profile.highestClearedLevel("rc"), null);
  assert.deepEqual([...profile.legacyClearedLevels], ["reform-9th-low"]);

  const restored = new UserProfile(profile.toJSON());
  assert.equal(restored.highestClearedLevel("rc"), null);
  assert.deepEqual([...restored.legacyClearedLevels], ["reform-9th-low"]);
});

test("manual clear evidence stays active after serialization", () => {
  const profile = new UserProfile({ userId: "u2" });
  profile.recordManualClear("reform-9th-low", "https://osu.ppy.sh/scores/mania/12345");

  const restored = new UserProfile(profile.toJSON());
  assert.equal(restored.highestClearedLevel("rc").id, "reform-9th-low");
});

test("a verified course clear remains active after serialization", () => {
  const profile = new UserProfile({ userId: "u3" });
  profile.recordClear("reform-9th-low");

  const restored = new UserProfile(profile.toJSON());
  assert.equal(restored.highestClearedLevel("rc").id, "reform-9th-low");
});

test("reconciliation preserves only explicit full-course and manual clears", () => {
  const profile = new UserProfile({
    userId: "u4",
    clearedLevels: ["reform-9th-low", "thaumiel-eta-mid"],
    verifiedCourseClearLevels: ["reform-9th-low", "thaumiel-eta-mid"],
    manualClearProofs: [{
      danLevelId: "reform-9th-low",
      scoreUrl: "https://osu.ppy.sh/scores/mania/12345"
    }]
  });

  assert.equal(profile.reconcileCourseClears([]), 1);
  assert.equal(profile.highestClearedLevel("rc").id, "reform-9th-low");
  assert.deepEqual([...profile.legacyClearedLevels], ["thaumiel-eta-mid"]);
});

test("reconciliation can reject a reported invalid course score but preserves manual proof", () => {
  const profile = new UserProfile({
    userId: "u5",
    clearedLevels: ["reform-9th-low", "thaumiel-eta-mid"],
    verifiedCourseClearLevels: ["reform-9th-low", "thaumiel-eta-mid"],
    manualClearProofs: [{
      danLevelId: "reform-9th-low",
      scoreUrl: "https://osu.ppy.sh/scores/mania/12345"
    }]
  });

  assert.equal(
    profile.reconcileCourseClears(["reform-9th-low", "thaumiel-eta-mid"], ["thaumiel-eta-mid"]),
    1
  );
  assert.equal(profile.highestClearedLevel("rc").id, "reform-9th-low");
  assert.deepEqual([...profile.legacyClearedLevels], ["thaumiel-eta-mid"]);
});

test("tracker clear reconciliation removes stale tracker evidence but preserves osu! clears", () => {
  const profile = new UserProfile({
    userId: "u6",
    trackerCourseClearLevels: ["thaumiel-eta-mid"],
    osuCourseClearLevels: ["reform-9th-low"],
    verifiedCourseClearLevels: ["thaumiel-eta-mid", "reform-9th-low"]
  });

  assert.equal(profile.reconcileTrackerCourseClears([]), 1);
  assert.equal(profile.highestClearedLevel("rc").id, "reform-9th-low");
  assert.deepEqual([...profile.legacyClearedLevels], ["thaumiel-eta-mid"]);
});
