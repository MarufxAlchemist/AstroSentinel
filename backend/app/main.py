from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from app.websocket.manager import manager

app = FastAPI(
    title="Cosmic Alert System API",
    version="1.0.0"
)


@app.get("/")
def root():
    return {
        "status": "online",
        "service": "Cosmic Alert System"
    }


@app.get("/health")
def health():
    return {
        "status": "healthy"
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):

    await manager.connect(websocket)

    try:
        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        manager.disconnect(websocket)