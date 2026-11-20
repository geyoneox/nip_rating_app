APP_SLUG = 'nip_rating'
SUPER_SLUG = 'nip_rating-super-admin'
# Roles a Super Admin may give. Super Admin itself is never given or removed here.
GRANTABLE = ('nip_user', 'nip_reviewer', 'nip_admin')
RANK = {'nip_admin': 3, 'nip_reviewer': 2, 'nip_user': 1}
MAX_PAGES = 10


def is_super(user_data):
    if user_data.get('is_superuser'):
        return True
    for r in (user_data.get('roles') or []):
        if isinstance(r, dict) and r.get('slug') == SUPER_SLUG and r.get('source') == 'direct':
            return True
    return False


def direct_app_roles(u):
    """Names of the roles this app gave the person directly (inherited ones are skipped)."""
    out = []
    for r in (u.get('roles') or []):
        if isinstance(r, dict) and r.get('app_slug') == APP_SLUG and r.get('source') == 'direct':
            out.append(r.get('name'))
    return out


def summarize(u):
    names = direct_app_roles(u)
    nip = None
    for n in names:
        if n in RANK and (nip is None or RANK[n] > RANK[nip]):
            nip = n
    return {
        'username': u.get('username'),
        'email': u.get('email'),
        'full_name': u.get('full_name') or ((u.get('first_name') or '') + ' ' + (u.get('last_name') or '')).strip(),
        'is_active': bool(u.get('is_active')),
        'last_login': u.get('last_login'),
        'date_joined': u.get('date_joined'),
        'nip_role': nip,
        'is_super_admin': 'Super Admin' in names,
        'in_app': len(names) > 0,
    }


def rows_of(res):
    if isinstance(res, dict):
        return res.get('data') or []
    return res or []


def fetch_all(sdk_client, search):
    users = []
    for page in range(1, MAX_PAGES + 1):
        if search:
            batch = rows_of(sdk_client.users.list(page=page, page_size=100, search=search))
        else:
            batch = rows_of(sdk_client.users.list(page=page, page_size=100))
        users.extend(batch)
        if len(batch) < 100:
            break
    return users


def do_list(params, sdk_client):
    search = (params.get('search') or '').strip()
    role = params.get('role') or 'all'
    page = max(1, int(params.get('page') or 1))
    size = min(100, max(5, int(params.get('page_size') or 25)))
    # Only people who hold a role in this app. The tenant also holds people from other apps.
    rows = [r for r in (summarize(u) for u in fetch_all(sdk_client, search)) if r['in_app']]
    counts = {'all': len(rows), 'super_admin': 0, 'nip_admin': 0, 'nip_reviewer': 0, 'nip_user': 0, 'none': 0}
    for r in rows:
        if r['is_super_admin']:
            counts['super_admin'] = counts['super_admin'] + 1
        elif r['nip_role']:
            counts[r['nip_role']] = counts[r['nip_role']] + 1
        else:
            counts['none'] = counts['none'] + 1
    if role == 'super_admin':
        rows = [r for r in rows if r['is_super_admin']]
    elif role == 'none':
        rows = [r for r in rows if not r['is_super_admin'] and not r['nip_role']]
    elif role in GRANTABLE:
        rows = [r for r in rows if not r['is_super_admin'] and r['nip_role'] == role]
    keyed = [(str(r['username'] or '').lower(), i) for i, r in enumerate(rows)]
    keyed.sort()
    rows = [rows[i] for nm, i in keyed]
    start = (page - 1) * size
    return {'success': True, 'users': rows[start:start + size], 'total': len(rows), 'page': page,
            'page_size': size, 'counts': counts}


def do_set_role(params, user_data, sdk_client):
    username = str(params.get('username') or '').strip()
    role = str(params.get('role') or '').strip()
    if not username:
        return {'success': False, 'error': 'username is required.'}
    if role not in GRANTABLE:
        return {'success': False, 'error': 'role must be nip_user, nip_reviewer or nip_admin.'}
    target = sdk_client.users.get(username)
    if isinstance(target, dict) and isinstance(target.get('data'), dict):
        target = target['data']
    if not isinstance(target, dict) or not target.get('username'):
        return {'success': False, 'error': 'User not found.'}
    current = summarize(target)
    if current['is_super_admin']:
        return {'success': False, 'error': 'A Super Admin role is not changed here.'}
    if current['nip_role'] == role and len([n for n in direct_app_roles(target) if n in GRANTABLE]) == 1:
        return {'success': True, 'changed': False, 'username': username, 'role': role}
    slug = APP_SLUG + '-'
    # give the new role first so the person is never left without one
    sdk_client.users.assign_roles(roles=[slug + role], usernames=[username])
    others = [slug + n for n in direct_app_roles(target) if n in GRANTABLE and n != role]
    if others:
        sdk_client.users.revoke_roles(roles=others, usernames=[username])
    log('AUDIT role_changed by=%s user=%s from=%s to=%s' % (user_data.get('username'), username, current['nip_role'], role), level='info')
    return {'success': True, 'changed': True, 'username': username, 'role': role, 'previous': current['nip_role']}


def main(params, user_data, sdk_client):
    """Super Admin only. action 'list' returns users with their NIP role; 'set_role' changes it."""
    params = params or {}
    if not is_super(user_data):
        return {'success': False, 'error': 'Only a Super Admin can manage users.'}
    action = params.get('action') or 'list'
    try:
        if action == 'list':
            return do_list(params, sdk_client)
        if action == 'set_role':
            return do_set_role(params, user_data, sdk_client)
    except Exception as e:
        log('nip_manage_users %s failed: %s' % (action, str(e)[:200]), level='error')
        return {'success': False, 'error': 'The request could not be completed.'}
    return {'success': False, 'error': 'Unknown action.'}
