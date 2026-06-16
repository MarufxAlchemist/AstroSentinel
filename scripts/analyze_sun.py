import json, pathlib, sys

root = pathlib.Path(r"E:\Maruf data\Antigravity\Cosmic-Alert-System")

files = {
    "historical_events.json":      root / "historical_events.json",
    "historical_events_2026.json": root / "historical_events_2026.json",
}

TARGET_IDS = {"FRB20260615T145508Z", "GRB260607A", "GRB260609A", "GRB260608C"}

for fname, fpath in files.items():
    if not fpath.exists():
        print(f"\n[SKIP] {fname} — not found\n")
        continue

    print(f"\n{'='*60}")
    print(f"FILE: {fname}")
    print(f"{'='*60}")

    data = json.loads(fpath.read_text(encoding="utf-8-sig"))
    print(f"  Total records: {len(data)}")

    if data:
        print(f"  Keys in first record: {sorted(data[0].keys())}")

    # Distribution of sunDistance values
    dist = {}
    for e in data:
        v = str(e.get("sunDistance", "MISSING"))
        dist[v] = dist.get(v, 0) + 1
    print(f"\n  sunDistance distribution (top 10):")
    for val, cnt in sorted(dist.items(), key=lambda x: -x[1])[:10]:
        print(f"    {cnt:>5}  {val}")

    # Distribution of moonDistance values
    mdist = {}
    for e in data:
        v = str(e.get("moonDistance", "MISSING"))
        mdist[v] = mdist.get(v, 0) + 1
    print(f"\n  moonDistance distribution (top 10):")
    for val, cnt in sorted(mdist.items(), key=lambda x: -x[1])[:10]:
        print(f"    {cnt:>5}  {val}")

    # Targeted lookups
    print(f"\n  Targeted event lookup:")
    found = {e["eventId"]: e for e in data if e.get("eventId") in TARGET_IDS}
    for eid in TARGET_IDS:
        if eid in found:
            e = found[eid]
            print(f"    {eid}: sun={e.get('sunDistance','MISSING')} moon={e.get('moonDistance','MISSING')} source={e.get('source','?')} isHistorical={e.get('isHistorical','?')}")
        else:
            print(f"    {eid}: NOT FOUND in this file")

print()
