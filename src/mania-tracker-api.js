import { stableManiaAccuracy } from "./dan-course-rules.js";

const API_BASE = "https://api.mania-tracker.com/api";

async function fetchJson(path, fetchImpl) {
  const response = await fetchImpl(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) {
    throw new Error(`Mania Tracker request failed with HTTP ${response.status}`);
  }
  return response.json();
}

function normalizeSide(side) {
  if (!side || typeof side.label !== "string") return null;

  const window = side.clearWindow;
  const skills = window?.skills;
  const normalizeSkillsetClearStatus = (clear) => {
    if (
      !clear ||
      !Number.isFinite(clear.accuracy) ||
      !Number.isFinite(clear.bar)
    ) return null;
    return clear.accuracy >= clear.bar ? "Tracker clear" : "near clear";
  };
  const skillsets = Object.entries(side.skillsets ?? {}).flatMap(([name, skillset]) =>
    typeof skillset?.label === "string"
      ? [{
          name,
          label: skillset.label,
          rawDan: Number.isFinite(skillset.rawDan) ? skillset.rawDan : null,
          clears: Number.isFinite(skillset.clears) ? skillset.clears : null,
          clearStatus: normalizeSkillsetClearStatus(skillset.skillsetClear),
          clearWindow: Number.isFinite(skillset.clearWindow?.have) &&
            Number.isFinite(skillset.clearWindow?.need)
            ? {
                have: skillset.clearWindow.have,
                need: skillset.clearWindow.need
              }
            : null
        }]
      : []
  );
  return {
    label: side.label,
    rawDan: Number.isFinite(side.rawDan) ? side.rawDan : null,
    skillsets,
    clearWindow: Number.isFinite(window?.have) && Number.isFinite(window?.need)
      ? {
          have: window.have,
          need: window.need,
          fullSkillsets: Number.isFinite(skills?.full) ? skills.full : null,
          totalSkillsets: Number.isFinite(skills?.total) ? skills.total : null
        }
      : null
  };
}

function normalizeCourseClear(courseClear) {
  if (!courseClear || typeof courseClear !== "object") return null;

  const scoreId = [
    courseClear.scoreId,
    courseClear.soloScoreId,
    courseClear.legacyScoreId
  ].find((id) => Number.isSafeInteger(Number(id)) && Number(id) > 0);

  const stableAccuracy = stableManiaAccuracy(courseClear.statistics) ??
    (courseClear.currency === "stable" && Number.isFinite(courseClear.accuracy)
      ? courseClear.accuracy
      : null);
  return {
    courseName: typeof courseClear.courseName === "string" ? courseClear.courseName : null,
    level: typeof courseClear.level === "string" ? courseClear.level : null,
    stableAccuracy,
    beatmapId: Number.isSafeInteger(courseClear.beatmapId) ? courseClear.beatmapId : null,
    scoreUrl: scoreId ? `https://osu.ppy.sh/scores/mania/${scoreId}` : null
  };
}

/** Fetches Mania Tracker's public 4K skill/Dan estimate for a linked osu! ID. */
export async function fetchManiaTrackerSkills(osuUserId, { fetchImpl = fetch } = {}) {
  const userId = Number(osuUserId);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new TypeError("osuUserId must be a positive integer.");
  }

  const [data, rcEvidence, lnEvidence] = await Promise.all([
    fetchJson(`/profiles/${userId}/skills`, fetchImpl),
    fetchJson(`/profiles/${userId}/dan-evidence?keys=4&side=rc&limit=1`, fetchImpl)
      .then((evidence) => ({ status: "fulfilled", value: evidence }))
      .catch((error) => ({ status: "rejected", reason: error })),
    fetchJson(`/profiles/${userId}/dan-evidence?keys=4&side=ln&limit=1`, fetchImpl)
      .then((evidence) => ({ status: "fulfilled", value: evidence }))
      .catch((error) => ({ status: "rejected", reason: error }))
  ]);
  const mode = data.modes?.find((entry) => entry.keyCount === 4);
  if (!mode) return null;

  return {
    analyzedPlays: Number.isFinite(mode.analyzedPlays) ? mode.analyzedPlays : 0,
    rc: normalizeSide(mode.dan?.rc),
    ln: normalizeSide(mode.dan?.ln),
    courseClear: {
      rc: rcEvidence.status === "fulfilled" ? normalizeCourseClear(rcEvidence.value.courseClear) : null,
      ln: lnEvidence.status === "fulfilled" ? normalizeCourseClear(lnEvidence.value.courseClear) : null
    },
    courseClearUnverified: {
      rc: rcEvidence.status === "fulfilled" &&
        Boolean(rcEvidence.value.courseClear) &&
        !normalizeCourseClear(rcEvidence.value.courseClear)?.scoreUrl,
      ln: lnEvidence.status === "fulfilled" &&
        Boolean(lnEvidence.value.courseClear) &&
        !normalizeCourseClear(lnEvidence.value.courseClear)?.scoreUrl
    },
    courseClearUnavailable:
      rcEvidence.status === "rejected" || lnEvidence.status === "rejected"
  };
}
