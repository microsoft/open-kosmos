# OpenKosmos AI Studio — Main Process Architecture

## 1. Scope

This document covers the **main process** (`src/main/`) and **preload scripts** (`src/preload/`). For renderer-side architecture see [arch-render.md](arch-render.md). The brand (`kosmos`) is controlled via the `BRAND` env variable.

---

## 2. Process Model (Main + Preload)

| Process | Path | Key Facts |
|---------|------|-----------|
| Main | `src/main/` | Node.js; system ops, auth, MCP, persistence, TTS/STT, analytics. Entry: `bootstrap.ts` → `main.ts`; `bootstrap.ts` sets brand userData path before any import. |
| Preload | `src/preload/main.ts` + 2 | `contextBridge` per window; compile-time IPC whitelisting via `src/shared/ipc/base.ts`. |

---

## 3. Main Process Modules

| Module | Path | One-line Description | Docs |
|--------|------|----------------------|------|
| Authentication | `src/main/lib/auth/` | GitHub Copilot OAuth device flow, token refresh | — |
| Profile & Data Mgmt | `src/main/lib/userDataADO/` | Profile cache, chat session I/O, debounced frontend sync | — |
| Chat Engine | `src/main/lib/chat/` | Per-tab AgentChat, tool execution, window compression, cancellation | [ai.prompt.md](../src/main/lib/chat/ai.prompt.md) |
| MCP Runtime | `src/main/lib/mcpRuntime/` | MCPClientManager, stdio/SSE/HTTP transports, built-in tools, deferred tool loading via `tool_search` | [builtinTools](../src/main/lib/mcpRuntime/builtinTools/ai.prompt.md), [tool-search-design](tool-search-design.md) |
| LLM Integration | `src/main/lib/llm/` | GHC Copilot + Azure/Gemini/Anthropic/Cohere/Ollama via Vercel AI SDK | — |
| Workspace | `src/main/lib/workspace/` | File tree, ripgrep search, chokidar watcher, fuzzy file index | — |
| Auto-Update | `src/main/lib/autoUpdate/` | electron-updater wrapper, CDN/GitHub update checker | — |
| Startup Update Svc | `src/main/lib/startupUpdate/` | Per-launch pipeline: MCP → Skills → Agents → Sub-Agents from CDN | — |
| Feature Flags | `src/main/lib/featureFlags/` | Defaults gated on isDev/brand/platform; CLI `--enable/disable-features` | [ai.prompt.md](../src/main/lib/featureFlags/ai.prompt.md) |
| Screenshot | `src/main/lib/screenshot/` | Multi-display overlays, `screenshot://` protocol, global shortcut | [ai.prompt.md](../src/main/lib/screenshot/ai.prompt.md) |
| STT / Whisper | `src/main/lib/whisper/` | Whisper transcription, GPU accel (Vulkan/Metal) | — |
| Native Module Mgr | `src/main/lib/nativeModules/` | On-demand download of whisper-addon / sherpa-onnx from npm CDN | — |
| Skills | `src/main/lib/skill/` | .zip/.skill archives, CDN catalog, SKILL.md YAML front-matter | — |
| Terminal Manager | `src/main/lib/terminalManager/` | Pooled `command` (ephemeral) and `mcp_transport` (persistent) terminals | — |
| Background Process Mgr | `src/main/lib/backgroundProcessManager/` | Async background process execution, ring-buffer output | [ai.prompt.md](../src/main/lib/backgroundProcessManager/ai.prompt.md) |
| Runtime Manager | `src/main/lib/runtime/` | Embedded bun + uv, Python shims, internal/external modes | — |
| Context Compression | `src/main/lib/compression/` | LLM-based compression with truncation fallback | — |
| Browser Control | `src/main/lib/browserControl/` | Local HTTP server for Chrome extension; Windows-only | [ai.prompt.md](../src/main/lib/browserControl/ai.prompt.md) |
| Assets Fetcher | `src/main/lib/assetsFetcher/` | agent_lib / mcp_lib / skills_lib JSON from CDN | — |
| Unified Logger | `src/main/lib/unifiedLogger/` | In-memory cache + file persistence in `{userData}/logs/` | — |
| Security | `src/main/lib/security/` | Path traversal prevention, workspace confinement, CommandParser | — |
| Token Counter | `src/main/lib/token/` | js-tiktoken, Vision tiling, LRU cache; drives compression gate | — |
| Quick Start Cache | `src/main/lib/cache/` | CDN agent card images cached for offline display | — |
| Cancellation Token | `src/main/lib/cancellation/` | Cooperative cancellation through chat + tool chain | — |
| Sub-Agent System | `src/main/lib/subAgent/` | SubAgentManager + SubAgentChat for bounded parallel tasks | — |
| Shared types/utils | `src/main/lib/types/`, `lib/utilities/`, `lib/utils/` | Cross-module types, error classes, Sharp helpers, CDN cache-busting | — |
| Eval Harness | `src/main/lib/evalHarness/` | AgenticEval HTTP server; `--eval-mode` headless agent execution | [ai.prompt.md](../src/main/lib/evalHarness/ai.prompt.md) |
| Crash Capture | `src/main/lib/crash/` | Crash bundles, run markers, breadcrumbs, recent logs/dumps | [crash-bundle.md](../docs/crash-bundle.md) |
| Scheduler | `src/main/lib/scheduler/` | Cron and one-shot jobs, catch-up recovery, monthly partitioned storage | [ai.prompt.md](../src/main/lib/scheduler/ai.prompt.md) |

---

## 4. Feature → Module Mapping (Main)

Use this only when a keyword does not obviously map to a module name in §3.

| Task Keyword | Module | Path |
|---|---|---|
| OAuth, login, token | Authentication | `src/main/lib/auth/` |
| agent loop, conversation | Chat Engine | `src/main/lib/chat/` |
| built-in tools, tool search, deferred tools | MCP Runtime | `src/main/lib/mcpRuntime/` |
| profile, session, data persistence | Profile & Data Mgmt | `src/main/lib/userDataADO/` |
| spawn, parallel tasks | Sub-Agent System | `src/main/lib/subAgent/` |
| model, provider | LLM Integration | `src/main/lib/llm/` |
| file tree, ripgrep | Workspace | `src/main/lib/workspace/` |
| .skill archive | Skills | `src/main/lib/skill/` |
| CDN update | Startup Update Svc | `src/main/lib/startupUpdate/` |
| voice input | STT / Whisper | `src/main/lib/whisper/` |
| addon download | Native Module Mgr | `src/main/lib/nativeModules/` |
| shell, command exec | Terminal Manager | `src/main/lib/terminalManager/` |
| async exec | Background Process Mgr | `src/main/lib/backgroundProcessManager/` |
| bun, uv, Python | Runtime Manager | `src/main/lib/runtime/` |
| context window | Context Compression | `src/main/lib/compression/` |
| Chrome extension | Browser Control | `src/main/lib/browserControl/` |
| library catalog | Assets Fetcher | `src/main/lib/assetsFetcher/` |
| log files | Unified Logger | `src/main/lib/unifiedLogger/` |
| path traversal | Security | `src/main/lib/security/` |
| token count, context size | Token Counter | `src/main/lib/token/` |
| auto-update | Auto-Update | `src/main/lib/autoUpdate/` |
| cron, scheduled task | Scheduler | `src/main/lib/scheduler/` |
| AgenticEval, headless | Eval Harness | `src/main/lib/evalHarness/` |

---

## 5. Key Dependencies (Main Process)

| Category | Libraries |
|---|---|
| Core | Electron 35.x, TypeScript 5.x |
| AI/LLM | Vercel AI SDK 5.x, `openai`, `@ai-sdk/openai-compatible`, `@google/generative-ai`, `cohere-ai`, `ollama` |
| MCP | `@modelcontextprotocol/sdk` ^1.26.0 |
| Database | `neo4j-driver` |
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
│   ├── profile.json
│   ├── chatSessions/{sessionId}.json
│   ├── credentials/browserAuthTokenCache.enc   # safeStorage-encrypted when available
│   └── skills/{skill-name}/
├── bin/                               # bun, uv + shims
├── cache/quick_start_images/
├── native-modules/                    # whisper-addon, sherpa-onnx
├── assets/whisper-models/, skills/
├── logs/
└── analytics-device-id
```

---

## 7. Build System Overview

**Webpack — Main** (target `electron-main`): 4 entries (bootstrap.ts, 3× preload); native modules externalized; `__dirname` preserved.

**Multi-Brand:**

| Attribute | `kosmos` |
|---|---|
| App ID | `com.kosmos.app` |
| Product name | OpenKosmos |
| userData folder | `openkosmos-app` |
| Exe name | `OpenKosmos.exe` |
| Config source | `brands/kosmos/config.json` |

**Electron Builder**: GitHub Releases (`gim-home/Kosmos`); asar unpack: ripgrep, playwright-core; excluded: whisper-addon, sherpa-onnx. Windows: NSIS+ZIP; macOS: DMG+ZIP (notarized); Linux: AppImage.

**Packaging Pitfall:** electron-builder only packages `dependencies` and `optionalDependencies` — **not** `devDependencies`. Moving `playwright` to devDependencies (commit `7ea925e`) silently broke all browser automation in production. Verify: `npx asar list <app.asar> | grep <module>`.

| Category | Packaged? | Use for |
|---|---|---|
| `dependencies` | Yes | Main-process runtime libs (playwright-core, sharp) |
| `optionalDependencies` | Yes (unless excluded) | Platform/on-demand native modules (whisper-addon, sherpa-onnx) |
| `devDependencies` | No | Build tools, test frameworks, renderer-only webpack-bundled modules |

---

## 8. Key Technical Decisions (Main)

**Singleton pattern**: Most main-process managers (auth, profile cache, MCP, runtime, update, analytics, feature flags, screenshot, TTS/whisper, native modules, terminal, skills, sub-agents, …) follow `private static instance` + `getInstance()`. Default to this pattern when adding a new long-lived service.

**Non-fatal error strategy**: Every subsystem wraps in try/catch + logs. One failed component never crashes the app — critical for analytics, startup updates, feature flags, native modules.

**Startup performance**: `bootstrap.ts` first (before any import); `main.ts` uses lazy getters (zero init at import time); heavy modules as `import type` only; `dotenv`/`electron-reload` via `setImmediate` in dev; `screenshot://` registered before `app.ready`.
