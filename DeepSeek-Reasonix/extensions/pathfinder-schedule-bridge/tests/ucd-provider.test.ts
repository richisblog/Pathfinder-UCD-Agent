import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizeAuditedSearchResult, queryScheduleBuilderInPage } from "../src/content/ucd-schedule-builder-provider";

afterEach(() => vi.unstubAllGlobals());

describe("audited UC Davis Schedule Builder provider", () => {
  it("keeps PIDM inside the page-origin search request", async () => {
    vi.stubGlobal("document", {
      querySelector: () => ({ value: "1234567" }),
      querySelectorAll: () => [],
      scripts: [],
    });
    vi.stubGlobal("window", {});
    const fetchMock = vi.fn(async () => new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await queryScheduleBuilderInPage("202610", "ECS 150");
    const [, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    const request = new URLSearchParams(String(init.body));

    expect(request.get("method")).toBe("search");
    expect(request.get("pidm")).toBe("1234567");
    expect(JSON.stringify(result)).not.toContain("1234567");
  });

  it("reads PIDM from Schedule Builder's nested user state without returning it", async () => {
    vi.stubGlobal("document", {
      querySelector: () => null,
      querySelectorAll: () => [],
      scripts: [],
    });
    vi.stubGlobal("window", { user: { pidm: "7654321", getPidm: () => "must-not-be-called" } });
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await queryScheduleBuilderInPage("202610", "ECS 150");
    const [, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    const request = new URLSearchParams(String(init.body));

    expect(request.get("pidm")).toBe("7654321");
    expect(JSON.stringify(result)).not.toContain("7654321");
  });

  it("accepts the school's BOM-prefixed JSON response", async () => {
    vi.stubGlobal("document", {
      querySelector: () => ({ value: "1234567" }),
      querySelectorAll: () => [],
      scripts: [],
    });
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("\uFEFF[]", { status: 200 })));

    const result = await queryScheduleBuilderInPage("202610", "ECS 150");

    expect(result.executionError).toBeUndefined();
    expect(result.sections).toEqual([]);
  });

  it("surfaces a MAIN-world execution error instead of losing the result", () => {
    expect(() => normalizeAuditedSearchResult({
      fetchedAt: "2026-07-16T13:00:00.000Z",
      rawSectionCount: 0,
      sections: [],
      executionError: "ReferenceError: example is not defined",
    }, "202610", "ECS 150")).toThrow(/ReferenceError: example is not defined/);
  });

  it("surfaces the school's bounded search error sentinel", () => {
    expect(() => normalizeAuditedSearchResult({
      fetchedAt: "2026-07-16T13:00:00.000Z",
      rawSectionCount: 1,
      sections: [],
      serverError: "Synthetic Schedule Builder search error",
    }, "202610", "ECS 150")).toThrow(/Synthetic Schedule Builder search error/);
  });

  it("normalizes every returned section and keeps only academic evidence", () => {
    const result = normalizeAuditedSearchResult({
      fetchedAt: "2026-07-16T13:00:00.000Z",
      rawSectionCount: 2,
      sections: [
        {
          course: {
            termCode: "202610",
            shortDesc: "ECS 150 001",
            seqNum: "001",
            crn: "29066",
            title: "Operating Systems & System Programming",
            unitsLow: 4,
            unitsHigh: 0,
            dropDesc: "10 Day Drop",
            dropDate: "October, 06 2026 00:00:00",
          },
          meetings: [
            { daysString: "TR", startTime: "1210", endTime: "1330", building: "Wellman Hall", room: "00002", description: "Lecture" },
          ],
          instructors: ["Synthetic Instructor"],
          prerequisite: "ECS 036C; ECS 154A.",
          generalEducation: "SE",
          finalExamDate: "December, 08 2026 10:30:00",
          seats: { seatsAvail: 130, waitCount: 0 },
          notes: ["Synthetic public course note"],
        },
        {
          course: { termCode: "202610", shortDesc: "ECS 150 002", seqNum: "002", crn: "29067", title: "Operating Systems", unitsLow: 4 },
          meetings: [], instructors: [], seats: { seatsAvail: 0, waitCount: 4 }, notes: [],
        },
      ],
    }, "202610", "ECS 150");

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]).toMatchObject({
      crn: "29066",
      section: "001",
      units: "4",
      prerequisites: "ECS 036C; ECS 154A.",
      generalEducation: "SE",
      dropRule: "10 Day Drop",
      enrollment: { openSeats: 130, waitlistCount: 0, status: "open" },
      meetings: [{ days: ["T", "R"], startTime: "12:10", endTime: "13:30", location: "Wellman Hall 2", type: "Lecture" }],
      finalExam: { date: "December, 08 2026 10:30:00" },
    });
    expect(JSON.stringify(result)).not.toMatch(/pidm|cookie|csrf|authorization/i);
  });

  it("rejects a mismatched term instead of returning ambiguous evidence", () => {
    expect(() => normalizeAuditedSearchResult({
      fetchedAt: "2026-07-16T13:00:00.000Z",
      sections: [{ course: { termCode: "202603", crn: "1", seqNum: "001" }, meetings: [], instructors: [], notes: [] }],
    }, "202610", "ECS 150")).toThrow(/term/i);
  });

  it("refuses to cache a false empty result after the school returned rows", () => {
    expect(() => normalizeAuditedSearchResult({
      fetchedAt: "2026-07-16T13:00:00.000Z",
      rawSectionCount: 1,
      sections: [],
      schemaDiagnostics: {
        itemKeys: ["Course", "Meeting"],
        courseKeys: ["CRN", "SeqNum", "TermCode"],
        courseContainerKey: "Course",
        crnCandidateTypes: { CRN: "string" },
      },
    }, "202610", "ECS 150")).toThrow(/Course.*CRN.*string/i);
  });
});
