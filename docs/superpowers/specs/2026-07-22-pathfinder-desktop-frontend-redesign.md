# Pathfinder Desktop Frontend Redesign

**Date:** 2026-07-22

**Product:** Existing DeepSeek-Reasonix Wails desktop client

**Frontend:** `desktop/frontend/src` (React + TypeScript)

## Purpose

Turn the existing DeepSeek-Reasonix desktop frontend into a focused Pathfinder
academic-assistant experience. This work modifies the current Wails/React
desktop client in place. It does not create a website or replace the desktop
runtime with a separate application.

## Product principles

1. Pathfinder is a student-facing academic assistant, not an AI coding tool.
2. The primary surface is a calm, ChatGPT-like conversation layout.
3. Academic context is visible and editable by the student.
4. Technical settings stay hidden unless required for compatibility.
5. Live UC Davis access and messaging connections remain available without
   occupying the transcript.
6. Existing backend/session contracts remain compatible while the desktop
   information architecture is simplified.

## Desktop shell

The expanded layout has three columns:

- **Left sidebar:** Pathfinder branding, new conversation, search, recent
  conversations, connection status, and settings.
- **Conversation:** topic header, transcript, and composer. This remains the
  largest flexible column.
- **Right task rail:** the current consultation todo list, independently
  collapsible and hidden when no useful task state exists.

At narrow widths, the task rail becomes an overlay drawer. The left sidebar can
collapse to an icon rail. Neither secondary surface may force the conversation
below its usable minimum width.

## Branding

Replace visible Reasonix branding in the desktop shell with Pathfinder. The
primary mark is a transparent-background, vector-friendly capital `P` whose
negative space or upper bowl incorporates a graduation cap. The mark must remain
legible at 20–32 px and pair with a simple `Pathfinder` wordmark.

The generated raster exploration is used to select the shape. The shipped
desktop asset is an optimized transparent PNG and, where practical, a manually
cleaned SVG derivative for crisp scaling. Existing application icon packaging
is updated only when the same mark can be applied without breaking platform
asset generation.

## Left sidebar behavior

The sidebar follows familiar ChatGPT desktop behavior:

- A prominent **New chat** action sits below the brand.
- Search filters conversations without replacing the main conversation.
- Conversations are grouped by recency.
- A normal click opens a conversation.
- Double-click or the context-menu **Rename** action starts inline rename.
- Right-click opens a compact menu with **Rename**, **Archive**, and **Delete**.
- Delete requires confirmation and uses the existing trash/recovery path rather
  than permanent deletion where supported.
- The active conversation has a clear selection state; hover reveals the
  overflow-menu button.
- Keyboard navigation and accessible menu semantics are retained.

The bottom utility area contains, in order:

1. UC Davis live-course connection status and entry point.
2. OpenClaw/message-channel status for supported services such as Telegram,
   WeChat, QQ, Feishu, or future configured connectors.
3. Settings.

The live-course entry displays only a compact status row. Pairing and login
details open in a popover or dialog.

## UC Davis live-course prompts

The persistent “连接 Chrome，启用 UC Davis 实时课程” banner is removed from the
normal transcript/composer layout.

- Setup and status live above Settings in the lower-left sidebar.
- Pairing opens a focused dialog with **Pair extension**.
- **Open Schedule Builder** appears only when the current bridge status requires
  a browser tab or login.
- During a query, recoverable consent/login/browser requirements may appear as a
  contextual transcript card associated with that request.
- The component continues to use the existing Wails bridge methods and status
  events; only placement and presentation change.

## Right task rail

The existing canonical todo state remains the source of truth. Presentation
moves out of the transcript column into the right rail.

- The rail title is **Current plan** / **当前计划**.
- Items display pending, active, and completed states.
- The active item is visually prominent without animation that distracts from
  reading.
- The rail can be collapsed manually and remembers that preference.
- A small header button reopens it when todo state exists.
- Dismissal remains scoped to the existing todo batch/session rules.

## Settings information architecture

The settings sidebar contains only:

1. **General** — language, startup behavior, and essential conversation options.
2. **Connections** — OpenClaw/message channels and UC Davis Schedule Bridge.
3. **Student memory** — structured academic profile and prior memory management.
4. **Shortcuts** — student-relevant desktop shortcuts.
5. **Appearance** — theme, text size, and fonts.

Provider/model, MCP, skills, hooks, permissions, sandbox, token economy,
developer network diagnostics, and coding-agent update controls are removed from
normal navigation. Existing backend settings and types remain intact unless a
separate migration proves they are unused; hidden settings must not be silently
deleted from user configuration.

## Structured student memory

Student memory is presented as editable sections rather than a raw developer
memory manager:

- Transcript / grades
- Résumé and experience
- Personal timetable
- Course schedule
- Academic and writing style
- Major / intended major
- College / school
- Personal preferences and constraints
- Prior conversation memories

Each section supports empty, populated, editing, saving, and error states. The
student can see what Pathfinder knows, edit inaccuracies, and remove an entry.
Sensitive operations retain explicit confirmation.

The frontend uses a typed student-profile contract. The desktop/backend adapter
maps those fields to durable memory records with stable category identifiers.
The agent receives the stored profile through the existing memory-loading path,
so it can automatically read preferences and relevant prior memories without
the frontend injecting hidden text into each message.

## Composer simplification

The composer keeps message entry, attachments, send/cancel, and academic
conversation modes that are still meaningful. Normal students do not see model
switching, reasoning effort, token economy, YOLO/tool approval, coding skills,
or workspace/file-development controls. Compatibility props may remain during
the transition, but the visible controls and keyboard affordances are removed
or replaced with student-facing equivalents.

## Error handling and accessibility

- Connection failures are recoverable and explain the next student action.
- Memory saves show field-level errors without discarding edits.
- Menus support keyboard navigation, Escape, focus return, and screen-reader
  labels.
- Destructive conversation and memory actions require confirmation.
- Empty and loading states are explicit; the UI never fabricates connection or
  memory status.

## Verification

Automated verification covers:

- Pathfinder branding and absence of visible Reasonix desktop-shell branding.
- Sidebar selection, rename, archive, delete, context menu, and keyboard access.
- The Schedule Bridge banner no longer mounting in the conversation layout.
- Compact lower-left connection status and contextual bridge actions.
- Todo rail placement, responsive collapse, and scoped dismissal behavior.
- The reduced settings navigation.
- Every structured memory category, editing state, save/delete behavior, and
  adapter payload.
- Composer absence of coding-agent controls.
- TypeScript typecheck, frontend tests, production Vite build, and a launched
  Wails desktop smoke check.

## Scope boundaries

This redesign does not create a browser-delivered Pathfinder website. It does
not replace the Reasonix kernel, session store, Wails bridge, or existing
Schedule Bridge protocol. It does not remove backend compatibility merely
because a developer-facing setting becomes hidden. It modifies the existing
desktop frontend and adds only the backend adapter needed for structured student
memory.
