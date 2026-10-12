import { Check, ChevronLeft, ChevronRight, Circle, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useT } from "../lib/i18n";
import type { Todo } from "../lib/tools";
import type { ConsultationSnapshot } from "../lib/todoSnapshot";
import { shouldOpenTodoPanelByDefault } from "../lib/todoVisibility";

const STORAGE_KEY = "todoPanel:openStates";
const MAX_STORED_OPEN_STATES = 80;

function loadOpenStates(): Record<string, boolean> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return {};
    const parsed = JSON.parse(saved) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
  } catch {
    return {};
  }
}

function loadOpenState(stateKey: string, defaultOpen: boolean): boolean {
  const states = loadOpenStates();
  return Object.prototype.hasOwnProperty.call(states, stateKey) ? states[stateKey] : defaultOpen;
}

function saveOpenState(stateKey: string, open: boolean): void {
  try {
    const entries = Object.entries(loadOpenStates()).filter(([key]) => key !== stateKey);
    entries.push([stateKey, open]);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries.slice(-MAX_STORED_OPEN_STATES))));
  } catch {
    /* localStorage unavailable */
  }
}

function normalizedStatus(status: Todo["status"]): "pending" | "in_progress" | "completed" {
  if (status === "completed") return "completed";
  if (status === "in_progress") return "in_progress";
  return "pending";
}

export function shouldReopenTodoRail(previousAllDone: boolean, nextAllDone: boolean): boolean {
  return previousAllDone && !nextAllDone;
}

function RailSection({
  children,
  count,
  kind,
  title,
}: {
  children: React.ReactNode;
  count: number | string;
  kind: "todos" | "known" | "unknown";
  title: string;
}) {
  const className = {
    todos: "todo-rail__section todo-rail__section--todos",
    known: "todo-rail__section todo-rail__section--known",
    unknown: "todo-rail__section todo-rail__section--unknown",
  }[kind];
  return (
    <section className={className}>
      <header className="todo-rail__section-header">
        <h2>{title}</h2>
        <span className="todo-rail__count">{count}</span>
      </header>
      <div className="todo-rail__section-body">{children}</div>
    </section>
  );
}

export function TodoRail({
  stateKey,
  snapshot,
  onDismiss,
}: {
  stateKey: string;
  snapshot: ConsultationSnapshot;
  onDismiss: () => void;
}) {
  const t = useT();
  const { todos, known, unknown } = snapshot;
  const currentRef = useRef<HTMLLIElement | null>(null);
  const done = todos.filter((todo) => todo.status === "completed").length;
  const allDone = todos.length > 0 && done === todos.length;
  const [open, setOpen] = useState(() => loadOpenState(stateKey, shouldOpenTodoPanelByDefault(todos)));
  const wasAllDoneRef = useRef(allDone);

  useEffect(() => {
    if (allDone && !wasAllDoneRef.current) {
      saveOpenState(stateKey, false);
      setOpen(false);
    } else if (shouldReopenTodoRail(wasAllDoneRef.current, allDone)) {
      saveOpenState(stateKey, true);
      setOpen(true);
    }
    wasAllDoneRef.current = allDone;
  }, [allDone, stateKey]);

  useEffect(() => {
    if (open) currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [open, todos]);

  if (todos.length === 0) return null;

  const toggle = () => {
    const next = !open;
    saveOpenState(stateKey, next);
    setOpen(next);
  };

  return (
    <aside className={`todo-rail${open ? "" : " todo-rail--collapsed"}`} data-testid="todo-rail" aria-label={t("todo.title")}>
      <header className="todo-rail__header">
        <button type="button" className="todo-rail__collapse" onClick={toggle} aria-label={open ? t("common.collapse") : t("common.expand")}>
          {open ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
        {open && allDone && (
          <button type="button" className="todo-rail__dismiss" onClick={onDismiss} aria-label={t("common.close")}>
            <X size={15} />
          </button>
        )}
      </header>
      {open && (
        <div className="todo-rail__sections">
          <RailSection kind="todos" title={t("todo.title")} count={`${done}/${todos.length}`}>
            <ol className="todo-rail__list">
              {todos.map((todo, index) => {
                const status = normalizedStatus(todo.status);
                const label = status === "in_progress" && todo.activeForm ? todo.activeForm : todo.content;
                const statusLabel = status === "completed"
                  ? t("todo.completed")
                  : status === "in_progress"
                    ? t("todo.inProgress")
                    : t("todo.pending");
                return (
                  <li key={`${index}:${todo.content}`} ref={status === "in_progress" ? currentRef : undefined} className={`todo-rail__item todo-rail__item--${status}${todo.level ? " todo-rail__item--sub" : ""}`}>
                    <span className="sr-only">{statusLabel}</span>
                    <span className="todo-rail__status" aria-hidden="true">
                      {status === "completed" ? <Check size={13} /> : status === "in_progress" ? <LoaderCircle size={13} /> : <Circle size={11} />}
                    </span>
                    <span className="todo-rail__text">{label}</span>
                  </li>
                );
              })}
            </ol>
          </RailSection>
          <RailSection kind="known" title={t("todo.knownTitle")} count={known.length}>
            {known.length > 0 ? (
              <ul className="todo-rail__knowledge-list">
                {known.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}
              </ul>
            ) : <p className="todo-rail__empty">{t("todo.knownEmpty")}</p>}
          </RailSection>
          <RailSection kind="unknown" title={t("todo.unknownTitle")} count={unknown.length}>
            {unknown.length > 0 ? (
              <ul className="todo-rail__knowledge-list todo-rail__knowledge-list--unknown">
                {unknown.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}
              </ul>
            ) : <p className="todo-rail__empty">{t("todo.unknownEmpty")}</p>}
          </RailSection>
        </div>
      )}
    </aside>
  );
}
