"""Build the static handbook fixture used by the Firebase Hosting build.

Run after starting the FastAPI server on :8000 (python main.py).
Writes static/data/handbook.json which the client-side bridge consumes so the
SPA keeps working with no Python process behind it.
"""
import json
import urllib.request
from pathlib import Path

BASE = "http://localhost:8000"
OUT = Path(__file__).resolve().parent / "static" / "data" / "handbook.json"


def get(path: str):
    with urllib.request.urlopen(BASE + path, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def post(path: str, payload: dict):
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        BASE + path, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(request, timeout=240) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> None:
    print("Fetching meta ...")
    meta = get("/api/meta")
    print("Fetching elements ...")
    elements = get("/api/elements")
    print("Fetching validated alloys ...")
    alloys = get("/api/alloys/validated")
    print("Fetching prescreen ...")
    prescreen = post("/api/prescreen", {
        "datasets": ["steels", "glass", "expt_gap"],
        "persona": "Aerospace",
        "min_confidence": "Low",
        "limit": 200,
        "include_hazardous": True,
    })
    print("Fetching leaderboard ...")
    leaderboard = get("/api/leaderboard?limit=25")

    payload = {
        "meta": meta,
        "elements": elements.get("elements", {}),
        "periodic": elements.get("periodic_table", []),
        "hazardous_elements": elements.get("hazardous_elements", []),
        "hazardous_meta": elements.get("hazardous_meta", {}),
        "category_colors": elements.get("category_colors", {}),
        "alloys": alloys.get("alloys", []),
        "prescreen": prescreen,
        "leaderboard": {
            "leaders": leaderboard.get("leaders", []),
            "stats": leaderboard.get("stats", {}),
            "title": leaderboard.get("title", ""),
            "subtitle": leaderboard.get("subtitle", ""),
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    size_kb = OUT.stat().st_size / 1024
    print(f"Wrote {OUT} ({size_kb:.1f} KB)")
    print(f"  periodic rows : {len(payload['periodic'])}")
    print(f"  prescreen rows: {len(prescreen.get('candidates', []))}")
    print(f"  validated     : {len(payload['alloys'])}")
    print(f"  leaders       : {len(payload['leaderboard']['leaders'])}")


if __name__ == "__main__":
    main()
