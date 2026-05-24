<!-- Last verified: 2026-05-18 -->
# Layout

> Shell of the renderer SPA: left navigation sidebar, resizable divider, main content area, right global sidepane (**PM Studio only**), Windows title bar, and the `LayoutProvider` context that tracks minimal-mode/always-on-top state.

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `AppLayout.tsx` | Root layout component — wraps providers (`LayoutProvider`, `PasteToWorkspaceProvider`, `SharePointSearchProvider`, `TeamsChatSelectorProvider`), owns global event listeners (chat-session delete/rename/star/download/fork, debug-info download), knowledge-base and skill-install callbacks, renders `AppLayoutContent` | ~320 LOC |
| `AppLayoutContent.tsx` | UI shell — macOS titlebar/zoom/fullscreen handling, left sidebar + `ResizableDivider` + `ContentContainer` + right pane layout, renders all global dropdown menus, overlays (delete/rename/duplicate/image-viewer/file-viewer/skill-apply), MSAL auth overlays, and Buddy | ~265 LOC |
| `ContentContainer.tsx` | `<main>` wrapper; renders `<Outlet>` (React Router) and passes `AgentContextType` to child routes; handles `agent:newAgent` / `agent:editAgent` custom events and redirects from `/agent` root | ~107 LOC |
| `LayoutProvider.tsx` | React context (`LayoutContext`) exposing `isMinimalMode`, `isAlwaysOnTop` and their mutators | ~118 LOC |
| `LeftNavigation.tsx` | `<nav>` shell; reads `leftPanelCollapsed` from parent to apply `.collapsed` CSS class; delegates to `NavigationSection` and `UserSection` | ~38 LOC |
| `NavigationSection.tsx` | Agent list area: "New Agent" button, scrollable `AgentList`, `Divider`, built-in agents below divider; handles branding differences (openkosmos vs pm-studio) for Kobi visibility | ~432 LOC |
| `UserMenu.tsx` | User menu dropdown rendered at `AppLayoutContent` level | ~145 LOC |
| `UserSection.tsx` | Bottom of sidebar: user avatar, logout, update button | ~80 LOC |
| `RightGlobalSidepane.tsx` | Right-side panel for UserTask (**PM Studio only** — gated in `AppLayoutContent` via `BRAND_NAME`) | ~27 LOC |
| `LogoSection.tsx` | Brand logo at top of sidebar | ~31 LOC |
| `WindowsTitleBar.tsx` | Windows-only custom title bar: app icon, sidebar toggle, zoom indicator, minimize/maximize/close controls | ~157 LOC |
| `WindowZoomHotkeys.tsx` | Global keyboard shortcuts for zoom in/out/reset | ~46 LOC |

## Architecture
- **Component split**: The former monolithic `AppLayout` (~2500 LOC) has been decomposed into two layers:
  - `AppLayout` — pure logic: providers wrapping, global DOM event listeners, callbacks for file-tree operations (move-to-knowledge, install-skill). Renders `AppLayoutContent` as a child.
  - `AppLayoutContent` — pure UI: sidebar/content/right-pane layout, all global dropdown menus and overlays are rendered here as sibling portals. This is where macOS titlebar, zoom-factor sync, and fullscreen CSS class management live.
- **State ownership**: `LayoutProvider` wraps the entire app and is the single source of truth for minimal mode and always-on-top. Sidebar state is managed by two atoms: `LeftNavSizeAtom` (width, drag, persistence) and `LeftNavCollapsedAtom` (collapse toggle, persistence) in `src/renderer/states/left-nav.atom.ts`. Right pane uses `RightPaneCollapsedAtom` in `src/renderer/states/right-pane.atom.ts`.
- **Minimal mode**: enabling it automatically sets `alwaysOnTop = true` via `electronAPI.window.setAlwaysOnTop`. Disabling minimal mode also clears always-on-top. In minimal mode, sidebar and right pane are hidden.
- **Dropdown/overlay state**: all context menus and overlays (agent dropdown, workspace menu, skill menu, image viewer, file viewer, delete/rename/duplicate dialogs, etc.) are managed via atoms and rendered at `AppLayoutContent` level. No prop-drilling for overlay state.
- **Agent navigation events**: `ContentContainer` listens for `agent:newAgent` and `agent:editAgent` custom DOM events — used by `NavigationSection` to request navigation without direct prop drilling through the full tree.
- **Routing**: `ContentContainer` renders `<Outlet>` from React Router. It also guards against the `/agent` root path and forces a redirect to `/agent/chat`.
- **Branding**: `NavigationSection` uses `BRAND_NAME` to determine label text ("New Agent" vs "New Project Agent") and Kobi conditional visibility logic. `AppLayoutContent` and `WindowsTitleBar` use `BRAND_NAME` to gate the right Task sidepane and its toggle button (PM Studio only).

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Add a new global dropdown / context menu | `AppLayoutContent.tsx` | Render the menu component as a sibling; state via atom |
| Add a new global event listener | `AppLayout.tsx` | Add `useEffect` with event listener in the logic layer |
| Change sidebar min/max width | `src/renderer/states/left-nav.atom.ts` | Constants `MIN_WIDTH` / `MAX_WIDTH` are defined there |
| Add a layout state flag (e.g. right panel) | `LayoutProvider.tsx` — add to `LayoutState`, `LayoutContextValue`, and `value` object | Consumers use `useLayout()`. Panel geometry state (like width) belongs in dedicated atoms, not `LayoutProvider`. |
| Add a navigation item to the sidebar | `NavigationSection.tsx` | Use `NavItem` component; check branding flag if needed |
| Adjust Windows title bar controls | `WindowsTitleBar.tsx` | Only renders on `win32`; toggle visibility via `isWindows` guard |

## Co-Change Map
| When you change | Also check/update |
|----------------|-------------------|
| `LayoutProvider` state shape | All `useLayout()` consumers (25+ files across `menu/`, `chat/`, `layout/`) |
| Sidebar persist keys / atoms | `src/renderer/states/left-nav.atom.ts` (`LeftNavSizeAtom` for width, `LeftNavCollapsedAtom` for collapse) |
| Right pane atoms | `src/renderer/states/right-pane.atom.ts` (`RightPaneCollapsedAtom`) |
| Route paths in `ContentContainer` | React Router config in `src/renderer/routes/` |
| `AppLayoutContent` props | `AppLayout.tsx` must pass matching props |
| Global overlay additions | Import and render in `AppLayoutContent.tsx` |

## Anti-Patterns
- Do NOT add per-feature state to `LayoutProvider` — it is for window/panel geometry only. Feature-level state belongs in feature providers or atoms.
- Do NOT dispatch `agent:newAgent` / `agent:editAgent` events from components outside the layout subtree without verifying `ContentContainer` is mounted.
- Do NOT bypass `LeftNavSizeAtom` / `LeftNavCollapsedAtom` by reading sidebar state from storage directly in leaf components; use the atom's `.use()` or `.useData()`.
- Do NOT call `electronAPI.window.setAlwaysOnTop` directly from components — route through `LayoutProvider.setAlwaysOnTop` so `isAlwaysOnTop` state stays in sync.
- Do NOT add global event listeners or provider wrapping in `AppLayoutContent` — those belong in `AppLayout` (logic layer).

## Verification Steps
1. Toggle sidebar collapse — confirm `leftPanelCollapsed` CSS class is applied and persists across reload.
2. Drag sidebar divider — confirm width updates live (no persist), then persists after release.
3. Enable minimal mode — confirm window goes always-on-top; disable — confirm it releases.
4. On Windows: confirm title bar renders; on macOS confirm it returns `null`.
5. Navigate to `/agent` root — confirm automatic redirect to `/agent/chat`.
6. Switch brand to pm-studio — confirm "New Project Agent" label and Kobi conditional visibility logic.
7. Toggle right pane — confirm sidepane appears/disappears correctly.

## Gotchas
- `WindowsTitleBar` renders `null` on macOS. Any sidebar toggle logic added there will be silently absent on non-Windows platforms.
- `NavigationSection` uses `chatStatusVersion` (incremented on every `onChatStatusChanged` event) as a `useMemo` dependency to re-evaluate Kobi visibility — intentional workaround for observing external manager state reactively.
- macOS titlebar zoom compensation uses CSS custom properties (`--mac-zoom-factor`) set directly on `documentElement` to avoid React render-delay jitter.

## Related
- Depends on: [userData providers](../userData/), `agentChatSessionCacheManager` (`src/renderer/lib/chat/`), `LeftNavSizeAtom` / `LeftNavCollapsedAtom` (`src/renderer/states/left-nav.atom.ts`), `RightPaneCollapsedAtom` (`src/renderer/states/right-pane.atom.ts`), `ResizableDivider` / `NavItem` UI primitives
- Depended by: virtually all renderer views — `ChatView`, `AgentChatEditingView`, all `menu/` dropdowns consume `useLayout()`; [Chat](../chat/ai.prompt.md) renders inside `ContentContainer`'s `<Outlet>`
