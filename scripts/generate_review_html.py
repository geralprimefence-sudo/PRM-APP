"""Generate an HTML review page from a batch OCR JSON report.

Usage:
  python scripts/generate_review_html.py --in batch_report_jpg_refined.json --out review.html
"""
import argparse
import json
import html
import os


def make_row(r):
    file = r.get('file')
    safe_file = html.escape(file or '')
    fields = r.get('fields') or r.get('response', {}).get('fields') or {}
    total = fields.get('total')
    date = fields.get('date')
    lines = r.get('lines') or []
    variant = r.get('refined') or r.get('variant') or ''
    ok = r.get('ok')
    error = r.get('error') or ''
    # image tag (relative)
    img_tag = ''
    if file and os.path.exists(file):
        img_tag = f'<a href="{html.escape(file)}" target="_blank"><img src="{html.escape(file)}" style="max-width:240px;max-height:240px;object-fit:contain;border:1px solid #ccc"/></a>'
    lines_html = '<br/>'.join(html.escape(l) for l in lines[:20])
    return f'<tr><td>{img_tag}</td><td>{safe_file}</td><td>{html.escape(str(total))}</td><td>{html.escape(str(date))}</td><td>{html.escape(variant)}</td><td>{html.escape(error)}</td><td style="white-space:pre-wrap">{lines_html}</td></tr>'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='jin', default='batch_report_jpg_refined.json')
    ap.add_argument('--out', default='batch_review.html')
    args = ap.parse_args()

    with open(args.jin, encoding='utf-8') as fh:
        j = json.load(fh)

    rows = [make_row(r) for r in j.get('results', [])]

    html_doc = f"""
<html>
<head>
  <meta charset="utf-8"/>
  <title>OCR Batch Review</title>
  <style>
    body{{font-family:Segoe UI,Arial,Helvetica,sans-serif}}
    table{{border-collapse:collapse;width:100%}}
    th,td{{border:1px solid #ddd;padding:6px;vertical-align:top}}
    th{{background:#f2f2f2;text-align:left}}
  </style>
</head>
<body>
  <h1>OCR Batch Review</h1>
  <p>Report: {html.escape(args.jin)}</p>
  <table>
    <thead><tr><th>Image</th><th>File</th><th>Total</th><th>Date</th><th>Variant</th><th>Error</th><th>Lines (top)</th></tr></thead>
    <tbody>
      {''.join(rows)}
    </tbody>
  </table>
</body>
</html>
"""

    with open(args.out, 'w', encoding='utf-8') as of:
        of.write(html_doc)
    print('Wrote', args.out)


if __name__ == '__main__':
    main()
