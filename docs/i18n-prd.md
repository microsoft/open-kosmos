# UI Internationalization PRD

## Summary

OpenKosmos must support switching the application UI between English and Simplified Chinese. The setting is a device-level application preference so startup, sign-in, loading, settings, chat, and utility surfaces can render in the selected language before a user profile is available.

## Goals

1. Let users choose English or Simplified Chinese from the application settings UI.
2. Persist the selected language across restarts and profile switches.
3. Localize renderer-owned UI copy across the main window and screenshot window.
4. Keep technical identifiers, product names, protocol names, commands, URLs, and user/runtime content unchanged when translation would reduce clarity.
5. Preserve the existing English behavior and wording as the default fallback.

## Non-goals

1. Translating user-generated content, model responses, file contents, logs, command output, tool metadata, protocol identifiers, or brand names.
2. Adding per-profile language preferences.
3. Adding runtime machine translation or automatic locale detection.
4. Supporting languages other than English and Simplified Chinese in this release.

## User Experience Requirements

1. The Settings navigation includes a Language page.
2. The Language page lists English and Simplified Chinese with localized names and descriptions.
3. Selecting a language updates visible UI copy without requiring an application restart.
4. The selected language is retained after app restart and after switching profiles.
5. If a catalog key is missing, the UI falls back to English instead of rendering an empty value.
6. Error messages, toasts, dialog labels, tooltips, placeholders, empty states, and action labels are localized when they are authored by the renderer.

## Acceptance Criteria

1. English and Simplified Chinese catalogs contain matching key sets enforced by TypeScript.
2. `app.json.uiLanguage` persists the selected value and rejects unsupported values.
3. The Language settings page can switch between English and Simplified Chinese.
4. Core flows remain localized after switching language: startup/auth, settings, chat chrome, agent editor, MCP/skills UI, file previews, Buddy UI, screenshot UI, dialogs, toasts, and empty/error states.
5. Existing tests cover supported-language validation, catalog parity, persistence, and rendering behavior for the Language settings page.
6. Pull requests that change renderer UI files must pass `npm run check:i18n`; visible copy, accessibility labels, placeholders, titles, toasts, alerts, confirmation messages, and renderer error messages in changed files must be routed through the active language.
7. Language switching must not reload user data, reset in-progress edits, close overlays, discard unsaved state, or disrupt active streaming/background work unless the user explicitly requested that action.
8. PR review must verify i18n coverage for every changed UI surface, including secondary renderer entries such as the screenshot window and startup/root error fallback.
