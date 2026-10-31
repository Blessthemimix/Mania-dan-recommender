import { DanProgression } from "./dan-progression.js";

export class UserProfile {
  constructor({
    userId,
    clearedLevels = [],
    nearClears = [],
    clearedMapIds = [],
    manualClearProofs = [],
    verifiedCourseClearLevels = [],
    trackerCourseClearLevels = null,
    osuCourseClearLevels = null,
    legacyClearedLevels = [],
    trackedOsuScoreIds = [],
    estimatedMapScores = [],
    osuUserId = null,
    osuUsername = null
  }) {
    if (!userId || typeof userId !== "string") {
      throw new TypeError("userId must be a non-empty string.");
    }

    this.userId = userId;
    this.clearedLevels = new Set();
    this.verifiedCourseClearLevels = new Set(verifiedCourseClearLevels);
    this.trackerCourseClearLevels = new Set(trackerCourseClearLevels ?? []);
    this.osuCourseClearLevels = new Set(osuCourseClearLevels ?? []);
    this.legacyClearedLevels = new Set(legacyClearedLevels);
    this.nearClears = [];
    this.clearedMapIds = new Set(clearedMapIds);
    this.manualClearProofs = [...manualClearProofs];
    this.trackedOsuScoreIds = new Set(trackedOsuScoreIds);
    this.estimatedMapScores = [...estimatedMapScores];
    this.osuUserId = osuUserId;
    this.osuUsername = osuUsername;

    const verifiedLevels = new Set([
      ...this.verifiedCourseClearLevels,
      ...manualClearProofs.map((proof) => proof.danLevelId)
    ]);
    for (const levelId of clearedLevels) {
      if (verifiedLevels.has(levelId)) {
        this.clearedLevels.add(levelId);
      } else {
        this.legacyClearedLevels.add(levelId);
      }
    }

    for (const levelId of this.verifiedCourseClearLevels) {
      this.clearedLevels.add(levelId);
      if (
        trackerCourseClearLevels === null &&
        !this.osuCourseClearLevels.has(levelId) &&
        !manualClearProofs.some((proof) => proof.danLevelId === levelId)
      ) {
        this.trackerCourseClearLevels.add(levelId);
      }
    }
    for (const proof of manualClearProofs) {
      this.recordClear(proof.danLevelId, "manual");
    }

    for (const attempt of nearClears) {
      this.recordNearClear(attempt);
    }
  }

  linkOsu({ id, username }) {
    if (!id || !username) {
      throw new TypeError("linkOsu requires both an osu! user id and username.");
    }

    this.osuUserId = id;
    this.osuUsername = username;
  }

  recordClear(levelId, source = "osu") {
    if (!DanProgression.getLevel(levelId)) {
      throw new Error(`Unknown Dan level: ${levelId}`);
    }

    this.clearedLevels.add(levelId);
    this.verifiedCourseClearLevels.add(levelId);
    this.legacyClearedLevels.delete(levelId);
    if (source === "tracker") this.trackerCourseClearLevels.add(levelId);
    if (source === "osu") this.osuCourseClearLevels.add(levelId);
  }

  recordTrackerClear(levelId) {
    this.recordClear(levelId, "tracker");
  }

  reconcileCourseClears(validCourseLevelIds, invalidCourseLevelIds = []) {
    const validLevels = new Set(validCourseLevelIds);
    const invalidLevels = new Set(invalidCourseLevelIds);
    const manualLevels = new Set(this.manualClearProofs.map((proof) => proof.danLevelId));
    let downgraded = 0;

    for (const levelId of this.verifiedCourseClearLevels) {
      if (
        (validLevels.has(levelId) && !invalidLevels.has(levelId)) ||
        manualLevels.has(levelId)
      ) continue;

      this.verifiedCourseClearLevels.delete(levelId);
      this.trackerCourseClearLevels.delete(levelId);
      this.osuCourseClearLevels.delete(levelId);
      this.clearedLevels.delete(levelId);
      this.legacyClearedLevels.add(levelId);
      downgraded += 1;
    }

    return downgraded;
  }

  reconcileTrackerCourseClears(validTrackerCourseLevelIds) {
    const validLevels = new Set(validTrackerCourseLevelIds);
    const manualLevels = new Set(this.manualClearProofs.map((proof) => proof.danLevelId));
    let downgraded = 0;

    for (const levelId of this.trackerCourseClearLevels) {
      if (validLevels.has(levelId)) continue;

      this.trackerCourseClearLevels.delete(levelId);
      if (this.osuCourseClearLevels.has(levelId) || manualLevels.has(levelId)) continue;

      this.verifiedCourseClearLevels.delete(levelId);
      this.clearedLevels.delete(levelId);
      this.legacyClearedLevels.add(levelId);
      downgraded += 1;
    }

    return downgraded;
  }

  recordNearClear({ danLevelId, completion, achievedAt = new Date().toISOString() }) {
    if (!DanProgression.getLevel(danLevelId)) {
      throw new Error(`Unknown Dan level: ${danLevelId}`);
    }

    if (!Number.isFinite(completion) || completion < 0 || completion > 1) {
      throw new RangeError("completion must be between 0 and 1.");
    }

    this.nearClears.push({ danLevelId, completion, achievedAt });
  }

  recordOsuScore(scoreId) {
    if (!scoreId || typeof scoreId !== "string") {
      throw new TypeError("scoreId must be a non-empty string.");
    }

    if (this.trackedOsuScoreIds.has(scoreId)) {
      return false;
    }

    this.trackedOsuScoreIds.add(scoreId);
    if (this.trackedOsuScoreIds.size > 500) {
      this.trackedOsuScoreIds.delete(this.trackedOsuScoreIds.values().next().value);
    }
    return true;
  }

  recordEstimatedMapScore({
    beatmapId,
    scoreId,
    danLevelId,
    label,
    accuracy,
    speedRate = 1,
    scoreUrl
  }) {
    if (!Number.isInteger(beatmapId) || beatmapId <= 0) {
      throw new TypeError("beatmapId must be a positive integer.");
    }
    if (!scoreId || typeof scoreId !== "string") {
      throw new TypeError("scoreId must be a non-empty string.");
    }
    if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 1) {
      throw new RangeError("accuracy must be between 0 and 1.");
    }
    if (!Number.isFinite(speedRate) || speedRate <= 0) {
      throw new RangeError("speedRate must be a positive number.");
    }
    if (danLevelId !== null && !DanProgression.getLevel(danLevelId)) {
      throw new Error(`Unknown Dan level: ${danLevelId}`);
    }

    const existing = this.estimatedMapScores.findIndex((entry) => entry.beatmapId === beatmapId);
    const estimate = {
      beatmapId,
      scoreId,
      danLevelId,
      label,
      accuracy,
      speedRate,
      scoreUrl
    };
    if (existing < 0) {
      this.estimatedMapScores.push(estimate);
    } else {
      this.estimatedMapScores[existing] = estimate;
    }
  }

  recordManualClear(danLevelId, scoreUrl) {
    if (!DanProgression.getLevel(danLevelId)) {
      throw new Error(`Unknown Dan level: ${danLevelId}`);
    }

    let url;
    try {
      url = new URL(scoreUrl);
    } catch {
      throw new TypeError("scoreUrl must be a valid osu! score URL.");
    }

    if (
      url.hostname !== "osu.ppy.sh" ||
      !/^\/scores\/(?:mania\/)?\d+\/?$/.test(url.pathname)
    ) {
      throw new TypeError("scoreUrl must link to an osu! score.");
    }

    if (this.manualClearProofs.some((proof) => proof.scoreUrl === url.href)) {
      return false;
    }

    this.recordClear(danLevelId, "manual");
    this.manualClearProofs.push({
      danLevelId,
      scoreUrl: url.href,
      recordedAt: new Date().toISOString()
    });
    return true;
  }

  markMapCleared(mapId) {
    if (!mapId || typeof mapId !== "string") {
      throw new TypeError("mapId must be a non-empty string.");
    }

    this.clearedMapIds.add(mapId);
  }

  /** Highest level cleared on `track` ("rc" or "ln"). */
  highestClearedLevel(track = "rc") {
    return DanProgression.highestCleared([...this.clearedLevels], track);
  }

  /** Estimated position on `track`'s scale, from clears and near-clears. */
  estimatedSkillPosition(track = "rc") {
    const highestClearedIndex = this.highestClearedLevel(track)?.index ?? -1;

    const nearClearEstimate = this.nearClears
      .filter((attempt) => DanProgression.getLevel(attempt.danLevelId)?.track === track)
      .reduce((best, attempt) => {
        const levelIndex = DanProgression.indexOf(attempt.danLevelId);
        const estimate = levelIndex - 1 + attempt.completion;
        return Math.max(best, estimate);
      }, -1);

    return Math.max(highestClearedIndex, nearClearEstimate);
  }

  highestEstimatedMapLevel(track = "rc") {
    return this.estimatedMapScores
      .map((score) => DanProgression.getLevel(score.danLevelId))
      .filter((level) => level?.track === track)
      .reduce(
        (highest, level) => (!highest || level.index > highest.index ? level : highest),
        null
      );
  }

  toJSON() {
    return {
      userId: this.userId,
      clearedLevels: [...this.clearedLevels],
      verifiedCourseClearLevels: [...this.verifiedCourseClearLevels],
      trackerCourseClearLevels: [...this.trackerCourseClearLevels],
      osuCourseClearLevels: [...this.osuCourseClearLevels],
      legacyClearedLevels: [...this.legacyClearedLevels],
      nearClears: this.nearClears,
      clearedMapIds: [...this.clearedMapIds],
      manualClearProofs: this.manualClearProofs,
      trackedOsuScoreIds: [...this.trackedOsuScoreIds],
      estimatedMapScores: this.estimatedMapScores,
      osuUserId: this.osuUserId,
      osuUsername: this.osuUsername
    };
  }
}
