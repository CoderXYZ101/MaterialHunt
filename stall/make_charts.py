"""
MaterialHunt stall charts. Run from the project root:  python stall/make_charts.py
Writes one PNG per sheet into stall/charts/. Numbers come from static/data/evaluation.json
and the grade library in static/tools.js, so re-run it after the evaluation changes.
Optional: put a QR code image at stall/qr.png and it is placed on the banner and QR sheet.
"""
import json
import re
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Rectangle, Circle, Polygon

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'stall' / 'charts'
OUT.mkdir(parents=True, exist_ok=True)
EV = json.loads((ROOT / 'static' / 'data' / 'evaluation.json').read_text(encoding='utf-8'))
LINK = 'materialhunt-2026.web.app'
plt.rcParams['font.family'] = ['Segoe UI', 'DejaVu Sans']
plt.rcParams['text.parse_math'] = False

NAVY = '#0b1626'
CYAN = '#22d3ee'
INK = '#0b0b0b'
INK2 = '#52514e'
MUTED = '#8a897f'
LINE = '#e4e3dc'
CARD = '#f6f6f2'
BLUE, ORANGE, AQUA, YELLOW, MAGENTA, GREEN, VIOLET, RED = '#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'
TEAL = '#0e7490'
GOOD, WARN, NEUTRAL = '#0ca30c', '#eda100', '#8a897f'
TINT = {BLUE: '#eaf2fc', RED: '#fdeeee', AQUA: '#e8f8f1', YELLOW: '#fdf5e0', VIOLET: '#efedfb', TEAL: '#e6f5f8', GOOD: '#e9f7e9', WARN: '#fdf5e0', NEUTRAL: '#f2f2ee', ORANGE: '#fdf0ea', GREEN: '#e9f4e9'}

W, H = 100.0, 141.4


def sheet(title, kicker, sub=None, size=(8.27, 11.69), h=H):
    fig = plt.figure(figsize=size, dpi=200)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, W)
    ax.set_ylim(h, 0)
    ax.axis('off')
    ax.add_patch(Rectangle((0, 0), W, 23, color=NAVY))
    ax.add_patch(Rectangle((0, 23), W, 0.8, color=CYAN))
    logo(ax, 91, 8.5, 4.2)
    T(ax, 6, 6.6, kicker.upper(), 10.5, CYAN, bold=True)
    T(ax, 6, 13.2, title, 30, 'white', bold=True)
    if sub:
        T(ax, 6, 19.4, sub, 11.5, '#b8c8dc')
    return fig, ax


def footer(ax, note=None, h=H):
    ax.plot([6, 94], [h - 8.2, h - 8.2], color=LINE, lw=1)
    if note:
        T(ax, 6, h - 5.4, note, 8.2, MUTED)
    T(ax, 94, h - 2.8, LINK, 10, TEAL, ha='right', bold=True)
    T(ax, 6, h - 2.8, 'MaterialHunt · pre-screening tool, not a lab test', 8.6, MUTED)


def T(ax, x, y, s, size=11, color=INK, bold=False, ha='left', va='center', **kw):
    return ax.text(x, y, s, fontsize=size, color=color, fontweight='bold' if bold else 'normal', ha=ha, va=va, linespacing=kw.pop('ls', 1.35), **kw)


def box(ax, x, y, w, h, fc=CARD, ec='none', r=2, lw=1.2, **kw):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle=f'round,pad=0,rounding_size={r}', fc=fc, ec=ec, lw=lw, **kw))


def logo(ax, cx, cy, r, w=1.0):
    import math
    for k, rr in enumerate((r, r * 0.55)):
        pts = [(cx + rr * math.cos(math.pi / 6 + i * math.pi / 3), cy + rr * math.sin(math.pi / 6 + i * math.pi / 3)) for i in range(6)]
        ax.add_patch(Polygon(pts, closed=True, fill=False, ec=CYAN, lw=(2.4 if k == 0 else 1.6) * w))
    ax.add_patch(Circle((cx, cy), r * 0.2, color=CYAN))


def num_badge(ax, x, y, n, color, r=3.2, size=14):
    ax.add_patch(Circle((x, y), r, color=color, zorder=3))
    T(ax, x, y, str(n), size, 'white', bold=True, ha='center', zorder=4)


def save(fig, name):
    fig.savefig(OUT / f'{name}.png', dpi=fig.dpi)
    plt.close(fig)
    print('wrote', name)


def qr_slot(ax, x, y, s, dark=False, fs=None):
    img = ROOT / 'stall' / 'qr.png'
    ax.add_patch(Rectangle((x, y), s, s, fc='white', ec=INK if not dark else CYAN, lw=2.2, ls='-' if img.exists() else '--'))
    if img.exists():
        ax.imshow(plt.imread(img), extent=(x + 1, x + s - 1, y + s - 1, y + 1), zorder=3, cmap='gray', aspect='auto', interpolation='nearest')
    else:
        T(ax, x + s / 2, y + s / 2, 'PASTE QR CODE\nHERE', fs or (14 if s > 30 else 10), MUTED, bold=True, ha='center')


# ---------------------------------------------------------------- 00 main banner (2 ft x 3 ft)
def banner():
    h = 150.0
    fig = plt.figure(figsize=(24, 36), dpi=100)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 100)
    ax.set_ylim(h, 0)
    ax.axis('off')
    ax.add_patch(Rectangle((0, 0), 100, h, color=NAVY))
    for gx in range(0, 101, 10):
        ax.plot([gx, gx], [0, h], color='#13233a', lw=1.5, zorder=0)
    for gy in range(0, 151, 10):
        ax.plot([0, 100], [gy, gy], color='#13233a', lw=1.5, zorder=0)
    logo(ax, 50, 17, 10, w=5)
    k = 2.9  # banner type scale
    T(ax, 50, 35, 'MaterialHunt', 74 * k / 1.3, 'white', bold=True, ha='center')
    T(ax, 50, 50, 'Will your metal survive?', 38 * k, 'white', bold=True, ha='center')
    T(ax, 50, 58.5, 'Know before you build.', 38 * k, CYAN, bold=True, ha='center')
    steps = [('1', 'Pick a metal', BLUE), ('2', 'Set heat and load', AQUA), ('3', 'Get a verdict', YELLOW)]
    for i, (n, s, c) in enumerate(steps):
        x = 6 + i * 30.5
        box(ax, x, 68, 27, 24, fc='#12243d', ec=c, r=2.5, lw=6)
        num_badge(ax, x + 13.5, 76, n, c, r=4.4, size=54)
        T(ax, x + 13.5, 86.5, s.replace(' and ', ' and\n'), 52, 'white', bold=True, ha='center', ls=1.15)
    qr_slot(ax, 32, 98, 36, dark=True, fs=54)
    T(ax, 50, 139.5, LINK, 30 * k, CYAN, bold=True, ha='center')
    T(ax, 50, 146, 'Free  ·  runs in your browser  ·  works offline', 17 * k, '#b8c8dc', ha='center')
    save(fig, '00-main-banner-2x3ft')


# ---------------------------------------------------------------- 01 problem
def problem():
    fig, ax = sheet('The problem', 'Sheet 1', 'Choosing a metal is hard when you are not an expert')
    items = [
        ('Guesswork', 'People pick the metal they know,\nor copy what someone else used.', RED, 'A wrong pick can bend, rust or melt.'),
        ('Numbers, not answers', 'Datasheets list values but do not\nsay if a metal suits your job.', ORANGE, 'Strength at room heat is not strength at 600 °C.'),
        ('Testing is costly', 'A lab test for every candidate\nis slow and costs money.', VIOLET, 'Students and small shops cannot test them all.'),
    ]
    y = 31
    for i, (t, d, c, why) in enumerate(items):
        box(ax, 6, y, 88, 28, fc=CARD)
        ax.add_patch(Rectangle((6, y + 3), 1.3, 22, color=c))
        num_badge(ax, 18, y + 14, i + 1, c, r=6.2, size=24)
        T(ax, 29, y + 6.5, t, 21, INK, bold=True)
        T(ax, 29, y + 15, d, 13.5, INK2)
        T(ax, 29, y + 23.4, why, 11.5, c, bold=True)
        y += 31.5
    box(ax, 6, 126, 88, 6.4, fc=NAVY, r=3.2)
    T(ax, 50, 129.2, 'So how do you shortlist before you spend?', 15, 'white', bold=True, ha='center')
    footer(ax)
    save(fig, '01-problem')


# ---------------------------------------------------------------- 02 solution
def solution():
    fig, ax = sheet('Our solution', 'Sheet 2', 'Screen metals first, then test only the best ones')
    flow = [('Pick a metal\nor describe your job', 'Mix any of 118 elements, or type the job in plain words.', BLUE),
            ('The simulator tests it', 'Heat, load, surroundings, pressure, weight and cost.', AQUA),
            ('Verdict you can read', 'SAFE, MARGINAL or UNSAFE, with how much to trust it.', YELLOW),
            ('Take the next step', 'Closest Indian grade, ₹ per kg range and a quote request.', VIOLET)]
    y = 30
    for i, (t, d, c) in enumerate(flow):
        box(ax, 16, y, 78, 18, fc=TINT[c])
        num_badge(ax, 9.5, y + 9, i + 1, c, r=4.4, size=18)
        T(ax, 21, y + 6.4, t.replace('\n', ' '), 18, INK, bold=True)
        T(ax, 21, y + 13, d, 12, INK2)
        if i < 3:
            ax.annotate('', xy=(9.5, y + 18.2 + 2.4), xytext=(9.5, y + 13.8), arrowprops=dict(arrowstyle='-|>', color=MUTED, lw=2, mutation_scale=16))
        y += 21.5
    T(ax, 6, 120.2, 'Why it is different', 14, INK, bold=True)
    for i, (t, d) in enumerate([('Made for India', 'Indian grades, ₹ prices'), ('Shows its errors', 'Evaluation page'), ('Works offline', 'Free, in your browser')]):
        x = 6 + i * 30
        box(ax, x, 123, 28, 9.6, fc=NAVY, r=2)
        T(ax, x + 14, 126.2, t, 12.5, 'white', bold=True, ha='center')
        T(ax, x + 14, 129.8, d, 9.2, CYAN, ha='center')
    footer(ax)
    save(fig, '02-solution')


# ---------------------------------------------------------------- 03 progress
def progress():
    fig, ax = sheet('Our progress', 'Sheet 3', 'What works today, what we are testing, what comes next')
    stats = [('48', 'library grades'), ('312', 'measured steels'), ('456', 'aluminium results'), ('118', 'elements')]
    for i, (n, l) in enumerate(stats):
        x = 6 + i * 22.4
        box(ax, x, 29, 20.8, 18, fc=CARD)
        T(ax, x + 10.4, 36, n, 30, TEAL, bold=True, ha='center')
        T(ax, x + 10.4, 43, l, 10, INK2, ha='center')
    cols = [('DONE', GOOD, '✓', ['Simulator', 'Alloy Finder', 'Failure Doctor', 'Cost-Down Scanner', 'ML Lab', 'AI assistant', 'Evaluation page', 'Forum and teams']),
            ('TRYING NOW', WARN, '●', ['Stockist price\ncheck', 'Density test\nat home', 'Magnet test', 'Rust race', 'Heat race']),
            ('NEXT', NEUTRAL, '→', ['Independent\nlab test', 'More public\nalloy data', 'Heat treatment\nas an input', 'School pilot'])]
    for i, (t, c, mark, rows) in enumerate(cols):
        x = 6 + i * 30
        box(ax, x, 52, 28, 74, fc=TINT[c])
        box(ax, x, 52, 28, 9, fc=c, r=2)
        T(ax, x + 14, 56.5, t, 14, 'white' if c != WARN else INK, bold=True, ha='center')
        y = 67
        for r in rows:
            two = '\n' in r
            T(ax, x + 2.4, y + (1.5 if two else 0), mark, 12, c, bold=True)
            T(ax, x + 6, y + (1.5 if two else 0), r, 11.2, INK)
            y += 10 if two else 7
    box(ax, 6, 128, 88, 5, fc=NAVY, r=2.5)
    T(ax, 50, 130.5, 'Not independently verified yet. That is our next step.', 11.5, 'white', bold=True, ha='center')
    footer(ax)
    save(fig, '03-progress')


# ---------------------------------------------------------------- 04 QR sheet
def qr_sheet():
    fig = plt.figure(figsize=(8.27, 11.69), dpi=200)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, W)
    ax.set_ylim(H, 0)
    ax.axis('off')
    logo(ax, 50, 11, 6)
    T(ax, 50, 24, 'Scan to try it', 40, INK, bold=True, ha='center')
    T(ax, 50, 32, 'Test a metal on your own phone', 15, INK2, ha='center')
    qr_slot(ax, 14, 39, 72)
    T(ax, 50, 119, 'or type this', 13, MUTED, ha='center')
    box(ax, 6, 122.5, 88, 10, fc=NAVY, r=3)
    T(ax, 50, 127.5, LINK, 28, CYAN, bold=True, ha='center')
    T(ax, 50, 137, 'MaterialHunt  ·  free  ·  runs in your browser', 11, INK2, ha='center')
    save(fig, '04-qr-sheet')


# ---------------------------------------------------------------- 05 trust
def trust():
    sc, d = EV['steel_cv'], EV['calc_checks']['density']
    lib = EV['library_loo']['trained_on_47_grades_plus_extra']
    fig, ax = sheet('Where can you trust it?', 'Sheet 5', 'Green: rely on it for screening. Amber: a first guess. Grey: check elsewhere')
    groups = [(GOOD, 'STRONG', '✓', [('Density of a mix', f"{d['mean_error_pct']:.1f}% average difference from datasheets"),
                                    ('Known grades', 'shows the stored datasheet strength'),
                                    ('Load and pressure sums', 'plain textbook arithmetic')]),
              (WARN, 'A FIRST GUESS', '!', [('Steels like the ones it learned', f"about {sc['mae']:.0f} MPa average error"),
                                           ('Other new mixes (ML)', f"about {lib['mape']:.0f}% average error"),
                                           ('Price in ₹ per kg', 'a range to budget with, ask for a quote')]),
              (NEUTRAL, 'CHECK ELSEWHERE', '?', [('A new type of steel', 'no better than guessing the average'),
                                                ('Melting point of new mixes', 'rough warning only'),
                                                ('Creep, fatigue, welds', 'not predicted')])]
    y = 29
    for c, title, mark, rows in groups:
        box(ax, 6, y, 88, 31.5, fc=TINT[c])
        box(ax, 6, y, 15, 31.5, fc=c, r=2)
        T(ax, 13.5, y + 13, mark, 38, 'white' if c != WARN else INK, bold=True, ha='center')
        T(ax, 13.5, y + 24, title.replace(' ', '\n'), 8.8, 'white' if c != WARN else INK, bold=True, ha='center')
        for k, (a, b) in enumerate(rows):
            T(ax, 25, y + 5.2 + k * 10, a, 14, INK, bold=True)
            T(ax, 25, y + 9.2 + k * 10, b, 10.5, INK2)
        y += 34.5
    footer(ax, 'Numbers from our own tests (Evaluation page). No independent check yet.')
    save(fig, '05-where-to-trust-it')


# ---------------------------------------------------------------- 06 strong or light
def parse_library():
    rows = []
    for line in (ROOT / 'static' / 'tools.js').read_text(encoding='utf-8').splitlines():
        s = line.strip()
        if not s.startswith("grade('"):
            continue
        gid, name, fam = re.match(r"grade\('([^']+)', '([^']+)', '([^']+)'", s).groups()
        y = float(re.search(r"[ ,{]y: ([\d.]+)", s).group(1))
        d = float(re.search(r"[ ,{]d: ([\d.]+)", s).group(1))
        rows.append((gid, name, fam, y, d))
    return rows


def strong_light():
    fig, ax = sheet('Strong or light?', 'Sheet 6', 'Each dot is one real grade. Up is stronger, left is lighter')
    g = fig.add_axes([0.135, 0.255, 0.82, 0.52])
    groups = [('Steel', BLUE, 'o', lambda f: 'steel' in f.lower() or f == 'Cast iron'),
              ('Aluminium', ORANGE, 's', lambda f: f == 'Aluminium'),
              ('Titanium', AQUA, '^', lambda f: f == 'Titanium'),
              ('Copper alloys', YELLOW, 'D', lambda f: f == 'Copper alloy'),
              ('Nickel and cobalt', MAGENTA, 'v', lambda f: f.startswith('Nickel') or f == 'Cobalt alloy'),
              ('Others', VIOLET, 'P', lambda f: f in ('Magnesium', 'Refractory metal'))]
    lib = parse_library()
    for lab, c, m, match in groups:
        pts = [(d, y) for _, _, f, y, d in lib if match(f)]
        g.scatter([p[0] for p in pts], [p[1] for p in pts], s=150, c=c, marker=m, edgecolors='white', linewidths=1.6, label=lab, zorder=3)
    g.set_xscale('log')
    g.set_yscale('log')
    g.set_xlim(1.6, 24)
    g.set_ylim(45, 2600)
    g.set_xticks([2, 3, 5, 8, 10, 20])
    g.set_xticklabels(['2', '3', '5', '8', '10', '20'])
    g.set_yticks([50, 100, 200, 500, 1000, 2000])
    g.set_yticklabels(['50', '100', '200', '500', '1000', '2000'])
    g.minorticks_off()
    g.tick_params(labelsize=11, colors=INK2, length=0)
    for s in g.spines.values():
        s.set_visible(False)
    g.grid(color=LINE, lw=1)
    g.set_xlabel('Density (g/cm³)   lighter  ←', fontsize=12.5, color=INK2, labelpad=8)
    g.set_ylabel('Yield strength (MPa)   stronger  ↑', fontsize=12.5, color=INK2, labelpad=6)
    names = {'al7075': ('Al 7075', -10, 12), 'ti64': ('Ti-6Al-4V', -62, 12), 'e250': ('Mild steel', 18, -3), 'ss316l': ('316L', -40, -18), 'maraging': ('Maraging steel', -102, 4), 'tungsten': ('Tungsten', -66, 10)}
    for gid, name, f, y, d in lib:
        if gid in names:
            t, dx, dy = names[gid]
            g.annotate(t, (d, y), textcoords='offset points', xytext=(dx, dy), fontsize=11, color=INK, fontweight='bold', zorder=5)
    g.legend(loc='upper center', bbox_to_anchor=(0.45, -0.1), ncol=3, frameon=False, fontsize=11.5, handletextpad=0.3, columnspacing=1.4)
    box(ax, 6, 121, 88, 8.6, fc=TINT[TEAL])
    T(ax, 50, 125.3, 'Aim for the top left: strong AND light. Then check price and heat.', 12.5, TEAL, bold=True, ha='center')
    footer(ax, f'Typical datasheet values for the {len(lib)} grades in our library. Both axes are logarithmic.')
    save(fig, '06-strong-or-light')


# ---------------------------------------------------------------- 07 accuracy check
def accuracy():
    rows = EV['validation_library']
    short = lambda n: re.sub(r' \(.*?\)', '', n).replace('Nickel-chrome-moly steel EN24', 'Steel EN24').replace('Medium-carbon steel', 'Steel').replace('Stainless steel', 'Stainless').replace('Duplex stainless', 'Duplex').replace('Maraging steel 18Ni300', 'Maraging steel').replace('Aluminium', 'Al').replace('Titanium ', '')
    rows = sorted(rows, key=lambda r: r['error_pct'])
    fig, ax = sheet('Can the ML guess it?', 'Sheet 7', 'The model guesses a metal it has never been shown. We print every miss')
    g = fig.add_axes([0.25, 0.235, 0.6, 0.555])
    for i, r in enumerate(rows):
        a, p = r['reference'], r['predicted']
        g.plot([a, p], [i, i], color='#c9c8c0', lw=3, zorder=1, solid_capstyle='round')
        g.scatter(a, i, s=130, color=BLUE, edgecolors='white', linewidths=1.5, zorder=3, label='Datasheet value' if i == 0 else None)
        g.scatter(p, i, s=130, color=ORANGE, marker='D', edgecolors='white', linewidths=1.5, zorder=3, label='ML guess (never saw it)' if i == 0 else None)
        g.text(1.04, i, f"{r['error_pct']:.0f}%", transform=g.get_yaxis_transform(), va='center', ha='left', fontsize=12.5, color=INK, fontweight='bold')
    g.text(1.04, len(rows) - 0.25, 'off by', transform=g.get_yaxis_transform(), fontsize=10.5, color=MUTED, va='center')
    g.set_yticks(range(len(rows)))
    g.set_yticklabels([short(r['name']) for r in rows], fontsize=11.5, color=INK)
    g.invert_yaxis()
    g.set_xlim(0, 2000)
    g.set_ylim(len(rows) - 0.4, -0.8)
    g.tick_params(length=0, labelsize=11)
    g.tick_params(axis='x', colors=INK2)
    for s in g.spines.values():
        s.set_visible(False)
    g.grid(axis='x', color=LINE, lw=1)
    g.set_xlabel('Yield strength (MPa)', fontsize=12, color=INK2, labelpad=6)
    g.legend(loc='upper center', bbox_to_anchor=(0.32, -0.085), ncol=2, frameon=False, fontsize=11.5, handletextpad=0.2)
    box(ax, 6, 123, 88, 8.6, fc=TINT[WARN])
    T(ax, 50, 127.3, 'Close on some, far off on others. For a known grade the site shows the datasheet.', 10.8, INK, bold=True, ha='center')
    footer(ax, 'Each grade was hidden from the model before it guessed (leave-one-out, Python evaluation script).')
    save(fig, '07-accuracy-check')


# ---------------------------------------------------------------- 08 more data, less error
def more_data():
    L, A = EV['library_loo'], EV['aluminium_effect']
    fig, ax = sheet('More data, less error', 'Sheet 7B', 'Average error on strength. Shorter bar is better')

    def bars(y0, title, items):
        T(ax, 6, y0, title, 17, INK, bold=True)
        y = y0 + 7
        for lab, v, c in items:
            T(ax, 6, y, lab, 12, INK2)
            ax.add_patch(Rectangle((6, y + 2.8), 76, 6.2, color=CARD))
            wid = 76 * v / 90
            box(ax, 6, y + 2.8, wid, 6.2, fc=c, r=1.1)
            T(ax, 6 + wid + 2, y + 5.9, f'{v:.0f}%', 19, INK, bold=True)
            y += 13.6

    bars(31, 'All 48 library grades', [('Just guess the average', L['guess_the_average']['mape'], NEUTRAL),
                                        ('Our ML with 312 steels added', L['trained_on_47_grades_plus_312_steels']['mape'], '#86b6ef'),
                                        ('Our ML with steels + aluminium data', L['trained_on_47_grades_plus_extra']['mape'], BLUE)])
    bars(80, f"Aluminium grades only ({A['n']} grades)", [('Before the aluminium data', A['before_mape'], '#86b6ef'),
                                                          (f"After adding {A['extra_rows']} public results", A['after_mape'], BLUE)])
    box(ax, 6, 114.5, 88, 17, fc=TINT[TEAL])
    T(ax, 50, 119, 'The lesson: data matters more than a bigger model', 13.5, TEAL, bold=True, ha='center')
    T(ax, 50, 126, 'The aluminium data holds similar alloys, so 8% shows the value of data,\nnot skill on a brand-new kind of aluminium.', 10.5, INK2, ha='center')
    footer(ax, 'Aluminium data: Bhat, Barnard and Birbilis, Mendeley Data 2023, CC BY 4.0.')
    save(fig, '07b-more-data-less-error')


# ---------------------------------------------------------------- 08 mystery tray guide
def mystery():
    fig, ax = sheet('Mystery metal tray', 'Sheet 8', 'Play the scientist: guess the metal, then check')
    steps = [('Look', 'Colour, shine, rust spots', BLUE), ('Lift', 'Does it feel heavy for its size?', ORANGE),
             ('Magnet', 'Does a magnet stick?', AQUA), ('Weigh and dunk', 'Density = mass ÷ water pushed aside', VIOLET)]
    for i, (t, d, c) in enumerate(steps):
        x = 6 + (i % 2) * 45
        y = 29 + (i // 2) * 22
        box(ax, x, y, 43, 19.5, fc=TINT[c])
        num_badge(ax, x + 6.5, y + 6.5, i + 1, c, r=3.6, size=15)
        T(ax, x + 12.5, y + 6.5, t, 15, INK, bold=True)
        T(ax, x + 3, y + 14.4, d, 9.8, INK2)
    T(ax, 6, 78, 'My results', 16, INK, bold=True)
    heads = ['Item', 'Magnet?', 'Mass (g)', 'Water (mL)', 'Density', 'My guess']
    xs = [6, 22, 36, 49, 64, 77, 94]
    box(ax, 6, 82, 88, 7, fc=NAVY, r=1)
    for i, h in enumerate(heads):
        T(ax, (xs[i] + xs[i + 1]) / 2, 85.5, h, 10, 'white', bold=True, ha='center')
    for r, name in enumerate(['A', 'B', 'C', 'D']):
        y = 89 + r * 8.2
        ax.add_patch(Rectangle((6, y), 88, 8.2, fc='white' if r % 2 else CARD, ec=LINE, lw=1))
        T(ax, 14, y + 4.1, name, 14, INK, bold=True, ha='center')
        for x in xs[1:-1]:
            ax.plot([x, x], [y, y + 8.2], color=LINE, lw=1)
    box(ax, 6, 124, 88, 7.6, fc=TINT[TEAL])
    T(ax, 50, 127.8, 'Typical g/cm³:  aluminium 2.7 · steel 7.8 · stainless 8.0 · brass 8.5 · copper 8.9', 10.2, TEAL, bold=True, ha='center')
    footer(ax, 'Coins and alloys vary, so a home test only narrows the choice.')
    save(fig, '08-mystery-tray')


# ---------------------------------------------------------------- 09 heat race
def heat():
    fig, ax = sheet('The heat race', 'Sheet 9', 'Which metal carries heat fastest? Guess before you watch')
    T(ax, 6, 31, 'Set up', 15, INK, bold=True)
    ax.add_patch(Rectangle((10, 62), 80, 3, color='#8fb7d9'))
    T(ax, 50, 69, 'hot water (an adult pours it)', 11, INK2, ha='center')
    for i, (n, c) in enumerate([('Aluminium', '#b9c0c9'), ('Steel', '#7c848d'), ('Copper or coin', '#c07a4a')]):
        x = 22 + i * 28
        box(ax, x - 2, 38, 4, 28, fc=c, r=1.5)
        box(ax, x - 3.4, 36, 6.8, 5.4, fc='#fde68a', ec=YELLOW, r=1.6)
        T(ax, x, 33.6, '', 1)
        T(ax, x + 5, 52, n.replace(' or ', '\nor '), 10.5, INK, bold=True)
    T(ax, 22, 43.8, '', 1)
    T(ax, 50, 75, 'A dab of butter sits at the top of each strip. The first to slide wins.', 11.5, INK2, ha='center')
    T(ax, 6, 84, 'Our result', 15, INK, bold=True)
    for i, h in enumerate(['1st to melt', '2nd', '3rd']):
        x = 6 + i * 30
        box(ax, x, 89, 28, 26, fc=CARD, ec=LINE)
        T(ax, x + 14, 94, h, 13, [GOOD, INK2, MUTED][i], bold=True, ha='center')
        ax.plot([x + 4, x + 24], [105, 105], color=MUTED, lw=1)
        T(ax, x + 14, 110.5, 'time: ______ s', 10.5, MUTED, ha='center')
    box(ax, 6, 119, 88, 12.4, fc=TINT[WARN])
    T(ax, 50, 125.2, 'Safety: hot water only with an adult. Do not touch the strips.\nThis shows heat flow, not strength.', 11.5, INK, bold=True, ha='center')
    footer(ax)
    save(fig, '09-heat-race')


# ---------------------------------------------------------------- 10 rust race
def rust():
    fig, ax = sheet('The rust race', 'Sheet 10', 'Iron nail against stainless steel in salt water. Stick one photo a day')
    T(ax, 32, 30, 'IRON NAIL', 14, ORANGE, bold=True, ha='center')
    T(ax, 70.5, 30, 'STAINLESS ITEM', 14, BLUE, bold=True, ha='center')
    for i, day in enumerate(['Day 0', 'Day 1', 'Day 2', 'Day 3', 'Day 4']):
        y = 33.5 + i * 18.2
        T(ax, 6, y + 8, day, 13, INK, bold=True)
        for x, c in ((15, ORANGE), (53.5, BLUE)):
            box(ax, x, y, 34.5, 16.4, fc=TINT[c], ec=c, r=1.6, lw=1, ls=(0, (4, 3)))
            T(ax, x + 17.25, y + 8.2, 'photo', 10, MUTED, ha='center')
    box(ax, 6, 125.4, 88, 6.8, fc=TINT[TEAL])
    T(ax, 50, 128.8, 'What did you see?  ______________________________________', 11.5, TEAL, bold=True, ha='center')
    footer(ax, 'Same salt water for both. Print this sheet when the photos are ready.')
    save(fig, '10-rust-race')


# ---------------------------------------------------------------- 11 tally
def tally():
    fig, ax = sheet('Tell us what you think', 'Sheet 11', 'Add one sticker dot to each question')
    def question(y, q, opts, h):
        T(ax, 6, y, q, 14, INK, bold=True)
        n = len(opts)
        w = (88 - (n - 1) * 1.8) / n
        for i, (lab, c) in enumerate(opts):
            x = 6 + i * (w + 1.8)
            box(ax, x, y + 4, w, h, fc='white', ec=c, r=1.6, lw=2)
            box(ax, x, y + 4 + h - 6.5, w, 6.5, fc=c, r=1.6)
            T(ax, x + w / 2, y + 4 + h - 3.25, lab, 10 if n > 3 else 13, 'white' if c != YELLOW else INK, bold=True, ha='center')
    question(30, 'A.  Which metal would you pick for a motor bracket?', [('Aluminium', BLUE), ('Mild steel', ORANGE), ('Stainless', AQUA), ('Titanium', VIOLET), ('Brass', YELLOW)], 29)
    question(68, 'B.  Did you guess the mystery metal?', [('Yes, I got it', GOOD), ('No, it fooled me', RED)], 25)
    question(102, 'C.  Would you use MaterialHunt?', [('Yes', GOOD), ('Maybe', YELLOW), ('No', RED)], 23)
    footer(ax, 'No names or personal details. Count the dots at the end of each day.')
    save(fig, '11-tally-sheet')


# ---------------------------------------------------------------- 12 limits (half A4)
def limits():
    h = 70.7
    fig = plt.figure(figsize=(8.27, 5.845), dpi=200)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 100)
    ax.set_ylim(h, 0)
    ax.axis('off')
    ax.add_patch(Rectangle((0, 0), 100, 14, color=NAVY))
    ax.add_patch(Rectangle((0, 14), 100, 0.8, color=CYAN))
    T(ax, 6, 7.2, 'What we cannot claim', 24, 'white', bold=True)
    logo(ax, 91, 7, 4)
    for i, (a, b) in enumerate([('A home test is not a lab test', 'it only narrows the choice'),
                                ('Our numbers are our own tests', 'no independent check yet'),
                                ('Prices are rough ranges', 'ask a supplier for a quote'),
                                ('Not for safety-critical parts', 'get them tested and signed off')]):
        y = 22 + i * 10.6
        num_badge(ax, 10, y, '×', RED, r=3.2, size=15)
        T(ax, 17, y - 1.7, a, 14.5, INK, bold=True)
        T(ax, 17, y + 2.8, b, 11, INK2)
    T(ax, 94, 67.5, LINK, 10, TEAL, bold=True, ha='right')
    save(fig, '12-limits-half-a4')


if __name__ == '__main__':
    for fn in (banner, problem, solution, progress, qr_sheet, trust, strong_light, accuracy, more_data, mystery, heat, rust, tally, limits):
        fn()
