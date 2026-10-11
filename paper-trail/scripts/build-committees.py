#!/usr/bin/env python3
"""Build src/data/committees.json: current committee and subcommittee seats
for every member of Congress, keyed by bioguide id (the id Quiver puts on each
congressional trade).

Source: github.com/unitedstates/congress-legislators (public domain).

    python3 scripts/build-committees.py              # downloads from GitHub
    python3 scripts/build-committees.py --from dir   # uses dir/committees-current.yaml
                                                     # and dir/committee-membership-current.yaml

Output:
    {
      "v": 1, "built": "YYYY-MM-DD", "source": "...",
      "committees": { "HSAS": ["House Armed Services", "house"], "HSAP02": ["House Appropriations: Defense", "house"], ... },
      "members":    { "B001236": [["SSAF", "chair"], ["SSAP01", ""], ...], ... }
    }

Requires PyYAML (pip install pyyaml). Which committee oversees which
industry is decided in src/model/oversight.js, not here.
"""
import argparse
import datetime
import json
import os
import re
import urllib.request

import yaml

BASE = "https://raw.githubusercontent.com/unitedstates/congress-legislators/main/"
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def load(name, src):
    if src:
        with open(os.path.join(src, name)) as f:
            return yaml.safe_load(f)
    with urllib.request.urlopen(BASE + name, timeout=60) as r:
        return yaml.safe_load(r.read())


def short(name, kind):
    n = re.sub(r"^(House|Senate)\s+(Permanent\s+)?(Select\s+|Special\s+)?Committee on (the )?", "", name)
    n = re.sub(r"^United States Senate\s+", "", n)
    n = n.replace(", Nutrition, and Forestry", " and Forestry")
    prefix = {"house": "House", "senate": "Senate", "joint": "Joint"}.get(kind, "")
    return f"{prefix} {n}".strip()


def role(title):
    t = (title or "").lower()
    if t.startswith("chair") or t == "cochairman":
        return "chair"
    if t.startswith("ranking"):
        return "ranking"
    return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src")
    ap.add_argument("--out", default=os.path.join(ROOT, "src", "data", "committees.json"))
    a = ap.parse_args()

    committees = {}
    for c in load("committees-current.yaml", a.src):
        cid = c["thomas_id"]
        kind = c.get("type", "")
        base = short(c["name"], kind)
        committees[cid] = [base, kind]
        for s in c.get("subcommittees", []) or []:
            committees[cid + s["thomas_id"]] = [f"{base}: {s['name']}", kind]

    members = {}
    for cid, seats in (load("committee-membership-current.yaml", a.src) or {}).items():
        if cid not in committees:
            continue
        for seat in seats or []:
            bid = seat.get("bioguide")
            if not bid:
                continue
            members.setdefault(bid, []).append([cid, role(seat.get("title"))])

    out = {
        "v": 1,
        "built": datetime.date.today().isoformat(),
        "source": "github.com/unitedstates/congress-legislators",
        "committees": committees,
        "members": members,
    }
    with open(a.out, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(json.dumps({"committees": len(committees), "members": len(members), "seats": sum(len(v) for v in members.values()), "bytes": os.path.getsize(a.out)}))


if __name__ == "__main__":
    main()
