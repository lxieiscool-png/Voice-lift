"""Train Reel's own detector for ball and rim (RF-DETR, Apache-2.0).

  modal run cv/train/modal_train.py::prepare     download + merge datasets
  modal run --detach cv/train/modal_train.py::start_training

Data (CC BY 4.0, credit in cv/train/CREDITS.md):
  hooper-ibdsr/basketball-detection-v6   hoop, ball  (holder/scorer dropped:
                                          only some people are boxed there)
  test-w6ead/basketball-detection-pymfu  rim, basketball
  tomas-34ray/basketball-detection-cjjxp Hoop, Scoreboard
People come from RF-DETR's stock COCO model instead, which already finds
them well.
"""
import os

import modal

app = modal.App("reel-train")
data = modal.Volume.from_name("reel-train", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("libgl1", "libglib2.0-0")
    .pip_install("rfdetr[train,loggers]", "roboflow", "pycocotools", "pillow", "numpy")
)

# Scoreboards stay with the open-vocabulary reader (no labelled source had them).
CLASSES = ["ball", "rim"]
REMAP = {"ball": "ball", "basketball": "ball", "hoop": "rim", "rim": "rim"}
SOURCES = [  # (workspace, project, version, max train images)
    ("hooper-ibdsr", "basketball-detection-v6", 1, 14000),
    ("test-w6ead", "basketball-detection-pymfu", 3, None),
    ("tomas-34ray", "basketball-detection-cjjxp", 3, None),
]


@app.function(image=image, timeout=4 * 3600, volumes={"/data": data}, secrets=[modal.Secret.from_name("reel-train")],
              cpu=8, memory=16384)
def prepare():
    """Download each source in COCO format and merge into /data/merged with
    our three classes. Large sources are subsampled to keep training cheap."""
    import json, random, shutil
    from roboflow import Roboflow
    rf = Roboflow(api_key=os.environ["ROBOFLOW_API_KEY"])
    out = "/data/merged"
    shutil.rmtree(out, ignore_errors=True)
    merged = {s: {"images": [], "annotations": [], "categories": [{"id": i, "name": c, "supercategory": "none"} for i, c in enumerate(CLASSES)]}
              for s in ("train", "valid", "test")}
    for s in merged:
        os.makedirs(f"{out}/{s}", exist_ok=True)
    img_id = ann_id = 0
    random.seed(0)
    stats = {}
    for ws, pj, ver, cap in SOURCES:
        dl = f"/data/src/{pj}"
        if not os.path.exists(dl):
            rf.workspace(ws).project(pj).version(ver).download("coco", location=dl)
        for split in ("train", "valid", "test"):
            jf = f"{dl}/{split}/_annotations.coco.json"
            if not os.path.exists(jf):
                continue
            coco = json.load(open(jf))
            cat = {c["id"]: REMAP.get(c["name"].strip().lower()) for c in coco["categories"]}
            anns = {}
            for a in coco["annotations"]:
                name = cat.get(a["category_id"])
                if name:
                    anns.setdefault(a["image_id"], []).append((name, a["bbox"]))
            imgs = coco["images"]
            if cap and split == "train" and len(imgs) > cap:
                imgs = random.sample(imgs, cap)
            # sources without their own validation split lend 4% of train to it
            has_valid = os.path.exists(f"{dl}/valid/_annotations.coco.json")
            dest = {}
            if split == "train" and not has_valid:
                for im in random.sample(imgs, len(imgs) // 25):
                    dest[im["id"]] = "valid"
            for im in imgs:
                to = dest.get(im["id"], split)
                src = f"{dl}/{split}/{im['file_name']}"
                if not os.path.exists(src):
                    continue
                img_id += 1
                fn = f"{pj[:12]}_{img_id}{os.path.splitext(im['file_name'])[1]}"
                shutil.copy(src, f"{out}/{to}/{fn}")
                merged[to]["images"].append({"id": img_id, "file_name": fn, "width": im["width"], "height": im["height"]})
                for name, (x, y, w, h) in anns.get(im["id"], []):
                    ann_id += 1
                    merged[to]["annotations"].append({"id": ann_id, "image_id": img_id, "category_id": CLASSES.index(name),
                                                         "bbox": [x, y, w, h], "area": w * h, "iscrowd": 0})
                    stats[(pj, to, name)] = stats.get((pj, to, name), 0) + 1
    for s, coco in merged.items():
        json.dump(coco, open(f"{out}/{s}/_annotations.coco.json", "w"))
    data.commit()
    summary = {s: (len(c["images"]), len(c["annotations"])) for s, c in merged.items()}
    print("images/annotations per split:", summary)
    for k, v in sorted(stats.items()):
        print(" ", k, v)
    return summary


# Hard cap: 2.5 h on an A100 (~$2.50/h) = at most ~$6.25, well inside the free credit.
@app.function(image=image, gpu="A100-80GB", timeout=int(2.5 * 3600), volumes={"/data": data})
def train(epochs: int = 12, size: str = "medium"):
    from rfdetr import RFDETRMedium, RFDETRSmall
    model = (RFDETRMedium if size == "medium" else RFDETRSmall)()
    model.train(dataset_dir="/data/merged", epochs=epochs, batch_size="auto", output_dir=f"/data/runs/{size}",
                num_workers=8, checkpoint_interval=2)
    data.commit()


@app.local_entrypoint()
def start_training(epochs: int = 12, size: str = "medium"):
    call = train.spawn(epochs, size)
    print("spawned", call.object_id)
