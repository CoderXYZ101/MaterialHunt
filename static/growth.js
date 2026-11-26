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
      guest: { sim: 60, bom: 15, report: 6, batch: 0, ai: 25, finder: 30, doctor: 25, compare: 30, ml: 10 }, // demo (no account): per day, except report which is per month
      free: { report: 3, batch: 2, ai: 40 },                  // reports/batch per month, ai per day
    },
    payments: { razorpayKeyId: '', upiId: '', payeeName: 'MaterialHunt' },
    supportEmail: '',
  }, window.MH_CONFIG || {});

  const rupee = (v) => `₹${Number(v).toLocaleString('en-IN')}`;
  const PAID = ['pro', 'max', 'ultra', 'team', 'team_max', 'team_ultra', 'enterprise'];
  const SOON = [];

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
  { const v = new URLSearchParams(location.search).get('view'); if (v && /^[a-z-]+$/.test(v)) setTimeout(() => { if (document.getElementById(`view-${v}`)) setView(v); }, 2500); }
  { const wants = new URLSearchParams(location.search); if (wants.get('contact') === '1' || wants.get('rate') === '1') setTimeout(() => document.querySelector('#feedbackToggle')?.click(), 1800); }
  /* the home-page box hands the sentence to the Alloy Finder */
  function goFind() {
    const text = (q('#jobPrompt')?.value || '').trim();
    setView('ai-design');
    setTimeout(() => { const box = q('#aiDesignPrompt'); if (box && text) { box.value = text; q('#runAIDesign')?.click(); } else box?.focus(); }, 200);
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'jobPrompt') { e.preventDefault(); goFind(); } });
  /* Booth mode: open the site with ?booth=1 on the stall device. No cookie box, and after 2 minutes with nobody touching it,
     it returns to the home page, so the next visitor starts clean. */
  const BOOTH = new URLSearchParams(location.search).get('booth') === '1';
  if (BOOTH) {
    if (!localStorage.getItem('mh_consent')) localStorage.setItem('mh_consent', 'no');
    let idle = null;
    const arm = () => { clearTimeout(idle); idle = setTimeout(() => { location.replace('/?booth=1'); }, 120000); };
    ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach((t) => window.addEventListener(t, arm, { passive: true }));
    arm();
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
    if (u.day !== today()) { u.day = today(); u.sim = 0; u.bom = 0; u.ai = 0; u.finder = 0; u.doctor = 0; u.compare = 0; u.ml = 0; }
    if (u.month !== month()) { u.month = month(); u.report = 0; u.batch = 0; }
    return u;
  }
  const writeUsage = (u) => localStorage.setItem(usageKey(), JSON.stringify(u));

  const PLAN = {
    tier() { return state.user ? (state.user.tier || 'free') : 'guest'; },
    isPaid() { return PAID.includes(PLAN.tier()); },
    verified() { return Boolean(state.user?.email_verified); },
    bucket(kind) { return { sim: 'sim', bom: 'bom', ai: 'ai', pdf: 'report', rfq: 'report', batch: 'batch', finder: 'finder', doctor: 'doctor', compare: 'compare', ml: 'ml' }[kind]; },
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
    batch: ['Create a free account to use this tool', 'It only takes a few seconds.'],
    finder: ['Demo limit reached for the Alloy Finder', 'Create a free account to keep searching.'],
    doctor: ['Demo limit reached for the Failure Doctor', 'Create a free account to keep diagnosing.'],
    compare: ['Demo limit reached for Compare', 'Create a free account to keep comparing alloys.'],
    ml: ['Demo limit reached for the ML Lab', 'Create a free account to keep training models.'],
  };

  function gateSignup(kind) {
    const [title, text] = KIND_COPY[kind] || KIND_COPY.sim;
    showGate({ title, text, primary: ['Create free account', () => openAuth('register')], secondary: ['I already have an account', () => openAuth('login')] });
    track('gate_signup', { kind });
  }
  function gateLimit(kind) {
    if (PLAN.tier() === 'guest') { gateSignup(kind); return; }
    const label = { batch: 'batch runs', ai: 'assistant questions (today)' }[PLAN.bucket(kind)] || 'reports';
    showGate({ title: `You have used this month's free ${label}`, text: 'Upgrade to Pro for unlimited reports and RFQ sheets.', primary: ['See Pro', () => openUpgrade('pro')], secondary: ['Not now', null] });
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
    pro: { name: 'Pro', blurb: 'Unlimited PDF reports and RFQ sheets, and a higher daily limit on the AI assistant.' },
    max: { name: 'Max', blurb: 'Everything in Pro, with a bigger own-data ML workspace, up to 10 saved models you can compare side by side, and a higher AI assistant limit.' },
    ultra: { name: 'Ultra', blurb: 'Everything in Max, with the largest own-data workspace, up to 50 saved models, a downloadable test-error report for each model, and the highest AI assistant limit.' },
    team: { name: 'Team Pro', blurb: 'Pro for up to 5 people. You add them by email and they get Pro. Includes a team chat and a shelf for sharing designs.' },
    team_max: { name: 'Team Max', blurb: 'Max for up to 10 people. You add them by email and they get Max. Includes a team chat and a shelf for sharing designs and trained models.' },
    team_ultra: { name: 'Team Ultra', blurb: 'Ultra for up to 25 people. You add them by email and they get Ultra. Includes a team chat and a shelf for sharing designs and trained models.' },
    enterprise: { name: 'Custom plan', blurb: 'Tell us how many people you are and what you need, and we will reply by email with a quote.' },
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
      <span class="panel-kicker">${plan === 'enterprise' ? 'TELL US WHAT YOU NEED' : SOON.includes(plan) ? 'COMING SOON' : 'UPGRADE'}</span>
      <h2>${esc(info.name)}</h2><p class="micro-note">${esc(info.blurb)}</p>
      <div class="upgrade-price"><strong>${esc(planPrice(plan))}</strong></div>
      <form class="auth-form" id="upgradeForm">
        <div class="field-two-col">
          <div><label class="field-label" for="upName">Your name</label><input id="upName" type="text" value="${esc(u.organization_name || '')}" required /></div>
          <div><label class="field-label" for="upOrg">Organisation</label><input id="upOrg" type="text" required /></div>
        </div>
        <label class="field-label" for="upEmail">Email</label><input id="upEmail" type="email" value="${esc(u.email || '')}" required />
        <label class="field-label" for="upNote">Anything we should know? (optional)</label><input id="upNote" type="text" placeholder="e.g. team size, parts you buy, timeline" />
        <button class="btn btn-primary full" type="submit">${plan === 'enterprise' ? 'Send' : SOON.includes(plan) ? 'Request early access' : canPay ? 'Continue to payment' : 'Request this plan'}</button>
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
        <p>${res?.ok ? (plan === 'enterprise' ? 'We have your message and will reply by email.' : SOON.includes(plan) ? 'You are on the early-access list. We will email you when it is ready.' : 'We have your request and will email you soon to confirm and send a secure payment link.') : 'We saved this on your device. Please try again in a moment.'}</p>
        <div class="rfq-actions"><button class="btn btn-primary" data-x2>Done</button></div>`;
      q('[data-x]', modal).onclick = close; q('[data-x2]', modal).onclick = close;
    };
  }
  window.openUpgrade = openUpgrade;

  /* Plans. A feature starting with "~" is planned, not built yet, and is shown with a "planned" tag. */
  const FREE_LIST = ['Unlimited simulations, all 118 elements', 'Closest Indian grade + indicative ₹/kg', 'Failure Doctor, Alloy Finder & Cost-Down Scanner', 'ML Lab: the two built-in models, plus your own table up to 300 rows, 1 saved model', '3 PDF reports or RFQ sheets / month', 'Save up to 5 designs', 'Design challenge, leaderboard and Forum'];
  const PLAN_CARDS = {
    me: [
      { id: 'free', name: 'FREE', price: 0, cycle: 'forever · no card', list: FREE_LIST, cta: 'Create free account' },
      { id: 'pro', name: 'PRO', tag: 'MOST PEOPLE', featured: true, list: ['Everything in Free', 'Unlimited PDF reports & RFQ sheets', 'Unlimited saved designs', 'Own-data ML up to 1,000 rows, 3 saved models', 'AI assistant: 60 questions a day', 'Email support'], cta: 'Upgrade to Pro' },
      { id: 'max', name: 'MAX', list: ['Everything in Pro', 'Own-data ML up to 5,000 rows', 'Save up to 10 models and compare them side by side', 'AI assistant: 150 questions a day', 'Priority email support'], cta: 'Upgrade to Max' },
      { id: 'ultra', name: 'ULTRA', list: ['Everything in Max', 'Own-data ML up to 50,000 rows', 'Save up to 50 models', 'Downloadable test-error report (CSV) for every model', 'AI assistant: 300 questions a day', 'Priority support, replies first'], cta: 'Upgrade to Ultra' },
    ],
    team: [
      { id: 'team', name: 'TEAM PRO', seats: 'up to 5 seats', list: ['Add up to 5 people by email, all get Pro', 'Team chat', 'Team shelf: share designs', 'Shows "Team full" when the seats are used', 'Email support'], cta: 'Get Team Pro' },
      { id: 'team_max', name: 'TEAM MAX', seats: 'up to 10 seats', featured: true, tag: 'MOST TEAMS', list: ['Add up to 10 people by email, all get Max', 'Team chat', 'Team shelf: share designs and trained models', 'Priority email support'], cta: 'Get Team Max' },
      { id: 'team_ultra', name: 'TEAM ULTRA', seats: 'up to 25 seats', list: ['Add up to 25 people by email, all get Ultra', 'Team chat', 'Team shelf: share designs and trained models', 'Priority support, replies first'], cta: 'Get Team Ultra' },
    ],
  };
  const CUSTOM_CARD = { id: 'enterprise', name: 'CUSTOM', customPrice: "Let's talk", cycle: 'more than 25 seats, or special needs', list: ['Tell us how many people and what you need', 'Custom grade and price lists, built to order', 'Onboarding for your team', 'We reply by email with a quote'], cta: 'Tell us what you need' };
  let audience = 'me';

  function cardHtml(c) {
    const priced = CONFIG.prices[c.id];
    const value = c.customPrice || (c.id === 'free' ? '₹0' : rupee(billing === 'year' ? priced.year : priced.month));
    const cycle = c.cycle || (billing === 'year' ? `per year · 2 months free${c.seats ? ` · ${c.seats}` : ''}` : `${c.seats ? `per team per month · ${c.seats}` : 'per month'} · ends by itself, no auto-renewal`);
    const items = c.list.map((t) => `<li>${esc(t)}</li>`).join('');
    return `<article class="glass price-card${c.featured ? ' featured' : ''}">
      ${c.tag ? `<span class="price-tag">${c.tag}</span>` : ''}
      <span class="price-tier">${c.name}</span><strong class="price-value">${value}</strong><span class="price-cycle">${esc(cycle)}</span>
      <ul class="price-list">${items}</ul>
      <button class="btn ${c.featured ? 'btn-primary' : 'btn-glass'} full" data-plan-cta="${c.id}">${c.cta}</button></article>`;
  }

  function renderPricing() {
    const grid = q('#pricingGrid');
    if (grid) grid.innerHTML = [...PLAN_CARDS[audience], CUSTOM_CARD].map(cardHtml).join('');
    qa('.billing-toggle [data-bill]').forEach((b) => b.classList.toggle('active', b.dataset.bill === billing));
    qa('.billing-toggle [data-aud]').forEach((b) => b.classList.toggle('active', b.dataset.aud === audience));
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
      return `${n} verified ${v === 1 ? 'member has' : 'members have'} joined`;
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
  /* Verified business (KYB) application                                  */
  /* ------------------------------------------------------------------ */
  const kybKey = () => `mh_kyb_requested_${state.user?.id || 'x'}`;

  function renderKybLink() {
    const link = q('#kybLink');
    if (!link) return;
    const u = state.user;
    if (!u || u.kyb_status === 'approved') { link.classList.add('hidden'); return; }
    link.classList.remove('hidden');
    link.textContent = localStorage.getItem(kybKey()) ? 'Verification pending' : 'Get verified';
  }

  function openKyb() {
    if (!state.user) { openAuth('register'); notify('Create a free account first, then apply for the badge.', 'info', 4000); return; }
    if (state.user.kyb_status === 'approved') { notify('Your business is already verified.', 'success', 3000); return; }
    let modal = q('#kybModal');
    if (!modal) { modal = document.createElement('div'); modal.id = 'kybModal'; modal.className = 'modal-backdrop hidden'; document.body.appendChild(modal); }
    const u = state.user;
    modal.innerHTML = `<div class="auth-modal glass tool-modal" role="dialog" aria-modal="true"><button class="modal-close" data-x aria-label="Close">×</button>
      <span class="panel-kicker">VERIFIED BUSINESS BADGE</span><h2>Verify your business</h2>
      <p class="micro-note">Free. We check what you send and may email you for one document. Once approved, a Verified badge appears next to your name.</p>
      <form class="auth-form" id="kybForm">
        <label class="field-label" for="kybOrg">Business, college or team name</label><input id="kybOrg" type="text" value="${esc(u.organization_name || '')}" required />
        <div class="field-two-col">
          <div><label class="field-label" for="kybReg">Registration or ID number</label><input id="kybReg" type="text" placeholder="GST, CIN, Udyam, college ID…" required /></div>
          <div><label class="field-label" for="kybRole">Your role</label><input id="kybRole" type="text" placeholder="e.g. Founder, Team lead" required /></div>
        </div>
        <label class="field-label" for="kybWeb">Website or LinkedIn page</label><input id="kybWeb" type="text" placeholder="https://…" />
        <label class="guardrail-check"><input type="checkbox" id="kybAuth" required /><span><strong>I am authorised to represent this organisation.</strong></span></label>
        <button class="btn btn-primary full" type="submit">Send for verification</button>
        <p class="form-error" id="kybError"></p>
      </form></div>`;
    modal.classList.remove('hidden');
    const close = () => modal.classList.add('hidden');
    q('[data-x]', modal).onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };
    q('#kybForm', modal).onsubmit = async (e) => {
      e.preventDefault();
      const val = (id) => q(id, modal).value.trim();
      const res = await window.MH_FIREBASE?.saveLead?.({
        kind: 'kyb', name: u.organization_name || u.email, organization: val('#kybOrg'), email: u.email,
        request_type: 'Business verification', notes: `Reg no: ${val('#kybReg')} | Role: ${val('#kybRole')} | Web: ${val('#kybWeb') || 'n/a'}`,
      });
      track('kyb_request');
      localStorage.setItem(kybKey(), '1');
      renderKybLink();
      q('.tool-modal', modal).innerHTML = `<button class="modal-close" data-x aria-label="Close">×</button>
        <span class="panel-kicker">SENT</span><h2>Thanks, we have your details.</h2>
        <p>${res?.ok ? 'We will review them and email you if we need anything else.' : 'We saved this on your device. Please retry shortly.'} The badge appears automatically once approved.</p>
        <div class="rfq-actions"><button class="btn btn-primary" data-x2>Done</button></div>`;
      q('[data-x]', modal).onclick = close; q('[data-x2]', modal).onclick = close;
    };
  }
  window.openKyb = openKyb;
  window.addEventListener('mh:session', renderKybLink);
  document.addEventListener('click', (e) => {
    if (e.target.closest('#kybLink')) { e.preventDefault(); openKyb(); }
    if (e.target.closest('#kybBtn')) openKyb();
  });

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
      if (e.target.closest('#jobGo')) { e.preventDefault(); goFind(); return; }
      const contact = e.target.closest('[data-contact]');
      if (contact) { e.preventDefault(); q('#feedbackToggle')?.click(); return; }
      const legal = e.target.closest('[data-legal]');
      if (legal) { e.preventDefault(); openLegal(legal.dataset.legal); return; }
      const cta = e.target.closest('[data-plan-cta]');
      if (cta) {
        const plan = cta.dataset.planCta;
        if (plan === 'free') openAuth('register'); else openUpgrade(plan);
        return;
      }
      const bill = e.target.closest('[data-bill]');
      if (bill) { billing = bill.dataset.bill; renderPricing(); return; }
      const aud = e.target.closest('[data-aud]');
      if (aud) { audience = aud.dataset.aud; renderPricing(); }
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
