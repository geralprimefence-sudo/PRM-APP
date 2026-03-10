import importlib.util, os, sys
path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'paddleocr-service', 'tesseract_app.py')
spec = importlib.util.spec_from_file_location('t_app', path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

img = 'test_receipt.png'
if not os.path.exists(img):
    print('test image missing')
    sys.exit(1)

print('TESSERACT_AVAILABLE:', mod.TESSERACT_AVAILABLE)
ok, ver = mod.check_tesseract_binary()
print('binary ok:', ok, ver)
pre = mod.preprocess_receipt(img)
print('preproc path:', pre)
lines = mod.extract_lines_from_tesseract(pre)
print('lines:', lines)
