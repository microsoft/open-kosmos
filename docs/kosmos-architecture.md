# OpenKosmos Project Layered Architecture Diagram

> **Version**: 1.0  
> **Updated**: 2026-01-26  
> **Author**: GitHub Copilot

## Overview

Kosmos is an AI assistant desktop application built with Electron, React, and TypeScript. It integrates GitHub Copilot, Model Context Protocol (MCP), local data persistence, and modular skill and memory systems.

---

## Overall Layered Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                               UI Layer                                          │
│                           src/renderer/components/                              │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐  │
│  │  auth/  │ │  chat/  │ │  mcp/   │ │ memory/ │ │ skills/ │ │  settings/  │  │
│  │ Auth UI │ │ Chat UI │ │  MCP UI │ │Mem. UI  │ │Skill UI │ │ Settings UI │  │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └──────┬──────┘  │
│       │          │          │          │          │             │            │
│  ┌────┴──────────┴──────────┴──────────┴──────────┴─────────────┴────┐       │
│  │                        Common UI Components (ui/)                     │       │
│  │         Button, Card, Dialog, Toast, Badge, Navigation...         │       │
│  └──────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ IPC Communication
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Renderer State Layer (State Layer)                     │
│                              src/renderer/lib/                                  │
│  ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐            │
│  │   AuthProvider    │ │ ProfileDataProvider│ │   ChatOps Manager │            │
│  │   Auth State Mgmt │ │   User Data Mgmt   │ │   Chat Ops Mgmt   │            │
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
│                            Main Process Core                                    │
│                                 src/main/lib/                                   │
│ ┌─────────────────────────────────────────────────────────────────────────────┐│
│ │                           Managers Layer                                    ││
│ │  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐               ││
│ │  │ MainAuthManager │ │AgentChatManager │ │MCPClientManager │               ││
│ │  │   Auth Mgmt     │ │ Chat Inst. Mgmt │ │  MCP Client Mgmt│               ││
│ │  └────────┬────────┘ └────────┬────────┘ └────────┬────────┘               ││
│ │           │                   │                   │                         ││
│ │  ┌────────┴───────────────────┴───────────────────┴────────┐               ││
│ │  │                  ProfileCacheManager                     │               ││
│ │  │                    User Profile Cache Management         │               ││
│ │  └──────────────────────────────────────────────────────────┘               ││
│ └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                 │
│ ┌─────────────────────────────────────────────────────────────────────────────┐│
│ │                           Business Logic Layer                              ││
│ │  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐   ││
│ │  │   AgentChat   │ │  SkillManager │ │ KosmosMemory  │ │  Workspace    │   ││
│ │  │  Chat Handler │ │  Skill Mgmt   │ │  Manager      │ │   Service     │   ││
│ │  │  Tool Calling │ │  Skill Import │ │ Memory System │ │ File Idx/Srch │   ││
│ │  └───────────────┘ └───────────────┘ └───────────────┘ └───────────────┘   ││
│ └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                 │
│ ┌─────────────────────────────────────────────────────────────────────────────┐│
│ │                             AI/LLM Integration Layer                        ││
│ │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐                  ││
│ │  │  GhcModelApi   │ │ AzureOpenAI    │ │ TextLlm        │                  ││
│ │  │ GitHub Copilot │ │   ModelApi     │ │   Embedder     │                  ││
│ │  │    API         │ │                │ │ Embed. Service │                  ││
│ │  └────────────────┘ └────────────────┘ └────────────────┘                  ││
│ └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                 │
│ ┌─────────────────────────────────────────────────────────────────────────────┐│
│ │                            MCP Runtime Layer                                ││
│ │  ┌───────────────────────────────────────────────────────────────────────┐ ││
│ │  │                       mcpRuntime/                                      │ ││
│ │  │  ┌───────────────┐ ┌───────────────┐ ┌───────────────────────────┐   │ ││
│ │  │  │ VscMcpClient  │ │BuiltinMcp    │ │    builtinTools/          │   │ ││
│ │  │  │ VSCode MCP    │ │Client        │ │ Built-in Tool Suite       │   │ ││
│ │  │  │  Client Impl  │ │Built-in MCP  │ │ • File Ops (read/write)   │   │ ││
│ │  │  └───────────────┘ └───────────────┘ │ • Web Search (Bing/Google)│   │ ││
│ │  │                                       │ • Web Scraping (fetch)    │   │ ││
│ │  │                                       │ • Agent Management        │   │ ││
│ │  │                                       │ • MCP Config Mgmt         │   │ ││
│ │  │                                       │ • Skill Management        │   │ ││
│ │  │                                       └───────────────────────────┘   │ ││
│ │  └───────────────────────────────────────────────────────────────────────┘ ││
│ └─────────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Infrastructure Layer                                │
│ ┌─────────────────────────────────────────────────────────────────────────────┐│
│ │                            Data Persistence (userDataADO/)                 ││
│ │  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────────┐   ││
│ │  │ChatSession      │ │ ChatSession     │ │     pathUtils               │   ││
│ │  │Manager          │ │ FileOps         │ │   Path Utilities            │   ││
│ │  │Session Mgmt     │ │ File Operations │ │                             │   ││
│ │  └─────────────────┘ └─────────────────┘ └─────────────────────────────┘   ││
│ └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                 │
│ ┌─────────────────────────────────────────────────────────────────────────────┐│
│ │                              Memory System (mem0/)                          ││
│ │  ┌───────────────────────────────────────────────────────────────────────┐ ││
│ │  │  mem0-core/                          kosmos-adapters/                 │ ││
│ │  │  ┌─────────────┐ ┌─────────────┐    ┌─────────────────────────────┐  │ ││
│ │  │  │ memory/     │ │vector_stores│    │ BetterSqliteVectorStore     │  │ ││
│ │  │  │ Core Memory │ │Vector Store │    │ KosmosEmbedder              │  │ ││
│ │  │  │ embeddings/ │ │ llms/       │    │ KosmosLLM                   │  │ ││
│ │  │  │ Embed. API  │ │ LLM API     │    │ KosmosMemoryManager         │  │ ││
│ │  │  └─────────────┘ └─────────────┘    └─────────────────────────────┘  │ ││
│ │  └───────────────────────────────────────────────────────────────────────┘ ││
│ └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                 │
│ ┌─────────────────────────────────────────────────────────────────────────────┐│
│ │                              Tools / Security Layer                         ││
│ │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   ││
│ │  │ unifiedLogger│ │ analytics/  │ │ security/   │ │  cancellation/      │   ││
│ │  │ Unified Log  │ │ Analytics   │ │ Security    │ │  Cancel Token Mgmt  │   ││
│ │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────┘   ││
│ │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   ││
│ │  │ token/      │ │ compression/│ │ autoUpdate/ │ │  utilities/         │   ││
│ │  │ Token Calc  │ │ Compression │ │ Auto Update │ │  General Utils      │   ││
│ │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────┘   ││
│ └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                 │
│ ┌─────────────────────────────────────────────────────────────────────────────┐│
│ │                               Underlying Storage                             ││
│ │  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────────┐   ││
│ │  │ better-sqlite3  │ │   sqlite-vec    │ │      JSON Files             │   ││
│ │  │    Database      │ │ Vector Extension│ │   profile.json / auth.json  │   ││
│ │  └─────────────────┘ └─────────────────┘ └─────────────────────────────┘   ││
│ └─────────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Detailed Layer Description

### 1. UI Layer

**Location**: `src/renderer/components/`

This layer is responsible for all user-facing interface elements, using React functional components with Hooks.

| Directory | Description |
|-----------|-------------|
| `auth/` | Login and authentication UI (SignInPage, AuthProvider) |
| `chat/` | Chat UI (ChatView, MessageList, InputBox) |
| `mcp/` | MCP server management UI (McpView, AddNewMcpServerView) |
| `memory/` | Memory system visualization UI |
| `skills/` | Skill management UI (SkillsView) |
| `settings/` | Application settings UI (RuntimeSettings) |
| `ui/` | Atomic UI components (Button, Card, Dialog, Toast, etc.) |
| `pages/` | Page-level components (AgentPage, StartupPage, SettingsPage) |

**Tech Stack**: React 18, Tailwind CSS, Radix UI

---

### 2. Renderer State Management Layer (State Layer)

**Location**: `src/renderer/lib/`

This layer manages frontend application state and handles IPC communication with the main process.

| Module | Responsibility |
|--------|----------------|
| `AuthProvider` | Authentication state management, listens to auth:authChanged events |
| `ProfileDataProvider` | User profile data management, provides Context |
| `ChatOps` | Chat operations manager, encapsulates chat-related business logic |
| `agentChatSessionCacheManager` | Frontend chat session cache |
| `mcpClientCacheManager` | MCP client state cache |

---

### 3. IPC Bridge Layer

**Location**: `src/main/preload.ts`

Uses Electron's `contextBridge` to expose a secure API to the renderer process.

```typescript
// Main exposed API categories:
- App info (version, name, isDev)
- Profile operations (getLLMApiSettings, getMCPServers, etc.)
- Chat operations (createChatSession, sendMessage, etc.)
- MCP operations (connectMcpServer, executeTool, etc.)
- Memory operations (addMemory, searchMemory, etc.)
```

---

### 4. Main Process Core

**Location**: `src/main/lib/`

This is the core business logic layer of the application, containing multiple key managers.

#### 4.1 Managers Layer

| Manager | File | Responsibility |
|---------|------|----------------|
| `MainAuthManager` | `auth/authManager.ts` | Auth session management, token refresh, profile directory management |
| `AgentChatManager` | `chat/agentChatManager.ts` | Manages AgentChat instances by ChatSessionId, session switching |
| `MCPClientManager` | `mcpRuntime/mcpClientManager.ts` | MCP client runtime management, tool mapping, connection state |
| `ProfileCacheManager` | `userDataADO/profileCacheManager.ts` | User profile caching and persistence |

#### 4.2 Business Logic Layer

| Module | File | Function |
|--------|------|----------|
| `AgentChat` | `chat/agentChat.ts` | Core chat processing, tool calling, message formatting, streaming output |
| `SkillManager` | `skill/skillManager.ts` | Skill management and skill importing |
| `KosmosMemoryManager` | `mem0/kosmos-adapters/KosmosMemoryManager.ts` | Memory system singleton management |
| `Workspace Service` | `workspace/` | File indexing, search, and file system watching |

---

### 5. AI/LLM Integration Layer

**Location**: `src/main/lib/llm/`

| Module | Function |
|--------|----------|
| `GhcModelApi` | GitHub Copilot API wrapper, supports GPT-4.1 and other models |
| `AzureOpenAIModelApi` | Azure OpenAI service integration |
| `TextLlmEmbedder` | Text embedding service (text-embedding-3-small) |
| `ChatSessionTitleLlmSummarizer` | Auto-generates chat session titles |
| `ghcModels.ts` | GitHub Copilot model configuration definitions |

---

### 6. MCP Runtime Layer

**Location**: `src/main/lib/mcpRuntime/`

Implements the Model Context Protocol (MCP) client runtime.

```
mcpRuntime/
├── mcpClientManager.ts      # MCP client manager (singleton)
├── vscMcpClient.ts          # VSCode-style MCP client implementation
├── builtinMcpClient.ts      # Built-in MCP client
└── builtinTools/            # Built-in tool suite
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

**Supported transport protocols**: stdio, SSE, streamable HTTP

---

### 7. Infrastructure Layer

#### 7.1 Data Persistence (userDataADO/)

| Module | Function |
|--------|----------|
| `ChatSessionManager` | Chat session management, paginated loading |
| `ChatSessionFileOps` | Session file read/write operations |
| `pathUtils` | Path management utilities |

**Data storage location**: `{userData}/profiles/{alias}/`

#### 7.2 Memory System (mem0/)

A local memory management system based on mem0, fully integrated into the Kosmos project.

```
mem0/
├── mem0-core/               # mem0 core code
│   ├── memory/              # Core memory management
│   ├── vector_stores/       # Vector storage interface
│   ├── embeddings/          # Embedding interface
│   └── llms/                # LLM interface
└── kosmos-adapters/         # OpenKosmos adapter layer
    ├── BetterSqliteVectorStore.ts  # SQLite vector storage
    ├── KosmosEmbedder.ts           # Embedding adapter
    ├── KosmosLLM.ts                # LLM adapter
    └── KosmosMemoryManager.ts      # Memory manager singleton
```

**Storage**: better-sqlite3 + sqlite-vec

#### 7.3 Tools / Security Layer

| Module | Function |
|--------|----------|
| `unifiedLogger/` | Unified logging system, supports file and console output |
| `analytics/` | Usage analytics and statistics |
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
│                    React Components (Renderer)                    │
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
│  │ Manager        │    │ Chat Instance  │                       │
│  └───────┬────────┘    └────────┬───────┘                       │
│          │                      │                                │
│          ▼                      ▼                                │
│  ┌────────────────┐    ┌────────────────┐    ┌────────────────┐ │
│  │ MCP Client     │◄──►│ GhcModelApi    │◄──►│ Kosmos Memory  │ │
│  │ Manager        │    │ LLM Calls      │    │ Manager        │ │
│  └────────┬───────┘    └────────────────┘    └────────┬───────┘ │
│           │                                           │         │
│           ▼                                           ▼         │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              ProfileCacheManager / ChatSessionManager       │ │
│  └────────────────────────────┬───────────────────────────────┘ │
└───────────────────────────────┼─────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                        File System                               │
│    profile.json / auth.json / chatSessions/ / memory.db         │
└──────────────────────────────────────────────────────────────────┘
```

---

## Core Module Relationship Diagram

```
                              ┌─────────────────┐
                              │   main.ts       │
                              │   App Entry      │
                              └────────┬────────┘
                                       │
           ┌───────────────────────────┼───────────────────────────┐
           │                           │                           │
           ▼                           ▼                           ▼
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│  MainAuthManager │       │ ProfileCache     │       │   UpdateManager  │
│  Auth Management │       │ Manager          │       │   Auto Update    │
│                  │       │ Config Cache     │       │                  │
└────────┬─────────┘       └────────┬─────────┘       └──────────────────┘
         │                          │
         │  ┌───────────────────────┘
         │  │
         ▼  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           AgentChatManager                               │
│                    Manages AgentChat Instance Lifecycle                   │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                          AgentChat                                   ││
│  │                                                                      ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐││
│  │  │ Message     │  │ Tool        │  │ Streaming   │  │ Context     │││
│  │  │ Processing  │  │ Execution   │  │ Handler     │  │ Compression │││
│  │  │ Msg Handler │  │ Tool Exec   │  │ Stream Proc │  │ Ctx Compress│││
│  │  └──────┬──────┘  └──────┬──────┘  └─────────────┘  └─────────────┘││
│  │         │                │                                          ││
│  │         ▼                ▼                                          ││
│  │  ┌─────────────────────────────────────────────────────────────────┐││
│  │  │                    MCPClientManager                              │││
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │││
│  │  │  │ VscMcpClient│  │BuiltinMcp  │  │ToolToServerMap          │ │││
│  │  │  │ External MCP│  │Client      │  │ Tool->Server Mapping    │ │││
│  │  │  └─────────────┘  └─────────────┘  └─────────────────────────┘ │││
│  │  └─────────────────────────────────────────────────────────────────┘││
│  └─────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        External Services / APIs                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐│
│  │ GitHub      │  │ Azure       │  │ External    │  │ Bing/Google     ││
│  │ Copilot API │  │ OpenAI      │  │ MCP Servers │  │ Search API      ││
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────┘│
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure Overview

```
src/
├── main/                           # Electron main process
│   ├── main.ts                     # Application entry point
│   ├── preload.ts                  # IPC bridge
│   ├── bootstrap.ts                # Startup bootstrap
│   ├── types/                      # Type definitions
│   └── lib/                        # Core library
│       ├── auth/                   # Authentication module
│       ├── chat/                   # Chat module
│       ├── llm/                    # LLM integration
│       ├── mcpRuntime/             # MCP runtime
│       ├── mem0/                   # Memory system
│       ├── skill/                  # Skill management
│       ├── userDataADO/            # Data persistence
│       ├── workspace/              # Workspace service
│       ├── analytics/              # Analytics and statistics
│       ├── autoUpdate/             # Auto update
│       ├── security/               # Security validation
│       ├── unifiedLogger/          # Unified logging
│       ├── token/                  # Token calculation
│       ├── compression/            # Compression module
│       ├── cancellation/           # Cancellation token
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
│   │   ├── memory/                 # Memory components
│   │   ├── skills/                 # Skill components
│   │   ├── settings/               # Settings components
│   │   ├── pages/                  # Page components
│   │   └── ui/                     # Common UI components
│   ├── lib/                        # Renderer process library
│   │   ├── auth/                   # Auth proxy
│   │   ├── chat/                   # Chat state management
│   │   ├── mcp/                    # MCP state management
│   │   ├── memory/                 # Memory state management
│   │   └── userData/               # User data management
│   └── types/                      # Type definitions
│
└── shared/                         # Shared code
    └── constants/                  # Shared constants
        └── branding.ts             # Branding configuration
```

---

## Tech Stack Summary

| Layer | Technology |
|-------|------------|
| **UI Framework** | React 18, TypeScript |
| **Styling** | Tailwind CSS, Radix UI |
| **Routing** | React Router DOM (HashRouter) |
| **Desktop Framework** | Electron |
| **Build** | Webpack, Electron Builder |
| **AI/LLM** | Vercel AI SDK, OpenAI, GitHub Copilot, Google Generative AI |
| **MCP** | @modelcontextprotocol/sdk |
| **Database** | better-sqlite3, sqlite-vec |
| **Logging** | Custom unifiedLogger |
| **Testing** | Jest, Playwright |

---

## Design Principles

1. **Clear Layering**: UI layer, state management layer, business logic layer, and infrastructure layer have well-defined responsibilities
2. **Process Isolation**: Main process and renderer process communicate strictly through IPC
3. **Singleton Pattern**: Core managers use the singleton pattern to ensure global uniqueness
4. **Modularity**: MCP tools, skills, etc. use modular design for easy extensibility
5. **Local-First**: Data storage prioritizes local SQLite and JSON files
6. **Security**: Security is enforced through preload isolation and SecurityValidator validation

---

## Related Documentation

- [Router Migration Plan](router-migration-plan.md)
- [Cancellation Token Implementation](cancellation-token-implementation-checklist.md)
- [Unified Data Structure Refactoring](unified-data-structure-refactoring.md)
- [LLM Output Format Guide](llm-output-format-guide.md)
