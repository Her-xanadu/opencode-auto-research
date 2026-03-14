import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { summarizeEvents } from "../../src/monitor/controller";

async function parseFixture(name: string) {
  const raw = await fs.readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), `../../fixtures/events/${name}.jsonl`), "utf8");
  return raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

describe("monitor controller", () => {
  it("classifies running, stalled, failed, completed, and recoverable states", async () => {
    expect(summarizeEvents(await parseFixture("running")).state).toBe("running");
    expect(summarizeEvents(await parseFixture("stalled"), 1).state).toBe("stalled");
    expect(summarizeEvents(await parseFixture("failed")).state).toBe("recoverable");
    expect(summarizeEvents(await parseFixture("completed")).state).toBe("completed");
  });
});
