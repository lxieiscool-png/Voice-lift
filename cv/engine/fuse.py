"""Box score from shots + close-up answers + scoreboard reads.

Rules, in order of authority:
  1. The scoreboard decides how many points each team scored and roughly when.
  2. Close-ups decide which attempt went in and who shot it.
  3. A player is only credited when the close-up was sure of the number;
     otherwise the points go to the team as "unidentified". Better an honest
     gap than #35 getting someone else's 18 points.
When a team's side of the board is never legible, its points come from
close-up makes alone.
"""
from collections import Counter, defaultdict

PTS = {"ft": 1, "2": 2, "3": 3}


def chain(reads):
    """Longest physically possible run of (t, score): never down, never faster
    than a team can score. Lone misreads fall out."""
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
        out.append(reads[k])
        k = prev[k]
    return out[::-1]


def side_chain(reads, key):
    """A score only counts once read at least twice."""
    n = Counter(o[key] for o in reads if o[key] is not None)
    return chain([(o["t"], o[key]) for o in reads if o[key] is not None and n[o[key]] >= 2])


def increments(ch):
    return [(a[0], b[0], b[1] - a[1]) for a, b in zip(ch, ch[1:]) if b[1] > a[1]]


def _label_matches(label: str, name: str | None) -> bool:
    if not name or not label:
        return False
    a, b = "".join(ch for ch in label.lower() if ch.isalnum()), "".join(ch for ch in name.lower() if ch.isalnum())
    return bool(a) and bool(b) and (a.startswith(b[:3]) or b.startswith(a[:3]) or a in b or b in a)


def assign_sides(board, teams, names):
    """Which board side (left/right) is which team label. By name when the
    board label matches a team name the uploader gave; otherwise by which
    team's made shots line up with each side's score changes."""
    labels = {s: Counter(o[f"{s}_label"] for o in board if o.get(f"{s}_label")).most_common(1) for s in ("left", "right")}
    labels = {s: (v[0][0] if v else "") for s, v in labels.items()}
    for s, other in (("left", "right"), ("right", "left")):
        for t in teams:
            if _label_matches(labels[s], names.get(t)):
                return {s: t, other: next(x for x in teams if x != t)}
    return None


def build(shots, board, teams, names, credit_fga=True):
    """shots: [{t, team, num, type, made}] (made: True/False/None from close-ups).
    teams: the two team labels. names: label -> team name (may be None).
    Returns {teams: [{label, name, final, players: {num: line}, unidentified}], events}."""
    line = lambda: Counter(pts=0, fgm=0, fga=0, tpm=0, tpa=0, ftm=0, fta=0)
    players = {t: defaultdict(line) for t in teams}
    unident = {t: line() for t in teams}
    events = []

    def credit(team, shot, pts, why):
        typ = "ft" if pts == 1 else "3" if pts == 3 else "2"
        row = players[team][shot["num"]] if shot and shot.get("num") and shot.get("team") == team else unident[team]
        row["pts"] += pts
        if typ == "ft":
            row["ftm"] += pts; row["fta"] += pts
        else:
            row["fgm"] += 1; row["fga"] += 1
            if typ == "3":
                row["tpm"] += 1; row["tpa"] += 1
        if shot:
            shot["used"] = True
        events.append({"t": shot["t"] if shot else None, "team": team, "num": row is not unident[team] and shot["num"] or None,
                       "pts": pts, "why": why})

    sides = assign_sides(board, teams, names) if board else None
    finals = {}
    board_teams = set()
    if sides:
        for side, team in sides.items():
            ch = side_chain(board, side)
            incs = increments(ch)
            if len(incs) < 3:
                continue  # this side was barely legible; fall back to close-ups
            board_teams.add(team)
            finals[team] = ch[-1][1]
            for a, b, d in incs:
                window = [s for s in shots if a - 3 <= s["t"] <= b and not s.get("used")]
                mine = [s for s in window if s.get("team") == team and s.get("made") is not False]
                # points the board saw but no close-up attributed to this team
                # stay with the team, unidentified
                mine.sort(key=lambda s: (s.get("made") is True, s["t"]), reverse=True)
                left = d
                for s in mine:
                    p = PTS.get(s.get("type") or "2", 2)
                    if p > left:
                        p = left if left in (1, 2, 3) else p
                    if p <= 0 or p > left:
                        continue
                    credit(team, s, p, f"board +{d}")
                    left -= p
                    if left == 0:
                        break
                if left > 0:
                    credit(team, None, left, f"board +{d}, shooter not seen")
    for team in teams:
        if team in board_teams:
            continue
        for s in shots:
            if s.get("made") and s.get("team") == team and not s.get("used"):
                credit(team, s, PTS.get(s.get("type") or "2", 2), "close-up make")
    if credit_fga:
        for s in shots:
            if s.get("made") is False and s.get("team") in players:
                row = players[s["team"]][s["num"]] if s.get("num") else unident[s["team"]]
                if s.get("type") == "ft":
                    row["fta"] += 1
                else:
                    row["fga"] += 1
                    if s.get("type") == "3":
                        row["tpa"] += 1
    out = []
    for t in teams:
        tot = sum(r["pts"] for r in players[t].values()) + unident[t]["pts"]
        out.append({"label": t, "name": names.get(t), "final": finals.get(t, tot), "points_found": tot,
                    "players": {n: dict(r) for n, r in sorted(players[t].items(), key=lambda kv: -kv[1]["pts"])},
                    "unidentified": dict(unident[t])})
    return {"teams": out, "events": sorted(events, key=lambda e: e["t"] or 0)}
