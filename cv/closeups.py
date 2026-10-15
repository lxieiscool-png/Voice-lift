"""Close-up reads: vision finds the moment and the player, Gemini reads a
small, sharp image of just that. One still strip per question costs a tiny
fraction of watching video, and reading a tight crop is what the model is
actually good at.

  jersey(...)  -> (number or None, shot type "2"/"3"/"ft" or None)
  made(...)    -> True / False / None

Answers are cached in out/closeups.json, so re-running scoring is free.
"""
import json, os

import cv2
import numpy as np
from dotenv import dotenv_values
from google import genai
from google.genai import types

_KEY = dotenv_values(os.path.join(os.path.dirname(__file__), "..", ".env.local")).get("GEMINI_API_KEY")
_client = genai.Client(api_key=_KEY, http_options=types.HttpOptions(timeout=60_000)) if _KEY else None
MODEL = "gemini-3.7-flash"
CACHE_F = os.path.join(os.path.dirname(__file__), "out", "closeups.json")
_cache = json.load(open(CACHE_F)) if os.path.exists(CACHE_F) else {}
calls = 0


def _save():
    json.dump(_cache, open(CACHE_F, "w"))


def _ask(key, images, prompt):
    global calls
    if key in _cache:
        return _cache[key]
    if not _client:
        return None
    parts = []
    for img in images:
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])
        parts.append(types.Part.from_bytes(data=buf.tobytes(), mime_type="image/jpeg"))
    parts.append(prompt)
    for attempt in range(3):
        try:
            r = _client.models.generate_content(model=MODEL, contents=parts,
                                                config=types.GenerateContentConfig(temperature=0))
            calls += 1
            _cache[key] = (r.text or "").strip()
            _save()
            return _cache[key]
        except Exception as e:  # network blips
            err = e
    print("  gemini error:", str(err)[:120])
    return None


def _frame(cap, t):
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, img = cap.read()
    return img if ok else None


def _strip(crops, h=220):
    crops = [cv2.resize(c, (max(1, int(c.shape[1] * h / c.shape[0])), h)) for c in crops if c is not None and c.size]
    return np.hstack(crops) if crops else None


def jersey(cap, vid, F, shot, colour, roster=None):
    """Number of the shooter and the shot type, from up to 6 crops of the
    shooter around the release plus the full frame at the release."""
    tid, rel = shot["shooter"], shot["release"]
    key = f"jersey:{vid}:{shot['t']}:{tid}"
    boxes = [(f["t"], p["b"]) for f in F if rel - 2.5 <= f["t"] <= shot["t"] + 1 for p in f["p"] if p["id"] == tid]
    if not boxes:
        return None, None
    boxes.sort(key=lambda x: -(x[1][3] - x[1][1]))  # biggest (closest) first
    picks = sorted(boxes[:6])
    crops = []
    for t, (x1, y1, x2, y2) in picks:
        img = _frame(cap, t)
        if img is None:
            continue
        pw, ph = int((x2 - x1) * 0.15), int((y2 - y1) * 0.05)
        crops.append(img[max(0, y1 - ph):y2 + ph, max(0, x1 - pw):x2 + pw])
    strip = _strip(crops)
    full = _frame(cap, rel)
    if strip is None or full is None:
        return None, None
    x1, y1, x2, y2 = next(b for t, b in boxes if t == min(boxes, key=lambda x: abs(x[0] - rel))[0])
    full = full.copy()
    cv2.rectangle(full, (x1, y1), (x2, y2), (0, 255, 255), 4)
    full = cv2.resize(full, (1280, int(full.shape[0] * 1280 / full.shape[1])))
    hint = f" Their team's numbers: {', '.join(sorted(roster, key=int))}." if roster else ""
    ans = _ask(key, [full, strip], (
        f"Image 1: a basketball game at the moment a player (yellow box, {colour} jersey) shoots. "
        f"Image 2: close-ups of that same player over a few frames.{hint}\n"
        "Answer exactly two lines:\n"
        "NUMBER: <jersey number, or unknown if you cannot read it clearly>\n"
        "SHOT: <ft if a free throw from the free-throw line, 3 if the feet are clearly behind the three-point line, otherwise 2>"))
    if not ans:
        return None, None
    num = typ = None
    for line in ans.splitlines():
        k, _, v = line.partition(":")
        v = v.strip().lower().lstrip("#")
        if k.strip().upper() == "NUMBER" and v.isdigit():
            num = str(int(v))
        if k.strip().upper() == "SHOT" and v in ("2", "3", "ft"):
            typ = v
    if roster and num and num not in roster:
        num = None
    return num, typ


def made(cap, vid, F, shot, rim_at):
    """Did this attempt go in? 12 crops around the rim from just before the
    ball arrives to 1.5 s after."""
    key = f"made:{vid}:{shot['t']}"
    if key in _cache:
        return _parse_made(_cache[key])
    crops = []
    for f_i in range(shot["i"], len(F)):
        f = F[f_i]
        if f["t"] - shot["t"] > 1.6:
            break
        r = rim_at[f_i]
        if not r:
            continue
        img = _frame(cap, f["t"])
        if img is None:
            continue
        w = r[2] - r[0]
        cx, cy = (r[0] + r[2]) / 2, (r[1] + r[3]) / 2
        x1, x2 = int(cx - 1.8 * w), int(cx + 1.8 * w)
        y1, y2 = int(cy - 2.0 * w), int(cy + 2.4 * w)
        crops.append(img[max(0, y1):y2, max(0, x1):x2])
        if len(crops) >= 12:
            break
    if len(crops) < 4:
        return None
    rows = [_strip(crops[i:i + 6], 200) for i in range(0, len(crops), 6)]
    w = max(r.shape[1] for r in rows)
    grid = np.vstack([cv2.copyMakeBorder(r, 0, 0, 0, w - r.shape[1], cv2.BORDER_CONSTANT) for r in rows])
    ans = _ask(key, [grid], (
        "These frames (left to right, top to bottom, 0.1 s apart) show a basketball hoop as a shot arrives. "
        "Did the ball go through the hoop? Answer with one word: MADE, MISSED, or UNCLEAR."))
    return _parse_made(ans)


def _parse_made(ans):
    if not ans:
        return None
    a = ans.upper()
    return True if "MADE" in a else False if "MISS" in a else None


def shooter(cap, vid, shot, teams, roster=None):
    """Who took this shot: 6 full frames from 2 s before the ball reaches the
    rim up to that moment. `teams` maps our colour labels to how the jerseys
    look, e.g. {"red": "red", "black": "dark green"}. Returns (label, number, type)."""
    key = f"shooter:{vid}:{shot['t']}"
    frames = []
    for dt in (-2.0, -1.6, -1.2, -0.8, -0.4, 0.0):
        img = _frame(cap, shot["t"] + dt)
        if img is not None:
            cv2.putText(img, f"{len(frames) + 1}", (30, 90), 0, 3, (0, 255, 255), 6)
            frames.append(img)
    if len(frames) < 4:
        return None, None, None
    looks = " or ".join(f"{v} jerseys" for v in teams.values())
    hint = f" The {list(teams.values())[0]} team's numbers: {', '.join(sorted(roster, key=int))}." if roster else ""
    ans = _ask(key, frames, (
        f"Frames 1-6 are 0.4 s apart from a basketball game ({looks}). In the last frame the ball is arriving at the hoop from a shot. "
        f"Which player released that shot?{hint} Read the jersey number carefully across the frames.\n"
        "Answer exactly three lines:\n"
        f"TEAM: <{' | '.join(teams.values())} | unknown>\n"
        "NUMBER: <jersey number, or unknown>\n"
        "SHOT: <ft | 3 | 2>"))
    if not ans:
        return None, None, None
    team = num = typ = None
    for line in ans.splitlines():
        k, _, v = line.partition(":")
        k, v = k.strip().upper(), v.strip().lower().lstrip("#")
        if k == "TEAM":
            team = next((lab for lab, look in teams.items() if look.lower() == v), None)
        elif k == "NUMBER" and v.isdigit():
            num = str(int(v))
        elif k == "SHOT" and v in ("2", "3", "ft"):
            typ = v
    return team, num, typ
