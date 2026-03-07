from flask import Flask, request, jsonify
from paddleocr import PaddleOCR
import tempfile
import os

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
        result = ocr.ocr(tmp_path, cls=True)
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


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8081)
