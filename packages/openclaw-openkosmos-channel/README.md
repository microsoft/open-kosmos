# @openclaw/openkosmos — Channel Plugin Setup Guide

Connect [OpenClaw](https://openclaw.dev) to OpenKosmos Desktop, so OpenClaw agents can receive messages from OpenKosmos users and reply through the OpenKosmos chat UI.

## How It Works

```
OpenKosmos User → OpenKosmos Desktop (WS Server :9527) → OpenClaw Plugin (WS Client) → OpenClaw Agent → Reply → OpenKosmos UI
```

- **OpenKosmos** runs a WebSocket server on port 9527
- **OpenClaw** connects as a WS client using this plugin
- Each OpenKosmos "External Agent" has its own auth token
- Messages are routed by `conversationId` so multiple chat sessions stay isolated

## Prerequisites

- OpenKosmos Desktop running with at least one **External Agent** created
- OpenClaw instance (self-hosted or cloud)
- Network connectivity between OpenClaw and OpenKosmos (same machine, LAN, or tunnel)

## Step 1: Create an External Agent in OpenKosmos

1. Open OpenKosmos Desktop
2. Click **"+ New Agent"** → select **"🐾 External Agent"**
3. Give it a name (e.g. "My OpenClaw Bot")
4. After creation, open the agent's **Settings** tab
5. Note the **Auth Token** and **WebSocket URL** (e.g. `ws://10.0.0.5:9527`)

## Step 2: Install the Plugin in OpenClaw

```bash
npm install @openclaw/openkosmos
```

## Step 3: Configure OpenClaw

Add to your OpenClaw `config.yaml`:

```yaml
plugins:
  entries:
    openkosmos:
      enabled: true
      config:
        url: "ws://YOUR_OpenKosmos_IP:9527"    # WebSocket URL from OpenKosmos UI
        accounts:
          <openclaw-agent-id>:               # Must match your OpenClaw agent id
            token: "YOUR_AUTH_TOKEN"        # Auth token from OpenKosmos agent settings
```

### Multiple Agents

If you have multiple External Agents in OpenKosmos, each with its own token:

```yaml
plugins:
  entries:
    openkosmos:
      enabled: true
      config:
        url: "ws://10.0.0.5:9527"
        accounts:
          leader-agent:
            token: "token-for-agent-alpha"
          dev-agent:
            token: "token-for-agent-beta"
```

Then configure agent routing in OpenClaw to map each account to an OpenClaw agent.

## Step 4: Start OpenClaw

```bash
openclaw start
```

You should see in the logs:

```
[OpenKosmosPlugin] Connecting to OpenKosmos at ws://10.0.0.5:9527 (account: default)
[OpenKosmosPlugin] Connected to OpenKosmos, sending auth
[OpenKosmosPlugin] Authenticated with OpenKosmos
```

In OpenKosmos, the connection indicator in the agent settings will turn green (● Connected).

## Troubleshooting

### Connection refused
- Verify OpenKosmos is running and the External Agent feature is enabled
- Check the IP address — use the address shown in OpenKosmos agent settings, not `localhost` (unless OpenClaw runs on the same machine)
- Check firewall rules for port 9527

### Auth token rejected (close code 4004)
- The token in `config.yaml` must exactly match the token shown in OpenKosmos agent settings
- Each External Agent has a unique token — make sure you're using the right one
- The plugin will **not** retry after a 4004 rejection (to avoid brute-force)

### Reconnection
The plugin automatically reconnects with exponential backoff (1s → 2s → 4s → ... → 30s max) on normal disconnections (network drop, OpenKosmos restart). No manual intervention needed.

### Messages not arriving
- Ensure the OpenClaw agent routing is configured to handle the `openkosmos` channel
- Check that `conversationId` is being passed correctly — each OpenKosmos chat session has its own ID

## WebSocket Protocol Reference

### Client → Server (Plugin → OpenKosmos)

| Message | Fields | Description |
|---------|--------|-------------|
| `auth` | `type: "auth"`, `token: string` | First message after connection |
| `reply` | `type: "reply"`, `text: string`, `conversationId: string` | Agent reply to user |

### Server → Client (OpenKosmos → Plugin)

| Message | Fields | Description |
|---------|--------|-------------|
| `auth_success` | `type: "auth_success"` | Authentication succeeded |
| `auth_error` | `type: "auth_error"`, `error: string` | Authentication failed |
| `message` | `type: "message"`, `text: string`, `conversationId: string` | User message from OpenKosmos |
| `error` | `type: "error"`, `error: string`, `conversationId?: string` | Server error |

### Close Codes

| Code | Meaning | Plugin Behavior |
|------|---------|-----------------|
| 4004 | Invalid token | Stop, no reconnect |
| 4008 | Rate limit exceeded | Reconnect with backoff |
| 1008 | Auth timeout (10s) | Reconnect with backoff |
| Other | Normal disconnect | Reconnect with backoff |
