from typing import Set
from fastapi import WebSocket

frontend_clients: Set[WebSocket] = set()
robot_clients: Set[WebSocket] = set()


async def register_frontend(ws: WebSocket):
    await ws.accept()
    frontend_clients.add(ws)


async def register_robot(ws: WebSocket):
    await ws.accept()
    robot_clients.add(ws)


def remove_frontend(ws: WebSocket):
    frontend_clients.discard(ws)


def remove_robot(ws: WebSocket):
    robot_clients.discard(ws)