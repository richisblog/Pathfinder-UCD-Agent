import { describe, expect, it } from "vitest";

import { ScheduleCache } from "../src/background/cache";
import { createRequestHandler, type ScheduleProvider, type ScheduleTabLocator } from "../src/background/request-handler";
import type { QueueClock } from "../src/background/query-queue";
import type { BridgeRequest } from "../src/protocol/messages";

class FakeClock implements QueueClock {
  nowMs = Date.UTC(2026, 6, 16, 11, 0, 0);
  sleeps: number[] = [];
  now(): number { return this.nowMs; }
  async sleep(ms: number): Promise<void> { this.sleeps.push(ms); this.nowMs += ms; }
}

describe("schedule request service", () => {
  it("returns pass times for an authorized personal request", async () => {
    let requestedCategories: string[] = [];
    const provider: ScheduleProvider = {
      source: "ucd_schedule_builder",
      version: "synthetic-contract-v1",
      sourceUrl: "https://my.ucdavis.edu/schedulebuilder/",
      async searchCourse() { throw new Error("public search was not requested"); },
      async readPersonal(term, categories) {
        requestedCategories = categories;
        return {
          fetchedAt: "2026-07-23T15:00:00.000Z",
          term,
          courses: [],
          passTimes: [{
            pass: 1,
            sourceText: "Pass 1: May 18, 2026 09:30 AM",
            localDateTime: "2026-05-18T09:30:00",
            instant: "2026-05-18T09:30:00-07:00",
            timeZone: "America/Los_Angeles",
            abbreviation: "PDT",
            utcOffset: "-07:00",
          }],
        };
      },
    };
    const handler = createRequestHandler({ find: async () => ({ id: 7 }) }, {
      providerForTab: async () => provider,
    });

    const result = await handler({
      protocol: 1,
      id: "req_pass_times_01",
      type: "request",
      method: "schedule.personal",
      params: { term: "202610", categories: ["pass_times"] },
    });

    expect(result.status).toBe("OK");
    expect(requestedCategories).toEqual(["pass_times"]);
    expect(result.evidence?.personal).toMatchObject({
      passTimes: [{ pass: 1, abbreviation: "PDT", utcOffset: "-07:00" }],
    });
  });

  it("requests pass times with personal context attached to a public search", async () => {
    let requestedCategories: string[] = [];
    const provider: ScheduleProvider = {
      source: "ucd_schedule_builder",
      version: "synthetic-contract-v1",
      sourceUrl: "https://my.ucdavis.edu/schedulebuilder/",
      async searchCourse(term, course) {
        return {
          provider: "ucd_schedule_builder",
          providerVersion: "synthetic-contract-v1",
          sourceUrl: "https://my.ucdavis.edu/schedulebuilder/",
          fetchedAt: "2026-07-23T15:00:00.000Z",
          term,
          course,
          freshness: "live",
          pagesFetched: 1,
          sections: [],
        };
      },
      async readPersonal(term, categories) {
        requestedCategories = categories;
        return { fetchedAt: "2026-07-23T15:00:00.000Z", term, courses: [] };
      },
    };
    const handler = createRequestHandler({ find: async () => ({ id: 7 }) }, {
      providerForTab: async () => provider,
      minimumDelayMs: 0,
      jitterMs: 0,
    });

    const result = await handler({
      protocol: 1,
      id: "req_search_personal_01",
      type: "request",
      method: "schedule.search",
      params: { term: "202610", courses: ["ECS 189G"], include_personal_context: true },
    });

    expect(result.status).toBe("OK");
    expect(requestedCategories).toEqual(["schedule", "waitlist", "pass_times"]);
  });

  it("maps personal parser failures to a recoverable site-version status", async () => {
    const provider: ScheduleProvider = {
      source: "ucd_schedule_builder",
      version: "synthetic-contract-v1",
      sourceUrl: "https://my.ucdavis.edu/schedulebuilder/",
      async searchCourse() { throw new Error("public search was not requested"); },
      async readPersonal() {
        throw new Error("SITE_VERSION_UNSUPPORTED: private displayed value must not be echoed");
      },
    };
    const handler = createRequestHandler({ find: async () => ({ id: 7 }) }, {
      providerForTab: async () => provider,
    });

    const result = await handler({
      protocol: 1,
      id: "req_pass_error_01",
      type: "request",
      method: "schedule.personal",
      params: { term: "202610", categories: ["pass_times"] },
    });

    expect(result).toEqual({
      status: "SITE_VERSION_UNSUPPORTED",
      message: "Schedule Builder personal-data format changed. Update the Pathfinder extension.",
    });
    expect(result.message).not.toContain("private displayed value");
  });

  it("returns registered and waitlisted courses for an authorized personal request", async () => {
    const provider: ScheduleProvider = {
      source: "ucd_schedule_builder",
      version: "synthetic-contract-v1",
      sourceUrl: "https://my.ucdavis.edu/schedulebuilder/",
      async searchCourse() { throw new Error("public search was not requested"); },
      async readPersonal(term, categories) {
        return {
          fetchedAt: "2026-07-23T15:00:00.000Z",
          term,
          courses: ([
            { crn: "12345", course: "ECS 036A", section: "001", status: "registered" },
            { crn: "23456", course: "MAT 021A", section: "A01", status: "waitlisted" },
          ] as const).filter((course) => (
            course.status === "registered" ? categories.includes("schedule") : categories.includes("waitlist")
          )),
        };
      },
    };
    const handler = createRequestHandler({ find: async () => ({ id: 7 }) }, {
      providerForTab: async () => provider,
    });

    const result = await handler({
      protocol: 1,
      id: "req_personal_01",
      type: "request",
      method: "schedule.personal",
      params: { term: "202610", categories: ["schedule", "waitlist"] },
    });

    expect(result.status).toBe("OK");
    expect(result.evidence?.personal).toMatchObject({
      courses: [
        { crn: "12345", status: "registered" },
        { crn: "23456", status: "waitlisted" },
      ],
    });
  });

  it("queries twelve courses sequentially and returns normalized evidence", async () => {
    const clock = new FakeClock();
    let active = 0;
    let maximumActive = 0;
    const seen: string[] = [];
    const provider: ScheduleProvider = {
      source: "ucd_schedule_builder",
      version: "synthetic-contract-v1",
      sourceUrl: "https://my.ucdavis.edu/schedulebuilder/",
      async searchCourse(term, course) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        seen.push(course);
        active -= 1;
        return {
          provider: "ucd_schedule_builder",
          providerVersion: "synthetic-contract-v1",
          sourceUrl: "https://my.ucdavis.edu/schedulebuilder/",
          fetchedAt: new Date(clock.now()).toISOString(),
          term,
          course,
          freshness: "live",
          pagesFetched: 1,
          sections: [{ crn: `CRN-${course}`, section: "A" }],
        };
      },
    };
    const locator: ScheduleTabLocator = { find: async () => ({ id: 7 }) };
    const courses = Array.from({ length: 12 }, (_, index) => `ECS ${index}`);
    const request: BridgeRequest = {
      protocol: 1,
      id: "req_many_live",
      type: "request",
      method: "schedule.search",
      params: { term: "2026-fall", courses },
    };
    const handler = createRequestHandler(locator, {
      providerForTab: async () => provider,
      cache: new ScheduleCache(() => clock.now()),
      clock,
      minimumDelayMs: 3000,
      jitterMs: 0,
      random: () => 0,
    });

    const result = await handler(request);

    expect(result.status).toBe("OK");
    expect(result.evidence?.courses).toHaveLength(12);
    expect(seen).toEqual(courses);
    expect(maximumActive).toBe(1);
    expect(clock.sleeps).toEqual(Array.from({ length: 11 }, () => 3000));
  });

  it("reuses live cached course evidence without calling the provider", async () => {
    const clock = new FakeClock();
    const cache = new ScheduleCache(() => clock.now());
    cache.putPublic("ucd_schedule_builder|2026-fall|ECS 036A", {
      provider: "ucd_schedule_builder",
      providerVersion: "synthetic-contract-v1",
      sourceUrl: "https://my.ucdavis.edu/schedulebuilder/",
      fetchedAt: new Date(clock.now()).toISOString(),
      term: "2026-fall",
      course: "ECS 036A",
      freshness: "live",
      pagesFetched: 1,
      sections: [],
    });
    let providerCalls = 0;
    const provider: ScheduleProvider = {
      source: "ucd_schedule_builder",
      version: "synthetic-contract-v1",
      sourceUrl: "https://my.ucdavis.edu/schedulebuilder/",
      async searchCourse() { providerCalls += 1; throw new Error("unexpected"); },
    };
    const handler = createRequestHandler({ find: async () => ({ id: 7 }) }, {
      providerForTab: async () => provider,
      cache,
      clock,
      minimumDelayMs: 0,
      jitterMs: 0,
      random: () => 0,
    });
    const result = await handler({
      protocol: 1, id: "req_cached_01", type: "request", method: "schedule.search",
      params: { term: "2026-fall", courses: ["ECS 036A"] },
    });
    expect(result.status).toBe("OK");
    expect(providerCalls).toBe(0);
  });
});
