/* ==========================================================================
   MATERIALHUNT — vision: camera, on-device defect check, samples
   - classifyMetalDefect(imageElement): runs on the device, uses no cloud tokens.
       1) If a trained model is plugged in (see "Plugging in your model" below) it is used.
       2) Otherwise a basic colour-and-texture check runs (a heuristic, not a trained network).
   - Camera / photo picker shared by the Failure Doctor and the assistant.
   - Optional "Escalate to Cloud AI" sends the photo to the Worker's /analyze-image (counts as 1 AI question).

   Plugging in your model (Teachable Machine / TensorFlow.js):
     Option A (Teachable Machine image model): set defectModelUrl in config.js, for example
        defectModelUrl: 'https://teachablemachine.withgoogle.com/models/XXXXXXXX/'
        Class names are matched by words: rust / corro -> corroded, heat / char / burn / melt -> melted,
        snap / brittle / fractur / broken -> brittle, crack / fatigue -> crack_vib, warp / bend -> warped.
     Option B (any TensorFlow.js model): set window.MH_DEFECT_MODEL = { predict: async (imageElement) =>
        [{ className: 'rust', probability: 0.91 }, ...] } before a photo is analysed.
   ========================================================================== */
'use strict';

(function () {
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t = 'info', ms) => { if (typeof toast === 'function') toast(m, t, ms); };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const LABELS = {
    corroded: 'Rust or corrosion',
    melted: 'Heat damage (overheated, charred or softened)',
    brittle: 'Sudden snap (brittle fracture)',
    crack_vib: 'Fatigue crack (repeated load or vibration)',
    warped: 'Bent or warped',
    unclear: 'No clear damage pattern',
  };
  const WHY = {
    corroded: 'Orange-brown, flaky or pitted patches are the classic sign of rusting. It usually starts where moisture, salt or a scratch breaks the surface.',
    melted: 'Dark soot or charring with blue, purple or straw-coloured bands is the colour of metal that was heated far past its service temperature.',
    brittle: 'A bright, flat or crystalline break with little stretching suggests a sudden fracture, often from cold, a sharp notch or a hidden defect.',
    crack_vib: 'A fine line crack in otherwise intact metal suggests fatigue, which grows from repeated loads at a corner, hole or weld.',
    warped: 'Smooth bending or twisting means the load went past yield, or heat released stress in the part.',
    unclear: 'The photo does not show a strong rust, heat, or fracture pattern. Try a closer, evenly lit photo of the damaged area.',
  };
  const METAL_FOR = { corroded: 'e250', melted: 'e250', brittle: 'al6061', crack_vib: 'ss304', warped: 'e250' };

  /* ------------------------------------------------------------------ */
  /* Image helpers                                                        */
  /* ------------------------------------------------------------------ */
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That image could not be read.'));
      img.src = src;
    });
  }

  function shrink(source, maxSide, quality = 0.8) {
    const w = source.naturalWidth || source.videoWidth || source.width;
    const h = source.naturalHeight || source.videoHeight || source.height;
    const k = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    return { canvas: c, dataUrl: c.toDataURL('image/jpeg', quality) };
  }

  /* ------------------------------------------------------------------ */
  /* Plugged-in model (optional)                                          */
  /* ------------------------------------------------------------------ */
  let modelPromise = null;
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });

  function getModel() {
    if (window.MH_DEFECT_MODEL && typeof window.MH_DEFECT_MODEL.predict === 'function') return Promise.resolve(window.MH_DEFECT_MODEL);
    const url = (window.MH_CONFIG && window.MH_CONFIG.defectModelUrl) || '';
    if (!url) return Promise.resolve(null);
    if (!modelPromise) {
      const base = url.endsWith('/') ? url : `${url}/`;
      modelPromise = (async () => {
        if (!window.tf) await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@1.3.1/dist/tf.min.js');
        if (!window.tmImage) await loadScript('https://cdn.jsdelivr.net/npm/@teachablemachine/image@0.8/dist/teachablemachine-image.min.js');
        return window.tmImage.load(`${base}model.json`, `${base}metadata.json`);
      })().catch((e) => { console.warn('Defect model could not be loaded, using the basic check:', e.message); return null; });
    }
    return modelPromise;
  }

  function keyFromClass(name) {
    const n = String(name).toLowerCase();
    if (/rust|corro|oxid/.test(n)) return 'corroded';
    if (/heat|char|burn|melt|scorch|overheat/.test(n)) return 'melted';
    if (/snap|brittle|fractur|broken|break/.test(n)) return 'brittle';
    if (/crack|fatigue/.test(n)) return 'crack_vib';
    if (/warp|bend|bent|deform/.test(n)) return 'warped';
    if (/good|ok|healthy|clean|normal|undamaged/.test(n)) return 'unclear';
    return 'other';
  }

  /* ------------------------------------------------------------------ */
  /* Basic on-device check (colour and texture)                           */
  /* ------------------------------------------------------------------ */
  function features(img) {
    const { canvas } = shrink(img, 112);
    const w = canvas.width; const h = canvas.height;
    const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const n = w * h;

    // if the picture has a plain background (a part on a table or a dark cloth), ignore it and look at the part only
    const ring = [];
    for (let x = 0; x < w; x += 1) { ring.push(x, (h - 1) * w + x); }
    for (let y = 0; y < h; y += 1) { ring.push(y * w, y * w + w - 1); }
    const med = [0, 1, 2].map((c) => { const vals = ring.map((i) => px[i * 4 + c]).sort((p, q2) => p - q2); return vals[Math.floor(vals.length / 2)]; });
    const dist = (i) => Math.hypot(px[i * 4] - med[0], px[i * 4 + 1] - med[1], px[i * 4 + 2] - med[2]);
    const plainBg = ring.filter((i) => dist(i) < 45).length / ring.length > 0.85;
    const fg = new Uint8Array(n);
    let fgCount = 0;
    for (let i = 0; i < n; i += 1) { fg[i] = plainBg ? (dist(i) > 45 ? 1 : 0) : 1; fgCount += fg[i]; }
    const useFg = plainBg && fgCount > n * 0.06;
    if (!useFg) { fg.fill(1); fgCount = n; }

    const gray = new Float32Array(n);
    let rust = 0; let dark = 0; let tint = 0; let bright = 0; let mid = 0;
    for (let i = 0; i < n; i += 1) {
      const r = px[i * 4] / 255; const g = px[i * 4 + 1] / 255; const b = px[i * 4 + 2] / 255;
      gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      if (!fg[i]) continue;
      const max = Math.max(r, g, b); const min = Math.min(r, g, b);
      const v = max; const d = max - min; const s = max === 0 ? 0 : d / max;
      let hue = 0;
      if (d > 0) {
        if (max === r) hue = ((g - b) / d) % 6; else if (max === g) hue = (b - r) / d + 2; else hue = (r - g) / d + 4;
        hue *= 60; if (hue < 0) hue += 360;
      }
      if (hue >= 4 && hue <= 40 && s > 0.38 && v > 0.18 && v < 0.92) rust += 1;
      if (v < 0.2) dark += 1;
      if ((hue >= 195 && hue <= 290 && s > 0.22 && v > 0.22 && v < 0.92) || (hue >= 38 && hue <= 58 && s > 0.4 && v > 0.55)) tint += 1;
      if (s < 0.2 && v > 0.62) bright += 1; else if (s < 0.2 && v >= 0.25) mid += 1;
    }
    let strong = 0; let sum = 0;
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * w + x;
        if (!fg[i]) continue;
        const gx = -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
        const gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
        const m = Math.hypot(gx, gy) / 4;
        sum += m;
        if (m > 0.2) strong += 1;
      }
    }
    const f = fgCount || 1;
    return { rust: rust / f, dark: dark / f, tint: tint / f, bright: bright / f, mid: mid / f, strongEdge: strong / f, meanEdge: sum / f, partOnly: useFg };
  }

  function heuristic(img) {
    const f = features(img);
    const raw = {
      corroded: clamp(f.rust * 2.6, 0, 1),
      melted: clamp((f.dark * 1.1 + f.tint * 1.9) * (f.rust > 0.3 ? 0.5 : 1), 0, 1),
      brittle: f.bright > 0.22 && f.rust < 0.1 ? clamp(f.strongEdge * 4.2 * (0.5 + f.bright), 0, 1) : 0,
      crack_vib: (f.bright + f.mid) > 0.45 && f.strongEdge > 0.03 && f.strongEdge < 0.12 && f.dark < 0.14 && f.rust < 0.08 ? clamp(f.strongEdge * 5, 0, 0.7) : 0,
      warped: 0.08,
    };
    const keys = Object.keys(raw);
    const top = keys.reduce((a, k) => (raw[k] > raw[a] ? k : a), 'warped');
    const signal = raw[top];
    const exps = keys.map((k) => Math.exp(raw[k] * 4.5));
    const total = exps.reduce((a, b) => a + b, 0);
    let ranked = keys.map((k, i) => ({ key: k, label: LABELS[k], confidence: exps[i] / total })).sort((a, b) => b.confidence - a.confidence);
    const notes = [];
    if (f.rust > 0.08) notes.push(`Orange-brown rust-coloured areas cover about ${Math.round(f.rust * 100)}% of the picture.`);
    if (f.dark > 0.2) notes.push(`About ${Math.round(f.dark * 100)}% of the picture is very dark, as in soot or charring.`);
    if (f.tint > 0.08) notes.push(`Blue, purple or straw colours (${Math.round(f.tint * 100)}%) are typical of heat tint.`);
    if (f.bright > 0.3 && f.strongEdge > 0.08) notes.push('Bright metal with many sharp edges, like a fresh break surface.');
    let best = ranked[0];
    if (signal < 0.3) { best = { key: 'unclear', label: LABELS.unclear, confidence: 0.5 }; ranked = [best, ...ranked.slice(0, 2)]; }
    const metalHint = f.rust > 0.1 || (f.dark > 0.2 && f.tint > 0.05) ? 'steel' : (f.bright > 0.35 ? 'aluminium or stainless' : 'unknown');
    return { source: 'heuristic', engine: 'Basic colour and texture check (on this device)', best, ranked: ranked.slice(0, 3), notes, metalHint, features: f };
  }

  /* the function you plug your model into */
  async function classifyMetalDefect(imageElement) {
    const model = await getModel();
    if (model) {
      try {
        const preds = await model.predict(imageElement);
        const merged = {};
        preds.forEach((p) => { const k = keyFromClass(p.className); merged[k] = Math.max(merged[k] || 0, Number(p.probability) || 0); });
        const ranked = Object.entries(merged).sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ key: k, label: LABELS[k] || k, confidence: c }));
        return { source: 'model', engine: 'Your trained model (on this device)', best: ranked[0], ranked: ranked.slice(0, 3), notes: [], metalHint: 'unknown' };
      } catch (e) { console.warn('Model prediction failed, using the basic check:', e.message); }
    }
    return heuristic(imageElement);
  }
  window.classifyMetalDefect = classifyMetalDefect;

  /* ------------------------------------------------------------------ */
  /* Sample images (drawn in the browser, so they work offline)           */
  /* ------------------------------------------------------------------ */
  const hash = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const smooth = (t) => t * t * (3 - 2 * t);
  function vnoise(x, y, s) {
    const xi = Math.floor(x); const yi = Math.floor(y); const xf = smooth(x - xi); const yf = smooth(y - yi);
    const a = hash(xi, yi, s); const b = hash(xi + 1, yi, s); const c = hash(xi, yi + 1, s); const d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  }
  const fbm = (x, y, s) => 0.5 * vnoise(x, y, s) + 0.27 * vnoise(x * 2.1, y * 2.1, s + 1) + 0.15 * vnoise(x * 4.3, y * 4.3, s + 2) + 0.08 * vnoise(x * 8.7, y * 8.7, s + 3);
  const mix = (a, b, t) => a + (b - a) * t;

  function makeSample(kind) {
    const W = 360; const H = 270;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    const d = img.data;
    const put = (i, r, gr, b) => { d[i] = clamp(r, 0, 255); d[i + 1] = clamp(gr, 0, 255); d[i + 2] = clamp(b, 0, 255); d[i + 3] = 255; };

    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = (y * W + x) * 4;
        const n = fbm(x / 38, y / 38, 7);
        const grain = (hash(x, y, 3) - 0.5) * 18;
        if (kind === 'bolt') {
          // a bolt lying horizontally: hex head on the left, threaded shank to the right
          const inHead = x > 40 && x < 120 && y > 70 && y < 200;
          const inShank = x >= 120 && x < 330 && y > 95 && y < 175;
          const thread = inShank && ((x / 7) % 1) < 0.5 ? -26 : 0;
          if (inHead || inShank) {
            const shade = 150 + (inHead ? 20 : 0) + thread + (y < 130 ? 22 : -10) + grain;
            const rustAmt = smooth(clamp((fbm(x / 24, y / 24, 11) - 0.34) * 3.6, 0, 1));
            const dark = fbm(x / 9, y / 9, 5);
            put(i, mix(shade, 168 + dark * 70, rustAmt), mix(shade + 4, 74 + dark * 40, rustAmt), mix(shade + 8, 24 + dark * 18, rustAmt));
          } else {
            const v = 36 + n * 26 + grain * 0.4;
            put(i, v, v + 3, v + 8);
          }
        } else if (kind === 'heat') {
          // steel plate with soot on one side, heat-tint bands, then clean metal
          const t = clamp((x + n * 90 - 20) / (W - 20), 0, 1);
          const base = 150 + grain + (y < 110 ? 18 : 0);
          let r; let gr; let b;
          if (t < 0.34) { const k = t / 0.34; r = mix(24, 58, k) + n * 14; gr = mix(22, 50, k) + n * 12; b = mix(26, 58, k) + n * 12; }
          else if (t < 0.52) { const k = (t - 0.34) / 0.18; r = mix(58, 70, k); gr = mix(52, 80, k); b = mix(60, 170, k); }
          else if (t < 0.66) { const k = (t - 0.52) / 0.14; r = mix(70, 205, k); gr = mix(80, 170, k); b = mix(170, 80, k); }
          else if (t < 0.8) { const k = (t - 0.66) / 0.14; r = mix(205, base, k); gr = mix(170, base, k); b = mix(80, base, k); }
          else { r = base; gr = base + 4; b = base + 9; }
          const soot = clamp((fbm(x / 14, y / 14, 21) - 0.5) * 2, 0, 1) * (t < 0.52 ? 1 : 0.2);
          put(i, r * (1 - soot * 0.55), gr * (1 - soot * 0.55), b * (1 - soot * 0.5));
        } else {
          // aluminium tab, snapped through the middle: jagged bright break on the right
          const edgeX = 238 + Math.sin(y / 11) * 14 + (hash(Math.floor(y / 3), 0, 9) - 0.5) * 22;
          const inTab = x > 34 && x < edgeX && y > 70 && y < 205;
          const hole = Math.hypot(x - 82, y - 138) < 17;
          if (inTab && !hole) {
            const nearBreak = clamp((x - (edgeX - 44)) / 44, 0, 1);
            const crystal = (hash(Math.floor(x / 3), Math.floor(y / 3), 17) - 0.5) * 90 * nearBreak;
            const v = 196 + grain * 0.6 + (y < 120 ? 12 : -4) + crystal;
            put(i, v, v + 3, v + 8);
          } else if (hole) {
            put(i, 28, 30, 34);
          } else {
            const v = 30 + n * 20 + grain * 0.3;
            put(i, v, v + 3, v + 7);
          }
        }
      }
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = 'rgba(0,0,0,.55)';
    g.font = '600 12px system-ui, sans-serif';
    g.fillText('Sample illustration', 10, H - 10);
    return c;
  }

  const SAMPLES = [
    { id: 'bolt', label: 'Rusted Bolt', event: 'corroded' },
    { id: 'heat', label: 'Heat-Charred Steel', event: 'melted' },
    { id: 'tab', label: 'Snapped Aluminum Tab', event: 'brittle' },
  ];

  /* ------------------------------------------------------------------ */
  /* Camera / photo picker                                                */
  /* ------------------------------------------------------------------ */
  let stream = null;
  function stopCamera() { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } }

  function openCamera(onPhoto, title = 'Scan damaged metal') {
    q('#camModal')?.remove();
    const m = document.createElement('div');
    m.id = 'camModal';
    m.className = 'modal-backdrop';
    m.innerHTML = `<div class="auth-modal glass tool-modal cam-modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <button class="modal-close" data-x aria-label="Close">×</button>
      <span class="panel-kicker">CAMERA</span><h2>${esc(title)}</h2>
      <div class="cam-stage"><video id="camVideo" autoplay playsinline muted></video><div class="cam-msg" id="camMsg">Starting camera…</div></div>
      <div class="cam-actions">
        <button class="btn btn-primary" id="camShot" disabled>Take photo</button>
        <button class="btn btn-glass" id="camFlip" disabled>Switch camera</button>
        <button class="btn btn-glass" id="camPick">Choose a photo instead</button>
        <input type="file" id="camFile" accept="image/*" class="hidden" />
      </div>
      <p class="micro-note">Photos are analysed on your device. Nothing is uploaded unless you press Escalate to Cloud AI afterwards.</p></div>`;
    document.body.appendChild(m);
    const close = () => { stopCamera(); m.remove(); };
    q('[data-x]', m).addEventListener('click', close);
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    const msg = q('#camMsg', m);
    const video = q('#camVideo', m);
    let facing = 'environment';

    async function start() {
      stopCamera();
      if (!navigator.mediaDevices?.getUserMedia) { msg.textContent = 'This browser cannot open a camera here. Choose a photo instead.'; return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1280 } }, audio: false });
        video.srcObject = stream;
        msg.classList.add('hidden');
        q('#camShot', m).disabled = false; q('#camFlip', m).disabled = false;
      } catch {
        msg.classList.remove('hidden');
        msg.textContent = 'Camera not available (no camera, or permission was declined). You can choose a photo instead.';
      }
    }
    q('#camFlip', m).addEventListener('click', () => { facing = facing === 'environment' ? 'user' : 'environment'; start(); });
    q('#camShot', m).addEventListener('click', () => {
      if (!video.videoWidth) return;
      const { dataUrl } = shrink(video, 1024, 0.88);
      close();
      onPhoto(dataUrl);
    });
    q('#camPick', m).addEventListener('click', () => q('#camFile', m).click());
    q('#camFile', m).addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try { const img = await loadImage(reader.result); close(); onPhoto(shrink(img, 1024, 0.88).dataUrl); }
        catch { msg.classList.remove('hidden'); msg.textContent = 'That file is not an image I can read.'; }
      };
      reader.readAsDataURL(file);
    });
    start();
  }

  /* ------------------------------------------------------------------ */
  /* Cloud escalation (optional, uses 1 AI question)                      */
  /* ------------------------------------------------------------------ */
  async function escalate(dataUrl, local) {
    const base = window.MH_CONFIG?.aiProxyUrl;
    if (!base) throw new Error('Cloud AI is not set up on this site.');
    if (!state.user) { openAuth('register'); throw new Error('Create a free account (and verify your email) to use Cloud AI.'); }
    if (!state.user.email_verified) throw new Error('Verify your email first to use Cloud AI.');
    const user = window.MH_FIREBASE?.auth?.currentUser;
    if (!user) throw new Error('Please sign in again.');
    const token = await user.getIdToken();
    const small = await loadImage(dataUrl).then((i) => shrink(i, 640, 0.72).dataUrl);
    const res = await fetch(`${base}/analyze-image`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ image: small, hint: local?.best?.label || '' }) });
    if (res.status === 429) throw new Error('You have used today\'s Cloud AI questions. The on-device result above still applies.');
    if (!res.ok) throw new Error('Cloud AI is not available right now. The on-device result above still applies.');
    const j = await res.json();
    if (!j.text) throw new Error('Cloud AI could not describe that photo.');
    return j.text;
  }

  /* ------------------------------------------------------------------ */
  /* Failure Doctor panel                                                 */
  /* ------------------------------------------------------------------ */
  let current = null; // { dataUrl, result }

  function barsHtml(result) {
    return result.ranked.map((r) => `<div class="sc-bar"><span>${esc(r.label)}</span><div><i style="width:${Math.round(r.confidence * 100)}%"></i></div><b>${result.source === 'heuristic' ? '' : Math.round(r.confidence * 100) + '%'}</b></div>`).join('');
  }

  async function analyse(dataUrl, label) {
    const box = q('#scanResult');
    if (!box) return;
    box.innerHTML = '<div class="empty-state"><span>Analysing on your device…</span></div>';
    let result;
    try { const img = await loadImage(dataUrl); result = await classifyMetalDefect(img); } catch (e) { box.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; return; }
    current = { dataUrl, result };
    const best = result.best;
    box.innerHTML = `<div class="scan-card">
      <img class="scan-thumb" src="${esc(dataUrl)}" alt="${esc(label || 'Your photo')}" />
      <div class="scan-info">
        <span class="pv-kicker">ON-DEVICE RESULT · 0 CLOUD TOKENS</span>
        <h4>${esc(best.label)}</h4>
        <p class="micro-note">${esc(WHY[best.key] || '')}</p>
        ${result.notes.length ? `<ul class="dr-evidence">${result.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        ${barsHtml(result)}
        <p class="micro-note">${esc(result.engine)}${result.source === 'heuristic' ? '. This is a quick screening of colours and texture, not a trained model, so treat it as a hint.' : '.'}</p>
        <div class="scan-actions">
          ${LABELS[best.key] && best.key !== 'unclear' && best.key !== 'other' ? '<button class="btn btn-primary small" id="scanUse">Use this finding</button>' : ''}
          <button class="btn btn-glass small" id="scanCloud">Escalate to Cloud AI</button>
        </div>
        <div id="scanCloudOut"></div>
      </div></div>`;
    q('#scanUse', box)?.addEventListener('click', () => applyToDoctor(result));
    q('#scanCloud', box)?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const out = q('#scanCloudOut', box);
      btn.disabled = true; out.innerHTML = '<p class="micro-note">Asking Cloud AI… (counts as 1 AI question)</p>';
      try { const text = await escalate(dataUrl, result); out.innerHTML = `<div class="scan-cloud"><span class="pv-kicker">CLOUD AI</span><p>${esc(text)}</p></div>`; }
      catch (err) { out.innerHTML = `<p class="micro-note">${esc(err.message)}</p>`; }
      btn.disabled = false;
    });
    window.MH_GROWTH?.track?.('doctor_photo', { source: result.source, finding: best.key });
  }

  function applyToDoctor(result) {
    const key = result.best.key;
    const ev = q('#drEvent'); const metal = q('#drMetal');
    if (ev && qa('option', ev).some((o) => o.value === key)) ev.value = key;
    if (metal && result.metalHint !== 'unknown') {
      const want = key === 'brittle' && /aluminium/.test(result.metalHint) ? 'al6061' : (METAL_FOR[key] || '');
      if (want && qa('option', metal).some((o) => o.value === want)) metal.value = want;
    }
    notify('Filled in what happened. Check the metal and where it was used, then press Diagnose.', 'success', 4500);
    q('#drRun')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function mountDoctor() {
    const form = q('#view-doctor .tool-form');
    if (!form) return false;
    if (q('#scanBox')) return true;
    const box = document.createElement('div');
    box.id = 'scanBox';
    box.className = 'scan-box';
    box.innerHTML = `<button class="btn btn-primary full" id="scanBtn" type="button">📷 Scan / Upload Damaged Metal</button>
      <div class="scan-presets" aria-label="Sample photos"><span>Or try a sample:</span>${SAMPLES.map((s) => `<button class="scan-chip" type="button" data-sample="${s.id}">${esc(s.label)}</button>`).join('')}</div>
      <div id="scanResult"></div>`;
    form.insertBefore(box, form.firstChild);
    q('#scanBtn', box).addEventListener('click', () => openCamera((url) => analyse(url, 'Your photo')));
    qa('[data-sample]', box).forEach((b) => b.addEventListener('click', () => {
      const s = SAMPLES.find((x) => x.id === b.dataset.sample);
      analyse(makeSample(s.id).toDataURL('image/jpeg', 0.9), s.label);
    }));
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Assistant: take a photo, answer on the device                        */
  /* ------------------------------------------------------------------ */
  let lastPhoto = null;
  async function photoReply(attached) {
    const img = await loadImage(attached.preview);
    const result = await classifyMetalDefect(img);
    lastPhoto = { dataUrl: attached.preview, result };
    const best = result.best;
    const real = best.key !== 'unclear' && best.key !== 'other';
    const html = `<p><b>${esc(best.label)}</b> (${result.source === 'heuristic' ? 'a quick colour and texture hint, not a trained model' : Math.round(best.confidence * 100) + '% on-device confidence'}).</p><p>${esc(WHY[best.key] || '')}</p>${result.notes.length ? `<ul>${result.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}<p class="micro-note">Checked on your device, no cloud tokens used. ${result.source === 'heuristic' ? 'This is a quick colour-and-texture screening, so treat it as a hint.' : ''}</p>`;
    return {
      html,
      followups: real ? ['Why does this happen?', 'Which metal would not fail like this?'] : ['What causes metals to crack?'],
      actions: [...(real ? [['fn', 'doctorPhoto', 'Diagnose in Failure Doctor']] : []), ['fn', 'escalatePhoto', 'Escalate to Cloud AI']],
    };
  }

  window.MH_ACTIONS = Object.assign(window.MH_ACTIONS || {}, {
    doctorPhoto() {
      if (!lastPhoto) return;
      setView('doctor');
      setTimeout(() => { mountDoctor(); analyse(lastPhoto.dataUrl, 'Your photo').then(() => applyToDoctor(lastPhoto.result)); }, 250);
    },
    async escalatePhoto() {
      if (!lastPhoto) return;
      const box = q('#copilotMessages');
      const el = document.createElement('div');
      el.className = 'copilot-msg assistant';
      el.innerHTML = '<span class="copilot-role">Assistant</span><div class="chat-body"><p class="micro-note">Asking Cloud AI about your photo… (counts as 1 AI question)</p></div>';
      box?.appendChild(el);
      try { const text = await escalate(lastPhoto.dataUrl, lastPhoto.result); q('.chat-body', el).innerHTML = `<p>${esc(text)}</p>`; }
      catch (err) { q('.chat-body', el).innerHTML = `<p>${esc(err.message)}</p>`; }
      if (box) box.scrollTop = box.scrollHeight;
    },
  });

  function mountAssistantCamera() {
    const attach = q('#copilotAttach');
    if (!attach) return false;
    if (q('#copilotCamera')) return true;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'copilotCamera'; b.className = attach.className; b.title = 'Take a photo with the camera'; b.setAttribute('aria-label', 'Take a photo');
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.4"/></svg>';
    attach.insertAdjacentElement('afterend', b);
    b.addEventListener('click', () => openCamera(async (dataUrl) => {
      // hand the photo to the assistant's own attach handler
      const blob = await (await fetch(dataUrl)).blob();
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
      const input = q('#copilotFile');
      if (input) { input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); }
    }, 'Take a photo for the assistant'));
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Engine status pill                                                   */
  /* ------------------------------------------------------------------ */
  function updatePill() {
    const pill = q('#enginePill');
    if (!pill) return;
    const online = navigator.onLine !== false;
    pill.classList.toggle('offline', !online);
    q('#enginePillText', pill).textContent = online ? 'Edge AI: Hybrid Ready · 0-Token Offline Safe' : 'Edge AI: Offline · Local engine active · 0 tokens';
  }
  window.addEventListener('online', updatePill);
  window.addEventListener('offline', updatePill);

  function boot() {
    updatePill();
    let n = 0;
    const t = setInterval(() => { const a = mountDoctor(); const b = mountAssistantCamera(); if ((a && b) || n++ > 60) clearInterval(t); }, 250);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.MH_VISION = { classifyMetalDefect, photoReply, openCamera, makeSample, escalate };
})();
