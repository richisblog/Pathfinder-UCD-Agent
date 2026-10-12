import type { ScheduleBridgeStatusView } from "./bridge";

export type ScheduleBridgeBannerMode =
  | "starting"
  | "extension"
  | "connected-private"
  | "connected-consented";

export function scheduleBridgeBannerMode(
  status: ScheduleBridgeStatusView | null,
  consent: boolean,
): ScheduleBridgeBannerMode {
  if (!status?.running) return "starting";
  if (!status.connected) return "extension";
  return consent ? "connected-consented" : "connected-private";
}
