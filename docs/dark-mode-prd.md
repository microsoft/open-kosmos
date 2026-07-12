# Dark Mode Support PRD

## Summary

OpenKosmos needs first-class dark mode support that follows the existing design system governance model. The feature must let users choose Light, Dark, or System appearance while preserving the current light UI as the default upgrade behavior.

## Goals

- Add a global appearance preference that applies to the whole app, independent of the signed-in profile.
- Preserve today's light theme as the default for existing and new installations.
- Support an explicit dark theme and a system-following option.
- Implement dark mode through semantic design tokens, not scattered component-level color branches.
- Keep the OpenKosmos visual system aligned with the existing design governance model.
- Keep design governance intact: no new raw color drift, no baseline increases, and documentation updated with any token contract changes.
- Make dark-mode development, CI, and PR review enforceable through `docs/dark-mode-governance.md`, `npm run check:dark-mode`, and the dedicated dark-mode review gate.

## Non-goals

- Per-brand theme divergence.
- User-customizable color palettes.
- Replacing the current design system or moving to a new component library.
- Full screenshot-editor recoloring in the first implementation slice. The screenshot window loads global tokens, but screenshot annotation colors and user drawing palettes remain fixed unless explicitly reworked later.
- Recoloring syntax highlighting. Code and markdown syntax colors stay governed by `code-styles.css`.

## User Experience

Users can open Settings and choose an appearance mode:

| Option | Behavior |
|---|---|
| Light | Always use the current light appearance. |
| Dark | Always use dark appearance. |
| System | Follow the OS color-scheme preference. |

The default is Light so existing users do not see an unexpected visual change after upgrading.

## Requirements

1. The app stores the appearance preference in app-level configuration (`app.json`), not in `profile.json`.
2. The renderer applies the effective theme by setting `data-theme` on the document root.
3. The main process synchronizes Electron `nativeTheme.themeSource` and the main window background with the stored preference, so native chrome such as the macOS hidden titlebar matches the effective theme.
4. Tailwind `dark:` variants, where they already exist, must be selector-driven by `data-theme="dark"` instead of silently following `prefers-color-scheme`.
5. The first implementation slice must include the app shell, shared headers/content containers, settings cards, buttons, form controls, and core global surfaces.
6. Components must prefer semantic tokens (`--color-text-*`, `--color-bg-*`, `--color-surface-*`, `--color-border-*`, `--button-*`) over primitive ramps for themeable surfaces.
7. Existing raw-color governance must remain enforced.
8. The Light baseline must remain the default upgrade path and must not be restyled by dark-mode work unless a PR explicitly changes Light UX and updates this PRD and the technical design.
9. Dark-mode governance assets must stay wired together: development guidance, technical design, PRD, design-system docs, the public review checklist, package script, and CI workflow.

## Acceptance Criteria

- Settings includes an Appearance page with Light, Dark, and System choices.
- Selecting Dark updates the current window without restart.
- Selecting Light restores the current light appearance.
- Selecting System updates according to the OS preference.
- The choice persists across reloads and app restarts.
- The root document exposes `data-theme="light"` or `data-theme="dark"` and an appropriate CSS `color-scheme`.
- Electron `nativeTheme.themeSource` is set to the stored source.
- The macOS titlebar / traffic-light strip uses the dark window background when Dark or dark System mode is active.
- Dark visual acceptance checks must treat light surfaces as failures even when their text contrast passes. Regular chrome, cards, tabs, buttons, form controls, markdown/file viewers, and onboarding surfaces must use dark surfaces with light text/icons unless the surface is an intentional media preview or user-authored content.
- Stateful controls and menus must be visually complete in dark mode: toggle off tracks must remain visible behind the thumb, selected radio/checkbox states must stay distinct, and custom dropdown triggers/menus must not render as light surfaces.
- Chat-specific acceptance checks must include real conversation chrome: ChatInput action buttons and SVG icon internals, message file cards, generated/presented file cards, and right-side Agent Memory, Scheduled runs, and Sub-Agent Tasks panes.
- Entry-state acceptance checks must render the real Electron UI before and during authentication: startup validation, sign-in, auto-login "Signing In", data loading, and First Run "Setting Up" screens must all use dark surfaces with readable light text/icons.
- Renderer route/component acceptance checks must be manifest-driven from `AppRoutes`: every public route wrapper, protected page component, Settings child route, Agent creation route, Agent Settings tab, and required transient overlay/state must have a named real Electron capture. Missing captures fail the audit even when the pages that did run have no visual failures.
- Shared component-state acceptance checks must include unified header icons/action buttons and connected-server status/tool badges. Inline SVG icon paint and badge text must meet dark-mode contrast requirements across every page using the shared header or MCP/Skills server card patterns.
- Real visual audits must include screenshot-level white-region detection, not only DOM computed-style checks, so stale/light rendered pixels cannot be missed when transient startup screens are captured.
- PR-added warning/success/danger state colors must be tokenized; `npm run check:dark-mode` fails on new raw status `rgba(...)` literals under `src/renderer`.
- `docs/dark-mode-governance.md` documents the required development, adaptation, CI, and PR review process.
- `npm run check:dark-mode`, `npm run check:design`, relevant unit tests, `npm run typecheck`, and `npm run build:vite` pass.

## Risks

- Existing isolated `dark:` utility classes can produce partial dark mode if they are not tied to the design-system theme selector.
- Primitive utility classes such as `bg-white` and `text-neutral-900` do not automatically become theme-aware; they need migration to semantic tokens over time.
- Black primary buttons lose contrast on dark surfaces unless button colors are moved behind component tokens.
- Ad-hoc `rgba(255,255,255,...)` and `rgba(0,0,0,...)` values need semantic surface/shadow tokens before dark mode can be visually complete.
