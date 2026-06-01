import asyncio
import websockets


async def test():

    uri = "ws://127.0.0.1:8000/ws"

    async with websockets.connect(uri) as websocket:

        print("Connected")

        while True:
            await websocket.send("ping")

            await asyncio.sleep(5)


asyncio.run(test())