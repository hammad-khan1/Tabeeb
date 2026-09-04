# X-ray classifier service

A small self-hosted classifier that Tabeeb calls over HTTP to screen chest X-rays.

It exists because a general-purpose vision LLM cannot read an X-ray. Asked to, it
produces fluent, confident, unfounded findings — which is what Tabeeb used to do and
store as clinical data. A CheXNet-class model instead returns a calibrated probability
per pathology, which the app can present honestly.

**Model:** `torchxrayvision` `densenet121-res224-all`, trained across NIH
ChestX-ray14, CheXpert, MIMIC-CXR and PadChest. It scores 18 pathologies including
the ones people ask about: fracture, mass, nodule, infiltration, consolidation,
pneumothorax, effusion, pneumonia, cardiomegaly.

**This is not a medical device.** No openly available chest X-ray model is
regulator-cleared. They are trained almost entirely on frontal adult chest films, and
published performance comes from the same datasets they were trained on. Output is a
screening signal requiring clinical confirmation, and Tabeeb labels it that way
everywhere it appears.

## Why the response shape matters

The service returns HuggingFace's image-classification format:

```json
[{"label": "Effusion", "score": 0.81}, {"label": "Pneumonia", "score": 0.64}]
```

That is deliberate. A managed HuggingFace Inference Endpoint returns the same shape,
so this service and a paid endpoint are interchangeable behind Tabeeb's single
`RADIOLOGY_CLASSIFIER_URL` setting. Self-hosting free now and moving to managed
hosting later is a configuration change, not a migration.

## Running locally

```bash
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
./.venv/bin/uvicorn app:app --port 8000
```

First request downloads the model weights (~30MB) and takes a few seconds; after that
CPU inference is well under a second. No GPU needed.

Point Tabeeb at it in `.env.local`:

```
RADIOLOGY_CLASSIFIER_URL=http://127.0.0.1:8000/
HF_API_KEY=any-non-empty-value
```

`HF_API_KEY` must be non-empty because Tabeeb sends it as a bearer token. Set
`AUTH_TOKEN` on the service to the same value to reject anything else.

## Deploying free

Any host that runs a container works. In rough order of least friction:

**HuggingFace Spaces (Docker SDK)** — free CPU tier, no card required. Create a Space,
push `app.py`, `requirements.txt` and a `Dockerfile`, and set `AUTH_TOKEN` as a Space
secret. Idle Spaces sleep and take 30–60s to wake; Tabeeb's client retries a cold
start with a long timeout, so this is workable.

**Fly.io / Render** — free allowances, same sleep behaviour.

**A small VPS** — no sleeping, roughly $5/month, simplest to reason about.

```dockerfile
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libgl1 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
# Warm the weights into the image so the first real request is not slow.
RUN python -c "import torchxrayvision as xrv; xrv.models.get_model('densenet121-res224-all')"
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
```

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/` | Raw image bytes in, ranked pathology scores out |
| `GET` | `/health` | Liveness, and whether the model is loaded |

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `XRV_MODEL` | `densenet121-res224-all` | Any torchxrayvision checkpoint |
| `AUTH_TOKEN` | *(unset)* | Shared secret. Set it — otherwise a public deployment is an open endpoint anyone can send images to. |

## A note on privacy

Whatever you deploy this on receives patients' X-rays. That rules out calling somebody
else's public Space, and it means the host you pick is a place medical images are
processed. Self-hosting is the point.
