import csv
import json
import time
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from . import retrain as _retrain_mod
from . import retrain_signs as _retrain_signs_mod

router = APIRouter()

DATA_DIR = Path(__file__).parent.parent / "data"
CONTRIB_CSV = DATA_DIR / "contributions.csv"
FIELDNAMES = ["timestamp", "label", "features"]

WORD_SIGNS_DIR = DATA_DIR / "word_signs"
VALID_SIGNS = {
    "hello", "thank_you", "yes", "no", "please",
    "help", "sorry", "goodbye", "name", "eat",
    "drink", "water", "good", "bad", "friend",
}


def _ensure_csv():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not CONTRIB_CSV.exists():
        with open(CONTRIB_CSV, "w", newline="") as f:
            csv.DictWriter(f, FIELDNAMES).writeheader()


class Contribution(BaseModel):
    label: str
    features: list[float]


@router.post("/contributions")
def add_contribution(item: Contribution):
    label = item.label.strip().upper()
    if not label or len(item.features) != 63:
        raise HTTPException(400, "label required and features must be length 63")
    _ensure_csv()
    with open(CONTRIB_CSV, "a", newline="") as f:
        csv.DictWriter(f, FIELDNAMES).writerow({
            "timestamp": int(time.time()),
            "label": label,
            "features": ",".join(f"{v:.6f}" for v in item.features),
        })
    # Count total to check auto-retrain threshold
    total = sum(1 for _ in open(CONTRIB_CSV)) - 1  # subtract header
    _retrain_mod.maybe_auto_retrain(total)
    return {"ok": True}


@router.get("/contributions/counts")
def contribution_counts():
    _ensure_csv()
    counts: dict[str, int] = {}
    try:
        with open(CONTRIB_CSV, newline="") as f:
            for row in csv.DictReader(f):
                counts[row["label"]] = counts.get(row["label"], 0) + 1
    except Exception:
        pass
    return {"counts": counts, "total": sum(counts.values())}


@router.delete("/contributions/last")
def delete_last_contribution():
    _ensure_csv()
    try:
        with open(CONTRIB_CSV, newline="") as f:
            rows = list(csv.DictReader(f))
        if not rows:
            raise HTTPException(404, "No contributions to delete")
        rows.pop()
        with open(CONTRIB_CSV, "w", newline="") as f:
            w = csv.DictWriter(f, FIELDNAMES)
            w.writeheader()
            w.writerows(rows)
        return {"ok": True, "remaining": len(rows)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Word-sign contributions ────────────────────────────────────────────────────
# Each sample is a sequence of frames saved as backend/data/word_signs/<sign>/<ts>.json
# Format: [[126 floats] × n_frames]  (n_frames is 15–60, nominally 30)

class WordContribution(BaseModel):
    sign: str
    sequence: list[list[float]]


@router.post("/word-contributions")
def add_word_contribution(item: WordContribution):
    sign = item.sign.lower().strip()
    if sign not in VALID_SIGNS:
        raise HTTPException(400, f"Unknown sign. Valid signs: {sorted(VALID_SIGNS)}")
    if not (15 <= len(item.sequence) <= 60):
        raise HTTPException(400, "Sequence must be 15–60 frames")
    for frame in item.sequence:
        if len(frame) != 126:
            raise HTTPException(400, "Each frame must have 126 features (two-hand vector)")

    sign_dir = WORD_SIGNS_DIR / sign
    sign_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{time.time_ns()}.json"
    with open(sign_dir / filename, "w") as f:
        json.dump([[round(v, 6) for v in frame] for frame in item.sequence], f)

    # Count total word-sign contributions and maybe trigger RF retraining
    total_word = sum(
        len(list(d.glob("*.json")))
        for d in WORD_SIGNS_DIR.iterdir()
        if d.is_dir()
    )
    _retrain_signs_mod.maybe_auto_retrain(total_word)

    return {"ok": True, "total": total_word}


@router.get("/word-contributions/counts")
def word_contribution_counts():
    counts: dict[str, int] = {}
    if WORD_SIGNS_DIR.exists():
        for sign_dir in WORD_SIGNS_DIR.iterdir():
            if sign_dir.is_dir():
                n = len(list(sign_dir.glob("*.json")))
                if n:
                    counts[sign_dir.name] = n
    return {"counts": counts, "total": sum(counts.values())}


@router.delete("/word-contributions/last")
def delete_last_word_contribution():
    if not WORD_SIGNS_DIR.exists():
        raise HTTPException(404, "No word-sign contributions yet")
    all_files = list(WORD_SIGNS_DIR.glob("*/*.json"))
    if not all_files:
        raise HTTPException(404, "No word-sign contributions to delete")
    latest = max(all_files, key=lambda p: p.stat().st_mtime)
    sign = latest.parent.name
    latest.unlink()
    return {"ok": True, "sign": sign}
