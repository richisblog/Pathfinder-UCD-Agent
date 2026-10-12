import { describe, expect, it } from "vitest";

import { validateIncomingRequest } from "../src/protocol/validate";

describe("validateIncomingRequest", () => {
  it("accepts a version-one schedule search", () => {
    expect(
      validateIncomingRequest({
        protocol: 1,
        id: "req_01JABCDEF0123456789",
        type: "request",
        method: "schedule.search",
        params: { term: "2026-fall", courses: ["ECS 036A"] },
      }).method,
    ).toBe("schedule.search");
  });

  it("rejects an arbitrary URL method", () => {
    expect(() =>
      validateIncomingRequest({
        protocol: 1,
        id: "req_01JABCDEF0123456789",
        type: "request",
        method: "fetch",
        params: { url: "https://example.com" },
      }),
    ).toThrow(/unknown method/i);
  });

  it.each([
    ["unsupported protocol", { protocol: 2 }, /protocol/i],
    ["malformed id", { id: "bad id" }, /request id/i],
    ["empty courses", { params: { term: "2026-fall", courses: [] } }, /courses/i],
    ["oversized course", { params: { term: "2026-fall", courses: ["E".repeat(33)] } }, /course/i],
    ["privileged top-level field", { url: "https://example.com" }, /unknown field/i],
  ])("rejects %s", (_name, patch, pattern) => {
    const base = {
      protocol: 1,
      id: "req_01JABCDEF0123456789",
      type: "request",
      method: "schedule.search",
      params: { term: "2026-fall", courses: ["ECS 036A"] },
    };
    expect(() => validateIncomingRequest({ ...base, ...patch })).toThrow(pattern as RegExp);
  });

  it("accepts one hundred courses as a memory-safety ceiling", () => {
    const courses = Array.from({ length: 100 }, (_, index) => `ECS ${index}`);
    expect(
      validateIncomingRequest({
        protocol: 1,
        id: "req_01JABCDEF0123456789",
        type: "request",
        method: "schedule.search",
        params: { term: "2026-fall", courses },
      }).params,
    ).toEqual({ term: "2026-fall", courses });
  });
});
