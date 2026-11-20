import math
import re
from datetime import datetime, timezone

SITE_URL = 'https://insurance.taruvi.cloud'
APP_SLUG = 'nip_rating'
PAGE = 500

SPECIAL_STATES = ['CA', 'FL', 'GA', 'TX']
STATE_NAMES = {'CALIFORNIA': 'CA', 'FLORIDA': 'FL', 'GEORGIA': 'GA', 'TEXAS': 'TX'}

INCOMPLETE_FACTOR = 1.33          # Incomplete vehicle: chassis value = MSRP x 1.33
GROWTH_UP = 1.03                  # OCN calculator, vehicle newer than the average year
GROWTH_DOWN = 0.97                # OCN calculator, vehicle older than the average year
DEFAULT_DUMP_SICS = ['79']        # ref_rules 'dump_sic_codes' (comma separated text) overrides this
# (up to and including this OCN, deductible); None = no upper limit. ref_rules 'deductible_tiers' overrides this
DEFAULT_TIERS = [(50000, 1000), (100000, 2000), (None, 5000)]
NO_CALCULATOR_PROGRAMS = ['treepro']   # the OCN calculator never runs for these programs
TRAILER_TYPES = ['semi_trailer', 'utility_trailer', 'trailer']
CALC_COLUMNS = ['class_code', 'ocn_value', 'ba_comp_answer', 'ba_comp_deductible', 'ba_coll_answer', 'ba_coll_deductible']

# detected type -> ref_class_codes.category (types decided by weight are handled in class_category)
FIXED_CATEGORY = {
    'mobile_equipment': 'mobile_equipment',
    'semi_trailer': 'semi_trailer',
    'utility_trailer': 'utility_trailer',
    'trailer': 'trailer',
    'passenger_car': 'private_passenger',
}
TRACTOR_CATEGORIES = ['tractor_over_45000', 'tractor_up_to_45000']
TRUCK_CATEGORIES = ['truck_45001_plus', 'truck_20001_45000', 'truck_10001_20000', 'truck_up_to_10000']


def now_iso():
    return datetime.now(timezone.utc).isoformat()


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


def service_client(sdk_client):
    # calculated columns cannot be written by a normal user (access policy), so a service credential writes them
    try:
        key = sdk_client.secrets.get('NIP_SERVICE_API_KEY')['value']
    except Exception:
        return None
    try:
        from taruvi import Client
        return Client(SITE_URL, APP_SLUG, mode='sync', api_key=key)
    except Exception:
        return None


# ---------------- value helpers ----------------
def clean_text(v):
    # blank and the literal "Not Available" both mean "no value"
    if v is None:
        return ''
    s = ' '.join(str(v).split())
    if s.lower() == 'not available':
        return ''
    return s


def to_number(v):
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace('$', '').replace(',', '').strip()
    try:
        return float(s)
    except ValueError:
        return None


def is_yes(v):
    return str(v or '').strip().lower() in ('yes', 'y', 'true', '1')


def state_code(v):
    s = clean_text(v).upper()
    if not s:
        return ''
    if s in STATE_NAMES:
        return STATE_NAMES[s]
    return s[:2]


def round_half_up(x):
    return int(math.floor(x + 0.5))


# ---------------- vehicle type detection ----------------
def is_trailer_row(body_type, model, make):
    # a row is a trailer when BODY_TYPE, MODEL or MAKE contains "trailer"
    for v in (body_type, model, make):
        if 'trailer' in str(v or '').lower():
            return True
    return False


VEHICLE_WORDS_RE = (r'\b(suv|sport utility|utility vehicle|pickup|truck|van|cab|chassis|ford|chevrolet|chevy|gmc|ram|dodge|'
                    r'toyota|nissan|isuzu|international|freightliner|kenworth|peterbilt|mack|hino|mitsubishi|honda|jeep|'
                    r'gator|deere|kubota|polaris|club car|cart|atv|utv|tractor|mower|loader|bobcat|skid|excavator)\b')
TRAILER_NAME_RE = r'\b(big\s*(tex|tx)|utility|carson)\b'
# VIN prefixes of trailer makers (Big Tex, DV, Carson, and two others seen on real applications)
TRAILER_WMI = ['16V', '1D9', '4HX', '7G7', '4GM']


def name_looks_like_trailer(v):
    # ASSUMED rule: a row whose make/model says "Utility", "Big Tex" or "Carson", or whose VIN starts with a trailer
    # maker's prefix (and that is not a truck, van, SUV or machine by name), is a trailer. Unlike a row that says
    # "trailer", it is still validated with PriceDigest, because the original app used the PriceDigest price for its cost.
    text = ' '.join([clean_text(v.get('make')), clean_text(v.get('model')), clean_text(v.get('body_type'))]).lower()
    if not text or re.search(VEHICLE_WORDS_RE, text):
        return False
    vin = ''.join(str(v.get('vin') or '').upper().split())
    if vin[:3] in TRAILER_WMI:
        return True
    return bool(re.search(TRAILER_NAME_RE, text))


def type_texts(v, pd, trailer_row):
    # returns (type text, subtype text), both lower case
    body = clean_text(v.get('body_type'))
    if trailer_row:
        t = body
        if 'trailer' not in t.lower():
            t = (t + ' trailer').strip()
        return t.lower(), clean_text(v.get('model')).lower()
    t = clean_text(pd.get('vehicle_type')) or body
    return t.lower(), clean_text(pd.get('vehicle_subtype')).lower()


def detect_type(t, s, tractor_flag):
    # first match wins. Returns None when nothing matches or there is no type text.
    if not t:
        return None

    def either(words):
        for w in words:
            if w in t or w in s:
                return True
        return False

    if 'mobile equipment' in t or ('mobile' in t and 'auto' not in t):
        return 'mobile_equipment'
    if either(['semi-trailer', 'semi trailer', 'semitrailer']):
        return 'semi_trailer'
    if either(['utility trailer']):          # not just "utility": "Sport Utility Vehicle" is not a trailer
        return 'utility_trailer'
    if either(['trailer']):
        return 'trailer'
    if tractor_flag or either(['tractor']):
        return 'tractor'
    if either(['truck', 'commercial', 'cab', 'chassis', 'suv', 'sport utility']):
        return 'truck_suv'
    if 'van' in t or 'minivan' in t or 'van' in s or 'cargo' in s:
        return 'van'
    if any(w in t for w in ('ppt', 'passenger', 'coupe', 'sedan')) or 'private passenger' in t or 'private passenger' in s:
        return 'passenger_car'
    return None


def is_dump(v, dump_sics):
    # "dump" in BODY_TYPE, MODEL or NET_VEH_DR_CR, or the vehicle SIC is exactly a listed code (79)
    for col in ('body_type', 'model', 'net_veh_dr_cr'):
        if 'dump' in str(v.get(col) or '').lower():
            return True
    return clean_text(v.get('sic')) in dump_sics


# ---------------- class code ----------------
def positive_weight(v):
    w = to_number(v)
    if w is None or w <= 0:
        return None
    return int(math.ceil(w))    # 20,000.5 is above the 20,000 limit


def pick_band(rows, categories, weight):
    if weight is None:
        return None
    for r in rows:
        if r.get('category') not in categories:
            continue
        lo = to_number(r.get('weight_min'))
        hi = to_number(r.get('weight_max'))
        if (lo is None or weight >= lo) and (hi is None or weight <= hi):
            return r
    return None


def class_row(detected, gvw, gcw, class_rows):
    if detected in FIXED_CATEGORY:
        for r in class_rows:
            if r.get('category') == FIXED_CATEGORY[detected]:
                return r
        return None
    if detected == 'tractor':
        return pick_band(class_rows, TRACTOR_CATEGORIES, gcw)
    if detected in ('truck_suv', 'van'):
        return pick_band(class_rows, TRUCK_CATEGORIES, gvw)
    return None


def class_code_for(detected, gvw, gcw, special, dump, class_rows):
    r = class_row(detected, gvw, gcw, class_rows)
    if not r:
        return None
    if dump:
        col = 'dump_special_state_code' if special else 'dump_standard_code'
    else:
        col = 'special_state_code' if special else 'standard_code'
    return clean_text(r.get(col)) or None


# ---------------- original cost new ----------------
def ocn_vehicle_type(detected, t, s, gvw, gcw):
    # name of the ref_ocn_lookup vehicle type. Weight bands follow the class code bands.
    if not t:
        return None
    text = t + ' ' + s
    words = text.replace('/', ' ').replace('-', ' ').split()
    if 'atv' in words or 'golf' in words:
        return 'ATV/Golf Cart'
    if detected == 'mobile_equipment':
        return 'Sp Mobile EQ'
    if detected == 'semi_trailer':
        return 'Semitrailers'
    if detected == 'utility_trailer':
        return 'Service or Utility Trailers'
    if detected == 'trailer':
        return 'Trailers'
    if detected == 'passenger_car':
        return 'PPT'
    # With no weight (for example a VIN PriceDigest could not read) the lowest band is used for the OCN type.
    # The class code does not do this: without a weight it stays blank.
    if detected == 'tractor':
        if gcw is not None and gcw > 45000:
            return 'Extra Heavy Truck-Tractors'
        return 'Heavy Truck-Tractors'
    if detected in ('truck_suv', 'van'):
        if gvw is None or gvw <= 10000:
            return 'Light Trucks'
        if gvw <= 20000:
            return 'Medium Trucks'
        if gvw <= 45000:
            return 'Heavy Trucks'
        return 'Extra Heavy Trucks'
    return 'All Other'


def calculator_ocn(row, year):
    if not row or year is None:
        return None
    avg_cost = to_number(row.get('avg_cost_new'))
    avg_year = to_number(row.get('avg_model_year'))
    if avg_cost is None or avg_year is None:
        return None
    if year >= avg_year:
        value = avg_cost * (GROWTH_UP ** (year - avg_year))
    else:
        value = avg_cost * (GROWTH_DOWN ** (avg_year - year))
    return round_half_up(value)


def pick_ocn(trailer_row, cost, msrp, incomplete, lookup_row, year):
    cost = cost if (cost is not None and cost > 0) else None
    msrp = msrp if (msrp is not None and msrp > 0) else None
    if trailer_row:
        # tabbed trailers are not validated and never use the calculator: the application cost is the value
        return cost
    candidates = []
    if cost is not None:
        candidates.append(cost)
    if msrp is not None:
        candidates.append(round(msrp * INCOMPLETE_FACTOR, 2) if incomplete else msrp)
    if candidates:
        return max(candidates)
    return calculator_ocn(lookup_row, year)


# ---------------- BA collision / comprehensive ----------------
def deductible_for_ocn(ocn, tiers):
    # first tier whose limit is at or above the OCN (50,000 exactly is still the 1,000 tier)
    if ocn is None:
        return None
    for up_to, ded in tiers:
        if up_to is None or ocn <= up_to:
            return ded
    return None


def ba_answer(raw, ocn, trailer, tiers):
    # returns (answer, deductible)
    s = clean_text(raw)
    if not s:
        return None, None
    if s.lower() in ('no', 'n', 'none', 'n/a', 'na'):
        return 'No', None
    amount = to_number(s)
    if amount is not None and amount > 0:
        return 'Yes', amount                  # an amount written on the application is kept
    if trailer:
        return 'Yes', 1000.0
    return 'Yes', deductible_for_ocn(ocn, tiers)


# ---------------- one vehicle ----------------
def compute_vehicle(v, pd, ctx):
    # a row that says "trailer", or is flagged by extraction, is a tabbed-only trailer: no PriceDigest, cost from the application
    trailer_row = is_trailer_row(v.get('body_type'), v.get('model'), v.get('make')) or bool(v.get('is_trailer'))
    # a row that only looks like a trailer by name or VIN prefix is rated as a trailer but keeps its PriceDigest values
    # (the original app only rated it as a trailer when PriceDigest returned a price for it; with no price it gets no class code)
    msrp_found = to_number((pd or {}).get('msrp'))
    named_trailer = (not trailer_row) and name_looks_like_trailer(v) and msrp_found is not None and msrp_found > 0
    pd = {} if trailer_row else (pd or {})      # PriceDigest is skipped for trailer rows
    t, s = type_texts(v, pd, trailer_row)
    if named_trailer:
        t, s = 'trailer', ''
    detected = detect_type(t, s, is_yes(pd.get('is_tractor')))
    gvw = positive_weight(pd.get('gross_vehicle_weight'))
    gcw = positive_weight(pd.get('gross_combine_weight'))
    # ASSUMED rule: PriceDigest gave a weight but no vehicle type, and it is not a tractor, so treat it as a truck
    if detected is None and gvw is not None and not is_yes(pd.get('is_tractor')):
        detected = 'truck_suv'

    special = state_code(v.get('garaging_state')) in SPECIAL_STATES or (
        not clean_text(v.get('garaging_state')) and state_code(ctx.get('insured_state')) in SPECIAL_STATES)
    dump = is_dump(v, ctx['dump_sics'])
    code = class_code_for(detected, gvw, gcw, special, dump, ctx['class_rows'])

    # the Dexter scraper sends a single letter ("I" = incomplete); older data may spell the word out
    complete_flag = clean_text(pd.get('complete_incomplete')).lower()
    incomplete = complete_flag == 'i' or complete_flag.startswith('incomplete')
    ocn_type = ocn_vehicle_type(detected, t, s, gvw, gcw)
    lookup_row = ctx['ocn_rows'].get(ocn_type) if ocn_type else None
    year = v.get('year')
    year = int(year) if isinstance(year, (int, float)) and not isinstance(year, bool) else None
    ocn = pick_ocn(trailer_row, to_number(v.get('cost_new')), to_number(pd.get('msrp')), incomplete, lookup_row, year)

    trailer_like = trailer_row or detected in TRAILER_TYPES
    comp_answer, comp_ded = ba_answer(v.get('comp_otc'), ocn, trailer_like, ctx['tiers'])
    coll_answer, coll_ded = ba_answer(v.get('coll'), ocn, trailer_like, ctx['tiers'])
    return {
        'class_code': code,
        'ocn_value': ocn,
        'ba_comp_answer': comp_answer,
        'ba_comp_deductible': comp_ded,
        'ba_coll_answer': coll_answer,
        'ba_coll_deductible': coll_ded,
    }


def same_value(a, b):
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(float(a) - float(b)) < 0.005
    return str(a) == str(b)


# ---------------- reference data ----------------
def parse_tiers(rule_row):
    # value_json: [{"up_to": 50000, "deductible": 1000}, ..., {"up_to": null, "deductible": 5000}]
    try:
        raw = (rule_row or {}).get('value_json')
        tiers = [(None if x.get('up_to') is None else float(x['up_to']), float(x['deductible'])) for x in raw]
        tiers.sort(key=lambda t: (t[0] is None, t[0] or 0))
        if tiers and tiers[-1][0] is None:
            return tiers
    except Exception:
        pass
    return DEFAULT_TIERS


def parse_dump_sics(rule_row):
    text = clean_text((rule_row or {}).get('value_text'))
    if not text:
        return DEFAULT_DUMP_SICS
    return [p.strip() for p in text.split(',') if p.strip()]


def read_all(db, table, filters):
    out = []
    page = 1
    while page < 200:
        q = db.database.from_(table)
        for col, val in filters:
            q = q.filter(col, 'eq', val)
        res = rows_of(q.page(page).page_size(PAGE).execute())
        out.extend(res)
        if len(res) < PAGE:
            break
        page = page + 1
    return out


def load_context(db, run):
    class_rows = rows_of(db.database.from_('ref_class_codes').page_size(100).execute())
    rules = {}
    for r in rows_of(db.database.from_('ref_rules').page_size(200).execute()):
        rules[r.get('rule_key')] = r
    ocn_rows = {}
    program = ''
    program_id = run.get('program_id')
    if program_id:
        progs = rows_of(db.database.from_('ref_programs').filter('id', 'eq', str(program_id)).execute())
        if progs:
            program = clean_text(progs[0].get('name')).lower()
        if program not in NO_CALCULATOR_PROGRAMS:
            for r in read_all(db, 'ref_ocn_lookup', [('program_id', str(program_id))]):
                ocn_rows[r.get('vehicle_type')] = r
    return {
        'class_rows': class_rows,
        'ocn_rows': ocn_rows,
        'tiers': parse_tiers(rules.get('deductible_tiers')),
        'dump_sics': parse_dump_sics(rules.get('dump_sic_codes')),
        'insured_state': run.get('insured_state'),
        'program': program,
    }


def main(params, user_data, sdk_client):
    params = params or {}
    caller = str(user_data.get('id'))
    run_id = str(params.get('run_id') or '')
    if not run_id:
        return {'success': False, 'error': 'run_id is required.'}
    only_ids = [str(x) for x in (params.get('vehicle_ids') or [])]

    # Prefer the service credential. Without it (secret not created yet) the caller's own access is used;
    # the owner / admin check below still decides who may recalculate a run.
    db = service_client(sdk_client)
    if db is None:
        db = sdk_client

    runs = rows_of(db.database.from_('nip_runs').filter('id', 'eq', run_id).execute())
    if not runs:
        return {'success': False, 'error': 'This run was not found.'}
    run = runs[0]
    if not (is_admin(user_data) or str(run.get('owner_id')) == caller):
        return {'success': False, 'error': 'You do not have permission to recalculate this run.'}
    if run.get('lifecycle_status') != 'active':
        return {'success': False, 'error': 'This run is being deleted.'}

    ctx = load_context(db, run)
    if not ctx['class_rows']:
        return {'success': False, 'error': 'The class code table is empty. Please ask an administrator to load it.'}

    vehicles = read_all(db, 'nip_vehicles', [('run_id', run_id)])
    pds = {}
    for r in read_all(db, 'nip_validation_results', [('run_id', run_id)]):
        pds[str(r.get('vin') or '').upper()] = r

    changed = 0
    checked = 0
    for v in vehicles:
        if only_ids and str(v.get('id')) not in only_ids:
            continue
        checked = checked + 1
        vin = str(v.get('vin') or '').upper()
        pd = pds.get(vin) if (vin and (pds.get(vin) or {}).get('success')) else {}
        new = compute_vehicle(v, pd, ctx)
        diff = {}
        for col in CALC_COLUMNS:
            if not same_value(v.get(col), new[col]):
                diff[col] = new[col]
        if diff:
            diff['updated_at'] = now_iso()
            # one single-row update per vehicle (bulk updates would not fire events)
            db.database.update('nip_vehicles', record_id=v.get('id'), data=diff)
            changed = changed + 1

    log('recompute run_id=%s by=%s checked=%d changed=%d' % (run_id, caller, checked, changed), level='info')
    return {'success': True, 'run_id': run_id, 'checked': checked, 'changed': changed}
