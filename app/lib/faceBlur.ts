// In-browser, best-effort face blurring. Loads TF.js + BlazeFace lazily from a
// CDN only when the user opts in, so it never touches the bundle or the build
// for anyone else. Detects faces on each already-extracted frame and pixelates
// them ON the client, so unblurred faces never leave the device.
//
// FAIL-CLOSED BY DESIGN: this is a privacy promise, so any failure (model won't
// load, a frame can't be processed) THROWS. The caller must abort the upload on
// throw — never fall back to sending unblurred frames.

declare global {
  interface Window { tf?: any; blazeface?: any }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.dataset.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

let modelPromise: Promise<any> | null = null;

async function getModel(): Promise<any> {
  if (!modelPromise) {
    modelPromise = (async () => {
      await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js");
      // NB: the package's own unpkg/jsdelivr field points at a non-existent
      // dist/blazeface.min.js (404) — the real UMD bundle is min.umd.js.
      await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow-models/blazeface@0.1.0/dist/blazeface.min.umd.js");
      if (!window.blazeface?.load) throw new Error("Face-blur model unavailable.");
      return window.blazeface.load();
    })().catch((e) => { modelPromise = null; throw e; });
  }
  return modelPromise;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Frame decode failed."));
    img.src = dataUrl;
  });
}

// Pixelate a region by downscaling then upscaling with smoothing off — robust
// across browsers (no reliance on canvas filter support).
function pixelate(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, x: number, y: number, w: number, h: number) {
  if (w <= 1 || h <= 1) return;
  const tmp = document.createElement("canvas");
  const sw = Math.max(1, Math.floor(w / 12));
  const sh = Math.max(1, Math.floor(h / 12));
  tmp.width = sw; tmp.height = sh;
  const tctx = tmp.getContext("2d");
  if (!tctx) return;
  tctx.drawImage(canvas, x, y, w, h, 0, 0, sw, sh);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, sw, sh, x, y, w, h);
  ctx.imageSmoothingEnabled = true;
}

export async function warmUpFaceBlur(): Promise<void> {
  await getModel();
}

// Returns new frames with detected faces pixelated. Throws on any failure.
export async function blurFacesInFrames(
  dataUrls: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const model = await getModel();
  const out: string[] = [];
  for (let i = 0; i < dataUrls.length; i++) {
    const img = await loadImage(dataUrls[i]);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable for face blur.");
    ctx.drawImage(img, 0, 0);

    const faces = await model.estimateFaces(img, false);
    for (const f of faces) {
      const [x1, y1] = f.topLeft as [number, number];
      const [x2, y2] = f.bottomRight as [number, number];
      const padX = (x2 - x1) * 0.3;
      const padY = (y2 - y1) * 0.3;
      const rx = Math.max(0, x1 - padX);
      const ry = Math.max(0, y1 - padY);
      const rw = Math.min(canvas.width - rx, (x2 - x1) + padX * 2);
      const rh = Math.min(canvas.height - ry, (y2 - y1) + padY * 2);
      pixelate(ctx, canvas, rx, ry, rw, rh);
    }
    out.push(canvas.toDataURL("image/jpeg", 0.85));
    onProgress?.(i + 1, dataUrls.length);
  }
  return out;
}
