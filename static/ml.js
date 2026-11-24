/* ==========================================================================
   MATERIALHUNT — ML Lab (runs entirely in your browser, works offline)
   A small random-forest regression model, written from scratch (no cloud, no library). It learns a
   property (yield strength, tensile strength, maximum service temperature or price) from an alloy's
   chemical composition and crystal structure. It is trained on the 48-grade library by default, or on
   your own table of measurements (CSV). Its accuracy is measured honestly with leave-one-out
   cross-validation: each sample is predicted by a model that never saw it.
   This is a small-data model: with 48 samples it is a rough guide, not a replacement for a lab test.
   ========================================================================== */
'use strict';

(function () {
  const q = (selector, root = document) => root.querySelector(selector);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t = 'info', ms) => { if (typeof toast === 'function') toast(m, t, ms); };
  const STRUCT = ['BCC', 'FCC', 'HCP'];
  const STORE = 'mh_ml_v2';
  const TARGETS = {
    y: { label: 'Yield strength (MPa)', unit: 'MPa', get: (g) => g.y },
    uts: { label: 'Tensile strength (MPa)', unit: 'MPa', get: (g) => g.uts },
    t: { label: 'Maximum service temperature (°C)', unit: '°C', get: (g) => g.t },
    price: { label: 'Price (₹/kg, middle of the range)', unit: '₹/kg', get: (g) => (g.price ? (g.price[0] + g.price[1]) / 2 : NaN) },
  };

  /* ------------------------------------------------------------------ */
  /* Random forest                                                        */
  /* ------------------------------------------------------------------ */
  function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function growTree(X, y, idx, p, rand, depth) {
    const n = idx.length;
    let sum = 0; let sum2 = 0;
    for (const i of idx) { sum += y[i]; sum2 += y[i] * y[i]; }
    const mean = sum / n;
    const sse = sum2 - (sum * sum) / n;
    if (depth >= p.maxDepth || n < p.minSplit || sse < 1e-9) return { v: mean };
    const nf = X[0].length;
    const feats = Array.from({ length: nf }, (_, i) => i);
    for (let i = nf - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [feats[i], feats[j]] = [feats[j], feats[i]]; }
    const take = Math.max(1, Math.round(nf * p.mtry));
    let best = null;
    for (const f of feats.slice(0, take)) {
      const order = idx.slice().sort((a, b) => X[a][f] - X[b][f]);
      let ls = 0; let l2 = 0;
      for (let k = 0; k < n - 1; k += 1) {
        const i = order[k];
        ls += y[i]; l2 += y[i] * y[i];
        const a = X[order[k]][f]; const b = X[order[k + 1]][f];
        if (a === b) continue;
        const nl = k + 1; const nr = n - nl;
        if (nl < p.minLeaf || nr < p.minLeaf) continue;
        const rs = sum - ls;
        const tot = (l2 - (ls * ls) / nl) + ((sum2 - l2) - (rs * rs) / nr);
        if (!best || tot < best.tot) best = { f, t: (a + b) / 2, tot };
      }
    }
    if (!best || best.tot >= sse - 1e-9) return { v: mean };
    const left = []; const right = [];
    for (const i of idx) (X[i][best.f] <= best.t ? left : right).push(i);
    return { f: best.f, t: best.t, l: growTree(X, y, left, p, rand, depth + 1), r: growTree(X, y, right, p, rand, depth + 1) };
  }

  const walk = (node, x) => { let n = node; while (n.v === undefined) n = x[n.f] <= n.t ? n.l : n.r; return n.v; };

  function trainForest(X, y, params, seed) {
    const p = { trees: 80, maxDepth: 8, minSplit: 3, minLeaf: 1, mtry: 0.4, ...params };
    const rand = mulberry(seed || 7);
    const n = X.length;
    const trees = [];
    for (let t = 0; t < p.trees; t += 1) {
      const idx = Array.from({ length: n }, () => Math.floor(rand() * n));
      trees.push(growTree(X, y, idx, p, rand, 0));
    }
    return trees;
  }

  function predictForest(trees, x) {
    const vals = trees.map((t) => walk(t, x));
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const spread = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    return { value: mean, spread };
  }

  /* ------------------------------------------------------------------ */
  /* Data                                                                 */
  /* ------------------------------------------------------------------ */
  function gradeFractions(g) {
    const c = {};
    Object.entries(g.comp).forEach(([k, v]) => { if (k !== 'bal' && typeof v === 'number') c[k] = v; });
    if (g.comp.bal) c[g.comp.bal] = Math.max(0, 100 - Object.values(c).reduce((a, b) => a + b, 0));
    return c;
  }

  function libraryRows(targetKey) {
    const T = window.MH_TOOLS;
    if (!T) return [];
    const get = TARGETS[targetKey].get;
    return T.GRADES.map((g) => ({ name: g.name, comp: gradeFractions(g), structure: g.s, target: Number(get(g)) })).filter((r) => Number.isFinite(r.target) && r.target > 0);
  }

  function parseCsv(text) {
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 6) throw new Error('Add a header row and at least 5 rows of data.');
    const split = (l) => l.split(/[,;\t]/).map((c) => c.trim());
    const head = split(lines[0]);
    const isEl = (h) => /^[A-Z][a-z]?$/.test(h);
    const elCols = head.map((h, i) => (isEl(h) ? i : -1)).filter((i) => i >= 0);
    const structCol = head.findIndex((h) => /^structure$/i.test(h));
    const nameCol = head.findIndex((h) => /^(name|alloy|grade|id)$/i.test(h));
    const targetCols = head.map((h, i) => i).filter((i) => !elCols.includes(i) && i !== structCol && i !== nameCol);
    if (!elCols.length) throw new Error('No element columns found. Use element symbols such as Fe, Cr, Ni as column names.');
    if (!targetCols.length) throw new Error('No target column found. Add a column with the measured value, for example "yield".');
    const tCol = targetCols[0];
    const rows = [];
    lines.slice(1).forEach((line, k) => {
      const c = split(line);
      const comp = {};
      elCols.forEach((i) => { const v = Number(c[i]); if (Number.isFinite(v) && v > 0) comp[head[i]] = v; });
      const target = Number(c[tCol]);
      if (!Object.keys(comp).length || !Number.isFinite(target)) return;
      const st = structCol >= 0 ? String(c[structCol] || '').toUpperCase() : 'BCC';
      rows.push({ name: nameCol >= 0 ? c[nameCol] : `row ${k + 1}`, comp, structure: STRUCT.includes(st) ? st : 'BCC', target });
    });
    if (rows.length < 5) throw new Error('Fewer than 5 usable rows were found.');
    return { rows, targetName: head[tCol] };
  }

  function featureList(rows) {
    const w = {};
    rows.forEach((r) => Object.entries(r.comp).forEach(([k, v]) => { w[k] = (w[k] || 0) + v; }));
    return Object.keys(w).sort((a, b) => w[b] - w[a]).slice(0, 34).sort();
  }
  function vectorise(comp, structure, features) {
    const total = Object.values(comp).reduce((a, b) => a + b, 0) || 1;
    return [...features.map((f) => ((comp[f] || 0) / total) * 100), ...STRUCT.map((s) => (s === structure ? 1 : 0))];
  }

  /* ------------------------------------------------------------------ */
  /* Training and honest evaluation                                       */
  /* ------------------------------------------------------------------ */
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const metrics = (actual, pred) => {
    const n = actual.length;
    const mae = actual.reduce((s, a, i) => s + Math.abs(a - pred[i]), 0) / n;
    const mape = actual.reduce((s, a, i) => s + Math.abs(a - pred[i]) / Math.abs(a), 0) / n * 100;
    const mean = actual.reduce((a, b) => a + b, 0) / n;
    const ssr = actual.reduce((s, a, i) => s + (a - pred[i]) ** 2, 0);
    const sst = actual.reduce((s, a) => s + (a - mean) ** 2, 0) || 1;
    return { mae, mape, r2: 1 - ssr / sst };
  };

  /* rows are tested; extraRows (optional) are only ever added to the training side, so they can never flatter the score.
     folds = 0 means leave-one-out; folds = k means k-fold. onProgress may be async (the live demo uses it to slow down). */
  async function trainAndEvaluate({ rows, extraRows = [], folds = 0, targetLabel, unit, params, onProgress }) {
    const features = featureList(rows.concat(extraRows));
    const X = rows.map((r) => vectorise(r.comp, r.structure, features));
    const y = rows.map((r) => r.target);
    const Xe = extraRows.map((r) => vectorise(r.comp, r.structure, features));
    const ye = extraRows.map((r) => r.target);
    const n = rows.length;
    const k = folds && folds < n ? folds : n;
    const order = rows.map((_, i) => i);
    if (folds) { const rand = mulberry(5); for (let i = n - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } }
    const loo = new Array(n).fill(0);
    const looSpread = new Array(n).fill(0);
    let absErr = 0; let absBase = 0; let done = 0;
    for (let f = 0; f < k; f += 1) {
      const held = folds ? order.filter((_, j) => j % k === f) : [f];
      const heldSet = new Set(held);
      const keep = X.map((_, i) => i).filter((i) => !heldSet.has(i));
      const trees = trainForest([...keep.map((i) => X[i]), ...Xe], [...keep.map((i) => y[i]), ...ye], { ...params, trees: Math.min(params.trees || 80, 50) }, 100 + f);
      const info = { fold: f + 1, folds: k, treesTrained: trees.length, trainedOn: keep.length + extraRows.length, held: [] };
      held.forEach((i) => {
        const p = predictForest(trees, X[i]);
        loo[i] = p.value; looSpread[i] = p.spread;
        const base = keep.reduce((a2, j) => a2 + y[j], 0) / keep.length;
        absErr += Math.abs(y[i] - p.value); absBase += Math.abs(y[i] - base); done += 1;
        info.held.push({ name: rows[i].name, actual: y[i], pred: p.value, base });
      });
      info.runMae = absErr / done; info.runBase = absBase / done;
      if (onProgress) await onProgress((f + 1) / k, info);
      else if (f % 4 === 0) await tick();
    }
    const meanBaseline = y.map((_, i) => y.filter((__, kk) => kk !== i).reduce((a2, b2) => a2 + b2, 0) / (n - 1));
    const finalTrees = trainForest([...X, ...Xe], [...y, ...ye], params, 99);
    const within = y.filter((a2, i) => Math.abs(a2 - loo[i]) <= looSpread[i] * 2).length / n * 100;
    return {
      features, trees: finalTrees, params, n, extra: extraRows.length, evalMethod: folds ? `${k}-fold` : 'leave-one-out', targetLabel, unit, trainedAt: Date.now(),
      cv: { ...metrics(y, loo), within },
      baseline: metrics(y, meanBaseline),
      points: rows.map((r, i) => ({ name: r.name, actual: y[i], pred: loo[i], spread: looSpread[i] })),
    };
  }

  /* ------------------------------------------------------------------ */
  /* State and the simulator readout                                      */
  /* ------------------------------------------------------------------ */
  let current = null;           // the model used by the simulator (library yield strength)
  let lab = null;               // the latest model trained in the Lab
  let training = false;

  const save = (m) => { try { localStorage.setItem(STORE, JSON.stringify({ ...m, points: m.points })); } catch { /* storage full */ } };
  const load = () => { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; } };

  function estimate(model, comp, structure) {
    if (!model) return null;
    const x = vectorise(comp, structure, model.features);
    return predictForest(model.trees, x);
  }

  function libraryMatch(fractions) {
    const T = window.MH_TOOLS;
    if (!T) return null;
    let best = null;
    T.GRADES.forEach((g) => {
      const gc = gradeFractions(g);
      const keys = new Set([...Object.keys(gc), ...Object.keys(fractions)]);
      let d = 0;
      keys.forEach((k) => { d += Math.abs((gc[k] || 0) - (fractions[k] || 0)); });
      if (!best || d < best.d) best = { g, d };
    });
    return best && best.d <= 6 ? best.g : null;
  }

  /* ------------------------------------------------------------------ */
  /* Steel model: trained offline on 312 measured steels, runs here        */
  /* ------------------------------------------------------------------ */
  const AMASS = { Al: 26.982, C: 12.011, Co: 58.933, Cr: 51.996, Fe: 55.845, Mn: 54.938, Mo: 95.95, N: 14.007, Nb: 92.906, Ni: 58.693, Si: 28.086, Ti: 47.867, V: 50.942, W: 183.84 };
  let steel = null;

  async function loadSteel() {
    if (steel) return steel;
    const res = await fetch('data/steel-yield-model.json');
    if (!res.ok) throw new Error('steel model file missing');
    const d = await res.json();
    const X = d.X;
    const dist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 1) s += (a[i] - b[i]) ** 2; return Math.sqrt(s); };
    // how close is a typical training steel to its nearest neighbour? A new mix farther than the 95th percentile is outside what the model has seen
    const nn = X.map((a, i) => { let m = Infinity; for (let k = 0; k < X.length; k += 1) if (k !== i) { const v = dist(a, X[k]); if (v < m) m = v; } return m; }).sort((a, b) => a - b);
    steel = { d, X, domain: nn[Math.floor(nn.length * 0.95)] * 1.25, dist, elements: d.elements };
    return steel;
  }

  function steelTree(t, x) { let i = 0; while (t.f[i] !== -2) i = x[t.f[i]] <= t.t[i] ? t.l[i] : t.r[i]; return t.v[i]; }

  /* comp: weight percent by element. Returns { ok, why } when the mix is outside the steel model's range. */
  function steelEstimate(comp) {
    if (!steel) return { ok: false, why: 'loading' };
    const els = steel.elements;
    const total = Object.values(comp).reduce((a, b) => a + b, 0) || 1;
    const known = els.reduce((s, e) => s + (comp[e] || 0), 0);
    if (known / total < 0.97) return { ok: false, why: 'It contains elements the steel model never saw.' };
    const moles = els.map((e) => (comp[e] || 0) / AMASS[e]);
    const mt = moles.reduce((a, b) => a + b, 0) || 1;
    const x = moles.map((m) => m / mt);
    const fe = x[els.indexOf('Fe')];
    if (fe < 0.4) return { ok: false, why: 'It is not iron-based.' };
    const nearest = steel.X.reduce((m, r) => Math.min(m, steel.dist(x, r)), Infinity);
    if (nearest > steel.domain) return { ok: false, why: 'It is far from the 312 alloyed steels the model learned from (they are all high-strength steels).' };
    const vals = steel.d.trees.map((t) => steelTree(t, x));
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const spread = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    return { ok: true, value: mean, spread, nearest, cv: steel.d.cv };
  }

  function refreshReadout() {
    const strong = q('#heroConfidence');
    if (!strong || typeof state === 'undefined') return;
    const label = strong.parentElement?.querySelector('span');
    const comp = typeof normalisedComposition === 'function' ? normalisedComposition() : null;
    if (!comp) return;
    const src = state.simulation?.prediction?.source;
    const pill = q('#simConfidence');
    if (src === 'custom') {
      if (label) label.textContent = 'My ML estimate';
      strong.textContent = `≈ ${Math.round(state.simulation.prediction.predicted)} MPa`;
      strong.title = 'Estimate from the model you trained yourself in the ML Lab (My ML). Its accuracy is whatever your training data allows.';
      if (pill) { pill.textContent = 'My ML'; pill.className = 'pill pill-cyan'; }
      return;
    }
    if (src === 'steel-ml') {
      const cv = steel?.d?.cv;
      if (label) label.textContent = 'Steel ML estimate';
      strong.textContent = `≈ ${Math.round(state.simulation.prediction.predicted)} MPa`;
      strong.title = `Machine-learning model trained offline on 312 measured high-strength steels and run on your device. Tested on steels it had not seen (5-fold cross-validation): average error ${cv ? Math.round(cv.mae) : '84'} MPa, R² ${cv ? cv.r2 : '0.85'}. Spread between trees ±${Math.round(state.simulation.prediction.ml_spread || 0)} MPa. A guide, not a lab measurement.`;
      if (pill) { pill.textContent = 'Steel ML'; pill.className = 'pill pill-cyan'; }
      return;
    }
    if (src === 'grade') {
      const g = libraryMatch(Object.fromEntries(Object.entries(comp).map(([k, v]) => [k, v])));
      if (label) label.textContent = 'Reference yield';
      strong.textContent = `${Math.round(state.simulation.prediction.predicted)} MPa${g ? ` · ${g.name.split(' (')[0]}` : ''}`;
      strong.title = 'Typical yield of the matching library grade. This is a library value, not a measurement of your batch.';
      if (pill) { pill.textContent = 'Grade value'; pill.className = 'pill pill-emerald'; }
      return;
    }
    const e = src === 'ml' && current ? estimate(current, comp, state.structure || 'BCC') : null;
    if (e) {
      if (label) label.textContent = 'ML yield estimate';
      strong.textContent = `≈ ${Math.round(e.value)} MPa`;
      strong.title = 'Random forest trained on ' + current.n + ' library grades' + (current.extra ? ' plus ' + current.extra + ' measured steels' : '') + '. Average error on grades it had not seen (' + (current.evalMethod || 'cross-validation') + '): about ' + Math.round(current.cv.mape) + '%. Spread between trees ±' + Math.round(e.spread) + ' MPa (not a calibrated confidence). Open ML Lab for details.';
      if (pill) { pill.textContent = 'ML estimate'; pill.className = 'pill pill-amber'; }
    } else if (label) label.textContent = 'Yield estimate';
  }

  const rerun = () => { refreshReadout(); if (typeof runSimulation === 'function' && !state.forgeRun && state.initialised) runSimulation({ silent: true }); };

  /* the 312 measured steels, as training rows (weight percent), used only on the training side */
  function steelRows() {
    if (!steel) return [];
    return steel.X.map((x, i) => {
      const w = steel.elements.map((e, k) => x[k] * AMASS[e]);
      const t = w.reduce((a, b) => a + b, 0) || 1;
      const comp = {}; steel.elements.forEach((e, k) => { if (w[k] > 0) comp[e] = (w[k] / t) * 100; });
      return { name: `measured steel ${i + 1}`, comp, structure: 'BCC', target: steel.d.y[i], extra: true };
    });
  }

  async function autoTrain() {
    // the steel model is pre-trained, so it is ready as soon as its file loads
    try { await loadSteel(); } catch { /* offline without the file: the library model still works on its own */ }
    renderDefault(); rerun();
    const saved = load();
    if (saved && saved.kind === 'library-y' && saved.trees && Boolean(saved.extra) === Boolean(steel)) { current = saved; renderDefault(); rerun(); return; }
    const rows = libraryRows('y');
    if (rows.length < 10) return;
    const m = await trainAndEvaluate({ rows, extraRows: steelRows(), folds: 8, targetLabel: TARGETS.y.label, unit: 'MPa', params: { trees: 80 } });
    m.kind = 'library-y';
    current = m;
    save(m);
    renderDefault();
    rerun();
  }

  /* what the ML Lab shows before anyone presses a button: the two models that are already working */
  function renderDefault() {
    const sec = q('#view-ml');
    if (!sec) return;
    const statR2 = q('#statAccuracy'); const statN = q('#statCandidates');
    if (steel && statR2) statR2.textContent = steel.d.cv.r2.toFixed(2);
    if (statN) statN.textContent = String((steel ? steel.d.n_train : 0) + libraryRows('y').length);
    const card = q('#mlSteel', sec);
    if (card && steel) {
      const cv = steel.d.cv;
      card.innerHTML = `<span class="pv-kicker">PRE-TRAINED · USED BY THE SIMULATOR FOR STEELS</span>
        <h3>Steel strength model</h3>
        <p class="micro-note">Learned from ${steel.d.n_train} measured high-strength steels (public Matbench steels data) and shipped with the site, so it works offline. When you test a steel-like mix in the Simulator that is not a library grade, this model gives the yield strength.</p>
        <div class="ml-kpis">
          <div><b>${cv.r2.toFixed(2)}</b><span>R² <i class="term-hint" data-hint="R² tells you how much of the real ups and downs in strength the model explains, on steels it was NOT trained on. 1.0 is perfect; 0 means no better than always guessing the average. 0.85 is a good score for this kind of data." data-ask="Explain the Best test R² score and what it means for material prediction">?</i></span></div>
          <div><b>${Math.round(cv.mae)} MPa</b><span>average error <i class="term-hint" data-hint="On steels hidden from the model during testing, its guess was off by this much on average. Guessing the average every time would be off by ${Math.round(cv.baseline_mae)} MPa.">?</i></span></div>
          <div><b>±${Math.round(cv.err80)} MPa</b><span>covers 4 in 5 steels <i class="term-hint" data-hint="For 80% of the test steels, the prediction was within this many MPa of the real value. Use it as a rough error bar.">?</i></span></div>
        </div>
        <p class="micro-note">${esc(cv.method)}. It only covers iron-based, alloyed steels in the range ${Math.round(steel.d.train_range[0])}-${Math.round(steel.d.train_range[1])} MPa. For anything else the simulator falls back to the library model below, then to a rough formula, and says which one it used.</p>`;
    }
    if (current && !lab && q('#mlResult', sec) && q('#mlResult .empty-state', sec)) {
      lab = current;
      renderResult();
      q('#mlTry', sec)?.classList.remove('hidden');
    }
  }

  /* ------------------------------------------------------------------ */
  /* ML Lab page                                                          */
  /* ------------------------------------------------------------------ */
  const f0 = (v) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-IN') : v.toFixed(1));

  function mount() {
    const main = q('main');
    if (!main || q('#view-ml')) return Boolean(q('#view-ml'));
    const sec = document.createElement('section');
    sec.className = 'view';
    sec.id = 'view-ml';
    sec.innerHTML = `<div class="section-head"><div><span class="panel-kicker">ML LAB · RUNS ON YOUR DEVICE</span><h2>Train a small model yourself</h2>
        <p>A random-forest model, written from scratch, that learns a property from an alloy's composition. Nothing leaves your device, and it works offline. Accuracy is measured honestly: every sample is predicted by a model that never saw it (leave-one-out).</p></div></div>
      <article class="glass ml-steel" id="mlSteel"><span class="pv-kicker">PRE-TRAINED</span><h3>Steel strength model</h3><p class="micro-note">Loading the pre-trained steel model…</p></article>
      <div class="ml-grid">
        <article class="glass tool-form ml-form">
          <label class="field-label" for="mlData">Training data</label>
          <select id="mlData" class="field-select"><option value="lib">Built-in library (48 grades)</option><option value="csv">My own table (CSV)</option></select>
          <div id="mlLibBox"><label class="field-label" for="mlTarget">What to predict</label>
            <select id="mlTarget" class="field-select">${Object.entries(TARGETS).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('')}</select></div>
          <div id="mlCsvBox" class="hidden"><label class="field-label" for="mlCsv">Paste your data</label>
            <textarea id="mlCsv" rows="8" spellcheck="false" placeholder="name,Fe,Cr,Ni,C,structure,yield&#10;sample 1,70,18,10,0.04,FCC,215&#10;sample 2,98,0,0,0.2,BCC,250&#10;..."></textarea>
            <p class="micro-note">One row per alloy. Use element symbols (Fe, Cr, Ni...) as column names with weight %, an optional <b>structure</b> column (BCC, FCC or HCP), and one column with the measured value to predict. At least 5 rows.</p>
            <input type="file" id="mlFile" accept=".csv,.txt" /></div>
          <div class="two-col"><div><label class="field-label" for="mlTrees">Trees</label><input id="mlTrees" type="number" min="10" max="300" value="80" /></div>
            <div><label class="field-label" for="mlDepth">Maximum depth</label><input id="mlDepth" type="number" min="2" max="14" value="8" /></div></div>
          <label class="check-row" id="mlSteelRow"><input type="checkbox" id="mlUseSteel" checked /> Also learn from the 312 measured steels <i class="term-hint" data-hint="More training data makes the yield-strength model better. The 312 steels are only used to teach the model; the score is still measured on the library grades alone, so it cannot be flattered.">?</i></label>
          <label class="check-row"><input type="checkbox" id="mlSlow" checked /> Slow motion (watch it learn) <i class="term-hint" data-hint="Slows training down so you can watch each step: hide some alloys, train the trees on the rest, then predict the hidden ones.">?</i></label>
          <button class="btn btn-primary full" id="mlTrain">Train and test the model</button>
          <div class="ml-progress hidden" id="mlProg"><i></i></div>
          <p class="form-error" id="mlErr"></p>
          <p class="micro-note">Small data means a rough guide. The numbers on the right say exactly how rough.</p>
        </article>
        <article class="glass ml-result" id="mlResult"><div class="empty-state"><strong>Training the library model…</strong><span>This runs once on your device (a few seconds). You can also press "Train and test the model" to try other settings.</span></div></article>
      </div>
      <article class="glass ml-live hidden" id="mlLive" aria-live="polite"></article>
      <article class="glass tool-form ml-try hidden" id="mlTry">
        <h3>Try the trained model</h3>
        <label class="field-label" for="mlComp">Composition (weight %)</label>
        <input id="mlComp" type="text" value="Fe70 Cr18 Ni10 C0.04" placeholder="e.g. Fe70 Cr18 Ni10 Mo2" />
        <label class="field-label" for="mlStruct">Crystal structure</label>
        <select id="mlStruct" class="field-select"><option>FCC</option><option>BCC</option><option>HCP</option></select>
        <button class="btn btn-glass" id="mlPredict" type="button">Predict</button>
        <p id="mlOut" class="micro-note"></p>
        <div class="ml-use" id="mlUse">
          <h4>Use this model in the other tabs</h4>
          <p class="micro-note">Pick what this model predicts, then switch the Simulator, Compare, Alloy Finder and Failure Doctor to <b>My ML</b>. You can switch back to Default ML or Rules at any time from the Estimator bar on each tab.</p>
          <div class="two-col"><select id="mlUseProp" class="field-select"><option value="y">Yield strength (MPa)</option><option value="uts">Tensile strength (MPa)</option><option value="t">Max service temperature (°C)</option><option value="price">Price (₹/kg)</option></select>
          <button class="btn btn-primary" id="mlUseBtn" type="button">Use as My ML</button></div>
          <p class="micro-note" id="mlUseNote"></p>
        </div>
      </article>`;
    main.appendChild(sec);
    q('#mlData', sec).addEventListener('change', (e) => { q('#mlLibBox', sec).classList.toggle('hidden', e.target.value === 'csv'); q('#mlCsvBox', sec).classList.toggle('hidden', e.target.value !== 'csv'); });
    q('#mlFile', sec).addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) f.text().then((t) => { q('#mlCsv').value = t; }); });
    q('#mlTrain', sec).addEventListener('click', runLab);
    q('#mlPredict', sec).addEventListener('click', runPredict);
    q('#mlUseBtn', sec).addEventListener('click', useAsCustom);
    q('#mlTarget', sec).addEventListener('change', syncSteelBox);
    q('#mlData', sec).addEventListener('change', syncSteelBox);
    syncSteelBox();
    return true;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function syncSteelBox() {
    const row = q('#mlSteelRow'); if (!row) return;
    const ok = q('#mlData').value === 'lib' && q('#mlTarget').value === 'y';
    row.classList.toggle('hidden', !ok);
  }

  /* a small scatter drawn as the points arrive, so the training can be watched */
  function liveHtml(points, lo, hi) {
    const W = 300; const H = 210; const pad = 28;
    const sx = (v) => pad + ((v - lo) / (hi - lo || 1)) * (W - pad - 8);
    const sy = (v) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - pad - 8);
    return `<svg viewBox="0 0 ${W} ${H}" class="ml-live-svg" role="img" aria-label="Predicted against actual, filling in as the model is tested">
      <line x1="${sx(lo)}" y1="${sy(lo)}" x2="${sx(hi)}" y2="${sy(hi)}" stroke="#64748b" stroke-dasharray="4 4"/>
      <text x="${W / 2}" y="${H - 6}" text-anchor="middle" fill="#9fb3c8" font-size="10">actual</text>
      <text x="10" y="${H / 2}" fill="#9fb3c8" font-size="10" transform="rotate(-90 10 ${H / 2})" text-anchor="middle">predicted</text>
      ${points.map((p, i) => `<circle cx="${sx(p.actual).toFixed(1)}" cy="${sy(p.pred).toFixed(1)}" r="${i === points.length - 1 ? 5 : 3.2}" fill="${i === points.length - 1 ? '#f59e0b' : '#22d3ee'}"/>`).join('')}</svg>`;
  }

  async function runLab() {
    if (training) return;
    const err = q('#mlErr'); err.textContent = '';
    let rows; let targetLabel; let unit; let kind = 'custom'; let extraRows = []; let folds = 0;
    try {
      if (q('#mlData').value === 'csv') {
        const parsed = parseCsv(q('#mlCsv').value);
        rows = parsed.rows; targetLabel = parsed.targetName; unit = '';
      } else {
        const key = q('#mlTarget').value;
        rows = libraryRows(key); targetLabel = TARGETS[key].label; unit = TARGETS[key].unit; kind = `library-${key}`;
        if (key === 'y' && q('#mlUseSteel').checked && steel) { extraRows = steelRows(); folds = 8; }
      }
    } catch (e) { err.textContent = e.message; return; }
    training = true;
    const btn = q('#mlTrain'); btn.disabled = true; btn.textContent = 'Training…';
    const prog = q('#mlProg'); prog.classList.remove('hidden');
    const params = { trees: Math.max(10, Math.min(300, Number(q('#mlTrees').value) || 80)), maxDepth: Math.max(2, Math.min(14, Number(q('#mlDepth').value) || 8)) };
    const slow = q('#mlSlow').checked;
    const live = q('#mlLive'); live.classList.remove('hidden');
    const seen = [];
    const ys = rows.map((r) => r.target); const lo = Math.min(...ys) * 0.9; const hi = Math.max(...ys) * 1.05;
    live.innerHTML = '<span class="pv-kicker">LIVE · TRAINING ON YOUR DEVICE</span><p class="micro-note">Starting…</p>';
    if (live.scrollIntoView) live.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try {
      lab = await trainAndEvaluate({ rows, extraRows, folds, targetLabel, unit, params, onProgress: async (p, info) => {
        q('i', prog).style.width = `${Math.round(p * 100)}%`;
        info.held.forEach((h) => seen.push(h));
        const last = info.held[info.held.length - 1];
        live.innerHTML = `<span class="pv-kicker">LIVE · STEP ${info.fold} OF ${info.folds}</span>
          <div class="ml-live-grid"><div>
            <p><b>1.</b> Hide ${info.held.length === 1 ? `<b>${esc(last.name)}</b>` : `<b>${info.held.length}</b> alloys (such as <b>${esc(last.name)}</b>)`} from the model.</p>
            <p><b>2.</b> Grow <b>${info.treesTrained}</b> decision trees on the other <b>${info.trainedOn}</b> samples${extraRows.length ? ` (including the ${extraRows.length} measured steels)` : ''}.</p>
            <p><b>3.</b> Ask the trees to predict the hidden ones: <b>${esc(last.name)}</b> is really <b>${f0(last.actual)}</b> ${esc(unit)}; the model said <b>${f0(last.pred)}</b>.</p>
            <p class="ml-live-score">Running average error: <b>${f0(info.runMae)}</b> ${esc(unit)} · guessing the average would give <b>${f0(info.runBase)}</b> ${esc(unit)}</p>
            <p class="micro-note">The dots sit on the dashed line when the model is right. Every dot is a prediction for an alloy the model had not seen.</p>
          </div><div>${liveHtml(seen, lo, hi)}</div></div>`;
        if (slow) await sleep(info.folds <= 12 ? 650 : 140);
        else await sleep(0);
      } });
      lab.kind = kind;
      live.innerHTML = `<span class="pv-kicker">LIVE · FINISHED</span><p class="micro-note">Training done. Final model: ${lab.params.trees} trees. Scores are shown below.</p>`;
      renderResult();
      q('#mlTry').classList.remove('hidden');
      const prop = { 'library-y': 'y', 'library-uts': 'uts', 'library-t': 't', 'library-price': 'price' }[kind] || guessProp(targetLabel);
      q('#mlUseProp').value = prop;
      if (window.MH_GROWTH && window.MH_GROWTH.track) window.MH_GROWTH.track('ml_trained', { n: rows.length, kind });
    } catch (e) { err.textContent = `Training failed: ${e.message}`; }
    training = false; btn.disabled = false; btn.textContent = 'Train and test the model'; prog.classList.add('hidden');
  }

  function guessProp(name) {
    const t = String(name || '').toLowerCase();
    if (/uts|tensile|ultimate/.test(t)) return 'uts';
    if (/temp|°c|service/.test(t)) return 't';
    if (/price|cost|rs|inr|₹/.test(t)) return 'price';
    return 'y';
  }

  function useAsCustom() {
    const note = q('#mlUseNote');
    if (!lab) { note.textContent = 'Train a model first.'; return; }
    const prop = q('#mlUseProp').value;
    if (!window.MH_ENGINE) { note.textContent = 'The estimator switch is not available.'; return; }
    window.MH_ENGINE.setCustom(lab, prop);
    window.MH_ENGINE.setMode('custom');
    note.textContent = 'Done. The Simulator, Compare, Alloy Finder and Failure Doctor now use your model for that property. Switch back any time from the Estimator bar.';
  }

  function renderResult() {
    const m = lab; const box = q('#mlResult');
    const better = m.cv.mae < m.baseline.mae;
    const heur = m.kind === 'library-y' ? heuristicMetrics() : null;
    const row = (name, x) => `<tr><td>${name}</td><td>${f0(x.mae)} ${esc(m.unit)}</td><td>${x.mape.toFixed(0)}%</td><td>${x.r2.toFixed(2)}</td></tr>`;
    const worst = m.points.slice().sort((a, b) => Math.abs(b.actual - b.pred) - Math.abs(a.actual - a.pred)).slice(0, 5);
    box.innerHTML = `<span class="pv-kicker">RESULT · ${m.n} SAMPLES · ${esc(m.targetLabel)}</span>
      <h3>${better ? 'Better than guessing the average' : 'Not better than guessing the average'}</h3>
      <p class="micro-note">Each sample was predicted by a model that never saw it (${esc(m.evalMethod)} <i class="term-hint" data-hint="Leave-one-out testing: hide one alloy, train on all the others, predict the hidden one, then repeat for every alloy. It is an honest test when you have little data." data-ask="What is leave-one-out testing?">?</i>). Lower error and higher R² are better; R² of 0 means "no better than the average".</p>
      <table class="ml-table"><thead><tr><th>Method</th><th>Average error <i class="term-hint" data-hint="On average, how far off the prediction was, in the same unit as the property. Lower is better.">?</i></th><th>Average % error <i class="term-hint" data-hint="The same error as a percentage of the real value. Useful for comparing properties with different units.">?</i></th><th>R² <i class="term-hint" data-hint="Score from 0 to 1 for how much of the real variation the model explains on samples it did not see. 1 is perfect, 0 is no better than always guessing the average (it can even go below 0)." data-ask="Explain the Best test R² score and what it means for material prediction">?</i></th></tr></thead><tbody>
        ${row('Random forest (this model)', m.cv)}${row('Always guess the average', m.baseline)}${heur ? row('Old composition formula', heur) : ''}</tbody></table>
      <p class="micro-note">Spread between trees: the true value fell within 2 spreads of the prediction for ${m.cv.within.toFixed(0)}% of samples. That is a rough guide to uncertainty, not a calibrated confidence.</p>
      <div id="mlChart" class="chart-box"></div>
      <h4>Biggest misses</h4>
      <ul class="dr-evidence">${worst.map((p) => `<li>${esc(p.name)}: actual ${f0(p.actual)}, predicted ${f0(p.pred)} ${esc(m.unit)}</li>`).join('')}</ul>
      <p class="micro-note">Tested by ${esc(m.evalMethod)} on ${m.n} samples${m.extra ? `, with ${m.extra} extra measured steels added to the training side only` : ''}. To make the other tabs use this model, press "Use as My ML" below.</p>`;
    const lo = Math.min(...m.points.map((p) => Math.min(p.actual, p.pred))); const hi = Math.max(...m.points.map((p) => Math.max(p.actual, p.pred)));
    if (typeof renderPlot === 'function') {
      renderPlot(q('#mlChart'), [
        { type: 'scatter', mode: 'lines', x: [lo, hi], y: [lo, hi], line: { color: '#64748b', dash: 'dot' }, hoverinfo: 'skip', showlegend: false },
        { type: 'scatter', mode: 'markers', x: m.points.map((p) => p.actual), y: m.points.map((p) => p.pred), text: m.points.map((p) => p.name), marker: { color: '#22d3ee', size: 8 }, hovertemplate: '%{text}<br>actual %{x:.0f}<br>predicted %{y:.0f}<extra></extra>', showlegend: false },
      ], { paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { color: '#9fb3c8', size: 11 }, margin: { l: 56, r: 10, t: 10, b: 44 }, xaxis: { title: 'Actual (library)', gridcolor: 'rgba(148,163,184,.15)' }, yaxis: { title: 'Predicted (never saw this sample)', gridcolor: 'rgba(148,163,184,.15)' }, height: 300 });
    }
  }

  function heuristicMetrics() {
    try {
      const T = window.MH_TOOLS; const sim = window.MH_OFFLINE_SIMULATE;
      const actual = []; const pred = [];
      T.GRADES.forEach((g) => {
        const r = sim({ elements: gradeFractions(g), temperature_c: 25, load_mpa: 100, safety_factor: 1.5, structure: g.s, use_grade_values: false });
        actual.push(g.y); pred.push(r.derived.strength_25c_mpa);
      });
      return metrics(actual, pred);
    } catch { return null; }
  }

  function parseComp(text) {
    const comp = {};
    String(text).replace(/([A-Z][a-z]?)\s*([\d.]+)/g, (m, s, v) => { comp[s] = (comp[s] || 0) + Number(v); return m; });
    return comp;
  }
  function runPredict() {
    const out = q('#mlOut');
    if (!lab) return;
    const comp = parseComp(q('#mlComp').value);
    if (!Object.keys(comp).length) { out.textContent = 'Type a composition like Fe70 Cr18 Ni10.'; return; }
    const e = estimate(lab, comp, q('#mlStruct').value);
    let text = `Predicted ${lab.targetLabel}: about ${f0(e.value)} ${lab.unit} (spread between trees ±${f0(e.spread)}). Typical error of this model: about ${lab.cv.mape.toFixed(0)}%. A guide, not a measurement.`;
    if (lab.kind === 'library-y') {
      const s = steelEstimate(comp);
      if (s.ok) text += ` Steel model (312 measured steels): about ${f0(s.value)} MPa, typical error about ${Math.round(s.cv.mae)} MPa.`;
      else if (s.why && s.why !== 'loading') text += ` The steel model was not used: ${s.why}`;
    }
    out.textContent = text;
  }

  /* ------------------------------------------------------------------ */
  function boot() {
    let n = 0;
    const t = setInterval(() => { if ((mount() && window.MH_TOOLS) || n++ > 60) clearInterval(t); }, 250);
    setTimeout(() => { autoTrain().catch(() => {}); }, 3500);
    window.addEventListener('mh:simulated', refreshReadout);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.addEventListener('mh:engine', () => rerun());
  window.MH_ML = { steelRows, featureList, vectorise, steelEstimate, loadSteel, get steel() { return steel; }, refreshReadout, trainForest, predictForest, parseCsv, libraryMatch, libraryRows, trainAndEvaluate, estimate, get model() { return current; } };
})();
