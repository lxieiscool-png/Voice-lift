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
ap.add_argument("--home", help="jersey colour of the home team on the scoreboard (the app asks the uploader)")
ap.add_argument("--roster", action="append", default=[], help="colour=1,3,11,... jersey numbers a team can have (repeatable)")
ap.add_argument("--looks", action="append", default=[], help="label=how the jerseys look, e.g. black='dark green' (for close-up prompts)")
ap.add_argument("--closeups", action="store_true", help="ask Gemini about tight crops (jersey, shot type, make/miss)")
ap.add_argument("--board", help="out/<video>-board.json from scoreboard.py: score changes decide makes and points")
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

# 2) Shots. An attempt is the ball arriving above the rim; it "looks made"
#    if within a second it is below the rim and still inside it horizontally.
#    From some angles a ball rolling off the front rim passes that test too,
#    which is why the scoreboard (when readable) has the final say.
shots = []
for i, f in enumerate(F):
    b, r = f["ball"], rim_at[i]
    if not b or not r:
        continue
    w = r[2] - r[0]
    if not (b[1] < r[1] and r[0] - 0.5 * w <= b[0] <= r[2] + 0.5 * w and r[1] - b[1] < 3 * w):
        continue
    made = False
    for j in range(i + 1, len(F)):
        if F[j]["t"] - f["t"] > 1.0:
            break
        b2, r2 = F[j]["ball"], rim_at[j] or r
        if not b2:
            continue
        w2 = r2[2] - r2[0]
        if b2[1] > r2[3] and r2[0] - 0.1 * w2 <= b2[0] <= r2[2] + 0.1 * w2 and b2[1] - r2[3] < 1.5 * w2:
            made = True
            break
    if shots and f["t"] - shots[-1]["t"] <= 3:
        shots[-1]["made"] |= made
        continue
    shots.append({"t": f["t"], "i": i, "made": made})
makes = [s_ for s_ in shots if s_["made"]]


# 3) Shooter: walk back from the make while the ball is in flight (not in
#    anyone's hands); the first player found holding it is the shooter.
def holder(f, only=None, slack=0.25):
    b = f["ball"]
    if not b:
        return None
    best = None
    for p in f["p"]:
        if only and not only(p["id"]):
            continue
        x1, y1, x2, y2 = p["b"]
        w, h = x2 - x1, y2 - y1
        if x1 - slack * w <= b[0] <= x2 + slack * w and y1 - 0.35 * h <= b[1] <= y1 + 0.6 * h:
            d = abs(b[0] - (x1 + x2) / 2) / w + abs(b[1] - y1) / h
            if not best or d < best[0]:
                best = (d, p["id"])
    return best[1] if best else None


def trace(m, only=None, slack=0.25):
    """Walk back from the shot while the ball is in flight; the first player
    found holding it is the shooter. `only` restricts who can be the holder."""
    in_flight = 0
    for k in range(m["i"], -1, -1):
        if m["t"] - F[k]["t"] > 4:
            break
        h = holder(F[k], only, slack)
        if h is None:
            in_flight += 1
            continue
        if in_flight >= 2 or m["t"] - F[k]["t"] > 0.6:
            return h, F[k]["t"]
    return None, None


for m in shots:
    m["shooter"], m["release"] = trace(m)

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
    # same name for both (e.g. black vs dark green): tell them apart by hue
    if names[0] == names[1]:
        g = int(np.argmin([f[1] for f in full]))  # lower a* = greener
        names = ["", ""]
        names[g], names[1 - g] = "green", colour_name(full[1 - g]) if colour_name(full[1 - g]) != "green" else "dark"
    print("teams by colour:", {n: [int(v) for v in f] for n, f in zip(names, full)})
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


ROSTER = {c: set(ns.split(",")) for c, ns in (r.split("=") for r in args.roster)}


def identify(m):
    tid = m["shooter"]
    roster = ROSTER.get(team_of.get(tid))
    if CU:
        looks = {lab: LOOKS.get(lab, lab) for lab in TEAMS}
        want = m.get("want") or TEAMS[0]
        team, num, typ = CU.shooter(cap, VID, m, {want: looks[want], **looks}, ROSTER.get(want))
        m["type"] = typ
        if team:
            m.update(team=team, num=num if (not ROSTER.get(team) or num in ROSTER[team]) else None, votes="gemini")
            return m
    n, v = number_of(tid, m["t"]) if tid is not None else (None, 0)
    if reader and tid is not None:
        fv = focused_number(tid, m["release"] - 3, m["t"] + 1.5) + votes[tid]
        if roster:
            fv = Counter({k: v for k, v in fv.items() if k in roster})
        if fv:
            n, v = fv.most_common(1)[0][0], round(fv.most_common(1)[0][1], 1)
    m.update(team=team_of.get(tid, "?"), num=n, votes=v)
    return m


def chain(reads):
    """Longest physically possible run of (t, score) readings: never down,
    never faster than teams score. Single misreads fall out."""
    reads = sorted(reads)
    if not reads:
        return []
    ok = lambda a, b: b[1] >= a[1] and b[1] - a[1] <= 4 + (b[0] - a[0]) / 8
    L, prev = [1] * len(reads), [-1] * len(reads)
    for j in range(len(reads)):
        for i in range(j):
            if ok(reads[i], reads[j]) and L[i] + 1 > L[j]:
                L[j], prev[j] = L[i] + 1, i
    k = max(range(len(reads)), key=lambda i: (L[i], -i))
    out = []
    while k != -1:
        out.append(reads[k]); k = prev[k]
    return out[::-1]


def increments(ch):
    """[(last time old score seen, first time new score seen, points)]"""
    out = []
    for a, b in zip(ch, ch[1:]):
        if b[1] > a[1]:
            out.append((a[0], b[0], b[1] - a[1]))
    return out


CU = VID = None
LOOKS = dict(l.split("=", 1) for l in args.looks)
TEAMS = [t for t, _ in Counter(v for v in team_of.values() if v != "ref?").most_common(2)]
if args.closeups:
    import closeups as CU
    import os
    VID = os.path.basename(args.video).split(".")[0]
    if cap is None:
        cap = cv2.VideoCapture(args.video)
    for m in shots:
        m["gmade"] = CU.made(cap, VID, F, m, rim_at) if m["shooter"] is not None else None
    print(f"close-up make/miss: {sum(1 for m in shots if m.get('gmade'))} made of {len(shots)} attempts")

box = defaultdict(Counter)
log = []
if args.board:
    board = json.load(open(args.board))
    def confirmed(k):
        # a score only counts once it has been read at least twice
        n = Counter(o[k] for o in board if o[k] is not None)
        return [(o["t"], o[k]) for o in board if o[k] is not None and n[o[k]] >= 2]
    sides = {k: chain(confirmed(k)) for k in ("home", "guest")}
    teams = [t for t, _ in Counter(team_of.get(m["shooter"]) for m in shots if team_of.get(m["shooter"]) not in (None, "ref?")).most_common(2)]

    def candidates(inc, colour):
        """Shots by `colour` in the window. When the board says this team
        scored but the traced shooter is an opponent (a contesting defender
        is often closest to the ball), re-trace among this team's players."""
        a, b, d = inc
        window = [m for m in shots if a - 3 <= m["t"] <= b]
        if CU:
            # the close-up read decides who shot; vision only supplies moments
            return [m for m in window if m.get("gmade") is not False]
        own = [m for m in window if m["shooter"] is not None and team_of.get(m["shooter"]) == colour]
        if own:
            return own
        out = []
        for m in window:
            tid, rel = trace(m, only=lambda x: team_of.get(x) == colour, slack=0.6)
            if tid is not None:
                out.append({**m, "shooter": tid, "release": rel})
        return out

    # which jersey colour is the home side: the one whose shots line up with home score changes
    fit = lambda colour, side: sum(1 for inc in increments(sides[side]) if candidates(inc, colour))
    if args.home and args.home in teams:
        teams = [args.home] + [t for t in teams if t != args.home]
    elif len(teams) == 2 and fit(teams[1], "home") + fit(teams[0], "guest") > fit(teams[0], "home") + fit(teams[1], "guest"):
        teams = teams[::-1]
    for side, colour in zip(("home", "guest"), teams):
        ch = sides[side]
        if CU and len(increments(ch)) <= 2:
            # board side not readable (often cut off by the frame): count the
            # close-up makes for this team instead
            print(f"{side} = {colour}: board unreadable, using close-up makes")
            for m in shots:
                if m.get("gmade"):
                    identify(m)
                    if m.get("team") != colour:
                        continue
                    p = {"ft": 1, "3": 3}.get(m.get("type"), 2)
                    box[colour][m["num"] or "?"] += p
                    log.append((m["t"], colour, m["num"] or "?", p, "close-up make"))
            continue
        if ch:
            print(f"{side} = {colour}: board {ch[0][1]} -> {ch[-1][1]} over {len(ch)} readings, {len(increments(ch))} changes")
        for inc in increments(ch):
            c = candidates(inc, colour)
            d = inc[2]
            # prefer shots that looked like makes, then the latest
            c.sort(key=lambda m: (m.get("gmade") is True, m["made"], m["t"]), reverse=True)
            if CU:
                c = [m for m in c if m.get("gmade") is not False] or c
            picks = c[:max(1, round(d / 2))] if d >= 4 else c[:1]
            if not picks:
                box[colour]["?"] += d
                log.append((inc[1], colour, "?", d, "no shot seen"))
                continue
            share = [d // len(picks)] * len(picks)
            share[0] += d - sum(share)
            for m, p in zip(picks, share):
                m["want"] = colour
                identify(m)
                # the board says which team scored; a close-up naming the other
                # team means the shooter is unknown, not that the board is wrong
                n = m["num"] if m.get("team", colour) == colour else None
                box[colour][n or "?"] += p
                log.append((m["t"], colour, m["num"] or "?", p, f"board +{d} by {inc[1]:.0f}s"))
    for t, colour, n, p, why in sorted(log):
        mm, ss = divmod(int(t), 60)
        print(f"  {mm}:{ss:02d}  {colour:6s} #{n:>2}  +{p}  ({why})")
else:
    print(f"{len(makes)} makes found in {F[0]['t']:.0f}-{F[-1]['t']:.0f}s")
    for m in makes:
        identify(m)
        box[m["team"]][m["num"] or "?"] += 2
        mm, ss = divmod(int(m["t"]), 60)
        print(f"  {mm}:{ss:02d}  {m['team']:6s} #{m['num'] or '?':>2}  (track {m['shooter']}, {m['votes']} votes, released {m.get('release', '-')})")

if args.truth:
    truth = json.load(open("truth.json"))[args.truth]
    teams = {k: v for k, v in box.items() if k not in ("?", None)}
    names = sorted(teams, key=lambda k: -sum(teams[k].values()))[:2]
    best = None
    for perm in ([names[0], names[1]], [names[1], names[0]]) if len(names) == 2 else [names + ["-"]]:
        right = sum(min(teams.get(c, {}).get(n, 0), p) for c, side in zip(perm, ["a", "b"]) for n, p in truth[side]["pts"].items())
        if not best or right > best[0]:
            best = (right, perm)
    tot = truth["a"]["total"] + truth["b"]["total"]
    print(f"\nvs truth (whole game): {best[0]} of {tot} points to the right player = {round(100 * best[0] / tot)}%  (mapping {best[1]})")
    for c, side in zip(best[1], ["a", "b"]):
        got = teams.get(c, {})
        print(f"  {truth[side]['name']} ({c}) {sum(got.values())}/{truth[side]['total']}: " + "  ".join(f"#{n} {got.get(n, 0)}/{p}" for n, p in sorted(truth[side]['pts'].items(), key=lambda x: -x[1]) if p or got.get(n)) + (f"  unknown {got['?']}" if got.get('?') else ""))
