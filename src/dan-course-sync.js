import { DanProgression } from "./dan-progression.js";
import { DAN_COURSE_MIN_ACCURACY } from "./dan-course-rules.js";
import {
  getBeatmapFile,
  getBeatmapInfo,
  getUserBestScores,
  getUserRecentScores
} from "./osu-api.js";
import { estimateMap as defaultEstimateMap } from "./map-estimator.js";

const MAX_MAP_ESTIMATES_PER_SYNC = 10;
const RC_ACCURACY_PASS_BAR = 0.96;
const MOD_DOUBLE_TIME = (1 << 6) | (1 << 9);
const MOD_HALF_TIME = 1 << 8;

function getScoreSpeedRate(score) {
  if (Number.isFinite(score.speedRate) && score.speedRate > 0) {
    return score.speedRate;
  }

  const mods = Number(score.mods ?? 0);
  if (!Number.isSafeInteger(mods) || mods < 0) return 1;
  if ((mods & MOD_HALF_TIME) !== 0) return 0.75;
  if ((mods & MOD_DOUBLE_TIME) !== 0) return 1.5;
  return 1;
}

/**
 * Checks a linked profile's real osu! scores against the configured Dan
 * courses and updates clears / near-clears in place. This is what replaces
 * the old manual /setlevel and /cleared commands.
 *
 * No-op if the profile isn't linked to an osu! account or no courses are
 * configured yet.
 */
export async function syncProfileFromOsu(
  profile,
  courses,
  {
    fetchBestScores = getUserBestScores,
    fetchRecentScores = getUserRecentScores,
    fetchBeatmap = getBeatmapInfo,
    fetchMapFile = getBeatmapFile,
    estimateMap = defaultEstimateMap
  } = {}
) {
  const validCourseLevelIds = courses
    .filter((course) => course.isCourseClear === true)
    .map((course) => course.danLevelId)
    .filter((levelId) => DanProgression.getLevel(levelId));
  const clearsReconciled = profile.reconcileCourseClears(validCourseLevelIds);

  if (!profile.osuUserId || courses.length === 0) {
    return { checked: 0, updated: 0, clearsReconciled };
  }

  const coursesByBeatmapId = new Map();
  for (const course of courses) {
    if (!DanProgression.getLevel(course.danLevelId)) continue;
    const mapCourses = coursesByBeatmapId.get(Number(course.beatmapId)) ?? [];
    mapCourses.push(course);
    coursesByBeatmapId.set(Number(course.beatmapId), mapCourses);
  }

  const scoresById = new Map();
  let bestScores = [];
  for (const [source, fetchScores] of [
    ["best", fetchBestScores],
    ["recent", fetchRecentScores]
  ]) {
    try {
      const scores = await fetchScores(profile.osuUserId);
      if (source === "best") bestScores = scores;
      for (const score of scores) {
        if (coursesByBeatmapId.has(Number(score.beatmapId))) {
          scoresById.set(score.scoreId, score);
        }
      }
    } catch (error) {
      console.error(`osu! sync: failed to fetch ${source} scores:`, error.message);
    }
  }

  let updated = 0;
  let trackedScores = 0;
  let estimatedMaps = 0;
  for (const score of scoresById.values()) {
    const isNewScore = profile.recordOsuScore(String(score.scoreId));
    if (isNewScore) trackedScores += 1;

    for (const course of coursesByBeatmapId.get(Number(score.beatmapId))) {
      if (course.isCourseClear !== true) continue;

      const track = DanProgression.getLevel(course.danLevelId).track;
      if (
        score.passed &&
        Number.isFinite(score.accuracy) &&
        score.accuracy >= DAN_COURSE_MIN_ACCURACY[track]
      ) {
        const wasCleared = profile.clearedLevels.has(course.danLevelId);
        if (!profile.osuCourseClearLevels.has(course.danLevelId)) {
          profile.recordClear(course.danLevelId, "osu");
        }
        if (!wasCleared) updated += 1;
        continue;
      }

      if (!isNewScore) continue;
      if (score.maxCombo <= 0) continue;

      let beatmap;
      try {
        beatmap = await fetchBeatmap(course.beatmapId);
      } catch (error) {
        console.error(`osu! sync: failed to fetch beatmap ${course.beatmapId}:`, error.message);
        continue;
      }

      if (!beatmap?.maxCombo) continue;
      profile.recordNearClear({
        danLevelId: course.danLevelId,
        completion: Math.min(1, score.maxCombo / beatmap.maxCombo)
      });
      updated += 1;
    }
  }

  const estimatesByBeatmapId = new Map(
    profile.estimatedMapScores.map((estimate) => [estimate.beatmapId, estimate])
  );
  const candidateBeatmapIds = new Set();
  const candidateScores = [];
  for (const score of bestScores) {
    const beatmapId = Number(score.beatmapId);
    const speedRate = getScoreSpeedRate(score);
    const existingEstimate = estimatesByBeatmapId.get(beatmapId);
    if (
      !score.passed ||
      !Number.isFinite(score.accuracy) ||
      score.accuracy < RC_ACCURACY_PASS_BAR ||
      candidateBeatmapIds.has(beatmapId) ||
      (existingEstimate &&
        String(existingEstimate.scoreId) === String(score.scoreId) &&
        Number(existingEstimate.speedRate) === speedRate)
    ) {
      continue;
    }

    candidateBeatmapIds.add(beatmapId);
    candidateScores.push(score);
    if (candidateScores.length >= MAX_MAP_ESTIMATES_PER_SYNC) break;
  }

  for (const score of candidateScores) {
    let mapText;
    try {
      mapText = await fetchMapFile(score.beatmapId);
    } catch (error) {
      console.error(`osu! sync: failed to download beatmap ${score.beatmapId}:`, error.message);
      continue;
    }

    try {
      const speedRate = getScoreSpeedRate(score);
      const result = estimateMap(mapText, { speedRate });
      const isRcMap = result.supported && result.lnRatio < 0.45;
      profile.recordEstimatedMapScore({
        beatmapId: Number(score.beatmapId),
        scoreId: String(score.scoreId),
        danLevelId: isRcMap ? result.danLevel?.id ?? null : null,
        label: isRcMap ? result.label : null,
        accuracy: score.accuracy,
        speedRate,
        scoreUrl: `https://osu.ppy.sh/scores/mania/${score.scoreId}`
      });
      estimatedMaps += 1;
    } catch (error) {
      console.error(`osu! sync: failed to estimate beatmap ${score.beatmapId}:`, error.message);
    }
  }

  return {
    checked: courses.length,
    updated,
    trackedScores,
    estimatedMaps,
    clearsReconciled
  };
}
