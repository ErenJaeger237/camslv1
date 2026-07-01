"""
camsl_dataset.py -- Video clip recorder for the CamSL community dataset.

Records short video clips (webcam frames) and corresponding landmark sequences
per sign, saves them locally, and uploads to Supabase when credentials are set.

Supabase one-time setup (paste in Supabase SQL Editor):

    create table if not exists camsl_clips (
        id               uuid default gen_random_uuid() primary key,
        sign_name        text not null,
        sign_category    text not null,
        meaning          text,
        contributor_name text,
        contributor_id   text not null,
        recorded_at      timestamptz default now(),
        video_url        text,
        landmarks_url    text,
        frame_count      integer,
        fps              real,
        duration_s       real
    );

Storage: create two buckets named  camsl-videos  and  camsl-landmarks
(make them public if you want direct video playback links).

Put credentials in a .env file in the project root:
    SUPABASE_URL=https://your-project.supabase.co
    SUPABASE_ANON_KEY=your-anon-key

The app also lets you enter these in the UI and writes them to .env for you.
"""

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

TABLE_NAME   = "camsl_clips"
BUCKET_VIDEO = "camsl-videos"
BUCKET_LM    = "camsl-landmarks"

ALPHABET_SIGNS = list("ABCDEFGHIKLMNOPQRSTUVWXY")
WORD_SIGNS = [
    "bad", "drink", "eat", "friend", "good", "goodbye",
    "hello", "help", "name", "no", "please", "school",
    "sick", "sorry", "thank_you", "water", "yes",
]


class CamSLVideoRecorder:
    """
    Saves sign video clips + landmark sequences locally, then uploads to Supabase.
    Local storage is the ground truth; Supabase upload is best-effort.
    Any clip that fails to upload is retried automatically on the next save.
    """

    def __init__(self, project_root: Path):
        self._root = project_root / "data" / "camsl_dataset" / "clips"
        for cat in ("alphabet", "word_signs"):
            (self._root / cat).mkdir(parents=True, exist_ok=True)

        self._sb     = None
        self._sb_url = os.getenv("SUPABASE_URL", "")
        self._sb_key = os.getenv("SUPABASE_ANON_KEY", "")
        if self._sb_url and self._sb_key:
            self._init_client()

    # ------------------------------------------------------------------
    # Supabase connection
    # ------------------------------------------------------------------

    def _init_client(self) -> bool:
        try:
            from supabase import create_client
            self._sb = create_client(self._sb_url, self._sb_key)
            return True
        except Exception as e:
            print(f"[Dataset] Supabase init failed: {e}")
            self._sb = None
            return False

    @property
    def connected(self) -> bool:
        return self._sb is not None

    def configure(self, url: str, key: str) -> dict:
        """
        Point the recorder at a Supabase project and test the connection.
        Writes credentials to .env on success so they persist across restarts.
        """
        self._sb_url = url.strip()
        self._sb_key = key.strip()
        if not self._init_client():
            return {"success": False, "message": "supabase package not installed. Run: pip install supabase"}
        try:
            self._sb.table(TABLE_NAME).select("id").limit(1).execute()
        except Exception as e:
            self._sb = None
            return {"success": False, "message": f"Could not reach Supabase: {e}"}
        _persist_env(self._sb_url, self._sb_key)
        return {"success": True, "message": "Connected to Supabase successfully."}

    # ------------------------------------------------------------------
    # Save a clip
    # ------------------------------------------------------------------

    def save_clip(
        self,
        frames:           list,
        landmarks:        list,
        sign_name:        str,
        category:         str,
        meaning:          str,
        contributor_name: str,
        contributor_id:   str,
        fps:              float = 30.0,
    ) -> dict:
        """
        Write video + landmarks locally, then try to upload to Supabase.
        Always returns {success, local_path, uploaded, message}.
        """
        if not frames:
            return {"success": False, "message": "No frames were captured."}

        clip_id    = uuid.uuid4().hex[:12]
        ts         = datetime.now().strftime("%Y%m%d_%H%M%S")
        slug       = f"{ts}_{clip_id}"
        clip_dir   = self._root / category / sign_name
        clip_dir.mkdir(parents=True, exist_ok=True)

        video_path = clip_dir / f"{slug}.mp4"
        lm_path    = clip_dir / f"{slug}.npy"
        meta_path  = clip_dir / f"{slug}.json"

        try:
            self._write_video(video_path, frames, fps)
        except Exception as e:
            return {"success": False, "message": f"Video write failed: {e}"}

        lm_arr = np.array(landmarks, dtype=np.float32) if landmarks else np.zeros((0, 63), dtype=np.float32)
        np.save(str(lm_path), lm_arr)

        metadata = {
            "clip_id":          clip_id,
            "sign_name":        sign_name,
            "sign_category":    category,
            "meaning":          meaning or sign_name,
            "contributor_name": contributor_name or "",
            "contributor_id":   contributor_id,
            "recorded_at":      datetime.now(timezone.utc).isoformat(),
            "frame_count":      len(frames),
            "fps":              fps,
            "duration_s":       round(len(frames) / max(fps, 1), 2),
            "video_file":       video_path.name,
            "landmarks_file":   lm_path.name,
            "uploaded":         False,
            "video_url":        None,
            "landmarks_url":    None,
        }
        meta_path.write_text(json.dumps(metadata, indent=2))

        result: dict = {
            "success":    True,
            "local_path": str(video_path),
            "uploaded":   False,
            "message":    f"Saved {len(frames)} frames ({metadata['duration_s']}s) locally.",
        }

        if self.connected:
            up = self._upload(video_path, lm_path, meta_path, metadata)
            result["uploaded"] = up.get("success", False)
            if up.get("success"):
                result["message"] = "Saved and uploaded to Supabase."
            else:
                result["message"] += f" Upload failed: {up.get('message', '')} (will retry later)"

        return result

    def _write_video(self, path: Path, frames: list, fps: float):
        h, w = frames[0].shape[:2]
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        out = cv2.VideoWriter(str(path), fourcc, fps, (w, h))
        for f in frames:
            out.write(f)
        out.release()

    def _upload(self, video_path: Path, lm_path: Path, meta_path: Path, metadata: dict) -> dict:
        try:
            clip_id  = metadata["clip_id"]
            prefix   = f"{metadata['sign_category']}/{metadata['sign_name']}/{clip_id}"

            with open(video_path, "rb") as f:
                self._sb.storage.from_(BUCKET_VIDEO).upload(
                    path=f"{prefix}.mp4",
                    file=f.read(),
                    file_options={"content-type": "video/mp4"},
                )
            video_url = self._sb.storage.from_(BUCKET_VIDEO).get_public_url(f"{prefix}.mp4")

            with open(lm_path, "rb") as f:
                self._sb.storage.from_(BUCKET_LM).upload(
                    path=f"{prefix}.npy",
                    file=f.read(),
                    file_options={"content-type": "application/octet-stream"},
                )
            lm_url = self._sb.storage.from_(BUCKET_LM).get_public_url(f"{prefix}.npy")

            self._sb.table(TABLE_NAME).insert({
                "sign_name":        metadata["sign_name"],
                "sign_category":    metadata["sign_category"],
                "meaning":          metadata["meaning"],
                "contributor_name": metadata["contributor_name"],
                "contributor_id":   metadata["contributor_id"],
                "recorded_at":      metadata["recorded_at"],
                "video_url":        video_url,
                "landmarks_url":    lm_url,
                "frame_count":      metadata["frame_count"],
                "fps":              metadata["fps"],
                "duration_s":       metadata["duration_s"],
            }).execute()

            metadata.update({"uploaded": True, "video_url": video_url, "landmarks_url": lm_url})
            meta_path.write_text(json.dumps(metadata, indent=2))
            return {"success": True}
        except Exception as e:
            return {"success": False, "message": str(e)}

    # ------------------------------------------------------------------
    # Retry any clips that previously failed to upload
    # ------------------------------------------------------------------

    def retry_pending(self) -> dict:
        """Scan local clips with uploaded=False and re-attempt Supabase upload."""
        if not self.connected:
            return {"retried": 0, "succeeded": 0}
        retried = succeeded = 0
        for meta_path in self._root.rglob("*.json"):
            try:
                data = json.loads(meta_path.read_text())
                if data.get("uploaded"):
                    continue
                vp = meta_path.parent / data["video_file"]
                lp = meta_path.parent / data["landmarks_file"]
                if not vp.exists() or not lp.exists():
                    continue
                retried += 1
                if self._upload(vp, lp, meta_path, data).get("success"):
                    succeeded += 1
            except Exception:
                pass
        return {"retried": retried, "succeeded": succeeded}

    # ------------------------------------------------------------------
    # Clip counts
    # ------------------------------------------------------------------

    def local_stats(self) -> dict:
        """Return {sign_name: count} by scanning local .json metadata files."""
        counts: dict = {}
        for meta_path in self._root.rglob("*.json"):
            try:
                data = json.loads(meta_path.read_text())
                name = data.get("sign_name", "?")
                counts[name] = counts.get(name, 0) + 1
            except Exception:
                pass
        return counts

    def remote_stats(self) -> dict:
        """Return {sign_name: count} from the Supabase table (empty if not connected)."""
        if not self.connected:
            return {}
        try:
            resp = self._sb.table(TABLE_NAME).select("sign_name").execute()
            counts: dict = {}
            for row in resp.data:
                name = row.get("sign_name", "?")
                counts[name] = counts.get(name, 0) + 1
            return counts
        except Exception as e:
            print(f"[Dataset] Remote stats error: {e}")
            return {}


def _persist_env(url: str, key: str):
    """Write SUPABASE_URL and SUPABASE_ANON_KEY to .env in the project root."""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    kept = []
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if not (line.startswith("SUPABASE_URL=") or line.startswith("SUPABASE_ANON_KEY=")):
                kept.append(line)
    kept += [f"SUPABASE_URL={url}", f"SUPABASE_ANON_KEY={key}"]
    env_path.write_text("\n".join(kept) + "\n")
