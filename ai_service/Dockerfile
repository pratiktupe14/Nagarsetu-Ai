# =================================================================
# NAGARSETU 3.1 — Production AI Microservice (FastAPI + YOLOv8 + LangGraph)
# Optimized for CPU inference with optional container GPU passthrough
# =================================================================

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

# Install runtime dependencies for OpenCV and image processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies (Using PyTorch CPU wheels to avoid 4+ GB of CUDA runtime wheels on CPU container hosts)
COPY requirements.txt .
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt


# Copy AI service source code and pre-trained weights
COPY . /app/ai_service

WORKDIR /app/ai_service

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request, os, sys; port=os.getenv('PORT', '8000'); sys.exit(0 if urllib.request.urlopen(f'http://localhost:{port}/health').getcode() == 200 else 1)" || exit 1

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
