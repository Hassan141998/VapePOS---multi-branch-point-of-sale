"""
Real-time push over WebSockets.

The API publishes small "something changed" events. Browsers listen and refetch
the affected data. Admins receive every event; managers/cashiers only receive
events for their own branch.

NOTE: connections live in this process's memory, so run ONE uvicorn worker
(plenty for 4 stores). To scale out, replace `publish` with Redis pub/sub or
PostgreSQL LISTEN/NOTIFY - see docs/ARCHITECTURE.md.
"""
from __future__ import annotations

import logging
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import WebSocket

log = logging.getLogger("vapepos.realtime")


@dataclass(eq=False)
class Client:
    websocket: WebSocket
    user_id: int
    role: str
    branch_id: int | None


class ConnectionManager:
    def __init__(self) -> None:
        self.clients: list[Client] = []

    async def connect(self, client: Client) -> None:
        await client.websocket.accept()
        self.clients.append(client)

    def disconnect(self, client: Client) -> None:
        if client in self.clients:
            self.clients.remove(client)

    async def publish(self, event_type: str, branch_ids: Iterable[int] = (), data: dict | None = None) -> None:
        targets = set(branch_ids)
        message = {
            "type": event_type,
            "branch_ids": sorted(targets),
            "data": data or {},
            "at": datetime.now(timezone.utc).isoformat(),
        }
        for client in list(self.clients):
            allowed = client.role == "admin" or not targets or client.branch_id in targets
            if not allowed:
                continue
            try:
                await client.websocket.send_json(message)
            except Exception:  # socket already closed
                log.debug("dropping dead websocket for user %s", client.user_id)
                self.disconnect(client)


manager = ConnectionManager()
