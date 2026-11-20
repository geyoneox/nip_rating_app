import io
import re
import uuid
from datetime import datetime, timezone

HEADER = ['First Name', 'Middle Name', 'Last Name', 'Date of Birth', 'License State', 'License Number']


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def rows_of(res):
    if isinstance(res, dict):
        return res.get('data') or []
    return res or []


def cell(v):
    s = '' if v is None else str(v)
    s = ' '.join(s.split())
    # a value that starts like a formula would run when the file is opened in Excel
    if s[:1] in ('=', '+', '-', '@'):
        s = "'" + s
    if ',' in s or '"' in s:
        s = '"' + s.replace('"', '""') + '"'
    return s


def norm(v):
    return re.sub('[^a-z0-9]', '', str(v or '').lower())


def driver_key(d):
    # same licence number (and state) is the same person; otherwise first + last name + date of birth
    lic = norm(d.get('license_number'))
    if lic:
        return 'lic:' + norm(d.get('license_state')) + ':' + lic
    dob = norm(d.get('date_of_birth') or d.get('date_of_birth_raw'))
    return 'name:' + norm(d.get('first_name')) + ':' + norm(d.get('last_name')) + ':' + dob


def main(params, user_data, sdk_client):
    params = params or {}
    caller = str(user_data.get('id'))
    run_id = str(params.get('run_id') or '')
    if not run_id:
        return {'success': False, 'error': 'run_id is required.'}

    # read with the caller's own access, so the table rules decide who may export
    runs = rows_of(sdk_client.database.from_('nip_runs').filter('id', 'eq', run_id).execute())
    if not runs:
        return {'success': False, 'error': 'This run was not found.'}
    run = runs[0]
    owner_id = str(run.get('owner_id'))
    if run.get('lifecycle_status') != 'active':
        return {'success': False, 'error': 'This run is being deleted.'}
    if run.get('extraction_status') != 'complete':
        return {'success': False, 'error': 'Extraction must finish before the drivers can be exported.'}

    drivers = rows_of(sdk_client.database.from_('nip_drivers').filter('run_id', 'eq', run_id).sort('row_number', 'asc').page_size(1000).execute())
    flagged = [d for d in drivers if not d.get('is_duplicate')]
    use = []
    seen = set()
    for d in flagged:
        k = driver_key(d)
        # a row with no name, date of birth or licence cannot be told apart, so keep it
        if k in ('name:::',):
            use.append(d)
            continue
        if k in seen:
            continue
        seen.add(k)
        use.append(d)
    repeats = len(flagged) - len(use)
    if not use:
        return {'success': False, 'error': 'There are no drivers to export.'}

    lines = [','.join(HEADER)]
    for d in use:
        dob = d.get('date_of_birth') or d.get('date_of_birth_raw')
        lines.append(','.join([cell(d.get('first_name')), cell(d.get('middle_name')), cell(d.get('last_name')), cell(dob), cell(d.get('license_state')), cell(d.get('license_number'))]))
    data = ('\r\n'.join(lines) + '\r\n').encode('utf-8')

    base = re.sub('[^A-Za-z0-9 ._-]', '', str(run.get('insured_name') or '').strip()).strip() or 'NIP'
    safe = re.sub('[^A-Za-z0-9._-]', '_', base)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    file_name = base + '_Drivers.csv'
    path = owner_id + '/' + run_id + '/' + safe + '_Drivers_' + stamp + '.csv'
    res = sdk_client.storage.from_('nip-exports').upload(files=[(path.split('/')[-1], io.BytesIO(data), 'text/csv')], paths=[path])
    if isinstance(res, dict) and res.get('failed_count'):
        return {'success': False, 'error': 'The file was built but could not be saved. Please try again.'}

    try:
        now = now_iso()
        sdk_client.database.create('nip_exports', {'id': str(uuid.uuid4()), 'run_id': run_id, 'owner_id': owner_id, 'export_type': 'drivers_csv', 'file_ref': path, 'file_name': file_name, 'created_by': caller, 'created_at': now, 'updated_at': now})
    except Exception:
        log('export drivers: history record not saved run_id=%s' % run_id, level='error')

    log('export drivers run_id=%s by=%s rows=%d repeats=%d' % (run_id, caller, len(use), repeats), level='info')
    out = {'success': True, 'run_id': run_id, 'file_ref': path, 'file_name': file_name, 'drivers': len(use), 'repeats_removed': repeats}
    if repeats:
        out['warning'] = '%d repeated driver row(s) were left out of the file (same licence number, or same name and date of birth).' % repeats
    return out
