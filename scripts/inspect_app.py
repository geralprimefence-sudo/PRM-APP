import importlib.util
import os

ROOT = os.path.dirname(os.path.dirname(__file__))
RUN_PATH = os.path.join(ROOT, 'run_waitress_tess.py')

def load_module(path):
    spec = importlib.util.spec_from_file_location('run_waitress_tess', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

if __name__ == '__main__':
    mod = load_module(RUN_PATH)
    app = getattr(mod, 'app')
    try:
        rules = list(app.url_map.iter_rules())
        print('Loaded app routes:')
        for r in rules:
            print(r)
    except Exception as e:
        print('Failed to introspect app:', e)
