# Hermes Kosmos Adapter

Kosmos platform adapter for [Hermes Agent](https://github.com/NousResearch/hermes-agent).

Connects Hermes to the Kosmos desktop app via WebSocket, allowing users to chat with Hermes through the Kosmos UI.

## Files

- `kosmos.py` — The platform adapter (subclass of `BasePlatformAdapter`)
- `hermes-integration.patch` — Patch for Hermes source files (config, run, platforms, prompt_builder)

## Installation

1. Copy `kosmos.py` to `gateway/platforms/kosmos.py` in your Hermes installation
2. Apply `hermes-integration.patch` to register the adapter:
   ```bash
   cd /path/to/hermes-agent
   git apply /path/to/hermes-integration.patch
   ```

3. Configure environment variables:
   ```bash
   export KOSMOS_URL="ws://<kosmos-host>:9527"
   export KOSMOS_TOKEN="<your-token>"
   export KOSMOS_ALLOW_ALL_USERS=true
   ```

4. Configure LLM provider in `~/.hermes/config.yaml`:
   ```yaml
   model:
     default: claude-opus-4.6
     provider: custom-local
   
   providers:
     custom-local:
       base_url: http://localhost:4141/v1
       api_key: dummy
   ```

5. Start Hermes gateway:
   ```bash
   hermes gateway
   ```

## WS Protocol

The adapter connects as a WS client to Kosmos's WS server (port 9527):

- Auth: `{"type": "auth", "token": "..."}`
- User message (Kosmos → Hermes): `{"type": "message", "text": "...", "conversationId": "..."}`  
- Reply (Hermes → Kosmos): `{"type": "push", "text": "...", "conversationId": "..."}`
- End reply: `{"type": "push_end", "conversationId": "..."}`

## Status

✅ Tested and working — full round-trip: Kosmos → Hermes → LLM → Kosmos
