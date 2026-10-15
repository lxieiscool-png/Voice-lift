"""Read the gym scoreboard once a second, locally.

Finds the board with Grounding DINO, OCRs it, and pulls the home and guest
scores out by position. Positions are measured in board heights from the
board's left edge, because the right side is often cut off by the frame;
the layout below fits the Huntington gym board (home score under the left
label, guest score under the right one). Other boards will need their own
layout, or a cheap image read of the crop.

usage: python scoreboard.py data/<video>.mp4 [--every 1]
writes out/<video>-board.json: [{t, home, guest}] (either may be null)
"""
import argparse, json, os, sys, time

import cv2
import torch
from PIL import Image
from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
import easyocr

ap = argparse.ArgumentParser()
ap.add_argument("video")
ap.add_argument("--every", type=float, default=1.0)
ap.add_argument("--start", type=float, default=0)
ap.add_argument("--secs", type=float, default=0)
args = ap.parse_args()

DEV = "mps"
gd_id = "IDEA-Research/grounding-dino-tiny"
P = AutoProcessor.from_pretrained(gd_id)
M = AutoModelForZeroShotObjectDetection.from_pretrained(gd_id).to(DEV)
R = easyocr.Reader(["en"], gpu=True, verbose=False)

# (x from, x to, y from, y to) in board heights, relative to the board's top-left
HOME = (0.0, 0.5, 0.33, 0.7)
GUEST = (0.95, 1.5, 0.2, 0.55)

cap = cv2.VideoCapture(args.video)
fps = cap.get(cv2.CAP_PROP_FPS) or 30
dur = cap.get(cv2.CAP_PROP_FRAME_COUNT) / fps
end = min(dur, args.start + args.secs) if args.secs else dur

out, t, t0 = [], args.start, time.time()
while t < end:
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, img = cap.read()
    if not ok:
        break
    H, W = img.shape[:2]
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    inp = P(images=pil, text="scoreboard.", return_tensors="pt").to(DEV)
    with torch.no_grad():
        o = M(**inp)
    r = P.post_process_grounded_object_detection(o, inp.input_ids, threshold=0.35, text_threshold=0.25, target_sizes=[pil.size[::-1]])[0]
    rec = {"t": round(t, 1), "home": None, "guest": None}
    if len(r["boxes"]):
        i = int(r["scores"].argmax())
        x1, y1, x2, y2 = [int(v) for v in r["boxes"][i]]
        h = y2 - y1
        # a board cut at the top or bottom edge throws the layout off
        if y1 > 2 and y2 < H - 2 and h > 40 and (x2 - x1) < W * 0.5:
            crop = img[y1:y2, x1:x2]
            k = 4 if h < 150 else 2
            big = cv2.resize(crop, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
            for box, text, conf in R.readtext(big, allowlist="0123456789", detail=1):
                t_ = text.strip()
                if not t_.isdigit() or len(t_) > 3 or conf < 0.5:
                    continue
                cx = (box[0][0] + box[2][0]) / 2 / k / h
                cy = (box[0][1] + box[2][1]) / 2 / k / h
                th = (box[2][1] - box[0][1]) / k / h
                if th < 0.1:
                    continue  # foul / timeout digits are smaller
                full_right = x2 < W - 3  # guest digits may be cut off otherwise
                if HOME[0] <= cx <= HOME[1] and HOME[2] <= cy <= HOME[3]:
                    rec["home"] = int(t_)
                elif full_right and GUEST[0] <= cx <= GUEST[1] and GUEST[2] <= cy <= GUEST[3] and x1 + GUEST[1] * h <= x2 + h * 0.1:
                    rec["guest"] = int(t_)
    out.append(rec)
    t += args.every
    if len(out) % 120 == 0:
        print(f"  {t:7.0f}s  {len(out) / (time.time() - t0):.1f}/s  last {rec}", file=sys.stderr)

name = os.path.splitext(os.path.basename(args.video))[0]
json.dump(out, open(f"out/{name}-board.json", "w"))
seen = [o for o in out if o["home"] is not None or o["guest"] is not None]
print(f"{name}: {len(out)} reads, {len(seen)} with a score, in {time.time() - t0:.0f}s")
