import os
import json
import sys
try:
    import requests
except Exception:
    requests = None


def analyze_receipt(image_path):
    """Call Azure Form Recognizer prebuilt receipt model and return parsed fields.

    Expects environment variables `AZURE_FR_ENDPOINT` and `AZURE_FR_KEY` to be set.
    Returns dict with raw response and a `fields` dict with common keys when available.
    """
    endpoint = os.environ.get('AZURE_FR_ENDPOINT')
    key = os.environ.get('AZURE_FR_KEY')
    if not endpoint or not key:
        raise RuntimeError('AZURE_FR_ENDPOINT or AZURE_FR_KEY not set')
    if requests is None:
        raise RuntimeError('requests library is required for Azure Form Recognizer integration')

    url = endpoint.rstrip('/') + '/formrecognizer/documentModels/prebuilt-receipt:analyze?api-version=2023-07-31'
    headers = {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/octet-stream'
    }
    with open(image_path, 'rb') as f:
        data = f.read()

    resp = requests.post(url, headers=headers, data=data, timeout=60)
    if resp.status_code not in (200, 201):
        # Some deployments return 202 and require polling; fall back to returning raw response
        try:
            return {'ok': False, 'status_code': resp.status_code, 'text': resp.text}
        except Exception:
            resp.raise_for_status()

    j = resp.json()
    # attempt to extract common fields from returned JSON
    fields = {}
    try:
        # navigate typical structure
        doc = j.get('documents', [{}])[0]
        props = doc.get('fields', {})
        def val(name):
            v = props.get(name)
            if not v:
                return None
            return v.get('content') or v.get('valueString') or v.get('valueNumber')

        fields['merchant_name'] = val('MerchantName')
        fields['total'] = val('Total')
        fields['transaction_date'] = val('TransactionDate')
    except Exception:
        pass

    return {'ok': True, 'raw': j, 'fields': fields}
