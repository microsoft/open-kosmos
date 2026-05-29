# PraestoClaw OpenKosmos Adapter

OpenKosmos channel adapter for [PraestoClaw](https://github.com/gim-home/PraestoClaw).

Connects PraestoClaw to the OpenKosmos desktop app via WebSocket, allowing users to chat with PraestoClaw through the OpenKosmos UI.

## Files

- `openkosmos.py` — OpenKosmosChannel (subclass of `BaseChannel`)
- `praestoclaw-integration.patch` — Patch for PraestoClaw source (ChannelType enum)

## Installation

1. Copy `openkosmos.py` to `praestoclaw/channels/openkosmos.py` in your PraestoClaw installation
2. Apply the patch:
   ```bash
   cd /path/to/PraestoClaw
   git apply /path/to/praestoclaw-integration.patch
   ```

3. Register in `praestoclaw/runtime.py` — add in `run_web_server()` after web channel setup:
   ```python
   if os.getenv("OpenKosmos_URL"):
       from praestoclaw.channels.openkosmos import OpenKosmosChannel
       openkosmos_ch = OpenKosmosChannel(self.bus)
       self.channel_manager.add(openkosmos_ch)
   ```

4. Set environment variables:
   ```bash
   export OpenKosmos_URL="ws://<openkosmos-host>:9527"
   export OpenKosmos_TOKEN="<your-token>"
   export OpenKosmos_ALLOW_ALL_USERS=true
   ```

5. Start PraestoClaw — OpenKosmosChannel will auto-connect.

## WS Protocol

Same as Hermes adapter — see `packages/hermes-openkosmos-adapter/README.md`.

## Status

🔧 Implemented, pending end-to-end testing.
