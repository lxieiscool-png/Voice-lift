"""Scoreboard reads that work on any board: vision finds and crops the board
every couple of seconds, Gemini reads the crops (12 per request, as one
numbered grid image). Replaces the fixed-layout OCR in scoreboard.py, which
only fit one gym.

usage: python board.py data/<video>.mp4 [--every 2]
writes out/<video>-board.json: [{t, home, guest, home_label, guest_label}]
"""
import argparse, json, os, re, sys, time

import cv2
import numpy as np
import torch
from PIL import Image
from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection

import closeups as CU

ap = argparse.ArgumentParser()
ap.add_argument("video")
ap.add_argument("--every", type=float, default=2.0)
ap.add_argument("--batch", type=int, default=12)
args = ap.parse_args()

DEV = "mps"
gd_id = "IDEA-Research/grounding-dino-tiny"
P = AutoProcessor.from_pretrained(gd_id)
M = AutoModelForZeroShotObjectDetection.from_pretrained(gd_id).to(DEV)

cap = cv2.VideoCapture(args.video)
fps = cap.get(cv2.CAP_PROP_FPS) or 30
dur = cap.get(cv2.CAP_PROP_FRAME_COUNT) / fps
vid = os.path.splitext(os.path.basename(args.video))[0]

crops, t, t0 = [], 0.0, time.time()
while t < dur:
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, img = cap.read()
    if not ok:
        break
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    inp = P(images=pil, text="scoreboard.", return_tensors="pt").to(DEV)
    with torch.no_grad():
        o = M(**inp)
    r = P.post_process_grounded_object_detection(o, inp.input_ids, threshold=0.35, text_threshold=0.25, target_sizes=[pil.size[::-1]])[0]
    if len(r["boxes"]):
        i = int(r["scores"].argmax())
        x1, y1, x2, y2 = [int(v) for v in r["boxes"][i]]
        H, W = img.shape[:2]
        if (x2 - x1) < W * 0.6 and (y2 - y1) > 30:
            px, py = int((x2 - x1) * 0.08), int((y2 - y1) * 0.08)
            crops.append((round(t, 1), img[max(0, y1 - py):y2 + py, max(0, x1 - px):x2 + px]))
    t += args.every
    if int(t / args.every) % 200 == 0:
        print(f"  {t:6.0f}s  boards {len(crops)}", file=sys.stderr)
print(f"{vid}: board visible in {len(crops)} of {int(dur / args.every)} samples ({time.time() - t0:.0f}s)", file=sys.stderr)


def grid(batch):
    cells = []
    for k, (_, c) in enumerate(batch):
        c = cv2.resize(c, (360, max(1, int(c.shape[0] * 360 / c.shape[1]))))
        c = cv2.copyMakeBorder(c, 44, 6, 6, 6, cv2.BORDER_CONSTANT, value=(255, 255, 255))
        cv2.putText(c, str(k + 1), (8, 36), 0, 1.2, (0, 0, 255), 3)
        cells.append(c)
    h = max(c.shape[0] for c in cells)
    cells = [cv2.copyMakeBorder(c, 0, h - c.shape[0], 0, 0, cv2.BORDER_CONSTANT, value=(255, 255, 255)) for c in cells]
    while len(cells) % 4:
        cells.append(np.full_like(cells[0], 255))
    return np.vstack([np.hstack(cells[i:i + 4]) for i in range(0, len(cells), 4)])


out = []
for b in range(0, len(crops), args.batch):
    batch = crops[b:b + args.batch]
    ans = CU._ask(f"board:{vid}:{batch[0][0]}:{len(batch)}", [grid(batch)], (
        f"These are {len(batch)} numbered photos of the same gym scoreboard at different moments. "
        "For each photo give the two team scores exactly as displayed, with the team label shown above or beside each score. "
        "If a score is cut off, blurry or not visible, write ? for it. Never guess a digit.\n"
        "One line per photo, exactly:\n<n>: <LEFT LABEL> <score or ?> | <RIGHT LABEL> <score or ?>"))
    for line in (ans or "").splitlines():
        m = re.match(r"\s*(\d+)\s*:\s*(.*?)\s+(\d{1,3}|\?)\s*\|\s*(.*?)\s+(\d{1,3}|\?)\s*$", line)
        if not m or not (1 <= int(m[1]) <= len(batch)):
            continue
        out.append({"t": batch[int(m[1]) - 1][0], "home_label": m[2].strip(), "home": None if m[3] == "?" else int(m[3]),
                    "guest_label": m[4].strip(), "guest": None if m[5] == "?" else int(m[5])})
out.sort(key=lambda o: o["t"])
json.dump(out, open(f"out/{vid}-board2.json", "w"))
print(f"{vid}: {len(out)} board reads, {sum(1 for o in out if o['home'] is not None)} home, {sum(1 for o in out if o['guest'] is not None)} guest, gemini calls {CU.calls}")
