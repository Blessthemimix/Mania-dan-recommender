import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { dataPaths, getDiscordConfig, getOsuApiKey } from "../config.js";
import { ManiaTrackerMapProvider } from "../map-provider.js";
import { JsonProfileStore } from "../json-profile-store.js";
import { JsonCourseStore } from "../dan-course-store.js";
import { RecommendationEngine } from "../recommendation-engine.js";
import { estimateMap } from "../map-estimator.js";
import { syncProfileFromOsu } from "../dan-course-sync.js";
import { createCommands, handleAutocomplete } from "./commands.js";

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

const { token } = getDiscordConfig();

const profileStore = new JsonProfileStore(dataPaths.profiles);
const courseStore = new JsonCourseStore(dataPaths.danCourses);

const commands = createCommands({
  profileStore,
  courseStore,
  engine: new RecommendationEngine(new ManiaTrackerMapProvider()),
  estimateMap
});

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  if (!getOsuApiKey()) {
    console.log("osu! API not configured (OSU_API_KEY) — automatic Dan tracking is off.");
    return;
  }

  runOsuSync();
  setInterval(runOsuSync, SYNC_INTERVAL_MS);
});

/** Checks every linked player's real scores against data/dan-courses.json. */
async function runOsuSync() {
  const courses = await courseStore.list();
  if (courses.length === 0) {
    console.log("osu! sync: skipped, data/dan-courses.json has no courses configured yet.");
    return;
  }

  const profiles = await profileStore.listAll();
  const linked = profiles.filter((profile) => profile.osuUserId);
  let totalUpdated = 0;
  let totalEstimatedMaps = 0;

  for (const profile of linked) {
    const { updated, trackedScores, estimatedMaps, clearsReconciled } =
      await syncProfileFromOsu(profile, courses);
    if (updated > 0 || trackedScores > 0 || estimatedMaps > 0 || clearsReconciled > 0) {
      await profileStore.save(profile);
      totalUpdated += updated;
      totalEstimatedMaps += estimatedMaps;
    }
  }

  console.log(
    `osu! sync: checked ${linked.length} linked player(s), ${totalUpdated} course update(s), ` +
      `estimated ${totalEstimatedMaps} top-play map(s).`
  );
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) {
      return;
    }

    const command = commands.get(interaction.commandName);
    if (!command) {
      return;
    }

    // Acknowledge within Discord's 3-second window before doing any work
    // (JSON file I/O, osu! API calls) that could otherwise blow past it.
    await interaction.deferReply(command.ephemeral ? { flags: MessageFlags.Ephemeral } : undefined);
    await command.execute(interaction);
  } catch (error) {
    console.error(`Command failed (${interaction.commandName}):`, error);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("Something went wrong running that command.").catch(() => {});
    }
  }
});

await client.login(token);
