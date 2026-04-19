"""
Knot Transaction Link: server-side sync and food-profile summarization.
See https://docs.knotapi.com/api-reference/products/transaction-link/sync.md
"""

from __future__ import annotations

import base64
import os
import re
from collections import Counter
from typing import Any, Optional

import httpx

_STOPWORDS = {
    "that",
    "this",
    "with",
    "from",
    "your",
    "have",
    "will",
    "been",
    "were",
    "they",
    "their",
    "there",
    "about",
    "which",
    "while",
    "where",
    "after",
    "before",
    "other",
    "into",
    "than",
    "then",
    "some",
    "such",
    "each",
    "made",
    "make",
    "also",
    "using",
    "used",
    "very",
    "just",
    "more",
    "most",
    "many",
    "much",
    "only",
    "even",
}


def _knot_basic_auth_header(client_id: str, secret: str) -> str:
    raw = f"{client_id}:{secret}".encode("utf-8")
    return "Basic " + base64.b64encode(raw).decode("ascii")


def _knot_base_url() -> str:
    return os.getenv("KNOT_API_BASE", "https://api.knotapi.com").rstrip("/")


def _tokens_from_text(text: str) -> list[str]:
    return [
        t
        for t in re.findall(r"[a-zA-Z]{4,}", text.lower())
        if t not in _STOPWORDS
    ]


def summarize_to_food_profile(
    *,
    merchant_name: Optional[str],
    transactions: list[dict[str, Any]],
) -> str:
    """
    Prefer SKU / line-item fields (product name, description) when present;
    fall back to merchant-level context when line items are sparse.
    """
    if not transactions:
        return (
            "No transactions returned yet. After you link a merchant in Knot, "
            "run sync again; production flows often use NEW_TRANSACTIONS_AVAILABLE webhooks."
        )

    product_names: list[str] = []
    desc_chunks: list[str] = []
    for tx in transactions:
        products = tx.get("products")
        if not isinstance(products, list):
            continue
        for p in products:
            if not isinstance(p, dict):
                continue
            name = p.get("name")
            if isinstance(name, str) and name.strip():
                product_names.append(name.strip())
            desc = p.get("description")
            if isinstance(desc, str) and desc.strip():
                desc_chunks.append(desc.strip())

    name_counts = Counter(product_names)
    top_names = [n for n, _ in name_counts.most_common(8)]

    token_counts: Counter[str] = Counter()
    for chunk in desc_chunks:
        token_counts.update(_tokens_from_text(chunk))
    top_tokens = [w for w, _ in token_counts.most_common(12)]

    merchant = (merchant_name or "").strip() or "linked merchant"

    lines: list[str] = [
        f"Spend signals from {merchant} ({len(transactions)} transaction(s) in this batch).",
    ]

    if top_names:
        lines.append(
            "Frequently purchased items (from line-item names): "
            + ", ".join(top_names[:6])
            + ("." if len(top_names) <= 6 else " …")
        )
    else:
        lines.append(
            "Line-item product names were sparse; merchant/category-level patterns only."
        )

    if top_tokens:
        lines.append(
            "Ingredient-like tokens from descriptions/SKU text: "
            + ", ".join(top_tokens[:10])
            + "."
        )
    elif desc_chunks:
        lines.append(
            "Descriptions were present but did not yield strong ingredient tokens after filtering."
        )
    else:
        lines.append(
            "No per-item descriptions in this batch — tastes may be inferred only from merchants and totals."
        )

    lines.append(
        "Note: When Knot returns coarse aggregates for a merchant, this summary stays honest about what was observed."
    )
    return "\n".join(lines)


async def sync_transactions_all(
    *,
    merchant_id: int,
    external_user_id: str,
    client_id: str,
    client_secret: str,
) -> tuple[list[dict[str, Any]], Optional[str]]:
    """POST /transactions/sync with cursor pagination until next_cursor is null."""
    auth = _knot_basic_auth_header(client_id, client_secret)
    base = _knot_base_url()
    headers = {
        "Authorization": auth,
        "Content-Type": "application/json",
    }

    aggregated: list[dict[str, Any]] = []
    cursor: Optional[str] = None
    merchant_label: Optional[str] = None

    async with httpx.AsyncClient(timeout=120.0) as client:
        for _ in range(80):
            body: dict[str, Any] = {
                "merchant_id": merchant_id,
                "external_user_id": external_user_id,
                "limit": 100,
            }
            if cursor:
                body["cursor"] = cursor

            r = await client.post(f"{base}/transactions/sync", headers=headers, json=body)

            try:
                data = r.json()
            except ValueError as e:
                snippet = (r.text or "")[:800]
                raise ValueError(
                    f"Knot sync returned non-JSON (HTTP {r.status_code}): {snippet}"
                ) from e

            if not r.is_success:
                err_msg = None
                if isinstance(data, dict):
                    err_msg = data.get("error_message") or data.get("message")
                raise ValueError(
                    f"Knot sync failed HTTP {r.status_code}: {err_msg or r.text[:800]}"
                )

            if isinstance(data, dict):
                m = data.get("merchant")
                if isinstance(m, dict):
                    nm = m.get("name")
                    if isinstance(nm, str) and nm.strip():
                        merchant_label = nm.strip()

                txs = data.get("transactions")
                if isinstance(txs, list):
                    aggregated.extend(
                        [t for t in txs if isinstance(t, dict)]
                    )

                nc = data.get("next_cursor")
                if nc is None or nc == "":
                    break
                cursor = str(nc)
            else:
                raise ValueError(f"Unexpected Knot sync payload: {data!r}")

    return aggregated, merchant_label


async def sync_and_build_summary(
    *,
    user_id: str,
    merchant_id: int,
) -> str:
    client_id = (os.getenv("KNOT_CLIENT_ID") or "").strip()
    secret = (os.getenv("KNOT_CLIENT_SECRET") or "").strip()
    if not client_id or not secret:
        raise ValueError(
            "KNOT_CLIENT_ID and KNOT_CLIENT_SECRET must be set in backend/.env for Knot sync."
        )

    txs, merchant_name = await sync_transactions_all(
        merchant_id=merchant_id,
        external_user_id=user_id,
        client_id=client_id,
        client_secret=secret,
    )
    return summarize_to_food_profile(merchant_name=merchant_name, transactions=txs)
