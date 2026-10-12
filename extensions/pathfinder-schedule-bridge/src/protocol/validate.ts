import {
  PROTOCOL_VERSION,
  type BridgeMethod,
  type BridgeParams,
  type BridgeRequest,
  type CancelParams,
  type PersonalParams,
  type SearchParams,
} from "./messages";

const METHODS = new Set<BridgeMethod>([
  "bridge.status",
  "schedule.terms",
  "schedule.search",
  "schedule.personal",
  "request.cancel",
]);
const REQUEST_FIELDS = new Set(["protocol", "id", "type", "method", "sent_at", "params"]);
const ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const TERM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$/;
const PERSONAL_CATEGORIES = new Set(["schedule", "pass_times", "holds", "waitlist"]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`unknown field ${label}.${unknown}`);
}

function requiredString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value;
}

function emptyParams(value: unknown, method: BridgeMethod): Record<string, never> {
  const params = record(value, `${method} params`);
  rejectUnknownFields(params, new Set(), `${method} params`);
  return {};
}

function searchParams(value: unknown): SearchParams {
  const params = record(value, "schedule.search params");
  rejectUnknownFields(params, new Set(["term", "courses", "include_personal_context"]), "schedule.search params");
  const term = requiredString(params.term, "term", 32);
  if (!TERM_PATTERN.test(term)) throw new Error("term contains unsupported characters");
  if (!Array.isArray(params.courses) || params.courses.length === 0 || params.courses.length > 100) {
    throw new Error("courses must contain between 1 and 100 entries");
  }
  const courses = params.courses.map((course, index) => requiredString(course, `course ${index + 1}`, 32));
  if (params.include_personal_context !== undefined && typeof params.include_personal_context !== "boolean") {
    throw new Error("include_personal_context must be boolean");
  }
  return {
    term,
    courses,
    ...(params.include_personal_context === undefined
      ? {}
      : { include_personal_context: params.include_personal_context }),
  };
}

function personalParams(value: unknown): PersonalParams {
  const params = record(value, "schedule.personal params");
  rejectUnknownFields(params, new Set(["term", "categories"]), "schedule.personal params");
  const term = requiredString(params.term, "term", 32);
  if (!TERM_PATTERN.test(term)) throw new Error("term contains unsupported characters");
  if (!Array.isArray(params.categories) || params.categories.length === 0) {
    throw new Error("categories must not be empty");
  }
  const categories = params.categories.map((category) => {
    if (typeof category !== "string" || !PERSONAL_CATEGORIES.has(category)) {
      throw new Error(`unknown personal category ${String(category)}`);
    }
    return category as PersonalParams["categories"][number];
  });
  return { term, categories };
}

function cancelParams(value: unknown): CancelParams {
  const params = record(value, "request.cancel params");
  rejectUnknownFields(params, new Set(["request_id"]), "request.cancel params");
  const requestID = requiredString(params.request_id, "request_id", 80);
  if (!ID_PATTERN.test(requestID)) throw new Error("request_id has invalid format");
  return { request_id: requestID };
}

function validateParams(method: BridgeMethod, value: unknown): BridgeParams {
  switch (method) {
    case "bridge.status":
    case "schedule.terms":
      return emptyParams(value, method);
    case "schedule.search":
      return searchParams(value);
    case "schedule.personal":
      return personalParams(value);
    case "request.cancel":
      return cancelParams(value);
  }
}

export function validateIncomingRequest(value: unknown): BridgeRequest {
  const request = record(value, "request");
  rejectUnknownFields(request, REQUEST_FIELDS, "request");
  if (request.protocol !== PROTOCOL_VERSION) throw new Error("unsupported protocol version");
  const id = requiredString(request.id, "request id", 80);
  if (!ID_PATTERN.test(id)) throw new Error("request id has invalid format");
  if (request.type !== "request") throw new Error("message type must be request");
  if (typeof request.method !== "string" || !METHODS.has(request.method as BridgeMethod)) {
    throw new Error(`unknown method ${String(request.method)}`);
  }
  if (request.sent_at !== undefined && typeof request.sent_at !== "string") {
    throw new Error("sent_at must be a string");
  }
  const method = request.method as BridgeMethod;
  return {
    protocol: PROTOCOL_VERSION,
    id,
    type: "request",
    method,
    ...(request.sent_at === undefined ? {} : { sent_at: request.sent_at }),
    params: validateParams(method, request.params),
  };
}
