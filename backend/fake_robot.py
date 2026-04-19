import asyncio
import json
import sys
import websockets

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

async def fake_robot():
    uri = "ws://127.0.0.1:8000/ws/robot"
    print(f"🤖 Fake Robot attempting to connect to {uri}...", flush=True)

    try:
        async with websockets.connect(uri) as ws:
            print("✅ Fake Robot Connected! Waiting for commands from Next.js...", flush=True)
            
            # Send a fake test message right away to see if the UI catches it
            await ws.send(json.dumps({
                "type": "kitchen_scan_result",
                "ingredients": ["apple", "banana", "fake_tomato"]
            }))
            
            # Listen forever for commands from your Next.js buttons
            while True:
                msg = await ws.recv()
                print(f"📥 Received from Backend: {msg}", flush=True)

    except Exception as e:
        print(f"❌ Connection failed: {e}", flush=True)

asyncio.run(fake_robot())