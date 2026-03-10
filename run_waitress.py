import importlib.util
import importlib
import os
from flask import Flask, jsonify

# Local path to the app module file inside the folder with a hyphen
MODULE_PATH = os.path.join(os.path.dirname(__file__), "paddleocr-service", "app.py")


def load_app_from_path(path):
    spec = importlib.util.spec_from_file_location("paddleocr_wrapper", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # Expect the Flask app to be named `app` in the module
    return getattr(module, "app")


def make_fallback_app(err):
    app = Flask("fallback")

    @app.route("/", methods=["GET"])
    def index():
        return jsonify({"ok": False, "error": "Missing dependencies: %s" % str(err)})

    @app.route("/ocr", methods=["POST"])
    def ocr_missing():
        return jsonify({"ok": False, "error": "OCR backend not installed in this environment."}), 501

    return app


# Try to load the real app; on failure expose a fallback app so server can start
try:
    app = load_app_from_path(MODULE_PATH)
except Exception as e:
    app = make_fallback_app(e)


if __name__ == "__main__":
    # Quick local debug run if invoked directly
    from waitress import serve
    serve(app, host="0.0.0.0", port=8000)
