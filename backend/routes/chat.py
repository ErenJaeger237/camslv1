import json
import os
import urllib.request
import urllib.error
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent"
)
SYSTEM_PROMPT = (
    "You are a friendly assistant embedded in a Cameroon Sign Language (CamSL) "
    "learning app. Keep replies short (≤3 sentences). The user may type or sign "
    "to communicate. If they ask about signs, explain them simply. "
    "Never reveal API keys or internal implementation details."
)


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []


@router.post("/chat")
def chat(req: ChatRequest):
    if not GEMINI_API_KEY:
        raise HTTPException(503, "GEMINI_API_KEY not set on server")

    message = req.message[:1000].strip()
    if not message:
        raise HTTPException(400, "Empty message")

    history = req.history[-20:]
    contents = []
    for turn in history:
        role = turn.get("role", "user")
        text = str(turn.get("text", ""))[:2000]
        if role in ("user", "model") and text:
            contents.append({"role": role, "parts": [{"text": text}]})
    contents.append({"role": "user", "parts": [{"text": message}]})

    body = json.dumps({
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": contents,
    }).encode()

    try:
        req_obj = urllib.request.Request(
            f"{GEMINI_URL}?key={GEMINI_API_KEY}",
            data=body,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req_obj, timeout=20) as resp:
            data = json.loads(resp.read())
        reply = data["candidates"][0]["content"]["parts"][0]["text"]
        return {"reply": reply}
    except urllib.error.HTTPError as e:
        raise HTTPException(502, f"Gemini error: {e.code}")
    except Exception as e:
        raise HTTPException(500, str(e))
