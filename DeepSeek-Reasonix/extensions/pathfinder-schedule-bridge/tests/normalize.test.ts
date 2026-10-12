import { describe, expect, it } from "vitest";

import { mergeCoursePages, type NormalizedCoursePage } from "../src/normalize/schedule";

function page(pageNumber: number, sections: NormalizedCoursePage["sections"]): NormalizedCoursePage {
  return {
    provider: "ucd_schedule_builder",
    providerVersion: "synthetic-contract-v1",
    sourceUrl: "https://my.ucdavis.edu/schedulebuilder/",
    fetchedAt: "2026-07-16T11:00:00.000Z",
    term: "2026-fall",
    course: "ECS 036A",
    page: pageNumber,
    sections,
  };
}

describe("mergeCoursePages", () => {
  it("merges thirty sections across sequential pages without a product cutoff", () => {
    const sections = Array.from({ length: 30 }, (_, index) => ({
      crn: String(50000 + index),
      section: String.fromCharCode(65 + index),
      enrollment: { openSeats: index, waitlistCount: index % 4 },
    }));

    const merged = mergeCoursePages([
      page(1, sections.slice(0, 12)),
      page(2, sections.slice(12, 24)),
      page(3, sections.slice(24)),
    ]);

    expect(merged.sections).toHaveLength(30);
    expect(merged.pagesFetched).toBe(3);
    expect(merged.sections.map((section) => section.crn)).toEqual(sections.map((section) => section.crn));
  });

  it("deduplicates repeated CRNs while preserving the freshest page value", () => {
    const merged = mergeCoursePages([
      page(1, [{ crn: "50001", section: "A01", enrollment: { openSeats: 2 } }]),
      page(2, [{ crn: "50001", section: "A01", enrollment: { openSeats: 1 } }]),
    ]);
    expect(merged.sections).toEqual([{ crn: "50001", section: "A01", enrollment: { openSeats: 1 } }]);
  });

  it("fails closed when pages mix terms or courses", () => {
    const mismatched = page(2, []);
    mismatched.course = "ECS 050";
    expect(() => mergeCoursePages([page(1, []), mismatched])).toThrow(/mixed course/i);
  });

  it("rejects raw HTML and credential-shaped fields from normalized evidence", () => {
    expect(() => mergeCoursePages([
      page(1, [{ crn: "50001", section: "A01", notes: "<script>raw response</script>" }]),
    ])).toThrow(/unsafe evidence/i);
  });
});
