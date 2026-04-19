import json
import os
import sqlite3
from contextlib import contextmanager
from typing import Any, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from services.knot_service import sync_and_build_summary
from services.pexels_service import fetch_first_photo_url

load_dotenv()

APP_BUILD_ID = "souschef-knot-k2-v1"

app = FastAPI(title="SousChef Command Relay")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, Any]:
    """If `build` is not souschef-knot-k2-v1, this process is not the full SousChef backend."""
    return {"status": "ok", "build": APP_BUILD_ID}


ACTIONS = {
    "chop": {"servo": [90, 40, 120, 90, 30, 90]},
    "stir": {"servo": [90, 60, 110, 90, 45, 90]},
    "pick_up": {"servo": [90, 30, 90, 45, 90, 30]},
    "wait": {"servo": None},
    "listen": {"servo": None},
    "talk": {"servo": None},
}

DATABASE_PATH = os.getenv("DATABASE_PATH", "souschef.db")

_robot_ws: Optional[WebSocket] = None
_browser_sockets: set[WebSocket] = set()


@contextmanager
def get_db():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS recipes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT,
                raw_text TEXT NOT NULL,
                steps_json TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS meals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recipe_id INTEGER,
                status TEXT DEFAULT 'pending',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (recipe_id) REFERENCES recipes(id)
            );

            CREATE TABLE IF NOT EXISTS actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meal_id INTEGER,
                action_type TEXT NOT NULL,
                payload_json TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (meal_id) REFERENCES meals(id)
            );

            CREATE TABLE IF NOT EXISTS user_profiles (
                user_id TEXT PRIMARY KEY,
                food_profile_summary TEXT NOT NULL,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            """
        )


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    _k2_base = os.getenv("K2_THINK_BASE_URL", "https://api.k2think.ai/v1")
    _k2_key = os.getenv("K2_THINK_API_KEY") or ""
    _k2_preview = _k2_key[:5] if len(_k2_key) >= 5 else (_k2_key or "(empty)")
    print(
        f"[K2 config] K2_THINK_BASE_URL={_k2_base!r} "
        f"K2_THINK_API_KEY(first5)={_k2_preview!r}",
        flush=True,
    )
    # If /recipes/suggest-personalized is missing from openapi.json, an old uvicorn may still be bound to :8000.
    route_paths = sorted(
        {getattr(r, "path", "") for r in app.routes if getattr(r, "path", None)}
    )
    print(f"[routes] build={APP_BUILD_ID} path_count={len(route_paths)}", flush=True)
    for p in route_paths:
        if "suggest" in p or "profile" in p or p.startswith("/recipes"):
            print(f"[routes]   {p}", flush=True)


async def broadcast_to_browsers(message: dict[str, Any]) -> None:
    dead: list[WebSocket] = []
    text = json.dumps(message)
    for ws in _browser_sockets:
        try:
            await ws.send_text(text)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _browser_sockets.discard(ws)


async def send_to_robot(payload: dict[str, Any]) -> None:
    global _robot_ws
    if _robot_ws is None:
        raise HTTPException(status_code=503, detail="Robot not connected")
    await _robot_ws.send_text(json.dumps(payload))


ALLOWED_ROBOT_ACTIONS = frozenset({"listen", "talk", "chop", "stir", "pick_up"})

CHEF_SUE_SYSTEM_PROMPT = (
    "You are Chef Sue. Output ONLY a JSON array — nothing else. "
    "No 'Thinking', no reasoning, no markdown, no text before or after the array. "
    "Each object MUST have exactly: action, target, voice_cue. "
    "action MUST be one of: chop, stir, pick_up, talk, listen. "
    'Example (format only): [{"action":"chop","target":"tomato","voice_cue":"Chopping!"}]'
)


def _strip_markdown_json_fence(content: str) -> str:
    text = content.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    return text.strip()


def _extract_first_json_array(text: str) -> str:
    """
    K2-Think-v2 may prefix 'Thinking' or other text before the JSON array.
    Find the first balanced `[` ... `]` slice (respecting double-quoted strings).
    """
    text = text.strip()
    start = text.find("[")
    if start < 0:
        raise ValueError("Model output has no '[' to start a JSON array")
    depth = 0
    in_string = False
    escape = False
    i = start
    while i < len(text):
        c = text[i]
        if in_string:
            if escape:
                escape = False
            elif c == "\\":
                escape = True
            elif c == '"':
                in_string = False
            i += 1
            continue
        if c == '"':
            in_string = True
            i += 1
            continue
        if c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
        i += 1
    raise ValueError("Model output has no balanced JSON array (unclosed '[')")


def _parse_model_content_to_steps(content: str) -> Any:
    """Parse assistant message into a JSON value; tolerate preamble before the array."""
    content = content.strip()
    content = _strip_markdown_json_fence(content)
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        fragment = _extract_first_json_array(content)
        return json.loads(fragment)


def _validate_robot_steps(steps: Any) -> list[dict[str, Any]]:
    if not isinstance(steps, list):
        raise ValueError("Expected a JSON array of robot steps")
    out: list[dict[str, Any]] = []
    for i, item in enumerate(steps):
        if not isinstance(item, dict):
            raise ValueError(f"Step {i} is not an object")
        for key in ("action", "target", "voice_cue"):
            if key not in item:
                raise ValueError(f"Step {i} missing required key {key!r}")
        action = str(item["action"]).strip().lower()
        target = str(item["target"]).strip()
        voice_cue = str(item["voice_cue"]).strip()
        if action not in ALLOWED_ROBOT_ACTIONS:
            raise ValueError(
                f"Step {i} has invalid action {action!r}; "
                "allowed: listen, talk, chop, stir, pick_up"
            )
        if not target:
            raise ValueError(f"Step {i} target must be non-empty")
        if not voice_cue:
            raise ValueError(f"Step {i} voice_cue must be non-empty")
        # Hard contract only — drop any extra keys from the model (e.g. instruction).
        out.append({"action": action, "target": target, "voice_cue": voice_cue})
    return out


def _merge_servo_into_step(step: dict[str, Any]) -> dict[str, Any]:
    """Hardware contract: action, target, voice_cue, servo (from ACTIONS)."""
    action = str(step.get("action", "")).strip().lower()
    target = str(step.get("target", "")).strip()
    voice_cue = str(step.get("voice_cue", "")).strip()
    spec = ACTIONS.get(action) or {}
    servo: Any = spec.get("servo")
    return {
        "action": action,
        "target": target,
        "voice_cue": voice_cue,
        "servo": servo,
    }


async def _parse_recipe_with_k2(recipe: str) -> list[dict[str, Any]]:
    api_key = (os.getenv("K2_THINK_API_KEY") or "").strip()
    if not api_key:
        raise ValueError(
            "K2_THINK_API_KEY is not set or is empty. Set it in backend/.env and restart uvicorn."
        )

    model = (os.getenv("K2_THINK_MODEL") or "").strip()
    if not model:
        raise ValueError(
            "K2_THINK_MODEL is not set or is empty. Set it in backend/.env (e.g. your K2 model id)."
        )

    base_url = os.getenv("K2_THINK_BASE_URL", "https://api.k2think.ai/v1").rstrip("/")

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            r = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": CHEF_SUE_SYSTEM_PROMPT},
                        {"role": "user", "content": recipe},
                    ],
                    "temperature": 0.2,
                },
            )
        except httpx.RequestError as e:
            raise ValueError(f"K2 Think request failed (network): {e}") from e

        try:
            r.raise_for_status()
        except httpx.HTTPStatusError as e:
            snippet = (e.response.text or "")[:800]
            raise ValueError(
                f"K2 Think API HTTP {e.response.status_code}: {snippet}"
            ) from e

        print("RAW K2 RESPONSE:", r.text, flush=True)

        try:
            data = r.json()
        except json.JSONDecodeError as e:
            raw = (r.text or "")[:500]
            raise ValueError(f"K2 Think response body was not JSON: {raw}") from e

        try:
            raw_content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as e:
            raise ValueError(
                f"Unexpected K2 Think response shape (missing choices/message): {data!r}"
            ) from e

        content = str(raw_content).strip()
        try:
            parsed = _parse_model_content_to_steps(content)
        except (json.JSONDecodeError, ValueError) as e:
            raise ValueError(
                f"Could not parse JSON array from model message: {content[:800]!r} ({e})"
            ) from e

        return _validate_robot_steps(parsed)


CHEFSUE_GEMINI_SYSTEM_PROMPT = (
    "You are ChefSue. Based on the user's spend profile, suggest exactly 3 quick meals. "
    "Output ONLY a JSON array — no markdown, no prose outside the array.\n"
    "SCHEMA: [{\"name\": \"Meal Name\", \"description\": \"1 short sentence\", "
    "\"search_query\": \"Short food noun or phrase for stock photo search (e.g. quinoa salad)\"}].\n"
    "Do not include any text outside the JSON array."
)


class _GeminiMealRow(BaseModel):
    name: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)
    search_query: str = Field(..., min_length=1)


async def _generate_meal_suggestions_gemini(
    *,
    user_prompt: str,
    food_profile_summary: str,
) -> list[dict[str, str]]:
    """POST /recipes/suggest-personalized — Gemini JSON only (K2 remains on /recipes/parse)."""
    api_key = (
        (os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY") or "").strip()
    )
    if not api_key:
        raise ValueError(
            "GOOGLE_API_KEY or GEMINI_API_KEY must be set in backend/.env for meal suggestions."
        )

    model = (os.getenv("GEMINI_SUGGEST_MODEL") or "gemini-2.5-flash").strip()
    profile_block = (
        food_profile_summary.strip()
        or "(No spend profile stored yet — user has not linked Knot or sync returned no data.)"
    )
    user_block = (
        f"User request:\n{user_prompt.strip()}\n\n"
        f"Spend / taste profile (from Knot when synced):\n{profile_block}"
    )

    url = (
        "https://generativelanguage.googleapis.com/v1beta/"
        f"models/{model}:generateContent?key={api_key}"
    )
    payload: dict[str, Any] = {
        "systemInstruction": {"parts": [{"text": CHEFSUE_GEMINI_SYSTEM_PROMPT}]},
        "contents": [{"parts": [{"text": user_block}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.5,
        },
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            r = await client.post(url, json=payload)
        except httpx.RequestError as e:
            raise ValueError(f"Gemini request failed (network): {e}") from e

        try:
            r.raise_for_status()
        except httpx.HTTPStatusError as e:
            snippet = (e.response.text or "")[:1200]
            raise ValueError(
                f"Gemini API HTTP {e.response.status_code}: {snippet}"
            ) from e

        try:
            data = r.json()
        except json.JSONDecodeError as e:
            raw = (r.text or "")[:500]
            raise ValueError(f"Gemini response body was not JSON: {raw}") from e

        if not data.get("candidates"):
            raise ValueError(f"Gemini returned no candidates: {data!r}")

        try:
            raw_text = data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError, TypeError) as e:
            raise ValueError(
                f"Unexpected Gemini response shape: {data!r}"
            ) from e

        raw_text = str(raw_text).strip()
        print(f"GEMINI JSON RECEIVED: {raw_text[:2000]}", flush=True)

        try:
            parsed = json.loads(raw_text)
        except json.JSONDecodeError as e:
            raise ValueError(
                f"Gemini did not return valid JSON: {raw_text[:800]!r} ({e})"
            ) from e

        if not isinstance(parsed, list):
            raise ValueError(f"Expected JSON array, got: {type(parsed).__name__}")

        rows: list[dict[str, str]] = []
        for item in parsed[:5]:
            if not isinstance(item, dict):
                continue
            row = _GeminiMealRow.model_validate(
                {
                    "name": str(item.get("name", "")).strip(),
                    "description": str(item.get("description", "")).strip(),
                    "search_query": str(item.get("search_query", "")).strip(),
                }
            )
            rows.append(
                {
                    "name": row.name,
                    "description": row.description,
                    "search_query": row.search_query,
                }
            )
        if not rows:
            raise ValueError("Gemini returned an empty meal list.")
        return rows


class ParseRecipeBody(BaseModel):
    recipe: str = Field(..., min_length=1)


class ParseRecipeResponse(BaseModel):
    id: int
    steps: list[dict[str, Any]]


# Green-mat demo: fixed 6-step plan (matches hardware script; no K2).
MASTER_TOMATO_SALAD_RAW = (
    "Master Tomato Salad — Green Mat Demo\n\n"
    "Pick up the yellow exacto knife from the mat.\n"
    "Perform a chopping motion.\n"
    "Pick up the red tomato.\n"
    "Move to the blue container top and release.\n"
    "Stir with the stick.\n"
    "Say we're done.\n"
)


def _magic_tomato_salad_demo_steps() -> list[dict[str, Any]]:
    raw_steps: list[dict[str, Any]] = [
        {
            "action": "pick_up",
            "target": "yellow exacto knife",
            "voice_cue": "Yellow knife on the green mat.",
        },
        {
            "action": "chop",
            "target": "chop motion",
            "voice_cue": "Chopping motion.",
        },
        {
            "action": "pick_up",
            "target": "red tomato",
            "voice_cue": "Grabbing the tomato.",
        },
        {
            "action": "pick_up",
            "target": "blue container top",
            "voice_cue": "Over the blue bowl.",
        },
        {
            "action": "stir",
            "target": "stick",
            "voice_cue": "Stirring motion.",
        },
        {
            "action": "talk",
            "target": "demo complete",
            "voice_cue": "Tomato salad demo complete.",
        },
    ]
    validated = _validate_robot_steps(raw_steps)
    return [_merge_servo_into_step(s) for s in validated]


@app.post("/recipes/demo/magic-tomato-salad", response_model=ParseRecipeResponse)
async def demo_magic_tomato_salad() -> ParseRecipeResponse:
    """Theater demo: persist fixed 6-step plan for green-mat hardware (no LLM)."""
    steps = _magic_tomato_salad_demo_steps()
    steps_json = json.dumps(steps)
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO recipes (title, raw_text, steps_json) VALUES (?, ?, ?)",
            ("Master Tomato Salad (demo)", MASTER_TOMATO_SALAD_RAW, steps_json),
        )
        rid = int(cur.lastrowid)
    return ParseRecipeResponse(id=rid, steps=steps)


@app.post("/recipes/parse", response_model=ParseRecipeResponse)
async def parse_recipe(body: ParseRecipeBody) -> ParseRecipeResponse:
    try:
        steps = await _parse_recipe_with_k2(body.recipe)
        steps = [_merge_servo_into_step(s) for s in steps]
    except (
        httpx.HTTPError,
        json.JSONDecodeError,
        ValueError,
        KeyError,
        IndexError,
        TypeError,
    ) as e:
        raise HTTPException(status_code=502, detail=f"Recipe parsing failed: {e}") from e

    steps_json = json.dumps(steps)
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO recipes (title, raw_text, steps_json) VALUES (?, ?, ?)",
            (None, body.recipe, steps_json),
        )
        rid = int(cur.lastrowid)

    return ParseRecipeResponse(id=rid, steps=steps)


class CookResponse(BaseModel):
    ok: bool
    recipe_id: int
    sent: dict[str, Any]


def _step_to_execute_action_payload(step: dict[str, Any]) -> dict[str, Any]:
    """Build robot WebSocket message with servo preset from ACTIONS or merged step."""
    action = str(step.get("action", "")).strip().lower()
    voice_cue = str(step.get("voice_cue") or "")
    if "servo" in step:
        servo: Any = step["servo"]
    else:
        spec = ACTIONS.get(action) or {}
        servo = spec.get("servo")
    return {
        "type": "execute_action",
        "action": action,
        "servo": servo,
        "voice_cue": voice_cue,
    }


class HardwareActionBody(BaseModel):
    action: str = Field(..., min_length=1)


class HardwareActionResponse(BaseModel):
    ok: bool
    sent: dict[str, Any]


@app.post("/hardware/action", response_model=HardwareActionResponse)
async def hardware_action(body: HardwareActionBody) -> HardwareActionResponse:
    """Apply ACTIONS[servo] on the server, then forward to the Pi on /ws/robot."""
    action = body.action.strip().lower()
    if action not in ALLOWED_ROBOT_ACTIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid action {action!r}; "
                f"allowed: {', '.join(sorted(ALLOWED_ROBOT_ACTIONS))}"
            ),
        )
    payload = _step_to_execute_action_payload(
        {
            "action": action,
            "target": "manual",
            "voice_cue": "Manual dock command",
        }
    )
    await send_to_robot(payload)
    return HardwareActionResponse(ok=True, sent=payload)


@app.post("/recipes/{recipe_id}/cook", response_model=CookResponse)
async def cook_recipe(recipe_id: int) -> CookResponse:
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, steps_json FROM recipes WHERE id = ?", (recipe_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Recipe not found")

    raw = json.loads(row["steps_json"])
    if not isinstance(raw, list):
        raise HTTPException(
            status_code=500, detail="Stored recipe steps are not a JSON array"
        )

    executed: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        payload = _step_to_execute_action_payload(item)
        await send_to_robot(payload)
        executed.append(payload)

    summary: dict[str, Any] = {
        "type": "cook_sequence",
        "recipe_id": recipe_id,
        "count": len(executed),
        "steps": executed,
    }
    return CookResponse(ok=True, recipe_id=recipe_id, sent=summary)


@app.websocket("/ws/robot")
async def ws_robot(websocket: WebSocket) -> None:
    global _robot_ws
    await websocket.accept()
    if _robot_ws is not None:
        try:
            await _robot_ws.close(code=4000, reason="Replaced by new robot connection")
        except Exception:
            pass
    _robot_ws = websocket
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                msg = {"type": "raw", "data": raw}
            await broadcast_to_browsers(msg)
    except WebSocketDisconnect:
        pass
    finally:
        if _robot_ws is websocket:
            _robot_ws = None


@app.websocket("/ws/browser")
async def ws_browser(websocket: WebSocket) -> None:
    await websocket.accept()
    _browser_sockets.add(websocket)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                msg = {"type": "browser_message", "data": raw}
            if _robot_ws is not None:
                await _robot_ws.send_text(json.dumps(msg))
    except WebSocketDisconnect:
        pass
    finally:
        _browser_sockets.discard(websocket)


def _default_knot_merchant_id() -> int:
    try:
        return int((os.getenv("KNOT_DEFAULT_MERCHANT_ID") or "19").strip())
    except ValueError:
        return 19


class ProfileSyncBody(BaseModel):
    user_id: str = Field(default="default", min_length=1)
    merchant_id: int | None = None


class ProfileSyncResponse(BaseModel):
    ok: bool = True
    summary: str


@app.post("/profile/sync", response_model=ProfileSyncResponse)
async def profile_sync(body: ProfileSyncBody) -> ProfileSyncResponse:
    """Sync Knot Transaction Link data and persist a SKU-aware food profile summary."""
    merchant_id = (
        body.merchant_id if body.merchant_id is not None else _default_knot_merchant_id()
    )
    try:
        summary = await sync_and_build_summary(
            user_id=body.user_id.strip(),
            merchant_id=merchant_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO user_profiles (user_id, food_profile_summary, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(user_id) DO UPDATE SET
              food_profile_summary = excluded.food_profile_summary,
              updated_at = excluded.updated_at
            """,
            (body.user_id.strip(), summary),
        )

    return ProfileSyncResponse(ok=True, summary=summary)


class SuggestPersonalizedBody(BaseModel):
    user_id: str = Field(default="default", min_length=1)
    user_prompt: str = Field(..., min_length=1)


class SuggestionCard(BaseModel):
    title: str
    description: str
    image_url: Optional[str] = None


class SuggestPersonalizedResponse(BaseModel):
    ok: bool = True
    suggestions: str = ""
    suggestion_cards: list[SuggestionCard] = Field(default_factory=list)


@app.post("/recipes/suggest-personalized", response_model=SuggestPersonalizedResponse)
async def suggest_personalized(body: SuggestPersonalizedBody) -> SuggestPersonalizedResponse:
    """Gemini JSON meal ideas + Pexels — K2 Think stays on POST /recipes/parse only."""
    uid = body.user_id.strip()
    with get_db() as conn:
        row = conn.execute(
            "SELECT food_profile_summary FROM user_profiles WHERE user_id = ?",
            (uid,),
        ).fetchone()
    profile_text = (
        str(row["food_profile_summary"])
        if row is not None and row["food_profile_summary"] is not None
        else ""
    )

    try:
        meals = await _generate_meal_suggestions_gemini(
            user_prompt=body.user_prompt,
            food_profile_summary=profile_text,
        )
    except (
        httpx.HTTPError,
        ValueError,
        KeyError,
        IndexError,
        TypeError,
    ) as e:
        raise HTTPException(
            status_code=502, detail=f"Personalized suggestions failed: {e}"
        ) from e

    cards: list[SuggestionCard] = []
    async with httpx.AsyncClient(timeout=60.0) as px_client:
        for m in meals:
            q = (m.get("search_query") or "").strip()[:120]
            if not q:
                q = (m.get("name") or "food").strip()[:120]
            print(f"SEARCHING PEXELS FOR: {q}", flush=True)
            img_url = await fetch_first_photo_url(query=q, client=px_client)
            cards.append(
                SuggestionCard(
                    title=m["name"],
                    description=m["description"],
                    image_url=img_url,
                )
            )

    suggestions_text = "\n\n".join(
        f"{c.title}: {c.description}" for c in cards
    )
    return SuggestPersonalizedResponse(
        ok=True,
        suggestions=suggestions_text,
        suggestion_cards=cards,
    )
