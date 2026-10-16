"""Run the whole engine on a local video and compare with HoopIQ's box score.

usage: python run_local.py data/<video>.mp4 --truth jv --our-colour red --our-name Huntington
       [--opp-colour green] [--roster 11,24,...] [--size m] [--scan-fps 10]
"""
import argparse, json, os, sys

from dotenv import dotenv_values

from engine import closeups as CU, pipeline, vision as V

ap = argparse.ArgumentParser()
ap.add_argument("video")
ap.add_argument("--truth")
ap.add_argument("--our-colour")
ap.add_argument("--our-name")
ap.add_argument("--opp-colour")
ap.add_argument("--opp-name")
ap.add_argument("--roster", default="")
ap.add_argument("--size", default="m", help="m on a laptop, x on a datacenter GPU")
ap.add_argument("--scan-fps", type=float, default=10)
args = ap.parse_args()

key = os.path.splitext(os.path.basename(args.video))[0]
reader = CU.Reader(dotenv_values("../.env.local")["GEMINI_API_KEY"], cache_file="out/engine-cache.json")
hints = {"our_colour": args.our_colour, "our_name": args.our_name, "opp_colour": args.opp_colour,
         "opp_name": args.opp_name, "roster": [r for r in args.roster.split(",") if r]}
rep = pipeline.run(args.video, hints, reader, V.load_models(args.size), key=key,
                   log=lambda m: print(m, file=sys.stderr, flush=True), scan_fps=args.scan_fps)
json.dump(rep, open(f"out/{key}-engine.json", "w"), indent=1)
print(json.dumps(rep["meta"], indent=1))
for t in rep["teams"]:
    print(f"{t['name'] or t['label']} ({t['label']}): final {t['final']}, found {t['points_found']}, unidentified {t['unidentified']['pts']}")
    print("   " + "  ".join(f"#{n} {r['pts']}" for n, r in t["players"].items()))

if args.truth:
    truth = json.load(open("truth.json"))[args.truth]
    tot = truth["a"]["total"] + truth["b"]["total"]
    best = None
    for perm in (rep["teams"], rep["teams"][::-1]):
        right = sum(min(perm[i]["players"].get(n, {}).get("pts", 0), p) for i, side in enumerate("ab") for n, p in truth[side]["pts"].items())
        if not best or right > best[0]:
            best = (right, perm)
    right, perm = best
    named = sum(r["pts"] for t in perm for r in t["players"].values())
    unk = sum(t["unidentified"]["pts"] for t in perm)
    print(f"\nRIGHT player {right}/{tot} = {round(100 * right / tot)}% | WRONG player {named - right} pts ({round(100 * (named - right) / tot)}%) | unidentified {unk}")
    for t, side in zip(perm, "ab"):
        print(f"  {truth[side]['name']}: final {t['final']}/{truth[side]['total']}  " + "  ".join(
            f"#{n} {t['players'].get(n, {}).get('pts', 0)}/{p}" for n, p in sorted(truth[side]["pts"].items(), key=lambda x: -x[1]) if p or n in t["players"]))
