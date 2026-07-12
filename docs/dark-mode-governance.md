# Dark Mode Development Governance

This guide defines how dark mode work is designed, adapted, checked in CI, and reviewed in OpenKosmos. It is the operational companion to the dark mode PRD and technical design.

## Core contract

1. **Light baseline is sacred.** Light mode must remain visually equivalent to the pre-dark-mode app unless a PR explicitly changes Light UX and updates the PRD / Tech Doc.
2. **Token-first adaptation.** Themeable color belongs in semantic or component tokens in `src/renderer/styles/globals.css`. New component work should reuse tokens before adding primitives, and should not use `dark:` utility pairs as the default approach.
3. **One theme entry point.** Runtime theme selection flows through `appearance.themeSource`, Electron `nativeTheme.themeSource`, the startup theme seed, and document-root `data-theme`. Components must not independently read `prefers-color-scheme` for app chrome.
4. **Actual UI coverage beats isolated component assumptions.** Dark mode acceptance is based on real Electron captures of routed pages, startup/auth screens, transient side panes, menus, and component states.
5. **Warnings block merge.** Dark-mode review warnings are merge blockers unless the only warning is still-running CI.

## Development and adaptation rules

When adding or changing UI:

1. Start from the design-system token table in `docs/design-system/README.md`.
2. For themeable surfaces, text, borders, icons, controls, shadows, or state badges, use existing semantic/component tokens.
3. If a reusable theme hook is missing, add a semantic/component token with both:
   - a `:root` Light value that preserves current Light output;
   - a `[data-theme="dark"]` override for Dark output.
4. Avoid adding raw hex, raw `rgba(...)`, raw Tailwind status/brand color utilities, or new baseline/allowlist entries to make a visual change pass. Transparent warning/success/danger state colors must be semantic surface/border tokens, not copied `rgba(...)` literals.
5. Use localized `dark:` classes only as temporary migration glue when a token hook would be disproportionate; the class must still be driven by `[data-theme="dark"]`.
6. For shared controls, fix the shared primitive or shared class hook. Do not patch only the one page where the issue was spotted.
7. For startup, auth, update, onboarding, modal, menu, popover, and side-pane states, verify the real state can be captured before considering the work complete.

## Required dark-mode audit coverage

The real Electron audit must be manifest-driven and fail when required coverage is missing. The manifest must include:

- every public route wrapper and protected page component reachable from `AppRoutes`;
- every Settings child route, including the embedded Browser page;
- every Agent creation route and Agent Settings tab/state;
- `ChatView` with real conversation chrome, ChatInput action buttons, file cards, and generated/presented file cards;
- transient side panes such as Agent Memory, Scheduled runs, and Current Session Sub-Agent Tasks;
- profile menus, dropdowns, popovers, modals, and custom controls that are not visible in a page shell capture;
- startup/auth/FRE states: startup validation, sign-in, auto-login "Signing In", data loading, and First Run "Setting Up";
- shared header/action icon states and connected MCP/Skills server badges with rendered tool counts.

A capture passes only when DOM computed-style checks and screenshot pixel checks both pass. Light surfaces, low-contrast text/icons, broken toggle/radio/checkbox states, missing SVG icon paint overrides, or large near-white screenshot regions are failures unless they are intentional user-authored content or media previews.

## CI checks

Dark mode governance is enforced by two pull-request checks in the design-system workflow:

```bash
npm run check:design
npm run check:dark-mode
```

`check:design` blocks raw color/radius/token drift. `check:dark-mode` verifies that the dark-mode PRD, technical design, development governance guide, public PR review contract, package scripts, and PR workflow remain connected, and it rejects PR-added raw status `rgba(...)` literals under `src/renderer` so warning/success/danger state colors stay tokenized. The governance check is intentionally lightweight: it prevents process drift, broken references, and repeat token-first violations, while the real Electron visual audit remains the behavioral acceptance gate for dark UI correctness.

## PR review guide

Reviewers must apply this checklist whenever a PR touches theme tokens, renderer UI, startup/auth/update UI, settings, profile menus, side panes, MCP/Skills cards, chat chrome, Electron window theme behavior, or the dark-mode audit tooling.

Review must verify:

1. **Light baseline preservation.** Light mode remains the default and preserves the pre-dark baseline.
2. **Token-first implementation.** Themeable changes use managed tokens and do not scatter unmanaged `dark:` branches.
3. **Single theme contract.** Startup seed, Electron window background, `nativeTheme`, preload, renderer cache, and `ThemeProvider` stay contract-compatible when touched.
4. **Real UI coverage.** Real Electron audit coverage is added for every new route/state/component variant.
5. CI includes `check:design`, `check:dark-mode`, relevant tests, typecheck, and build verification for the changed scope.
6. PRD, Tech Doc, design-system docs, and module `ai.prompt.md` files remain synchronized with behavior.

## Updating this governance

Update this guide in the same PR when a dark-mode rule, audit manifest requirement, review expectation, or CI gate changes. If a change makes this guide more specific, also update `docs/dark-mode-prd.md`, `docs/dark-mode-tech-doc.md`, and `ai.prompt/design-system.md` when applicable.
