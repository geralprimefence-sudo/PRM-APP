Cliente de exemplo (Python)
===========================

Um cliente Python mínimo para testar o endpoint `/ocr` localmente.

Pré-requisitos
- `requests` instalado no ambiente (no `venv` do projecto):

```powershell
pip install requests
```

Uso

```powershell
python scripts/ocr_client.py test_receipt.png
# ou especifica o servidor
python scripts/ocr_client.py test_receipt.png http://localhost:8000/ocr
```

O script imprime o código HTTP e a resposta (JSON ou texto). Útil para testar integração rápida do APK com a API.
