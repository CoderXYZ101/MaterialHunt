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
        rows.append(dict(id=gid, name=name, comp=comp, y=y, s=st.group(1) if st else 'BCC'))
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

def loo(extra, log=False):
    pred = []
    for i in range(len(lib)):
        tr = [k for k in range(len(lib)) if k != i]
        Xt, yt = Xl[tr], yl[tr]
        if extra:
            Xt, yt = np.vstack([Xt, Xe]), np.concatenate([yt, ys])
        m = RandomForestRegressor(n_estimators=80, max_features=0.4, random_state=i).fit(Xt, np.log(yt) if log else yt)
        v = m.predict(Xl[i:i + 1])[0]
        pred.append(float(np.exp(v)) if log else float(v))
    return np.array(pred)

base = [np.delete(yl, i).mean() for i in range(len(yl))]
p47 = loo(False)
p359 = loo(True)
plog = loo(True, log=True)
out['library_loo'] = dict(
    guess_the_average=metrics(yl, base),
    trained_on_47_grades=metrics(yl, p47),
    trained_on_47_grades_plus_312_steels=metrics(yl, p359),
    tried_log_scale_not_adopted=metrics(yl, plog),
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
    ('Same, predicting on a log scale (tried, not adopted)', L['tried_log_scale_not_adopted'])]))
block('vlib', rows(out['validation_library'], [lambda g: g['name'], lambda g: f(g['reference']), lambda g: f(g['predicted']), lambda g: f"{g['error_pct']:.0f}%"]))
block('vsteel', rows(out['validation_steels'], [lambda g: g['composition'], lambda g: f(g['measured']), lambda g: f(g['predicted']), lambda g: f"{g['error_pct']:.0f}%"]))
page_path.write_text(page, encoding='utf-8')
print(json.dumps({k: out[k] for k in ('steel_cv', 'library_loo', 'validation_library', 'validation_steels')}, indent=1))
print('wrote', dest, 'and', page_path)
