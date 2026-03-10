"""Run OCR over a directory of receipt images and produce a JSON report.

Usage examples:
  python scripts/run_batch_ocr.py --dir . --pattern test_receipt.png
  python scripts/run_batch_ocr.py --dir uploads/2026 --mode http --endpoint http://localhost:8001/ocr

Supports optional ground-truth CSV with columns: filename,total,date
"""
import argparse
import os
import glob
import json
import csv
import tempfile
import shutil
from PIL import Image, ImageOps, ImageFilter, ImageEnhance
try:
    import cv2
    OPENCV_AVAILABLE = True
except Exception:
    OPENCV_AVAILABLE = False


def load_tesseract_app_module(path_root):
    import importlib.util
    p = os.path.join(path_root, 'paddleocr-service', 'tesseract_app.py')
    spec = importlib.util.spec_from_file_location('tesseract_app', p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run_local_on_file(mod, filepath):
    # ensure tesseract binary is configured for pytesseract
    try:
        mod.check_tesseract_binary()
    except Exception:
        pass
    # call preprocess + extract + fields
    pre = mod.preprocess_receipt(filepath)
    try:
        lines = mod.extract_lines_from_tesseract(pre)
        fields = mod.extract_fields_from_lines(lines)
    finally:
        try:
            if pre and pre != filepath and os.path.exists(pre):
                os.unlink(pre)
        except Exception:
            pass
    return {'lines': lines, 'fields': fields}


def try_preprocessing_variants(mod, filepath):
    tmp_files = []
    try:
        img = Image.open(filepath)
    except Exception as e:
        raise

    def save_tmp(im, suffix):
        fd, p = tempfile.mkstemp(suffix='_'+suffix+'.png')
        os.close(fd)
        try:
            im2 = im.convert('RGB') if hasattr(im, 'convert') else im
            # downscale very large images to avoid encoder hangs
            maxw = 2000
            if hasattr(im2, 'width') and im2.width and im2.width > maxw:
                new_h = int(im2.height * (maxw / im2.width))
                im2 = im2.resize((maxw, new_h), Image.LANCZOS)
            im2.save(p, format='PNG')
            tmp_files.append(p)
            return p
        except Exception:
            # fallback: try saving without conversion
            try:
                im.save(p)
                tmp_files.append(p)
                return p
            except Exception:
                return None

    variants = []
    # 1) contrast enhance
    try:
        v1 = ImageEnhance.Contrast(img).enhance(1.8)
        variants.append(('contrast_x1.8', v1))
    except Exception:
        pass
    # 2) resize up (2x)
    try:
        v2 = img.resize((img.width*2, img.height*2), Image.LANCZOS)
        variants.append(('resize_x2', v2))
    except Exception:
        pass
    # 3) equalize + median
    try:
        v3 = ImageOps.equalize(img.convert('L')).filter(ImageFilter.MedianFilter(size=3))
        variants.append(('equalize_median', v3))
    except Exception:
        pass
    # 4) simple binarize
    try:
        gs = img.convert('L')
        bw = gs.point(lambda p: 255 if p > 140 else 0)
        variants.append(('binarize_140', bw))
    except Exception:
        pass
    # 5) OpenCV adaptive threshold if available
    if OPENCV_AVAILABLE:
        try:
            import numpy as np
            cv = cv2.imread(filepath)
            gray = cv2.cvtColor(cv, cv2.COLOR_BGR2GRAY)
            th = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 10)
            fd, p = tempfile.mkstemp(suffix='_cv_adapt.png')
            os.close(fd)
            cv2.imwrite(p, th)
            tmp_files.append(p)
            variants.append(('cv_adapt', None, p))
        except Exception:
            pass

    # Try each variant until fields found
    for item in variants:
        if len(item) == 3 and item[2]:
            # pre-made path
            p = item[2]
        else:
            name, im = item
            p = save_tmp(im, name)
        if not p:
            continue
        try:
            lines = mod.extract_lines_from_tesseract(p)
            fields = mod.extract_fields_from_lines(lines)
            if fields.get('total') is not None or fields.get('date') is not None:
                return {'lines': lines, 'fields': fields, 'variant': item[0] if len(item)>=2 else 'cv'}
        except Exception:
            continue

    # if none improved, return last attempt (if any)
    if tmp_files:
        last = tmp_files[-1]
        try:
            lines = mod.extract_lines_from_tesseract(last)
            fields = mod.extract_fields_from_lines(lines)
            return {'lines': lines, 'fields': fields, 'variant': 'last'}
        except Exception:
            pass
    return {'lines': [], 'fields': {'total': None, 'date': None}, 'variant': None}


def load_ground_truth(csv_path):
    gt = {}
    if not csv_path:
        return gt
    with open(csv_path, newline='', encoding='utf-8') as fh:
        rdr = csv.DictReader(fh)
        for r in rdr:
            fn = r.get('filename') or r.get('file')
            if not fn:
                continue
            gt[fn] = {'total': float(r['total']) if r.get('total') else None, 'date': r.get('date')}
    return gt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default='.', help='Directory with images')
    ap.add_argument('--pattern', default='*.png', help='Glob pattern for images')
    ap.add_argument('--mode', choices=('local','http'), default='local')
    ap.add_argument('--endpoint', default='http://127.0.0.1:8001/ocr')
    ap.add_argument('--gt', help='Optional ground-truth CSV file (filename,total,date)')
    ap.add_argument('--out', default='batch_ocr_report.json')
    args = ap.parse_args()

    # Ensure tessdata available for pytesseract: copy por.traineddata if present
    try:
        tess_dest = os.path.join(os.getcwd(), 'paddleocr-service', 'tessdata')
        if not os.path.exists(tess_dest):
            os.makedirs(tess_dest, exist_ok=True)
        root_por = os.path.join(os.getcwd(), 'por.traineddata')
        dest_por = os.path.join(tess_dest, 'por.traineddata')
        if os.path.exists(root_por) and not os.path.exists(dest_por):
            shutil.copy(root_por, dest_por)
        # set TESSDATA_PREFIX so tesseract finds traineddata
        os.environ['TESSDATA_PREFIX'] = tess_dest
    except Exception:
        pass

    files = sorted(glob.glob(os.path.join(args.dir, args.pattern)))
    if not files:
        print('No files found for', os.path.join(args.dir, args.pattern))
        return

    gt = load_ground_truth(args.gt)

    results = []
    if args.mode == 'local':
        root = os.getcwd()
        mod = load_tesseract_app_module(root)
        for f in files:
            print('Processing', f)
            try:
                res = run_local_on_file(mod, f)
                entry = {'file': os.path.relpath(f), 'ok': True, 'lines': res['lines'], 'fields': res['fields']}
            except Exception as e:
                # gather tesseract diagnostic if available
                diag = {}
                try:
                    diag_ok, diag_ver = mod.check_tesseract_binary()
                    local_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'paddleocr-service', 'tesseract-bin', 'tesseract.exe')
                    diag = {'check_ok': bool(diag_ok), 'version': diag_ver, 'local_exists': os.path.exists(local_path), 'which': shutil.which('tesseract'), 'PATH': os.environ.get('PATH','')}
                except Exception:
                    diag = {'diag_error': 'failed to run check_tesseract_binary'}
                entry = {'file': os.path.relpath(f), 'ok': False, 'error': str(e), 'tesseract_diag': diag}

            # If fields missing, try preprocessing variants
            got = entry.get('fields') or {}
            if entry.get('ok') and (got.get('total') is None or got.get('date') is None):
                try:
                    refined = try_preprocessing_variants(mod, f)
                    if refined and refined.get('fields'):
                        # update only if we gained something
                        rf = refined['fields']
                        if rf.get('total') is not None or rf.get('date') is not None:
                            entry['fields'] = rf
                            entry['lines'] = refined.get('lines')
                            entry['refined'] = refined.get('variant')
                except Exception:
                    pass
            # attach GT if available
            bn = os.path.basename(f)
            if bn in gt:
                entry['gt'] = gt[bn]
            results.append(entry)
    else:
        try:
            import requests
        except Exception:
            raise RuntimeError('requests not installed; install with: pip install requests')
        for f in files:
            print('Posting', f)
            with open(f, 'rb') as fh:
                filesp = {'file': (os.path.basename(f), fh, 'application/octet-stream')}
                r = requests.post(args.endpoint, files=filesp, timeout=60)
            try:
                payload = r.json()
            except Exception:
                payload = {'ok': False, 'status_code': r.status_code, 'text': r.text}
            entry = {'file': os.path.relpath(f), 'response': payload}
            bn = os.path.basename(f)
            if bn in gt:
                entry['gt'] = gt[bn]
            results.append(entry)

    # compute simple metrics when ground-truth provided
    stats = {'count': len(results)}
    if any('gt' in r for r in results):
        total_found = 0
        date_found = 0
        total_errors = []
        for r in results:
            if 'gt' not in r:
                continue
            gt_row = r['gt']
            got = r.get('fields') or r.get('response', {}).get('fields')
            if got and got.get('total') is not None:
                total_found += 1
                if gt_row.get('total') is not None:
                    try:
                        total_errors.append(abs(got.get('total') - gt_row.get('total')))
                    except Exception:
                        pass
            if got and got.get('date'):
                if gt_row.get('date'):
                    if got.get('date') == gt_row.get('date'):
                        date_found += 1
        stats['gt_count'] = sum(1 for r in results if 'gt' in r)
        stats['total_found'] = total_found
        stats['date_exact_match'] = date_found
        if total_errors:
            stats['total_mae'] = sum(total_errors)/len(total_errors)
        else:
            stats['total_mae'] = None

    report = {'meta': {'mode': args.mode, 'count': len(results)}, 'results': results, 'stats': stats}
    with open(args.out, 'w', encoding='utf-8') as of:
        json.dump(report, of, ensure_ascii=False, indent=2)

    print('Wrote', args.out)


if __name__ == '__main__':
    main()
