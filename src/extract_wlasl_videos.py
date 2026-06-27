"""
extract_wlasl_videos.py — Extract target sign videos from the local WLASL zip.

Reads WLASL_v0.3.json, finds all video IDs for the 15 target signs,
then extracts them directly from the local wlasl-processed.zip.

Run:
    python src/extract_wlasl_videos.py

Output: data/raw_videos/<sign_name>/<video_id>.mp4
Next:   python src/extract_word_landmarks.py
"""

import json
import zipfile
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
WLASL_JSON   = Path.home() / "Downloads" / "wlasl_json" / "WLASL_v0.3.json"
WLASL_ZIP    = PROJECT_ROOT / "data" / "wlasl_test" / "wlasl-processed.zip"
OUT_DIR      = PROJECT_ROOT / "data" / "raw_videos"

# ── Sign mapping: WLASL gloss → our folder name ───────────────────────────────
SIGN_GLOSS = {
    "hello":     "hello",
    "thank you": "thank_you",
    "yes":       "yes",
    "no":        "no",
    "please":    "please",
    "help":      "help",
    "sorry":     "sorry",
    "bye":       "goodbye",
    "sick":      "sick",
    "eat":       "eat",
    "drink":     "drink",
    "school":    "school",
    "good":      "good",
    "bad":       "bad",
    "friend":    "friend",
}

MAX_PER_SIGN = 20   # cap per sign to keep dataset balanced


def load_video_ids() -> dict[str, list[str]]:
    """Read WLASL JSON and return {sign_name: [video_id, ...]}."""
    with open(WLASL_JSON, encoding="utf-8") as f:
        data = json.load(f)

    result: dict[str, list[str]] = {}
    for entry in data:
        sign_name = SIGN_GLOSS.get(entry["gloss"])
        if sign_name is None:
            continue
        instances = entry.get("instances", [])
        # prefer train split; fall back to all splits if insufficient
        train_ids = [i["video_id"] for i in instances if i.get("split") == "train"]
        all_ids   = [i["video_id"] for i in instances]
        chosen    = train_ids if len(train_ids) >= MAX_PER_SIGN else all_ids
        result[sign_name] = [str(v) for v in chosen[:MAX_PER_SIGN]]
    return result


def main() -> None:
    if not WLASL_JSON.exists():
        print(f"ERROR: WLASL_v0.3.json not found at:\n  {WLASL_JSON}")
        return
    if not WLASL_ZIP.exists():
        print(f"ERROR: WLASL zip not found at:\n  {WLASL_ZIP}")
        return

    sign_videos = load_video_ids()
    print(f"\nFound {len(sign_videos)} target signs in WLASL_v0.3.json")

    print(f"Opening zip ({WLASL_ZIP.stat().st_size / 1e9:.2f} GB) — this may take a moment ...\n")

    with zipfile.ZipFile(WLASL_ZIP, "r") as zf:
        # Build a quick lookup: video_id → zip member name
        zip_names = {Path(n).stem: n for n in zf.namelist() if n.endswith(".mp4")}
        print(f"Zip contains {len(zip_names):,} .mp4 files.\n")

        total_saved = total_skip = total_miss = 0

        for sign, ids in sorted(sign_videos.items()):
            sign_dir = OUT_DIR / sign
            sign_dir.mkdir(parents=True, exist_ok=True)

            saved = skip = miss = 0
            for vid_id in ids:
                dest = sign_dir / f"{vid_id}.mp4"
                if dest.exists() and dest.stat().st_size > 5_000:
                    skip += 1
                    continue
                zip_member = zip_names.get(vid_id)
                if zip_member is None:
                    miss += 1
                    continue
                data = zf.read(zip_member)
                dest.write_bytes(data)
                saved += 1

            total_now = sum(1 for p in sign_dir.glob("*.mp4") if p.stat().st_size > 5_000)
            mark = "OK" if total_now >= 15 else "--"
            parts = [f"{saved} saved"]
            if skip: parts.append(f"{skip} already had")
            if miss: parts.append(f"{miss} not in zip")
            print(f"  {mark}  {sign:<14}  {', '.join(parts)}  ->  {total_now} total")

            total_saved += saved
            total_skip  += skip
            total_miss  += miss

    print(f"\nDone.  {total_saved} extracted,  {total_skip} already existed,  {total_miss} not found in zip.")
    print(f"\nNext step:")
    print(f"  python src/extract_word_landmarks.py")


if __name__ == "__main__":
    main()
