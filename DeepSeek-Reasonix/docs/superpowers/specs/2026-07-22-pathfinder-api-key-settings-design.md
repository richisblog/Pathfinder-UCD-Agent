# Pathfinder API Key Settings Restoration Design

## Goal

Restore a discoverable bilingual settings entry for changing model-provider API keys without restoring unrelated AI coding settings.

## Root cause

The existing `ModelsSection`, `KeyField`, `SetProviderKey`, and `ClearProviderKey` implementations are still present. The regression was introduced when `models` was removed from the visible `SETTINGS_TABS` array and the Models command-palette entry was removed. Users can no longer navigate to the working key-management interface.

## Interface

The settings navigation includes a `models` page between General and Connections. Its label is:

- Simplified Chinese: `模型与 API`
- Traditional Chinese: `模型與 API`
- English: `Models & API`

The existing page keeps two subtabs:

- model usage for choosing the active model;
- provider access for setting, updating, and clearing provider API keys.

The command palette restores a `models` command that opens the same page. No MCP, Skills, sandbox, permissions, developer hooks, or other coding-specific settings return to the visible settings navigation.

## Data flow and security

The UI continues to call the existing desktop bridge methods `SetProviderKey(apiKeyEnv, value)` and `ClearProviderKey(apiKeyEnv)`. Keys remain password inputs, are never returned to the frontend after saving, and retain the existing global credential storage behavior. The page displays only configured/not-configured state and the existing credential-source metadata.

## Testing and packaging

Contract tests prove that `models` is visible while coding-specific tabs stay hidden, the page renders `ModelsSection`, the command palette opens `models`, bilingual labels exist, and the key field is connected to both set and clear operations. After frontend regression tests pass, rebuild the arm64 Wails application and package a new DMG through the previously verified academic-data allowlist pipeline.
