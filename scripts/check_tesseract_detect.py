import importlib.util, os, subprocess, sys

path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'paddleocr-service', 'tesseract_app.py')
spec = importlib.util.spec_from_file_location('t_app', path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

print('TESSERACT_AVAILABLE (python libs):', getattr(mod, 'TESSERACT_AVAILABLE', None))
ok, ver = mod.check_tesseract_binary()
print('check_tesseract_binary ->', ok, ver)

# Try invoking common paths directly
for cp in [r'C:\Program Files\Tesseract-OCR\tesseract.exe', r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe']:
    print('exists', cp, os.path.exists(cp))
    if os.path.exists(cp):
        try:
            p = subprocess.run([cp, '--version'], capture_output=True, text=True, timeout=5)
            print(cp, 'returncode', p.returncode)
            print('stdout:', p.stdout[:200])
            print('stderr:', p.stderr[:200])
        except Exception as e:
            print('invoke error', e)

sys.exit(0)
