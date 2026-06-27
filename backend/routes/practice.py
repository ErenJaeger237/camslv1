import json
import os
import urllib.request
import urllib.error
from fastapi import APIRouter
from pydantic import BaseModel
from .. import db

router = APIRouter()

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent"
)

# Static fallback tips for common letter confusions (target → detected)
_STATIC_TIPS: dict[tuple[str, str], str] = {
    ("A", "S"): "For A your thumb should rest against the side of your index finger, not across your fist like in S.",
    ("S", "A"): "For S, wrap your thumb over all four closed fingers. In A the thumb stays on the side.",
    ("A", "E"): "For A make a proper fist with the thumb on the side. In E the fingers curl lower and the thumb tucks under.",
    ("B", "4"): "For B keep all four fingers pressed tightly together. In 4 the fingers fan out.",
    ("C", "O"): "For C the hand stays open and curved. For O the fingers close all the way to meet the thumb.",
    ("O", "C"): "For O bring your fingertips down to touch your thumb, forming a complete circle.",
    ("D", "1"): "For D curve your three middle fingers to touch your thumb; only the index points up.",
    ("E", "A"): "For E bend all fingers forward so they curl over your thumb. In A the fingers form a fist.",
    ("F", "9"): "For F touch only the index fingertip to the thumb tip; the other three fingers stay extended.",
    ("G", "H"): "For G the hand points sideways with index and thumb parallel, like a gun. For H it lies flat.",
    ("H", "G"): "For H hold your index and middle finger flat and horizontal, pointing to the side.",
    ("K", "V"): "For K raise your index and middle finger in a V, but bend the middle finger slightly.",
    ("L", "D"): "For L extend only the index finger and thumb outward at a right angle.",
    ("M", "N"): "For M tuck three fingers over the thumb. For N tuck only two.",
    ("N", "M"): "For N tuck two fingers over the thumb. For M tuck three.",
    ("R", "U"): "For R cross your index and middle fingers. For U keep them side by side.",
    ("U", "R"): "For U keep your index and middle fingers straight and together, without crossing.",
    ("U", "V"): "For U keep fingers together. For V spread them apart.",
    ("V", "U"): "For V spread your index and middle fingers apart into a clear V shape.",
    ("W", "6"): "For W spread your index, middle, and ring finger apart — three distinct fingers showing.",
    ("X", "D"): "For X hook your index finger into a sharp crook. For D it points straight up.",
    ("Y", "A"): "For Y extend your pinky and thumb outward. In A all fingers are closed.",
}


def _static_tip(target: str, detected: str) -> str:
    tip = _STATIC_TIPS.get((target, detected))
    if tip:
        return tip
    return (
        f"Double-check the hand shape for '{target}': look at a reference image "
        f"and compare each finger's position carefully. "
        f"The model saw '{detected}' — compare both shapes side by side to spot the difference."
    )


class PracticeResult(BaseModel):
    session_id: str
    letter: str
    correct: bool
    recent: list[str] = []


@router.post("/practice/init")
def practice_init(body: dict):
    sid = str(body.get("session_id", "default"))[:64]
    db.init_session(sid)
    letter = db.select_next_letter(sid, [])
    mastery = db.overall_mastery(sid)
    return {"letter": letter, "mastery": mastery}


@router.post("/practice/result")
def practice_result(req: PracticeResult):
    sid = req.session_id[:64]
    db.update_leitner(sid, req.letter, req.correct)
    next_letter = db.select_next_letter(sid, req.recent[-5:])
    mastery = db.overall_mastery(sid)
    return {"next_letter": next_letter, "mastery": mastery}


class TipRequest(BaseModel):
    target: str
    detected: str


@router.post("/practice/tip")
def practice_tip(req: TipRequest):
    target = req.target.upper()[:1]
    detected = req.detected.upper()[:1]

    if not GEMINI_API_KEY:
        return {"tip": _static_tip(target, detected), "source": "static"}

    prompt = (
        f"A learner is practising the ASL manual alphabet. "
        f"They were trying to sign the letter '{target}' but the system kept "
        f"recognising '{detected}' instead after three attempts. "
        f"In exactly 2-3 short, practical sentences: explain what they likely "
        f"did wrong and give one concrete correction for hand shape, finger "
        f"positions, or thumb placement. Be encouraging and specific. "
        f"Do not use bullet points or headings — plain sentences only."
    )

    body = json.dumps({
        "system_instruction": {"parts": [{"text": "You are a sign language tutor. Be concise, clear, and encouraging."}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
    }).encode()

    try:
        req_obj = urllib.request.Request(
            f"{GEMINI_URL}?key={GEMINI_API_KEY}",
            data=body,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req_obj, timeout=10) as resp:
            data = json.loads(resp.read())
        tip = data["candidates"][0]["content"]["parts"][0]["text"].strip()
        return {"tip": tip, "source": "ai"}
    except Exception:
        return {"tip": _static_tip(target, detected), "source": "static"}
