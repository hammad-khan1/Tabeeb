"""Runs the classifier directly on an image and prints ranked pathologies."""
import sys
import io
import numpy as np
import skimage.io
import torch
import torchxrayvision as xrv
import torchvision

path = sys.argv[1]
raw = open(path, "rb").read()
img = skimage.io.imread(io.BytesIO(raw))
print(f"input: {img.shape}, dtype={img.dtype}")

if img.ndim == 3:
    img = img[:, :, :3].mean(axis=2)
img = xrv.datasets.normalize(img, 255)
img = img[None, ...]

model = xrv.models.get_model("densenet121-res224-all")
model.eval()
transform = torchvision.transforms.Compose(
    [xrv.datasets.XRayCenterCrop(), xrv.datasets.XRayResizer(224)]
)
img = transform(img)

with torch.no_grad():
    out = model(torch.from_numpy(img).unsqueeze(0).float())[0]

rows = sorted(
    ((p, float(s)) for p, s in zip(model.pathologies, out) if p and float(s) > 0),
    key=lambda r: -r[1],
)
print(f"\n{len(rows)} pathologies scored:\n")
for pathology, score in rows:
    bar = "█" * int(score * 40)
    print(f"  {pathology:28} {score:.3f} {bar}")
