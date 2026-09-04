FROM python:3.11-slim
WORKDIR /app

# skimage/torchvision need these at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libgl1 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

# Bake the weights into the image so the first real request is not a slow download.
RUN python -c "import torchxrayvision as xrv; xrv.models.get_model('densenet121-res224-all')"

EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
