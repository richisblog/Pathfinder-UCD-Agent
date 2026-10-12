export type StudentMemoryFieldId =
  | "transcript"
  | "resume"
  | "timetable"
  | "courseSchedule"
  | "academicStyle"
  | "major"
  | "college"
  | "preferences";

export type StudentMemoryProfile = Record<StudentMemoryFieldId, string>;

export const STUDENT_MEMORY_FIELDS: ReadonlyArray<{ id: StudentMemoryFieldId; heading: string }> = [
  { id: "transcript", heading: "Transcript and grades" },
  { id: "resume", heading: "Résumé and experience" },
  { id: "timetable", heading: "Personal timetable" },
  { id: "courseSchedule", heading: "Course schedule" },
  { id: "academicStyle", heading: "Academic and writing style" },
  { id: "major", heading: "Major or intended major" },
  { id: "college", heading: "College or school" },
  { id: "preferences", heading: "Personal preferences and constraints" },
] as const;

export const EMPTY_STUDENT_MEMORY: StudentMemoryProfile = {
  transcript: "",
  resume: "",
  timetable: "",
  courseSchedule: "",
  academicStyle: "",
  major: "",
  college: "",
  preferences: "",
};

const BLOCK_START = "<!-- pathfinder-student-memory:start -->";
const BLOCK_END = "<!-- pathfinder-student-memory:end -->";

function fieldStart(id: StudentMemoryFieldId): string {
  return `<!-- pathfinder-field:${id}:start -->`;
}

function fieldEnd(id: StudentMemoryFieldId): string {
  return `<!-- pathfinder-field:${id}:end -->`;
}

export function parseStudentMemory(body: string): StudentMemoryProfile {
  const profile = { ...EMPTY_STUDENT_MEMORY };
  const blockStart = body.indexOf(BLOCK_START);
  if (blockStart < 0) return profile;
  const blockEnd = body.indexOf(BLOCK_END, blockStart + BLOCK_START.length);
  const block = body.slice(blockStart, blockEnd < 0 ? body.length : blockEnd);
  for (const field of STUDENT_MEMORY_FIELDS) {
    const startMarker = fieldStart(field.id);
    const endMarker = fieldEnd(field.id);
    const start = block.indexOf(startMarker);
    if (start < 0) continue;
    const valueStart = start + startMarker.length;
    const end = block.indexOf(endMarker, valueStart);
    if (end < 0) continue;
    profile[field.id] = block.slice(valueStart, end).trim();
  }
  return profile;
}

function renderStudentMemory(profile: StudentMemoryProfile): string {
  const sections = STUDENT_MEMORY_FIELDS.map((field) => [
    `### ${field.heading}`,
    fieldStart(field.id),
    profile[field.id].trim(),
    fieldEnd(field.id),
  ].join("\n"));
  return [BLOCK_START, "## Pathfinder Student Profile", "", ...sections.flatMap((section, index) => index === 0 ? [section] : ["", section]), BLOCK_END].join("\n");
}

export function writeStudentMemory(body: string, profile: StudentMemoryProfile): string {
  const rendered = renderStudentMemory(profile);
  const start = body.indexOf(BLOCK_START);
  if (start >= 0) {
    const endMarker = body.indexOf(BLOCK_END, start + BLOCK_START.length);
    const end = endMarker < 0 ? body.length : endMarker + BLOCK_END.length;
    return `${body.slice(0, start)}${rendered}${body.slice(end)}`;
  }
  const prefix = body.length === 0 ? "" : body.endsWith("\n\n") ? body : body.endsWith("\n") ? `${body}\n` : `${body}\n\n`;
  return `${prefix}${rendered}\n`;
}
