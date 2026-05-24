# Kosmos Project Layered Architecture Diagram

> **Version**: 1.0  
> **Last Updated**: 2026-01-26  
> **Author**: GitHub Copilot

## Overview

Kosmos is an AI assistant desktop application built on Electron, React, and TypeScript. It integrates GitHub Copilot, Model Context Protocol (MCP), local data persistence, and a modular skills system.

---

## Overall Architecture Layered Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              UI Layer                                           │
│                           src/renderer/components/                              │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐  │
│  │  auth/  │ │  chat/  │ │  mcp/   │ │ skills/ │ │  settings/  │  │
│  │ Auth UI │ │ Chat UI │ │  MCP UI │ │ Skill UI│ │ Settings UI │  │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └──────┬──────┘  │
│       │          │          │          │          │             │            │
│  ┌────┴──────────┴──────────┴──────────┴──────────┴─────────────┴────┐       │
│  │                     Common UI Components (ui/)                     │       │
│  │         Button, Card, Dialog, Toast, Badge, Navigation...         │       │
│  └──────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ IPC Communication
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        Renderer Process State Management Layer                  │
│                              src/renderer/lib/                                  │
│  ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐            │
│  │   AuthProvider    │ │ ProfileDataProvider│ │   ChatOps Manager │            │
│  │   Auth State Mgmt │ │   User Data Mgmt  │ │   Chat Ops Mgmt   │            │
│  └─────────┬─────────┘ └─────────┬─────────┘ └─────────┬─────────┘            │
│            │                    │                    │                        │
│  ┌─────────┴────────────────────┴────────────────────┴─────────┐              │
│  │                     Cache Managers                           │              │
│  │  ┌────────────────────┐  ┌────────────────────────────────┐ │              │
│  │  │agentChatSession    │  │ mcpClientCacheManager          │ │              │
│  │  │CacheManager        │  │ MCP Client State Cache         │ │              │
│  │  │Chat Session Cache  │  │                                │ │              │
│  │  └────────────────────┘  └────────────────────────────────┘ │              │
│  └─────────────────────────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                            ┌───────────┴───────────┐
                            │     preload.ts        │
                            │   Electron IPC Bridge │
                            │   (contextBridge)     │
                            └───────────┬───────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          Main Process Core Layer                                │
│                                 src/main/lib/                                   │
│ ┌─────────────────────────────────────────────────────────────────────────────┐│
│ │                           Managers Layer                                    ││
│ │  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐               ││
│ │  │ MainAuthManager │ │AgentChatManager │ │MCPClientManager │               ││
│ │  │   Auth Mgmt     │ │ Chat Instance   │ │  MCP Client     │               ││
│ │  │                 │ │ Mgmt            │ │  Mgmt           │               ││
│ │  └────────┬────────┘ └────────┬────────┘ └────────┬────────┘               ││
│ │           │                   │                   │                         ││
│ │  ┌────────┴───────────────────┴───────────────────┴────────┐               ││
│ │  │                  ProfileCacheManager                     │               ││
│ │  │                  User Config Cache Mgmt                  │               ││
│ │  └──────────────────────────────────────────────────────────┘               ││
│ └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                 │
│ ┌─────────────────────────────────────────────────────────────────────────────┐│
│ │                           Business Logic Layer                              ││
│ │  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐   ││
│ │  │   AgentChat   │ │  SkillManager │ │  Workspace    │   ││
│ │  │   Chat        │ │   Skill Mgmt  │ │   Service     │   ││
│ │  │   Processing  │ │   Skill Import│ │  File Index   │   ││
│ │  │   Tool Calls  │ │               │ │  & Search     │   ││
│ │  └───────────────┘ └───────────────┘ └───────────────┘   ││
│ └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                 │
│ ┌─────────────────────────────────────────────────────────────────────────────┐│
│ │                             AI/LLM Integration Layer                        ││
│ │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐                  ││
│ │  │  GhcModelApi   │ │ AzureOpenAI    │ │ TextLlm        │                  ││
│ │  │ GitHub Copilot │ │   ModelApi     │ │   Embedder     │                  ││
│ │  │    API         │ │                │ │ Embedding Svc  │                  ││
│ │  └────────────────┘ └────────────────┘ └────────────────┘                  ││
│ └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                 │
│ ┌─────────────────────────────────────────────────────────────────────────────┐│
│ │                            MCP Runtime Layer                                ││
│ │  ┌───────────────────────────────────────────────────────────────────────┐ ││
│ │  │                       mcpRuntime/                                      │ ││
│ │  │  ┌───────────────┐ ┌───────────────┐ ┌───────────────────────────┐   │ ││
│ │  │  │ VscMcpClient  │ │BuiltinMcp    │ │    builtinTools/          │   │ ││
│ │  │  │ VSCode MCP    │ │Client        │ │ Built-in Tool Set         │   │ ││
│ │  │  │ Client Impl   │ │Builtin MCP   │ │ • File ops (read/write)   │   │ ││
│ │  │  │               │ │Client        │ │ • Web search (Bing/Google) │   │ ││
│ │  │  └───────────────┘ └───────────────┘ │ • Web fetch (fetch/read)  │   │ ││
│ │  │                                       │ • Agent management        │   │ ││
│ │  │                                       │ • MCP config management   │   │ ││
│ │  │                                       │ • Skill management        │   │ ││
│ │  │                                       └───────────────────────────┘   │ ││
│ │  └───────────────────────────────────────────────────────────────────────┘ ││
│ └─────────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Infrastructure Layer                               │
│ ┌─────────────────────────────────────────────────────────────────────────────┐│
│ │                         Data Persistence (userDataADO/)                     ││
│ │  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────────┐   ││
│ │  │ChatSession      │ │ ChatSession     │ │     pathUtils               │   ││
│ │  │Manager          │ │ FileOps         │ │   Path Utilities            │   ││
│ │  │Session Mgmt     │ │ File Operations │ │                             │   ││
│ │  └─────────────────┘ └─────────────────┘ └─────────────────────────────┘   ││
│ └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                 │
│ ┌─────────────────────────────────────────────────────────────────────────────┐│
│ │                              Utilities / Security Layer                     ││
│ │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   ││
│ │  │ unifiedLogger│ │ analytics/  │ │ security/   │ │  cancellation/      │   ││
│ │  │ Unified Log │ │ Analytics   │ │ Security    │ │  Cancel Token Mgmt  │   ││
│ │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────┘   ││
│ │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   ││
│ │  │ token/      │ │ compression/│ │ autoUpdate/ │ │  utilities/         │   ││
│ │  │ Token Calc  │ │ Compression │ │ Auto Update │ │  General Utilities  │   ││
│ │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────┘   ││
│ └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                 │
│ ┌─────────────────────────────────────────────────────────────────────────────┐│
│ │                               Storage Layer                                 ││
│ │  ┌─────────────────────────────────────────────────────────────────────┐    ││
│ │  │                        JSON Files                                   │    ││
│ │  │              profile.json / auth.json                               │    ││
│ │  └─────────────────────────────────────────────────────────────────────┘    ││
│ └─────────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Layer Detailed Description

### 1. UI Layer

**Location**: `src/renderer/components/`

This layer is responsible for all user-visible interface elements, using the React functional components + Hooks pattern.

| Directory | Functional Description |
|------|----------|
| `auth/` | Login and auth UI (SignInPage, AuthProvider) |
| `chat/` | Chat UI (ChatView, MessageList, InputBox) |
| `mcp/` | MCP server management UI (McpView, AddNewMcpServerView) |
| `skills/` | Skill management UI (SkillsView) |
| `settings/` | App settings UI (RuntimeSettings, ToolbarSettings) |
| `ui/` | Atomic UI components (Button, Card, Dialog, Toast, etc.) |
| `pages/` | Page-level components (AgentPage, StartupPage, SettingsPage) |

**Tech stack**: React 18, Tailwind CSS, Radix UI

---

### 2. Renderer Process State Management Layer

**Location**: `src/renderer/lib/`

This layer manages frontend application state and handles IPC communication with the main process.

| Module | Responsibility |
|------|------|
| `AuthProvider` | Auth state management, listens to auth:authChanged events |
| `ProfileDataProvider` | User config data management, provides Context |
| `ChatOps` | Chat operations manager, encapsulates chat-related business logic |
| `agentChatSessionCacheManager` | Frontend chat session cache |
| `mcpClientCacheManager` | MCP client state cache |

---

### 3. IPC Bridge Layer

**Location**: `src/preload/main.ts`

Uses Electron's `contextBridge` to expose safe APIs to the renderer process.

```typescript
// Main exposed API categories:
- App info (version, name, isDev)
- Profile operations (getLLMApiSettings, getMCPServers, etc.)
- Chat operations (createChatSession, sendMessage, etc.)
- MCP operations (connectMcpServer, executeTool, etc.)
```

---

### 4. Main Process Core Layer

**Location**: `src/main/lib/`

This is the core business logic layer of the application, containing several key managers.

#### 4.1 Managers Layer

| Manager | File | Responsibility |
|--------|------|------|
| `MainAuthManager` | `auth/authManager.ts` | Auth session management, token refresh, profile directory management |
| `AgentChatManager` | `chat/agentChatManager.ts` | Manages AgentChat instances by ChatSessionId, session switching |
| `MCPClientManager` | `mcpRuntime/mcpClientManager.ts` | MCP client runtime management, tool mapping, connection state |
| `ProfileCacheManager` | `userDataADO/profileCacheManager.ts` | User config cache, persistence |

#### 4.2 Business Logic Layer

| Module | File | Function |
|------|------|------|
| `AgentChat` | `chat/agentChat.ts` | Core chat processing, tool calls, message formatting, streaming output |
| `SkillManager` | `skill/skillManager.ts` | Skill management, skill import |
| `Workspace Service` | `workspace/` | File indexing, search, filesystem watching |

---

### 5. AI/LLM Integration Layer

**Location**: `src/main/lib/llm/`

| Module | Function |
|------|------|
| `GhcModelApi` | GitHub Copilot API wrapper, supports GPT-4.1 and other models |
| `AzureOpenAIModelApi` | Azure OpenAI service integration |
| `TextLlmEmbedder` | Text embedding service (text-embedding-3-small) |
| `ChatSessionTitleLlmSummarizer` | Auto-generates chat session titles |
| `ghcModels.ts` | GitHub Copilot model configuration definitions |

---

### 6. MCP Runtime Layer

**Location**: `src/main/lib/mcpRuntime/`

Implements the client runtime for Model Context Protocol (MCP).

```
mcpRuntime/
├── mcpClientManager.ts      # MCP client manager (singleton)
├── vscMcpClient.ts          # VSCode-style MCP client implementation
├── builtinMcpClient.ts      # Built-in MCP client
└── builtinTools/            # Built-in tool set
    ├── readFileTool.ts
    ├── writeFileTool.ts
    ├── createFileTool.ts
    ├── searchFilesTool.ts
    ├── bingWebSearchTool.ts
    ├── googleWebSearchTool.ts
    ├── fetchWebContentTool.ts
    ├── getAllAgentsTool.ts
    ├── addAgentByConfigTool.ts
    ├── toggleMcpByNameTool.ts
    └── ... (30+ tools)
```

**Transport protocol support**: stdio, SSE, streamable HTTP

---

### 7. Infrastructure Layer

#### 7.1 Data Persistence (userDataADO/)

| Module | Function |
|------|------|
| `ChatSessionManager` | Chat session management, paginated loading |
| `ChatSessionFileOps` | Session file read/write operations |
| `pathUtils` | Path management utilities |

**Data storage location**: `{userData}/profiles/{alias}/`

#### 7.2 Utilities / Security Layer

| Module | Function |
|------|------|
| `unifiedLogger/` | Unified logging system, supports file and console output |
| `analytics/` | Usage analytics |
| `security/` | Security validation, tool call approval |
| `cancellation/` | Cancellation token management, supports streaming request cancellation |
| `token/` | Token calculation |
| `compression/` | Context compression |
| `autoUpdate/` | Application auto-update |

---

## Data Flow Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        User Interaction                          │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    React Components (Renderer)                   │
│              ChatView / McpView / SettingsPage                   │
└────────────────────────────┬─────────────────────────────────────┘
                             │ Context / State
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                  State Management Providers                      │
│          AuthProvider / ProfileDataProvider                      │
└────────────────────────────┬─────────────────────────────────────┘
                             │ IPC invoke/on
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Preload Bridge                               │
│                   window.electronAPI                             │
└────────────────────────────┬─────────────────────────────────────┘
                             │ ipcMain.handle
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Main Process                                 │
│                                                                  │
│  ┌────────────────┐    ┌────────────────┐                       │
│  │ AgentChat      │◄───│ AgentChat      │                       │
│  │ Manager        │    │ Instance       │                       │
│  └───────┬────────┘    └────────┬───────┘                       │
│          │                      │                                │
│          ▼                      ▼                                │
│  ┌────────────────┐    ┌────────────────┐ │
│  │ MCP Client     │◄──►│ GhcModelApi    │ │
│  │ Manager        │    │ LLM Calls      │ │
│  └────────┬───────┘    └────────────────┘ │
│           │                                           │         │
│           ▼                                           ▼         │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              ProfileCacheManager / ChatSessionManager       │ │
│  └────────────────────────┬───────────────────────────────────┘ │
└───────────────────────────┼─────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                        File System                               │
│    profile.json / auth.json / chatSessions/                     │
└──────────────────────────────────────────────────────────────────┘
```

---

## Core Module Relationship Diagram

```
                              ┌─────────────────┐
                              │   main.ts       │
                              │   App Entry     │
                              └────────┬────────┘
                                       │
           ┌───────────────────────────┼───────────────────────────┐
           │                           │                           │
           ▼                           ▼                           ▼
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│  MainAuthManager │       │ ProfileCache     │       │   UpdateManager  │
│  Auth Mgmt       │       │ Manager          │       │   Auto Update    │
│                  │       │ Config Cache     │       │                  │
└────────┬─────────┘       └────────┬─────────┘       └──────────────────┘
         │                          │
         │  ┌───────────────────────┘
         │  │
         ▼  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           AgentChatManager                               │
│                  Manages AgentChat Instance Lifecycle                    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                          AgentChat                                   ││
│  │                                                                      ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐││
│  │  │ Message     │  │ Tool        │  │ Streaming   │  │ Context     │││
│  │  │ Processing  │  │ Execution   │  │ Handler     │  │ Compression │││
│  │  └──────┬──────┘  └──────┬──────┘  └─────────────┘  └─────────────┘││
│  │         │                │                                          ││
│  │         ▼                ▼                                          ││
│  │  ┌─────────────────────────────────────────────────────────────────┐││
│  │  │                    MCPClientManager                              │││
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │││
│  │  │  │ VscMcpClient│  │BuiltinMcp  │  │ToolToServerMap          │ │││
│  │  │  │ External MCP│  │Client      │  │ Tool->Server Mapping     │ │││
│  │  │  └─────────────┘  └─────────────┘  └─────────────────────────┘ │││
│  │  └─────────────────────────────────────────────────────────────────┘││
│  └─────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        External Services / API                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐│
│  │ GitHub      │  │ Azure       │  │ External MCP│  │ Bing/Google     ││
│  │ Copilot API │  │ OpenAI      │  │ Servers     │  │ Search API      ││
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────┘│
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure Overview

```
src/
├── main/                           # Electron main process
│   ├── main.ts                     # App entry point
│   ├── preload.ts                  # IPC bridge
│   ├── bootstrap.ts                # Startup bootstrap
│   ├── types/                      # Type definitions
│   └── lib/                        # Core libraries
│       ├── auth/                   # Auth module
│       ├── chat/                   # Chat module
│       ├── llm/                    # LLM integration
│       ├── mcpRuntime/             # MCP runtime
│       ├── skill/                  # Skill management
│       ├── userDataADO/            # Data persistence
│       ├── workspace/              # Workspace service
│       ├── analytics/              # Analytics
│       ├── autoUpdate/             # Auto update
│       ├── security/               # Security validation
│       ├── unifiedLogger/          # Unified logging
│       ├── token/                  # Token calculation
│       ├── compression/            # Compression module
│       ├── cancellation/           # Cancellation tokens
│       └── utilities/              # Utility functions
│
├── renderer/                       # React renderer process
│   ├── App.tsx                     # App root component
│   ├── index.tsx                   # Entry file
│   ├── routes/                     # Route configuration
│   │   ├── AppRoutes.tsx
│   │   └── RequireAuth.tsx
│   ├── components/                 # UI components
│   │   ├── auth/                   # Auth components
│   │   ├── chat/                   # Chat components
│   │   ├── mcp/                    # MCP components
│   │   ├── skills/                 # Skill components
│   │   ├── settings/               # Settings components
│   │   ├── pages/                  # Page components
│   │   └── ui/                     # Common UI components
│   ├── lib/                        # Renderer process libraries
│   │   ├── auth/                   # Auth proxy
│   │   ├── chat/                   # Chat state management
│   │   ├── mcp/                    # MCP state management
│   │   └── userData/               # User data management
│   └── types/                      # Type definitions
│
└── shared/                         # Shared code
    └── constants/                  # Shared constants
        └── branding.ts             # Brand configuration
```

---

## Tech Stack Summary

| Layer | Technology |
|------|------|
| **UI Framework** | React 18, TypeScript |
| **Styling** | Tailwind CSS, Radix UI |
| **Routing** | React Router DOM (HashRouter) |
| **Desktop Framework** | Electron |
| **Build** | Webpack, Electron Builder |
| **AI/LLM** | Vercel AI SDK, OpenAI, GitHub Copilot, Google Generative AI |
| **MCP** | @modelcontextprotocol/sdk |
| **Database** | (none) |
| **Logging** | Custom unifiedLogger |
| **Testing** | Jest, Playwright |

---

## Design Principles

1. **Clear Layering**: UI layer, state management layer, business logic layer, and infrastructure layer have clearly defined responsibilities
2. **Process Isolation**: Main process and renderer process communicate strictly via IPC
3. **Singleton Pattern**: Core managers use singleton pattern to ensure global uniqueness
4. **Modularity**: MCP tools, skills, etc. use modular design for easy extensibility
5. **Local-first**: Data storage prefers local SQLite and JSON files
6. **Security**: Security validation via preload isolation and SecurityValidator

---

## Related Documentation

- [Router Migration Plan](router-migration-plan.md)
- [Cancellation Token Implementation](cancellation-token-implementation-checklist.md)
- [Unified Data Structure Refactoring](unified-data-structure-refactoring.md)
- [LLM Output Format Guide](llm-output-format-guide.md)
