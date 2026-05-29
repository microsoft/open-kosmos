# PraestoClaw OpenKosmos Adapter

OpenKosmos channel adapter for [PraestoClaw](https://github.com/gim-home/PraestoClaw).

Connects PraestoClaw to the OpenKosmos desktop app via WebSocket, allowing users to chat with PraestoClaw through the OpenKosmos UI.

## Files

- `kosmos.py` — OpenKosmosChannel (subclass of `BaseChannel`)
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
   if os.getenv("OpenKosmos_URL"):
       from praestoclaw.channels.kosmos import OpenKosmosChannel
       kosmos_ch = OpenKosmosChannel(self.bus)
       self.channel_manager.add(kosmos_ch)
   ```

4. Set environment variables:
   ```bash
   export OpenKosmos_URL="ws://<kosmos-host>:9527"
   export OpenKosmos_TOKEN="<your-token>"
   export OpenKosmos_ALLOW_ALL_USERS=true
   ```

5. Start PraestoClaw — OpenKosmosChannel will auto-connect.

## WS Protocol

Same as Hermes adapter — see `packages/hermes-kosmos-adapter/README.md`.

## Status

🔧 Implemented, pending end-to-end testing.
