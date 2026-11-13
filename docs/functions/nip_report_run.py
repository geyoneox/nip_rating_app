from datetime import datetime, timezone
import uuid

# Only RiskMeter has a Dexter process today. OSHA and SAFER need their own Dexter handlers.
SUPPORTED = ['riskmeter']
RISKMETER_REPORTS = [
    'Crime Risk Score', 'Fire Protection Class', 'Flash Flood Risk Score', 'Flood Risk Score',
    'Hail Probability', 'Wind Probability', 'Distance to Shore', 'Wildfire Risk Score',
]


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def rows_of(res):
    if isinstance(res, dict):
        return res.get('data') or []
    return res or []


def main(params, user_data, sdk_client):
    params = params or {}
    caller = str(user_data.get('id'))
    run_id = str(params.get('run_id') or '')
    report_type = str(params.get('report_type') or '')
    p = params.get('params') or {}
    if not run_id:
        return {'success': False, 'error': 'run_id is required.'}
    if report_type not in ('riskmeter', 'osha', 'safer'):
        return {'success': False, 'error': 'Choose RiskMeter, OSHA or SAFER.'}
    if report_type not in SUPPORTED:
        return {'success': False, 'error': 'The %s report is not available yet. Its lookup service has not been set up.' % report_type.upper()}

    address = ' '.join(str(p.get('address') or '').split())
    reports = [str(x) for x in (p.get('reports') or [])]
    if not address:
        return {'success': False, 'error': 'Enter an insured/location address for RiskMeter.'}
    if len(address) > 300:
        return {'success': False, 'error': 'The address is too long.'}
    if not reports:
        return {'success': False, 'error': 'Select at least one RiskMeter report.'}
    for r in reports:
        if r not in RISKMETER_REPORTS:
            return {'success': False, 'error': 'One of the selected reports is not recognised.'}

    runs = rows_of(sdk_client.database.from_('nip_runs').filter('id', 'eq', run_id).execute())
    if not runs:
        return {'success': False, 'error': 'This run was not found.'}
    run = runs[0]
    owner_id = str(run.get('owner_id'))
    if owner_id != caller and not (user_data.get('is_cloud_user') or user_data.get('is_superuser')):
        return {'success': False, 'error': 'Only the owner of this run can order reports.'}
    if run.get('lifecycle_status') != 'active':
        return {'success': False, 'error': 'This run is being deleted.'}

    existing = rows_of(sdk_client.database.from_('nip_reports').filter('run_id', 'eq', run_id).filter('report_type', 'eq', report_type).filter('status', 'eq', 'processing').execute())
    if existing:
        return {'success': False, 'error': 'A %s report is already being generated for this run.' % report_type}

    report_id = str(uuid.uuid4())
    now = now_iso()
    # the address is stored with the run's own data, never in function logs
    sdk_client.database.create('nip_reports', {
        'id': report_id, 'run_id': run_id, 'owner_id': owner_id, 'report_type': report_type,
        'parameters': {'address': address, 'reports': reports},
        'status': 'processing', 'created_at': now, 'updated_at': now,
    })
    try:
        sdk_client.functions.execute('nip_report_worker', params={'report_id': report_id, 'run_id': run_id}, is_async=True)
    except Exception:
        sdk_client.database.update('nip_reports', record_id=report_id, data={'status': 'failed', 'error': 'The report could not be started. Please try again.', 'updated_at': now_iso()})
        return {'success': False, 'error': 'The report could not be started. Please try again.'}

    log('report started run_id=%s type=%s reports=%d' % (run_id, report_type, len(reports)), level='info')
    return {'success': True, 'report_id': report_id, 'run_id': run_id, 'report_type': report_type}
