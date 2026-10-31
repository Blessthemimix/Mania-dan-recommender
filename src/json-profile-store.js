import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { UserProfile } from "./user-profile.js";

export class JsonProfileStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async load(userId) {
    const profiles = await this.#readAll();
    return new UserProfile(profiles[userId] ?? { userId });
  }

  /** All stored profiles, for the background osu! sync to loop over. */
  async listAll() {
    const profiles = await this.#readAll();
    return Object.values(profiles).map((data) => new UserProfile(data));
  }

  async save(profile) {
    const profiles = await this.#readAll();
    profiles[profile.userId] = profile.toJSON();

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(profiles, null, 2)}\n`, "utf8");
  }

  async #readAll() {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
  }
}
