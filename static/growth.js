/* ==========================================================================
   MATERIALHUNT — growth layer
   Plans & usage gates, upgrade/lead capture, verified-user counter, email-verification
   prompts, referral/invite, consent-based analytics, nav dropdown, auth-modal wiring.
   Loaded after app.js and tools.js.
   ========================================================================== */
'use strict';

(function () {
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (msg, type = 'info', ms) => { if (typeof toast === 'function') toast(msg, type, ms); };

  /* ------------------------------------------------------------------ */
  /* Config you can edit without touching the logic                       */
  /* ------------------------------------------------------------------ */
  const CONFIG = window.MH_CONFIG = Object.assign({
    // Paste Razorpay / Stripe Payment Link URLs here to enable instant checkout.
    // Leave empty and upgrade requests are captured as leads and followed up by email.
    paymentLinks: { pro_month: '', pro_year: '', team_month: '', team_year: '', credits: '' },
    prices: { pro: { month: 1499, year: 14990 }, team: { month: 4999, year: 49990 }, credits: 999 },
    limits: {
      guest: { sim: 3, bom: 1, report: 0, batch: 0, ai: 5 },  // per day: sim, bom, ai; report/batch: not available
      free: { report: 3, batch: 2, ai: 40 },                  // reports/batch per month, ai per day
    },
    payments: { razorpayKeyId: '', upiId: '', payeeName: 'MaterialHunt' },
    supportEmail: '',
  }, window.MH_CONFIG || {});

  const rupee = (v) => `₹${Number(v).toLocaleString('en-IN')}`;
  const PAID = ['pro', 'team', 'enterprise'];

  /* ------------------------------------------------------------------ */
  /* Referral + analytics (consent-based)                                 */
  /* ------------------------------------------------------------------ */
  const params = new URLSearchParams(location.search);
  if (params.get('ref')) localStorage.setItem('mh_ref', params.get('ref').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16));

  let analytics = null;
  function track(name, data = {}) {
    try { if (analytics) analytics.logEvent(name, data); } catch { /* analytics is optional */ }
  }
  async function enableAnalytics() {
    try {
      await window.MH_FIREBASE?.initFirebase?.();
      if (!window.firebase?.apps?.length) return;
      if (!window.firebase.analytics) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics-compat.js';
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      analytics = window.firebase.analytics();
      track('page_view', { page_title: document.title });
    } catch { /* blocked by an extension or offline */ }
  }
  function consentBanner() {
    const choice = localStorage.getItem('mh_consent');
    if (choice === 'yes') { enableAnalytics(); return; }
    if (choice === 'no') return;
    const bar = document.createElement('div');
    bar.className = 'consent-bar glass';
    bar.innerHTML = '<span>We use privacy-friendly analytics to see which tools are useful. No ads, no selling data.</span><button class="btn btn-primary small" data-c="yes">Accept</button><button class="btn btn-ghost small" data-c="no">Decline</button>';
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]');
      if (!b) return;
      localStorage.setItem('mh_consent', b.dataset.c);
      bar.remove();
      if (b.dataset.c === 'yes') enableAnalytics();
    });
    document.body.appendChild(bar);
  }

  /* ------------------------------------------------------------------ */
  /* Plans and usage                                                      */
  /* ------------------------------------------------------------------ */
  const today = () => new Date().toISOString().slice(0, 10);
  const month = () => new Date().toISOString().slice(0, 7);

  function usageKey() { return `mh_usage_v2_${state.user?.id || 'guest'}`; }
  function readUsage() {
    let u = {};
    try { u = JSON.parse(localStorage.getItem(usageKey()) || '{}'); } catch { u = {}; }
    if (u.day !== today()) { u.day = today(); u.sim = 0; u.bom = 0; u.ai = 0; }
    if (u.month !== month()) { u.month = month(); u.report = 0; u.batch = 0; }
    return u;
  }
  const writeUsage = (u) => localStorage.setItem(usageKey(), JSON.stringify(u));

  const PLAN = {
    tier() { return state.user ? (state.user.tier || 'free') : 'guest'; },
    isPaid() { return PAID.includes(PLAN.tier()); },
    verified() { return Boolean(state.user?.email_verified); },
    bucket(kind) { return { sim: 'sim', bom: 'bom', ai: 'ai', pdf: 'report', rfq: 'report', batch: 'batch' }[kind]; },
    limit(kind) {
      const b = PLAN.bucket(kind);
      const t = PLAN.tier();
      if (PAID.includes(t)) return Infinity;
      if (t === 'guest') return CONFIG.limits.guest[b] ?? 0;
      return CONFIG.limits.free[b] ?? Infinity;
    },
    remaining(kind) {
      const b = PLAN.bucket(kind);
      const lim = PLAN.limit(kind);
      return lim === Infinity ? Infinity : Math.max(0, lim - (readUsage()[b] || 0));
    },
    canOpen(kind) {
      const t = PLAN.tier();
      if (t === 'guest' && PLAN.limit(kind) === 0) { gateSignup(kind); return false; }
      if (t !== 'guest' && !PLAN.isPaid() && !PLAN.verified() && PLAN.bucket(kind) === 'report') { gateVerify(); return false; }
      if (PLAN.remaining(kind) <= 0) { gateLimit(kind); return false; }
      return true;
    },
    use(kind) {
      if (!PLAN.canOpen(kind)) return false;
      const b = PLAN.bucket(kind);
      const u = readUsage();
      u[b] = (u[b] || 0) + 1;
      writeUsage(u);
      renderRunHint();
      return true;
    },
  };
  window.MH_PLAN = PLAN;

  const KIND_COPY = {
    sim: ['You have used your free runs for today', 'Create a free account for unlimited simulations.'],
    ai: ['Keep the conversation going', 'Create a free account to keep chatting with the assistant, and save your history.'],
    bom: ['Scan more parts lists with a free account', 'Create a free account to keep using the Cost-Down Scanner.'],
    pdf: ['Create a free account to download reports', 'Free accounts get 3 PDF reports a month.'],
    rfq: ['Create a free account to generate RFQs', 'Free accounts get 3 RFQ / PDF reports a month, with the full NABL test sheet.'],
    batch: ['Create a free account to run batch screens', 'Free accounts get 2 batch runs a month.'],
  };

  function gateSignup(kind) {
    const [title, text] = KIND_COPY[kind] || KIND_COPY.sim;
    showGate({ title, text, primary: ['Create free account', () => openAuth('register')], secondary: ['I already have an account', () => openAuth('login')] });
    track('gate_signup', { kind });
  }
  function gateLimit(kind) {
    if (PLAN.tier() === 'guest') { gateSignup(kind); return; }
    const label = { batch: 'batch runs', ai: 'assistant questions (today)' }[PLAN.bucket(kind)] || 'reports';
    showGate({ title: `You have used this month's free ${label}`, text: 'Upgrade to Pro for unlimited reports, RFQ sheets and batch runs.', primary: ['See Pro', () => openUpgrade('pro')], secondary: ['Not now', null] });
    track('gate_upgrade', { kind });
  }
  function gateVerify() {
    notify('Please verify your email first. We sent you a link.', 'warning', 5000);
    const banner = q('#verifyBanner');
    banner?.classList.add('pulse');
    setTimeout(() => banner?.classList.remove('pulse'), 2500);
    banner?.scrollIntoView({ block: 'nearest' });
  }
  function showGate({ title, text, primary, secondary }) {
    let modal = q('#gateModal');
    if (!modal) { modal = document.createElement('div'); modal.id = 'gateModal'; modal.className = 'modal-backdrop hidden'; document.body.appendChild(modal); }
    modal.innerHTML = `<div class="auth-modal glass gate-card" role="dialog" aria-modal="true"><button class="modal-close" data-x aria-label="Close">×</button>
      <span class="panel-kicker">FREE ACCOUNT</span><h2>${esc(title)}</h2><p>${esc(text)}</p>
      <ul class="auth-benefits compact"><li>Unlimited simulations</li><li>Closest Indian grade and ₹/kg</li><li>Failure Doctor, Cost-Down Scanner</li><li>Takes 20 seconds, no card</li></ul>
      <div class="rfq-actions"><button class="btn btn-primary" data-p>${esc(primary[0])}</button>${secondary ? `<button class="btn btn-ghost" data-s>${esc(secondary[0])}</button>` : ''}</div></div>`;
    modal.classList.remove('hidden');
    const close = () => modal.classList.add('hidden');
    q('[data-x]', modal).onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };
    q('[data-p]', modal).onclick = () => { close(); primary[1]?.(); };
    const s = q('[data-s]', modal);
    if (s) s.onclick = () => { close(); secondary[1]?.(); };
  }

  /* gate the real actions */
  function wrapGlobal(name, kind, silentAware) {
    const original = window[name];
    if (typeof original !== 'function') return;
    window[name] = function gated(...args) {
      const silent = silentAware && args[0] && args[0].silent;
      if (!silent && !PLAN.use(kind)) return Promise.resolve();
      return original.apply(this, args);
    };
  }
  wrapGlobal('runSimulation', 'sim', true);
  wrapGlobal('downloadPdf', 'pdf', false);
  wrapGlobal('runBatch', 'batch', false);

  function renderRunHint() {
    const btn = q('#runSimulation');
    if (!btn) return;
    let hint = q('#runHint');
    if (!hint) { hint = document.createElement('p'); hint.id = 'runHint'; hint.className = 'run-hint'; btn.insertAdjacentElement('afterend', hint); }
    if (PLAN.tier() !== 'guest') { hint.classList.add('hidden'); return; }
    const left = PLAN.remaining('sim');
    hint.classList.remove('hidden');
    hint.innerHTML = left > 0
      ? `<b>${left}</b> free ${left === 1 ? 'run' : 'runs'} left today. <a href="#" data-signup>Create a free account</a> for unlimited.`
      : 'Free runs used up for today. <a href="#" data-signup>Create a free account</a> to continue.';
    q('[data-signup]', hint).onclick = (e) => { e.preventDefault(); openAuth('register'); };
  }

  /* ------------------------------------------------------------------ */
  /* Upgrade / lead capture                                               */
  /* ------------------------------------------------------------------ */
  const PLAN_COPY = {
    pro: { name: 'Pro', blurb: 'Unlimited reports, RFQs, batch runs and the Cost-Down Scanner.' },
    team: { name: 'Team', blurb: 'Pro for up to 5 people with a shared workspace and branded RFQs.' },
    enterprise: { name: 'Enterprise', blurb: 'On-premise or private cloud, SSO, API access and custom libraries.' },
    credits: { name: 'Report credit pack', blurb: '10 branded PDF reports or RFQ sheets for ₹999. Credits never expire.' },
  };
  let billing = 'month';

  function planPrice(plan) {
    if (plan === 'credits') return `${rupee(CONFIG.prices.credits)} one-time`;
    if (plan === 'enterprise') return 'Custom pricing';
    const p = CONFIG.prices[plan];
    return billing === 'year' ? `${rupee(p.year)} / year` : `${rupee(p.month)} / month`;
  }

  function planAmount(plan) {
    if (plan === 'credits') return CONFIG.prices.credits;
    if (plan === 'enterprise') return 0;
    return CONFIG.prices[plan]?.[billing] || 0;
  }

  function loadExternal(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const el = document.createElement('script');
      el.src = src; el.async = true; el.onload = resolve; el.onerror = () => reject(new Error('Could not load the payment window'));
      document.head.appendChild(el);
    });
  }

  function upiLink(amount, note) {
    const pay = CONFIG.payments || {};
    const params = new URLSearchParams({ pa: pay.upiId, pn: pay.payeeName || 'MaterialHunt', am: String(amount), cu: 'INR', tn: note });
    return `upi://pay?${params.toString()}`;
  }

  function paymentOptions(plan) {
    const pay = CONFIG.payments || {};
    const link = CONFIG.paymentLinks[`${plan}_${billing}`] || CONFIG.paymentLinks[plan] || '';
    return { razorpay: Boolean(pay.razorpayKeyId), link, upi: Boolean(pay.upiId) };
  }

  async function recordPayment(plan, details, who, ref, method) {
    const info = PLAN_COPY[plan] || PLAN_COPY.pro;
    return window.MH_FIREBASE?.saveLead?.({
      kind: 'payment', name: who.name, organization: who.org, email: who.email,
      request_type: `${info.name} (${plan === 'credits' ? 'one-time' : billing}) via ${method}`,
      notes: `Payment ref: ${ref}. Amount INR ${details.amount}. Verify in payments dashboard, then set users/{uid}.tier.`, plan, billing, amount_inr: details.amount,
    });
  }

  function showPaid(modal, plan, close) {
    const info = PLAN_COPY[plan] || PLAN_COPY.pro;
    q('.tool-modal', modal).innerHTML = `<button class="modal-close" data-x aria-label="Close">×</button>
      <span class="panel-kicker">PAYMENT RECEIVED</span><h2>Thank you.</h2>
      <p>We are confirming your payment and will activate <b>${esc(info.name)}</b> on your account shortly, usually within a few hours. You will get an email when it is live.</p>
      <div class="rfq-actions"><button class="btn btn-primary" data-x2>Done</button></div>`;
    q('[data-x]', modal).onclick = close; q('[data-x2]', modal).onclick = close;
  }

  function showPaymentStep(modal, plan, who, close) {
    const info = PLAN_COPY[plan] || PLAN_COPY.pro;
    const amount = planAmount(plan);
    const opts = paymentOptions(plan);
    const details = { amount };
    const card = q('.tool-modal', modal);
    const upiNote = `MaterialHunt ${info.name}`;
    card.innerHTML = `<button class="modal-close" data-x aria-label="Close">×</button>
      <span class="panel-kicker">CHECKOUT</span><h2>Pay ${rupee(amount)}</h2>
      <p class="micro-note">${esc(info.name)} · ${plan === 'credits' ? 'one-time' : billing === 'year' ? 'one year' : 'one month'} · ${rupee(amount)}</p>
      <div class="pay-options">
        ${opts.razorpay ? `<button class="pay-option" id="payRazor"><b>Card, UPI, netbanking, wallets</b><small>Secure popup by Razorpay</small></button>` : ''}
        ${opts.link ? `<button class="pay-option" id="payLink"><b>Pay on a secure page</b><small>Opens in a new tab</small></button>` : ''}
        ${opts.upi ? `<div class="pay-option static"><b>Pay with UPI</b><small>Pay to <code>${esc(CONFIG.payments.upiId)}</code> from any UPI app</small>
          <div class="rfq-actions"><a class="btn btn-glass small" id="payUpiApp" href="${esc(upiLink(amount, upiNote))}">Open UPI app</a><button class="btn btn-ghost small" id="payUpiCopy" type="button">Copy UPI ID</button></div>
          <label class="field-label" for="payUtr">After paying, enter the UPI reference (UTR)</label>
          <input id="payUtr" type="text" placeholder="12-digit UTR / transaction ID" inputmode="numeric" />
          <button class="btn btn-primary small" id="payUpiDone" type="button">I have paid</button></div>` : ''}
      </div>
      <p class="form-error" id="payError"></p>`;
    q('[data-x]', modal).onclick = close;
    q('#payRazor', card)?.addEventListener('click', async () => {
      try {
        await loadExternal('https://checkout.razorpay.com/v1/checkout.js');
        const rzp = new window.Razorpay({
          key: CONFIG.payments.razorpayKeyId, amount: Math.round(amount * 100), currency: 'INR', name: 'MaterialHunt',
          description: `${info.name} (${plan === 'credits' ? 'one-time' : billing})`, prefill: { name: who.name, email: who.email },
          notes: { plan, billing, uid: state.user?.id || '' }, theme: { color: '#22D3EE' },
          handler: async (res) => { await recordPayment(plan, details, who, res.razorpay_payment_id, 'Razorpay'); track('payment_success', { plan, method: 'razorpay' }); showPaid(modal, plan, close); },
        });
        rzp.on('payment.failed', (res) => { q('#payError', card).textContent = res?.error?.description || 'Payment failed. You can try again.'; });
        rzp.open();
        track('payment_start', { plan, method: 'razorpay' });
      } catch (err) { q('#payError', card).textContent = err.message; }
    });
    q('#payLink', card)?.addEventListener('click', () => { window.open(opts.link, '_blank', 'noopener'); track('payment_start', { plan, method: 'link' }); });
    q('#payUpiCopy', card)?.addEventListener('click', () => { navigator.clipboard?.writeText(CONFIG.payments.upiId); notify('UPI ID copied.', 'success', 2000); });
    q('#payUpiApp', card)?.addEventListener('click', () => track('payment_start', { plan, method: 'upi' }));
    q('#payUpiDone', card)?.addEventListener('click', async () => {
      const utr = (q('#payUtr', card).value || '').trim();
      if (!/^[A-Za-z0-9]{8,24}$/.test(utr)) { q('#payError', card).textContent = 'Enter the UPI reference number from your payment app.'; return; }
      await recordPayment(plan, details, who, utr, 'UPI');
      track('payment_success', { plan, method: 'upi' });
      showPaid(modal, plan, close);
    });
  }

  function openUpgrade(plan = 'pro') {
    const info = PLAN_COPY[plan] || PLAN_COPY.pro;
    let modal = q('#upgradeModal');
    if (!modal) { modal = document.createElement('div'); modal.id = 'upgradeModal'; modal.className = 'modal-backdrop hidden'; document.body.appendChild(modal); }
    const u = state.user || {};
    const opts = paymentOptions(plan);
    const canPay = plan !== 'enterprise' && (opts.razorpay || opts.link || opts.upi);
    modal.innerHTML = `<div class="auth-modal glass tool-modal" role="dialog" aria-modal="true"><button class="modal-close" data-x aria-label="Close">×</button>
      <span class="panel-kicker">${plan === 'enterprise' ? 'TALK TO SALES' : 'UPGRADE'}</span>
      <h2>${esc(info.name)}</h2><p class="micro-note">${esc(info.blurb)}</p>
      <div class="upgrade-price"><strong>${esc(planPrice(plan))}</strong></div>
      <form class="auth-form" id="upgradeForm">
        <div class="field-two-col">
          <div><label class="field-label" for="upName">Your name</label><input id="upName" type="text" value="${esc(u.organization_name || '')}" required /></div>
          <div><label class="field-label" for="upOrg">Organisation</label><input id="upOrg" type="text" required /></div>
        </div>
        <label class="field-label" for="upEmail">Email</label><input id="upEmail" type="email" value="${esc(u.email || '')}" required />
        <label class="field-label" for="upNote">Anything we should know? (optional)</label><input id="upNote" type="text" placeholder="e.g. team size, parts you buy, timeline" />
        <button class="btn btn-primary full" type="submit">${plan === 'enterprise' ? 'Request a call' : canPay ? 'Continue to payment' : 'Request this plan'}</button>
        <p class="form-error" id="upError"></p>
        <p class="micro-note">${canPay ? 'You will choose how to pay on the next step.' : 'We will email you a secure payment link within one business day.'}</p>
      </form></div>`;
    modal.classList.remove('hidden');
    const close = () => modal.classList.add('hidden');
    q('[data-x]', modal).onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };
    q('#upgradeForm', modal).onsubmit = async (e) => {
      e.preventDefault();
      const val = (id) => q(id, modal).value.trim();
      const email = val('#upEmail');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { q('#upError', modal).textContent = 'Enter a valid email address.'; return; }
      const who = { name: val('#upName'), org: val('#upOrg'), email };
      const res = await window.MH_FIREBASE?.saveLead?.({
        kind: 'upgrade', name: who.name, organization: who.org, email,
        request_type: `${info.name} (${plan === 'credits' ? 'one-time' : billing})`, notes: val('#upNote'), plan, billing,
      });
      track('upgrade_request', { plan, billing });
      if (canPay) { showPaymentStep(modal, plan, who, close); return; }
      q('.tool-modal', modal).innerHTML = `<button class="modal-close" data-x aria-label="Close">×</button>
        <span class="panel-kicker">REQUEST RECEIVED</span><h2>Thank you${who.name ? `, ${esc(who.name.split(' ')[0])}` : ''}.</h2>
        <p>${res?.ok ? 'We will email you within one business day' : 'We saved this on your device. Please retry shortly,'} to confirm ${esc(info.name)} and send ${plan === 'enterprise' ? 'a call invite' : 'a secure payment link'}.</p>
        <div class="rfq-actions"><button class="btn btn-primary" data-x2>Done</button></div>`;
      q('[data-x]', modal).onclick = close; q('[data-x2]', modal).onclick = close;
    };
  }
  window.openUpgrade = openUpgrade;

  function renderPricing() {
    const set = (id, text) => { const el = q(id); if (el) el.textContent = text; };
    const yearly = billing === 'year';
    set('#proPrice', rupee(yearly ? CONFIG.prices.pro.year : CONFIG.prices.pro.month));
    set('#proCycle', yearly ? 'per year · 2 months free' : 'per month · cancel anytime');
    set('#teamPrice', rupee(yearly ? CONFIG.prices.team.year : CONFIG.prices.team.month));
    set('#teamCycle', yearly ? 'per year · up to 5 seats' : 'per month · up to 5 seats');
    qa('.billing-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.bill === billing));
    const tier = PLAN.tier();
    qa('[data-plan-cta]').forEach((b) => {
      const plan = b.dataset.planCta;
      if (plan === tier) { b.textContent = 'Your current plan'; b.disabled = true; } else { b.disabled = false; if (plan === 'free') b.textContent = state.user ? 'Included' : 'Create free account'; }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Social proof counter                                                 */
  /* ------------------------------------------------------------------ */
  let stats = null;
  function counterText(kind) {
    const v = stats?.verified_users || 0;
    const n = v.toLocaleString('en-IN');
    if (v >= 1) {
      if (kind === 'footer') return `${n} verified ${v === 1 ? 'member' : 'members'}`;
      return `${n} verified ${v === 1 ? 'engineer, maker or student has' : 'engineers, makers and students have'} joined`;
    }
    return kind === 'footer' ? 'Verified members joining' : 'Be among the first verified members';
  }
  function renderCounters() {
    qa('.mh-counter').forEach((el) => { el.textContent = counterText(el.dataset.counterCopy); });
    const hero = q('#socialProofText');
    if (hero) hero.textContent = counterText('hero');
    q('#socialProof')?.classList.toggle('has-count', (stats?.verified_users || 0) >= 1);
  }
  async function loadStats() {
    try {
      const res = await fetch('/api/stats/public');
      const data = await res.json();
      if (data && data.ok) { stats = data; renderCounters(); }
    } catch { /* show default copy */ }
  }

  /* ------------------------------------------------------------------ */
  /* Email verification banner                                            */
  /* ------------------------------------------------------------------ */
  function renderVerify(user) {
    const el = q('#verifyBanner');
    if (!el) return;
    if (!user || user.email_verified) { el.classList.add('hidden'); return; }
    el.innerHTML = `<span><b>Verify your email</b> to unlock reports and join the leaderboard. We sent a link to <b>${esc(user.email)}</b>.</span>
      <button class="btn btn-glass small" id="vbResend">Resend link</button><button class="btn btn-primary small" id="vbCheck">I have verified</button>`;
    el.classList.remove('hidden');
    q('#vbResend', el).onclick = async () => {
      try { await api('/api/auth/resend-verification', { method: 'POST' }); notify('Verification email sent. Check your inbox and spam folder.', 'success', 4500); }
      catch (err) { notify(err.message, 'error'); }
    };
    q('#vbCheck', el).onclick = checkVerified;
  }
  async function checkVerified() {
    try {
      const res = await api('/api/auth/refresh', { method: 'POST' });
      if (res.user?.email_verified) {
        setSession(state.token, res.user);
        notify('Email verified. You are all set.', 'success', 4000);
        track('email_verified');
        loadStats();
      } else {
        notify('Not verified yet. Open the link in your email, then try again.', 'info', 4500);
      }
    } catch (err) { notify(err.message, 'error'); }
  }
  window.addEventListener('focus', () => { if (state.user && !state.user.email_verified) checkVerified(); });
  window.addEventListener('mh:session', (e) => { renderVerify(e.detail.user); renderPricing(); renderRunHint(); });

  /* ------------------------------------------------------------------ */
  /* Invite / share                                                       */
  /* ------------------------------------------------------------------ */
  function openInvite() {
    const code = state.user?.referral_code || '';
    const link = `${location.origin}${location.pathname}${code ? `?ref=${code}` : ''}`;
    const text = 'I use MaterialHunt to test metals and get the closest Indian grade with ₹/kg. Free to try: ';
    let modal = q('#inviteModal');
    if (!modal) { modal = document.createElement('div'); modal.id = 'inviteModal'; modal.className = 'modal-backdrop hidden'; document.body.appendChild(modal); }
    modal.innerHTML = `<div class="auth-modal glass tool-modal"><button class="modal-close" data-x aria-label="Close">×</button>
      <span class="panel-kicker">INVITE A COLLEAGUE</span><h2>Share MaterialHunt</h2>
      <p class="micro-note">Teammates, classmates or your supplier. It is free to join.</p>
      <input id="invLink" type="text" readonly value="${esc(link)}" />
      <div class="rfq-actions"><button class="btn btn-primary" id="invCopy">Copy link</button>
      <a class="btn btn-glass" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text + link)}">WhatsApp</a>
      <a class="btn btn-glass" target="_blank" rel="noopener" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}">LinkedIn</a></div></div>`;
    modal.classList.remove('hidden');
    q('[data-x]', modal).onclick = () => modal.classList.add('hidden');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
    q('#invCopy', modal).onclick = () => { navigator.clipboard?.writeText(link); notify('Link copied.', 'success', 2000); track('invite_copy'); };
  }

  /* ------------------------------------------------------------------ */
  /* Legal                                                                */
  /* ------------------------------------------------------------------ */
  const LEGAL = {
    terms: ['Terms of use', `<p>MaterialHunt provides screening-grade engineering estimates. Results are not certified test data and must be validated by qualified engineers and accredited laboratories before use in any safety-critical or regulated application.</p>
      <p>Prices are indicative ranges and not offers. You are responsible for decisions made using the tool. We may change or discontinue features. Paid plans are billed as shown at purchase and can be cancelled anytime.</p>
      <p>Do not use the service to design weapons or to bypass export controls. The dual-use guardrail may block restricted elements.</p>`],
    privacy: ['Privacy policy', `<p>We collect your email, name or organisation, the role you choose, and your usage of the tools to run your account, send verification and support emails, and improve the product. Optional analytics run only if you accept the cookie notice.</p>
      <p>We do not sell personal data. RFQs you send are shared with the suppliers or labs needed to answer them. Data is stored with Google Firebase. You can ask us to export or delete your data at any time by emailing the contact on this site.</p>`],
  };
  function openLegal(kind) {
    const [title, body] = LEGAL[kind] || LEGAL.terms;
    let modal = q('#legalModal');
    if (!modal) { modal = document.createElement('div'); modal.id = 'legalModal'; modal.className = 'modal-backdrop hidden'; document.body.appendChild(modal); }
    modal.innerHTML = `<div class="auth-modal glass tool-modal"><button class="modal-close" data-x aria-label="Close">×</button><h2>${esc(title)}</h2><div class="legal-body">${body}</div></div>`;
    modal.classList.remove('hidden');
    q('[data-x]', modal).onclick = () => modal.classList.add('hidden');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
  }

  /* ------------------------------------------------------------------ */
  /* Nav dropdown + page tracking                                         */
  /* ------------------------------------------------------------------ */
  function setupNav() {
    const btn = q('#navMoreBtn');
    const menu = q('#navMenu');
    if (!btn || !menu) return;
    const close = () => { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', (e) => { e.stopPropagation(); const open = menu.classList.toggle('open'); btn.setAttribute('aria-expanded', String(open)); });
    document.addEventListener('click', (e) => { if (!menu.contains(e.target) && e.target !== btn) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    menu.addEventListener('click', (e) => { if (e.target.closest('.nav-item')) close(); });
    const original = window.setView;
    window.setView = function patched(view, scroll) {
      original(view, scroll);
      close();
      const inMenu = Boolean(q(`#navMenu [data-view="${view}"]`));
      btn.classList.toggle('active', inMenu);
      qa('#navMenu .nav-item').forEach((i) => i.classList.toggle('active', i.dataset.view === view));
      track('view', { view });
    };
  }

  /* ------------------------------------------------------------------ */
  /* Auth modal wiring                                                    */
  /* ------------------------------------------------------------------ */
  function setupAuth() {
    const original = window.switchAuthTab;
    window.switchAuthTab = function patched(tab) {
      original(tab);
      const reg = tab === 'register';
      const k = q('#authKicker'); const t = q('#authTitle');
      if (k) k.textContent = reg ? 'FREE · 20 SECONDS' : 'WELCOME BACK';
      if (t) t.textContent = reg ? 'Create your free account' : 'Sign in to MaterialHunt';
    };
    q('#forgotPassword')?.addEventListener('click', async () => {
      const email = (q('#loginEmail').value || '').trim();
      const err = q('#authError');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = 'Type your email above first, then press "Forgot password?".'; return; }
      try { await api('/api/auth/reset', { method: 'POST', auth: false, body: { email } }); err.textContent = ''; notify('Password reset email sent. Check your inbox.', 'success', 5000); }
      catch (e) { err.textContent = e.message; }
    });
    q('#registerForm')?.addEventListener('submit', () => track('signup_submit'));
    q('#loginForm')?.addEventListener('submit', () => track('login_submit'));
    // open the sign-up tab from every CTA
    ['#ctaSignup', '#heroCreate'].forEach((sel) => q(sel)?.addEventListener('click', () => { openAuth('register'); track('cta_signup', { src: sel }); }));
    q('#loginBtn')?.addEventListener('click', () => openAuth('login'));
    q('#inviteBtn')?.addEventListener('click', openInvite);
    document.addEventListener('click', (e) => {
      const legal = e.target.closest('[data-legal]');
      if (legal) { e.preventDefault(); openLegal(legal.dataset.legal); return; }
      const cta = e.target.closest('[data-plan-cta]');
      if (cta) {
        const plan = cta.dataset.planCta;
        if (plan === 'free') openAuth('register'); else openUpgrade(plan);
        return;
      }
      const bill = e.target.closest('[data-bill]');
      if (bill) { billing = bill.dataset.bill; renderPricing(); }
    });
    window.MH_GROWTH = Object.assign(window.MH_GROWTH || {}, { track, renderPricing, setPendingSubmit: (v) => { pendingSubmit = v; } });
  }

  let pendingSubmit = false;
  window.addEventListener('mh:session', (e) => {
    if (e.detail.user && pendingSubmit) {
      pendingSubmit = false;
      setTimeout(() => { setView('challenge'); notify('Welcome! Press "Check & submit my design" to enter the leaderboard.', 'success', 5000); }, 600);
    }
    if (e.detail.user) loadStats();
  });

  /* ------------------------------------------------------------------ */
  /* Boot                                                                 */
  /* ------------------------------------------------------------------ */
  function boot() {
    setupNav();
    setupAuth();
    renderPricing();
    renderRunHint();
    consentBanner();
    loadStats();
    if (params.get('challenge')) setTimeout(() => setView('challenge'), 400);
    if (params.get('view')) setTimeout(() => { try { setView(params.get('view')); } catch { /* unknown view */ } }, 400);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
