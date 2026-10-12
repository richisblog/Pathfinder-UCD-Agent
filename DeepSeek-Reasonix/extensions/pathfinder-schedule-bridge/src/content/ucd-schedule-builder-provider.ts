import type { ScheduleBuilderTab, ScheduleProvider } from "../background/request-handler";
import type { NormalizedCourseEvidence, NormalizedMeeting, NormalizedSection } from "../normalize/schedule";
import { queryPersonalScheduleInPage, type PersonalScheduleEvidence } from "./personal-schedule-provider";
import type { PersonalParams } from "../protocol/messages";

const SEARCH_ENDPOINT = "https://my.ucdavis.edu/schedulebuilder/cf/search/search.cfc";
const CONTRACT_VERSION = "schedule-builder-search.cfc-2026-07";

interface AuditedCourseFields {
  termCode?: string;
  shortDesc?: string;
  seqNum?: string;
  crn?: string;
  title?: string;
  unitsLow?: number | string;
  unitsHigh?: number | string;
  dropDesc?: string;
  dropDate?: string;
}

interface AuditedMeetingFields {
  daysString?: string;
  startTime?: string;
  endTime?: string;
  building?: string;
  room?: string;
  description?: string;
  type?: string;
}

interface AuditedSection {
  course: AuditedCourseFields;
  meetings: AuditedMeetingFields[];
  instructors: string[];
  prerequisite?: string;
  generalEducation?: string;
  finalExamDate?: string;
  seats?: { seatsAvail?: number; waitCount?: number };
  notes: string[];
}

export interface AuditedSearchResult {
  fetchedAt: string;
  rawSectionCount?: number;
  executionError?: string;
  serverError?: string;
  schemaDiagnostics?: {
    itemKeys: string[];
    courseKeys: string[];
    courseContainerKey?: string;
    crnCandidateTypes: Record<string, string>;
    pidmInputKeys?: string[];
    pidmWindowPaths?: string[];
  };
  sections: AuditedSection[];
}

export function createChromeScheduleProvider(tab: ScheduleBuilderTab): ScheduleProvider {
  return {
    source: "ucd_schedule_builder",
    version: CONTRACT_VERSION,
    sourceUrl: SEARCH_ENDPOINT,
    async searchCourse(term, course) {
      if (!/^\d{6}$/.test(term)) {
        throw new Error("Schedule Builder requires its six-digit UC Davis term code");
      }
      const execution = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: queryScheduleBuilderInPage,
        args: [term, course],
      });
      const result = execution[0]?.result as AuditedSearchResult | undefined;
      if (!result) throw new Error("Schedule Builder did not return readable course evidence");
      return normalizeAuditedSearchResult(result, term, course);
    },
    async readPersonal(term: string, categories: PersonalParams["categories"]): Promise<PersonalScheduleEvidence> {
      const execution = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: queryPersonalScheduleInPage,
        args: [term, categories],
      });
      const result = execution[0]?.result as PersonalScheduleEvidence | undefined;
      if (!result || (term !== "current" && result.term !== term) || !/^\d{6}$/.test(result.term) || !Array.isArray(result.courses) || typeof result.fetchedAt !== "string") {
        throw new Error("Schedule Builder did not return readable personal schedule evidence");
      }
      return result;
    },
  };
}

export function normalizeAuditedSearchResult(
  result: AuditedSearchResult,
  term: string,
  course: string,
): NormalizedCourseEvidence {
  if (result.executionError) {
    throw new Error(`Schedule Builder page execution failed: ${result.executionError}`);
  }
  if (result.serverError) {
    const pidmSchema = result.schemaDiagnostics
      ? ` PIDM schema: inputs=${result.schemaDiagnostics.pidmInputKeys?.join(",") || "none"}; window=${result.schemaDiagnostics.pidmWindowPaths?.join(",") || "none"}.`
      : "";
    throw new Error(`Schedule Builder search failed: ${result.serverError}.${pidmSchema}`);
  }
  if (!result || !Array.isArray(result.sections) || typeof result.fetchedAt !== "string") {
    throw new Error("Schedule Builder returned an unsupported search response");
  }
  if ((result.rawSectionCount ?? 0) > 0 && result.sections.length === 0) {
    const schema = result.schemaDiagnostics;
    const diagnostic = schema
      ? ` item keys=${schema.itemKeys.join(",")}; course container=${schema.courseContainerKey ?? "missing"}; course keys=${schema.courseKeys.join(",")}; CRN candidate types=${Object.entries(schema.crnCandidateTypes).map(([key, type]) => `${key}:${type}`).join(",") || "missing"}`
      : "";
    throw new Error(`Schedule Builder returned sections that this extension could not safely normalize.${diagnostic}`);
  }

  const sections: NormalizedSection[] = result.sections.map((raw) => {
    if (raw.course.termCode !== term) throw new Error("Schedule Builder returned a mismatched term");
    const crn = cleanRequired(raw.course.crn, "section CRN");
    const section = cleanRequired(raw.course.seqNum, "section number");
    const meetings = raw.meetings.map(normalizeMeeting);
    const openSeats = finiteNumber(raw.seats?.seatsAvail);
    const waitlistCount = finiteNumber(raw.seats?.waitCount);
    const notes = raw.notes.filter(isUsefulText);

    return {
      crn,
      section,
      ...(isUsefulText(raw.course.title) ? { title: raw.course.title } : {}),
      ...(formatUnits(raw.course.unitsLow, raw.course.unitsHigh) ? { units: formatUnits(raw.course.unitsLow, raw.course.unitsHigh) } : {}),
      ...(raw.instructors.length > 0 ? { instructors: raw.instructors.filter(isUsefulText) } : {}),
      ...(meetings.length > 0 ? { meetings } : {}),
      ...(openSeats !== undefined || waitlistCount !== undefined ? {
        enrollment: {
          ...(openSeats === undefined ? {} : { openSeats }),
          ...(waitlistCount === undefined ? {} : { waitlistCount }),
          status: enrollmentStatus(openSeats, waitlistCount),
        },
      } : {}),
      ...(isUsefulText(raw.prerequisite) ? { prerequisites: raw.prerequisite } : {}),
      ...(isUsefulText(raw.generalEducation) ? { generalEducation: raw.generalEducation } : {}),
      ...(isUsefulText(raw.course.dropDesc) ? { dropRule: raw.course.dropDesc } : {}),
      ...(isUsefulText(raw.course.dropDate) ? { dropDeadline: raw.course.dropDate } : {}),
      ...(isUsefulText(raw.finalExamDate) ? { finalExam: { date: raw.finalExamDate } } : {}),
      ...(notes.length > 0 ? { notes: notes.join("\n") } : {}),
    };
  });

  return {
    provider: "ucd_schedule_builder",
    providerVersion: CONTRACT_VERSION,
    sourceUrl: SEARCH_ENDPOINT,
    fetchedAt: result.fetchedAt,
    term,
    course,
    freshness: "live",
    pagesFetched: 1,
    sections,
  };
}

function normalizeMeeting(raw: AuditedMeetingFields): NormalizedMeeting {
  const location = [raw.building, normalizeRoom(raw.room)].filter(isUsefulText).join(" ");
  return {
    ...(isUsefulText(raw.daysString) ? { days: raw.daysString.replace(/[^MTWRFSU]/gi, "").toUpperCase().split("") } : {}),
    ...(formatClock(raw.startTime) ? { startTime: formatClock(raw.startTime) } : {}),
    ...(formatClock(raw.endTime) ? { endTime: formatClock(raw.endTime) } : {}),
    ...(location ? { location } : {}),
    ...(isUsefulText(raw.description ?? raw.type) ? { type: (raw.description ?? raw.type)! } : {}),
  };
}

function formatClock(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}$/.test(value)) return undefined;
  return `${value.slice(0, 2)}:${value.slice(2)}`;
}

function normalizeRoom(value: unknown): string | undefined {
  if (!isUsefulText(value)) return undefined;
  return /^\d+$/.test(value) ? String(Number(value)) : value;
}

function formatUnits(low: unknown, high: unknown): string | undefined {
  const lowValue = typeof low === "number" || typeof low === "string" ? String(low) : "";
  const highValue = typeof high === "number" || typeof high === "string" ? String(high) : "";
  if (!lowValue) return undefined;
  return highValue && highValue !== "0" && highValue !== lowValue ? `${lowValue}-${highValue}` : lowValue;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function enrollmentStatus(openSeats?: number, waitlistCount?: number): "open" | "closed" | "waitlist" | "unknown" {
  if (openSeats === undefined) return "unknown";
  if (openSeats > 0) return "open";
  return (waitlistCount ?? 0) > 0 ? "waitlist" : "closed";
}

function cleanRequired(value: unknown, label: string): string {
  if (!isUsefulText(value)) throw new Error(`Schedule Builder ${label} is missing`);
  return value;
}

function isUsefulText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Runs in Schedule Builder's MAIN world so the school's own authenticated
 * cookies stay inside that origin. It returns a strict academic-data subset;
 * PIDM, cookies, request headers and page HTML never cross into the extension.
 */
export async function queryScheduleBuilderInPage(term: string, course: string): Promise<AuditedSearchResult> {
  try {
  const endpoint = "/schedulebuilder/cf/search/search.cfc";
  if (!/^\d{6}$/.test(term) || !/^[A-Z]{2,4}\s+\d{1,3}[A-Z]?$/i.test(course.trim())) {
    throw new Error("INVALID_REQUEST: unsupported term or course identifier");
  }

  const cleanText = (value: unknown, maximum = 2000): string | undefined => {
    if (typeof value !== "string" && typeof value !== "number") return undefined;
    const text = String(value).replace(/<[^>]*>/g, " ").replace(/&(?:nbsp|#160);/gi, " ").replace(/\s+/g, " ").trim();
    return text ? text.slice(0, maximum) : undefined;
  };
  const numberValue = (value: unknown): number | undefined => {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const post = async (fields: Record<string, string>): Promise<unknown> => {
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
      body: new URLSearchParams(fields).toString(),
    });
    if (response.status === 401 || response.status === 403) throw new Error("LOGIN_REQUIRED: Schedule Builder sign-in is required");
    if (response.status === 429) {
      const seconds = Number(response.headers.get("Retry-After"));
      throw new Error(`RATE_LIMITED:${Number.isFinite(seconds) ? Math.max(1000, seconds * 1000) : 5000}`);
    }
    if (!response.ok) throw new Error(`Schedule Builder read failed with HTTP ${response.status}`);
    const body = await response.text();
    if (/<!doctype\s+html|<html[\s>]/i.test(body)) throw new Error("LOGIN_REQUIRED: Schedule Builder session expired");
    try { return JSON.parse(body); } catch {
      const prefixCodes = Array.from(body.slice(0, 12)).map((character) => character.charCodeAt(0)).join(",");
      const contentType = response.headers.get("Content-Type")?.split(";")[0] ?? "missing";
      throw new Error(`SITE_VERSION_UNSUPPORTED: Schedule Builder returned non-JSON data (content-type=${contentType}; length=${body.length}; prefix-codes=${prefixCodes || "empty"})`);
    }
  };
  const firstText = (record: Record<string, unknown>, keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = cleanText(record[key]);
      if (value) return value;
    }
    return undefined;
  };
  const instructors = (value: unknown): string[] => Array.isArray(value) ? value.flatMap((item) => {
    if (typeof item === "string") return cleanText(item, 200) ?? [];
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const direct = firstText(record, ["displayName", "instructorName", "name", "fullName"]);
    const combined = [firstText(record, ["firstName", "first"]), firstText(record, ["lastName", "last"])].filter(Boolean).join(" ");
    const name = direct ?? combined;
    return name ? [name] : [];
  }) : [];
  const noteStrings = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (typeof item === "string") return cleanText(item) ?? [];
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const note = firstText(record, ["note", "description", "text", "message", "NOTE", "DESCRIPTION"]);
      return note ? [note] : [];
    });
  };
  const findPidm = (): string | undefined => {
    const input = document.querySelector<HTMLInputElement>('input[name*="pidm" i], input[id*="pidm" i]')?.value;
    if (/^\d{4,12}$/.test(input ?? "")) return input;
    for (const key of ["pidm", "studentPidm", "studentPIDM"]) {
      const value = (window as unknown as Record<string, unknown>)[key];
      if (typeof value === "string" && /^\d{4,12}$/.test(value)) return value;
      if (typeof value === "number" && Number.isInteger(value)) return String(value);
    }
    for (const key of Object.getOwnPropertyNames(window).slice(0, 2000)) {
      const descriptor = Object.getOwnPropertyDescriptor(window, key);
      const container = descriptor && "value" in descriptor ? descriptor.value : undefined;
      if (!container || typeof container !== "object") continue;
      try {
        const nestedKey = Object.keys(container).find((candidate) => /^pidm$/i.test(candidate));
        if (!nestedKey) continue;
        const value = (container as Record<string, unknown>)[nestedKey];
        if (typeof value === "string" && /^\d{4,12}$/.test(value)) return value;
        if (typeof value === "number" && Number.isInteger(value)) return String(value);
      } catch { /* ignore inaccessible page-owned objects */ }
    }
    for (const script of document.scripts) {
      const match = script.textContent?.match(/["']?(?:ZFBPRPT_)?PIDM["']?\s*[:=]\s*["']?(\d{4,12})/i);
      if (match?.[1]) return match[1];
    }
    return undefined;
  };

  const pidm = findPidm();
  const pidmInputKeys = Array.from(document.querySelectorAll<HTMLElement>('[name*="pidm" i], [id*="pidm" i]')).slice(0, 20).map((element) => {
    const id = element.getAttribute("id");
    const name = element.getAttribute("name");
    return [element.tagName.toLowerCase(), id ? `id:${id}` : "", name ? `name:${name}` : ""].filter(Boolean).join("/");
  });
  const pidmWindowPaths: string[] = [];
  for (const key of Object.getOwnPropertyNames(window).slice(0, 2000)) {
    if (/pidm/i.test(key)) pidmWindowPaths.push(key);
    const descriptor = Object.getOwnPropertyDescriptor(window, key);
    const value = descriptor && "value" in descriptor ? descriptor.value : undefined;
    if (!value || typeof value !== "object") continue;
    try {
      for (const nested of Object.keys(value).filter((candidate) => /pidm/i.test(candidate)).slice(0, 5)) pidmWindowPaths.push(`${key}.${nested}`);
    } catch { /* schema-only diagnostic; ignore inaccessible objects */ }
    if (pidmWindowPaths.length >= 30) break;
  }
  const raw = await post({
    method: "search",
    termCode: term,
    filters: JSON.stringify({ searchTerm: course.trim().toUpperCase(), addFilters: "" }),
    ...(pidm ? { pidm } : {}),
  });
  if (!Array.isArray(raw)) throw new Error("SITE_VERSION_UNSUPPORTED: search response is not an array");
  const schemaDiagnostics: NonNullable<AuditedSearchResult["schemaDiagnostics"]> = {
    itemKeys: [], courseKeys: [], crnCandidateTypes: {}, pidmInputKeys, pidmWindowPaths,
  };
  const firstRow = raw.find((item) => item && typeof item === "object") as Record<string, unknown> | undefined;
  const serverError = firstRow && Object.keys(firstRow).length === 1 && Object.hasOwn(firstRow, "error")
    ? cleanText(firstRow.error, 300)
    : undefined;
  if (firstRow) {
    schemaDiagnostics.itemKeys = Object.keys(firstRow).slice(0, 40);
    schemaDiagnostics.courseContainerKey = Object.keys(firstRow).find((key) => key.toLowerCase() === "course");
    const candidate = schemaDiagnostics.courseContainerKey ? firstRow[schemaDiagnostics.courseContainerKey] : undefined;
    if (candidate && typeof candidate === "object") {
      const candidateRecord = candidate as Record<string, unknown>;
      schemaDiagnostics.courseKeys = Object.keys(candidateRecord).slice(0, 80);
      for (const key of Object.keys(candidateRecord).filter((key) => /crn/i.test(key)).slice(0, 10)) {
        const value = candidateRecord[key];
        schemaDiagnostics.crnCandidateTypes[key] = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
      }
    }
  }
  const sections: AuditedSection[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index];
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const courseRecord = record.course && typeof record.course === "object" ? record.course as Record<string, unknown> : {};
    const crn = firstText(courseRecord, ["crn", "hidCRN", "printCRN"]);
    if (!crn) continue;
    let seats: AuditedSection["seats"];
    try {
      const seatRaw = await post({ method: "getSeatAvailability", termCode: term, crn, ...(pidm ? { pidm } : {}) });
      if (seatRaw && typeof seatRaw === "object") {
        const seatRecord = seatRaw as Record<string, unknown>;
        seats = { seatsAvail: numberValue(seatRecord.seatsAvail), waitCount: numberValue(seatRecord.waitCount) };
      }
    } catch (error) {
      if (error instanceof Error && /^(?:LOGIN_REQUIRED|RATE_LIMITED)/.test(error.message)) throw error;
    }

    const icms = record.icmsData && typeof record.icmsData === "object" ? record.icmsData as Record<string, unknown> : {};
    const finalExam = record.finalExam && typeof record.finalExam === "object" ? record.finalExam as Record<string, unknown> : {};
    const meetingValues = Array.isArray(record.meeting) ? record.meeting : [];
    sections.push({
      course: {
        termCode: firstText(courseRecord, ["termCode"]), shortDesc: firstText(courseRecord, ["shortDesc"]),
        seqNum: firstText(courseRecord, ["seqNum"]), crn, title: firstText(courseRecord, ["title"]),
        unitsLow: numberValue(courseRecord.unitsLow) ?? cleanText(courseRecord.unitsLow),
        unitsHigh: numberValue(courseRecord.unitsHigh) ?? cleanText(courseRecord.unitsHigh),
        dropDesc: firstText(courseRecord, ["dropDesc"]), dropDate: firstText(courseRecord, ["dropDate"]),
      },
      meetings: meetingValues.flatMap((meeting) => {
        if (!meeting || typeof meeting !== "object") return [];
        const value = meeting as Record<string, unknown>;
        return [{ daysString: firstText(value, ["daysString"]), startTime: firstText(value, ["startTime"]), endTime: firstText(value, ["endTime"]), building: firstText(value, ["building"]), room: firstText(value, ["room"]), description: firstText(value, ["description"]), type: firstText(value, ["type"]) }];
      }),
      instructors: instructors(record.instructor),
      prerequisite: firstText(icms, ["prereq"]), generalEducation: firstText(icms, ["ge3"]),
      finalExamDate: firstText(finalExam, ["examDate"]), seats,
      notes: [...noteStrings(record.courseDepartmentNotes), ...noteStrings(record.courseSubjectNotes), ...noteStrings(record.crnNotes), ...noteStrings(record.importantNotes)],
    });
    if (index < raw.length - 1) await new Promise((resolve) => setTimeout(resolve, 250 + Math.floor(Math.random() * 501)));
  }
  return { fetchedAt: new Date().toISOString(), rawSectionCount: raw.length, serverError, schemaDiagnostics, sections };
  } catch (error) {
    return {
      fetchedAt: new Date().toISOString(),
      rawSectionCount: 0,
      sections: [],
      executionError: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}
