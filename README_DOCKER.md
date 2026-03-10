Docker (PaddleOCR) - Build & Run
================================

Este projecto inclui um `Dockerfile` e `docker-compose.yml` para criar um container com a API OCR.

Notas importantes:
- O PaddleOCR e algumas dependências (ex.: `numpy`, `shapely`, `scikit-image`) podem exigir compilação/depêndencias adicionais. A imagem base pode precisar de ser ajustada para incluir toolchains ou usar uma imagem pré-compilada.
- Se a instalação falhar no `pip install -r paddleocr-service/requirements.txt`, testa usar uma imagem baseada em Ubuntu completa ou construir numa máquina Linux com suporte ao compilador.

Build e run:

```bash
# Build image
docker build -t faturas-ocr:latest .

# Ou com docker-compose
docker-compose up --build -d

# Verifica logs
docker-compose logs -f
```

Endpoint exposto:
- `http://localhost:8000/` — wrapper service (usa `run_waitress:app` criado no repositório)
- `http://localhost:8000/ocr` — endpoint POST para subir imagens (multipart/form-data `file`).

Production notes:
- Usa HTTPS (proxy reverso como nginx / Traefik) e autenticação (API keys, JWT).
- Para performance e precisão, considera usar uma VM Linux com GPU e imagem optimizada para PaddlePaddle se fores usar PaddleOCR em produção.
