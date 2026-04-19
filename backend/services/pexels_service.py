"""
Pexels Photos API — optional images for meal suggestion cards.
https://www.pexels.com/api/documentation/
"""

from __future__ import annotations

import os
from typing import Optional

import httpx

_PEXELS_SEARCH = "https://api.pexels.com/v1/search"


async def fetch_first_photo_url(
    *,
    query: str,
    client: httpx.AsyncClient,
) -> Optional[str]:
    """Return medium JPEG URL for the first search result, or None on any failure."""
    key = (os.getenv("PEXELS_API_KEY") or "").strip()
    q = (query or "").strip()
    if not key or not q:
        return None

    try:
        r = await client.get(
            _PEXELS_SEARCH,
            headers={"Authorization": key},
            params={"query": q, "per_page": 1, "orientation": "landscape"},
            timeout=15.0,
        )
        if not r.is_success:
            return None
        data = r.json()
    except (httpx.RequestError, ValueError, TypeError, KeyError):
        return None

    photos = data.get("photos")
    if not isinstance(photos, list) or not photos:
        return None
    first = photos[0]
    if not isinstance(first, dict):
        return None
    src = first.get("src")
    if not isinstance(src, dict):
        return None
    for k in ("medium", "large", "small"):
        url = src.get(k)
        if isinstance(url, str) and url.startswith("http"):
            return url
    return None
