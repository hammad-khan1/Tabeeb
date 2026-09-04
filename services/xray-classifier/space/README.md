---
title: Tabeeb X-ray Classifier
emoji: 🩻
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
short_description: Chest X-ray pathology screening API for Tabeeb
---

# Tabeeb X-ray classifier

Screening API that scores 18 chest pathologies with
[torchxrayvision](https://github.com/mlmed/torchxrayvision)
`densenet121-res224-all`.

`POST /` with raw image bytes returns HuggingFace's image-classification format, so
this Space is interchangeable with a managed Inference Endpoint:

```json
[{"label": "Effusion", "score": 0.81}, {"label": "Pneumonia", "score": 0.64}]
```

**Not a medical device.** No openly available chest X-ray model is regulator-cleared.
Output is a screening signal requiring clinical confirmation. The calling application
additionally rejects results where the model failed to discriminate — which is the
normal outcome for a photograph of a film on a lightbox rather than the X-ray file.

Set `AUTH_TOKEN` as a Space secret; requests must then carry
`Authorization: Bearer <token>`.
