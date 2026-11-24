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
  const STORE = 'mh_ml_v1';
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

  async function trainAndEvaluate({ rows, targetLabel, unit, params, onProgress }) {
    const features = featureList(rows);
    const X = rows.map((r) => vectorise(r.comp, r.structure, features));
    const y = rows.map((r) => r.target);
    const n = rows.length;
    const loo = [];
    const looSpread = [];
    for (let i = 0; i < n; i += 1) {
      const Xi = X.filter((_, k) => k !== i);
      const yi = y.filter((_, k) => k !== i);
      const trees = trainForest(Xi, yi, { ...params, trees: Math.min(params.trees || 80, 50) }, 100 + i);
      const p = predictForest(trees, X[i]);
      loo.push(p.value); looSpread.push(p.spread);
      if (onProgress && i % 4 === 0) { onProgress((i + 1) / n); await tick(); }
    }
    const meanBaseline = y.map((_, i) => y.filter((__, k) => k !== i).reduce((a, b) => a + b, 0) / (n - 1));
    const finalTrees = trainForest(X, y, params, 99);
    const within = y.filter((a, i) => Math.abs(a - loo[i]) <= looSpread[i] * 2).length / n * 100;
    return {
      features, trees: finalTrees, params, n, targetLabel, unit, trainedAt: Date.now(),
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

  function refreshReadout() {
    const strong = q('#heroConfidence');
    if (!strong || typeof state === 'undefined') return;
    const label = strong.parentElement?.querySelector('span');
    const comp = typeof normalisedComposition === 'function' ? normalisedComposition() : null;
    if (!comp) return;
    const src = state.simulation?.prediction?.source;
    const pill = q('#simConfidence');
    if (src === 'grade') {
      const g = libraryMatch(Object.fromEntries(Object.entries(comp).map(([k, v]) => [k, v])));
      if (label) label.textContent = 'Reference yield';
      strong.textContent = `${Math.round(state.simulation.prediction.predicted)} MPa${g ? ` · ${g.name.split(' (')[0]}` : ''}`;
      strong.title = 'Typical yield of the matching library grade. This is a library value, not a measurement of your batch.';
      if (pill) { pill.textContent = 'Grade value'; pill.className = 'pill pill-emerald'; }
      return;
    }
    const e = current ? estimate(current, comp, state.structure || 'BCC') : null;
    if (e) {
      if (label) label.textContent = 'ML yield estimate';
      strong.textContent = `≈ ${Math.round(e.value)} MPa`;
      strong.title = `Random forest trained on ${current.n} library grades. Leave-one-out average error about ${Math.round(current.cv.mape)}%. Spread between trees ±${Math.round(e.spread)} MPa (not a calibrated confidence). Open ML Lab for details.`;
      if (pill) { pill.textContent = 'ML estimate'; pill.className = 'pill pill-amber'; }
    } else if (label) label.textContent = 'Yield estimate';
  }

  async function autoTrain() {
    const saved = load();
    const rerun = () => { refreshReadout(); if (typeof runSimulation === 'function' && !state.forgeRun && state.initialised) runSimulation({ silent: true }); };
    if (saved && saved.kind === 'library-y' && saved.trees) { current = saved; rerun(); return; }
    const rows = libraryRows('y');
    if (rows.length < 10) return;
    const m = await trainAndEvaluate({ rows, targetLabel: TARGETS.y.label, unit: 'MPa', params: { trees: 80 } });
    m.kind = 'library-y';
    current = m;
    save(m);
    rerun();
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
          <button class="btn btn-primary full" id="mlTrain">Train and test the model</button>
          <div class="ml-progress hidden" id="mlProg"><i></i></div>
          <p class="form-error" id="mlErr"></p>
          <p class="micro-note">Small data means a rough guide. The numbers on the right say exactly how rough.</p>
        </article>
        <article class="glass ml-result" id="mlResult"><div class="empty-state"><strong>Press "Train and test the model"</strong><span>Training 48 library grades takes a couple of seconds.</span></div></article>
      </div>
      <article class="glass tool-form ml-try hidden" id="mlTry">
        <h3>Try the trained model</h3>
        <label class="field-label" for="mlComp">Composition (weight %)</label>
        <input id="mlComp" type="text" value="Fe70 Cr18 Ni10 C0.04" placeholder="e.g. Fe70 Cr18 Ni10 Mo2" />
        <label class="field-label" for="mlStruct">Crystal structure</label>
        <select id="mlStruct" class="field-select"><option>FCC</option><option>BCC</option><option>HCP</option></select>
        <button class="btn btn-glass" id="mlPredict" type="button">Predict</button>
        <p id="mlOut" class="micro-note"></p>
      </article>`;
    main.appendChild(sec);
    q('#mlData', sec).addEventListener('change', (e) => { q('#mlLibBox', sec).classList.toggle('hidden', e.target.value === 'csv'); q('#mlCsvBox', sec).classList.toggle('hidden', e.target.value !== 'csv'); });
    q('#mlFile', sec).addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) f.text().then((t) => { q('#mlCsv').value = t; }); });
    q('#mlTrain', sec).addEventListener('click', runLab);
    q('#mlPredict', sec).addEventListener('click', runPredict);
    return true;
  }

  async function runLab() {
    if (training) return;
    const err = q('#mlErr'); err.textContent = '';
    let rows; let targetLabel; let unit; let kind = 'custom';
    try {
      if (q('#mlData').value === 'csv') {
        const parsed = parseCsv(q('#mlCsv').value);
        rows = parsed.rows; targetLabel = parsed.targetName; unit = '';
      } else {
        const key = q('#mlTarget').value;
        rows = libraryRows(key); targetLabel = TARGETS[key].label; unit = TARGETS[key].unit; kind = `library-${key}`;
      }
    } catch (e) { err.textContent = e.message; return; }
    training = true;
    const btn = q('#mlTrain'); btn.disabled = true; btn.textContent = 'Training…';
    const prog = q('#mlProg'); prog.classList.remove('hidden');
    const params = { trees: Math.max(10, Math.min(300, Number(q('#mlTrees').value) || 80)), maxDepth: Math.max(2, Math.min(14, Number(q('#mlDepth').value) || 8)) };
    try {
      lab = await trainAndEvaluate({ rows, targetLabel, unit, params, onProgress: (p) => { q('i', prog).style.width = `${Math.round(p * 100)}%`; } });
      lab.kind = kind;
      renderResult();
      if (kind === 'library-y') { current = lab; save(lab); refreshReadout(); }
      q('#mlTry').classList.remove('hidden');
      window.MH_GROWTH?.track?.('ml_trained', { n: rows.length, kind });
    } catch (e) { err.textContent = `Training failed: ${e.message}`; }
    training = false; btn.disabled = false; btn.textContent = 'Train and test the model'; prog.classList.add('hidden');
  }

  function renderResult() {
    const m = lab; const box = q('#mlResult');
    const better = m.cv.mae < m.baseline.mae;
    const heur = m.kind === 'library-y' ? heuristicMetrics() : null;
    const row = (name, x) => `<tr><td>${name}</td><td>${f0(x.mae)} ${esc(m.unit)}</td><td>${x.mape.toFixed(0)}%</td><td>${x.r2.toFixed(2)}</td></tr>`;
    const worst = m.points.slice().sort((a, b) => Math.abs(b.actual - b.pred) - Math.abs(a.actual - a.pred)).slice(0, 5);
    box.innerHTML = `<span class="pv-kicker">RESULT · ${m.n} SAMPLES · ${esc(m.targetLabel)}</span>
      <h3>${better ? 'Better than guessing the average' : 'Not better than guessing the average'}</h3>
      <p class="micro-note">Each sample was predicted by a model that never saw it (leave-one-out). Lower error and higher R² are better; R² of 0 means "no better than the average".</p>
      <table class="ml-table"><thead><tr><th>Method</th><th>Average error</th><th>Average % error</th><th>R²</th></tr></thead><tbody>
        ${row('Random forest (this model)', m.cv)}${row('Always guess the average', m.baseline)}${heur ? row('Old composition formula', heur) : ''}</tbody></table>
      <p class="micro-note">Spread between trees: the true value fell within 2 spreads of the prediction for ${m.cv.within.toFixed(0)}% of samples. That is a rough guide to uncertainty, not a calibrated confidence.</p>
      <div id="mlChart" class="chart-box"></div>
      <h4>Biggest misses</h4>
      <ul class="dr-evidence">${worst.map((p) => `<li>${esc(p.name)}: actual ${f0(p.actual)}, predicted ${f0(p.pred)} ${esc(m.unit)}</li>`).join('')}</ul>
      ${m.kind === 'library-y' ? '<p class="micro-note">This model is now used for the "ML yield estimate" in the simulator, for compositions that do not match a library grade.</p>' : ''}`;
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
    out.textContent = `Predicted ${lab.targetLabel}: about ${f0(e.value)} ${lab.unit} (spread between trees ±${f0(e.spread)}). Typical error of this model: about ${lab.cv.mape.toFixed(0)}%. A guide, not a measurement.`;
  }

  /* ------------------------------------------------------------------ */
  function boot() {
    let n = 0;
    const t = setInterval(() => { if ((mount() && window.MH_TOOLS) || n++ > 60) clearInterval(t); }, 250);
    setTimeout(() => { autoTrain().catch(() => {}); }, 3500);
    window.addEventListener('mh:simulated', refreshReadout);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.MH_ML = { refreshReadout, trainForest, predictForest, parseCsv, libraryMatch, libraryRows, trainAndEvaluate, estimate, get model() { return current; } };
})();
