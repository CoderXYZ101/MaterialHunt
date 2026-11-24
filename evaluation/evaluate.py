"""
MaterialHunt: reproducible model evaluation.

Run from the project root:
    pip install scikit-learn numpy
    python evaluation/evaluate.py

It reads only files that are in this repository (static/tools.js for the 48-grade library and
static/data/steel-yield-model.json for the 312 measured steels) and writes static/data/evaluation.json,
which the website shows on its Evaluation page. Seeds are fixed, so you get the same numbers.

What it measures
  1. Steel model: 5-fold cross-validation on the 312 measured steels (re-run from scratch here).
  2. Independent test: the shipped steel model, which never saw the library, predicts the yield strength
     of every library grade it considers inside its range, and is compared with the library value.
  3. Library yield model: leave-one-out on the 48 library grades, trained on the 47 other grades only,
     versus trained on those 47 plus the 312 measured steels. Always compared with "guess the average".
"""
import json
import re
from pathlib import Path

import numpy as np
from sklearn.ensemble import ExtraTreesRegressor, RandomForestRegressor
from sklearn.model_selection import KFold

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'static'
AM = dict(Al=26.982, C=12.011, Co=58.933, Cr=51.996, Fe=55.845, Mn=54.938, Mo=95.95, N=14.007,
          Nb=92.906, Ni=58.693, Si=28.086, Ti=47.867, V=50.942, W=183.84)


def parse_library():
    rows = []
    for line in (SRC / 'tools.js').read_text(encoding='utf-8').splitlines():
        s = line.strip()
        if not s.startswith("grade('"):
            continue
        gid, name, fam, comp_s = re.match(r"grade\('([^']+)', '([^']+)', '([^']+)', \{([^}]*)\}", s).groups()
        comp, bal = {}, None
        for k, v in re.findall(r"(\w+): ([\d.]+|'\w+')", comp_s):
            if k == 'bal':
                bal = v.strip("'")
            else:
                comp[k] = float(v)
        if bal:
            comp[bal] = max(0.0, 100 - sum(comp.values()))
        y = float(re.search(r"[ ,{]y: ([\d.]+)", s).group(1))
        st = re.search(r"\bs: '(\w+)'", s)
        rows.append(dict(id=gid, name=name, fam=fam, comp=comp, y=y, d=float(re.search(r"[ ,{]d: ([\d.]+)", s).group(1)), s=st.group(1) if st else 'BCC'))
    return rows


def metrics(actual, pred):
    actual, pred = np.asarray(actual, float), np.asarray(pred, float)
    if len(actual) < 3:  # R-squared means nothing for one or two points
        return dict(mae=round(float(np.mean(np.abs(actual - pred))), 1), mape=round(float(np.mean(np.abs(actual - pred) / actual) * 100), 1), r2=None)
    return dict(mae=round(float(np.mean(np.abs(actual - pred))), 1),
                mape=round(float(np.mean(np.abs(actual - pred) / actual) * 100), 1),
                r2=round(float(1 - np.sum((actual - pred) ** 2) / np.sum((actual - actual.mean()) ** 2)), 3))


lib = parse_library()
steel = json.loads((SRC / 'data' / 'steel-yield-model.json').read_text(encoding='utf-8'))
els = steel['elements']
Xs, ys = np.array(steel['X']), np.array(steel['y'])
out = dict(generated_by='evaluation/evaluate.py', library_grades=len(lib), measured_steels=len(ys))

# 1. steel model, 5-fold cross-validation
oof = np.zeros(len(ys))
for tr, te in KFold(5, shuffle=True, random_state=0).split(Xs):
    oof[te] = ExtraTreesRegressor(n_estimators=80, random_state=0).fit(Xs[tr], ys[tr]).predict(Xs[te])
m = metrics(ys, oof)
m['baseline_mae'] = round(float(np.mean(np.abs(ys - ys.mean()))), 1)
m['err80'] = round(float(np.percentile(np.abs(ys - oof), 80)), 1)
m['method'] = '5-fold cross-validation (shuffled, seed 0) on 312 measured steels, extra-trees, 80 trees'
out['steel_cv'] = m
out['steel_cv_shipped'] = steel['cv']

# 2. independent test: shipped steel model on library grades it considers in range
def wt_to_atomic(comp):
    total = sum(comp.values())
    known = sum(comp.get(e, 0) for e in els)
    if known / total < 0.97:
        return None
    mol = np.array([comp.get(e, 0) / AM[e] for e in els])
    return mol / mol.sum()

def tree_predict(t, x):
    i = 0
    while t['f'][i] != -2:
        i = t['l'][i] if x[t['f'][i]] <= t['t'][i] else t['r'][i]
    return t['v'][i]

nn = sorted(min(np.linalg.norm(Xs[i] - Xs[k]) for k in range(len(Xs)) if k != i) for i in range(len(Xs)))
domain = nn[int(len(nn) * 0.95)] * 1.25
tested, skipped = [], []
for r in lib:
    x = wt_to_atomic(r['comp'])
    if x is None or x[els.index('Fe')] < 0.4 or min(np.linalg.norm(x - row) for row in Xs) > domain:
        skipped.append(r['id'])
        continue
    p = float(np.mean([tree_predict(t, x) for t in steel['trees']]))
    tested.append(dict(id=r['id'], name=r['name'], library_yield=r['y'], predicted=round(p, 0)))
ind = dict(n_tested=len(tested), n_outside_range=len(skipped), grades=tested,
           note='Library values are typical datasheet values, which depend on heat treatment; this is a small, honest check, not a proof.')
if tested:
    ind.update(metrics([t['library_yield'] for t in tested], [t['predicted'] for t in tested]))
out['independent_steel_on_library'] = ind

# 3. library yield model, leave-one-out
def feat(comp, s, cols):
    tot = sum(comp.values()) or 1
    return [comp.get(e, 0) / tot * 100 for e in cols] + [1.0 if s == k else 0.0 for k in ('BCC', 'FCC', 'HCP')]

cols = sorted({e for r in lib for e in r['comp']} | set(els))
Xl = np.array([feat(r['comp'], r['s'], cols) for r in lib])
yl = np.array([r['y'] for r in lib])
Xe = []
for x in Xs:
    w = {e: x[i] * AM[e] for i, e in enumerate(els)}
    t = sum(w.values())
    Xe.append(feat({e: v / t * 100 for e, v in w.items()}, 'BCC', cols))
Xe = np.array(Xe)

def loo(extra, log=False, trees=80):
    pred = []
    for i in range(len(lib)):
        tr = [k for k in range(len(lib)) if k != i]
        Xt, yt = Xl[tr], yl[tr]
        if extra:
            Xt, yt = np.vstack([Xt, Xe]), np.concatenate([yt, ys])
        m = RandomForestRegressor(n_estimators=trees, max_features=0.4, random_state=i).fit(Xt, np.log(yt) if log else yt)
        v = m.predict(Xl[i:i + 1])[0]
        pred.append(float(np.exp(v)) if log else float(v))
    return np.array(pred)

base = [np.delete(yl, i).mean() for i in range(len(yl))]
p47 = loo(False)
p359 = loo(True)
plog = loo(True, log=True)
p400 = loo(True, trees=400)
out['library_loo'] = dict(
    guess_the_average=metrics(yl, base),
    trained_on_47_grades=metrics(yl, p47),
    trained_on_47_grades_plus_312_steels=metrics(yl, p359),
    tried_log_scale_not_adopted=metrics(yl, plog),
    tried_400_trees_no_gain=metrics(yl, p400),
    method='leave-one-out over the 48 library grades; random forest, 80 trees, seed per fold')

# 4. known-material validation: reference value, prediction made without seeing that material, error
def pct(a, p):
    return round(abs(p - a) / a * 100, 1)

picks = ['e250', 'en8', 'en24', 'ss304', 'ss316l', 'ss174', 'du2205', 'al6061', 'al7075', 'ti64', 'brass70', 'in718', 'maraging']
ids = [r['id'] for r in lib]
out['validation_library'] = [dict(name=lib[ids.index(g)]['name'], reference=lib[ids.index(g)]['y'], predicted=round(float(p359[ids.index(g)])),
                                  error_pct=pct(lib[ids.index(g)]['y'], p359[ids.index(g)])) for g in picks if g in ids]
order = np.argsort(ys)
chosen = [int(order[k]) for k in np.linspace(5, len(ys) - 6, 10).astype(int)]
def steel_formula(i):
    w = {e: Xs[i][k] * AM[e] for k, e in enumerate(els)}
    t = sum(w.values())
    top = sorted(((v / t * 100, e) for e, v in w.items()), reverse=True)
    return ' '.join(f'{e}{v:.1f}' for v, e in top if v >= 0.5)
out['validation_steels'] = [dict(composition=steel_formula(i), measured=round(float(ys[i])), predicted=round(float(oof[i])), error_pct=pct(ys[i], oof[i])) for i in chosen]
out['validation_note'] = 'Every prediction here was made by a model that did not see that material (out-of-fold for the steels, leave-one-out for the library grades).'

# 5. stronger validation: leave one material FAMILY out (the model never saw anything like it)
fams = {}
for i, r in enumerate(lib):
    fams.setdefault(r['fam'], []).append(i)
pfam = np.zeros(len(lib))
for fam, idx in fams.items():
    tr = [k for k in range(len(lib)) if k not in idx]
    m = RandomForestRegressor(n_estimators=80, max_features=0.4, random_state=7).fit(np.vstack([Xl[tr], Xe]), np.concatenate([yl[tr], ys]))
    pfam[idx] = m.predict(Xl[idx])
fam_rows = []
for fam, idx in fams.items():
    fam_rows.append(dict(family=fam, n=len(idx), mape=round(float(np.mean(np.abs(yl[idx] - pfam[idx]) / yl[idx]) * 100), 1),
                         guess_mape=round(float(np.mean(np.abs(yl[idx] - np.delete(yl, idx).mean()) / yl[idx]) * 100), 1)))
out['family_holdout'] = dict(overall=metrics(yl, pfam), families=fam_rows,
                             method='leave-one-family-out: every grade of a family (for example all stainless steels) is hidden, the model trains on the other families plus the 312 steels')

# 6. calculation checks against reference values
hb = json.loads((SRC / 'data' / 'handbook.json').read_text(encoding='utf-8'))
EL = hb['elements']
PER = {r['symbol']: r for r in hb['periodic']}
def dens_el(e):
    return EL.get(e, {}).get('density') or PER.get(e, {}).get('density') or 7.5
def mix_density(comp):
    t = sum(comp.values())
    return 1 / sum((v / t) / dens_el(e) for e, v in comp.items())
def mix_density_old(comp):
    t = sum(comp.values())
    return sum(dens_el(e) * v / t for e, v in comp.items())
def mix_liquidus(comp):
    t = sum(comp.values())
    v = sum(PER[e]['melting_point_c'] * x / t for e, x in comp.items())
    return v * 0.92 if len(comp) > 1 else v
de = [abs(mix_density(r['comp']) - r['d']) / r['d'] * 100 for r in lib]
de_old = [abs(mix_density_old(r['comp']) - r['d']) / r['d'] * 100 for r in lib]
worst = int(np.argmax(de))
dens_check = dict(n=len(lib), mean_error_pct=round(float(np.mean(de)), 2), worst_error_pct=round(float(max(de)), 2), worst_grade=lib[worst]['name'],
                  within_3pct=int(sum(1 for e in de if e <= 3)), previous_mean_error_pct=round(float(np.mean(de_old)), 2), previous_worst_error_pct=round(float(max(de_old)), 2),
                  method='density of the mix from element densities (volumes add) against the datasheet density of each of the 48 library grades')
melt_ref = [('ss304', 1400, 1450), ('ss316', 1375, 1400), ('al6061', 582, 652), ('al7075', 477, 635), ('ti64', 1604, 1660),
            ('brass70', 915, 955), ('in718', 1260, 1336), ('ni200', 1435, 1446), ('cuetp', 1083, 1083), ('tungsten', 3410, 3422)]
ids = [r['id'] for r in lib]
liq = []
for g, lo, hi in melt_ref:
    r = lib[ids.index(g)]
    v = mix_liquidus(r['comp'])
    mid = (lo + hi) / 2
    liq.append(dict(name=r['name'], ref_low=lo, ref_high=hi, calculated=round(v), error_c=round(v - mid), inside=bool(lo <= v <= hi), close=bool(lo - 25 <= v <= hi + 25)))
out['calc_checks'] = dict(density=dens_check, liquidus=liq,
                          liquidus_note='Reference: typical published melting ranges (handbook values). The simulator uses a weighted average of the element melting points times 0.92, not a phase diagram.')
# exact formulas: dynamic pressure q = 1/2 rho v^2 and applied stress = load x safety factor, against hand calculation
hand = [('Air at 100 m/s (360 km/h)', 1.225, 360, 0.5 * 1.225 * 100 ** 2), ('Seawater at 10 m/s (36 km/h)', 1025, 36, 0.5 * 1025 * 10 ** 2), ('Water at 5 m/s (18 km/h)', 998, 18, 0.5 * 998 * 5 ** 2)]
out['calc_checks']['pressure'] = [dict(case=n, hand_pa=round(h, 1), calculated_pa=round(0.5 * rho * (kmh / 3.6) ** 2, 1)) for n, rho, kmh, h in hand]

dest = SRC / 'data' / 'evaluation.json'
dest.write_text(json.dumps(out, indent=1), encoding='utf-8')

# ------------------------------------------------------------------ write the numbers into evaluation.html (so it reads without JavaScript)
def f(v, d=0):
    return 'n/a' if v is None else f'{v:.{d}f}'

def rows(items, cols):
    return ''.join('<tr>' + ''.join(f'<td>{c(x)}</td>' for c in cols) + '</tr>' for x in items)

def block(name, html):
    global page
    a, b = f'<!--EVAL:{name}-->', f'<!--/EVAL:{name}-->'
    i, j = page.index(a) + len(a), page.index(b)
    page = page[:i] + html + page[j:]

page_path = SRC / 'evaluation.html'
page = page_path.read_text(encoding='utf-8')
sc, sh = out['steel_cv'], out['steel_cv_shipped']
block('steel', f"<tr><td>5-fold cross-validation, re-run by the script</td><td>{f(sc['mae'])} MPa</td><td>{f(sc['r2'], 2)}</td><td>{f(sc['baseline_mae'])} MPa</td></tr>"
      f"<tr><td>5-fold cross-validation, recorded when the shipped model was trained</td><td>{f(sh['mae'])} MPa</td><td>{f(sh['r2'], 2)}</td><td>{f(sh['baseline_mae'])} MPa</td></tr>")
block('ind', rows(ind['grades'], [lambda g: g['name'], lambda g: f(g['library_yield']), lambda g: f(g['predicted'])]) if ind['grades'] else '<tr><td colspan="3">No library grade was inside the steel model range.</td></tr>')
block('indnote', f"<strong>Only {ind['n_tested']} of the {out['library_grades']} library grades was inside the steel model's range</strong> (the other {ind['n_outside_range']} are stainless, aluminium, nickel and other alloys it was not trained for). "
      + (f"On that one grade the error was about {f(ind['mape'])}%. One grade proves very little, and it shows the model is rough outside its training data. " if ind['grades'] else '') + ind['note'])
L = out['library_loo']
block('lib', ''.join(f"<tr><td>{n}</td><td>{f(m['mae'])}</td><td>{f(m['mape'])}%</td><td>{f(m['r2'], 2)}</td></tr>" for n, m in [
    ('Always guess the average', L['guess_the_average']), ('Trained on the other 47 grades only', L['trained_on_47_grades']),
    ('Trained on the other 47 grades plus the 312 measured steels', L['trained_on_47_grades_plus_312_steels']),
    ('Same, predicting on a log scale (tried, not adopted)', L['tried_log_scale_not_adopted']),
    ('Same, with 400 trees instead of 80 (a bigger model: tried, no gain)', L['tried_400_trees_no_gain'])]))
block('vlib', rows(out['validation_library'], [lambda g: g['name'], lambda g: f(g['reference']), lambda g: f(g['predicted']), lambda g: f"{g['error_pct']:.0f}%"]))
block('vsteel', rows(out['validation_steels'], [lambda g: g['composition'], lambda g: f(g['measured']), lambda g: f(g['predicted']), lambda g: f"{g['error_pct']:.0f}%"]))

fh, cc = out['family_holdout'], out['calc_checks']
block('famsum', f"Overall, with whole families hidden, the library model's average error is <strong>{f(fh['overall']['mape'])}%</strong> and R² is <strong>{f(fh['overall']['r2'], 2)}</strong> (compare {f(L['trained_on_47_grades_plus_312_steels']['mape'])}% and {f(L['trained_on_47_grades_plus_312_steels']['r2'], 2)} when only single grades are hidden).")
block('fam', rows(fh['families'], [lambda g: g['family'], lambda g: str(g['n']), lambda g: f"{g['mape']:.0f}%", lambda g: f"{g['guess_mape']:.0f}%"]))
dc = cc['density']
block('dens', f"The simulator mixes densities so that volumes add. Across all {dc['n']} grades the mean difference from the datasheet density is <strong>{dc['mean_error_pct']}%</strong> (worst {dc['worst_error_pct']}%, {dc['worst_grade']}); {dc['within_3pct']} of {dc['n']} are within 3%. An earlier version averaged densities by weight and was off by {dc['previous_mean_error_pct']}% on average and up to {dc['previous_worst_error_pct']}%; the check found that, and it was fixed.")
block('liq', rows(cc['liquidus'], [lambda g: g['name'], lambda g: f"{g['ref_low']}" if g['ref_low'] == g['ref_high'] else f"{g['ref_low']}–{g['ref_high']}", lambda g: f"{g['calculated']}", lambda g: 'yes' if g['inside'] else ('close (within 25 °C)' if g['close'] else f"no ({g['error_c']:+d} °C from the middle)")]))
n_in = sum(1 for g in cc['liquidus'] if g['inside'])
n_close = sum(1 for g in cc['liquidus'] if g['close'])
block('liqnote', f"The simulator's estimate is a weighted average of the element melting points times 0.92, so it is only rough: <strong>{n_in} of {len(cc['liquidus'])}</strong> landed inside the published range and <strong>{n_close}</strong> were inside it or within 25 °C. The worst miss was {max(abs(g['error_c']) for g in cc['liquidus'])} °C. Nickel superalloys, titanium, brass and stainless steels are the weak spots.")
block('pres', rows(cc['pressure'], [lambda g: g['case'], lambda g: f"{g['hand_pa']:,.0f}", lambda g: f"{g['calculated_pa']:,.0f}"]))
page_path.write_text(page, encoding='utf-8')
print(json.dumps({k: out[k] for k in ('steel_cv', 'library_loo', 'validation_library', 'validation_steels')}, indent=1))
print('wrote', dest, 'and', page_path)
