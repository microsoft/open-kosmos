# Hermes OpenKosmos Adapter

OpenKosmos platform adapter for [Hermes Agent](https://github.com/NousResearch/hermes-agent).

Connects Hermes to the OpenKosmos desktop app via WebSocket, allowing users to chat with Hermes through the OpenKosmos UI.

## Files

- `openkosmos.py` — The platform adapter (subclass of `BasePlatformAdapter`)
- `hermes-integration.patch` — Patch for Hermes source files (config, run, platforms, prompt_builder)

## Installation

1. Copy `openkosmos.py` to `gateway/platforms/openkosmos.py` in your Hermes installation
2. Apply `hermes-integration.patch` to register the adapter:
   ```bash
   cd /path/to/hermes-agent
   git apply /path/to/hermes-integration.patch
   ```

3. Configure environment variables:
   ```bash
   export OpenKosmos_URL="ws://<openkosmos-host>:9527"
   export OpenKosmos_TOKEN="<your-token>"
   export OpenKosmos_ALLOW_ALL_USERS=true
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

The adapter connects as a WS client to OpenKosmos's WS server (port 9527):

- Auth: `{"type": "auth", "token": "..."}`
- User message (OpenKosmos → Hermes): `{"type": "message", "text": "...", "conversationId": "..."}`  
- Reply (Hermes → OpenKosmos): `{"type": "push", "text": "...", "conversationId": "..."}`
- End reply: `{"type": "push_end", "conversationId": "..."}`

## Status

✅ Tested and working — full round-trip: OpenKosmos → Hermes → LLM → OpenKosmos
