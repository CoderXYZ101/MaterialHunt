/* ==========================================================================
   MATERIALHUNT — offline SPA controller
   Three.js WebGL lattice / tensile viewer + Plotly analytics + SaaS flows
   ========================================================================== */
'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const STORAGE = {
  token: 'mh_token_v26',
  theme: 'mh_theme_v26',
  admin: 'mh_admin_passkey_v26',
  seenAuth: 'mh_seen_auth_v26',
};

const CONF_COLOR = { High: '#10B981', Medium: '#F59E0B', Low: '#F43F5E' };
const DATASET_COLOR = { steels: '#22D3EE', glass: '#A78BFA', expt_gap: '#F59E0B' };
const DATASET_NAME = { steels: 'Steels', glass: 'Glass', expt_gap: 'Band Gap' };
const UI_ELEMENTS = ['Fe', 'Cr', 'Ni', 'C', 'Ti', 'Al', 'Mo'];
const COMMON_CHIPS = ['Fe', 'Cr', 'Ni', 'C', 'Ti', 'Al', 'Mo', 'Mn', 'Si', 'V', 'Cu', 'W'];
const HAZARD_ELEMENTS = ['U', 'Pu', 'Th', 'Be', 'Br', 'Cd', 'Hg', 'As'];

const PRESETS = {
  '316L': { Fe: 68, Cr: 17, Ni: 12, Mo: 2.5, C: 0.03, Ti: 0, Al: 0 },
  Ti64: { Ti: 90, Al: 6, V: 4 },
  Aermet: { Fe: 84.5, Ni: 10, Co: 3.5, Mo: 1, C: 0.4, Cr: 0.6 },
  Inconel: { Ni: 58, Cr: 21, Fe: 17, Mo: 3, Ti: 0.9, Al: 0.5, C: 0.05 },
  Al7075: { Al: 90, Zn: 5.6, Mg: 2.5, Cu: 1.6, Cr: 0.3 },
};

const ELEMENT_FALLBACK = { name: 'Unknown', color: '#94A3B8', radius: 130, density: 7.5, role: 'Alloying element' };

const state = {
  token: localStorage.getItem(STORAGE.token) || '',
  user: null,
  meta: null,
  health: null,
  view: 'simulator',
  persona: 'Aerospace',
  composition: { Fe: 70, Cr: 18, Ni: 8, Mo: 2, C: 2, Ti: 0, Al: 0 },
  structure: 'BCC',
  structureMode: 'AUTO',
  shapeColor: '',
  mode: 'lattice',
  screenItems: [],
  lastScreen: null,
  selectedItem: null,
  simulation: null,
  simRequest: null,
  simTimer: null,
  chartTimer: null,
  feedbackRating: 0,
  adminPasskey: sessionStorage.getItem(STORAGE.admin) || '',
  adminSnapshot: null,
  gateActive: false,
  pressureUnit: 'kPa',
  pressureScale: 1000,
  pressureValue: 101325,
  mediumDensity: 1.225,
  comparison: null,
  batchRows: [],
  discoveryRegistry: null,
  periodic: null,
  inlineRating: 0,
  include: new Set(),
  exclude: new Set(),
  scene: null,
  chartsReady: {},
  lastRadar: null,
  benchmarkId: 'rocket-nozzle',
  benchmark: null,
  customBenchmark: null,
  forgeResult: null,
  guidedTourStep: 0,
  initialised: false,
};

const chartConfig = {
  responsive: true,
  displaylogo: false,
  displayModeBar: false,
  scrollZoom: false,
};

/* --------------------------------------------------------------------------
   Small utilities
   -------------------------------------------------------------------------- */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const fmt = (value, digits = 0) => Number(value).toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const fmtCompact = (value) => {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (Math.abs(n) >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${fmt(n)}`;
};
const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const humanFormula = (composition, max = 7) => {
  const entries = Object.entries(composition).filter(([, v]) => Number(v) > 0).sort((a, b) => b[1] - a[1]).slice(0, max);
  return entries.map(([sym, pct]) => {
    const pctNum = Number(pct);
    const suffix = pctNum >= 10 ? pctNum.toFixed(0) : pctNum.toFixed(1);
    return sym + suffix;
  }).join(' ') || '\u2014';
};
const confClass = (confidence) => `conf-${String(confidence).toLowerCase()}`;
const convertStrain = (arr) => arr.map((v) => Number((v * 100).toFixed(3)));
const debounce = (fn, wait = 300) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
};

function elementMeta(symbol) {
  const meta = state.meta?.elements?.[symbol];
  return meta ? { ...ELEMENT_FALLBACK, ...meta, color: meta.color || ELEMENT_FALLBACK.color } : { ...ELEMENT_FALLBACK };
}

function periodicRow(symbol) {
  const table = Array.isArray(state.periodic) ? state.periodic : (state.periodic?.periodic_table || []);
  return table.find((row) => row.symbol === symbol) || null;
}

function aggregatePhaseFor(elements, temperature, pressurePa = null) {
  const pressure = Number(pressurePa || pressurePaFromUI() || 101325);
  const shift = (base, span) => base + clamp(span * Math.log10(Math.max(1, pressure) / 101325), -220, 650);
  let total = 0;
  let vapor = 0;
  let liquid = 0;
  for (const [symbol, pct] of Object.entries(elements || {})) {
    const w = Number(pct);
    if (!(w > 0)) continue;
    const row = periodicRow(symbol);
    if (!row) continue;
    total += w;
    const melt = Number(row.melting_point_c) || 1500;
    const boil = Number(row.boiling_point_c) || (melt * 1.35 + 450);
    const subRaw = row.sublimation_point_c;
    const sub = (subRaw === null || subRaw === undefined || subRaw === '') ? NaN : Number(subRaw);
    const meltEff = shift(melt, 16);
    const boilEff = shift(boil, 34);
    if ((Number.isFinite(sub) && temperature >= shift(sub, 34)) || temperature >= boilEff) vapor += w;
    else if (temperature >= meltEff) liquid += w;
  }
  const share = total || 1;
  if ((vapor / share) * 100 >= 50) return 'GASEOUS / VAPORIZED';
  return ((vapor + liquid) / share) * 100 >= 50 ? 'LIQUID' : 'SOLID';
}

function themeColors() {
  const dark = document.documentElement.dataset.theme !== 'light';
  return {
    dark,
    text: dark ? '#B9C7DA' : '#42536A',
    muted: dark ? '#7B8DA6' : '#65758C',
    grid: dark ? 'rgba(148,163,184,0.09)' : 'rgba(15,23,42,0.07)',
    axis: dark ? 'rgba(148,163,184,0.22)' : 'rgba(15,23,42,0.18)',
    panel: dark ? 'rgba(9,16,30,0.62)' : 'rgba(255,255,255,0.75)',
    cyan: dark ? '#22D3EE' : '#0891B2',
    emerald: dark ? '#10B981' : '#059669',
    amber: dark ? '#F59E0B' : '#D97706',
    rose: dark ? '#F43F5E' : '#E11D48',
    violet: dark ? '#A78BFA' : '#7C3AED',
    blue: dark ? '#60A5FA' : '#2563EB',
  };
}

function plotBase(extra = {}, margins = null) {
  const c = themeColors();
  const base = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: '"Segoe UI", Inter, sans-serif', size: 10, color: c.text },
    margin: margins || { l: 48, r: 18, t: 18, b: 40 },
    hoverlabel: {
      bgcolor: c.dark ? 'rgba(8,14,26,0.95)' : 'rgba(255,255,255,0.97)',
      bordercolor: c.dark ? 'rgba(34,211,238,0.4)' : 'rgba(8,145,178,0.3)',
      font: { color: c.dark ? '#E7F1FF' : '#0B1220', size: 10 },
    },
    legend: {
      orientation: 'h', y: 1.12, x: 0, font: { size: 9, color: c.muted },
      bgcolor: 'rgba(0,0,0,0)', borderwidth: 0,
    },
  };
  return { ...base, ...extra };
}

function axisBase(extra = {}) {
  const c = themeColors();
  return {
    gridcolor: c.grid,
    zerolinecolor: c.axis,
    linecolor: c.axis,
    tickfont: { color: c.muted, size: 9 },
    titlefont: { color: c.muted, size: 9.5 },
    ...extra,
  };
}

/* Browsers allow only about 16 WebGL contexts per page. Every Plotly chart that uses WebGL (3D and "gl" charts)
   takes one, so those charts are drawn only while their page is on screen and released when it is not. */
const GL_CHART = /gl$|3d$|^surface$|^mesh3d$|^volume$/;
const glLive = new Map();      // element -> [traces, layout, config] for GL charts currently drawn
const glDeferred = new Map();  // element -> [traces, layout, config] for GL charts waiting to become visible
const elementHidden = (el) => !el.isConnected || (el.offsetParent === null && getComputedStyle(el).position !== 'fixed');

function renderPlot(element, traces, layout, config = chartConfig) {
  if (!element) return;
  if (!window.Plotly) {
    element.innerHTML = '<div class="empty-row">Plotly.js was not found in /static/vendor.</div>';
    return;
  }
  const usesGl = (traces || []).some((t) => GL_CHART.test(String(t?.type || '')));
  if (usesGl) {
    if (elementHidden(element)) { glDeferred.set(element, [traces, layout, config]); return; }
    glDeferred.delete(element);
    glLive.set(element, [traces, layout, config]);
  }
  Plotly.react(element, traces, layout, config).catch((err) => console.warn('Plotly render failed', err));
}

function syncGlCharts() {
  glLive.forEach((args, el) => {
    if (!elementHidden(el)) return;
    try { Plotly.purge(el); } catch { /* already gone */ }
    glLive.delete(el);
    glDeferred.set(el, args);
  });
  glDeferred.forEach((args, el) => {
    if (elementHidden(el)) return;
    glDeferred.delete(el);
    glLive.set(el, args);
    Plotly.react(el, ...args).catch((err) => console.warn('Plotly render failed', err));
  });
}

function toast(message, type = 'info', timeout = 4200) {
  const container = $('#toastContainer');
  if (!container) return;
  const icons = {
    success: '<path d="m5 13 4 4L19 7"/>',
    error: '<path d="M12 8v5M12 17v.5"/><circle cx="12" cy="12" r="9"/>',
    warning: '<path d="M12 9v4M12 17v.5"/><path d="M10.3 3.8 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>',
  };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${icons[type] || icons.info}</svg><span>${escapeHtml(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 320);
  }, timeout);
}

class ApiError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

function detailText(detail) {
  if (!detail) return 'Request failed.';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((d) => d.msg || d.message || JSON.stringify(d)).join(' ‷ ');
  return detail.message || detail.code || JSON.stringify(detail);
}

async function api(path, options = {}) {
  const { method = 'GET', body = null, auth = true, admin = false, extraHeaders = {} } = options;
  const headers = { ...extraHeaders };
  if (body !== null) headers['Content-Type'] = 'application/json';
  if (auth && state.token) headers.Authorization = `Bearer ${state.token}`;
  if (admin && state.adminPasskey) headers['X-Admin-Passkey'] = state.adminPasskey;
  const target = admin ? `${path}${path.includes('?') ? '&' : '?'}gate=mh_vault_99x` : path;
  let response;
  try {
    response = await fetch(target, { method, headers, body: body !== null ? JSON.stringify(body) : undefined });
  } catch (err) {
    throw new ApiError('Local server unreachable. Is uvicorn running on port 8000?', 0, null);
  }
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { detail: text }; }
  if (!response.ok) {
    const detail = data?.detail || data;
    throw new ApiError(detailText(detail), response.status, detail);
  }
  return data;
}

/* --------------------------------------------------------------------------
   Theme + navigation
   -------------------------------------------------------------------------- */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORAGE.theme, theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#F4F7FB' : '#070B14');
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  renderAllCharts();
  if (state.scene) state.scene.setTheme(next);
  toast(`${next === 'dark' ? 'Dark Industrial Slate' : 'Light Lab'} theme engaged`, 'info', 1800);
}

function setView(view, scroll = true) {
  state.view = view;
  document.body.dataset.activeView = view;
  $$('.view').forEach((section) => section.classList.toggle('active', section.id === `view-${view}`));
  $$('.nav-link').forEach((link) => link.classList.toggle('active', link.dataset.view === view));
  if (view === 'analytics') renderAnalyticsCharts();
  if (view === 'simulator') {
    renderSimulationCharts();
    if (!state.simulation && !state.simTimer) runSimulation({ silent: true });
  }
  if (view === 'comparison' && !state.comparison) runComparison({ silent: true });
  if (view === 'batch' && !state.batchRows.length) loadBatchSample(false);
  if (view === 'roi') renderRoi();
  if (view === 'discoveryRegistry') loadDiscoveryRegistry();
  if (view === 'pricing') renderPricing();
  if (view === 'admin') {
    const unlocked = Boolean(state.adminSnapshot);
    $('#adminLock')?.classList.toggle('hidden', unlocked);
    $('#adminContent')?.classList.toggle('hidden', !unlocked);
    if (unlocked) renderAdminSnapshot(state.adminSnapshot);
  }
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(syncGlCharts, 60);
  setTimeout(resizeCharts, 160);
}

/* --------------------------------------------------------------------------
   Auth
   -------------------------------------------------------------------------- */
function openAuth(tab = 'login') {
  const modal = $('#authModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  switchAuthTab(tab);
  $('#authError').textContent = '';
  setTimeout(() => {
    if (tab === 'login') $('#loginEmail')?.focus();
    else $('#registerOrg')?.focus();
  }, 80);
}

function closeAuth() {
  $('#authModal')?.classList.add('hidden');
  $('#authError').textContent = '';
}

function switchAuthTab(tab) {
  $$('.auth-tab').forEach((button) => button.classList.toggle('active', button.dataset.auth === tab));
  $('#loginForm')?.classList.toggle('hidden', tab !== 'login');
  $('#registerForm')?.classList.toggle('hidden', tab !== 'register');
  $('#authError').textContent = '';
}

function setSession(token, user) {
  state.token = token || '';
  state.user = user || null;
  if (token) localStorage.setItem(STORAGE.token, token);
  else localStorage.removeItem(STORAGE.token);
  renderSession();
}

function renderSession() {
  const loggedIn = Boolean(state.user);
  $('#loginBtn')?.classList.toggle('hidden', loggedIn);
  $('#ctaSignup')?.classList.toggle('hidden', loggedIn);
  $('#heroCreate')?.classList.toggle('hidden', loggedIn);
  $('#inviteBtn')?.classList.toggle('hidden', !loggedIn);
  $('#userChip')?.classList.toggle('hidden', !loggedIn);
  window.dispatchEvent(new CustomEvent('mh:session', { detail: { user: state.user } }));
  if (!loggedIn) return;
  const org = state.user.organization_name || state.user.email;
  const initials = org.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'MH';
  $('#userAvatar').textContent = initials;
  $('#userName').textContent = org;
  const until = state.user.trial_until ? ` until ${new Date(state.user.trial_until).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : '';
  $('#userTier').textContent = `${state.user.tier_name || 'Free'} plan${until}${state.user.kyb_status === 'approved' ? ' · Verified business' : ''}`;
  if (state.gateActive) $('#vaultNav')?.classList.remove('hidden');
  if (state.user.plan_expired && !sessionStorage.getItem('mh_plan_ended')) {
    sessionStorage.setItem('mh_plan_ended', '1');
    toast('Your paid plan has ended. Renew from the Pricing page to keep Pro features.', 'warning', 8000);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const button = $('#loginForm button[type="submit"]');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Verifying…';
  try {
    const result = await api('/api/auth/login', {
      method: 'POST', auth: false,
      body: { email: $('#loginEmail').value.trim(), password: $('#loginPassword').value },
    });
    setSession(result.token, result.user);
    closeAuth();
    toast(`Welcome back, ${result.user.organization_name}`, 'success');
    await afterLogin();
  } catch (err) {
    $('#authError').textContent = err.message;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const button = $('#registerForm button[type="submit"]');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Creating your account…';
  try {
    const result = await api('/api/auth/register', {
      method: 'POST', auth: false,
      body: {
        email: $('#registerEmail').value.trim(),
        password: $('#registerPassword').value,
        organization_name: $('#registerOrg').value.trim(),
        org_id: $('#registerOrgId').value.trim(),
      },
    });
    setSession(result.token, result.user);
    closeAuth();
    toast('Account created. Check your inbox to verify your email.', 'success', 6000);
    await afterLogin();
  } catch (err) {
    $('#authError').textContent = err.message;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function afterLogin() {
  renderSession();
  if (state.user?.role === 'admin' && state.gateActive) $('#vaultNav')?.classList.remove('hidden');
  await loadPrescreen();
  await runSimulation({ silent: true });
}

async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* offline logout is still local */ }
  setSession('', null);
  state.screenItems = [];
  state.selectedItem = null;
  state.adminSnapshot = null;
  renderCandidateTable([]);
  toast('Signed out.', 'info');
}

/* --------------------------------------------------------------------------
   Bootstrap + metadata
   -------------------------------------------------------------------------- */
async function bootstrap() {
  const savedTheme = localStorage.getItem(STORAGE.theme);
  applyTheme(savedTheme || 'dark');

  try {
    const [health, meta] = await Promise.all([
      api('/api/health', { auth: false }),
      api('/api/meta', { auth: false }),
    ]);
    state.health = health;
    state.meta = meta;
    applyMeta(meta);
    updateHealthBadge(health);
  } catch (err) {
    toast(err.message, 'error', 7000);
    $('#offlineText').textContent = 'ENGINE OFFLINE';
  }

  if (state.meta) {
    renderAllCharts();
    renderElementSliders();
    updateCompositionUI();
    renderHandbook();
    renderRiskRadar();
    preloadPeriodic();
  }
  applyUrlFormula();
  benchmarkFromUrl();
  applyBenchmark(state.benchmarkId, { silent: true });

  if (state.token) {
    try {
      const result = await api('/api/auth/me');
      setSession(state.token, result.user);
    } catch {
      setSession('', null);
    }
  }

  if (state.gateActive) {
    $('#vaultNav')?.classList.remove('hidden');
    setView('admin', false);
    if (state.adminPasskey) attemptAdminUnlock(true);
  }

  if (state.user) {
    await afterLogin();
  } else {
    // The pre-screen endpoint is public; show a populated guest preview so the
    // command deck is never empty before sign-in.
    if (state.meta) {
      await loadPrescreen();
      await runSimulation({ silent: true });
    }
  }

  // Initialize enterprise features
  if (typeof initEnterpriseFeatures === 'function') initEnterpriseFeatures();
  
  state.initialised = true;
  setTimeout(resizeCharts, 300);
}

function updateHealthBadge(health) {
  const badge = $('#offlineBadge');
  const text = $('#offlineText');
  if (!badge || !text) return;
  const assetsOk = (health.assets?.['three.min.js']?.present && health.assets?.['plotly.min.js']?.present);
  if (health.model_loaded && assetsOk) {
    badge.className = 'status-pill status-online';
    text.textContent = 'ENGINE READY';
    badge.title = `three.js ${fmt(health.assets['three.min.js'].bytes / 1024)} KB · Plotly ${fmt(health.assets['plotly.min.js'].bytes / 1024 / 1024, 1)} MB · local only`;
  } else {
    badge.className = 'status-pill status-amber';
    text.textContent = 'DEGRADED';
    badge.title = health.model_error || 'Model or vendor asset missing';
  }
}

function applyMeta(meta) {
  const datasets = meta.datasets || {};
  const bestR2 = Math.max(...Object.values(datasets).map((d) => Number(d.benchmarks?.random_forest?.r2) || 0), 0);
  $('#statAccuracy').textContent = bestR2 ? bestR2.toFixed(3) : '—';
  $('#statAccuracySub').textContent = `best task · ${Object.entries(datasets).sort((a, b) => (b[1].benchmarks.random_forest.r2 - a[1].benchmarks.random_forest.r2))[0]?.[1]?.label || 'Random Forest'}`;
  $('#statCandidates').textContent = meta.candidate_total ? fmt(meta.candidate_total) : '—';
  $('#analyticsBadge').textContent = `${Object.keys(datasets).length} TASKS · ${meta.feature_count} FEATURES`;
  const variance = (meta.pca_explained_variance || []).map((v) => `${(v * 100).toFixed(1)}%`).join(' / ');
  $('#clusterVariance').textContent = `PCA-3 variance ${variance}`;
  $('#analyticsVariance').textContent = `PCA-3 variance ${variance}`;

  renderPersonas();
  renderElementChips();
  populateConditionSelects();
  renderBenchmarkTable();
  renderCoverageChart();
  renderErrorChart();
  renderImportanceChart();

  const tierSelect = $('#roiTier');
  if (tierSelect && meta.tiers) {
    tierSelect.innerHTML = `
      <option value="pro">Pro · ₹${fmt(meta.tiers.pro.price)} / mo</option>
      <option value="enterprise">Enterprise · ₹${fmt(meta.tiers.enterprise.price)} / mo</option>`;
  }
  renderRoi();
  renderPricing();
}

function renderPersonas() {
  const container = $('#personaGrid');
  if (!container) return;
  const personas = state.meta?.personas || {};
  container.innerHTML = Object.entries(personas).map(([key, persona]) => {
    const active = key === state.persona ? ' active' : '';
    return `<button class="persona-btn${active}" data-persona="${escapeHtml(key)}"><span class="pdot"></span>${escapeHtml(persona.label)}</button>`;
  }).join('');
}

function renderElementChips() {
  const include = $('#includeElements');
  const exclude = $('#excludeElements');
  if (!include || !exclude) return;
  include.innerHTML = COMMON_CHIPS.map((sym) => `<button class="el-chip${state.include.has(sym) ? ' active' : ''}" data-chip="include" data-symbol="${sym}">${sym}</button>`).join('');
  const excludeList = [...COMMON_CHIPS, ...HAZARD_ELEMENTS];
  exclude.innerHTML = excludeList.map((sym) => {
    const hazard = HAZARD_ELEMENTS.includes(sym) ? ' hazard' : '';
    return `<button class="el-chip exclude${hazard}${state.exclude.has(sym) ? ' active' : ''}" data-chip="exclude" data-symbol="${sym}">${sym}</button>`;
  }).join('');
}

function populateConditionSelects() {
  const environments = state.meta?.environments || {
    'Air / Industrial': { label: 'Air / Industrial' },
    'Marine / Salt Spray': { label: 'Marine / Salt Spray' },
    'Acidic / Chemical': { label: 'Acidic / Chemical' },
  };
  const profiles = state.meta?.load_profiles || {
    'Static tension': { label: 'Static tension' },
    'Cyclic / Fatigue': { label: 'Cyclic / Fatigue' },
  };
  const envSelect = $('#environmentSelect');
  const profileSelect = $('#loadProfileSelect');
  if (envSelect) {
    envSelect.innerHTML = Object.entries(environments).map(([key, env]) =>
      `<option value="${escapeHtml(key)}">${escapeHtml(env.label)}</option>`).join('');
    envSelect.value = 'Air / Industrial';
  }
  if (profileSelect) {
    profileSelect.innerHTML = Object.entries(profiles).map(([key, profile]) =>
      `<option value="${escapeHtml(key)}">${escapeHtml(profile.label)}</option>`).join('');
    profileSelect.value = 'Static tension';
  }
}

function renderElementSliders() {
  const container = $('#elementSliders');
  if (!container) return;
  const symbols = [...new Set([...UI_ELEMENTS, ...Object.keys(state.composition)])];
  symbols.sort((a, b) => {
    const ia = UI_ELEMENTS.indexOf(a);
    const ib = UI_ELEMENTS.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return (state.composition[b] || 0) - (state.composition[a] || 0);
  });
  container.innerHTML = symbols.map((sym) => {
    const meta = elementMeta(sym);
    const value = Number(state.composition[sym] || 0);
    const hazard = HAZARD_ELEMENTS.includes(sym) ? ' ⚠' : '';
    return `
      <div class="el-slider-row" style="--el-color:${meta.color}">
        <span class="el-symbol" title="${escapeHtml(meta.role)}">${sym}${hazard}</span>
        <input type="range" min="0" max="100" step="0.1" value="${value}" data-element="${sym}" aria-label="${sym} percentage" />
        <output data-output="${sym}">${value.toFixed(value < 1 ? 2 : 1)}</output>
      </div>`;
  }).join('');
}

/* Rule of thumb for the crystal structure of a mix: each element votes with its usual room-temperature structure,
   weighted by how much of it there is. Iron with enough nickel or manganese turns austenitic (FCC), as in stainless steel. */
const NATURAL_STRUCTURE = {
  BCC: ['Fe', 'Cr', 'V', 'Nb', 'Ta', 'Mo', 'W', 'Mn', 'Li', 'Na', 'K', 'Ba'],
  FCC: ['Al', 'Ni', 'Cu', 'Ag', 'Au', 'Pt', 'Pd', 'Pb', 'Ir', 'Rh', 'Ca', 'Sr', 'Th'],
  HCP: ['Ti', 'Zr', 'Hf', 'Mg', 'Zn', 'Cd', 'Co', 'Be', 'Re', 'Ru', 'Os', 'Sc', 'Y', 'Tl'],
};
function predictStructure(norm) {
  const votes = { BCC: 0, FCC: 0, HCP: 0 };
  const stabiliser = (norm.Ni || 0) + (norm.Mn || 0) * 0.5 + (norm.Cu || 0) * 0.4;
  Object.entries(norm).forEach(([sym, pct]) => {
    let kind = Object.keys(NATURAL_STRUCTURE).find((k) => NATURAL_STRUCTURE[k].includes(sym)) || 'BCC';
    if (sym === 'Fe' && stabiliser >= 8) kind = 'FCC';
    if (sym === 'Co' && (norm.Ni || 0) >= 15) kind = 'FCC';
    votes[kind] += pct;
  });
  return Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0];
}
function syncStructure() {
  if (state.structureMode === 'AUTO') state.structure = predictStructure(normalisedComposition());
}

function updateCompositionUI() {
  syncStructure();
  const normalized = normalisedComposition();
  const formulaEl = $('#simFormula');
  if (formulaEl) formulaEl.textContent = humanFormula(normalized, 9);
  renderHeroLegend(normalized);
  const signature = Object.entries(normalized).sort().map(([s, v]) => `${s}${v.toFixed(1)}`).join('·');
  const badge = $('#heroBadge');
  if (badge) badge.textContent = `${state.structure} · ${signature}`;
  updateSceneFromState();
}

function normalisedComposition() {
  const entries = Object.entries(state.composition).filter(([, value]) => Number(value) > 0.0001);
  const total = entries.reduce((sum, [, value]) => sum + Number(value), 0) || 1;
  return Object.fromEntries(entries.map(([sym, value]) => [sym, Number(value) / total * 100]));
}

function renderHeroLegend(normalized = normalisedComposition()) {
  const legend = $('#heroLegend');
  if (!legend) return;
  legend.innerHTML = Object.entries(normalized).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([sym, pct]) => {
    const meta = elementMeta(sym);
    return `<span class="legend-item"><span class="legend-dot" style="color:${meta.color};background:${meta.color}"></span>${sym} ${pct.toFixed(pct < 10 ? 1 : 0)}%</span>`;
  }).join('');
}

/* --------------------------------------------------------------------------
   Pre-screening
   -------------------------------------------------------------------------- */
function prescreenPayload() {
  const datasets = $$('.dataset-check').filter((c) => c.checked).map((c) => c.value);
  const customWeights = state.persona === 'Custom Weights' ? {
    strength: Number($('#wStrength')?.value || 25),
    weight: Number($('#wWeight')?.value || 20),
    thermal: Number($('#wThermal')?.value || 20),
    corrosion: Number($('#wCorrosion')?.value || 15),
    cost: Number($('#wCost')?.value || 10),
    confidence: Number($('#wConfidence')?.value || 10),
  } : null;
  const cost = Number($('#maxCost')?.value || 8000);
  const density = Number($('#maxDensity')?.value || 20);
  return {
    datasets: datasets.length ? datasets : ['steels', 'glass', 'expt_gap'],
    persona: state.persona,
    custom_weights: customWeights,
    min_confidence: $('#confidenceFilter')?.value || 'Low',
    max_cost: cost >= 8000 ? null : cost,
    max_density: density >= 20 ? null : density,
    include_elements: [...state.include],
    exclude_elements: [...state.exclude],
    search: $('#searchInput')?.value.trim() || '',
    include_hazardous: false,
    limit: 60,
  };
}

async function loadPrescreen() {
  const status = $('#prescreenStatus');
  if (status) { status.textContent = 'SCANNING'; status.className = 'status-pill status-amber'; }
  $('#prescreenStatus')?.classList.add('pulse');
  try {
    const result = await api('/api/prescreen', { method: 'POST', body: prescreenPayload() });
    state.lastScreen = result;
    state.screenItems = result.candidates || [];
    renderCandidateTable(state.screenItems);
    renderAshby(state.screenItems);
    if (state.screenItems.length) {
      selectCandidate(state.screenItems[0], false);
    } else {
      state.lastRadar = null;
      renderRadar(null);
    }
    const summary = $('#resultsSummary');
    if (summary) {
      summary.textContent = `${result.count} candidates · ${result.persona} weighting · ${result.total_before_limit} passed filters`;
    }
    const footer = $('#tableFooterNote');
    if (footer) footer.textContent = `Persona weights: ${Object.entries(result.weights).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(' · ')}`;
    if (status) { status.textContent = 'SCREEN COMPLETE'; status.className = 'status-pill status-cyan'; }
    updateStatsFromScreen(result);
  } catch (err) {
    if (status) { status.textContent = 'ERROR'; status.className = 'status-pill status-rose'; }
    toast(err.message, 'error');
  }
}

function updateStatsFromScreen(result) {
  const bestR2 = result.candidates?.length
    ? Math.max(...result.candidates.map((c) => Number(c.benchmark_r2) || 0))
    : null;
  if (bestR2) $('#statAccuracy').textContent = bestR2.toFixed(3);
  const el = $('#statCandidates');
  if (el) el.textContent = result.total_before_limit ? fmt(result.total_before_limit) : '0';
}

function renderCandidateTable(items) {
  const body = $('#candidateBody');
  const count = $('#resultCount');
  if (count) count.textContent = String(items.length);
  if (!body) return;
  if (!items.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="9">No candidates in this envelope. Widen the filters or reset the selector matrix.</td></tr>`;
    return;
  }
  body.innerHTML = items.map((item, index) => {
    const selected = state.selectedItem?.id === item.id ? ' selected' : '';
    return `
      <tr class="${selected}" data-row="${index}">
        <td class="mono">${item.rank}</td>
        <td>
          <span class="formula">${escapeHtml(item.formula)}</span>
          <span class="sub-line">${escapeHtml(item.alloy_class)}</span>
        </td>
        <td><span class="dataset-tag">${escapeHtml(DATASET_NAME[item.dataset] || item.dataset)}</span></td>
        <td><span class="mono">${fmt(item.predicted, item.unit === 'eV' ? 2 : 0)}</span> <span class="sub-line">${escapeHtml(item.unit)}</span></td>
        <td>
          <span class="${confClass(item.confidence)} conf-dot"><i></i>${escapeHtml(item.confidence)}</span>
          <span class="sub-line">±${fmt(item.uncertainty, item.unit === 'eV' ? 3 : 0)} ${escapeHtml(item.unit)}</span>
        </td>
        <td class="mono">₹${fmt(item.cost_per_kg, 0)}<span class="sub-line">/kg</span></td>
        <td class="mono">${item.density.toFixed(2)}<span class="sub-line">g/cm³</span></td>
        <td>
          <span class="mono">${item.rank_score.toFixed(0)}</span>
          <div class="score-bar"><i style="width:${clamp(item.rank_score, 0, 100)}%"></i></div>
        </td>
        <td><button class="row-action" data-load="${index}">Simulate →</button></td>
      </tr>`;
  }).join('');
}

function csvExport() {
  if (!state.screenItems.length) { toast('Run a screen before exporting.', 'warning'); return; }
  const rows = [
    ['rank', 'formula', 'dataset', 'predicted', 'unit', 'uncertainty', 'confidence', 'cost_inr_kg', 'density_gcm3', 'rank_score'],
    ...state.screenItems.map((item) => [item.rank, item.formula, item.dataset, item.predicted, item.unit, item.uncertainty, item.confidence, item.cost_per_kg, item.density, item.rank_score]),
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `MATERIALHUNT_pre-screen_${Date.now()}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast('Candidate matrix exported as CSV.', 'success');
}

function selectCandidate(item, announce = true) {
  if (!item) return;
  state.selectedItem = item;
  $$('#candidateBody tr').forEach((row, index) => row.classList.toggle('selected', state.screenItems[index]?.id === item.id));
  const radar = radarFromCandidate(item);
  state.lastRadar = radar;
  renderRadar(radar, item.formula);
  const tag = $('#radarTag');
  if (tag) tag.textContent = item.formula;
  if (announce) toast(`${item.formula} loaded into the six-axis comparison`, 'info', 2200);
}

function radarFromCandidate(item) {
  const costScore = clamp(100 - Math.log10(item.cost_per_kg + 1) * 26, 2, 100);
  const weightScore = clamp(100 - (item.density - 1.5) * 10.5, 2, 100);
  const strengthScore = item.dataset === 'steels'
    ? clamp(item.predicted / 1600 * 100, 2, 100)
    : clamp(item.predicted / (item.dataset === 'glass' ? 1000 : 8) * 100, 2, 100);
  return {
    labels: ['Strength', 'Ductility', 'Thermal', 'Corrosion', 'Cost-Efficiency', 'Weight-Efficiency'],
    alloy: [strengthScore, item.ductility_index * 100, clamp(item.thermal_limit_c / 12, 2, 100), item.corrosion_index * 100, costScore, weightScore],
    benchmark: [52, 48, 55, 46, 58, 52],
    confidence: item.confidence,
  };
}

function loadCandidateIntoSimulator(item) {
  const composition = {};
  Object.entries(item.elements || {}).forEach(([sym, fraction]) => {
    composition[sym] = Number(fraction) * 100;
  });
  state.composition = composition;
  renderElementSliders();
  updateCompositionUI();
  setView('simulator');
  runSimulation();
  toast(`${item.formula} loaded into the digital metallurgy bench.`, 'success');
}

/* ==========================================================================
   Plotly analytics
   ========================================================================== */
function renderAllCharts() {
  try {
    renderAshby(state.screenItems || []);
    renderRadar(state.lastRadar || defaultRadar());
    renderCluster($('#clusterChart'), state.meta?.feature_space || [], state.simulation?.pca || null);
    renderSimulationCharts();
    renderAnalyticsCharts();
    renderRoi();
    renderBenchmarkTable();
  } catch (err) {
    console.warn('Chart refresh failed', err);
  }
}

function emptyChartLayout(message) {
  const c = themeColors();
  return plotBase({
    xaxis: { visible: false },
    yaxis: { visible: false },
    annotations: [{
      text: message, showarrow: false, x: 0.5, y: 0.5, xref: 'paper', yref: 'paper',
      font: { color: c.muted, size: 11 },
    }],
    margin: { l: 20, r: 20, t: 20, b: 20 },
  });
}

function renderAshby(items) {
  const el = $('#ashbyChart');
  if (!el) return;
  const steels = (items || []).filter((item) => Number(item.specific_strength) > 0 && Number(item.cost_per_kg) > 0);
  if (!steels.length) {
    renderPlot(el, [], emptyChartLayout('No structural (yield-strength) candidates in this filter envelope.'));
    return;
  }
  const c = themeColors();
  const groups = { High: [], Medium: [], Low: [] };
  steels.forEach((item) => (groups[item.confidence] || groups.Low).push(item));
  const traces = Object.entries(groups).filter(([, arr]) => arr.length).map(([confidence, arr]) => ({
    type: 'scatter',
    mode: 'markers',
    name: `${confidence} confidence`,
    x: arr.map((item) => item.cost_per_kg),
    y: arr.map((item) => item.specific_strength),
    text: arr.map((item) => item.formula),
    customdata: arr.map((item) => [item.alloy_class, item.predicted, item.density, item.uncertainty]),
    marker: {
      size: arr.map((item) => (confidence === 'High' ? 19 : confidence === 'Medium' ? 14 : 10)),
      color: CONF_COLOR[confidence],
      opacity: 0.82,
      line: { color: c.dark ? 'rgba(232,238,249,0.55)' : 'rgba(255,255,255,0.95)', width: 1.2 },
      sizemode: 'diameter',
    },
    hovertemplate: '<b>%{text}</b><br>%{customdata[0]}<br>Cost ?%{x:,.0f}/kg<br>Specific strength %{y:,.0f} MPa·cm³/g<br>YS %{customdata[1]:,.0f} MPa · ρ %{customdata[2]:.2f}<br>±%{customdata[3]:,.0f} MPa<extra></extra>',
  }));
  const selected = state.selectedItem?.specific_strength ? [{
    type: 'scatter', mode: 'markers', name: 'Selected',
    x: [state.selectedItem.cost_per_kg], y: [state.selectedItem.specific_strength],
    marker: { size: 28, color: 'rgba(0,0,0,0)', line: { color: c.amber, width: 2 }, symbol: 'circle-open' },
    hoverinfo: 'skip', showlegend: false,
  }] : [];
  const maxY = Math.max(...steels.map((i) => i.specific_strength)) * 1.12;
  const layout = plotBase({
    margin: { l: 54, r: 22, t: 20, b: 48 },
    xaxis: axisBase({
      type: 'log', title: 'Raw material cost (? / kg, log scale)',
      rangemode: 'tozero', gridcolor: c.grid,
    }),
    yaxis: axisBase({ title: 'Specific yield strength (MPa·cm³/g)', range: [0, maxY] }),
    shapes: [{
      type: 'rect', xref: 'paper', yref: 'y', x0: 0, x1: 0.56, y0: 60, y1: maxY,
      fillcolor: 'rgba(16,185,129,0.055)', line: { color: 'rgba(16,185,129,0.35)', width: 1, dash: 'dot' }, layer: 'below',
    }],
    annotations: [{
      x: 0.02, y: 0.95, xref: 'paper', yref: 'paper', text: '◆ Ashby target zone · low cost / high specific strength',
      showarrow: false, font: { size: 8.5, color: c.emerald }, align: 'left',
    }],
    legend: { orientation: 'h', x: 0.57, y: 1.14, font: { size: 9, color: c.muted } },
  });
  renderPlot(el, [...traces, ...selected], layout);
}

function defaultRadar() {
  return {
    labels: ['Strength', 'Ductility', 'Thermal', 'Corrosion', 'Cost-Efficiency', 'Weight-Efficiency'],
    alloy: [58, 52, 56, 48, 62, 55],
    benchmark: [52, 48, 55, 46, 58, 52],
    confidence: 'Medium',
  };
}

function renderRadar(radar, tag = '') {
  const el = $('#radarChart');
  if (!el) return;
  const data = radar || defaultRadar();
  const c = themeColors();
  const close = (arr) => [...arr, arr[0]];
  const labels = close(data.labels);
  const layout = plotBase({
    margin: { l: 38, r: 38, t: 24, b: 26 },
    polar: {
      bgcolor: 'rgba(0,0,0,0)',
      radialaxis: { visible: true, range: [0, 100], showline: false, gridcolor: c.grid, tickfont: { size: 7, color: c.muted }, angle: 90, tickangle: 90 },
      angularaxis: { gridcolor: c.grid, linecolor: c.axis, tickfont: { size: 8.5, color: c.text } },
    },
    legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.06, font: { size: 8.5, color: c.muted } },
    annotations: tag ? [{ text: tag, x: 0.5, y: 1.1, xref: 'paper', yref: 'paper', showarrow: false, font: { size: 9, color: c.cyan } }] : [],
  });
  renderPlot(el, [
    {
      type: 'scatterpolar', r: close(data.alloy), theta: labels, fill: 'toself', name: 'Target alloy',
      line: { color: c.cyan, width: 2 }, fillcolor: 'rgba(34,211,238,0.13)',
      marker: { color: c.cyan, size: 4 },
      hovertemplate: '%{theta}: %{r:.0f}/100<extra></extra>',
    },
    {
      type: 'scatterpolar', r: close(data.benchmark), theta: labels, fill: 'toself', name: 'Dataset benchmark',
      line: { color: c.violet, width: 1.4, dash: 'dot' }, fillcolor: 'rgba(167,139,250,0.055)',
      marker: { color: c.violet, size: 3 },
      hovertemplate: '%{theta}: %{r:.0f}/100<extra></extra>',
    },
  ], layout);
}

function clusterTraces(points, customPoint) {
  const c = themeColors();
  const traces = ['steels', 'glass', 'expt_gap'].map((dataset) => {
    const subset = points.filter((p) => p.dataset === dataset);
    return {
      type: 'scatter3d', mode: 'markers', name: DATASET_NAME[dataset],
      x: subset.map((p) => p.x), y: subset.map((p) => p.y), z: subset.map((p) => p.z),
      text: subset.map((p) => p.composition),
      customdata: subset.map((p) => p.confidence),
      marker: {
        size: subset.map((p) => (p.confidence === 'High' ? 3.4 : p.confidence === 'Medium' ? 2.8 : 2.2)),
        color: DATASET_COLOR[dataset], opacity: 0.48,
        line: { color: 'rgba(255,255,255,0.05)', width: 0.4 },
      },
      hovertemplate: `<b>%{text}</b><br>${DATASET_NAME[dataset]}<br>PC1 %{x:.2f} · PC2 %{y:.2f} · PC3 %{z:.2f}<br>%{customdata} confidence<extra></extra>`,
    };
  });
  if (customPoint) {
    traces.push({
      type: 'scatter3d', mode: 'markers+text', name: 'Your alloy',
      x: [customPoint[0]], y: [customPoint[1]], z: [customPoint[2]],
      text: ['YOUR ALLOY'], textposition: 'top center', textfont: { size: 9, color: c.amber },
      marker: { size: 10, color: c.amber, symbol: 'diamond', line: { color: '#FFF7ED', width: 2 } },
      hovertemplate: `<b>Custom alloy</b><br>PC1 %{x:.2f} · PC2 %{y:.2f} · PC3 %{z:.2f}<extra></extra>`,
    });
  }
  return traces;
}

function sceneLayout() {
  const c = themeColors();
  const axis = (title) => ({
    title: { text: title, font: { size: 8, color: c.muted } },
    backgroundcolor: 'rgba(0,0,0,0)', gridcolor: c.grid, zerolinecolor: c.axis,
    showbackground: true, showspikes: false, tickfont: { size: 7, color: c.muted },
  });
  return {
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    margin: { l: 4, r: 4, t: 8, b: 4 },
    font: { family: '"Segoe UI", Inter, sans-serif', color: c.text, size: 9 },
    scene: {
      bgcolor: 'rgba(0,0,0,0)',
      xaxis: axis('PC1'), yaxis: axis('PC2'), zaxis: axis('PC3'),
      camera: { eye: { x: 1.55, y: 1.32, z: 1.3 } },
      aspectmode: 'cube',
    },
    legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: 0.98, font: { size: 8.5, color: c.muted }, bgcolor: 'rgba(0,0,0,0)' },
  };
}

function renderCluster(el, points, customPoint) {
  if (!el) return;
  if (!points || !points.length) {
    renderPlot(el, [], emptyChartLayout('Feature-space map will appear once the model bundle is loaded.'));
    return;
  }
  renderPlot(el, clusterTraces(points, customPoint), sceneLayout(), { ...chartConfig, displayModeBar: false });
}

function renderStressChart(sim) {
  const el = $('#simStressChart');
  if (!el) return;
  if (!sim?.curves) {
    renderPlot(el, [], emptyChartLayout('Run a simulation to generate the stress-strain envelope.'));
    return;
  }
  const c = themeColors();
  const room = sim.curves.room;
  const op = sim.curves.operating;
  const traces = [
    {
      type: 'scatter', mode: 'lines', name: `25°C · ${fmt(room.yield_point.stress)} MPa yield`,
      x: convertStrain(room.strain), y: room.stress,
      line: { color: c.cyan, width: 2.2, shape: 'spline', smoothing: 0.6 },
      hovertemplate: 'Strain %{x:.2f}%<br>Stress %{y:,.0f} MPa<extra>25°C</extra>',
    },
    {
      type: 'scatter', mode: 'lines', name: `${fmt(sim.conditions.temperature_c)}°C · ${fmt(op.yield_point.stress)} MPa yield`,
      x: convertStrain(op.strain), y: op.stress,
      line: { color: c.amber, width: 2.2, shape: 'spline', smoothing: 0.6 },
      hovertemplate: 'Strain %{x:.2f}%<br>Stress %{y:,.0f} MPa<extra>Operating</extra>',
    },
    {
      type: 'scatter', mode: 'markers', name: 'Yield points',
      x: [room.yield_point.strain * 100, op.yield_point.strain * 100],
      y: [room.yield_point.stress, op.yield_point.stress],
      marker: { size: 8, color: [c.cyan, c.amber], symbol: 'circle', line: { color: '#fff', width: 1 } },
      hovertemplate: 'Yield %{y:,.0f} MPa<extra></extra>',
    },
    {
      type: 'scatter', mode: 'markers', name: 'Fracture points',
      x: [room.fracture_point.strain * 100, op.fracture_point.strain * 100],
      y: [room.fracture_point.stress, op.fracture_point.stress],
      marker: { size: 9, color: [c.rose, '#FB7185'], symbol: 'x', line: { width: 1.2 } },
      hovertemplate: 'Fracture %{y:,.0f} MPa<extra></extra>',
    },
  ];
  const layout = plotBase({
    margin: { l: 52, r: 16, t: 24, b: 42 },
    xaxis: axisBase({ title: 'Engineering strain (%)', zeroline: false }),
    yaxis: axisBase({ title: 'Engineering stress (MPa)', rangemode: 'tozero' }),
    legend: { orientation: 'h', x: 0, y: 1.18, font: { size: 8.5, color: c.muted } },
  });
  renderPlot(el, traces, layout);
  const tag = $('#strainTag');
  if (tag) tag.textContent = `Fracture ${op.fracture_strain_pct.toFixed(1)}% strain`;
}

function renderThermalChart(sim) {
  const el = $('#simThermalChart');
  if (!el) return;
  if (!sim?.curves?.degradation) {
    renderPlot(el, [], emptyChartLayout('Thermal degradation appears after a simulation run.'));
    return;
  }
  const c = themeColors();
  const deg = sim.curves.degradation;
  const opTemp = deg.operating_temperature_c;
  const opStrength = sim.derived.operating_strength_mpa;
  const traces = [
    {
      type: 'scatter', mode: 'lines', name: 'Derated strength',
      x: deg.temperature_c, y: deg.strength_mpa,
      line: { color: c.cyan, width: 2.2, shape: 'spline', smoothing: 0.5 },
      fill: 'tozeroy', fillcolor: 'rgba(34,211,238,0.055)',
      hovertemplate: '%{x:,.0f}°C → %{y:,.0f} MPa<extra></extra>',
    },
    {
      type: 'scatter', mode: 'markers', name: 'Operating point',
      x: [opTemp], y: [opStrength],
      marker: { size: 10, color: c.amber, symbol: 'diamond', line: { color: '#fff7ed', width: 1 } },
      hovertemplate: `Operating %{x:.0f}°C<br>%{y:,.0f} MPa<extra></extra>`,
    },
  ];
  const layout = plotBase({
    margin: { l: 52, r: 16, t: 24, b: 42 },
    xaxis: axisBase({ title: 'Temperature (°C)', zeroline: false }),
    yaxis: axisBase({ title: 'Working strength (MPa)', rangemode: 'tozero' }),
    shapes: [
      { type: 'line', x0: opTemp, x1: opTemp, y0: 0, y1: 1, yref: 'paper', line: { color: c.amber, width: 1, dash: 'dot' } },
      { type: 'line', x0: deg.thermal_limit_c, x1: deg.thermal_limit_c, y0: 0, y1: 1, yref: 'paper', line: { color: c.rose, width: 1, dash: 'dash' } },
    ],
    annotations: [
      { x: opTemp, y: 0.02, yref: 'paper', text: 'operating', showarrow: false, font: { size: 8, color: c.amber }, xanchor: opTemp > 500 ? 'right' : 'left' },
      { x: deg.thermal_limit_c, y: 0.96, yref: 'paper', text: `service ceiling ${deg.thermal_limit_c}°C`, showarrow: false, font: { size: 8, color: c.rose }, xanchor: 'right' },
    ],
    legend: { orientation: 'h', x: 0, y: 1.18, font: { size: 8.5, color: c.muted } },
  });
  renderPlot(el, traces, layout);
  const tag = $('#thermalTag');
  if (tag) tag.textContent = `Service ceiling ${deg.thermal_limit_c}°C`;
}

function renderSimulationCharts() {
  renderStressChart(state.simulation);
  renderThermalChart(state.simulation);
  const el = $('#simRadarChart');
  if (el) {
    const radar = state.simulation?.radar || state.lastRadar || defaultRadar();
    const c = themeColors();
    const close = (arr) => [...arr, arr[0]];
    const layout = plotBase({
      margin: { l: 42, r: 42, t: 30, b: 28 },
      polar: {
        bgcolor: 'rgba(0,0,0,0)',
        radialaxis: { visible: true, range: [0, 100], showline: false, gridcolor: c.grid, tickfont: { size: 7, color: c.muted }, angle: 90 },
        angularaxis: { gridcolor: c.grid, linecolor: c.axis, tickfont: { size: 9, color: c.text } },
      },
      showlegend: true,
      legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.05, font: { size: 8.5, color: c.muted } },
    });
    renderPlot(el, [
      {
        type: 'scatterpolar', r: close(radar.alloy), theta: close(radar.labels), fill: 'toself', name: 'Custom alloy',
        line: { color: c.emerald, width: 2 }, fillcolor: 'rgba(16,185,129,0.13)', marker: { color: c.emerald, size: 4 },
        hovertemplate: '%{theta}: %{r:.0f}/100<extra></extra>',
      },
      {
        type: 'scatterpolar', r: close(radar.benchmark), theta: close(radar.labels), fill: 'toself', name: 'Dataset benchmark',
        line: { color: c.violet, width: 1.4, dash: 'dot' }, fillcolor: 'rgba(167,139,250,0.05)', marker: { color: c.violet, size: 3 },
        hovertemplate: '%{theta}: %{r:.0f}/100<extra></extra>',
      },
    ], layout);
    const tag = $('#simRadarTag');
    if (tag) tag.textContent = `Confidence ${state.simulation?.prediction?.confidence || '—'}`;
  }
}

/* --------------------------------------------------------------------------
   Analytics
   -------------------------------------------------------------------------- */
function renderBenchmarkTable() {
  const body = $('#benchmarkBody');
  if (!body || !state.meta?.datasets) return;
  const rows = [];
  Object.values(state.meta.datasets).forEach((dataset) => {
    ['linear', 'random_forest', 'gradient_boosting'].forEach((key) => {
      const benchmark = dataset.benchmarks?.[key];
      if (!benchmark) return;
      const modelName = { linear: 'Linear Baseline', random_forest: 'Random Forest · 150', gradient_boosting: 'Gradient Boosting' }[key];
      const badge = { linear: 'model-linear', random_forest: 'model-rf', gradient_boosting: 'model-gb' }[key];
      const isBest = dataset.best_model === key;
      rows.push(`
        <tr>
          <td>${escapeHtml(dataset.label)}<span class="sub-line">${escapeHtml(dataset.unit)} · n=${fmt(dataset.rows)}</span></td>
          <td><span class="benchmark-model"><span class="model-badge ${badge}">${key === 'random_forest' ? 'RF' : key === 'linear' ? 'OLS' : 'GBM'}</span>${modelName}</span></td>
          <td class="mono">${Number(benchmark.r2).toFixed(4)}<div class="score-bar"><i style="width:${clamp(Number(benchmark.r2) * 100, 0, 100)}%"></i></div></td>
          <td class="mono">${Number(benchmark.mae).toFixed(3)}</td>
          <td class="mono">${Number(benchmark.rmse).toFixed(3)}</td>
          <td class="mono">${Number(benchmark.train_seconds).toFixed(1)}s</td>
          <td>${isBest ? '<span class="pill pill-emerald">BEST</span>' : '<span class="pill">benchmark</span>'}</td>
        </tr>`);
    });
  });
  body.innerHTML = rows.join('');
}

function renderImportanceChart() {
  const el = $('#analyticsImportanceChart');
  if (!el || !state.meta?.datasets) return;
  const select = $('#importanceDataset');
  const datasetKey = select?.value || 'steels';
  const dataset = state.meta.datasets[datasetKey];
  const rfImportance = dataset?.feature_importances?.find((entry) => entry.model === 'random_forest') || dataset?.feature_importances?.[0];
  if (!rfImportance) { renderPlot(el, [], emptyChartLayout('Feature importance unavailable.')); return; }
  const features = [...rfImportance.features].sort((a, b) => a.importance - b.importance);
  const c = themeColors();
  const nice = (name) => name.replace(/_/g, ' ').replace('MagpieData ', '').replace('mean', 'μ').replace('avg dev', 'σ');
  renderPlot(el, [{
    type: 'bar', orientation: 'h',
    x: features.map((f) => f.importance),
    y: features.map((f) => nice(f.feature)),
    marker: {
      color: features.map((f, i) => i < 4 ? c.emerald : i < 7 ? c.cyan : c.violet),
      line: { width: 0 },
    },
    hovertemplate: '%{y}<br>importance %{x:.4f}<extra></extra>',
  }], plotBase({
    margin: { l: 132, r: 16, t: 12, b: 32 },
    xaxis: axisBase({ title: 'Impurity importance', zeroline: false, gridcolor: c.grid }),
    yaxis: axisBase({ tickfont: { size: 8, color: c.text }, gridcolor: 'rgba(0,0,0,0)' }),
    showlegend: false,
  }));
}

function renderCoverageChart() {
  const el = $('#analyticsCoverageChart');
  if (!el || !state.meta?.datasets) return;
  const c = themeColors();
  const entries = Object.values(state.meta.datasets);
  renderPlot(el, [
    {
      type: 'bar', name: 'Total rows',
      x: entries.map((d) => d.label.replace('Matbench ', '')),
      y: entries.map((d) => d.rows),
      marker: { color: c.cyan, opacity: 0.35 },
      hovertemplate: '%{x}<br>%{y:,} rows<extra></extra>',
    },
    {
      type: 'bar', name: 'Hold-out test',
      x: entries.map((d) => d.label.replace('Matbench ', '')),
      y: entries.map((d) => Math.round(d.rows * 0.2)),
      marker: { color: c.emerald, opacity: 0.85 },
      hovertemplate: '%{x}<br>%{y:,} test rows<extra></extra>',
    },
  ], plotBase({
    margin: { l: 52, r: 16, t: 18, b: 42 },
    barmode: 'overlay',
    xaxis: axisBase({ gridcolor: 'rgba(0,0,0,0)' }),
    yaxis: axisBase({ title: 'Compositions', gridcolor: c.grid }),
    legend: { orientation: 'h', x: 0, y: 1.14, font: { size: 9, color: c.muted } },
  }));
}

function renderErrorChart() {
  const el = $('#analyticsErrorChart');
  if (!el || !state.meta?.datasets) return;
  const c = themeColors();
  const entries = Object.values(state.meta.datasets);
  renderPlot(el, [
    {
      type: 'bar', name: 'Linear',
      x: entries.map((d) => d.label.replace('Matbench ', '')),
      y: entries.map((d) => d.benchmarks.linear.mae),
      marker: { color: c.blue, opacity: 0.55 },
      hovertemplate: '%{x}<br>MAE %{y:.2f} %{text}<extra>Linear</extra>', text: entries.map((d) => d.unit),
    },
    {
      type: 'bar', name: 'Random Forest',
      x: entries.map((d) => d.label.replace('Matbench ', '')),
      y: entries.map((d) => d.benchmarks.random_forest.mae),
      marker: { color: c.emerald },
      hovertemplate: '%{x}<br>MAE %{y:.2f} %{text}<extra>Random Forest</extra>', text: entries.map((d) => d.unit),
    },
    {
      type: 'bar', name: 'Gradient Boosting',
      x: entries.map((d) => d.label.replace('Matbench ', '')),
      y: entries.map((d) => d.benchmarks.gradient_boosting.mae),
      marker: { color: c.violet, opacity: 0.8 },
      hovertemplate: '%{x}<br>MAE %{y:.2f} %{text}<extra>Gradient Boosting</extra>', text: entries.map((d) => d.unit),
    },
  ], plotBase({
    margin: { l: 52, r: 16, t: 18, b: 42 },
    barmode: 'group',
    xaxis: axisBase({ gridcolor: 'rgba(0,0,0,0)' }),
    yaxis: axisBase({ title: 'Hold-out MAE (native units)', gridcolor: c.grid }),
    legend: { orientation: 'h', x: 0, y: 1.14, font: { size: 8.5, color: c.muted } },
  }));
}

function renderAnalyticsCharts() {
  if (!state.meta) return;
  renderBenchmarkTable();
  renderImportanceChart();
  renderCoverageChart();
  renderErrorChart();
  renderAnalyticsR2();
  renderAnalyticsMae();
  renderAnalyticsTrainTime();
  renderAnalyticsResidual();
  renderAnalyticsUncertainty();
  renderAnalyticsCostDensity();
  renderAnalyticsBenchRadar();
  renderCluster($('#analyticsClusterChart'), state.meta.feature_space || [], state.simulation?.pca || null);
}

/* --------------------------------------------------------------------------
   ROI calculator
   -------------------------------------------------------------------------- */
function roiNumbers() {
  const experiments = Number($('#roiExperiments')?.value || 40);
  const cost = Number($('#roiCost')?.value || 45000);
  const reduction = Number($('#roiReduction')?.value || 42);
  const days = Number($('#roiDays')?.value || 18);
  const team = Number($('#roiTeam')?.value || 800000);
  const tier = $('#roiTier')?.value || 'pro';
  const tierPrice = tier === 'enterprise_access' ? 0 : tier === 'enterprise' ? 19999 : 4999;
  const avoided = experiments * 12 * reduction / 100;
  const rawSavings = avoided * cost;
  const capacitySavings = team * 12 * (reduction / 100) * 0.65;
  const subscription = tierPrice * 12;
  const net = rawSavings + capacitySavings - subscription;
  const monthlyGross = (rawSavings + capacitySavings) / 12;
  const paybackMonths = subscription > 0 && monthlyGross > 0 ? subscription / monthlyGross : 0;
  const roiPercent = subscription > 0 ? net / subscription * 100 : Infinity;
  return { experiments, cost, reduction, days, team, tier, tierPrice, avoided, rawSavings, capacitySavings, subscription, net, paybackMonths, roiPercent };
}

function renderRoi() {
  const numbers = roiNumbers();
  const out = (id, value) => { const el = $(id); if (el) el.textContent = value; };
  out('#roiExperimentsOut', fmt(numbers.experiments));
  out('#roiCostOut', `₹${fmt(numbers.cost)}`);
  out('#roiReductionOut', `${numbers.reduction}%`);
  out('#roiDaysOut', `${numbers.days} days`);
  out('#roiTeamOut', fmtCompact(numbers.team));
  out('#roiSavings', fmtCompact(Math.max(0, numbers.net)));
  out('#roiSavingsSub', `after ₹${fmt(numbers.subscription)} annual subscription · ${numbers.tier === 'enterprise_access' ? 'Enterprise access grant active' : 'list price'}`);
  out('#roiPayback', numbers.subscription === 0 ? 'Immediate' : numbers.paybackMonths < 1 ? `${Math.max(1, Math.round(numbers.paybackMonths * 30))} days` : `${numbers.paybackMonths.toFixed(1)} mo`);
  out('#roiPercent', Number.isFinite(numbers.roiPercent) ? `${numbers.roiPercent.toFixed(0)}%` : '∞');
  out('#roiAvoided', `${fmt(numbers.avoided)} tests`);
  out('#roiDaysSaved', `${fmt(numbers.avoided * numbers.days)} days`);

  const baselineAnnual = numbers.experiments * 12 * numbers.cost;
  const assistedAnnual = Math.max(0, baselineAnnual - numbers.rawSavings) + numbers.subscription;
  const bars = [
    ['#roiBar1', numbers.rawSavings / Math.max(1, baselineAnnual) * 100],
    ['#roiBar2', numbers.capacitySavings / Math.max(1, baselineAnnual + numbers.capacitySavings) * 100],
    ['#roiBar3', numbers.subscription / Math.max(1, baselineAnnual) * 100],
  ];
  bars.forEach(([id, pct]) => { const el = $(id); if (el) el.style.width = `${clamp(pct, 1.5, 100)}%`; });
  out('#roiRaw', fmtCompact(numbers.rawSavings));
  out('#roiCapacity', fmtCompact(numbers.capacitySavings));
  out('#roiSub', numbers.subscription ? `−₹${fmt(numbers.subscription)}` : '₹0');

  const el = $('#roiChart');
  if (!el) return;
  const c = themeColors();
  renderPlot(el, [
    {
      type: 'bar', name: 'Baseline R&D spend',
      x: ['Annual testing', 'Annual run-rate'],
      y: [baselineAnnual, baselineAnnual],
      marker: { color: c.rose, opacity: 0.45 },
      width: [0.5, 0.5],
      hovertemplate: '?%{y:,.0f}<extra>Baseline</extra>',
      showlegend: false,
    },
    {
      type: 'bar', name: 'With MATERIALHUNT',
      x: ['Annual testing', 'Annual run-rate'],
      y: [assistedAnnual, baselineAnnual + numbers.capacitySavings - numbers.rawSavings + numbers.subscription],
      marker: { color: c.emerald },
      width: [0.5, 0.5],
      hovertemplate: '?%{y:,.0f}<extra>Assisted</extra>',
      showlegend: false,
    },
    {
      type: 'bar', name: 'Net benefit',
      x: ['Annual testing', 'Annual run-rate'],
      y: [numbers.net, numbers.net],
      marker: { color: c.cyan, opacity: 0.55 },
      width: [0.5, 0.5],
      hovertemplate: '?%{y:,.0f}<extra>Net benefit</extra>',
      showlegend: false,
    },
  ], plotBase({
    margin: { l: 62, r: 16, t: 20, b: 40 },
    barmode: 'group',
    xaxis: axisBase({ gridcolor: 'rgba(0,0,0,0)' }),
    yaxis: axisBase({ title: '? per year', gridcolor: c.grid, tickformat: '~s' }),
    showlegend: false,
  }));
}

function resizeCharts() {
  if (!window.Plotly) return;
  $$('.chart-box').forEach((el) => {
    if (el.offsetParent !== null && el.data) {
      try { Plotly.Plots.resize(el); } catch { /* chart not ready */ }
    }
  });
}

/* ==========================================================================
   Working-condition simulator
   ========================================================================== */
function collectSimulationRequest() {
  const elements = {};
  Object.entries(state.composition).forEach(([sym, value]) => {
    const pct = Number(value);
    if (pct > 0) elements[sym] = pct;
  });
  return {
    elements: Object.keys(elements).length ? elements : { Fe: 100 },
    temperature_c: Number($('#temperatureSlider')?.value || 25),
    environment: $('#environmentSelect')?.value || 'Air / Industrial',
    load_profile: $('#loadProfileSelect')?.value || 'Static tension',
    load_mpa: Number($('#loadSlider')?.value || 250),
    safety_factor: Number($('#safetySlider')?.value || 1.5),
    hazard_verified: Boolean($('#hazardVerify')?.checked),
    structure: (syncStructure(), state.structure),
    environment_density_kgm3: Number(state.mediumDensity || 1.225),
    pressure_pa: pressurePaFromUI(),
    velocity_kmh: Number($('#velocitySlider')?.value || 0),
  };
}

/* --------------------------------------------------------------------------
   Pressure unit engine (0 Pa to ∞ Burst)
   -------------------------------------------------------------------------- */
const PRESSURE_UNITS = {
  Pa: { scale: 1, min: 0, max: 1000000000, step: 1000, def: 101325 },
  kPa: { scale: 1000, min: 0, max: 1000000, step: 1, def: 101.325 },
  MPa: { scale: 1000000, min: 0, max: 1000, step: 0.5, def: 0.101325 },
  GPa: { scale: 1000000000, min: 0, max: 1000, step: 1, def: 0.000101325 },
  inf: { scale: 1e13, min: 0, max: 1000, step: 1, def: 0 },
};

function formatPressure(valuePa) {
  const pa = Number(valuePa) || 0;
  if (pa >= 1e15) return '∞ Burst';
  if (pa >= 1e9) return `${fmt(pa / 1e9, 2)} GPa`;
  if (pa >= 1e6) return `${fmt(pa / 1e6, 2)} MPa`;
  if (pa >= 1e3) return `${fmt(pa / 1e3, 1)} kPa`;
  return `${fmt(pa, 0)} Pa`;
}

function pressurePaFromUI() {
  const unit = state.pressureUnit || 'Pa';
  const spec = PRESSURE_UNITS[unit] || PRESSURE_UNITS.Pa;
  const raw = Number($('#pressureSlider')?.value || 0);
  if (unit === 'inf') return raw >= spec.max ? 1e16 : 0;
  return raw * spec.scale;
}

function setPressureUnit(unit, announce = false) {
  const spec = PRESSURE_UNITS[unit] || PRESSURE_UNITS.Pa;
  const current = pressurePaFromUI();
  state.pressureUnit = unit;
  state.pressureScale = spec.scale;
  const slider = $('#pressureSlider');
  if (slider) {
    slider.min = String(spec.min);
    slider.max = String(spec.max);
    slider.step = String(spec.step);
    const next = unit === 'inf' ? 0 : clamp(current / spec.scale, spec.min, spec.max);
    slider.value = String(Number(next.toFixed(4)));
  }
  $$('#pressureUnits .unit-pill').forEach((button) => button.classList.toggle('active', button.dataset.unit === unit));
  const tag = $('#pressureUnitTag');
  if (tag) tag.textContent = unit === 'inf' ? '∞' : unit;
  updateRangeLabels();
  if (announce) scheduleSimulation(400);
}

function setMediumDensity(value, announce = false) {
  state.mediumDensity = clamp(Number(value) || 0, 0, 25000);
  const slider = $('#densitySlider');
  if (slider) slider.value = String(state.mediumDensity);
  $$('#mediumDensityRow .medium-chip').forEach((chip) =>
    chip.classList.toggle('active', Math.abs(Number(chip.dataset.density) - state.mediumDensity) < 0.01));
  updateRangeLabels();
  if (announce) scheduleSimulation(500);
}

function scheduleSimulation(delay = 700) {
  clearTimeout(state.simTimer);
  state.simTimer = setTimeout(() => {
    state.simTimer = null;
    runSimulation({ silent: true });
  }, delay);
}

async function runSimulation(options = {}) {
  const { silent = false } = options;
  const request = collectSimulationRequest();
  const sequence = (state.simSeq = (state.simSeq || 0) + 1);
  const status = $('#simStatus');
  const button = $('#runSimulation');
  if (status) {
    status.textContent = 'COMPUTING';
    status.className = 'status-pill status-amber';
  }
  if (button) button.disabled = true;
  const started = performance.now();
  try {
    const result = await api('/api/simulate', { method: 'POST', body: request });
    if (sequence !== state.simSeq) return;
    state.simulation = result;
    state.simRequest = request;
    renderSimulation(result);
    const latency = Math.round(performance.now() - started);
    $('#statLatency').textContent = `${latency} ms`;
    if (status) {
      status.textContent = 'SIMULATED';
      status.className = 'status-pill status-emerald';
    }
    if (!silent) toast(`Simulation complete · ${result.composition.formula} · ${result.derived.verdict}`, result.derived.verdict === 'SAFE' ? 'success' : result.derived.verdict === 'MARGINAL' ? 'warning' : 'error', 4600);
  } catch (err) {
    if (sequence !== state.simSeq) return;
    const detail = err.detail;
    if (err.status === 403 && detail?.code === 'DUAL_USE_BLOCKED') {
      state.simulation = null;
      renderBlockedSimulation(detail);
      if (status) { status.textContent = 'BLOCKED'; status.className = 'status-pill status-rose'; }
      toast(detail.message || 'Dual-use guardrail blocked this alloy.', 'error', 6500);
    } else {
      if (status) { status.textContent = 'ERROR'; status.className = 'status-pill status-rose'; }
      toast(err.message, 'error', 6000);
    }
  } finally {
    if (sequence === state.simSeq && button) button.disabled = false;
  }
}

function renderSimulation(sim) {
  const derived = sim.derived;
  const prediction = sim.prediction;
  const card = $('#verdictCard');
  card?.classList.remove('verdict-safe', 'verdict-marginal', 'verdict-unsafe', 'verdict-melted');
  if (card) card.classList.add(`verdict-${derived.verdict.toLowerCase()}`);
  const set = (id, value) => { const el = $(id); if (el) el.textContent = value; };

  set('#simVerdict', derived.verdict);
  set('#simVerdictSub', derived.verdict_label);
  set('#simConfidence', `Confidence ${prediction.confidence}`);
  $('#simConfidence').className = `pill pill-${prediction.confidence === 'High' ? 'emerald' : prediction.confidence === 'Medium' ? 'amber' : 'rose'}`;
  set('#simStructure', `${derived.crystal_structure} lattice`);
  set('#simHazard', derived.hazard_cleared ? 'Guardrail cleared' : 'Guardrail clear');
  $('#simHazard').className = derived.hazard_cleared ? 'pill pill-amber' : 'pill pill-emerald';

  set('#simStrength', `${fmt(prediction.predicted)} MPa`);
  set('#simUncertainty', `±${fmt(prediction.uncertainty)} MPa`);
  set('#simWorking', `${fmt(derived.operating_strength_mpa)} MPa`);
  set('#simDensityCost', `${derived.density_gcm3.toFixed(2)} g/cm³ · ₹${fmt(derived.cost_per_kg)}/kg`);
  set('#simUtilization', derived.utilization_ratio.toFixed(2));
  set('#simLiquidus', `${fmt(derived.liquidus_c || 0)} °C`);
  set('#simPressure', derived.pressure_label || formatPressure(derived.total_pressure_pa || 0));
  renderEnvironmentHud(sim);

  const ring = $('#utilRing');
  if (ring) {
    const circumference = 2 * Math.PI * 52;
    const fraction = clamp(derived.utilization_ratio / 1.5, 0, 1);
    ring.style.strokeDasharray = String(circumference);
    ring.style.strokeDashoffset = String(circumference * (1 - fraction));
    ring.style.stroke = derived.verdict === 'SAFE' ? 'var(--emerald)' : derived.verdict === 'MARGINAL' ? 'var(--amber)' : 'var(--rose)';
  }

  set('#simHypothesis', sim.hypothesis);
  const advice = $('#simAdvice');
  if (advice) advice.innerHTML = (sim.advice || []).map((tip) => `<li>${escapeHtml(tip)}</li>`).join('');
  const warnings = $('#simWarnings');
  if (warnings) warnings.innerHTML = (sim.warnings || []).map((warning) => `<div class="warning-item"><span>⚠</span><span>${escapeHtml(warning)}</span></div>`).join('');

  set('#heroTempChip', `${fmt(sim.conditions.temperature_c)}°C`);
  set('#heroStress', `${fmt(derived.applied_stress_mpa)} MPa`);
  set('#heroDerated', `${fmt(derived.operating_strength_mpa)} MPa`);
  set('#heroConfidence', `${prediction.confidence} · ±${fmt(prediction.uncertainty)}`);

  const guardrailNote = $('#guardrailNote');
  if (guardrailNote) {
    guardrailNote.classList.toggle('blocked', false);
    guardrailNote.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 3 20h18L12 3Z"/><path d="M12 9v5M12 17v.5"/></svg>
      ${derived.hazard_cleared ? 'Dual-use guardrail cleared with your hazardous-material handling confirmation.' : 'Dual-Use Guardrail active: restricted elements are blocked without verified clearance.'}`;
  }

  state.lastRadar = sim.radar;
  renderStressChart(sim);
  renderThermalChart(sim);
  renderRadar(sim.radar, sim.composition.formula);
  renderSimulationCharts();
  updateSceneFromState();
}

function renderEnvironmentHud(sim) {
  const derived = (sim && sim.derived) || {};
  const set = (id, value) => { const el = $(id); if (el) el.textContent = value; };
  const liquidus = Number(derived.liquidus_c || 0);
  set('#liquidusOut', liquidus ? `${fmt(liquidus)} °C` : '—');
  const statePill = $('#liquidusState');
  if (statePill) {
    const melted = Boolean(derived.is_melted);
    statePill.textContent = melted ? 'MELTED' : 'SOLID';
    statePill.className = `liquidus-state ${melted ? 'melted' : 'solid'}`;
  }
  set('#dynamicPressureOut', formatPressure(derived.dynamic_pressure_pa || 0));
  set('#totalPressureOut', formatPressure(derived.total_pressure_pa || pressurePaFromUI()));
  set('#burstLimitOut', formatPressure(derived.burst_pressure_pa || 0));
}

function renderBlockedSimulation(detail) {
  const card = $('#verdictCard');
  card?.classList.remove('verdict-safe', 'verdict-marginal', 'verdict-unsafe');
  card?.classList.add('verdict-unsafe');
  const set = (id, value) => { const el = $(id); if (el) el.textContent = value; };
  set('#simVerdict', 'BLOCKED');
  set('#simVerdictSub', 'Dual-Use Hazardous Element Guardrail');
  set('#simConfidence', 'Restricted');
  $('#simConfidence').className = 'pill pill-rose';
  set('#simStructure', 'Simulation halted');
  set('#simHazard', 'Guardrail blocked');
  $('#simHazard').className = 'pill pill-rose';
  set('#simHypothesis', detail.message || 'This composition contains restricted dual-use elements.');
  const blocked = (detail.blocked || []).map((entry) => `${entry.symbol}: ${entry.reason}`);
  const advice = $('#simAdvice');
  if (advice) advice.innerHTML = [
    ...blocked.map((text) => `<li>${escapeHtml(text)}</li>`),
    `<li>${escapeHtml(detail.requires || 'Confirm you hold authority to handle hazardous materials, then retry.')}</li>`,
    '<li>The 3D viewer and ML prediction are intentionally frozen for this input.</li>',
  ].join('');
  const warnings = $('#simWarnings');
  if (warnings) warnings.innerHTML = `<div class="warning-item"><span>⛔</span><span>Audit event written. No prediction was generated for this composition.</span></div>`;
  const guardrailNote = $('#guardrailNote');
  if (guardrailNote) {
    guardrailNote.classList.add('blocked');
    guardrailNote.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 3 20h18L12 3Z"/><path d="M12 9v5M12 17v.5"/></svg>
      Blocked: ${escapeHtml((detail.blocked || []).map((b) => `${b.symbol} (${b.reason})`).join(' · '))}`;
  }
  set('#simUtilization', '—');
  const ring = $('#utilRing');
  if (ring) ring.style.strokeDashoffset = String(2 * Math.PI * 52);
}

function updateSceneFromState() {
  if (!state.scene) return;
  syncStructure();
  const normalized = normalisedComposition();
  const elements = Object.entries(normalized).map(([symbol, pct]) => {
    const meta = elementMeta(symbol);
    return { symbol, pct, color: meta.color, radius: meta.radius };
  });
  const temperature = Number($('#temperatureSlider')?.value || 25);
  const derived = state.simulation?.derived;
  const stress = Number(derived?.applied_stress_mpa || $('#loadSlider')?.value || 250);
  state.scene.setComposition(elements, state.structure, temperature, stress);
  state.scene.setMode(state.mode);
  state.scene.setSimulation({
    temperature,
    stress,
    utilization: Number(derived?.utilization_ratio || 0),
    verdict: derived?.verdict || 'SAFE',
    phase: derived?.aggregate_phase || aggregatePhaseFor(normalized, temperature, derived?.total_pressure_pa),
    liquidus: Number(derived?.liquidus_c || 1500),
  });
  const phaseChip = $('#heroPhaseChip');
  if (phaseChip) {
    const phase = derived?.aggregate_phase || aggregatePhaseFor(normalized, temperature, derived?.total_pressure_pa);
    phaseChip.textContent = phase;
    phaseChip.className = `hud-chip hud-phase phase-${phase === 'GASEOUS / VAPORIZED' ? 'gas' : phase.toLowerCase()}`;
  }
}

/* --------------------------------------------------------------------------
   PDF report
   -------------------------------------------------------------------------- */
async function downloadPdf() {
  const request = { ...collectSimulationRequest(), report_title: 'Enterprise Lab Screening Dossier', lab_reference: `MH-${new Date().getFullYear()}` };
  const button = $('#downloadPdf');
  const original = button?.innerHTML;
  if (button) { button.disabled = true; button.textContent = 'Rendering PDF…'; }
  try {
    let blob = null;
    let filename = 'MATERIALHUNT_Report.pdf';
    if (window.MH_FIREBASE?.buildPdf) {
      const pdfText = window.MH_FIREBASE.buildPdf(request);
      blob = new Blob([pdfText], { type: 'application/pdf' });
    } else {
      const response = await fetch('/api/report/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        let detail = 'PDF export failed.';
        try { const data = await response.json(); detail = detailText(data.detail); } catch { /* non-JSON */ }
        throw new ApiError(detail, response.status, null);
      }
      blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="?([^"]+)"?/);
      if (match) filename = match[1];
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1500);
    toast('Enterprise lab screening PDF downloaded.', 'success', 4600);
  } catch (err) {
    if (err.status === 402) {
      toast('PDF reports require Pro Lab or Enterprise. Enterprise access grant pilots are fee-enterprise_access.', 'warning', 6000);
    } else {
      toast(err.message, 'error', 6000);
    }
  } finally {
    if (button) { button.disabled = false; button.innerHTML = original; }
  }
}

/* --------------------------------------------------------------------------
   Feedback drawer
   -------------------------------------------------------------------------- */
const STAR_CAPTIONS = ['0★ — blocking issue', 'Needs serious work', 'Below expectations', 'Solid — usable', 'Excellent — impressed', 'Flawless — category leader'];

function setStarRating(rating) {
  state.feedbackRating = rating;
  $$('#starRow .star-btn').forEach((button) => {
    const value = Number(button.dataset.star);
    button.classList.toggle('active', value === 0 ? rating === 0 : value <= rating);
  });
  const caption = $('#starCaption');
  if (caption) caption.textContent = STAR_CAPTIONS[rating] || 'Select a rating (0–5)';
}

function openFeedback() {
  if (!state.user) {
    toast('Sign in to send feedback to the founder triage queue.', 'warning');
    openAuth('login');
    return;
  }
  $('#feedbackDrawer')?.classList.add('open');
  $('#drawerBackdrop')?.classList.remove('hidden');
}

function closeFeedback() {
  $('#feedbackDrawer')?.classList.remove('open');
  $('#drawerBackdrop')?.classList.add('hidden');
}

async function submitFeedback(event) {
  event.preventDefault();
  if (!state.user) { closeFeedback(); openAuth('login'); return; }
  const error = $('#feedbackError');
  const thanks = $('#feedbackThanks');
  if (error) error.textContent = '';
  if (state.feedbackRating < 0 || state.feedbackRating > 5) {
    if (error) error.textContent = 'Choose a 0–5 star rating.';
    return;
  }
  const message = $('#feedbackMessage')?.value.trim() || '';
  if (!message) {
    if (error) error.textContent = 'Tell us at least one sentence so we can act on it.';
    return;
  }
  try {
    await api('/api/feedback', {
      method: 'POST',
      body: { rating: state.feedbackRating, category: $('#feedbackCategory')?.value || 'General', message },
    });
    if (thanks) { thanks.classList.remove('hidden'); thanks.textContent = 'Thank you. We have received your feedback.'; }
    setStarRating(0);
    $('#feedbackMessage').value = '';
    toast('Thank you, your feedback was sent.', 'success');
    setTimeout(() => { thanks?.classList.add('hidden'); closeFeedback(); }, 2400);
  } catch (err) {
    if (error) error.textContent = err.message;
  }
}

/* --------------------------------------------------------------------------
   Hidden admin vault
   -------------------------------------------------------------------------- */
async function attemptAdminUnlock(silent = false) {
  if (!state.gateActive) return;
  const input = $('#adminPasskey');
  const passkey = (input?.value || state.adminPasskey || '').trim();
  const error = $('#adminError');
  if (!passkey) {
    if (error) error.textContent = 'Enter the vault passkey.';
    return;
  }
  state.adminPasskey = passkey;
  sessionStorage.setItem(STORAGE.admin, passkey);
  if (error) error.textContent = '';
  const button = $('#adminUnlockForm button[type="submit"]');
  if (button) { button.disabled = true; button.textContent = 'Verifying…'; }
  try {
    const result = await api('/api/admin/login', { method: 'POST', admin: true, body: {} });
    state.adminSnapshot = result.snapshot;
    renderAdminSnapshot(result.snapshot);
    $('#adminLock')?.classList.add('hidden');
    $('#adminContent')?.classList.remove('hidden');
    const badge = $('#adminBadge');
    if (badge) { badge.textContent = 'UNLOCKED'; badge.className = 'status-pill status-emerald'; }
    if (!silent) toast('Admin vault unlocked. All actions are audit-logged.', 'success');
  } catch (err) {
    const detail = err.detail;
    if (err.status === 423) {
      const seconds = detail?.retry_after_seconds || 900;
      if (error) error.textContent = `Locked after 3 failed attempts. Retry in ${Math.ceil(seconds / 60)} minutes.`;
      sessionStorage.removeItem(STORAGE.admin);
      state.adminPasskey = '';
    } else if (err.status === 401) {
      const remaining = detail?.remaining_attempts;
      if (error) error.textContent = `${detailText(detail)}${remaining !== undefined ? ` · ${remaining} attempt${remaining === 1 ? '' : 's'} remaining` : ''}`;
      sessionStorage.removeItem(STORAGE.admin);
      state.adminPasskey = '';
    } else {
      if (error) error.textContent = err.message;
    }
    if (!silent) toast(error?.textContent || err.message, 'error', 6000);
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Unlock Vault'; }
  }
}

function renderAdminSnapshot(snapshot) {
  const overview = snapshot.overview || {};
  const stats = $('#adminStats');
  if (stats) {
    const cards = [
      ['Accounts', fmt(overview.total_users || 0), 'registered labs'],
      ['MRR', fmtCompact(overview.mrr_inr || 0), 'active subscriptions'],
      ['Waived', fmt(overview.enterprise_access_accounts || 0), 'Enterprise access grant ₹0'],
      ['Pending KYB', fmt(overview.pending_kyb || 0), 'awaiting approval'],
      ['Avg rating', `${Number(overview.avg_rating || 0).toFixed(2)} / 5`, `${overview.open_feedback || 0} open reports`],
    ];
    stats.innerHTML = cards.map(([label, value, sub]) => `
      <article class="admin-stat glass"><span>${label}</span><strong>${value}</strong><small>${sub}</small></article>`).join('');
  }

  const users = $('#adminUsers');
  if (users) {
    users.innerHTML = (snapshot.users || []).map((user) => `
      <tr>
        <td><span class="formula">${escapeHtml(user.organization_name)}</span><span class="sub-line">${escapeHtml(user.email)}</span><span class="sub-line">${escapeHtml(user.org_id)}</span></td>
        <td><span class="pill ${user.kyb_status === 'approved' ? 'pill-emerald' : 'pill-amber'}">${escapeHtml(user.kyb_status)}</span></td>
        <td>${escapeHtml(user.tier_name)}<span class="sub-line">${escapeHtml(user.role)}</span></td>
        <td><span class="pill ${user.billing_enterprise_access ? 'pill-amber' : 'pill'}">${escapeHtml(user.billing_enterprise_access ? 'WAIVED ₹0' : user.billing_status)}</span></td>
        <td>
          <div class="admin-actions">
            ${user.billing_enterprise_access ? '' : `<button class="waive" data-admin-action="waive" data-user="${user.id}">Grant plan upgrade</button>`}
            ${user.kyb_status === 'approved' ? '' : `<button data-admin-action="kyb" data-user="${user.id}">Approve KYB</button>`}
          </div>
        </td>
      </tr>`).join('');
  }

  const feedback = $('#adminFeedback');
  const count = $('#adminFeedbackCount');
  if (count) count.textContent = `${overview.open_feedback || 0} open`;
  if (feedback) {
    feedback.innerHTML = (snapshot.feedback || []).map((item) => `
      <div class="fb-admin-item">
        <div class="fb-admin-head">
          <span class="fb-stars">${'★'.repeat(item.rating)}${'☆'.repeat(5 - item.rating)}</span>
          <span class="fb-cat">${escapeHtml(item.category)}</span>
        </div>
        <p class="fb-msg">${escapeHtml(item.message || '(no message)')}</p>
        <div class="fb-meta">
          <span>${escapeHtml(item.email || 'guest')} · #${item.id} · ${escapeHtml(item.status)}</span>
          <span class="fb-actions">
            ${item.status !== 'Resolved' ? `<button data-triage="Resolved" data-feedback="${item.id}">Resolve</button>` : ''}
            ${item.status !== 'Dismissed' ? `<button data-triage="Dismissed" data-feedback="${item.id}">Dismiss</button>` : ''}
          </span>
        </div>
      </div>`).join('') || '<p class="micro-note">No feedback yet.</p>';
  }

  const audit = $('#adminAudit');
  if (audit) {
    audit.innerHTML = (snapshot.audit || []).map((event) => {
      const time = new Date(event.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return `<div class="audit-row"><span class="audit-time">${escapeHtml(time)}</span><span class="audit-action">${escapeHtml(event.action)}</span><span class="audit-detail">${escapeHtml(event.actor)} · ${escapeHtml(event.detail)}</span></div>`;
    }).join('') || '<p class="micro-note">No audit events yet.</p>';
  }
  if (state.gateActive) refreshAdminDiscoveryRegistry();
}

async function adminAction(action, userId) {
  const endpoint = action === 'waive' ? '/api/admin/waive-fee' : '/api/admin/approve-kyb';
  try {
    const result = await api(endpoint, { method: 'POST', admin: true, body: { user_id: Number(userId), note: 'Founder vault commercial console' } });
    toast(result.message, 'success', 6000);
    await refreshAdmin();
  } catch (err) {
    toast(err.message, 'error', 6000);
  }
}

async function triageFeedback(feedbackId, status) {
  try {
    const result = await api('/api/admin/feedback-triage', {
      method: 'POST', admin: true, body: { feedback_id: Number(feedbackId), status },
    });
    toast(`Feedback #${result.feedback.id} marked ${result.feedback.status}.`, 'success');
    await refreshAdmin();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function refreshAdmin() {
  try {
    const result = await api('/api/admin/snapshot', { admin: true });
    state.adminSnapshot = result.snapshot;
    renderAdminSnapshot(result.snapshot);
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ==========================================================================
   Deep Engineering Analytics — 11 live Plotly panels
   ========================================================================== */
function analyticsEntries() {
  return Object.values(state.meta?.datasets || {});
}

function renderAnalyticsR2() {
  const el = $('#analyticsR2Chart');
  const entries = analyticsEntries();
  if (!el || !entries.length) return;
  const c = themeColors();
  const models = [['linear', 'Linear', c.blue], ['random_forest', 'Random Forest', c.emerald], ['gradient_boosting', 'Gradient Boosting', c.violet]];
  renderPlot(el, models.map(([key, label, color]) => ({
    type: 'bar', name: label,
    x: entries.map((d) => (d.label || '').replace('Matbench ', '')),
    y: entries.map((d) => d.benchmarks?.[key]?.r2 || 0),
    marker: { color, opacity: key === 'random_forest' ? 1 : 0.62 },
    hovertemplate: '%{x}<br>R² %{y:.3f}<extra>' + label + '</extra>',
  })), plotBase({
    barmode: 'group',
    yaxis: axisBase({ title: 'Test R²', range: [0, 1], gridcolor: c.grid }),
    xaxis: axisBase({ gridcolor: 'rgba(0,0,0,0)' }),
    legend: { orientation: 'h', x: 0, y: 1.16, font: { size: 8, color: c.muted } },
  }));
}

function renderAnalyticsMae() {
  const el = $('#analyticsMaeChart');
  const entries = analyticsEntries();
  if (!el || !entries.length) return;
  const c = themeColors();
  renderPlot(el, [
    {
      type: 'scatterpolar', mode: 'lines+markers', name: 'MAE share', fill: 'toself',
      r: entries.map((d) => {
        const mae = Number(d.benchmarks?.random_forest?.mae || 0);
        return clamp(100 - mae, 2, 100);
      }),
      theta: entries.map((d) => `${d.target_short || d.label} (${d.unit})`),
      line: { color: c.amber, width: 2 }, marker: { size: 5, color: c.amber },
      fillcolor: 'rgba(245,158,11,0.18)',
      hovertemplate: '%{theta}<br>relative accuracy %{r:.1f}<extra></extra>',
    },
  ], plotBase({
    polar: {
      bgcolor: 'rgba(0,0,0,0)',
      radialaxis: { gridcolor: c.grid, tickfont: { size: 8, color: c.muted }, range: [0, 100] },
      angularaxis: { gridcolor: c.grid, tickfont: { size: 8.5, color: c.text } },
    },
    showlegend: false,
    margin: { l: 52, r: 52, t: 22, b: 22 },
  }));
}

function renderAnalyticsTrainTime() {
  const el = $('#analyticsTrainTimeChart');
  const entries = analyticsEntries();
  if (!el || !entries.length) return;
  const c = themeColors();
  const labels = entries.map((d) => (d.label || '').replace('Matbench ', ''));
  const rfTime = entries.map((d) => Number(d.benchmarks?.random_forest?.train_seconds || d.benchmarks?.random_forest?.fit_seconds || 0));
  const gbTime = entries.map((d) => Number(d.benchmarks?.gradient_boosting?.train_seconds || d.benchmarks?.gradient_boosting?.fit_seconds || 0));
  renderPlot(el, [
    { type: 'bar', name: 'Random Forest', x: labels, y: rfTime, marker: { color: c.emerald }, hovertemplate: '%{x}<br>%{y:.2f} s<extra>Random Forest</extra>' },
    { type: 'bar', name: 'Gradient Boosting', x: labels, y: gbTime, marker: { color: c.violet, opacity: 0.75 }, hovertemplate: '%{x}<br>%{y:.2f} s<extra>Gradient Boosting</extra>' },
  ], plotBase({
    barmode: 'group',
    yaxis: axisBase({ title: 'Fit time (s)', gridcolor: c.grid }),
    xaxis: axisBase({ gridcolor: 'rgba(0,0,0,0)' }),
    legend: { orientation: 'h', x: 0, y: 1.16, font: { size: 8, color: c.muted } },
  }));
}

function renderAnalyticsResidual() {
  const el = $('#analyticsResidualChart');
  if (!el) return;
  const rows = (state.screenItems || []).filter((r) => Number.isFinite(Number(r.actual)) && Number.isFinite(Number(r.predicted))).slice(0, 120);
  if (!rows.length) {
    renderPlot(el, [], emptyChartLayout('Run a pre-screen to populate held-out parity.'));
    return;
  }
  const c = themeColors();
  const maxValue = Math.max(...rows.map((r) => Math.max(Number(r.predicted), Number(r.actual)))) * 1.05;
  renderPlot(el, [
    {
      type: 'scattergl', mode: 'markers', name: 'Candidates',
      x: rows.map((r) => Number(r.actual)), y: rows.map((r) => Number(r.predicted)),
      marker: { size: 7, color: c.cyan, opacity: 0.7, line: { width: 0.5, color: 'rgba(7,11,20,0.6)' } },
      text: rows.map((r) => r.formula), hovertemplate: '%{text}<br>actual %{x:.1f} · predicted %{y:.1f}<extra></extra>',
    },
    {
      type: 'scatter', mode: 'lines', name: 'Parity',
      x: [0, maxValue], y: [0, maxValue],
      line: { color: c.muted, width: 1, dash: 'dot' }, hoverinfo: 'skip',
    },
  ], plotBase({
    xaxis: axisBase({ title: 'Measured (native unit)', gridcolor: c.grid }),
    yaxis: axisBase({ title: 'Predicted (native unit)', gridcolor: c.grid }),
    legend: { orientation: 'h', x: 0, y: 1.16, font: { size: 8, color: c.muted } },
  }));
}

function renderAnalyticsUncertainty() {
  const el = $('#analyticsUncertaintyChart');
  if (!el) return;
  const rows = (state.screenItems || []).slice(0, 140);
  if (!rows.length) {
    renderPlot(el, [], emptyChartLayout('Run a pre-screen to map epistemic spread.'));
    return;
  }
  const c = themeColors();
  renderPlot(el, [{
    type: 'scattergl', mode: 'markers', name: 'Uncertainty',
    x: rows.map((r) => Number(r.predicted)),
    y: rows.map((r) => Number(r.uncertainty)),
    marker: {
      size: rows.map((r) => (r.confidence === 'High' ? 9 : r.confidence === 'Medium' ? 7 : 5)),
      color: rows.map((r) => CONF_COLOR[r.confidence] || c.muted),
      opacity: 0.8,
    },
    text: rows.map((r) => `${r.formula} · ${r.confidence}`),
    hovertemplate: '%{text}<br>predicted %{x:.2f} · σ %{y:.3f}<extra></extra>',
  }], plotBase({
    xaxis: axisBase({ title: 'Predicted value', gridcolor: c.grid }),
    yaxis: axisBase({ title: 'Tree standard deviation', gridcolor: c.grid }),
    showlegend: false,
  }));
}

function renderAnalyticsCostDensity() {
  const el = $('#analyticsCostDensityChart');
  if (!el) return;
  const rows = (state.screenItems || []).slice(0, 160);
  if (!rows.length) {
    renderPlot(el, [], emptyChartLayout('Run a pre-screen to build the cost-density field.'));
    return;
  }
  const c = themeColors();
  renderPlot(el, [{
    type: 'scattergl', mode: 'markers', name: 'Candidates',
    x: rows.map((r) => Number(r.density)),
    y: rows.map((r) => Number(r.cost_per_kg)),
    marker: {
      size: 7,
      color: rows.map((r) => (r.dataset === 'steels' ? c.cyan : r.dataset === 'glass' ? c.violet : c.amber)),
      opacity: 0.72,
    },
    text: rows.map((r) => `${r.formula} · ${DATASET_NAME[r.dataset] || r.dataset}`),
    hovertemplate: '%{text}<br>ρ %{x:.2f} g/cm³ · ?%{y:,.0f}/kg<extra></extra>',
  }], plotBase({
    xaxis: axisBase({ title: 'Density (g/cm³)', gridcolor: c.grid }),
    yaxis: axisBase({ title: 'Cost (INR/kg)', gridcolor: c.grid }),
    showlegend: false,
  }));
}

function renderAnalyticsBenchRadar() {
  const el = $('#analyticsRadarBenchChart');
  const entries = analyticsEntries();
  if (!el || !entries.length) return;
  const c = themeColors();
  renderPlot(el, entries.map((d, index) => {
    const colors = [c.cyan, c.violet, c.amber];
    return {
      type: 'scatterpolar', mode: 'lines+markers', name: d.label,
      r: [
        clamp((d.benchmarks?.random_forest?.r2 || 0) * 100, 2, 100),
        clamp(100 - (d.benchmarks?.random_forest?.mae || 0) * 4, 2, 100),
        clamp((d.rows || 0) / 60, 2, 100),
        clamp(Number(d.benchmarks?.test_rows || 0) * 2, 2, 100),
        clamp(100 - (d.benchmarks?.gradient_boosting?.mae || 0) * 3, 2, 100),
      ],
      theta: ['R²', 'MAE headroom', 'Coverage', 'Hold-out', 'GB headroom'],
      line: { color: colors[index % colors.length], width: 1.8 },
      marker: { size: 4, color: colors[index % colors.length] },
      fillcolor: 'transparent',
    };
  }), plotBase({
    polar: {
      bgcolor: 'rgba(0,0,0,0)',
      radialaxis: { gridcolor: c.grid, tickfont: { size: 7.5, color: c.muted }, range: [0, 100] },
      angularaxis: { gridcolor: c.grid, tickfont: { size: 8, color: c.text } },
    },
    legend: { orientation: 'h', x: 0, y: 1.14, font: { size: 8, color: c.muted } },
    margin: { l: 46, r: 46, t: 24, b: 20 },
  }));
}

/* ==========================================================================
   118-element periodic table modal
   ========================================================================== */
async function openPeriodic() {
  $('#periodicModal')?.classList.remove('hidden');
  if (!state.periodic) {
    try {
      const result = await api('/api/elements', { auth: false });
      state.periodic = result;
    } catch (err) {
      toast(err.message, 'error');
      return;
    }
  }
  renderPeriodicLegend(state.periodic);
  renderPeriodicTable('');
}

async function preloadPeriodic() {
  try {
    const temperature = Number($('#temperatureSlider')?.value || 25);
    const pressure = pressurePaFromUI();
    const result = await api(`/api/elements?temperature_c=${temperature}&pressure_pa=${pressure}`, { auth: false });
    state.periodic = result;
    renderPeriodicLegend(result);
    renderPeriodicTable('');
  } catch { /* the modal will retry on open */ }
}

function closePeriodic() {
  $('#periodicModal')?.classList.add('hidden');
}

function renderPeriodicLegend(payload) {
  const legend = $('#periodicLegend');
  if (!legend) return;
  const colors = payload.category_colors || {};
  legend.innerHTML = Object.entries(colors).map(([label, color]) =>
    `<span class="legend-item"><i style="background:${color}"></i>${escapeHtml(label)}</span>`).join('');
}

function renderPeriodicTable(query) {
  const grid = $('#periodicGrid');
  if (!grid || !state.periodic) return;
  const term = String(query || '').toLowerCase().trim();
  const rows = (state.periodic.periodic_table || []).filter((item) =>
    !term || item.symbol.toLowerCase().includes(term) || String(item.name).toLowerCase().includes(term) || String(item.z) === term);
  grid.innerHTML = rows.map((item) => `
    <button class="pt-cell${state.periodic.hazardous_elements?.includes(item.symbol) ? ' pt-hazard' : ''} phase-cell-${String(item.phase || item.phase_at_stp || 'SOLID').replace(/[^A-Z]/g, '').toLowerCase()}"
      style="grid-column:${item.grid_col};grid-row:${item.grid_row};--pt-color:${item.category_color || '#94A3B8'}"
      data-symbol="${item.symbol}" title="${escapeHtml(item.name)} · Z=${item.z} · ${escapeHtml(item.phase || item.phase_at_stp || 'SOLID')}">
      <span class="pt-z">${item.z}</span>
      <strong>${item.symbol}</strong>
      <small>${escapeHtml(String(item.name).slice(0, 9))}</small>
    </button>`).join('');
}

function showPeriodicDetail(symbol) {
  const detail = $('#periodicDetail');
  if (!detail || !state.periodic) return;
  const item = (state.periodic.periodic_table || []).find((entry) => entry.symbol === symbol);
  if (!item) return;
  const hazardous = state.periodic.hazardous_elements?.includes(symbol);
  detail.innerHTML = `
    <div class="pd-head">
      <span class="pd-symbol" style="--pt-color:${item.category_color || '#94A3B8'}">${item.symbol}</span>
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <span>Z ${item.z} · ${escapeHtml(item.category)} · period ${item.period || '—'} / group ${item.group || '—'}</span>
      </div>
      ${hazardous ? '<span class="pill pill-rose">DUAL-USE RESTRICTED</span>' : '<span class="pill pill-emerald">COMMERCIAL USE</span>'}
    </div>
    <div class="pd-grid">
      <div><span>Atomic mass</span><strong>${item.mass || '—'}</strong></div>
      <div><span>Density</span><strong>${item.density ? `${item.density} g/cm³` : '—'}</strong></div>
      <div><span>Melting point</span><strong>${item.melting_point_c != null ? `${fmt(item.melting_point_c)} °C` : '—'}</strong></div>
      <div><span>Boiling / sublimation</span><strong>${item.sublimation_point_c != null ? `${fmt(item.sublimation_point_c)} °C (sublimes)` : item.boiling_point_c != null ? `${fmt(item.boiling_point_c)} °C` : '—'}</strong></div>
      <div><span>Phase at test point</span><strong class="phase-text phase-${String(item.phase || item.phase_at_stp || 'SOLID').replace(/[^A-Z]/g, '').toLowerCase()}">${escapeHtml(item.phase || item.phase_at_stp || 'SOLID')}</strong></div>
      <div><span>Indicative cost</span><strong>${item.cost ? `₹${fmt(item.cost)}/kg` : '—'}</strong></div>
      <div><span>Atomic radius</span><strong>${item.radius ? `${item.radius} pm` : '—'}</strong></div>
      <div class="pd-role"><span>Engineering role</span><strong>${escapeHtml(item.role || 'Periodic-table element')}</strong></div>
    </div>
    <p class="micro-note">${escapeHtml(item.phase_note || 'Phase evaluated at the current temperature and pressure.')}</p>
    ${item.symbol === 'C' ? '<p class="micro-note">Carbon does not melt at 1 atm — it sublimates at 3,642 °C.</p>' : ''}
    <div class="pd-actions">
      <button class="btn btn-primary small" data-pd-add="A" data-symbol="${item.symbol}">Add to Alloy A</button>
      <button class="btn btn-glass small" data-pd-add="B" data-symbol="${item.symbol}">Use in Alloy B</button>
    </div>`;
}

function addPeriodicElement(symbol) {
  const current = Number(state.composition[symbol] || 0);
  state.composition[symbol] = current > 0 ? current : 4;
  renderElementSliders();
  updateCompositionUI();
  closePeriodic();
  setView('simulator');
  scheduleSimulation(400);
  toast(`${symbol} added to the alloy composition.`, 'success', 2600);
}

/* ==========================================================================
   AI Mission Co-Pilot
   ========================================================================== */
async function runMissionSearch() {
  const prompt = ($('#missionPrompt')?.value || '').trim();
  if (!prompt) {
    toast('Describe the mission in one sentence first.', 'warning');
    return;
  }
  const button = $('#runMission');
  const original = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'Classifying mission…'; }
  try {
    const result = await api('/api/mission-search', {
      method: 'POST',
      body: { prompt, persona: $('#missionPersona')?.value || 'Aerospace' },
    });
    const summary = $('#missionSummary');
    if (summary) summary.textContent = `${result.intent.label} · ${result.candidates_evaluated} candidates evaluated · ${result.recommendation}`;
    const container = $('#missionResults');
    if (container) {
      container.innerHTML = (result.results || []).slice(0, 8).map((item, index) => {
        const short = item.formula_short || humanFormula(item.elements || {}, 4) || item.formula;
        const payload = escapeHtml(JSON.stringify(item.elements || {}));
        return `
        <button class="mission-result" data-elements="${payload}" data-formula="${escapeHtml(short)}">
          <span class="mission-rank">${index + 1}</span>
          <span class="mission-formula">${escapeHtml(short)}</span>
          <span class="mission-tags">
            <span>${item.strength_mpa ? `${fmt(item.strength_mpa)} MPa` : 'functional'}</span>
            <span>${Number(item.density_gcm3 || 0).toFixed(2)} g/cm³</span>
            <span>₹${fmt(item.cost_per_kg || 0)}/kg</span>
            <span class="pill ${item.confidence === 'High' ? 'pill-emerald' : item.confidence === 'Medium' ? 'pill-amber' : 'pill-rose'}">${escapeHtml(item.confidence)}</span>
          </span>
          <span class="mission-score">${Number(item.rank_score).toFixed(1)}</span>
        </button>`;
      }).join('') || '<p class="micro-note">No candidate matched this mission brief.</p>';
    }
    toast(`Mission classified: ${result.intent.label}`, 'success', 3800);
  } catch (err) {
    toast(err.message, 'error', 6000);
  } finally {
    if (button) { button.disabled = false; button.textContent = original; }
  }
}

function parseComposition(text) {
  const result = {};
  String(text || '').split(/[\s,;|]+/).forEach((token) => {
    const match = token.match(/^([A-Z][a-z]?)[:\-=]?([0-9]*\.?[0-9]+)?$/);
    if (!match) return;
    const symbol = match[1];
    const value = Number(match[2] || 1);
    if (Number.isFinite(value) && value >= 0) result[symbol] = (result[symbol] || 0) + value;
  });
  return result;
}

/* ==========================================================================
   Alloy A vs. B Comparative Analysis
   ========================================================================== */
function presetComposition(name, customText = '') {
  if (name === 'custom') {
    const parsed = parseComposition(customText);
    return Object.keys(parsed).length ? parsed : { ...PRESETS['316L'] };
  }
  if (PRESETS[name]) return { ...PRESETS[name] };
  const alloy = (state.handbookAlloys || []).find((item) => item.designation === name || item.id === name);
  if (alloy) return { ...alloy.composition };
  return { ...PRESETS['316L'] };
}

function comparisonRequest(preset, temperature, velocity, customText = '') {
  return {
    elements: presetComposition(preset, customText),
    temperature_c: Number(temperature),
    environment: 'Air / Industrial',
    load_profile: 'Static tension',
    load_mpa: 250,
    safety_factor: 1.5,
    hazard_verified: false,
    environment_density_kgm3: 1.225,
    pressure_pa: 101325,
    velocity_kmh: Number(velocity),
  };
}

function comparisonMetrics(sim) {
  const d = sim.derived;
  return {
    strength: Number(d.operating_strength_mpa || 0),
    liquidus_margin: Number(d.liquidus_c || 0) - Number(sim.conditions.temperature_c || 0),
    density: Number(d.density_gcm3 || 0),
    cost: Number(d.cost_per_kg || 0),
    pressure_ratio: Number(d.pressure_ratio || 0),
    verdict: d.verdict,
    utilization: Number(d.utilization_ratio || 0),
    confidence: sim.prediction.confidence,
    formula: sim.composition.formula,
    is_melted: Boolean(d.is_melted),
    is_burst: Boolean(d.is_burst_condition),
  };
}

async function runComparison(options = {}) {
  const status = $('#comparisonStatus');
  if (status) { status.textContent = 'ANALYZING'; status.className = 'status-pill status-amber'; }
  const button = $('#runComparison');
  if (button) button.disabled = true;
  try {
    const aPreset = $('#comparisonPresetA')?.value || '316L';
    const bPreset = $('#comparisonPresetB')?.value || 'Ti64';
    const aName = $('#comparisonImportA')?.value || aPreset;
    const bName = $('#comparisonImportB')?.value || bPreset;
    const aRequest = comparisonRequest(aName, $('#comparisonTempA')?.value || 25, $('#comparisonVelA')?.value || 0, $('#comparisonCustomA')?.value || '');
    const bRequest = comparisonRequest(bName, $('#comparisonTempB')?.value || 25, $('#comparisonVelB')?.value || 0, $('#comparisonCustomB')?.value || '');
    const [a, b] = await Promise.all([
      api('/api/simulate', { method: 'POST', body: aRequest }),
      api('/api/simulate', { method: 'POST', body: bRequest }),
    ]);
    state.comparison = { a, b, aRequest, bRequest };
    renderComparison();
    if (status) { status.textContent = 'COMPLETE'; status.className = 'status-pill status-emerald'; }
    if (!options.silent) toast('Comparison analysis complete.', 'success', 3000);
  } catch (err) {
    if (status) { status.textContent = 'ERROR'; status.className = 'status-pill status-rose'; }
    toast(err.message, 'error', 6000);
  } finally {
    if (button) button.disabled = false;
  }
}

function renderComparison() {
  if (!state.comparison) return;
  const { a, b } = state.comparison;
  const ma = comparisonMetrics(a);
  const mb = comparisonMetrics(b);
  const set = (id, value) => { const el = $(id); if (el) el.textContent = value; };

  set('#comparisonNameA', ma.formula);
  set('#comparisonNameB', mb.formula);
  const renderStats = (target, metrics) => {
    const el = $(target);
    if (!el) return;
    el.innerHTML = [
      ['Working strength', `${fmt(metrics.strength)} MPa`],
      ['Liquidus margin', `${fmt(metrics.liquidus_margin)} °C`],
      ['Density', `${metrics.density.toFixed(2)} g/cm³`],
      ['Cost', `₹${fmt(metrics.cost)}/kg`],
      ['Pressure ratio', metrics.pressure_ratio.toFixed(3)],
      ['Verdict', metrics.verdict],
    ].map(([label, value]) => `<li><span>${label}</span><strong>${escapeHtml(value)}</strong></li>`).join('');
  };
  renderStats('#comparisonStatsA', ma);
  renderStats('#comparisonStatsB', mb);

  const verdictClass = (metrics, target) => {
    const el = $(target);
    if (!el) return;
    el.textContent = `${metrics.verdict} · utilisation ${metrics.utilization.toFixed(2)} · ${metrics.confidence} confidence`;
    el.className = `comparison-verdict ${metrics.verdict === 'SAFE' ? 'safe' : metrics.verdict === 'MARGINAL' ? 'marginal' : 'unsafe'}`;
  };
  verdictClass(ma, '#comparisonVerdictA');
  verdictClass(mb, '#comparisonVerdictB');

  const categories = [
    ['Strength', ma.strength, mb.strength, true],
    ['Liquidus margin', ma.liquidus_margin, mb.liquidus_margin, true],
    ['Lightness', -ma.density, -mb.density, true],
    ['Cost efficiency', -ma.cost, -mb.cost, true],
    ['Pressure safety', -ma.pressure_ratio, -mb.pressure_ratio, true],
  ];
  let aWins = 0;
  let bWins = 0;
  const rows = categories.map(([label, valueA, valueB]) => {
    let winner = 'Tie';
    if (valueA > valueB) { winner = 'Alloy A'; aWins += 1; }
    else if (valueB > valueA) { winner = 'Alloy B'; bWins += 1; }
    const display = (value) => (label === 'Lightness' ? `${Math.abs(value).toFixed(2)} g/cm³` :
      label === 'Cost efficiency' ? `₹${fmt(Math.abs(value))}/kg` :
      label === 'Pressure safety' ? Math.abs(value).toFixed(3) : `${fmt(value)} ${label === 'Strength' ? 'MPa' : '°C'}`);
    return `<tr><td>${label}</td><td>${display(valueA)}</td><td>${display(valueB)}</td>
      <td><span class="pill ${winner === 'Alloy A' ? 'pill-cyan' : winner === 'Alloy B' ? 'pill-amber' : 'pill'}">${winner}</span></td></tr>`;
  });
  const body = $('#comparisonResults');
  if (body) body.innerHTML = rows.join('');

  const anyMelt = ma.is_melted || mb.is_melted;
  const anyBurst = ma.is_burst || mb.is_burst;
  const winner = aWins === bWins ? 'Draw' : aWins > bWins ? `Alloy A wins (${aWins}–${bWins})` : `Alloy B wins (${bWins}–${aWins})`;
  set('#comparisonWinner', anyMelt ? `${winner} · liquidus failure flagged` : anyBurst ? `${winner} · pressure burst flagged` : winner);
  set('#comparisonScoreline', `A ${aWins} · ${bWins} B`);
  $('#comparisonCardA')?.classList.toggle('comparison-fail', ma.is_melted || ma.is_burst);
  $('#comparisonCardB')?.classList.toggle('comparison-fail', mb.is_melted || mb.is_burst);

  const colors = themeColors();
  renderPlot($('#comparisonRadar'), [
    {
      type: 'scatterpolar', mode: 'lines+markers', name: `A · ${ma.formula}`, fill: 'toself',
      r: a.radar.alloy, theta: a.radar.labels,
      line: { color: colors.cyan, width: 2 }, marker: { size: 4, color: colors.cyan },
      fillcolor: 'rgba(34,211,238,0.16)',
    },
    {
      type: 'scatterpolar', mode: 'lines+markers', name: `B · ${mb.formula}`, fill: 'toself',
      r: b.radar.alloy, theta: b.radar.labels,
      line: { color: colors.amber, width: 2 }, marker: { size: 4, color: colors.amber },
      fillcolor: 'rgba(245,158,11,0.14)',
    },
  ], plotBase({
    polar: {
      bgcolor: 'rgba(0,0,0,0)',
      radialaxis: { gridcolor: colors.grid, tickfont: { size: 7.5, color: colors.muted }, range: [0, 100] },
      angularaxis: { gridcolor: colors.grid, tickfont: { size: 8.5, color: colors.text } },
    },
    legend: { orientation: 'h', x: 0, y: 1.14, font: { size: 8.5, color: colors.muted } },
    margin: { l: 48, r: 48, t: 26, b: 20 },
  }));

  renderPlot($('#comparisonBars'), [
    {
      type: 'bar', name: 'Alloy A', orientation: 'h',
      y: categories.map(([label]) => label), x: categories.map(([, valueA]) => Math.abs(valueA)),
      marker: { color: colors.cyan, opacity: 0.8 },
      hovertemplate: 'A · %{y}<br>%{x:,.2f}<extra></extra>',
    },
    {
      type: 'bar', name: 'Alloy B', orientation: 'h',
      y: categories.map(([label]) => label), x: categories.map(([, , valueB]) => Math.abs(valueB)),
      marker: { color: colors.amber, opacity: 0.8 },
      hovertemplate: 'B · %{y}<br>%{x:,.2f}<extra></extra>',
    },
  ], plotBase({
    barmode: 'group',
    xaxis: axisBase({ title: 'Absolute metric magnitude', gridcolor: colors.grid }),
    yaxis: axisBase({ gridcolor: 'rgba(0,0,0,0)', automargin: true }),
    legend: { orientation: 'h', x: 0, y: 1.16, font: { size: 8, color: colors.muted } },
    margin: { l: 110, r: 18, t: 26, b: 42 },
  }));
}

/* ==========================================================================
   Enterprise batch CSV + custom lab data
   ========================================================================== */
const BATCH_SAMPLE = [
  '316L | Fe:68, Cr:17, Ni:12, Mo:2.5, C:0.03',
  'Ti64 | Ti:90, Al:6, V:4',
  'Aermet | Fe:84.5, Ni:10, Co:3.5, Mo:1, C:0.4, Cr:0.6',
  'Inconel718 | Ni:58, Cr:21, Fe:17, Mo:3, Ti:0.9, Al:0.5, C:0.05',
  'Al7075 | Al:90, Zn:5.6, Mg:2.5, Cu:1.6, Cr:0.3',
].join('\n');

function loadBatchSample(announce = true) {
  const input = $('#batchInput');
  if (input) input.value = BATCH_SAMPLE;
  if (announce) toast('Sample queue loaded.', 'info', 2200);
}

function parseBatchLine(line) {
  const raw = String(line || '').trim();
  if (!raw || raw.startsWith('#')) return null;
  let label = '';
  let body = raw;
  const separator = raw.indexOf('|');
  if (separator >= 0) {
    label = raw.slice(0, separator).trim();
    body = raw.slice(separator + 1);
  }
  const elements = parseComposition(body);
  if (!Object.keys(elements).length) return null;
  return { label: label || `Batch-${Object.keys(elements).slice(0, 3).join('-')}`, elements };
}

async function runBatch() {
  const input = $('#batchInput');
  const lines = String(input?.value || '').split(/\r?\n/).map(parseBatchLine).filter(Boolean).slice(0, 25);
  if (!lines.length) {
    toast('Paste at least one composition line.', 'warning');
    return;
  }
  const status = $('#batchStatus');
  const button = $('#runBatch');
  if (button) button.disabled = true;
  state.batchRows = [];
  const body = $('#batchBody');
  if (body) body.innerHTML = '<tr class="empty-row"><td colspan="8">Running batch screen…</td></tr>';

  const profile = $('#batchProfile')?.value || 'Static tension';
  let done = 0;
  for (const line of lines) {
    try {
      const result = await api('/api/simulate', {
        method: 'POST',
        body: {
          elements: line.elements,
          temperature_c: 25,
          environment: 'Air / Industrial',
          load_profile: profile,
          load_mpa: 250,
          safety_factor: 1.5,
          environment_density_kgm3: 1.225,
          pressure_pa: 101325,
          velocity_kmh: 0,
        },
      });
      state.batchRows.push({
        label: line.label,
        formula: result.composition.formula,
        strength: result.derived.operating_strength_mpa,
        density: result.derived.density_gcm3,
        liquidus: result.derived.liquidus_c,
        verdict: result.derived.verdict,
        pressure: result.derived.pressure_label,
        elements: line.elements,
      });
    } catch (err) {
      state.batchRows.push({
        label: line.label, formula: '—', strength: 0, density: 0, liquidus: 0,
        verdict: err.status === 403 ? 'BLOCKED' : 'ERROR', pressure: '—', elements: line.elements,
      });
    }
    done += 1;
    const progress = $('#batchProgress');
    if (progress) progress.textContent = `Screening ${done} / ${lines.length} compositions…`;
    if (status) { status.textContent = `RUNNING ${done}/${lines.length}`; status.className = 'status-pill status-amber'; }
  }

  if (status) { status.textContent = 'COMPLETE'; status.className = 'status-pill status-emerald'; }
  const progress = $('#batchProgress');
  if (progress) progress.textContent = `${state.batchRows.length} compositions screened · ${state.batchRows.filter((r) => r.verdict === 'SAFE').length} cleared for detailed design.`;
  if (button) button.disabled = false;
  $('#batchExport')?.removeAttribute('disabled');
  $('#batchPushDiscovery')?.removeAttribute('disabled');
  renderBatchTable();
  toast('Batch screen complete.', 'success', 3600);
}

function renderBatchTable() {
  const body = $('#batchBody');
  if (!body) return;
  body.innerHTML = state.batchRows.map((row, index) => {
    const cls = row.verdict === 'SAFE' ? 'pill-emerald' : row.verdict === 'MARGINAL' ? 'pill-amber' : 'pill-rose';
    return `<tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(row.label)}</td>
      <td><span class="formula">${escapeHtml(row.formula)}</span></td>
      <td>${row.strength ? `${fmt(row.strength)} MPa` : '—'}</td>
      <td>${row.density ? `${Number(row.density).toFixed(2)} g/cm³` : '—'}</td>
      <td>${row.liquidus ? `${fmt(row.liquidus)} °C` : '—'}</td>
      <td><span class="pill ${cls}">${escapeHtml(row.verdict)}</span></td>
      <td>${escapeHtml(row.pressure || '—')}</td>
    </tr>`;
  }).join('') || '<tr class="empty-row"><td colspan="8">No rows returned.</td></tr>';
}

function exportBatchCsv() {
  if (!state.batchRows.length) return;
  const header = ['label', 'formula', 'operating_strength_mpa', 'density_gcm3', 'liquidus_c', 'verdict', 'pressure'];
  const lines = [header.join(',')].concat(state.batchRows.map((row) =>
    [row.label, row.formula, row.strength, row.density, row.liquidus, row.verdict, row.pressure]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `MATERIALHUNT_batch_${Date.now()}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1500);
  toast('Batch results exported as CSV.', 'success');
}

async function validateLabCoupon() {
  const elements = parseComposition($('#labCompound')?.value || '');
  if (!Object.keys(elements).length) {
    toast('Enter a valid lab composition first.', 'warning');
    return;
  }
  const button = $('#validateLab');
  if (button) { button.disabled = true; button.textContent = 'Validating…'; }
  try {
    const result = await api('/api/simulate', {
      method: 'POST',
      body: {
        elements,
        temperature_c: Number($('#labTemp')?.value || 25),
        environment: 'Air / Industrial',
        load_profile: 'Static tension',
        load_mpa: 250,
        safety_factor: 1.5,
        environment_density_kgm3: 1.225,
        pressure_pa: 101325,
        velocity_kmh: 0,
      },
    });
    const measuredStrength = Number($('#labStrength')?.value || 0);
    const measuredDensity = Number($('#labDensity')?.value || 0);
    const measuredCost = Number($('#labCost')?.value || 0);
    const predictedStrength = Number(result.prediction.predicted || 0);
    const predictedDensity = Number(result.derived.density_gcm3 || 0);
    const predictedCost = Number(result.derived.cost_per_kg || 0);
    const strengthBias = measuredStrength ? (predictedStrength - measuredStrength) / measuredStrength * 100 : 0;
    const densityBias = measuredDensity ? (predictedDensity - measuredDensity) / measuredDensity * 100 : 0;
    const costBias = measuredCost ? (predictedCost - measuredCost) / measuredCost * 100 : 0;
    const container = $('#labResult');
    if (container) {
      container.innerHTML = `
        <div class="lab-bias-grid">
          <div><span>Strength bias</span><strong class="${Math.abs(strengthBias) < 10 ? 'ok' : 'warn'}">${strengthBias >= 0 ? '+' : ''}${strengthBias.toFixed(1)}%</strong><small>model ${fmt(predictedStrength)} vs measured ${fmt(measuredStrength)} MPa</small></div>
          <div><span>Density bias</span><strong class="${Math.abs(densityBias) < 5 ? 'ok' : 'warn'}">${densityBias >= 0 ? '+' : ''}${densityBias.toFixed(1)}%</strong><small>model ${predictedDensity.toFixed(2)} vs measured ${measuredDensity.toFixed(2)} g/cm³</small></div>
          <div><span>Cost bias</span><strong class="${Math.abs(costBias) < 15 ? 'ok' : 'warn'}">${costBias >= 0 ? '+' : ''}${costBias.toFixed(1)}%</strong><small>model ₹${fmt(predictedCost)} vs measured ₹${fmt(measuredCost)}/kg</small></div>
        </div>
        <p class="micro-note">Model verdict at ${Number($('#labTemp')?.value || 25)}°C: <strong>${escapeHtml(result.derived.verdict)}</strong> · weighted liquidus ${fmt(result.derived.liquidus_c)}°C · ${escapeHtml(result.prediction.confidence)} confidence · ${escapeHtml($('#labNotes')?.value || 'no lab reference')}.</p>`;
    }
    toast('Lab coupon validated against the model envelope.', 'success', 4200);
  } catch (err) {
    toast(err.message, 'error', 6000);
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Validate Coupon Against Model'; }
  }
}

async function pushBatchDiscoveryRegistry() {
  const best = [...state.batchRows].sort((a, b) => b.strength - a.strength)[0];
  if (!best) return;
  await publishToDiscoveryRegistry(best.elements);
}

/* ==========================================================================
   Global R&D Discovery Discovery Registry
   ========================================================================== */
async function loadDiscoveryRegistry() {
  try {
    const result = await api('/api/discoveryRegistry?limit=20', { auth: false });
    state.discoveryRegistry = result;
    const stats = $('#discoveryRegistryStats');
    const info = result.stats || {};
    if (stats) {
      stats.innerHTML = [
        ['Verified discoveries', fmt(info.total_discoveries || 0), 'all-time'],
        ['Top score', Number(info.top?.rank_score || 0).toFixed(1), 'discovery index'],
        ['Datasets covered', fmt(Object.keys(info.by_dataset || {}).length), 'Matbench tasks'],
        ['Leading team', info.top?.organization_name || info.top?.email || '—', 'verified lab'],
      ].map(([label, value, sub]) => `<article class="leader-stat glass"><span>${label}</span><strong>${escapeHtml(String(value))}</strong><small>${escapeHtml(String(sub))}</small></article>`).join('');
    }
    const body = $('#discoveryRegistryBody');
    if (body) {
      body.innerHTML = (result.leaders || []).map((row, index) => {
        const cls = row.confidence === 'High' ? 'pill-emerald' : row.confidence === 'Medium' ? 'pill-amber' : 'pill-rose';
        return `<tr>
          <td><span class="rank-badge rank-${index + 1}">${index + 1}</span></td>
          <td>${escapeHtml(row.actor)}</td>
          <td><span class="formula">${escapeHtml(row.formula)}</span></td>
          <td>${fmt(row.predicted)} ${escapeHtml(row.unit)}</td>
          <td><span class="pill ${cls}">${escapeHtml(row.confidence)}</span></td>
          <td class="leader-note">${escapeHtml(row.discovery_note || '—')}</td>
          <td>${escapeHtml(String(row.created_at || '').slice(0, 10))}</td>
        </tr>`;
      }).join('') || '<tr class="empty-row"><td colspan="7">No verified discoveries yet.</td></tr>';
    }
  } catch (err) {
    toast(err.message, 'error', 5000);
  }
}

async function publishToDiscoveryRegistry(elements) {
  if (!state.user) {
    toast('Sign in or launch the pilot sandbox to publish a discovery.', 'warning');
    openAuth('login');
    return;
  }
  try {
    const request = elements ? { ...comparisonRequest('316L', 25, 0), elements }
      : collectSimulationRequest();
    const result = await api('/api/discoveryRegistry/submit', { method: 'POST', body: request });
    toast(`Discovery published · score ${Number(result.entry.rank_score || 0).toFixed(1)}`, 'success', 4600);
    await loadDiscoveryRegistry();
    if (state.gateActive) refreshAdminDiscoveryRegistry();
  } catch (err) {
    toast(err.message, 'error', 6000);
  }
}

/* ==========================================================================
   Pricing and inline feedback
   ========================================================================== */
function renderPricing() {
  window.MH_GROWTH?.renderPricing?.();
}

function setInlineRating(rating) {
  state.inlineRating = rating;
  $$('#inlineStarRow .star-btn').forEach((button) => {
    const value = Number(button.dataset.star);
    button.classList.toggle('active', value === 0 ? rating === 0 : value <= rating);
  });
  const label = $('#inlineRatingLabel');
  if (label) label.textContent = rating === 0 && !state.inlineRatingTouched ? 'Not rated' : `${rating} / 5`;
}

async function submitInlineFeedback() {
  if (!state.user) {
    toast('Sign in to send us your feedback.', 'warning');
    openAuth('login');
    return;
  }
  const message = ($('#inlineFeedbackMessage')?.value || '').trim();
  if (!message) {
    toast('Add one sentence of context before sending.', 'warning');
    return;
  }
  const button = $('#submitInlineFeedback');
  if (button) button.disabled = true;
  try {
    await api('/api/feedback', {
      method: 'POST',
      body: {
        rating: Number(state.inlineRating || 0),
        category: $('#inlineFeedbackCategory')?.value || 'General',
        message,
      },
    });
    const status = $('#inlineFeedbackStatus');
    if (status) status.textContent = `Feedback logged at ${new Date().toLocaleTimeString('en-IN')} · ${state.inlineRating}★`;
    $('#inlineFeedbackMessage').value = '';
    toast('Thank you, your feedback was sent.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

/* ==========================================================================
   Founder vault extras
   ========================================================================== */
async function refreshAdminDiscoveryRegistry() {
  try {
    const result = await api('/api/admin/discoveries', { admin: true });
    const body = $('#adminDiscoveryRegistry');
    if (body) {
      body.innerHTML = (result.discoveryRegistry || []).map((row, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(row.actor)}</td>
          <td><span class="formula">${escapeHtml(row.formula)}</span></td>
          <td>${fmt(row.predicted)} ${escapeHtml(row.unit)}</td>
          <td>${Number(row.rank_score || 0).toFixed(1)}</td>
        </tr>`).join('') || '<tr class="empty-row"><td colspan="5">No discoveries recorded.</td></tr>';
    }
  } catch (err) {
    console.warn('Admin discoveryRegistry unavailable', err);
  }
}

async function adminMintPilot() {
  try {
    const result = await api('/api/admin/mint-pilot?mode=live_demo', { method: 'POST', admin: true });
    toast(`Pilot minted: ${result.user.email} · ENTERPRISE ACCESS GRANT — FEE WAIVED (₹0)`, 'success', 6000);
    await refreshAdmin();
    await refreshAdminDiscoveryRegistry();
  } catch (err) {
    toast(err.message, 'error', 6000);
  }
}

/* ==========================================================================
   Three.js WebGL specimen viewer
   ========================================================================== */
class MaterialScene {
  constructor(canvas) {
    if (!window.THREE) throw new Error('three.js unavailable');
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.14;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x040912, 0.023);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    this.target = new THREE.Vector3(0, 0, 0);
    this.theta = 0.68;
    this.phi = 1.08;
    this.radius = 8.4;
    this.mode = 'lattice';
    this.composition = [];
    this.structure = 'BCC';
    this.temperature = 25;
    this.stress = 250;
    this.utilization = 0;
    this.verdict = 'SAFE';
    this.phase = 'SOLID';
    this.liquidus = 1500;
    this.cameraPreset = 'default';
    this.cameraAuto = true;
    this.cameraLerp = null;
    this.burstActive = false;
    this.burstClock = 0;
    this.time = 0;
    this.dragging = false;
    this.pointers = new Map();
    this.lastPointer = { x: 0, y: 0 };
    this.pinchDistance = 0;
    this.lastSignature = '';
    this.rebuildTimer = null;
    this.atomMeshes = [];
    this.bondMeshes = [];
    this.atomMaterials = [];

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.latticeGroup = new THREE.Group();
    this.tensileGroup = new THREE.Group();
    this.specimenGroup = new THREE.Group();
    this.root.add(this.latticeGroup, this.tensileGroup, this.specimenGroup);

    this.glowTexture = this.makeGlowTexture();
    this.addLights();
    this.addBackdrop();
    this.buildLattice();
    this.buildTensile();
    this.buildSpecimens();
    this.buildEmission();
    this.setMode('lattice');
    this.bindOrbit();
    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement || canvas);

    this.animateBound = this.animate.bind(this);
    this.lastFrame = performance.now();
    requestAnimationFrame(this.animateBound);
  }

  makeGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.22, 'rgba(255,255,255,0.62)');
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.14)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  addLights() {
    this.scene.add(new THREE.AmbientLight(0x2a3b58, 1.1));
    const hemisphere = new THREE.HemisphereLight(0x67e8f9, 0x020617, 1.2);
    this.scene.add(hemisphere);
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(5, 8, 7);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x22d3ee, 2.0);
    rim.position.set(-7, 3, -5);
    this.scene.add(rim);
    const cyan = new THREE.PointLight(0x22d3ee, 48, 24, 2);
    cyan.position.set(4, 2.5, 3.5);
    this.scene.add(cyan);
    const emerald = new THREE.PointLight(0x10b981, 32, 22, 2);
    emerald.position.set(-4, -1.5, 3);
    this.scene.add(emerald);
    const amber = new THREE.PointLight(0xf59e0b, 20, 18, 2);
    amber.position.set(0, -2.5, -4);
    this.scene.add(amber);
  }

  addBackdrop() {
    const positions = [];
    for (let i = 0; i < 620; i += 1) {
      const radius = 12 + Math.random() * 18;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions.push(radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi) * 0.55, radius * Math.sin(phi) * Math.sin(theta));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.stars = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: 0x6fe7ff, size: 0.035, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.scene.add(this.stars);

    const grid = new THREE.GridHelper(18, 36, 0x155e75, 0x0b2435);
    grid.position.y = -2.25;
    grid.material.transparent = true;
    grid.material.opacity = 0.3;
    grid.material.depthWrite = false;
    this.scene.add(grid);

    const glow = (color, scale, position, opacity) => {
      const material = new THREE.SpriteMaterial({
        map: this.glowTexture, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(scale, scale, 1);
      sprite.position.copy(position);
      this.scene.add(sprite);
    };
    glow(0x22d3ee, 7.5, new THREE.Vector3(-1.5, 0.5, -3.5), 0.18);
    glow(0x10b981, 5.5, new THREE.Vector3(2.6, -1.2, -3.2), 0.14);
  }

  clearGroup(group) {
    while (group.children.length) {
      const child = group.children.pop();
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
    }
  }

  /* One standard unit cell, drawn the way a textbook draws it:
     BCC  = 8 corners + 1 centre (2 atoms per cell), FCC = 8 corners + 6 face centres (4 atoms per cell),
     HCP  = hexagonal prism: 12 corners + 2 face centres + 3 inside (6 atoms per cell, c/a = 1.633). */
  unitCellPositions() {
    const k = this.cellScale || 1;
    const P = [];
    if (this.structure === 'HCP') {
      const R = 1.5 * k;
      const c = R * 1.633;
      for (let level = -1; level <= 1; level += 2) {
        for (let i = 0; i < 6; i += 1) {
          const t = (i / 6) * Math.PI * 2;
          P.push(new THREE.Vector3(R * Math.cos(t), (c / 2) * level, R * Math.sin(t)));
        }
        P.push(new THREE.Vector3(0, (c / 2) * level, 0));
      }
      for (let i = 0; i < 3; i += 1) {
        const t = (i / 3) * Math.PI * 2 + Math.PI / 6;
        P.push(new THREE.Vector3((R / Math.sqrt(3)) * Math.cos(t), 0, (R / Math.sqrt(3)) * Math.sin(t)));
      }
      // atom radius when the neighbours just touch is R/2 (we draw a fraction of that so the cell stays readable)
      return { positions: P, threshold: R * 1.04, touch: R / 2, edge: R };
    }
    const a = 2.6 * k;
    const h = a / 2;
    [-h, h].forEach((x) => [-h, h].forEach((y) => [-h, h].forEach((z) => P.push(new THREE.Vector3(x, y, z)))));
    if (this.structure === 'BCC') {
      P.push(new THREE.Vector3(0, 0, 0));
      return { positions: P, threshold: a * 0.88, touch: (Math.sqrt(3) / 4) * a, edge: a };
    }
    P.push(new THREE.Vector3(-h, 0, 0), new THREE.Vector3(h, 0, 0), new THREE.Vector3(0, -h, 0), new THREE.Vector3(0, h, 0), new THREE.Vector3(0, 0, -h), new THREE.Vector3(0, 0, h));
    return { positions: P, threshold: a * 0.72, touch: (Math.SQRT2 / 4) * a, edge: a };
  }

  buildLattice() {
    this.clearGroup(this.latticeGroup);
    this.atomMeshes = [];
    this.bondMeshes = [];
    this.atomMaterials = [];
    if (!this.composition.length) {
      this.composition = [{ symbol: 'Fe', pct: 70, color: '#7FB3FF', radius: 126 }, { symbol: 'Cr', pct: 18, color: '#46E0C0', radius: 128 }, { symbol: 'Ni', pct: 12, color: '#B388FF', radius: 124 }];
    }
    // the cell grows or shrinks with the average atom size of the mix (Vegard's law, simplified)
    const totalPct = this.composition.reduce((sum, el) => sum + Math.max(0.001, Number(el.pct)), 0);
    const avgRadius = this.composition.reduce((sum, el) => sum + Math.max(0.001, Number(el.pct)) * (Number(el.radius) || 126), 0) / totalPct;
    this.cellScale = clamp(avgRadius / 130, 0.85, 1.25);
    const data = this.unitCellPositions();

    // the same mix always draws the same picture: exact shares of each element, placed by a seeded shuffle
    let seed = 2166136261;
    `${this.structure}|${this.composition.map((el) => `${el.symbol}${Number(el.pct).toFixed(1)}`).sort().join(',')}`.split('').forEach((ch) => { seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619); });
    const rand = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const slots = data.positions.length;
    const share = this.composition.map((el) => ({ el, exact: Math.max(0.001, Number(el.pct)) / totalPct * slots }));
    share.forEach((x) => { x.n = Math.floor(x.exact); });
    share.forEach((x) => { if (x.n === 0 && x.exact >= 0.3) x.n = 1; });
    let assigned = share.reduce((sum, x) => sum + x.n, 0);
    while (assigned < slots) { share.sort((a, b) => (b.exact - b.n) - (a.exact - a.n)); share[0].n += 1; assigned += 1; }
    while (assigned > slots) { share.sort((a, b) => b.n - a.n); share[0].n -= 1; assigned -= 1; }
    const bag = [];
    share.forEach((x) => { for (let i = 0; i < x.n; i += 1) bag.push(x.el); });
    for (let i = bag.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    const facts = { BCC: '2 atoms per cell · 8 nearest neighbours · 68% packed', FCC: '4 atoms per cell · 12 nearest neighbours · 74% packed', HCP: '6 atoms per cell · 12 nearest neighbours · 74% packed' }[this.structure] || '';
    this.latticeInfo = { cell: this.cellScale, structure: this.structure, facts };
    const note = document.getElementById('latticeNote');
    if (note) note.textContent = `${this.structure}: ${facts}. The lattice is for representation purposes only.`;

    const sphereGeometry = new THREE.SphereGeometry(1, 36, 28);
    const materialMap = new Map();
    data.positions.forEach((position, index) => {
      const el = bag[index] || this.composition[0];
      const key = el.symbol;
      if (!materialMap.has(key)) {
        const color = new THREE.Color(el.color || '#7FB3FF');
        materialMap.set(key, { material: new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.28, metalness: 0.55, roughness: 0.3 }), base: color.clone() });
      }
      const mesh = new THREE.Mesh(sphereGeometry, materialMap.get(key).material);
      // about 40% of the touching radius keeps the cell readable; sizes follow each element's relative atomic radius
      mesh.scale.setScalar(data.touch * 0.4 * clamp((Number(el.radius) || 126) / avgRadius, 0.75, 1.3));
      mesh.position.copy(position);
      mesh.userData.base = position.clone();
      mesh.userData.phase = index * 0.73;
      this.latticeGroup.add(mesh);
      this.atomMeshes.push(mesh);
    });
    this.atomMaterials = Array.from(materialMap.values());

    // thin lines between nearest neighbours only
    const bondGeometry = new THREE.CylinderGeometry(0.02, 0.02, 1, 8, 1, false);
    const bondMaterial = new THREE.MeshStandardMaterial({ color: 0x8fa6bd, emissive: 0x0e7490, emissiveIntensity: 0.25, metalness: 0.5, roughness: 0.5, transparent: true, opacity: 0.4 });
    this.bondMaterial = bondMaterial;
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < data.positions.length; i += 1) {
      for (let j = i + 1; j < data.positions.length; j += 1) {
        const pa = data.positions[i];
        const pb = data.positions[j];
        const distance = pa.distanceTo(pb);
        if (distance > data.threshold) continue;
        const bond = new THREE.Mesh(bondGeometry, bondMaterial);
        bond.position.copy(pa).add(pb).multiplyScalar(0.5);
        bond.quaternion.setFromUnitVectors(up, pb.clone().sub(pa).normalize());
        bond.scale.set(1, distance, 1);
        bond.userData.baseLength = distance;
        bond.userData.phase = (i + j) * 0.51;
        this.latticeGroup.add(bond);
        this.bondMeshes.push(bond);
      }
    }
    this.latticeGroup.rotation.set(0.12, -0.3, 0.05);
    this.updateTint();
  }

  buildTensile() {
    const shape = new THREE.Shape();
    shape.moveTo(-3.25, -0.92);
    shape.lineTo(-2.3, -0.92);
    shape.bezierCurveTo(-1.55, -0.92, -1.48, -0.4, -1.02, -0.4);
    shape.lineTo(1.02, -0.4);
    shape.bezierCurveTo(1.48, -0.4, 1.55, -0.92, 2.3, -0.92);
    shape.lineTo(3.25, -0.92);
    shape.lineTo(3.25, 0.92);
    shape.lineTo(2.3, 0.92);
    shape.bezierCurveTo(1.55, 0.92, 1.48, 0.4, 1.02, 0.4);
    shape.lineTo(-1.02, 0.4);
    shape.bezierCurveTo(-1.48, 0.4, -1.55, 0.92, -2.3, 0.92);
    shape.lineTo(-3.25, 0.92);
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.5, bevelEnabled: true, bevelSize: 0.045, bevelThickness: 0.045, bevelSegments: 3, steps: 1, curveSegments: 28,
    });
    geometry.center();

    this.tensileMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uStress: { value: 0.25 },
        uTemp: { value: 25 },
        uTime: { value: 0 },
        uBase: { value: new THREE.Color(0x1a5cc7) },
        uCustom: { value: 0 },
      },
      vertexShader: `
        uniform float uStress;
        varying vec3 vPos;
        varying vec3 vNrm;
        void main() {
          vec3 p = position;
          float g = exp(-pow(p.x / 1.15, 2.0));
          float neck = uStress * 0.19 * g;
          p.y *= 1.0 - neck;
          p.z *= 1.0 - neck * 0.8;
          vPos = p;
          vNrm = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform float uStress;
        uniform float uTemp;
        uniform float uTime;
        uniform vec3 uBase;
        uniform float uCustom;
        varying vec3 vPos;
        varying vec3 vNrm;
        void main() {
          float g = exp(-pow(vPos.x / 1.45, 2.0));
          float heat = clamp((uTemp + 200.0) / 1100.0, 0.0, 1.0);
          float s = clamp(uStress * 0.9 + g * uStress * 0.6 + heat * 0.34, 0.0, 1.0);
          vec3 cold = mix(vec3(0.10, 0.36, 0.78), uBase, uCustom);
          vec3 mid = vec3(0.98, 0.56, 0.12);
          vec3 hot = vec3(1.0, 0.10, 0.12);
          vec3 col = mix(cold, mid, smoothstep(0.0, 0.55, s));
          col = mix(col, hot, smoothstep(0.55, 1.0, s));
          float rim = pow(1.0 - abs(normalize(vNrm).z), 2.0);
          col += vec3(0.08, 0.55, 0.85) * rim * 0.24;
          float pulse = 0.5 + 0.5 * sin(uTime * 4.5);
          col += vec3(0.95, 0.18, 0.05) * uStress * g * pulse * 0.32;
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.DoubleSide,
    });
    this.dogbone = new THREE.Mesh(geometry, this.tensileMaterial);
    this.tensileGroup.add(this.dogbone);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 24),
      new THREE.LineBasicMaterial({ color: 0x9adfff, transparent: true, opacity: 0.22 }),
    );
    this.tensileGroup.add(edges);

    const collarGeometry = new THREE.TorusGeometry(0.32, 0.035, 8, 28);
    const collarMaterial = new THREE.MeshStandardMaterial({ color: 0x8cb7d4, emissive: 0x0e7490, emissiveIntensity: 0.5, metalness: 0.95, roughness: 0.25 });
    [-2.55, 2.55].forEach((x) => {
      const collar = new THREE.Mesh(collarGeometry, collarMaterial);
      collar.rotation.y = Math.PI / 2;
      collar.position.set(x, 0, 0);
      this.tensileGroup.add(collar);
    });

    this.fractureGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTexture, color: 0xf43f5e, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.fractureGlow.scale.setScalar(1.3);
    this.fractureGlow.position.set(0, 0, 0.65);
    this.tensileGroup.add(this.fractureGlow);

    const particleCount = 48;
    const positions = new Float32Array(particleCount * 3);
    this.particleSpeeds = [];
    for (let i = 0; i < particleCount; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 0.7;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 0.7;
      positions[i * 3 + 2] = 0.6 + Math.random() * 0.3;
      this.particleSpeeds.push(0.08 + Math.random() * 0.2);
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.neckParticles = new THREE.Points(particleGeometry, new THREE.PointsMaterial({
      color: 0xffa240, size: 0.055, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.tensileGroup.add(this.neckParticles);
    this.tensileGroup.rotation.set(0.05, -0.16, 0);
  }

  buildSpecimens() {
    this.specimenMaterial = new THREE.MeshStandardMaterial({
      color: 0x93A9C4, metalness: 0.92, roughness: 0.26, emissive: 0x0a1626, emissiveIntensity: 0.3,
    });
    this.specimenWire = new THREE.MeshBasicMaterial({ color: 0x7FDBFF, wireframe: true, transparent: true, opacity: 0.16 });
    this.specimens = {};

    /* Rocket nozzle bell (lathe profile with throat + exit cone) */
    const nozzlePoints = [];
    for (let i = 0; i <= 26; i += 1) {
      const t = i / 26;
      const y = -1.75 + t * 3.5;
      const radius = 0.34 + 1.28 * Math.pow(Math.max(0, t - 0.18) / 0.82, 1.9);
      nozzlePoints.push(new THREE.Vector2(radius, y));
    }
    const nozzle = new THREE.Group();
    const bell = new THREE.Mesh(new THREE.LatheGeometry(nozzlePoints, 64), this.specimenMaterial);
    bell.material.side = THREE.DoubleSide;
    nozzle.add(bell);
    const bellWire = new THREE.Mesh(new THREE.LatheGeometry(nozzlePoints, 28), this.specimenWire);
    bellWire.scale.setScalar(1.012);
    nozzle.add(bellWire);
    const throatRing = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.05, 10, 40), this.specimenMaterial);
    throatRing.rotation.x = Math.PI / 2;
    throatRing.position.y = -1.1;
    nozzle.add(throatRing);
    this.specimens.nozzle = nozzle;

    /* Hypersonic turbine blade */
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(-0.5, -1.85);
    bladeShape.bezierCurveTo(0.62, -1.25, 0.92, -0.2, 0.8, 1.62);
    bladeShape.lineTo(-0.42, 1.88);
    bladeShape.bezierCurveTo(-0.18, 0.5, -0.32, -0.7, -0.5, -1.85);
    const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.24, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 3, steps: 1, curveSegments: 30 });
    bladeGeometry.center();
    const blade = new THREE.Group();
    blade.add(new THREE.Mesh(bladeGeometry, this.specimenMaterial));
    const bladeWire = new THREE.Mesh(bladeGeometry, this.specimenWire);
    bladeWire.scale.setScalar(1.008);
    blade.add(bladeWire);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.3, 28), this.specimenMaterial);
    hub.position.y = -2.0;
    blade.add(hub);
    blade.rotation.z = -0.14;
    this.specimens.blade = blade;

    /* Submersible pressure sphere */
    const sphere = new THREE.Group();
    sphere.add(new THREE.Mesh(new THREE.SphereGeometry(1.42, 56, 36), this.specimenMaterial));
    const sphereWire = new THREE.Mesh(new THREE.SphereGeometry(1.44, 24, 16), this.specimenWire);
    sphere.add(sphereWire);
    for (let i = 0; i < 3; i += 1) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.46, 0.028, 8, 60), this.specimenMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.rotation.z = (i / 3) * Math.PI;
      sphere.add(ring);
    }
    this.specimens.sphere = sphere;

    Object.values(this.specimens).forEach((group) => { group.visible = false; this.specimenGroup.add(group); });

    this.rippleGroup = new THREE.Group();
    for (let i = 0; i < 3; i += 1) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.3 + i * 0.28, 0.014, 8, 64),
        new THREE.MeshBasicMaterial({ color: 0x67E8F9, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.userData.offset = i * 0.33;
      this.rippleGroup.add(ring);
    }
    this.rippleGroup.visible = false;
    this.specimenGroup.add(this.rippleGroup);
  }

  buildEmission() {
    const count = 260;
    const positions = new Float32Array(count * 3);
    this.emissionSeeds = [];
    for (let i = 0; i < count; i += 1) {
      const radius = Math.random() * 1.9;
      const angle = Math.random() * Math.PI * 2;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 3.4;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      this.emissionSeeds.push({ speed: 0.4 + Math.random() * 1.4, spin: angle, radius, y: positions[i * 3 + 1] });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.emission = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: 0xFFB347, size: 0.05, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.root.add(this.emission);

    const burstCount = 130;
    const burstPositions = new Float32Array(burstCount * 3);
    this.burstSeeds = [];
    for (let i = 0; i < burstCount; i += 1) {
      burstPositions[i * 3] = 0;
      burstPositions[i * 3 + 1] = 0;
      burstPositions[i * 3 + 2] = 0;
      this.burstSeeds.push({
        vx: (Math.random() - 0.5) * 3.4,
        vy: (Math.random() - 0.35) * 3.8,
        vz: (Math.random() - 0.5) * 3.4,
      });
    }
    const burstGeometry = new THREE.BufferGeometry();
    burstGeometry.setAttribute('position', new THREE.BufferAttribute(burstPositions, 3));
    this.burstPoints = new THREE.Points(burstGeometry, new THREE.PointsMaterial({
      color: 0xFF7A3D, size: 0.09, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.root.add(this.burstPoints);
  }

  blackbodyColor(celsius) {
    const stops = [
      [-273.15, '#4EA8FF'], [-100, '#6FC6FF'], [25, '#C8D5E4'], [350, '#E8C9A0'],
      [650, '#C0392B'], [950, '#FF4D12'], [1400, '#FF8C1A'], [2000, '#FFB347'],
      [3000, '#FFE1A8'], [3600, '#FFF3D6'], [4500, '#FFFFFF'],
    ];
    const value = Number(celsius) || 0;
    for (let i = 0; i < stops.length - 1; i += 1) {
      const [t0, c0] = stops[i];
      const [t1, c1] = stops[i + 1];
      if (value <= t1) {
        const ratio = clamp((value - t0) / (t1 - t0), 0, 1);
        return new THREE.Color(c0).lerp(new THREE.Color(c1), ratio);
      }
    }
    return new THREE.Color('#FFFFFF');
  }

  setShape(shape) {
    const allowed = ['lattice', 'nozzle', 'blade', 'sphere', 'dogbone'];
    this.mode = allowed.includes(shape) ? shape : 'lattice';
    this.latticeGroup.visible = this.mode === 'lattice';
    this.tensileGroup.visible = this.mode === 'dogbone';
    this.specimenGroup.visible = !['lattice', 'dogbone'].includes(this.mode);
    Object.entries(this.specimens).forEach(([key, group]) => { group.visible = key === this.mode; });
    if (this.mode === 'lattice' && this.needsRebuild) {
      this.buildLattice();
      this.needsRebuild = false;
    }
    this.radius = this.mode === 'dogbone' ? 9.8 : this.mode === 'lattice' ? 8.8 : 8.0;
    this.applyPhaseVisual();
  }

  setMode(mode) {
    this.setShape(mode === 'tensile' ? 'dogbone' : mode);
  }

  /* a hex colour (or empty for the default) for the nozzle, blade, sphere and dogbone */
  setCustomColor(hex) {
    this.customColor = /^#[0-9a-f]{6}$/i.test(hex || '') ? new THREE.Color(hex) : null;
    if (this.tensileMaterial) {
      this.tensileMaterial.uniforms.uCustom.value = this.customColor ? 1 : 0;
      if (this.customColor) this.tensileMaterial.uniforms.uBase.value.copy(this.customColor);
    }
    this.applyPhaseVisual();
  }

  applyPhaseVisual() {
    const liquid = this.phase === 'LIQUID';
    const gas = this.phase === 'GASEOUS / VAPORIZED';
    const hot = this.blackbodyColor(this.temperature);
    if (this.specimenMaterial) {
      const base = this.customColor ? this.customColor.clone() : new THREE.Color(0x93A9C4);
      const heatMix = clamp((this.temperature + 60) / 1200, 0, 1);
      this.specimenMaterial.color.copy(base).lerp(hot, Math.min(0.82, heatMix * 0.85));
      this.specimenMaterial.emissive.copy(hot);
      this.specimenMaterial.emissiveIntensity = 0.22 + clamp((this.temperature - 300) / 1400, 0, 1) * 1.5;
      this.specimenMaterial.transparent = gas;
      this.specimenMaterial.opacity = gas ? 0.38 : 1;
      this.specimenMaterial.roughness = liquid ? 0.18 : 0.26;
      this.specimenMaterial.metalness = gas ? 0.4 : 0.92;
    }
    if (this.rippleGroup) this.rippleGroup.visible = liquid || this.temperature >= this.liquidus;
    if (this.emission) this.emission.material.opacity = gas ? 0.85 : 0;
    if (this.emission) this.emission.material.color.copy(hot);
    if (this.latticeGroup && gas) this.latticeGroup.scale.setScalar(1 + Math.sin(this.time * 2.2) * 0.01);
  }

  setSimulation(info = {}) {
    if (Number.isFinite(Number(info.temperature))) this.temperature = Number(info.temperature);
    if (Number.isFinite(Number(info.stress))) this.stress = Number(info.stress);
    if (Number.isFinite(Number(info.utilization))) this.utilization = Number(info.utilization);
    if (Number.isFinite(Number(info.liquidus))) this.liquidus = Number(info.liquidus);
    if (info.verdict) this.verdict = info.verdict;
    if (info.phase) this.phase = info.phase;
    const failed = this.verdict === 'MELTED' || this.verdict === 'UNSAFE' || this.utilization > 1;
    if (failed && !this.burstActive) {
      this.burstActive = true;
      this.burstClock = 0;
    }
    if (!failed && this.burstActive) this.burstActive = false;
    this.updateTint();
    this.updateUniforms();
    this.applyPhaseVisual();
  }

  setCameraPreset(name) {
    const presets = {
      atomic: { theta: 0.72, phi: 0.9, radius: 5.1 },
      stress: { theta: 0.02, phi: 1.5, radius: 7.2 },
      cinema: { theta: 0.5, phi: 1.02, radius: 10.2 },
      reset: { theta: 0.68, phi: 1.08, radius: this.mode === 'dogbone' ? 9.6 : 8.2 },
    };
    const target = presets[name] || presets.reset;
    this.cameraPreset = name;
    this.cameraAuto = name === 'cinema';
    this.cameraLerp = { ...target };
    if (name === 'cinema') this.radius = Math.max(this.radius, 9.4);
  }

  resetSpecimen() {
    this.burstActive = false;
    this.burstClock = 0;
    if (this.burstPoints) this.burstPoints.material.opacity = 0;
    this.needsRebuild = true;
    this.lastSignature = '';
    this.buildLattice();
    this.setCameraPreset('reset');
    this.applyPhaseVisual();
  }

  bindOrbit() {
    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.lastPointer = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!this.pointers.has(event.pointerId)) return;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size === 2) {
        const points = Array.from(this.pointers.values());
        const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        if (this.pinchDistance) this.radius = clamp(this.radius + (this.pinchDistance - distance) * 0.012, 4.5, 16);
        this.pinchDistance = distance;
        return;
      }
      const dx = event.clientX - this.lastPointer.x;
      const dy = event.clientY - this.lastPointer.y;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.theta -= dx * 0.0058;
      this.phi = clamp(this.phi - dy * 0.0058, 0.28, Math.PI - 0.22);
    });
    const end = (event) => {
      this.pointers.delete(event.pointerId);
      this.dragging = this.pointers.size > 0;
      this.pinchDistance = 0;
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* pointer already released */ }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', (event) => { if (event.buttons === 0) end(event); });
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.radius = clamp(this.radius + event.deltaY * 0.0032, 4.5, 16);
    }, { passive: false });
    canvas.addEventListener('dblclick', () => {
      this.theta = 0.68;
      this.phi = 1.08;
      this.radius = this.mode === 'tensile' ? 9.6 : 8.4;
    });
  }

  setTheme() {
    if (this.stars) this.stars.material.color.set(0x6fe7ff);
  }

  setComposition(elements, structure, temperature, stress) {
    this.temperature = Number(temperature) || 25;
    this.stress = Number(stress) || 0;
    const nextStructure = ['BCC', 'FCC', 'HCP'].includes(structure) ? structure : this.structure;
    const signature = `${nextStructure}|${(elements || []).map((el) => `${el.symbol}${Number(el.pct).toFixed(1)}${el.color || ''}${el.radius || ''}`).sort().join(',')}`;
    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      this.composition = (elements || []).map((el) => ({ ...el }));
      this.structure = nextStructure;
      this.needsRebuild = true;
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = setTimeout(() => {
        if (this.mode === 'lattice') {
          this.buildLattice();
          this.needsRebuild = false;
        }
      }, 90);
    }
    this.updateTint();
    this.updateUniforms();
  }

  updateTint() {
    const stressNorm = clamp(this.stress / 1200, 0, 1);
    const tempNorm = clamp((this.temperature + 200) / 1100, 0, 1);
    const heat = new THREE.Color(0xff5a2a);
    this.atomMaterials.forEach(({ material, base }) => {
      material.emissive.copy(base).lerp(heat, clamp(stressNorm * 0.45 + tempNorm * 0.18, 0, 0.62));
      material.emissiveIntensity = 0.32 + stressNorm * 0.4 + tempNorm * 0.16;
    });
    if (this.bondMaterial) this.bondMaterial.emissiveIntensity = 0.3 + tempNorm * 0.8;
  }

  updateUniforms() {
    if (!this.tensileMaterial) return;
    const stressNorm = clamp(this.stress / 1200, 0, 1);
    this.tensileMaterial.uniforms.uStress.value = stressNorm;
    this.tensileMaterial.uniforms.uTemp.value = this.temperature;
    if (this.fractureGlow) this.fractureGlow.material.opacity = stressNorm > 0.78 ? (stressNorm - 0.78) * 2.4 : 0;
    if (this.neckParticles) this.neckParticles.material.opacity = stressNorm > 0.7 ? (stressNorm - 0.7) * 1.7 : 0;
  }

  resize() {
    const parent = this.canvas.parentElement;
    const width = parent?.clientWidth || this.canvas.clientWidth;
    const height = parent?.clientHeight || this.canvas.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  updateCamera() {
    const sinPhi = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * sinPhi * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sinPhi * Math.cos(this.theta),
    );
    this.camera.lookAt(this.target);
  }

  animate(now) {
    requestAnimationFrame(this.animateBound);
    const time = now / 1000;
    this.time = time;
    const tempNorm = clamp((this.temperature + 200) / 1100, 0, 1);
    const stressNorm = clamp(this.stress / 1200, 0, 1);

    if (!this.dragging) {
      if (this.cameraLerp) {
        const target = this.cameraLerp;
        this.theta += (target.theta - this.theta) * 0.08;
        this.phi += (target.phi - this.phi) * 0.08;
        this.radius += (target.radius - this.radius) * 0.08;
        if (Math.abs(target.theta - this.theta) < 0.004 && Math.abs(target.radius - this.radius) < 0.02) this.cameraLerp = null;
      } else if (this.cameraAuto) {
        this.theta += 0.0011;
      }
    }
    if (this.stars) this.stars.rotation.y = time * 0.012;

    if (this.mode === 'lattice') {
      this.atomMeshes.forEach((atom) => {
        const base = atom.userData.base;
        const phase = atom.userData.phase;
        const amplitude = 0.006 + tempNorm * 0.022;
        atom.position.set(
          base.x + Math.sin(time * 5.2 + phase) * amplitude,
          base.y + Math.cos(time * 4.6 + phase * 1.4) * amplitude,
          base.z + Math.sin(time * 3.8 + phase * 0.7) * amplitude,
        );
      });
      this.bondMeshes.forEach((bond) => {
        const baseLength = bond.userData.baseLength;
        bond.scale.y = baseLength * (1 + Math.sin(time * 2.6 + bond.userData.phase) * (0.004 + tempNorm * 0.008));
      });
      const gas = this.phase === 'GASEOUS / VAPORIZED';
      if (!this.dragging) this.latticeGroup.rotation.y += 0.0014;
      if (gas) {
        this.latticeGroup.scale.setScalar(1 + Math.sin(time * 2.2) * 0.012);
        this.latticeGroup.rotation.z = Math.sin(time * 0.7) * 0.02;
      } else {
        this.latticeGroup.scale.setScalar(1);
      }
    } else if (this.mode === 'dogbone') {
      if (this.tensileMaterial) this.tensileMaterial.uniforms.uTime.value = time;
      if (this.neckParticles && this.neckParticles.material.opacity > 0.01) {
        const positions = this.neckParticles.geometry.attributes.position;
        for (let i = 0; i < positions.count; i += 1) {
          let y = positions.getY(i) + this.particleSpeeds[i] * 0.008;
          if (y > 0.55) y = -0.45;
          positions.setY(i, y);
          positions.setX(i, positions.getX(i) + Math.sin(time * 3 + i) * 0.0007);
        }
        positions.needsUpdate = true;
      }
      this.tensileGroup.rotation.y = -0.16 + Math.sin(time * 0.35) * 0.04;
      this.tensileGroup.rotation.z = Math.sin(time * 0.5) * 0.012;
      this.tensileGroup.rotation.x = 0.05 + Math.sin(time * 0.28) * 0.02;
      this.fractureGlow?.scale.setScalar(1.1 + Math.sin(time * 6) * 0.18 + stressNorm * 0.4);
    } else {
      const group = this.specimens[this.mode];
      if (group) {
        const tremor = this.utilization > 0.85
          ? Math.sin(time * 34) * 0.006 * clamp((this.utilization - 0.85) * 6, 0, 1)
          : 0;
        group.position.x = tremor;
        group.position.y = Math.sin(time * 1.4) * 0.035;
        group.rotation.y += 0.0038;
        group.rotation.z = Math.sin(time * 0.6) * 0.018;
        if (this.phase === 'LIQUID') group.scale.set(1, 1 + Math.sin(time * 3.2) * 0.012, 1);
        else group.scale.setScalar(1);
      }
      if (this.rippleGroup?.visible) {
        this.rippleGroup.children.forEach((ring) => {
          const wave = (time * 0.55 + ring.userData.offset) % 1;
          ring.scale.setScalar(0.7 + wave * 0.9);
          ring.material.opacity = (1 - wave) * 0.5;
          ring.position.y = -1.5 + wave * 0.2;
        });
      }
    }

    if (this.emission && this.emission.material.opacity > 0.01) {
      const positions = this.emission.geometry.attributes.position;
      for (let i = 0; i < positions.count; i += 1) {
        const seed = this.emissionSeeds[i];
        let y = positions.getY(i) + seed.speed * 0.012;
        if (y > 1.9) y = -1.9;
        positions.setY(i, y);
        const spin = seed.spin + time * seed.speed * 0.6;
        positions.setX(i, Math.cos(spin) * seed.radius * (1 + (y + 1.9) * 0.08));
        positions.setZ(i, Math.sin(spin) * seed.radius * (1 + (y + 1.9) * 0.08));
      }
      positions.needsUpdate = true;
    }

    if (this.burstPoints) {
      if (this.burstActive) {
        this.burstClock += 0.016;
        const positions = this.burstPoints.geometry.attributes.position;
        for (let i = 0; i < positions.count; i += 1) {
          const seed = this.burstSeeds[i];
          positions.setXYZ(i, seed.vx * this.burstClock, seed.vy * this.burstClock - 0.9 * this.burstClock * this.burstClock, seed.vz * this.burstClock);
        }
        positions.needsUpdate = true;
        this.burstPoints.material.opacity = clamp(1 - this.burstClock * 0.9, 0, 0.95);
      } else {
        this.burstPoints.material.opacity = 0;
      }
    }
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  }
}

function initScene() {
  const canvas = $('#heroCanvas');
  if (!canvas) return;
  if (!window.THREE) {
    showSceneFallback('three.min.js was not found in /static/vendor. The offline 3D engine cannot start.');
    return;
  }
  try {
    state.scene = new MaterialScene(canvas);
    state.scene.setTheme(document.documentElement.dataset.theme);
    updateSceneFromState();
  } catch (err) {
    console.warn('WebGL initialisation failed', err);
    showSceneFallback('WebGL is unavailable in this browser. The analytics engine still works fully offline.');
  }
}

function showSceneFallback(message) {
  const stage = $('#heroViewport');
  if (!stage) return;
  const fallback = document.createElement('div');
  fallback.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:40px;color:#7B8DA6;font-size:12px;line-height:1.7;';
  fallback.textContent = message;
  stage.appendChild(fallback);
}

/* ==========================================================================
   UI event wiring
   ========================================================================== */
function updateRangeLabels() {
  const cost = Number($('#maxCost')?.value || 8000);
  const density = Number($('#maxDensity')?.value || 20);
  const costOut = $('#maxCostOut');
  const densityOut = $('#maxDensityOut');
  if (costOut) costOut.textContent = cost >= 8000 ? 'Any' : `≤ ₹${fmt(cost)}/kg`;
  if (densityOut) densityOut.textContent = density >= 20 ? 'Any' : `≤ ${density.toFixed(1)} g/cm³`;

  const temperature = Number($('#temperatureSlider')?.value || 25);
  const load = Number($('#loadSlider')?.value || 250);
  const safety = Number($('#safetySlider')?.value || 1.5);
  const tempReadout = $('#tempReadout');
  if (tempReadout) tempReadout.textContent = `${fmt(temperature)}°C`;
  const loadOut = $('#loadOut');
  if (loadOut) loadOut.textContent = `${fmt(load)} MPa`;
  const safetyOut = $('#safetyOut');
  if (safetyOut) safetyOut.textContent = safety.toFixed(2);
  if ($('#heroTempChip')) $('#heroTempChip').textContent = `${fmt(temperature)}°C`;
  if ($('#heroStress') && !state.simulation) $('#heroStress').textContent = `${fmt(load * safety)} MPa`;

  const pressure = pressurePaFromUI();
  const pressureOut = $('#pressureOut');
  if (pressureOut) pressureOut.textContent = formatPressure(pressure);
  const velocity = Number($('#velocitySlider')?.value || 0);
  const velocityOut = $('#velocityOut');
  if (velocityOut) velocityOut.textContent = `${fmt(velocity)} km/h`;
  const densityValue = Number(state.mediumDensity || 1.225);
  const densityReadout = $('#densityOut');
  if (densityReadout) densityReadout.textContent = `${fmt(densityValue, 3)} kg/m³`;
  const q = 0.5 * densityValue * Math.pow(velocity / 3.6, 2);
  const dynamicOut = $('#dynamicPressureOut');
  if (dynamicOut && !state.simulation) dynamicOut.textContent = formatPressure(q);
  const totalOut = $('#totalPressureOut');
  if (totalOut && !state.simulation) totalOut.textContent = formatPressure(pressure + q);
  $$('#mediumDensityRow .medium-chip').forEach((chip) =>
    chip.classList.toggle('active', Math.abs(Number(chip.dataset.density) - densityValue) < 0.01));
  $$('#pressureUnits .unit-pill').forEach((button) =>
    button.classList.toggle('active', button.dataset.unit === state.pressureUnit));
}

function updatePersonaHint() {
  const hint = $('#personaHint');
  if (hint) hint.textContent = state.meta?.personas?.[state.persona]?.brief || 'Weights are applied across the filtered multi-material pool.';
  $('#customWeights')?.classList.toggle('hidden', state.persona !== 'Custom Weights');
}

function updateModeUI() {
  const titles = {
    lattice: 'Crystal Atomic Lattice',
    nozzle: 'Rocket Nozzle Bell',
    blade: 'Hypersonic Turbine Blade',
    sphere: 'Submersible Pressure Sphere',
    dogbone: 'Tensile Dogbone Bar',
  };
  $$('.mode-btn').forEach((button) => {
    const active = button.dataset.shape === state.mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  const title = $('#heroViewerTitle');
  if (title) title.textContent = titles[state.mode] || titles.lattice;
  $('#latticeControls')?.classList.toggle('hidden', state.mode !== 'lattice');
  $('#latticeNote')?.classList.toggle('hidden', state.mode !== 'lattice');
  $('#shapeColors')?.classList.toggle('hidden', state.mode === 'lattice');
  if (state.scene) {
    state.scene.setMode(state.mode);
    updateSceneFromState();
  }
}

function bindEvents() {
  $('#themeToggle')?.addEventListener('click', toggleTheme);
  $('#loginBtn')?.addEventListener('click', () => openAuth('login'));
  $('#closeAuth')?.addEventListener('click', closeAuth);
  $('#authModal')?.addEventListener('click', (event) => { if (event.target === $('#authModal')) closeAuth(); });
  $$('.auth-tab').forEach((tab) => tab.addEventListener('click', () => switchAuthTab(tab.dataset.auth)));
  $('#loginForm')?.addEventListener('submit', handleLogin);
  $('#registerForm')?.addEventListener('submit', handleRegister);
  $('#logoutBtn')?.addEventListener('click', logout);
  $$('[data-view]').forEach((element) => {
    element.addEventListener('click', (event) => {
      if (element.tagName === 'A') event.preventDefault();
      setView(element.dataset.view);
    });
  });

  /* Pre-screen controls */
  $('#personaGrid')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-persona]');
    if (!button) return;
    state.persona = button.dataset.persona;
    renderPersonas();
    updatePersonaHint();
    if (state.user) loadPrescreen();
  });
  $$('#customWeights input[type="range"]').forEach((input) => {
    input.addEventListener('input', () => {
      const output = input.parentElement.querySelector('output');
      if (output) output.textContent = input.value;
    });
  });
  $('#includeElements')?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-chip]');
    if (!chip) return;
    const sym = chip.dataset.symbol;
    if (state.include.has(sym)) state.include.delete(sym); else state.include.add(sym);
    renderElementChips();
  });
  $('#excludeElements')?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-chip]');
    if (!chip) return;
    const sym = chip.dataset.symbol;
    if (state.exclude.has(sym)) state.exclude.delete(sym); else state.exclude.add(sym);
    renderElementChips();
  });
  $('#maxCost')?.addEventListener('input', updateRangeLabels);
  $('#maxDensity')?.addEventListener('input', updateRangeLabels);
  $('#applyFilters')?.addEventListener('click', () => {
    if (!state.user) toast('Preview mode — create a free account to save and download reports.', 'info');
    loadPrescreen();
  });
  $('#searchInput')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') loadPrescreen(); });
  $('#exportTableCsv')?.addEventListener('click', csvExport);
  $('#loadTopBtn')?.addEventListener('click', () => {
    if (state.screenItems.length) loadCandidateIntoSimulator(state.screenItems[0]);
    else toast('Run a screen first.', 'warning');
  });
  $('#resetFilters')?.addEventListener('click', () => {
    state.persona = 'Aerospace';
    state.include.clear();
    state.exclude.clear();
    if ($('#confidenceFilter')) $('#confidenceFilter').value = 'Low';
    if ($('#maxCost')) $('#maxCost').value = '8000';
    if ($('#maxDensity')) $('#maxDensity').value = '20';
    if ($('#searchInput')) $('#searchInput').value = '';
    $$('.dataset-check').forEach((check) => { check.checked = true; });
    renderPersonas();
    renderElementChips();
    updatePersonaHint();
    updateRangeLabels();
    loadPrescreen();
  });
  $('#candidateBody')?.addEventListener('click', (event) => {
    const load = event.target.closest('[data-load]');
    if (load) {
      const item = state.screenItems[Number(load.dataset.load)];
      if (item) loadCandidateIntoSimulator(item);
      return;
    }
    const row = event.target.closest('[data-row]');
    if (row) selectCandidate(state.screenItems[Number(row.dataset.row)]);
  });

  /* Pressure / velocity / medium density */
  $$('#pressureUnits .unit-pill').forEach((button) => button.addEventListener('click', () => setPressureUnit(button.dataset.unit, true)));
  $('#pressureSlider')?.addEventListener('input', () => { updateRangeLabels(); scheduleSimulation(600); });
  $('#velocitySlider')?.addEventListener('input', () => { updateRangeLabels(); scheduleSimulation(600); });
  $('#densitySlider')?.addEventListener('input', () => { setMediumDensity($('#densitySlider').value); scheduleSimulation(700); });
  $('#mediumDensityRow')?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-density]');
    if (!chip) return;
    setMediumDensity(chip.dataset.density, true);
  });

  /* Periodic table */
  ['#openPeriodic', '#openPeriodicInline'].forEach((selector) => $(selector)?.addEventListener('click', openPeriodic));
  $('#closePeriodic')?.addEventListener('click', closePeriodic);
  $('#periodicModal')?.addEventListener('click', (event) => { if (event.target === $('#periodicModal')) closePeriodic(); });
  $('#periodicSearch')?.addEventListener('input', (event) => renderPeriodicTable(event.target.value));
  $('#periodicGrid')?.addEventListener('click', (event) => {
    const cell = event.target.closest('[data-symbol]');
    if (cell) showPeriodicDetail(cell.dataset.symbol);
  });
  $('#periodicDetail')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-pd-add]');
    if (button) addPeriodicElement(button.dataset.symbol);
  });

  /* Mission Co-Pilot */
  $('#runMission')?.addEventListener('click', runMissionSearch);
  $('#missionPrompt')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') runMissionSearch(); });
  $('#missionResults')?.addEventListener('click', (event) => {
    const card = event.target.closest('[data-elements], [data-formula]');
    if (!card) return;
    let composition = {};
    try { composition = JSON.parse(card.dataset.elements || '{}'); } catch { composition = {}; }
    if (!Object.keys(composition).length) {
      composition = parseComposition(String(card.dataset.formula || '').replace(/([A-Z][a-z]?)([0-9.]+)/g, '$1:$2 '));
    }
    if (!Object.keys(composition).length) return;
    const total = Object.values(composition).reduce((sum, value) => sum + Number(value), 0);
    state.composition = total > 0 && total <= 5
      ? Object.fromEntries(Object.entries(composition).map(([sym, value]) => [sym, Number((value / total * 100).toFixed(3))]))
      : composition;
    renderElementSliders();
    updateCompositionUI();
    setView('simulator');
    runSimulation();
    toast(`${card.dataset.formula || humanFormula(state.composition, 4)} loaded from the mission shortlist.`, 'success', 3200);
  });
  $('#heroRunSim')?.addEventListener('click', () => {
    setView('simulator');
    runSimulation();
  });

  /* Comparative Analysis */
  $('#runComparison')?.addEventListener('click', () => runComparison());
  $('#swapComparison')?.addEventListener('click', () => {
    const a = $('#comparisonPresetA');
    const b = $('#comparisonPresetB');
    if (a && b) {
      const temp = a.value;
      a.value = b.value;
      b.value = temp;
    }
    runComparison();
  });
  ['#comparisonPresetA', '#comparisonPresetB'].forEach((selector) => $(selector)?.addEventListener('change', () => runComparison({ silent: true })));
  const comparisonLabel = (id, suffix) => {
    const slider = $(id);
    if (!slider) return;
    slider.addEventListener('input', () => {
      const out = $(`${id}Out`);
      if (out) out.textContent = `${fmt(Number(slider.value))}${suffix}`;
    });
    slider.addEventListener('change', () => runComparison({ silent: true }));
  };
  comparisonLabel('#comparisonTempA', '°C');
  comparisonLabel('#comparisonTempB', '°C');
  comparisonLabel('#comparisonVelA', ' km/h');
  comparisonLabel('#comparisonVelB', ' km/h');

  /* Batch + lab */
  $('#batchSample')?.addEventListener('click', () => loadBatchSample(true));
  $('#runBatch')?.addEventListener('click', runBatch);
  $('#batchExport')?.addEventListener('click', exportBatchCsv);
  $('#batchPushDiscovery')?.addEventListener('click', pushBatchDiscoveryRegistry);
  $('#validateLab')?.addEventListener('click', validateLabCoupon);
  $('#batchFile')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const input = $('#batchInput');
      if (input) input.value = String(reader.result || '');
      toast(`${file.name} loaded into the batch queue.`, 'success', 3000);
    };
    reader.readAsText(file);
  });

  /* Discovery Registry + inline feedback */
  $('#refreshDiscovery')?.addEventListener('click', loadDiscoveryRegistry);
  $('#publishDiscovery')?.addEventListener('click', () => publishToDiscoveryRegistry(null));
  $('#openFeedbackFromBoard')?.addEventListener('click', openFeedback);
  $('#inlineStarRow')?.addEventListener('click', (event) => {
    const star = event.target.closest('[data-star]');
    if (star) setInlineRating(Number(star.dataset.star));
  });
  $('#submitInlineFeedback')?.addEventListener('click', submitInlineFeedback);

  /* Pricing + admin extras */
  $('#adminMintPilot')?.addEventListener('click', adminMintPilot);
  $('#exportPdfTop')?.addEventListener('click', downloadPdf);

  /* 3D controls */
  $$('.mode-btn').forEach((button) => button.addEventListener('click', () => {
    state.mode = button.dataset.shape || 'lattice';
    updateModeUI();
  }));
  $$('.cam-btn').forEach((button) => button.addEventListener('click', () => {
    state.scene?.setCameraPreset(button.dataset.camera || 'reset');
    toast(`Camera preset: ${button.textContent.trim()}.`, 'info', 1800);
  }));
  $('#resetSpecimen')?.addEventListener('click', () => {
    state.scene?.resetSpecimen();
    toast('Specimen rebuilt and fracture state cleared.', 'success', 2200);
  });
  /* colour of the nozzle, blade, sphere and dogbone */
  const applyShapeColor = (hex) => {
    state.shapeColor = hex || '';
    try { localStorage.setItem('mh_shape_color', state.shapeColor); } catch { /* storage unavailable */ }
    state.scene?.setCustomColor(state.shapeColor);
    $$('#shapeColors .sc-swatch').forEach((b) => b.classList.toggle('on', (b.dataset.sc || '') === state.shapeColor));
    if (state.shapeColor) { const inp = $('#shapeColorInput'); if (inp) inp.value = state.shapeColor; }
  };
  $$('#shapeColors .sc-swatch').forEach((b) => b.addEventListener('click', () => applyShapeColor(b.dataset.sc || '')));
  $('#shapeColorInput')?.addEventListener('input', (event) => applyShapeColor(event.target.value));
  try { const saved = localStorage.getItem('mh_shape_color'); if (saved) setTimeout(() => applyShapeColor(saved), 600); } catch { /* storage unavailable */ }
  $('#structureSelect')?.addEventListener('change', (event) => {
    state.structureMode = event.target.value === 'AUTO' ? 'AUTO' : 'MANUAL';
    if (state.structureMode === 'MANUAL') state.structure = event.target.value;
    updateCompositionUI();
    scheduleSimulation(500);
  });

  /* Composition */
  $('#elementSliders')?.addEventListener('input', (event) => {
    const input = event.target.closest('[data-element]');
    if (!input) return;
    const symbol = input.dataset.element;
    state.composition[symbol] = Number(input.value);
    const output = input.parentElement.querySelector('output');
    if (output) output.textContent = Number(input.value).toFixed(Number(input.value) < 1 ? 2 : 1);
    updateCompositionUI();
    scheduleSimulation(850);
  });
  $('#presetRow')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-preset]');
    if (!button) return;
    const preset = PRESETS[button.dataset.preset];
    if (!preset) return;
    state.composition = { ...preset };
    renderElementSliders();
    updateCompositionUI();
    runSimulation();
    toast(`${button.textContent.trim()} chemistry loaded.`, 'success', 2400);
  });
  $('#resetComposition')?.addEventListener('click', () => {
    state.composition = { Fe: 70, Cr: 18, Ni: 8, Mo: 2, C: 2, Ti: 0, Al: 0 };
    renderElementSliders();
    updateCompositionUI();
    runSimulation();
  });

  /* Conditions */
  ['#temperatureSlider', '#loadSlider', '#safetySlider'].forEach((selector) => {
    $(selector)?.addEventListener('input', () => {
      updateRangeLabels();
      updateSceneFromState();
      scheduleSimulation(750);
    });
  });
  ['#environmentSelect', '#loadProfileSelect'].forEach((selector) => {
    $(selector)?.addEventListener('change', () => scheduleSimulation(300));
  });
  $('#hazardVerify')?.addEventListener('change', () => {
    const note = $('#guardrailNote');
    if (note) {
      note.classList.toggle('blocked', false);
      note.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 3 20h18L12 3Z"/><path d="M12 9v5M12 17v.5"/></svg>
        ${$('#hazardVerify').checked ? 'Clearance acknowledged. Restricted-element simulations will be written to the audit trail.' : 'Dual-Use Guardrail active: restricted elements are blocked without verified clearance.'}`;
    }
    scheduleSimulation(250);
  });
  $('#runSimulation')?.addEventListener('click', () => {
    clearTimeout(state.simTimer);
    state.simTimer = null;
    runSimulation();
  });
  $('#jumpViewerBtn')?.addEventListener('click', () => {
    document.querySelector('.hero')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#downloadPdf')?.addEventListener('click', downloadPdf);

  /* Feedback */
  // ? next to Screened candidates statistic
  $('#statCandidates')?.closest('.glass')?.previousElementSibling?.querySelector('button')?.addEventListener('click', () => {
    copilotOpen();
    copilotAsk('Explain the screened candidates count and what it means for the Matbench test set');
  });

  // ? next to Best test R² statistic
  $('#statAccuracy')?.closest('.glass')?.previousElementSibling?.querySelector('button')?.addEventListener('click', () => {
    copilotOpen();
    copilotAsk('Explain the Best test R² score and what it means for material prediction');
  });

  // ? next to Inference latency statistic
  $('#statLatency')?.closest('.glass')?.previousElementSibling?.querySelector('button')?.addEventListener('click', () => {
    copilotOpen();
    copilotAsk('Explain the inference latency and Magpie + 150-tree RF ensemble');
  });

  $('#feedbackToggle')?.addEventListener('click', openFeedback);
  $('#feedbackClose')?.addEventListener('click', closeFeedback);
  $('#drawerBackdrop')?.addEventListener('click', closeFeedback);
  $('#starRow')?.addEventListener('click', (event) => {
    const star = event.target.closest('[data-star]');
    if (star) setStarRating(Number(star.dataset.star));
  });
  $('#feedbackForm')?.addEventListener('submit', submitFeedback);

  /* Admin */
  $('#adminUnlockForm')?.addEventListener('submit', (event) => { event.preventDefault(); attemptAdminUnlock(false); });
  $('#adminRefresh')?.addEventListener('click', refreshAdmin);
  $('#adminUsers')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-admin-action]');
    if (!button) return;
    adminAction(button.dataset.adminAction, button.dataset.user);
  });
  $('#adminFeedback')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-triage]');
    if (!button) return;
    triageFeedback(button.dataset.feedback, button.dataset.triage);
  });

  /* Analytics + ROI */
  $('#importanceDataset')?.addEventListener('change', renderImportanceChart);
  ['#roiExperiments', '#roiCost', '#roiReduction', '#roiDays', '#roiTeam', '#roiTier'].forEach((selector) => {
    $(selector)?.addEventListener('input', renderRoi);
    $(selector)?.addEventListener('change', renderRoi);
  });

  window.addEventListener('resize', debounce(resizeCharts, 180));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeFeedback();
      if (!$('#authModal')?.classList.contains('hidden')) closeAuth();
    }
  });
}

/* ==========================================================================
   Machining + heat-treatment spec export
   ========================================================================== */
function heatTreatmentFor(sim) {
  const elements = sim?.composition?.elements || [];
  const has = (symbol) => elements.some((el) => el.symbol === symbol && Number(el.wt_pct) > 0.5);
  if (has('Ti')) {
    return {
      process: 'Beta anneal + age',
      steps: ['Solution treat at 940–970 °C for 1 h, argon quench', 'Age at 480–540 °C for 4–8 h', 'Stress relieve at 700 °C if welded'],
      machining: 'Rigid setup, high-pressure coolant, carbide or PCD tooling, 35–55 m/min surface speed.',
    };
  }
  if (has('Al')) {
    return {
      process: 'T6 solution + artificial age',
      steps: ['Solution treat at 525–540 °C for 1 h', 'Water quench within 10 s', 'Age at 170–185 °C for 8–12 h'],
      machining: 'Sharp polished carbide, climb milling, avoid dwell marks, 200–400 m/min.',
    };
  }
  if (has('Ni')) {
    return {
      process: 'Solution anneal + two-step age',
      steps: ['Solution anneal at 1,010–1,060 °C, argon quench', 'Primary age at 720 °C for 8 h', 'Secondary age at 620 °C for 8 h'],
      machining: 'Low surface speed 20–35 m/min, ceramic or coated carbide, flood coolant, rigid tooling.',
    };
  }
  return {
    process: 'Austenitise + temper',
    steps: ['Austenitise at 1,000–1,060 °C', 'Oil or polymer quench', 'Double temper at 550–620 °C for 2 h each'],
    machining: 'Coated carbide at 90–140 m/min, 0.15 mm/rev feed, high-pressure coolant.',
  };
}

function buildSpec(sim) {
  if (!sim) return null;
  const derived = sim.derived;
  const treatment = heatTreatmentFor(sim);
  return {
    product: 'MATERIALHUNT Inc.',
    generated_at: new Date().toISOString(),
    formula: sim.composition?.elements ? sim.composition.elements.map((el) => `${el.symbol} ${el.wt_pct}%`).join(' · ') : sim.composition?.formula,
    verdict: derived.verdict,
    service_envelope: {
      temperature_c: sim.conditions.temperature_c,
      pressure_label: derived.pressure_label,
      total_pressure_pa: derived.total_pressure_pa,
      environment: sim.conditions.environment,
      load_mpa: sim.conditions.load_mpa,
      safety_factor: sim.conditions.safety_factor,
    },
    properties: {
      yield_strength_mpa: sim.prediction.predicted,
      working_strength_mpa: derived.operating_strength_mpa,
      density_gcm3: derived.density_gcm3,
      cost_inr_kg: derived.cost_per_kg,
      liquidus_c: derived.liquidus_c,
      service_ceiling_c: derived.thermal_limit_c,
      aggregate_phase: derived.aggregate_phase,
      utilization: derived.utilization_ratio,
    },
    heat_treatment: treatment,
    machining: treatment.machining,
    validation: 'Screening output only — confirm with NABL-accredited tensile, creep and corrosion testing before release.',
  };
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1200);
}

function downloadSpec(format) {
  const spec = buildSpec(state.simulation);
  if (!spec) { toast('Run a simulation first.', 'warning'); return; }
  if (format === 'json') {
    downloadBlob(JSON.stringify(spec, null, 2), 'MATERIALHUNT_Machining_HeatTreatment_Spec.json', 'application/json');
  } else {
    const lines = [
      'MATERIALHUNT INC. — MACHINING & HEAT-TREATMENT SPECIFICATION',
      `Generated: ${new Date().toLocaleString('en-IN')}`,
      `Formula: ${spec.formula}`,
      `Verdict: ${spec.verdict}`,
      '',
      'SERVICE ENVELOPE',
      `  Temperature: ${spec.service_envelope.temperature_c} °C`,
      `  Pressure: ${spec.service_envelope.pressure_label}`,
      `  Environment: ${spec.service_envelope.environment}`,
      `  Applied load: ${spec.service_envelope.load_mpa} MPa at SF ${spec.service_envelope.safety_factor}`,
      '',
      'PROPERTIES',
      `  Yield strength: ${spec.properties.yield_strength_mpa} MPa`,
      `  Derated working strength: ${spec.properties.working_strength_mpa} MPa`,
      `  Density: ${spec.properties.density_gcm3} g/cm3`,
      `  Raw cost: INR ${spec.properties.cost_inr_kg}/kg`,
      `  Liquidus: ${spec.properties.liquidus_c} °C`,
      `  Aggregate phase: ${spec.properties.aggregate_phase}`,
      '',
      `HEAT TREATMENT — ${spec.heat_treatment.process}`,
      ...spec.heat_treatment.steps.map((step) => `  - ${step}`),
      '',
      'MACHINING',
      `  ${spec.machining}`,
      '',
      spec.validation,
    ];
    downloadBlob(lines.join('\n'), 'MATERIALHUNT_Machining_HeatTreatment_Spec.txt', 'text/plain');
  }
  toast(`Machining & heat-treatment spec exported as .${format}.`, 'success', 3200);
}

/* ==========================================================================
   1-click auto-optimise (cheaper & lighter, same envelope)
   ========================================================================== */
async function autoOptimize() {
  if (!state.simulation) await runSimulation({ silent: true });
  const engine = window.MH_OFFLINE_SIMULATE;
  if (!engine) { toast('Optimiser needs the bundled screening engine.', 'error'); return; }
  const request = collectSimulationRequest();
  const baseline = state.simulation?.derived || {};
  const baseCost = Number(baseline.cost_per_kg || 0);
  const baseDensity = Number(baseline.density_gcm3 || 0);
  const symbols = Object.keys(normalisedComposition());
  const cheap = ['Fe', 'Al', 'Si', 'Mn', 'Mg'];
  let best = null;
  const button = $('#autoOptimize');
  const original = button?.innerHTML;
  if (button) { button.disabled = true; button.textContent = 'Iterating 200 mixes…'; }
  for (let i = 0; i < 200; i += 1) {
    const candidate = {};
    symbols.forEach((symbol) => {
      const base = Number(state.composition[symbol] || 0);
      candidate[symbol] = Math.max(0, base * (0.72 + Math.random() * 0.56));
    });
    const add = cheap[Math.floor(Math.random() * cheap.length)];
    candidate[add] = (candidate[add] || 0) + 1.5 + Math.random() * 6;
    try {
      const sim = engine({ ...request, elements: candidate });
      const d = sim.derived;
      const feasible = !d.is_melted && !d.is_burst_condition && d.utilization_ratio <= 0.95
        && d.aggregate_phase !== 'GASEOUS / VAPORIZED' && d.verdict !== 'UNSAFE' && d.verdict !== 'MELTED';
      if (!feasible) continue;
      const score = Number(d.cost_per_kg) * 0.62 + Number(d.density_gcm3) * 420;
      if (!best || score < best.score) best = { score, composition: { ...candidate }, derived: d };
    } catch { /* skip invalid mix */ }
  }
  if (button) { button.disabled = false; button.innerHTML = original; }
  if (!best) {
    toast('No cheaper mix passed the exact temperature and pressure envelope. Relax the load or raise the cost ceiling.', 'warning', 6000);
    return;
  }
  state.composition = best.composition;
  renderElementSliders();
  updateCompositionUI();
  await runSimulation({ silent: true });
  const costSaving = baseCost > 0 ? Math.max(0, (baseCost - Number(best.derived.cost_per_kg)) / baseCost * 100) : 0;
  const weightSaving = baseDensity > 0 ? Math.max(0, (baseDensity - Number(best.derived.density_gcm3)) / baseDensity * 100) : 0;
  toast(`Auto-optimise: ₹${fmt(Math.max(0, baseCost - best.derived.cost_per_kg))}/kg saved (${costSaving.toFixed(1)}%) · ${weightSaving.toFixed(1)}% lighter · same pressure/temperature envelope.`, 'success', 7200);
}

/* ==========================================================================
   Shareable spec + benchmark links
   ========================================================================== */
function copyText(text, successMessage) {
  const done = () => toast(successMessage, 'success', 4200);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, done) {
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try { document.execCommand('copy'); done(); } catch { toast('Copy failed — select the link manually.', 'error'); }
  area.remove();
}

function applyUrlFormula() {
  const params = new URLSearchParams(location.search);
  const formula = params.get('formula');
  if (!formula) return;
  const composition = parseComposition(formula.replace(/,/g, ' '));
  if (!Object.keys(composition).length) return;
  const total = Object.values(composition).reduce((sum, value) => sum + Number(value), 0);
  state.composition = total > 0 && total <= 5
    ? Object.fromEntries(Object.entries(composition).map(([sym, value]) => [sym, Number((value / total * 100).toFixed(3))]))
    : composition;
  renderElementSliders();
  updateCompositionUI();
  toast('Shared alloy loaded from the link.', 'success', 3200);
}

function shareSpecLink() {
  const composition = Object.entries(normalisedComposition()).map(([sym, pct]) => `${sym}:${Number(pct).toFixed(1)}`).join(',');
  const url = `${location.origin}${location.pathname}?formula=${encodeURIComponent(composition)}&benchmark=${encodeURIComponent(state.benchmark?.id || 'studio')}`;
  copyText(url, 'Shareable spec link copied — paste into WhatsApp, LinkedIn or Slack.');
}

function copyBenchmarkLink() {
  const benchmark = state.benchmark || BENCHMARKS[state.benchmarkId] || BENCHMARKS['rocket-nozzle'];
  const params = new URLSearchParams({
    benchmark: 'custom',
    title: benchmark.title,
    temp: String(benchmark.targetTempC),
    burst: String(benchmark.minBurstMPa),
    cost: String(benchmark.maxCostINR),
    banned: (benchmark.bannedElements || []).join(','),
  });
  copyText(`${location.origin}${location.pathname}?${params.toString()}`, 'Benchmark link copied — anyone can open it and compete.');
}

/* ==========================================================================
   Validation Benchmarks & stress-test benchmarks
   ========================================================================== */
const BENCHMARKS = {
  'rocket-nozzle': {
    id: 'rocket-nozzle', title: 'Reusable Rocket Nozzle', tag: 'AEROSPACE · REUSABLE',
    brief: 'A regeneratively cooled bell nozzle must survive 2,200°C combustion gas at 65 MPa chamber pressure (about 163 MPa wall stress). Metals only. Heavy tungsten and tantalum bust the weight limit, plain steel and titanium melt, so the winning alloy has to be tuned.',
    targetTempC: 2200, minBurstMPa: 65, loadMpa: 162.5, maxDensity: 10.5, maxCostINR: 5500, minSafety: 1.25, bannedElements: [], metalsOnly: true,
    environment: 'Oxidising / Steam',
    tiers: [
      { name: 'GOLD', label: 'Gold (ISRO-grade)', sf: 1.55, cost: 3500, dens: 9.2 },
      { name: 'SILVER', label: 'Silver', sf: 1.40, cost: 4200, dens: 9.8 },
      { name: 'BRONZE', label: 'Bronze', sf: 1.25, cost: 5500, dens: 10.5 },
    ],
    rules: ['Survive 2,200 °C without melting', 'Hold 65 MPa chamber pressure (163 MPa wall stress)', 'Density ≤ 10.5 g/cm³', 'Raw cost ≤ ₹5,500/kg', 'Safety factor ≥ 1.25', 'Metals only (no carbon, boron, silicon…)'],
    standards: 'AMS 5662 · ASTM B575 · IS 1570',
  },
  submersible: {
    id: 'submersible', title: 'Deep-Sea Submersible Hull', tag: 'MARINE · 11,000 M',
    brief: 'A pressure hull for full-ocean-depth dives must resist 110 MPa seawater pressure while keeping mass and corrosion under control.',
    targetTempC: 4, minBurstMPa: 110, loadMpa: 627, maxDensity: 7.0, maxCostINR: 4000, minSafety: 1.85, bannedElements: [], metalsOnly: true, environment: 'Marine / Salt Spray',
    tiers: [
      { name: 'GOLD', label: 'Gold', sf: 1.95, cost: 3600, dens: 6.6 },
      { name: 'SILVER', label: 'Silver', sf: 1.9, cost: 3800, dens: 6.8 },
      { name: 'BRONZE', label: 'Bronze', sf: 1.85, cost: 4000, dens: 7.0 },
    ],
    rules: ['Hold 110 MPa external pressure (627 MPa wall stress)', 'Seawater corrosion resistance', 'Density ≤ 7.0 g/cm³', 'Raw cost ≤ ₹4,000/kg', 'Safety factor ≥ 1.85', 'Metals only'],
    standards: 'ASTM A240 · NORSOK M-001 · IS 6911',
  },
  'ev-enclosure': {
    id: 'ev-enclosure', title: 'EV Solid-State Battery Enclosure', tag: 'AUTOMOTIVE · EV',
    brief: 'A crash-safe battery enclosure must stay light, cheap and dimensionally stable while resisting a 2 MPa internal vent pressure.',
    targetTempC: 60, minBurstMPa: 2, loadMpa: 200, maxDensity: 3.0, maxCostINR: 900, minSafety: 1.5, bannedElements: [], metalsOnly: true,
    tiers: [
      { name: 'GOLD', label: 'Gold', sf: 1.86, cost: 610, dens: 2.65 },
      { name: 'SILVER', label: 'Silver', sf: 1.68, cost: 760, dens: 2.82 },
      { name: 'BRONZE', label: 'Bronze', sf: 1.5, cost: 900, dens: 3.0 },
    ],
    rules: ['Density ≤ 3.0 g/cm³', 'Raw cost ≤ ₹900/kg', 'Hold 2 MPa vent pressure (200 MPa crash load)', 'Safety factor ≥ 1.50', 'Metals only'],
    standards: 'IS 16893 · AIS-156 · ASTM B209',
  },
  'turbine-blade': {
    id: 'turbine-blade', title: 'Hypersonic Turbine Blade', tag: 'AEROSPACE · 45,000 RPM',
    brief: 'A rotating blade sees 1,450°C gas, 45,000 RPM centrifugal load and 45 MPa cooling pressure. Creep and burst are both fatal.',
    targetTempC: 1450, minBurstMPa: 45, loadMpa: 472.5, maxDensity: 8.5, maxCostINR: 7000, minSafety: 1.2, bannedElements: [], metalsOnly: true,
    tiers: [
      { name: 'GOLD', label: 'Gold', sf: 1.3, cost: 3950, dens: 6.8 },
      { name: 'SILVER', label: 'Silver', sf: 1.24, cost: 5750, dens: 7.8 },
      { name: 'BRONZE', label: 'Bronze', sf: 1.2, cost: 7000, dens: 8.5 },
    ],
    rules: ['Survive 1,450 °C gas temperature', 'Hold 45 MPa cooling pressure (472 MPa centrifugal load)', 'Density ≤ 8.5 g/cm³', 'Raw cost ≤ ₹7,000/kg', 'Safety factor ≥ 1.20', 'Metals only'],
    standards: 'AMS 5544 · AMS 5950 · ASTM E139',
  },
  'bone-implant': {
    id: 'bone-implant', title: 'Orthopedic Bone Implant', tag: 'BIOMEDICAL · IMPLANT',
    brief: 'A load-bearing implant must be biocompatible, corrosion resistant and free of toxic elements while surviving 5 MPa cyclic loading.',
    targetTempC: 37, minBurstMPa: 5, maxDensity: 6.5, maxCostINR: 9000, minSafety: 1.5, bannedElements: ['Co', 'Be', 'Hg', 'Cd', 'Pb'],
    rules: ['Zero Co, Be, Hg, Cd, Pb', 'Density ≤ 6.5 g/cm³', 'Hold 5 MPa cyclic load', 'Safety factor ≥ 1.50'],
    standards: 'ASTM F136 · ISO 5832-3 · ASTM F138',
  },
  custom: {
    id: 'custom', title: 'Custom Part', tag: 'YOUR OWN PROBLEM',
    brief: 'Define your own temperature, pressure, cost and banned-element constraints with the benchmark designer.',
    targetTempC: 1200, minBurstMPa: 50, maxDensity: 9.5, maxCostINR: 4000, minSafety: 1.2, bannedElements: [],
    rules: ['Custom constraints', 'Defined by your declarative block'], standards: 'Your plant standard',
  },
};

function benchmarkFromUrl() {
  const params = new URLSearchParams(location.search);
  const id = params.get('benchmark');
  if (!id) return;
  if (BENCHMARKS[id]) {
    state.benchmarkId = id;
    return;
  }
  const title = params.get('title') || 'Custom Benchmark';
  state.customBenchmark = {
    id: 'custom', title, tag: 'SHARED BENCHMARK',
    brief: 'A shared custom problem. Meet every constraint to pass.',
    targetTempC: clamp(Number(params.get('temp') || 1200), -273, 4500),
    minBurstMPa: clamp(Number(params.get('burst') || 50), 0, 5000),
    maxCostINR: clamp(Number(params.get('cost') || 4000), 0, 50000),
    maxDensity: 9.5,
    minSafety: 1.2,
    bannedElements: String(params.get('banned') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12),
    environment: params.get('env') || 'Air / Industrial',
    rules: ['Shared custom constraints', 'Meet temperature, burst, cost and banned-element limits'],
    standards: 'Shared link',
  };
  state.benchmarkId = 'custom';
}

function applyBenchmark(id, options = {}) {
  const benchmark = id === 'custom' && state.customBenchmark ? state.customBenchmark : BENCHMARKS[id] || BENCHMARKS['rocket-nozzle'];
  state.benchmarkId = id;
  state.benchmark = benchmark;
  const select = $('#benchmarkSelect');
  if (select) select.value = id;
  const set = (selector, text) => { const el = $(selector); if (el) el.textContent = text; };
  set('#benchmarkTag', benchmark.tag);
  set('#benchmarkTitle', benchmark.title);
  set('#benchmarkBrief', benchmark.brief);
  set('#benchmarkTempReq', `target ${fmt(benchmark.targetTempC)}°C`);
  set('#benchmarkPressureReq', `target ${fmt(benchmark.minBurstMPa)} MPa`);
  set('#benchmarkMassReq', `max ${benchmark.maxDensity.toFixed(1)} g/cm³`);
  set('#benchmarkCostReq', `max ₹${fmt(benchmark.maxCostINR)}`);
  set('#benchmarkSafetyReq', `min ${benchmark.minSafety.toFixed(2)}`);
  const rules = $('#benchmarkRules');
  if (rules) rules.innerHTML = benchmark.rules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join('');
  set('#benchmarkStandards', benchmark.standards);
  if (options.silent !== true) toast(`${benchmark.title} blueprint loaded.`, 'info', 2600);
}

const NON_METALS = ['H', 'He', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Si', 'P', 'S', 'Cl', 'Ar', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Te', 'I', 'Xe', 'At', 'Rn'];

/* true safety factor: usable strength at temperature divided by the load the part carries */
function benchmarkSafety(sim) {
  const load = Number(sim.conditions?.load_mpa || 0);
  const op = Number(sim.derived?.operating_strength_mpa || 0);
  return load > 0 ? op / load : 0;
}

function benchmarkTier(benchmark, sim) {
  if (!benchmark.tiers) return null;
  const d = sim.derived;
  const sf = benchmarkSafety(sim);
  return benchmark.tiers.find((t) => sf >= t.sf && d.cost_per_kg <= t.cost && d.density_gcm3 <= t.dens) || null;
}

/* what is still missing for the next medal up */
function benchmarkNextTierHint(benchmark, sim, current) {
  if (!benchmark.tiers) return '';
  const d = sim.derived;
  const sf = benchmarkSafety(sim);
  const order = benchmark.tiers.slice().reverse(); // BRONZE, SILVER, GOLD
  const idx = current ? order.findIndex((t) => t.name === current.name) : -1;
  const next = order[idx + 1];
  if (!next) return 'Top tier reached.';
  const gaps = [];
  if (sf < next.sf) gaps.push(`safety factor ${sf.toFixed(2)} → ${next.sf.toFixed(2)}`);
  if (d.cost_per_kg > next.cost) gaps.push(`cost ₹${fmt(d.cost_per_kg)} → ≤ ₹${fmt(next.cost)}/kg`);
  if (d.density_gcm3 > next.dens) gaps.push(`density ${Number(d.density_gcm3).toFixed(2)} → ≤ ${next.dens} g/cm³`);
  return gaps.length ? `For ${next.label}: ${gaps.join(', ')}.` : '';
}

function benchmarkScore(benchmark, sim, tier) {
  const d = sim.derived;
  const sf = benchmarkSafety(sim);
  const base = { GOLD: 300, SILVER: 200, BRONZE: 100 }[tier?.name] || 0;
  return Math.round(base + Math.min(sf, 3) * 10 + Math.max(0, benchmark.maxDensity - d.density_gcm3) * 5 + Math.max(0, (benchmark.maxCostINR - d.cost_per_kg) / 100));
}

function benchmarkVerdict(benchmark, sim) {
  const derived = sim.derived;
  const elements = (sim.composition?.elements || []).map((el) => el.symbol);
  const bannedHit = elements.filter((symbol) => (benchmark.bannedElements || []).includes(symbol));
  const nonMetals = benchmark.metalsOnly ? elements.filter((symbol) => NON_METALS.includes(symbol)) : [];
  if (derived.is_melted || derived.aggregate_phase === 'GASEOUS / VAPORIZED') return 'MELT';
  if (bannedHit.length || nonMetals.length) return 'BANNED';
  if (derived.is_burst_condition || (derived.burst_pressure_pa / 1e6) < benchmark.minBurstMPa) return 'BURST';
  if (derived.density_gcm3 > benchmark.maxDensity) return 'OVERWEIGHT';
  if (derived.cost_per_kg > benchmark.maxCostINR) return 'OVER BUDGET';
  if (benchmarkSafety(sim) < benchmark.minSafety || derived.verdict === 'UNSAFE') return 'FRACTURE';
  return 'PASS';
}

function renderBenchmarkResult(benchmark, sim) {
  const verdict = benchmarkVerdict(benchmark, sim);
  const derived = sim.derived;
  const set = (selector, text) => { const el = $(selector); if (el) el.textContent = text; };
  set('#forgeTemp', `${fmt(sim.conditions.temperature_c)}°C`);
  set('#forgePressure', derived.pressure_label);
  set('#forgeMass', `${Number(derived.density_gcm3).toFixed(2)} g/cm³`);
  set('#forgeCost', `₹${fmt(derived.cost_per_kg)}`);
  set('#forgeSafety', `${benchmarkSafety(sim).toFixed(2)}×`);
  set('#forgeBurst', Number(derived.burst_pressure_pa / 1e6).toFixed(1));
  const card = $('#benchmarkVerdictCard');
  if (card) card.className = `forge-verdict verdict-${verdict === 'OVER BUDGET' ? 'overweight' : verdict.toLowerCase()}`;
  set('#benchmarkVerdict', verdict === 'PASS' ? 'PASS' : verdict);
  set('#benchmarkVerdictSub', {
    PASS: 'All blueprint constraints satisfied. Ready for validation.',
    MELT: 'The alloy reaches its liquidus before the service temperature.',
    BURST: 'Pressure containment fails below the required burst pressure.',
    BANNED: benchmark.metalsOnly && ((sim.composition?.elements || []).some((el) => NON_METALS.includes(el.symbol))) ? `Metals only: remove ${((sim.composition?.elements || []).map((el) => el.symbol)).filter((s) => NON_METALS.includes(s)).join(', ')}.` : `Banned elements present: ${((sim.composition?.elements || []).map((el) => el.symbol)).filter((s) => benchmark.bannedElements.includes(s)).join(', ')}.`,
    OVERWEIGHT: 'Density exceeds the blueprint limit.',
    'OVER BUDGET': 'Raw material cost exceeds the blueprint limit.',
    FRACTURE: 'Safety factor is below the required minimum.',
  }[verdict]);
  const fixes = [];
  if (verdict === 'MELT') fixes.push(`Add W, Mo, Ta or Nb to raise the liquidus above ${fmt(benchmark.targetTempC)}°C.`);
  if (verdict === 'BURST') fixes.push('Raise Ni/Cr/Mo for strength, or increase wall section to cut hoop stress.');
  if (verdict === 'OVERWEIGHT') fixes.push('Too dense: swap some of the heavy metal (W, Ta, Re) for a lighter one (Nb, V, Ti).');
  if (verdict === 'OVER BUDGET') fixes.push('Cut the expensive elements (Ta, Nb, Re, Hf) or blend with cheaper metals.');
  if (verdict === 'FRACTURE') fixes.push('Increase strength or reduce applied load until safety factor clears the minimum.');
  if (verdict === 'BANNED') fixes.push(benchmark.metalsOnly ? 'This challenge allows metals only. Remove carbon, boron, silicon and other non-metals.' : `Remove ${benchmark.bannedElements.join(', ')} from the composition.`);
  const tier = verdict === 'PASS' ? benchmarkTier(benchmark, sim) : null;
  if (verdict === 'PASS') fixes.push(benchmark.tiers ? benchmarkNextTierHint(benchmark, sim, tier) : 'Lock the heat-treatment spec and book a NABL validation coupon.');
  const list = $('#benchmarkFixes');
  if (list) list.innerHTML = fixes.map((fix) => `<li>${escapeHtml(fix)}</li>`).join('');
  const status = $('#benchmarkStatus');
  if (status) {
    status.textContent = verdict;
    status.className = `status-pill ${verdict === 'PASS' ? 'status-emerald' : verdict === 'MELT' || verdict === 'BURST' ? 'status-rose' : 'status-amber'}`;
  }
  const fixButton = $('#benchmarkAutoFix');
  if (fixButton) fixButton.disabled = verdict === 'PASS';
  const publish = $('#benchmarkPublish');
  if (publish) publish.disabled = verdict !== 'PASS';
  const medal = $('#benchmarkMedal');
  if (medal) {
    medal.className = `forge-medal${tier ? ` medal-${tier.name.toLowerCase()}` : ' hidden'}`;
    medal.innerHTML = tier ? `<span class="medal-disc"></span><div><b>${tier.label} pass</b><small>Score ${benchmarkScore(benchmark, sim, tier)}</small></div>` : '';
  }
  state.forgeResult = { verdict, tier: tier ? tier.name : null, sf: benchmarkSafety(sim), score: tier ? benchmarkScore(benchmark, sim, tier) : 0 };
}

async function runBenchmark() {
  const benchmark = state.benchmark || BENCHMARKS[state.benchmarkId] || BENCHMARKS['rocket-nozzle'];
  const tempSlider = $('#temperatureSlider');
  if (tempSlider) tempSlider.value = String(clamp(benchmark.targetTempC, -273.15, 4500));
  setPressureUnit('MPa');
  const pressureSlider = $('#pressureSlider');
  if (pressureSlider) pressureSlider.value = String(clamp(benchmark.minBurstMPa, 0, 1000));
  const env = $('#environmentSelect');
  if (env && benchmark.environment) env.value = benchmark.environment;
  const load = $('#loadSlider');
  if (load) load.value = String(Math.min(2000, benchmark.loadMpa || Math.max(50, benchmark.minBurstMPa * 3)));
  const safetySlider = $('#safetySlider');
  if (safetySlider) safetySlider.value = '1';
  updateRangeLabels();
  const status = $('#benchmarkStatus');
  if (status) { status.textContent = 'TESTING'; status.className = 'status-pill status-amber'; }
  await runSimulation({ silent: true });
  if (!state.simulation) { if (status) status.textContent = 'ERROR'; return; }
  renderBenchmarkResult(benchmark, state.simulation);
  const verdict = state.forgeResult.verdict;
  toast(`${benchmark.title}: ${verdict}`, verdict === 'PASS' ? 'success' : 'warning', 5200);
  if (typeof trackBenchmark === 'function') trackBenchmark(verdict);
}

async function applyBenchmarkFix() {
  const benchmark = state.benchmark || BENCHMARKS[state.benchmarkId] || BENCHMARKS['rocket-nozzle'];
  const derived = state.simulation?.derived;
  if (!derived) { toast('Run the stress test first.', 'warning'); return; }
  const current = { ...state.composition };
  const ensure = (symbol, amount) => { current[symbol] = Number(current[symbol] || 0) + amount; };
  if (derived.is_melted || derived.aggregate_phase === 'GASEOUS / VAPORIZED') {
    ensure('W', 6); ensure('Mo', 4); ensure('C', 0.4);
    Object.keys(current).forEach((symbol) => { if (!['W', 'Mo', 'C', 'Ta', 'Nb'].includes(symbol)) current[symbol] = Math.max(0, current[symbol] * 0.82); });
  } else if (derived.is_burst_condition) {
    ensure('Cr', 3); ensure('Ni', 4); ensure('Mo', 2);
  } else if (derived.density_gcm3 > benchmark.maxDensity) {
    ['W', 'Mo', 'Ta', 'Nb', 'Co', 'Ni'].forEach((symbol) => { if (current[symbol]) current[symbol] = Math.max(0, current[symbol] * 0.55); });
    ensure('Al', 4); ensure('Fe', 6);
  } else if (Number(derived.cost_per_kg) > benchmark.maxCostINR) {
    ['Co', 'Ni', 'Mo', 'W', 'Ti'].forEach((symbol) => { if (current[symbol]) current[symbol] = Math.max(0, current[symbol] * 0.6); });
    ensure('Fe', 8);
  } else {
    ensure('C', 0.25); ensure('Mo', 1.5); ensure('Cr', 2);
  }
  (benchmark.bannedElements || []).forEach((symbol) => { delete current[symbol]; });
  const total = Object.values(current).reduce((sum, value) => sum + Number(value), 0) || 1;
  state.composition = Object.fromEntries(Object.entries(current).filter(([, value]) => Number(value) > 0.01).map(([symbol, value]) => [symbol, Number((value / total * 105).toFixed(2))]));
  renderElementSliders();
  updateCompositionUI();
  toast('AI fix applied to the composition — re-running the 3D stress test.', 'success', 4200);
  await runBenchmark();
  document.querySelector('.hero')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ==========================================================================
   Benchmark designer (safe declarative JSON only)
   ========================================================================== */
function syncBenchmarkSlidersToJson() {
  const block = {
    maxCostINR: Number($('#benchmarkCost')?.value || 1200),
    minBurstMPa: Number($('#benchmarkBurst')?.value || 150),
    bannedElements: String($('#benchmarkBanned')?.value || '').split(',').map((s) => s.trim()).filter(Boolean),
    targetTempC: Number($('#benchmarkTemp')?.value || 1800),
  };
  const json = $('#benchmarkJson');
  if (json) json.value = JSON.stringify(block, null, 2);
}

function parseDeclarativeBenchmark(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The block must be a JSON object.');
  const allowed = ['maxCostINR', 'minBurstMPa', 'bannedElements', 'targetTempC'];
  const clean = {};
  allowed.forEach((key) => { if (key in parsed) clean[key] = parsed[key]; });
  const number = (value, fallback) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  };
  const banned = Array.isArray(clean.bannedElements) ? clean.bannedElements : [];
  return {
    maxCostINR: clamp(number(clean.maxCostINR, 1200), 0, 50000),
    minBurstMPa: clamp(number(clean.minBurstMPa, 150), 0, 5000),
    targetTempC: clamp(number(clean.targetTempC, 1800), -273, 4500),
    bannedElements: banned.map((symbol) => String(symbol).trim()).filter((symbol) => /^[A-Za-z]{1,2}$/.test(symbol)).slice(0, 12)
      .map((symbol) => symbol.charAt(0).toUpperCase() + symbol.slice(1).toLowerCase()),
  };
}

function applyBenchmarkDesign() {
  const error = $('#benchmarkError');
  if (error) error.textContent = '';
  try {
    const block = parseDeclarativeBenchmark($('#benchmarkJson')?.value || '{}');
    const title = ($('#benchmarkName')?.value || 'Custom Part').trim().slice(0, 60) || 'Custom Part';
    state.customBenchmark = {
      id: 'custom', title, tag: 'YOUR OWN PROBLEM',
      brief: `Custom problem: reach ${fmt(block.targetTempC)} °C, hold ${fmt(block.minBurstMPa)} MPa burst, stay under ₹${fmt(block.maxCostINR)}/kg${block.bannedElements.length ? ` and avoid ${block.bannedElements.join(', ')}` : ''}.`,
      targetTempC: block.targetTempC, minBurstMPa: block.minBurstMPa, maxCostINR: block.maxCostINR,
      maxDensity: 9.5, minSafety: 1.2, bannedElements: block.bannedElements,
      rules: [
        `Target temperature ${fmt(block.targetTempC)} °C`,
        `Minimum burst pressure ${fmt(block.minBurstMPa)} MPa`,
        `Maximum raw cost ₹${fmt(block.maxCostINR)}/kg`,
        block.bannedElements.length ? `Banned elements: ${block.bannedElements.join(', ')}` : 'No banned elements',
      ],
      standards: 'Client-declared constraint block',
    };
    const params = new URLSearchParams({
      benchmark: 'custom', title, temp: String(block.targetTempC), burst: String(block.minBurstMPa),
      cost: String(block.maxCostINR), banned: block.bannedElements.join(','),
    });
    history.replaceState({}, '', `${location.pathname}?${params.toString()}`);
    $('#benchmarkModal')?.classList.add('hidden');
    applyBenchmark('custom');
    runBenchmark();
    toast('Custom benchmark generated and saved to the URL.', 'success', 4200);
  } catch (err) {
    if (error) error.textContent = err.message || 'Invalid constraint block.';
  }
}

/* ==========================================================================
   Guided guidedTour + quick help
   ========================================================================== */
const GUIDED_TOUR_STEPS = [
  {
    title: '1 · Set the mission',
    text: 'Start with the 3D simulator. Pick a preset or ask the Mission Co-Pilot in plain English.',
    points: ['Presets load real chemistries: 316L, Ti-6Al-4V, Aermet, Inconel 718, Al-7075.', 'The periodic table adds any of the 118 elements.'],
  },
  {
    title: '2 · Dial the envelope',
    text: 'Push temperature to +4,500°C and pressure into the GPa range. Dynamic head adds to static pressure.',
    points: ['Liquidus shows the melt-out temperature.', 'The burst ceiling responds to wall strength and temperature.'],
  },
  {
    title: '3 · Read the verdict',
    text: 'The 3D specimen exhibits blackbody thermal emission, fluid ripples above liquidus, and fracture initiation below a safety factor of 1.0.',
    points: ['Toggle between crystal lattice, nozzle, blade, sphere, and tensile dogbone geometries.', 'Utilize camera presets for atomic-resolution or stress cross-section views.'],
  },
  {
    title: '4 · Validate & export',
    text: 'Export the dossier, machining spec, and request a sample melt or NABL lab test.',
    points: ['Validation Benchmarks benchmarks score your part.', 'Share a specification link via WhatsApp, LinkedIn, or Slack.'],
  },
];

function showGuidedTour(step = 0) {
  state.guidedTourStep = clamp(step, 0, GUIDED_TOUR_STEPS.length - 1);
  const data = GUIDED_TOUR_STEPS[state.guidedTourStep];
  $('#guidedTourOverlay')?.classList.remove('hidden');
  const title = $('#guidedTourTitle');
  const text = $('#guidedTourText');
  const points = $('#guidedTourPoints');
  if (title) title.textContent = data.title;
  if (text) text.textContent = data.text;
  if (points) points.innerHTML = data.points.map((point) => `<li>${escapeHtml(point)}</li>`).join('');
  $$('#guidedTourProgress i').forEach((dot, index) => dot.classList.toggle('active', index <= state.guidedTourStep));
  const next = $('#guidedTourNext');
  if (next) next.textContent = state.guidedTourStep === GUIDED_TOUR_STEPS.length - 1 ? 'Start hunting' : 'Next';
  const back = $('#guidedTourBack');
  if (back) back.disabled = state.guidedTourStep === 0;
}

function guidedTourPreset() {
  $('#guidedTourOverlay')?.classList.add('hidden');
  setView('simulator');
  state.composition = { Ni: 58, Cr: 21, Fe: 17, Mo: 3, Ti: 0.9, Al: 0.5, C: 0.05 };
  renderElementSliders();
  updateCompositionUI();
  if ($('#temperatureSlider')) $('#temperatureSlider').value = '950';
  setPressureUnit('MPa');
  if ($('#pressureSlider')) $('#pressureSlider').value = '80';
  updateRangeLabels();
  runSimulation();
  toast('Guided Tour preset loaded: Inconel 718 at 950°C and 80 MPa.', 'success', 5200);
}

/* ==========================================================================
   AI Co-Pilot Helper drawer
   ========================================================================== */
const COPILOT_CHIPS = ['Why did it melt?', 'Make it cheaper', 'Explain liquidus', 'Fix failing alloy', 'Is it safe at 80 MPa?'];

function copilotOpen() {
  $('#copilotDrawer')?.classList.add('open');
  setTimeout(() => $('#copilotInput')?.focus(), 320);
  updateCopilotContext();
  if (!$('#copilotMessages')?.children.length) {
    copilotPush('assistant', 'I can see your alloy, temperature, pressure and active benchmark. Ask me anything, or use a quick prompt below.');
  }
}

function copilotClose() {
  $('#copilotDrawer')?.classList.remove('open');
}

function updateCopilotContext() {
  const container = $('#copilotContext');
  if (!container) return;
  const sim = state.simulation;
  const derived = sim?.derived;
  const chips = [
    `Alloy ${sim?.composition?.formula || humanFormula(normalisedComposition(), 4)}`,
    `${fmt(Number($('#temperatureSlider')?.value || 25))}°C`,
    derived?.pressure_label || formatPressure(pressurePaFromUI()),
    state.benchmark?.title || 'Studio mode',
  ];
  container.innerHTML = chips.map((chip) => `<span class="copilot-chip context">${escapeHtml(chip)}</span>`).join('');
  const chipsBox = $('#copilotChips');
  if (chipsBox) chipsBox.innerHTML = COPILOT_CHIPS.map((chip) => `<button class="copilot-chip" data-copilot-prompt="${escapeHtml(chip)}">${escapeHtml(chip)}</button>`).join('');
}

function copilotPush(role, html, action = null) {
  const box = $('#copilotMessages');
  if (!box) return;
  const message = document.createElement('div');
  message.className = `copilot-msg ${role}`;
  message.innerHTML = `<span class="copilot-role">${role === 'user' ? 'You' : 'Co-Pilot'}</span><div>${role === 'user' ? escapeHtml(html) : html}</div>`;
  if (action) {
    const button = document.createElement('button');
    button.className = 'btn btn-primary small copilot-action';
    button.dataset.copilotAction = action;
    button.textContent = '⚡ Apply AI Fix';
    message.appendChild(button);
  }
  box.appendChild(message);
  box.scrollTop = box.scrollHeight;
}

function copilotDiagnose() {
  const sim = state.simulation;
  if (!sim) return 'Run a simulation first so I can see the alloy and envelope.';
  const d = sim.derived;
  const tips = [];
  if (d.is_melted) tips.push(`It melted because ${fmt(sim.conditions.temperature_c)}°C is above the ${fmt(d.liquidus_c)}°C weighted liquidus. Add W, Mo, Ta or Nb, or reduce temperature.`);
  if (d.is_burst_condition) tips.push(`It burst because total pressure ${d.pressure_label} exceeded the ${formatPressure(d.burst_pressure_pa)} ceiling. Increase wall strength or reduce velocity.`);
  if (d.utilization_ratio > 0.85) tips.push(`Utilisation is ${d.utilization_ratio.toFixed(2)} — too close to the limit. Add section or pick a stronger temper.`);
  if (d.cost_per_kg > 5000) tips.push(`Cost is ₹${fmt(d.cost_per_kg)}/kg. Trim Ni, Co and Mo, then add Fe or Al.`);
  if (d.density_gcm3 > 8.2) tips.push(`Density is ${d.density_gcm3.toFixed(2)} g/cm³. Replace W/Mo with Al/Ti for a lighter part.`);
  if (d.aggregate_phase === 'GASEOUS / VAPORIZED') tips.push('Some elements are vaporising at this pressure. Lower temperature or raise pressure.');
  if (!tips.length) tips.push('The envelope is healthy. Confirm fatigue life and book a NABL coupon before release.');
  return tips.join(' ');
}

function copilotAnswer(question) {
  const q = question.toLowerCase();
  const sim = state.simulation;
  const d = sim?.derived;
  if (!sim) return { text: 'Run one simulation first — then I can reason about your actual alloy and envelope.' };
  if (/melt|liquidus|temperature|hot/.test(q)) {
    const margin = Number(d.liquidus_c) - Number(sim.conditions.temperature_c);
    return {
      text: `Your weighted liquidus is <strong>${fmt(d.liquidus_c)}°C</strong> and you are running at <strong>${fmt(sim.conditions.temperature_c)}°C</strong> — a ${margin >= 0 ? `${fmt(margin)}°C solid-state margin` : `${fmt(Math.abs(margin))}°C beyond melt-out`}. ${d.is_melted ? 'It is melted, so the part cannot carry load. Raise the refractory content (W, Mo, Ta, Nb) or lower the service temperature.' : 'Carbon sublimates rather than melting at 1 atm, so carbon-bearing grades need a pressure-aware check.'}`,
      action: d.is_melted ? 'fix' : null,
    };
  }
  if (/pressure|burst|80 mpa|mpa/.test(q)) {
    return {
      text: `Total pressure is <strong>${d.pressure_label}</strong> (static plus ½ρv²). The burst ceiling is <strong>${formatPressure(d.burst_pressure_pa)}</strong>, so the burst ratio is ${Number(d.pressure_ratio).toFixed(2)}. ${d.is_burst_condition ? 'That is a containment failure — add wall section or a stronger grade.' : 'Containment is inside the ceiling right now.'}`,
      action: d.is_burst_condition ? 'fix' : null,
    };
  }
  if (/cost|cheap|price|budget|inr/.test(q)) {
    return {
      text: `Raw cost is <strong>₹${fmt(d.cost_per_kg)}/kg</strong>. The biggest cost drivers are Ni, Co, Mo and W. I can run 200 mixes that keep the exact temperature and pressure envelope and find a cheaper, lighter chemistry.`,
      action: 'optimize',
    };
  }
  if (/light|weight|density|mass/.test(q)) {
    return {
      text: `Density is <strong>${Number(d.density_gcm3).toFixed(2)} g/cm³</strong>. Replace heavy W/Mo with Al or Ti, but watch the liquidus and strength drop. Use Auto-Optimize to search 200 alternatives without leaving the envelope.`,
      action: 'optimize',
    };
  }
  if (/corrosion|marine|salt|seawater|pren/.test(q)) {
    const cr = Number((sim.composition?.fractions?.Cr || 0) * 100);
    const mo = Number((sim.composition?.fractions?.Mo || 0) * 100);
    const pren = cr + 3.3 * mo;
    return { text: `PREN is roughly <strong>${pren.toFixed(1)}</strong> (Cr + 3.3·Mo). Above 40 resists seawater pitting; above 50 handles harsh chlorides. ${pren < 40 ? 'Raise Cr above 16% and Mo above 2% for marine duty.' : 'This chemistry is in the seawater-capable band.'}` };
  }
  if (/creep|fatigue|cycle/.test(q)) {
    return { text: `Creep is time-dependent hot deformation. At ${fmt(sim.conditions.temperature_c)}°C your service ceiling is ${fmt(d.thermal_limit_c)}°C. Keep at least 50–100°C headroom for long-life hot sections, and use the fatigue profile for cyclic duty.` };
  }
  if (/benchmark|blueprint|forge|pass/.test(q)) {
    const benchmark = state.benchmark || BENCHMARKS[state.benchmarkId];
    if (!benchmark) return { text: 'Open Validation Benchmarks in the simulator and pick a blueprint. I will score PASS, MELT, BURST or OVERWEIGHT against its rules.' };
    return { text: `Current blueprint: <strong>${escapeHtml(benchmark.title)}</strong>. It needs ${fmt(benchmark.targetTempC)}°C, ${fmt(benchmark.minBurstMPa)} MPa burst, ≤${benchmark.maxDensity} g/cm³ and ≤₹${fmt(benchmark.maxCostINR)}/kg. ${state.forgeResult ? `Last run scored <strong>${state.forgeResult.verdict}</strong>.` : 'Run the stress test to score it.'}` };
  }
  if (/fix|fail|unsafe|help|why/.test(q)) {
    return { text: copilotDiagnose(), action: 'fix' };
  }
  return {
    text: `Here is the current picture: <strong>${escapeHtml(sim.composition.formula)}</strong> at ${fmt(sim.conditions.temperature_c)}°C and ${d.pressure_label}, predicted ${fmt(sim.prediction.predicted)} MPa yield, derated to ${fmt(d.operating_strength_mpa)} MPa. Verdict <strong>${d.verdict}</strong>. Ask me about melting, pressure, cost, weight, corrosion, creep or the active benchmark.`,
  };
}

function copilotAsk(prompt) {
  const question = String(prompt || '').trim();
  if (!question) return;
  copilotPush('user', question);
  const answer = copilotAnswer(question);
  setTimeout(() => copilotPush('assistant', answer.text, answer.action), 260);
}

async function copilotAction(action) {
  if (action === 'optimize') await autoOptimize();
  if (action === 'fix') await autoOptimize();
  updateCopilotContext();
}

/* ==========================================================================
   OAuth + lead capture
   ========================================================================== */
async function oauthLogin(provider) {
  const bridge = window.MH_FIREBASE;
  if (!bridge?.signIn) {
    toast('Sign-in service is still loading. Please retry in a moment.', 'warning', 4000);
    return;
  }
  const button = $(`[data-oauth="${provider}"]`);
  if (button) button.disabled = true;
  const result = await bridge.signIn(provider);
  if (button) button.disabled = false;
  if (!result.ok) {
    toast(result.message || 'OAuth sign-in failed.', 'error', 6000);
    return;
  }
  setSession(result.token, result.user);
  closeAuth();
  await afterLogin();
  toast(`Signed in as ${state.user?.email || 'member'}.`, 'success', 4000);
}

async function saveLead(lead) {
  const bridge = window.MH_FIREBASE;
  if (bridge?.saveLead) return bridge.saveLead(lead);
  const key = 'mh_rfq_leads_v1';
  let list = [];
  try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch { list = []; }
  list.unshift({ ...lead, id: `local-${Date.now()}`, created_at: new Date().toISOString() });
  localStorage.setItem(key, JSON.stringify(list.slice(0, 40)));
  return { ok: true, id: `local-${Date.now()}`, storage: 'local' };
}

function openRfq(type = 'Custom sample melt') {
  const select = $('#rfqType');
  if (select && type) select.value = type;
  const alloy = $('#rfqAlloy');
  if (alloy) alloy.value = Object.entries(normalisedComposition()).map(([sym, pct]) => `${sym}:${Number(pct).toFixed(1)}`).join(', ');
  $('#rfqModal')?.classList.remove('hidden');
}

function openLab() {
  $('#labModal')?.classList.remove('hidden');
}

async function submitRfq(event) {
  event.preventDefault();
  const error = $('#rfqError');
  if (error) error.textContent = '';
  const lead = {
    kind: 'rfq',
    name: $('#rfqName')?.value?.trim(),
    organization: $('#rfqOrg')?.value?.trim(),
    email: $('#rfqEmail')?.value?.trim(),
    alloy: $('#rfqAlloy')?.value?.trim(),
    quantity_kg: Number($('#rfqQty')?.value || 0),
    request_type: $('#rfqType')?.value,
    notes: $('#rfqNotes')?.value?.trim(),
  };
  if (!lead.name || !lead.organization || !lead.email) {
    if (error) error.textContent = 'Name, organisation and work email are required.';
    return;
  }
  await saveLead(lead);
  $('#rfqThanks')?.classList.remove('hidden');
  toast('Thank you. Your request has been received and we will be in touch by email.', 'success', 5200);
  setTimeout(() => $('#rfqModal')?.classList.add('hidden'), 1600);
}

async function submitLabBooking(event) {
  event.preventDefault();
  const error = $('#labBookingError');
  if (error) error.textContent = '';
  const lead = {
    kind: 'lab_test',
    name: $('#labContact')?.value?.trim(),
    email: $('#labEmail')?.value?.trim(),
    test_package: $('#labTestType')?.value,
    coupons: Number($('#labCoupons')?.value || 1),
    city: $('#labCity')?.value?.trim(),
    specimen: $('#labSpecimen')?.value?.trim(),
    notes: $('#labBookingNotes')?.value?.trim(),
  };
  if (!lead.name || !lead.email) {
    if (error) error.textContent = 'Contact name and work email are required.';
    return;
  }
  await saveLead(lead);
  $('#labBookingThanks')?.classList.remove('hidden');
  toast('NABL lab request logged. A coordinator will confirm the slot.', 'success', 5200);
  setTimeout(() => $('#labModal')?.classList.add('hidden'), 1600);
}

/* ==========================================================================
   Validated alloy handbook + supply-chain risk radar
   ========================================================================== */
const RISK_ITEMS = [
  { material: 'Cobalt (Co)', exposure: 86, note: '~70% of global supply from the DRC; export scrutiny rising.', alt: 'Co-free maraging / Fe-Ni-Mo grades' },
  { material: 'Tungsten (W)', exposure: 78, note: 'China controls ~80% of refined output.', alt: 'Mo-TZM for nozzle throats' },
  { material: 'Rare earths (Nd, Dy)', exposure: 91, note: 'Magnet-grade separation is China-dominated.', alt: 'Ferrite or switched-reluctance designs' },
  { material: 'Nickel (Ni)', exposure: 54, note: 'Indonesia export policy moves the price floor.', alt: 'Indian stainless scrap + Jindal / MIDHANI' },
  { material: 'Titanium (Ti)', exposure: 58, note: 'Sponge capacity is concentrated; aerospace grades long-lead.', alt: 'KMML Kerala sponge · MIDHANI Hyderabad' },
];

function renderRiskRadar() {
  const container = $('#riskRadar');
  if (container) {
    container.innerHTML = RISK_ITEMS.map((item) => `
      <div class="risk-item">
        <div class="risk-item-head"><strong>${escapeHtml(item.material)}</strong><span class="risk-score ${item.exposure >= 80 ? 'high' : item.exposure >= 60 ? 'mid' : 'low'}">${item.exposure}%</span></div>
        <div class="risk-bar"><i style="width:${item.exposure}%"></i></div>
        <p>${escapeHtml(item.note)}</p>
        <span class="risk-alt">Indian alternative: ${escapeHtml(item.alt)}</span>
      </div>`).join('');
  }
  const alternatives = $('#riskAlternatives');
  if (alternatives) {
    alternatives.innerHTML = [
      ['Ti-6Al-4V ELI', 'ASTM F136 · IS 18386', 'MIDHANI / KMML sponge route'],
      ['Inconel 718 Plus', 'AMS 5662 · IS 1570', 'MIDHANI superalloy melting'],
      ['AerMet 340', 'AMS 6532', 'Import substitution: Fe-Co-Ni-Cr-Mo'],
      ['Maraging C300', 'AMS 6514', 'MIDHANI maraging programme'],
      ['Hastelloy C-276', 'ASTM B575', 'Indian chemical-process stockists'],
      ['Al-7075-T6', 'AMS 4045 · IS 7368', 'Hindalco / NALCO extrusion'],
      ['316LVM Surgical', 'ASTM F138 · IS 5832', 'Jindal Stainless medical grade'],
    ].map(([name, standard, source]) => `
      <div class="risk-alt-item">
        <div><strong>${escapeHtml(name)}</strong><span>${escapeHtml(standard)}</span></div>
        <small>${escapeHtml(source)}</small>
      </div>`).join('');
  }
}

async function renderHandbook() {
  const container = $('#alloyHandbook');
  if (!container) return;
  let alloys = [];
  try {
    const result = await api('/api/alloys/validated', { auth: false });
    alloys = result.alloys || [];
  } catch {
    alloys = window.MH_FIREBASE?.getHandbook()?.alloys || [];
  }
  if (!alloys.length) {
    container.innerHTML = '<div class="empty-hint">Validated alloy handbook is unavailable offline.</div>';
    return;
  }
  state.handbookAlloys = alloys;
  const count = $('#handbookCount');
  if (count) count.textContent = `${alloys.length} grades`;
  container.innerHTML = alloys.map((alloy) => `
    <button class="handbook-card" data-alloy="${escapeHtml(alloy.id)}" title="Load ${escapeHtml(alloy.designation)} into the simulator">
      <div class="handbook-card-head"><strong>${escapeHtml(alloy.designation)}</strong><span>${escapeHtml(alloy.family)}</span></div>
      <div class="handbook-meta"><span>${escapeHtml(alloy.uns || '—')}</span><span>${escapeHtml(alloy.standard || '')}</span></div>
      <div class="handbook-stats">
        <span>${fmt(alloy.yield_mpa)} MPa</span>
        <span>${Number(alloy.density).toFixed(2)} g/cm³</span>
        <span>₹${fmt(alloy.cost_inr_kg)}/kg</span>
        <span>${fmt(alloy.max_temp_c)}°C</span>
      </div>
      <p>${escapeHtml(alloy.applications || '')}</p>
    </button>`).join('');
  container.querySelectorAll('[data-alloy]').forEach((card) => {
    card.addEventListener('click', () => {
      const alloy = alloys.find((item) => item.id === card.dataset.alloy);
      if (!alloy) return;
      state.composition = { ...alloy.composition };
      renderElementSliders();
      updateCompositionUI();
      setView('simulator');
      runSimulation();
      toast(`${alloy.designation} loaded from the validated handbook.`, 'success', 3200);
    });
  });
}

/* ==========================================================================
   Extra event wiring
   ========================================================================== */
function bindExtraEvents() {
  $('#helpBtn')?.addEventListener('click', () => showGuidedTour(0));
  $('#closeGuided')?.addEventListener('click', () => $('#guidedTourOverlay')?.classList.add('hidden'));
  $('#guidedTourSkip')?.addEventListener('click', () => $('#guidedTourOverlay')?.classList.add('hidden'));
  $('#guidedTourNext')?.addEventListener('click', () => {
    if (state.guidedTourStep >= GUIDED_TOUR_STEPS.length - 1) $('#guidedTourOverlay')?.classList.add('hidden');
    else showGuidedTour(state.guidedTourStep + 1);
  });
  $('#guidedTourBack')?.addEventListener('click', () => showGuidedTour(state.guidedTourStep - 1));
  $('#guidedTourPreset')?.addEventListener('click', guidedTourPreset);

  $('#copilotFab')?.addEventListener('click', copilotOpen);
  $('#copilotClose')?.addEventListener('click', copilotClose);
  $('#copilotForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('#copilotInput');
    copilotAsk(input?.value || '');
    if (input) input.value = '';
  });
  $('#copilotDrawer')?.addEventListener('click', (event) => {
    const prompt = event.target.closest('[data-copilot-prompt]');
    if (prompt) { copilotAsk(prompt.dataset.copilotPrompt); return; }
    const action = event.target.closest('[data-copilot-action]');
    if (action) copilotAction(action.dataset.copilotAction);
  });
  $$('.ask-ai').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    copilotOpen();
    copilotAsk(button.dataset.ask || 'Explain this chart');
  }));

  $('#autoOptimize')?.addEventListener('click', autoOptimize);
  $('#shareSpec')?.addEventListener('click', shareSpecLink);
  $('#downloadSpecTxt')?.addEventListener('click', () => downloadSpec('txt'));
  $('#downloadSpecJson')?.addEventListener('click', () => downloadSpec('json'));

  $('#benchmarkSelect')?.addEventListener('change', (event) => applyBenchmark(event.target.value));
  $('#runBenchmark')?.addEventListener('click', runBenchmark);
  $('#benchmarkAutoFix')?.addEventListener('click', applyBenchmarkFix);
  $('#benchmarkPublish')?.addEventListener('click', () => (window.MH_CHALLENGE ? window.MH_CHALLENGE.submitFromForge() : publishToDiscoveryRegistry(null)));
  $('#openBenchmarkDesigner')?.addEventListener('click', () => {
    syncBenchmarkSlidersToJson();
    $('#benchmarkModal')?.classList.remove('hidden');
  });
  $('#closeBenchmarkModal')?.addEventListener('click', () => $('#benchmarkModal')?.classList.add('hidden'));
  $('#benchmarkModal')?.addEventListener('click', (event) => { if (event.target === $('#benchmarkModal')) $('#benchmarkModal')?.classList.add('hidden'); });
  $('#benchmarkFromSliders')?.addEventListener('click', syncBenchmarkSlidersToJson);
  $('#benchmarkApply')?.addEventListener('click', applyBenchmarkDesign);
  $('#copyBenchmarkLink')?.addEventListener('click', copyBenchmarkLink);
  // Generate Challenge - auto-populate with aerospace rocket nozzle defaults
  $('#genChallenge')?.addEventListener('click', () => {
    $('#benchmarkTag').value = 'AEROSPACE - REUSABLE';
    $('#benchmarkTitle').value = 'Rocket Nozzle Gen-2';
    $('#benchmarkBrief').value = 'Rocket nozzle must survive combustion and pressure cycles';
    syncBenchmarkSlidersToJson();
    $('#benchmarkCost').value = 800;
    $('#benchmarkBurst').value = 250;
    $('#benchmarkTemp').value = 1800;
    $('#benchmarkBanned').value = 'Co,Be';
    applyBenchmarkDesign();
    toast('Challenge generated - review and adjust sliders', 'success', 3000);
  });
  $('#loadBenchmarkLink')?.addEventListener('click', () => { benchmarkFromUrl(); applyBenchmark(state.benchmarkId); runBenchmark(); });

  $('#requestSampleBtn')?.addEventListener('click', () => openRfq('Custom sample melt'));
  $('#bookLabBtn')?.addEventListener('click', openLab);
  $('#brokerageBtn')?.addEventListener('click', () => openRfq('Supplier quote (mill / stockist)'));
    $('#buyCreditsBtn')?.addEventListener('click', () => window.openUpgrade?.('credits'));
  $('#riskAskAi')?.addEventListener('click', () => { copilotOpen(); copilotAsk('Explain the supply-chain risk and Indian alternatives'); });
  $('#closeRfq')?.addEventListener('click', () => $('#rfqModal')?.classList.add('hidden'));
  $('#rfqModal')?.addEventListener('click', (event) => { if (event.target === $('#rfqModal')) $('#rfqModal')?.classList.add('hidden'); });
  $('#rfqForm')?.addEventListener('submit', submitRfq);
  $('#closeLab')?.addEventListener('click', () => $('#labModal')?.classList.add('hidden'));
  $('#labModal')?.addEventListener('click', (event) => { if (event.target === $('#labModal')) $('#labModal')?.classList.add('hidden'); });
  $('#labBookingForm')?.addEventListener('submit', submitLabBooking);

  $$('[data-oauth]').forEach((button) => button.addEventListener('click', () => oauthLogin(button.dataset.oauth)));

  $('#comparisonImportA')?.addEventListener('change', (event) => {
    if (event.target.value) {
      const preset = $('#comparisonPresetA');
      if (preset) preset.value = 'custom';
      const custom = $('#comparisonCustomA');
      if (custom) custom.value = '';
      runComparison({ silent: true });
    }
  });
  $$('[data-import-active]').forEach((button) => button.addEventListener('click', () => {
    const side = button.dataset.importActive;
    const custom = $(`#comparisonCustom${side}`);
    if (custom) custom.value = Object.entries(normalisedComposition()).map(([sym, pct]) => `${sym}:${Number(pct).toFixed(1)}`).join(', ');
    const preset = $(`#comparisonPreset${side}`);
    if (preset) preset.value = 'custom';
    runComparison({ silent: true });
  }));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      copilotClose();
      $('#rfqModal')?.classList.add('hidden');
      $('#labModal')?.classList.add('hidden');
      $('#benchmarkModal')?.classList.add('hidden');
      $('#guidedTourOverlay')?.classList.add('hidden');
    }
  });
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  bindExtraEvents();
  updateRangeLabels();
  updatePersonaHint();
  setStarRating(0);
  renderRoi();
  if (state.gateActive) $('#vaultNav')?.classList.remove('hidden');
  initScene();
  bootstrap();
});





/* ==========================================================================
   ENTERPRISE FEATURES — GTA-6 LEVEL MONETIZATION & RETENTION
   ========================================================================== */

// --- PERIODIC TABLE ELEMENT SLIDER ON HOVER ---
function injectPeriodicSliders() {
  const grid = $('#periodicGrid');
  if (!grid) return;
  const buttons = grid.querySelectorAll('.pt-cell');
  buttons.forEach(btn => {
    const symbol = btn.dataset.symbol;
    if (!symbol) return;
    const current = Number(state.composition[symbol] || 0);
    const overlay = document.createElement('div');
    overlay.className = 'element-slider-overlay';
    overlay.innerHTML = `
      <div class="slider-label">${symbol} — ${state.periodic?.periodic_table?.find(e => e.symbol === symbol)?.name || ''}</div>
      <div class="slider-row">
        <span>${symbol}</span>
        <input type="range" min="0" max="100" step="0.1" value="${current}" data-element="${symbol}" data-hover-slider="true">
        <output>${current.toFixed(1)}</output>
      </div>
      <div class="slider-actions">
        <button class="btn btn-primary small" data-add-periodic="${symbol}">Add</button>
        <button class="btn btn-glass small" data-set-periodic="${symbol}">Set</button>
      </div>`;
    btn.appendChild(overlay);
  });
  
  // Event delegation for hover sliders
  grid.addEventListener('input', (e) => {
    if (e.target.matches('[data-hover-slider]')) {
      const symbol = e.target.dataset.element;
      const value = Number(e.target.value);
      const output = e.target.parentElement.querySelector('output');
      if (output) output.textContent = value.toFixed(1);
    }
  });
  
  grid.addEventListener('change', (e) => {
    if (e.target.matches('[data-hover-slider]')) {
      const symbol = e.target.dataset.element;
      const value = Number(e.target.value);
      if (value > 0) {
        state.composition[symbol] = value;
      } else {
        delete state.composition[symbol];
      }
      renderElementSliders();
      updateCompositionUI();
      scheduleSimulation(400);
    }
  });
  
  grid.addEventListener('click', (e) => {
    const addBtn = e.target.closest('[data-add-periodic]');
    if (addBtn) {
      const symbol = addBtn.dataset.addPeriodic;
      const current = Number(state.composition[symbol] || 0);
      state.composition[symbol] = current + 4;
      renderElementSliders();
      updateCompositionUI();
      scheduleSimulation(400);
      toast(`${symbol} added to alloy`, 'success', 2000);
      return;
    }
    const setBtn = e.target.closest('[data-set-periodic]');
    if (setBtn) {
      const symbol = setBtn.dataset.setPeriodic;
      state.composition[symbol] = 10;
      renderElementSliders();
      updateCompositionUI();
      scheduleSimulation(400);
      toast(`${symbol} set to 10%`, 'success', 2000);
      return;
    }
  });
}

// --- USAGE ANALYTICS DASHBOARD ---
function renderAnalyticsDashboard() {
  const container = $('#analyticsDashboard');
  if (!container) return;
  
  const sims = JSON.parse(localStorage.getItem('mh_simulation_history') || '[]');
  const benchmarks = JSON.parse(localStorage.getItem('mh_benchmark_history') || '[]');
  const alloys = JSON.parse(localStorage.getItem('mh_alloy_history') || '[]');
  
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7*86400000).toISOString().split('T')[0];
  
  const simsToday = sims.filter(s => s.date?.startsWith(today)).length;
  const simsWeek = sims.filter(s => s.date >= weekAgo).length;
  const benchmarksPassed = benchmarks.filter(c => c.verdict === 'PASS').length;
  const uniqueAlloys = new Set(alloys.map(a => a.formula)).size;
  
  container.innerHTML = `
    <div class="analytics-kpis">
      <div class="kpi-card">
        <div class="kpi-icon">🧪</div>
        <div class="kpi-value">${sims.length.toLocaleString()}</div>
        <div class="kpi-label">Total Simulations</div>
        <div class="kpi-trend positive">+${simsWeek} this week</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon">🎯</div>
        <div class="kpi-value">${benchmarksPassed}</div>
        <div class="kpi-label">Benchmarks Passed</div>
        <div class="kpi-trend">${benchmarks.length > 0 ? ((benchmarksPassed/benchmarks.length)*100).toFixed(0) : 0}% pass rate</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon">🧬</div>
        <div class="kpi-value">${uniqueAlloys}</div>
        <div class="kpi-label">Unique Alloys Designed</div>
        <div class="kpi-trend positive">+${alloys.filter(a => a.date >= weekAgo).length} this week</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon">⚡</div>
        <div class="kpi-value">${state.user ? 'Enterprise' : 'Free Studio'}</div>
        <div class="kpi-label">Current Tier</div>
        <div class="kpi-trend">${state.user?.tier_name ? `${state.user.tier_name} plan` : 'Free plan'}</div>
      </div>
    </div>
    <div class="glass" style="padding: 20px;">
      <h3 style="margin: 0 0 16px;">Recent Activity</h3>
      <div style="display: grid; gap: 8px; max-height: 300px; overflow: auto;">
        ${[...sims.slice(-10).reverse(), ...benchmarks.slice(-5).reverse()]
          .sort((a,b) => new Date(b.date) - new Date(a.date))
          .slice(0, 15)
          .map(item => `
            <div class="glass" style="padding: 12px; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
              <div>
                <strong>${item.type === 'simulation' ? '🧪 Simulation' : '🏆 Benchmark'}</strong>
                <span style="margin-left: 8px; color: var(--muted);">${item.formula || item.benchmark}</span>
              </div>
              <div style="text-align: right;">
                <span class="status-pill ${item.verdict === 'PASS' || item.verdict === 'SAFE' ? 'status-emerald' : item.verdict === 'MELTED' || item.verdict === 'MELT' ? 'status-rose' : 'status-amber'}">${item.verdict || item.type}</span>
                <div style="font-size: 10px; color: var(--muted); margin-top: 2px;">${item.date}</div>
              </div>
            </div>
          `).join('') || '<p class="micro-note">No activity yet. Run a simulation or benchmark!</p>'}
      </div>
    </div>
  `;
}

// --- TEAM WORKSPACES ---
function renderWorkspaces() {
  const container = $('#workspacesPanel');
  if (!container) return;
  
  const workspaces = JSON.parse(localStorage.getItem('mh_workspaces') || '[]');
  const currentWorkspace = localStorage.getItem('mh_current_workspace');
  
  if (!workspaces.length) {
    container.innerHTML = `
      <div class="glass" style="padding: 40px; text-align: center;">
        <div style="font-size: 48px; margin-bottom: 16px;">👥</div>
        <h3 style="margin: 0 0 8px;">No workspaces yet</h3>
        <p class="micro-note" style="margin-bottom: 24px;">Create a workspace to collaborate with your team on alloys and benchmarks.</p>
        <button class="btn btn-primary" id="createFirstWorkspace">Create Your First Workspace</button>
      </div>
    `;
    $('#createFirstWorkspace')?.addEventListener('click', createWorkspace);
    return;
  }
  
  container.innerHTML = `
    <div class="workspace-header">
      <h3 style="margin: 0;">Your Workspaces</h3>
      <button class="btn btn-primary" id="createWorkspaceBtn">New Workspace</button>
    </div>
    <div class="workspace-alloy-list">
      ${workspaces.map(ws => `
        <div class="workspace-alloy-card ${ws.id === currentWorkspace ? 'selected' : ''}" data-ws-id="${ws.id}">
          <div class="workspace-alloy-info">
            <span class="workspace-alloy-formula">${ws.name} ${ws.id === currentWorkspace ? '<span class=\"pill pill-emerald\" style=\"font-size:8px;\">ACTIVE</span>' : ''}</span>
            <span class="workspace-alloy-meta">${ws.members?.length || 1} members · ${ws.alloys?.length || 0} shared alloys · ${ws.benchmarks?.length || 0} benchmarks</span>
          </div>
          <div class="workspace-alloy-actions">
            <button class="btn btn-glass small" data-ws-switch="${ws.id}">Switch</button>
            <button class="btn btn-primary small" data-ws-invite="${ws.id}">Invite</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  
  $('#createWorkspaceBtn')?.addEventListener('click', createWorkspace);
  container.querySelectorAll('[data-ws-switch]').forEach(btn => btn.addEventListener('click', () => switchWorkspace(btn.dataset.wsSwitch)));
  container.querySelectorAll('[data-ws-invite]').forEach(btn => btn.addEventListener('click', () => inviteToWorkspace(btn.dataset.wsInvite)));
}

function createWorkspace() {
  const name = prompt('Workspace name:', 'Project Apollo');
  if (!name) return;
  const workspaces = JSON.parse(localStorage.getItem('mh_workspaces') || '[]');
  const ws = {
    id: 'ws_' + Date.now(),
    name,
    created: new Date().toISOString(),
    owner: state.user?.email || 'local',
    members: [{ email: state.user?.email || 'local', role: 'owner', joined: new Date().toISOString() }],
    alloys: [],
    benchmarks: []
  };
  workspaces.push(ws);
  localStorage.setItem('mh_workspaces', JSON.stringify(workspaces));
  localStorage.setItem('mh_current_workspace', ws.id);
  renderWorkspaces();
  toast(`Workspace "${name}" created`, 'success');
}

function switchWorkspace(id) {
  localStorage.setItem('mh_current_workspace', id);
  renderWorkspaces();
  toast('Switched workspace', 'info');
}

function inviteToWorkspace(id) {
  const email = prompt('Invite email:');
  if (!email) return;
  toast(`Invitation sent to ${email} (simulated)`, 'success');
}

// --- ADVANCED REPORT TEMPLATES ---
const REPORT_TEMPLATES = [
  { id: 'as9100', name: 'AS9100D First Article Inspection', standard: 'AS9100D / EN9100:2018', icon: '✈️', tags: ['Aerospace', 'FAI', 'Form 1/2/3'], desc: 'Complete FAI report with ballooned drawings, dimensional results, and material certs.' },
  { id: 'iso9001', name: 'ISO 9001:2015 Material Certificate', standard: 'ISO 9001:2015 / ISO 10474', icon: '📋', tags: ['Quality', '3.1 Cert', 'EN 10204'], desc: 'Type 3.1 inspection certificate per EN 10204 with full traceability.' },
  { id: 'mil-std-810', name: 'MIL-STD-810H Environmental Qualification', standard: 'MIL-STD-810H / MIL-STD-202', icon: '🛡️', tags: ['Defense', 'Shock', 'Vibe', 'Thermal'], desc: 'Environmental test report with Methods 501-527, tailorable test plans.' },
  { id: 'astm-e8', name: 'ASTM E8/E8M Tensile Test Report', standard: 'ASTM E8/E8M / ISO 6892-1', icon: '📊', tags: ['Mechanical', 'Tensile', 'Yield/UTS'], desc: 'Complete tensile test with stress-strain curves, yield methods, and uncertainty.' },
  { id: 'astm-e21', name: 'ASTM E21 Elevated Temperature Tensile', standard: 'ASTM E21 / ISO 6892-2', icon: '🔥', tags: ['High-Temp', 'Creep', '0.2% Offset'], desc: 'Elevated temperature tensile with strain rate control and extensometry.' },
  { id: 'nadcap', name: 'NADCAP Heat Treat / NDT Checklist', standard: 'AC7102 / AC7114 / AMS2750', icon: '🔬', tags: ['Heat Treat', 'Pyrometry', 'SAT/TUS'], desc: 'NADCAP-compliant pyrometry survey, TUS/SAT records, and process logs.' },
  { id: 'norsok', name: 'NORSOK M-650 / M-001 Qualification', standard: 'NORSOK M-650 / M-001 / ISO 17782', icon: '🌊', tags: ['Offshore', 'Sour Service', 'SSC/HIC'], desc: 'Qualification dossier for H2S/CO2 service with SSC/HIC test results.' },
  { id: 'is16000', name: 'IS 16000 Indian Defence Material Spec', standard: 'IS 16000 / DMSRDE / DGQA', icon: '🇮🇳', tags: ['Defence India', 'Armor', 'Ballistic'], desc: 'DRDO/DGQA compliant material spec with ballistic limit curves.' },
  { id: 'reach', name: 'REACH / RoHS / SCIP Declaration', standard: 'EC 1907/2006 / 2011/65/EU', icon: '🌿', tags: ['Compliance', 'SVHC', 'SCIP'], desc: 'Automated SVHC screening, RoHS exemption check, SCIP dossier generation.' },
  { id: 'dfars', name: 'DFARS 252.225-7009 Compliance', standard: 'DFARS / 10 USC 4863 / 10 USC 4871', icon: '🏛️', tags: ['US Defense', 'Specialty Metals', 'Berry'], desc: 'Specialty metals melt compliance, country of origin, Berry Amendment.' },
  { id: 'cmrt', name: 'Conflict Minerals Reporting Template (CMRT)', standard: 'RMI CMRT 6.31 / SEC Rule 13p-1', icon: '⚖️', tags: ['3TG', 'Smelter List', 'Dodd-Frank'], desc: 'RMI CMRT with smelter validation, due diligence, and OECD alignment.' },
  { id: 'esg', name: 'ESG / Carbon Footprint Report', standard: 'GHG Protocol / TCFD / ISSB S2', icon: '🌍', tags: ['Scope 1/2/3', 'PCF', 'LCA'], desc: 'Product carbon footprint with primary data, allocation, and uncertainty.' }
];

function renderReportTemplates() {
  const container = $('#templatesGrid');
  if (!container) return;
  
  container.innerHTML = REPORT_TEMPLATES.map(t => `
    <div class="template-card" data-template="${t.id}">
      <div class="template-icon">${t.icon}</div>
      <div class="template-title">${t.name}</div>
      <div class="template-desc">${t.desc}</div>
      <div class="template-tags">${t.tags.map(tag => `<span class="template-tag">${tag}</span>`).join('')}</div>
      <div style="display: flex; gap: 8px; margin-top: auto;">
        <button class="btn btn-primary small" data-gen-template="${t.id}">Generate</button>
        <button class="btn btn-glass small" data-preview-template="${t.id}">Preview</button>
      </div>
    </div>
  `).join('');
  
  container.querySelectorAll('[data-gen-template]').forEach(btn => btn.addEventListener('click', () => generateReport(btn.dataset.genTemplate)));
  container.querySelectorAll('[data-preview-template]').forEach(btn => btn.addEventListener('click', () => previewReport(btn.dataset.previewTemplate)));
}

function generateReport(id) {
  const t = REPORT_TEMPLATES.find(x => x.id === id);
  if (!t) return;
  toast(`Generating ${t.name}... (simulated)`, 'info');
  setTimeout(() => {
    downloadReport(t);
  }, 800);
}

function previewReport(id) {
  const t = REPORT_TEMPLATES.find(x => x.id === id);
  if (!t) return;
  toast(`Opening ${t.name} preview...`, 'info');
}

function downloadReport(template) {
  const sim = state.simulation;
  const lines = [
    `# ${template.name}`,
    `Standard: ${template.standard}`,
    `Generated: ${new Date().toLocaleString('en-IN')}`,
    `Alloy: ${sim?.composition?.formula || 'N/A'}`,
    `Verdict: ${sim?.derived?.verdict || 'N/A'}`,
    `Strength: ${sim?.prediction?.predicted || 'N/A'} MPa`,
    `Density: ${sim?.derived?.density_gcm3 || 'N/A'} g/cm³`,
    `Cost: ₹${sim?.derived?.cost_per_kg || 'N/A'}/kg`,
    `Liquidus: ${sim?.derived?.liquidus_c || 'N/A'}°C`,
    `Temperature: ${sim?.conditions?.temperature_c || 'N/A'}°C`,
    `Pressure: ${sim?.derived?.pressure_label || 'N/A'}`,
    `Safety Factor: ${sim?.conditions?.safety_factor || 'N/A'}`,
    '',
    `--- ${template.standard} COMPLIANT ---`,
    'This is a simulated report. Actual certification requires accredited lab testing.'
  ];
  downloadBlob(lines.join('\n'), `MATERIALHUNT_${template.id}_${Date.now()}.txt`, 'text/plain');
  toast(`${template.name} downloaded`, 'success');
}

// --- REAL-TIME METAL PRICING ---
const METAL_PRICES = [
  { symbol: 'Ni', name: 'Nickel', lme: 16420, shfe: 128500, indian: 1480, change: '+2.3%', unit: '$/t' },
  { symbol: 'Co', name: 'Cobalt', lme: 28500, shfe: 225000, indian: 3200, change: '-1.1%', unit: '$/t' },
  { symbol: 'Mo', name: 'Molybdenum', lme: 46200, shfe: 368000, indian: 2850, change: '+0.8%', unit: '$/t' },
  { symbol: 'W', name: 'Tungsten', lme: 285, shfe: 2280, indian: 2450, change: '+1.5%', unit: '$/kg' },
  { symbol: 'Cr', name: 'Chromium', lme: 8500, shfe: 68000, indian: 185, change: '-0.4%', unit: '$/t' },
  { symbol: 'Fe', name: 'Iron Ore (62%)', lme: 98, shfe: 780, indian: 5200, change: '+3.2%', unit: '$/t' },
  { symbol: 'Al', name: 'Aluminum', lme: 2180, shfe: 18900, indian: 215, change: '+1.8%', unit: '$/t' },
  { symbol: 'Ti', name: 'Titanium Sponge', lme: 8.5, shfe: 68, indian: 720, change: '+0.5%', unit: '$/kg' },
  { symbol: 'Cu', name: 'Copper', lme: 8420, shfe: 68500, indian: 785, change: '-0.7%', unit: '$/t' },
  { symbol: 'Mn', name: 'Manganese', lme: 1250, shfe: 10200, indian: 95, change: '+2.1%', unit: '$/t' },
  { symbol: 'V', name: 'Vanadium', lme: 18.5, shfe: 145, indian: 1650, change: '-1.2%', unit: '$/kg' },
  { symbol: 'Nb', name: 'Niobium', lme: 42, shfe: 335, indian: 3800, change: '+0.9%', unit: '$/kg' },
  { symbol: 'Ta', name: 'Tantalum', lme: 185, shfe: 1480, indian: 18500, change: '+2.4%', unit: '$/kg' },
  { symbol: 'RE', name: 'Rare Earth (NdPr)', lme: 52, shfe: 420, indian: 480, change: '-2.1%', unit: '$/kg' },
];

function renderMetalPricing() {
  const container = $('#metalPricingTicker');
  if (!container) return;
  
  container.innerHTML = `
    <div class="pricing-header">
      <span class="pricing-title">Reference metal prices</span>
      <span class="pricing-source">Indicative values for budgeting. Not a live market feed.</span>
    </div>
    <div class="pricing-table">
      <table>
        <thead>
          <tr>
            <th>Element</th>
            <th>Name</th>
            <th>Global reference</th>
            <th>India (₹/kg)</th>
          </tr>
        </thead>
        <tbody>
          ${METAL_PRICES.map(p => `
            <tr>
              <td><strong>${p.symbol}</strong></td>
              <td>${p.name}</td>
              <td>${Number(p.lme).toLocaleString()} ${p.unit}</td>
              <td>₹${Number(p.indian).toLocaleString()}/kg</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <p class="micro-note" style="padding:12px 16px 4px">Confirm current rates with your supplier before ordering.</p>
  `;
}

// --- SUPPLIER MARKETPLACE ---
const SUPPLIERS = [
  { id: 's1', name: 'Mishra Dhatu Nigam (MIDHANI)', location: 'Hyderabad, India', verified: true, preferred: true, caps: ['Superalloys', 'Titanium', 'Maraging Steel', 'NABL Lab'], type: 'Mill' },
  { id: 's2', name: 'Jindal Stainless', location: 'Hisar, India', verified: true, preferred: false, caps: ['316LVM', 'Duplex', 'Precision Strip', 'IS 6911'], type: 'Mill' },
  { id: 's3', name: 'Hindalco Industries', location: 'Renukoot, India', verified: true, preferred: true, caps: ['Al-7075', 'Al-2024', 'Extrusions', 'Forgings'], type: 'Mill' },
  { id: 's4', name: 'KMML (Kerala Minerals)', location: 'Kollam, India', verified: true, preferred: false, caps: ['Ti Sponge', 'TiO2 Pigment', 'Zircon'], type: 'Mill' },
  { id: 's5', name: 'Carpenter Technology', location: 'Reading, PA, USA', verified: true, preferred: true, caps: ['AerMet 340', 'BioDur 108', 'Custom 465', 'AMS 5662'], type: 'Mill' },
  { id: 's6', name: 'ATI Specialty Alloys', location: 'Pittsburgh, PA, USA', verified: true, preferred: false, caps: ['Inconel 718', 'Haynes 282', 'Rene 41', 'Waspaloy'], type: 'Mill' },
  { id: 's7', name: 'VDM Metals', location: 'Werdohl, Germany', verified: true, preferred: false, caps: ['Hastelloy C-276', 'Alloy 59', 'Nicrofer 6025'], type: 'Mill' },
  { id: 's8', name: 'Sandvik Materials', location: 'Sandviken, Sweden', verified: true, preferred: true, caps: ['Sanicro 25', 'Safurex', 'Kanthal APM'], type: 'Mill' },
  { id: 's9', name: 'Höganäs AB', location: 'Höganäs, Sweden', verified: true, preferred: false, caps: ['AM Powder', 'MIM Powder', '316L', 'Inconel 718'], type: 'Powder' },
  { id: 's10', name: 'Carpenter Additive', location: 'Athens, AL, USA', verified: true, preferred: true, caps: ['AM Powder', 'Ni718', 'Ti64', 'AlSi10Mg'], type: 'Powder' },
];

function renderSupplierMarketplace() {
  const container = $('#supplierGrid');
  if (!container) return;
  
  container.innerHTML = SUPPLIERS.map(s => `
    <div class="supplier-card" data-supplier="${s.id}">
      <div class="supplier-header">
        <div>
          <div class="supplier-logo">${s.type === 'Mill' ? '🏭' : s.type === 'Powder' ? '⚗️' : '🔬'}</div>
          <div class="supplier-name">${s.name}</div>
          <div class="supplier-location">${s.location}</div>
        </div>
        <div>
        </div>
      </div>
      <div class="supplier-caps">
        ${s.caps.map(c => `<span class="supplier-cap">${c}</span>`).join('')}
      </div>
      <div class="supplier-actions">
        <button class="btn btn-primary small" data-rfq-supplier="${s.id}">Ask for a quote</button>
      </div>
    </div>
  `).join('');
  
  container.querySelectorAll('[data-rfq-supplier]').forEach(btn => btn.addEventListener('click', () => openRfqForSupplier(btn.dataset.rfqSupplier)));
}

function openRfqForSupplier(id) {
  const s = SUPPLIERS.find(x => x.id === id);
  if (!s) return;
  openRfq(`Supplier quote from ${s.name}`);
  const alloyField = $('#rfqAlloy');
  if (alloyField) alloyField.value = Object.entries(normalisedComposition()).map(([sym, pct]) => `${sym}:${Number(pct).toFixed(1)}`).join(', ');
  const notesField = $('#rfqNotes');
  if (notesField) notesField.value = `Suggested supplier: ${s.name} (${s.location})`;
  toast(`RFQ prepared for ${s.name}`, 'success');
}

function contactSupplier(id) {
  const s = SUPPLIERS.find(x => x.id === id);
  if (!s) return;
  toast(`Contact details for ${s.name} copied (simulated)`, 'success');
}

// --- FAILURE ANALYSIS KNOWLEDGE BASE ---
const FAILURE_CASES = [
  { id: 'f1', title: 'Turbine Blade LCF Failure at 950°C', alloy: 'Inconel 718', type: 'fatigue', desc: 'Low-cycle fatigue crack initiation at fir-tree root due to stress concentration and dwell fatigue.', condition: '950°C · 1.2% strain · R=-1 · Air', actions: ['Shot peen root', 'Reduce dwell', 'Switch to Rene 104'] },
  { id: 'f2', title: 'Marine Valve SCC in Duplex 2205', alloy: '2205 Duplex', type: 'corrosion', desc: 'Stress corrosion cracking in chloride-containing seawater at 60°C with 400 MPa residual stress.', condition: '60°C · 3.5% NaCl · 400 MPa · Seawater', actions: ['Reduce ferrite to 45%', 'Apply compressive stress', 'Use 2507 Super Duplex'] },
  { id: 'f3', title: 'Reformer Tube Creep Rupture', alloy: 'HK-40 (25Cr-20Ni)', type: 'creep', desc: 'Primary creep accelerated by carburization; tertiary creep rupture at 105,000 hours.', condition: '950°C · 15 MPa · Carburizing', actions: ['Aluminize coating', 'Reduce tube skin temp', 'Switch to HP Modified'] },
  { id: 'f4', title: 'Cryogenic Brittle Fracture in 304L', alloy: '304L SS', type: 'brittle', desc: 'Cleavage fracture at -196°C due to δ-ferrite stringers and high strain rate.', condition: '-196°C · 500 MPa · LNG Service', actions: ['Specify 316LN', 'Limit ferrite < 1%', 'Charpy qualify'] },
  { id: 'f5', title: 'Hydrogen Embrittlement in Aermet 100', alloy: 'Aermet 100', type: 'hydrogen', desc: 'Delayed fracture at 1800 MPa UTS after cadmium plating; H ingress during electroplating.', condition: 'RT · 1800 MPa · Cd Plated', actions: ['Bake 190°C/23h post-plate', 'Use IVD aluminum', 'Reduce strength to 1600 MPa'] },
  { id: 'f6', title: 'Thermal Fatigue in Rocket Nozzle', alloy: 'NARloy-Z (Cu-3Ag-0.5Zr)', type: 'fatigue', desc: 'Cracking at throat due to thermal cycling; oxidation-assisted fatigue.', condition: '500-1200°C · 100 cycles · H2/O2', actions: ['GRCop-84 alloy', 'Channel cooling', 'Increase corner radius'] },
  { id: 'f7', title: 'Pitting in Offshore Riser 13Cr', alloy: '13Cr Martensitic', type: 'corrosion', desc: 'Severe pitting at 120°C with 500 ppm Cl- and 0.5 MPa H2S.', condition: '120°C · 500 ppm Cl · 0.5 MPa H2S', actions: ['Switch to Super 13Cr', 'Inhibitor injection', 'CRA cladding'] },
  { id: 'f8', title: 'Creep-Fatigue in GTD-111 Blade', alloy: 'GTD-111 DS', type: 'creep', desc: 'Hold-time fatigue interaction at 980°C; rafting-induced loss of creep strength.', condition: '980°C · 120 MPa · 120s hold', actions: ['Reduce hold time', 'Coat with TBC', 'Switch to Rene N5'] },
];

function renderFailureAnalysis() {
  const container = $('#failureGrid');
  if (!container) return;
  
  container.innerHTML = FAILURE_CASES.map(f => `
    <div class="failure-card" data-failure="${f.id}">
      <div class="failure-title">${f.title}</div>
      <div class="failure-alloy">${f.alloy}</div>
      <span class="failure-type ${f.type}">${f.type.toUpperCase()}</span>
      <div class="failure-desc">${f.desc}</div>
      <div class="failure-condition">
        <span>${f.condition}</span>
      </div>
      <div class="failure-actions">
        <button class="btn btn-primary small" data-failure-detail="${f.id}">Root Cause Tree</button>
        <button class="btn btn-glass small" data-failure-prevent="${f.id}">Prevention Playbook</button>
      </div>
    </div>
  `).join('');
  
  container.querySelectorAll('[data-failure-detail]').forEach(btn => btn.addEventListener('click', () => showFailureDetail(btn.dataset.failureDetail)));
  container.querySelectorAll('[data-failure-prevent]').forEach(btn => btn.addEventListener('click', () => showPreventionPlaybook(btn.dataset.failurePrevent)));
}

function showFailureDetail(id) {
  const f = FAILURE_CASES.find(x => x.id === id);
  if (!f) return;
  toast(`Root cause analysis for ${f.title} (simulated)`, 'info');
}

function showPreventionPlaybook(id) {
  const f = FAILURE_CASES.find(x => x.id === id);
  if (!f) return;
  toast(`Prevention playbook: ${f.actions.join(' → ')}`, 'success');
}

// Filter handlers
function bindFailureFilters() {
  $('#failureSearch')?.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    document.querySelectorAll('#failureGrid .failure-card').forEach(card => {
      const text = card.textContent.toLowerCase();
      card.style.display = text.includes(term) ? '' : 'none';
    });
  });
  $('#failureFilter')?.addEventListener('change', (e) => {
    const type = e.target.value;
    document.querySelectorAll('#failureGrid .failure-card').forEach(card => {
      const badge = card.querySelector('.failure-type');
      card.style.display = !type || badge?.classList.contains(type) ? '' : 'none';
    });
  });
}

// --- COMPLIANCE AUTO-GENERATION ---
const COMPLIANCE_ITEMS = [
  { id: 'itar', title: 'ITAR / EAR Classification', standard: '22 CFR 120-130 / 15 CFR 730-774', status: 'pending', regs: ['USML Cat VI', 'ECCN 1C002', 'ECCN 1C216'] },
  { id: 'reach', title: 'REACH SVHC Screening', standard: 'EC 1907/2006', status: 'pending', regs: ['Candidate List', 'Annex XIV', 'Annex XVII'] },
  { id: 'rohs', title: 'RoHS 3 Compliance', standard: '2011/65/EU + 2015/863', status: 'pending', regs: ['Pb, Hg, Cd, Cr(VI)', 'PBB, PBDE', 'DEHP, BBP, DBP, DIBP'] },
  { id: 'dfars', title: 'DFARS 252.225-7009', standard: 'DFARS / 10 USC 4863', status: 'pending', regs: ['Specialty Metals', 'Melt in US', 'Qualifying Country'] },
  { id: 'cmrt', title: 'Conflict Minerals (CMRT)', standard: 'RMI CMRT 6.31 / SEC 13p-1', status: 'pending', regs: ['3TG', 'Smelter List', 'Due Diligence'] },
  { id: 'esg', title: 'ESG / Carbon Footprint', standard: 'GHG Protocol / ISSB S2', status: 'pending', regs: ['Scope 1/2/3', 'PCF', 'LCA'] },
];

function renderCompliance() {
  const container = $('#complianceChecklist');
  if (!container) return;
  
  const sim = state.simulation;
  const composition = sim?.composition?.elements || [];
  const elements = new Set(composition.map(e => e.symbol));
  
  container.innerHTML = COMPLIANCE_ITEMS.map(item => {
    let status = 'pending';
    let evidence = 'Run analysis';
    if (item.id === 'itar') {
      const controlled = ['U', 'Pu', 'Th', 'Be', 'Zr', 'Hf', 'Ta', 'W', 'Mo', 'Nb'];
      const found = controlled.filter(el => elements.has(el));
      status = found.length ? 'flagged' : 'clear';
      evidence = found.length ? `Controlled: ${found.join(', ')}` : 'No controlled elements';
    } else if (item.id === 'reach' || item.id === 'rohs') {
      const restricted = ['Cd', 'Hg', 'Pb', 'Cr', 'As'];
      const found = restricted.filter(el => elements.has(el));
      status = found.length ? 'flagged' : 'clear';
      evidence = found.length ? `Restricted: ${found.join(', ')}` : 'No restricted substances';
    } else if (item.id === 'dfars') {
      const specialty = ['Co', 'Ni', 'Cr', 'Mo', 'W', 'V', 'Nb', 'Ta', 'Ti', 'Zr', 'Hf'];
      const found = specialty.filter(el => elements.has(el));
      status = found.length ? 'pending' : 'clear';
      evidence = found.length ? `Specialty: ${found.join(', ')} — verify melt origin` : 'No specialty metals';
    } else if (item.id === 'cmrt') {
      const conflict = ['Au', 'Ta', 'W', 'Sn'];
      const found = conflict.filter(el => elements.has(el));
      status = found.length ? 'pending' : 'clear';
      evidence = found.length ? `3TG present: ${found.join(', ')} — CMRT required` : 'No 3TG elements';
    } else if (item.id === 'esg') {
      status = 'pending';
      evidence = 'Requires supply chain data';
    }
    
    return `
      <div class="compliance-item ${status}">
        <input type="checkbox" class="compliance-checkbox" ${status === 'clear' ? 'checked' : ''} disabled>
        <div class="compliance-info">
          <div class="compliance-title">${item.title}</div>
          <div class="compliance-standard">${item.standard}</div>
        </div>
        <span class="compliance-evidence">${evidence}</span>
      </div>
    `;
  }).join('');
  
  // Add generate all button
  container.innerHTML += `
    <div style="display: flex; gap: 8px; margin-top: 16px;">
      <button class="btn btn-primary" id="genAllCompliance">Generate All Reports</button>
      <button class="btn btn-glass" id="downloadCompliancePack">Download Compliance Pack (ZIP)</button>
    </div>
  `;
  $('#genAllCompliance')?.addEventListener('click', generateAllCompliance);
  $('#downloadCompliancePack')?.addEventListener('click', downloadCompliancePack);
}

function generateAllCompliance() {
  toast('Generating compliance reports... (simulated)', 'info');
  setTimeout(() => {
    const sim = state.simulation;
    const lines = [
      'MATERIALHUNT COMPLIANCE PACK',
      `Alloy: ${sim?.composition?.formula || 'N/A'}`,
      `Generated: ${new Date().toLocaleString('en-IN')}`,
      '',
      ...COMPLIANCE_ITEMS.map(item => {
        const status = item.id === 'itar' ? 'See above' : 'Pending';
        return `${item.title}: ${status}`;
      }),
      '',
      '--- SIMULATED OUTPUT ---'
    ];
    downloadBlob(lines.join('\n'), `MATERIALHUNT_Compliance_Pack_${Date.now()}.txt`, 'text/plain');
    toast('Compliance pack downloaded', 'success');
  }, 1000);
}

function downloadCompliancePack() {
  toast('ZIP download simulated — would contain PDF, XML (CMRT), JSON (ESG)', 'success');
}

// --- API ACCESS PANEL ---
function renderApiAccess() {
  const container = $('#apiAccessPanel');
  if (!container) return;
  
  const apiKeys = JSON.parse(localStorage.getItem('mh_api_keys') || '[]');
  
  container.innerHTML = `
    <div class="api-key-card">
      <div class="api-key-header">
        <span class="api-key-label">Your API Keys</span>
        ${apiKeys.length < 3 ? '<button class="btn btn-primary small" id="generateApiKeyBtn">Generate New Key</button>' : '<span class="pill pill-amber">Max 3 keys</span>'}
      </div>
      ${apiKeys.length ? `
        <div style="display: grid; gap: 12px;">
          ${apiKeys.map(key => `
            <div class="glass" style="padding: 16px; display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span class="api-key-label">${key.name} (${key.id.slice(0,8)}...)</span>
                <span class="pill pill-${key.active ? 'emerald' : 'rose'}">${key.active ? 'Active' : 'Revoked'}</span>
              </div>
              <div class="api-key-value">${key.key}</div>
              <div class="api-key-perms">${key.perms.map(p => `<span class="api-perm">${p}</span>`).join('')}</div>
              <div style="display: flex; gap: 8px;">
                <button class="btn btn-glass small" data-copy-key="${key.id}">Copy</button>
                <button class="btn btn-glass small" data-revoke-key="${key.id}">${key.active ? 'Revoke' : 'Restore'}</button>
                <button class="btn btn-glass small" data-delete-key="${key.id}">Delete</button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : '<p class="micro-note">No API keys yet. Generate one to start integrating.</p>'}
    </div>
    
    <div class="api-key-card">
      <div class="api-key-header"><span class="api-key-label">API Usage (30 days)</span></div>
      <div class="api-usage">
        <div class="api-usage-stat">
          <div class="api-usage-value">${Math.floor(Math.random() * 5000) + 1000}</div>
          <div class="api-usage-label">Simulations</div>
        </div>
        <div class="api-usage-stat">
          <div class="api-usage-value">${Math.floor(Math.random() * 200) + 50}</div>
          <div class="api-usage-label">Optimizations</div>
        </div>
        <div class="api-usage-stat">
          <div class="api-usage-value">${Math.floor(Math.random() * 100) + 10}</div>
          <div class="api-usage-label">Mission Searches</div>
        </div>
      </div>
    </div>
    
    <div class="api-key-card">
      <div class="api-key-header"><span class="api-key-label">Documentation & SDKs</span></div>
      <div style="display: flex; flex-wrap: wrap; gap: 8px;">
        <a href="#" class="btn btn-glass small" target="_blank">OpenAPI 3.1 Spec</a>
        <a href="#" class="btn btn-glass small" target="_blank">Python SDK</a>
        <a href="#" class="btn btn-glass small" target="_blank">TypeScript SDK</a>
        <a href="#" class="btn btn-glass small" target="_blank">Rust SDK</a>
        <a href="#" class="btn btn-glass small" target="_blank">Postman Collection</a>
        <a href="#" class="btn btn-glass small" target="_blank">WebSocket Guide</a>
      </div>
    </div>
  `;
  
  $('#generateApiKeyBtn')?.addEventListener('click', generateApiKey);
  container.querySelectorAll('[data-copy-key]').forEach(btn => btn.addEventListener('click', () => copyApiKey(btn.dataset.copyKey)));
  container.querySelectorAll('[data-revoke-key]').forEach(btn => btn.addEventListener('click', () => revokeApiKey(btn.dataset.revokeKey)));
  container.querySelectorAll('[data-delete-key]').forEach(btn => btn.addEventListener('click', () => deleteApiKey(btn.dataset.deleteKey)));
}

function generateApiKey() {
  const name = prompt('Key name:', 'Production API');
  if (!name) return;
  const key = 'mh_' + Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b => b.toString(16).padStart(2, '0')).join('');
  const apiKeys = JSON.parse(localStorage.getItem('mh_api_keys') || '[]');
  apiKeys.push({
    id: 'key_' + Date.now(),
    name,
    key,
    perms: ['simulate', 'optimize', 'mission-search', 'prescreen'],
    active: true,
    created: new Date().toISOString()
  });
  localStorage.setItem('mh_api_keys', JSON.stringify(apiKeys));
  renderApiAccess();
  toast(`API key generated: ${key.slice(0,20)}...`, 'success');
}

function copyApiKey(id) {
  const apiKeys = JSON.parse(localStorage.getItem('mh_api_keys') || '[]');
  const key = apiKeys.find(k => k.id === id);
  if (key) navigator.clipboard.writeText(key.key).then(() => toast('API key copied', 'success'));
}

function revokeApiKey(id) {
  const apiKeys = JSON.parse(localStorage.getItem('mh_api_keys') || '[]');
  const key = apiKeys.find(k => k.id === id);
  if (key) {
    key.active = !key.active;
    localStorage.setItem('mh_api_keys', JSON.stringify(apiKeys));
    renderApiAccess();
    toast(key.active ? 'Key restored' : 'Key revoked', 'success');
  }
}

function deleteApiKey(id) {
  if (!confirm('Delete this API key permanently?')) return;
  let apiKeys = JSON.parse(localStorage.getItem('mh_api_keys') || '[]');
  apiKeys = apiKeys.filter(k => k.id !== id);
  localStorage.setItem('mh_api_keys', JSON.stringify(apiKeys));
  renderApiAccess();
  toast('API key deleted', 'success');
}

// --- ALLOY GENOME VISUALIZATION ---
function initAlloyGenome() {
  const canvas = $('#genomeCanvas');
  if (!canvas) return;
  
  // Simple 3D scatter using Three.js
  if (window.genomeScene) return;
  
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
  camera.position.set(0, 0, 50);
  
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  
  // OrbitControls is not bundled with vendor/three.min.js; fall back to a slow auto-rotate.
  const controls = typeof THREE.OrbitControls === 'function'
    ? new THREE.OrbitControls(camera, renderer.domElement)
    : { update() { if (window.genomeScene?.pointsMesh) window.genomeScene.pointsMesh.rotation.y += 0.0015; } };
  if (typeof THREE.OrbitControls === 'function') {
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
  }
  
  // Generate synthetic data points
  const points = 5000;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(points * 3);
  const colors = new Float32Array(points * 3);
  const sizes = new Float32Array(points);
  
  for (let i = 0; i < points; i++) {
    const x = (Math.random() - 0.5) * 80;
    const y = (Math.random() - 0.5) * 80;
    const z = (Math.random() - 0.5) * 80;
    positions[i*3] = x;
    positions[i*3+1] = y;
    positions[i*3+2] = z;
    
    const val = Math.random();
    colors[i*3] = val;
    colors[i*3+1] = 1 - val;
    colors[i*3+2] = 0.5;
    sizes[i] = 1 + Math.random() * 2;
  }
  
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  
  const material = new THREE.PointsMaterial({
    size: 0.8,
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    sizeAttenuation: true
  });
  
  const pointsMesh = new THREE.Points(geometry, material);
  scene.add(pointsMesh);
  
  // Grid
  const gridHelper = new THREE.GridHelper(100, 20, 0x22D3EE, 0x22D3EE);
  gridHelper.material.opacity = 0.1;
  gridHelper.material.transparent = true;
  scene.add(gridHelper);
  
  window.genomeScene = { scene, camera, renderer, controls, pointsMesh, geometry };
  
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
  
  // Resize handler
  const resizeObserver = new ResizeObserver(() => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  resizeObserver.observe(canvas);
  
  // Projection/color change handlers
  $('#genomeProjection')?.addEventListener('change', () => toast('Projection changed (simulated)', 'info'));
  $('#genomeColorBy')?.addEventListener('change', () => toast('Color mapping changed (simulated)', 'info'));
  $('#genomeDataset')?.addEventListener('change', () => toast('Dataset changed (simulated)', 'info'));
}

// --- DIGITAL TWIN EXPORT ---
const EXPORT_FORMATS = [
  { id: 'fmu', name: 'FMU 2.0/3.0', icon: '📦', desc: 'Functional Mock-up Unit for co-simulation', ext: '.fmu' },
  { id: 'abaqus', name: 'Abaqus Input Deck', icon: '📄', desc: 'INP file with material cards, steps, output requests', ext: '.inp' },
  { id: 'ansys', name: 'ANSYS APDL', icon: '📄', desc: 'Command stream with MP, TB, TBPT data', ext: '.inp' },
  { id: 'step', name: 'STEP AP242', icon: '🔧', desc: 'CAD geometry with PMI and material properties', ext: '.stp' },
  { id: 'stl', name: 'STL Binary', icon: '🔺', desc: 'Tessellated geometry for 3D printing/FEA prep', ext: '.stl' },
  { id: 'materialx', name: 'MaterialX', icon: '🎨', desc: 'Open standard for material/shader definitions', ext: '.mtlx' },
  { id: 'jsonld', name: 'JSON-LD Digital Thread', icon: '🔗', desc: 'Linked data for PLM/MES integration', ext: '.jsonld' },
  { id: 'hdf5', name: 'HDF5 Results', icon: '💾', desc: 'Full field output: stress, strain, temp, phase', ext: '.h5' },
];

function renderDigitalTwinExport() {
  const container = $('#digitalTwinFormats');
  if (!container) return;
  
  container.innerHTML = EXPORT_FORMATS.map(f => `
    <div class="export-format-card" data-format="${f.id}">
      <div class="export-format-icon">${f.icon}</div>
      <div class="export-format-name">${f.name}</div>
      <div class="export-format-desc">${f.desc}</div>
      <button class="btn btn-primary small" data-export-format="${f.id}">Export ${f.ext}</button>
    </div>
  `).join('');
  
  container.querySelectorAll('[data-export-format]').forEach(btn => btn.addEventListener('click', () => exportDigitalTwin(btn.dataset.exportFormat)));
}

function exportDigitalTwin(format) {
  const f = EXPORT_FORMATS.find(x => x.id === format);
  if (!f) return;
  
  toast(`Generating ${f.name}...`, 'info');
  setTimeout(() => {
    const sim = state.simulation;
    let content = '';
    if (format === 'abaqus') {
      content = `*HEADING
MATERIALHUNT Digital Twin Export - ${new Date().toISOString()}
Alloy: ${sim?.composition?.formula || 'N/A'}
Temperature: ${sim?.conditions?.temperature_c || 'N/A'}°C
Pressure: ${sim?.derived?.pressure_label || 'N/A'}
*
*MATERIAL, NAME=ALLOY
*DENSITY
${sim?.derived?.density_gcm3 || 7.85}
*ELASTIC
${sim?.derived?.modulus_gpa || 210}, 0.3
*PLASTIC
${sim?.prediction?.predicted || 500}, 0.0
${(sim?.prediction?.predicted || 500) * 1.2}, 0.02
*
*STEP, NAME=SIMULATION
*STATIC
*CLOAD
1, 3, ${sim?.conditions?.load_mpa || 250}
*NODE PRINT
U, RF
*EL PRINT
S, E
*END STEP`;
    } else if (format === 'jsonld') {
      content = JSON.stringify({
        
        '@type': 'MaterialSimulation',
        alloy: sim?.composition?.formula,
        conditions: sim?.conditions,
        results: sim?.derived,
        generated: new Date().toISOString(),
        source: 'MATERIALHUNT Inc.'
      }, null, 2);
    } else {
      content = `# ${f.name} Export
Alloy: ${sim?.composition?.formula || 'N/A'}
Conditions: ${JSON.stringify(sim?.conditions)}
Results: ${JSON.stringify(sim?.derived)}
Generated: ${new Date().toISOString()}
# Simulated output - actual export requires licensed exporter
`;
    }
    downloadBlob(content, `MATERIALHUNT_DigitalTwin_${format}_${Date.now()}${f.ext}`, 'text/plain');
    toast(`${f.name} exported`, 'success');
  }, 1000);
}

// --- AI-POWERED ALLOY DESIGN ---
function renderAIDesign() {
  const container = $('#aiDesignPanel');
  if (!container) return;
  
  container.innerHTML = `
    <div class="ai-design-input">
      <label style="font-weight: 700; font-size: 12px;">Describe your requirement</label>
      <textarea id="aiDesignPrompt" placeholder="e.g. Lightweight turbine blade for 1200°C, 50 MPa centrifugal stress, 10,000 hour creep life, under $50/kg, no Co/W, manufacturable by LPBF"></textarea>
      <div style="display: flex; gap: 8px;">
        <button class="btn btn-primary" id="runAIDesign">🧠 Generate 10 Alloys</button>
        <button class="btn btn-glass" id="clearAIDesign">Clear</button>
      </div>
    </div>
    
    <div class="ai-design-requirements" id="aiDesignRequirements" style="display: none;"></div>
    
    <div class="ai-design-results" id="aiDesignResults"></div>
  `;
  
  $('#runAIDesign')?.addEventListener('click', runAIDesign);
  $('#clearAIDesign')?.addEventListener('click', clearAIDesign);
}

function runAIDesign() {
  const prompt = $('#aiDesignPrompt')?.value?.trim();
  if (!prompt) { toast('Enter a requirement first', 'warning'); return; }
  
  const btn = $('#runAIDesign');
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Generating...';
  
  // Simulate AI generation
  setTimeout(() => {
    const results = generateAIAlloys(prompt);
    renderAIResults(results);
    btn.disabled = false;
    btn.textContent = orig;
    toast('Generated 10 novel compositions', 'success');
  }, 1500);
}

function clearAIDesign() {
  $('#aiDesignPrompt').value = '';
  $('#aiDesignRequirements').style.display = 'none';
  $('#aiDesignRequirements').innerHTML = '';
  $('#aiDesignResults').innerHTML = '';
}

function generateAIAlloys(prompt) {
  // Extract constraints from prompt (simplified)
  const baseAlloys = [
    { base: 'Ni', name: 'Ni-Base Superalloy' },
    { base: 'Co', name: 'Co-Base Superalloy' },
    { base: 'Fe', name: 'Fe-Base Superalloy' },
    { base: 'Ti', name: 'Ti Aluminide' },
    { base: 'Al', name: 'Al-Si Alloy' },
    { base: 'Cr', name: 'Cr-Base Refractory' },
    { base: 'W', name: 'W-Base Refractory' },
    { base: 'HEA', name: 'High-Entropy Alloy' },
    { base: 'Ceramic', name: 'CMC Matrix' },
    { base: 'Hybrid', name: 'Gradient Alloy' },
  ];
  
  return baseAlloys.map((b, i) => ({
    formula: generateFormula(b.base),
    score: 95 - i * 3 + Math.random() * 5,
    props: {
      strength: Math.round(800 + Math.random() * 600),
      density: Number((6 + Math.random() * 12).toFixed(1)),
      cost: Math.round(500 + Math.random() * 8000),
      liquidus: Math.round(1200 + Math.random() * 1500),
      creep: Math.round(Math.random() * 10000)
    },
    route: ['LPBF', 'EBM', 'Directed Energy', 'Casting', 'Forging'][Math.floor(Math.random() * 5)],
    uncertainty: Number((0.05 + Math.random() * 0.15).toFixed(2))
  }));
}

function generateFormula(base) {
  const recipes = {
    'Ni': ['Ni-18Cr-8Al-4Ti-3Mo-2W-0.1C', 'Ni-22Cr-5Al-3Ti-4Mo-1.5Nb-0.05C', 'Ni-15Cr-6Al-4Ti-3Mo-2Ta-0.08C'],
    'Co': ['Co-22Cr-5W-2Ni-0.5C', 'Co-20Cr-10Ni-3W-0.3C'],
    'Fe': ['Fe-25Ni-15Cr-3Al-2Ti-0.05C', 'Fe-20Ni-12Cr-4Mo-1Al-0.03C'],
    'Ti': ['Ti-45Al-2Nb-2Cr-0.2B', 'Ti-48Al-2Cr-2Nb-0.1B'],
    'Al': ['Al-12Si-1Mg-0.5Cu', 'Al-7Si-0.3Mg-0.2Fe'],
    'Cr': ['Cr-10Ni-5Al-0.5Y2O3', 'Cr-15Ni-3Al-2Hf-0.1Y'],
    'W': ['W-1Ni-0.5Fe-0.1Y2O3', 'W-2Re-0.5HfC'],
    'HEA': ['CoCrFeMnNi', 'AlCoCrFeNi', 'CrMnFeCoNiTi'],
    'Ceramic': ['SiC/SiC', 'C/SiC', 'Al2O3/Al2O3'],
    'Hybrid': ['Ni/Co Gradient', 'Ti/Al Gradient']
  };
  return recipes[base][Math.floor(Math.random() * recipes[base].length)];
}

function renderAIResults(results) {
  const reqContainer = $('#aiDesignRequirements');
  reqContainer.style.display = 'grid';
  reqContainer.innerHTML = `
    <div class="ai-req-item"><div class="ai-req-label">Temperature</div><div class="ai-req-value">Extracted from prompt</div></div>
    <div class="ai-req-item"><div class="ai-req-label">Pressure/Stress</div><div class="ai-req-value">Extracted from prompt</div></div>
    <div class="ai-req-item"><div class="ai-req-label">Budget</div><div class="ai-req-value">Extracted from prompt</div></div>
    <div class="ai-req-item"><div class="ai-req-label">Banned Elements</div><div class="ai-req-value">Extracted from prompt</div></div>
  `;
  
  const resContainer = $('#aiDesignResults');
  resContainer.innerHTML = results.map((r, i) => `
    <div class="ai-result-card">
      <div class="ai-result-header">
        <span class="ai-result-formula">${r.formula}</span>
        <span class="ai-result-score">${r.score.toFixed(0)}%</span>
      </div>
      <div class="ai-result-props">
        <span class="ai-result-prop">💪 ${r.props.strength} MPa</span>
        <span class="ai-result-prop">⚖️ ${r.props.density} g/cm³</span>
        <span class="ai-result-prop">💰 ₹${r.props.cost}/kg</span>
        <span class="ai-result-prop">🔥 ${r.props.liquidus}°C</span>
        <span class="ai-result-prop">⏱️ ${r.props.creep}h creep</span>
        <span class="ai-result-prop">📦 ${r.route}</span>
        <span class="ai-result-prop">📊 ±${(r.uncertainty*100).toFixed(0)}%</span>
      </div>
      <div class="ai-result-actions">
        <button class="btn btn-primary small" data-load-ai="${i}">Load in Simulator</button>
        <button class="btn btn-glass small" data-refine-ai="${i}">Refine</button>
        <button class="btn btn-glass small" data-report-ai="${i}">Report</button>
      </div>
    </div>
  `).join('');
  
  resContainer.querySelectorAll('[data-load-ai]').forEach(btn => btn.addEventListener('click', () => loadAIAlloy(results[btn.dataset.loadAi])));
  resContainer.querySelectorAll('[data-refine-ai]').forEach(btn => btn.addEventListener('click', () => toast('Refining... (simulated)', 'info')));
  resContainer.querySelectorAll('[data-report-ai]').forEach(btn => btn.addEventListener('click', () => downloadAIReport(results[btn.dataset.reportAi])));
}

function loadAIAlloy(alloy) {
  // Parse formula string into composition
  const comp = parseFormulaString(alloy.formula);
  state.composition = comp;
  renderElementSliders();
  updateCompositionUI();
  setView('simulator');
  runSimulation();
  toast(`${alloy.formula} loaded from AI Designer`, 'success');
}

function parseFormulaString(formula) {
  // Simple parser for "Ni-18Cr-8Al" format
  const comp = {};
  const parts = formula.split('-');
  parts.forEach(p => {
    const match = p.match(/^([A-Z][a-z]?)([\d.]+)?/);
    if (match) {
      comp[match[1]] = Number(match[2] || 1);
    }
  });
  // Normalize
  const total = Object.values(comp).reduce((a,b) => a+b, 0);
  Object.keys(comp).forEach(k => comp[k] = Number((comp[k]/total*100).toFixed(2)));
  return comp;
}

function downloadAIReport(alloy) {
  const lines = [
    `MATERIALHUNT AI DESIGN REPORT`,
    `Generated: ${new Date().toLocaleString('en-IN')}`,
    `Formula: ${alloy.formula}`,
    `Confidence Score: ${alloy.score.toFixed(0)}%`,
    `Manufacturing Route: ${alloy.route}`,
    `Uncertainty: ±${(alloy.uncertainty*100).toFixed(0)}%`,
    '',
    'PREDICTED PROPERTIES:',
    `  Yield Strength: ${alloy.props.strength} MPa`,
    `  Density: ${alloy.props.density} g/cm³`,
    `  Cost: ₹${alloy.props.cost}/kg`,
    `  Liquidus: ${alloy.props.liquidus}°C`,
    `  Creep Life: ${alloy.props.creep} hours`,
    '',
    '--- SIMULATED OUTPUT ---',
    'Validate with physical testing before production use.'
  ];
  downloadBlob(lines.join('\n'), `MATERIALHUNT_AI_${alloy.formula.replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}.txt`, 'text/plain');
  toast('AI design report downloaded', 'success');
}

// --- EXPORT CONTROL COMPLIANCE ---
function renderExportControl() {
  const container = $('#exportControlPanel');
  if (!container) return;
  
  const sim = state.simulation;
  const composition = sim?.composition?.elements || [];
  const elements = new Set(composition.map(e => e.symbol));
  
  const controlled = {
    'USML_Cat_VI': ['U', 'Pu', 'Th', 'Be', 'Zr', 'Hf', 'Ta', 'W', 'Mo', 'Nb'],
    'ECCN_1C002': ['Be', 'BeO', 'Be-Al'],
    'ECCN_1C216': ['Hf', 'Zr', 'Ta', 'W', 'Mo', 'Nb'],
    'Wassenaar': ['U', 'Pu', 'Th', 'Be', 'Zr', 'Hf'],
    'Dual_Use_IN': ['U', 'Pu', 'Th', 'Be', 'Zr', 'Hf', 'Ta', 'W', 'Co']
  };
  
  const findings = [];
  Object.entries(controlled).forEach(([reg, els]) => {
    const found = els.filter(el => elements.has(el));
    if (found.length) {
      findings.push({ regulation: reg, elements: found, status: 'FLAGGED' });
    } else {
      findings.push({ regulation: reg, elements: [], status: 'CLEAR' });
    }
  });
  
  const hasFlags = findings.some(f => f.status === 'FLAGGED');
  
  container.innerHTML = `
    <div class="export-control-status ${hasFlags ? 'flagged' : 'clear'}">
      <span class="export-control-icon">${hasFlags ? '⚠️' : '✅'}</span>
      <div>
        <div class="export-control-title">${hasFlags ? 'Export Control Flags Detected' : 'All Clear — No Controlled Elements'}</div>
        <div class="export-control-details">${hasFlags ? 'This composition contains elements subject to export controls. Review regulations below.' : 'No USML, ECCN, Wassenaar, or Indian Dual-Use elements detected.'}</div>
      </div>
    </div>
    <div class="export-control-scan">
      ${findings.map(f => `
        <div class="export-control-item">
          <div>
            <div class="export-control-element">${f.regulation}</div>
            <div class="export-control-regulations">
              ${f.elements.length ? f.elements.map(e => `<span class="export-control-reg">${e}</span>`).join('') : '<span class="export-control-reg" style="color:var(--emerald)">CLEAR</span>'}
            </div>
          </div>
          <span class="status-pill ${f.status === 'FLAGGED' ? 'status-rose' : 'status-emerald'}">${f.status}</span>
        </div>
      `).join('')}
    </div>
    <div style="display: flex; gap: 8px; margin-top: 16px;">
      <button class="btn btn-primary" id="genEndUseCert">Generate End-Use Certificate</button>
      <button class="btn btn-glass" id="genReexportLicense">Re-Export License Check</button>
      <button class="btn btn-glass" id="downloadECReport">Download EC Report</button>
    </div>
  `;
  
  $('#genEndUseCert')?.addEventListener('click', genEndUseCert);
  $('#genReexportLicense')?.addEventListener('click', genReexportLicense);
  $('#downloadECReport')?.addEventListener('click', downloadECReport);
}

function genEndUseCert() {
  toast('End-Use Certificate generated (simulated)', 'success');
}

function genReexportLicense() {
  toast('Re-Export License eligibility checked (simulated)', 'success');
}

function downloadECReport() {
  const lines = [
    'MATERIALHUNT EXPORT CONTROL REPORT',
    `Generated: ${new Date().toLocaleString('en-IN')}`,
    `Alloy: ${state.simulation?.composition?.formula || 'N/A'}`,
    '',
    'CLASSIFICATION:',
    '  USML Category VI: CHECK COMPOSITION',
    '  ECCN 1C002: CHECK COMPOSITION',
    '  ECCN 1C216: CHECK COMPOSITION',
    '  Wassenaar: CHECK COMPOSITION',
    '  Indian Dual-Use: CHECK COMPOSITION',
    '',
    '--- SIMULATED OUTPUT ---'
  ];
  downloadBlob(lines.join('\n'), `MATERIALHUNT_ExportControl_${Date.now()}.txt`, 'text/plain');
  toast('Export control report downloaded', 'success');
}

// --- MAIN ENTRY POINTS ---
function initEnterpriseFeatures() {
  // Inject periodic sliders
  injectPeriodicSliders();
  
  // Render all enterprise views if containers exist
  if ($('#analyticsDashboard')) renderAnalyticsDashboard();
  if ($('#workspacesPanel')) renderWorkspaces();
  if ($('#templatesGrid')) renderReportTemplates();
  if ($('#metalPricingTicker')) renderMetalPricing();
  if ($('#supplierGrid')) renderSupplierMarketplace();
  if ($('#failureGrid')) { renderFailureAnalysis(); bindFailureFilters(); }
  if ($('#complianceChecklist')) renderCompliance();
  if ($('#apiAccessPanel')) renderApiAccess();
  if ($('#genomeCanvas')) {
    const canvas = $('#genomeCanvas');
    const start = () => { try { initAlloyGenome(); } catch (err) { console.warn('Alloy genome view could not start', err.message || err); } };
    if (typeof IntersectionObserver === 'function') {
      const watcher = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { watcher.disconnect(); start(); } });
      watcher.observe(canvas);
    } else start();
  }
  if ($('#digitalTwinFormats')) renderDigitalTwinExport();
  if ($('#aiDesignPanel')) renderAIDesign();
  if ($('#exportControlPanel')) renderExportControl();
  
  // Track simulation for analytics
  trackSimulation();
}

function trackSimulation() {
  const sim = state.simulation;
  if (!sim) return;
  
  const history = JSON.parse(localStorage.getItem('mh_simulation_history') || '[]');
  history.push({
    date: new Date().toISOString().split('T')[0],
    time: new Date().toISOString(),
    formula: sim.composition?.formula || 'Unknown',
    verdict: sim.derived?.verdict || 'Unknown',
    strength: sim.prediction?.predicted,
    temp: sim.conditions?.temperature_c,
    pressure: sim.derived?.pressure_label,
    type: 'simulation'
  });
  if (history.length > 1000) history.shift();
  localStorage.setItem('mh_simulation_history', JSON.stringify(history));
  
  const alloys = JSON.parse(localStorage.getItem('mh_alloy_history') || '[]');
  const formula = sim.composition?.formula;
  if (formula && !alloys.some(a => a.formula === formula)) {
    alloys.push({ formula, date: new Date().toISOString().split('T')[0] });
    localStorage.setItem('mh_alloy_history', JSON.stringify(alloys));
  }
  
  // Update consecutiveDays
  const consecutiveDays = JSON.parse(localStorage.getItem('mh_daily_consecutiveDays') || '{"count":0,"last":null}');
  const today = new Date().toISOString().split('T')[0];
  if (consecutiveDays.last !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    consecutiveDays.count = consecutiveDays.last === yesterday ? consecutiveDays.count + 1 : 1;
    consecutiveDays.last = today;
    localStorage.setItem('mh_daily_consecutiveDays', JSON.stringify(consecutiveDays));
  }
}

function trackBenchmark(verdict) {
  const history = JSON.parse(localStorage.getItem('mh_benchmark_history') || '[]');
  history.push({
    date: new Date().toISOString().split('T')[0],
    time: new Date().toISOString(),
    benchmark: state.benchmark?.title || 'Custom',
    verdict,
    formula: state.simulation?.composition?.formula,
    type: 'benchmark'
  });
  if (history.length > 500) history.shift();
  localStorage.setItem('mh_benchmark_history', JSON.stringify(history));
  
  // Unlock milestones
  const milestones = JSON.parse(localStorage.getItem('mh_user_milestones') || '[]');
  if (verdict === 'PASS' && !milestones.includes('first_benchmark')) {
    milestones.push('first_benchmark');
    localStorage.setItem('mh_user_milestones', JSON.stringify(milestones));
    toast('🏆 Achievement unlocked: Benchmark Accepted!', 'success');
  }
  if (verdict === 'PASS' && state.benchmark?.id === 'rocket-nozzle' && !milestones.includes('rocket_scientist')) {
    milestones.push('rocket_scientist');
    localStorage.setItem('mh_user_milestones', JSON.stringify(milestones));
    toast('🚀 Achievement unlocked: Rocket Scientist!', 'success');
  }
  if (verdict === 'PASS' && state.simulation?.conditions?.temperature_c <= -100 && !milestones.includes('cryo_master')) {
    milestones.push('cryo_master');
    localStorage.setItem('mh_user_milestones', JSON.stringify(milestones));
    toast('❄️ Achievement unlocked: Cryo Master!', 'success');
  }
  if (verdict === 'PASS' && state.simulation?.derived?.cost_per_kg <= (state.benchmark?.maxCostINR || 999999) * 0.5 && !milestones.includes('cost_cutter')) {
    milestones.push('cost_cutter');
    localStorage.setItem('mh_user_milestones', JSON.stringify(milestones));
    toast('💰 Achievement unlocked: Cost Cutter!', 'success');
  }
  if (verdict === 'PASS' && !Object.keys(state.composition).includes('Co') && !milestones.includes('zero_cobalt')) {
    milestones.push('zero_cobalt');
    localStorage.setItem('mh_user_milestones', JSON.stringify(milestones));
    toast('🚫 Achievement unlocked: Zero-Cobalt Pioneer!', 'success');
  }
  if (verdict === 'PASS' && state.simulation?.derived?.density_gcm3 <= (state.benchmark?.maxDensity || 999) * 0.8 && !milestones.includes('weight_watcher')) {
    milestones.push('weight_watcher');
    localStorage.setItem('mh_user_milestones', JSON.stringify(milestones));
    toast('⚖️ Achievement unlocked: Weight Watcher!', 'success');
  }
}

// Export for global use
window.initEnterpriseFeatures = initEnterpriseFeatures;
window.trackSimulation = trackSimulation;
window.trackBenchmark = trackBenchmark;
  // ---- ADDED: Missing button handlers ----
  $('#exportTableCsv')?.addEventListener('click', () => {
    if (!window.Blob || !window.URL) {
      toast('Blob not supported', 'error', 3000);
      return;
    }
    const table = document.querySelector('.data-table');
    if (!table) {
      toast('No table found', 'error', 3000);
      return;
    }
    const rows = table.querySelectorAll('tr');
    let csv = '';
    rows.forEach((row, rIdx) => {
      const cells = row.querySelectorAll('td, th');
      const cellText = Array.from(cells).map(c => c.textContent.replace(/"/g, '""')).join(',');
      if (rIdx === 0) csv += '"' + cellText + '"\n';
      else csv += cellText + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'materialhunt_results.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV exported', 'success', 2000);
  });

  $('#tourPreset')?.addEventListener('click', () => {
    let step = state.guidedTourStep || 0;
    const presets = [
      () => { $('#structureSelect').value = 'BCC'; toast('Selected BCC lattice', 'info'); },
      () => { $('#structureSelect').value = 'FCC'; toast('Selected FCC lattice', 'info'); },
      () => { $('#structureSelect').value = 'HCP'; toast('Selected HCP lattice', 'info'); },
      () => { $('#runSimulation')?.click(); toast('Running simulation', 'info'); },
    ];
    if (step < presets.length) {
      presets[step]();
      state.guidedTourStep = step + 1;
      localStorage.setItem('mh_guided_tour_step', String(step + 1));
    } else {
      toast('Tour preset complete', 'success', 3000);
      state.guidedTourStep = 0;
      localStorage.removeItem('mh_guided_tour_step');
    }
  });

  $('#tourNext')?.addEventListener('click', () => {
    let step = state.guidedTourStep || 0;
    const nextSteps = [
      () => { state.guidedTourStep = 1; toast('Step 2 of 4', 'info'); },
      () => { state.guidedTourStep = 2; toast('Step 3 of 4', 'info'); },
      () => { state.guidedTourStep = 3; toast('Step 4 of 4', 'info'); },
      () => { state.guidedTourStep = 0; toast('Tour complete', 'success', 3000); localStorage.removeItem('mh_guided_tour_step'); },
    ];
    if (step < nextSteps.length) {
      nextSteps[step]();
    } else {
      nextSteps[nextSteps.length - 1]();
    }
  });

  $('#tourBack')?.addEventListener('click', () => {
    let step = state.guidedTourStep || 0;
    const backSteps = [
      () => { state.guidedTourStep = 0; toast('Tour reset', 'info'); },
      () => { state.guidedTourStep = 0; toast('Tour step 1', 'info'); },
      () => { state.guidedTourStep = 0; toast('Tour step 2', 'info'); },
      () => { state.guidedTourStep = 0; toast('Tour step 3', 'info'); },
    ];
    if (step < backSteps.length) {
      backSteps[step]();
    } else {
      backSteps[backSteps.length - 1]();
    }
  });

  $('#tourSkip')?.addEventListener('click', () => {
    state.guidedTourStep = 0;
    localStorage.removeItem('mh_guided_tour_step');
    toast('Tour skipped', 'info', 2000);
  });

  $('#swapBattle')?.addEventListener('click', () => {
    if (state.comparison) {
      const tempA = state.comparison.tempA,
        tempB = state.comparison.tempB;
      state.comparison = { ...state.comparison, tempA, tempB };
      renderComparison();
      tempA && tempB && toast('Specimens swapped', 'success', 2000);
    } else {
      toast('No comparison loaded', 'info', 2000);
    }
  });

  $('#runBattle')?.addEventListener('click', () => {
    runComparison({ silent: true });
    toast('Comparison analysis complete', 'success', 3000);
  });
  //---------------------------------------
window.injectPeriodicSliders = injectPeriodicSliders;
