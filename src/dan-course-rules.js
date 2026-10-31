export const DAN_COURSE_MIN_ACCURACY = Object.freeze({
  rc: 0.96,
  ln: 0.97
});

export function stableManiaAccuracy(statistics) {
  if (!statistics || typeof statistics !== "object") return null;

  const grades = [
    [statistics.perfect ?? statistics.countgeki, 6],
    [statistics.great ?? statistics.count300, 6],
    [statistics.good ?? statistics.countkatu, 4],
    [statistics.ok ?? statistics.count100, 2],
    [statistics.meh ?? statistics.count50, 1],
    [statistics.miss ?? statistics.countmiss, 0]
  ];
  if (!grades.some(([count]) => count !== undefined && count !== null)) return null;

  let total = 0;
  let weighted = 0;
  for (const [rawCount, weight] of grades) {
    const count = rawCount === undefined || rawCount === null ? 0 : Number(rawCount);
    if (!Number.isFinite(count) || count < 0) return null;
    total += count;
    weighted += count * weight;
  }

  return total > 0 ? weighted / (6 * total) : null;
}
