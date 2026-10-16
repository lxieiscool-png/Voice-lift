"""From per-frame detections to basketball events: where the rim is, every
shot attempt, and which jersey colour each player track wears. Pure
functions over the frame dicts that vision.scan produces."""
from collections import Counter, defaultdict

import cv2
import numpy as np


def pick_rim(cands, ball, ball_size: float = 30.0):
    """The real rim among detector candidates: a flat box a bit wider than the
    ball that isn't the ball itself; failing that, the bottom-centre of a
    backboard-sized box."""
    if not cands:
        return None
    bs = ball[2] if ball else ball_size
    best = board = None
    for x1, y1, x2, y2, s in cands:
        w, h = x2 - x1, y2 - y1
        if ball and abs(ball[0] - (x1 + x2) / 2) < bs * 0.6 and abs(ball[1] - (y1 + y2) / 2) < bs * 0.6 and w < bs * 1.6:
            continue
        if bs * 1.4 <= w <= bs * 4 and w / max(h, 1) >= 1.4:
            if not best or s > best[0]:
                best = (s, [x1, y1, x2, y2])
        elif bs * 3.5 <= w <= bs * 10 and 0.8 <= w / max(h, 1) <= 1.8:
            if not board or s > board[0]:
                board = (s, [x1, y1, x2, y2])
    if best:
        return best[1]
    if board:
        x1, y1, x2, y2 = board[1]
        w, h, cx = x2 - x1, y2 - y1, (x1 + x2) / 2
        return [cx - 0.18 * w, y2 - 0.25 * h, cx + 0.18 * w, y2 - 0.05 * h]
    return None


def rims(F):
    """Rim per frame: picked where candidates exist, carried up to 0.6 s
    (the camera pans) until the next detection."""
    out = [None] * len(F)
    for i, f in enumerate(F):
        if f["rim"]:
            near = [F[k]["ball"][2] for k in range(max(0, i - 30), min(len(F), i + 30)) if F[k]["ball"]]
            out[i] = pick_rim(f["rim"], f["ball"], float(np.median(near)) if near else 30.0)
    last, last_t = None, -9
    for i, f in enumerate(F):
        if out[i]:
            last, last_t = out[i], f["t"]
        elif last and f["t"] - last_t <= 0.6:
            out[i] = last
    return out


def shots(F, rim_at):
    """Every attempt: the ball arriving above the rim. `looks_made` if within a
    second it is below the rim and still inside it horizontally (a hint only;
    from some angles a ball rolling off the front rim passes this test)."""
    out = []
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
            if b2:
                w2 = r2[2] - r2[0]
                if b2[1] > r2[3] and r2[0] - 0.1 * w2 <= b2[0] <= r2[2] + 0.1 * w2 and b2[1] - r2[3] < 1.5 * w2:
                    made = True
                    break
        if out and f["t"] - out[-1]["t"] <= 3:
            out[-1]["looks_made"] |= made
            continue
        out.append({"t": f["t"], "i": i, "looks_made": made})
    return out


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


def team_colours(F):
    """Track id -> team label, by clustering long tracks' jersey colours into
    two teams (refs and passers-by rarely seed a cluster). Returns
    (team_of, {label: median LAB})."""
    cols = defaultdict(list)
    for f in F:
        for p in f["p"]:
            if p.get("c"):
                cols[p["id"]].append(p["c"])
    med = {tid: np.median(np.array(c), axis=0) for tid, c in cols.items() if c}
    long_ = [t for t, c in cols.items() if len(c) >= 10 and med[t][0] < 115]
    if len(long_) < 4:
        return {}, {}
    seed = np.array([med[t][1:] for t in long_], dtype=np.float32)
    _, _, cen = cv2.kmeans(seed, 2, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 0.2), 8, cv2.KMEANS_PP_CENTERS)
    nearest = lambda m: int(np.argmin(((cen - m[1:]) ** 2).sum(1)))
    full = [np.median(np.array([med[t] for t in long_ if nearest(med[t]) == k]), axis=0) for k in range(2)]
    names = [colour_name(f) for f in full]
    if names[0] == names[1]:  # e.g. black vs dark green: tell apart by hue
        g = int(np.argmin([f[1] for f in full]))
        other = colour_name(full[1 - g])
        names = ["", ""]
        names[g], names[1 - g] = "green", other if other != "green" else "dark"
    if names[0] == names[1]:
        names = [names[0] + "-1", names[1] + "-2"]
    team_of = {t: (names[nearest(m)] if m[0] < 130 else "ref") for t, m in med.items()}
    return team_of, dict(zip(names, full))


def match_team(label_colours: dict, wanted: str) -> str | None:
    """Which cluster label is the uploader's colour word ("black", "red/black",
    "navy")? Nearest cluster by name first, then by hue family."""
    w = wanted.lower()
    for lab in label_colours:
        if lab.split("-")[0] in w:
            return lab
    families = {"navy": "blue", "royal": "blue", "maroon": "red", "crimson": "red", "gold": "yellow",
                "purple": "blue", "gray": "grey", "silver": "grey", "charcoal": "black"}
    for word, fam in families.items():
        if word in w:
            for lab in label_colours:
                if lab.startswith(fam):
                    return lab
    return None
