# Settings Page Development Guide

This document describes how to add a new Settings page in Kosmos, and the unified design and implementation conventions that all Settings pages must follow.

---

## Table of Contents

- [Settings Page Development Guide](#settings-page-development-guide)
  - [Table of Contents](#table-of-contents)
  - [1. Overall Architecture](#1-overall-architecture)
  - [2. File Naming \& Directory Structure](#2-file-naming--directory-structure)
  - [3. Three-Layer Component Pattern](#3-three-layer-component-pattern)
    - [3.1 `*View.tsx` — Container Layer](#31-viewtsx--container-layer)
    - [3.2 `*HeaderView.tsx` — Header Layer](#32-headerviewtsx--header-layer)
    - [3.3 `*ContentView.tsx` — Content Layer](#33-contentviewtsx--content-layer)
  - [4. Header Design Conventions](#4-header-design-conventions)
    - [4.1 Template](#41-template)
    - [4.2 Rules](#42-rules)
  - [5. Content Area Design Conventions](#5-content-area-design-conventions)
    - [5.1 Root Structure](#51-root-structure)
    - [5.2 Card Conventions](#52-card-conventions)
    - [5.3 Setting Item Conventions](#53-setting-item-conventions)
  - [6. CSS Import Conventions](#6-css-import-conventions)
  - [7. State Management (Container Pattern)](#7-state-management-container-pattern)
    - [7.1 State Declaration](#71-state-declaration)
    - [7.2 Optimistic Updates](#72-optimistic-updates)
    - [7.3 Callback Naming](#73-callback-naming)
  - [8. IPC Call Conventions](#8-ipc-call-conventions)
  - [9. Common UI Controls](#9-common-ui-controls)
    - [9.1 Toggle Switch](#91-toggle-switch)
    - [9.2 Radio Mode Selector](#92-radio-mode-selector)
    - [9.3 Dropdown Select](#93-dropdown-select)
    - [9.4 Shortcut Recorder](#94-shortcut-recorder)
    - [9.5 Inline Action Button](#95-inline-action-button)
    - [9.6 Setting Description Text](#96-setting-description-text)
  - [10. Error Handling](#10-error-handling)
  - [11. Register in Navigation](#11-register-in-navigation)
    - [Step 1: Add an icon](#step-1-add-an-icon)
    - [Step 2: Add a feature flag (optional)](#step-2-add-a-feature-flag-optional)
    - [Step 3: Add a NavItem](#step-3-add-a-navitem)
    - [Step 4: Map the path in `getActiveView()`](#step-4-map-the-path-in-getactiveview)
  - [12. Register Route](#12-register-route)
  - [13. Feature Flags](#13-feature-flags)
  - [14. New Page Checklist](#14-new-page-checklist)
  - [Existing Pages](#existing-pages)
  - [App-Level Config (app.json)](#app-level-config-appjson)
  - [Profile-Level Config (profile.json)](#profile-level-config-profilejson)
  - [Visual Spec Reference](#visual-spec-reference)

---

## 1. Overall Architecture

Every Settings page follows a **three-layer component pattern**:

```
<XxxView>               ← Container layer: owns state, handles logic, makes IPC calls
  ├── <XxxHeaderView>   ← Presentation layer (Header): renders the top title bar, stateless
  └── <XxxContentView>  ← Presentation layer (Content): renders settings items, pure props, no IPC
```

**Principles:**
- `*View.tsx` — the only stateful layer; responsible for data loading, saving, and IPC calls
- `*HeaderView.tsx` — stateless, renders a fixed header
- `*ContentView.tsx` — driven entirely by props (data + callbacks); no direct IPC calls; easy to test in isolation

---

## 2. File Naming & Directory Structure

All files live in `src/renderer/components/settings/`, named as follows:

| File | Description |
|------|-------------|
| `XxxSettingsView.tsx` | Container layer (also `XxxView.tsx` for legacy pages, e.g. `AboutAppView.tsx`) |
| `XxxSettingsHeaderView.tsx` | Header layer |
| `XxxSettingsContentView.tsx` | Content layer |

Example (Screenshot):

```
ScreenshotSettingsView.tsx
ScreenshotSettingsHeaderView.tsx
ScreenshotSettingsContentView.tsx
```

> **Convention**: New pages must use `XxxSettingsView.tsx` naming. `XxxView.tsx` is a legacy exception.

---

## 3. Three-Layer Component Pattern

### 3.1 `*View.tsx` — Container Layer

```tsx
import React, { useState, useEffect } from 'react'
import XxxSettingsHeaderView from './XxxSettingsHeaderView'
import XxxSettingsContentView from './XxxSettingsContentView'
import '../../styles/ToolbarSettingsView.css'

interface XxxSettings {
  enabled: boolean
  // match IPC response shape
}

const XxxSettingsView: React.FC = () => {
  const [settings, setSettings] = useState<XxxSettings>({ enabled: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      setLoading(true)
      const res = await window.electronAPI.xxx?.getSettings()
      if (res?.success && res.data) {
        setSettings(res.data)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleSettingsChange = async (newSettings: XxxSettings) => {
    setSettings(newSettings)
    await window.electronAPI.xxx?.saveSettings(newSettings)
  }

  return (
    <div className="runtime-settings-view">
      <XxxSettingsHeaderView />
      <XxxSettingsContentView
        settings={settings}
        loading={loading}
        error={error}
        onSettingsChange={handleSettingsChange}
      />
    </div>
  )
}

export default XxxSettingsView
```

**Key rules:**
- Root element must use `className="runtime-settings-view"` (`display: flex; flex-direction: column; height: 100%`)
- Pass `loading` and `error` as props to ContentView
- All event callbacks (`onXxx`) are defined here and passed as props
- Toggle-style settings use **optimistic updates**: call `setSettings()` first, then IPC async

### 3.2 `*HeaderView.tsx` — Header Layer

See [Section 4](#4-header-design-conventions).

### 3.3 `*ContentView.tsx` — Content Layer

See [Section 5](#5-content-area-design-conventions).

---

## 4. Header Design Conventions

### 4.1 Template

```tsx
import React from 'react'
import '../../styles/Header.css'

// Define a page-specific icon (Fluent UI SVG, 24×24)
const XxxIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* SVG path */}
  </svg>
)

const XxxSettingsHeaderView: React.FC = () => {
  return (
    <div className="unified-header">
      <div className="header-title">
        <XxxIcon />
        <span className="header-name">Xxx Settings</span>
      </div>
      {/* Optional: right-side actions */}
      {/* <div className="header-actions">...</div> */}
    </div>
  )
}

export default XxxSettingsHeaderView
```

### 4.2 Rules

| Rule | Detail |
|------|--------|
| **Container class** | Must use `.unified-header` (defined in `Header.css`) |
| **Height** | Fixed `64px` (enforced by `.unified-header`) |
| **Icon** | Use Fluent System Icons ([fluenticons.co](https://fluenticons.co)), size `24×24`, color `fill="currentColor"` or `fill="#272320"` |
| **Title text** | Use `.header-name`, `17px` / `weight 650` |
| **Right-side actions** | Wrap in `.header-actions` container, `gap: 8px` |
| **Stateless** | No `useState` inside HeaderView |

---

## 5. Content Area Design Conventions

### 5.1 Root Structure

```tsx
<div className="content-view-container">           {/* Outer scroll container, full height */}
  <div className="toolbar-settings-content">       {/* max-width: 56rem, centered */}
    <div className="toolbar-settings-form">        {/* Transition wrapper */}
      <div className="toolbar-settings-form-inner"> {/* padding: 0 1.5rem 1.5rem */}

        {/* One Card per logical feature group */}
        <div className="toolbar-settings-card">
          {/* Setting items */}
        </div>

      </div>
    </div>
  </div>
</div>
```

**Key rules:**
- Content root must always be `content-view-container` (full-height + scrollable)
- Content max-width `56rem` (`toolbar-settings-content`), auto-centered
- Logical groups are wrapped in a **Card** (`.toolbar-settings-card`), `1.5rem` vertical gap between cards

### 5.2 Card Conventions

```css
/* Defined in: ToolbarSettingsView.css */
.toolbar-settings-card {
  background-color: white;
  border-radius: 0.75rem;    /* 12px */
  padding: 8px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
```

**When to create a new Card:**
- Use one Card per logical feature group (e.g. General Settings / Shortcut / Agent Visibility)
- **Do not** put all items into a single Card

**Card title row separator:**
When a Card has a title row, use `borderBottom` to visually separate it from content rows:
```tsx
<div className="toolbar-setting-item" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '10px', marginBottom: '4px' }}>
  <div className="setting-label-container">
    <label className="setting-label" style={{ fontWeight: 500 }}>Card Title</label>
    <p className="setting-description">Optional card description.</p>
  </div>
</div>
```

### 5.3 Setting Item Conventions

```tsx
<div className="toolbar-setting-item">
  <div className="setting-label-container">
    <label className="setting-label">Setting Name</label>
    <p className="setting-description">Optional helper text.</p>
  </div>
  {/* Right-side control: Toggle / Radio / Select / Input / Button */}
</div>
```

`.toolbar-setting-item` rules:
- `display: flex; align-items: center; justify-content: space-between`
- `padding: 10px 4px`
- Label on the left (`.setting-label-container`), control on the right — never stack both left

---

## 6. CSS Import Conventions

**ContentView** import order:

```tsx
import '../../styles/ContentView.css'          // Required: outer container base styles
import '../../styles/ToolbarSettingsView.css'   // Required: Card / Item / Toggle common styles
import '../../styles/RuntimeSettings.css'       // Optional: Radio rows, status dots, selects, etc.
```

**HeaderView** import:

```tsx
import '../../styles/Header.css'               // Required
```

**View (container layer)** import:

```tsx
import '../../styles/ToolbarSettingsView.css'  // Required (contains .runtime-settings-view root)
```

> **Do not** create a page-specific CSS file unless you need styles unique to that page (e.g. `AboutAppView.css`). Prefer extending `ToolbarSettingsView.css` or `RuntimeSettings.css` to keep styles centralized.

---

## 7. State Management (Container Pattern)

### 7.1 State Declaration

- All state lives in the container View
- Keep data state and UI state (`loading`, `error`) separate
- Pass both state values and handlers down to ContentView as props

```tsx
// ✅ Correct
const [settings, setSettings] = useState<XxxSettings>(defaultSettings)
const [loading, setLoading]   = useState(true)
const [error, setError]       = useState<string | null>(null)
```

### 7.2 Optimistic Updates

For toggle-style settings that take effect immediately:

```tsx
const handleToggle = async (value: boolean) => {
  // 1. Update local state immediately (instant feedback)
  setSettings(prev => ({ ...prev, enabled: value }))
  // 2. Notify main process asynchronously
  await window.electronAPI.xxx?.saveSettings({ ...settings, enabled: value })
}
```

### 7.3 Callback Naming

| Prop name | Purpose |
|-----------|---------|
| `onSettingsChange` | Full settings object change (toggle, select, etc.) |
| `onXxxChange` | Single field change (e.g. `onShortcutChange`) |
| `onInstall` | Install action |
| `onDelete` / `onUninstall` | Delete / uninstall action |
| `onSelectPath` / `onResetPath` | Path picker / reset |

---

## 8. IPC Call Conventions

**Rule: IPC calls are made only in `*View.tsx` (container layer). `*ContentView.tsx` must never call IPC directly.**

```tsx
// ✅ Correct — in View layer
const loadSettings = async () => {
  const res = await window.electronAPI.xxx?.getSettings()
  if (res?.success && res.data) setSettings(res.data)
}

// ❌ Wrong — IPC inside ContentView
const handleSave = async () => {
  await window.electronAPI.xxx?.saveSettings(settings)
}
```

All IPC calls follow a standard response shape:
```ts
interface IpcResponse<T> {
  success: boolean
  data?: T
  error?: string
}
```

---

## 9. Common UI Controls

### 9.1 Toggle Switch

```tsx
<label className="toolbar-toggle-wrapper">
  <input
    type="checkbox"
    checked={settings.enabled}
    onChange={(e) => onSettingsChange({ ...settings, enabled: e.target.checked })}
  />
  <div className="toolbar-toggle-track"></div>
</label>
```

### 9.2 Radio Mode Selector

```tsx
<label
  className={`runtime-mode-row toolbar-setting-item ${value === 'option-a' ? 'runtime-mode-row--active' : ''}`}
  onClick={() => onChange('option-a')}
>
  <div className="setting-label-container">
    <span className="setting-label">Option A</span>
    <span className="setting-description">Description of this option.</span>
  </div>
  <input type="radio" name="modeGroup" checked={value === 'option-a'} onChange={() => onChange('option-a')} className="runtime-radio" />
</label>
```

`runtime-mode-row--active` adds a highlight background (defined in `RuntimeSettings.css`).

### 9.3 Dropdown Select

```tsx
<select
  className="runtime-select"
  value={settings.language}
  onChange={(e) => onSettingsChange({ ...settings, language: e.target.value })}
>
  {options.map(opt => (
    <option key={opt.value} value={opt.value}>{opt.label}</option>
  ))}
</select>
```

`.runtime-select` is defined in `RuntimeSettings.css`.

### 9.4 Shortcut Recorder

```tsx
import ShortcutRecorder from '../ui/ShortcutRecorder'

<ShortcutRecorder value={settings.shortcut} onChange={onShortcutChange} />
```

### 9.5 Inline Action Button

```tsx
<button className="runtime-action-btn" onClick={() => onInstall('bun')}>
  Install
</button>
```

### 9.6 Setting Description Text

```tsx
<p className="setting-description">A short description of this setting.</p>
```

`.setting-description` spec (defined in `ToolbarSettingsView.css`): `font-size: 12px; color: rgba(0,0,0,0.5); margin-top: 2px`

---

## 10. Error Handling

ContentView should always include an error banner above the form:

```tsx
{error && (
  <div className="toolbar-settings-error glass-surface">
    <div className="message-header">
      <div className="message-indicator"></div>
      <span className="message-label">Error:</span>
    </div>
    <p className="message-text">{error}</p>
  </div>
)}
```

**Rules:**
- `error: string | null` is passed in as a prop — never stored inside ContentView
- Catch errors in the View layer and call `setError()`
- Optionally auto-dismiss: `setTimeout(() => setError(null), 5000)`

---

## 11. Register in Navigation

New pages must be registered in `SettingsNavigation.tsx`.

### Step 1: Add an icon

At the top of the file, define a 20×20 SVG icon component (`fill="currentColor"`):

```tsx
const XxxIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Fluent Icon SVG path */}
  </svg>
)
```

> Navigation icons are **20×20**; Header icons are **24×24**.

### Step 2: Add a feature flag (optional)

```tsx
const xxxEnabled = useFeatureFlag('kosmosFeatureXxx')
```

### Step 3: Add a NavItem

```tsx
{xxxEnabled && (
  <NavItem
    icon={<XxxIcon />}
    label="Xxx Settings"
    isActive={activeView === 'xxx-settings'}
    onClick={() => navigate('/settings/xxx')}
  />
)}
```

### Step 4: Map the path in `getActiveView()`

```tsx
const getActiveView = () => {
  const path = location.pathname
  // ...
  if (path.includes('/settings/xxx')) return 'xxx-settings'
  return null
}
```

---

## 12. Register Route

Add a route in the app router (`src/renderer/routes/AppRoutes.tsx`):

```tsx
import XxxSettingsView from '../components/settings/XxxSettingsView'

// Under the /settings nested routes:
<Route path="xxx" element={<XxxSettingsView />} />
```

Path convention: `/settings/<feature-kebab-case>`

---

## 13. Feature Flags

For experimental or platform-specific pages, use a feature flag:

```tsx
// In src/renderer/lib/featureFlags.ts
export const FEATURE_FLAGS = {
  // ...
  kosmosFeatureXxx: {
    defaultValue: false,
    platforms: ['darwin', 'win32'],
    envs: ['development'],
  }
}
```

Usage in components:
```tsx
const xxxEnabled = useFeatureFlag('kosmosFeatureXxx')
```

Pages that are fully shipped to all users do not need a feature flag.

---

## 14. New Page Checklist

- [ ] Create `XxxSettingsHeaderView.tsx`
  - [ ] Import `Header.css`
  - [ ] Use `.unified-header > .header-title > .header-name` structure
  - [ ] Define a 24×24 Fluent SVG icon

- [ ] Create `XxxSettingsContentView.tsx`
  - [ ] Import `ContentView.css` + `ToolbarSettingsView.css` (and optionally `RuntimeSettings.css`)
  - [ ] Root structure: `content-view-container > toolbar-settings-content > toolbar-settings-form > toolbar-settings-form-inner`
  - [ ] Wrap feature groups in `.toolbar-settings-card`
  - [ ] Use `.toolbar-setting-item` for each setting row
  - [ ] Add error banner at the top of the form
  - [ ] **No direct IPC calls** — all data via props

- [ ] Create `XxxSettingsView.tsx` (container layer)
  - [ ] Import `ToolbarSettingsView.css`
  - [ ] Root element uses `runtime-settings-view`
  - [ ] Load initial data in `useEffect`
  - [ ] Define all event callbacks and pass to ContentView
  - [ ] Centralize `loading` and `error` state

- [ ] In `SettingsNavigation.tsx`:
  - [ ] Add a 20×20 SVG icon component
  - [ ] Map the path in `getActiveView()`
  - [ ] Add a `NavItem` (conditionally or unconditionally)

- [ ] Add `<Route>` in the router file

- [ ] (Optional) Register a feature flag in `featureFlags.ts`

---

## Existing Pages

| Page | Route | Feature Flag |
|------|------|--------------|
| About | `/settings/about` | — |
| Screenshot | `/settings/screenshot` | `kosmosFeatureScreenshot` |
| Runtime | `/settings/runtime` | — |
| Voice Input | `/settings/voice-input` | `kosmosFeatureVoiceInput` |
| Chrome Extension | `/settings/chrome-extension` | `browserControl` |

---

## App-Level Config (app.json)

For settings that are **shared across all profiles** (e.g., runtime environment, updater version), use the app-level config pipeline instead of profile-level state.

See the full guide: [`src/main/lib/userDataADO/README.md — App-Level Config Development Guide`](../../../main/lib/userDataADO/README.md#app-level-config-development-guide)

### Quick reference for Settings components

| Task | How |
|------|-----|
| Read app config | `appDataManager.getConfig()` / `appDataManager.getRuntimeEnvironment()` |
| React to config changes | `appDataManager.subscribe(listener)` in `useEffect` |
| Write config update | `appDataManager.updateConfig({ field: value })` |
| Never do | Call `window.electronAPI.runtime.*` to **read** config; call IPC directly to read persisted state |

```tsx
// Minimal example
useEffect(() => {
  appDataManager.initialize().then(() => setEnv(appDataManager.getRuntimeEnvironment()));
  const unsub = appDataManager.subscribe(cfg => setEnv(cfg.runtimeEnvironment ?? null));
  return unsub;
}, []);
```

---

## Profile-Level Config (profile.json)

For settings that are **per-user** (e.g., MCP servers, agent configuration), use the profile-level config pipeline. Each user's data is stored in `{userData}/profiles/{alias}/profile.json` and is fully isolated from other profiles.

See the full guide: [`src/main/lib/userDataADO/README.md — Profile-Level Config Development Guide`](../../../main/lib/userDataADO/README.md#profile-level-config-development-guide)

### Quick reference for Settings components

| Task | How |
|------|-----|
| Read profile config | `profileDataManager.getCache().profile` |
| React to profile changes | `profileDataManager.subscribe(listener)` in `useEffect` |
| Write config update | `window.electronAPI.myFeature?.update(...)` (IPC → feature manager → `ProfileCacheManager`) |
| Never do | Call `window.electronAPI.profile.getProfile()` directly inside a settings component to read persisted state |

```tsx
// Minimal example
useEffect(() => {
  const cache = profileDataManager.getCache();
  if (cache.profile) setMyConfig((cache.profile as ProfileV2).myFeature ?? DEFAULT_MY_FEATURE_CONFIG);

  const unsub = profileDataManager.subscribe((cache) => {
    if (cache.profile) setMyConfig({ ...(cache.profile as ProfileV2).myFeature! });
  });
  return unsub;
}, []);
```

---

## Visual Spec Reference

| Property | Value |
|----------|-------|
| Primary text color | `#272320` |
| Description text color | `rgba(0,0,0,0.5)` |
| Primary text size | `14px / weight 400` |
| Card title text size | `14px / weight 500` |
| Header title text size | `17px / weight 650` |
| Card border radius | `12px` |
| Card border | `1px solid rgba(0,0,0,0.12)` |
| Card padding | `8px` |
| Card item gap | `8px` |
| Setting item padding | `10px 4px` |
| Form inner padding | `0 1.5rem 1.5rem` |
| Content max-width | `56rem` |
