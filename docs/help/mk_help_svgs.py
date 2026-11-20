import os

OUT = os.path.join('public', 'help', 'img')
os.makedirs(OUT, exist_ok=True)
NAVY, BLUE, RED, GREEN, AMBER, GREY, LINE, BG = '#073b5c', '#1976d2', '#d32f2f', '#2e7d32', '#ed6c02', '#5f6b76', '#d9dee3', '#eef0f3'
W, H = 1000, 560


def esc(s):
    return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def text(x, y, s, size=14, color='#1f2933', weight=400, anchor='start'):
    return '<text x="%d" y="%d" font-family="Roboto, Arial, sans-serif" font-size="%d" fill="%s" font-weight="%d" text-anchor="%s">%s</text>' % (x, y, size, color, weight, anchor, esc(s))


def box(x, y, w, h, fill='#fff', stroke=LINE, r=6, sw=1):
    return '<rect x="%d" y="%d" width="%d" height="%d" rx="%d" fill="%s" stroke="%s" stroke-width="%d"/>' % (x, y, w, h, r, fill, stroke, sw)


def button(x, y, label, kind='contained', color=BLUE, w=None):
    w = w or (len(label) * 8 + 34)
    if kind == 'contained':
        return box(x, y, w, 34, color, color, 4) + text(x + w / 2, y + 22, label.upper(), 12, '#fff', 500, 'middle')
    return box(x, y, w, 34, '#fff', color, 4) + text(x + w / 2, y + 22, label.upper(), 12, color, 500, 'middle')


def callout(x, y, w, h, n):
    # numbered red frame around the element a step refers to
    return ('<rect x="%d" y="%d" width="%d" height="%d" rx="8" fill="none" stroke="%s" stroke-width="3" stroke-dasharray="7 4"/>' % (x - 5, y - 5, w + 10, h + 10, RED)
            + '<circle cx="%d" cy="%d" r="14" fill="%s"/>' % (x - 5, y - 5, RED) + text(x - 5, y, n, 14, '#fff', 700, 'middle'))


def frame(title, active, body, caption):
    s = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d" role="img" aria-label="%s">' % (W, H, W, H, esc(caption)),
         '<rect width="%d" height="%d" fill="%s"/>' % (W, H, BG),
         '<rect width="%d" height="48" fill="%s"/>' % (W, NAVY), text(18, 31, 'NIP Rating', 19, '#fff', 500),
         '<circle cx="912" cy="24" r="11" fill="none" stroke="#9de5fd" stroke-width="2"/>' + text(912, 29, '?', 14, '#9de5fd', 700, 'middle'),
         '<circle cx="958" cy="24" r="11" fill="none" stroke="#9de5fd" stroke-width="2"/>' + '<circle cx="958" cy="21" r="4" fill="none" stroke="#9de5fd" stroke-width="2"/>',
         '<rect x="0" y="48" width="72" height="%d" fill="#fff" stroke="%s"/>' % (H - 48, LINE)]
    for i, (lab, key) in enumerate((('Runs', 'runs'), ('Reports', 'reports'), ('Admin', 'admin'))):
        y = 70 + i * 62
        if key == active:
            s.append('<rect x="0" y="%d" width="72" height="54" fill="%s"/>' % (y - 8, BLUE))
        s.append('<rect x="27" y="%d" width="18" height="16" rx="3" fill="%s"/>' % (y, '#fff' if key == active else GREY))
        s.append(text(36, y + 34, lab, 10, '#fff' if key == active else GREY, 500, 'middle'))
    s.append(box(92, 66, 890, 476, '#fff', LINE, 8))
    s.append(text(116, 104, title.upper(), 22, '#1f2933', 500))
    s.extend(body)
    s.append(text(500, 554, caption, 11, GREY, 400, 'middle'))
    s.append('</svg>')
    return '\n'.join(s)


def table(x, y, cols, rows, widths, highlight=None):
    out = [box(x, y, sum(widths), 34 + 34 * len(rows), '#fff', LINE, 4)]
    cx = x
    for c, w in zip(cols, widths):
        out.append(text(cx + 10, y + 22, c.upper(), 10, GREY, 500))
        cx += w
    out.append('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s"/>' % (x, y + 34, x + sum(widths), y + 34, LINE))
    for i, r in enumerate(rows):
        ry = y + 34 + 34 * i
        if highlight is not None and i == highlight:
            out.append('<rect x="%d" y="%d" width="%d" height="34" fill="#fdecea"/>' % (x + 1, ry + 1, sum(widths) - 2))
        cx = x
        for v, w in zip(r, widths):
            color = BLUE if v and str(v).startswith('#') is False and cx == x else '#1f2933'
            out.append(text(cx + 10, ry + 22, v, 12, '#1f2933'))
            cx += w
    return out


def stat(x, y, w, label, value, tone=None):
    fill = {'error': '#fdecea', 'success': '#e8f5e9', 'warning': '#fff4e5', 'info': '#e8f0fe'}.get(tone, '#fff')
    col = {'error': RED, 'success': GREEN, 'warning': AMBER, 'info': BLUE}.get(tone, '#1f2933')
    return [box(x, y, w, 62, fill, LINE, 6), text(x + 12, y + 22, label, 11, col if tone else GREY, 500), text(x + 12, y + 50, value, 22, col, 500)]


imgs = {}

# 1 runs list
b = [text(116, 126, 'Upload PDFs, extract VIN tables, and validate results.', 13, GREY),
     button(800, 82, 'New Validation', w=160), callout(800, 82, 160, 34, 1),
     box(116, 146, 300, 40, '#f0f0f0', '#f0f0f0', 4), text(130, 171, 'Search runs', 13, GREY),
     box(430, 146, 150, 40, '#f0f0f0', '#f0f0f0', 4), text(444, 171, 'Status', 13, GREY), callout(116, 146, 464, 40, 2)]
b += table(116, 206, ['File', 'Insured', 'Status', 'Vehicles', 'Created'],
           [['Sample Fleet Application.pdf', 'Sample Landscaping Co.', 'Validated', '42', 'Nov 19, 2026'],
            ['Example Contractors App.pdf', 'Example Contractors LLC', 'Ready to validate', '120', 'Nov 18, 2026'],
            ['Demo Vehicle List.xlsx', 'Demo Transport Inc.', 'Failed', '-', 'Nov 17, 2026']], [250, 210, 150, 90, 142])
b.append(callout(116, 240, 842, 34, 3))
imgs['01-runs-list'] = frame('VIN Validation - Runs', 'runs', b, 'Runs page: 1 New Validation, 2 search and status filter, 3 click a run to open it')

# 2 new validation
b = [box(250, 120, 500, 330, '#fff', LINE, 10), text(274, 156, 'New Validation', 18, '#1f2933', 500),
     text(274, 184, 'Upload the tabbed application (PDF, .xlsx or .xls, up to 50 MB).', 12, GREY),
     box(274, 206, 452, 120, '#f7f9fb', BLUE, 8), text(500, 262, 'Choose file', 15, BLUE, 500, 'middle'),
     text(500, 286, 'Sample Fleet Application.pdf', 12, GREY, 400, 'middle'), callout(274, 206, 452, 120, 1),
     button(560, 392, 'Start Extraction', w=166), callout(560, 392, 166, 34, 2), button(470, 392, 'Cancel', 'outlined', w=80)]
imgs['02-new-validation'] = frame('VIN Validation - Runs', 'runs', b, 'New Validation: 1 choose the file, 2 Start Extraction')

# 3 extraction
b = [button(116, 82, 'Back to Runs', 'outlined', w=130),
     box(116, 136, 842, 92, '#e8f0fe', '#c5d8fb', 6), text(136, 164, 'Extraction is in progress. This view will refresh automatically.', 14, BLUE, 500),
     '<rect x="136" y="180" width="800" height="8" rx="4" fill="#c5d8fb"/><rect x="136" y="180" width="420" height="8" rx="4" fill="%s"/>' % BLUE,
     text(136, 212, '25/47 parts read', 12, GREY), callout(116, 136, 842, 92, 1),
     box(116, 250, 842, 46, '#fff', LINE, 6), text(136, 279, 'Extraction read 24 pages in 5 parts in 40 s   v', 14, '#1f2933', 500), callout(116, 250, 842, 46, 2),
     text(136, 330, 'Vehicles  - Base kept: 42 rows from AUTO, VEH SCHED', 12, GREY),
     text(136, 352, 'Equipment (IM) - Base kept: 18 rows from IM', 12, GREY)]
imgs['03-extraction'] = frame('Sample Fleet Application.pdf', 'runs', b, 'Run page: 1 progress while extracting, 2 summary of what was read once it finishes')

# 4 vehicles dashboard
b = [box(116, 120, 300, 40, '#fff', LINE, 4), text(130, 145, 'Program Name: Select program...', 13, GREY), callout(116, 120, 300, 40, 1),
     text(116, 196, 'AUTO (42)      IM (18)      DRIVER (6)', 14, BLUE, 500), '<rect x="116" y="204" width="80" height="3" fill="%s"/>' % BLUE,
     text(116, 236, 'VIN VALIDATION STATUS DASHBOARD', 13, '#1f2933', 500)]
for i, (lab, val, tone) in enumerate((('Unique VINs Queued', '30', None), ('Duplicate Rows', '1', 'error'), ('Invalid VINs', '0', 'warning'), ('Blank / Placeholder', '0', None), ('Trailers', '11', None))):
    b += stat(116 + i * 168, 248, 158, lab, val, tone)
for i, (lab, val, tone) in enumerate((('TOTAL VEHICLES', '30', None), ('PASSED', '29', 'success'), ('FAILED', '1', 'error'), ('PENDING', '0', 'info'))):
    b += stat(116 + i * 210, 322, 200, lab, val, tone)
b += [button(116, 410, 'Validate VINs (PriceDigest)', w=230), callout(116, 410, 230, 34, 2),
      button(360, 410, 'Validate Selected VINs (0)', 'outlined', w=220), button(594, 410, 'Retry Failed (1)', 'outlined', RED, 150), callout(594, 410, 150, 34, 3)]
imgs['04-vehicles-dashboard'] = frame('Sample Fleet Application.pdf', 'runs', b, 'AUTO tab: 1 choose the program, 2 validate the VINs, 3 retry the ones that failed')

# 5 failure filter + edit
b = [text(116, 128, 'FAILURE BREAKDOWN & FILTERS  (Click a pill to filter the vehicle table below)', 12, GREY, 500),
     box(116, 142, 230, 34, RED, RED, 17), text(231, 164, 'PriceDigest lookup failed   1', 13, '#fff', 500, 'middle'), callout(116, 142, 230, 34, 1),
     box(358, 142, 120, 34, '#fff', LINE, 17), text(418, 164, 'Clear Filter x', 13, '#1f2933', 500, 'middle')]
b += table(116, 200, ['VIN', 'Make', 'Model', 'Year', 'Status'],
           [['1HGCM82633A004352', 'Honda', 'Accord', '2003', 'VIN not found in PriceDigest']], [230, 120, 150, 80, 262], 0)
b += [box(126, 238, 200, 26, '#fff', BLUE, 4), text(134, 256, '1HGCM82633A004352|', 12, '#1f2933'), callout(126, 238, 200, 26, 2),
      box(116, 300, 842, 70, '#fff4e5', '#ffd8a8', 6), text(136, 328, 'CHECK DIGIT chip: the 9th character does not fit the rest of the VIN, so a character', 12, AMBER, 500),
      text(136, 348, 'was probably misread. Compare it with the application and correct it.', 12, AMBER, 500), callout(116, 300, 842, 70, 3)]
imgs['05-failures-and-edits'] = frame('Sample Fleet Application.pdf', 'runs', b, 'Failures: 1 filter by reason, 2 click a cell to correct it, 3 check flagged VINs')

# 6 exports
b = [text(116, 128, 'Exports', 14, '#1f2933', 500)]
x = 116
for lab, col in (('Export BA Worksheet', BLUE), ('Export IM Worksheet', GREEN), ('Export Default', BLUE), ('Export Drivers CSV', BLUE)):
    w = len(lab) * 8 + 40
    b.append(button(x, 142, lab, 'contained' if col == GREEN or lab.startswith('Export BA') else 'outlined', col, w))
    x += w + 12
b += [callout(116, 142, 830, 34, 1), box(116, 210, 842, 70, '#e8f5e9', '#b7dfb9', 6),
      text(136, 240, 'The file downloads to your computer: Sample_Landscaping_Co._BA_Worksheet_20261119.xlsx', 12, GREEN, 500),
      text(136, 262, 'Open it in Excel and check it before you send it on.', 12, GREEN), callout(116, 210, 842, 70, 2)]
imgs['06-exports'] = frame('Sample Fleet Application.pdf', 'runs', b, 'Exports: 1 choose the worksheet, 2 the Excel file downloads')

# 7 admin people and roles
b = [text(116, 128, 'Reference data    Templates    Usage reports    People and roles', 13, BLUE, 500), callout(560, 112, 130, 24, 1),
     box(116, 150, 280, 40, '#f0f0f0', '#f0f0f0', 4), text(130, 175, 'Search people', 13, GREY)]
b += table(116, 206, ['Name', 'Email', 'Status', 'Last sign-in', 'NIP role'],
           [['Jane Example', 'jane.example@example.com', 'Active', 'Nov 12, 2026', 'Admin  v'],
            ['Sam Sample', 'sam.sample@example.com', 'Active', 'Nov 13, 2026', 'User  v']], [170, 260, 110, 140, 162])
b += [callout(796, 240, 162, 68, 2)]
imgs['07-admin-people'] = frame('Admin', 'admin', b, 'Admin (Super Admin only): 1 People and roles tab, 2 change a person\'s role')

# 8 help button
b = [box(700, 58, 290, 150, '#fff', LINE, 8), text(720, 92, 'Top bar', 14, '#1f2933', 500),
     text(720, 120, '? opens this help guide', 13, GREY), text(720, 144, 'Profile icon: theme, report an issue, log out', 13, GREY),
     callout(901, 13, 22, 22, 1)]
imgs['08-help-button'] = frame('VIN Validation - Runs', 'runs', b, '1 The ? button next to your profile opens this guide')

for name, svg in imgs.items():
    open(os.path.join(OUT, name + '.svg'), 'w', encoding='utf-8').write(svg)
print(sorted(os.listdir(OUT)))

