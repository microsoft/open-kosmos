# Kosmos Browser Control

Browser control suite for [Kosmos](https://github.com/anthropics/kosmos). Exposes Chrome browser capabilities to AI agents via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/), enabling browser automation, content analysis, and interaction — all within the user's existing browser session.

## Architecture

```
MCP Client (Kosmos)
        │
        ▼  Streamable HTTP / SSE / stdio
┌───────────────────┐
│   Native Server   │  Fastify on 127.0.0.1:12306
│   (MCP bridge)    │  Registers 27 MCP tools
└───────┬───────────┘
        │  Chrome Native Messaging (stdin/stdout)
        ▼
┌───────────────────┐
│ Chrome Extension  │  MV3 Service Worker
│ (chrome-mcp-server)│  Delegates to Chrome APIs / CDP
└───────────────────┘
```

The system has three packages in a pnpm monorepo:

| Package | Path | Description |
|---|---|---|
| **chrome-mcp-shared** | `shared/` | Shared constants, types, and MCP tool schemas |
| **chrome-mcp-server** | `chrome-extension/` | Chrome extension (WXT + Vue 3, Manifest V3) |
| **chromium-mcp-native-server** | `native-server/` | Node.js native messaging host + HTTP MCP server |

## Prerequisites

- Node.js >= 20
- pnpm
- Chrome, Chromium, or Edge

## Build

```bash
pnpm install
pnpm build        # builds shared → native-server + chrome-extension
```

### Chrome Extension

Build output is at `chrome-extension/.output/chrome-mv3/` (unpacked).

To pack as CRX with a stable extension ID:

1. Open `chrome://extensions/` → enable Developer mode
2. Click "Pack extension" → set root directory to `chrome-extension/.output/chrome-mv3`
3. Provide the same `.pem` file in `chrome-extension/.output/` to keep the extension ID consistent

The resulting `.crx` and `.pem` are written to `chrome-extension/.output/`.

### Native Server

The native server is compiled by `tsc` (no bundler), so it depends on `node_modules` at runtime — including `chrome-mcp-shared`.

To produce a standalone deployment directory and deploy it in one shot:

```powershell
# Configure these two paths before running
$repoRoot  = "C:\path\to\browser-control"             # ← repo root
$targetDir = "C:\path\to\native-server"                      # ← deploy target

$tempDir = "$env:TEMP\native-server-build"

# 1. Create temp directory with dist + package.json
Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item $tempDir -ItemType Directory -Force
Copy-Item "$repoRoot\native-server\dist" "$tempDir\dist" -Recurse
Copy-Item "$repoRoot\native-server\package.json" "$tempDir\package.json"

# 2. Install production dependencies (skip chrome-mcp-shared which npm can't resolve)
$pkg = Get-Content "$tempDir\package.json" | ConvertFrom-Json
$pkg.dependencies.PSObject.Properties.Remove('chrome-mcp-shared')
$pkg | ConvertTo-Json -Depth 10 | Set-Content "$tempDir\package.json"
Push-Location $tempDir
npm install --production --ignore-scripts
Pop-Location

# 3. Place chrome-mcp-shared manually from the workspace build
$sharedTarget = "$tempDir\node_modules\chrome-mcp-shared"
New-Item $sharedTarget -ItemType Directory -Force
Copy-Item "$repoRoot\shared\dist\*" $sharedTarget -Recurse
Copy-Item "$repoRoot\shared\package.json" $sharedTarget

# 4. Deploy to target (remove first to avoid nested copy)
Remove-Item $targetDir -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item $tempDir $targetDir -Recurse
```

The result is a self-contained `$targetDir` folder (`dist/` + `node_modules/` + `package.json`) ready for use.

## MCP Connection

Once the extension connects to the native host, the MCP server is available at:

```
http://127.0.0.1:12306/mcp
```

### Streamable HTTP (recommended)

```json
{
  "mcpServers": {
    "browser-control": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

### Stdio

For clients that only support stdio transport, use the `mcp-chrome-stdio` binary which proxies stdio ↔ HTTP:

```json
{
  "mcpServers": {
    "browser-control": {
      "command": "mcp-chrome-stdio"
    }
  }
}
```

The port can be overridden with environment variables `CHROME_MCP_PORT` or `MCP_HTTP_PORT`.

## Available Tools (27)

### Browser Management

| Tool | Description |
|---|---|
| `get_windows_and_tabs` | List all open windows and tabs |
| `chrome_navigate` | Navigate to URL, go back/forward |
| `chrome_switch_tab` | Switch to a specific tab |
| `chrome_close_tabs` | Close tabs by ID |

### Page Reading & Content

| Tool | Description |
|---|---|
| `chrome_read_page` | Get accessibility tree of visible elements |
| `chrome_get_web_content` | Extract page HTML or text content |
| `chrome_screenshot` | Capture screenshot (full page, element, or viewport) |
| `chrome_console` | Capture console output (snapshot or persistent buffer) |
| `chrome_javascript` | Execute JavaScript via CDP |

### Interaction

| Tool | Description |
|---|---|
| `chrome_computer` | Unified mouse/keyboard/scroll/screenshot control |
| `chrome_click_element` | Click element by selector, XPath, ref, or coordinates |
| `chrome_fill_or_select` | Fill form inputs or select options |
| `chrome_keyboard` | Simulate keyboard input and shortcuts |
| `chrome_request_element_selection` | Human-in-the-loop element picker |
| `chrome_upload_file` | Upload files to form inputs (path, URL, or base64) |
| `chrome_handle_dialog` | Handle alert/confirm/prompt dialogs |
| `chrome_handle_download` | Wait for and track downloads |

### Network

| Tool | Description |
|---|---|
| `chrome_network_capture` | Start/stop network request capture |
| `chrome_network_request` | Send HTTP requests with browser cookies |

### History & Bookmarks

| Tool | Description |
|---|---|
| `chrome_history` | Search browsing history with date filters |
| `chrome_bookmark_search` | Find bookmarks by keyword |
| `chrome_bookmark_add` | Add bookmark with folder support |
| `chrome_bookmark_delete` | Delete bookmark by ID |

### Performance & Recording

| Tool | Description |
|---|---|
| `performance_start_trace` | Start Chrome DevTools performance trace |
| `performance_stop_trace` | Stop trace and save results |
| `performance_analyze_insight` | Analyze trace data for performance insights |
| `chrome_gif_recorder` | Record tab activity as animated GIF |

## CLI Reference

The native server provides a CLI via `mcp-chrome-bridge`:

```
mcp-chrome-bridge register [options]     Register native messaging host
mcp-chrome-bridge fix-permissions        Fix file permissions
mcp-chrome-bridge update-port <port>     Update MCP server port
mcp-chrome-bridge doctor [options]       Diagnose installation issues
mcp-chrome-bridge report [options]       Export diagnostic report
```

## Project Structure

```
├── shared/                  # chrome-mcp-shared
│   └── src/
│       ├── constants.ts     # DEFAULT_SERVER_PORT, HOST_NAME
│       ├── types.ts         # NativeMessageType, NativeMessage, ElementPicker types
│       └── tools.ts         # TOOL_NAMES, TOOL_SCHEMAS (27 MCP tool definitions)
├── chrome-extension/        # chrome-mcp-server (WXT + Vue 3)
│   ├── entrypoints/
│   │   ├── background/      # Service worker, native host bridge, tool handlers
│   │   └── offscreen/       # Offscreen page for background work
│   ├── common/              # Shared constants, message types
│   ├── inject-scripts/      # Scripts injected into web pages
│   └── utils/
├── native-server/           # chromium-mcp-native-server
│   └── src/
│       ├── cli.ts           # CLI commands (register, doctor, report)
│       ├── server/          # Fastify HTTP server
│       ├── mcp/             # MCP server setup (StreamableHttp, SSE, stdio)
│       ├── native-messaging-host.ts  # Chrome native messaging bridge
│       ├── scripts/         # Host registration, browser detection
│       └── constant/        # Server-specific config (CORS, timeouts, etc.)
├── package.json             # Monorepo root
├── pnpm-workspace.yaml      # Workspace: chrome-extension, native-server, shared
└── eslint.config.js         # Shared ESLint config
```
