# FRE (First Run Experience) Module

## Overview

FRE (First Run Experience) is the first-run experience module of the Kosmos application, responsible for guiding users through runtime environment configuration and Agent selection when they first use the application.

## Architecture Design

### Component Hierarchy

```
FreOverlay (Coordinator)
├── FreWelcomeView (Welcome View - Kosmos brand only)
└── FreSettingUpView (Setup View)
```

### File Structure

```
src/renderer/components/fre/
├── index.ts              # Module exports
├── FreOverlay.tsx        # Coordinator component (~126 lines)
├── FreWelcomeView.tsx    # Welcome View component (~510 lines)
├── FreSettingUpView.tsx  # Setup View component (~1146 lines)
└── README.md             # This document
```

## Component Details

### 1. FreOverlay (Coordinator)

**Responsibility:** Manages view switching and branding logic

**Core State:**
```typescript
type FreView = 'welcome' | 'setup';
type SetupFlowType = 'basic' | 'pm-agent' | 'design-agent';

const [currentView, setCurrentView] = useState<FreView>(...);
const [selectedAgent, setSelectedAgent] = useState<FrePromotedAgent | null>(null);
const [setupFlowType, setSetupFlowType] = useState<SetupFlowType>(...);
```

**Branding Logic:**
- **Kosmos brand**: Initially shows Welcome View → enters Setup View after user selection

**Props:**
```typescript
interface FreOverlayProps {
  onSkip: () => void;  // Callback for setup completion or skip
}
```

### 2. FreWelcomeView (Welcome View)

**Responsibility:** Display recommended Agents for user selection

**Data Source:**
- Agent library data (currently not available - CDN removed)
- Promoted agents shown when available

**Core Interface:**
```typescript
interface FrePromotedAgent {
  name: string;
  version: string;
  description: string;
  team?: string;
  requirements?: {
    mcp?: string[];
    skills?: string[];
  };
  configuration?: {
    emoji?: string;
    avatar?: string;
    model?: string;
    system_prompt?: string;
    // ...
  };
}

interface FreWelcomeViewProps {
  onSelectAgent: (agent: FrePromotedAgent) => void;
  onSkip: () => void;
  isWindows: boolean;
}
```

**UI Features:**
- Displays personalized user greeting (fetches username from profile)
- Agent card grid layout
- Mouse hover effects
- Skip button (bottom-right corner)

### 3. FreSettingUpView (Setup View)

**Responsibility:** Executes runtime environment installation

**Setup Flow Types:**

| Flow Type | Installation Steps |
|-----------|---------|
| `basic` | Bun → uv → Python |
| `pm-agent` | Bun → uv → Python → MCP Servers → Skills → PM Agent |
| `design-agent` | Bun → uv → Python → MCP Servers → Skills → Design Agent |

**Core State:**
```typescript
type SetupStep = 'bun' | 'uv' | 'python' | 'mcp-server' | 'skills' | 'agent' | 'done';

interface SetupStatus {
  step: SetupStep;
  message: string;
  progress: number;  // 0-100
  error?: string;
}
```

**Props:**
```typescript
interface FreSettingUpViewProps {
  setupFlowType: SetupFlowType;
  selectedAgent: FrePromotedAgent | null;
  onSkip: () => void;
  isWindows: boolean;
}
```

## Data Flow

### Kosmos Brand Complete Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FreOverlay                                   │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ currentView: 'welcome' | 'setup'                            │    │
│  │ selectedAgent: FrePromotedAgent | null                      │    │
│  │ setupFlowType: 'basic' | 'pm-agent' | 'design-agent'        │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│              ┌───────────────┴───────────────┐                      │
│              ▼                               ▼                       │
│  ┌──────────────────────┐      ┌──────────────────────┐            │
│  │   FreWelcomeView     │      │  FreSettingUpView    │            │
│  │                      │      │                      │            │
│  │ 1. Fetch agents from │      │ 1. Install Bun      │            │
│  │    CDN               │      │ 2. Install uv       │            │
│  │ 2. Display cards     │ ───► │ 3. Install Python   │            │
│  │ 3. User selects or   │      │ 4. Install MCP*     │            │
│  │    skips             │      │ 5. Install Skills*  │            │
│  └──────────────────────┘      │ 6. Install Agent*   │            │
│                                │ 7. Mark freDone     │            │
│                                └──────────────────────┘            │
└─────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
                              ┌──────────────────┐
                              │  onSkip()        │
                              │  → Agent Page    │
                              └──────────────────┘

* Only executed in agent flow (pm-agent/design-agent)
```

## API Calls

### Runtime Related

```typescript
// Check runtime status
window.electronAPI.runtime.checkStatus()

// Set runtime mode
window.electronAPI.runtime.setMode('internal')

// Install Bun/uv
window.electronAPI.runtime.install('bun', '1.3.6')
window.electronAPI.runtime.install('uv', '0.6.17')

// Python version management
window.electronAPI.runtime.listPythonVersionsFast()
window.electronAPI.runtime.installPythonVersion('3.10.12')
window.electronAPI.runtime.setPinnedPythonVersion('3.10.12')
```

### MCP/Skills/Agent Related

```typescript
// Get Agent configuration
window.electronAPI.builtinTools.execute('get_agent_config_from_lib', { agent_name: 'PM Agent' })

// Add MCP Server
window.electronAPI.mcpLibrary.fetchAndUpdate()
window.electronAPI.builtinTools.execute('add_mcp_by_config', { mcp_config: {...} })

// Add Skill
window.electronAPI.skillLibrary.getLibraryData()
window.electronAPI.builtinTools.execute('add_skill_from_lib_by_name', { skill_name: '...' })

// Add Agent
window.electronAPI.builtinTools.execute('add_agent_by_config', {...})

// Set primary Agent
window.electronAPI.profile.setPrimaryAgent(agentName)

// Switch to Agent chat
window.electronAPI.agentChat.startNewChatFor(chatId)
```

### Profile Related

```typescript
// Mark FRE as complete
window.electronAPI.profile.updateFreDone(userAlias, true)

// Get user information
profileDataManager.getProfile()
profileDataManager.getCurrentUserAlias()
```

## Style Guidelines

### Design System

- **Font**: Abhaya Libre (Georgia fallback)
- **Primary color**: #322D29 (dark brown text)
- **Background color**: #F8F4F1, #FFFBF8
- **Accent color**: #0ea5e9 (blue progress bar)
- **Border radius**: 8px (buttons), 26px-32px (cards)

### Windows Adaptation

```typescript
const WINDOWS_TITLE_BAR_HEIGHT = 40;

// Reserve space for title bar on Windows
style={{
  top: isWindows ? WINDOWS_TITLE_BAR_HEIGHT : 0,
}}
```

## Error Handling

### Setup Failure

- Display error message
- Provide "Retry Setup" button
- Provide "Skip Setup" button (only shown in error state)

### Agent Fetch Failure

- Welcome View displays error state
- User can click "Retry" to re-fetch
- Or select "Skip" to bypass Welcome View

## State Persistence

FRE completion status is stored in the user Profile:

```typescript
// Mark as complete
await window.electronAPI.profile.updateFreDone(userAlias, true);

// Check status (in Agent Page)
const profile = profileDataManager.getProfile();
const freDone = (profile as any).freDone;
```

## Extension Guide

### Adding a New Setup Flow Type

1. Add a new flow type in `FreSettingUpView.tsx`:
   ```typescript
   export type SetupFlowType = 'basic' | 'pm-agent' | 'design-agent' | 'new-agent';
   ```

2. Update the `getSetupSteps()` function to define the steps for the new flow

3. Add corresponding installation logic in `startSetup()`

4. Add Agent name matching rules in `handleSelectAgent()` of `FreOverlay.tsx`

### Adding a New Promoted Agent

1. Add Agent configuration in the CDN's `agent_lib.json`
2. Set `needs_fre_promotion: true`
3. Ensure all dependent MCP and Skills are listed in `requirements`

## Debugging

### Log Prefixes

- `[FRE]` - FreOverlay Coordinator logs
- `[FreWelcomeView]` - Welcome View logs
- `[FRE][SettingUp]` - Setting Up View logs

### Resetting FRE State

```typescript
// Execute in console to reset FRE
const userAlias = profileDataManager.getCurrentUserAlias();
await window.electronAPI.profile.updateFreDone(userAlias, false);
// Refresh the page to see FRE again
```

