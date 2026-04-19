# SousChef web (Next.js)

## Local development (three processes)

Run these in separate terminals from the repo:

1. **FastAPI** (often **8001** when using `backend/scripts/start-uvicorn.ps1`; or **8000** if you pass `-Port 8000`): see `backend/README.md`.
2. **Knot session proxy** (port **3001**): `npm run knot-api` from this `web/` directory. Uses `KNOT_CLIENT_ID` / `KNOT_CLIENT_SECRET` from `web/.env.local`, `web/.env`, or `backend/.env`.
3. **Next.js** (port **3000**): `npm run dev` from this `web/` directory.

Set `NEXT_PUBLIC_KNOT_CLIENT_ID` and `NEXT_PUBLIC_KNOT_ENVIRONMENT` in `web/.env.local` so they match the Knot dashboard for that client ID. Point `NEXT_PUBLIC_KNOT_API_BASE` at `http://localhost:3001` when using the local proxy.

If the Knot Web SDK logs `INVALID_CLIENT_ID`, the public client ID and `environment` flag do not match the dashboard environment for that key.

Roadmap / checklist for Knot → taste profile → K2 follow-ups: `../docs/knot-k2-taste-profile-roadmap.md`.

Optional: **`NEXT_PUBLIC_API_BASE`** — override FastAPI URL if the backend runs on another host/port (e.g. `http://127.0.0.1:8001`). Defaults to `http://localhost:8000`. If you change the port, set **`NEXT_PUBLIC_WS_URL`** to match (e.g. `ws://127.0.0.1:8001/ws/browser`).
