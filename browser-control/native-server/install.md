# Chrome MCP Bridge Installation Guide

This document describes the installation and registration process for Chrome MCP Bridge in detail.

## Installation Flow Overview

```
npm install -g mcp-chrome-bridge
└─ postinstall.js
   ├─ Copy executable to npm_prefix/bin   ← Always writable (user or root permissions)
   ├─ Attempt user-level registration     ← No sudo required, succeeds in most cases
   └─ If failed ➜ Prompt user to run mcp-chrome-bridge register --system
      └─ Requires running manually with admin privileges
```

The flowchart above shows the complete process from global installation to final registration.

## Detailed Installation Steps

### 1. Global Installation

```bash
npm install -g mcp-chrome-bridge
```

After installation, the system automatically attempts to register the Native Messaging host in the user directory. This does not require administrator privileges and is the recommended installation method.

### 2. User-Level Registration

User-level registration creates manifest files at the following locations:

```
Manifest file locations
├─ User-level (no admin privileges required)
│  ├─ Windows: %APPDATA%\Google\Chrome\NativeMessagingHosts\
│  ├─ macOS:   ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/
│  └─ Linux:   ~/.config/google-chrome/NativeMessagingHosts/
│
└─ System-level (admin privileges required)
   ├─ Windows: %ProgramFiles%\Google\Chrome\NativeMessagingHosts\
   ├─ macOS:   /Library/Google/Chrome/NativeMessagingHosts/
   └─ Linux:   /etc/opt/chrome/native-messaging-hosts/
```

If automatic registration fails, or if you want to register manually, run:

```bash
mcp-chrome-bridge register
```

**Recommended: Run the diagnostic tool to check for issues:**

```bash
mcp-chrome-bridge doctor
```

### 3. System-Level Registration

If user-level registration fails (e.g., due to permission issues), you can try system-level registration. System-level registration requires admin privileges, but two convenient methods are provided.

#### Method 1: Using the `--system` flag (recommended)

```bash
# macOS/Linux
sudo mcp-chrome-bridge register --system

# Windows (run Command Prompt as administrator)
mcp-chrome-bridge register --system
```

System-level installation requires admin privileges to write to system directories and the registry.

#### Method 2: Run directly with admin privileges

**Windows**:
Run Command Prompt or PowerShell as administrator, then execute:

```
mcp-chrome-bridge register
```

**macOS/Linux**:
Use the sudo command:

```
sudo mcp-chrome-bridge register
```

## Registration Flow Details

### Registration Flowchart

```
Registration flow
├─ User-level registration (mcp-chrome-bridge register)
│  ├─ Get user-level manifest path
│  ├─ Create user directory
│  ├─ Generate manifest content
│  ├─ Write manifest file
│  └─ Windows: Create user-level registry key
│
└─ System-level registration (mcp-chrome-bridge register --system)
   ├─ Check for admin privileges
   │  ├─ Has privileges → Directly create system directory and write manifest
   │  └─ No privileges → Prompt user to run with admin privileges
   └─ Windows: Create system-level registry key
```

### Manifest File Structure

```
manifest.json
├─ name: "com.chromemcp.nativehost"
├─ description: "Node.js Host for Browser Bridge Extension"
├─ path: "/path/to/run_host.sh"       ← Startup script path
├─ type: "stdio"                      ← Communication type
└─ allowed_origins: [                 ← Allowed extension origins
   "chrome-extension://extensionId/"
]
```

### User-Level Registration Flow

1. Determine user-level manifest file path
2. Create necessary directories
3. Generate manifest content, including:
   - Host name
   - Description
   - Node.js executable path
   - Communication type (stdio)
   - Allowed extension IDs
   - Startup arguments
4. Write manifest file
5. On Windows, also create the corresponding registry key

### System-Level Registration Flow

1. Detect whether admin privileges are already held
2. If admin privileges are available:
   - Directly create system-level directory
   - Write manifest file
   - Set appropriate permissions
   - On Windows, create system-level registry key
3. If admin privileges are not available:
   - Prompt user to re-run the command with admin privileges
   - macOS/Linux: `sudo mcp-chrome-bridge register --system`
   - Windows: Run Command Prompt as administrator

## Verifying Installation

### Verification Flowchart

```
Verify installation
├─ Check manifest file
│  ├─ File exists → Check content is correct
│  └─ File missing → Reinstall
│
├─ Check Chrome extension
│  ├─ Extension installed → Check extension permissions
│  └─ Extension not installed → Install extension
│
└─ Test connection
   ├─ Connection successful → Installation complete
   └─ Connection failed → Check error logs → See troubleshooting
```

### Verification Steps

After installation, verify success using the following steps:

1. Check that the manifest file exists in the appropriate directory
   - User-level: Check for manifest file in user directory
   - System-level: Check for manifest file in system directory
   - Confirm manifest file content is correct

2. Install the corresponding Chrome extension
   - Ensure the extension is correctly installed
   - Ensure the extension has the `nativeMessaging` permission

3. Try connecting to the local service through the extension
   - Use the extension's test feature to attempt a connection
   - Check the Chrome extension logs for error messages

## Troubleshooting

### Troubleshooting Flowchart

```
Troubleshooting
├─ Permission issues
│  ├─ Check user permissions
│  │  ├─ Sufficient permissions → Check directory permissions
│  │  └─ Insufficient permissions → Try system-level installation
│  │
│  ├─ Execute permission issues (macOS/Linux)
│  │  ├─ "Permission denied" error
│  │  ├─ "Native host has exited" error
│  │  └─ Run mcp-chrome-bridge fix-permissions
│  │
│  └─ Try mcp-chrome-bridge register --system
│
├─ Path issues
│  ├─ Check Node.js installation (node -v)
│  └─ Check global NPM path (npm root -g)
│
├─ Registry issues (Windows)
│  ├─ Check registry access permissions
│  └─ Try creating registry key manually
│
└─ Other issues
   ├─ Check console error messages
   └─ Submit Issue to project repository
```

### Common Problem-Solving Steps

If you encounter issues during installation, try the following steps:

1. Ensure Node.js is correctly installed
   - Run `node -v` and `npm -v` to check versions
   - Ensure Node.js version >= 20.x

2. Check that you have sufficient permissions to create files and directories
   - User-level installation requires write access to the user directory
   - System-level installation requires admin/root privileges

3. **Fix execute permission issues**

   **macOS/Linux platforms**:

   **Problem description**:
   - npm install usually preserves file permissions, but pnpm may not
   - You may encounter "Permission denied" or "Native host has exited" errors
   - Chrome extension cannot launch the native host process

   **Solutions**:

   a) **Use the built-in fix command (recommended)**:

   ```bash
   mcp-chrome-bridge fix-permissions
   ```

   b) **Run the diagnostic tool with auto-fix**:

   ```bash
   mcp-chrome-bridge doctor --fix
   ```

   c) **Set permissions manually**:

   ```bash
   # Find the installation path
   npm list -g mcp-chrome-bridge
   # Or for pnpm
   pnpm list -g mcp-chrome-bridge

   # Set execute permissions (replace with actual path)
   chmod +x /path/to/node_modules/mcp-chrome-bridge/run_host.sh
   chmod +x /path/to/node_modules/mcp-chrome-bridge/index.js
   chmod +x /path/to/node_modules/mcp-chrome-bridge/cli.js
   ```

   **Windows platform**:

   **Problem description**:
   - `.bat` files on Windows do not usually require execute permissions, but other issues may arise
   - Files may be marked as read-only
   - You may encounter "Access denied" or file-cannot-be-executed errors

   **Solutions**:

   a) **Use the built-in fix command (recommended)**:

   ```cmd
   mcp-chrome-bridge fix-permissions
   ```

   b) **Run the diagnostic tool with auto-fix**:

   ```cmd
   mcp-chrome-bridge doctor --fix
   ```

   c) **Check file attributes manually**:

   ```cmd
   # Find the installation path
   npm list -g mcp-chrome-bridge

   # Check file attributes (right-click in File Explorer -> Properties)
   # Ensure run_host.bat is not a read-only file
   ```

   d) **Reinstall and force permissions**:

   ```bash
   # Uninstall
   npm uninstall -g mcp-chrome-bridge
   # Or pnpm uninstall -g mcp-chrome-bridge

   # Reinstall
   npm install -g mcp-chrome-bridge
   # Or pnpm install -g mcp-chrome-bridge

   # If issues persist, run the permission fix
   mcp-chrome-bridge fix-permissions
   ```

4. On Windows, ensure registry access is not restricted
   - Check access to `HKCU\Software\Google\Chrome\NativeMessagingHosts\`
   - For system-level, check `HKLM\Software\Google\Chrome\NativeMessagingHosts\`

5. Try system-level installation
   - Use the `mcp-chrome-bridge register --system` command
   - Or run directly with admin privileges

6. Check the error messages in the console output
   - Detailed error messages usually point to the root cause
   - Add the `--verbose` flag for more log output

If the issue persists, submit an issue to the project repository and include the following information:

- Operating system version
- Node.js version
- Installation command
- Error message
- Solutions already attempted
