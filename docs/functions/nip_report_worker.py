import io
import re
import json
import time
import base64
import requests
from datetime import datetime, timezone

# Dexter: POST /api/scraper-runs/ -> 202 {run_id, status_url}; poll status_url until
# status is succeeded, partial or failed. Header: Authorization: Token <token>.
POLL_SECONDS = 5
WAIT_SECONDS = 780          # Dexter's own timeout for this process is 600 s; allow for queueing
UNAVAILABLE = 'The RiskMeter service is unavailable. Please try again later.'
TIMEOUT_MSG = 'The RiskMeter report took too long. Please try again.'


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def rows_of(res):
    if isinstance(res, dict):
        return res.get('data') or []
    return res or []


def rule_text(db, key):
    try:
        rows = rows_of(db.database.from_('ref_rules').filter('rule_key', 'eq', key).execute())
        if rows and rows[0].get('value_text'):
            return str(rows[0].get('value_text')).strip()
    except Exception:
        pass
    return None


def safe_name(s):
    return re.sub('[^A-Za-z0-9._-]', '_', str(s or 'report'))[:80]


def scalar_items(d, prefix, out):
    # flatten simple values so the page can show them as a table
    if isinstance(d, dict):
        for k in d:
            scalar_items(d[k], (prefix + ' ' if prefix else '') + str(k), out)
    elif isinstance(d, list):
        if len(d) <= 30 and all([not isinstance(x, (dict, list)) for x in d]):
            out[prefix] = ', '.join([str(x) for x in d])[:300]
    elif d is not None and not isinstance(d, bool):
        out[prefix] = str(d)[:300]
    elif isinstance(d, bool):
        out[prefix] = 'Yes' if d else 'No'


def key_shape(d, depth):
    # names only, never values: safe to log
    if isinstance(d, dict) and depth < 3:
        return dict([(k, key_shape(d[k], depth + 1)) for k in list(d.keys())[:30]])
    if isinstance(d, list):
        return ['list:%d' % len(d)] + ([key_shape(d[0], depth + 1)] if d else [])
    return 'value'





def fail(db, report_id, msg):
    db.database.update('nip_reports', record_id=report_id, data={'status': 'failed', 'error': msg, 'updated_at': now_iso()})
    return {'success': False, 'error': msg}


def main(params, user_data, sdk_client):
    params = params or {}
    report_id = str(params.get('report_id') or '')
    run_id = str(params.get('run_id') or '')
    db = sdk_client
    rows = rows_of(db.database.from_('nip_reports').filter('id', 'eq', report_id).execute())
    if not rows:
        return {'success': False, 'error': 'Report not found.'}
    rep = rows[0]
    if rep.get('status') != 'processing':
        return {'success': True, 'skipped': True}
    owner_id = str(rep.get('owner_id'))
    prm = rep.get('parameters') or {}
    address = prm.get('address')
    reports = prm.get('reports') or []

    sc = None
    try:
        sc = sdk_client.secrets.get('SCRAPER_KEY')['value']
    except Exception:
        sc = None
    base = sc.get('base_url') if isinstance(sc, dict) else None
    token = sc.get('api_token') if isinstance(sc, dict) else None
    client = rule_text(db, 'scraper_client')
    process = rule_text(db, 'scraper_process_riskmeter')
    if not base or not token or not client or not process:
        return fail(db, report_id, UNAVAILABLE)
    root = str(base).rstrip('/')
    headers = {'Content-Type': 'application/json', 'Authorization': 'Token ' + str(token)}

    try:
        # one report row = one logical order attempt, so a repeated start can never order twice
        start_headers = dict(headers)
        start_headers['Idempotency-Key'] = report_id
        r = requests.post(root + '/api/scraper-runs/', json={'client': client, 'process': process, 'parameters': {'address': address, 'reports': reports}}, headers=start_headers, timeout=30)
    except Exception:
        return fail(db, report_id, UNAVAILABLE)
    if r.status_code >= 300:
        log('riskmeter start refused http=%s body_keys=%s' % (r.status_code, str(r.text)[:200] if r.status_code < 500 else ''), level='error')
        return fail(db, report_id, UNAVAILABLE)
    status_url = (r.json() or {}).get('status_url')
    if not status_url:
        return fail(db, report_id, UNAVAILABLE)

    started = time.time()
    result = None
    while time.time() - started < WAIT_SECONDS:
        time.sleep(POLL_SECONDS)
        try:
            g = requests.get(root + status_url, headers=headers, timeout=30)
        except Exception:
            continue
        if g.status_code >= 300:
            if g.status_code >= 500:
                continue
            return fail(db, report_id, UNAVAILABLE)
        body = g.json() or {}
        if body.get('status') in ('succeeded', 'partial', 'failed'):
            result = body
            break
        db.database.update('nip_reports', record_id=report_id, data={'updated_at': now_iso()})
    if result is None:
        return fail(db, report_id, TIMEOUT_MSG)
    if result.get('status') == 'failed':
        log('riskmeter run failed shape=%s' % json.dumps(key_shape(result, 0)), level='error')
        return fail(db, report_id, 'RiskMeter could not produce the reports. Please check the address and try again.')

    log('riskmeter result shape=%s' % json.dumps(key_shape(result.get('result'), 0)), level='info')
    res = result.get('result')

    files = []
    names = {}
    if isinstance(res, dict):
        for fl in (res.get('files') or []):
            if isinstance(fl, dict) and fl.get('key'):
                names[str(fl.get('key'))] = fl.get('display_name') or fl.get('name')
    i = 0
    for art in (result.get('artifacts') or []):
        if not isinstance(art, dict):
            continue
        fname = str(art.get('file_name') or art.get('name') or 'RiskMeter_Report.pdf')
        if not (fname.lower().endswith('.pdf') or 'pdf' in str(art.get('content_type') or '').lower()):
            continue
        i = i + 1
        content = None
        for link, use_auth in ((art.get('download_endpoint'), True), (art.get('download_url'), True), (art.get('signed_download_url'), False)):
            if not link or content:
                continue
            u = str(link)
            if u.startswith('/'):
                u = root + u
            try:
                d = requests.get(u, headers=(headers if use_auth else {}), timeout=90)
                if d.status_code < 300 and len(d.content) > 0:
                    content = d.content
            except Exception:
                content = None
        if not content:
            log('riskmeter artifact could not be downloaded index=%d' % i, level='error')
            continue
        nm = safe_name(art.get('key') or 'RiskMeter_Report')
        if not nm.lower().endswith('.pdf'):
            nm = nm + '.pdf'
        path = owner_id + '/' + run_id + '/riskmeter/' + report_id[:8] + '_' + str(i) + '_' + nm
        up = db.storage.from_('nip-reports').upload(files=[(nm, io.BytesIO(content), 'application/pdf')], paths=[path])
        if isinstance(up, dict) and up.get('failed_count'):
            continue
        shown = names.get(str(art.get('key'))) or fname
        files.append({'path': path, 'name': str(shown)[:150]})

    scores = {}
    if isinstance(res, dict):
        extra = dict([(k, res[k]) for k in res if k not in ('files', 'steps', 'address', 'reports', 'warnings', 'correlation')])
        scalar_items(extra, '', scores)
    if not files:
        return fail(db, report_id, 'RiskMeter finished but the report file could not be saved. Please try again.')
    prm2 = dict(prm)
    prm2['files'] = files
    prm2['scores'] = scores
    upd = {'status': 'complete', 'parameters': prm2, 'error': None, 'updated_at': now_iso()}
    if files:
        upd['file_ref'] = files[0]['path']
    db.database.update('nip_reports', record_id=report_id, data=upd)
    log('riskmeter complete run_id=%s files=%d scores=%d' % (run_id, len(files), len(scores)), level='info')
    return {'success': True, 'report_id': report_id, 'files': len(files), 'scores': len(scores)}
