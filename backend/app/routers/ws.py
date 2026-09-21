from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool

from app.database import SessionLocal
from app.models import User
from app.realtime import Client, manager
from app.security import decode_access_token

router = APIRouter(tags=["Realtime"])


def _load_user(token: str) -> tuple[int, str, int | None] | None:
    user_id = decode_access_token(token)
    if not user_id:
        return None
    with SessionLocal() as db:
        user = db.get(User, user_id)
        if not user or not user.is_active:
            return None
        return user.id, user.role, user.branch_id


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    """
    Live event stream. Connect with `/api/v1/ws?token=<JWT>`.
    Send the text "ping" now and then to keep proxies from closing an idle socket.
    """
    identity = await run_in_threadpool(_load_user, token)
    if identity is None:
        await websocket.close(code=4401)
        return
    client = Client(websocket=websocket, user_id=identity[0], role=identity[1], branch_id=identity[2])
    await manager.connect(client)
    try:
        while True:
            message = await websocket.receive_text()
            if message == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(client)
