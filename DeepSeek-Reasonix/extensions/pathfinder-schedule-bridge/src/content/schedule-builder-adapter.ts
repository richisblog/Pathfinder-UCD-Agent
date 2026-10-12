export type ReadOperation =
  | { kind: "terms" }
  | { kind: "courseSearch"; term: string; course: string; page?: number }
  | { kind: "personalSchedule"; term: string }
  | { kind: "passTimes"; term: string }
  | { kind: "holds" }
  | { kind: "personalWaitlist"; term: string };

export interface PageExecutor {
  execute(operation: ReadOperation): Promise<unknown>;
}

const WRITE_OPERATIONS = new Set([
  "register",
  "drop",
  "swap",
  "saveSchedule",
  "updatePreferences",
]);

const FIELDS_BY_KIND: Record<ReadOperation["kind"], ReadonlySet<string>> = {
  terms: new Set(["kind"]),
  courseSearch: new Set(["kind", "term", "course", "page"]),
  personalSchedule: new Set(["kind", "term"]),
  passTimes: new Set(["kind", "term"]),
  holds: new Set(["kind"]),
  personalWaitlist: new Set(["kind", "term"]),
};

export class ReadOnlyRouter {
  async execute(value: unknown, page: PageExecutor): Promise<unknown> {
    const operation = this.validate(value);
    return page.execute(operation);
  }

  private validate(value: unknown): ReadOperation {
    if (!isRecord(value) || typeof value.kind !== "string") {
      throw new Error("Invalid read-only operation");
    }
    if (WRITE_OPERATIONS.has(value.kind)) {
      throw new Error(`Operation ${value.kind} is denied by the read-only policy`);
    }

    if (!(value.kind in FIELDS_BY_KIND)) {
      throw new Error(`Operation ${value.kind} is not in the read-only allowlist`);
    }
    const kind = value.kind as ReadOperation["kind"];
    const allowedFields = FIELDS_BY_KIND[kind];
    const unknownField = Object.keys(value).find((field) => !allowedFields.has(field));
    if (unknownField) throw new Error(`Unknown field ${unknownField} in read-only operation`);

    switch (kind) {
      case "terms":
      case "holds":
        return { kind };
      case "courseSearch":
        const term = readString(value, "term");
        const course = readString(value, "course");
        const page = value.page;
        if (page !== undefined && (!Number.isInteger(page) || (page as number) < 1)) {
          throw new Error("Course search page must be a positive integer");
        }
        return { kind, term, course, ...(page === undefined ? {} : { page: page as number }) };
      case "personalSchedule":
      case "passTimes":
      case "personalWaitlist":
        return { kind, term: readString(value, "term") };
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: Record<string, unknown>, field: string): string {
  if (typeof value[field] !== "string" || value[field].trim() === "") {
    throw new Error(`Field ${field} must be a non-empty string`);
  }
  return value[field];
}
