type ScheduleBridgeSessionTab = {
  sessionPath?: string;
};

// Mirrors internal/agent.BranchID so the frontend consent grant and the
// query_live_schedule tool use one authoritative conversation identity.
export function scheduleBridgeSessionIdForTab(tab: ScheduleBridgeSessionTab | undefined): string {
  const sessionPath = tab?.sessionPath?.trim() ?? "";
  if (!sessionPath) return "";
  const parts = sessionPath.split(/[\\/]/);
  const base = parts[parts.length - 1] ?? "";
  const extensionIndex = base.lastIndexOf(".");
  return extensionIndex > 0 ? base.slice(0, extensionIndex) : base;
}
