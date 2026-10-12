export interface SanitizedEndpointContract {
  host: string;
  path: string;
  method: "GET" | "POST";
  statusClass: string;
  requestFields: string[];
  responseShape: unknown;
  paginationFields: string[];
}

export interface SanitizedHARContract {
  schemaVersion: 1;
  generatedFrom: "sanitized-har-contract";
  endpoints: SanitizedEndpointContract[];
}

export function sanitizeHAR(input: unknown): SanitizedHARContract;
