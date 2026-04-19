import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./hooks/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cmd: {
          listen: "#bae6fd",
          talk: "#fbcfe8",
          chop: "#fecaca",
          stir: "#fed7aa",
          pick: "#a7f3d0",
        },
      },
      zIndex: {
        "mesh-back": "0",
        "postit-back": "10",
        "postit-mid": "20",
        "postit-events": "40",
        content: "10",
        "float-ui": "50",
        "command-dock": "55",
        mascot: "60",
      },
      boxShadow: {
        glass:
          "0 20px 50px -12px rgba(15, 23, 42, 0.2), inset 0 1px 0 rgba(255,255,255,0.5)",
        glassDeep:
          "0 28px 60px -12px rgba(15, 23, 42, 0.22), inset 0 1px 0 rgba(255,255,255,0.45)",
        cmdListen:
          "0 14px 0 0 rgba(59, 130, 246, 0.35), 0 18px 36px rgba(59, 130, 246, 0.28), inset 0 1px 0 rgba(255,255,255,0.55)",
        cmdTalk:
          "0 14px 0 0 rgba(236, 72, 153, 0.32), 0 18px 36px rgba(236, 72, 153, 0.25), inset 0 1px 0 rgba(255,255,255,0.55)",
        cmdChop:
          "0 14px 0 0 rgba(239, 68, 68, 0.32), 0 18px 36px rgba(239, 68, 68, 0.22), inset 0 1px 0 rgba(255,255,255,0.5)",
        cmdStir:
          "0 14px 0 0 rgba(249, 115, 22, 0.35), 0 18px 36px rgba(249, 115, 22, 0.24), inset 0 1px 0 rgba(255,255,255,0.5)",
        cmdPick:
          "0 14px 0 0 rgba(52, 211, 153, 0.38), 0 18px 36px rgba(52, 211, 153, 0.26), inset 0 1px 0 rgba(255,255,255,0.55)",
        dock:
          "0 -12px 40px -8px rgba(15, 23, 42, 0.12), 0 24px 48px -12px rgba(15, 23, 42, 0.18), inset 0 1px 0 rgba(255,255,255,0.55)",
      },
      keyframes: {
        blob: {
          "0%, 100%": { transform: "translate(0px, 0px) scale(1)" },
          "25%": { transform: "translate(24px, -32px) scale(1.05)" },
          "50%": { transform: "translate(-16px, 20px) scale(0.98)" },
          "75%": { transform: "translate(12px, 8px) scale(1.02)" },
        },
        blobSlow: {
          "0%, 100%": { transform: "translate(0px, 0px) scale(1)" },
          "50%": { transform: "translate(-28px, 24px) scale(1.08)" },
        },
        floatSoft: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
      },
      animation: {
        blob: "blob 20s ease-in-out infinite",
        blobSlow: "blobSlow 24s ease-in-out infinite",
        blobDelayed: "blob 26s ease-in-out infinite 4s",
        floatSoft: "floatSoft 3.5s ease-in-out infinite",
      },
    },
  },
} satisfies Config;
