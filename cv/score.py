"""Made baskets and who shot them, from extract.py's per-frame output.

  make    = the ball is above the rim, then within a second it is below the rim
            and still horizontally inside it
  shooter = walking back from the make, the last player whose hands the ball
            was in before its flight
  number  = votes from every jersey read on the shooter's track
  team    = jersey colour cluster of the shooter's track

usage: python score.py out/<video>-frames.jsonl [--truth jv]
"""
import argparse, json
from collections import Counter, defaultdict

import cv2
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("frames")
ap.add_argument("--truth", help="key in truth.json to compare against")
ap.add_argument("--debug", action="store_true")
ap.add_argument("--video", help="video file, for a focused jersey read on each shooter")
args = ap.parse_args()

F = [json.loads(l) for l in open(args.frames)]
T = np.array([f["t"] for f in F])


def ball_size_near(i, span=30):
    s = [F[k]["ball"][2] for k in range(max(0, i - span), min(len(F), i + span)) if F[k]["ball"]]
    return float(np.median(s)) if s else 30.0


# 1) Rim per frame. Candidates come every ~0.5 s; drop ones that are really
#    the ball (same place, same size) and keep the best wide, short box.
rim_at = [None] * len(F)
for i, f in enumerate(F):
    if not f["rim"]:
        continue
    bs = ball_size_near(i)
    b = f["ball"]
    best, board = None, None
    for x1, y1, x2, y2, s in f["rim"]:
        w, h = x2 - x1, y2 - y1
        on_ball = b and abs(b[0] - (x1 + x2) / 2) < bs * 0.6 and abs(b[1] - (y1 + y2) / 2) < bs * 0.6 and w < bs * 1.6
        if on_ball:
            continue
        if bs * 1.4 <= w <= bs * 4 and w / max(h, 1) >= 1.4:
            if not best or s > best[0]:
                best = (s, [x1, y1, x2, y2])
        elif bs * 3.5 <= w <= bs * 10 and 0.8 <= w / max(h, 1) <= 1.8:
            if not board or s > board[0]:
                board = (s, [x1, y1, x2, y2])
    if best:
        rim_at[i] = best[1]
    elif board:
        # no rim box: the rim hangs at the bottom-centre of the backboard
        x1, y1, x2, y2 = board[1]
        w, h, cx = x2 - x1, y2 - y1, (x1 + x2) / 2
        rim_at[i] = [cx - 0.18 * w, y2 - 0.25 * h, cx + 0.18 * w, y2 - 0.05 * h]
# carry each rim until the next one found (<=0.6 s; the camera pans)
last, last_t = None, -9
for i, f in enumerate(F):
    if rim_at[i]:
        last, last_t = rim_at[i], f["t"]
    elif last and f["t"] - last_t <= 0.6:
        rim_at[i] = last

# 2) Makes.
makes = []
for i, f in enumerate(F):
    b, r = f["ball"], rim_at[i]
    if not b or not r:
        continue
    w = r[2] - r[0]
    if not (b[1] < r[1] and r[0] - 0.5 * w <= b[0] <= r[2] + 0.5 * w and r[1] - b[1] < 3 * w):
        continue
    for j in range(i + 1, len(F)):
        if F[j]["t"] - f["t"] > 1.0:
            break
        b2, r2 = F[j]["ball"], rim_at[j] or r
        if not b2:
            continue
        w2 = r2[2] - r2[0]
        if b2[1] > r2[3] and r2[0] - 0.1 * w2 <= b2[0] <= r2[2] + 0.1 * w2 and b2[1] - r2[3] < 1.5 * w2:
            if not makes or f["t"] - makes[-1]["t"] > 4:
                makes.append({"t": f["t"], "i": i})
            break


# 3) Shooter: walk back from the make while the ball is in flight (not in
#    anyone's hands); the first player found holding it is the shooter.
def holder(f):
    b = f["ball"]
    if not b:
        return None
    best = None
    for p in f["p"]:
        x1, y1, x2, y2 = p["b"]
        w, h = x2 - x1, y2 - y1
        if x1 - 0.25 * w <= b[0] <= x2 + 0.25 * w and y1 - 0.35 * h <= b[1] <= y1 + 0.6 * h:
            d = abs(b[0] - (x1 + x2) / 2) / w + abs(b[1] - y1) / h
            if not best or d < best[0]:
                best = (d, p["id"])
    return best[1] if best else None


for m in makes:
    m["shooter"] = None
    in_flight = 0
    for k in range(m["i"], -1, -1):
        if m["t"] - F[k]["t"] > 4:
            break
        h = holder(F[k])
        if h is None:
            in_flight += 1
            continue
        if in_flight >= 2 or m["t"] - F[k]["t"] > 0.6:
            m["shooter"], m["release"] = h, F[k]["t"]
            break

# 4) Track identities: number by vote, team by jersey colour.
votes, cols, frames_of = defaultdict(Counter), defaultdict(list), Counter()
for f in F:
    for p in f["p"]:
        frames_of[p["id"]] += 1
        if "n" in p:
            votes[p["id"]][p["n"][0]] += p["n"][1]
        if p.get("c"):
            cols[p["id"]].append(p["c"])


def colour_name(lab):
    L, a, b = lab[0] * 100 / 255, lab[1] - 128, lab[2] - 128
    if a > 8 and a > abs(b) * 0.6:
        return "red"
    if a < -1 and a < b:
        return "green" if L < 60 else "teal"
    if b < -8:
        return "blue"
    if b > 15:
        return "yellow" if L > 60 else "orange"
    return "white" if L > 70 else "black" if L < 30 else "grey"


# Two teams = two clusters over the colour of players' tracks. Referees and
# crowd (very light / near-neutral and rarely on court long) mostly fall
# out because only long tracks seed the clusters; short tracks join the
# nearest one.
med = {tid: np.median(np.array(c), axis=0) for tid, c in cols.items() if c}
seed = np.array([med[t][1:] for t, c in cols.items() if len(c) >= 10 and med[t][0] < 115], dtype=np.float32)
team_of = {}
if len(seed) >= 4:
    _, _, cen = cv2.kmeans(seed, 2, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 0.2), 8, cv2.KMEANS_PP_CENTERS)
    full = [np.median(np.array([med[t] for t, c in cols.items() if len(c) >= 10 and np.argmin(((cen - med[t][1:]) ** 2).sum(1)) == k]), axis=0) for k in range(2)]
    names = [colour_name(f) for f in full]
    if names[0] == names[1]:
        names = [names[0] + "-1", names[1] + "-2"]
    for t, m in med.items():
        d = ((cen - m[1:]) ** 2).sum(1)
        team_of[t] = names[int(np.argmin(d))] if m[0] < 130 else "ref?"


# Tracks break when players cross; a shooter's track with no number read
# borrows from same-colour tracks that overlap its last box spatially in time.
def number_of(tid, t):
    if votes[tid]:
        n, v = votes[tid].most_common(1)[0]
        return n, round(v, 1)
    return None, 0


# Focused read: the shooter's track usually lives only a few seconds, so go
# back to the video and read their jersey on every frame around the shot.
reader = cap = None
if args.video:
    import easyocr
    reader = easyocr.Reader(["en"], gpu=True, verbose=False)
    cap = cv2.VideoCapture(args.video)


def focused_number(tid, t_from, t_to):
    got = Counter()
    for f in F:
        if not (t_from <= f["t"] <= t_to):
            continue
        p = next((p for p in f["p"] if p["id"] == tid), None)
        if not p:
            continue
        cap.set(cv2.CAP_PROP_POS_MSEC, f["t"] * 1000)
        ok, img = cap.read()
        if not ok:
            continue
        x1, y1, x2, y2 = p["b"]
        h = y2 - y1
        torso = img[max(0, y1 + int(h * 0.1)):y1 + int(h * 0.55), max(0, x1):x2]
        if torso.shape[0] < 20:
            continue
        big = cv2.resize(torso, None, fx=96 / torso.shape[0], fy=96 / torso.shape[0], interpolation=cv2.INTER_CUBIC)
        for _, text, conf in reader.readtext(big, allowlist="0123456789", detail=1):
            t = text.strip()
            if 1 <= len(t) <= 2 and conf >= 0.3:
                got[t.lstrip("0") or "0"] += conf
    return got


box = defaultdict(Counter)
print(f"{len(makes)} makes found in {F[0]['t']:.0f}-{F[-1]['t']:.0f}s")
for m in makes:
    tid = m["shooter"]
    n, v = number_of(tid, m["t"]) if tid is not None else (None, 0)
    if reader and tid is not None:
        fv = focused_number(tid, m["release"] - 3, m["t"] + 1.5) + votes[tid]
        if fv:
            n, v = fv.most_common(1)[0][0], round(fv.most_common(1)[0][1], 1)
    team = team_of.get(tid, "?")
    m.update(team=team, num=n)
    box[team][n or "?"] += 2
    mm, ss = divmod(int(m["t"]), 60)
    print(f"  {mm}:{ss:02d}  {team:6s} #{n or '?':>2}  (track {tid}, {v} votes, released {m.get('release', '-')})")

if args.truth:
    truth = json.load(open("truth.json"))[args.truth]
    teams = {k: v for k, v in box.items() if k != "?"}
    names = sorted(teams, key=lambda k: -sum(teams[k].values()))[:2]
    best = None
    for perm in ([names[0], names[1]], [names[1], names[0]]) if len(names) == 2 else [names + ["-"]]:
        right = sum(min(teams.get(c, {}).get(n, 0), p) for c, side in zip(perm, ["a", "b"]) for n, p in truth[side]["pts"].items())
        if not best or right > best[0]:
            best = (right, perm)
    tot = truth["a"]["total"] + truth["b"]["total"]
    print(f"\nvs truth (whole game): {best[0]} of {tot} points to the right player = {round(100 * best[0] / tot)}%  (mapping {best[1]})")
    for c, side in zip(best[1], ["a", "b"]):
        print(f"  {truth[side]['name']} ({c}): " + "  ".join(f"#{n} {teams.get(c, {}).get(n, 0)}/{p}" for n, p in sorted(truth[side]['pts'].items(), key=lambda x: -x[1]) if p or teams.get(c, {}).get(n)))
