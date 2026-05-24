# FRE (First Run Experience) Module

## Overview

FRE (First Run Experience) is the first-run experience module for the OpenKosmos app. It guides users through runtime environment configuration and Agent selection the first time they use the app.

## Architecture

### Component Hierarchy

```
FreOverlay (coordinator)
├── FreWelcomeView (welcome view - OpenKosmos brand only)
└── FreSettingUpView (setup view)
```

### File Structure

```
src/renderer/components/fre/
├── index.ts              # Module exports
├── FreOverlay.tsx        # Coordinator component (~126 lines)
├── FreWelcomeView.tsx    # Welcome view component (~510 lines)
├── FreSettingUpView.tsx  # Setup view component (~1146 lines)
└── README.md             # This document
```

## Component Details

### 1. FreOverlay (Coordinator)

**Responsibility:** Manages view switching and brand logic

**Core State:**
```typescript
type FreView = 'welcome' | 'setup';
type SetupFlowType = 'basic' | 'pm-agent' | 'design-agent';

const [currentView, setCurrentView] = useState<FreView>(...);
const [selectedAgent, setSelectedAgent] = useState<FrePromotedAgent | null>(null);
const [setupFlowType, setSetupFlowType] = useState<SetupFlowType>(...);
```

**Brand Logic:**
- **OpenKosmos brand**: Initially shows Welcome View → enters Setup View after user selection
- Other brands may skip Welcome View and go directly to Setup View

**Props:**
```typescript
interface FreOverlayProps {
  onSkip: () => void;  // Callback when setup is complete or skipped
}
```

### 2. FreWelcomeView (Welcome View)

**Responsibility:** Shows recommended Agents for user selection

**Data Source:**
- CDN URL: `https://cdn.kosmos-ai.com/[dev/]agent/agent_lib.json`
- Filter condition: `needs_fre_promotion: true`

**Core Interfaces:**
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
- Personalized user greeting (gets username from profile)
- Agent card grid layout
- Mouse hover effects
- Skip button (bottom right)

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

### OpenKosmos Brand Complete Flow

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

### Brand Flow (non-OpenKosmos)

```
FreOverlay
    │
    ▼ (skip Welcome View)
FreSettingUpView (setupFlowType: 'pm-agent')
    │
    ▼
onSkip() → Agent Page
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
// Get Agent config
window.electronAPI.builtinTools.execute('get_agent_template_from_library', { agent_name: 'PM Agent' })

// Add MCP Server
window.electronAPI.builtinTools.execute('create_mcp_server_from_config', { mcp_config: {...} })

// Add Skill
window.electronAPI.builtinTools.execute('install_skill_from_library', { skill_name: '...' })

// Add Agent
window.electronAPI.builtinTools.execute('create_agent_from_config', {...})

// Set primary Agent
window.electronAPI.profile.setPrimaryAgent(agentName)

// Switch to Agent chat
window.electronAPI.agentChat.startNewChatFor(chatId)
```

### Profile Related

```typescript
// Mark FRE as done
window.electronAPI.profile.updateFreDone(userAlias, true)

// Get user info
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

- Welcome View shows error state
- User can click "Retry" to re-fetch
- Or select "Skip" to skip Welcome View

## State Persistence

FRE completion state is stored in the user Profile:

```typescript
// Mark as done
await window.electronAPI.profile.updateFreDone(userAlias, true);

// Check state (in Agent Page)
const profile = profileDataManager.getProfile();
const freDone = (profile as any).freDone;
```

## Extension Guide

### Adding a New Setup Flow Type

1. Add new flow type in `FreSettingUpView.tsx`:
   ```typescript
   export type SetupFlowType = 'basic' | 'pm-agent' | 'design-agent' | 'new-agent';
   ```

2. Update `getSetupSteps()` function to define steps for the new flow

3. Add corresponding installation logic in `startSetup()`

4. Add Agent name matching rules in `handleSelectAgent()` in `FreOverlay.tsx`

### Adding a New Promoted Agent

1. Add Agent config to `agent_lib.json` on the CDN
2. Set `needs_fre_promotion: true`
3. Ensure all dependent MCP and Skills are listed in `requirements`

## Debugging

### Log Prefixes

- `[FRE]` - FreOverlay coordinator logs
- `[FreWelcomeView]` - Welcome view logs
- `[FRE][SettingUp]` - Setting Up view logs

### Reset FRE State

```typescript
// Execute in console to reset FRE
const userAlias = profileDataManager.getCurrentUserAlias();
await window.electronAPI.profile.updateFreDone(userAlias, false);
// Refresh page to see FRE again
```
