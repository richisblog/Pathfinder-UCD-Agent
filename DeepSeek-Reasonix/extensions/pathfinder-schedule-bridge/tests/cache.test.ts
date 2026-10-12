import { describe, expect, it } from "vitest";

import { ScheduleCache } from "../src/background/cache";

describe("ScheduleCache", () => {
  it("retains public data for thirty minutes but expires seat freshness after sixty seconds", () => {
    let now = Date.UTC(2026, 6, 16, 9, 0, 0);
    const cache = new ScheduleCache(() => now);
    cache.putPublic("ecs-036a", { sections: 30 });

    now += 61_000;
    expect(cache.getPublic("ecs-036a")).toMatchObject({ retained: true, structureLive: true, availabilityLive: false });

    now += 30 * 60_000;
    expect(cache.getPublic("ecs-036a")).toBeUndefined();
  });

  it("keeps personal data in memory for five minutes and clears it by session", () => {
    let now = Date.UTC(2026, 6, 16, 9, 0, 0);
    const cache = new ScheduleCache(() => now);
    cache.putPersonal("session-a", "holds", []);
    cache.putPersonal("session-b", "holds", ["synthetic-hold"]);

    cache.clearPersonal("session-a");
    expect(cache.getPersonal("session-a", "holds")).toBeUndefined();
    expect(cache.getPersonal("session-b", "holds")?.data).toEqual(["synthetic-hold"]);

    now += 5 * 60_000 + 1;
    expect(cache.getPersonal("session-b", "holds")).toBeUndefined();
  });
});
