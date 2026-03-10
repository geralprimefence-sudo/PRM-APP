from flask import Flask, request, jsonify
from flask_cors import CORS
import tempfile
import os
import shutil
import subprocess

try:
    import cv2
    import numpy as np
    OPENCV_AVAILABLE = True
except Exception:
    OPENCV_AVAILABLE = False

try:
    import pytesseract
    from PIL import Image, ImageFilter, ImageOps
    TESSERACT_AVAILABLE = True
except Exception:
    TESSERACT_AVAILABLE = False

# If pytesseract is available, prefer a bundled local binary and write startup log
if TESSERACT_AVAILABLE:
    try:
        local_path = os.path.join(os.path.dirname(__file__), 'tesseract-bin', 'tesseract.exe')
        binary_set = None
        if os.path.exists(local_path):
            try:
                pytesseract.pytesseract.tesseract_cmd = local_path
                binary_set = local_path
            except Exception:
                binary_set = None
        else:
            w = shutil.which('tesseract')
            if w:
                try:
                    pytesseract.pytesseract.tesseract_cmd = w
                    binary_set = w
                except Exception:
                    binary_set = None
        try:
            with open(os.path.join(os.path.dirname(__file__), 'tess_startup.txt'), 'w', encoding='utf-8') as sf:
                sf.write(f'python_libs:{TESSERACT_AVAILABLE}\nbinary_cmd:{binary_set}\nPATH:{os.environ.get("PATH","")}\n')
        except Exception:
            pass
    except Exception:
        pass

app = Flask(__name__)
# Enable CORS (configurable via CORS_ORIGINS env var, default '*')
cors_origins = os.environ.get('CORS_ORIGINS', '*')
CORS(app, origins=cors_origins, supports_credentials=True)


def check_tesseract_binary():
    # First check for a local bundled binary inside the project
    local_path = os.path.join(os.path.dirname(__file__), 'tesseract-bin', 'tesseract.exe')
    if os.path.exists(local_path):
        try:
            p = subprocess.run([local_path, '--version'], capture_output=True, text=True, timeout=5)
            if p.returncode == 0:
                try:
                    import pytesseract as _pt
                    _pt.pytesseract.tesseract_cmd = local_path
                except Exception:
                    pass
                return True, p.stdout.splitlines()[0]
        except Exception:
            return True, local_path

    # Fallback to system PATH
    path = shutil.which('tesseract')
    if path:
        try:
            p = subprocess.run(['tesseract', '--version'], capture_output=True, text=True, timeout=5)
            if p.returncode == 0:
                try:
                    import pytesseract as _pt
                    _pt.pytesseract.tesseract_cmd = 'tesseract'
                except Exception:
                    pass
                return True, p.stdout.splitlines()[0]
        except Exception:
            return True, path
    # Common Windows install locations
    common_paths = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ]
    for cp in common_paths:
        if os.path.exists(cp):
            try:
                p = subprocess.run([cp, '--version'], capture_output=True, text=True, timeout=5)
                if p.returncode == 0:
                    try:
                        import pytesseract as _pt
                        _pt.pytesseract.tesseract_cmd = cp
                    except Exception:
                        pass
                    return True, p.stdout.splitlines()[0]
            except Exception:
                return True, cp
    return False, None


def deskew_cv2(image):
    coords = np.column_stack(np.where(image > 0))
    if coords.shape[0] < 10:
        return image
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle
    (h, w) = image.shape[:2]
    M = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
    rotated = cv2.warpAffine(image, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return rotated


def preprocess_receipt(image_path):
    # Prefer OpenCV pipeline if available for better results
    if OPENCV_AVAILABLE:
        img = cv2.imread(image_path)
        if img is None:
            return image_path
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        gray = cv2.equalizeHist(gray)
        th = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY, 25, 11
        )
        den = cv2.medianBlur(th, 3)
        deskewed = deskew_cv2(den)
        preproc_path = image_path + '_tess_preproc.png'
        cv2.imwrite(preproc_path, deskewed)
        return preproc_path
    else:
        # Lightweight Pillow-based preprocessing when OpenCV is not installed
        pil = Image.open(image_path)
        pil = pil.convert('L')
        pil = ImageOps.equalize(pil)
        pil = pil.filter(ImageFilter.MedianFilter(size=3))
        # simple threshold
        pil = pil.point(lambda p: 255 if p > 128 else 0)
        preproc_path = image_path + '_tess_preproc.png'
        pil.save(preproc_path)
        return preproc_path


def extract_lines_from_tesseract(img_path):
    # Try multiple PSM modes and pick the best by a simple heuristic
    pil = Image.open(img_path)

    def _lines_from_data(data_dict):
        lines_local = []
        current_line_num = -1
        current_text = []
        for i, line_num in enumerate(data_dict.get('line_num', [])):
            text = data_dict.get('text', [])[i] or ''
            if line_num != current_line_num:
                if current_text:
                    joined = ' '.join([t for t in current_text if t.strip()])
                    if joined:
                        lines_local.append(joined)
                current_text = [text]
                current_line_num = line_num
            else:
                current_text.append(text)
        if current_text:
            joined = ' '.join([t for t in current_text if t.strip()])
            if joined:
                lines_local.append(joined)
        return lines_local

    psm_candidates = [6, 11, 3, 1]
    best = None
    best_score = -1
    best_psm = None
    best_lines = []

    def score_lines(lines_list):
        # heuristic: count numeric-looking tokens and date-like patterns
        import re
        score = 0
        text_all = '\n'.join(lines_list)
        nums = re.findall(r"\d+[\.,]?\d*", text_all)
        score += len(nums)
        # bonus for date-like occurrences
        score += len(re.findall(r"\b\d{1,2}[\-/\.\s]\d{1,2}[\-/\.\s]\d{2,4}\b", text_all)) * 3
        # bonus for TOTAL-like keywords
        score += sum(2 for l in lines_list if any(k in l.upper() for k in ("TOTAL", "IVA", "VALOR", "MONTANTE")))
        return score

    for psm in psm_candidates:
        try:
            config = f'--psm {psm}'
            try:
                data = pytesseract.image_to_data(pil, output_type=pytesseract.Output.DICT, config=config, lang='por')
            except Exception:
                data = pytesseract.image_to_data(pil, output_type=pytesseract.Output.DICT, config=config)
            lines_try = _lines_from_data(data)
            sc = score_lines(lines_try)
            if sc > best_score:
                best_score = sc
                best = data
                best_psm = psm
                best_lines = lines_try
        except Exception:
            continue

    # fallback to a single run if nothing selected
    if best is None:
        try:
            data = pytesseract.image_to_data(pil, output_type=pytesseract.Output.DICT, lang='por')
        except Exception:
            data = pytesseract.image_to_data(pil, output_type=pytesseract.Output.DICT)
        best_lines = _lines_from_data(data)
        best_psm = None

    # return lines and psm used for debugging
    return {'lines': best_lines, 'psm': best_psm}


def parse_amount(text):
    import re
    if not text:
        return None
    # Fix common OCR substitution errors before parsing
    def fix_ocr_digits(s: str) -> str:
        subs = {
            'O': '0', 'o': '0', 'l': '1', 'I': '1', 'S': '5', 's': '5', 'B': '8', '€': '', '£': '', '$': ''
        }
        for k, v in subs.items():
            s = s.replace(k, v)
        return s
    text = fix_ocr_digits(text)
    # find numbers like 12.34 or 1,234.56 or 12,34
    # accept optional currency symbol and numbers with 1-3 groupings
    candidates = re.findall(r"[€$£]?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2}|\d+[.,]\d{3}|\d+", text)
    if not candidates:
        return None
    # prefer the last candidate (often total at bottom)
    s = candidates[-1]
    # normalize number formats to a dot-decimal float string
    # Heuristic: if there's a dot with three digits after it and no comma, treat dot as thousands separator
    if '.' in s and ',' not in s and re.search(r"\.\d{3}$", s):
        s_norm = s.replace('.', '')
    elif '.' in s and ',' in s:
        # determine which is decimal separator by position (decimal usually last)
        if s.rfind('.') < s.rfind(','):
            # format like 1.234,56 -> remove dots, convert comma to dot
            s_norm = s.replace('.', '').replace(',', '.')
        else:
            # format like 1,234.56 -> remove commas
            s_norm = s.replace(',', '')
    elif ',' in s:
        s_norm = s.replace(',', '.')
    else:
        s_norm = s
    try:
        return float(s_norm)
    except Exception:
        try:
            return float(s_norm.replace(' ', ''))
        except Exception:
            return None


def parse_date(text):
    import re
    if not text:
        return None
    # normalize common OCR misreads
    def fix_ocr_date(s: str) -> str:
        s = s.replace('O', '0').replace('o', '0').replace('l', '1').replace('I', '1')
        s = s.replace('\\', '/').replace('-', '/').replace('.', '/')
        return s
    text = fix_ocr_date(text)
    # common patterns: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
    patterns = [r"(\d{4})[\/](\d{1,2})[\/](\d{1,2})", r"(\d{1,2})[\/](\d{1,2})[\/](\d{4})", r"(\d{1,2})[\/](\d{1,2})[\/](\d{2})"]
    for p in patterns:
        m = re.search(p, text)
        if m:
            if len(m.groups()) == 3:
                g = m.groups()
                # determine if first is year
                if len(g[0]) == 4:
                    y, mo, d = g[0], g[1], g[2]
                else:
                    d, mo, y = g[0], g[1], g[2]
                try:
                    y = int(y); mo = int(mo); d = int(d)
                    # handle two-digit years
                    if y < 100:
                        if y <= 50:
                            y = 2000 + y
                        else:
                            y = 1900 + y
                    # sanity: if year appears far in future, try to normalize by
                    # finding the closest plausible year (digit-wise) within a reasonable range
                    import datetime
                    cy = datetime.datetime.now().year
                    if y > cy + 2:
                        # search candidates in [1900, cy+2] minimizing digit Hamming distance
                        ys = range(1900, cy + 3)
                        s_y = f"{y:04d}"
                        best = None
                        best_h = None
                        for c in ys:
                            cs = f"{c:04d}"
                            # compute Hamming distance on digits
                            h = sum(1 for a, b in zip(s_y, cs) if a != b)
                            if best_h is None or h < best_h or (h == best_h and abs(c - y) < abs(best - y)):
                                best = c
                                best_h = h
                        # accept normalization only if reasonable (<=2 digit changes)
                        if best is not None and best_h is not None and best_h <= 2:
                            y = best
                        else:
                            return None
                    return f"{y:04d}-{mo:02d}-{d:02d}"
                except Exception:
                    continue
    # fallback: look for year-month-like
    m = re.search(r"(19|20)\d{2}", text)
    if m:
        return m.group(0)
    # try dateutil.parser if available for fuzzy parsing
    try:
        from dateutil import parser as _p
        dt = _p.parse(text, fuzzy=True, dayfirst=True)
        return f"{dt.year:04d}-{dt.month:02d}-{dt.day:02d}"
    except Exception:
        pass
    return None


def extract_fields_from_lines(lines):
    # lines: list of strings from top->bottom
    text = "\n".join(lines)

    # Initialize
    total = None
    date = None
    supplier = None
    supplier_nif = None
    vat_percent = None
    vat_amount = None
    total_ex_vat = None

    # 1) Try to detect supplier and NIF from top lines
    top_lines = [l.strip() for l in lines[:8] if l.strip()]
    # NIF: 9 digits (Portuguese), sometimes with spaces/dots
    import re
    for i, l in enumerate(top_lines):
        m = re.search(r"\b(\d{9})\b", l.replace('.', '').replace(' ', ''))
        if m:
            supplier_nif = m.group(1)
            # supplier likely on same line or previous line
            if i > 0:
                supplier = top_lines[i-1]
            else:
                supplier = top_lines[i]
            break
    # if no NIF, pick longest top line that looks like a company name
    if not supplier:
        candidate = None
        for l in top_lines:
            # ignore generic words
            if any(k in l.upper() for k in ("FACTUR", "RECIBO", "NIF", "MORADA", "DATA", "TEL", "TAX")):
                continue
            if candidate is None or len(l) > len(candidate):
                candidate = l
        supplier = candidate

    # 2) Detect total (prefer bottom-up with keywords)
    for line in reversed(lines):
        l = line.upper()
        if any(k in l for k in ("TOTAL", "VALOR", "MONTANTE", "TOTAL A PAGAR", "LIQUIDO A PAGAR", "TOTAL COM IVA")):
            amt = parse_amount(line)
            if amt is not None:
                total = amt
                break
    if total is None:
        total = parse_amount(text)

    # 3) Detect VAT lines: look for IVA/VAT and percentage or amounts
    vat_patterns = []
    for line in lines:
        u = line.upper()
        if 'IVA' in u or 'VAT' in u or '%' in u:
            vat_patterns.append(line)
    # examine VAT candidate lines for percent and amount
    def parse_vat_line(s):
        p_pct = None
        p_amt = None
        # percent like 23% or 23,00 %
        m_pct = re.search(r"(\d{1,2}(?:[.,]\d)?)\s*%", s)
        if m_pct:
            p_pct = float(m_pct.group(1).replace(',', '.'))
        # amount using parse_amount
        p_amt = parse_amount(s)
        return p_pct, p_amt

    for vline in vat_patterns:
        pp, pa = parse_vat_line(vline)
        if pp is not None or pa is not None:
            # prefer percent if present
            if pp is not None:
                vat_percent = pp
            if pa is not None:
                vat_amount = pa

    # 4) Try detect subtotal/base amount (lines with 'BASE', 'SUBTOTAL')
    base = None
    for line in reversed(lines):
        u = line.upper()
        if any(k in u for k in ("BASE", "SUBTOTAL", "SUB-TOTAL", "BASE IMPON")):
            b = parse_amount(line)
            if b is not None:
                base = b
                break

    # 5) Compute missing values if possible
    # If we have total and vat_amount we can compute base
    if total is not None and vat_amount is not None and base is None:
        total_ex_vat = round(max(0.0, total - vat_amount), 2)
    # If we have base and vat_percent, compute vat_amount
    if base is not None and vat_percent is not None and vat_amount is None:
        vat_amount = round(base * (vat_percent / 100.0), 2)
        total = round(base + vat_amount, 2)
        total_ex_vat = base
    # If we have total and vat_percent but not vat_amount nor base
    if total is not None and vat_percent is not None and vat_amount is None and total_ex_vat is None:
        # assume total includes VAT -> compute base = total / (1 + p/100)
        try:
            denom = 1.0 + (vat_percent / 100.0)
            base_est = total / denom
            vat_amount = round(total - base_est, 2)
            total_ex_vat = round(base_est, 2)
        except Exception:
            pass

    # If still missing total_ex_vat but have base or can infer
    if total_ex_vat is None and base is not None:
        total_ex_vat = base
    if total_ex_vat is None and total is not None and vat_amount is not None:
        total_ex_vat = round(total - vat_amount, 2)

    # 6) Detect date by scanning lines
    for line in lines:
        if any(k in line.upper() for k in ("DATA", "DATE", "DT")):
            d = parse_date(line)
            if d:
                date = d
                break
    if date is None:
        # fallback: search whole text
        date = parse_date(text)

    return {
        'supplier': supplier,
        'supplier_nif': supplier_nif,
        'total': total,
        'total_ex_vat': total_ex_vat,
        'vat_amount': vat_amount,
        'vat_percent': vat_percent,
        'date': date
    }


@app.route('/ocr', methods=['POST'])
def run_ocr():
    # If an API key is configured in the environment, require it via the X-API-Key header
    api_key_env = os.environ.get('API_KEY')
    if api_key_env:
        provided = request.headers.get('X-API-Key') or request.args.get('api_key')
        if provided != api_key_env:
            return jsonify({'ok': False, 'error': 'unauthorized'}), 401

    # verify that pytesseract/Pillow are present and binary is available
    if not TESSERACT_AVAILABLE:
        return jsonify({'ok': False, 'error': 'pytesseract or Pillow not installed in the Python environment.'}), 500
    # capture detection info inside this process for debugging
    binary_ok = False
    version = None
    try:
        binary_ok, version = check_tesseract_binary()
        dbg_lines = []
        dbg_lines.append(f'check_tesseract_binary -> {binary_ok} | {version}')
        local_path = os.path.join(os.path.dirname(__file__), 'tesseract-bin', 'tesseract.exe')
        dbg_lines.append(f'local_exists={os.path.exists(local_path)}')
        which = shutil.which('tesseract')
        dbg_lines.append(f'which={which}')
        dbg_lines.append('PATH=' + os.environ.get('PATH', ''))
        try:
            with open(os.path.join(os.path.dirname(__file__), 'tess_debug.txt'), 'w', encoding='utf-8') as df:
                df.write('\n'.join(dbg_lines))
        except Exception:
            pass
    except Exception as _dbg:
        try:
            with open(os.path.join(os.path.dirname(__file__), 'tess_debug.txt'), 'a', encoding='utf-8') as df:
                df.write('\nEXC:' + str(_dbg))
        except Exception:
            pass

    if not binary_ok:
        # Try cloud OCR fallback (Azure Form Recognizer) if configured
        try:
            from .azure_form_recognizer import analyze_receipt
            endpoint = os.environ.get('AZURE_FR_ENDPOINT')
            key = os.environ.get('AZURE_FR_KEY')
            if endpoint and key:
                # proceed to use Azure for this image
                pass
            else:
                return jsonify({'ok': False, 'error': "tesseract is not installed or it's not in your PATH.", 'local_exists': os.path.exists(local_path), 'which': shutil.which('tesseract'), 'path': os.environ.get('PATH','')}), 500
        except Exception as e:
            return jsonify({'ok': False, 'error': "tesseract is not installed or it's not in your PATH.", 'exception': str(e), 'local_exists': os.path.exists(local_path), 'which': shutil.which('tesseract'), 'path': os.environ.get('PATH','')}), 500

    if 'file' not in request.files:
        return jsonify({'ok': False, 'error': 'missing file'}), 400

    f = request.files['file']
    if not f.filename:
        return jsonify({'ok': False, 'error': 'empty filename'}), 400

    suffix = os.path.splitext(f.filename)[1] or '.bin'
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp_path = tmp.name
    tmp.close()

    try:
        f.save(tmp_path)
        preproc = preprocess_receipt(tmp_path)
        # If binary missing but Azure configured, use cloud OCR
        if not binary_ok:
            try:
                res = analyze_receipt(preproc)
                if not res.get('ok'):
                    return jsonify({'ok': False, 'error': 'Azure Form Recognizer call failed', 'detail': res}), 500
                return jsonify({'ok': True, 'source': 'azure', 'fields': res.get('fields'), 'raw': res.get('raw')})
            except Exception as exc:
                return jsonify({'ok': False, 'error': 'Azure OCR error', 'detail': str(exc)}), 500

            res = extract_lines_from_tesseract(preproc)
            lines = res.get('lines') if isinstance(res, dict) else res
            psm_used = res.get('psm') if isinstance(res, dict) else None
            text = '\n'.join(lines)
            # extract structured fields (total, date)
            try:
                fields = extract_fields_from_lines(lines)
            except Exception:
                fields = {'total': None, 'date': None}
            return jsonify({'ok': True, 'text': text, 'lines': lines, 'ocr_raw_lines': lines, 'tesseract_psm': psm_used, 'fields': fields})
    except Exception as exc:
        return jsonify({'ok': False, 'error': str(exc)}), 500
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        try:
            if 'preproc' in locals() and preproc != tmp_path:
                os.unlink(preproc)
        except OSError:
            pass


if __name__ == '__main__':
    # quick debug
    app.run(host='0.0.0.0', port=8082)


@app.route('/health', methods=['GET'])
def health():
    py_ok = TESSERACT_AVAILABLE
    binary_ok, version = check_tesseract_binary()
    return jsonify({'python_libs': py_ok, 'tesseract_binary': bool(binary_ok), 'version': version})


@app.route('/debug/check', methods=['GET'])
def debug_check():
    try:
        ok, ver = check_tesseract_binary()
        local_path = os.path.join(os.path.dirname(__file__), 'tesseract-bin', 'tesseract.exe')
        return jsonify({'ok': ok, 'version': ver, 'local_exists': os.path.exists(local_path), 'which': shutil.which('tesseract'), 'PATH': os.environ.get('PATH','')}), 200
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500
