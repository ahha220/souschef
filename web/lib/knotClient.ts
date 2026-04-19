import KnotapiJS from "knotapi-js";

const DEFAULT_KNOT_API_BASE = "http://localhost:3001";

function knotApiBase(): string {
  return (
    process.env.NEXT_PUBLIC_KNOT_API_BASE?.trim() || DEFAULT_KNOT_API_BASE
  ).replace(/\/$/, "");
}

function clientId(): string {
  const id = process.env.NEXT_PUBLIC_KNOT_CLIENT_ID?.trim();
  if (!id) {
    throw new Error(
      "NEXT_PUBLIC_KNOT_CLIENT_ID is not set. Add it to web/.env.local.",
    );
  }
  return id;
}

function knotEnvironment(): "development" | "production" | "sandbox" {
  const raw = (process.env.NEXT_PUBLIC_KNOT_ENVIRONMENT || "development")
    .trim()
    .toLowerCase();
  if (raw === "production" || raw === "sandbox" || raw === "development") {
    return raw;
  }
  return "development";
}

function merchantIds(): number[] {
  const raw = process.env.NEXT_PUBLIC_KNOT_MERCHANT_IDS?.trim();
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every((x) => typeof x === "number" && Number.isFinite(x))
      ) {
        return parsed;
      }
    } catch {
      /* ignore invalid JSON */
    }
    console.warn(
      "[knot] NEXT_PUBLIC_KNOT_MERCHANT_IDS must be a JSON array of numbers; falling back to [19].",
    );
  }
  return [19];
}

export type InitializeKnotSessionOptions = {
  /** Matches backend /profile/sync and Knot external_user_id (default until auth). */
  userId?: string;
  /** FastAPI base, e.g. http://localhost:8000 */
  profileSyncBaseUrl?: string;
  /** Optional override for DoorDash / merchant used in server sync. */
  merchantId?: number;
  onProfileSynced?: (summary: string) => void;
  onProfileSyncError?: (message: string) => void;
  /** Called when the Knot UI closes or reports an SDK error (end of user flow). */
  onKnotUiClosed?: () => void;
};

/**
 * Creates a Knot session via the Express proxy, opens the Web SDK, and triggers
 * POST /profile/sync on success.
 */
export async function initializeKnotSession(
  options: InitializeKnotSessionOptions = {},
): Promise<void> {
  const userId = options.userId?.trim() || "default";
  const profileBase = (options.profileSyncBaseUrl || "http://localhost:8000")
    .trim()
    .replace(/\/$/, "");

  const createRes = await fetch(`${knotApiBase()}/api/knot/create-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ external_user_id: userId }),
  });

  if (!createRes.ok) {
    const detail = await createRes.text();
    console.error("[knot] create-session failed:", createRes.status, detail);
    throw new Error(
      `Could not create Knot session (${createRes.status}). Check knot-api logs.`,
    );
  }

  const created: { session_id?: string } = await createRes.json();
  const sessionId = created.session_id;
  if (!sessionId) {
    throw new Error("Knot proxy returned no session_id.");
  }

  const knotapi = new KnotapiJS();
  knotapi.open({
    sessionId,
    clientId: clientId(),
    environment: knotEnvironment(),
    product: "transaction_link",
    merchantIds: merchantIds(),
    useCategories: true,
    useSearch: true,
    entryPoint: "souschef_recipe_lab",
    onSuccess: () => {
      void (async () => {
        try {
          const syncRes = await fetch(`${profileBase}/profile/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_id: userId,
              merchant_id: options.merchantId,
            }),
          });
          const payload: unknown = await syncRes.json().catch(() => ({}));
          if (!syncRes.ok) {
            const detail =
              payload &&
              typeof payload === "object" &&
              "detail" in payload &&
              typeof (payload as { detail: unknown }).detail === "string"
                ? (payload as { detail: string }).detail
                : syncRes.statusText;
            throw new Error(detail);
          }
          const summary =
            payload &&
            typeof payload === "object" &&
            "summary" in payload &&
            typeof (payload as { summary: unknown }).summary === "string"
              ? (payload as { summary: string }).summary
              : "";
          options.onProfileSynced?.(summary);
        } catch (e) {
          const msg =
            e instanceof Error ? e.message : "Profile sync after Knot failed.";
          console.error("[knot] profile sync:", msg);
          options.onProfileSyncError?.(msg);
        }
      })();
    },
    onError: (err) => {
      console.error("[knot] onError", err.errorCode, err.errorDescription);
      options.onKnotUiClosed?.();
    },
    onExit: () => {
      console.log("[knot] onExit");
      options.onKnotUiClosed?.();
    },
    onEvent: (ev) => {
      console.log("[knot] onEvent", ev.event, ev.merchant, ev.merchantId);
    },
  });
}
