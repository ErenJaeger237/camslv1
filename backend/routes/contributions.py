import csv
import time
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from . import retrain as _retrain_mod

router = APIRouter()

DATA_DIR = Path(__file__).parent.parent / "data"
CONTRIB_CSV = DATA_DIR / "contributions.csv"
FIELDNAMES = ["timestamp", "label", "features"]


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
