import importlib.util
import os

MODULE_PATH = os.path.join(os.path.dirname(__file__), "paddleocr-service", "tesseract_app.py")


def load_app_from_path(path):
    spec = importlib.util.spec_from_file_location("tesseract_wrapper", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return getattr(module, "app")


try:
    app = load_app_from_path(MODULE_PATH)
except Exception as e:
    import traceback
    tb = traceback.format_exc()
    try:
        with open(os.path.join(os.path.dirname(__file__), 'run_import_error.txt'), 'w', encoding='utf-8') as ef:
            ef.write(tb)
    except Exception:
        pass
    # Provide a minimal fallback Flask app so the server can start
    from flask import Flask, jsonify

    app = Flask("tesseract_fallback")

    @app.route("/", methods=["GET"])
    def index():
        return jsonify({"ok": False, "error": "Failed to load tesseract app. See run_import_error.txt for details."}), 500

    @app.route("/ocr", methods=["POST"])
    def ocr_unavailable():
        return jsonify({"ok": False, "error": "Tesseract service unavailable in this environment."}), 503


if __name__ == "__main__":
    from waitress import serve
    serve(app, host="0.0.0.0", port=8001)
