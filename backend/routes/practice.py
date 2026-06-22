from fastapi import APIRouter
from pydantic import BaseModel
from .. import db

router = APIRouter()


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
