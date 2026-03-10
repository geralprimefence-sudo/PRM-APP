import importlib.util
import os
import pytest


def load_tesseract_app():
    base = os.path.dirname(os.path.dirname(__file__))
    path = os.path.join(base, 'tesseract_app.py')
    spec = importlib.util.spec_from_file_location('tesseract_app', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope='module')
def ta():
    return load_tesseract_app()


def test_parse_amount_simple(ta):
    assert ta.parse_amount('TOTAL 12.34') == 12.34


def test_parse_amount_comma_decimal(ta):
    assert ta.parse_amount('Total: 1.234,56') == 1234.56


def test_parse_amount_thousands_dot(ta):
    assert ta.parse_amount('VALOR 2.345.678,90') == 2345678.90


def test_parse_amount_no_match(ta):
    assert ta.parse_amount('NO NUMBERS HERE') is None


def test_parse_date_ddmmyyyy(ta):
    assert ta.parse_date('DATA 09/03/2026') == '2026-03-09'


def test_parse_date_yyyy_mm_dd(ta):
    assert ta.parse_date('2026-03-09') == '2026-03-09'


def test_extract_fields_from_lines(ta):
    lines = ['LOJA X', 'RECIBO', 'TOTAL 12.34', 'DATA 09/03/2026']
    f = ta.extract_fields_from_lines(lines)
    assert f['total'] == 12.34
    assert f['date'] == '2026-03-09'
