"""Reel stats engine on Modal.

  modal run cv/modal_app.py --url <youtube url> --our-colour red     one-off test
  modal deploy cv/modal_app.py                                         for the app

Secrets (Modal secret "reel-engine"): GEMINI_API_KEY; for YouTube, which
blocks datacenter servers: YTDLP_COOKIES_B64 (a throwaway account's cookies,
base64) and/or YTDLP_PROXY (residential proxy, the fallback once cookies
stop working).
"""
import os

import modal

app = modal.App("reel-engine")
videos = modal.Volume.from_name("reel-videos", create_if_missing=True)


def _bake_weights():
    # Download model weights into the image so cold starts don't fetch them.
    from ultralytics import YOLO, YOLOWorld
    from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
    os.chdir("/weights")
    YOLO("yolo11x.pt")
    w = YOLOWorld("yolov8x-worldv2.pt")
    w.set_classes(["basketball"])
    for gd in ("IDEA-Research/grounding-dino-base",):
        AutoProcessor.from_pretrained(gd)
        AutoModelForZeroShotObjectDetection.from_pretrained(gd)


image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "libgl1", "libglib2.0-0", "nodejs", "curl")
    .pip_install("torch==2.8.0", "torchvision==0.23.0", "ultralytics", "supervision", "transformers", "opencv-python-headless",
                 "google-genai", "yt-dlp[default]", "deno", "pillow", "numpy", "lap", "clip-anytorch", "setuptools<80")
    .run_commands("mkdir -p /weights")
    .run_function(_bake_weights)
    .add_local_python_source("engine")
)


class YouTubeBlocked(RuntimeError):
    """YouTube refused the download (bot check / login cookies rejected)."""


def _download(url: str, out: str) -> str:
    """yt-dlp with, in order of preference: the throwaway account's cookies
    (YTDLP_COOKIES_B64), then a residential proxy (YTDLP_PROXY). Without
    either, YouTube's bot check blocks datacenter servers."""
    import base64, subprocess
    # yt-dlp solves YouTube's JS challenges with Deno (Debian's Node 18 is too old)
    import shutil
    deno = shutil.which("deno") or __import__("deno").find_deno_bin()
    base = ["yt-dlp", "-q", "--no-warnings", "--js-runtimes", f"deno:{deno}", "--retries", "10", "--fragment-retries", "10",
            "-f", "bv*[ext=mp4][height<=1080]/b[ext=mp4]/bv*+ba/b", "-o", out]
    attempts = []
    if os.environ.get("YTDLP_COOKIES_B64"):
        with open("/tmp/cookies.txt", "wb") as f:
            f.write(base64.b64decode(os.environ["YTDLP_COOKIES_B64"]))
        attempts.append(("cookies", ["--cookies", "/tmp/cookies.txt"]))
    if os.environ.get("YTDLP_PROXY"):
        attempts.append(("proxy", ["--proxy", os.environ["YTDLP_PROXY"]]))
    attempts = attempts or [("direct", [])]
    errors = []
    for how, extra in attempts:
        r = subprocess.run(base + extra + [url], capture_output=True, text=True)
        if r.returncode == 0 and os.path.exists(out):
            print(f"downloaded via {how}")
            return out
        errors.append(f"{how}: {(r.stderr or r.stdout).strip()[-300:]}")
    msg = " | ".join(errors)
    if "not a bot" in msg or "Sign in" in msg or "cookies" in msg.lower():
        raise YouTubeBlocked(msg)
    raise RuntimeError(f"download failed: {msg}")


@app.function(image=image, gpu="L40S", timeout=3 * 3600, secrets=[modal.Secret.from_name("reel-engine")])
def analyze(url: str, hints: dict, key: str = "game") -> dict:
    import time
    os.chdir("/weights")
    from engine import closeups as CU, pipeline, vision as V
    t0 = time.time()
    path = _download(url, f"/tmp/{key}.mp4")
    dl = time.time() - t0
    reader = CU.Reader(os.environ["GEMINI_API_KEY"], cache={})
    rep = pipeline.run(path, hints, reader, V.load_models("x"), key=key)
    rep["meta"]["timings"]["download"] = round(dl, 1)
    return rep


@app.function(image=image, gpu="L40S", timeout=3 * 3600, secrets=[modal.Secret.from_name("reel-engine")],
              volumes={"/videos": videos})
def analyze_file(name: str, hints: dict) -> dict:
    """Same as analyze, for a video already in the reel-videos volume."""
    os.chdir("/weights")
    from engine import closeups as CU, pipeline, vision as V
    import json
    key = name.split(".")[0]
    # cache close-up answers on the volume so a re-run never pays twice
    reader = CU.Reader(os.environ["GEMINI_API_KEY"], cache_file=f"/videos/{key}-closeups.json")
    rep = pipeline.run(f"/videos/{name}", hints, reader, V.load_models("x"), key=key)
    json.dump(rep, open(f"/videos/{key}-report.json", "w"), indent=1)
    videos.commit()
    return rep


@app.local_entrypoint()
def start_file(name: str, our_colour: str = "", our_name: str = "", opp_colour: str = "", opp_name: str = "", roster: str = ""):
    """Hand the job to Modal and return immediately; the report lands in the
    reel-videos volume as <name>-report.json (fetch with: modal volume get)."""
    hints = {"our_colour": our_colour or None, "our_name": our_name or None, "opp_colour": opp_colour or None,
             "opp_name": opp_name or None, "roster": [r for r in roster.split(",") if r]}
    call = analyze_file.spawn(name, hints)
    print("spawned", call.object_id)


@app.local_entrypoint()
def test_file(name: str, our_colour: str = "", our_name: str = "", opp_colour: str = "", opp_name: str = "", roster: str = ""):
    import json
    hints = {"our_colour": our_colour or None, "our_name": our_name or None, "opp_colour": opp_colour or None,
             "opp_name": opp_name or None, "roster": [r for r in roster.split(",") if r]}
    rep = analyze_file.remote(name, hints)
    os.makedirs("out", exist_ok=True)
    json.dump(rep, open(f"out/{name.split('.')[0]}-modal.json", "w"), indent=1)
    print(json.dumps(rep["meta"], indent=1))


@app.local_entrypoint()
def main(url: str, our_colour: str = "", our_name: str = "", opp_colour: str = "", opp_name: str = "", roster: str = ""):
    import json
    hints = {"our_colour": our_colour or None, "our_name": our_name or None, "opp_colour": opp_colour or None,
             "opp_name": opp_name or None, "roster": [r for r in roster.split(",") if r]}
    rep = analyze.remote(url, hints)
    print(json.dumps(rep["meta"], indent=1))
    for t in rep["teams"]:
        print(f"{t['name'] or t['label']}: final {t['final']}, unidentified {t['unidentified']['pts']}  " +
              "  ".join(f"#{n} {r['pts']}" for n, r in t["players"].items()))
    os.makedirs("cv/out", exist_ok=True)
    json.dump(rep, open("cv/out/modal-last.json", "w"), indent=1)


@app.function(image=image, timeout=1800, secrets=[modal.Secret.from_name("reel-engine")])
def probe(url: str) -> dict:
    """CPU only: can this server download the video? (YouTube may block
    datacenter addresses.) Returns size, duration and how long it took."""
    import time, cv2
    t0 = time.time()
    try:
        path = _download(url, "/tmp/probe.mp4")
    except Exception as e:
        return {"ok": False, "error": str(e)[-400:], "seconds": round(time.time() - t0, 1)}
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    return {"ok": True, "seconds": round(time.time() - t0, 1), "mb": round(os.path.getsize(path) / 1e6),
            "duration": round(cap.get(cv2.CAP_PROP_FRAME_COUNT) / fps), "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))}


@app.local_entrypoint()
def try_download(url: str):
    print(probe.remote(url))
