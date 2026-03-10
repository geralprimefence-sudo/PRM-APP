import urllib.request
import urllib.error
try:
    with urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=5) as resp:
        print(resp.status)
        print(resp.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print('HTTPERR', e.code, e.reason)
    try:
        print(e.read().decode('utf-8'))
    except Exception:
        pass
except Exception as e:
    print('ERR', e)
