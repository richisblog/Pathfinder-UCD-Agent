export const PROTOCOL_VERSION = 1 as const;

export type BridgeMethod =
  | "bridge.status"
  | "schedule.terms"
  | "schedule.search"
  | "schedule.personal"
  | "request.cancel";

export type BridgeStatus =
  | "OK"
  | "PARTIAL"
  | "BROWSER_REQUIRED"
  | "EXTENSION_REQUIRED"
  | "PAIRING_REQUIRED"
  | "LOGIN_REQUIRED"
  | "CONSENT_REQUIRED"
  | "RATE_LIMITED"
  | "SITE_VERSION_UNSUPPORTED"
  | "INVALID_REQUEST"
  | "CANCELLED"
  | "INTERNAL_ERROR";

export interface StatusParams {
  readonly [key: string]: never;
}

export interface TermsParams {
  readonly [key: string]: never;
}

export interface SearchParams {
  term: string;
  courses: string[];
  include_personal_context?: boolean;
}

export interface PersonalParams {
  term: string;
  categories: Array<"schedule" | "pass_times" | "holds" | "waitlist">;
}

export interface CancelParams {
  request_id: string;
}

export type BridgeParams = StatusParams | TermsParams | SearchParams | PersonalParams | CancelParams;

export interface BridgeRequest<T extends BridgeParams = BridgeParams> {
  protocol: typeof PROTOCOL_VERSION;
  id: string;
  type: "request";
  method: BridgeMethod;
  sent_at?: string;
  params: T;
}

export interface BridgeEvidence {
  source: "ucd_schedule_builder" | "ucd_class_search";
  source_url: string;
  provider_version: string;
  fetched_at: string;
  term: string;
  freshness: "live" | "stale";
  authenticated: boolean;
  courses?: unknown[];
  personal?: unknown;
}

export interface BridgeResult {
  protocol: typeof PROTOCOL_VERSION;
  id: string;
  type: "result";
  status: BridgeStatus;
  message?: string;
  retry_after_ms?: number;
  evidence?: BridgeEvidence;
}
