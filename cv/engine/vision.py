"""Vision models and frame scanning.

Two passes keep the GPU bill down without losing accuracy where it matters:
  find_shot_windows  cheap: ball + rim only, a few frames a second, to find
                     the moments a ball reaches the rim
  scan               full: players (tracked), ball and rim at full frame rate,
                     only inside those windows
"""
from dataclasses import dataclass

import cv2
import numpy as np
import torch


def device():
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


@dataclass
class Models:
    people: object
    ball: object
    gd_proc: object
    gd: object
    dev: str
    trained: object = None  # Reel's RF-DETR ball/rim model, when loaded
    rfdetr_people: bool = False


def load_models(size: str = "x", trained_weights: str | None = None) -> Models:
    """With `trained_weights`: Reel's own RF-DETR (ball, rim) plus stock
    RF-DETR for people, both Apache-2.0. Without: the open-vocabulary
    stack the prototype used (size "x" on a datacenter GPU, "m" on a laptop).
    Grounding DINO stays either way, for the scoreboard."""
    from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
    dev = device()
    gd_id = "IDEA-Research/grounding-dino-base" if size == "x" else "IDEA-Research/grounding-dino-tiny"
    gd_proc = AutoProcessor.from_pretrained(gd_id)
    gd = AutoModelForZeroShotObjectDetection.from_pretrained(gd_id).to(dev)
    if trained_weights:
        from rfdetr import RFDETRMedium
        trained = RFDETRMedium(pretrain_weights=trained_weights)
        people = RFDETRMedium()  # stock COCO weights
        return Models(people, None, gd_proc, gd, dev, trained=trained, rfdetr_people=True)
    from ultralytics import YOLO, YOLOWorld
    people = YOLO(f"yolo11{size}.pt")
    ball = YOLOWorld(f"yolov8{'x' if size == 'x' else 'm'}-worldv2.pt")
    ball.set_classes(["basketball"])
    return Models(people, ball, gd_proc, gd, dev)


BALL, RIM = 0, 1  # class ids in Reel's trained model
COCO_PERSON = 1


def _trained(m: Models, frame, threshold: float = 0.3):
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    return m.trained.predict(rgb, threshold=threshold)


def ball_and_rims(m: Models, frame):
    """One trained-model pass: ([cx, cy, size, conf] | None, [rim boxes + score])."""
    d = _trained(m, frame, 0.25)
    ball, rims = None, []
    for (x1, y1, x2, y2), c, k in zip(d.xyxy.tolist(), d.confidence.tolist(), d.class_id.tolist()):
        if k == BALL and (x2 - x1) < frame.shape[1] * 0.06 and (not ball or c > ball[3]):
            ball = [round((x1 + x2) / 2), round((y1 + y2) / 2), round(x2 - x1), round(c, 2)]
        elif k == RIM and c >= 0.35:
            rims.append([round(x1), round(y1), round(x2), round(y2), round(c, 2)])
    return ball, rims


def detect_people(m: Models, frame):
    """supervision Detections of people."""
    import supervision as sv
    if m.rfdetr_people:
        d = m.people.predict(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB), threshold=0.4)
        return d[d.class_id == COCO_PERSON]
    r = m.people(frame, classes=[0], conf=0.3, verbose=False, device=m.dev)[0]
    return sv.Detections.from_ultralytics(r)


def grounded(m: Models, frame, text: str, threshold: float = 0.2):
    """[(x1, y1, x2, y2, score, label)] for an open-vocabulary prompt."""
    from PIL import Image
    img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    inp = m.gd_proc(images=img, text=text, return_tensors="pt").to(m.dev)
    with torch.no_grad():
        out = m.gd(**inp)
    res = m.gd_proc.post_process_grounded_object_detection(
        out, inp.input_ids, threshold=threshold, text_threshold=threshold, target_sizes=[img.size[::-1]])[0]
    labels = res.get("text_labels") or res.get("labels") or [""] * len(res["boxes"])
    return [[round(v) for v in b] + [round(s, 2), str(l)] for b, s, l in zip(res["boxes"].tolist(), res["scores"].tolist(), labels)]


def detect_ball(m: Models, frame, imgsz: int = 1280):
    """[cx, cy, size, conf] of the most confident basketball, or None."""
    if m.trained:
        return ball_and_rims(m, frame)[0]
    r = m.ball(frame, conf=0.15, verbose=False, device=m.dev, imgsz=imgsz)[0]
    if not len(r.boxes):
        return None
    i = int(r.boxes.conf.argmax())
    x1, y1, x2, y2 = r.boxes.xyxy[i].tolist()
    if (x2 - x1) >= frame.shape[1] * 0.06:
        return None
    return [round((x1 + x2) / 2), round((y1 + y2) / 2), round(x2 - x1), round(float(r.boxes.conf[i]), 2)]


def detect_rims(m: Models, frame, with_board: bool = False):
    """Rim candidates (events.pick_rim chooses; the detector sometimes boxes
    the ball), plus the scoreboard box when asked, from one detector call."""
    if m.trained:
        rims = ball_and_rims(m, frame)[1]
        if not with_board:
            return rims
        found = grounded(m, frame, "scoreboard.")
    else:
        found = grounded(m, frame, "basketball rim. basketball hoop." + (" scoreboard." if with_board else ""))
        rims = [b[:5] for b in found if "score" not in b[5] and 0 < b[2] - b[0] < frame.shape[1] * 0.2]
    if not with_board:
        return rims
    boards = [b for b in found if "score" in b[5] and b[4] >= 0.35 and (b[2] - b[0]) < frame.shape[1] * 0.6 and (b[3] - b[1]) > 30]
    return rims, (max(boards, key=lambda b: b[4])[:4] if boards else None)


def lab_color(crop):
    h, w = crop.shape[:2]
    torso = crop[int(h * 0.18):int(h * 0.5), int(w * 0.25):int(w * 0.75)]
    if torso.size == 0:
        return None
    return np.median(cv2.cvtColor(torso, cv2.COLOR_BGR2LAB).reshape(-1, 3), axis=0).round().astype(int).tolist()


class Video:
    """Random access by time, decoding forward where possible (seeking is slow)."""

    def __init__(self, path: str):
        self.cap = cv2.VideoCapture(path)
        self.fps = self.cap.get(cv2.CAP_PROP_FPS) or 30
        self.duration = self.cap.get(cv2.CAP_PROP_FRAME_COUNT) / self.fps
        self.pos, self.img = -1e9, None

    def _read(self):
        ok, img = self.cap.read()
        self.img = img if ok else None
        self.pos = self.cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
        return self.img

    def at(self, t: float):
        half = 0.5 / self.fps
        if self.img is not None and abs(t - self.pos) < half:
            return self.img
        if not (0 < t - self.pos <= 2):  # far away or backwards: seek
            self.cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            return self._read()
        while self.pos < t - half:  # close ahead: decode forward
            if self._read() is None:
                return None
        return self.img


def find_shot_windows(m: Models, video: Video, start: float = 0, end: float | None = None,
                      fps: float = 4, rim_every: float = 1.0, before: float = 5, after: float = 2, board_every: float = 4):
    """Cheap pass. Returns (windows, board_crops): merged [start, end] windows
    around every moment the ball is seen near and above a rim, padded so the
    full pass sees the release and the drop; and [(t, crop)] of the
    scoreboard whenever it is in frame."""
    from .events import pick_rim
    end = video.duration if end is None else end
    hits, boards, rim, rim_t, board_t, t = [], [], None, -1e9, -1e9, start
    while t < end:
        frame = video.at(t)
        if frame is None:
            break
        if m.trained:
            ball, cands = ball_and_rims(m, frame)
            rim = pick_rim(cands, ball) or rim
        else:
            ball = detect_ball(m, frame, imgsz=960)
        if t - rim_t >= rim_every:
            if m.trained:
                bd = detect_rims(m, frame, with_board=True)[1]
            else:
                cands, bd = detect_rims(m, frame, with_board=True)
                rim = pick_rim(cands, ball)
            rim_t = t
            if bd and t - board_t >= board_every:
                x1, y1, x2, y2 = bd
                px, py = int((x2 - x1) * 0.08), int((y2 - y1) * 0.08)
                crop = frame[max(0, y1 - py):y2 + py, max(0, x1 - px):x2 + px]
                if crop.shape[1] > 480:
                    crop = cv2.resize(crop, (480, int(crop.shape[0] * 480 / crop.shape[1])))
                boards.append((round(t, 1), crop.copy()))
                board_t = t
        if ball and rim:
            w = rim[2] - rim[0]
            near_x = rim[0] - 1.5 * w <= ball[0] <= rim[2] + 1.5 * w
            near_y = rim[1] - 5 * w <= ball[1] <= rim[3] + 1.0 * w
            if near_x and near_y:
                hits.append(t)
        t += 1 / fps
    windows = []
    for h in hits:
        a, b = max(start, h - before), min(end, h + after)
        if windows and a <= windows[-1][1]:
            windows[-1][1] = max(windows[-1][1], b)
        else:
            windows.append([a, b])
    return windows, boards


def scan(m: Models, video: Video, windows, fps: float = 15, rim_every: float = 0.5):
    """Full pass over the given windows: tracked players with jersey colour,
    ball every frame, rim candidates every `rim_every` s. One dict per frame."""
    import supervision as sv
    frames = []
    for wi, (a, b) in enumerate(windows):
        tracker = sv.ByteTrack(frame_rate=fps, lost_track_buffer=int(fps * 2), track_activation_threshold=0.4)
        seen, rim_t, t = {}, -1e9, a
        base = (wi + 1) * 100_000  # track ids unique across windows
        while t <= b:
            frame = video.at(t)
            if frame is None:
                break
            H, W = frame.shape[:2]
            det = detect_people(m, frame)
            det = det[(det.xyxy[:, 3] - det.xyxy[:, 1]) > H * 0.08]
            det = tracker.update_with_detections(det)
            ps = []
            for (x1, y1, x2, y2), tid in zip(det.xyxy.astype(int).tolist(), det.tracker_id.tolist()):
                crop = frame[max(0, y1):y2, max(0, x1):x2]
                if crop.size == 0:
                    continue
                tid = base + int(tid)
                p = {"id": tid, "b": [x1, y1, x2, y2]}
                seen[tid] = seen.get(tid, 0) + 1
                if seen[tid] % 3 == 1:
                    p["c"] = lab_color(crop)
                ps.append(p)
            if m.trained:  # one cheap pass gives ball and rim on every frame
                ball, rims = ball_and_rims(m, frame)
            else:
                ball, rims = detect_ball(m, frame), None
                if t - rim_t >= rim_every:
                    rims, rim_t = detect_rims(m, frame), t
            frames.append({"t": round(t, 2), "p": ps, "ball": ball, "rim": rims, "W": W, "H": H})
            t += 1 / fps
    return frames
