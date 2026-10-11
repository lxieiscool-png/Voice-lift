"""Vision pass over a game video: everything later stages need, saved per frame.

For every sampled frame: player boxes with tracker ids, the ball, and (once a
second) the rim. Jersey numbers are read off each track's torso every few
frames and voted on later. Output is one JSON line per frame so the scoring
logic in score.py can be iterated on without re-running the models.

usage: python extract.py data/<video>.mp4 [--start S] [--secs N] [--fps 10]
"""
import argparse, json, os, sys, time

import cv2
import numpy as np
import supervision as sv
import torch
from PIL import Image
from ultralytics import YOLO, YOLOWorld

ap = argparse.ArgumentParser()
ap.add_argument("video")
ap.add_argument("--start", type=float, default=0)
ap.add_argument("--secs", type=float, default=0)
ap.add_argument("--fps", type=float, default=10)
ap.add_argument("--rim-every", type=float, default=0.5, help="seconds between rim detections")
ap.add_argument("--ocr-every", type=int, default=5, help="read a track's number every Nth frame it appears")
args = ap.parse_args()
DEV = "mps"

cap = cv2.VideoCapture(args.video)
src_fps = cap.get(cv2.CAP_PROP_FPS) or 30
dur = cap.get(cv2.CAP_PROP_FRAME_COUNT) / src_fps
end = min(dur, args.start + args.secs) if args.secs else dur
step = max(1, round(src_fps / args.fps))

people = YOLO("yolo11m.pt")
ballnet = YOLOWorld("yolov8m-worldv2.pt")
ballnet.set_classes(["basketball"])
tracker = sv.ByteTrack(frame_rate=args.fps, lost_track_buffer=int(args.fps * 2), track_activation_threshold=0.4)

from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
gd_id = "IDEA-Research/grounding-dino-tiny"
gd_proc = AutoProcessor.from_pretrained(gd_id)
gd = AutoModelForZeroShotObjectDetection.from_pretrained(gd_id).to(DEV)

import easyocr
reader = easyocr.Reader(["en"], gpu=True, verbose=False)


def find_rim(frame):
    """Every 'basketball rim' candidate; score.py picks the real one (the
    detector sometimes boxes the ball itself, so filtering needs the ball)."""
    img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    inp = gd_proc(images=img, text="basketball rim. basketball hoop.", return_tensors="pt").to(DEV)
    with torch.no_grad():
        out = gd(**inp)
    res = gd_proc.post_process_grounded_object_detection(out, inp.input_ids, threshold=0.2, text_threshold=0.2, target_sizes=[img.size[::-1]])[0]
    return [[round(v) for v in b] + [round(s, 2)] for b, s in zip(res["boxes"].tolist(), res["scores"].tolist())
            if 0 < b[2] - b[0] < frame.shape[1] * 0.2]


def read_number(crop):
    h, w = crop.shape[:2]
    torso = crop[int(h * 0.12):int(h * 0.5), int(w * 0.1):int(w * 0.9)]
    if torso.shape[0] < 30 or torso.shape[1] < 20:
        return None
    g = cv2.cvtColor(torso, cv2.COLOR_BGR2GRAY)
    g = cv2.resize(g, None, fx=64 / g.shape[0], fy=64 / g.shape[0], interpolation=cv2.INTER_CUBIC)
    best = None
    for _, text, conf in reader.readtext(g, allowlist="0123456789", detail=1, min_size=8, text_threshold=0.5):
        t = text.strip()
        if 1 <= len(t) <= 2 and conf >= 0.4 and (not best or conf > best[1]):
            best = (t.lstrip("0") or "0", round(float(conf), 2))
    return best


def lab_color(crop):
    h, w = crop.shape[:2]
    torso = crop[int(h * 0.18):int(h * 0.5), int(w * 0.25):int(w * 0.75)]
    if torso.size == 0:
        return None
    return np.median(cv2.cvtColor(torso, cv2.COLOR_BGR2LAB).reshape(-1, 3), axis=0).round().astype(int).tolist()


os.makedirs("out", exist_ok=True)
name = os.path.splitext(os.path.basename(args.video))[0]
suffix = f"-{int(args.start)}-{int(end)}" if (args.start or args.secs) else ""
outf = open(f"out/{name}{suffix}-frames.jsonl", "w")
seen = {}
t0 = time.time()
cap.set(cv2.CAP_PROP_POS_MSEC, args.start * 1000)
idx, n, last_rim_t, rim = 0, 0, -1e9, None
while True:
    if not cap.grab():
        break
    t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
    if t > end:
        break
    idx += 1
    if idx % step:
        continue
    ok, frame = cap.retrieve()
    if not ok:
        break
    n += 1
    H, W = frame.shape[:2]

    r = people(frame, classes=[0], conf=0.3, verbose=False, device=DEV)[0]
    det = sv.Detections.from_ultralytics(r)
    det = det[(det.xyxy[:, 3] - det.xyxy[:, 1]) > H * 0.08]
    det = tracker.update_with_detections(det)

    br = ballnet(frame, conf=0.15, verbose=False, device=DEV, imgsz=1280)[0]
    ball = None
    if len(br.boxes):
        i = int(br.boxes.conf.argmax())
        x1, y1, x2, y2 = br.boxes.xyxy[i].tolist()
        if (x2 - x1) < W * 0.06:
            ball = [round((x1 + x2) / 2), round((y1 + y2) / 2), round(x2 - x1), round(float(br.boxes.conf[i]), 2)]

    rim = None
    if t - last_rim_t >= args.rim_every:
        rim, last_rim_t = find_rim(frame), t

    ps = []
    for (x1, y1, x2, y2), tid in zip(det.xyxy.astype(int).tolist(), det.tracker_id.tolist()):
        crop = frame[max(0, y1):y2, max(0, x1):x2]
        if crop.size == 0:
            continue
        p = {"id": tid, "b": [x1, y1, x2, y2]}
        seen[tid] = seen.get(tid, 0) + 1
        if seen[tid] % 3 == 1:
            p["c"] = lab_color(crop)
        if seen[tid] % args.ocr_every == 1:
            num = read_number(crop)
            if num:
                p["n"] = num
        ps.append(p)

    outf.write(json.dumps({"t": round(t, 2), "p": ps, "ball": ball, "rim": rim, "W": W, "H": H}) + "\n")
    if n % 200 == 0:
        el = time.time() - t0
        print(f"  {t:7.1f}s  frames {n}  {n / el:.1f} fps  eta {(end - t) * args.fps / (n / el) / 60:.0f} min", file=sys.stderr)
        outf.flush()

outf.close()
print(f"{name}: {args.start:.0f}-{end:.0f}s, {n} frames in {time.time() - t0:.0f}s")
