# WorkPilot OpenKosmos Adapter

OpenKosmos channel adapter for [WorkPilot](https://github.com/gim-home/WorkPilot).

Connects WorkPilot to the OpenKosmos desktop app via WebSocket, allowing users to chat with WorkPilot through the OpenKosmos UI.

## Files

- `kosmos.py` — OpenKosmosChannel (subclass of `BaseChannel`)
- `workpilot-integration.patch` — Patch for WorkPilot source (ChannelType enum)

## Installation

1. Copy `kosmos.py` to `workpilot/channels/kosmos.py` in your WorkPilot installation
2. Apply the patch:
   ```bash
   cd /path/to/WorkPilot
   git apply /path/to/workpilot-integration.patch
   ```

3. Register in `workpilot/runtime.py` — add in `run_web_server()` after web channel setup:
   ```python
   if os.getenv("OpenKosmos_URL"):
       from workpilot.channels.kosmos import OpenKosmosChannel
       kosmos_ch = OpenKosmosChannel(self.bus)
       self.channel_manager.add(kosmos_ch)
   ```

4. Set environment variables:
   ```bash
   export OpenKosmos_URL="ws://<kosmos-host>:9527"
   export OpenKosmos_TOKEN="<your-token>"
   export OpenKosmos_ALLOW_ALL_USERS=true
   ```

5. Start WorkPilot — OpenKosmosChannel will auto-connect.

## WS Protocol

Same as Hermes adapter — see `packages/hermes-kosmos-adapter/README.md`.

## Status

🔧 Implemented, pending end-to-end testing.
