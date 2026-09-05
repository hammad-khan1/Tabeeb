"""
REJECTED — do not wire this model into the app. Kept as the record of why.

Exports prithivMLmods/Bone-Fracture-Detection to ONNX. Evaluated as the free option
for limb fracture detection and found unusable on real input.

A SigLIP2 image classifier fine-tuned for binary fracture detection on limb
radiographs. Published metrics on 8,863 held-out samples:

              precision   recall   f1
    Fractured    0.8633   0.7893   0.8246
Not Fractured    0.8020   0.8722   0.8356

Those figures are on its own held-out split. Run against the images this app
actually receives, it collapses:

    foot X-ray                      Fractured 0.909
    leg X-ray with metal implant    Fractured 0.229
    chest X-ray (miliary TB)        Fractured 0.980
    photograph of a prescription    Fractured 0.822

It calls a chest film 98% fractured and a picture of a sheet of paper 82%
fractured. It is not detecting fractures; it emits near-arbitrary output biased
toward the positive class on anything outside its training distribution. A patient
shown "possible fracture, 91%" from that has been told nothing, and would be told
the same about their prescription.

Shipping it would reproduce the exact failure this whole feature was rebuilt to
remove: confident, structured, unfounded clinical output. Limb fracture detection
needs a validated model; the cleared commercial products (Gleamer BoneView and
similar) exist for this and are not free.

    ./.venv/bin/python export_fracture_onnx.py   # only to reproduce the evaluation
"""

import json
from pathlib import Path

import torch
from transformers import AutoImageProcessor, AutoModelForImageClassification

OUT = Path(__file__).resolve().parents[2] / "models"
REPO = "prithivMLmods/Bone-Fracture-Detection"


class LogitsOnly(torch.nn.Module):
    """Unwraps the HF output object, which does not export cleanly."""

    def __init__(self, model: torch.nn.Module) -> None:
        super().__init__()
        self.model = model

    def forward(self, pixel_values: torch.Tensor) -> torch.Tensor:
        return torch.softmax(self.model(pixel_values=pixel_values).logits, dim=-1)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    processor = AutoImageProcessor.from_pretrained(REPO)
    model = AutoModelForImageClassification.from_pretrained(REPO).eval()

    size = processor.size["height"]
    dummy = torch.randn(1, 3, size, size)
    onnx_path = OUT / "bone-fracture-siglip2.onnx"

    torch.onnx.export(
        LogitsOnly(model).eval(), (dummy,), str(onnx_path),
        input_names=["pixel_values"], output_names=["probs"],
        opset_version=17, dynamo=False,
    )

    meta = {
        "model": REPO,
        "input_size": size,
        "id2label": model.config.id2label,
        # SigLIP normalisation: (x/255 - mean) / std, per channel.
        "image_mean": processor.image_mean,
        "image_std": processor.image_std,
        "metrics": {
            "fractured": {"precision": 0.8633, "recall": 0.7893},
            "not_fractured": {"precision": 0.8020, "recall": 0.8722},
            "accuracy": 0.8303,
            "support": 8863,
        },
    }
    (OUT / "bone-fracture-siglip2.meta.json").write_text(json.dumps(meta, indent=1))
    print(f"wrote {onnx_path} ({onnx_path.stat().st_size // (1024*1024)}MB)")
    print("labels:", model.config.id2label)
    print("preprocessing:", processor.image_mean, processor.image_std, size)


if __name__ == "__main__":
    main()
