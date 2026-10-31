import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonProfileStore } from "../src/json-profile-store.js";
import { RecommendationEngine } from "../src/recommendation-engine.js";
import { numericToDanLevel } from "../src/map-estimator.js";
import { createCommands, handleAutocomplete } from "../src/discord/commands.js";

const maps = [
  { id: "m1", title: "Easy", danLevelId: "reform-2nd-mid", rating: null, beatmapId: 111 },
  { id: "m2", title: "Hard", danLevelId: "reform-3rd-high", rating: null }
];

function fakeInteraction(userId, { strings = {}, integers = {}, attachment = null } = {}) {
  const replies = [];
  return {
    replies,
    user: { id: userId },
    options: {
      getString: (name) => strings[name] ?? null,
      getInteger: (name) => integers[name] ?? null,
      getAttachment: () => attachment
    },
    // Commands only ever call editReply; bot.js is the one that defers.
    editReply: async (message) => replies.push(message)
  };
}

async function setup(overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), "dan-test-"));
  const profileStore = new JsonProfileStore(join(dir, "profiles.json"));
  const engine = new RecommendationEngine({ listMaps: async () => maps });
  const commands = createCommands({
    profileStore,
    engine,
    courseStore: { list: async () => [] },
    estimateMap: () => ({
      supported: true,
      columnCount: 4,
      star: 7.1,
      label: "Alpha mid",
      danLevel: { label: "Alpha Mid" },
      algorithm: "Roxy"
    }),
    fetchText: async () => "fake osu text",
    lookupOsuUser: async (username) =>
      username === "unknown-user" ? null : { id: 999, username },
    syncProfileFromOsu: async () => ({ checked: 0, updated: 0 }),
    fetchManiaTrackerSkills: async () => null,
    getOsuAvatarAccentColor: async () => 0x7b4ca8,
    ...overrides
  });
  return {
    commands,
    profileStore,
    cleanup: () => rm(dir, { recursive: true, force: true })
  };
}

test("every command serialises to valid Discord JSON", async () => {
  const { commands, cleanup } = await setup();
  const names = [...commands.keys()].sort();
  assert.deepEqual(names, ["estimate", "link", "profile", "recommend", "record-clear"]);
  for (const command of commands.values()) {
    assert.ok(command.data.toJSON().description.length > 0);
  }
  await cleanup();
});

test("recommend asks to /link before a level is known", async () => {
  const { commands, cleanup } = await setup();
  const interaction = fakeInteraction("u1");
  await commands.get("recommend").execute(interaction);
  assert.match(interaction.replies[0], /\/link/);
  await cleanup();
});

test("link stores the osu! account and recommend then works off its sync result", async () => {
  const { commands, profileStore, cleanup } = await setup({
    syncProfileFromOsu: async (profile) => {
      profile.recordClear("reform-1st-high");
      return { checked: 1, updated: 1 };
    }
  });

  const linkInteraction = fakeInteraction("u1", { strings: { username: "Mitix" } });
  await commands.get("link").execute(linkInteraction);
  assert.match(linkInteraction.replies[0], /Linked to \*\*Mitix\*\*/);

  const recommendInteraction = fakeInteraction("u1");
  await commands.get("recommend").execute(recommendInteraction);
  assert.match(recommendInteraction.replies[0], /Easy/);
  assert.match(recommendInteraction.replies[0], /osu\.ppy\.sh\/b\/111/);
  await cleanup();
});

test("recommend uses a Mania Tracker RC estimate even without a verified course clear", async () => {
  const { commands, cleanup } = await setup({
    fetchManiaTrackerSkills: async () => ({
      rc: { rawDan: 1.2, label: "1+", skillsets: [] }
    })
  });
  await commands.get("link").execute(
    fakeInteraction("u1", { strings: { username: "Mitix" } })
  );

  const interaction = fakeInteraction("u1");
  await commands.get("recommend").execute(interaction);
  assert.match(interaction.replies[0], /4K RC recommendations/);
  assert.match(interaction.replies[0], /Estimator: Reform 2nd Mid/);
  assert.match(interaction.replies[0], /not verified Dan course clears/);
  await cleanup();
});

test("link reports an unknown osu! username", async () => {
  const { commands, cleanup } = await setup();
  const interaction = fakeInteraction("u1", { strings: { username: "unknown-user" } });
  await commands.get("link").execute(interaction);
  assert.match(interaction.replies[0], /Couldn't find/);
  await cleanup();
});

test("record-clear stores a valid osu! score link and updates the Dan profile", async () => {
  const { commands, cleanup } = await setup();
  const interaction = fakeInteraction("u1", {
    strings: {
      level: "thaumiel-eta-mid",
      "score-url": "https://osu.ppy.sh/scores/mania/12345"
    }
  });

  await commands.get("record-clear").execute(interaction);
  assert.match(interaction.replies[0], /Thaumiel Eta Mid/);
  assert.match(interaction.replies[0], /not API-verified/);

  const profile = fakeInteraction("u1");
  await commands.get("profile").execute(profile);
  assert.match(profile.replies[0].embeds[0].data.description, /manual: \*\*Thaumiel Eta Mid\*\*/);
  await cleanup();
});

test("record-clear rejects non-score URLs", async () => {
  const { commands, cleanup } = await setup();
  const interaction = fakeInteraction("u1", {
    strings: {
      level: "thaumiel-eta-mid",
      "score-url": "https://osu.ppy.sh/b/2738787"
    }
  });

  await commands.get("record-clear").execute(interaction);
  assert.match(interaction.replies[0], /Provide a score link/);
  await cleanup();
});

test("profiles are separate per Discord user", async () => {
  const { commands, cleanup } = await setup({
    syncProfileFromOsu: async (profile) => {
      profile.recordClear("alpha-low");
      return { checked: 1, updated: 1 };
    }
  });
  await commands.get("link").execute(fakeInteraction("u1", { strings: { username: "u1osu" } }));

  const other = fakeInteraction("u2");
  await commands.get("profile").execute(other);
  assert.match(other.replies[0].embeds[0].data.description, /RC Dan course clear: \*\*none verified\*\*/);
  assert.match(other.replies[0].embeds[0].data.footer.text, /not linked/);
  await cleanup();
});

test("simultaneous links from several users are all saved", async () => {
  const { commands, cleanup } = await setup({
    syncProfileFromOsu: async (profile) => {
      profile.recordManualClear(
        "reform-1st-low",
        "https://osu.ppy.sh/scores/mania/12345"
      );
      return { checked: 1, updated: 1 };
    }
  });
  await Promise.all(
    ["a", "b", "c", "d", "e"].map((id) =>
      commands.get("link").execute(fakeInteraction(id, { strings: { username: `osu-${id}` } }))
    )
  );

  for (const id of ["a", "b", "c", "d", "e"]) {
    const check = fakeInteraction(id);
    await commands.get("profile").execute(check);
    assert.match(check.replies[0].embeds[0].data.description, /manual: \*\*Reform 1st Low\*\*/);
  }
  await cleanup();
});

test("profile distinguishes Mania Tracker's skill Dan from a single-chart estimate", async () => {
  const { commands, profileStore, cleanup } = await setup({
    courseStore: {
      list: async () => [{
        danLevelId: "thaumiel-eta-mid",
        beatmapId: 2738787,
        isCourseClear: true
      }]
    },
    fetchManiaTrackerSkills: async () => ({
      rc: {
        label: "eta+",
        clearWindow: { have: 78, need: 80, fullSkillsets: 3, totalSkillsets: 4 },
        skillsets: [
          { name: "jack", label: "9", clears: 1 },
          { name: "tech", label: "10", clears: 10 }
        ]
      },
      ln: { label: "16++", clearWindow: { have: 18, need: 20 } },
      courseClear: {
        rc: {
          courseName: "Dan ~ REFORM ~ FINAL-ETA",
          level: "eta",
          beatmapId: 2738787,
          stableAccuracy: 0.961324,
          scoreUrl: "https://osu.ppy.sh/scores/mania/12345"
        },
        ln: null
      }
    })
  });
  await commands.get("link").execute(
    fakeInteraction("u1", { strings: { username: "saragi" } })
  );

  const interaction = fakeInteraction("u1");
  await commands.get("profile").execute(interaction);
  const embed = interaction.replies[0].embeds[0].data;
  assert.match(embed.description, /\n\nMania Tracker 4K skill estimate — RC:.*LN:/s);
  assert.match(embed.description, /Near clears: 0 course attempts; 0 Mania Tracker skillset near clears/);
  assert.match(embed.description, /RC Dan course clear: \[\*\*Dan ~ REFORM ~ FINAL-ETA — ETA\*\* \(96\.13% stable acc\)/);
  assert.match(embed.description, /Mania Tracker 4K skill estimate — RC: \*\*eta\+/);
  assert.match(embed.description, /78\/80 evidence; 3\/4 skillsets complete/);
  assert.match(embed.description, /skills: Jack 9 \(1 clear\), Tech 10 \(10 clears\)/);
  assert.match(embed.description, /LN: \*\*16\+\+\*\* \(18\/20 evidence\)/);
  assert.doesNotMatch(embed.description, /RC chart estimate from top plays/);
  assert.doesNotMatch(embed.description, /Thaumiel Eta Mid \(verified\)/);
  assert.equal(embed.color, 0x7b4ca8);
  assert.equal(embed.thumbnail.url, "https://a.ppy.sh/999");
  assert.doesNotMatch(embed.description, /highest cleared: \*\*Reform/);
  const saved = await profileStore.load("u1");
  assert.equal(saved.highestClearedLevel("rc").id, "thaumiel-eta-mid");
  await cleanup();
});

test("profile downgrades an unscorelinked ETA tracker entry instead of claiming a clear", async () => {
  const { commands, profileStore, cleanup } = await setup({
    courseStore: {
      list: async () => [{
        danLevelId: "thaumiel-eta-mid",
        beatmapId: 2738787,
        isCourseClear: true
      }]
    },
    fetchManiaTrackerSkills: async () => ({
      rc: { label: "10-" },
      ln: null,
      courseClear: {
        rc: {
          courseName: "Dan ~ REFORM ~ FINAL-ETA",
          beatmapId: 2738787,
          scoreUrl: null,
          countMiss: null
        },
        ln: null
      },
      courseClearUnverified: { rc: true, ln: false },
      courseClearUnavailable: false
    })
  });
  await commands.get("link").execute(
    fakeInteraction("u1", { strings: { username: "saragi" } })
  );
  const oldProfile = await profileStore.load("u1");
  oldProfile.recordTrackerClear("thaumiel-eta-mid");
  await profileStore.save(oldProfile);

  const interaction = fakeInteraction("u1");
  await commands.get("profile").execute(interaction);
  const description = interaction.replies[0].embeds[0].data.description;
  assert.match(description, /RC Dan estimate: \*\*10-\*\* \(Mania Tracker; no verified course clear; tracker score not verified: tracker entry has no score link\)/);
  assert.doesNotMatch(description, /Thaumiel Eta/);
  assert.equal((await profileStore.load("u1")).highestClearedLevel("rc"), null);
  await cleanup();
});

test("profile accepts a linked tracker clear with misses when RC stable accuracy reaches 96 percent", async () => {
  const { commands, profileStore, cleanup } = await setup({
    courseStore: {
      list: async () => [{
        danLevelId: "thaumiel-eta-mid",
        beatmapId: 2738787,
        isCourseClear: true
      }]
    },
    fetchManiaTrackerSkills: async () => ({
      rc: { label: "eta" },
      ln: null,
      courseClear: {
        rc: {
          courseName: "Dan ~ REFORM ~ FINAL-ETA",
          level: "eta",
          beatmapId: 2738787,
          stableAccuracy: 0.96,
          scoreUrl: "https://osu.ppy.sh/scores/mania/7663486169"
        },
        ln: null
      },
      courseClearUnverified: { rc: false, ln: false },
      courseClearUnavailable: false
    })
  });
  await commands.get("link").execute(
    fakeInteraction("u1", { strings: { username: "myucchii" } })
  );
  const profile = await profileStore.load("u1");
  profile.recordClear("thaumiel-eta-mid");
  await profileStore.save(profile);

  const interaction = fakeInteraction("u1");
  await commands.get("profile").execute(interaction);
  const description = interaction.replies[0].embeds[0].data.description;
  assert.match(description, /FINAL-ETA — ETA\*\* \(96\.00% stable acc\)/);
  assert.equal((await profileStore.load("u1")).highestClearedLevel("rc").id, "thaumiel-eta-mid");
  await cleanup();
});

test("profile rejects a score below stable accuracy bar and demotes a stale LN clear", async () => {
  const { commands, profileStore, cleanup } = await setup({
    courseStore: {
      list: async () => [{
        danLevelId: "ln-1st-dan-mid",
        beatmapId: 1862813,
        isCourseClear: true
      }]
    },
    fetchManiaTrackerSkills: async () => ({
      rc: null,
      ln: { label: "1st Dan" },
      courseClear: {
        rc: null,
        ln: {
          courseName: "LN 1st Dan",
          level: "1st Dan",
          beatmapId: 1862813,
          stableAccuracy: 0.9699,
          scoreUrl: "https://osu.ppy.sh/scores/mania/12346"
        }
      },
      courseClearUnverified: { rc: false, ln: false },
      courseClearUnavailable: false
    })
  });
  await commands.get("link").execute(
    fakeInteraction("u1", { strings: { username: "saragi" } })
  );
  const oldProfile = await profileStore.load("u1");
  oldProfile.recordTrackerClear("ln-1st-dan-mid");
  await profileStore.save(oldProfile);

  const interaction = fakeInteraction("u1");
  await commands.get("profile").execute(interaction);
  const description = interaction.replies[0].embeds[0].data.description;
  assert.match(description, /stable accuracy 96\.99% \(minimum 97%\)/);
  assert.equal((await profileStore.load("u1")).highestClearedLevel("ln"), null);
  await cleanup();
});

test("profile uses personalized Mania Tracker low/mid estimates when no course clear is verified", async () => {
  const trackerEstimates = [
    {
      label: "10-",
      rawDan: 9.72,
      clearWindow: { have: 80, need: 80, fullSkillsets: 4, totalSkillsets: 4 },
      skillsets: [
        {
          name: "jack",
          label: "9",
          rawDan: 9,
          clears: 1,
          clearStatus: "Tracker clear"
        },
        { name: "tech", label: "10", rawDan: 10.08, clears: 10 },
        {
          name: "speed",
          label: "10-",
          rawDan: 9.73,
          clears: 8,
          clearStatus: "near clear"
        },
        { name: "stamina", label: "10", rawDan: 10.05, clears: 9 }
      ]
    },
    {
      label: "10",
      rawDan: 10.08,
      skillsets: []
    }
  ];
  const lnEstimate = {
    label: "17-",
    rawDan: 16.88,
    clearWindow: { have: 20, need: 20 },
    skillsets: [
      { name: "lnhybrid", label: "15+", rawDan: 15.16, clears: 6 },
      { name: "lntechnical", label: "17--", rawDan: 16.54, clears: 14 },
      { name: "lnwalls", label: "16-", rawDan: 15.75, clears: 7 },
      { name: "lnspeed", label: "14+", rawDan: 14.11, clears: 3 }
    ]
  };
  let estimateIndex = 0;
  const { commands, profileStore, cleanup } = await setup({
    courseStore: {
      list: async () => [{
        danLevelId: "thaumiel-eta-mid",
        beatmapId: 2738787,
        isCourseClear: true
      }]
    },
    fetchManiaTrackerSkills: async () => {
      const index = estimateIndex++;
      return {
        rc: trackerEstimates[index],
        ln: index === 1 ? lnEstimate : null,
        courseClear: { rc: null, ln: null },
        courseClearUnverified: { rc: false, ln: false },
        courseClearUnavailable: false
      };
    }
  });

  for (const id of ["u1", "u2"]) {
    await commands.get("link").execute(
      fakeInteraction(id, { strings: { username: `osu-${id}` } })
    );
    if (id === "u1") {
      const oldProfile = await profileStore.load(id);
      oldProfile.recordTrackerClear("thaumiel-eta-mid");
      await profileStore.save(oldProfile);
    }
    const interaction = fakeInteraction(id);
    await commands.get("profile").execute(interaction);
    const description = interaction.replies[0].embeds[0].data.description;
    if (id === "u1") {
      assert.match(description, /RC Dan estimate: \*\*10th Dan Low\*\* \(Mania Tracker; no verified course clear\)/);
      assert.match(description, /skills: Jack 9th Dan Mid \(Tracker clear\), Tech 10th Dan Mid \(10 clears\), Speed 10th Dan Low \(near clear\), Stamina 10th Dan Mid \(9 clears\)/);
      assert.match(description, /Near clears: 0 course attempts; 1 Mania Tracker skillset near clears/);
      assert.doesNotMatch(description, /RC Dan course clear: .*Thaumiel Eta/);
      assert.equal((await profileStore.load(id)).highestClearedLevel("rc"), null);
    } else {
      assert.match(description, /RC Dan estimate: \*\*10th Dan Mid\*\* \(Mania Tracker; no verified course clear\)/);
      assert.match(description, /Mania Tracker 4K skill estimate — RC: \*\*10th Dan Mid\*\*/);
      assert.match(description, /LN: \*\*17th Dan Low\*\* \(20\/20 evidence; skills: LN hybrid 15th Dan High \(6 clears\), LN technical 17th Dan Low \(14 clears\), LN walls 16th Dan Low \(7 clears\), LN speed 14th Dan High \(3 clears\)\)/);
      assert.match(description, /LN Dan estimate: \*\*17th Dan Low\*\*/);
      assert.doesNotMatch(description, /LN: \*\*Gamma|LN Dan estimate: \*\*Gamma/);
    }
  }
  await cleanup();
});

test("estimate rejects non-.osu files and accepts .osu files", async () => {
  const { commands, cleanup } = await setup();

  const bad = fakeInteraction("u1", { attachment: { name: "x.png", size: 10, url: "u" } });
  await commands.get("estimate").execute(bad);
  assert.match(bad.replies[0], /\.osu/);

  const good = fakeInteraction("u1", { attachment: { name: "map.osu", size: 10, url: "u" } });
  await commands.get("estimate").execute(good);
  assert.match(good.replies[0], /Alpha mid/);
  await cleanup();
});

test("autocomplete returns at most 25 matching levels", async () => {
  let response;
  await handleAutocomplete({
    options: { getFocused: () => "" },
    respond: async (choices) => {
      response = choices;
    }
  });
  assert.equal(response.length, 25);

  await handleAutocomplete({
    options: { getFocused: () => "alpha" },
    respond: async (choices) => {
      response = choices;
    }
  });
  assert.deepEqual(response.map((c) => c.value), ["alpha-low", "alpha-mid", "alpha-high"]);
});

test("numericToDanLevel maps the analyser scale onto bot levels", () => {
  assert.equal(numericToDanLevel(0.4), null);
  assert.equal(numericToDanLevel(1.0).id, "reform-1st-mid");
  assert.equal(numericToDanLevel(1.4).id, "reform-1st-high");
  assert.equal(numericToDanLevel(10.8).id, "alpha-low");
  assert.equal(numericToDanLevel(11.0).id, "alpha-mid");
  assert.equal(numericToDanLevel(13.2).id, "gamma-high");
  assert.equal(numericToDanLevel(25).id, "eta-high");
});
