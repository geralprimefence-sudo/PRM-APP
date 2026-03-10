"""Exemplo simples de cliente para enviar imagens ao endpoint /ocr.

Uso:
    python scripts/ocr_client.py test_receipt.png

Opcionalmente podes passar a URL do servidor como segundo argumento:
    python scripts/ocr_client.py test_receipt.png http://localhost:8000/ocr

Este script usa a biblioteca `requests`.
Instala: pip install requests
"""
import sys
import os
import requests


def upload_image(image_path, url="http://127.0.0.1:8000/ocr"):
    if not os.path.exists(image_path):
        raise FileNotFoundError(image_path)
    with open(image_path, "rb") as f:
        files = {"file": (os.path.basename(image_path), f, "image/png")}
        resp = requests.post(url, files=files, timeout=30)
        try:
            return resp.status_code, resp.json()
        except Exception:
            return resp.status_code, resp.text


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/ocr_client.py <image> [server_url]")
        sys.exit(1)
    image = sys.argv[1]
    url = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:8000/ocr"
    code, body = upload_image(image, url)
    print("HTTP", code)
    print(body)


if __name__ == "__main__":
    main()
