#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const ALLOWED_HOSTS = new Set(["my.ucdavis.edu", "registrar-apps.ucdavis.edu"]);
const SENSITIVE_KEY_RULES = [
  ["cookie", /(?:^|[_-])cookies?(?:$|[_-])/i],
  ["authorization", /authorization|bearer|api[_-]?key/i],
  ["csrf", /csrf|xsrf|requestverificationtoken/i],
  ["student_id", /student[_-]?(?:id|number)|sid/i],
  ["login_id", /login[_-]?id|kerberos|username|user[_-]?id/i],
  ["email", /e[_-]?mail|email/i],
  ["passphrase", /pass(?:word|phrase|code)|secret/i],
];

export function sanitizeHAR(input) {
  const findings = new Set();
  scanSensitive(input, findings);
  if (findings.size > 0) {
    throw new Error(`HAR contains sensitive categories: ${[...findings].sort().join(", ")}`);
  }

  const entries = input?.log?.entries;
  if (!Array.isArray(entries)) throw new Error("HAR log.entries must be an array");
  const endpoints = entries.map((entry, index) => sanitizeEntry(entry, index));
  return {
    schemaVersion: 1,
    generatedFrom: "sanitized-har-contract",
    endpoints: deduplicate(endpoints),
  };
}

function sanitizeEntry(entry, index) {
  if (!entry || typeof entry !== "object" || !entry.request || !entry.response) {
    throw new Error(`HAR entry ${index + 1} is incomplete`);
  }
  let url;
  try {
    url = new URL(entry.request.url);
  } catch {
    throw new Error(`HAR entry ${index + 1} has an invalid URL`);
  }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`HAR entry ${index + 1} uses unsupported host ${url.hostname}`);
  }
  const method = String(entry.request.method ?? "").toUpperCase();
  if (!/^(GET|POST)$/.test(method)) {
    throw new Error(`HAR entry ${index + 1} uses unsupported method ${method}`);
  }

  const requestFields = new Set();
  for (const item of entry.request.queryString ?? []) {
    if (typeof item?.name === "string") requestFields.add(item.name);
  }
  const requestBody = parseJSONContent(entry.request.postData?.text, entry.request.postData?.mimeType);
  collectFieldNames(requestBody, requestFields);

  const responseBody = parseJSONContent(entry.response.content?.text, entry.response.content?.mimeType);
  const paginationFields = [];
  collectPaginationFields(responseBody, "", paginationFields);
  return {
    host: url.hostname,
    path: pathTemplate(url.pathname),
    method,
    statusClass: `${Math.floor(Number(entry.response.status) / 100) || 0}xx`,
    requestFields: [...requestFields].sort(),
    responseShape: shapeOf(responseBody),
    paginationFields: [...new Set(paginationFields)].sort(),
  };
}

function parseJSONContent(text, mimeType = "") {
  if (typeof text !== "string" || text.trim() === "") return null;
  if (!String(mimeType).toLowerCase().includes("json") && !/^[\[{]/.test(text.trim())) return "non-json";
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("HAR contains malformed JSON content");
  }
}

function shapeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length === 0 ? [] : [shapeOf(value[0])];
  if (typeof value !== "object") return typeof value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shapeOf(value[key])]));
}

function collectFieldNames(value, output) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of Object.keys(value)) output.add(key);
}

function collectPaginationFields(value, prefix, output) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    if (value[0] !== undefined) collectPaginationFields(value[0], `${prefix}[]`, output);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (/page|offset|limit|cursor|next|previous|total/i.test(key)) output.push(path);
    collectPaginationFields(child, path, output);
  }
}

function pathTemplate(path) {
  return path
    .split("/")
    .map((segment) => (/^\d{3,}$/.test(segment) || /^[0-9a-f]{16,}$/i.test(segment) ? ":id" : segment))
    .join("/");
}

function deduplicate(endpoints) {
  const seen = new Set();
  return endpoints.filter((endpoint) => {
    const key = JSON.stringify(endpoint);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scanSensitive(value, findings, key = "") {
  for (const [category, pattern] of SENSITIVE_KEY_RULES) {
    if (pattern.test(key) && !isEmpty(value)) findings.add(category);
  }
  if (typeof value === "string") {
    if (/\b[A-Z0-9._%+-]+@(?:ucdavis\.edu|gmail\.com|outlook\.com)\b/i.test(value)) findings.add("email");
    if (/\bBearer\s+[A-Za-z0-9._~-]+/i.test(value)) findings.add("authorization");
    if (/(?:^|;\s*)[A-Za-z0-9_-]+=[^;]{8,}(?:;|$)/.test(value) && /cookie/i.test(key)) findings.add("cookie");
    const trimmed = value.trim();
    if (/^[\[{]/.test(trimmed)) {
      try {
        scanSensitive(JSON.parse(trimmed), findings, key);
      } catch {
        // Non-JSON response text is never emitted; malformed JSON is handled by
        // the contract parser when the MIME type declares JSON.
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) scanSensitive(item, findings, key);
    return;
  }
  if (value && typeof value === "object") {
    if (typeof value.name === "string") {
      for (const [category, pattern] of SENSITIVE_KEY_RULES) {
        if (pattern.test(value.name) && !isEmpty(value.value)) findings.add(category);
      }
    }
    for (const [childKey, child] of Object.entries(value)) scanSensitive(child, findings, childKey);
  }
}

function isEmpty(value) {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

async function main(argv) {
  const inputPath = option(argv, "--input");
  const outputPath = option(argv, "--output");
  if (!inputPath || !outputPath) throw new Error("usage: sanitize-har.mjs --input <file.har> --output <contract.json>");
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  const sanitized = sanitizeHAR(input);
  await writeFile(outputPath, `${JSON.stringify(sanitized, null, 2)}\n`, { mode: 0o600 });
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
