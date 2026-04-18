from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import json

from planner import plan_recipe
from actions import ACTIONS
from connections import (
    register_frontend,
    register_robot,
    frontend_clients,
    robot_clients,
    remove_frontend,
    remove_robot
)

app = FastAPI()
