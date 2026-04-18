import httpx
import json

API_KEY = "YOUR_KEY" # change this to gemini key 

async def plan_recipe(recipe_text: str):
    prompt = f"""
Convert this recipe into robot steps.

Return ONLY JSON:
[
  {{
    "action": "chop | stir | pour | pick_up | wait",
    "ingredient": "string",
    "note": "short instruction"
  }}
]

Recipe:
{recipe_text}
"""

    async with httpx.AsyncClient() as client:
        r = await client.post(
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"gemini-2.0-flash-exp:generateContent?key={API_KEY}",
            json={"contents": [{"parts": [{"text": prompt}]}]}
        )

    text = r.json()["candidates"][0]["content"]["parts"][0]["text"]
    clean = text.strip("```json").strip("```")
    return json.loads(clean)
