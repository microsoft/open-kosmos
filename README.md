# OpenKosmos Studio

**OpenKosmos Studio** is an advanced AI-powered desktop application built with Electron, React, and TypeScript. It provides a unified interface for interacting with multiple AI models, managing chat sessions, and integrating with Model Context Protocol (MCP) servers to extend AI capabilities with custom tools and contextual information.

## Table of Contents

- [Features](#features)
- [Getting Started](#getting-started)
  - [Quick Start for OpenKosmos](#quick-start)
- [Architecture](#architecture)
- [Development](#development)
  - [Eval Mode (Headless)](#eval-mode-headless)
- [Feature Flags](#feature-flags)
- [Building for Production](#building-for-production)
- [Troubleshooting](#troubleshooting)

## Features

### 🤖 Multi-Model AI Integration
- **GitHub Copilot Integration**: Seamless authentication and access to GitHub Copilot models
- **Multiple AI Providers**: Support for OpenAI-compatible APIs, Google Gemini, Claude, Cohere, and Ollama
- **Model Flexibility**: Switch between different AI models within the same chat session
- **Streaming Responses**: Real-time streaming of AI responses for improved user experience

### 💬 Advanced Chat Management
- **Multi-Chat Sessions**: Create and manage multiple independent chat sessions
- **Agent-Based Conversations**: Configure custom AI agents with specific personalities, instructions, and tools
- **Session Persistence**: Automatic saving and restoration of chat history

### 🔧 MCP (Model Context Protocol) Support
- **MCP Server Integration**: Connect to external MCP servers to extend AI capabilities
- **Tool Execution**: Enable AI models to execute tools and access external data sources
- **VSCode MCP Import**: Import MCP server configurations directly from VSCode settings
- **Built-in Tools**: Pre-configured tools for common operations, like web-search, web-fetch, and file management

### 🗂️ Profile and Session Persistence
- **Local Profiles**: Store user-specific agents, MCP servers, skills, and app preferences
- **Chat History**: Save and restore conversations across app launches
- **Archived Agents**: Keep retired agents available without cluttering the active workspace
- **External Context**: Bring in contextual data through MCP servers and built-in tools

### 🔐 Authentication & Security
- **OAuth Device Flow**: Secure authentication with GitHub Copilot
- **Token Management**: Automatic token refresh and expiration handling
- **Multi-User Support**: Separate profiles for different authenticated users

### 🎨 Modern User Interface
- **Glass Morphism Design**: Modern, elegant UI with glass effects and smooth animations
- **Responsive Layout**: Adaptive interface that works on different screen sizes
- **Dark Mode**: Comfortable viewing experience with dark theme support
- **Customizable Agents**: Configure agent appearance with emojis and custom names

## Getting Started

### Prerequisites

Before running OpenKosmos Studio, ensure you have the following installed:

- **Node.js** 18.0.0 or later
- **Python** 3.10 or later (for MCP server support)
- **VS Code** (recommended for development)
- **GitHub Copilot** subscription and authentication in VS Code

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/microsoft/open-kosmos.git
   cd open-kosmos
   ```

2. **Configure environment variables**
   
   Copy the example environment file to create your local configuration:
   ```bash
   # Windows
   copy .env.example .env.local
   
   # macOS/Linux
   cp .env.example .env.local
   ```
   
   The `.env.local` file contains default settings that work out of the box. No modification needed.

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Rebuild native modules for Electron** (required for Whisper speech-to-text)

   OpenKosmos Studio uses native Node.js addons that need to be rebuilt for your Electron version:
   ```bash
   npx electron-rebuild
   ```

   This step is necessary for:
   - `@kutalia/whisper-node-addon` - Offline speech-to-text with Whisper
   - `@vscode/ripgrep` - Fast file search

   > **Note**: If you encounter build errors, ensure you have the necessary build tools:
   > - **Windows**: Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++"
   > - **macOS**: Install Xcode Command Line Tools (`xcode-select --install`)
   > - **Linux**: Install build-essential (`sudo apt install build-essential`)
### Quick Start 

#### with Hot Reload (Recommended)
OpenKosmos Studio features a modern development environment with hot module replacement (HMR) for rapid iteration:

```bash
# One-command development mode (recommended)
npm run dev:full

# Or start components separately
npm run dev          # Terminal 1: Start webpack-dev-server
npm run dev:main    # Terminal 2: Build main process in watch mode
npm run electron:dev # Terminal 3: Launch Electron
```
#### without Hot Reload
 ```bash
   npm run build
   npm run electron
```

## Architecture

OpenKosmos Studio is built on a modern Electron architecture:

- **Main Process**: Handles system operations, file I/O, authentication, and MCP server management
- **Renderer Process**: React-based UI with TypeScript for type safety
- **IPC Communication**: Secure communication between main and renderer processes
- **ProfileCacheManager**: Centralized data management for user profiles and chat configurations
- **AuthManager**: Unified authentication and token management system
- **MCP Runtime**: Dynamic loading and management of MCP servers

## Development

### Requesting Development Access

Public contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for
issue, pull request, testing, and security-reporting guidance.

### Development Workflow

1. **Choose your AI coding assistant**:
   - GitHub Copilot in VS Code
   - Claude Code with GitHub Copilot (see [CLAUDE.md](./CLAUDE.md) for detailed instructions)
   - RooCode with GitHub Copilot
   - ECline with GitHub Copilot
   - Or other AI-powered development tools

2. **Create a development branch**:
   ```bash
   git switch main
   git pull origin main
   git checkout -b user/<your-alias>/<branch-name>
   ```

3. **Make your changes** and test thoroughly

4. **Submit a Pull Request**:

   You can use the AI-assisted PR workflow:
   ```
   Use AI with .github/prompts/gitpush.prompt.md to automatically create and submit PR
   ```

### Development Commands

```bash
# Development
npm run dev          # Start webpack-dev-server with HMR
npm run dev:main     # Build main process in watch mode
npm run dev:full     # Start both dev server and electron (parallel)
npm run electron:dev # Launch Electron in development mode

# Building
npm run build        # Full build (main + renderer)
npm run build:main   # Build main process only
npm run build:renderer # Build renderer process only

# Testing & Quality
npm test             # Run Jest tests
npm run lint         # Check code style
npm run lint:fix     # Auto-fix linting issues

# Running
npm run electron     # Run after building
npm run start        # Build and run in production mode
```

### Eval Mode (Headless)

Eval Mode launches the app as a **headless HTTP server** — no windows, no tray, no auto-update. It initializes only the core backend (Auth, Profile, MCP, Chat) and exposes an HTTP API on `127.0.0.1:8100` for external evaluation systems (e.g. AgenticEval).

#### Prerequisites

1. You **must log in via the GUI at least once** before using eval mode. The headless server reads persisted auth sessions from disk and does not provide its own login flow. Without a valid session you will see:

```
[EvalMode] FATAL: No authenticated session found. Please run OpenKosmos normally first to log in.
```

2. The `EVAL_AUTH_TOKEN` environment variable **must be set**. This token is generated by [AgenticEval](https://github.com/JuntongLiu96/agentic-eval) and passed to OpenKosmos via the adapter config. All requests (except `/eval/health`) must include `Authorization: Bearer <token>`. You can set it in either of two ways:
   - **`.env.local` file** (recommended for local development): add `EVAL_AUTH_TOKEN=<your-token>` to the project root `.env.local`
   - **Command line**: prefix the launch command with `EVAL_AUTH_TOKEN=<your-token>`

#### Launch

```bash
# Production build + eval mode (EVAL_AUTH_TOKEN must be set in the environment)
EVAL_AUTH_TOKEN=<your-token> npm run eval

# Development build + eval mode
EVAL_AUTH_TOKEN=<your-token> npm run eval:dev

# Custom port (default is 8100)
EVAL_AUTH_TOKEN=<your-token> npm run build && electron . --eval-mode --eval-port=9000
```

> Eval mode bypasses the single-instance lock, so it can run alongside the GUI.

#### Startup Sequence

```
--eval-mode flag
  → isEvalMode = true
  → Skip single-instance lock (can coexist with the GUI)
  → onReady() enters startEvalMode(), skips all UI initialization
    1. Initialize ProfileCacheManager
    2. Load auth from disk, restore first valid session
    3. Initialize AgentChatManager
    4. Initialize MCPClientManager (tool execution)
    5. Start EvalHttpServer on 127.0.0.1:8100
```

#### HTTP Endpoints

| Method | Path           | Auth     | Purpose                                    |
|--------|----------------|----------|--------------------------------------------|
| `GET`  | `/eval/health` | None     | Health check — returns `{ "status": "ok" }` |
| `POST` | `/eval/run`    | Required | Full agent end-to-end loop                 |
| `POST` | `/eval/judge`  | Required | Raw LLM call (no agent loop)              |

#### Example Requests

```bash
# Health check (no auth needed)
curl http://127.0.0.1:8100/eval/health

# Run agent (requires auth)
curl -X POST http://127.0.0.1:8100/eval/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{"prompt": "Hello, tell me about yourself", "metadata": {}}'

# Raw LLM judge call (requires auth)
curl -X POST http://127.0.0.1:8100/eval/judge \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{"messages": [{"role": "user", "content": "What is 1+1?"}]}'
```

#### Notes
- This eval endpoint is for [agentic-eval](https://github.com/JuntongLiu96/agentic-eval) using.
- Default port is **8100** (configurable via `--eval-port=NNNN`).
- All logs are written to **stderr** (not stdout), keeping them separate from JSON responses.
- Maximum request body size is **1 MB**.

### Project Structure

```
OpenKosmos.app/
├── src/
│   ├── main/              # Electron main process
│   │   ├── lib/           # Core libraries
│   │   │   ├── auth/      # Authentication system
│   │   │   ├── llm/       # LLM integrations
│   │   │   ├── mcpRuntime/# MCP server management
│   │   │   └── userDataADO/# Data persistence
│   │   └── main.ts        # Main process entry
│   └── renderer/          # React application
│       ├── components/    # React components
│       ├── lib/           # Frontend libraries
│       └── styles/        # CSS styles
├── resources/             # Application resources
├── scripts/               # Build and utility scripts
└── docs/                  # Documentation

```

## Feature Flags

OpenKosmos Studio uses a feature flag system to control experimental and in-development features. This ensures new features can be safely developed and tested without affecting production users.

### Key Concepts

| Property | Purpose | Description |
|----------|---------|-------------|
| `devOnly` | **Environment restriction** | When `true`, the feature is **only available in development mode**. In production, the flag always returns `false` regardless of other settings. |
| `defaultValue` | **Business logic** | Controls feature availability based on business conditions (brand, platform, architecture, etc.). Can be a static boolean or a dynamic function. |

### Configuration

Feature flags are defined in `src/main/lib/featureFlags/featureFlagDefinitions.ts`:

```typescript
// Static value: simple boolean
{
  name: 'openkosmosFeatureScreenshot',
  description: 'Screenshot capture functionality',
  defaultValue: true,           // Always enabled (in dev environment)
  devOnly: true,
}

```

**Available context properties for dynamic values:**

Context properties are defined in `src/main/lib/featureFlags/types.ts` (`FeatureFlagContext` interface) and can be extended as needed. Current properties include:

| Property | Type | Description |
|----------|------|-------------|
| `ctx.isDev` | boolean | Whether running in development mode |
| `ctx.brandName` | string | Current brand name (`'openkosmos'`) |
| `ctx.platform` | string | OS platform (`'win32'`, `'darwin'`, `'linux'`) |
| `ctx.arch` | string | CPU architecture (`'x64'`, `'arm64'`) |

### Adding a New Feature Flag

1. **Add the flag name** to `src/main/lib/featureFlags/types.ts`:
   ```typescript
   export type FeatureFlagName = 
     | 'openkosmosFeatureMyNewFeature'
     // ... other flags
   ```

2. **Add the configuration** to `src/main/lib/featureFlags/featureFlagDefinitions.ts`:
   ```typescript
   {
     name: 'openkosmosFeatureMyNewFeature',
     description: 'Description of my new feature',
     defaultValue: true,  // or (ctx) => ctx.someCondition
     devOnly: true,       // Set to true for experimental features
   }
   ```

### Usage

#### In Main Process
```typescript
import { featureFlagManager } from './lib/featureFlags';

if (featureFlagManager.isEnabled('openkosmosFeatureMyNewFeature')) {
  // Feature-specific code
}
```

#### In Renderer Process
```typescript
import { useFeatureFlag } from '../lib/featureFlags';

function MyComponent() {
  const isFeatureEnabled = useFeatureFlag('openkosmosFeatureMyNewFeature');
  
  if (!isFeatureEnabled) return null;
  
  return <div>New Feature UI</div>;
}
```

### Best Practices

1. **New/Experimental features**: Always set `devOnly: true` until the feature is stable and ready for production
2. **Separation of concerns**: Use `devOnly` for environment control, `defaultValue` for business logic
3. **Naming convention**: Use prefix `openkosmosFeature` followed by the feature name in PascalCase
4. **CLI override**: Flags can be overridden via CLI args (dev mode only): `--feature-myNewFeature=true`

## Building for Production

### Local Build Testing (macOS)

Before pushing to CI/CD, test your build locally to catch issues early:

```bash
# Quick test build (skips notarization)
npm run test:build

# Test build with verification
npm run test:build:verify
```

For detailed local testing instructions and troubleshooting, see [docs/local-build-test.md](docs/local-build-test.md).

### Build for Current Platform
```bash
npm run dist
```

### Build for Specific Platforms
```bash
# Windows
npm run dist:win

# macOS
npm run dist:mac

# Linux
npm run dist:linux

# All platforms
npm run dist:all
```

## Troubleshooting

### Whisper Native Addon Issues
If you encounter errors related to loading the Whisper native addon (e.g., `Cannon find module .../whisper.node` or `Library not loaded: @rpath/libwhisper.1.dylib`), you can run the fix script manually:

```bash
node scripts/fix-whisper-addon.js
```

This script fixes the directory structure (copies `mac-arm64` to `darwin-arm64`) and patches the dynamic library paths (RPATH) for macOS. It runs automatically after `npm install` and during `npm run rebuild`.

## Team

### Core Team

| Name | Email |
|------|-------|
| Yang Huangfu | yanhu@microsoft.com |
| Dale Xiao | dingxiao@microsoft.com |
| Menghui Hu | menghuihu@microsoft.com |

### Contributors

| Name | Email |
|------|-------|
| Jiashuang Shang | jshang@microsoft.com |
| Jianli Wei | jianliwei@microsoft.com |
| Yun Ni | v-yunn@microsoft.com |
| Luna Chen | yueyingchen@microsoft.com |
| Jiajun Yan | jiajunyan@microsoft.com |
| Jiaming Mao | jiamingmao@microsoft.com |
| Juntong Liu | juntongliu@microsoft.com |

## License

This project is licensed under the [MIT License](./LICENSE). Third-party
attributions are recorded in [NOTICE](./NOTICE).

## Contact

For questions, issues, or development access requests, please contact:
- **Email**: yanhu@microsoft.com
- **Support**: See [SUPPORT.md](./SUPPORT.md)
