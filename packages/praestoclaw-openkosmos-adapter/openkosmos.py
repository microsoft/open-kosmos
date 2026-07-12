"""
OpenKosmos channel — WebSocket client connecting to OpenKosmos desktop app.

OpenKosmos is an Electron desktop app that provides a chat UI and connects
to AI agent backends via WebSocket. This channel acts as a WS CLIENT
connecting to OpenKosmos's WS server.

Protocol (JSON-based):
- Auth: send {"type": "auth", "token": "<token>"}
- Auth success: receive {"type": "auth_success"}
- Auth error: receive {"type": "auth_error", "error": "..."}
- User message: receive {"type": "message", "text": "...", "conversationId": "..."}
- Push reply: send {"type": "push", "text": "...", "conversationId": "..."}
- End reply: send {"type": "push_end", "conversationId": "..."}
"""

from __future__ import annotations

import asyncio
import json
import os
import random
from typing import Any

import websockets
import websockets.exceptions
from loguru import logger

from praestoclaw.bus.queue import MessageBus
from praestoclaw.channels.base import BaseChannel

# Auth failure close codes — don't reconnect on these
AUTH_FAILURE_CODES = {
    4004,  # Invalid token
    4010,  # Rate limited
}


class OpenKosmosChannel(BaseChannel):
    """WebSocket client channel for OpenKosmos desktop app."""

    def __init__(
        self,
        bus: MessageBus,
        url: str | None = None,
        token: str | None = None,
        allow_from: list[str] | None = None,
    ) -> None:
        # Resolve allow_from: if None, check env var for allow-all default
        if allow_from is None:
            allow_all = os.getenv("OPENKOSMOS_ALLOW_ALL_USERS", "true").lower() in ("true", "1", "yes")
            if allow_all:
                allow_from = []  # empty = allow all

        super().__init__(bus, allow_from)

        self._url = url or os.getenv("OPENKOSMOS_URL", "")
        self._token = token or os.getenv("OPENKOSMOS_TOKEN", "")

        # WebSocket state
        self._ws: Any = None
        self._authenticated = False
        self._running = False
        self._connect_task: asyncio.Task[None] | None = None

        # Reconnection parameters
        self._reconnect_attempt = 0
        self._base_reconnect_delay = 1.0
        self._max_reconnect_delay = 60.0

    @property
    def name(self) -> str:
        return "openkosmos"

    @property
    def is_connected(self) -> bool:
        return self._ws is not None and self._authenticated

    async def start(self) -> None:
        """Start the channel — begin connecting to OpenKosmos."""
        if not self._url:
            logger.error("[openkosmos] No URL configured. Set OPENKOSMOS_URL env var")
            return
        if not self._token:
            logger.error("[openkosmos] No token configured. Set OPENKOSMOS_TOKEN env var")
            return

        self._running = True
        self._connect_task = asyncio.create_task(self._connect_loop(), name="openkosmos-connect")
        logger.info("[openkosmos] Channel started, connecting to {}", self._safe_url())

    async def stop(self) -> None:
        """Stop the channel and disconnect."""
        self._running = False

        if self._connect_task and not self._connect_task.done():
            self._connect_task.cancel()
            try:
                await self._connect_task
            except asyncio.CancelledError:
                pass
            self._connect_task = None

        await self._close_ws()
        logger.info("[openkosmos] Channel stopped")

    async def send(self, channel_id: str, content: str, **kwargs: Any) -> None:
        """Send a response to OpenKosmos.

        channel_id is the conversationId from OpenKosmos.
        """
        if not self._ws or not self._authenticated:
            logger.warning("[openkosmos] Cannot send — not connected")
            return

        try:
            # Send push message with content
            push_msg = json.dumps({
                "type": "push",
                "text": content,
                "conversationId": channel_id,
            })
            await self._ws.send(push_msg)

            # Send push_end to signal completion
            end_msg = json.dumps({
                "type": "push_end",
                "conversationId": channel_id,
            })
            await self._ws.send(end_msg)

            logger.debug("[openkosmos] Sent reply: conversation={} len={}", channel_id[:8], len(content))
        except websockets.exceptions.ConnectionClosed as e:
            logger.warning("[openkosmos] Send failed — connection closed: {}", e)
        except Exception as e:
            logger.error("[openkosmos] Send failed: {}", e)

    def _safe_url(self) -> str:
        """Return URL safe for logging (no credentials)."""
        return self._url.split("?")[0] if self._url else "(none)"

    async def _connect_loop(self) -> None:
        """Main connection loop with exponential backoff + jitter."""
        while self._running:
            try:
                await self._run_connection()
                self._reconnect_attempt = 0  # Reset on clean close
            except asyncio.CancelledError:
                break
            except websockets.exceptions.ConnectionClosed as e:
                logger.warning("[openkosmos] Connection closed: code={} reason={}", e.code, e.reason)
                self._authenticated = False

                # Check for auth failure codes — don't reconnect
                if e.code in AUTH_FAILURE_CODES:
                    logger.error("[openkosmos] Auth failure code {} — not reconnecting", e.code)
                    break

                if self._running:
                    await self._wait_and_reconnect()
            except Exception as e:
                logger.error("[openkosmos] Connection error: {}", e)
                self._authenticated = False
                if self._running:
                    await self._wait_and_reconnect()

    async def _run_connection(self) -> None:
        """Single connection lifecycle: connect, auth, receive messages."""
        if not await self._connect_and_auth():
            # Auth failed — wait and retry
            if self._running:
                await self._wait_and_reconnect()
            return

        logger.info("[openkosmos] Connected and authenticated to {}", self._safe_url())
        self._reconnect_attempt = 0

        # Receive messages until disconnected
        await self._receive_messages()

    async def _connect_and_auth(self) -> bool:
        """Establish WebSocket connection and perform auth handshake."""
        try:
            self._ws = await websockets.connect(
                self._url,
                ping_interval=30,
                ping_timeout=10,
                close_timeout=5,
            )
        except Exception as e:
            logger.error("[openkosmos] WebSocket connect failed: {}", e)
            return False

        # Send auth message
        auth_msg = json.dumps({"type": "auth", "token": self._token})
        try:
            await self._ws.send(auth_msg)
        except Exception as e:
            logger.error("[openkosmos] Failed to send auth message: {}", e)
            await self._close_ws()
            return False

        # Wait for auth response
        try:
            response_raw = await asyncio.wait_for(self._ws.recv(), timeout=10.0)
            response = json.loads(response_raw)
        except asyncio.TimeoutError:
            logger.error("[openkosmos] Auth response timeout")
            await self._close_ws()
            return False
        except Exception as e:
            logger.error("[openkosmos] Failed to receive auth response: {}", e)
            await self._close_ws()
            return False

        msg_type = response.get("type")
        if msg_type == "auth_success":
            self._authenticated = True
            logger.debug("[openkosmos] Authentication successful")
            return True
        elif msg_type == "auth_error":
            error = response.get("error", "Unknown auth error")
            logger.error("[openkosmos] Authentication failed: {}", error)
            await self._close_ws()
            return False
        else:
            logger.error("[openkosmos] Unexpected auth response type: {}", msg_type)
            await self._close_ws()
            return False

    async def _receive_messages(self) -> None:
        """Receive and process messages from WebSocket."""
        if not self._ws:
            return

        async for message in self._ws:
            try:
                data = json.loads(message)
                await self._process_message(data)
            except json.JSONDecodeError:
                logger.warning("[openkosmos] Received invalid JSON: {}", message[:100] if message else "")
            except Exception as e:
                logger.exception("[openkosmos] Error handling message: {}", e)

    async def _process_message(self, data: dict[str, Any]) -> None:
        """Process an incoming message from OpenKosmos."""
        msg_type = data.get("type")

        if msg_type == "message":
            text = data.get("text", "")
            conversation_id = data.get("conversationId", "")

            if not conversation_id:
                logger.warning("[openkosmos] Received message without conversationId")
                return

            logger.debug(
                "[openkosmos] Received message: conversation={} len={}",
                conversation_id[:8],
                len(text),
            )

            # Publish to bus via base class helper
            await self._handle_message(
                channel_id=conversation_id,
                sender_id="openkosmos_user",  # Single user per OpenKosmos instance
                sender_name="User",
                content=text,
                thread_id=conversation_id,
                metadata={"source": "openkosmos"},
            )

        elif msg_type == "auth_success":
            # May receive this on reconnect
            self._authenticated = True
            logger.debug("[openkosmos] Re-authenticated")

        elif msg_type == "auth_error":
            error = data.get("error", "Unknown")
            logger.error("[openkosmos] Auth error received: {}", error)

        else:
            logger.debug("[openkosmos] Ignoring message type: {}", msg_type)

    async def _wait_and_reconnect(self) -> None:
        """Wait with exponential backoff + jitter before reconnecting."""
        self._reconnect_attempt += 1

        # Exponential backoff with jitter
        delay = min(
            self._base_reconnect_delay * (2 ** (self._reconnect_attempt - 1)),
            self._max_reconnect_delay,
        )
        # Add jitter: +/- 20%
        jitter = delay * 0.2 * (random.random() * 2 - 1)
        delay = max(0.5, delay + jitter)

        logger.info("[openkosmos] Reconnecting in {:.1f}s (attempt {})", delay, self._reconnect_attempt)
        await asyncio.sleep(delay)

    async def _close_ws(self) -> None:
        """Close WebSocket connection gracefully."""
        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None
        self._authenticated = False
