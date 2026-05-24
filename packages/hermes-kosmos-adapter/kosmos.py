"""Kosmos platform adapter.

Connects Hermes to a Kosmos desktop app instance via WebSocket.
Kosmos is an Electron desktop app that provides a chat UI and connects
to AI agent backends via WebSocket.

The adapter is a WS CLIENT connecting to Kosmos's WS server.

Protocol (JSON-based):
- Auth: send {"type": "auth", "token": "<token>"}
- Auth success: receive {"type": "auth_success"}
- Auth error: receive {"type": "auth_error", "error": "..."}
- User message: receive {"type": "message", "text": "...", "conversationId": "..."}
- Push reply: send {"type": "push", "text": "...", "conversationId": "..."}
- End reply: send {"type": "push_end", "conversationId": "..."}
- Error: send {"type": "error", "error": "...", "conversationId": "..."}
"""

import asyncio
import json
import logging
import os
import random
from typing import Any, Dict, Optional

try:
    import websockets
    from websockets.exceptions import ConnectionClosed

    WEBSOCKETS_AVAILABLE = True
except ImportError:
    WEBSOCKETS_AVAILABLE = False
    websockets = None  # type: ignore[assignment]
    ConnectionClosed = Exception  # type: ignore[assignment,misc]

from gateway.config import Platform, PlatformConfig
from gateway.platforms.base import (
    BasePlatformAdapter,
    MessageEvent,
    MessageType,
    SendResult,
)

logger = logging.getLogger(__name__)

# Auth failure close codes that should NOT trigger reconnection
AUTH_FAILURE_CODES = {
    4004,  # Invalid token - don't reconnect
    4009,  # Replaced by another connection
    4010,  # Rate limited
}


def check_kosmos_requirements() -> bool:
    """Check if Kosmos adapter dependencies are available."""
    return WEBSOCKETS_AVAILABLE


class KosmosAdapter(BasePlatformAdapter):
    """WebSocket client adapter for Kosmos desktop app."""

    def __init__(self, config: PlatformConfig):
        super().__init__(config, Platform.KOSMOS)

        # Parse config
        self._url: str = config.extra.get("url") or os.getenv("KOSMOS_URL", "")
        self._token: str = config.extra.get("token") or os.getenv("KOSMOS_TOKEN", "")

        # Allow all users by default (Kosmos is a local desktop app)
        allow_all_default = os.getenv("KOSMOS_ALLOW_ALL_USERS", "true")
        self._allow_all: bool = allow_all_default.lower() in ("true", "1", "yes")

        # WebSocket connection state
        self._ws: Optional[Any] = None
        self._listener_task: Optional[asyncio.Task] = None
        self._reconnect_task: Optional[asyncio.Task] = None
        self._authenticated: bool = False
        self._should_reconnect: bool = True

        # Reconnection parameters
        self._reconnect_attempt: int = 0
        self._max_reconnect_delay: float = 60.0
        self._base_reconnect_delay: float = 1.0

    async def connect(self) -> bool:
        """Connect to Kosmos WS server and authenticate."""
        if not self._url:
            logger.error("[kosmos] No URL configured. Set KOSMOS_URL or config.extra.url")
            self._set_fatal_error("no_url", "No Kosmos URL configured", retryable=False)
            return False

        if not self._token:
            logger.error("[kosmos] No token configured. Set KOSMOS_TOKEN or config.extra.token")
            self._set_fatal_error("no_token", "No Kosmos token configured", retryable=False)
            return False

        try:
            success = await self._connect_and_auth()
            if success:
                self._mark_connected()
                self._should_reconnect = True
                self._reconnect_attempt = 0
                # Start message listener
                self._listener_task = asyncio.create_task(self._listen_loop())
                self._background_tasks.add(self._listener_task)
                self._listener_task.add_done_callback(self._background_tasks.discard)
                logger.info("[kosmos] Connected and authenticated to %s", self._safe_url())
                return True
            return False
        except Exception as e:
            logger.error("[kosmos] Connection failed: %s", e)
            self._set_fatal_error("connect_error", str(e), retryable=True)
            return False

    def _safe_url(self) -> str:
        """Return URL safe for logging (no credentials)."""
        # URL should be ws://host:port, no credentials expected
        return self._url.split("?")[0] if self._url else "(none)"

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
            logger.error("[kosmos] WebSocket connect failed: %s", e)
            return False

        # Send auth message
        auth_msg = json.dumps({"type": "auth", "token": self._token})
        try:
            await self._ws.send(auth_msg)
        except Exception as e:
            logger.error("[kosmos] Failed to send auth message: %s", e)
            await self._close_ws()
            return False

        # Wait for auth response
        try:
            response_raw = await asyncio.wait_for(self._ws.recv(), timeout=10.0)
            response = json.loads(response_raw)
        except asyncio.TimeoutError:
            logger.error("[kosmos] Auth response timeout")
            await self._close_ws()
            return False
        except Exception as e:
            logger.error("[kosmos] Failed to receive auth response: %s", e)
            await self._close_ws()
            return False

        msg_type = response.get("type")
        if msg_type == "auth_success":
            self._authenticated = True
            logger.debug("[kosmos] Authentication successful")
            return True
        elif msg_type == "auth_error":
            error = response.get("error", "Unknown auth error")
            logger.error("[kosmos] Authentication failed: %s", error)
            self._set_fatal_error("auth_error", f"Auth failed: {error}", retryable=False)
            await self._close_ws()
            return False
        else:
            logger.error("[kosmos] Unexpected auth response type: %s", msg_type)
            await self._close_ws()
            return False

    async def _close_ws(self) -> None:
        """Close WebSocket connection gracefully."""
        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None
        self._authenticated = False

    async def disconnect(self) -> None:
        """Disconnect from Kosmos."""
        self._should_reconnect = False

        # Cancel reconnect task if running
        if self._reconnect_task and not self._reconnect_task.done():
            self._reconnect_task.cancel()
            try:
                await self._reconnect_task
            except asyncio.CancelledError:
                pass
            self._reconnect_task = None

        # Cancel listener task
        if self._listener_task and not self._listener_task.done():
            self._listener_task.cancel()
            try:
                await self._listener_task
            except asyncio.CancelledError:
                pass
            self._listener_task = None

        # Close WebSocket
        await self._close_ws()
        self._mark_disconnected()
        logger.info("[kosmos] Disconnected")

    async def _listen_loop(self) -> None:
        """Main message listener loop with reconnection."""
        while self._should_reconnect:
            try:
                await self._receive_messages()
            except asyncio.CancelledError:
                logger.debug("[kosmos] Listener cancelled")
                return
            except ConnectionClosed as e:
                logger.warning("[kosmos] Connection closed: code=%s reason=%s", e.code, e.reason)
                self._authenticated = False

                # Check if we should reconnect
                if e.code in AUTH_FAILURE_CODES:
                    logger.error("[kosmos] Auth failure code %d - not reconnecting", e.code)
                    self._set_fatal_error(
                        f"auth_code_{e.code}",
                        f"Connection closed with auth error code {e.code}",
                        retryable=False,
                    )
                    await self._notify_fatal_error()
                    return

                if self._should_reconnect:
                    await self._schedule_reconnect()
            except Exception as e:
                logger.exception("[kosmos] Listener error: %s", e)
                if self._should_reconnect:
                    await self._schedule_reconnect()

    async def _receive_messages(self) -> None:
        """Receive and process messages from WebSocket."""
        if not self._ws:
            return

        async for message in self._ws:
            try:
                data = json.loads(message)
                await self._handle_message(data)
            except json.JSONDecodeError:
                logger.warning("[kosmos] Received invalid JSON: %s", message[:100])
            except Exception as e:
                logger.exception("[kosmos] Error handling message: %s", e)

    async def _handle_message(self, data: dict) -> None:
        """Process an incoming message from Kosmos."""
        msg_type = data.get("type")

        if msg_type == "message":
            # User message from Kosmos
            text = data.get("text", "")
            conversation_id = data.get("conversationId", "")

            if not conversation_id:
                logger.warning("[kosmos] Received message without conversationId")
                return

            # Build session source
            # For Kosmos, the conversationId IS the chat_id
            source = self.build_source(
                chat_id=conversation_id,
                chat_name=f"Kosmos:{conversation_id[:8]}",
                chat_type="dm",  # Kosmos is a personal desktop app
                user_id="kosmos_user",  # Single user per Kosmos instance
                user_name="User",
            )

            event = MessageEvent(
                text=text,
                message_type=MessageType.TEXT,
                source=source,
                raw_message=data,
                message_id=conversation_id,  # Use conversationId as message_id
            )

            logger.debug(
                "[kosmos] Received message: conversation=%s len=%d",
                conversation_id[:8],
                len(text),
            )

            # Dispatch to gateway
            task = asyncio.create_task(self.handle_message(event))
            self._background_tasks.add(task)
            task.add_done_callback(self._background_tasks.discard)

        elif msg_type == "auth_success":
            # May receive this if we reconnected
            self._authenticated = True
            logger.debug("[kosmos] Re-authenticated")

        elif msg_type == "auth_error":
            error = data.get("error", "Unknown")
            logger.error("[kosmos] Auth error received: %s", error)
            self._set_fatal_error("auth_error", f"Auth error: {error}", retryable=False)
            await self._notify_fatal_error()

        else:
            logger.debug("[kosmos] Ignoring message type: %s", msg_type)

    async def _schedule_reconnect(self) -> None:
        """Schedule a reconnection attempt with exponential backoff + jitter."""
        if not self._should_reconnect:
            return

        self._reconnect_attempt += 1

        # Exponential backoff with jitter
        delay = min(
            self._base_reconnect_delay * (2 ** (self._reconnect_attempt - 1)),
            self._max_reconnect_delay,
        )
        # Add jitter: +/- 20%
        jitter = delay * 0.2 * (random.random() * 2 - 1)
        delay = max(0.5, delay + jitter)

        logger.info(
            "[kosmos] Reconnecting in %.1fs (attempt %d)",
            delay,
            self._reconnect_attempt,
        )

        await asyncio.sleep(delay)

        if not self._should_reconnect:
            return

        # Attempt reconnection
        try:
            success = await self._connect_and_auth()
            if success:
                self._reconnect_attempt = 0
                self._mark_connected()
                logger.info("[kosmos] Reconnected successfully")
        except Exception as e:
            logger.error("[kosmos] Reconnect failed: %s", e)

    async def send(
        self,
        chat_id: str,
        content: str,
        reply_to: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> SendResult:
        """Send a message (push + push_end) to Kosmos.

        chat_id IS the conversationId for Kosmos.
        """
        if not self._ws or not self._authenticated:
            return SendResult(
                success=False,
                error="Not connected to Kosmos",
                retryable=True,
            )

        conversation_id = chat_id

        try:
            # Send push message with content
            push_msg = json.dumps({
                "type": "push",
                "text": content,
                "conversationId": conversation_id,
            })
            await self._ws.send(push_msg)

            # Send push_end to signal completion
            end_msg = json.dumps({
                "type": "push_end",
                "conversationId": conversation_id,
            })
            await self._ws.send(end_msg)

            logger.debug(
                "[kosmos] Sent reply: conversation=%s len=%d",
                conversation_id[:8],
                len(content),
            )

            return SendResult(success=True, message_id=conversation_id)

        except ConnectionClosed as e:
            logger.warning("[kosmos] Send failed - connection closed: %s", e)
            return SendResult(
                success=False,
                error=f"Connection closed: {e}",
                retryable=True,
            )
        except Exception as e:
            logger.error("[kosmos] Send failed: %s", e)
            return SendResult(success=False, error=str(e), retryable=True)

    async def send_typing(self, chat_id: str, metadata=None) -> None:
        """Send typing indicator - Kosmos doesn't support this yet."""
        # No-op: Kosmos doesn't have typing indicators
        pass

    async def send_image(
        self,
        chat_id: str,
        image_url: str,
        caption: Optional[str] = None,
        reply_to: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> SendResult:
        """Send an image - not supported by Kosmos yet."""
        # Fall back to sending URL as text
        text = f"{caption}\n{image_url}" if caption else image_url
        return await self.send(chat_id=chat_id, content=text, reply_to=reply_to)

    async def get_chat_info(self, chat_id: str) -> Dict[str, Any]:
        """Get information about a conversation."""
        return {
            "name": f"Kosmos:{chat_id[:8]}",
            "type": "dm",
            "chat_id": chat_id,
        }
