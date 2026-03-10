Deploying the OCR service to Render
----------------------------------

This repository contains a small Flask-based OCR microservice in `paddleocr-service`.
Below are concise steps to deploy it to Render using the included `Dockerfile`.

1) Build & test locally with Docker

```bash
docker build -t faturas-ocr:latest -f paddleocr-service/Dockerfile .
docker run -p 8001:8001 -e API_KEY=secret123 faturas-ocr:latest
# then test
curl -H "X-API-Key: secret123" -F "file=@test_receipt.png" http://127.0.0.1:8001/ocr
```

2) Create a new Render service

- On Render dashboard, create a new Web Service and choose "Docker" as the environment.
- Connect your GitHub repo and point to the root of this repository.
- Set the build command to default (Render will use the Dockerfile).
- Set the startup command to the default (Docker CMD is used).

3) Environment variables

- `API_KEY` — set a strong secret and store it in the app's environment. The service will require `X-API-Key` header if set.
- `CORS_ORIGINS` — optional, default `*`. You can restrict to your webapp domain.

4) After deploy

- Validate `/ocr` and `/health` (if added) using HTTPS URL provided by Render.
- Update your webapp (`public/capturar-foto.html`) to point to the deployed OCR URL and (optionally) store the API key in `localStorage.setItem('ocr_api_key','yourkey')` for testing.

If you want, I can also add a `render.yaml` entry for you — tell me if you want me to modify the repository's `render.yaml` automatically.

Secrets required for CI-driven deploy
------------------------------------

To allow the GitHub Actions workflow to trigger deploys on Render you should add two repository secrets in GitHub:

- `RENDER_API_KEY` — an API key from Render with permission to create deploys.
- `RENDER_SERVICE_ID` — the Render service id for the `faturas-ocr` service (you can find it in the Render dashboard URL for the service).

The workflow will also push the image to GitHub Container Registry using the built-in `GITHUB_TOKEN`.
