API - OCR Service
==================

Base URL (local dev): `http://<host>:8000/`

Endpoints
---------

1) POST /ocr

- Description: Recebe uma imagem (`multipart/form-data` campo `file`) e devolve o texto detectado.
- Request: `multipart/form-data` com campo `file` (jpeg/png)
- Response (success, 200):

```json
{
  "ok": true,
  "text": "linha1\nlinha2...",
  "lines": ["linha1","linha2"]
}
```

- Error (500): mensagem informativa, p.ex. quando `tesseract` não está disponível.

2) GET /health

- Description: devolve estado das bibliotecas e binário Tesseract.
- Response:

```json
{
  "python_libs": true,
  "tesseract_binary": false,
  "version": null
}
```

Exemplo de request (curl)
-------------------------

```bash
curl -F "file=@recibo.jpg" http://localhost:8000/ocr
```

Recomendações de produção
-------------------------
- Forçar HTTPS (nginx/Traefik) e autenticação. Compressão e redimensionamento no cliente para reduzir banda.
- Padrão de resposta: incluir campos extraídos (date, total) e confiança quando possível.
