# OpenKosmos

**OpenKosmos** is an advanced AI-powered desktop application built with Electron, React, and TypeScript. It provides a unified interface for interacting with multiple AI models, managing chat sessions, and integrating with Model Context Protocol (MCP) servers to extend AI capabilities with custom tools and contextual information.

## Features

### 🤖 Multi-Model AI Integration
- **GitHub Copilot Integration**: Seamless authentication and access to GitHub Copilot models
- **Multiple AI Providers**: Support for OpenAI, Azure OpenAI, Google Gemini, Claude Sonnect
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

### 🧠 Memory System
- **Long-Term Memory**: Store and retrieve contextual information across sessions using mem0
- **Vector Search**: Semantic search through conversation history and stored memories
- **Automatic Embeddings**: Generate embeddings for efficient memory retrieval
- **User-Specific Memory**: Isolated memory storage per user profile

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

Before running OpenKosmos, ensure you have the following installed:

- **Node.js** 18.0.0 or later
- **Python** 3.10 or later (for MCP server support)
- **VS Code** (recommended for development)
- **GitHub Copilot** subscription and authentication in VS Code

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/ai-microsoft/openKosmos.git
   cd openKosmos
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

   OpenKosmos uses native Node.js addons that need to be rebuilt for your Electron version:
   ```bash
   npx electron-rebuild
   ```

   This step is necessary for:
   - `@kutalia/whisper-node-addon` - Offline speech-to-text with Whisper
   - `sqlite-vec` - Vector database for memory system
   - `@vscode/ripgrep` - Fast file search

   > **Note**: If you encounter build errors, ensure you have the necessary build tools:
   > - **Windows**: Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++"
   > - **macOS**: Install Xcode Command Line Tools (`xcode-select --install`)
   > - **Linux**: Install build-essential (`sudo apt install build-essential`)
### Quick Start 

#### with Hot Reload (Recommended)
OpenKosmos features a modern development environment with hot module replacement (HMR) for rapid iteration:

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

OpenKosmos is built on a modern Electron architecture:

- **Main Process**: Handles system operations, file I/O, authentication, and MCP server management
- **Renderer Process**: React-based UI with TypeScript for type safety
- **IPC Communication**: Secure communication between main and renderer processes
- **ProfileCacheManager**: Centralized data management for user profiles and chat configurations
- **AuthManager**: Unified authentication and token management system
- **MCP Runtime**: Dynamic loading and management of MCP servers

## Development

### Contributing

We welcome contributions! Please open an issue or submit a pull request on [GitHub](https://github.com/ai-microsoft/openKosmos).

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

### Project Structure

```
OpenKosmos/
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

OpenKosmos uses a feature flag system to control experimental and in-development features. This ensures new features can be safely developed and tested without affecting production users.

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
  name: 'kosmosFeatureScreenshot',
  description: 'Screenshot capture functionality',
  defaultValue: true,           // Always enabled (in dev environment)
  devOnly: true,
}

// Dynamic value: function that receives context
{
  name: 'kosmosFeatureMemory',
  description: 'Enable memory system features',
  defaultValue: (ctx) => ctx.arch !== 'arm64' || ctx.platform !== 'win32',
  devOnly: true,
}
```

**Available context properties for dynamic values:**

Context properties are defined in `src/main/lib/featureFlags/types.ts` (`FeatureFlagContext` interface) and can be extended as needed. Current properties include:

| Property | Type | Description |
|----------|------|-------------|
| `ctx.isDev` | boolean | Whether running in development mode |
| `ctx.brandName` | string | Current brand name (e.g., `'openkosmos'`) |
| `ctx.platform` | string | OS platform (`'win32'`, `'darwin'`, `'linux'`) |
| `ctx.arch` | string | CPU architecture (`'x64'`, `'arm64'`) |

### Adding a New Feature Flag

1. **Add the flag name** to `src/main/lib/featureFlags/types.ts`:
   ```typescript
   export type FeatureFlagName = 
     | 'kosmosFeatureMyNewFeature'
     // ... other flags
   ```

2. **Add the configuration** to `src/main/lib/featureFlags/featureFlagDefinitions.ts`:
   ```typescript
   {
     name: 'kosmosFeatureMyNewFeature',
     description: 'Description of my new feature',
     defaultValue: true,  // or (ctx) => ctx.someCondition
     devOnly: true,       // Set to true for experimental features
   }
   ```

### Usage

#### In Main Process
```typescript
import { featureFlagManager } from './lib/featureFlags';

if (featureFlagManager.isEnabled('kosmosFeatureMyNewFeature')) {
  // Feature-specific code
}
```

#### In Renderer Process
```typescript
import { useFeatureFlag } from '../lib/featureFlags';

function MyComponent() {
  const isFeatureEnabled = useFeatureFlag('kosmosFeatureMyNewFeature');
  
  if (!isFeatureEnabled) return null;
  
  return <div>New Feature UI</div>;
}
```

### Best Practices

1. **New/Experimental features**: Always set `devOnly: true` until the feature is stable and ready for production
2. **Separation of concerns**: Use `devOnly` for environment control, `defaultValue` for business logic
3. **Naming convention**: Use prefix `kosmosFeature` followed by the feature name in PascalCase
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

## License

This project is licensed under the [MIT License](LICENSE).

## Contact

For questions, bug reports, or feature requests, please open an issue on [GitHub](https://github.com/ai-microsoft/openKosmos/issues).

