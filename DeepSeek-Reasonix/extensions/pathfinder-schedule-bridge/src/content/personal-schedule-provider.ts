import type { PersonalParams } from "../protocol/messages";

export type PersonalCourseStatus = "registered" | "waitlisted";

export interface PersonalCourse {
  crn: string;
  status: PersonalCourseStatus;
  course?: string;
  section?: string;
  title?: string;
  units?: string;
  instructors?: string[];
  dropDate?: string;
  finalExamStart?: string;
  meetings?: Array<{
    type?: string;
    days?: string[];
    location?: string;
    startDate?: string;
    startTime?: string;
    endDate?: string;
    endTime?: string;
  }>;
}

export interface PersonalPassTime {
  pass: 1 | 2;
  sourceText: string;
  localDateTime: string;
  instant: string;
  timeZone: "America/Los_Angeles";
  abbreviation: "PST" | "PDT";
  utcOffset: string;
}

export interface PersonalScheduleEvidence {
  fetchedAt: string;
  term: string;
  courses: PersonalCourse[];
  passTimes?: PersonalPassTime[];
}

/**
 * Runs in Schedule Builder's MAIN world. Only the bounded academic fields
 * returned here cross into the extension; page scripts and identifiers such as
 * PIDM, student ID, and instructor email remain inside the university page.
 */
export function queryPersonalScheduleInPage(
  term: string,
  categories: PersonalParams["categories"],
): PersonalScheduleEvidence {
  const pageScripts = Array.from(document.scripts)
    .map((script) => (script.textContent ?? "").slice(0, 1_000_000));
  let resolvedTerm = term;
  if (term === "current") {
    const urlTerm = typeof location !== "undefined"
      ? new URLSearchParams(location.search).get("termCode")
      : undefined;
    const scriptTerm = pageScripts.join("\n").match(/\btermCode\s*=\s*["'](\d{6})["']/i)?.[1];
    resolvedTerm = urlTerm ?? scriptTerm ?? "";
  }
  if (!/^\d{6}$/.test(resolvedTerm)) {
    throw new Error("INVALID_REQUEST: Schedule Builder requires a six-digit term code");
  }

  const requested = new Set(categories);
  const scriptText = pageScripts
    .filter((text) => text.includes("CourseDetails.t"))
    .join("\n");

  const passTimes: PersonalPassTime[] = [];
  if (requested.has("pass_times")) {
    const monthNumbers: Record<string, number> = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    };
    const pad = (value: number): string => String(value).padStart(2, "0");
    const offsetAt = (instant: Date): number => {
      const part = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        timeZoneName: "shortOffset",
      }).formatToParts(instant).find((candidate) => candidate.type === "timeZoneName")?.value ?? "";
      const match = part.match(/^GMT(?:(?<sign>[+-])(?<hour>\d{1,2})(?::(?<minute>\d{2}))?)?$/);
      if (!match) throw new Error("SITE_VERSION_UNSUPPORTED: Pacific timezone offset is unavailable");
      if (!match.groups?.sign) return 0;
      const magnitude = Number(match.groups.hour) * 60 + Number(match.groups.minute ?? "0");
      return match.groups.sign === "-" ? -magnitude : magnitude;
    };
    const wallPartsAt = (instant: Date): string => {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).formatToParts(instant);
      const get = (type: Intl.DateTimeFormatPartTypes): string =>
        parts.find((candidate) => candidate.type === type)?.value ?? "";
      return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
    };
    const normalizePassTime = (pass: 1 | 2, sourceText: string): PersonalPassTime => {
      const clean = sourceText.replace(/\s+/g, " ").trim().slice(0, 200);
      const match = clean.match(/^Pass\s+([12]):\s+([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i);
      if (!match || Number(match[1]) !== pass) {
        throw new Error("SITE_VERSION_UNSUPPORTED: Schedule Builder pass-time format changed");
      }
      const month = monthNumbers[match[2]!.toLowerCase()];
      if (!month) throw new Error("SITE_VERSION_UNSUPPORTED: Schedule Builder pass-time format changed");
      const day = Number(match[3]);
      const year = Number(match[4]);
      const minute = Number(match[6]);
      let hour = Number(match[5]) % 12;
      if (match[7]!.toUpperCase() === "PM") hour += 12;
      const localDateTime = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`;
      const wallAsUTC = Date.UTC(year, month - 1, day, hour, minute, 0);
      let instantMillis = wallAsUTC;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        instantMillis = wallAsUTC - offsetAt(new Date(instantMillis)) * 60_000;
      }
      const instantDate = new Date(instantMillis);
      if (wallPartsAt(instantDate) !== localDateTime) {
        throw new Error("SITE_VERSION_UNSUPPORTED: Schedule Builder pass time is invalid");
      }
      const offsetMinutes = offsetAt(instantDate);
      const offsetSign = offsetMinutes < 0 ? "-" : "+";
      const offsetMagnitude = Math.abs(offsetMinutes);
      const utcOffset = `${offsetSign}${pad(Math.floor(offsetMagnitude / 60))}:${pad(offsetMagnitude % 60)}`;
      const abbreviation = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        timeZoneName: "short",
      }).formatToParts(instantDate).find((candidate) => candidate.type === "timeZoneName")?.value;
      if (abbreviation !== "PST" && abbreviation !== "PDT") {
        throw new Error("SITE_VERSION_UNSUPPORTED: Pacific timezone abbreviation is unavailable");
      }
      return {
        pass,
        sourceText: clean,
        localDateTime,
        instant: `${localDateTime}${utcOffset}`,
        timeZone: "America/Los_Angeles",
        abbreviation,
        utcOffset,
      };
    };
    const scriptFallback = pageScripts.join("\n");
    for (const pass of [1, 2] as const) {
      const node = typeof document.querySelector === "function"
        ? document.querySelector(`#PassTime${pass}`)
        : null;
      const nodeText = node?.textContent?.replace(/\s+/g, " ").trim().slice(0, 200);
      const assignment = scriptFallback.match(
        new RegExp(`pass${pass}\\.html\\(\\s*[\`"'](Pass\\s+${pass}:[^\`"']{1,180})[\`"']\\s*\\)`, "i"),
      )?.[1];
      const sourceText = nodeText || assignment;
      if (sourceText) passTimes.push(normalizePassTime(pass, sourceText));
    }
  }

  const statuses = new Map<string, PersonalCourseStatus>();
  const statusPattern = /CourseDetails\.t([A-Za-z0-9_-]{5,80})\.REGISTRATION_STATUS\s*=\s*["'](Registered|Waitlisted)["']\s*;/gi;
  for (const match of scriptText.matchAll(statusPattern)) {
    const status = match[2]?.toLowerCase() as PersonalCourseStatus;
    if ((status === "registered" && requested.has("schedule"))
      || (status === "waitlisted" && requested.has("waitlist"))) {
      statuses.set(match[1]!, status);
    }
  }

  const objectByID = new Map<string, string>();
  const objectPattern = /CourseDetails\.t([A-Za-z0-9_-]{5,80})\s*=\s*\{(.*?)\}\s*;/gs;
  for (const match of scriptText.matchAll(objectPattern)) {
    objectByID.set(match[1]!, match[2] ?? "");
  }

  const readString = (source: string, key: string): string | undefined => {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = source.match(new RegExp(`"${escapedKey}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`));
    if (!match?.[1]) return undefined;
    try {
      const value = JSON.parse(match[1]) as unknown;
      if (typeof value !== "string") return undefined;
      const clean = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      return clean ? clean.slice(0, 500) : undefined;
    } catch {
      return undefined;
    }
  };

  const readInstructors = (source: string): string[] => {
    const array = source.match(/"INSTRUCTORS"\s*:\s*\[(.*?)\]/s)?.[1];
    if (!array) return [];
    const names: string[] = [];
    for (const match of array.matchAll(/\{(.*?)\}/gs)) {
      const first = readString(match[1] ?? "", "FIRST_NAME");
      const last = readString(match[1] ?? "", "LAST_NAME");
      const name = [first, last].filter(Boolean).join(" ");
      if (name) names.push(name);
    }
    return names;
  };

  const readDate = (source: string, key: string): { date: string; time: string } | undefined => {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = source.match(new RegExp(
      `"${escapedKey}"\\s*:\\s*new Date\\(\\s*(\\d{4})\\s*,\\s*\\(?\\s*(\\d{1,2})(\\s*-\\s*1)?\\s*\\)?\\s*,\\s*(\\d{1,2})\\s*,\\s*(\\d{1,2})\\s*,\\s*(\\d{1,2})\\s*,\\s*(\\d{1,2})`,
    ));
    if (!match) return undefined;
    const year = Number(match[1]);
    const month = Number(match[2]) + (match[3] ? 0 : 1);
    const day = Number(match[4]);
    const hour = Number(match[5]);
    const minute = Number(match[6]);
    const second = Number(match[7]);
    const value = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day ||
      value.getUTCHours() !== hour || value.getUTCMinutes() !== minute || value.getUTCSeconds() !== second) {
      return undefined;
    }
    const pad = (number: number): string => String(number).padStart(2, "0");
    return { date: `${year}-${pad(month)}-${pad(day)}`, time: `${pad(hour)}:${pad(minute)}:${pad(second)}` };
  };

  const readMeetings = (source: string): NonNullable<PersonalCourse["meetings"]> => {
    const array = source.match(/"MEETINGS"\s*:\s*\[(.*?)\]/s)?.[1];
    if (!array) return [];
    const meetings: NonNullable<PersonalCourse["meetings"]> = [];
    for (const match of array.matchAll(/\{(.*?)\}/gs)) {
      const value = match[1] ?? "";
      const weekdays = readString(value, "WEEKDAYS");
      const start = readDate(value, "STARTTIME");
      const end = readDate(value, "ENDTIME");
      const meeting = {
        ...(readString(value, "TYPE") ? { type: readString(value, "TYPE") } : {}),
        ...(weekdays ? { days: weekdays.replace(/[^MTWRFSU]/gi, "").toUpperCase().split("") } : {}),
        ...(readString(value, "LOCATION") ? { location: readString(value, "LOCATION") } : {}),
        ...(start ? { startDate: start.date, startTime: start.time } : {}),
        ...(end ? { endDate: end.date, endTime: end.time } : {}),
      };
      if (Object.keys(meeting).length > 0) meetings.push(meeting);
    }
    return meetings;
  };

  const registeredUnitsByID = new Map<string, string>();
  const registeredUnitsPattern = /CourseDetails\.t([A-Za-z0-9_-]{5,80})\.REGISTERED_UNITS\s*=\s*["'](\d+(?:\.\d+)?)["']\s*;/gi;
  for (const match of scriptText.matchAll(registeredUnitsPattern)) {
    const numeric = Number(match[2]);
    if (Number.isFinite(numeric)) registeredUnitsByID.set(match[1]!, String(numeric));
  }

  const courses: PersonalCourse[] = [];
  for (const [pageID, status] of statuses.entries()) {
    const source = objectByID.get(pageID) ?? "";
    const fieldCRN = readString(source, "CRN");
    const crn = /^\d{5}$/.test(fieldCRN ?? "") ? fieldCRN! : (/^\d{5}$/.test(pageID) ? pageID : "");
    if (!crn) continue;
    const subject = readString(source, "SUBJECT_CODE");
    const number = readString(source, "COURSE_NUMBER");
    const instructors = readInstructors(source);
    const meetings = readMeetings(source);
    const units = registeredUnitsByID.get(pageID) ?? readString(source, "UNITS");
    const drop = readDate(source, "DROP_DATE");
    const finalExam = readDate(source, "FINAL_EXAM_STARTDATE");
    courses.push({
      crn,
      status,
      ...(subject && number ? { course: `${subject} ${number}` } : {}),
      ...(readString(source, "SECTION_NUMBER") ? { section: readString(source, "SECTION_NUMBER") } : {}),
      ...(readString(source, "TITLE") ? { title: readString(source, "TITLE") } : {}),
      ...(units ? { units } : {}),
      ...(drop ? { dropDate: drop.date } : {}),
      ...(finalExam ? { finalExamStart: `${finalExam.date}T${finalExam.time}` } : {}),
      ...(instructors.length > 0 ? { instructors } : {}),
      ...(meetings.length > 0 ? { meetings } : {}),
    });
  }

  courses.sort((left, right) => {
    const statusOrder = Number(left.status === "waitlisted") - Number(right.status === "waitlisted");
    return statusOrder || (left.course ?? left.crn).localeCompare(right.course ?? right.crn);
  });
  return {
    fetchedAt: new Date().toISOString(),
    term: resolvedTerm,
    courses,
    ...(requested.has("pass_times") && passTimes.length > 0 ? { passTimes } : {}),
  };
}
