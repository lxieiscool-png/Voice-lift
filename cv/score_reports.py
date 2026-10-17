"""Score engine reports against HoopIQ's box scores.
usage: python score_reports.py report2   (suffix of out/<video>-<suffix>.json)"""
import json, sys
suffix = sys.argv[1] if len(sys.argv) > 1 else "report"
truth = json.load(open("truth.json"))
for key, tk in [("JaD8DBMdvBk", "jv"), ("E9xAgACYm6s", "varsity"), ("WfkJJDIywtY", "barons")]:
    try:
        rep = json.load(open(f"out/{key}-{suffix}.json"))
    except FileNotFoundError:
        continue
    tr, m, T = truth[tk], rep["meta"], rep["teams"]
    tot = tr["a"]["total"] + tr["b"]["total"]
    right = sum(min(T[i]["players"].get(n, {}).get("pts", 0), p) for i, s in enumerate("ab") for n, p in tr[s]["pts"].items())
    named = sum(r["pts"] for t in T for r in t["players"].values())
    unk = sum(t["unidentified"]["pts"] for t in T)
    print(f"== {tk}: RIGHT {right}/{tot} = {round(100 * right / tot)}% | WRONG {named - right} ({round(100 * (named - right) / tot)}%) | unidentified {unk}")
    for t, s in zip(T, "ab"):
        print(f"   {tr[s]['name']}: final {t['final']} (real {tr[s]['total']}) | " + "  ".join(
            f"#{n} {t['players'].get(n, {}).get('pts', 0)}/{p}" for n, p in sorted(tr[s]['pts'].items(), key=lambda x: -x[1]) if p or n in t['players']))
    print(f"   {round(m['duration'] / 60)} min video | attempts {m['attempts']} | gemini {m['gemini_calls']} | timings {m['timings']}")
