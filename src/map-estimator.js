import { RC_LEVELS, RC_TIERS } from "./dan-progression.js";
import { runMixedEstimatorFromText } from "./vendor/mania-analyser/estimator/mixedEstimator.js";

const SUB_LEVEL_THRESHOLD = 1 / 6;

/**
 * Converts the analyser's numeric difficulty (Reform N = N, Alpha = 11,
 * Beta = 12, ... Kappa = 20) into one of this project's RC_LEVELS.
 * Returns null for values below Reform 1.
 */
export function numericToDanLevel(numeric) {
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const base = Math.round(numeric);
  if (base < 1) {
    return null;
  }

  if (base > RC_TIERS.length) {
    return RC_LEVELS[RC_LEVELS.length - 1];
  }

  const offset = numeric - base;
  let subLevelIndex = 1;
  if (offset < -SUB_LEVEL_THRESHOLD) {
    subLevelIndex = 0;
  } else if (offset > SUB_LEVEL_THRESHOLD) {
    subLevelIndex = 2;
  }

  return RC_LEVELS[(base - 1) * 3 + subLevelIndex];
}

/**
 * Estimates the Dan level of a mania beatmap from the raw .osu file text.
 * Only 4K maps get a usable Dan level.
 */
export function estimateMap(osuText, { speedRate = 1.0 } = {}) {
  const result = runMixedEstimatorFromText(osuText, { speedRate });
  const numeric = Number.isFinite(Number(result.numericDifficulty))
    ? Number(result.numericDifficulty)
    : null;

  const supported = result.columnCount === 4 && numeric !== null && numeric > 0;

  return {
    supported,
    columnCount: result.columnCount,
    star: result.star,
    lnRatio: result.lnRatio,
    label: result.estDiff,
    numeric,
    algorithm: result.actualEstimatorAlgorithm,
    danLevel: supported ? numericToDanLevel(numeric) : null
  };
}
