import { parseConsultationSnapshot, type ConsultationSnapshot } from "./tools";
import type { Item } from "./useController";

export { parseConsultationSnapshot, type ConsultationSnapshot } from "./tools";

const emptySnapshot = (): ConsultationSnapshot => ({ todos: [], known: [], unknown: [] });
const todoStatuses = new Set(["pending", "in_progress", "completed"]);
const maxKnowledgeItems = 10;

export function latestTodoSnapshot(items: Item[]): ConsultationSnapshot {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind !== "tool" || item.name !== "todo_write" || item.parentId) continue;
    if (item.error || (item.status !== "running" && item.status !== "done")) continue;
    if (!hasValidTodoList(item.args)) continue;
    return parseConsultationSnapshot(item.args);
  }
  return emptySnapshot();
}

function hasValidTodoList(args: string): boolean {
  try {
    const value = JSON.parse(args) as Record<string, unknown> | null;
    return Boolean(
      value
      && typeof value === "object"
      && !Array.isArray(value)
      && Array.isArray(value.todos)
      && value.todos.every(isValidTodo)
      && isValidOptionalKnowledge(value.known)
      && isValidOptionalKnowledge(value.unknown)
    );
  } catch {
    return false;
  }
}

function isValidOptionalKnowledge(value: unknown): boolean {
  return value === undefined || (
    Array.isArray(value)
    && value.length <= maxKnowledgeItems
    && value.every((entry) => typeof entry === "string" && entry.trim() !== "")
  );
}

function isValidTodo(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const todo = value as Record<string, unknown>;
  if (typeof todo.content !== "string" || todo.content.trim() === "") return false;
  if (typeof todo.status !== "string" || !todoStatuses.has(todo.status)) return false;
  if (todo.activeForm !== undefined && typeof todo.activeForm !== "string") return false;
  return todo.level === undefined || (typeof todo.level === "number" && Number.isFinite(todo.level));
}
