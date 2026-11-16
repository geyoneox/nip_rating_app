import base64
import io
import json
import re
import time
import uuid
import requests
from datetime import datetime, timezone, date

SITE_URL = 'https://insurance.taruvi.cloud'
APP_SLUG = 'nip_rating'
GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/'
DEFAULT_MODEL = 'gemini-2.5-flash'
TEXT_CHUNK_LINES = 80
PDF_CHUNK_PAGES = 8
MAX_CHUNKS = 150
MAX_CHUNK_BYTES = 15 * 1024 * 1024
BATCH = 200
VALUATIONS = ['Replacement Cost', 'Actual Cash Value']
CHILD_TABLES = ['nip_validation_results', 'nip_vehicles', 'nip_im_items', 'nip_drivers']

PROMPT = (
    'You read one tabbed commercial insurance application (or part of one). '
    'Return ONLY a JSON object with these keys. Use null for anything not shown. '
    'Copy values exactly as written; do not guess, correct or invent anything.\n'
    '{"epic_id": str, "policy_number": str, "broker_email": str, '
    '"im_valuation_type": "Replacement Cost" | "Actual Cash Value" | null, '
    '"insured": {"name": str, "mailing_address": str, "city": str, "state": str, "zip": str, "sic": str}, '
    '"vehicles": [{"vin": str, "year": str, "make": str, "model": str, "body_type": str, '
    '"garaging_address": str, "garaging_city": str, "garaging_county": str, "garaging_state": str, "garaging_zip": str, '
    '"radius": str, "cost_new": str, "stated_amount": str, "comp_otc": str, "coll": str, "net_veh_dr_cr": str, "sic": str}], '
    '"im_items": [{"type": str, "manufacturer": str, "description": str, "model": str, "model_year": str, '
    '"serial_no": str, "amount_of_insurance": str}], '
    '"drivers": [{"first_name": str, "middle_name": str, "last_name": str, "date_of_birth": str, '
    '"license_state": str, "license_number": str}]}\n'
    'Include one list entry per row in the document, in order. Keep every value as a string.'
)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def role_names(user_data):
    out = []
    for r in (user_data.get('roles') or []):
        if isinstance(r, str):
            out.append(r)
        elif isinstance(r, dict):
            for k in ('name', 'slug'):
                if r.get(k):
                    out.append(str(r.get(k)))
    return out


def is_admin(user_data):
    if user_data.get('is_cloud_user') or user_data.get('is_superuser'):
        return True
    return any(n in ('nip_admin', 'nip_rating-nip_admin') for n in role_names(user_data))


def service_client(sdk_client):
    try:
        key = sdk_client.secrets.get('NIP_SERVICE_API_KEY')['value']
    except Exception:
        return None
    try:
        from taruvi import Client
        return Client(SITE_URL, APP_SLUG, mode='sync', api_key=key)
    except Exception:
        return None


def rows_of(res):
    if isinstance(res, dict):
        return res.get('data') or []
    return res or []


def user_error(msg):
    return Exception('USER:' + msg)


# ---------------- value helpers ----------------
def txt(v):
    if v is None:
        return None
    s = str(v).strip()
    if s == '' or s.lower() in ('null', 'none'):
        return None
    return s


def to_num(raw):
    s = txt(raw)
    if s is None:
        return None
    t = s.replace('$', '').replace(',', '').replace(' ', '')
    if re.match(r'^-?\d+(\.\d+)?$', t):
        return float(t)
    return None


def to_year(raw):
    s = txt(raw)
    if s is None:
        return None
    m = re.search(r'(19|20)\d{2}', s)
    if m:
        return int(m.group(0))
    return None


def to_radius(raw):
    s = txt(raw)
    if s is None:
        return None
    m = re.search(r'\d+', s.replace(',', ''))
    if m:
        return int(m.group(0))
    return None


def to_date(raw):
    s = txt(raw)
    if s is None:
        return None
    for fmt in ('%Y-%m-%d', '%m/%d/%Y', '%m-%d-%Y', '%m/%d/%y', '%m-%d-%y'):
        try:
            d = datetime.strptime(s, fmt).date()
        except Exception:
            continue
        if d > date.today():
            try:
                d = d.replace(year=d.year - 100)
            except Exception:
                return None
        return d.isoformat()
    return None


def norm_vin(v):
    return ''.join(str(v or '').upper().split())


def is_trailer_row(body_type, model, make):
    # a row is a trailer when BODY_TYPE, MODEL or MAKE contains "trailer"
    for v in (body_type, model, make):
        if 'trailer' in str(v or '').lower():
            return True
    return False


# ---------------- Gemini client interface: call(chunk) -> dict ----------------
def make_real_gemini(sdk_client, model):
    try:
        key = sdk_client.secrets.get('GEMINI_API_KEY')['value']
    except Exception:
        key = None
    if not key:
        raise user_error('Extraction is not available yet: the Gemini key has not been set up.')
    url = GEMINI_BASE + model + ':generateContent'

    def call(chunk):
        parts = [{'text': PROMPT}]
        if chunk['kind'] == 'pdf':
            parts.append({'inline_data': {'mime_type': 'application/pdf', 'data': chunk['data_b64']}})
        else:
            parts.append({'text': chunk['text']})
        body = {
            'contents': [{'role': 'user', 'parts': parts}],
            'generationConfig': {'temperature': 0, 'responseMimeType': 'application/json', 'maxOutputTokens': 65536},
        }
        last = None
        for attempt in range(1, 4):
            try:
                r = requests.post(url, headers={'x-goog-api-key': key, 'Content-Type': 'application/json'}, json=body, timeout=240)
            except Exception:
                last = 'unreachable'
                time.sleep(5 * attempt)
                continue
            if r.status_code in (429, 500, 502, 503, 504):
                last = 'busy'
                time.sleep(8 * attempt)
                continue
            if r.status_code in (401, 403):
                raise user_error('Extraction failed: the Gemini key was not accepted.')
            if r.status_code >= 400:
                raise user_error('Extraction failed: the AI service rejected a section of the file.')
            data = r.json()
            cands = data.get('candidates') or []
            if not cands:
                raise user_error('Extraction failed: the AI service returned no answer for a section of the file.')
            if cands[0].get('finishReason') == 'MAX_TOKENS':
                raise user_error('Extraction failed: a section of the file was too large to read.')
            ps = (cands[0].get('content') or {}).get('parts') or []
            return parse_json_text(''.join([p.get('text') or '' for p in ps]))
        if last == 'busy':
            raise user_error('Extraction failed: the AI service is busy. Please try again in a few minutes.')
        raise user_error('Extraction failed: the AI service could not be reached. Please try again.')
    return {'call': call}


def make_fake_gemini(params):
    responses = params.get('fake_responses') or []
    fail_at = params.get('fake_fail_chunk')
    state = {'n': 0, 'seen': []}

    def call(chunk):
        i = state['n']
        state['n'] = i + 1
        state['seen'].append(chunk['kind'] + ':' + str(len(chunk.get('text') or chunk.get('data_b64') or '')))
        if fail_at is not None and int(fail_at) == i:
            raise user_error('Extraction failed: simulated AI failure.')
        if not responses:
            return {}
        if i < len(responses):
            return responses[i]
        return {}
    return {'call': call, 'state': state}


def parse_json_text(t):
    s = (t or '').strip()
    if s.startswith('```'):
        s = re.sub(r'^```[a-zA-Z]*', '', s).strip()
        if s.endswith('```'):
            s = s[:-3].strip()
    try:
        d = json.loads(s)
    except Exception:
        raise user_error('Extraction failed: the AI answer could not be read. Please try again.')
    if isinstance(d, list):
        d = {'vehicles': d}
    if not isinstance(d, dict):
        raise user_error('Extraction failed: the AI answer could not be read. Please try again.')
    return d


# ---------------- file to chunks ----------------
def cell_text(c):
    if c is None:
        return ''
    if isinstance(c, float) and c == int(c):
        return str(int(c))
    if isinstance(c, datetime):
        return c.date().isoformat()
    if isinstance(c, date):
        return c.isoformat()
    return str(c).strip()


def sheet_rows_to_chunks(name, rows):
    chunks = []
    if not rows:
        return chunks
    header = rows[0]
    i = 0
    while i < len(rows):
        part = rows[i:i + TEXT_CHUNK_LINES]
        text = 'Sheet: ' + str(name) + '\nColumn headings (first row of the sheet): ' + header + '\nRows (cells separated by " | "):\n' + '\n'.join(part)
        chunks.append({'kind': 'text', 'text': text})
        i = i + TEXT_CHUNK_LINES
    return chunks


def excel_chunks(file_bytes, ext):
    sheets = []
    if ext == 'xlsx':
        try:
            from openpyxl import load_workbook
            wb = load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
            for ws in wb.worksheets:
                rows = []
                for row in ws.iter_rows(values_only=True):
                    cells = [cell_text(c) for c in row]
                    while cells and cells[-1] == '':
                        cells.pop()
                    if cells:
                        rows.append(' | '.join(cells))
                sheets.append((ws.title, rows))
        except Exception:
            raise user_error('This Excel file could not be read. Please check that it opens in Excel and upload it again.')
    else:
        try:
            import pandas as pd
            frames = pd.read_excel(io.BytesIO(file_bytes), sheet_name=None, header=None)
            for nm in frames:
                df = frames[nm]
                rows = []
                for rec in df.values.tolist():
                    cells = [cell_text(None if (isinstance(c, float) and c != c) else c) for c in rec]
                    while cells and cells[-1] == '':
                        cells.pop()
                    if cells:
                        rows.append(' | '.join(cells))
                sheets.append((nm, rows))
        except Exception:
            raise user_error('This .xls file could not be read. Please save it as .xlsx in Excel and upload it again.')
    chunks = []
    for sh in sheets:
        chunks = chunks + sheet_rows_to_chunks(sh[0], sh[1])
    return chunks


def pdf_chunks(file_bytes):
    try:
        from pypdf import PdfReader, PdfWriter
        reader = PdfReader(io.BytesIO(file_bytes))
        if reader.is_encrypted:
            raise user_error('This PDF is password protected. Please remove the password and upload it again.')
        n = len(reader.pages)
        chunks = []
        i = 0
        while i < n:
            w = PdfWriter()
            j = i
            while j < min(n, i + PDF_CHUNK_PAGES):
                w.add_page(reader.pages[j])
                j = j + 1
            buf = io.BytesIO()
            w.write(buf)
            data = buf.getvalue()
            if len(data) > MAX_CHUNK_BYTES:
                raise user_error('A section of this PDF is too large to read. Please upload a smaller or lower resolution file.')
            chunks.append({'kind': 'pdf', 'data_b64': base64.b64encode(data).decode('ascii')})
            i = i + PDF_CHUNK_PAGES
        return chunks
    except Exception as e:
        if str(e).startswith('USER:'):
            raise e
        raise user_error('This PDF could not be read. Please check that it opens normally and upload it again.')


# ---------------- row builders ----------------
def build_rows(merged, run, owner_id):
    now = now_iso()
    vehicles = []
    seen = set()
    n = 0
    for v in merged['vehicles']:
        n = n + 1
        vin = norm_vin(v.get('vin')) or None
        dup = False
        if vin:
            if vin in seen:
                dup = True
            seen.add(vin)
        bt = txt(v.get('body_type'))
        vehicles.append({
            'id': str(uuid.uuid4()), 'run_id': run['id'], 'owner_id': owner_id, 'row_number': n,
            'vin': vin, 'make': txt(v.get('make')), 'model': txt(v.get('model')), 'body_type': bt,
            'year_raw': txt(v.get('year')), 'year': to_year(v.get('year')),
            'garaging_address': txt(v.get('garaging_address')), 'garaging_city': txt(v.get('garaging_city')),
            'garaging_county': txt(v.get('garaging_county')), 'garaging_state': txt(v.get('garaging_state')),
            'garaging_zip': txt(v.get('garaging_zip')),
            'radius_raw': txt(v.get('radius')), 'radius': to_radius(v.get('radius')),
            'cost_new_raw': txt(v.get('cost_new')), 'cost_new': to_num(v.get('cost_new')),
            'stated_amount_raw': txt(v.get('stated_amount')), 'stated_amount': to_num(v.get('stated_amount')),
            'comp_otc': txt(v.get('comp_otc')), 'coll': txt(v.get('coll')), 'net_veh_dr_cr': txt(v.get('net_veh_dr_cr')),
            'sic': txt(v.get('sic')),
            'is_trailer': is_trailer_row(bt, txt(v.get('model')), txt(v.get('make'))), 'is_duplicate': dup, 'edited_fields': {},
            'created_at': now, 'updated_at': now,
        })
    items = []
    n = 0
    for it in merged['im_items']:
        n = n + 1
        items.append({
            'id': str(uuid.uuid4()), 'run_id': run['id'], 'owner_id': owner_id, 'row_number': n,
            'type': txt(it.get('type')), 'manufacturer': txt(it.get('manufacturer')), 'description': txt(it.get('description')),
            'model': txt(it.get('model')), 'model_year': txt(it.get('model_year')), 'serial_no': txt(it.get('serial_no')),
            'amount_of_insurance_raw': txt(it.get('amount_of_insurance')), 'amount_of_insurance': to_num(it.get('amount_of_insurance')),
            'is_duplicate': False, 'edited_fields': {}, 'created_at': now, 'updated_at': now,
        })
    drivers = []
    n = 0
    for d in merged['drivers']:
        n = n + 1
        drivers.append({
            'id': str(uuid.uuid4()), 'run_id': run['id'], 'owner_id': owner_id, 'row_number': n,
            'first_name': txt(d.get('first_name')), 'middle_name': txt(d.get('middle_name')), 'last_name': txt(d.get('last_name')),
            'date_of_birth_raw': txt(d.get('date_of_birth')), 'date_of_birth': to_date(d.get('date_of_birth')),
            'license_state': txt(d.get('license_state')), 'license_number': txt(d.get('license_number')),
            'is_duplicate': False, 'edited_fields': {}, 'created_at': now, 'updated_at': now,
        })
    return vehicles, items, drivers


def merge_results(results):
    merged = {'header': {}, 'insured': {}, 'vehicles': [], 'im_items': [], 'drivers': []}
    for r in results:
        for k in ('epic_id', 'policy_number', 'broker_email', 'im_valuation_type'):
            if k not in merged['header'] and txt(r.get(k)) is not None:
                merged['header'][k] = txt(r.get(k))
        ins = r.get('insured')
        if isinstance(ins, dict):
            for k in ('name', 'mailing_address', 'city', 'state', 'zip', 'sic'):
                if k not in merged['insured'] and txt(ins.get(k)) is not None:
                    merged['insured'][k] = txt(ins.get(k))
        for key in ('vehicles', 'im_items', 'drivers'):
            lst = r.get(key)
            if isinstance(lst, list):
                for x in lst:
                    if isinstance(x, dict):
                        merged[key].append(x)
    return merged


def delete_children(db, run_id):
    for table in CHILD_TABLES:
        loops = 0
        while loops < 200:
            loops = loops + 1
            ids = [r['id'] for r in rows_of(db.database.from_(table).filter('run_id', 'eq', run_id).page_size(500).execute())]
            if not ids:
                break
            db.database.delete(table, ids=ids)


def insert_batches(db, table, rows):
    i = 0
    while i < len(rows):
        db.database.create(table, rows[i:i + BATCH])
        i = i + BATCH


def still_active(db, run_id):
    cur = rows_of(db.database.from_('nip_runs').filter('id', 'eq', run_id).execute())
    if not cur:
        return False
    return cur[0].get('lifecycle_status') == 'active' and cur[0].get('extraction_status') == 'processing'


def fail_run(db, run_id, msg):
    try:
        now = now_iso()
        db.database.update('nip_runs', record_id=run_id, data={'extraction_status': 'failed', 'extraction_error': msg, 'last_progress_at': now, 'updated_at': now})
    except Exception:
        log('extract: could not record failure run_id=%s' % run_id, level='error')


def main(params, user_data, sdk_client):
    params = params or {}
    caller = str(user_data.get('id'))
    run_id = str(params.get('run_id') or '')
    if not run_id:
        return {'success': False, 'error': 'run_id is required.'}
    test_mode = params.get('test_mode') == 'fake' and bool(user_data.get('is_cloud_user'))

    db = service_client(sdk_client)
    if db is None:
        if not is_admin(user_data):
            return {'success': False, 'error': 'Extraction is not available yet: the service credential has not been set up.'}
        db = sdk_client

    runs = rows_of(db.database.from_('nip_runs').filter('id', 'eq', run_id).execute())
    if not runs:
        return {'success': False, 'error': 'This run was not found.'}
    run = runs[0]
    owner_id = str(run.get('owner_id'))
    if not (is_admin(user_data) or owner_id == caller):
        return {'success': False, 'error': 'You do not have permission to extract this run.'}
    if run.get('lifecycle_status') != 'active':
        return {'success': False, 'error': 'This run is being deleted.'}
    if run.get('extraction_status') != 'processing':
        return {'success': False, 'error': 'This run is not waiting for extraction.'}

    try:
        model = DEFAULT_MODEL
        try:
            cfg = rows_of(db.database.from_('ref_rules').filter('rule_key', 'eq', 'gemini_model').execute())
            if cfg and txt(cfg[0].get('value_text')):
                model = txt(cfg[0].get('value_text'))
        except Exception:
            model = DEFAULT_MODEL
        gemini = make_fake_gemini(params) if test_mode else make_real_gemini(sdk_client, model)

        # ---- read the uploaded file ----
        try:
            raw = db.storage.from_('nip-uploads').download(run.get('file_ref'))
        except Exception:
            raise user_error('The uploaded file could not be found. Please upload it again.')
        if isinstance(raw, dict):
            raw = raw.get('content') or raw.get('data')
        if raw is None or len(raw) == 0:
            raise user_error('The uploaded file is empty. Please upload it again.')
        stype = str(run.get('source_type') or '').lower()
        if stype == 'pdf':
            chunks = pdf_chunks(raw)
        else:
            chunks = excel_chunks(raw, stype)
        if not chunks:
            raise user_error('The file has no readable content.')
        if len(chunks) > MAX_CHUNKS:
            raise user_error('The file is too large to extract in one run. Please split it and upload the parts separately.')

        total = len(chunks)
        db.database.update('nip_runs', record_id=run_id, data={'extraction_progress': {'processed': 0, 'total': total}, 'extraction_error': None, 'last_progress_at': now_iso(), 'updated_at': now_iso()})

        # ---- call Gemini one section at a time ----
        results = []
        idx = 0
        for ch in chunks:
            results.append(gemini['call'](ch))
            idx = idx + 1
            now = now_iso()
            db.database.update('nip_runs', record_id=run_id, data={'extraction_progress': {'processed': idx, 'total': total}, 'last_progress_at': now, 'updated_at': now})
            if not still_active(db, run_id):
                log('extract stopped run_id=%s (run deleted or no longer processing)' % run_id, level='info')
                return {'success': False, 'stopped': True}

        merged = merge_results(results)
        vehicles, items, drivers = build_rows(merged, run, owner_id)

        # ---- replace any earlier rows, then save ----
        delete_children(db, run_id)
        insert_batches(db, 'nip_vehicles', vehicles)
        insert_batches(db, 'nip_im_items', items)
        insert_batches(db, 'nip_drivers', drivers)

        ins = merged['insured']
        hd = merged['header']
        upd = {'extraction_status': 'complete', 'extraction_error': None, 'extraction_progress': {'processed': total, 'total': total}, 'last_progress_at': now_iso(), 'updated_at': now_iso()}
        for col, val in (('insured_name', ins.get('name')), ('insured_mailing_address', ins.get('mailing_address')), ('insured_city', ins.get('city')),
                         ('insured_state', ins.get('state')), ('insured_zip', ins.get('zip')), ('insured_sic', ins.get('sic')),
                         ('epic_id', hd.get('epic_id')), ('policy_number', hd.get('policy_number')), ('broker_email', hd.get('broker_email'))):
            if val is not None:
                upd[col] = val
        if hd.get('im_valuation_type') in VALUATIONS:
            upd['im_valuation_type'] = hd.get('im_valuation_type')
        db.database.update('nip_runs', record_id=run_id, data=upd)
        log('extract complete run_id=%s chunks=%d vehicles=%d im=%d drivers=%d' % (run_id, total, len(vehicles), len(items), len(drivers)), level='info')
        out = {'success': True, 'run_id': run_id, 'counts': {'vehicles': len(vehicles), 'im_items': len(items), 'drivers': len(drivers)}}
        if test_mode:
            out['fake_seen'] = gemini['state']['seen']
        return out
    except Exception as e:
        m = str(e)
        if m.startswith('USER:'):
            msg = m[5:]
        else:
            log('extract failed run_id=%s stage=unexpected' % run_id, level='error')
            msg = 'Extraction failed. Please try again, or upload the file again.'
        fail_run(db, run_id, msg)
        return {'success': False, 'error': msg}
