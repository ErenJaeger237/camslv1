"""
download_wlasl_signs.py — Download specific WLASL sign clips via partial zip download.

The WLASL dataset on Kaggle is a 5.17 GB zip. Instead of downloading the full zip,
this script uses HTTP Range requests to download only the ~300 video files needed for
our 15 target signs (estimated ~30-150 MB total).

How it works
------------
1. Gets a time-limited GCS URL for the full zip from the Kaggle API (no phone verification needed).
2. Downloads only the last few MB of the zip to read the Central Directory.
3. Parses the Central Directory to find byte offsets for the target video files.
4. Downloads only those specific byte ranges.
5. Decompresses and saves each file to data/raw_videos/<sign_name>/<video_id>.mp4

Requirements
------------
  KAGGLE_API_TOKEN environment variable set  (already configured)
  requests package (already installed)

Run
---
  python src/download_wlasl_signs.py
"""

import json
import os
import struct
import zlib
from pathlib import Path

import requests

# ── Config ────────────────────────────────────────────────────────────────────
WLASL_JSON    = Path.home() / "Downloads" / "wlasl_json" / "WLASL_v0.3.json"
RAW_VIDEO_DIR = Path(__file__).resolve().parent.parent / "data" / "raw_videos"
MAX_PER_SIGN  = 20

SIGN_GLOSS = {
    "hello":     "hello",
    "thank_you": "thank you",
    "yes":       "yes",
    "no":        "no",
    "please":    "please",
    "help":      "help",
    "sorry":     "sorry",
    "goodbye":   "goodbye",
    "sick":      "sick",
    "eat":       "eat",
    "drink":     "drink",
    "school":    "school",
    "good":      "good",
    "bad":       "bad",
    "friend":    "friend",
}

# ── Kaggle API ────────────────────────────────────────────────────────────────

def get_gcs_url() -> str:
    """Get a time-limited GCS download URL for the full WLASL zip via Kaggle API."""
    os.environ.setdefault("KAGGLE_API_TOKEN", "KGAT_aa5e6e2f33b13988d380e026d9b02aae")
    from kaggle import KaggleApi
    from kagglesdk.datasets.types.dataset_api_service import ApiDownloadDatasetRequest

    api = KaggleApi()
    api.authenticate()
    print(f"Kaggle: authenticated as {api.config_values.get('username', '?')}")

    with api.build_kaggle_client() as kaggle:
        req = ApiDownloadDatasetRequest()
        req.owner_slug = "risangbaskoro"
        req.dataset_slug = "wlasl-processed"
        resp = kaggle.datasets.dataset_api_client.download_dataset(req)
        return resp.request.url


# ── Zip Central Directory Parser ──────────────────────────────────────────────

EOCD_SIG      = b"\x50\x4b\x05\x06"
EOCD64_SIG    = b"\x50\x4b\x06\x06"
EOCD64_LOC    = b"\x50\x4b\x06\x07"
CD_SIG        = b"\x50\x4b\x01\x02"
LOCAL_SIG     = b"\x50\x4b\x03\x04"

def _range_get(session: requests.Session, url: str, start: int, end: int) -> bytes:
    """Download bytes [start, end] from the url using Range header."""
    r = session.get(url, headers={"Range": f"bytes={start}-{end}"}, timeout=120)
    r.raise_for_status()
    return r.content


def find_central_directory(session: requests.Session, url: str, total_size: int) -> tuple[int, int]:
    """
    Read the last 64 KB of the zip to find the EOCD (or Zip64 EOCD) record.
    Returns (cd_offset, cd_size).  Handles archives > 4 GB via Zip64.
    """
    tail_size = min(65536 + 22, total_size)
    tail = _range_get(session, url, total_size - tail_size, total_size - 1)

    # Look for standard EOCD first
    idx = tail.rfind(EOCD_SIG)
    if idx == -1:
        raise RuntimeError("EOCD signature not found in last 64 KB")

    cd_size   = struct.unpack_from("<I", tail, idx + 12)[0]
    cd_offset = struct.unpack_from("<I", tail, idx + 16)[0]

    # Zip64: the 0xFFFFFFFF sentinel means real values are in the Zip64 EOCD
    if cd_offset == 0xFFFFFFFF or cd_size == 0xFFFFFFFF:
        # Zip64 EOCD Locator sits immediately before the standard EOCD
        loc_idx = tail.rfind(EOCD64_LOC, 0, idx)
        if loc_idx == -1:
            raise RuntimeError("Zip64 EOCD Locator not found")
        # Locator: sig(4) disk_with_eocd64(4) eocd64_offset(8) total_disks(4)
        eocd64_offset = struct.unpack_from("<Q", tail, loc_idx + 8)[0]
        # Download the Zip64 EOCD record
        eocd64 = _range_get(session, url, eocd64_offset, eocd64_offset + 55)
        if eocd64[:4] != EOCD64_SIG:
            raise RuntimeError("Zip64 EOCD signature mismatch")
        # Zip64 EOCD: sig(4) size_of_eocd64(8) ver_made(2) ver_needed(2)
        #   disk_num(4) disk_cd_start(4) entries_this_disk(8) total_entries(8)
        #   cd_size(8) cd_offset(8)
        cd_size   = struct.unpack_from("<Q", eocd64, 40)[0]
        cd_offset = struct.unpack_from("<Q", eocd64, 48)[0]

    return cd_offset, cd_size


def parse_central_directory(cd_data: bytes) -> dict[str, dict]:
    """
    Parse Central Directory entries.
    Returns {filename: {"compressed_size": int, "uncomp_size": int, "local_offset": int, "method": int}}
    """
    files: dict[str, dict] = {}
    pos = 0
    while pos < len(cd_data) - 4:
        if cd_data[pos:pos+4] != CD_SIG:
            break
        # CD entry layout:
        # sig(4) ver_made(2) ver_needed(2) flags(2) method(2) mod_time(2) mod_date(2) crc32(4)
        # comp_size(4) uncomp_size(4) name_len(2) extra_len(2) comment_len(2)
        # disk_start(2) int_attrs(2) ext_attrs(4) local_offset(4) name(n) extra(e) comment(c)
        method       = struct.unpack_from("<H", cd_data, pos + 10)[0]
        comp_size    = struct.unpack_from("<I", cd_data, pos + 20)[0]
        uncomp_size  = struct.unpack_from("<I", cd_data, pos + 24)[0]
        name_len     = struct.unpack_from("<H", cd_data, pos + 28)[0]
        extra_len    = struct.unpack_from("<H", cd_data, pos + 30)[0]
        comment_len  = struct.unpack_from("<H", cd_data, pos + 32)[0]
        local_offset = struct.unpack_from("<I", cd_data, pos + 42)[0]
        name = cd_data[pos+46 : pos+46+name_len].decode("utf-8", errors="replace")
        files[name] = {
            "method":       method,
            "comp_size":    comp_size,
            "uncomp_size":  uncomp_size,
            "local_offset": local_offset,
        }
        pos += 46 + name_len + extra_len + comment_len
    return files


def download_entry(session: requests.Session, url: str,
                   entry: dict, dest: Path) -> bool:
    """
    Download and decompress a single zip entry using Range requests.
    Returns True on success.
    """
    if dest.exists() and dest.stat().st_size > 5_000:
        return True

    local_offset = entry["local_offset"]

    # Read the local file header to find where the actual data starts
    # Local header: sig(4) ver(2) flags(2) method(2) time(2) date(2) crc(4) comp(4) uncomp(4) name_len(2) extra_len(2)
    lhdr = _range_get(session, url, local_offset, local_offset + 29)
    if lhdr[:4] != LOCAL_SIG:
        return False
    name_len  = struct.unpack_from("<H", lhdr, 26)[0]
    extra_len = struct.unpack_from("<H", lhdr, 28)[0]
    data_offset = local_offset + 30 + name_len + extra_len

    comp_size = entry["comp_size"]
    if comp_size == 0:
        return False   # empty file

    compressed = _range_get(session, url, data_offset, data_offset + comp_size - 1)

    method = entry["method"]
    try:
        if method == 0:      # Store (no compression)
            raw = compressed
        elif method == 8:    # DEFLATE
            raw = zlib.decompress(compressed, -15)
        else:
            print(f"\n      Unknown compression method {method} for {dest.name}")
            return False
    except zlib.error as e:
        print(f"\n      Decompress error {dest.name}: {e}")
        return False

    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)
    return dest.stat().st_size > 5_000


# ── Sign video list ───────────────────────────────────────────────────────────

def load_sign_videos() -> dict[str, list[str]]:
    with open(WLASL_JSON, encoding="utf-8") as f:
        data = json.load(f)
    gloss_to_sign = {v: k for k, v in SIGN_GLOSS.items()}
    result: dict[str, list[str]] = {}
    for entry in data:
        sign = gloss_to_sign.get(entry["gloss"])
        if sign is None:
            continue
        instances = entry.get("instances", [])
        train_ids = [i["video_id"] for i in instances if i.get("split") == "train"]
        all_ids   = [i["video_id"] for i in instances]
        chosen    = train_ids if len(train_ids) >= MAX_PER_SIGN else all_ids
        result[sign] = chosen[:MAX_PER_SIGN]
    return result


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    if not WLASL_JSON.exists():
        print(f"ERROR: WLASL_v0.3.json not found:\n  {WLASL_JSON}")
        return

    print("Getting Kaggle download URL …")
    gcs_url = get_gcs_url()
    print("GCS URL obtained.\n")

    session = requests.Session()
    session.headers.update({"User-Agent": "camsl-downloader/1.0"})

    # Get total zip size
    head = session.head(gcs_url, timeout=10)
    total_size = int(head.headers["Content-Length"])
    print(f"Zip size: {total_size / 1e9:.2f} GB\n")

    print("Reading Central Directory …")
    cd_offset, cd_size = find_central_directory(session, gcs_url, total_size)
    print(f"  Central Directory at offset {cd_offset:,}, size {cd_size/1e6:.1f} MB")

    cd_data = _range_get(session, gcs_url, cd_offset, cd_offset + cd_size - 1)
    cd = parse_central_directory(cd_data)
    print(f"  Parsed {len(cd):,} zip entries.\n")

    sign_videos = load_sign_videos()

    total_ok = total_fail = total_skip = 0

    for sign, ids in sign_videos.items():
        out_dir = RAW_VIDEO_DIR / sign
        ok = skip = 0
        print(f"  [{sign}]  {len(ids)} videos …")

        for vid_id in ids:
            dest     = out_dir / f"{vid_id}.mp4"
            zip_path = f"videos/{vid_id}.mp4"

            if dest.exists() and dest.stat().st_size > 5_000:
                skip += 1
                continue

            entry = cd.get(zip_path)
            if entry is None:
                total_fail += 1
                continue

            success = download_entry(session, gcs_url, entry, dest)
            if success:
                ok += 1
            else:
                total_fail += 1

        total_ok   += ok
        total_skip += skip
        final = sum(1 for p in out_dir.glob("*.mp4") if p.stat().st_size > 5_000) if out_dir.exists() else 0
        status = "✓ ready" if final >= 15 else f"need {15 - final} more"
        msg = f"{ok} downloaded"
        if skip:
            msg += f", {skip} already had"
        print(f"  [{sign}]  {msg}  →  {final} total  [{status}]")

    print(f"\nDone.  {total_ok} downloaded,  {total_skip} already existed,  {total_fail} failed/missing.")
    print(f"\nNext:  python src/extract_word_landmarks.py")


if __name__ == "__main__":
    main()
