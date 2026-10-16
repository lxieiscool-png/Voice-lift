"""One game, video file in, box score out.

  1. cheap pass   find shot moments + scoreboard crops (ball, rim, board)
  2. full pass    tracked players, ball, rim at full rate, only around shots
  3. events       rim per frame, every shot attempt, team colours
  4. close-ups    make/miss + who shot, for every attempt; scoreboard scores
  5. fuse         scoreboard-anchored box score, no guessing

hints (all optional, from the upload form):
  our_colour, our_name, opp_colour, opp_name, roster (list of our numbers)
"""
import time

from . import closeups as CU
from . import events as EV
from . import fuse as FU
from . import vision as V


def run(video_path: str, hints: dict, reader: "CU.Reader", models: "V.Models | None" = None,
        key: str = "game", log=print, scan_fps: float = 15):
    t0 = time.time()
    timings = {}
    models = models or V.load_models()
    video = V.Video(video_path)
    timings["load"] = time.time() - t0

    windows, board_crops = V.find_shot_windows(models, video)
    timings["cheap_pass"] = time.time() - t0 - sum(timings.values())
    covered = sum(b - a for a, b in windows)
    log(f"cheap pass: {len(windows)} shot windows covering {covered:.0f}s of {video.duration:.0f}s, {len(board_crops)} board crops")

    F = V.scan(models, video, windows, fps=scan_fps)
    timings["full_pass"] = time.time() - t0 - sum(timings.values())

    rim_at = EV.rims(F)
    shots = EV.shots(F, rim_at)
    team_of, colours = EV.team_colours(F)
    labels = list(colours)
    ours = EV.match_team(colours, hints["our_colour"]) if hints.get("our_colour") else None
    if ours is None and len(labels) == 2 and hints.get("opp_colour"):
        theirs = EV.match_team(colours, hints["opp_colour"])
        ours = next((l for l in labels if l != theirs), None) if theirs else None
    ours = ours or (labels[0] if labels else "team-1")
    theirs = next((l for l in labels if l != ours), "team-2")
    looks = {ours: hints.get("our_colour") or ours, theirs: hints.get("opp_colour") or theirs}
    names = {ours: hints.get("our_name"), theirs: hints.get("opp_name")}
    roster = {ours: set(map(str, hints.get("roster") or []))}
    log(f"{len(shots)} attempts; teams {looks}")

    made_jobs = [CU.made_job(video, key, F, s, rim_at) for s in shots]
    who_jobs = [CU.shooter_job(video, key, s, looks, roster) for s in shots]
    answers = CU.ask_all(reader, made_jobs + who_jobs)
    for s, m_ans, w_ans in zip(shots, answers[:len(shots)], answers[len(shots):]):
        s["made"] = CU.parse_made(m_ans)
        s["team"], s["num"], s["type"] = CU.parse_shooter(w_ans, looks, roster)
    board = CU.board(reader, key, board_crops)
    timings["closeups"] = time.time() - t0 - sum(timings.values())

    report = FU.build(shots, board, [ours, theirs], names)
    timings["total"] = time.time() - t0
    report["meta"] = {"duration": video.duration, "windows": len(windows), "seconds_scanned": covered,
                      "attempts": len(shots), "board_reads": len(board), "gemini_calls": reader.calls,
                      "timings": {k: round(v, 1) for k, v in timings.items()}, "teams": looks}
    return report
