"""
Regenerates models/chest-xray-densenet121.onnx from the torchxrayvision checkpoint.

The exported graph deliberately stops *before* `op_norm`. That function rescales each
output about its calibrated operating point using boolean-mask assignment, which does
not survive ONNX export — the resulting graph fails at a Reshape node. The same maths
is a few lines of TypeScript, so it lives in the app instead (see onnx-classifier.ts),
and the thresholds it needs are written to the .meta.json beside the model.

    ./.venv/bin/python export_onnx.py
"""

import json
from pathlib import Path

import torch
import torch.nn as nn
import torchxrayvision as xrv

OUT = Path(__file__).resolve().parents[2] / "models"
MODEL = "densenet121-res224-all"


class RawSigmoid(nn.Module):
    """Everything up to the sigmoid; op_norm is applied by the caller."""

    def __init__(self, model: nn.Module) -> None:
        super().__init__()
        self.model = model

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return torch.sigmoid(self.model.classifier(self.model.features2(x)))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    base = xrv.models.get_model(MODEL).eval()

    # Static batch of 1: a dynamic batch axis breaks a Reshape in the graph tail, and
    # the app scores one image at a time.
    dummy = torch.randn(1, 1, 224, 224)
    onnx_path = OUT / "chest-xray-densenet121.onnx"
    torch.onnx.export(
        RawSigmoid(base).eval(), (dummy,), str(onnx_path),
        input_names=["image"], output_names=["sigmoid"],
        opset_version=17, dynamo=False,
    )

    meta = {
        "model": MODEL,
        "pathologies": base.pathologies,
        "op_threshs": [None if t != t else float(t) for t in base.op_threshs],
    }
    (OUT / "chest-xray-densenet121.meta.json").write_text(json.dumps(meta, indent=1))
    print(f"wrote {onnx_path} ({onnx_path.stat().st_size // (1024*1024)}MB)")


if __name__ == "__main__":
    main()
