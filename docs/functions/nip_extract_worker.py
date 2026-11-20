import io
import re
import time
import uuid
from datetime import datetime, timezone, date

# Extraction orchestrator for one run.
# 1. Reads the PDF bookmarks and plans passes: one per tab variant (AUTO / IM / DRIVER, base and revised) plus the
#    ACORD pages for INSURED and PREMISES. A tab without a bookmark gets one full-document pass (only its rows are
#    used); a PDF with no recognised bookmark gets one full-document pass for everything. Patterns and numbers come
#    from ref_rules (extract_section_patterns, extract_settings, gemini_model).
# 2. Cuts each pass into parts (5 pages when a pass is over 20 pages; halved while a part has more than 40 VINs in
#    its text; a page with more than 60 VINs is read in row batches of 40) and runs the parts at the same time, each
#    as an async nip_extract_part call.
# 3. Keeps the variant with more rows (tie: more filled fields), cleans the rows in code, replaces the run's earlier
#    rows and records the plan, the choice, timings and any unread pages on the run (extraction_progress).

SITE_URL = 'https://insurance.taruvi.cloud'
APP_SLUG = 'nip_rating'
DEFAULT_MODEL = 'gemini-2.5-flash'
PART_FN = 'nip_extract_part'
TEXT_CHUNK_LINES = 80
MAX_PARTS = 200
MAX_PARALLEL = 10
PART_TIMEOUT_SECONDS = 1500
RUN_TIMEOUT_SECONDS = 5400
POLL_SECONDS = 3
PART_ATTEMPTS = 2
BATCH = 200
OTHER_WORKER_SECONDS = 600
VALUATIONS = ['Replacement Cost', 'Actual Cash Value']
CHILD_TABLES = ['nip_validation_results', 'nip_vehicles', 'nip_im_items', 'nip_drivers']
TABS = ['AUTO', 'IM', 'DRIVER']
ALL_TABS = ['INSURED', 'PREMISES', 'AUTO', 'IM', 'DRIVER']
PLACEHOLDERS = ['NEED', 'NEEDED', 'NA', 'NONE', 'UNKNOWN', 'NOTAVAILABLE', 'NOTAPPLICABLE', 'TBD', 'PENDING']
VIN_RE = re.compile(r'[A-HJ-NPR-Z0-9]{17}')

DEFAULT_SETTINGS = {'split_over_pages': 20, 'chunk_pages': 5, 'max_vins_per_chunk': 40, 'page_row_batch_over': 60,
                    'row_batch': 40, 'parallel': 6, 'repair_rounds': 2, 'min_coverage': 0.85, 'max_depth': 3,
                    'full_pass_pages': 8}
DEFAULT_PATTERNS = {
    'acord_prefix': 'ACORD',
    'revised_word': 'REVISED',
    'order': ['DRIVER', 'AUTO', 'IM'],
    # for these tabs a _WKST bookmark is a worksheet copy (often a full asset inventory): it is read only when the
    # plain section gives no rows
    'worksheet_fallback_tabs': ['IM'],
    'tabs': {
        'AUTO': ['VEHICLE SCHEDULE', 'VEH SCHED', 'VH SCHED', 'VEHICLES', 'AUTO', 'BA SECTION', 'BUSINESS AUTO'],
        'IM': ['IM', 'INLAND MARINE', 'EQUIPMENT LIST', 'CONTRACTORS EQUIPMENT', 'EQUIPMENT FLOATER', 'SCHEDULED EQUIPMENT', 'IM SECTION'],
        'DRIVER': ['DRIVER LIST', 'DRIVERS LIST', 'DRIVER SCHEDULE', 'DRIVERS SCHEDULE'],
    },
}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def seconds_since(ts_text):
    try:
        d = datetime.fromisoformat(str(ts_text).replace('Z', '+00:00'))
    except Exception:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - d).total_seconds()


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


def is_trailer_row(body_type, model, make):
    # a row is a trailer when BODY_TYPE, MODEL or MAKE contains "trailer"
    for v in (body_type, model, make):
        if 'trailer' in str(v or '').lower():
            return True
    return False


# ---------------- spreadsheet to text parts ----------------
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


# ---------------- settings from ref_rules ----------------
def load_settings(db):
    model = DEFAULT_MODEL
    settings = dict(DEFAULT_SETTINGS)
    patterns = DEFAULT_PATTERNS
    try:
        for r in rows_of(db.database.from_('ref_rules').filter('rule_key', 'in', ['gemini_model', 'extract_settings', 'extract_section_patterns']).execute()):
            k = r.get('rule_key')
            if k == 'gemini_model' and txt(r.get('value_text')):
                model = txt(r.get('value_text'))
            elif k == 'extract_settings' and isinstance(r.get('value_json'), dict):
                for f in r['value_json']:
                    settings[f] = r['value_json'][f]
            elif k == 'extract_section_patterns' and isinstance(r.get('value_json'), dict) and isinstance(r['value_json'].get('tabs'), dict):
                patterns = r['value_json']
    except Exception:
        pass
    return model, settings, patterns


# ---------------- Step 1: bookmarks and section plan ----------------
def norm_title(t):
    s = str(t or '').upper().replace('_', ' ').replace('-', ' ')
    return ' '.join(s.split())


def match_title(title, patterns):
    """('ACORD', False) | (tab, is_revised) | (None, False)"""
    t = norm_title(title)
    words = t.split(' ')
    acord = str(patterns.get('acord_prefix') or 'ACORD').upper()
    # a title that starts with ACORD, or names an ACORD form, is used only for INSURED and PREMISES
    if t.startswith(acord) or acord in words:
        return 'ACORD', False
    rev_word = str(patterns.get('revised_word') or 'REVISED').upper()
    revised = rev_word in words
    core = ' '.join([w for w in words if w not in (rev_word, 'WKST')])
    order = patterns.get('order') or list((patterns.get('tabs') or {}).keys())
    for tab in order:
        for p in (patterns.get('tabs') or {}).get(tab) or []:
            p = norm_title(p)
            if core == p or core.startswith(p + ' ') or core.endswith(' ' + p):
                return tab, revised
    return None, False


def read_outline(reader):
    marks = []

    def walk(items):
        for it in items:
            if isinstance(it, list):
                walk(it)
                continue
            try:
                pg = reader.get_destination_page_number(it)
            except Exception:
                pg = None
            if pg is not None:
                marks.append({'title': str(it.title or '').strip(), 'page': int(pg)})
    try:
        walk(reader.outline)
    except Exception:
        return []
    return sorted(marks, key=lambda m: m['page'])


def plan_passes(marks, n, patterns):
    """Passes: {name, tab, variant, tabs, pages, titles}. Plus a description of the bookmarks found."""
    ranges = []
    for i, m in enumerate(marks):
        if not (0 <= m['page'] < n):
            continue
        nxt = n
        for m2 in marks[i + 1:]:
            if m2['page'] > m['page']:
                nxt = m2['page']
                break
        kind, revised = match_title(m['title'], patterns)
        ranges.append({'title': m['title'], 'kind': kind, 'revised': revised, 'first': m['page'], 'last': nxt - 1})
    ws_tabs = patterns.get('worksheet_fallback_tabs')
    if ws_tabs is None:
        ws_tabs = DEFAULT_PATTERNS['worksheet_fallback_tabs']
    groups = {}
    for r in ranges:
        if not r['kind']:
            continue
        variant = 'revised' if r['revised'] else 'base'
        if r['kind'] in ws_tabs and 'WKST' in norm_title(r['title']).split(' ') and not r['revised']:
            variant = 'worksheet'
        key = (r['kind'], variant)
        g = groups.setdefault(key, {'pages': [], 'titles': []})
        g['pages'] = g['pages'] + list(range(r['first'], r['last'] + 1))
        g['titles'].append(r['title'])
    passes = []
    found_tabs = set([k[0] for k in groups if k[0] in TABS])
    if not found_tabs:
        return [{'name': 'whole document', 'tab': 'ALL', 'variant': 'base', 'tabs': ALL_TABS, 'pages': list(range(n)), 'titles': []}], ranges
    for tab in TABS:
        for variant in ('base', 'revised', 'worksheet'):
            g = groups.get((tab, variant))
            if g:
                pages = sorted(set(g['pages']))
                passes.append({'name': '%s %s' % (tab, variant), 'tab': tab, 'variant': variant, 'tabs': [tab], 'pages': pages, 'titles': g['titles']})
    if ('ACORD', 'base') in groups:
        g = groups[('ACORD', 'base')]
        passes.append({'name': 'ACORD', 'tab': 'ACORD', 'variant': 'base', 'tabs': ['INSURED', 'PREMISES'], 'pages': sorted(set(g['pages'])), 'titles': g['titles']})
    missing = [t for t in TABS if t not in found_tabs]
    if ('ACORD', 'base') not in groups:
        missing = missing + ['INSURED', 'PREMISES']
    if missing:
        # a tab with no bookmark: one full-document pass; only that tab's rows are used from it
        passes.append({'name': 'full document for ' + ', '.join(missing), 'tab': 'MISSING', 'variant': 'base', 'tabs': missing, 'pages': list(range(n)), 'titles': []})
    return passes, ranges


def page_vins(reader, pages):
    out = {}
    for p in pages:
        try:
            t = (reader.pages[p].extract_text() or '').upper()
        except Exception:
            t = ''
        seen = []
        for v in VIN_RE.findall(t):
            if v not in seen and any(c.isdigit() for c in v) and any(c.isalpha() for c in v):
                seen.append(v)
        out[p] = seen
    return out


def runs_of(pages):
    out = []
    for p in pages:
        if out and out[-1][-1] == p - 1:
            out[-1].append(p)
        else:
            out.append([p])
    return out


def label(pages):
    return ', '.join([('%d' % (r[0] + 1)) if len(r) == 1 else ('%d to %d' % (r[0] + 1, r[-1] + 1)) for r in runs_of(sorted(pages))])


def split_pass(ps, vins_by_page, settings):
    """Cut a pass into parts: chunks of 5 pages when the pass is over 20 pages, halved while a part has more than
    40 VINs; a single page with more than 60 VINs becomes row batches of 40."""
    pages = ps['pages']
    over = int(settings['split_over_pages'])
    size = int(settings['chunk_pages'])
    max_v = int(settings['max_vins_per_chunk'])
    chunks = []
    if len(pages) > over:
        for r in runs_of(pages):
            for i in range(0, len(r), size):
                chunks.append(r[i:i + size])
    else:
        chunks = [pages]
    check_vins = 'AUTO' in ps['tabs']

    def vins_of(ch):
        out = []
        for p in ch:
            for v in vins_by_page.get(p) or []:
                if v not in out:
                    out.append(v)
        return out
    parts = []
    queue = list(chunks)
    while queue:
        ch = queue.pop(0)
        vs = vins_of(ch) if check_vins else []
        if check_vins and len(vs) > max_v and len(ch) > 1:
            mid = len(ch) // 2
            queue.insert(0, ch[mid:])
            queue.insert(0, ch[:mid])
            continue
        if check_vins and len(ch) == 1 and len(vs) > int(settings['page_row_batch_over']):
            b = int(settings['row_batch'])
            for a in range(0, len(vs), b):
                parts.append({'pages': ch, 'expected': vs[a:a + b], 'row_range': [a + 1, a + b]})
            continue
        parts.append({'pages': ch, 'expected': vs, 'row_range': None})
    return parts


def section_note(ps, n):
    if ps['tab'] in ('ALL', 'MISSING'):
        return None
    if ps['tab'] == 'ACORD':
        return 'The selected section is the ACORD forms (pages %s). Return only INSURED and PREMISES from them.' % label(ps['pages'])
    rev = ' A revised section is authoritative; ignore the older one.' if ps['variant'] == 'revised' else ''
    return ('The selected section is %s (%s), pages %s of %d.%s If these pages are outside that section, return an empty '
            'array for %s.' % (ps['tab'], ', '.join(ps['titles']), label(ps['pages']), n, rev, ps['tab']))


# ---------------- running parts at the same time ----------------
def task_id_of(started):
    for path in (('invocation', 'celery_task_id'), ('data', 'invocation', 'celery_task_id')):
        cur = started
        try:
            for k in path:
                cur = cur[k]
            if cur:
                return cur
        except Exception:
            continue
    return None


def read_task(sdk_client, task_id):
    """('pending', None) | ('done', function_output) | ('crashed', None)"""
    try:
        g = sdk_client.functions.get_result(task_id)
    except Exception:
        return 'pending', None
    d = g.get('data') if isinstance(g, dict) and isinstance(g.get('data'), dict) else g
    if not isinstance(d, dict):
        return 'pending', None
    st = str(d.get('status') or '').upper()
    if st == 'SUCCESS':
        res = d.get('result')
        out = res.get('result') if isinstance(res, dict) and 'result' in res else res
        return ('done', out) if isinstance(out, dict) else ('crashed', None)
    if st in ('FAILURE', 'REVOKED'):
        return 'crashed', None
    return 'pending', None


def run_parts(sdk_client, db, run_id, token, parts, parallel):
    """Runs every part, `parallel` at a time. Returns ({index: output}, [failed pages]) or None when the run was
    stopped. A part that fails twice is recorded as unread pages; it never stops the other parts."""
    total = len(parts)
    queue = list(range(total))
    attempts = {}
    running = {}
    done = {}
    failed = []
    t0 = time.time()
    last_saved = -1
    last_check = time.time()
    while queue or running:
        while queue and len(running) < parallel:
            i = queue.pop(0)
            attempts[i] = attempts.get(i, 0) + 1
            tid = None
            try:
                tid = task_id_of(sdk_client.functions.execute(PART_FN, params=parts[i]['params'], is_async=True))
            except Exception:
                tid = None
            if not tid:
                if attempts[i] < PART_ATTEMPTS:
                    queue.append(i)
                else:
                    failed.append({'pages': parts[i]['label'], 'pass': parts[i]['pass'], 'reason': 'could not be started'})
                    done[i] = None
                continue
            running[i] = {'task': tid, 'at': time.time()}
        time.sleep(POLL_SECONDS)
        for i in list(running.keys()):
            state, out = read_task(sdk_client, running[i]['task'])
            if state == 'pending' and time.time() - running[i]['at'] <= PART_TIMEOUT_SECONDS:
                continue
            del running[i]
            if state == 'done' and out.get('success'):
                done[i] = out
                for f in (out.get('failed') or []):
                    failed.append({'pages': f.get('pages'), 'pass': parts[i]['pass'], 'reason': f.get('reason')})
                continue
            if state == 'done' and not out.get('retryable'):
                raise user_error(out.get('error') or 'Extraction failed while reading the file.')
            if attempts.get(i, 0) < PART_ATTEMPTS:
                log('extract part %d retry run_id=%s' % (i, run_id), level='warning')
                queue.append(i)
                continue
            failed.append({'pages': parts[i]['label'], 'pass': parts[i]['pass'], 'reason': 'timed out' if state == 'pending' else 'could not be read'})
            done[i] = None
        if len(done) != last_saved:
            save_progress(db, run_id, token, len(done), total)
            last_saved = len(done)
        if time.time() - last_check > 15:
            last_check = time.time()
            if not still_active(db, run_id, token):
                return None
        if time.time() - t0 > RUN_TIMEOUT_SECONDS:
            for i in list(running.keys()) + queue:
                failed.append({'pages': parts[i]['label'], 'pass': parts[i]['pass'], 'reason': 'took too long'})
            break
    return done, failed


# ---------------- Step 5: clean-up (code, not prompt) ----------------
def clean_vin(v):
    s = ''.join(str(v or '').upper().split())
    if len(s) == 17:
        s = s.replace('O', '0').replace('I', '1')
    return s or None


def alnum(v):
    return re.sub(r'[^A-Z0-9]', '', str(v or '').upper())


def is_placeholder(v):
    k = alnum(v)
    return (not k) or k in PLACEHOLDERS


def filled(row):
    return len([k for k in row if txt(row.get(k)) is not None])


def is_empty(row):
    return filled(row) == 0


def is_summary_row(v):
    # no VIN, cost, stated amount or address: a line from a summary list, not a schedule row (the original app skips these)
    return (not clean_vin(v.get('V_I_N')) and not txt(v.get('COST_NEW')) and not txt(v.get('STATED_AMOUNT'))
            and not txt(v.get('GARAGING_ADDRESS')) and not txt(v.get('CITY')))


def sys_edit(edited, col, original, value, why, now):
    edited[col] = {'original': original, 'edited': value, 'edited_by': 'system (' + why + ')', 'edited_at': now}


def premises_key(p):
    return '|'.join([alnum(p.get('STREET')), alnum(p.get('CITY')), alnum(p.get('STATE')), alnum(p.get('ZIP'))[:5], alnum(p.get('LOC')), alnum(p.get('BLD'))])


def clean_premises(lst):
    out = []
    seen = set()
    for p in lst:
        if not isinstance(p, dict) or not txt(p.get('STREET')):
            continue
        k = premises_key(p)
        if k in seen:
            continue
        seen.add(k)
        out.append(p)
    return out


def pick_premises(v, premises):
    # city + state + ZIP, then county + state, then city + state, then the first premises
    if not premises:
        return None
    city, state, zp, county = alnum(v.get('CITY')), alnum(v.get('STATE')), alnum(v.get('ZIP'))[:5], alnum(v.get('COUNTY'))
    tests = []
    if city and state and zp:
        tests.append(lambda p: alnum(p.get('CITY')) == city and alnum(p.get('STATE')) == state and alnum(p.get('ZIP'))[:5] == zp)
    if county and state:
        tests.append(lambda p: alnum(p.get('COUNTY')) == county and alnum(p.get('STATE')) == state)
    if city and state:
        tests.append(lambda p: alnum(p.get('CITY')) == city and alnum(p.get('STATE')) == state)
    for t in tests:
        for p in premises:
            if t(p):
                return p
    return premises[0]


def plausible_dob(raw):
    iso = to_date(raw)
    if not iso:
        return None
    try:
        d = date.fromisoformat(iso)
    except Exception:
        return None
    age = (date.today() - d).days / 365.25
    return iso if 14 <= age <= 100 else None


def only_a_word(v):
    # the VIN cell holds a word with no digits (COMPOSITE, N/A) and the row has nothing else: not a vehicle
    vin = alnum(v.get('V_I_N'))
    if any(c.isdigit() for c in vin):
        return False
    return len([k for k in v if k != 'V_I_N' and txt(v.get(k)) is not None]) == 0


def clean_auto(rows):
    out = []
    seen = set()
    for v in rows:
        if not isinstance(v, dict) or is_empty(v) or is_summary_row(v) or only_a_word(v):
            continue
        k = '|'.join([str(txt(v.get(f)) or '').upper() for f in sorted(v.keys())])
        if k in seen:  # exact duplicate row (all fields equal, case-insensitive)
            continue
        seen.add(k)
        out.append(v)
    return out


def clean_im(rows):
    out = []
    by_serial = {}
    for it in rows:
        if not isinstance(it, dict) or is_empty(it):
            continue
        s = txt(it.get('ID_SERIAL_NO'))
        if s and not is_placeholder(s):
            k = alnum(s)
            if k in by_serial:
                # duplicate serial: keep the row with more filled fields
                j = by_serial[k]
                if filled(it) > filled(out[j]):
                    out[j] = it
                continue
            by_serial[k] = len(out)
        out.append(it)
    return out


def clean_drivers(rows):
    out = []
    seen = set()
    for d in rows:
        if not isinstance(d, dict):
            continue
        name = ' '.join([str(txt(d.get(f)) or '') for f in ('FirstName', 'LastName')]).strip()
        lic = alnum(d.get('DRIVERS_LICENSE_NUMBER'))
        dob_raw = txt(d.get('DATE_OF_BIRTH'))
        dob = plausible_dob(dob_raw) if dob_raw else None
        if dob_raw and not dob:
            continue  # a DOB that is not a real date, or gives an age outside 14 to 100
        if not (name or len(lic) >= 4):
            continue
        if not (lic or dob):
            continue
        k = ('L:' + lic) if lic else ('N:' + alnum(name) + '|' + str(dob) + '|' + alnum(d.get('STATE_LIC')))
        if k in seen:
            continue
        seen.add(k)
        out.append(d)
    return out


def merge_insured(results):
    ins = {}
    for r in results:
        src = r.get('INSURED') if isinstance(r, dict) else None
        if isinstance(src, dict):
            for f in src:
                if txt(ins.get(f)) is None and txt(src.get(f)) is not None:
                    ins[f] = txt(src.get(f))
    return ins


def pick_variant(tab, base, revised):
    """The variant with more rows wins; a tie goes to more non-empty fields."""
    if revised is None:
        return 'base'
    if base is None:
        return 'revised'
    a = (len(base), sum([filled(x) for x in base]))
    b = (len(revised), sum([filled(x) for x in revised]))
    return 'revised' if b > a else 'base'


def build_rows(auto, im, drv, premises, run, owner_id):
    """Table rows. Calculated fields (class code, OCN, deductibles) are left to the rating step. Changes made by the
    clean-up are recorded in edited_fields with the original extracted value."""
    now = now_iso()
    notes = {'vin_fixed': 0, 'stated_cleared': 0, 'stated_basis': 0, 'garaging_from_premises': 0}
    vehicles = []
    seen = set()
    for n, v in enumerate(auto, start=1):
        edited = {}
        raw_vin = ''.join(str(v.get('V_I_N') or '').upper().split()) or None
        vin = clean_vin(v.get('V_I_N'))
        if raw_vin and vin and vin != raw_vin:
            sys_edit(edited, 'vin', raw_vin, vin, 'VIN cleanup', now)
            notes['vin_fixed'] = notes['vin_fixed'] + 1
        dup = bool(vin and vin in seen)
        if vin:
            seen.add(vin)
        stated_raw = txt(v.get('STATED_AMOUNT'))
        stated = to_num(stated_raw)
        if stated is not None and stated <= 10000 and stated in (to_num(v.get('COLL')), to_num(v.get('COMP_OTC'))):
            sys_edit(edited, 'stated_amount', stated_raw, None, 'stated amount equals a deductible', now)
            stated, stated_raw = None, None
            notes['stated_cleared'] = notes['stated_cleared'] + 1
        elif stated is not None and stated > 10000:
            notes['stated_basis'] = notes['stated_basis'] + 1  # VALUATION_BASIS = STATED (kept in the run summary)
        addr = {'garaging_address': txt(v.get('GARAGING_ADDRESS')), 'garaging_city': txt(v.get('CITY')),
                'garaging_county': txt(v.get('COUNTY')), 'garaging_state': txt(v.get('STATE')), 'garaging_zip': txt(v.get('ZIP'))}
        if not addr['garaging_address']:
            p = pick_premises(v, premises)
            if p:
                notes['garaging_from_premises'] = notes['garaging_from_premises'] + 1
                for col, src in (('garaging_address', 'STREET'), ('garaging_city', 'CITY'), ('garaging_county', 'COUNTY'),
                                 ('garaging_state', 'STATE'), ('garaging_zip', 'ZIP')):
                    if not addr[col] and txt(p.get(src)):
                        addr[col] = txt(p.get(src))
                        sys_edit(edited, col, None, addr[col], 'filled from premises', now)
        bt = txt(v.get('BODY_TYPE'))
        row = {'id': str(uuid.uuid4()), 'run_id': run['id'], 'owner_id': owner_id, 'row_number': n,
               'vin': vin, 'make': txt(v.get('MAKE')), 'model': txt(v.get('MODEL')), 'body_type': bt,
               'year_raw': txt(v.get('YEAR')), 'year': to_year(v.get('YEAR')),
               'radius_raw': txt(v.get('RADIUS')), 'radius': to_radius(v.get('RADIUS')),
               'cost_new_raw': txt(v.get('COST_NEW')), 'cost_new': to_num(v.get('COST_NEW')),
               'stated_amount_raw': stated_raw, 'stated_amount': stated,
               'comp_otc': txt(v.get('COMP_OTC')), 'coll': txt(v.get('COLL')), 'net_veh_dr_cr': txt(v.get('NET_VEH_DR_CR')),
               'sic': txt(v.get('SIC')), 'is_trailer': is_trailer_row(bt, txt(v.get('MODEL')), txt(v.get('MAKE'))),
               'is_duplicate': dup, 'edited_fields': edited, 'created_at': now, 'updated_at': now}
        for col in addr:
            row[col] = addr[col]
        vehicles.append(row)
    items = []
    for n, it in enumerate(im, start=1):
        items.append({'id': str(uuid.uuid4()), 'run_id': run['id'], 'owner_id': owner_id, 'row_number': n,
                      'type': txt(it.get('TYPE')), 'manufacturer': txt(it.get('MANUFACTURER')), 'description': txt(it.get('DESCRIPTION')),
                      'model': txt(it.get('MODEL')), 'model_year': txt(it.get('MODEL_YEAR')), 'serial_no': txt(it.get('ID_SERIAL_NO')),
                      'amount_of_insurance_raw': txt(it.get('AMOUNT_OF_INSURANCE')), 'amount_of_insurance': to_num(it.get('AMOUNT_OF_INSURANCE')),
                      'is_duplicate': False, 'edited_fields': {}, 'created_at': now, 'updated_at': now})
    drivers = []
    for n, d in enumerate(drv, start=1):
        drivers.append({'id': str(uuid.uuid4()), 'run_id': run['id'], 'owner_id': owner_id, 'row_number': n,
                        'first_name': txt(d.get('FirstName')), 'middle_name': txt(d.get('MiddleName')), 'last_name': txt(d.get('LastName')),
                        'date_of_birth_raw': txt(d.get('DATE_OF_BIRTH')), 'date_of_birth': plausible_dob(d.get('DATE_OF_BIRTH')),
                        'license_state': txt(d.get('STATE_LIC')), 'license_number': txt(d.get('DRIVERS_LICENSE_NUMBER')),
                        'is_duplicate': False, 'edited_fields': {}, 'created_at': now, 'updated_at': now})
    return vehicles, items, drivers, notes


def delete_children(db, run_id):
    for table in CHILD_TABLES:
        loops = 0
        while loops < 1000:
            loops = loops + 1
            # 100 ids per call: the ids go in the request URL, and 500 ids is over the URL limit (414)
            ids = [r['id'] for r in rows_of(db.database.from_(table).filter('run_id', 'eq', run_id).page_size(100).execute())]
            if not ids:
                break
            db.database.delete(table, ids=ids)


KNOWN_COLS = ['vin', 'make', 'model', 'body_type', 'year_raw', 'year', 'garaging_address', 'garaging_city', 'garaging_county',
              'garaging_state', 'garaging_zip', 'radius_raw', 'radius', 'cost_new_raw', 'cost_new', 'stated_amount_raw', 'stated_amount',
              'comp_otc', 'coll', 'net_veh_dr_cr', 'sic', 'is_trailer', 'is_duplicate', 'edited_fields', 'row_number', 'owner_id', 'run_id',
              'type', 'manufacturer', 'description', 'model_year', 'serial_no', 'amount_of_insurance_raw', 'amount_of_insurance',
              'first_name', 'middle_name', 'last_name', 'date_of_birth', 'date_of_birth_raw', 'license_state', 'license_number',
              'created_at', 'updated_at', 'id']


def describe_failure(res, err):
    # column names only, never values (the error text can contain personal data)
    text = str(err if err is not None else res)
    cols = sorted(set([c for c in KNOWN_COLS if re.search(r"\b" + c + r"\b", text)]))
    words = []
    for w in ('required', 'maxLength', 'max_length', 'too long', 'format', 'type', 'enum', 'permission', 'denied', 'forbidden', 'unique', 'duplicate', 'null'):
        if w.lower() in text.lower():
            words.append(w)
    return 'cols=%s hints=%s' % (','.join(cols) or '-', ','.join(words) or '-')


def insert_batches(db, table, rows):
    i = 0
    while i < len(rows):
        part = rows[i:i + BATCH]
        res = None
        err = None
        try:
            res = db.database.create(table, part)
        except Exception as e:
            err = e
        saved = rows_of(res) if err is None else []
        if err is not None or len(saved) != len(part):
            log('extract save failed table=%s batch=%d sent=%d saved=%d %s' % (table, i, len(part), len(saved), describe_failure(res, err)), level='error')
            raise user_error('Extraction read the file but some rows could not be saved. Please try again or contact an admin.')
        i = i + BATCH


def still_active(db, run_id, token):
    # False when the run was deleted, is no longer processing, or another worker has taken it over
    cur = rows_of(db.database.from_('nip_runs').filter('id', 'eq', run_id).execute())
    if not cur:
        return False
    r0 = cur[0]
    if r0.get('lifecycle_status') != 'active' or r0.get('extraction_status') != 'processing':
        return False
    prog = r0.get('extraction_progress') if isinstance(r0.get('extraction_progress'), dict) else {}
    job = prog.get('job')
    return job is None or job == token


def save_progress(db, run_id, token, processed, total):
    # a failed progress write is retried; it is not worth losing a long extraction over one network blip
    last = None
    for attempt in range(1, 4):
        try:
            now = now_iso()
            db.database.update('nip_runs', record_id=run_id, data={'extraction_progress': {'processed': processed, 'total': total, 'job': token}, 'last_progress_at': now, 'updated_at': now})
            return
        except Exception as e:
            last = e
            time.sleep(2 * attempt)
    raise last


def fail_run(db, run_id, msg):
    try:
        cur = rows_of(db.database.from_('nip_runs').filter('id', 'eq', run_id).execute())
        if cur and cur[0].get('extraction_status') != 'processing':
            # another worker already finished (or stopped) this run; never overwrite its result
            log('extract: not marking run failed, status is %s run_id=%s' % (cur[0].get('extraction_status'), run_id), level='info')
            return
        now = now_iso()
        db.database.update('nip_runs', record_id=run_id, data={'extraction_status': 'failed', 'extraction_error': msg, 'last_progress_at': now, 'updated_at': now})
    except Exception:
        log('extract: could not record failure run_id=%s' % run_id, level='error')


def make_parts(run_id, model, settings, passes, reader, n, start=0):
    parts = []
    vins_by_page = {}
    if reader is not None:
        scan = sorted(set([p for ps in passes if 'AUTO' in ps['tabs'] for p in ps['pages']]))
        vins_by_page = page_vins(reader, scan)
    for ps in passes:
        note = section_note(ps, n)
        for pt in split_pass(ps, vins_by_page, settings):
            prm = {'run_id': run_id, 'model': model, 'part': start + len(parts), 'tabs': ps['tabs'], 'pages': pt['pages'], 'page_count': n,
                   'section_note': note, 'row_range': pt['row_range'], 'expected_vins': pt['expected'],
                   'page_vins': dict([(str(p), vins_by_page.get(p) or []) for p in pt['pages']]),
                   'repair_rounds': settings['repair_rounds'], 'min_coverage': settings['min_coverage'], 'max_depth': settings['max_depth']}
            parts.append({'pass': ps['name'], 'label': label(pt['pages']), 'params': prm})
    return parts


def collect(passes, parts, done):
    by_pass = {}
    for i, p in enumerate(parts):
        out = done.get(i)
        if out and isinstance(out.get('result'), dict):
            by_pass.setdefault(p['pass'], []).append(out['result'])
    choices = {}
    tabs = {}
    keys = {'AUTO': clean_auto, 'IM': clean_im, 'DRIVER': clean_drivers}
    for tab in TABS:
        variants = {}
        for ps in passes:
            if tab not in ps['tabs']:
                continue
            rows = []
            for r in by_pass.get(ps['name']) or []:
                rows = rows + [x for x in (r.get(tab) or []) if isinstance(x, dict)]
            variants[ps['variant'] if ps['tab'] == tab else 'base'] = {'rows': keys[tab](rows), 'titles': ps['titles'] or [ps['name']]}
        if not variants:
            tabs[tab] = []
            continue
        win = pick_variant(tab, (variants.get('base') or {}).get('rows'), (variants.get('revised') or {}).get('rows'))
        if win not in variants or (not variants[win]['rows'] and 'worksheet' in variants):
            win = 'worksheet' if 'worksheet' in variants else win
        if win not in variants:
            tabs[tab] = []
            continue
        tabs[tab] = variants[win]['rows']
        info = {'chosen': win, 'chosen_titles': variants[win]['titles'], 'rows': len(variants[win]['rows'])}
        others = [v for v in ('base', 'revised', 'worksheet') if v in variants and v != win]
        if others:
            other = others[0]
            info['other'] = other
            info['other_titles'] = variants[other]['titles']
            info['other_rows'] = len(variants[other]['rows'])
        choices[tab] = info
    # INSURED and PREMISES: the ACORD pass first, then any other pass that returned them
    order = [ps['name'] for ps in passes if 'INSURED' in ps['tabs']] + [ps['name'] for ps in passes if 'INSURED' not in ps['tabs']]
    results = []
    for name in order:
        results = results + (by_pass.get(name) or [])
    premises = []
    for r in results:
        premises = premises + [x for x in (r.get('PREMISES') or []) if isinstance(x, dict)]
    return tabs, choices, merge_insured(results), clean_premises(premises)


def main(params, user_data, sdk_client):
    params = params or {}
    caller = str(user_data.get('id'))
    run_id = str(params.get('run_id') or '')
    if not run_id:
        return {'success': False, 'error': 'run_id is required.'}
    db = sdk_client  # caller's own access; own-row table policies apply
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
    token = str(uuid.uuid4())
    prog0 = run.get('extraction_progress') if isinstance(run.get('extraction_progress'), dict) else {}
    age = seconds_since(run.get('last_progress_at'))
    if prog0.get('job') and age is not None and age < OTHER_WORKER_SECONDS:
        return {'success': False, 'error': 'Extraction is already running for this run.'}

    stage = 'start'
    t0 = time.time()
    try:
        model, settings, patterns = load_settings(db)
        parallel = max(1, min(MAX_PARALLEL, int(settings.get('parallel') or 6)))
        stage = 'download'
        try:
            raw = db.storage.from_('nip-uploads').download(run.get('file_ref'))
        except Exception:
            raise user_error('The uploaded file could not be found. Please upload it again.')
        if isinstance(raw, dict):
            raw = raw.get('content') or raw.get('data')
        if not raw:
            raise user_error('The uploaded file is empty. Please upload it again.')
        stage = 'plan'
        stype = str(run.get('source_type') or '').lower()
        bookmarks = []
        if stype == 'pdf':
            try:
                from pypdf import PdfReader
                reader = PdfReader(io.BytesIO(raw))
                if reader.is_encrypted:
                    raise user_error('This PDF is password protected. Please remove the password and upload it again.')
                n = len(reader.pages)
            except Exception as e:
                if str(e).startswith('USER:'):
                    raise e
                raise user_error('This PDF could not be read. Please check that it opens normally and upload it again.')
            passes, ranges = plan_passes(read_outline(reader), n, patterns)
            bookmarks = [{'title': r['title'], 'kind': r['kind'], 'revised': r['revised'], 'pages': label(list(range(r['first'], r['last'] + 1)))} for r in ranges]
            ws_passes = [p for p in passes if p['variant'] == 'worksheet']
            passes = [p for p in passes if p['variant'] != 'worksheet']
            parts = make_parts(run_id, model, settings, passes, reader, n)
            ws_reader = reader if ws_passes else None
            reader = None
        else:
            n = 0
            ws_passes = []
            ws_reader = None
            passes = [{'name': 'spreadsheet', 'tab': 'ALL', 'variant': 'base', 'tabs': ALL_TABS, 'pages': [], 'titles': []}]
            parts = [{'pass': 'spreadsheet', 'label': 'rows block %d' % (i + 1),
                      'params': {'run_id': run_id, 'model': model, 'part': i, 'tabs': ALL_TABS, 'text': c['text']}}
                     for i, c in enumerate(excel_chunks(raw, stype))]
        raw = None
        if not parts:
            raise user_error('The file has no readable content.')
        if len(parts) > MAX_PARTS:
            raise user_error('The file is too large to extract in one run. Please split it and upload the parts separately.')
        total = len(parts)
        plan_s = int(time.time() - t0)
        db.database.update('nip_runs', record_id=run_id, data={'extraction_progress': {'processed': 0, 'total': total, 'job': token}, 'extraction_error': None, 'last_progress_at': now_iso(), 'updated_at': now_iso()})
        log('extract plan run_id=%s passes=%d parts=%d parallel=%d' % (run_id, len(passes), total, parallel), level='info')

        stage = 'read parts'
        res = run_parts(sdk_client, db, run_id, token, parts, parallel)
        if res is None:
            return {'success': False, 'stopped': True}
        done, failed = res
        if not [i for i in done if done[i]]:
            raise user_error('No part of the file could be read. Please try again.')
        mock = any([bool(done[i].get('mock')) for i in done if done[i]])

        stage = 'merge'
        tabs, choices, insured, premises = collect(passes, parts, done)
        # a worksheet copy is read only for a tab whose plain section gave no rows
        need = [p for p in ws_passes if not tabs.get(p['tab'])]
        if need:
            stage = 'read worksheet'
            extra = make_parts(run_id, model, settings, need, ws_reader, n, start=len(parts))
            log('extract worksheet fallback run_id=%s tabs=%s parts=%d' % (run_id, ','.join([p['tab'] for p in need]), len(extra)), level='info')
            res2 = run_parts(sdk_client, db, run_id, token, extra, parallel)
            if res2 is None:
                return {'success': False, 'stopped': True}
            base = len(parts)
            for k in res2[0]:
                done[base + k] = res2[0][k]
            failed = failed + res2[1]
            passes = passes + need
            parts = parts + extra
            total = len(parts)
            stage = 'merge'
            tabs, choices, insured, premises = collect(passes, parts, done)
        skipped_ws = [{'name': p['name'], 'pages': len(p['pages']), 'titles': p['titles']} for p in ws_passes if p not in passes]
        ws_reader = None
        vehicles, items, drivers, notes = build_rows(tabs['AUTO'], tabs['IM'], tabs['DRIVER'], premises, run, owner_id)
        if not still_active(db, run_id, token):
            return {'success': False, 'stopped': True}
        stage = 'save rows'
        delete_children(db, run_id)
        insert_batches(db, 'nip_vehicles', vehicles)
        insert_batches(db, 'nip_im_items', items)
        insert_batches(db, 'nip_drivers', drivers)

        stage = 'finish'
        seconds = int(time.time() - t0)
        summary = {'processed': total, 'total': total, 'seconds': seconds, 'plan_seconds': plan_s, 'parallel': parallel,
                   'passes': [{'name': p['name'], 'pages': len(p['pages'])} for p in passes], 'bookmarks': bookmarks,
                   'choices': choices, 'cleanup': notes, 'premises': premises, 'warnings': failed, 'mock': mock,
                   'worksheets_not_read': skipped_ws}
        upd = {'extraction_status': 'complete', 'extraction_error': ('Some pages could not be read: ' + '; '.join([str(f.get('pages')) for f in failed])) if failed else None,
               'extraction_progress': summary, 'last_progress_at': now_iso(), 'updated_at': now_iso(), 'queue_diagnostics': {'totalRows': len(vehicles)}}
        for col, key in (('insured_name', 'NAME'), ('insured_mailing_address', 'MAILING_ADDRESS'), ('insured_city', 'CITY'), ('insured_state', 'STATE'),
                         ('insured_zip', 'ZIP'), ('insured_sic', 'SIC'), ('epic_id', 'EPIC_ID'), ('policy_number', 'POLICY_NUMBER'), ('broker_email', 'BROKER_EMAIL')):
            if insured.get(key) is not None:
                upd[col] = insured.get(key)
        for val in VALUATIONS:
            if str(insured.get('IM_VALUATION_TYPE') or '').strip().lower() == val.lower():
                upd['im_valuation_type'] = val
        db.database.update('nip_runs', record_id=run_id, data=upd)
        log('extract complete run_id=%s parts=%d seconds=%d vehicles=%d im=%d drivers=%d unread=%d' % (run_id, total, seconds, len(vehicles), len(items), len(drivers), len(failed)), level='info')
        return {'success': True, 'run_id': run_id, 'seconds': seconds, 'parts': total, 'choices': choices, 'warnings': failed,
                'counts': {'vehicles': len(vehicles), 'im_items': len(items), 'drivers': len(drivers), 'premises': len(premises)}}
    except Exception as e:
        m = str(e)
        if m.startswith('USER:'):
            msg = m[5:]
            log('extract failed run_id=%s stage=%s reason=%s' % (run_id, stage, msg), level='error')
        else:
            log('extract failed run_id=%s stage=%s kind=%s' % (run_id, stage, str(type(e))[:80]), level='error')
            msg = 'Extraction failed. Please try again, or upload the file again.'
        fail_run(db, run_id, msg)
        return {'success': False, 'error': msg}