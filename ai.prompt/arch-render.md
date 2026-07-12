<!-- Last verified: 2026-07-12 (OpenKosmos branding and public-only renderer surfaces verified.) -->
# OpenKosmos AI Studio — Renderer Process Architecture

Focuses on `src/renderer/` and the shared IPC framework `src/shared/ipc/`. For main-process architecture see [arch-main.md](arch-main.md).

---

## 1. Two Windows, Two Entries

The renderer process backs **two independent Electron `BrowserWindow`s**, each with its own webpack entry, HTML file, and React tree. They share `src/renderer/` as a code pool but mount completely separate component trees.

| # | Window | Entry / HTML | Dedicated code | Notes |
|---|--------|--------------|----------------|-------|
| 1 | **Main** | `index.tsx` / `index.html` | most of `src/renderer/` | Primary UI. Mounts `<App />` → provider stack → `HashRouter`. Almost every feature lives here. |
| 2 | **Screenshot** | `screenshot.tsx` / `screenshot.html` | `src/renderer/screenshot/` (`constant.ts`, `core/`, `index.tsx`) | Cropping + annotation UI. Self-contained; does not import the main-window component tree. |

The screenshot entry renders a single root via `createRoot` and bypasses `<App />` and routing entirely.

---

## 2. Top-Level Layout

```
src/renderer/
├── index.tsx, index.html              # Main window
├── screenshot.tsx, screenshot.html, screenshot/   # Screenshot window
├── App.tsx                            # Main-window provider stack + readiness gate
├── routes/                            # AppRoutes.tsx, RequireAuth.tsx (main window only)
├── components/                        # Feature-grouped UI (chat/, layout/, settings/, ...)
├── atom/                              # Custom atom state library
├── states/                            # Top-layer cross-component atoms
├── lib/                               # Renderer-side services (audio, mcp, streaming, userData ...)
├── ipc/                               # Per-feature renderer IPC clients
├── types/                             # Shared TS types + global.d.ts
├── config/, assets/, styles/
└── __tests__/
```

---

## 3. Process Boundaries & IPC

The renderer is sandboxed (`web` target, no Node integration). Anything privileged — file I/O, child_process, native modules, OS APIs — goes through preload + a typed IPC channel.

| Surface | Direction | Where defined |
|---------|-----------|---------------|
| `window.electronAPI.*` | renderer → main (request/response + subscribe) | `src/preload/main.ts`, contracts in `src/shared/ipc/*.ts` |
| `connectRenderToMain` / `connectMainToRender` | typed channel factories | `src/shared/ipc/base.ts` (see [ai.prompt.md](../src/shared/ipc/ai.prompt.md)) |
| `src/renderer/ipc/*.ts` | feature-specific client wrappers | one file per subsystem (scheduler, screenshot, memex, etc.) |
| `window` DOM events (`tokenMonitor:*`, `auth:monitor`, `navigate:to`, `debugWindowReady`) | main → renderer broadcast | preload bridges main events to `window.dispatchEvent` |

---

## 4. Main-Window Bootstrap (`App.tsx`)

1. **Readiness gate** — block the provider stack on `electronAPI.isReady()` / `onAppReady`. AuthProvider / ProfileDataProvider must not fire IPC before main-process services (auth, profile cache, MCP runtime) finish startup, or first calls race the bootstrap and surface as spurious errors.
2. **Provider stack** (outer → inner):
   `ThemeProvider → ToastProvider → AuthProvider → ReauthProvider → ProfileDataProvider → AppContent`
   - ThemeProvider applies app-level appearance from `app.json` before routed content, toast chrome, and other providers render.
   - Auth wraps ProfileData (profile load needs the token).
   - Reauth sits between to intercept 401s from any data layer below.
3. **AppContent** mounts `HashRouter`, `WindowsTitleBar`, `WindowZoomHotkeys`, `McpAuthConsentDialog`, `RequestOAuthClientIdDialog`, and `<AppRoutes />`.

Token-monitor DOM events and the MCP connection-failure toast are subscribed at the `App` level so a crashed panel below cannot drop them.

---

## 5. Routes (`routes/AppRoutes.tsx`)

`HashRouter` (required because Electron loads via `file://`) with feature-flag-gated routes. Public routes drive the login funnel; protected routes live under `<RequireAuth />`.

| Path | Page | Notes |
|------|------|-------|
| `/` | `StartupPage` | Validates env, picks next route via `StartupAction` enum |
| `/auto-login` | `AutoLoginSingleUser` | Single-user fast-path |
| `/login` | `SignInPage` | Multi-user / new-user signup |
| `/loading` | `DataLoadingPage` | Hydrates profile, then → `/agent` |
| `/agent/chat[/:chatId[/:sessionId]]` | `ChatView` | Main chat surface |
| `/agent/chat/:chatId/settings/*` | `AgentChatEditingView` | Agent editor (basic / system-prompt / mcp / skills / …) |
| `/agent/chat/creation/*` | agent-area creation flows | Custom-agent workflows |
| `/settings/*` | `SettingsPage` | mcp / runtime / appearance / skills / sub-agents (FF) / memex (profile.json master switch + profile-memory list/detail archive/delete manager) / coding-cli (profile.json master switch) / memory / sync / about / archived / embedded browser |

`AppRoutes` also bridges main-process `navigate:to` events into React Router and records every `route-change` as a crash breadcrumb via `electronAPI.recordCrashBreadcrumb`.

---

## 6. Renderer Modules (with dedicated docs)

| Module | Path | One-line | Docs |
|--------|------|----------|------|
| Atom State Library | `src/renderer/atom/` | `atom()` (Value/Action/Computed) + `<WithStore>` + `mutate`; useSyncExternalStore-based, `immer` interop | [ai.prompt.md](../src/renderer/atom/ai.prompt.md) |
| Chat UI | `src/renderer/components/chat/` | ChatView/ChatViewContent/ChatContainer/ChatRenderItem + ChatInput + Message + agent-editor (8 tabs) + toolCallViews + chat-input subcomponents + workspace | [ai.prompt.md](../src/renderer/components/chat/ai.prompt.md) |
| Streaming | `src/renderer/lib/streaming/` | RAF typewriter, smart auto-scroll, perf monitor, compatibility layer for old message format | [ai.prompt.md](../src/renderer/lib/streaming/ai.prompt.md) |
| Renderer I18n | `src/renderer/lib/i18n/` | App-level UI language catalog, typed translation helper, and `useI18n()` hook for English/Simplified Chinese UI copy | [ai.prompt.md](../src/renderer/lib/i18n/ai.prompt.md) |
| Layout | `src/renderer/components/layout/` | AppLayout (logic) + AppLayoutContent (UI shell) + ContentContainer + LayoutProvider, LeftNavigation, NavigationSection, UserMenu, WindowsTitleBar, WindowZoomHotkeys | [ai.prompt.md](../src/renderer/components/layout/ai.prompt.md) |
| Design System | `tailwind.config.js` + `src/renderer/styles/` | Token source-of-truth, multi-brand policy, styling strategy, and the `check:design` ratchet governance engine | [design-system.md](design-system.md) |
| Theme Provider | `src/renderer/components/theme/` | App-level `data-theme` + `color-scheme` bridge from persisted appearance config and system color-scheme preference | [ai.prompt.md](../src/renderer/components/theme/ai.prompt.md) |
| UI Primitives | `src/renderer/components/ui/` | Hand-rolled Badge/Card/Dialog/Toast/overlays + `cn()` (buttons use the global `.btn-*` classes — no `Button` component); `cva` powers `Badge` variants; Radix was removed (dead deps) | [ai.prompt.md](../src/renderer/components/ui/ai.prompt.md) |
| IPC Framework | `src/shared/ipc/` | `connectRenderToMain` / `connectMainToRender` typed channel factories shared across main + preload + renderer | [ai.prompt.md](../src/shared/ipc/ai.prompt.md) |

## 7. Other Renderer Folders

| Folder | Notes |
|--------|-------|
| `components/auth/` | `AuthProvider`, `ReauthProvider`, `ReauthDialog`, `AutoLoginSingleUser` |
| `components/buddy/` | Self-contained pixel-art companion widget (sprite, XP, hatching ceremony, speech bubble) |
| `components/common/` | Reusable widgets shared across features |
| `components/fre/` | First-run-experience flow |
| `components/mcp/` | Server list / add / import-from-vscode / auth consent dialog |
| `components/menu/` | Context menus and menubars |
| `components/pages/` | Top-level route pages: Startup / SignIn / DataLoading / Agent / Settings |
| `components/settings/` | All `/settings/*` panels (one per category) |
| `components/skills/` | Installed skills list and local import |
| `components/streaming/` | Streaming UI components (typewriter, auto-scroll wrapper) |
| `components/theme/` | `ThemeProvider` writes `data-theme="light|dark"` and `color-scheme` from `AppConfig.appearance.themeSource`; CSS must consume semantic tokens instead of ad-hoc media queries |
| `components/chat/toolCallViews/SubAgentToolCallView.tsx` | Ad-hoc sub-agent task progress/result viewer |
| `components/userData/` | `ProfileDataProvider` — top of the data hydration tree |
| `lib/audio/` | Whisper STT (`useSpeechRecognition`, `useStreamingAudioRecorder`) |
| `lib/auth/` | Renderer-side auth helpers / hooks |
| `lib/chat/` | Chat-view orchestration helpers (selectors, derived state) |
| `lib/featureFlags/` | `useFeatureFlag` / `useFeatureFlagState` hooks over main-side flag manager; use initialized-aware state before redirecting or permanently hiding deep-linked routes |
| `lib/i18n/` | Typed English/Simplified Chinese locale catalogs, `translate()`, and `useI18n()` for app-level UI language switching |
| `lib/mcp/` | `useMcpConnectionFailureToast` + MCP client helpers |
| `lib/models/` | Model-list / model-selector helpers |
| `lib/perf/` | `ghcPerformanceOptimizer`, `memoryOptimizer` |
| `lib/runtime/` | Renderer view of runtime status (bun/uv install state) |
| `lib/scheduler/` | Renderer scheduler client |
| `lib/screenshot/` | Renderer-side screenshot trigger |
| `lib/skills/` | Skill list / install hooks |
| `lib/startup/` | Startup validation client |
| `lib/userData/` | `appDataManager`, `profileDataManager`, `useAppZoomLevel`, `useVoiceInputEnabled` |
| `lib/utilities/` | `createLogger` (forwards to main unifiedLogger), misc helpers |
| `lib/workspace/` | Renderer file-tree client |
| `ipc/` | One file per subsystem, including `memex`, `scheduler`, `screenshot-main`, and `screenshot-overlay` |
| `states/` | App-wide atoms (e.g. `left-nav.atom.ts`). Other state should live next to its consuming components, named `*.atom.ts`. See §8. |
| `types/` | `authTypes`, `ghcAuthTypes`, `mcpTypes`, `profileTypes`, `startupValidationTypes`, `agentContextTypes`, `global.d.ts` (declares `window.electronAPI`) |

---

## 8. State Management ⚠️ MUST READ before changing renderer code

State management is the backbone of renderer maintainability. Strictly follow the rules below.

### 8.1 Hard limit: no component file > 500 lines

**A single component file MUST NOT exceed 500 lines.** Oversized components inevitably accumulate large piles of local `useState`, and that "scattered local state" is the root cause of long-term maintenance pain: state spreads everywhere, dependencies tangle, and cross-component reuse becomes impossible.

- When approaching the limit, you **must** split into sub-components, extract hooks, or lift state into an atom.
- Do not keep the file alive by "just one more `useState`" — that is taking on debt.

### 8.2 Cross-component communication: think before you reach for tools

Pick the simplest option that works. **Only escalate when you actually need to:**

1. **Parent ↔ child → use props.** Simplest, best-typed, easiest to debug. Don't reach for atoms "for consistency".
2. **Cross-component / cross-layer sharing → use an atom.** See the [atom library guide](../src/renderer/atom/ai.prompt.md).
3. **Genuinely "ambient" semantics (Auth, Profile, Toast, Update) → React Context.** Use the existing Providers; do not add new ones.

### 8.3 Atom naming and placement

- **Naming convention:** every atom file ends with `*.atom.ts`, so they're trivial to grep across the codebase.
- **App-wide state:** put it in `src/renderer/states/`, e.g. `src/renderer/states/left-nav.atom.ts`.
- **Locally-shared state:** put it next to the components that use it — **proximity principle**. Example: a menu state shared only inside chat-input lives at `src/renderer/components/chat/chat-input/context-menu.atom.ts`.
- **Nested object updates:** use `immer` (already a dependency, no need to add anything).

### 8.4 Anti-patterns

- ❌ A single global `store/` directory hoarding every atom.
- ❌ Forcing atoms between parent and child instead of just using props.
- ❌ Atom files NOT named `*.atom.ts` — hidden inside `utils.ts` / `state.ts` / `context.ts`.
- ❌ A component file already > 500 lines and still adding more `useState`.

---

## 9. Feature → Module Mapping (Renderer)

| Task Keyword | Module | Path |
|---|---|---|
| chat UI, message render, streaming text | Chat UI / Streaming | `src/renderer/components/chat/`, `src/renderer/lib/streaming/` |
| agent editor (system prompt, MCP, skills, schedules) | Chat UI → agent-editor | `src/renderer/components/chat/agent-editor/` |
| sidebar, navigation, title bar, window zoom | Layout | `src/renderer/components/layout/` |
| settings panel (any `/settings/*`) | Settings | `src/renderer/components/settings/` |
| login / auto-login / reauth dialog | Auth | `src/renderer/components/auth/` |
| profile loading, app data hydration | Userdata | `src/renderer/components/userData/`, `lib/userData/` |
| voice input | Audio | `src/renderer/lib/audio/` |
| MCP UI (server list, add, library) | MCP UI | `src/renderer/components/mcp/`, `lib/mcp/` |
| sub-agent task viewer | Chat UI / Tool Calls | `src/renderer/components/chat/toolCallViews/SubAgentToolCallView.tsx` |
| skills UI | Skills UI | `src/renderer/components/skills/`, `lib/skills/` |
| feature flag check in UI | featureFlags hook | `src/renderer/lib/featureFlags/` |
| routes / navigation | Routes | `src/renderer/routes/AppRoutes.tsx` |
| dark mode, appearance, theme source | Theme Provider / Design System / Settings | `src/renderer/components/theme/`, `src/renderer/styles/`, `src/renderer/components/settings/AppearanceSettingsView.tsx` |
| state management, atom | Atom | `src/renderer/atom/` |
| screenshot window (cropping, annotation UI) | Screenshot entry + folder | `src/renderer/screenshot.tsx`, `src/renderer/screenshot/` |
| IPC channel typing / contract | IPC framework | `src/shared/ipc/` |
| renderer IPC client for a specific feature | renderer/ipc | `src/renderer/ipc/<feature>.ts` |

---

## 10. Renderer-Specific Dependencies

Versions and libs not already covered by [arch-main.md](arch-main.md).

| Category | Libraries |
|---|---|
| Core | React 18.x, `react-dom` |
| Routing | `react-router-dom` 6.x — `HashRouter` (Electron loads via `file://`) |
| UI primitives | TailwindCSS 4.x, hand-rolled primitives (Radix removed — dead deps), `lucide-react` |
| Markdown / diagrams | `react-markdown`, Mermaid (async chunk), Monaco Editor (async chunk) |
| Virtualization | `react-window` |
| State helpers | `immer` |

---

## 11. Renderer-Specific Build Notes

- 3 webpack entries → 3 HTML pages → 3 `BrowserWindow`s (see §1).
- Target `web`; Node.js polyfills (path, os, crypto, stream, buffer) injected for bundled libs — the renderer itself never touches Node APIs.
- Mermaid + Monaco split as async chunks.
- Dev server port **39017**.
- Renderer code is fully bundled into `app.asar`, so the `dependencies` vs `devDependencies` packaging pitfall in [arch-main.md](arch-main.md) does not apply here.
