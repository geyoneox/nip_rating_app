import base64
import io
import json
import re
import time
import requests

# Reads ONE part of an uploaded application (a few PDF pages, or a block of spreadsheet rows) with Gemini and returns
# what it found in the agreed shape (INSURED, PREMISES, AUTO, IM, DRIVER). Started (async) by nip_extract_worker, which
# runs several parts at the same time and merges them. Saves nothing itself.
#
# Per part: one call; then, for AUTO, up to N repair calls for VINs that are on the pages (found by a text scan) but
# missing from the answer; a part of more than one page that still has under the coverage limit is treated as failed
# and halved, up to a set depth. A part that still fails returns success with failed_pages, so the run goes on.
# Without a Gemini key the part returns a fixed sample (mock mode) so the rest of the app can be tested.

GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/'
DEFAULT_MODEL = 'gemini-2.5-flash'
TEMPERATURE = 0.1
CALL_TIMEOUT = 600
MAX_INLINE_BYTES = 15 * 1024 * 1024
VIN_RE = re.compile(r'[A-HJ-NPR-Z0-9]{17}')

BASE_PROMPT = (
    'You read part of one tabbed commercial insurance application. Return ONLY a JSON object. Use only the keys listed. '
    'Copy values exactly as written on the page; do not guess, correct or invent anything; use null when a value is not shown. '
    'Keep every value as a string. Include one entry per row of the schedule, in the order shown.\n'
    'Rules: AUTO rows come only from vehicle schedule tables (for example ACORD 127/129 vehicle descriptions or a vehicle list), '
    'never from notes, remarks or questionnaire answers that mention a vehicle or part of a VIN. IM rows come only from an '
    'equipment or inland marine schedule. DRIVER rows come only from a driver schedule or list of people who drive company '
    'vehicles; never list owners, officers, contacts, signers or employees from workers compensation, included/excluded, '
    'contact or signature sections. INSURED is the named insured or applicant. PREMISES are the listed insured or garaging '
    'locations, one entry per location and building.\n'
)
SHAPES = {
    'INSURED': '"INSURED": {"NAME": str, "MAILING_ADDRESS": str, "CITY": str, "STATE": str, "ZIP": str, "IM_VALUATION_TYPE": str, "SIC": str, "EPIC_ID": str, "POLICY_NUMBER": str, "BROKER_EMAIL": str}',
    'PREMISES': '"PREMISES": [{"LOC": str, "BLD": str, "STREET": str, "CITY": str, "COUNTY": str, "STATE": str, "ZIP": str}]',
    'AUTO': '"AUTO": [{"V_I_N": str, "YEAR": str, "MAKE": str, "MODEL": str, "BODY_TYPE": str, "GARAGING_ADDRESS": str, "CITY": str, "COUNTY": str, "STATE": str, "ZIP": str, "RADIUS": str, "COST_NEW": str, "STATED_AMOUNT": str, "COMP_OTC": str, "COLL": str, "NET_VEH_DR_CR": str, "SIC": str}]',
    'IM': '"IM": [{"MANUFACTURER": str, "TYPE": str, "DESCRIPTION": str, "MODEL": str, "MODEL_YEAR": str, "ID_SERIAL_NO": str, "AMOUNT_OF_INSURANCE": str}]',
    'DRIVER': '"DRIVER": [{"FirstName": str, "MiddleName": str, "LastName": str, "DATE_OF_BIRTH": str, "STATE_LIC": str, "DRIVERS_LICENSE_NUMBER": str}]',
}
ORDER = ['INSURED', 'PREMISES', 'AUTO', 'IM', 'DRIVER']

MOCK_RESULT = {
    'INSURED': {'NAME': 'Mock Insured LLC', 'MAILING_ADDRESS': '100 Sample St', 'CITY': 'Springfield', 'STATE': 'IL', 'ZIP': '62701', 'IM_VALUATION_TYPE': 'Actual Cash Value'},
    'PREMISES': [{'LOC': '1', 'BLD': '1', 'STREET': '100 Sample St', 'CITY': 'Springfield', 'COUNTY': 'Sangamon', 'STATE': 'IL', 'ZIP': '62701'}],
    'AUTO': [
        {'V_I_N': '1FTFW1E50JFA00001', 'YEAR': '2018', 'MAKE': 'FORD', 'MODEL': 'F-150', 'BODY_TYPE': 'PICKUP', 'CITY': 'Springfield', 'STATE': 'IL', 'ZIP': '62701', 'RADIUS': '50', 'COST_NEW': '45000', 'COMP_OTC': '1000', 'COLL': '1000'},
        {'V_I_N': '1GCUYDED5LZ000002', 'YEAR': '2020', 'MAKE': 'CHEVROLET', 'MODEL': 'SILVERADO', 'BODY_TYPE': 'PICKUP', 'GARAGING_ADDRESS': '200 Yard Rd', 'CITY': 'Springfield', 'STATE': 'IL', 'ZIP': '62702', 'RADIUS': '100', 'COST_NEW': '52000', 'STATED_AMOUNT': '1000', 'COMP_OTC': '1000', 'COLL': '1000'},
    ],
    'IM': [{'MANUFACTURER': 'JOHN DEERE', 'TYPE': 'LOADER', 'DESCRIPTION': 'Skid steer loader', 'MODEL': '332G', 'MODEL_YEAR': '2019', 'ID_SERIAL_NO': '1T0332GMKKF000003', 'AMOUNT_OF_INSURANCE': '65000'}],
    'DRIVER': [{'FirstName': 'Sam', 'LastName': 'Sample', 'DATE_OF_BIRTH': '1980-04-01', 'STATE_LIC': 'IL', 'DRIVERS_LICENSE_NUMBER': 'S12345678901'}],
}


def rows_of(res):
    if isinstance(res, dict):
        return res.get('data') or []
    return res or []


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


def part_error(msg):
    # the function sandbox does not allow class statements, so part failures are tagged plain exceptions
    return Exception('PART:' + msg)


# ---------------- JSON parsing ----------------
def close_brackets(s):
    stack = []
    in_str = False
    esc = False
    for c in s:
        if in_str:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c in '{[':
            stack.append('}' if c == '{' else ']')
        elif c in '}]':
            if stack:
                stack.pop()
    if in_str:
        return None
    return s + ''.join(reversed(stack))


def balanced_object(s):
    start = s.find('{')
    if start < 0:
        return None
    depth = 0
    in_str = False
    esc = False
    i = start
    while i < len(s):
        c = s[i]
        if in_str:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == '{':
            depth = depth + 1
        elif c == '}':
            depth = depth - 1
            if depth == 0:
                return s[start:i + 1]
        i = i + 1
    return None


def parse_answer(text):
    """Fenced block, else the balanced {...} object; a truncated answer is cut back to the last } that parses."""
    s = (text or '').strip()
    m = re.search(r'```(?:json)?\s*(.*?)```', s, re.S)
    if m:
        s = m.group(1).strip()
    cand = balanced_object(s)
    if cand:
        try:
            d = json.loads(cand)
            if isinstance(d, dict):
                return d
        except Exception:
            pass
    start = s.find('{')
    if start < 0:
        return None
    body = s[start:]
    tries = 0
    pos = len(body)
    while tries < 400:
        pos = body.rfind('}', 0, pos)
        if pos < 0:
            break
        tries = tries + 1
        fixed = close_brackets(body[:pos + 1])
        if fixed:
            try:
                d = json.loads(fixed)
                if isinstance(d, dict):
                    return d
            except Exception:
                pass
    return None


# ---------------- Gemini ----------------
def gemini_key(sdk_client):
    try:
        key = sdk_client.secrets.get('GEMINI_API_KEY')['value']
        if isinstance(key, dict):
            key = key.get('api_key')
        return key or None
    except Exception:
        return None


def make_caller(key, model):
    url = GEMINI_BASE + model + ':generateContent'

    def call(prompt, chunk):
        parts = [{'text': prompt}]
        if chunk['kind'] == 'pdf':
            parts.append({'inline_data': {'mime_type': 'application/pdf', 'data': chunk['data_b64']}})
        else:
            parts.append({'text': chunk['text']})
        gen = {'temperature': TEMPERATURE, 'responseMimeType': 'application/json', 'maxOutputTokens': 65536}
        if 'flash' in str(model).lower():
            gen['thinkingConfig'] = {'thinkingBudget': 0}
        body = {'contents': [{'role': 'user', 'parts': parts}], 'generationConfig': gen}
        last = 'unreachable'
        for attempt in range(1, 5):
            try:
                r = requests.post(url, headers={'x-goog-api-key': key, 'Content-Type': 'application/json'}, json=body, timeout=CALL_TIMEOUT)
            except Exception:
                last = 'unreachable'
                time.sleep(4 * attempt)
                continue
            if r.status_code in (429, 500, 502, 503, 504):
                last = 'busy'
                time.sleep(6 * attempt)
                continue
            if r.status_code in (401, 403):
                raise part_error('the Gemini key was not accepted')
            if r.status_code >= 400:
                raise part_error('the AI service rejected this part')
            try:
                data = r.json()
            except Exception:
                last = 'busy'
                continue
            cands = data.get('candidates') or []
            if not cands:
                raise part_error('the AI service returned no answer')
            ps = (cands[0].get('content') or {}).get('parts') or []
            d = parse_answer(''.join([p.get('text') or '' for p in ps]))
            if d is None:
                raise part_error('the AI answer could not be read')
            return d
        raise part_error('the AI service is busy' if last == 'busy' else 'the AI service could not be reached')
    return call


# ---------------- prompt ----------------
def build_prompt(tabs, pages, page_count, section_note, row_range, only_vins):
    tabs = [t for t in ORDER if t in (tabs or ORDER)]
    p = BASE_PROMPT + 'Return this JSON: {' + ', '.join([SHAPES[t] for t in tabs]) + '}\n'
    if section_note:
        p = p + section_note + '\n'
    if pages:
        human = page_label(pages)
        p = p + ('You are receiving only pages %s of %d of the original file. Extract only what you see on these pages; '
                 'a table that continues across these pages is one table; return the same JSON shape.\n' % (human, page_count))
    if row_range:
        p = p + 'Extract only rows %d to %d of the vehicle table on this page (count rows from the top of the table).\n' % (row_range[0], row_range[1])
    if only_vins:
        p = p + 'Extract ONLY the AUTO rows for these VINs, nothing else: ' + ', '.join(only_vins) + '\n'
    return p


def page_label(pages):
    pages = sorted(set([int(x) + 1 for x in pages]))
    runs = []
    for x in pages:
        if runs and runs[-1][1] == x - 1:
            runs[-1][1] = x
        else:
            runs.append([x, x])
    return ', '.join([('%d' % a) if a == b else ('%d to %d' % (a, b)) for a, b in runs])


# ---------------- pages ----------------
def cut_pdf(reader, pages):
    from pypdf import PdfWriter
    w = PdfWriter()
    for k in pages:
        w.add_page(reader.pages[int(k)])
    buf = io.BytesIO()
    w.write(buf)
    data = buf.getvalue()
    if len(data) > MAX_INLINE_BYTES:
        raise part_error('these pages are too large to send in one call')
    return {'kind': 'pdf', 'data_b64': base64.b64encode(data).decode('ascii')}


def norm_vin(v):
    s = ''.join(str(v or '').upper().split())
    if len(s) == 17:
        s = s.replace('O', '0').replace('I', '1')
    return s


def vins_in(result):
    out = set()
    for row in (result.get('AUTO') or []):
        if isinstance(row, dict):
            v = norm_vin(row.get('V_I_N'))
            if v:
                out.add(v)
    return out


def merge_into(base, extra):
    for k in ORDER:
        if k == 'INSURED':
            ins = extra.get('INSURED')
            if isinstance(ins, dict):
                cur = base.setdefault('INSURED', {})
                for f in ins:
                    if (cur.get(f) in (None, '')) and ins.get(f) not in (None, ''):
                        cur[f] = ins.get(f)
        else:
            lst = extra.get(k)
            if isinstance(lst, list):
                base.setdefault(k, [])
                base[k] = base[k] + [x for x in lst if isinstance(x, dict)]
    return base


# ---------------- one part ----------------
def extract(ctx, pages, expected, depth, failed):
    """Returns the merged result for these pages. Failed page ranges are appended to `failed`."""
    try:
        chunk = cut_pdf(ctx['reader'], pages) if ctx['reader'] is not None else {'kind': 'text', 'text': ctx['text']}
        prompt = build_prompt(ctx['tabs'], pages if ctx['reader'] is not None else None, ctx['page_count'], ctx['section_note'], ctx['row_range'], None)
        result = ctx['call'](prompt, chunk)
        ctx['calls'] = ctx['calls'] + 1
        if expected and 'AUTO' in ctx['tabs']:
            want = set(expected)
            for rnd in range(ctx['repair_rounds']):
                missing = sorted(want - vins_in(result))
                if not missing:
                    break
                extra = ctx['call'](build_prompt(['AUTO'], pages if ctx['reader'] is not None else None, ctx['page_count'], ctx['section_note'], None, missing), chunk)
                ctx['calls'] = ctx['calls'] + 1
                ctx['repairs'] = ctx['repairs'] + 1
                merge_into(result, {'AUTO': extra.get('AUTO') or []})
            got = len(want & vins_in(result))
            if len(pages or []) > 1 and got < ctx['min_coverage'] * len(want):
                raise part_error('only %d of %d VINs on these pages came back' % (got, len(want)))
        return result
    except Exception as e:
        if not str(e).startswith('PART:'):
            raise
        reason = str(e)[5:]
        if ctx['reader'] is not None and len(pages) > 1 and depth < ctx['max_depth']:
            mid = len(pages) // 2
            left, right = pages[:mid], pages[mid:]
            res = {}
            for half in (left, right):
                exp = [v for v in (expected or []) if any(v in (ctx['page_vins'].get(str(p)) or []) for p in half)]
                merge_into(res, extract(ctx, half, exp, depth + 1, failed))
            return res
        failed.append({'pages': page_label(pages) if pages else 'spreadsheet rows', 'reason': reason})
        return {}


def main(params, user_data, sdk_client):
    params = params or {}
    run_id = str(params.get('run_id') or '')
    if not run_id:
        return {'success': False, 'error': 'run_id is required.'}
    db = sdk_client  # caller's own access; own-row table policies apply
    t0 = time.time()
    try:
        runs = rows_of(db.database.from_('nip_runs').filter('id', 'eq', run_id).execute())
        if not runs:
            return {'success': False, 'error': 'This run was not found.'}
        run = runs[0]
        if not (is_admin(user_data) or str(run.get('owner_id')) == str(user_data.get('id'))):
            return {'success': False, 'error': 'You do not have permission to extract this run.'}

        key = gemini_key(sdk_client)
        if not key:
            # mock mode: a fixed sample on the first part only, so the run completes with known rows
            out = MOCK_RESULT if int(params.get('part') or 0) == 0 else {}
            return {'success': True, 'part': params.get('part'), 'mock': True, 'result': out, 'failed': [], 'calls': 0}

        ctx = {
            'call': make_caller(key, str(params.get('model') or DEFAULT_MODEL)),
            'tabs': params.get('tabs') or ORDER,
            'page_count': int(params.get('page_count') or 0),
            'section_note': params.get('section_note'),
            'row_range': params.get('row_range'),
            'repair_rounds': int(params.get('repair_rounds') or 2),
            'min_coverage': float(params.get('min_coverage') or 0.85),
            'max_depth': int(params.get('max_depth') or 3),
            'page_vins': params.get('page_vins') or {},
            'reader': None, 'text': None, 'calls': 0, 'repairs': 0,
        }
        pages = [int(x) for x in (params.get('pages') or [])]
        if params.get('text') is not None:
            ctx['text'] = str(params.get('text'))
        else:
            try:
                raw = db.storage.from_('nip-uploads').download(run.get('file_ref'))
            except Exception:
                return {'success': False, 'error': 'The uploaded file could not be found. Please upload it again.'}
            if isinstance(raw, dict):
                raw = raw.get('content') or raw.get('data')
            from pypdf import PdfReader
            ctx['reader'] = PdfReader(io.BytesIO(raw))
        failed = []
        result = extract(ctx, pages, params.get('expected_vins') or [], 0, failed)
        return {'success': True, 'part': params.get('part'), 'result': result, 'failed': failed,
                'calls': ctx['calls'], 'repairs': ctx['repairs'], 'seconds': round(time.time() - t0, 1)}
    except Exception as e:
        log('extract part crashed run_id=%s part=%s kind=%s' % (run_id, params.get('part'), str(type(e))[:80]), level='error')
        return {'success': False, 'part': params.get('part'), 'error': 'This part could not be read.', 'retryable': True}
