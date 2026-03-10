FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /app

# Copy repository into container
COPY . /app

# Install system dependencies and tesseract
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     tesseract-ocr \
     libtesseract-dev \
     libleptonica-dev \
     pkg-config \
     build-essential \
  && rm -rf /var/lib/apt/lists/*

# Upgrade pip and install Python deps
RUN pip install --upgrade pip
RUN pip install -r paddleocr-service/requirements.txt

# Expose OCR port
EXPOSE 8001

# Default environment variables
ENV CORS_ORIGINS='*'

# Run the waitress launcher which imports the app dynamically
CMD ["python", "-u", "scripts/run_waitress_tess_launcher.py"]
FROM python:3.11-slim

# Install system deps and Tesseract
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        tesseract-ocr \
        libtesseract-dev \
        libleptonica-dev \
        pkg-config \
        poppler-utils \
        build-essential \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install Python deps. We install lightweight deps first
COPY requirements.txt /app/requirements.txt
RUN pip install --upgrade pip && pip install -r /app/requirements.txt && pip install pytesseract Pillow waitress

# Copy service code
COPY . /app

ENV FLASK_ENV=production
EXPOSE 8000

CMD ["waitress-serve", "--port=8000", "run_waitress_tess:app"]
