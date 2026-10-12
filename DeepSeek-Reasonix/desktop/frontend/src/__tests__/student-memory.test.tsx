import assert from "node:assert/strict";
import fs from "node:fs";

import { EMPTY_STUDENT_MEMORY, STUDENT_MEMORY_FIELDS, parseStudentMemory, writeStudentMemory } from "../lib/studentMemory";

assert.deepEqual(parseStudentMemory("# Existing memory\n"), EMPTY_STUDENT_MEMORY);

const profile = {
  transcript: "GPA 3.86; MAT 21A: A",
  resume: "Research assistant in the learning lab",
  timetable: "Prefers mornings; unavailable Friday afternoon",
  courseSchedule: "Fall: ECS 150, ECS 154A",
  academicStyle: "Concise analytical writing with citations",
  major: "Computer Science",
  college: "College of Letters and Science",
  preferences: "Avoid back-to-back finals; prefers small seminars",
};

const original = "# Durable user memory\n\nKeep this unrelated note.\n";
const written = writeStudentMemory(original, profile);
assert.match(written, /<!-- pathfinder-student-memory:start -->/);
assert.match(written, /<!-- pathfinder-student-memory:end -->/);
assert.match(written, /Keep this unrelated note\./);
assert.deepEqual(parseStudentMemory(written), profile);

const replaced = writeStudentMemory(written, { ...profile, major: "Data Science", transcript: "" });
assert.equal(replaced.match(/pathfinder-student-memory:start/g)?.length, 1);
assert.equal(parseStudentMemory(replaced).major, "Data Science");
assert.equal(parseStudentMemory(replaced).transcript, "");
assert.equal(STUDENT_MEMORY_FIELDS.length, 8);

const panel = fs.readFileSync(new URL("../components/StudentMemoryPanel.tsx", import.meta.url), "utf8");
for (const field of STUDENT_MEMORY_FIELDS) assert.match(panel, new RegExp(`studentMemory\\.${field.id}`));
assert.match(panel, /onSaveDoc/);

console.log("student memory contract passed");
