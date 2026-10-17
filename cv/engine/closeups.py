"""Close-up reads: vision finds the moment, Gemini reads a few sharp stills
of just that. Reading a tight image is what the model is good at; watching
minutes of video and guessing who scored is what it was bad at.

  made_job / parse_made        the ball through the rim?   True / False / None
  shooter_job / parse_shooter  team, number (only when sure), shot type
  board                        scores on grids of scoreboard crops
Images are built in order from the video (*_job), then asked in parallel
(ask_all), so a game's few hundred reads take about a minute.
"""
import json, os, re, threading

import cv2
import numpy as np

MODEL = os.environ.get("CLOSEUP_MODEL", "gemini-3.7-flash")


class Reader:
    def __init__(self, api_key: str, cache: dict | None = None, cache_file: str | None = None):
        from google import genai
        from google.genai import types
        self.types = types
        self.client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=120_000))
        self.cache_file = cache_file
        self.cache = cache if cache is not None else (json.load(open(cache_file)) if cache_file and os.path.exists(cache_file) else {})
        self.calls = 0
        self.lock = threading.Lock()

    def ask(self, key, images, prompt):
        if key in self.cache:
            return self.cache[key]
        parts = []
        for img in images:
            ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])
            parts.append(self.types.Part.from_bytes(data=buf.tobytes(), mime_type="image/jpeg"))
        parts.append(prompt)
        err = None
        import time
        for attempt in range(4):
            if attempt:
                time.sleep(2 ** attempt)
            try:
                r = self.client.models.generate_content(model=MODEL, contents=parts,
                                                        config=self.types.GenerateContentConfig(temperature=0))
                with self.lock:
                    self.calls += 1
                    self.cache[key] = (r.text or "").strip()
                    if self.cache_file:
                        json.dump(self.cache, open(self.cache_file, "w"))
                return self.cache[key]
            except Exception as e:  # network blips, 5xx
                err = e
        print("  closeup error:", str(err)[:120])
        return None


def _strip(crops, h=200):
    crops = [cv2.resize(c, (max(1, int(c.shape[1] * h / c.shape[0])), h)) for c in crops if c is not None and c.size]
    return np.hstack(crops) if crops else None


def _grid(cells, cols):
    h = max(c.shape[0] for c in cells)
    w = max(c.shape[1] for c in cells)
    pad = [cv2.copyMakeBorder(c, 0, h - c.shape[0], 0, w - c.shape[1], cv2.BORDER_CONSTANT, value=(255, 255, 255)) for c in cells]
    while len(pad) % cols:
        pad.append(np.full_like(pad[0], 255))
    return np.vstack([np.hstack(pad[i:i + cols]) for i in range(0, len(pad), cols)])


def made_job(video, key: str, F, shot, rim_at):
    """(cache key, images, prompt) for: did this attempt go in? 12 crops
    around the rim from the ball's arrival to ~1.5 s after."""
    crops = []
    for i in range(shot["i"], len(F)):
        f = F[i]
        if f["t"] - shot["t"] > 1.6 or len(crops) >= 12:
            break
        r = rim_at[i]
        img = video.at(f["t"]) if r else None
        if img is None:
            continue
        w = r[2] - r[0]
        cx, cy = (r[0] + r[2]) / 2, (r[1] + r[3]) / 2
        crops.append(img[max(0, int(cy - 2.0 * w)):int(cy + 2.4 * w), max(0, int(cx - 1.8 * w)):int(cx + 1.8 * w)].copy())
    if len(crops) < 4:
        return None
    return (f"made:{key}:{shot['t']}", [_grid([_strip([c]) for c in crops], 6)],
            "These frames (left to right, top to bottom, 0.1 s apart) show a basketball hoop as a shot arrives. "
            "Did the ball go through the hoop? Answer with one word: MADE, MISSED, or UNCLEAR.")


def parse_made(ans):
    if not ans:
        return None
    a = ans.upper()
    return True if "MADE" in a else False if "MISS" in a else None


def shooter_job(video, key: str, shot, looks: dict, roster: dict | None = None):
    """(cache key, images, prompt) for: who released this shot? 6 full frames
    over the 2 s before the ball reaches the rim. `looks` maps team label ->
    how the jerseys look."""
    frames = []
    for dt in (-2.0, -1.6, -1.2, -0.8, -0.4, 0.0):
        img = video.at(max(0, shot["t"] + dt))
        if img is not None:
            img = cv2.resize(img, (1280, int(img.shape[0] * 1280 / img.shape[1]))) if img.shape[1] > 1280 else img.copy()
            cv2.putText(img, str(len(frames) + 1), (24, 72), 0, 2.4, (0, 255, 255), 5)
            frames.append(img)
    if len(frames) < 4:
        return None
    hint = "".join(f" {looks[lab]} team's numbers: {', '.join(sorted(ns, key=lambda n: int(n) if n.isdigit() else 999))}."
                   for lab, ns in (roster or {}).items() if ns and lab in looks)
    return (f"shooter:{key}:{shot['t']}", frames,
            f"Frames 1-6 are 0.4 s apart from a basketball game ({' vs '.join(f'{v} jerseys' for v in looks.values())}). "
            f"In the last frame the ball is arriving at the hoop from a shot. Which player released that shot?{hint} "
            "Read the jersey number carefully across the frames.\n"
            "Answer exactly four lines:\n"
            f"TEAM: <{' | '.join(looks.values())} | unknown>\n"
            "NUMBER: <jersey number, or unknown>\n"
            "SHOT: <ft | 3 | 2>\n"
            "SURE: <high if you clearly see this player release the ball AND clearly read the number; otherwise low>")


def parse_shooter(ans, looks: dict, roster: dict | None = None):
    """(team label or None, number or None, "2" | "3" | "ft" | None).
    No guessing: the number is dropped unless the model is sure of it."""
    if not ans:
        return None, None, None
    team = num = typ = None
    sure = False
    for line in ans.splitlines():
        k, _, v = line.partition(":")
        k, v = k.strip().upper(), v.strip().lower().lstrip("#")
        if k == "TEAM":
            team = next((lab for lab, look in looks.items() if look.lower() == v), None)
        elif k == "NUMBER" and v.isdigit():
            num = str(int(v))
        elif k == "SHOT" and v in ("2", "3", "ft"):
            typ = v
        elif k == "SURE":
            sure = v.startswith("high")
    if num and team and roster and roster.get(team) and num not in roster[team]:
        num = None
    return team, (num if sure else None), typ


def ask_all(rd: Reader, jobs, workers: int = 8):
    """Answers for [(key, images, prompt) | None], asked in parallel."""
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(workers) as ex:
        return list(ex.map(lambda j: rd.ask(*j) if j else None, jobs))


def board(rd: Reader, key: str, crops):
    """crops: [(t, image)] of the scoreboard. Returns [{t, left, left_label,
    right, right_label}] with None for anything not clearly legible."""
    import re
    batches, jobs = [], []
    for b in range(0, len(crops), 12):
        batch = crops[b:b + 12]
        cells = []
        for k, (_, c) in enumerate(batch):
            c = cv2.resize(c, (360, max(1, int(c.shape[0] * 360 / c.shape[1]))))
            c = cv2.copyMakeBorder(c, 44, 6, 6, 6, cv2.BORDER_CONSTANT, value=(255, 255, 255))
            cv2.putText(c, str(k + 1), (8, 36), 0, 1.2, (0, 0, 255), 3)
            cells.append(c)
        batches.append(batch)
        jobs.append((f"board:{key}:{batch[0][0]}:{len(batch)}", [_grid(cells, 4)], (
            f"These are {len(batch)} numbered photos of the same gym scoreboard at different moments. "
            "For each photo give the two team scores exactly as displayed, with the team label shown above or beside each score. "
            "If a score is cut off, blurry or not visible, write ? for it. Never guess a digit.\n"
            "One line per photo, exactly:\n<n>: <LEFT LABEL> <score or ?> | <RIGHT LABEL> <score or ?>")))
    out = []
    for batch, ans in zip(batches, ask_all(rd, jobs)):
        for line in (ans or "").splitlines():
            m = re.match(r"\s*(\d+)\s*:\s*(.*?)\s+(\d{1,3}|\?)\s*\|\s*(.*?)\s+(\d{1,3}|\?)\s*$", line)
            if not m or not (1 <= int(m[1]) <= len(batch)):
                continue
            out.append({"t": batch[int(m[1]) - 1][0], "left_label": m[2].strip(), "left": None if m[3] == "?" else int(m[3]),
                        "right_label": m[4].strip(), "right": None if m[5] == "?" else int(m[5])})
    return sorted(out, key=lambda o: o["t"])


def _iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    return inter / max(1, (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)


def _box_near(F, tid, t, within: float = 0.35):
    best = None
    for f in F:
        if abs(f["t"] - t) > within:
            continue
        for p in f["p"]:
            if p["id"] == tid and (best is None or abs(f["t"] - t) < best[0]):
                best = (abs(f["t"] - t), f["t"], p["b"])
    return best[1:] if best else None


def candidates_job(video, key: str, F, shot, release, cands, looks: dict, roster: dict | None = None):
    """(cache key, images, prompt) for: which of these tracked players released
    the shot? Image 1 is the release frame with candidates boxed A/B/C;
    image 2 has a row of sharp close-ups per candidate. Choosing among a few
    labelled, zoomed-in players is far easier than finding one in a wide shot."""
    if not cands or release is None:
        return None
    letters = "ABC"
    frame = video.at(release)
    if frame is None:
        return None
    frame = frame.copy()
    rows = []
    for L, tid in zip(letters, cands):
        nb = _box_near(F, tid, release)
        if nb:
            x1, y1, x2, y2 = nb[1]
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 255), 4)
            cv2.putText(frame, L, (x1, max(40, y1 - 10)), 0, 1.6, (0, 255, 255), 4)
        if not nb:
            continue
        rb = nb[1]
        crops = []
        # Stay close to the release and follow the player's position, not the
        # tracker id: ids swap when players overlap, which mixed people up.
        for dt in (-0.3, -0.15, 0.0, 0.15):
            got = _box_near(F, tid, release + dt, 0.1)
            box = got[1] if got and _iou(got[1], rb) > 0.3 else rb
            img = video.at(release + dt)
            if img is None:
                continue
            x1, y1, x2, y2 = box
            pw, ph = int((x2 - x1) * 0.2), int((y2 - y1) * 0.06)
            crops.append(img[max(0, y1 - ph):y2 + ph, max(0, x1 - pw):x2 + pw].copy())
        strip = _strip(crops, 260)
        if strip is None:
            continue
        strip = cv2.copyMakeBorder(strip, 0, 0, 70, 0, cv2.BORDER_CONSTANT, value=(255, 255, 255))
        cv2.putText(strip, L, (12, 150), 0, 2.2, (0, 0, 255), 5)
        rows.append(strip)
    if not rows:
        return None
    w = max(r.shape[1] for r in rows)
    sheet = np.vstack([cv2.copyMakeBorder(r, 6, 6, 0, w - r.shape[1], cv2.BORDER_CONSTANT, value=(255, 255, 255)) for r in rows])
    if frame.shape[1] > 1600:
        frame = cv2.resize(frame, (1600, int(frame.shape[0] * 1600 / frame.shape[1])))
    hint = "".join(f" {looks[lab]} team's numbers: {', '.join(sorted(ns, key=lambda n: int(n) if n.isdigit() else 999))}."
                   for lab, ns in (roster or {}).items() if ns and lab in looks)
    shown = letters[:len(rows)]
    return (f"cands:{key}:{shot['t']}", [frame, sheet],
            f"Basketball ({' vs '.join(f'{v} jerseys' for v in looks.values())}). Image 1 is the moment a shot leaves a player's hands; "
            f"the players who could have shot it are boxed {', '.join(shown)}. Image 2 shows close-ups of each of them over about a second "
            f"(one row per letter, taken just around the release).{hint}\n"
            "Which boxed player released the shot? Read that player's jersey number from the close-ups.\n"
            "Answer exactly five lines:\n"
            f"SHOOTER: <{' | '.join(shown)} | none>\n"
            f"TEAM: <{' | '.join(looks.values())} | unknown>\n"
            "NUMBER: <jersey number, or unknown>\n"
            "SHOT: <ft | 3 | 2>\n"
            "SURE: <high if you can see this player release the ball AND clearly read the number; otherwise low>")


def parse_candidates(ans, looks: dict, roster: dict | None = None):
    """Like parse_shooter; (None, None, None) when the model picked nobody."""
    if not ans or re.search(r"SHOOTER:\s*none", ans, re.I):
        return None, None, None
    return parse_shooter(ans, looks, roster)
