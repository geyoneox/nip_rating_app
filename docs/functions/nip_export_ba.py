import io
import re
import uuid
import zipfile
from datetime import datetime, timezone

TEMPLATE = 'BA_Worksheet.xlsx'
SHEET = 'xl/worksheets/sheet3.xml'
WORKBOOK = 'xl/workbook.xml'
FIRST_ROW = 6
TEMPLATE_LAST_ROW = 158      # the template is prepared up to this row; later rows are copied from it
MAX_VEHICLES = 5000
XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def rows_of(res):
    if isinstance(res, dict):
        return res.get('data') or []
    return res or []


def norm_vin(v):
    return ''.join(str(v or '').upper().split())


def col_index(letters):
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n


def esc(s):
    return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def text_or_none(v, limit):
    if v is None:
        return None
    s = ' '.join(str(v).split())
    if s == '':
        return None
    return s[:limit]


def upper_or_none(s):
    return s.upper() if s is not None else None


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


def zip5(z):
    if z is None:
        return None
    m = re.match(r'^\s*(\d{5})', str(z))
    return m.group(1) if m else text_or_none(z, 10)


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


def blank_row(template_row_xml, rn):
    # a copy of the template's last row for a new row number: same columns and styles, no values
    xml = re.sub('<row r="\\d+"', '<row r="%d"' % rn, template_row_xml, count=1)

    def empty(m):
        sm = re.search(' s="(\\d+)"', m.group(2))
        return '<c r="%s%d"%s/>' % (m.group(1), rn, (' s="' + sm.group(1) + '"') if sm else '')

    return re.sub('<c r="([A-Z]+)\\d+"([^>]*?)(?:/>|>.*?</c>)', empty, xml, flags=re.S)


def vehicle_values(v):
    year = v.get('year')
    if year is None:
        m = re.search('(19|20)\\d{2}', str(v.get('year_raw') or ''))
        year = int(m.group(0)) if m else None
    # Original Cost New is the calculated value (largest of cost new and MSRP, or the program calculator).
    # Without one, the application's cost new, else its stated amount.
    cost = to_number(v.get('ocn_value'))
    if cost is None:
        cost = to_number(v.get('cost_new'))
    if cost is None:
        cost = to_number(v.get('stated_amount'))
    out = {
        'F': text_or_none(v.get('garaging_address'), 60),
        'H': text_or_none(v.get('garaging_city'), 40),
        'I': text_or_none(v.get('garaging_state'), 2),
        'J': zip5(v.get('garaging_zip')),
        'K': text_or_none(v.get('garaging_county'), 40),
        'L': year,
        'M': upper_or_none(text_or_none(v.get('make'), 60)),
        'N': upper_or_none(text_or_none(v.get('model'), 60)),
        'Q': text_or_none(norm_vin(v.get('vin')), 21),
        'R': int(round(cost)) if cost is not None else None,
        'S': text_or_none(v.get('class_code'), 6),
    }
    # the template starts every row as Yes / $1,000. An answer of No on the application must replace that.
    coll_answer = text_or_none(v.get('ba_coll_answer'), 5)
    coll = to_number(v.get('ba_coll_deductible'))
    if coll is None:
        coll = to_number(v.get('coll'))
    otc_answer = text_or_none(v.get('ba_comp_answer'), 5)
    otc = to_number(v.get('ba_comp_deductible'))
    if otc is None:
        otc = to_number(v.get('comp_otc'))
    if coll_answer == 'No':
        out['V'] = 'No'
        out['W'] = None
    else:
        if coll_answer == 'Yes':
            out['V'] = 'Yes'
        if coll is not None:
            out['W'] = coll
    if otc_answer == 'No':
        out['Z'] = 'No'
        out['AA'] = None
    else:
        if otc_answer == 'Yes':
            out['Z'] = 'Yes'
        if otc is not None:
            out['AA'] = otc
    return out


def fill_sheet(sheet, vehicles):
    # Writes every vehicle on one worksheet. Rows the template already has are filled in place;
    # rows beyond the template are copied from its last prepared row. Returns (sheet, vehicles with no cost, error).
    tm = re.search('<row r="' + str(TEMPLATE_LAST_ROW) + '"[^>]*>.*?</row>', sheet, re.S)
    if not tm:
        return None, 0, 'The BA worksheet template is missing row %d.' % TEMPLATE_LAST_ROW
    template_row = tm.group(0)
    missing = 0
    extra = []
    i = 0
    for v in vehicles:
        rn = FIRST_ROW + i
        i = i + 1
        vals = vehicle_values(v)
        vals['C'] = i          # vehicle number: 1, 2, 3 ... with no gaps
        if vals.get('R') is None:
            missing = missing + 1
        m = re.search('<row r="' + str(rn) + '"[^>]*>.*?</row>', sheet, re.S)
        if m:
            row_xml = m.group(0)
            for col in vals:
                row_xml = set_cell(row_xml, rn, col, vals[col])
            sheet = sheet[:m.start()] + row_xml + sheet[m.end():]
        else:
            row_xml = blank_row(template_row, rn)
            for col in vals:
                row_xml = set_cell(row_xml, rn, col, vals[col])
            extra.append(row_xml)
    if extra:
        k = sheet.rfind('</sheetData>')
        sheet = sheet[:k] + ''.join(extra) + sheet[k:]
    last = FIRST_ROW + len(vehicles) - 1
    if last > TEMPLATE_LAST_ROW:
        # keep the header filter and the sheet size covering the new rows
        sheet = re.sub('(<autoFilter ref="A5:AC)\\d+"', '\\g<1>%d"' % last, sheet, count=1)
        sheet = re.sub('(<dimension ref="[A-Z]+\\d+:[A-Z]+)\\d+"', '\\g<1>%d"' % last, sheet, count=1)
    return sheet, missing, None


def build_workbook(zin, sheet, last_row):
    buf = io.BytesIO()
    zout = zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED)
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == SHEET:
            data = sheet.encode('utf-8')
        elif item.filename == WORKBOOK and last_row > TEMPLATE_LAST_ROW:
            text = data.decode('utf-8')
            text = text.replace('VehicleWorksheet!$A$5:$AC$%d' % TEMPLATE_LAST_ROW, 'VehicleWorksheet!$A$5:$AC$%d' % last_row)
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
        return {'success': False, 'error': 'Extraction must finish before the BA worksheet can be exported.'}

    vehicles = []
    page = 1
    while page < 50:
        got = rows_of(sdk_client.database.from_('nip_vehicles').filter('run_id', 'eq', run_id).sort('row_number', 'asc').page(page).page_size(500).execute())
        vehicles.extend(got)
        if len(got) < 500:
            break
        page = page + 1
    live = [v for v in vehicles if not v.get('is_duplicate')]
    # a row with no VIN cannot be rated or listed on the worksheet, so it is left out and counted in the warning
    use = [v for v in live if norm_vin(v.get('vin'))]
    no_vin = len(live) - len(use)
    if not use:
        return {'success': False, 'error': 'There are no vehicles with a VIN to export.'}
    if len(use) > MAX_VEHICLES:
        return {'success': False, 'error': 'This run has %d vehicles. The BA worksheet holds at most %d.' % (len(use), MAX_VEHICLES)}

    try:
        tpl = sdk_client.storage.from_('nip-templates').download(TEMPLATE)
    except Exception:
        tpl = None
    if not tpl:
        return {'success': False, 'error': 'The BA worksheet template has not been uploaded yet. Please ask an administrator.'}

    try:
        zin = zipfile.ZipFile(io.BytesIO(tpl))
        base_sheet = zin.read(SHEET).decode('utf-8')
    except Exception:
        return {'success': False, 'error': 'The BA worksheet template could not be read. Please ask an administrator to upload it again.'}

    sheet, missing_cost, err = fill_sheet(base_sheet, use)
    if err:
        return {'success': False, 'error': err}
    out_bytes = build_workbook(zin, sheet, FIRST_ROW + len(use) - 1)

    base = re.sub('[^A-Za-z0-9 ._-]', '', str(run.get('insured_name') or '').strip()).strip() or 'NIP'
    safe = re.sub('[^A-Za-z0-9._-]', '_', base)  # storage path without spaces; the download keeps the readable name
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    file_name = base + '_BA_Worksheet.xlsx'
    path = owner_id + '/' + run_id + '/' + safe + '_BA_Worksheet_' + stamp + '.xlsx'
    res = sdk_client.storage.from_('nip-exports').upload(files=[(path.split('/')[-1], io.BytesIO(out_bytes), XLSX)], paths=[path])
    if isinstance(res, dict) and res.get('failed_count'):
        return {'success': False, 'error': 'The worksheet was built but could not be saved. Please try again.'}
    try:
        now = now_iso()
        sdk_client.database.create('nip_exports', {'id': str(uuid.uuid4()), 'run_id': run_id, 'owner_id': owner_id, 'export_type': 'ba_worksheet', 'file_ref': path, 'file_name': file_name, 'created_by': caller, 'created_at': now, 'updated_at': now})
    except Exception:
        log('export ba: history record not saved run_id=%s' % run_id, level='error')

    log('export ba run_id=%s by=%s vehicles=%d no_vin_left_out=%d missing_cost=%d' % (run_id, caller, len(use), no_vin, missing_cost), level='info')
    out = {'success': True, 'run_id': run_id, 'file_ref': path, 'file_name': file_name, 'files': [{'file_ref': path, 'file_name': file_name}], 'vehicles': len(use), 'worksheets': 1}
    warns = []
    if no_vin:
        warns.append('%d row(s) with no VIN were left out of the worksheet.' % no_vin)
    if missing_cost:
        warns.append('%d vehicle(s) have no Original Cost New: the application shows no cost new or stated amount and no value could be calculated.' % missing_cost)
    if warns:
        out['warning'] = ' '.join(warns)
    return out
