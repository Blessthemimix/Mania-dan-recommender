import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { getOsuAvatarAccentColor } from "../src/avatar-color.js";

test("samples a dominant color from an osu! avatar", async () => {
  const avatar = await sharp({
    create: {
      width: 16,
      height: 16,
      channels: 3,
      background: { r: 35, g: 115, b: 205 }
    }
  }).png().toBuffer();

  const color = await getOsuAvatarAccentColor(987654321, {
    fetchImpl: async () => ({
      ok: true,
      arrayBuffer: async () => avatar
    })
  });

  assert.equal(color, 0x2373cd);
});

test("reports avatar download errors instead of fabricating a sampled color", async () => {
  await assert.rejects(
    getOsuAvatarAccentColor(987654322, {
      fetchImpl: async () => ({ ok: false, status: 404 })
    }),
    /HTTP 404/
  );
});
