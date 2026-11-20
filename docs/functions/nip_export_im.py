import io
import re
import uuid
import zipfile
from datetime import datetime, timezone

TEMPLATE = 'IM_Worksheet.xlsx'
SCHEDULE = 'xl/worksheets/sheet3.xml'   # ContractorsEquipmentSchedule
COVERAGE = 'xl/worksheets/sheet2.xml'   # ContractorsEquipmentCoverage
WORKBOOK = 'xl/workbook.xml'
FIRST_ROW = 6
TEMPLATE_LAST_ROW = 82       # the template is prepared up to this row; later rows are copied from it
MAX_ITEMS = 5000
XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
LOW_DEDUCTIBLE_PROGRAMS = ['treepro', 'landpro']
SKIP_WORDS = ['small tool', 'miscellaneous', 'unscheduled']
SERIAL_RE = r'(?:SERIAL\s*#|SER\s*#|S/N|S#|SN)\s*[:\-]?\s*([A-Z0-9\-]{4,})'


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def rows_of(res):
    if isinstance(res, dict):
        return res.get('data') or []
    return res or []


def col_index(letters):
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n


def esc(s):
    return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def clean(v):
    if v is None:
        return ''
    return ' '.join(str(v).split())


def to_number(v):
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    t = str(v).replace('$', '').replace(',', '').strip()
    m = re.match(r'^-?\d+(\.\d+)?', t)
    return float(m.group(0)) if m else None


def fmt_number(x):
    if x == int(x):
        return str(int(x))
    return repr(x)


def running_case(text):
    # title case as in the original app's worksheet: the first letter of a word is a capital and the rest is lower case,
    # where a word starts after a space, "/", "-", "(" or a quote ("EXMARK" -> "Exmark", "walk behind" -> "Walk Behind",
    # "W/ECV749" -> "W/Ecv749", "lazer-z" -> "Lazer-Z", "1200A" -> "1200a")
    return re.sub('(^|[\\s/\\-("#])([a-z])', lambda m: m.group(1) + m.group(2).upper(), text.lower())


def set_cell(xml, rn, col, value):
    ref = col + str(rn)
    pat = re.compile('<c r="' + ref + '"([^>]*?)(?:/>|>.*?</c>)', re.S)
    m = pat.search(xml)
    style = ''
    if m:
        sm = re.search(' s="(\\d+)"', m.group(1))
        if sm:
            style = ' s="' + sm.group(1) + '"'
    if value is None:
        new = '<c r="%s"%s/>' % (ref, style)
    elif isinstance(value, (int, float)):
        new = '<c r="%s"%s><v>%s</v></c>' % (ref, style, fmt_number(value))
    else:
        new = '<c r="%s"%s t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (ref, style, esc(value))
    if m:
        return xml[:m.start()] + new + xml[m.end():]
    target = col_index(col)
    for cm in re.finditer('<c r="([A-Z]+)\\d+"', xml):
        if col_index(cm.group(1)) > target:
            return xml[:cm.start()] + new + xml[cm.start():]
    k = xml.rfind('</row>')
    return xml[:k] + new + xml[k:]


def describe(it):
    # an edited full description wins; otherwise manufacturer + type + description + model
    edited = it.get('edited_fields') or {}
    full = clean(it.get('full_description'))
    if edited.get('full_description') and full:
        return running_case(full), full
    # a word that an earlier part already gave is not repeated ("John Deere" + "Gator" + "Gator" -> "John Deere Gator")
    seen = set()
    words = []
    for k in ('manufacturer', 'type', 'description', 'model'):
        for w in clean(it.get(k)).split(' '):
            if not w:
                continue
            key = re.sub('[^a-z0-9]', '', w.lower())
            if key and key in seen:
                continue
            if key:
                seen.add(key)
            words.append(w)
    joined = ' '.join(words)
    if not joined:
        joined = full
    return running_case(joined), joined


def item_values(it, valuation_type, program, this_year):
    text, raw_text = describe(it)
    low = raw_text.lower()
    crane = bool(it.get('is_crane')) or ('crane' in low)

    year = None
    ym = re.search('(19|20)\\d{2}', clean(it.get('model_year')))
    if ym:
        year = int(ym.group(0))
    elif raw_text:
        lead = re.match('^\\s*((?:19|20)\\d{2})\\b', raw_text)
        if lead:
            year = int(lead.group(1))

    serial = clean(it.get('serial_no'))
    if not serial:
        sm = re.search(SERIAL_RE, raw_text.upper())
        if sm:
            serial = sm.group(1)

    limit = to_number(it.get('amount_of_insurance'))

    if valuation_type == 'Replacement Cost' and year is not None and year >= this_year - 7:
        valuation = 'Replacement Cost'
    else:
        valuation = 'Actual Cash Value'

    low_program = program in LOW_DEDUCTIBLE_PROGRAMS
    if crane:
        deductible = 2500
    elif limit is not None and limit >= 250000:
        deductible = 10000
    elif limit is not None and limit >= 100000:
        deductible = 5000
    elif low_program:
        deductible = 1000
    else:
        deductible = 2500

    year_text = str(year) if year is not None else ('Need' if raw_text else None)
    serial_text = serial if serial else ('Needed' if raw_text else None)
    # the same machine can appear on several pages of the application: serial number, else description and limit
    if serial:
        same_as = 'serial:' + serial.upper()
    else:
        same_as = 'text:' + raw_text.lower() + '|' + str(limit)
    return {
        'text': text,
        'raw': raw_text,
        'crane': crane,
        'same_as': same_as,
        'C': text or None,
        'D': 'Cranes and Derricks' if crane else 'All Other Equipment',
        'E': year_text,
        'F': serial_text,
        'G': valuation,
        'H': int(round(limit)) if limit is not None else None,
        'I': deductible,
        'J': 2 if crane else 1,
    }


def skip_reason(it, vals):
    if it.get('is_duplicate'):
        return 'duplicate'
    low = vals['raw'].lower()
    for w in SKIP_WORDS:
        if w in low:
            return 'excluded'
    if it.get('is_small_tool'):
        return 'excluded'
    limit = to_number(it.get('amount_of_insurance'))
    if limit is not None and limit < 1000:
        return 'excluded'
    return None


def blank_row(template_row_xml, rn):
    # a copy of the template's last row for a new row number: same columns and styles, no values
    xml = re.sub('<row r="\\d+"', '<row r="%d"' % rn, template_row_xml, count=1)

    def empty(m):
        sm = re.search(' s="(\\d+)"', m.group(2))
        return '<c r="%s%d"%s/>' % (m.group(1), rn, (' s="' + sm.group(1) + '"') if sm else '')

    return re.sub('<c r="([A-Z]+)\\d+"([^>]*?)(?:/>|>.*?</c>)', empty, xml, flags=re.S)


def fill_schedule(sched, items):
    # Writes every item on one worksheet. Rows the template already has are filled in place;
    # rows beyond the template are copied from its last prepared row. Returns (sheet, error).
    tm = re.search('<row r="' + str(TEMPLATE_LAST_ROW) + '"[^>]*>.*?</row>', sched, re.S)
    if not tm:
        return None, 'The IM worksheet template is missing row %d.' % TEMPLATE_LAST_ROW
    template_row = tm.group(0)
    extra = []
    i = 0
    for vals in items:
        rn = FIRST_ROW + i
        i = i + 1
        m = re.search('<row r="' + str(rn) + '"[^>]*>.*?</row>', sched, re.S)
        if m:
            row_xml = m.group(0)
        else:
            row_xml = blank_row(template_row, rn)
        row_xml = set_cell(row_xml, rn, 'A', i)
        row_xml = set_cell(row_xml, rn, 'B', 'ContractorsEquipment')
        for col in ('C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'):
            row_xml = set_cell(row_xml, rn, col, vals[col])
        if m:
            sched = sched[:m.start()] + row_xml + sched[m.end():]
        else:
            extra.append(row_xml)
    if extra:
        k = sched.rfind('</sheetData>')
        sched = sched[:k] + ''.join(extra) + sched[k:]
    last = FIRST_ROW + len(items) - 1
    if last > TEMPLATE_LAST_ROW:
        # keep the header filter covering the new rows
        sched = re.sub('(<autoFilter ref="A5:J)\\d+"', '\\g<1>%d"' % last, sched, count=1)
    return sched, None


def build_workbook(zin, sched, cover, last_row):
    buf = io.BytesIO()
    zout = zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED)
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == SCHEDULE:
            data = sched.encode('utf-8')
        elif item.filename == COVERAGE:
            data = cover.encode('utf-8')
        elif item.filename == WORKBOOK and last_row > TEMPLATE_LAST_ROW:
            text = data.decode('utf-8')
            text = text.replace('ContractorsEquipmentSchedule!$A$5:$J$%d' % TEMPLATE_LAST_ROW, 'ContractorsEquipmentSchedule!$A$5:$J$%d' % last_row)
            data = text.encode('utf-8')
        zout.writestr(item.filename, data)
    zout.close()
    return buf.getvalue()


def main(params, user_data, sdk_client):
    params = params or {}
    caller = str(user_data.get('id'))
    run_id = str(params.get('run_id') or '')
    if not run_id:
        return {'success': False, 'error': 'run_id is required.'}

    # everything below is read with the caller's own access, so the table rules decide who may export
    runs = rows_of(sdk_client.database.from_('nip_runs').filter('id', 'eq', run_id).execute())
    if not runs:
        return {'success': False, 'error': 'This run was not found.'}
    run = runs[0]
    owner_id = str(run.get('owner_id'))
    if run.get('lifecycle_status') != 'active':
        return {'success': False, 'error': 'This run is being deleted.'}
    if run.get('extraction_status') != 'complete':
        return {'success': False, 'error': 'Extraction must finish before the IM worksheet can be exported.'}

    items = []
    page = 1
    while page < 50:
        got = rows_of(sdk_client.database.from_('nip_im_items').filter('run_id', 'eq', run_id).sort('row_number', 'asc').page(page).page_size(500).execute())
        items.extend(got)
        if len(got) < 500:
            break
        page = page + 1
    program_raw = ''
    if run.get('program_id'):
        progs = rows_of(sdk_client.database.from_('ref_programs').filter('id', 'eq', str(run.get('program_id'))).execute())
        if progs:
            program_raw = clean(progs[0].get('name'))
    program = program_raw.lower()
    valuation_type = run.get('im_valuation_type')
    this_year = datetime.now(timezone.utc).year

    chosen = []
    left_out = 0
    repeated = 0
    seen = set()
    for it in items:
        vals = item_values(it, valuation_type, program, this_year)
        if skip_reason(it, vals):
            left_out = left_out + 1
            continue
        if vals['same_as'] in seen:
            repeated = repeated + 1
            continue
        seen.add(vals['same_as'])
        chosen.append(vals)
    if not chosen:
        return {'success': False, 'error': 'There are no equipment items to export.'}

    try:
        tpl = sdk_client.storage.from_('nip-templates').download(TEMPLATE)
    except Exception:
        tpl = None
    if not tpl:
        return {'success': False, 'error': 'The IM worksheet template has not been uploaded yet. Please ask an administrator.'}

    try:
        zin = zipfile.ZipFile(io.BytesIO(tpl))
        base_sched = zin.read(SCHEDULE).decode('utf-8')
        base_cover = zin.read(COVERAGE).decode('utf-8')
    except Exception:
        return {'success': False, 'error': 'The IM worksheet template could not be read. Please ask an administrator to upload it again.'}

    low_program = program in LOW_DEDUCTIBLE_PROGRAMS
    cm = re.search('<row r="6"[^>]*>.*?</row>', base_cover, re.S)
    if not cm:
        return {'success': False, 'error': 'The IM worksheet template is missing the coverage row.'}
    crow = cm.group(0)
    crow = set_cell(crow, 6, 'T', 1000 if low_program else 2500)
    crow = set_cell(crow, 6, 'U', 3)
    crow = set_cell(crow, 6, 'V', 3)
    cover = base_cover[:cm.start()] + crow + base_cover[cm.end():]

    # one workbook holds every item: template rows are filled in place and further rows are copied from the last one
    if len(chosen) > MAX_ITEMS:
        return {'success': False, 'error': 'This run has %d equipment items. The IM worksheet holds at most %d.' % (len(chosen), MAX_ITEMS)}
    sched, err = fill_schedule(base_sched, chosen)
    if err:
        return {'success': False, 'error': err}
    out_bytes = build_workbook(zin, sched, cover, FIRST_ROW + len(chosen) - 1)

    base = re.sub('[^A-Za-z0-9 ._-]', '', str(run.get('insured_name') or '').strip()).strip() or 'NIP'
    safe = re.sub('[^A-Za-z0-9._-]', '_', base)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    file_name = base + '_IM_Worksheet.xlsx'
    path = owner_id + '/' + run_id + '/' + safe + '_IM_Worksheet_' + stamp + '.xlsx'
    res = sdk_client.storage.from_('nip-exports').upload(files=[(path.split('/')[-1], io.BytesIO(out_bytes), XLSX)], paths=[path])
    if isinstance(res, dict) and res.get('failed_count'):
        return {'success': False, 'error': 'The worksheet was built but could not be saved. Please try again.'}
    files = [{'file_ref': path, 'file_name': file_name}]
    count = 1
    try:
        now = now_iso()
        sdk_client.database.create('nip_exports', {'id': str(uuid.uuid4()), 'run_id': run_id, 'owner_id': owner_id, 'export_type': 'im_worksheet', 'file_ref': path, 'file_name': file_name, 'created_by': caller, 'created_at': now, 'updated_at': now})
    except Exception:
        log('export im: history record not saved run_id=%s' % run_id, level='error')
    warnings = []
    if repeated:
        warnings.append('%d repeated item(s) with the same serial number or description were left out.' % repeated)
    if not program_raw:
        warnings.append('No program is set on this run, so deductibles use the standard $2,500 rule.')
    if not valuation_type:
        warnings.append('The application did not show a valuation type, so every item is Actual Cash Value.')
    log('export im run_id=%s by=%s items=%d worksheets=%d left_out=%d repeated=%d' % (run_id, caller, len(chosen), count, left_out, repeated), level='info')
    out = {'success': True, 'run_id': run_id, 'file_ref': files[0]['file_ref'], 'file_name': files[0]['file_name'], 'files': files, 'items': len(chosen), 'worksheets': count, 'left_out': left_out + repeated}
    if warnings:
        out['warning'] = ' '.join(warnings)
    return out
