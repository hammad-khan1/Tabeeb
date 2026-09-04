"""
Chest X-ray screening service.

A small, self-hosted classifier that Tabeeb calls over HTTP. It exists because a
general-purpose vision LLM cannot read an X-ray — it produces fluent, unfounded
findings — while a CheXNet-class model returns calibrated per-pathology
probabilities that the app can present honestly.

The response deliberately matches HuggingFace's image-classification format
(`[{"label": ..., "score": ...}]`) so this service and a HuggingFace Inference
Endpoint are interchangeable: point RADIOLOGY_CLASSIFIER_URL at either, no code
change. That is what makes the free self-hosted option now and a managed endpoint
later the same decision.

Model: torchxrayvision densenet121-res224-all, trained across NIH ChestX-ray14,
CheXpert, MIMIC-CXR, PadChest and others. CPU inference on a 224x224 image is well
under a second, so no GPU is needed.

NOT a medical device. Output is a screening signal requiring clinical confirmation.
"""

import io
import logging
import os

import numpy as np
import skimage.io
import torch
import torchxrayvision as xrv
import torchvision
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("xray")

MODEL_NAME = os.environ.get("XRV_MODEL", "densenet121-res224-all")

# Optional shared secret. Tabeeb sends `Authorization: Bearer <HF_API_KEY>`; when
# AUTH_TOKEN is set the value must match, so a public deployment is not an open
# endpoint anyone can send images to.
AUTH_TOKEN = os.environ.get("AUTH_TOKEN", "").strip()

MAX_BYTES = 25 * 1024 * 1024

app = FastAPI(title="Tabeeb X-ray classifier", docs_url=None, redoc_url=None)

_model = None
_transform = None


def get_model():
    """Loaded once, lazily — a cold container should answer /health immediately."""
    global _model, _transform
    if _model is None:
        log.info("loading %s", MODEL_NAME)
        _model = xrv.models.get_model(MODEL_NAME)
        _model.eval()
        _transform = torchvision.transforms.Compose(
            [xrv.datasets.XRayCenterCrop(), xrv.datasets.XRayResizer(224)]
        )
        log.info("loaded, %d pathologies", len(_model.pathologies))
    return _model, _transform


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME, "loaded": _model is not None}


@app.post("/")
async def classify(request: Request) -> Response:
    if AUTH_TOKEN:
        supplied = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        if supplied != AUTH_TOKEN:
            raise HTTPException(status_code=401, detail="Unauthorized")

    raw = await request.body()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty request body")
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Image too large")

    try:
        img = skimage.io.imread(io.BytesIO(raw))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unreadable image: {exc}") from exc

    # torchxrayvision expects a single-channel image scaled to [-1024, 1024].
    if img.ndim == 3:
        img = img[:, :, :3].mean(axis=2)
    img = xrv.datasets.normalize(img, 255)
    img = img[None, ...]

    model, transform = get_model()
    img = transform(img)

    with torch.no_grad():
        outputs = model(torch.from_numpy(img).unsqueeze(0).float())[0]

    # Labels the checkpoint does not predict come back as 0.0; drop them rather than
    # reporting a confident "absent" the model never actually made.
    results = [
        {"label": pathology, "score": round(float(score), 4)}
        for pathology, score in zip(model.pathologies, outputs)
        if pathology and float(score) > 0.0
    ]
    results.sort(key=lambda r: r["score"], reverse=True)

    return JSONResponse(results)
