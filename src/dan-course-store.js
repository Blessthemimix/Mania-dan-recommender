import { readFile } from "node:fs/promises";

/**
 * Reads data/dan-courses.json: the list of real beatmaps that represent each
 * Dan level, which the background sync checks players' scores against.
 *
 * Each entry: { danLevelId, beatmapId, isCourseClear? }.
 * Individual chart entries can inform chart estimates; only a map explicitly
 * marked isCourseClear may be counted as a complete Dan course by score sync.
 */
export class JsonCourseStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async list() {
    let data;
    try {
      data = JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }

    return Array.isArray(data) ? data : [];
  }
}
