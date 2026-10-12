import type { Todo } from "./tools";
import type { ConsultationSnapshot } from "./todoSnapshot";

export interface TodoPanelScopeInput {
  activeTabId?: string | null;
  activeTab?: {
    id?: string | null;
    scope?: string | null;
    workspaceRoot?: string | null;
    topicId?: string | null;
    sessionPath?: string | null;
  } | null;
  eventChannel?: string | null;
}

export function todoDismissalKey(todos: Todo[]): string {
  const normalized = normalizedTodos(todos);
  return normalized.length === 0 ? "" : JSON.stringify(normalized);
}

export function consultationDismissalKey(snapshot: ConsultationSnapshot): string {
  const todos = Array.isArray(snapshot?.todos) ? snapshot.todos : [];
  const known = normalizedStrings(snapshot?.known);
  const unknown = normalizedStrings(snapshot?.unknown);
  if (todos.length === 0 && known.length === 0 && unknown.length === 0) return "";
  return JSON.stringify({ todos: normalizedTodos(todos), known, unknown });
}

function normalizedTodos(todos: unknown): Array<{ content: string; status: string; activeForm: string; level: number }> {
  if (!Array.isArray(todos)) return [];
  return todos.map((todo) => {
    const value = todoRecord(todo);
    return {
      content: String(value.content ?? ""),
      status: todoStatus(value.status),
      activeForm: String(value.activeForm ?? ""),
      level: typeof value.level === "number" && Number.isFinite(value.level) ? value.level : 0,
    };
  });
}

function todoRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizedStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function todoPanelScope({ activeTab, activeTabId, eventChannel }: TodoPanelScopeInput): string {
  const tabId = String(activeTabId ?? "").trim();
  const tab = !tabId || activeTab?.id === tabId ? activeTab : null;
  const sessionPath = tab?.sessionPath?.trim();
  if (sessionPath) return `session:${sessionPath}`;
  if (tabId) return `tab:${tabId}`;
  const topicId = tab?.topicId?.trim();
  if (tab && topicId) return `topic:${tab.scope ?? ""}:${tab.workspaceRoot ?? ""}:${topicId}`;
  const channel = String(eventChannel ?? "").trim();
  return channel ? `event:${channel}` : "";
}

export function scopedTodoDismissalKey(scope: string | null | undefined, todoKey: string | null | undefined): string {
  const key = String(todoKey ?? "").trim();
  if (!key) return "";
  const prefix = String(scope ?? "").trim();
  return prefix ? `${prefix}\0${key}` : key;
}

export function dismissedTodoKeyForScope(
  scope: string | null | undefined,
  dismissedKeys: ReadonlySet<string> | null | undefined,
  todoKey: string | null | undefined,
): string | null {
  const scopedKey = scopedTodoDismissalKey(scope, todoKey);
  if (!scopedKey || !dismissedKeys?.has(scopedKey)) return null;
  return todoKey ?? null;
}

export function todoBatchKey(todos: Todo[]): string {
  if (!Array.isArray(todos) || todos.length === 0) return "";
  return JSON.stringify(todos.map((todo) => {
    const value = todoRecord(todo);
    return {
      content: String(value.content ?? ""),
      level: typeof value.level === "number" && Number.isFinite(value.level) ? value.level : 0,
    };
  }));
}

export function scopedTodoBatchKey(scope: string | null | undefined, batchKey: string | null | undefined): string {
  const key = String(batchKey ?? "").trim();
  if (!key) return "";
  const prefix = String(scope ?? "").trim();
  return prefix ? `${prefix}\0${key}` : key;
}

export function shouldShowTodoPanel(
  todoKey: string | null | undefined,
  dismissedTodoKey: string | null,
  todos: Todo[],
): boolean {
  if (!todoKey || todos.length === 0) return false;
  if (hasIncompleteTodos(todos)) return true;
  return todoKey !== dismissedTodoKey;
}

export function shouldOpenTodoPanelByDefault(todos: Todo[]): boolean {
  return hasIncompleteTodos(todos);
}

function todoStatus(status: unknown): string {
  const normalized = String(status ?? "").trim();
  return normalized || "pending";
}

function hasIncompleteTodos(todos: Todo[]): boolean {
  return todos.some((todo) => todoStatus(todo.status) !== "completed");
}
