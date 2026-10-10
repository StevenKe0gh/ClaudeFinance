#!/usr/bin/env python3
"""Fetch dark-theme company logos and pack them as data URIs for the artifact db.

Logos come from github.com/nvstly/icons (white/light marks on transparent
backgrounds, made for dark UIs). Each is resized to a small square PNG so a
few hundred fit in a handful of database documents.

    python3 jobs/logos.py --tickers MRVL,AMD,C --out out/logos.json
    python3 jobs/logos.py --tickers-file tickers.txt --have have.json --packs out/packs --start-pack 3

Requires Pillow (pip install pillow).
"""
import argparse
import base64
import io
import json
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

BASE = "https://raw.githubusercontent.com/nvstly/icons/main/ticker_icons/{}.png"
PACK_BUDGET = 190_000  # bytes per db document (limit is 256 KiB)


def fetch(ticker, size):
    url = BASE.format(ticker.replace(".", "-"))
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "paper-trail"}), timeout=20) as r:
            raw = r.read()
    except Exception:
        return ticker, None
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGBA")
        img.thumbnail((size, size), Image.LANCZOS)
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        canvas.paste(img, ((size - img.width) // 2, (size - img.height) // 2), img)
        buf = io.BytesIO()
        canvas.save(buf, "PNG", optimize=True)
        return ticker, "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return ticker, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", default="")
    ap.add_argument("--tickers-file")
    ap.add_argument("--have", help="JSON list or {ticker: ...} of logos already stored; skipped")
    ap.add_argument("--size", type=int, default=48)
    ap.add_argument("--out", help="write {logos, missing} here")
    ap.add_argument("--packs", help="directory for pack files p<N>.json sized for db documents")
    ap.add_argument("--start-pack", type=int, default=0)
    a = ap.parse_args()

    tickers = [t.strip().upper() for t in a.tickers.split(",") if t.strip()]
    if a.tickers_file:
        tickers += [t.strip().upper() for t in open(a.tickers_file) if t.strip()]
    have = set()
    if a.have and os.path.exists(a.have):
        h = json.load(open(a.have))
        have = set(h if isinstance(h, list) else h.keys())
    todo = sorted(set(tickers) - have)

    with ThreadPoolExecutor(8) as ex:
        results = dict(ex.map(lambda t: fetch(t, a.size), todo))
    logos = {t: d for t, d in results.items() if d}
    missing = sorted(t for t, d in results.items() if not d)

    if a.out:
        os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
        json.dump({"logos": logos, "missing": missing}, open(a.out, "w"))
    if a.packs:
        os.makedirs(a.packs, exist_ok=True)
        pack, size, n = {}, 0, a.start_pack
        for t in sorted(logos):
            item = len(t) + len(logos[t]) + 8
            if pack and size + item > PACK_BUDGET:
                json.dump({"logos": pack}, open(os.path.join(a.packs, f"p{n}.json"), "w"))
                pack, size, n = {}, 0, n + 1
            pack[t] = logos[t]
            size += item
        if pack:
            json.dump({"logos": pack}, open(os.path.join(a.packs, f"p{n}.json"), "w"))
    print(json.dumps({"requested": len(todo), "found": len(logos), "missing": len(missing), "bytes": sum(len(v) for v in logos.values())}))


if __name__ == "__main__":
    sys.exit(main())
