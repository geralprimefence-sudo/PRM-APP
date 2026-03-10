"""Convert batch OCR JSON report to a human-readable CSV."""
import argparse
import json
import csv
import os


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='jin', default='batch_report_jpg.json')
    ap.add_argument('--out', default='batch_report_jpg.csv')
    args = ap.parse_args()

    with open(args.jin, encoding='utf-8') as fh:
        data = json.load(fh)

    rows = []
    for r in data.get('results', []):
        file = r.get('file')
        ok = r.get('ok')
        total = None
        date = None
        if r.get('fields'):
            total = r['fields'].get('total')
            date = r['fields'].get('date')
        else:
            resp = r.get('response') or {}
            f = resp.get('fields') or {}
            total = f.get('total')
            date = f.get('date')
        lines = r.get('lines') or []
        lines_text = '\n'.join(lines)
        error = r.get('error') or ''
        rows.append({'file': file, 'ok': ok, 'total': total, 'date': date, 'error': error, 'lines': lines_text})

    with open(args.out, 'w', newline='', encoding='utf-8') as cf:
        writer = csv.DictWriter(cf, fieldnames=['file','ok','total','date','error','lines'])
        writer.writeheader()
        for rr in rows:
            writer.writerow(rr)

    print('Wrote', args.out)


if __name__ == '__main__':
    main()
