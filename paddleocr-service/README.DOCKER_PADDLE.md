Docker (Paddle) — build & run

This Dockerfile builds a CPU-based image including `paddlepaddle` and the service requirements.

Build locally:

```bash
docker build -t paddleocr-service:paddle -f paddleocr-service/Dockerfile.paddle .
```

Run locally (exposes port 10000 inside container):

```bash
docker run --rm -p 10000:10000 -e PORT=10000 paddleocr-service:paddle
```

Notes:
- The `paddlepaddle` wheel is installed from the official Paddle whl index for CPU (MKL/AVX); if your host lacks AVX support or you need GPU, change the pip install target accordingly.
- Builds can be large and may take several minutes; ensure sufficient memory (>=2GB recommended).
- If installation fails due to wheel compatibility, consider using a CI runner with a matching architecture or using a prebuilt base image from Paddle.

Once the container is running, point your app to the container URL and run the same smoke tests used previously.
