import { BridgeClient, BrowserSocketFactory, ChromeCredentialStore } from "./bridge-client";
import type { BridgeStatus } from "../protocol/messages";
import { ChromeScheduleTabLocator, createRequestHandler } from "./request-handler";
import { createChromeScheduleProvider } from "../content/ucd-schedule-builder-provider";

const client = new BridgeClient({
  extensionId: chrome.runtime.id,
  ports: [38673, 38674, 38675],
  sockets: new BrowserSocketFactory(),
  store: new ChromeCredentialStore(),
  handleRequest: createRequestHandler(new ChromeScheduleTabLocator(), {
    providerForTab: async (tab) => createChromeScheduleProvider(tab),
  }),
});

let status: BridgeStatus = "EXTENSION_REQUIRED";
let connecting: Promise<BridgeStatus> | undefined;

async function connect(): Promise<BridgeStatus> {
  if (connecting) return connecting;
  connecting = client.connect().then((next) => {
    status = next;
    return next;
  }).finally(() => {
    connecting = undefined;
  });
  return connecting;
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (typeof message !== "object" || message === null) return false;
  const request = message as { type?: unknown; code?: unknown };
  if (request.type === "bridge.status") {
    void connect().then((next) => sendResponse({ status: next })).catch((error: unknown) => {
      sendResponse({ status: "INTERNAL_ERROR", message: String(error) });
    });
    return true;
  }
  if (request.type === "bridge.pair") {
    if (typeof request.code !== "string") {
      sendResponse({ status: "INVALID_REQUEST", message: "Pairing code is required." });
      return false;
    }
    void client.pair(request.code)
      .then(() => connect())
      .then((next) => sendResponse({ status: next }))
      .catch((error: unknown) => sendResponse({ status: "PAIRING_REQUIRED", message: String(error) }));
    return true;
  }
  if (request.type === "bridge.reconnect") {
    void connect().then((next) => sendResponse({ status: next }));
    return true;
  }
  return false;
});

chrome.runtime.onInstalled.addListener(() => void connect());
chrome.runtime.onStartup.addListener(() => void connect());
void connect();

export { connect, status };
