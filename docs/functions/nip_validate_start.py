import uuid
from datetime import datetime, timezone

SITE_URL = 'https://insurance.taruvi.cloud'
APP_SLUG = 'nip_rating'
PLACEHOLDERS = ['NEED', 'NEEDED', 'NA', 'NONE', 'UNKNOWN', 'NOTAVAILABLE', 'NOTAPPLICABLE', 'TBD', 'PENDING']
VIN_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'
TRAILER_MSG = 'Skipped: trailer (values from tabbed application)'
INVALID_MSG = 'Skipped: invalid VIN format'

# Letters from other alphabets that look like a Latin letter or digit, as read by OCR
LOOKALIKES = {
    '\u0410': 'A', '\u0412': 'B', '\u0415': 'E', '\u041a': 'K', '\u041c': 'M', '\u041d': 'H', '\u041e': '0',
    '\u0420': 'P', '\u0421': 'C', '\u0422': 'T', '\u0423': 'Y', '\u0425': 'X', '\u0417': '3', '\u0406': '1',
    '\u0391': 'A', '\u0392': 'B', '\u0395': 'E', '\u0396': 'Z', '\u0397': 'H', '\u0399': '1', '\u039a': 'K',
    '\u039c': 'M', '\u039d': 'N', '\u039f': '0', '\u03a1': 'P', '\u03a4': 'T', '\u03a5': 'Y', '\u03a7': 'X',
}

# VIN check digit (position 9). Required for North American VINs (first character 1 to 5).
CD_VALUES = {'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'F': 6, 'G': 7, 'H': 8, 'J': 1, 'K': 2, 'L': 3, 'M': 4, 'N': 5, 'P': 7,
             'R': 9, 'S': 2, 'T': 3, 'U': 4, 'V': 5, 'W': 6, 'X': 7, 'Y': 8, 'Z': 9}
CD_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]
# characters commonly confused when a VIN is read from an application
MISREADS = {'S': '5', '5': 'S', 'B': '8G', '8': 'B', 'G': '6B', '6': 'G', 'Z': '2', '2': 'Z', 'D': '0', '0': 'D',
            'U': 'V', 'V': 'U', 'X': 'K', 'K': 'X'}


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


def has_role(user_data, name):
    return name in role_names(user_data) or ('nip_rating-' + name) in role_names(user_data)


def is_admin(user_data):
    return bool(user_data.get('is_cloud_user') or user_data.get('is_superuser') or has_role(user_data, 'nip_admin'))


def rows_of(res):
    if isinstance(res, dict):
        return res.get('data') or []
    return res or []


def norm_vin(v):
    return ''.join(str(v or '').upper().split())


def is_placeholder(vin):
    letters = ''.join([c for c in vin if c.isalpha()])
    return letters in PLACEHOLDERS


def is_valid_vin(vin):
    if len(vin) != 17:
        return False
    for c in vin:
        if c not in VIN_CHARS:
            return False
    return True


def clean_vin(vin):
    # I, O and Q never appear in a VIN: read them as 1, 0 and 0. Look-alike letters from other alphabets become Latin.
    out = []
    for c in vin:
        c = LOOKALIKES.get(c, c)
        if c == 'I':
            c = '1'
        elif c in ('O', 'Q'):
            c = '0'
        out.append(c)
    fixed = ''.join(out)
    if fixed != vin and is_valid_vin(fixed):
        return fixed
    return None


def check_digit_ok(vin):
    if not is_valid_vin(vin) or vin[0] not in '12345':
        return True
    total = 0
    for i in range(17):
        c = vin[i]
        total = total + (int(c) if c.isdigit() else CD_VALUES[c]) * CD_WEIGHTS[i]
    r = total % 11
    return ('X' if r == 10 else str(r)) == vin[8]


def check_digit_fix(vin):
    """The single VIN, one common misread (or one swap of neighbouring characters) away, whose check digit is right.
    None when there is no such VIN or more than one: then nothing is changed and the VIN is only flagged."""
    found = []
    for i in range(17):
        for c in MISREADS.get(vin[i], ''):
            cand = vin[:i] + c + vin[i + 1:]
            if cand[0] in '12345' and is_valid_vin(cand) and check_digit_ok(cand) and cand not in found:
                found.append(cand)
    for i in range(16):
        if vin[i] != vin[i + 1]:
            cand = vin[:i] + vin[i + 1] + vin[i] + vin[i + 2:]
            if cand[0] in '12345' and is_valid_vin(cand) and check_digit_ok(cand) and cand not in found:
                found.append(cand)
    return found[0] if len(found) == 1 else None


def save_vin_fix(db, v, new_vin, now, why):
    # keep the first original in edited_fields, like a manual edit does
    edited = {}
    old_edits = v.get('edited_fields') or {}
    for k in old_edits:
        edited[k] = old_edits[k]
    if isinstance(edited.get('vin'), dict):
        edited['vin']['edited'] = new_vin
        edited['vin']['edited_at'] = now
        edited['vin']['edited_by'] = why
    else:
        edited['vin'] = {'original': v.get('vin'), 'edited': new_vin, 'edited_by': why, 'edited_at': now}
    try:
        db.database.update('nip_vehicles', record_id=v.get('id'), data={'vin': new_vin, 'edited_fields': edited, 'updated_at': now})
        v['vin'] = new_vin
        v['edited_fields'] = edited
        return True
    except Exception:
        return False


def main(params, user_data, sdk_client):
    params = params or {}
    caller = str(user_data.get('id'))
    run_id = str(params.get('run_id') or '')
    mode = str(params.get('mode') or 'all')
    selected = params.get('selected_vins') or []
    test_mode = params.get('test_mode') == 'fake' and bool(user_data.get('is_cloud_user'))

    if mode not in ('all', 'selected', 'retry_failed'):
        return {'success': False, 'error': 'Choose all, selected or retry failed.'}
    if not run_id:
        return {'success': False, 'error': 'run_id is required.'}

    db = sdk_client  # caller's own access; own-row table policies apply

    runs = rows_of(db.database.from_('nip_runs').filter('id', 'eq', run_id).execute())
    if not runs:
        return {'success': False, 'error': 'This run was not found.'}
    run = runs[0]
    owner_id = str(run.get('owner_id'))
    if not (is_admin(user_data) or owner_id == caller):
        return {'success': False, 'error': 'You do not have permission to validate this run.'}
    if run.get('lifecycle_status') != 'active':
        return {'success': False, 'error': 'This run is being deleted.'}
    if run.get('extraction_status') != 'complete':
        return {'success': False, 'error': 'Extraction must finish before VINs can be validated.'}
    if run.get('validation_status') == 'processing':
        return {'success': False, 'error': 'VIN validation is already running for this run.'}

    vehicles = rows_of(db.database.from_('nip_vehicles').filter('run_id', 'eq', run_id).sort('row_number', 'asc').page_size(1000).execute())
    prev_rows = rows_of(db.database.from_('nip_validation_results').filter('run_id', 'eq', run_id).page_size(1000).execute())
    prev = {}
    for p in prev_rows:
        prev[norm_vin(p.get('vin'))] = p

    # ---- build the plan ----
    seen = set()
    unique = []
    skipped = {}
    blank = 0
    placeholder = 0
    trailers = 0
    invalid = 0
    dup = 0
    fixed_count = 0
    cd_fixed = 0
    cd_warn = []
    plan_now = now_iso()
    for v in vehicles:
        vin = norm_vin(v.get('vin'))
        if not vin:
            blank = blank + 1
            continue
        if is_placeholder(vin):
            placeholder = placeholder + 1
            continue
        if v.get('is_trailer'):
            trailers = trailers + 1
            skipped[vin] = TRAILER_MSG
            continue
        was_fixed = False
        if not is_valid_vin(vin):
            cleaned = clean_vin(vin)
            if cleaned and save_vin_fix(db, v, cleaned, plan_now, 'system (VIN cleanup)'):
                vin = cleaned
                was_fixed = True
                fixed_count = fixed_count + 1
            else:
                invalid = invalid + 1
                skipped[vin] = INVALID_MSG
                continue
        # a wrong check digit means a character was misread: fix it only when exactly one common misread fits
        if not v.get('is_duplicate') and not check_digit_ok(vin):
            fix = check_digit_fix(vin)
            if fix and save_vin_fix(db, v, fix, plan_now, 'system (VIN check digit)'):
                log('validate: check digit fix run_id=%s row=%s' % (run_id, v.get('row_number')), level='info')
                vin = fix
                was_fixed = True
                cd_fixed = cd_fixed + 1
            else:
                cd_warn.append(vin)
        if v.get('is_duplicate'):
            dup = dup + 1
            continue
        if vin in seen:
            dup = dup + 1
            if was_fixed:
                # the same vehicle appears twice once the VIN is corrected: keep the first row only
                try:
                    db.database.update('nip_vehicles', record_id=v.get('id'), data={'is_duplicate': True, 'updated_at': plan_now})
                except Exception:
                    pass
            continue
        seen.add(vin)
        unique.append(vin)

    if len(vehicles) == 0 or blank == len(vehicles):
        return {'success': False, 'error': 'No VINs extracted to validate'}

    if mode == 'all':
        send = list(unique)
        if len(send) == 0:
            return {'success': False, 'error': 'No valid VINs were found to validate'}
    elif mode == 'selected':
        wanted = set([norm_vin(x) for x in selected])
        send = [x for x in unique if x in wanted]
        if len(send) == 0:
            return {'success': False, 'error': 'No selected unique VINs require validation'}
    else:
        send = []
        for x in unique:
            p = prev.get(x)
            if p is not None and (not p.get('success')) and (not p.get('skipped')):
                send.append(x)
        if len(send) == 0:
            return {'success': False, 'error': 'No failed unique VINs to retry'}

    send_set = set(send)
    preserved = 0
    for vin in prev:
        if vin not in send_set and not prev[vin].get('skipped') and vin not in skipped:
            preserved = preserved + 1

    diag = {
        'totalRows': len(vehicles),
        'uniqueVinCount': len(unique),
        'duplicateVinCount': dup,
        'blankVinCount': blank,
        'placeholderVinCount': placeholder,
        'invalidVinCount': invalid,
        'trailerVinCount': trailers,
        'fixedVinCount': fixed_count,
        'checkDigitFixedCount': cd_fixed,
        'checkDigitWarnCount': len(cd_warn),
        'validationVinCount': len(send),
        'preservedResultCount': preserved,
    }

    # ---- claim the run first so a second quick click is refused. The job id lets a worker notice it was replaced ----
    job_id = str(uuid.uuid4())
    now = now_iso()
    db.database.update('nip_runs', record_id=run_id, data={
        'validation_status': 'processing',
        'validation_progress': {'processed': preserved, 'total': preserved + len(send)},
        'validation_error': None,
        'validation_cancel_requested': False,
        'queue_diagnostics': diag,
        'active_job_id': job_id,
        'last_progress_at': now,
        'updated_at': now,
    })

    # ---- record skipped rows (idempotent, keyed by run and VIN) ----
    for vin in skipped:
        msg = skipped[vin]
        old = prev.get(vin)
        if old is not None and old.get('skipped') and old.get('error') == msg:
            continue
        data = {'success': False, 'skipped': True, 'error': msg, 'validated_at': now, 'updated_at': now}
        if msg == TRAILER_MSG:
            # a trailer uses the values on the tabbed application, so drop any PriceDigest values stored earlier
            for col in ('is_tractor', 'gross_vehicle_weight', 'gross_combine_weight', 'complete_incomplete', 'msrp', 'retail_value', 'wholesale_value', 'pd_make', 'pd_model', 'pd_year', 'vehicle_type', 'vehicle_subtype'):
                data[col] = None
        if old is not None:
            db.database.update('nip_validation_results', record_id=old.get('id'), data=data)
        else:
            data['run_id'] = run_id
            data['owner_id'] = owner_id
            data['vin'] = vin
            db.database.create('nip_validation_results', data)

    # ---- start the worker ----
    worker_params = {'run_id': run_id, 'vins': send, 'mode': mode, 'preserved': preserved, 'job_id': job_id}
    if test_mode:
        worker_params['test_mode'] = 'fake'
        worker_params['fake_script'] = params.get('fake_script') or {}
    try:
        sdk_client.functions.execute('nip_validate_worker', params=worker_params, is_async=True)
    except Exception:
        db.database.update('nip_runs', record_id=run_id, data={'validation_status': 'failed', 'validation_error': 'The VIN validation could not be started. Please try again.', 'active_job_id': None, 'updated_at': now_iso()})
        return {'success': False, 'error': 'The VIN validation could not be started. Please try again.'}

    log('validation started run_id=%s mode=%s send=%d fixed_vins=%d check_digit_fixed=%d check_digit_warn=%d' % (run_id, mode, len(send), fixed_count, cd_fixed, len(cd_warn)), level='info')
    return {'success': True, 'run_id': run_id, 'mode': mode, 'to_validate': len(send), 'fixed_vins': fixed_count,
            'check_digit_fixed': cd_fixed, 'check_digit_warnings': len(cd_warn), 'queue_diagnostics': diag}
