# Pathfinder Sidebar and Todo Sync Refinement

## Goal

Match the annotated desktop screenshot by refining the existing Pathfinder shell without changing unrelated chat behavior.

## Sidebar layout

- Move `ScheduleBridgeStatus` out of the top of the sidebar.
- Render it in a dedicated footer slot immediately above the history, trash, automation, and settings controls.
- Keep the control compact while collapsed and make its detail popover open upward so it does not cover the project list.
- Preserve the existing UC Davis pairing, Schedule Builder launch, consent, refresh, and connection-status behavior.

## Pathfinder branding

- Continue using the current Pathfinder wordmark asset.
- Remove the negative left margin that clips the P symbol.
- Increase the visible wordmark to approximately 160 by 40 CSS pixels in the normal sidebar, with proportional sizing in workbench variants.
- Keep the entire P symbol and the Pathfinder text visible at standard sidebar widths.

## Todo state synchronization

- The right todo rail and the chat transcript must derive from the same latest top-level `todo_write` data.
- A valid running `todo_write` takes precedence immediately so pending, in-progress, and completed state changes appear without waiting for the tool result.
- A successful completed `todo_write` remains canonical after completion.
- Failed or malformed updates do not replace the last valid todo snapshot.
- When the same todo batch moves from all-completed back to incomplete, reopen the rail automatically.
- Preserve manual collapse for ordinary status updates; automatic reopening happens only for a completed-to-incomplete transition or a genuinely new incomplete batch.
- Switching conversations keeps todo scope isolated by session/tab as before.

## Testing

- Add a source/layout contract proving the schedule bridge is below the project list and before footer navigation.
- Add a branding contract proving the sidebar wordmark is not negatively offset and uses the enlarged dimensions.
- Add todo-selection unit tests for running updates, completed updates, malformed/failed fallback, and conversation scoping.
- Add todo-open-state tests for completed-to-incomplete reopening and manual-collapse preservation.
- Run the full frontend test suite, production build, and local desktop preview.

## Packaging

- Rebuild the Wails macOS arm64 application with the existing Go 1.26.4 and Wails 2.12.0 toolchain.
- Preserve the Pathfinder application icon.
- Regenerate and verify the repository DMG and the Desktop installer copy.
