from flask import Flask, request, jsonify
from paddleocr import PaddleOCR
import tempfile
import os
import cv2
import numpy as np

app = Flask(__name__)

ocr = PaddleOCR(use_angle_cls=True, lang='pt')


def extract_lines(result):
    lines = []
    for block in result or []:
        for item in block or []:
            if not item or len(item) < 2:
                continue
            text = item[1][0] if item[1] and len(item[1]) > 0 else ""
            if text:
                lines.append(str(text).strip())
    return [l for l in lines if l]


@app.route('/ocr', methods=['POST'])
def run_ocr():
    if 'file' not in request.files:
        return jsonify({'ok': False, 'error': 'missing file'}), 400

    f = request.files['file']
    if not f.filename:
        return jsonify({'ok': False, 'error': 'empty filename'}), 400

    suffix = os.path.splitext(f.filename)[1] or '.bin'
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp_path = tmp.name
    tmp.close()

    try:
        f.save(tmp_path)
        # Pré-processamento para recibos térmicos
        preproc_path = preprocess_receipt(tmp_path)
        result = ocr.ocr(preproc_path, cls=True)
        lines = extract_lines(result)
        text = "\n".join(lines)
        return jsonify({'ok': True, 'text': text, 'lines': lines})
    except Exception as exc:
        return jsonify({'ok': False, 'error': str(exc)}), 500
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        try:
            if 'preproc_path' in locals() and preproc_path != tmp_path:
                os.unlink(preproc_path)
        except OSError:
            pass


def deskew(image):
    coords = np.column_stack(np.where(image > 0))
    if coords.shape[0] < 10:
        return image  # não deskewa imagens quase vazias
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle
    (h, w) = image.shape[:2]
    M = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
    rotated = cv2.warpAffine(image, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return rotated


def preprocess_receipt(image_path):
    img = cv2.imread(image_path)
    if img is None:
        return image_path  # fallback: return original if failed to load
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)
    bin_img = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY, 25, 11  # parâmetros ajustados
    )
    denoised = cv2.medianBlur(bin_img, 3)
    deskewed = deskew(denoised)
    preproc_path = image_path + '_preproc.png'
    cv2.imwrite(preproc_path, deskewed)
    return preproc_path


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8081)
