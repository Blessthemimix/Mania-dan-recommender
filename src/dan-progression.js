function ordinal(n) {
  const suffixes = ["th", "st", "nd", "rd"];
  const mod100 = n % 100;
  const suffix = suffixes[(mod100 - 20) % 10] ?? suffixes[mod100] ?? suffixes[0];
  return `${n}${suffix}`;
}

function slugify(tier) {
  return tier.toLowerCase().replaceAll(" ", "-");
}

// Matches the osumania_map_analyser estimator's scale exactly (Reform 1-10,
// then Alpha...Kappa), using its exact tier names for Zeta/Eta/Theta, which
// are also each tier's real canonical course's creator in this project's
// data/dan-courses.json.
export const RC_TIERS = Object.freeze([
  "Reform 1st", "Reform 2nd", "Reform 3rd", "Reform 4th", "Reform 5th",
  "Reform 6th", "Reform 7th", "Reform 8th", "Reform 9th", "Reform 10th",
  "Alpha", "Beta", "Gamma", "Delta", "Epsilon",
  "Emik Zeta", "Thaumiel Eta", "CloverWisp Theta", "Iota", "Kappa"
]);

// LN Dan courses are a separate skill track from RC. There's no official
// Greek-letter naming for these yet, so they just count up.
export const LN_TIERS = Object.freeze(Array.from({ length: 17 }, (_, i) => `LN ${ordinal(i + 1)} Dan`));

export const SUB_LEVELS = Object.freeze(["Low", "Mid", "High"]);

function buildLevels(tiers, track) {
  return tiers.flatMap((tier, tierIndex) =>
    SUB_LEVELS.map((subLevel, subLevelIndex) => {
      const slug = slugify(tier);
      return Object.freeze({
        id: `${slug}-${subLevel.toLowerCase()}`,
        track,
        tier,
        subLevel,
        tierIndex,
        subLevelIndex,
        index: tierIndex * SUB_LEVELS.length + subLevelIndex,
        label: `${tier} ${subLevel}`
      });
    })
  );
}

export const RC_LEVELS = Object.freeze(buildLevels(RC_TIERS, "rc"));
export const LN_LEVELS = Object.freeze(buildLevels(LN_TIERS, "ln"));
export const DAN_LEVELS = Object.freeze([...RC_LEVELS, ...LN_LEVELS]);

const LEVEL_BY_ID = new Map(DAN_LEVELS.map((level) => [level.id, level]));
const LEVELS_BY_TRACK = { rc: RC_LEVELS, ln: LN_LEVELS };

export class DanProgression {
  static getLevel(levelId) {
    return LEVEL_BY_ID.get(levelId) ?? null;
  }

  static indexOf(levelId) {
    return this.getLevel(levelId)?.index ?? -1;
  }

  static compare(firstLevelId, secondLevelId) {
    const first = this.getLevel(firstLevelId);
    const second = this.getLevel(secondLevelId);

    if (!first || !second) {
      throw new Error("Cannot compare an unknown Dan level.");
    }
    if (first.track !== second.track) {
      throw new Error("Cannot compare levels from different Dan tracks (RC vs LN).");
    }

    return Math.sign(first.index - second.index);
  }

  static next(levelId) {
    const level = this.getLevel(levelId);
    if (!level) {
      throw new Error(`Unknown Dan level: ${levelId}`);
    }

    return LEVELS_BY_TRACK[level.track][level.index + 1] ?? null;
  }

  /** Highest level in `track` ("rc" or "ln") among the given level ids. */
  static highestCleared(levelIds, track = "rc") {
    return levelIds
      .map((levelId) => this.getLevel(levelId))
      .filter((level) => level && level.track === track)
      .reduce(
        (highest, level) => (!highest || level.index > highest.index ? level : highest),
        null
      );
  }
}
