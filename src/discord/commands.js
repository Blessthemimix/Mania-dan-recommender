import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { DAN_LEVELS, DanProgression } from "../dan-progression.js";
import { lookupOsuUser as defaultLookupOsuUser } from "../osu-api.js";
import { syncProfileFromOsu as defaultSyncProfileFromOsu } from "../dan-course-sync.js";
import { fetchManiaTrackerSkills as defaultFetchManiaTrackerSkills } from "../mania-tracker-api.js";
import { getOsuAvatarAccentColor as defaultGetOsuAvatarAccentColor } from "../avatar-color.js";
import { DAN_COURSE_MIN_ACCURACY } from "../dan-course-rules.js";

const MAX_OSU_FILE_BYTES = 5 * 1024 * 1024;

function mapLink(map) {
  return map.beatmapId ? ` <https://osu.ppy.sh/b/${map.beatmapId}>` : "";
}

function hasNearClearOn(profile, track) {
  return profile.nearClears.some((attempt) => DanProgression.getLevel(attempt.danLevelId)?.track === track);
}

function isOsuScoreUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === "osu.ppy.sh" && /^\/scores\/(?:mania\/)?\d+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * Builds the slash commands. Dependencies are injected so the handlers can be
 * tested without a Discord connection or a real osu! API call.
 *
 * Every command here replies with `interaction.editReply()`: bot.js defers
 * every interaction immediately on receipt (see its `ephemeral` flag below)
 * so a slow command can never miss Discord's 3-second ack window.
 */
export function createCommands({
  profileStore,
  engine,
  estimateMap,
  courseStore,
  fetchText = defaultFetchText,
  lookupOsuUser = defaultLookupOsuUser,
  syncProfileFromOsu = defaultSyncProfileFromOsu,
  fetchManiaTrackerSkills = defaultFetchManiaTrackerSkills,
  getOsuAvatarAccentColor = defaultGetOsuAvatarAccentColor
}) {
  // Serialises read-modify-write on the JSON profile file within this process.
  let queue = Promise.resolve();
  const withLock = (task) => {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  };

  const updateProfile = (userId, change) =>
    withLock(async () => {
      const profile = await profileStore.load(userId);
      const result = await change(profile);
      await profileStore.save(profile);
      return result;
    });

  const commands = [
    {
      ephemeral: false,
      data: new SlashCommandBuilder()
        .setName("recommend")
        .setDescription("Recommend 4K RC maps using your Tracker skill and map estimates")
        .addIntegerOption((o) =>
          o.setName("limit").setDescription("How many maps (1-10)").setMinValue(1).setMaxValue(10)
        ),
      async execute(interaction) {
        const limit = interaction.options.getInteger("limit") ?? 5;
        const profile = await profileStore.load(interaction.user.id);
        let trackerEstimate = null;
        let trackerUnavailable = false;
        if (profile.osuUserId) {
          try {
            trackerEstimate = await fetchManiaTrackerSkills(profile.osuUserId);
          } catch (error) {
            console.error("Mania Tracker recommendation lookup failed:", error.message);
            trackerUnavailable = true;
          }
        }
        const hasLocalEstimate =
          profile.highestClearedLevel("rc") ||
          hasNearClearOn(profile, "rc") ||
          profile.highestEstimatedMapLevel("rc");
        if (!trackerEstimate?.rc && !hasLocalEstimate) {
          await interaction.editReply(
            profile.osuUserId
              ? trackerUnavailable
                ? "Mania Tracker is temporarily unavailable, and I don't have a local RC estimate to fall back on. Try again later."
                : "I couldn't find enough RC skill data on Mania Tracker yet. Play some 4K maps and try again."
              : "I need your Mania Tracker RC estimate to recommend maps. Use `/link` to connect your osu! account first."
          );
          return;
        }

        const maps = await engine.recommend(profile, { limit, trackerEstimate });
        if (maps.length === 0) {
          await interaction.editReply(
            "I couldn't find any suitable 4K RC maps near your estimated level. Try again later as Mania Tracker's map pool updates."
          );
          return;
        }

        const lines = maps.map(
          (map, i) =>
            `${i + 1}. **${map.title}** | Estimator: ${map.danLevel}` +
            `${map.trackerDanLabel ? ` | Tracker: ${map.trackerDanLabel}` : ""}` +
            `${map.focusSkill ? ` | focus: ${formatSkillsetName(map.focusSkill)}` : ""}` +
            `${mapLink(map)}`
        );
        const level = trackerEstimate?.rc?.rawDan
          ? formatTrackerDanEstimate(trackerEstimate.rc)
          : profile.highestClearedLevel("rc")?.label ??
            profile.highestEstimatedMapLevel("rc")?.label ??
            "your local Dan evidence";
        await interaction.editReply(
          `4K RC recommendations for **${profile.osuUsername ?? "you"}** ` +
            `(Mania Tracker: ${level}; chart estimates verified by the bot):\n${lines.join("\n")}\n` +
            "These are individual chart estimates, not verified Dan course clears."
        );
      }
    },
    {
      ephemeral: true,
      data: new SlashCommandBuilder()
        .setName("link")
        .setDescription("Connect your osu! account so I can track your Dan clears automatically")
        .addStringOption((o) =>
          o.setName("username").setDescription("Your osu! username").setRequired(true)
        ),
      async execute(interaction) {
        const username = interaction.options.getString("username", true).trim();

        let osuUser;
        try {
          osuUser = await lookupOsuUser(username);
        } catch (error) {
          console.error("osu! lookup failed:", error);
          await interaction.editReply(
            "Couldn't reach the osu! API. The bot may not be configured with osu! API credentials yet."
          );
          return;
        }

        if (!osuUser) {
          await interaction.editReply(`Couldn't find an osu! mania player named \`${username}\`.`);
          return;
        }

        const courses = (await courseStore?.list()) ?? [];
        const syncResult = await updateProfile(interaction.user.id, async (profile) => {
          profile.linkOsu(osuUser);
          return syncProfileFromOsu(profile, courses);
        });

        const syncNote =
          courses.length === 0
            ? " (no Dan courses are configured yet, so nothing to check against)"
            : `; scanned ${syncResult.checked} Dan course(s), tracked ` +
              `${syncResult.trackedScores ?? 0} matching score(s), and updated ` +
              `${syncResult.updated ?? 0} record(s); analyzed ` +
              `${syncResult.estimatedMaps ?? 0} top-play map(s)`;

        await interaction.editReply(`Linked to **${osuUser.username}**${syncNote}.`);
      }
    },
    {
      ephemeral: true,
      data: new SlashCommandBuilder()
        .setName("record-clear")
        .setDescription("Manually record a Dan clear with its osu! score link")
        .addStringOption((o) =>
          o
            .setName("level")
            .setDescription("Dan level cleared")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((o) =>
          o.setName("score-url").setDescription("Link to the osu! score").setRequired(true)
        ),
      async execute(interaction) {
        const levelId = interaction.options.getString("level", true);
        const level = DanProgression.getLevel(levelId);
        if (!level) {
          await interaction.editReply("Choose a valid Dan level from the suggestions.");
          return;
        }

        const scoreUrl = interaction.options.getString("score-url", true).trim();
        if (!isOsuScoreUrl(scoreUrl)) {
          await interaction.editReply("Provide a score link in the form https://osu.ppy.sh/scores/mania/12345.");
          return;
        }

        const result = await updateProfile(interaction.user.id, async (profile) =>
          profile.recordManualClear(levelId, scoreUrl)
        );

        await interaction.editReply(
          result
            ? `Recorded **${level.label}** with your score link. osu! does not expose scores for some pending maps, so this clear is recorded manually and not API-verified.`
            : `That score link is already recorded.`
        );
      }
    },
    {
      ephemeral: true,
      data: new SlashCommandBuilder().setName("profile").setDescription("Show what I know about you"),
      async execute(interaction) {
        let profile = await profileStore.load(interaction.user.id);

        let trackerEstimate = null;
        let trackerUnavailable = false;
        let avatarColor = 0x5865f2;
        if (profile.osuUserId) {
          try {
            trackerEstimate = await fetchManiaTrackerSkills(profile.osuUserId);
          } catch (error) {
            console.error("Mania Tracker skills lookup failed:", error.message);
            trackerUnavailable = true;
          }
          try {
            avatarColor = await getOsuAvatarAccentColor(profile.osuUserId);
          } catch (error) {
            console.error("osu! avatar color lookup failed:", error.message);
          }
        }

        const trackerClearLevelIds = [];
        const verifiedTrackerCourseClears = { rc: null, ln: null };
        const trackerCourseClearStatus = {
          rc: trackerEstimate?.courseClearUnverified?.rc
            ? "tracker entry has no score link"
            : null,
          ln: trackerEstimate?.courseClearUnverified?.ln
            ? "tracker entry has no score link"
            : null
        };
        const courses = (await courseStore?.list()) ?? [];
        const validCourseLevelIds = courses
          .filter((course) => course.isCourseClear === true)
          .map((course) => course.danLevelId);
        for (const track of ["rc", "ln"]) {
          const clear = trackerEstimate?.courseClear?.[track];
          if (!clear) continue;

          const course = courses.find(
            (entry) =>
              Number(entry.beatmapId) === clear.beatmapId &&
              DanProgression.getLevel(entry.danLevelId)?.track === track
          );
          if (!course?.isCourseClear) {
            trackerCourseClearStatus[track] = "beatmap is not marked as a full course";
          } else {
            if (!clear.scoreUrl) {
              trackerCourseClearStatus[track] = "tracker entry has no score link";
            } else if (!Number.isFinite(clear.stableAccuracy)) {
              trackerCourseClearStatus[track] = "stable score accuracy is unavailable";
            } else if (clear.stableAccuracy < DAN_COURSE_MIN_ACCURACY[track]) {
              trackerCourseClearStatus[track] =
                `stable accuracy ${(clear.stableAccuracy * 100).toFixed(2)}% ` +
                `(minimum ${(DAN_COURSE_MIN_ACCURACY[track] * 100).toFixed(0)}%)`;
            } else {
              verifiedTrackerCourseClears[track] = clear;
              trackerClearLevelIds.push(course.danLevelId);
            }

          }
        }
        let reconciledClears = profile.reconcileCourseClears(validCourseLevelIds);
        if (trackerEstimate && !trackerEstimate.courseClearUnavailable) {
          reconciledClears += profile.reconcileTrackerCourseClears(trackerClearLevelIds);
        }
        if (reconciledClears > 0) {
          await profileStore.save(profile);
        }
        if (trackerClearLevelIds.length > 0) {
          await updateProfile(interaction.user.id, async (storedProfile) => {
            for (const levelId of trackerClearLevelIds) {
              storedProfile.recordTrackerClear(levelId);
            }
          });
          profile = await profileStore.load(interaction.user.id);
        }

        const trackerLine = !profile.osuUserId
          ? null
          : trackerUnavailable
            ? "Mania Tracker 4K skill estimate: temporarily unavailable"
            : trackerEstimate
              ? `Mania Tracker 4K skill estimate — RC: ${formatTrackerSide(trackerEstimate.rc)}; ` +
                `LN: ${formatTrackerSide(trackerEstimate.ln, "ln")}`
              : "Mania Tracker 4K skill estimate: not enough tracked data";

        const rcStatus = formatDanStatus(
          profile,
          verifiedTrackerCourseClears.rc,
          "rc",
          trackerCourseClearStatus.rc,
          trackerUnavailable || trackerEstimate?.courseClearUnavailable,
          trackerEstimate?.rc,
          trackerClearLevelIds
        );
        const lnStatus = formatDanStatus(
          profile,
          verifiedTrackerCourseClears.ln,
          "ln",
          trackerCourseClearStatus.ln,
          trackerUnavailable || trackerEstimate?.courseClearUnavailable,
          trackerEstimate?.ln,
          trackerClearLevelIds
        );
        const trackerNearClearCount = ["rc", "ln"].reduce(
          (total, track) =>
            total +
            (trackerEstimate?.[track]?.skillsets ?? []).filter(
              (skillset) => skillset.clearStatus === "near clear"
            ).length,
          0
        );
        const embed = new EmbedBuilder()
          .setColor(avatarColor)
          .setTitle(`${profile.osuUsername ?? "osu!mania"} — Dan profile`)
          .setDescription([
            rcStatus,
            ...(trackerLine ? [trackerLine] : []),
            lnStatus,
            `Near clears: ${profile.nearClears.length} course attempts; ` +
              `${trackerNearClearCount} Mania Tracker skillset near clears`
          ].join("\n\n"))
          .setFooter({ text: `osu! account: ${profile.osuUsername ?? "not linked — use /link"}` });
        if (profile.osuUserId) {
          embed
            .setURL(`https://osu.ppy.sh/users/${profile.osuUserId}/mania`)
            .setThumbnail(`https://a.ppy.sh/${profile.osuUserId}`);
        }

        await interaction.editReply({ embeds: [embed] });
      }
    },
    {
      ephemeral: false,
      data: new SlashCommandBuilder()
        .setName("estimate")
        .setDescription("Estimate the RC Dan level of a 4K .osu file")
        .addAttachmentOption((o) =>
          o.setName("file").setDescription("The .osu beatmap file").setRequired(true)
        ),
      async execute(interaction) {
        const file = interaction.options.getAttachment("file", true);
        if (!file.name.toLowerCase().endsWith(".osu")) {
          await interaction.editReply("Please attach a `.osu` file.");
          return;
        }
        if (file.size > MAX_OSU_FILE_BYTES) {
          await interaction.editReply("That file is too large.");
          return;
        }

        try {
          const text = await fetchText(file.url);
          const result = estimateMap(text);

          if (!result.supported) {
            await interaction.editReply(
              result.columnCount === 4
                ? "Couldn't estimate a Dan level for this map (outside the supported range)."
                : `Only 4K maps are supported (this one is ${result.columnCount}K).`
            );
            return;
          }

          await interaction.editReply(
            `**${result.label}** (star ${Number(result.star).toFixed(2)}, ` +
              `bot level: ${result.danLevel.label}, algorithm: ${result.algorithm})`
          );
        } catch (error) {
          console.error("estimate failed:", error);
          await interaction.editReply("Couldn't read that beatmap file.");
        }
      }
    }
  ];

  return new Map(commands.map((command) => [command.data.name, command]));
}

function formatTrackerSide(side, track = "rc") {
  if (!side) return "not enough data";

  const window = side.clearWindow;
  const skillsets = side.skillsets?.length
    ? `; skills: ${side.skillsets.map(({ name, label, rawDan, clears, clearStatus }) =>
        `${formatSkillsetName(name)} ${formatTrackerDanEstimate({ label, rawDan }, track)}` +
        ` (${clearStatus ?? `${clears ?? 0} ${clears === 1 ? "clear" : "clears"}`})`
      ).join(", ")}`
    : "";
  const evidence = window ? ` (${window.have}/${window.need} evidence` +
    (Number.isFinite(window.fullSkillsets) && Number.isFinite(window.totalSkillsets)
      ? `; ${window.fullSkillsets}/${window.totalSkillsets} skillsets complete`
      : "") + skillsets + ")" : skillsets;
  return `**${formatTrackerDanEstimate(side, track)}**${evidence}`;
}

function formatTrackerDanEstimate(side, track = "rc") {
  if (!Number.isFinite(side.rawDan) || side.rawDan <= 0) return side.label;

  const rank = Math.round(side.rawDan);
  if (rank < 1) return side.label;
  const ordinal = (number) => {
    const remainder = number % 100;
    const suffix = remainder >= 11 && remainder <= 13
      ? "th"
      : ({ 1: "st", 2: "nd", 3: "rd" }[number % 10] ?? "th");
    return `${number}${suffix}`;
  };
  const danName = track === "ln" || rank <= 10
    ? `${ordinal(rank)} Dan`
    : ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa"][
        rank - 11
      ] ?? `Dan ${rank}`;
  const label = side.label.toLowerCase();
  const sublevel = label.endsWith("-") ? "Low" : label.endsWith("+") ? "High" : "Mid";
  return `${danName} ${sublevel}`;
}

function formatSkillsetName(name) {
  return ({
    jack: "Jack",
    tech: "Tech",
    speed: "Speed",
    stamina: "Stamina",
    lnhybrid: "LN hybrid",
    lntechnical: "LN technical",
    lnwalls: "LN walls",
    lnspeed: "LN speed"
  })[name] ?? name;
}

function formatDanStatus(
  profile,
  courseClear,
  track,
  trackerEntryStatus = null,
  trackerUnavailable = false,
  trackerEstimate = null,
  trackerCourseLevelIds = []
) {
  const descriptions = [];

  if (courseClear?.scoreUrl) {
    const name = courseClear.courseName ?? `${track.toUpperCase()} course`;
    const level = courseClear.level ? ` — ${courseClear.level.toUpperCase()}` : "";
    const accuracy = Number.isFinite(courseClear.stableAccuracy)
      ? ` (${(courseClear.stableAccuracy * 100).toFixed(2)}% stable acc)`
      : "";
    const label = `**${name}${level}**${accuracy}`;
    descriptions.push(courseClear.scoreUrl ? `[${label}](${courseClear.scoreUrl})` : label);
  }

  const manualHighest = DanProgression.highestCleared(
    profile.manualClearProofs.map((proof) => proof.danLevelId),
    track
  );
  if (manualHighest) {
    descriptions.push(`manual: **${manualHighest.label}**`);
  }

  const trustedLevelIds = [
    ...profile.osuCourseClearLevels,
    ...profile.manualClearProofs.map((proof) => proof.danLevelId),
    ...trackerCourseLevelIds
  ];
  const verifiedHighest = DanProgression.highestCleared(trustedLevelIds, track);
  const trackerHighest = DanProgression.highestCleared(trackerCourseLevelIds, track);
  if (
    verifiedHighest &&
    !manualHighest &&
    verifiedHighest.id !== trackerHighest?.id
  ) {
    descriptions.push(`**${verifiedHighest.label}** (verified)`);
  }

  const prefix = `${track.toUpperCase()} Dan`;
  if (descriptions.length > 0) return `${prefix} course clear: ${descriptions.join("; ")}`;
  if (trackerEstimate) {
    const reason = trackerEntryStatus
      ? `; tracker score not verified: ${trackerEntryStatus}`
      : "";
    return `${prefix} estimate: **${formatTrackerDanEstimate(trackerEstimate, track)}** ` +
      `(Mania Tracker; no verified course clear${reason})`;
  }
  const status = trackerEntryStatus
    ? `none verified (${trackerEntryStatus})`
    : trackerUnavailable
      ? "tracker data unavailable"
      : "none verified";
  return `${prefix} course clear: **${status}**`;
}

export async function handleAutocomplete(interaction) {
  const query = interaction.options.getFocused().toLowerCase();
  const choices = DAN_LEVELS
    .filter((level) =>
      level.label.toLowerCase().includes(query) || level.id.includes(query)
    )
    .slice(0, 25)
    .map((level) => ({ name: level.label, value: level.id }));

  await interaction.respond(choices);
}

async function defaultFetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}`);
  }
  return response.text();
}
