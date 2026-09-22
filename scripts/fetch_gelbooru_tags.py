#!/usr/bin/env python3
"""Create the bundled Gelbooru artist and metadata tag datasets once."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
DATA_DIR = ROOT / "data"
API_URL = "https://gelbooru.com/index.php"
PAGE_SIZE = 100
TYPE_ARTIST = 1
TYPE_METADATA = 5
DEFAULT_ARTIST_THRESHOLD = 50


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip("\"'"))


def request_page(api_key: str, user_id: str, pid: int, retries: int = 5) -> dict:
    params = urllib.parse.urlencode({
        "page": "dapi", "s": "tag", "q": "index", "json": 1,
        "limit": PAGE_SIZE, "pid": pid, "orderby": "count", "order": "DESC",
        "api_key": api_key, "user_id": user_id,
    })
    request = urllib.request.Request(
        f"{API_URL}?{params}",
        headers={"Accept": "application/json", "User-Agent": "novelai-style-evolver/1.0"},
    )
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            if isinstance(error, urllib.error.HTTPError) and error.code in {401, 403}:
                raise RuntimeError("Gelbooru 認證失敗，請檢查 .env。") from None
            if attempt == retries - 1:
                raise RuntimeError(f"Gelbooru 第 {pid} 頁抓取失敗。") from None
            time.sleep(min(30, (2 ** attempt) + random.random()))
    raise AssertionError("unreachable")


def prompt_tag(name: str) -> str:
    return re.sub(r"_+", " ", name.strip().lower())


def load_seed() -> dict:
    return json.loads((DATA_DIR / "style-tags.seed.json").read_text(encoding="utf-8"))


def atomic_json(path: Path, value: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def build_style_output(metadata: dict[str, dict], threshold: int) -> dict:
    seed = load_seed()
    style_items: dict[str, dict] = {}
    for item in seed["tags"]:
        normalized = item["tag"].strip().lower()
        style_items[normalized] = {
            "tag": normalized,
            "category": item["category"],
            "polarity": item.get("polarity", "positive"),
            "source": item.get("source", "curated-seed"),
            "postCount": item.get("postCount"),
        }
    for year in range(2000, 2027):
        tag = f"year {year}"
        style_items.setdefault(tag, {
            "tag": tag,
            "category": "year",
            "polarity": "positive",
            "source": "nai-official",
            "postCount": None,
        })
    # Gelbooru type=metadata contains many workflow and file-state tags. Only
    # metadata explicitly curated in the seed file may enter the mutation pool.
    for record in metadata.values():
        normalized = prompt_tag(record["name"])
        current = style_items.get(normalized)
        if current:
            current["source"] = "nai-or-user+gelbooru"
            current["postCount"] = record["postCount"]
    return {
        "version": 3,
        "targetCount": seed.get("targetCount", len(style_items)),
        "minimumPostCountExclusive": threshold,
        "metadataPolicy": seed.get("metadataPolicy", "curated-seed-whitelist"),
        "source": seed.get("source", "NAI / user seed"),
        "categories": seed["categories"],
        "tags": sorted(style_items.values(), key=lambda value: (value["category"], value["tag"])),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--delay", type=float, default=1.0, help="每次 API 請求後等待秒數")
    parser.add_argument("--start-page", type=int, default=0)
    parser.add_argument("--max-pages", type=int, default=0, help="0 代表抓到所有門檻都已涵蓋")
    parser.add_argument("--threshold", type=int, default=50)
    parser.add_argument("--artist-threshold", type=int, default=DEFAULT_ARTIST_THRESHOLD,
                        help="收集進資料檔的畫師最低作品數（包含此數值，預設 50）")
    parser.add_argument("--workers", type=int, default=1, choices=range(1, 9))
    parser.add_argument("--rebuild-style", action="store_true", help="只由現有 raw metadata 重建風格詞")
    args = parser.parse_args()
    lowest_required_count = min(args.artist_threshold, args.threshold + 1)

    if args.rebuild_style:
        raw_path = DATA_DIR / "metadata-tags.raw.json"
        if not raw_path.exists():
            print("缺少 data/metadata-tags.raw.json。", file=sys.stderr)
            return 2
        raw = json.loads(raw_path.read_text(encoding="utf-8"))
        metadata = {item["name"]: item for item in raw.get("tags", [])}
        style_output = build_style_output(metadata, args.threshold)
        atomic_json(DATA_DIR / "style-tags.json", style_output)
        print(f"已由 raw metadata 重建 {len(style_output['tags'])} 個風格詞。")
        return 0

    load_dotenv(ENV_PATH)
    api_key = os.environ.get("GELBOORU_API_KEY", "").strip()
    user_id = os.environ.get("GELBOORU_USER_ID", "").strip()
    if not api_key or not user_id:
        print("缺少 GELBOORU_API_KEY 或 GELBOORU_USER_ID。", file=sys.stderr)
        return 2

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    checkpoint_path = DATA_DIR / ".gelbooru-checkpoint.json"
    checkpoint = {"nextPage": args.start_page, "artists": {}, "metadata": {}}
    if checkpoint_path.exists() and args.start_page == 0:
        checkpoint.update(json.loads(checkpoint_path.read_text(encoding="utf-8")))

    page = int(checkpoint.get("nextPage", args.start_page))
    artists = {
        name: record for name, record in checkpoint.get("artists", {}).items()
        if int(record.get("postCount", 0)) >= args.artist_threshold
    }
    metadata = {
        name: record for name, record in checkpoint.get("metadata", {}).items()
        if int(record.get("postCount", 0)) > args.threshold
    }
    fetched = 0
    done = False
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        while not done:
            remaining = args.max_pages - fetched if args.max_pages else args.workers
            count = min(args.workers, remaining) if args.max_pages else args.workers
            pages = list(range(page, page + max(1, count)))
            payloads = executor.map(lambda current: request_page(api_key, user_id, current), pages)
            for current_page, payload in zip(pages, payloads):
                tags = payload.get("tag", [])
                if isinstance(tags, dict):
                    tags = [tags]
                if not tags:
                    done = True
                    break
                for item in tags:
                    item_count = int(item.get("count", 0))
                    tag_type = int(item.get("type", -1))
                    name = str(item.get("name", "")).strip().lower()
                    if not name:
                        continue
                    record = {"id": int(item.get("id", 0)), "name": name, "postCount": item_count}
                    if tag_type == TYPE_ARTIST and item_count >= args.artist_threshold:
                        artists[name] = record
                    elif tag_type == TYPE_METADATA and item_count > args.threshold:
                        metadata[name] = record

                page = current_page + 1
                fetched += 1
                lowest = min(int(item.get("count", 0)) for item in tags)
                if fetched == 1 or fetched % 50 == 0 or lowest < lowest_required_count:
                    print(
                        f"page={current_page} lowest={lowest} artists={len(artists)} metadata={len(metadata)}",
                        file=sys.stderr,
                        flush=True,
                    )
                if lowest < lowest_required_count or (args.max_pages and fetched >= args.max_pages):
                    done = True
                    break
            checkpoint = {"nextPage": page, "artists": artists, "metadata": metadata}
            atomic_json(checkpoint_path, checkpoint)
            if not done:
                time.sleep(max(0.0, args.delay))

    artist_output = {
        "version": 1,
        "source": "https://gelbooru.com/index.php?page=dapi&s=tag&q=index",
        "minimumPostCount": args.artist_threshold,
        "artists": [
            {
                "tag": f"artist:{record['name']}",
                "sourceTagId": record["id"],
                "postCount": record["postCount"],
            }
            for record in sorted(artists.values(), key=lambda value: (-value["postCount"], value["name"]))
        ],
    }
    raw_metadata = {
        "version": 1,
        "minimumPostCountExclusive": args.threshold,
        "tags": sorted(metadata.values(), key=lambda value: (-value["postCount"], value["name"])),
    }
    style_output = build_style_output(metadata, args.threshold)
    atomic_json(DATA_DIR / "artists.json", artist_output)
    atomic_json(DATA_DIR / "metadata-tags.raw.json", raw_metadata)
    atomic_json(DATA_DIR / "style-tags.json", style_output)
    checkpoint_path.unlink(missing_ok=True)
    print(f"完成：{len(artist_output['artists'])} 位畫師，{len(style_output['tags'])} 個風格詞。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
