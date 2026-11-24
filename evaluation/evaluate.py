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

def loo(extra):
    pred = []
    for i in range(len(lib)):
        tr = [k for k in range(len(lib)) if k != i]
        Xt, yt = Xl[tr], yl[tr]
        if extra:
            Xt, yt = np.vstack([Xt, Xe]), np.concatenate([yt, ys])
        pred.append(RandomForestRegressor(n_estimators=80, max_features=0.4, random_state=i).fit(Xt, yt).predict(Xl[i:i + 1])[0])
    return metrics(yl, pred)

base = [np.delete(yl, i).mean() for i in range(len(yl))]
out['library_loo'] = dict(
    guess_the_average=metrics(yl, base),
    trained_on_47_grades=loo(False),
    trained_on_47_grades_plus_312_steels=loo(True),
    method='leave-one-out over the 48 library grades; random forest, 80 trees, seed per fold')
dest = SRC / 'data' / 'evaluation.json'
dest.write_text(json.dumps(out, indent=1), encoding='utf-8')
print(json.dumps(out, indent=1))
print('wrote', dest)
