import sharp from "sharp";

const avatarColorCache = new Map();
const CACHE_LIMIT = 256;

export async function getOsuAvatarAccentColor(osuUserId, { fetchImpl = fetch } = {}) {
  const userId = Number(osuUserId);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new TypeError("osuUserId must be a positive integer.");
  }
  if (avatarColorCache.has(userId)) {
    return avatarColorCache.get(userId);
  }

  const request = (async () => {
    const response = await fetchImpl(`https://a.ppy.sh/${userId}`, {
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      throw new Error(`osu! avatar request failed with HTTP ${response.status}`);
    }

    const image = Buffer.from(await response.arrayBuffer());
    const { data, info } = await sharp(image)
      .resize(32, 32, { fit: "cover" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const palette = new Map();
    for (let offset = 0; offset < data.length; offset += info.channels) {
      const alpha = data[offset + 3];
      if (alpha < 96) continue;

      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const key = `${red >> 4},${green >> 4},${blue >> 4}`;
      const bucket = palette.get(key) ?? { red: 0, green: 0, blue: 0, count: 0 };
      bucket.red += red;
      bucket.green += green;
      bucket.blue += blue;
      bucket.count += 1;
      palette.set(key, bucket);
    }

    let winner = null;
    let winnerScore = -1;
    for (const bucket of palette.values()) {
      const red = Math.round(bucket.red / bucket.count);
      const green = Math.round(bucket.green / bucket.count);
      const blue = Math.round(bucket.blue / bucket.count);
      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      const saturation = maximum === 0 ? 0 : (maximum - minimum) / maximum;
      const brightness = (red * 299 + green * 587 + blue * 114) / 1000;
      const brightnessWeight = brightness < 24 || brightness > 245 ? 0.35 : 1;
      const score = bucket.count * (1 + saturation) * brightnessWeight;

      if (score > winnerScore) {
        winner = (red << 16) | (green << 8) | blue;
        winnerScore = score;
      }
    }
    if (winner === null) {
      throw new Error("osu! avatar did not contain usable color pixels.");
    }
    return winner;
  })();

  avatarColorCache.set(userId, request);
  if (avatarColorCache.size > CACHE_LIMIT) {
    avatarColorCache.delete(avatarColorCache.keys().next().value);
  }

  try {
    return await request;
  } catch (error) {
    avatarColorCache.delete(userId);
    throw error;
  }
}
