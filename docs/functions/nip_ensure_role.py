SITE_URL = 'https://insurance.taruvi.cloud'
APP_SLUG = 'nip_rating'
DEFAULT_ROLE = 'nip_rating-nip_user'
# A person holding any of these already has a NIP role. Nothing is changed for them.
KNOWN_ROLES = ('nip_user', 'nip_reviewer', 'nip_admin', 'super admin', 'nip_rating-super-admin')


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


def has_nip_role(user_data):
    if user_data.get('is_cloud_user') or user_data.get('is_superuser'):
        return True
    for n in role_names(user_data):
        low = n.lower()
        if low in KNOWN_ROLES or low.replace('nip_rating-', '') in KNOWN_ROLES:
            return True
    return False


def role_client(sdk_client):
    # Preferred: a credential kept in the secret NIP_SERVICE_API_KEY that is allowed to assign roles.
    # Without it the caller's own access is used, which the platform may refuse.
    try:
        key = sdk_client.secrets.get('NIP_SERVICE_API_KEY')['value']
        from taruvi import Client
        return Client(SITE_URL, APP_SLUG, mode='sync', api_key=key), 'service'
    except Exception:
        return sdk_client, 'caller'


def main(params, user_data, sdk_client):
    """Gives the caller the nip_user role the first time they open the app.

    Only the caller can be changed and only to nip_user. Nobody can use this to
    get nip_reviewer, nip_admin or Super Admin. Takes no username from the request,
    except that an admin may name a person to test with.
    """
    params = params or {}
    username = user_data.get('username')
    target = username
    if params.get('username') and params.get('username') != username:
        names = [n.lower() for n in role_names(user_data)]
        admin = bool(user_data.get('is_cloud_user') or user_data.get('is_superuser')) or any(
            n in ('nip_admin', 'nip_rating-nip_admin', 'super admin', 'nip_rating-super-admin') for n in names)
        if not admin:
            return {'success': False, 'error': 'Only an admin can name another person.'}
        target = str(params.get('username'))
        check = None
    else:
        check = user_data

    if not target:
        return {'success': False, 'error': 'Could not tell who is signed in.'}
    if check is not None and has_nip_role(check):
        return {'success': True, 'assigned': False, 'reason': 'already has a NIP role'}

    client, how = role_client(sdk_client)
    try:
        client.users.assign_roles(roles=[DEFAULT_ROLE], usernames=[target])
    except Exception as e:
        log('nip_ensure_role could not assign role to %s via %s: %s' % (target, how, str(e)[:200]), level='error')
        return {'success': False, 'assigned': False, 'via': how,
                'error': 'Could not assign the nip_user role. An admin must assign it.'}
    log('AUDIT role_auto_assigned user=%s role=%s via=%s' % (target, DEFAULT_ROLE, how), level='info')
    return {'success': True, 'assigned': True, 'role': DEFAULT_ROLE, 'via': how}
