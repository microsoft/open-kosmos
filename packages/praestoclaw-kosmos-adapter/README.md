# PraestoClaw Kosmos Adapter

Kosmos channel adapter for [PraestoClaw](https://github.com/gim-home/PraestoClaw).

Connects PraestoClaw to the Kosmos desktop app via WebSocket, allowing users to chat with PraestoClaw through the Kosmos UI.

## Files

- `kosmos.py` — KosmosChannel (subclass of `BaseChannel`)
- `praestoclaw-integration.patch` — Patch for PraestoClaw source (ChannelType enum)

## Installation

1. Copy `kosmos.py` to `praestoclaw/channels/kosmos.py` in your PraestoClaw installation
2. Apply the patch:
   ```bash
   cd /path/to/PraestoClaw
   git apply /path/to/praestoclaw-integration.patch
   ```

3. Register in `praestoclaw/runtime.py` — add in `run_web_server()` after web channel setup:
   ```python
   if os.getenv("KOSMOS_URL"):
       from praestoclaw.channels.kosmos import KosmosChannel
       kosmos_ch = KosmosChannel(self.bus)
       self.channel_manager.add(kosmos_ch)
   ```

4. Set environment variables:
   ```bash
   export KOSMOS_URL="ws://<kosmos-host>:9527"
   export KOSMOS_TOKEN="<your-token>"
   export KOSMOS_ALLOW_ALL_USERS=true
   ```

5. Start PraestoClaw — KosmosChannel will auto-connect.

## WS Protocol

Same as Hermes adapter — see `packages/hermes-kosmos-adapter/README.md`.

## Status

🔧 Implemented, pending end-to-end testing.
