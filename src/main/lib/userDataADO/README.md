# userDataADO — Data Persistence Layer

This module handles all persistent data for OpenKosmos:

| File | Scope | Manager (Main) | Manager (Renderer) |
|------|-------|----------------|--------------------|
| `{userData}/app.json` | App-level, shared by all profiles | `AppCacheManager` | `AppDataManager` |
| `{userData}/profiles/{alias}/profile.json` | Profile-level, per-user | `ProfileCacheManager` | `ProfileDataManager` |
| `{userData}/profiles/{alias}/mcp.json` | Installed global MCP servers, per-user | `McpConfigManager` | `ProfileDataManager` via injected `mcp_servers` |
| `{userData}/profiles/{alias}/skills.json` | Global skill registry, per-user | `SkillsConfigManager` | `ProfileDataManager` via injected `skills` |
| `{userData}/profiles/{alias}/hooks.json` | Global Agent Hook library (the hook *list*), per-user | `HooksConfigManager` | `ProfileDataManager` via injected `hooks` |

---

## App-Level Config Development Guide

> **App-level config** is persisted in `{userData}/app.json` and shared across all user profiles. Use this pattern when the setting should not change per user (e.g., runtime environment, updater version).
>
> For profile-level config (per-user), follow the `ProfileCacheManager` pattern instead.

### Reference Implementation

The **Runtime Environment** feature (`runtimeEnvironment` in `app.json`) is the canonical example. All code references below use it as the template.

---

### Step 1 — Update the Template File (Required)

**File:** `resources/examples/app.json`

This file is the **single source of truth** for the complete `app.json` data structure. It must always reflect every field, including new ones you add, with their correct default values.

```json
{
  "updaterVersion": "",
  "runtimeEnvironment": {
    "mode": "internal",
    "bunVersion": "1.3.6",
    "uvVersion": "0.6.17",
    "pinnedPythonVersion": "3.10.12"
  }
}
```

**Rules:**
- Every field that can appear in `app.json` must exist here.
- Default values must match `DEFAULT_APP_CONFIG` in `types/app.ts`.
- Never leave undefined/null by default in the template — use `""` for optional strings.

---

### Step 2 — Add Type Definitions

**File:** `src/main/lib/userDataADO/types/app.ts`

Follow the existing pattern:

```typescript
// 1. Define the interface for the new config section
export interface MyFeatureConfig {
  enabled: boolean;
  threshold: number;
}

// 2. Define the default value
export const DEFAULT_MY_FEATURE_CONFIG: MyFeatureConfig = {
  enabled: false,
  threshold: 100,
};

// 3. Add the field to AppConfig
export interface AppConfig {
  updaterVersion?: string;
  runtimeEnvironment?: RuntimeEnvironment;  // existing
  myFeature?: MyFeatureConfig;              // ← add here
}

// 4. Update DEFAULT_APP_CONFIG
export const DEFAULT_APP_CONFIG: AppConfig = {
  runtimeEnvironment: { ...DEFAULT_RUNTIME_ENVIRONMENT },
  myFeature: { ...DEFAULT_MY_FEATURE_CONFIG },  // ← add here
};

// 5. Add a type guard
export function isMyFeatureConfig(obj: any): obj is MyFeatureConfig {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.enabled === 'boolean' &&
    typeof obj.threshold === 'number'
  );
}
```

**Key principle:** All fields in `AppConfig` are optional (`?`). `integrityEnsure` fills in missing fields at runtime; the type system must not assume they always exist.

---

### Step 3 — Config Integrity & Migration

**File:** `src/main/lib/userDataADO/appCacheManager.ts`

#### 3a. integrityEnsure — called on every read

`integrityEnsure` is called when `app.json` is loaded. It must:
1. Fill in any missing fields with defaults.
2. Migrate data from legacy locations (if any).

```typescript
private integrityEnsure(raw: Partial<AppConfig>): AppConfig {
  const result: AppConfig = { ...raw };

  // Existing: migrate runtimeEnvironment from legacy runtimeConfig.json
  if (!result.runtimeEnvironment) {
    const migrated = this.migrateRuntimeEnvironmentFromLegacy();
    result.runtimeEnvironment = migrated
      ? { ...DEFAULT_RUNTIME_ENVIRONMENT, ...migrated }
      : { ...DEFAULT_RUNTIME_ENVIRONMENT };
  } else {
    // Backfill any sub-fields added in newer versions
    result.runtimeEnvironment = {
      ...DEFAULT_RUNTIME_ENVIRONMENT,
      ...result.runtimeEnvironment,
    };
  }

  // ── New feature: backfill missing myFeature ──
  if (!result.myFeature) {
    result.myFeature = { ...DEFAULT_MY_FEATURE_CONFIG };
  } else {
    result.myFeature = { ...DEFAULT_MY_FEATURE_CONFIG, ...result.myFeature };
  }

  return result;
}
```

**Migration example** (data living in a legacy file):

```typescript
private migrateMyFeatureFromLegacy(): Partial<MyFeatureConfig> | null {
  const legacyPath = path.join(this.getUserDataPath(), 'myFeature.json');
  if (!fs.existsSync(legacyPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
  } catch {
    return null;
  }
}
```

#### 3b. appConfigSanitize — called on every write

`appConfigSanitize` is called before any write to disk. It must strip invalid types and ensure every persisted value conforms to the schema:

```typescript
private appConfigSanitize(config: Partial<AppConfig>): AppConfig {
  const sanitized: AppConfig = {};

  // ... existing fields ...

  // ── New feature ──
  const mf = config.myFeature;
  if (mf && typeof mf === 'object') {
    sanitized.myFeature = {
      enabled: typeof mf.enabled === 'boolean'
        ? mf.enabled
        : DEFAULT_MY_FEATURE_CONFIG.enabled,
      threshold: typeof mf.threshold === 'number' && Number.isFinite(mf.threshold)
        ? mf.threshold
        : DEFAULT_MY_FEATURE_CONFIG.threshold,
    };
  }

  return sanitized;
}
```

---

### Step 4 — Frontend / Backend Sync

#### Architecture

```
[Main Process]                        [Renderer Processes]

AppCacheManager                       AppDataManager instances
  ├─ cache: AppConfig  ──IPC push──►    ├─ cache: AppConfig
  ├─ updateConfig()    ◄──IPC call──    ├─ updateConfig()
  └─ getConfig()                        ├─ getConfig()
                                        ├─ subscribe(listener)
                                        └─ getRuntimeEnvironment()  // convenience
```

- **Main → Renderer push**: `AppCacheManager.updateConfig()` triggers a 150 ms debounced `app:configUpdated` IPC event to every live renderer window.
- **Renderer → Main call**: `AppDataManager.updateConfig()` invokes `app:updateAppConfig` IPC handler.

#### IPC channels (defined in `preload.ts`)

| Channel | Direction | Description |
|---------|-----------|-------------|
| `app:getAppConfig` | Renderer → Main (invoke) | Pull current config on init |
| `app:updateAppConfig` | Renderer → Main (invoke) | Write config updates |
| `app:configUpdated` | Main → Renderer (push) | Notify every live renderer window of any change |

#### Using AppDataManager in a React component

```tsx
import { appDataManager } from '../../lib/userData/appDataManager';
import type { AppConfig } from '../../lib/userData/types';

const MySettingsView: React.FC = () => {
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    // 1. Pull current value on mount
    appDataManager.initialize().then(() => {
      setConfig(appDataManager.getConfig());
    });

    // 2. Subscribe to future updates pushed by the main process
    const unsub = appDataManager.subscribe((cfg) => setConfig({ ...cfg }));
    return unsub; // unsubscribe on unmount
  }, []);

  const handleChange = async (enabled: boolean) => {
    await appDataManager.updateConfig({
      myFeature: { enabled, threshold: config?.myFeature?.threshold ?? 100 },
    });
  };

  return <Toggle checked={config?.myFeature?.enabled} onChange={handleChange} />;
};
```

**Important:** Never call `window.electronAPI.runtime.*` or any feature-specific IPC directly from a settings component to read config. Always read from `appDataManager` and write through it.

---

### Step 5 — Feature Manager Pattern

For complex features (like Runtime), create a dedicated manager class that encapsulates business logic and delegates all persistence to `AppCacheManager`:

```
[RuntimeManager]
  ├─ getRunTimeConfig()       → appCacheManager.getConfig().runtimeEnvironment
  ├─ setRuntimeMode(mode)     → appCacheManager.updateConfig({ runtimeEnvironment: { mode } })
  ├─ setPinnedPythonVersion() → appCacheManager.updateConfig({ runtimeEnvironment: { pinnedPythonVersion } })
  └─ (no local file I/O, no local config cache)
```

**Rules:**
- The feature manager holds **no local copy** of config data. `getRunTimeConfig()` always reads from `AppCacheManager.getConfig()` (in-memory, O(1)).
- All writes go through `appCacheManager.updateConfig()`, which handles sanitize + persist + live renderer notification in one call.
- The feature manager never writes directly to any file.

```typescript
// RuntimeManager example
public getRunTimeConfig(): RuntimeEnvironment {
  return appCacheManager.getConfig().runtimeEnvironment ?? { ...DEFAULT_RUNTIME_ENVIRONMENT };
}

public async setRuntimeMode(mode: RuntimeMode): Promise<void> {
  await appCacheManager.updateConfig({ runtimeEnvironment: { mode } });
}
```

---

### Full Checklist

When adding a new app-level config field:

- [ ] `resources/examples/app.json` — add the field with its default value
- [ ] `src/main/lib/userDataADO/types/app.ts` — add interface + default constant + type guard; add field to `AppConfig`
- [ ] `AppCacheManager.integrityEnsure()` — backfill missing field on read (+ migration if needed)
- [ ] `AppCacheManager.appConfigSanitize()` — validate and clean field on write
- [ ] `AppCacheManager.updateConfig()` — if the field is a nested object, ensure it receives deep-merge treatment
- [ ] `src/renderer/lib/userData/types/index.ts` — re-export new type if needed by renderer
- [ ] Feature Manager — delegate all reads to `appCacheManager.getConfig()`, all writes to `appCacheManager.updateConfig()`
- [ ] Settings UI — read from `appDataManager`, write via `appDataManager.updateConfig()`

---

## Profile-Level Config Development Guide

> **Profile-level config** is persisted in `{userData}/profiles/{alias}/profile.json` and is **isolated per user**. Use this pattern when a setting should be different for each user (e.g., agent configuration, voice input settings, per-profile feature toggles).
>
> For app-level config shared across all profiles, follow the `AppCacheManager` pattern instead.
>
> **Exception:** installed global MCP servers are profile-scoped but persisted in `{userData}/profiles/{alias}/mcp.json`, owned by `McpConfigManager`. Do not use `profile.json` / `ProfileV2.mcp_servers` as the runtime source of truth for installed global MCP server configs. The same split applies to the **global skill registry** (`skills.json`, owned by `SkillsConfigManager`) and the **global Agent Hook library** (`hooks.json`, owned by `HooksConfigManager` — but note the Hooks **master switch `hooksEnabled` still lives in `profile.json`**; only the hook *list* is split out).

### Reference Implementation

The examples below use a small `myFeature` profile field as the template. MCP is intentionally not used as the canonical profile-field example anymore because installed global MCP servers are split into `mcp.json`.

---

### Step 1 — Update Profile Defaults (Required)

**File:** `src/main/lib/userDataADO/types/profile.ts`

`DEFAULT_PROFILE_V2` is the source of truth for default durable `profile.json` values created by code. It must reflect every profile-owned field, including new ones you add, with the correct default values. Do not add installed global MCP servers here; they belong to `mcp.json`.

```json
{
  "version": "2.0.0",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "alias": "example_user",
  "freDone": false,
  "primaryAgent": "Kobi",
  "myFeature": {
    "enabled": false,
    "threshold": 100
  }
}
```

**Rules:**
- Every field that can appear in `profile.json` must exist here.
- Default values must match the corresponding `DEFAULT_*` constants in `types/profile.ts`.
- Never leave undefined/null in the default object — use `""` for optional strings, `false` for booleans, `[]` for arrays.
- All team members use this default object as a reference when they need to understand the full data shape.

---

### Step 2 — Add Type Definitions

**File:** `src/main/lib/userDataADO/types/profile.ts`

Follow the existing pattern used by `ScreenshotSettings`, `VoiceInputSettings`, etc.:

```typescript
// 1. Define the interface for the new config section
export interface MyFeatureConfig {
  enabled: boolean;
  threshold: number;
}

// 2. Define the default value constant
export const DEFAULT_MY_FEATURE_CONFIG: MyFeatureConfig = {
  enabled: false,
  threshold: 100,
};

// 3. Add the field to ProfileV2 (use optional `?`)
export interface ProfileV2 {
  version: string;
  // ... existing fields ...
  screenshotSettings?: ScreenshotSettings;  // existing
  myFeature?: MyFeatureConfig;              // ← add here
}

// 4. (Optional) Add a type guard for runtime validation
export function isMyFeatureConfig(obj: any): obj is MyFeatureConfig {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.enabled === 'boolean' &&
    typeof obj.threshold === 'number'
  );
}
```

**Key principle:** All feature config fields in `ProfileV2` are optional (`?`). `ensureV2ProfileIntegrity` and `sanitizeProfileV2` fill in missing fields at runtime; the type system must not assume they always exist.

---

### Step 3 — Config Integrity & Migration

**File:** `src/main/lib/userDataADO/profileCacheManager.ts`

There are two methods to modify. They have complementary roles:

| Method | When called | Role |
|--------|-------------|------|
| `ensureV2ProfileIntegrity()` | On every **read** from disk | One-time migration + backfill of new fields; has side effects (creates dirs, writes back to disk if changed) |
| `sanitizeProfileV2()` | On every **write** to disk | Schema normalizer; pure function, strips invalid types, ensures every persisted value conforms to the schema |

#### 3a. `ensureV2ProfileIntegrity` — called on every read

Add your new field inside `ensureV2ProfileIntegrity`. Follow the two-phase loop pattern documented in the method header comments:

```typescript
private async ensureV2ProfileIntegrity(alias: string, profile: ProfileV2): Promise<ProfileV2> {
  // ... existing code (deep copy, freDone, skills, screenshotSettings checks) ...

  // ── New feature: backfill missing myFeature ──
  if (!profileCopy.myFeature) {
    profileCopy.myFeature = { ...DEFAULT_MY_FEATURE_CONFIG };
    needsSave = true;
  } else {
    // Backfill any sub-fields added in newer versions
    let myFeatureNeedsUpdate = false;
    if (profileCopy.myFeature.enabled === undefined) {
      profileCopy.myFeature.enabled = DEFAULT_MY_FEATURE_CONFIG.enabled;
      myFeatureNeedsUpdate = true;
    }
    if (profileCopy.myFeature.threshold === undefined) {
      profileCopy.myFeature.threshold = DEFAULT_MY_FEATURE_CONFIG.threshold;
      myFeatureNeedsUpdate = true;
    }
    if (myFeatureNeedsUpdate) needsSave = true;
  }

  // ... rest of existing code ...
}
```

**MCP note:** V4 migration still needs to see a transient top-level `mcp_servers` value during load so it can clean legacy `memex-*` entries. `ProfileCacheManager.readProfileFromFile()` attaches that field temporarily from `McpConfigManager`, then strips it before caching/writing `profile.json`.

**Important rules from the method's own header:**
- Always deep-copy the input: `JSON.parse(JSON.stringify(profile))` — never mutate the `profile` argument.
- Do **not** call `notifyProfileDataManager` inside this method (cache is not updated yet).
- If `needsSave` is true at the end, the method writes the corrected data back to disk automatically.

#### 3b. `sanitizeProfileV2` — called on every write

Add corresponding sanitization in `sanitizeProfileV2` to ensure the field is never written in an invalid state:

```typescript
private sanitizeProfileV2(profile: ProfileV2): ProfileV2 {
  // ... existing sanitization (chats, skills, settings, etc.) ...

  const sanitizedProfile: ProfileV2 = {
    // ... existing fields ...

    // ── New feature ──
    myFeature: profile.myFeature
      ? {
          enabled: typeof profile.myFeature.enabled === 'boolean'
            ? profile.myFeature.enabled
            : DEFAULT_MY_FEATURE_CONFIG.enabled,
          threshold: typeof profile.myFeature.threshold === 'number' && Number.isFinite(profile.myFeature.threshold)
            ? profile.myFeature.threshold
            : DEFAULT_MY_FEATURE_CONFIG.threshold,
        }
      : undefined,
  };

  return sanitizedProfile;
}
```

---

### Step 4 — Frontend / Backend Sync

#### Architecture

```
[Main Process]                              [Renderer Process]

ProfileCacheManager                         ProfileDataManager
  ├─ cache: Map<alias, ProfileV2>             ├─ cache: ProfileCacheDataV2
  ├─ addMcpServerConfig()   ──IPC push──►     │   (profile, chats, skills, ...)
  ├─ updateMcpServerConfig()                  ├─ subscribe(listener)
  ├─ deleteMcpServerConfig()                  └─ getCache()
  └─ notifyProfileDataManager()
           │
           └─ IPC event: profile:cacheUpdated  ──►  profileDataManager.handleProfileCacheUpdate()
                                                            │
                                                            └─ notifyListeners() → React components
```

- **Main → Renderer push**: Any write to `ProfileCacheManager` (via `addMcpServerConfig`, `updateMcpServerConfig`, etc.) ends with a call to `notifyProfileDataManager(alias)`. This sends a `profile:cacheUpdated` IPC event carrying the full updated `ProfileV2` snapshot.
- **Renderer → Main call**: React components call `window.electronAPI.myFeature.updateConfig(...)` (feature-specific IPC) or a shared profile IPC handler. The main process handler calls the appropriate `ProfileCacheManager` write method, which in turn triggers the IPC push above.

#### IPC channels (defined in `preload.ts`)

| Channel | Direction | Description |
|---------|-----------|-------------|
| `profile:getProfile` | Renderer → Main (invoke) | Pull full profile on init |
| `profile:cacheUpdated` | Main → Renderer (push) | Full profile snapshot after any write |
| `myFeature:update` | Renderer → Main (invoke) | Feature-specific write (delegate to `ProfileCacheManager`) |

#### Using ProfileDataManager in a React component

```tsx
import { profileDataManager } from '../../lib/userData/profileDataManager';
import type { ProfileV2 } from '../../lib/userData/types';

const MySettingsView: React.FC = () => {
  const [profile, setProfile] = useState<ProfileV2 | null>(null);

  useEffect(() => {
    // 1. Read current cached value immediately (may be null before first sync)
    const cache = profileDataManager.getCache();
    if (cache.profile) setProfile(cache.profile as ProfileV2);

    // 2. Subscribe to future updates pushed by the main process
    const unsub = profileDataManager.subscribe((cache) => {
      if (cache.profile) setProfile({ ...(cache.profile as ProfileV2) });
    });
    return unsub;
  }, []);

  const handleEnableToggle = async (enabled: boolean) => {
    // Optimistic update
    setProfile(prev => prev ? { ...prev, myFeature: { ...prev.myFeature!, enabled } } : null);
    // Persist via IPC → main process → ProfileCacheManager
    await window.electronAPI.myFeature?.update({ enabled });
  };

  return (
    <Toggle
      checked={profile?.myFeature?.enabled ?? false}
      onChange={handleEnableToggle}
    />
  );
};
```

**Important:** Always read config from `profileDataManager.getCache()` and subscribe to updates. Never call `window.electronAPI.profile.getProfile()` directly inside a settings component — that bypasses the cache and creates unnecessary IPC calls.

---

### Step 5 — Feature Manager Pattern

For features with non-trivial business logic, create a dedicated manager class that encapsulates domain behavior and delegates persistence to the owner of the relevant file.

```
[MyFeatureManager]
  ├─ getSettings(alias)        → profileCacheManager.getProfile(alias).myFeature
  ├─ updateSettings(alias, ..) → profileCacheManager update helper / IPC handler
  │                              └─ sanitizeProfileV2 → write profile.json → notifyProfileDataManager
  └─ runtime state             → manager-owned memory or a separate runtime IPC event
```

**Rules:**
- The feature manager holds **no local copy** of persisted config data.
  Profile-owned fields are read from `ProfileCacheManager` / `ProfileDataManager`.
- Profile-owned writes go through the appropriate `ProfileCacheManager` write path, which handles sanitize + persist + frontend notification in one call.
- The feature manager **never writes directly** to `profile.json`.
- Runtime/transient state is not stored in `profile.json`. It lives in the feature manager's own in-memory structure and is pushed to the renderer via a separate IPC event when needed.

**MCP exception:**

```typescript
// Installed global MCP server persistence is owned by McpConfigManager, not profile.json.
// ProfileCacheManager only gates existing-profile CRUD and sends the unchanged
// profile:cacheUpdated wire payload with mcp_servers re-injected from the manager.

// Read runtime source of truth
public getAllMcpServerInfo(alias: string): McpServerConfig[] {
  return mcpConfigManager.getServers(alias);
}

// Write installed global MCP servers
public async addServer(alias: string, config: McpServerConfig): Promise<boolean> {
  return mcpConfigManager.addServer(alias, config);
}
```

For UI-facing profile notifications, `ProfileCacheManager` re-injects `mcp_servers: mcpConfigManager.getServers(alias)` into both `profile:cacheUpdated` and `profile:getProfile`. `ProfileV2.mcp_servers` is optional/deprecated and should only appear transiently during load/migration; do not read or write it at runtime.

---

### Full Checklist

When adding a new profile-level config field:

- [ ] `src/main/lib/userDataADO/types/profile.ts` — add interface + `DEFAULT_PROFILE_V2` default + optional type guard; add optional field to `ProfileV2`
- [ ] `ProfileCacheManager.ensureV2ProfileIntegrity()` — backfill missing field on read (+ migration if moving data from a legacy location); set `needsSave = true` if modified
- [ ] `ProfileCacheManager.sanitizeProfileV2()` — validate and clean field on write (strip invalid types, fall back to defaults)
- [ ] IPC handler in `main.ts` — add `ipcMain.handle('myFeature:update', ...)` that calls the feature manager or `profileCacheManager` write method
- [ ] `preload.ts` — expose the new IPC channel under `window.electronAPI.myFeature`
- [ ] `src/renderer/lib/userData/types/index.ts` — re-export new type if needed by renderer
- [ ] Feature Manager (if applicable) — delegate profile-owned reads/writes to `ProfileCacheManager`; never write `profile.json` directly
- [ ] Settings UI — read from `profileDataManager.getCache()` + `subscribe()`, write via `window.electronAPI.myFeature.update()`; never call `window.electronAPI.profile.getProfile()` directly in a settings component

When changing installed global MCP servers, use `McpConfigManager` / `mcp.json` instead of this generic profile-field checklist.

---

# ProfileOps - Profile Directory Scanner

ProfileOps is a module for scanning and managing user profile directories in the OpenKosmos application. It provides a complete API to scan, inspect, and monitor user profiles under the `appPath/profiles` directory.

## Features

- 🔍 **Scan Profile Directories**: Scan all user profile directories and return detailed information
- ✅ **Validate Profiles**: Check whether a profile directory contains a valid `profile.json` file
- 📊 **Statistics**: Provides counts of total, valid, and invalid profiles
- 🏷️ **Get Alias Lists**: Quickly retrieve all or only valid profile aliases
- 📁 **Directory Check**: Check whether a specific profile directory exists
- 📋 **Detailed Info**: Get detailed directory information for a specific profile
- 🔄 **Live Monitoring**: Supports monitoring profile directory changes

## Core Types

### ProfileDirectoryInfo
```typescript
interface ProfileDirectoryInfo {
  /** Profile alias/name */
  alias: string;
  /** Full path to the profile directory */
  path: string;
  /** Whether the directory contains a profile.json file */
  hasProfileJson: boolean;
  /** Directory creation time */
  createdAt: Date;
  /** Directory last-modified time */
  modifiedAt: Date;
}
```

### ProfileScanResult
```typescript
interface ProfileScanResult {
  /** Array of found profile directories */
  profiles: ProfileDirectoryInfo[];
  /** Total profile count */
  totalCount: number;
  /** Valid profile count (contains profile.json) */
  validProfiles: number;
  /** Invalid profile count (missing profile.json) */
  invalidProfiles: number;
  /** Scan timestamp */
  scannedAt: Date;
}
```

## API Usage

### 1. Scan All Profile Directories

```typescript
import { profileScanner } from './src/main/lib/profileOps';

// Get the full scan result
const scanResult = await profileScanner.scanProfileDirectories();

console.log(`Found ${scanResult.totalCount} profiles`);
console.log(`${scanResult.validProfiles} valid`);
console.log(`${scanResult.invalidProfiles} invalid`);

// Iterate over all profiles
scanResult.profiles.forEach(profile => {
  console.log(`${profile.alias}: ${profile.hasProfileJson ? '✅' : '❌'}`);
});
```

### 2. Get Profile Alias Lists

```typescript
// Get all profile aliases
const allAliases = await profileScanner.getProfileAliases();
console.log('All profiles:', allAliases);

// Get only valid profile aliases
const validAliases = await profileScanner.getValidProfileAliases();
console.log('Valid profiles:', validAliases);
```

### 3. Check a Specific Profile

```typescript
const alias = 'user123';

// Check whether the profile directory exists
const exists = await profileScanner.profileDirectoryExists(alias);
if (exists) {
  // Get detailed info
  const profileInfo = await profileScanner.getProfileDirectoryInfo(alias);
  if (profileInfo) {
    console.log(`Profile: ${profileInfo.alias}`);
    console.log(`Path: ${profileInfo.path}`);
    console.log(`Valid: ${profileInfo.hasProfileJson}`);
    console.log(`Created: ${profileInfo.createdAt}`);
  }
} else {
  console.log(`Profile ${alias} does not exist`);
}
```

### 4. Monitor Profile Changes

```typescript
let lastScanResult = null;

const checkForChanges = async () => {
  const currentScanResult = await profileScanner.scanProfileDirectories();

  if (lastScanResult) {
    const countChanged = currentScanResult.totalCount !== lastScanResult.totalCount;
    if (countChanged) {
      console.log('Profile change detected!');
      console.log(`Total: ${lastScanResult.totalCount} → ${currentScanResult.totalCount}`);
    }
  }

  lastScanResult = currentScanResult;
};

// Check every 10 seconds
setInterval(checkForChanges, 10000);
```

## File Structure

```
src/main/lib/profileOps/
├── index.ts                    # Module exports
├── profileScanner.ts           # Core scanner implementation
├── profileScanner.test.ts      # Jest unit tests
├── profileScanner.simple.test.ts # Simplified test file
├── test-runner.ts              # Standalone test runner
├── usage-example.ts            # Usage examples
└── README.md                   # This document
```

## Tests

### Run Unit Tests

```bash
# Run tests with Jest
npm test src/main/lib/profileOps/profileScanner.test.ts

# Run simplified standalone tests
npx ts-node src/main/lib/profileOps/test-runner.ts
```

### Run Usage Examples

```bash
# Run all usage examples
npx ts-node src/main/lib/profileOps/usage-example.ts
```

## Implementation Details

### Profile Directory Structure

ProfileScanner scans the following directory structure:

```
{appPath}/profiles/
├── user1/
│   ├── profile.json     # Valid profile
│   └── ... other files
├── user2/               # Invalid profile (missing profile.json)
│   └── ... other files
└── user3/
    ├── profile.json     # Valid profile
    └── ... other files
```

### Error Handling

- If the profiles directory does not exist, an empty result is returned rather than an error
- Errors in individual profile directories do not affect the overall scan
- All errors are recorded in the log

### Performance Considerations

- Uses async I/O operations to avoid blocking
- Supports concurrent processing of multiple profile directories
- Results are sorted by creation time (newest first)

## Integration with the Existing System

The ProfileOps module is designed to work alongside the existing [`ProfileManager`](../profileManager.ts) system:

- ProfileScanner is responsible for discovering and scanning profile directories
- ProfileManager is responsible for reading, writing, and managing specific profile data
- Both share the same directory structure conventions

## Logging

ProfileScanner uses the project's unified logging system to record operation information:

- Scan start and completion
- Number of profiles discovered
- Errors and warnings
- Debug information

## Example Output

```
🔍 Scanning profile directories...

📊 Scan Summary:
  Total profiles: 3
  Valid profiles: 2
  Invalid profiles: 1
  Scanned at: 2023-12-07T10:30:45.123Z

📁 Profile Details:
  • user1
    Path: /Users/username/Library/Application Support/openkosmos-app/profiles/user1
    Has profile.json: ✅
    Created: 12/6/2023
    Modified: 12/7/2023

  • user2
    Path: /Users/username/Library/Application Support/openkosmos-app/profiles/user2
    Has profile.json: ❌
    Created: 12/5/2023
    Modified: 12/5/2023

  • user3
    Path: /Users/username/Library/Application Support/openkosmos-app/profiles/user3
    Has profile.json: ✅
    Created: 12/4/2023
    Modified: 12/6/2023
```

## Contributing

1. All new features should include corresponding tests
2. Follow existing code style and naming conventions
3. Update documentation to reflect API changes
4. Ensure backward compatibility
