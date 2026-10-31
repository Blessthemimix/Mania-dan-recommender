import { REST, Routes } from "discord.js";
import { getDiscordConfig } from "../config.js";
import { createCommands } from "./commands.js";

const { token, appId, guildId } = getDiscordConfig();

// Handlers are never run here, so the dependencies can be empty.
const commands = createCommands({});
const body = [...commands.values()].map((command) => command.data.toJSON());

const rest = new REST({ version: "10" }).setToken(token);
const route = guildId
  ? Routes.applicationGuildCommands(appId, guildId)
  : Routes.applicationCommands(appId);

await rest.put(route, { body });

console.log(
  `Registered ${body.length} commands ${guildId ? `to server ${guildId}` : "globally"}: ` +
    body.map((c) => `/${c.name}`).join(", ")
);
