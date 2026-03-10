import requests
try:
    with open('test_receipt.png','rb') as f:
        r = requests.post('http://127.0.0.1:8082/ocr', files={'file': f}, timeout=120)
    print(r.status_code)
    print(r.text)
except Exception as e:
    print('ERR', e)
