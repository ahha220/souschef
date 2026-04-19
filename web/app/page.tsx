"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type MouseEvent,
  type FocusEvent,
} from "react";
import { Quicksand } from "next/font/google";
import { useRobotSocket } from "@/hooks/useRobotSocket";

const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000"
).replace(/\/$/, "");
const PARSE_URL = `${API_BASE}/recipes/parse`;
const DEMO_MAGIC_TOMATO_URL = `${API_BASE}/recipes/demo/magic-tomato-salad`;
const HARDWARE_ACTION_URL = `${API_BASE}/hardware/action`;
const SUGGEST_PERSONALIZED_URL = `${API_BASE}/recipes/suggest-personalized`;

/** Set NEXT_PUBLIC_DEMO_THEATER=true in web/.env.local for judge demo (PDF drop zone, hide action dock). */
const isDemoTheater =
  process.env.NEXT_PUBLIC_DEMO_THEATER === "true" ||
  process.env.NEXT_PUBLIC_DEMO_THEATER === "1";

/** Shown in textarea after fake PDF scan; must match backend MASTER_TOMATO_SALAD_RAW narrative. */
const MASTER_TOMATO_SALAD = `Master Tomato Salad — Green Mat Demo

Pick up the yellow exacto knife from the mat.
Perform a chopping motion.
Pick up the red tomato.
Move to the blue container top and release.
Stir with the stick.
Say we're done.
`;

const DEMO_SCAN_MESSAGES = [
  "Analyzing handwriting...",
  "OCR extraction in progress...",
  "Normalizing ingredients...",
] as const;
/** Slightly longer than backend httpx timeout so abort surfaces as timeout first */
const PARSE_TIMEOUT_MS = 125_000;

type RobotStep = {
  action?: string;
  target?: string;
  voice_cue?: string;
  instruction?: string;
  servo?: number[] | null;
};

function formatActionLabel(action?: string): string {
  if (!action) return "";
  return action.replaceAll("_", " ").toUpperCase();
}

const ACTION_EMOJI: Record<string, string> = {
  listen: "🎤",
  talk: "💬",
  chop: "🔪",
  stir: "🥣",
  pick_up: "🦾",
};

function actionEmoji(action?: string): string {
  if (!action) return "⚙️";
  return ACTION_EMOJI[action.toLowerCase()] ?? "⚙️";
}

function formatServoPreview(servo: RobotStep["servo"]): string {
  if (servo === undefined) return "";
  if (servo === null) return "[null]";
  if (Array.isArray(servo)) return `[${servo.join(", ")}]`;
  return String(servo);
}

function formatTypeLabel(type?: string): string {
  if (!type) return "NOTE";
  return type.replaceAll("_", " ").toUpperCase();
}

async function readHttpError(res: Response): Promise<string> {
  try {
    const j: unknown = await res.json();
    if (
      j &&
      typeof j === "object" &&
      "detail" in j &&
      typeof (j as { detail: unknown }).detail === "string"
    ) {
      return (j as { detail: string }).detail;
    }
  } catch {
    /* ignore */
  }
  return res.statusText || "Request failed";
}

const quicksand = Quicksand({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

/** Emoji Kitchen assets (Google static CDN) */
const IMG_CHEF_SUE =
  "https://www.gstatic.com/android/keyboard/emojikitchen/20220506/u1fa84/u1fa84_u1f373.png";
const IMG_MEAL_JOURNAL =
  "https://www.gstatic.com/android/keyboard/emojikitchen/20240530/u1f358/u1f358_u1f601.png";
const IMG_CURRENT_RECIPE =
  "https://www.gstatic.com/android/keyboard/emojikitchen/20240206/u1f957/u1f957_u1f61a.png";
const IMG_RECENT_EVENTS =
  "https://www.gstatic.com/android/keyboard/emojikitchen/20250130/u1f642-u200d-u2195-ufe0f/u1f642-u200d-u2195-ufe0f_u1f9c0.png";

const QUICK_START = {
  tomato:
    "Chop the tomatoes, stir them in a bowl with olive oil, and talk to me when you're done.",
  pasta:
    "Boil salted water, stir the pasta until tender, then listen for when it is ready to drain.",
  oats:
    "Pick up the oats, stir them into warm milk, and talk when breakfast is cozy.",
} as const;

const stickerBtn =
  "rounded-full border border-white/35 bg-white/20 px-3 py-1.5 text-left text-[11px] font-bold text-slate-800 shadow-md backdrop-blur-md transition hover:bg-white/35 hover:shadow-lg active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 sm:text-xs";

type DashboardCardId = "journal" | "recipe" | "events";

function dashboardStackZ(
  id: DashboardCardId,
  focused: DashboardCardId | null,
): number {
  if (focused === id) return 50;
  switch (id) {
    case "journal":
      return 10;
    case "recipe":
      return 20;
    case "events":
      return 30;
    default:
      return 10;
  }
}

function friendlyStatus(state: string): string {
  switch (state) {
    case "connecting":
      return "Waking up your sous chef...";
    case "open":
      return "SousChef is listening!";
    case "closed":
      return "Resting for the next meal";
    case "error":
      return "Oops, let us try again";
    default:
      return "Hello!";
  }
}

export default function Home() {
  const { connectionState, lastEvents } = useRobotSocket();
  const eventsList = lastEvents ?? [];

  const [recipeText, setRecipeText] = useState("");
  const [recipeSteps, setRecipeSteps] = useState<RobotStep[] | null>(null);
  const [recipeId, setRecipeId] = useState<number | null>(null);
  const [parseLoading, setParseLoading] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [cookLoading, setCookLoading] = useState(false);
  const [cookHint, setCookHint] = useState<string | null>(null);
  const [dockError, setDockError] = useState<string | null>(null);
  const [dockLoading, setDockLoading] = useState(false);
  const [knotLoading, setKnotLoading] = useState(false);
  const [knotHint, setKnotHint] = useState<string | null>(null);
  const [personalizedPrompt, setPersonalizedPrompt] = useState("");
  const [personalizedLoading, setPersonalizedLoading] = useState(false);
  const [personalizedError, setPersonalizedError] = useState<string | null>(null);
  const [personalizedResult, setPersonalizedResult] = useState<string | null>(null);
  const [personalizedCards, setPersonalizedCards] = useState<
    {
      title: string;
      description: string;
      image_url?: string | null;
    }[]
  >([]);
  const [demoUploading, setDemoUploading] = useState(false);
  const [demoStatusMsg, setDemoStatusMsg] = useState("");
  const [focusedCard, setFocusedCard] = useState<DashboardCardId | null>(null);
  const demoFileInputRef = useRef<HTMLInputElement>(null);
  const demoTimersRef = useRef<ReturnType<typeof globalThis.setTimeout>[]>([]);

  const clearDemoTimers = useCallback(() => {
    for (const t of demoTimersRef.current) {
      globalThis.clearTimeout(t);
    }
    demoTimersRef.current = [];
  }, []);

  const handleDashboardCardBlur = useCallback(
    (e: FocusEvent<HTMLElement>) => {
      const deck = e.currentTarget.parentElement;
      if (!deck) return;
      const next = e.relatedTarget;
      if (next instanceof Node && deck.contains(next)) return;
      setFocusedCard(null);
    },
    [],
  );

  useEffect(
    () => () => {
      clearDemoTimers();
    },
    [clearDemoTimers],
  );

  const glassCard =
    "rounded-[2.5rem] border border-white/30 bg-white/20 shadow-2xl shadow-slate-900/15 backdrop-blur-xl [-webkit-backdrop-filter:blur(24px)]";

  const runDemoMagicTomatoSalad = useCallback(async () => {
    setParseError(null);
    setCookHint(null);
    setParseLoading(true);
    try {
      const res = await fetch(DEMO_MAGIC_TOMATO_URL, {
        method: "POST",
        headers: { "ngrok-skip-browser-warning": "true" },
      });
      if (!res.ok) {
        throw new Error(await readHttpError(res));
      }
      const data: { id: number; steps: RobotStep[] } = await res.json();
      console.log("Demo green-mat plan:", data.steps);
      setRecipeId(data.id);
      setRecipeSteps(data.steps);
    } catch (e) {
      setRecipeSteps(null);
      setRecipeId(null);
      setParseError(
        e instanceof Error ? e.message : "Demo recipe could not load.",
      );
    } finally {
      setParseLoading(false);
    }
  }, []);

  const runDemoTheaterScan = useCallback(() => {
    clearDemoTimers();
    setRecipeSteps(null);
    setRecipeId(null);
    setParseError(null);
    setCookHint(null);
    setDemoUploading(true);
    setDemoStatusMsg(DEMO_SCAN_MESSAGES[0]);
    demoTimersRef.current.push(
      globalThis.setTimeout(() => {
        setDemoStatusMsg(DEMO_SCAN_MESSAGES[1]);
      }, 1000),
    );
    demoTimersRef.current.push(
      globalThis.setTimeout(() => {
        setDemoStatusMsg(DEMO_SCAN_MESSAGES[2]);
      }, 2000),
    );
    demoTimersRef.current.push(
      globalThis.setTimeout(() => {
        setDemoUploading(false);
        setRecipeText(MASTER_TOMATO_SALAD);
        void runDemoMagicTomatoSalad();
      }, 3000),
    );
  }, [clearDemoTimers, runDemoMagicTomatoSalad]);

  async function handleMagicParse() {
    setParseError(null);
    setCookHint(null);
    const trimmed = recipeText.trim();
    if (!trimmed) {
      setParseError("Add a few lines about your dish first.");
      return;
    }
    setParseLoading(true);
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(
      () => controller.abort(),
      PARSE_TIMEOUT_MS,
    );
    try {
      const res = await fetch(PARSE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify({ recipe: trimmed }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(await readHttpError(res));
      }
      const data: { id: number; steps: RobotStep[] } = await res.json();
      console.log("Raw K2 Response:", data.steps);
      setRecipeId(data.id);
      setRecipeSteps(data.steps);
    } catch (e) {
      setRecipeSteps(null);
      setRecipeId(null);
      const aborted =
        (typeof DOMException !== "undefined" &&
          e instanceof DOMException &&
          e.name === "AbortError") ||
        (e instanceof Error && e.name === "AbortError");
      if (aborted) {
        setParseError(
          `Request timed out after ${PARSE_TIMEOUT_MS / 1000}s. The kitchen brain may be busy — check the backend logs and try again.`,
        );
      } else {
        setParseError(
          e instanceof Error ? e.message : "Could not reach the kitchen brain.",
        );
      }
    } finally {
      globalThis.clearTimeout(timeoutId);
      setParseLoading(false);
    }
  }

  async function handleLinkSpending() {
    setKnotHint(null);
    setKnotLoading(true);
    try {
      const { initializeKnotSession } = await import("@/lib/knotClient");
      await initializeKnotSession({
        profileSyncBaseUrl: API_BASE,
        onKnotUiClosed: () => setKnotLoading(false),
        onProfileSynced: (summary) => {
          setKnotHint(
            summary
              ? `Profile saved: ${summary.slice(0, 140)}${summary.length > 140 ? "…" : ""}`
              : "Profile sync finished.",
          );
        },
        onProfileSyncError: (msg) => {
          setKnotHint(msg);
        },
      });
    } catch (e) {
      setKnotLoading(false);
      setKnotHint(
        e instanceof Error ? e.message : "Could not start Knot link flow.",
      );
    }
  }

  async function handlePersonalizedIdeas() {
    const trimmed = personalizedPrompt.trim();
    setPersonalizedError(null);
    setPersonalizedResult(null);
    setPersonalizedCards([]);
    if (!trimmed) {
      setPersonalizedError(
        "Add a short prompt (for example: healthy weeknight dinners).",
      );
      return;
    }
    setPersonalizedLoading(true);
    try {
      const res = await fetch(SUGGEST_PERSONALIZED_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify({ user_id: "default", user_prompt: trimmed }),
      });
      if (!res.ok) {
        throw new Error(await readHttpError(res));
      }
      const data: {
        suggestions?: string;
        suggestion_cards?: {
          title: string;
          description: string;
          image_url?: string | null;
        }[];
      } = await res.json();
      setPersonalizedResult(data.suggestions ?? "");
      setPersonalizedCards(
        Array.isArray(data.suggestion_cards) ? data.suggestion_cards : [],
      );
    } catch (e) {
      setPersonalizedError(
        e instanceof Error ? e.message : "Could not load suggestions.",
      );
    } finally {
      setPersonalizedLoading(false);
    }
  }

  async function handleHardwareAction(action: string) {
    setDockError(null);
    setDockLoading(true);
    try {
      const res = await fetch(HARDWARE_ACTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        throw new Error(await readHttpError(res));
      }
    } catch (e) {
      setDockError(
        e instanceof Error ? e.message : "Hardware request failed.",
      );
    } finally {
      setDockLoading(false);
    }
  }

  async function handleCook() {
    if (recipeId == null) return;
    setCookHint(null);
    setCookLoading(true);
    try {
      const res = await fetch(`${API_BASE}/recipes/${recipeId}/cook`, {
        method: "POST",
        headers: { "ngrok-skip-browser-warning": "true" },
      });
      if (!res.ok) {
        throw new Error(await readHttpError(res));
      }
      setCookHint("Your plan is on its way to the robot.");
    } catch (e) {
      setCookHint(e instanceof Error ? e.message : "Could not start cooking.");
    } finally {
      setCookLoading(false);
    }
  }

  function handleEditRecipe() {
    setRecipeSteps(null);
    setRecipeId(null);
    setCookHint(null);
    setParseError(null);
  }

  /**
   * Quick Start stickers: textarea only. No fetch, no WebSocket, no cook.
   * K2 parse runs only via Magic Parse; robot cook only via Cooking after parse.
   */
  function fillQuickStartText(text: string) {
    setRecipeText(text);
    setRecipeSteps(null);
    setRecipeId(null);
    setParseError(null);
    setCookHint(null);
  }

  function onQuickStartClick(e: MouseEvent<HTMLButtonElement>, text: string) {
    e.preventDefault();
    e.stopPropagation();
    fillQuickStartText(text);
  }

  const hasParsedSteps =
    recipeId != null &&
    recipeSteps != null &&
    recipeSteps.length > 0;

  return (
    <div className={`${quicksand.className} relative min-h-dvh antialiased`}>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-mesh-back overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-pink-200/95 via-violet-100/90 to-emerald-100/95" />
        <div className="absolute -left-[18%] -top-[12%] h-[min(72vw,30rem)] w-[min(72vw,30rem)] animate-blob rounded-full bg-fuchsia-300/45 blur-3xl" />
        <div className="absolute -right-[12%] top-[8%] h-[min(68vw,28rem)] w-[min(68vw,28rem)] animate-blobSlow rounded-full bg-emerald-300/40 blur-3xl" />
        <div className="absolute bottom-[-8%] left-[10%] h-[min(78vw,32rem)] w-[min(78vw,32rem)] animate-blobDelayed rounded-full bg-rose-200/50 blur-3xl" />
        <div
          className="absolute bottom-[18%] right-[8%] h-[min(58vw,24rem)] w-[min(58vw,24rem)] animate-blob rounded-full bg-violet-300/35 blur-3xl"
          style={{ animationDelay: "5s" }}
        />
      </div>

      {/* Main column: zones 1–2 + in-flow dock (zone 3) */}
      <div className="relative z-content flex min-h-dvh flex-col overflow-x-hidden px-3 pb-8 pt-8 sm:px-6">
        <header className="relative z-float-ui mx-auto mb-8 w-full max-w-3xl shrink-0 pr-24 text-center sm:mb-10 sm:pr-32">
          <h1 className="text-3xl font-bold tracking-tight text-slate-800 sm:text-5xl md:text-6xl">
            SousChef Command
          </h1>
          <p className="mt-4 text-base font-semibold text-slate-600 sm:text-lg">
            <span
              className={`inline-flex items-center rounded-full border border-white/30 ${glassCard} px-5 py-2 text-base text-violet-950 shadow-glass`}
            >
              {friendlyStatus(connectionState)}
            </span>
          </p>
        </header>

        {/* ZONE 1: three glass cards in a layered 3D stack (z-planes + focus) */}
        <div
          className="relative mx-auto mb-2 min-h-[min(32rem,78svh)] w-full max-w-7xl px-1 perspective-[1200px] sm:min-h-[min(30rem,76svh)] sm:px-2"
          onMouseLeave={() => setFocusedCard(null)}
        >
          {/* Meal Journal */}
          <div
            role="group"
            aria-labelledby="dashboard-meal-journal-title"
            tabIndex={0}
            style={{ zIndex: dashboardStackZ("journal", focusedCard) }}
            onMouseEnter={() => setFocusedCard("journal")}
            onClick={() => setFocusedCard("journal")}
            onFocus={() => setFocusedCard("journal")}
            onBlur={handleDashboardCardBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setFocusedCard("journal");
              }
            }}
            className={`pointer-events-auto absolute left-2 top-7 flex min-h-0 min-w-0 w-[min(19rem,calc(100vw-2rem))] -rotate-2 flex-col ${glassCard} px-5 pb-6 pt-7 shadow-glassDeep transition-all duration-300 ease-out will-change-transform [transform-style:preserve-3d] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 sm:left-[7%] sm:top-8 sm:w-[min(22rem,90vw)] md:-rotate-3 ${
              focusedCard === "journal"
                ? "scale-[1.03] shadow-[0_22px_50px_rgba(15,23,42,0.18)]"
                : "hover:scale-[1.015] hover:shadow-[0_18px_40px_rgba(15,23,42,0.12)]"
            } max-h-[min(70vh,28rem)] overflow-y-auto sm:max-h-none sm:overflow-visible`}
          >
            <div className="flex shrink-0 items-start gap-3">
              <div className="h-14 w-14 shrink-0 sm:h-16 sm:w-16">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={IMG_MEAL_JOURNAL}
                  alt=""
                  width={64}
                  height={64}
                  className="h-full w-full object-contain drop-shadow-md"
                />
              </div>
              <div className="min-w-0 pt-0.5">
                <h2
                  id="dashboard-meal-journal-title"
                  className="text-lg font-bold leading-tight text-slate-800 sm:text-xl md:text-2xl"
                >
                  Meal Journal
                </h2>
                <p className="mt-1 text-[0.65rem] font-bold uppercase tracking-[0.2em] text-slate-500">
                  your food story
                </p>
              </div>
            </div>
            <ul className="mt-5 space-y-3 text-sm font-medium leading-relaxed text-slate-700">
              <li
                className={`rounded-2xl border border-white/25 bg-white/15 px-3 py-2.5 ${glassCard}`}
              >
                <span className="font-semibold text-violet-800">Today: </span>
                hungry and hopeful
              </li>
              <li
                className={`rounded-2xl border border-white/25 bg-white/12 px-3 py-2.5 ${glassCard}`}
              >
                <span className="font-semibold text-emerald-800">
                  Yesterday:{" "}
                </span>
                empty - add a recipe when you are ready
              </li>
              <li className="rounded-2xl border border-dashed border-slate-400/20 bg-white/10 px-3 py-3 text-slate-600">
                Your robot will fill this in after the next cook
              </li>
            </ul>
          </div>

          {/* Current Recipe (status only; input lives in Zone 2) */}
          <div
            role="group"
            aria-labelledby="dashboard-current-recipe-title"
            tabIndex={0}
            style={{ zIndex: dashboardStackZ("recipe", focusedCard) }}
            onMouseEnter={() => setFocusedCard("recipe")}
            onClick={() => setFocusedCard("recipe")}
            onFocus={() => setFocusedCard("recipe")}
            onBlur={handleDashboardCardBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setFocusedCard("recipe");
              }
            }}
            className={`pointer-events-auto absolute left-1/2 top-10 flex min-h-0 min-w-0 w-[min(22rem,calc(100vw-1.25rem))] -translate-x-1/2 rotate-1 flex-col ${glassCard} px-5 pb-6 pt-7 shadow-glassDeep transition-all duration-300 ease-out will-change-transform [transform-style:preserve-3d] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 sm:top-12 ${
              focusedCard === "recipe"
                ? "scale-[1.03] shadow-[0_22px_50px_rgba(15,23,42,0.18)]"
                : "hover:scale-[1.015] hover:shadow-[0_18px_40px_rgba(15,23,42,0.12)]"
            } max-h-[min(70vh,28rem)] overflow-y-auto sm:max-h-none sm:overflow-visible`}
          >
            <div className="flex shrink-0 items-start gap-3">
              <div className="h-14 w-14 shrink-0 sm:h-16 sm:w-16">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={IMG_CURRENT_RECIPE}
                  alt=""
                  width={64}
                  height={64}
                  className="h-full w-full object-contain drop-shadow-md"
                />
              </div>
              <div className="min-w-0 pt-0.5">
                <h2
                  id="dashboard-current-recipe-title"
                  className="text-lg font-bold leading-tight text-slate-800 sm:text-xl md:text-2xl"
                >
                  Current Recipe
                </h2>
                <p className="mt-1 text-[0.65rem] font-bold uppercase tracking-[0.2em] text-slate-500">
                  what we are making next
                </p>
              </div>
            </div>
            <div className="mt-5 rounded-2xl border border-white/25 bg-white/12 px-4 py-4 text-sm leading-relaxed text-slate-700 shadow-inner">
              {recipeSteps !== null && (recipeSteps ?? []).length > 0 ? (
                <p>
                  <span className="font-semibold text-violet-900">
                    K2 plan ready:
                  </span>{" "}
                  {(recipeSteps ?? []).length} hardware steps (listen, talk,
                  chop, stir, pick_up). Use Cooking in the recipe lab when your
                  Pi is connected.
                </p>
              ) : recipeSteps !== null && (recipeSteps ?? []).length === 0 ? (
                <p>
                  Parsed with no steps yet. Adjust your text in the lab below
                  and run Magic Parse again.
                </p>
              ) : recipeText.trim() ? (
                <p>
                  Text is in the lab below. Tap{" "}
                  <span className="font-semibold">Magic Parse</span> so Chef Sue
                  (K2 Think) can build the five hardware actions.
                </p>
              ) : (
                <p>
                  Paste a recipe in the lab below. K2 Think maps ingredients and
                  instructions into listen, talk, chop, stir, and pick_up for the
                  arm.
                </p>
              )}
            </div>
          </div>

          {/* Recent Events */}
          <div
            role="group"
            aria-labelledby="dashboard-recent-events-title"
            tabIndex={0}
            style={{ zIndex: dashboardStackZ("events", focusedCard) }}
            onMouseEnter={() => setFocusedCard("events")}
            onClick={() => setFocusedCard("events")}
            onFocus={() => setFocusedCard("events")}
            onBlur={handleDashboardCardBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setFocusedCard("events");
              }
            }}
            className={`pointer-events-auto absolute right-2 top-14 flex min-h-0 min-w-0 w-[min(19rem,calc(100vw-2rem))] -rotate-1 flex-col ${glassCard} px-5 pb-6 pt-7 shadow-glassDeep transition-all duration-300 ease-out will-change-transform [transform-style:preserve-3d] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 sm:right-[7%] sm:top-16 sm:w-[min(22rem,90vw)] md:rotate-2 ${
              focusedCard === "events"
                ? "scale-[1.03] shadow-[0_22px_50px_rgba(15,23,42,0.18)]"
                : "hover:scale-[1.015] hover:shadow-[0_18px_40px_rgba(15,23,42,0.12)]"
            } max-h-[min(70vh,28rem)] overflow-y-auto sm:max-h-none sm:overflow-visible`}
          >
            <div className="flex shrink-0 items-start gap-3">
              <div className="h-14 w-14 shrink-0 sm:h-16 sm:w-16">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={IMG_RECENT_EVENTS}
                  alt=""
                  width={64}
                  height={64}
                  className="h-full w-full object-contain drop-shadow-md"
                />
              </div>
              <div className="min-w-0 pt-0.5">
                <h2
                  id="dashboard-recent-events-title"
                  className="text-lg font-bold leading-tight text-slate-800 sm:text-xl md:text-2xl"
                >
                  Recent Events
                </h2>
                <p className="mt-1 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-slate-500">
                  little notes from the kitchen
                </p>
              </div>
            </div>
            {eventsList.length === 0 ? (
              <div className="mt-5 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/35 bg-white/12 px-4 py-6 text-center shadow-inner">
                <p className="max-w-sm text-sm font-semibold leading-relaxed text-slate-700">
                  Chef Sue is waiting for news! <span aria-hidden>•ᴗ•</span>
                </p>
              </div>
            ) : (
              <ul className="mt-5 max-h-52 space-y-2 overflow-y-auto rounded-2xl border border-white/25 bg-white/15 p-3 text-left text-[11px] font-medium leading-relaxed text-slate-700 shadow-inner">
                {eventsList.map(({ id, data }) => {
                  const ev = data as Record<string, unknown>;
                  const action =
                    typeof ev.action === "string" ? ev.action : undefined;
                  const typ =
                    typeof ev.type === "string" ? ev.type : undefined;
                  const voiceCue =
                    typeof ev.voice_cue === "string" ? ev.voice_cue : undefined;
                  const ingredientsRaw = ev.ingredients;
                  const ingredients =
                    Array.isArray(ingredientsRaw)
                      ? ingredientsRaw.filter(
                          (x): x is string => typeof x === "string",
                        )
                      : undefined;
                  const headline = action
                    ? formatActionLabel(action)
                    : formatTypeLabel(typ);
                  const detail =
                    voiceCue ||
                    (ingredients?.length ? ingredients.join(", ") : undefined) ||
                    "New update from Chef Sue!";
                  return (
                    <li
                      key={id}
                      className="rounded-lg border border-white/25 bg-white/30 px-2 py-1.5"
                    >
                      <span className="font-bold text-violet-900">
                        {headline}
                      </span>
                      <p className="mt-0.5 text-slate-700">{detail}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* ZONE 2: Recipe lab (textarea, Quick Start, Magic Parse, steps, cook) */}
        <section
          className={`relative z-10 mx-auto mt-10 w-full max-w-4xl ${glassCard} px-5 pb-8 pt-8 shadow-glassDeep sm:px-8`}
        >
          <h2 className="text-xl font-bold text-slate-800 sm:text-2xl">
            Recipe lab
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {isDemoTheater
              ? "Upload a family recipe PDF — Chef Sue extracts the plan, then Cooking sends it to the robot."
              : "Type or paste text, optionally use Quick Start, then Magic Parse so K2 Think returns the five Pi actions. Cooking sends your saved plan to the robot."}
          </p>

          <div
            className="mt-6 space-y-4 transition-opacity duration-500 ease-out"
            style={{ opacity: parseLoading || demoUploading ? 0.85 : 1 }}
          >
            {isDemoTheater ? (
              <div className="space-y-3">
                <p className="text-[0.65rem] font-bold uppercase tracking-wider text-slate-500">
                  Family recipe
                </p>
                <input
                  ref={demoFileInputRef}
                  id="demo-pdf-input"
                  type="file"
                  accept=".pdf,application/pdf,*/*"
                  className="sr-only"
                  aria-label="Upload family recipe PDF"
                  onChange={(e) => {
                    e.target.value = "";
                    runDemoTheaterScan();
                  }}
                />
                <button
                  type="button"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!demoUploading && !parseLoading) runDemoTheaterScan();
                  }}
                  onClick={() => {
                    if (!demoUploading && !parseLoading) {
                      demoFileInputRef.current?.click();
                    }
                  }}
                  className={`flex min-h-[8rem] w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-violet-400/50 bg-white/15 px-4 py-6 text-center transition hover:border-violet-500/70 hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 ${demoUploading || parseLoading ? "pointer-events-none opacity-70" : ""}`}
                >
                  {demoUploading ? (
                    <>
                      <span className="mb-2 inline-block h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
                      <span className="text-sm font-semibold text-slate-800">
                        {demoStatusMsg}
                      </span>
                      <span className="mt-1 text-xs text-slate-600">
                        Please wait…
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-3xl" aria-hidden>
                        📄
                      </span>
                      <span className="mt-2 text-sm font-bold text-slate-800">
                        Upload Family Recipe PDF
                      </span>
                      <span className="mt-1 text-xs text-slate-600">
                        Drop a file here or click to browse (any file works for
                        the demo)
                      </span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              <>
                <p className="text-[0.65rem] font-bold uppercase tracking-wider text-slate-500">
                  Quick start
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={stickerBtn}
                    onClick={(e) => onQuickStartClick(e, QUICK_START.tomato)}
                  >
                    🍅 Tomato Salad
                  </button>
                  <button
                    type="button"
                    className={stickerBtn}
                    onClick={(e) => onQuickStartClick(e, QUICK_START.pasta)}
                  >
                    🍝 Simple Pasta
                  </button>
                  <button
                    type="button"
                    className={stickerBtn}
                    onClick={(e) => onQuickStartClick(e, QUICK_START.oats)}
                  >
                    🥣 Morning Oats
                  </button>
                </div>
              </>
            )}
            <div className="space-y-2">
              <p className="text-[0.65rem] font-bold uppercase tracking-wider text-slate-500">
                Spending link
              </p>
              <button
                type="button"
                disabled={parseLoading || demoUploading || knotLoading}
                onClick={() => void handleLinkSpending()}
                className="w-full rounded-2xl border border-emerald-400/40 bg-emerald-100/35 px-4 py-3 text-sm font-bold text-slate-800 shadow-inner backdrop-blur-sm transition hover:bg-emerald-100/55 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {knotLoading ? "Opening Knot…" : "Link spending (Knot)"}
              </button>
              {knotHint ? (
                <p className="rounded-2xl border border-white/25 bg-white/12 px-3 py-2 text-xs font-medium text-slate-700">
                  {knotHint}
                </p>
              ) : null}
            </div>
            <label className="sr-only" htmlFor="recipe-input">
              Recipe
            </label>
            <textarea
              id="recipe-input"
              value={recipeText}
              onChange={(e) => setRecipeText(e.target.value)}
              rows={6}
              disabled={parseLoading || demoUploading}
              placeholder="Paste your recipe here (e.g., 'Chop the tomato')..."
              className="min-h-[10rem] w-full resize-y bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl p-4 text-base text-slate-800 placeholder-slate-500 outline-none focus:ring-2 focus:ring-purple-300 sm:min-h-[9rem] sm:text-sm leading-relaxed"
            />
            {parseError ? (
              <p
                className="rounded-2xl border border-rose-300/80 bg-rose-50/90 px-4 py-3 text-sm font-semibold text-rose-900 shadow-inner"
                role="alert"
              >
                {parseError}
              </p>
            ) : null}
            <button
              type="button"
              disabled={parseLoading || demoUploading}
              onClick={() => void handleMagicParse()}
              className="w-full rounded-full border border-white/40 bg-violet-200/55 px-5 py-4 text-center text-sm font-bold uppercase tracking-wide text-slate-800 shadow-[0_10px_0_rgba(139,92,246,0.25),0_8px_24px_rgba(124,58,237,0.2)] backdrop-blur-md transition hover:-translate-y-0.5 hover:bg-violet-200/70 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
            >
              {parseLoading
                ? "Working…"
                : demoUploading
                  ? "Scanning PDF…"
                  : "✨ Magic Parse"}
            </button>
            <div className="space-y-3 rounded-2xl border border-fuchsia-300/35 bg-fuchsia-50/15 px-4 py-4 shadow-inner">
              <p className="text-sm font-bold text-slate-800">Personalized ideas</p>
              <p className="text-xs text-slate-600">
                Uses your synced Knot taste profile when available. Meal ideas are
                structured JSON (Gemini); Magic Parse above uses K2 for robot steps.
              </p>
              <textarea
                value={personalizedPrompt}
                onChange={(e) => setPersonalizedPrompt(e.target.value)}
                rows={3}
                disabled={personalizedLoading}
                placeholder='e.g. "Quick vegetarian dinners for this week"'
                className="min-h-[5rem] w-full resize-y rounded-2xl border border-white/25 bg-white/15 p-3 text-sm text-slate-800 placeholder-slate-500 outline-none focus:ring-2 focus:ring-fuchsia-300/80"
              />
              <button
                type="button"
                disabled={personalizedLoading || parseLoading || demoUploading}
                onClick={() => void handlePersonalizedIdeas()}
                className="w-full rounded-2xl border border-fuchsia-400/45 bg-fuchsia-200/45 px-4 py-3 text-sm font-bold text-slate-800 shadow-inner backdrop-blur-sm transition hover:bg-fuchsia-200/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {personalizedLoading ? "Thinking…" : "Get personalized ideas"}
              </button>
              {personalizedError ? (
                <p
                  className="rounded-2xl border border-rose-300/80 bg-rose-50/90 px-3 py-2 text-xs font-semibold text-rose-900"
                  role="alert"
                >
                  {personalizedError}
                </p>
              ) : null}
              {personalizedResult &&
              personalizedCards.length === 0 &&
              !personalizedLoading ? (
                <p
                  className="rounded-2xl border border-amber-300/80 bg-amber-50/90 px-3 py-2 text-xs font-semibold text-amber-950"
                  role="status"
                >
                  ⚠️ No structured ideas found for image search.
                </p>
              ) : null}
              {personalizedCards.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {personalizedCards.map((card, idx) => (
                    <div
                      key={`${idx}-${card.title.slice(0, 32)}`}
                      className="overflow-hidden rounded-2xl border border-white/25 bg-white/15 shadow-inner"
                    >
                      {card.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element -- remote Pexels URLs; avoids next/image domain config
                        <img
                          src={card.image_url}
                          alt=""
                          className="h-40 w-full object-cover"
                          loading="lazy"
                        />
                      ) : null}
                      <div className="space-y-1.5 px-3 py-3">
                        <p className="text-sm font-bold text-slate-900">
                          {card.title}
                        </p>
                        <p className="text-sm leading-relaxed text-slate-700">
                          {card.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : personalizedResult ? (
                <p className="whitespace-pre-wrap rounded-2xl border border-white/25 bg-white/15 px-3 py-3 text-sm leading-relaxed text-slate-800">
                  {personalizedResult}
                </p>
              ) : null}
            </div>
          </div>

          {recipeSteps !== null ? (
            <div className="mt-8 space-y-4 border-t border-white/20 pt-8">
              <p className="text-sm font-semibold text-slate-700">
                Here is your plan. Ready when you are.
              </p>
              {(recipeSteps ?? []).length === 0 ? (
                <p className="rounded-2xl border border-white/25 bg-white/12 px-4 py-6 text-center text-sm font-medium text-slate-700 shadow-inner">
                  Waiting for a recipe! <span aria-hidden>•ᴗ•</span>
                </p>
              ) : (
                <ul className="max-h-64 space-y-2.5 overflow-y-auto rounded-2xl border border-white/25 bg-white/12 p-3 text-left shadow-inner">
                  {(recipeSteps ?? []).map((step, idx) => {
                    const target = step.target ?? "";
                    const actionTrim =
                      step.action != null && String(step.action).trim() !== ""
                        ? String(step.action).trim()
                        : "";
                    const hasInstr =
                      typeof step.instruction === "string" &&
                      step.instruction.trim() !== "";
                    const headlineIsAction = actionTrim !== "";
                    const headline =
                      headlineIsAction
                        ? formatActionLabel(step.action)
                        : hasInstr
                          ? step.instruction!.trim()
                          : "UNKNOWN ACTION";
                    const detailLine =
                      step.voice_cue ||
                      step.instruction ||
                      JSON.stringify(step);
                    return (
                      <li
                        key={`recipe-step-${idx}-${JSON.stringify(step).slice(0, 64)}`}
                        className="rounded-xl border border-white/20 bg-white/20 px-3 py-2.5"
                      >
                        <p
                          className={`text-[11px] font-bold text-violet-900 ${
                            headlineIsAction
                              ? "uppercase tracking-wider"
                              : "normal-case tracking-normal"
                          }`}
                        >
                          <span aria-hidden>{actionEmoji(actionTrim || step.action)} </span>
                          {headline}
                          {formatServoPreview(step.servo) ? (
                            <span className="ml-1.5 font-mono text-[10px] font-semibold normal-case tracking-normal text-slate-600">
                              {formatServoPreview(step.servo)}
                            </span>
                          ) : null}
                        </p>
                        {target ? (
                          <p className="mt-0.5 text-sm font-medium text-slate-800">
                            {target}
                          </p>
                        ) : null}
                        <p className="mt-1 break-words text-xs leading-snug text-slate-600">
                          {detailLine}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <button
                  type="button"
                  disabled={cookLoading || !hasParsedSteps}
                  onClick={() => void handleCook()}
                  title={
                    hasParsedSteps
                      ? undefined
                      : "Run Magic Parse first so Chef Sue can build your steps."
                  }
                  className="w-full rounded-full border border-white/40 bg-fuchsia-200/50 px-5 py-3 text-center text-sm font-bold uppercase tracking-wide text-slate-800 shadow-[0_10px_0_rgba(217,70,239,0.2),0_8px_22px_rgba(192,38,211,0.18)] backdrop-blur-md transition hover:-translate-y-0.5 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/70 sm:w-auto"
                >
                  {cookLoading ? "Sending…" : "Cooking"}
                </button>
                <button
                  type="button"
                  onClick={handleEditRecipe}
                  className="rounded-full border border-white/30 bg-white/15 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-700 backdrop-blur-sm transition hover:bg-white/25 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                >
                  Edit recipe
                </button>
              </div>
              {cookHint ? (
                <output className="block text-sm font-medium text-emerald-800">
                  {cookHint}
                </output>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* ZONE 3: action dock (hidden in demo theater for one-touch flow) */}
        {!isDemoTheater ? (
        <div className="relative z-command-dock mx-auto mt-8 w-full max-w-4xl shrink-0 pb-8">
          <div
            className={`rounded-[1.75rem] border border-white/35 bg-white/18 p-4 shadow-dock backdrop-blur-xl [-webkit-backdrop-filter:blur(20px)] sm:rounded-[2rem] sm:p-5 ${glassCard}`}
          >
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
            <button
              type="button"
              disabled={dockLoading}
              className="flex min-h-[5.5rem] flex-col items-center justify-center gap-1 rounded-full border border-white/50 bg-sky-200/60 px-4 py-4 text-center font-bold text-slate-800 shadow-cmdListen shadow-lg ring-2 ring-sky-300/70 backdrop-blur-md transition hover:-translate-y-0.5 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[6rem]"
              onClick={() => void handleHardwareAction("listen")}
            >
              <span className="text-2xl" aria-hidden>
                🎤
              </span>
              <span className="text-xs uppercase tracking-wide sm:text-sm">
                Listen
              </span>
            </button>
            <button
              type="button"
              disabled={dockLoading}
              className="flex min-h-[5.5rem] flex-col items-center justify-center gap-1 rounded-full border border-white/50 bg-pink-200/65 px-4 py-4 text-center font-bold text-slate-800 shadow-cmdTalk shadow-lg ring-2 ring-pink-300/70 backdrop-blur-md transition hover:-translate-y-0.5 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-400/60 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[6rem]"
              onClick={() => void handleHardwareAction("talk")}
            >
              <span className="text-2xl" aria-hidden>
                💬
              </span>
              <span className="text-xs uppercase tracking-wide sm:text-sm">
                Talk
              </span>
            </button>
            <div className="col-span-2 flex flex-col items-center gap-2.5 md:col-span-3 lg:col-span-3">
              <span
                className="inline-flex items-center rounded-full bg-gradient-to-tr from-amber-400 to-yellow-200 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-800 shadow-[0_4px_10px_rgba(251,191,36,0.4)]"
                aria-label="SousChef Pro — coming soon"
              >
                SOUSCHEF PRO
              </span>
              <div
                className="relative w-full rounded-2xl bg-slate-900/40 p-3 shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] ring-1 ring-white/5"
              >
                <div className="relative grid min-h-[5.5rem] grid-cols-3 gap-3 sm:min-h-[6rem] sm:gap-4">
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="flex min-h-[5.5rem] flex-col items-center justify-center gap-1 rounded-full border border-white/40 bg-red-200/50 px-4 py-4 text-center font-bold text-slate-800 shadow-cmdChop backdrop-blur-md sm:min-h-[6rem]"
                  >
                    <span className="text-2xl" aria-hidden>
                      🔪
                    </span>
                    <span className="text-xs uppercase tracking-wide sm:text-sm">
                      Chop
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="flex min-h-[5.5rem] flex-col items-center justify-center gap-1 rounded-full border border-white/40 bg-orange-200/55 px-4 py-4 text-center font-bold text-slate-800 shadow-cmdStir backdrop-blur-md sm:min-h-[6rem]"
                  >
                    <span className="text-2xl" aria-hidden>
                      🥣
                    </span>
                    <span className="text-xs uppercase tracking-wide sm:text-sm">
                      Stir
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="flex min-h-[5.5rem] flex-col items-center justify-center gap-1 rounded-full border border-white/40 bg-emerald-200/55 px-4 py-4 text-center font-bold text-slate-800 shadow-cmdPick backdrop-blur-md sm:min-h-[6rem]"
                  >
                    <span className="text-2xl" aria-hidden>
                      🦾
                    </span>
                    <span className="text-xs uppercase tracking-wide sm:text-sm">
                      Pick up
                    </span>
                  </button>
                  <div
                    className="pointer-events-auto absolute inset-0 z-10 cursor-not-allowed rounded-xl border-b border-b-black/20 border-l border-l-white/40 border-r border-r-black/20 border-t border-t-white/40 bg-white/5 backdrop-blur-md shadow-2xl"
                    aria-hidden
                  />
                </div>
              </div>
            </div>
          </div>
          {dockError ? (
            <p
              className="mt-4 rounded-2xl border border-rose-300/80 bg-rose-50/90 px-4 py-3 text-center text-sm font-semibold text-rose-900"
              role="alert"
            >
              {dockError}
            </p>
          ) : null}
          </div>
        </div>
        ) : null}
      </div>

      {/* Chef Sue (Emoji Kitchen) — fixed top-right, clear of title */}
      <div
        className="pointer-events-none fixed right-4 top-24 z-mascot animate-floatSoft sm:right-8 sm:top-28"
        aria-hidden
      >
        <div
          className={`flex items-center gap-3 rounded-3xl border border-white/30 ${glassCard} p-3 shadow-glassDeep`}
        >
          <div className="h-16 w-16 shrink-0 sm:h-[4.5rem] sm:w-[4.5rem]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={IMG_CHEF_SUE}
              alt=""
              width={112}
              height={112}
              className="h-full w-full object-contain drop-shadow-md"
            />
          </div>
          <div className="pr-1 text-left">
            <p className="text-xs font-bold uppercase tracking-wide text-violet-900">
              Chef Sue
            </p>
            <p className="text-sm font-semibold text-slate-700">•ᴗ•</p>
          </div>
        </div>
      </div>
    </div>
  );
}
