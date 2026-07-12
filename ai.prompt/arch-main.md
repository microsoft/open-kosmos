<!-- Last verified: 2026-07-12 (OpenKosmos branding, stable packaging identity, installation-device ID migration, user-data migration, and public-only modules verified.) -->
# OpenKosmos AI Studio — Main Process Architecture

## 1. Scope

This document covers the **main process** (`src/main/`) and **preload scripts** (`src/preload/`). For renderer-side architecture see [arch-render.md](arch-render.md). The application is built as OpenKosmos-only.

---

## 2. Process Model (Main + Preload)

| Process | Path | Key Facts |
|---------|------|-----------|
| Main | `src/main/` | Node.js; system ops, auth, MCP, persistence, local logging, and TTS/STT. Entry: `bootstrap.ts` → `bootstrapUserData.ts` (sets brand `app.setName`/`userData` path) → `main.ts`. The userData setup lives in its own module imported *before* `./main` so ESM/Rolldown evaluates it ahead of `main.ts` side effects (Vite dev bundle inlines `./main` before the entry file's own body). |
| Preload | `src/preload/main.ts` + 2 | `contextBridge` per window; compile-time IPC whitelisting via `src/shared/ipc/base.ts`. |

---

## 3. Main Process Modules

| Module | Path | One-line Description | Docs |
|--------|------|----------------------|------|
| Authentication | `src/main/lib/auth/` | GitHub Copilot OAuth device flow, token refresh | — |
| Profile & Data Mgmt | `src/main/lib/userDataADO/` | Profile cache, chat session I/O, debounced frontend sync, profile-level user-facing master switches | [ai.prompt.md](../src/main/lib/userDataADO/ai.prompt.md) |
| Chat Engine | `src/main/lib/chat/` | Per-tab AgentChat, tool execution, window compression, cancellation | [ai.prompt.md](../src/main/lib/chat/ai.prompt.md) |
| MCP Runtime | `src/main/lib/mcpRuntime/` | MCPClientManager, stdio/SSE/HTTP transports, built-in tools, deferred tool loading via `tool_search` | [builtinTools](../src/main/lib/mcpRuntime/builtinTools/ai.prompt.md), [tool-search-design](tool-search-design.md) |
| Coding CLI | `src/main/lib/codingCli/` | Type-safe Settings IPC for profile-level coding-agent master switch, selected CLI, and CLI availability detection | [ai.prompt.md](../src/main/lib/codingCli/ai.prompt.md) |
| LLM Integration | `src/main/lib/llm/` | GitHub Copilot utilities plus user-configurable OpenAI-compatible/Gemini/Anthropic/Cohere/Ollama providers | [ai.prompt.md](../src/main/lib/llm/ai.prompt.md) |
| Workspace | `src/main/lib/workspace/` | File tree, ripgrep search, chokidar watcher, fuzzy file index | — |
| Feature Flags | `src/main/lib/featureFlags/` | Defaults gated on isDev/brand/platform; CLI `--enable/disable-features` | [ai.prompt.md](../src/main/lib/featureFlags/ai.prompt.md) |
| Screenshot | `src/main/lib/screenshot/` | Multi-display overlays, `screenshot://` protocol, global shortcut | [ai.prompt.md](../src/main/lib/screenshot/ai.prompt.md) |
| TTS | `src/main/lib/tts/` | Worker pool, VITS ONNX via sherpa-onnx, chunk reorder buffer | — |
| STT / Whisper | `src/main/lib/whisper/` | Whisper transcription, GPU accel (Vulkan/Metal) | — |
| Native Module Mgr | `src/main/lib/nativeModules/` | On-demand installation of whisper-addon / sherpa-onnx from the npm registry | — |
| Skills | `src/main/lib/skill/` | Local .zip/.skill archives and SKILL.md YAML front-matter | [ai.prompt.md](../src/main/lib/skill/ai.prompt.md) |
| Terminal Manager | `src/main/lib/terminalManager/` | Pooled `command` (ephemeral) and `mcp_transport` (persistent) terminals | — |
| Background Process Mgr | `src/main/lib/backgroundProcessManager/` | Async background process execution, ring-buffer output | [ai.prompt.md](../src/main/lib/backgroundProcessManager/ai.prompt.md) |
| Runtime Manager | `src/main/lib/runtime/` | Embedded bun + uv, Python shims, and internal/external runtime modes | [ai.prompt.md](../src/main/lib/runtime/ai.prompt.md) |
| Context Compression | `src/main/lib/compression/` | LLM-based compression with truncation fallback | — |
| Embedded Browser | `src/main/lib/embeddedBrowser/` | Per-chat-session in-app browser side panel (`WebContentsView` per session, shared cookie partition, 5-min idle reclaim) for chat-message links; also **agent-controllable** via the `browser` built-in tool (navigation state/history/reload/stop, viewport screenshots, read/inspect/diagnostics, click/type/wait/scroll/key/hover/form actions) gated by the profile-level `browser.enabled` switch in profile.json (Settings → Browser; default off) | [ai.prompt.md](../src/main/lib/embeddedBrowser/ai.prompt.md) |
| Computer Use | `src/main/lib/computerUse/` | Agent control of the **real local desktop** via the `computer_use` built-in tool (screenshot grounding + synthetic mouse/keyboard on any native app: click/type/hotkey/drag/scroll/focus_window); image→screen coordinate mapping, macOS Screen-Recording/Accessibility gating, per-action HITL confirmation (`request_interactive_input` + `confirmed:true` retry), per-app allowlist; gated by the profile-level `computerUse.enabled` switch in profile.json (Settings → Computer Use; default off). Native input via `@nut-tree-fork/nut-js` (optionalDependency) | [ai.prompt.md](../src/main/lib/computerUse/ai.prompt.md) |
| Unified Logger | `src/main/lib/unifiedLogger/` | In-memory cache + file persistence in `{userData}/logs/` | — |
| Security | `src/main/lib/security/` | Path traversal prevention, workspace confinement, CommandParser | — |
| Token Counter | `src/main/lib/token/` | js-tiktoken, Vision tiling, LRU cache; drives compression gate | — |
| Cancellation Token | `src/main/lib/cancellation/` | Cooperative cancellation through chat + tool chain | — |
| Sub-Agent System | `src/main/lib/subAgent/` | SubAgentManager + SubAgentChat for bounded parallel tasks | [ai.prompt.md](../src/main/lib/subAgent/ai.prompt.md) |
| Shared types/utils | `src/main/lib/types/`, `lib/utilities/`, `lib/utils/` | Cross-module types, error classes, and Sharp helpers | — |
| Eval Harness | `src/main/lib/evalHarness/` | AgenticEval HTTP server; `--eval-mode` headless agent execution | [ai.prompt.md](../src/main/lib/evalHarness/ai.prompt.md) |
| Crash Capture | `src/main/lib/crash/` | Crash bundles, run markers, breadcrumbs, recent logs/dumps | [crash-bundle.md](../docs/crash-bundle.md) |
| Scheduler | `src/main/lib/scheduler/` | Cron and one-shot jobs, catch-up recovery, monthly partitioned storage | [ai.prompt.md](../src/main/lib/scheduler/ai.prompt.md) |
| Memex Memory | `src/main/lib/memex/` | Zettelkasten long-term memory with current-agent and profile-memory scopes; vendored memex core, native facade, chat-scoped read IPC, Settings profile-memory management, gated by the profile-level `memex.enabled` switch in profile.json (Settings → Memex Memory; default off) | [ai.prompt.md](../src/main/lib/memex/ai.prompt.md) |
| Agent Hooks | `src/main/lib/agentHooks/` | Profile-level Hook resources resolved per-Agent and executed around eight Agent Loop lifecycle events with command and HTTP actions; manager facade + resolver + command/HTTP runners, gated by the profile-level `hooksEnabled` switch in profile.json (default off) | [ai.prompt.md](../src/main/lib/agentHooks/ai.prompt.md) |

---

## 4. Feature → Module Mapping (Main)

Use this only when a keyword does not obviously map to a module name in §3.

| Task Keyword | Module | Path |
|---|---|---|
| OAuth, login, token | Authentication | `src/main/lib/auth/` |
| agent loop, conversation | Chat Engine | `src/main/lib/chat/` |
| built-in tools, tool search, deferred tools | MCP Runtime | `src/main/lib/mcpRuntime/` |
| coding CLI, coding agent CLI selection | Coding CLI | `src/main/lib/codingCli/` |
| agent memory, memex, knowledge cards, Zettelkasten | Memex Memory | `src/main/lib/memex/` |
| profile, session, data persistence | Profile & Data Mgmt | `src/main/lib/userDataADO/` |
| spawn, parallel tasks | Sub-Agent System | `src/main/lib/subAgent/` |
| model, provider | LLM Integration | `src/main/lib/llm/` |
| file tree, ripgrep | Workspace | `src/main/lib/workspace/` |
| .skill archive | Skills | `src/main/lib/skill/` |
| voice output | TTS | `src/main/lib/tts/` |
| voice input | STT / Whisper | `src/main/lib/whisper/` |
| addon download | Native Module Mgr | `src/main/lib/nativeModules/` |
| shell, command exec | Terminal Manager | `src/main/lib/terminalManager/` |
| async exec | Background Process Mgr | `src/main/lib/backgroundProcessManager/` |
| bun, uv, Python | Runtime Manager | `src/main/lib/runtime/` |
| context window | Context Compression | `src/main/lib/compression/` |
| log files | Unified Logger | `src/main/lib/unifiedLogger/` |
| path traversal | Security | `src/main/lib/security/` |
| token count, context size | Token Counter | `src/main/lib/token/` |
| cron, scheduled task | Scheduler | `src/main/lib/scheduler/` |
| AgenticEval, headless | Eval Harness | `src/main/lib/evalHarness/` |

---

## 5. Key Dependencies (Main Process)

| Category | Libraries |
|---|---|
| Core | Electron 35.x, TypeScript 5.x |
| AI/LLM | Vercel AI SDK 5.x, `openai`, `@ai-sdk/openai-compatible`, `@google/generative-ai`, `cohere-ai`, `ollama` |
| MCP | `@modelcontextprotocol/sdk` ^1.26.0 |
| Database | `better-sqlite3`, `neo4j-driver` |
| Native | `sharp`, `@vscode/ripgrep`, `playwright-core` |
| Speech | `@kutalia/whisper-node-addon`, `sherpa-onnx` (on-demand) |
| Token | `js-tiktoken` (`cl100k_base` / `o200k_base`) |
| Validation | `zod` |

---

## 6. Data Storage Layout

```
{userData}/
├── profiles/{userAlias}/
│   ├── auth.json
│   ├── profile.json                      # profile-owned settings, chats, agents, and feature master switches
│   ├── mcp.json                          # installed global MCP server configs, owned by McpConfigManager
│   ├── skills.json                       # global skill registry, owned by SkillsConfigManager
│   ├── hooks.json                        # global Agent Hook library, owned by HooksConfigManager; hooksEnabled stays in profile.json
│   ├── chatSessions/{sessionId}.json
│   ├── profile-memory/                 # profile-scoped Memex Memory cards shared across agents
│   ├── agents/
│   │   ├── index.json                     # agent registry
│   │   └── {agentId}/
│   │       ├── agent.json                 # standalone agent config
│   │       ├── knowledge/                 # per-agent knowledge
│   │       └── memory/                    # per-agent Memex Memory cards
│   ├── credentials/browserAuthTokenCache.enc   # safeStorage-encrypted when available
│   └── skills/{skill-name}/
├── bin/                               # bun, uv + shims
├── cache/quick_start_images/
├── native-modules/                    # whisper-addon, sherpa-onnx
├── tts-models/
├── assets/whisper-models/, skills/
├── installation-device-id             # local stable ID used in generated entity IDs and sync markers
└── logs/
```

On first access, `idFactory.ts` atomically renames the retired local
`analytics-device-id` file to `installation-device-id`, preserving the UUID while
removing the telemetry-specific filename. The ID is used only for local entity IDs
and sync markers; it is not sent to Application Insights.

---

## 7. Build System Overview

**Webpack — Main** (target `electron-main`): 5 entries (bootstrap.ts, 3× preload, ttsWorker); native modules externalized; `__dirname` preserved.

**Branding:**

| Attribute | OpenKosmos |
|---|---|
| App ID | `com.openkosmos-ai-studio` |
| Product name | OpenKosmos |
| userData folder | `openkosmos-app` |
| Exe name | `OpenKosmos.exe` |
| Config source | `brands/openkosmos/config.json` |

The App ID is a stable packaging identity: it is the macOS bundle identifier and
the Windows App User Model ID. Keep `com.openkosmos-ai-studio` synchronized across
brand config, builder metadata, compile-time definitions, tests, and build docs;
do not make a cosmetic rename without an approved migration and release identity.

**Electron Builder**: GitHub Releases (`microsoft/open-kosmos`); asar unpack: ripgrep, playwright-core; excluded: whisper-addon, sherpa-onnx. Windows: NSIS+ZIP; macOS: DMG+ZIP (notarized); Linux: AppImage.

**Packaging Pitfall:** electron-builder only packages `dependencies` and `optionalDependencies` — **not** `devDependencies`. Moving `playwright` to devDependencies (commit `7ea925e`) silently broke all browser automation in production. Verify: `npx asar list <app.asar> | grep <module>`.

| Category | Packaged? | Use for |
|---|---|---|
| `dependencies` | Yes | Main-process runtime libs (playwright-core, sharp, better-sqlite3) |
| `optionalDependencies` | Yes (unless excluded) | Platform/on-demand native modules (whisper-addon, sherpa-onnx) |
| `devDependencies` | No | Build tools, test frameworks, renderer-only webpack-bundled modules |

---

## 8. Key Technical Decisions (Main)

**Singleton pattern**: Most main-process managers (auth, profile cache, MCP, runtime, feature flags, screenshot, TTS/whisper, native modules, terminal, skills, sub-agents, …) follow `private static instance` + `getInstance()`. Default to this pattern when adding a new long-lived service.

**Non-fatal error strategy**: Every subsystem wraps in try/catch + local logs. One failed component never crashes the app — critical for startup initialization, feature flags, and native modules.

**Startup performance**: `bootstrapUserData.ts` first (sets userData before any `getPath('userData')` read), then `main.ts` (lazy getters, zero init at import time); heavy modules as `import type` only; `dotenv`/`electron-reload` via `setImmediate` in dev; `screenshot://` registered before `app.ready`. **Do not move the userData setup back into `bootstrap.ts`'s body or reorder its imports** — under the Vite/Rolldown dev bundle the whole `./main` graph is inlined and evaluated before the entry file's own statements, so the setup must stay in a module imported before `./main` (else dev `userData` falls back to `.../Application Support/Electron/`, diverging from prod). Runtime override `OPENKOSMOS_USER_DATA_NAME` pins the brand folder without a rebuild. On the first OpenKosmos launch, bootstrap atomically renames the legacy `kosmos-app` directory to `openkosmos-app` when the new directory does not exist. If both directories exist, the new directory wins without merging or overwriting. If the rename fails, bootstrap continues from the legacy directory. Explicit test and runtime folder overrides bypass migration.

**Profile-level master switches (user-facing feature toggles)**: A shippable feature the user enables from Settings (default off, persisted in `profile.json`) — *not* a developer `openkosmosFeature*` flag. Examples: `browser.enabled`, `memex.enabled`, and `hooksEnabled`. The built-in tool is always registered but gated live by `shouldExposeTool` (advertise) + `executeTool` (run), and the renderer must call `mcpClientCacheManager.refresh()` on toggle so the Agent tool list updates without a chat switch.
