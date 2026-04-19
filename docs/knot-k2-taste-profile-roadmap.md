# Knot → taste profile → K2: roadmap and checklist

This file tracks **follow-up work** toward the HackPrinceton / flyer “Food Taste Profile” vision. It does **not** change runtime behavior by itself.

## Guardrails (do not break SousChef-Core)

- Do **not** change `_parse_recipe_with_k2` or **`POST /recipes/parse`** (hardware / robot JSON contract).
- New behavior should stay **additive** (new routes, columns, UI sections) unless explicitly migrating data.

## Current pipeline (already in repo)

1. Knot link (SDK) → **`POST /profile/sync`** → Knot **`/transactions/sync`** → `summarize_to_food_profile` → **`user_profiles.food_profile_summary`** (SQLite).
2. **“Personalized ideas”** → **`POST /recipes/suggest-personalized`** → loads profile text → **`_generate_meal_suggestions_k2`** (NL only).

Dev servers: Next **3000**, Knot proxy **3001**, FastAPI **8000** (see `web/README.md`).

---

## Phase A — Validate end-to-end (do this before big UX)

- [ ] **`npm run knot-api`** (from `web/`) + **`npm run dev`** + **`uvicorn`** on **8000** from `backend/`.
- [ ] Link flow completes; browser **Network** shows **`POST …/profile/sync`** → **200** with `{ ok, summary }`.
- [ ] SQLite **`user_profiles`** has a row for `user_id` **`default`** with non-empty **`food_profile_summary`** after sync (when Knot returns data).
- [ ] **`http://localhost:8000/openapi.json`** includes **`/recipes/suggest-personalized`**; **`/docs`** lists it (hard-refresh if cached).
- [ ] **`POST /recipes/suggest-personalized`** with `{"user_id":"default","user_prompt":"…"}` → **200** and `suggestions` text (or **502** only if K2/env fails).

---

## Phase B — Richer profile (data; UI can stay minimal)

- [ ] Optional: persist **sync metadata** (e.g. last sync time, merchant name, cursor) for debugging — new columns or small table; keep **`food_profile_summary`** for K2.
- [ ] Extend **`summarize_to_food_profile`** (or successor) to surface **cuisine / category** signals when Knot payloads include them.
- [ ] **Second merchant** (e.g. grocery): call sync for another **`merchant_id`**, then **merge** summaries or store **tagged sections** (“Delivery” vs “Grocery”) before K2.

---

## Phase C — UX aligned with the flyer (after pipeline is trustworthy)

- [ ] **Taste profile panel**: show stored **summary** + optional **top items** (requires structured data — e.g. JSON blob of top products, not only prose).
- [ ] Optional: **product thumbnails** using `image_url` from Knot line items when present.
- [ ] **Personalized ideas**: prompt **chips** (e.g. meal prep, spicier, budget) + optional “focus on last order” if you store recent line items.
- [ ] **K2**: keep a **single** NL path; optionally prepend **bullet themes** from spend data into the system message.

---

## Phase D — Polish (hackathon / demo)

- [ ] Clear **loading / empty / error** states for link, sync, and personalized ideas.
- [ ] Short **judge script**: env vars, three terminals, test Knot creds, one happy-path demo.

---

## What this repo is *not* yet (intentional scope gap)

- Full **gallery** of real DoorDash orders with photos (needs UI + possibly storing per-item JSON; dev often uses **Knot test credentials**, not personal accounts).
- **DoorDash + grocery** on one screen without Phase B multi-merchant work.

---

## References (Knot)

- [Transaction Link testing](https://docs.knotapi.com/transaction-link/testing) (test usernames/passwords in development).
- [Sync Transactions](https://docs.knotapi.com/api-reference/products/transaction-link/sync.md).
