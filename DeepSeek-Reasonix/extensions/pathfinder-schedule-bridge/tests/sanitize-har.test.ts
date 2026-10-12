import { describe, expect, it } from "vitest";

import { sanitizeHAR } from "../scripts/sanitize-har.mjs";

const safeHAR = {
  log: {
    entries: [{
      request: {
        method: "POST",
        url: "https://my.ucdavis.edu/schedulebuilder/api/course/search?term=2026-fall",
        headers: [{ name: "Accept", value: "application/json" }],
        queryString: [{ name: "term", value: "2026-fall" }],
        postData: {
          mimeType: "application/json",
          text: JSON.stringify({ course: "SYNTHETIC 001", page: 2 }),
        },
      },
      response: {
        status: 200,
        headers: [{ name: "Content-Type", value: "application/json" }],
        content: {
          mimeType: "application/json",
          text: JSON.stringify({ sections: [{ crn: "SYNTHETIC-CRN", seats: 4 }], totalPages: 3 }),
        },
      },
    }],
  },
};

describe("sanitizeHAR", () => {
  it("emits only endpoint contracts, field names, and value-free shapes", () => {
    const sanitized = sanitizeHAR(safeHAR);
    expect(sanitized.endpoints).toHaveLength(1);
    expect(sanitized.endpoints[0]).toMatchObject({
      host: "my.ucdavis.edu",
      path: "/schedulebuilder/api/course/search",
      method: "POST",
      requestFields: ["course", "page", "term"],
      responseShape: { sections: [{ crn: "string", seats: "number" }], totalPages: "number" },
    });
    const encoded = JSON.stringify(sanitized);
    expect(encoded).not.toContain("SYNTHETIC 001");
    expect(encoded).not.toContain("SYNTHETIC-CRN");
    expect(encoded).not.toContain("2026-fall");
  });

  it("rejects cookies, authorization, CSRF, login identifiers, and email before emitting output", () => {
    const unsafe = structuredClone(safeHAR);
    unsafe.log.entries[0]!.request.headers.push({ name: "Cookie", value: "session=secret" });
    unsafe.log.entries[0]!.request.postData.text = JSON.stringify({ csrfToken: "secret", email: "student@ucdavis.edu" });
    expect(() => sanitizeHAR(unsafe)).toThrow(/cookie.*csrf.*email/i);
  });

  it("rejects non-UC-Davis hosts", () => {
    const unsafe = structuredClone(safeHAR);
    unsafe.log.entries[0]!.request.url = "https://example.com/collect";
    expect(() => sanitizeHAR(unsafe)).toThrow(/host/i);
  });
});
