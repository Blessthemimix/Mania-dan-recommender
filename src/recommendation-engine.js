import { DanProgression, RC_LEVELS } from "./dan-progression.js";
import { getBeatmapFile as defaultGetBeatmapFile } from "./osu-api.js";
import { estimateMap as defaultEstimateMap, numericToDanLevel } from "./map-estimator.js";

const TRACK = "rc";
const MAX_ESTIMATOR_CANDIDATES = 12;
const RC_SKILLS = new Set(["jack", "speed", "stamina", "tech", "stream"]);

function rawDanForLevel(level) {
  return level.tierIndex + 1 + (level.subLevelIndex - 1) / 3;
}

function levelForRawDan(rawDan) {
  return Number.isFinite(rawDan) ? numericToDanLevel(rawDan) : null;
}

export class RecommendationEngine {
  constructor(mapProvider, {
    maxLevelsAbove = 5,
    targetLevelsAbove = 1.25,
    getBeatmapFile = defaultGetBeatmapFile,
    estimateMap = defaultEstimateMap,
    maxEstimatorCandidates = MAX_ESTIMATOR_CANDIDATES
  } = {}) {
    if (!mapProvider || typeof mapProvider.listMaps !== "function") {
      throw new TypeError("mapProvider must implement listMaps().");
    }

    this.mapProvider = mapProvider;
    this.maxLevelsAbove = maxLevelsAbove;
    this.targetLevelsAbove = targetLevelsAbove;
    this.getBeatmapFile = getBeatmapFile;
    this.estimateMap = estimateMap;
    this.maxEstimatorCandidates = maxEstimatorCandidates;
  }

  async recommend(profile, { limit = 10, signal, trackerEstimate = null } = {}) {
    const trackerSide = trackerEstimate?.rc;
    const trackerLevel = levelForRawDan(trackerSide?.rawDan);
    const clearedLevel = profile.highestClearedLevel(TRACK);
    const estimatedMapLevel = profile.highestEstimatedMapLevel(TRACK);
    const localPosition = profile.estimatedSkillPosition?.(TRACK) ?? -1;
    const localLevel = clearedLevel ?? estimatedMapLevel ??
      RC_LEVELS[Math.max(0, Math.min(RC_LEVELS.length - 1, Math.round(localPosition)))];
    const baseLevel = trackerLevel ?? localLevel;
    const skillPosition = baseLevel?.index ??
      localPosition;
    if (skillPosition < 0) return [];

    const skills = (trackerSide?.skillsets ?? []).flatMap((skillset) => {
      const name = String(skillset.name ?? "").toLowerCase();
      const level = levelForRawDan(skillset.rawDan);
      return RC_SKILLS.has(name) && level
        ? [{ name, level, rawDan: skillset.rawDan }]
        : [];
    });
    const rawLevels = [
      Number.isFinite(trackerSide?.rawDan) ? trackerSide.rawDan : null,
      ...skills.map(({ rawDan }) => rawDan)
    ].filter(Number.isFinite);
    const allRawDan = rawLevels.length > 0
      ? rawLevels
      : [rawDanForLevel(localLevel)];
    const danMin = Math.max(1, Math.floor(Math.min(...allRawDan)) - 1);
    const danMax = Math.min(20, Math.ceil(Math.max(...allRawDan)) + 1);
    const maps = await this.mapProvider.listMaps({
      danMin,
      danMax,
      skills: skills.map(({ name }) => name),
      signal
    });
    const targetRawLevels = rawLevels.length > 0
      ? rawLevels
      : [rawDanForLevel(baseLevel)];
    const targetRawDanAbove = this.targetLevelsAbove / 3;
    const trackerGap = (map) => Number.isFinite(map.trackerRawDan)
      ? Math.min(...targetRawLevels.map((rawDan) =>
          Math.abs(map.trackerRawDan - rawDan - targetRawDanAbove)
        ))
      : 0;
    const playedMapIds = new Set([
      ...profile.clearedMapIds,
      ...(profile.estimatedMapScores ?? []).map((score) => `bm-${score.beatmapId}`)
    ]);
    const candidates = maps
      .filter((map) => !playedMapIds.has(map.id))
      .sort((first, second) => {
        const firstGap = trackerGap(first);
        const secondGap = trackerGap(second);
        const popularityDifference =
          (Number.isFinite(second.playCount) ? second.playCount : 0) -
          (Number.isFinite(first.playCount) ? first.playCount : 0);
        return firstGap - secondGap || popularityDifference;
      })
      .slice(0, this.maxEstimatorCandidates);

    const recommendations = [];
    for (const map of candidates) {
      let level;
      let estimateLabel = map.estimate ?? null;
      if (map.source === "mania-tracker" && Number.isSafeInteger(map.beatmapId)) {
        try {
          const osuText = await this.getBeatmapFile(map.beatmapId, { signal });
          const estimate = this.estimateMap(osuText);
          if (!estimate.supported || estimate.lnRatio >= 0.45 || !estimate.danLevel) continue;
          level = estimate.danLevel;
          estimateLabel = estimate.label;
        } catch (error) {
          console.error(`recommend: failed to estimate beatmap ${map.beatmapId}:`, error.message);
          continue;
        }
      } else {
        level = DanProgression.getLevel(map.danLevelId);
      }

      if (!level || level.track !== TRACK) continue;
      const focus = bestSkillFocus(
        map,
        skills,
        baseLevel,
        skillPosition,
        level.index,
        this.targetLevelsAbove
      );
      const distanceAboveSkill = level.index - focus.position;
      if (distanceAboveSkill <= 0 || distanceAboveSkill > this.maxLevelsAbove) continue;

      const targetDistance = Math.abs(distanceAboveSkill - this.targetLevelsAbove);
      const trackerDistance = Number.isFinite(map.trackerRawDan) && Number.isFinite(focus.rawDan)
        ? Math.abs(map.trackerRawDan - focus.rawDan - targetRawDanAbove)
        : 0;
      const popularityBonus = Number.isFinite(map.playCount)
        ? Math.min(Math.log10(map.playCount + 1), 5)
        : 0;
      const statusBonus = ({
        ranked: 3,
        loved: 2,
        qualified: 1
      })[map.status] ?? 0;
      recommendations.push({
        ...map,
        danLevel: level.label,
        estimatorLabel: estimateLabel,
        focusSkill: focus.name,
        score: Number((
          100 - targetDistance * 18 - trackerDistance * 8 + popularityBonus + statusBonus
        ).toFixed(2))
      });
    }

    return recommendations
      .sort((first, second) =>
        second.score - first.score || first.title.localeCompare(second.title)
      )
      .slice(0, limit);
  }
}

function bestSkillFocus(map, skills, baseLevel, skillPosition, levelIndex, targetLevelsAbove) {
  const tileSkills = new Set((map.danTiles ?? []).map((skill) => String(skill).toLowerCase()));
  const applicableSkills = skills.filter((skill) =>
    tileSkills.has(skill.name) || (skill.name === "tech" && tileSkills.has("technical"))
  );
  const options = applicableSkills.length > 0
    ? applicableSkills
    : [{ name: null, level: baseLevel, rawDan: null }];

  return options
    .map((skill) => ({
      name: skill.name,
      rawDan: skill.rawDan,
      position: skill.level.index,
      distance: Math.abs(levelIndex - skill.level.index - targetLevelsAbove)
    }))
    .sort((first, second) => first.distance - second.distance)[0] ??
    { name: null, rawDan: null, position: skillPosition };
}
