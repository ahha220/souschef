/**
 * Express server: POST /api/knot/create-session
 * Proxies Knot Create Session with Basic Auth (KNOT_CLIENT_ID : KNOT_CLIENT_SECRET).
 *
 * Run: npm run knot-api (from web/)
 * Default port: 3001 (override with KNOT_API_PORT)
 */
const path = require("path");
const express = require("express");
const cors = require("cors");
require("dotenv").config({
  path: path.join(__dirname, "..", ".env.local"),
});
require("dotenv").config({
  path: path.join(__dirname, "..", ".env"),
});
require("dotenv").config({
  path: path.join(__dirname, "..", "..", "backend", ".env"),
});

/** Knot development host by default; override with KNOT_CREATE_SESSION_URL (e.g. production). */
const KNOT_CREATE_SESSION_URL =
  process.env.KNOT_CREATE_SESSION_URL ||
  "https://development.knotapi.com/session/create";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.post("/api/knot/create-session", async (req, res) => {
  const externalUserIdRaw =
    req.body &&
    typeof req.body.external_user_id === "string" &&
    req.body.external_user_id.trim()
      ? req.body.external_user_id.trim()
      : "default";

  const clientId = process.env.KNOT_CLIENT_ID;
  const clientSecret = process.env.KNOT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(
      "[knot-api] Missing KNOT_CLIENT_ID or KNOT_CLIENT_SECRET in environment.",
    );
    return res.status(500).json({
      error: "Server misconfiguration",
      detail:
        "KNOT_CLIENT_ID and KNOT_CLIENT_SECRET must be set (e.g. backend/.env or web/.env.local).",
    });
  }

  // Authorization: Basic base64( KNOT_CLIENT_ID + ":" + KNOT_CLIENT_SECRET )
  const basic = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString(
    "base64",
  );

  try {
    const response = await fetch(KNOT_CREATE_SESSION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${basic}`,
      },
      body: JSON.stringify({
        type: "transaction_link",
        external_user_id: externalUserIdRaw,
      }),
    });

    const rawText = await response.text();
    console.log("[knot-api] Knot response status:", response.status);

    let data;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (parseErr) {
      console.error(
        "[knot-api] Knot returned non-JSON body (first 100 chars):",
        rawText ? rawText.slice(0, 100) : "",
      );
      return res.status(502).json({
        error: "Invalid response from Knot",
        detail: rawText?.slice(0, 200) || String(parseErr),
      });
    }

    if (!response.ok) {
      console.error(
        "[knot-api] Knot API error:",
        response.status,
        response.statusText,
        data,
      );
      return res.status(response.status >= 400 ? response.status : 502).json({
        error: "Knot API request failed",
        status: response.status,
        detail: data,
      });
    }

    const sessionId =
      data.session ??
      data.session_id ??
      data.sessionId ??
      data.id ??
      data.data?.session ??
      data.data?.session_id ??
      data.data?.id;

    if (!sessionId) {
      console.error(
        "[knot-api] Knot response missing session_id. Body:",
        JSON.stringify(data),
      );
      return res.status(502).json({
        error: "Unexpected Knot response",
        detail: "No session_id in response",
        raw: data,
      });
    }

    console.log("[knot-api] Session created:", String(sessionId).slice(0, 8) + "…");
    return res.json({ session_id: sessionId });
  } catch (err) {
    console.error("[knot-api] Request failed:", err);
    return res.status(500).json({
      error: "Failed to reach Knot API",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

const port = Number(process.env.KNOT_API_PORT || 3001);
app.listen(port, () => {
  console.log(`[knot-api] Listening on http://127.0.0.1:${port}`);
  console.log(`[knot-api] POST http://127.0.0.1:${port}/api/knot/create-session`);
  console.log(`[knot-api] Knot create-session URL: ${KNOT_CREATE_SESSION_URL}`);
});
