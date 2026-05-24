<!-- Last verified: 2026-05-17 -->

# userDataADO — Layer 2 Module Documentation

Central data persistence and profile management layer for the main process.
Owns all reads/writes to `profile.json`, chat session files, app config, and skills metadata.
Nearly every other main-process module depends on this layer.

---

## Key Files

| File | LOC | Role |
|------|-----|------|
| `profileCacheManager.ts` | ~4,200 | Singleton. In-memory cache for all profile-level data (agents, skills, MCP servers, sub-agents, settings). Writes to `profile.json`. Sends batched IPC notifications to the renderer on a 500 ms debounce. |
| `chatSessionManager.ts` | ~1,000 | Singleton. CRUD + index maintenance for chat sessions. Manages two levels of index files: chat-level (`index.json`) and month-level (`{YYYYMM}/index.json`). |
| `chatSessionFileOps.ts` | ~334 | Per-alias singleton. Raw file I/O for individual `{chatSessionId}.json` blobs. Keeps `chat_history` (UI) and `context_history` (LLM) separate in each file. |
| `appCacheManager.ts` | ~620 | Singleton. Reads/writes `{userData}/app.json` (runtime config, zoom, voice settings, screenshot settings). Fires `app:configUpdated` IPC on change. |
| `types/profile.ts` | ~1,100 | All profile-related TypeScript interfaces and default values: `Profile`, `ProfileV2`, `ChatConfig`, `ChatAgent`, `ModelConfig`, `McpServerConfig`, `SubAgentConfig`, `SubAgentIndex`, `VoiceInputSettings`, etc. |
| `openkosmosPlaceholders.ts` | ~291 | Resolves `@OPENKOSMOS_*` placeholder strings in system prompts (e.g., `@OPENKOSMOS_PROFILE_WORKSPACES_FOLDER`). Supports PATH and STRING placeholder types. |
| `pathUtils.ts` | ~451 | All path-construction helpers: `getUserDataPath`, `getProfileDirectoryPath`, `getChatSessionFilePath`, `getDefaultWorkspacePath`, and related utilities. Falls back to `os.tmpdir()` in test environments where Electron is not available. |
| `portablePath.ts` | — | Detects and converts absolute paths that no longer match the current `userData` location (e.g., after moving the app between machines or OS reinstall). |
| `agentAssetsImporter.ts` | — | Imports agent configurations from external sources into the local profile. |
| `scheduleSettingsManager.ts` | — | Manages schedule/sync-related settings within the profile. |
| `agentDuplicator.ts` | ~136 | Orchestrates agent duplication: creates new config via `ProfileCacheManager.addChatConfig`, copies knowledge files (async recursive), and duplicates enabled scheduled tasks via `schedulerManager.createJob`. |

---

## Architecture

### Storage Layout

```
{userData}/
├── app.json                                  # AppCacheManager — app-level runtime config
└── profiles/{userAlias}/
    ├── profile.json                          # ProfileCacheManager — all user profile data
    ├── chat_sessions/{chatId}/
    │   ├── index.json                        # ChatSessionManager — chat-level month index
    │   └── {YYYYMM}/
    │       ├── index.json                    # ChatSessionManager — month-level session metadata
    │       └── {chatSessionId}.json          # ChatSessionFileOps — full session file
    └── skills/{skill-name}/                  # Skill package directories
```

`chat_id` format: `chat_{YYYYMMDDHHmmSS}_{deviceId}_{random}`.
`chatSessionId` format: `chatSession_{YYYYMMDDHHmmSS}_{deviceId}_{random}`.
`schedule job id` format for newly created schedules: `sched_{YYYYMMDDHHmmSS}_{deviceId}_{random}`.
Month indexing still derives from the leading `YYYYMM` segment, and legacy `chatSession_{YYYYMMDDHHmmSS}` plus legacy `sched_{YYYYMMDDHHmmSS}_{random}` IDs remain readable for backward compatibility.

### In-Memory Cache + Dual Debounce

`ProfileCacheManager` keeps the full `ProfileV2` object in memory.
On any mutation, a 500 ms debounced batch notification is sent to all `BrowserWindow` instances via IPC.
The renderer's `ProfileDataManager` applies a further 200 ms debounce before notifying React components.
**Total maximum UI lag: ~700 ms.**

### IPC Notification Pattern

```
ProfileCacheManager.save()
  → scheduleNotifyFrontend()   // 500 ms debounce, main process
  → webContents.send('profile:updated', payload)
      → ProfileDataManager (renderer)
          → 200 ms debounce
          → React components re-render
```

`AppCacheManager` uses the same pattern but fires `app:configUpdated` synchronously on each change (no batching).

### Profile Migration V1 → V2

`isProfileV2()` detects the format on load.
If a V1 profile is found, `ProfileCacheManager` migrates it automatically to the V2 `AuthData` structure before caching.
No manual migration step is required.

### Portable Path Conversion

`portablePath.ts` compares the stored absolute paths in `profile.json` against the current `userData` root.
If a mismatch is detected (e.g., the OS user account was renamed), paths are rewritten in-place before use.

### `@OPENKOSMOS_*` Placeholder Substitution

`openkosmosPlaceholders.ts` is called by `AgentChat` at turn boundaries to expand placeholders in system prompts.
Supported placeholders:

| Placeholder | Type | Resolves To |
|-------------|------|-------------|
| `@OPENKOSMOS_PROFILE_WORKSPACES_FOLDER` | PATH | `{userData}/profiles/{alias}/chat_workspaces` |

PATH-type placeholders are normalized to the current OS path separator after expansion.

---

## Common Changes

### Adding a New Field to the Profile

1. Add the interface and default value to `types/profile.ts`.
2. Update `DEFAULT_PROFILE_V2` with the default.
3. In `ProfileCacheManager`, add a getter/setter pair and call `scheduleNotifyFrontend()` after any write.
4. Update the `integrityEnsure` block in `ProfileCacheManager` to back-fill the field for existing profiles that pre-date the change.

Confirmation suppression flags should be grouped under `confirmationSettings` in `profile.json`, not added as standalone top-level booleans. Current example: `confirmationSettings.inlineEditRegenerate.skipConfirmation`.

Agent knowledge-related settings are also grouped. Persist the Knowledge Base path under `chat.agent.knowledge`; any removed legacy fields should be stripped during normalization rather than reintroduced on `chat.agent`.

Model-tunable behavior owned by the active model (not the agent persona) is persisted as a top-level field on `ChatAgent`. The current example is `ChatAgent.reasoningEffort?: string`, canonicalized to lowercase on read and write; `undefined` means "do not send a reasoning_effort parameter" so the server-side default applies. The renderer reads it via `profileDataManager.getReasoningEffort(chatId)` (defensive `.toLowerCase()` on read for legacy mixed-case values). The chat engine consumes it through `agentChat.getCurrentModelConfig()` → `agentChatStreamingService.buildReasoningParams()` (see [Chat Engine](../chat/ai.prompt.md) and [LLM](../llm/ai.prompt.md)).

### Adding a New `@OPENKOSMOS_*` Placeholder

1. Add the enum member to `OpenKosmosPlaceholder` in `openkosmosPlaceholders.ts`.
2. Register its `PlaceholderType` in `PLACEHOLDER_METADATA`.
3. Implement the resolver in the `resolvePlaceholder` function.

### Adding a New App-Level Config Field

1. Add the field to `AppConfig` and its default in `types/app.ts`.
2. Update `isAppConfig` type-guard if needed.
3. Add a getter/setter to `AppCacheManager`; the setter must call `notifyFrontend()`.

### Changing Chat Session Storage

`ChatSessionFileOps` is keyed by `userAlias`. Any path restructuring must also update the helpers in `pathUtils.ts` (`getChatSessionFilePath`, `getChatSessionsMonthPath`, etc.) and the index maintenance logic in `ChatSessionManager`.

---

## Gotchas

- **700 ms UI lag ceiling.** The 500 ms main-process debounce + 200 ms renderer debounce means profile changes are never reflected in the UI immediately. Do not rely on synchronous reads from the renderer right after an IPC write.

- **`ChatSessionFileOps` is per-alias, not a single global singleton.** It uses `Map<string, ChatSessionFileOps>`. Calling `getInstance(aliasA)` and `getInstance(aliasB)` returns two distinct objects with different `basePath` values.

- **Month-index write locks.** `ChatSessionManager` serializes concurrent writes to the same month index using promise-chained locks (`monthIndexWriteLocks: Map<string, Promise<void>>`). Bypassing `ChatSessionManager` and writing month indexes directly via `ChatSessionFileOps` will race with these locks and corrupt the index.

- **`CorruptedMonthIndexError` is thrown, not swallowed.** If a month index file cannot be parsed, `ChatSessionManager` throws a typed `CorruptedMonthIndexError`. Callers in `ProfileCacheManager` and `AgentChat` must handle this explicitly.

- **`pathUtils` falls back to `os.tmpdir()` in tests.** When Electron is not importable (Jest environment), `getUserDataPath()` returns a temp path. Tests that write real files must set `global.electron.app` (or `OPENKOSMOS_TEST_USER_DATA_PATH`) before importing this module.

- **`portablePath` runs on every profile load.** The conversion is lightweight, but editing `profile.json` by hand with absolute paths from a different machine will trigger a rewrite of those fields on the next app start.

- **`BUILTIN_SKILL_NAMES` cannot be deleted.** `ProfileCacheManager` rejects delete requests for skills whose names appear in `BUILTIN_SKILL_NAMES` (currently `['skill-creator']`).

- **`integrityEnsure` is the startup backfill gate.** It handles missing-field backfills and still-supported compatibility normalization on each profile load. Do not add new required persisted fields without updating `integrityEnsure()`, or existing users will hit `undefined` reads.

---

## Related Modules

| Module | Relationship |
|--------|--------------|
| `src/main/lib/chat/agentChat.ts` | Primary consumer. Reads agent config, skill snapshots, model config, and MCP server list from `ProfileCacheManager` on every chat turn. |
| `src/main/lib/skill/skillManager.ts` | Writes to `{userAlias}/skills/` on disk; notifies `ProfileCacheManager` to refresh the skill index in `profile.json`. |
| `src/main/lib/auth/authManager.ts` | Reads the active `userAlias` from `ProfileCacheManager` to determine which profile directory to use. |
| `src/main/lib/mcpRuntime/mcpClientManager.ts` | Reads `McpServerConfig[]` from `ProfileCacheManager`; writes connection status back via `setMcpServerRuntimeState()`. |
| `src/main/lib/subAgent/subAgentManager.ts` | Reads `SubAgentIndex[]` / `SubAgentConfig` from `ProfileCacheManager`. |
| `src/main/lib/startupUpdate/startupUpdateService.ts` | Writes updated agent/skill/MCP/sub-agent entries back into `ProfileCacheManager` after CDN version checks. |
| `src/main/lib/runtime/RuntimeManager.ts` | Reads and writes `RuntimeEnvironment` via `AppCacheManager`. |
| `src/renderer/components/userData/ProfileDataManager` | Renderer-side consumer. Receives debounced `profile:updated` IPC events and hydrates React state. |
| `src/main/lib/workspace/fileTreeService.ts` | Reads workspace path from `ProfileCacheManager` to root the file tree. |
| `src/shared/ipc/base.ts` | IPC contract used by `ProfileCacheManager` and `AppCacheManager` to push updates to the renderer. |
