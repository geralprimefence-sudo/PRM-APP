FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# System deps for common Python imaging libs; adjust if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

# copy project
COPY . /app

# Install Python deps from service requirements (may be large)
RUN pip install --upgrade pip
RUN pip install --no-cache-dir waitress
RUN if [ -f paddleocr-service/requirements.txt ]; then pip install --no-cache-dir -r paddleocr-service/requirements.txt || true; fi

# Expose port used by the service
EXPOSE 8000

# Use the wrapper created to avoid hyphen path issues
CMD ["waitress-serve", "--port=8000", "run_waitress:app"]
