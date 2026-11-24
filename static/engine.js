/* ==========================================================================
   MATERIALHUNT — estimator switch
   One setting that every tool reads:
     Rules       fixed formulas and the library table, no machine learning
     Default ML  the pre-trained steel model plus the library model that come with the site
     My ML       the model you trained yourself in the ML Lab
   The switch sits at the top of the Simulator, Compare, Alloy Finder, Failure Doctor and ML Lab and is kept
   in sync. Library grades always keep their datasheet values; ML only adds a clearly labelled estimate or a
   cross-check (what a model that never saw that grade would have guessed), and never replaces a datasheet number.
   ========================================================================== */
'use strict';

(function () {
  const KEY = 'mh_engine';
  const CKEY = 'mh_ml_custom_v1';
  const MODES = [
    ['rules', 'Rules', 'Fixed formulas and the library table. No machine learning.'],
    ['ml', 'Default ML', 'The pre-trained steel model and the library model that come with the site.'],
    ['custom', 'My ML', 'The model you trained yourself in the ML Lab.'],
  ];
  const PROPS = {
    y: { label: 'yield strength', unit: 'MPa', get: (g) => g.y },
    uts: { label: 'tensile strength', unit: 'MPa', get: (g) => g.uts },
    t: { label: 'max service temperature', unit: '°C', get: (g) => g.t },
    price: { label: 'price', unit: '₹/kg', get: (g) => (g.price ? (g.price[0] + g.price[1]) / 2 : null) },
  };
  const VIEWS = ['simulator', 'comparison', 'ai-design', 'doctor', 'ml'];
  const q = (s, r = document) => r.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let mode = 'ml';
  try { const m = localStorage.getItem(KEY); if (MODES.some((x) => x[0] === m)) mode = m; } catch { /* storage blocked */ }
  let custom = null;
  try { custom = JSON.parse(localStorage.getItem(CKEY) || 'null'); } catch { custom = null; }
  const defaults = {};   // prop -> trained default model (library only), built lazily in the background

  const gradeComp = (g) => {
    const c = {};
    Object.entries(g.comp).forEach(([k, v]) => { if (k !== 'bal' && typeof v === 'number') c[k] = v; });
    if (g.comp.bal) c[g.comp.bal] = Math.max(0, 100 - Object.values(c).reduce((a, b) => a + b, 0));
    return c;
  };

  function emit() { window.dispatchEvent(new Event('mh:engine')); syncBars(); }

  function setMode(m) {
    if (!MODES.some((x) => x[0] === m)) return;
    if (m === 'custom' && !custom) m = 'ml';
    mode = m;
    try { localStorage.setItem(KEY, m); } catch { /* ignore */ }
    emit();
  }

  function setCustom(model, prop) {
    custom = { prop, label: model.targetLabel, n: model.n, cv: model.cv, baseline: model.baseline, model: { features: model.features, trees: model.trees, params: model.params }, points: model.points, savedAt: Date.now() };
    try { localStorage.setItem(CKEY, JSON.stringify(custom)); } catch { /* too large for storage: it still works for this visit */ }
    emit();
  }

  /* Estimate one property for a composition (weight percent). Returns null when this mode has nothing to add. */
  function estimate(comp, structure, prop = 'y', m = mode) {
    const ML = window.MH_ML;
    if (m === 'rules' || !ML) return null;
    if (m === 'custom' && custom && custom.prop === prop) {
      const e = ML.estimate(custom.model, comp, structure || 'BCC');
      if (e && e.outside) return { refused: true, why: 'it is outside the range of compositions your own model was trained on', source: 'refused', label: 'My ML' };
      return e ? { value: e.value, spread: e.spread, source: 'custom', label: 'My ML' } : null;
    }
    if (prop === 'y') {
      const s = ML.steelEstimate && ML.steelEstimate(comp);
      if (s && s.ok) return { value: s.value, spread: s.spread, source: 'steel-ml', label: 'Steel ML' };
      if (ML.model) {
        const e = ML.estimate(ML.model, comp, structure || 'BCC');
        if (e && e.outside) return { refused: true, why: `${s && s.why && s.why !== 'loading' ? s.why + ' ' : ''}It is also outside the range of compositions the library model learned from.`, source: 'refused', label: 'Library ML' };
        if (e) return { value: e.value, spread: e.spread, source: 'ml', label: 'Library ML' };
      }
      return null;
    }
    const d = defaults[prop];
    if (d && d.model) {
      const e = ML.estimate(d.model, comp, structure || 'BCC');
      if (e && e.outside) return { refused: true, why: 'it is outside the range of compositions the library model learned from', source: 'refused', label: 'Library ML' };
      if (e) return { value: e.value, spread: e.spread, source: 'ml', label: 'Library ML' };
    }
    return null;
  }

  /* what the default model said about a library grade it was NOT trained on (out-of-fold prediction) */
  function blindGuess(g, prop) {
    const ML = window.MH_ML;
    const m = prop === 'y' ? ML && ML.model : defaults[prop] && defaults[prop].model;
    const pt = m && m.points && m.points.find((p) => p.name === g.name);
    return pt ? pt.pred : null;
  }

  const f0 = (v) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-IN') : v.toFixed(0));

  /* one line shown under a grade in the Alloy Finder / Failure Doctor */
  function crossCheckHtml(g, prop = 'y') {
    if (mode === 'rules' || !g) return '';
    const P = PROPS[prop];
    const lib = P.get(g);
    if (!Number.isFinite(lib)) return '';
    let guess = null; let who = '';
    if (mode === 'custom' && custom) {
      const cp = custom.prop;
      const pt = custom.points && custom.points.find((p) => p.name === g.name);
      if (pt) { guess = pt.pred; who = `My ML for ${PROPS[cp].label} (which never saw this grade)`; prop = cp; }   // out-of-fold, so it cannot have memorised the grade
      else { const e = estimate(gradeComp(g), g.s, cp, 'custom'); if (e) { guess = e.value; who = `My ML for ${PROPS[cp].label}`; prop = cp; } }
    }
    if (guess === null) { guess = blindGuess(g, prop); who = 'Default ML (which never saw this grade)'; }
    if (guess === null || !Number.isFinite(guess)) return '';
    const lib2 = PROPS[prop].get(g);
    const gap = Math.abs(guess - lib2) / Math.max(1, Math.abs(lib2));
    const verdict = gap <= 0.25 ? 'close to the datasheet value' : gap <= 0.6 ? 'some distance from the datasheet value' : 'far from the datasheet value, so trust the datasheet';
    return `<p class="ml-xcheck"><b>ML check:</b> ${esc(who)} would estimate ${esc(PROPS[prop].label)} at ${f0(guess)} ${esc(PROPS[prop].unit)} (library: ${f0(lib2)}), ${verdict}.</p>`;
  }

  /* a short ML-based note for text that contains a composition such as "Fe70 Cr18 Ni10" */
  const KNOWN = new Set('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Zr Nb Mo Ru Rh Pd Ag Cd In Sn Sb Te Hf Ta W Re Os Ir Pt Au Pb Bi'.split(' '));
  function parseComposition(text) {
    const comp = {}; let n = 0;
    String(text).replace(/\b([A-Z][a-z]?)\s*([0-9]+(?:\.[0-9]+)?)\b/g, (m, sym, val) => { if (KNOWN.has(sym)) { comp[sym] = (comp[sym] || 0) + Number(val); n += 1; } return m; });
    return n >= 2 ? comp : null;
  }
  function describeComposition(comp) {
    const total = Object.values(comp).reduce((a, b) => a + b, 0) || 1;
    const wt = Object.fromEntries(Object.entries(comp).map(([k, v]) => [k, (v / total) * 100]));
    const formula = Object.entries(wt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${Math.round(v * 10) / 10}`).join(' ');
    const lines = [];
    const ML = window.MH_ML;
    const grade = ML && ML.libraryMatch ? ML.libraryMatch(wt) : null;
    if (grade) lines.push(`That is close to the library grade **${grade.name}**, whose typical yield strength is ${grade.y} MPa (a datasheet value).`);
    const e = estimate(wt, 'BCC', 'y', mode === 'rules' ? 'ml' : mode);
    if (e && e.refused) {
      lines.push(`No ML estimate for ${formula}: ${e.why} A model should not guess outside what it has seen, so check a datasheet or a lab.`);
    } else if (e) {
      lines.push(`${e.label} estimate of yield strength for ${formula}: about **${f0(e.value)} MPa** (spread between trees ±${f0(e.spread)}).${e.source === 'steel-ml' ? ' The steel model was typically about 84 MPa off on steels it had not seen.' : e.source === 'ml' ? ' The library model is a rough guide (roughly 50% average error on grades it had not seen).' : ' Its accuracy depends on the data you trained it on.'}`);
    } else if (!grade) lines.push('The ML models are not ready yet, or this mix is outside what they know.');
    lines.push('This is a screening estimate, not a measurement: heat treatment can change real strength a lot. Confirm with a lab test.');
    return lines;
  }
  function contextFor(text) {
    const comp = parseComposition(text);
    if (!comp) return '';
    return describeComposition(comp).join(' ').replace(/\*\*/g, '');
  }

  /* ---------------------------------------------------------------- */
  /* background models for the other properties (used for cross-checks) */
  async function warm() {
    const ML = window.MH_ML;
    if (!ML || !ML.libraryRows) return;
    for (const prop of ['uts', 't', 'price']) {
      if (defaults[prop]) continue;
      try {
        const rows = ML.libraryRows(prop);
        if (rows.length < 10) continue;
        defaults[prop] = { model: await ML.trainAndEvaluate({ rows, targetLabel: PROPS[prop].label, unit: PROPS[prop].unit, params: { trees: 60 } }) };
      } catch { /* the cross-check for this property is simply skipped */ }
    }
    window.dispatchEvent(new Event('mh:engine-ready'));
  }

  /* ---------------------------------------------------------------- */
  /* the switch                                                         */
  function note() {
    const ML = window.MH_ML;
    if (mode === 'rules') return 'Using fixed formulas and the library table. No machine learning is involved.';
    if (mode === 'custom' && custom) return `Using your model: ${custom.label} (${custom.n} samples, error about ${Math.round(custom.cv.mape)}%). It is used for ${PROPS[custom.prop].label}; other properties use Default ML.`;
    const m = ML && ML.model;
    return `Order used: library grade datasheet value, then the steel model (312 measured steels), then the library model${m ? ` (${m.n} grades + ${m.extra || 0} steels)` : ''}. Outside their ranges the models refuse and the rough formula is used instead.`;
  }

  function barHtml(view) {
    const id = `eng-${view}`;
    return `<div class="engine-bar glass" data-engine-bar>
      <span class="engine-title">Estimator <i class="term-hint" data-hint="Choose what powers the estimates and checks on this page. Rules: fixed formulas and the library table. Default ML: the pre-trained steel model and the library model. My ML: the model you trained in the ML Lab. The choice is shared by every tab." data-ask="Where is the machine learning on this site?">?</i></span>
      <span class="engine-opts" role="radiogroup" aria-label="Estimator">${MODES.map(([k, label, tip]) => `<label class="engine-opt" title="${esc(tip)}"><input type="radio" name="${id}" value="${k}" ${k === 'custom' && !custom ? 'disabled' : ''}/> <span>${label}</span></label>`).join('')}</span>
      <span class="engine-note" data-engine-note></span>
    </div>`;
  }

  function syncBars() {
    document.querySelectorAll('[data-engine-bar]').forEach((bar) => {
      bar.querySelectorAll('input[type=radio]').forEach((r) => { r.checked = r.value === mode; if (r.value === 'custom') r.disabled = !custom; });
      const n = bar.querySelector('[data-engine-note]');
      if (n) n.textContent = note();
      const opt = bar.querySelector('input[value=custom]');
      if (opt) opt.closest('label').title = custom ? 'The model you trained yourself in the ML Lab.' : 'Train a model in the ML Lab first, then press "Use as My ML".';
    });
  }

  function mountBars() {
    VIEWS.forEach((v) => {
      const view = document.getElementById(`view-${v}`);
      if (!view || view.querySelector('[data-engine-bar]')) return;
      const wrap = document.createElement('div');
      wrap.innerHTML = barHtml(v);
      const bar = wrap.firstElementChild;
      const head = view.querySelector('.section-head');
      if (head && head.parentNode === view) head.insertAdjacentElement('afterend', bar); else view.insertBefore(bar, view.firstChild);
      bar.addEventListener('change', (e) => { if (e.target && e.target.type === 'radio') setMode(e.target.value); });
    });
    syncBars();
  }

  function boot() {
    let n = 0;
    const t = setInterval(() => { mountBars(); if (n++ > 80) clearInterval(t); }, 500);
    window.addEventListener('mh:engine-ready', syncBars);
    setTimeout(() => { warm(); }, 6000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.MH_ENGINE = {
    mode: () => mode, setMode, setCustom, estimate, crossCheckHtml, contextFor, parseComposition, describeComposition,
    get custom() { return custom; }, get defaults() { return defaults; }, props: PROPS,
  };
})();
