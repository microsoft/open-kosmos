# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Building and Running
```bash
# Development server (renderer only)
npm run dev

# Full development (main + renderer watch)
npm run dev:full

# Build (main + renderer)
npm run build
npm run build:main       # Build main process only
npm run build:renderer   # Build renderer process only

# Run the application
npm run electron         # After building
npm run electron:dev     # Development mode with dev renderer
npm run start            # Build and run in production mode
npm run start:prod       # Production mode
```

### Testing and Quality
```bash
npm test                 # Run Jest tests
npm run lint             # Check code style
npm run lint:fix         # Auto-fix linting issues
npm run test:build       # Test build integrity
npm run test:build:verify # Verify build output
```

### Building Installers
```bash
npm run dist             # Build for current platform
npm run dist:win         # Windows installer
npm run dist:mac         # macOS DMG
npm run dist:linux       # Linux AppImage
npm run dist:all         # All platforms

# Architecture-specific builds
npm run dist:win:x64
npm run dist:win:arm64
npm run dist:mac:x64
npm run dist:mac:arm64
npm run dist:mac:universal
```

### Release Management
```bash
npm run prepare:release         # Interactive release preparation
npm run prepare:release:patch   # Prepare patch release (x.x.1)
npm run prepare:release:minor   # Prepare minor release (x.1.0)
npm run prepare:release:major   # Prepare major release (1.0.0)

npm run dist:publish            # Build and publish to GitHub releases
npm run dist:publish:win        # Publish Windows build
npm run dist:publish:mac        # Publish macOS build
```

## Architecture Overview

OpenKosmos is an Electron-based AI assistant application (v1.21.7) with a modern React frontend. It supports multi-brand deployment via `BRAND` env variable. The architecture follows Electron's multi-process model with clear separation of concerns.

### Process Architecture

**Main Process** (`src/main/`)
- Handles system-level operations, file I/O, and native integrations
- Manages authentication via GitHub Copilot OAuth device flow
- Controls MCP (Model Context Protocol) server lifecycle
- Persists user data and chat sessions to local storage
- Manages voice features (STT), screenshot capture, browser control, and analytics
- Entry point: `src/main/bootstrap.ts` → `src/main/main.ts`
- `bootstrap.ts` configures brand-specific `userData` path isolation before any module initialization

**Renderer Process** (`src/renderer/`)
- React 18 UI with TypeScript and TailwindCSS
- Two independent entry points: main window (`index.tsx`), screenshot overlay (`screenshot.tsx`)
- Communicates with main process via type-safe Electron IPC (see `src/shared/ipc/`)
- Custom atom-based state management library (`src/renderer/atom/`)
- Entry point: `src/renderer/index.tsx`, main component: `src/renderer/App.tsx`

**Preload Scripts** (`src/main/preload.ts`, `preload-screenshot/entry.ts`)
- Bridge main and renderer processes securely via `contextBridge`
- Each window type has its own preload with scoped API surface
- Type-safe IPC channel whitelisting enforced at compile time via `src/shared/ipc/base.ts`

### Core Systems

#### 1. Authentication System (`src/main/lib/auth/`)
- **MainAuthManager**: Singleton managing authentication state, token refresh, and profile persistence
- **GhcAuthManager**: GitHub Copilot OAuth device flow implementation
- **TokenMonitor**: Monitors token expiration and triggers automatic refresh
- **RefreshTokenAnalyzer**: Validates and analyzes token health
- Authentication flow uses GitHub OAuth device code flow with automatic token refresh
- Stores auth data in `{userData}/profiles/{userAlias}/auth.json`

#### 2. Profile & Data Management (`src/main/lib/userDataADO/`)
- **ProfileCacheManager**: Centralized data management (~110KB) for user profiles, chat configs, agents, skills, and MCP servers
- **ChatSessionManager** / **ChatSessionFileOps**: Handles chat session persistence to individual JSON files
- **AgentAssetsImporter**: Imports agent configurations from external sources
- **AppCacheManager**: Application-level cache (runtime config, feature flags)
- Profiles stored in `{userData}/profiles/{userAlias}/profile.json`
- Chat sessions stored in `{userData}/profiles/{userAlias}/chatSessions/{sessionId}.json`
- Skills stored in `{userData}/profiles/{userAlias}/skills/{skill-name}/`
- Uses in-memory caching with batch notification to frontend (500ms debounce)

#### 3. Chat Engine (`src/main/lib/chat/`)
- **AgentChat**: Core conversation engine (~163KB) — one instance per active chat tab, manages multi-step agent conversations with tool execution
- **AgentChatManager**: Manages AgentChat instance lifecycle (~51KB)
- **GlobalSystemPrompt**: Injects global system instructions into all conversations
- Chat status flow: `IDLE → SENDING_RESPONSE → COMPRESSING_CONTEXT → COMPRESSED_CONTEXT → RECEIVED_RESPONSE`
- Supports `{{KOSMOS_*}}` placeholder substitution in system prompts
- Integrates with memory system for semantic context enhancement
- Uses `CancellationToken` for mid-stream cancellation

#### 4. MCP Runtime (`src/main/lib/mcpRuntime/`)
- **MCPClientManager**: Manages MCP server connections and tool execution (~55KB, singleton)
- **VscMcpClient**: VSCode-compatible MCP client implementation (primary client, supports stdio/SSE/HTTP)
- **BuiltinMcpClient**: Provides 30+ built-in tools organized by category
- **BuiltinToolsManager**: Central tool registry and dispatcher
- Supports multiple transport types: stdio, SSE, and HTTP
- Uses ALL vscMcpClient approach (MCPClient/SDK disabled to avoid issues)
- Can import MCP server configs from VSCode settings

**Built-in Tools** (`src/main/lib/mcpRuntime/builtinTools/`):
| Category | Tools |
|----------|-------|
| Web Search | Bing web/image search, Google web/image search |
| Web Fetch | Fetch web content, read HTML, Playwright browser automation |
| File Operations | Read, write, create, append, move files, download & save |
| File Search | Search files, search text in files (ripgrep) |
| Office/Docs | Read Office files (docx, xlsx, pptx via mammoth/jszip) |
| Command Execution | Execute shell commands via terminal manager |
| MCP Management | Add/toggle/update/check MCP servers by config or from library |
| Skill Management | Add skills from library, check skill status |
| Agent Management | Add/update/get/set agents, check agent status |
| Utilities | Get current date/time, present deliverables |

#### 5. LLM Integration (`src/main/lib/llm/`)
- **ghcModelApi**: GitHub Copilot model API integration (primary provider)
- **ghcModels**: Model definitions and capabilities (~49KB)
- **AzureOpenAIModelApi**: Azure OpenAI integration
- **TextLlmEmbedder**: Text embedding for memory/search features
- **ChatSessionTitleLlmSummarizer**: Auto-generates chat session titles via LLM
- **FileNameLlmGenerator**: AI-generated file names for downloads
- Supports streaming responses via Vercel AI SDK 5.x
- Model configurations stored per-profile in profile.json
- Supports multiple providers: OpenAI, Azure OpenAI, Google Gemini, Anthropic Claude, Cohere, Ollama

#### 6. Memory System (`src/main/lib/mem0/`)
- mem0-based long-term memory with vector embeddings
- **KosmosMemoryManager**: OpenKosmos-specific memory orchestration
- **BetterSqliteVectorStore**: Local SQLite + sqlite-vec for vector search
- **KosmosNeo4jStore**: Optional Neo4j graph store for knowledge graphs
- **KosmosLLM** / **KosmosEmbedder**: Memory-specific LLM and embedding adapters
- Supports semantic search through conversation history
- User-specific memory storage isolated by profile
- Gated by `kosmosFeatureMemory` feature flag

#### 7. Workspace System (`src/main/lib/workspace/`)
- **FileTreeService**: Manages file tree structure for workspace/project integration
- **SearchService**: Unified search interface for workspace files
- **RipgrepSearchEngine**: Fast content search using `@vscode/ripgrep` (primary search engine)
- **NodeFSSearchEngine**: Fallback Node.js-based search
- **WorkspaceWatcher**: File system watcher with chokidar for real-time updates
- **FileIndexCache**: In-memory file index with fuzzy matching (`fuzzyScorer.ts`)
- Workspace path defaults to user's home directory if not configured

#### 8. Auto-Update System (`src/main/lib/autoUpdate/`)
- **UpdateManager**: Manages electron-updater for application updates (~53KB)
- **CdnUpdateChecker**: Checks for updates via CDN (GitHub releases or custom CDN)
- **UpdaterFetcher**: Fetches update metadata
- Supports GitHub releases and custom CDN update channels
- Configurable via `RELEASE_CDN_URL` environment variable

#### 9. Feature Flag System (`src/main/lib/featureFlags/`)
- **FeatureFlagManager**: Singleton with context-aware defaults and CLI override
- Flags gated on: `isDev`, `brandName`, `platform`, `arch`
- CLI override: `--enable-features=flag1,flag2` / `--disable-features=flag3`
- Current flags:
  | Flag | Default |
  |------|---------|
  | `kosmosFeatureMemory` | dev (excluding win32-arm64) |
  | `kosmosFeatureScreenshot` | always enabled |
  | `kosmosFeatureVoiceInput` | dev only |
  | `browserControl` | dev + win32 only |
  | `kosmosUseOwnedOAuth` | always disabled |

#### 12. Screenshot System (`src/main/lib/screenshot/`)
- **ScreenshotManager**: Cross-platform, multi-display screenshot with capture-first-then-select workflow (singleton)
- One transparent overlay `BrowserWindow` per display (always-on-top, screen-saver level)
- Custom `screenshot://` protocol serves JPEG thumbnails to overlay renderer (avoids large IPC transfers)
- Actions: save to file, copy to clipboard, send to chat input
- Global shortcut (default: `Ctrl+Shift+S`), gated on feature flag + user settings
- macOS screen recording permission handling with retry logic

#### 13. Voice Features

**STT — Speech-to-Text** (`src/main/lib/whisper/`)
- **WhisperTranscriptionService**: Whisper-based transcription via `@kutalia/whisper-node-addon`
- **WhisperModelManager**: Downloads model files (tiny → large) from CDN
- Supports GPU acceleration (Vulkan on Windows/Linux, Metal on macOS)
- Models stored in `{userData}/assets/whisper-models/`

#### 14. Native Module Manager (`src/main/lib/nativeModules/`)
- **NativeModuleManager**: On-demand download of oversized native addons from npm CDN (singleton)
- Managed modules: `whisper-addon` (~127MB)
- Downloads `.tgz` from `registry.npmjs.org`, extracts to `{userData}/native-modules/`
- Uses `createRequire(__filename)` to bypass webpack bundling for runtime-loaded native binaries
- Throws `NativeModuleNotDownloadedError` to trigger UI download prompts
- Excluded from electron-builder asar to reduce installer size

#### 15. Skills System (`src/main/lib/skill/`)
- **SkillManager**: Manages installation and lifecycle of packaged AI prompt templates (`.zip`/`.skill` archives)
- **SkillDeviceImporter**: Imports skills from local file system
- Skill packages contain `SKILL.md` with YAML front-matter (name, description, version)
- Built-in skills (e.g., `skill-creator`) auto-installed during FRE
- Skills stored in `{userData}/profiles/{userAlias}/skills/{skill-name}/`

#### 16. Terminal Manager (`src/main/lib/terminalManager/`)
- **TerminalManager**: Manages a pool of terminal instances (max 50, 5-min idle timeout)
- **TerminalInstance**: Individual terminal process wrapper
- **PlatformConfigManager**: Platform-specific shell configuration
- Two instance types: `command` (ephemeral, one-shot) and `mcp_transport` (persistent, for MCP stdio servers)
- Automatic cleanup of idle instances (60s interval)

#### 17. Runtime Manager (`src/main/lib/runtime/`)
- **RuntimeManager**: Manages embedded `bun` and `uv` runtimes (~51KB, singleton)
- **LocalPythonMirror**: Downloads pinned Python versions for reproducible environments
- Two modes: `internal` (Kosmos-managed binaries in `{userData}/bin/`) and `external` (system-installed)
- Shim system creates wrapper scripts (python→uv, npm/npx/node→bun) in `{userData}/bin/`
- Concurrency-safe installation via `installLocks: Map`

#### 18. Context Compression (`src/main/lib/compression/`)
- **FullModeCompressor**: LLM-based conversation history compression using `claude-haiku-4.5`
- Preserves first user message, first skill tool call, and last 5 messages
- Generates 8-section structured summary (overview, resources, content status, problems, progress, active work, recent ops, continuation plan)
- Fallback to simple truncation on error

#### 19. Browser Control (`src/main/lib/browserControl/`)
- **BrowserControlHttpServer**: Local HTTP server on port 8000 serving Chrome extension update manifest and `.crx` package
- **BrowserControlMonitor**: Polls port 12306 every 2s to detect Chrome extension status, auto-connects MCP server
- Windows-only, gated by `browserControl` feature flag
- Enables AI agents to automate the user's browser via Chrome/Edge extension

#### 20. Unified Logger (`src/main/lib/unifiedLogger/`)
- **CacheLogManager**: In-memory log cache with file persistence
- **FileOperations**: Log file I/O
- **LogEntryManager**: Structured log entry creation with context fields
- Stored in `{userData}/logs/`

### Frontend Architecture

#### Window Types
| Window | Entry | HTML | Purpose |
|--------|-------|------|---------|
| Main | `index.tsx` | `index.html` | Primary application |
| Screenshot | `screenshot.tsx` | `screenshot.html` | Screen capture overlay |

#### Provider Stack (outermost → innermost)
```
ToastProvider → UpdateProvider → AuthProvider → ReauthProvider → ProfileDataProvider → AppContent
```

#### Routing (`src/renderer/routes/AppRoutes.tsx`)
Uses React Router v6 with `HashRouter`:
| Path | Component | Notes |
|------|-----------|-------|
| `/` | StartupPage | App validation |
| `/login` | SignInPage | Auth page |
| `/auto-login` | AutoLoginPage | Single-user auto-login |
| `/loading` | DataLoadingPage | Post-auth data loading |
| `/agent` | AgentPage | Protected, main chat hub |
| `/agent/chat/:chatId/:sessionId` | ChatView | Active chat |
| `/agent/chat/creation/*` | Agent creation views | Custom, library, PM project |
| `/settings/*` | SettingsPage | MCP, skills, memory, runtime, about, voice, browser control, screenshot |

Startup flow: `/` → validates → `/auto-login` or `/login` → `/loading` → `/agent`

#### Component Structure (`src/renderer/components/`)
- **auth/**: Authentication UI (AuthProvider, ReauthDialog, AutoLoginSingleUser)
- **autoUpdate/**: In-app update UI (UpdateDialog, UpdateProvider, RestartingOverlay)
- **chat/**: Chat interface (~80KB Message.tsx, ~77KB ChatInput.tsx, ~49KB ChatView.tsx)
  - **agent-area/**: Agent selection sidebar and library browser (~86KB)
  - **agent-editor/**: Multi-tab agent editor (basic, knowledge base, MCP servers, skills, system prompt)
  - **toolCallViews/**: Rich tool-call result displays (ExecuteCommand, WebFetch, WebSearch, WriteFile)
  - **workspace/**: Workspace file browser panel (FileTreeExplorer, PasteToWorkspaceDialog)
- **common/**: Shared small components
- **fre/**: First-run experience (welcome, setup, first agent tutorial, install-update-on-startup)
- **layout/**: App shell (~71KB AppLayout.tsx, LeftNavigation, WindowsTitleBar, LayoutProvider)
- **mcp/**: MCP server management (~74KB library browser, ~34KB new server wizard, import from VSCode)
- **memory/**: Memory viewer and search UI
- **menu/**: Context menus (agent, chat session, file tree, MCP, skill, workspace, attachment)
- **pages/**: Top-level pages (AgentPage, SettingsPage, SignInPage, StartupPage, DataLoadingPage)
- **settings/**: Settings panels (Runtime, VoiceInput, BrowserControl, Screenshot, About)
- **skills/**: Skills management (SkillsView, SkillListPanel, SkillFolderExplorer, library browser)
- **streaming/**: StreamingV2Message with RAF-based typewriter animation and smart auto-scroll
- **ui/**: Radix UI-based component library (buttons, dialogs, toasts, badges, navigation, overlay viewers)
- **userData/**: Profile data React context provider

#### State Management
- **Custom Atom Library** (`src/renderer/atom/`): Bespoke state management (similar to Jotai/Recoil)
  - `ValueAtom<T>`: Simple read/write atoms with `useData()`, `useChange()`, `useDataOnly()` hooks
  - `ActionAtom<T, A>`: Atoms with bound actions, supports cross-atom mutations
  - `ComputedAtom<T>`: Derived read-only atoms with automatic dependency tracking
  - `mutate()`: Cross-atom mutation functions callable from anywhere
  - Uses `useSyncExternalStore` internally for React 18 concurrent-mode safety
  - Requires `<WithStore>` provider at component tree root
- **React Context API** for auth, profile, toast, update, and layout state
- **ProfileDataManager**: Singleton with 200ms debounced IPC sync from main process
- **AgentChatSessionCacheManager**: Client-side chat session cache (~77KB) with direct callback for streaming performance
- **AgentChatIpc**: Singleton wrapping all chat IPC event listeners (streaming chunks, tool use/result, context changes)

#### Streaming Architecture
- Main process streams LLM chunks via IPC → `AgentChatIpc` → `AgentChatSessionCacheManager`
- `AgentPage` registers direct callbacks (bypasses React rendering pipeline) for immediate streaming updates
- `StreamingV2Message`: `requestAnimationFrame`-based typewriter (8 chars/frame for text, 1 char/frame for punctuation)
- `StreamingScrollManager`: VSCode-style smart scroll (auto-scroll disabled when user scrolls >150px from bottom)
- Tracks streaming metrics: words/second, time-to-first-content, latency
- Mermaid diagrams and Monaco editor lazy-loaded as async chunks

#### Styling
- TailwindCSS 3.x for styling with custom glass-morphism theme
- Custom backdrop-blur and animation utilities
- Custom CSS in `src/renderer/styles/`

### Shared Code (`src/shared/`)

#### Type-Safe IPC Framework (`src/shared/ipc/base.ts`)
Two factory functions for fully typed IPC:
- **`connectRenderToMain<RM>(prefix?)`**: Renderer → Main (invoke/handle pattern)
  - Generates `ipcMain.handle()` bindings from TypeScript interface
  - Preload whitelist enforced at compile time (missing keys → type error)
  - Channel format: `"{prefix}:{methodName}"`
- **`connectMainToRender<MR>(prefix?)`**: Main → Renderer (send/on pattern)
  - Uses `WeakMap<WebContents>` cache for per-window proxies

#### Brand Constants (`src/shared/constants/branding.ts`)
Build-time injected: `APP_NAME`, `BRAND_NAME`, `BRAND_CONFIG`, `getWindowTitle()`

#### Built-in Skills (`src/shared/constants/builtinSkills.ts`)
`BUILTIN_SKILL_NAMES = ['skill-creator']` — auto-installed, cannot be deleted

### Build System

#### Webpack Configuration

**Main Process** (`webpack.main.config.js`, target: `electron-main`)
- 4 entry points: `main` (bootstrap.ts), `preload`, `preload.screenshot`
- Externalizes all native modules: sharp, sqlite, whisper, playwright, etc.
- Preserves `__dirname`/`__filename` for Electron asset paths

**Renderer Process** (`webpack.renderer.config.js`, target: `web`)
- 2 entry points: `main` (index.tsx), `screenshot`
- Dual TypeScript loader: `babel-loader` (React Fast Refresh) → `ts-loader`
- Node.js polyfills for browser: path, os, crypto, stream, buffer, process (fs/net/child_process disabled)
- Monaco Editor plugin (11 languages, 17 features)
- Production split chunks: mermaid (async), monaco (async), mainVendor (initial), common
- Dev server: port 3000, HMR enabled, SockJS transport

#### Multi-Brand Architecture
| Attribute | `openkosmos` (default) |
|-----------|-------------------|
| App ID | `com.openkosmos.app` |
| Product name | OpenKosmos |
| User data folder | `openkosmos-app` |
| Exe name | `OpenKosmos.exe` |
| Window title | OpenKosmos |
| Config source | `brands/openkosmos/config.json` |

Controlled by `BRAND` environment variable. Brand configs stored in `brands/` directory.

#### Environment Variables
Configured via `.env.local` file (copy from `.env.example`). Injected via webpack `DefinePlugin`.

| Variable | Scope | Description |
|----------|-------|-------------|
| `NODE_ENV` | Both | development / production |
| `HISTORY_PROMPT_QUEUE_SIZE` | Both | Prompt history ring buffer size (default: 20) |
| `RELEASE_CDN_URL` | Both | Custom CDN URL for auto-updates |
| `DEVELOPMENT_BASE_CDN_URL` | Both | Dev CDN for assets |
| `PRODUCTION_BASE_CDN_URL` | Both | Prod CDN for assets |
| `GHC_CLIENT_ID` | Both | GitHub OAuth Client ID override |
| `PRESET_MODEL_*` | Both | Pre-configured Azure OpenAI model settings |
| `TAVILY_API_KEY` | Main | Tavily search service |

#### Electron Builder (`electron-builder.config.js`)
- Multi-brand support via `brandConfig`
- Publication: GitHub Releases (`ai-microsoft/openKosmos` repo)
- Asar unpacking: `@vscode/ripgrep`, all `sqlite-vec` platform variants
- Excluded from bundle: whisper-addon (downloaded on demand)
- Windows: NSIS installer + ZIP (x64, arm64)
- macOS: DMG + ZIP, hardened runtime, notarization via `scripts/notarize.js`
- Linux: AppImage (x64)

### Data Flow Patterns

#### IPC Communication (Type-Safe)
- Uses `connectRenderToMain` / `connectMainToRender` from `src/shared/ipc/base.ts`
- Renderer calls `window.electronAPI.invoke()` (async) or subscribes via `window.electronAPI.on()`
- Main handles via `ipcMain.handle()` or pushes via `webContents.send()`
- Channel format: `{prefix}:{methodName}` with compile-time type checking
- Main process also responds to `navigate:to` events to trigger renderer navigation

#### Profile Update Flow
1. User action in renderer → IPC call to main
2. ProfileCacheManager updates in-memory cache
3. ProfileCacheManager writes to disk
4. ProfileCacheManager batches frontend notification (500ms debounce)
5. Renderer `ProfileDataManager` receives update → 200ms debounce → notifies React components

#### Chat Message Flow
1. User sends message → Renderer calls `sendChatMessage` IPC
2. Main `AgentChat` formats prompt with agent config, system prompt, and MCP tools
3. Main calls LLM API with streaming enabled (via Vercel AI SDK)
4. Streaming chunks forwarded to renderer via `onStreamingChunk` IPC events
5. `AgentChatIpc` → `AgentChatSessionCacheManager` → direct callback → `AgentPage` state update
6. `StreamingV2Message` renders with RAF typewriter animation
7. Completed message saved to chat session file

#### MCP Tool Execution Flow
1. LLM requests tool execution during chat
2. `AgentChat` routes to `MCPClientManager`
3. `MCPClientManager` finds appropriate MCP client (built-in or external)
4. For external: executes via VscMcpClient (stdio/SSE/HTTP transport)
5. For built-in: dispatches through `BuiltinToolsManager` to specific tool handler
6. Result returned to LLM for continued generation
7. Tool calls may require user approval (via `SecurityValidator`)

### Data Storage Layout
```
{userData}/
├── profiles/{userAlias}/
│   ├── auth.json                    # Authentication tokens
│   ├── profile.json                 # User profile + chat configs + agent configs
│   ├── chatSessions/{sessionId}.json # Individual chat session files
│   └── skills/{skill-name}/         # Installed skill packages
├── bin/                             # Managed runtime binaries (bun, uv) + shims
├── native-modules/                  # On-demand native addons (whisper)
├── assets/
│   ├── whisper-models/              # Whisper STT model binaries
│   └── skills/                      # CDN-fetched skill catalog
├── logs/                            # Unified log files
└── analytics-device-id              # Persistent device UUID for DAU tracking
```

## Development Workflow

### Branch Naming Convention
Use the pattern: `user/<your-alias>/<feature-name>`

Example: `user/alice/add-tool-execution-logs`

### Commit Message Format
Follow conventional commits with concise descriptions:
```
type(scope): concise description

- Detailed change 1
- Detailed change 2
- Detailed change 3
```

Types: feat, fix, docs, style, refactor, test, chore

Reference: `.github/prompts/gitpush.prompt.md` for automated commit workflow

### Pull Request Process
1. Create feature branch from main
2. Make changes and test thoroughly
3. Use `.github/prompts/gitpush.prompt.md` for automated PR creation
4. Request review from project maintainer
5. Merge after approval

### Key Files to Understand
- `src/main/bootstrap.ts` - Brand-specific userData path isolation (runs before everything)
- `src/main/main.ts` - Main process initialization, all IPC handlers (~259KB, lazy-loaded managers)
- `src/main/preload.ts` - Preload script with all contextBridge IPC exposures (~101KB)
- `src/main/lib/chat/agentChat.ts` - Core chat engine (~163KB)
- `src/main/lib/userDataADO/profileCacheManager.ts` - Profile data management (~110KB)
- `src/main/lib/auth/authManager.ts` - Authentication management (~40KB)
- `src/main/lib/mcpRuntime/mcpClientManager.ts` - MCP server management (~55KB)
- `src/main/lib/runtime/RuntimeManager.ts` - Runtime environment management (~51KB)
- `src/renderer/App.tsx` - Main React component with provider stack
- `src/renderer/routes/AppRoutes.tsx` - Full route definitions
- `src/renderer/components/pages/AgentPage.tsx` - Main chat interface with streaming
- `src/renderer/atom/index.tsx` - Custom atom state management library
- `src/shared/ipc/base.ts` - Type-safe IPC framework

## Important Technical Details

### Startup Performance
- `bootstrap.ts` runs first to set brand-specific paths before any imports
- `main.ts` uses lazy getters for all heavy managers (zero initialization at import time)
- Static `import type` only for heavy modules to avoid load-time cost
- `dotenv` and `electron-reload` loaded asynchronously via `setImmediate` in dev mode
- Custom `screenshot://` protocol registered before `app.ready` (Electron requirement)

### Singleton Pattern (Universal)
Every manager class uses `private static instance` + `getInstance()`:
- `ProfileCacheManager`, `AppCacheManager`, `RuntimeManager`, `UpdateManager`
- `MainAuthManager`, `MainTokenMonitor`, `MCPClientManager`
- `AnalyticsManager`, `FeatureFlagManager`, `ScreenshotManager`
- `WhisperModelManager`
- `NativeModuleManager`, `TerminalManager`, `SkillManager`

### Electron Sandbox
- Main process runs with full Node.js access
- Renderer process runs in sandbox mode (target: `web`, no Node.js)
- Preload scripts bridge the gap securely via `contextBridge`
- Node.js APIs polyfilled in renderer where needed (path, os, crypto, stream, buffer)
- Native modules externalized from webpack, loaded at runtime

### MCP Server Management
- Supports stdio-based servers (spawned as child processes via TerminalManager)
- Supports HTTP-based servers (connects via HTTP/SSE)
- All transports use VscMcpClient implementation (VSCode-compatible, `src/main/lib/mcpRuntime/vscodeMcpClient/`)
- Automatic cleanup on app quit to prevent zombie processes
- Process tracking and forced termination in 4-stage shutdown sequence
- Startup update service auto-updates MCP servers from CDN on each launch

### Profile Migration
- Supports migration from V1 to V2 profile format
- V2 uses AuthData structure with consistent token format
- Migration happens automatically on first load

### Non-Fatal Error Strategy
Every subsystem wraps operations in try/catch and logs warnings rather than throwing — one failed component never crashes the whole app. Critical for analytics, startup updates, feature checks, and native module loading.

### Testing
- Jest configured with ts-jest (node environment)
- Tests located next to implementation files (*.test.ts)
- Path aliases configured: `@shared/*`, `@renderer/*`
- Main process tests require Electron mocking
- Test roots: `src/` and `tests/`

### Known Limitations
- Python 3.10+ required for some MCP servers
- GitHub Copilot subscription required for primary AI provider
- Windows/macOS/Linux support varies for native modules
- Memory system requires local vector database setup (sqlite-vec)
- Browser control system is Windows-only currently
- Voice input feature is dev-only by default (feature flag gated)
- Native modules (whisper ~127MB) downloaded on demand, not bundled

### Key Dependencies
| Category | Libraries |
|----------|-----------|
| Core | Electron 35.x, React 18.x, TypeScript 5.x |
| AI/LLM | Vercel AI SDK 5.x (`ai`), `openai`, `@ai-sdk/openai-compatible`, `@google/generative-ai`, `cohere-ai`, `ollama` |
| MCP | `@modelcontextprotocol/sdk` ^1.26.0 |
| UI | TailwindCSS 3.x, Radix UI, `lucide-react`, `react-markdown`, `react-syntax-highlighter`, `react-window`, `react-router-dom` 6.x, Monaco Editor |
| Database | `better-sqlite3`, `sqlite-vec`, `neo4j-driver` |
| Native | `sharp`, `@vscode/ripgrep`, `playwright` |
| Speech | `@kutalia/whisper-node-addon` (on-demand) |
| Build | webpack 5.x, electron-builder 26.x, ts-loader, babel-loader |

### Git & Pull Requests
- PR titles must be written in **English**
- Use clear, concise descriptions (e.g., "Add active user tracking via App Insights")

## Contact
For development access or questions, contact: yanhu@microsoft.com
