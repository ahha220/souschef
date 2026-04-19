# SousChef backend (FastAPI)

## Run the API (full `main.py` with Knot + K2 routes)

**Important:** Only **one** process should listen on port **8000**. If an old copy of the app is still bound, `/health` will show only `{"status":"ok"}` (no `build`) and `openapi.json` will **not** list `/recipes/suggest-personalized` — even if you just started a **second** terminal with the new code.

### Option A — Free port, then uvicorn (recommended on Windows)

From **repo root**:

```powershell
powershell -ExecutionPolicy Bypass -File .\backend\scripts\free-port-8000.ps1
cd backend
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### Option B — One script (free + start)

```powershell
powershell -ExecutionPolicy Bypass -File .\backend\scripts\start-uvicorn.ps1
```

Defaults to port **8001** (and frees it first) so you are not stuck behind another listener on **8000**. Use `-Port 8000` if that port is truly free. Set **`web/.env.local`** `NEXT_PUBLIC_API_BASE` / `NEXT_PUBLIC_WS_URL` to the same host and port.

(Run from repo root; adjust path if you `cd` elsewhere.)

### Option C — Manual `cd` only (if port is already free)

```powershell
cd C:\Users\ninip\OneDrive\Documents\SousChef-Core\backend
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Startup logs should include:

- `[routes] build=souschef-knot-k2-v1`
- A line with `/recipes/suggest-personalized`

## Verify you have the **full** app

| Check | Expected |
|--------|----------|
| `GET http://127.0.0.1:8000/health` | JSON includes **`"build":"souschef-knot-k2-v1"`** |
| `GET http://127.0.0.1:8000/openapi.json` | Paths include **`/recipes/suggest-personalized`** and **`/profile/sync`** |

If `build` is missing: the request is **not** reaching this repo’s current `main.py` — free port **8000** and restart (Option A).

**Use an external browser or curl** if the IDE embedded browser caches an old response; hard-refresh (Ctrl+F5).

## If port 8000 cannot be freed

Run the API on **8001** and point the web app at it:

1. `python -m uvicorn main:app --reload --host 127.0.0.1 --port 8001`
2. In `web/.env.local` add:  
   `NEXT_PUBLIC_API_BASE=http://127.0.0.1:8001`  
   (and `NEXT_PUBLIC_WS_URL=ws://127.0.0.1:8001/ws/browser` for the robot WebSocket)
3. Restart `npm run dev`.

## SQLite profile check

From `backend/`:

```powershell
python scripts\print_user_profile.py
```
