export interface NormalizedMeeting {
  days?: string[];
  startTime?: string;
  endTime?: string;
  location?: string;
  type?: string;
}

export interface NormalizedEnrollment {
  capacity?: number;
  enrolled?: number;
  openSeats?: number;
  waitlistCount?: number;
  waitlistCapacity?: number;
  status?: "open" | "closed" | "waitlist" | "cancelled" | "unknown";
}

export interface NormalizedSection {
  crn: string;
  section: string;
  title?: string;
  units?: string;
  instructors?: string[];
  meetings?: NormalizedMeeting[];
  enrollment?: NormalizedEnrollment;
  restrictions?: string[];
  notes?: string;
  prerequisites?: string;
  generalEducation?: string;
  dropRule?: string;
  dropDeadline?: string;
  finalExam?: { date?: string; startTime?: string; endTime?: string; location?: string };
  cancelled?: boolean;
}

export interface NormalizedCoursePage {
  provider: "ucd_schedule_builder" | "ucd_class_search";
  providerVersion: string;
  sourceUrl: string;
  fetchedAt: string;
  term: string;
  course: string;
  page: number;
  sections: NormalizedSection[];
}

export interface NormalizedCourseEvidence {
  provider: NormalizedCoursePage["provider"];
  providerVersion: string;
  sourceUrl: string;
  fetchedAt: string;
  term: string;
  course: string;
  freshness: "live";
  pagesFetched: number;
  sections: NormalizedSection[];
}

export function mergeCoursePages(pages: NormalizedCoursePage[]): NormalizedCourseEvidence {
  if (pages.length === 0) throw new Error("At least one normalized course page is required");
  const ordered = [...pages].sort((left, right) => left.page - right.page);
  const first = ordered[0]!;
  validatePage(first);

  const sections = new Map<string, NormalizedSection>();
  for (const current of ordered) {
    validatePage(current);
    if (current.course !== first.course) throw new Error("Cannot merge mixed course pages");
    if (current.term !== first.term) throw new Error("Cannot merge mixed term pages");
    if (current.provider !== first.provider || current.providerVersion !== first.providerVersion) {
      throw new Error("Cannot merge mixed provider contracts");
    }
    for (const section of current.sections) {
      validateSection(section);
      sections.set(section.crn, cloneSection(section));
    }
  }

  const last = ordered.at(-1)!;
  return {
    provider: first.provider,
    providerVersion: first.providerVersion,
    sourceUrl: first.sourceUrl,
    fetchedAt: last.fetchedAt,
    term: first.term,
    course: first.course,
    freshness: "live",
    pagesFetched: ordered.length,
    sections: [...sections.values()],
  };
}

function validatePage(page: NormalizedCoursePage): void {
  if (!Number.isInteger(page.page) || page.page < 1) throw new Error("Normalized page number is invalid");
  for (const value of [page.providerVersion, page.sourceUrl, page.fetchedAt, page.term, page.course]) {
    if (typeof value !== "string" || value.trim() === "") throw new Error("Normalized page metadata is incomplete");
    assertSafeEvidence(value);
  }
  if (!/^https:\/\/(?:my|registrar-apps)\.ucdavis\.edu\//.test(page.sourceUrl)) {
    throw new Error("Normalized evidence source is not an approved UC Davis URL");
  }
  if (!Array.isArray(page.sections)) throw new Error("Normalized sections must be an array");
}

function validateSection(section: NormalizedSection): void {
  if (typeof section.crn !== "string" || section.crn.trim() === "") throw new Error("Normalized section CRN is required");
  if (typeof section.section !== "string" || section.section.trim() === "") throw new Error("Normalized section label is required");
  assertSafeEvidence(section);
}

function assertSafeEvidence(value: unknown, key = "evidence"): void {
  if (/cookie|authorization|csrf|xsrf|password|passphrase|session.?id|student.?id/i.test(key)) {
    throw new Error(`Unsafe evidence field ${key}`);
  }
  if (typeof value === "string") {
    if (/<\/?[a-z][^>]*>/i.test(value) || /\bBearer\s+\S+/i.test(value) || /@ucdavis\.edu\b/i.test(value)) {
      throw new Error("Unsafe evidence value detected");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertSafeEvidence(item, key);
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) assertSafeEvidence(child, childKey);
  }
}

function cloneSection(section: NormalizedSection): NormalizedSection {
  return {
    ...section,
    ...(section.instructors ? { instructors: [...section.instructors] } : {}),
    ...(section.meetings ? { meetings: section.meetings.map((meeting) => ({ ...meeting, ...(meeting.days ? { days: [...meeting.days] } : {}) })) } : {}),
    ...(section.enrollment ? { enrollment: { ...section.enrollment } } : {}),
    ...(section.restrictions ? { restrictions: [...section.restrictions] } : {}),
    ...(section.finalExam ? { finalExam: { ...section.finalExam } } : {}),
  };
}
