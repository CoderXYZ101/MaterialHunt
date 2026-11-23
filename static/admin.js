/* ==========================================================================
   MATERIALHUNT — admin page (free, no server)
   Visible only to accounts whose Firestore user document has role = "admin".
   The real protection is in firestore.rules; hiding the button is only cosmetic.
   Lists upgrade / payment / RFQ requests, lets you approve a plan by clicking,
   search users by email, mark a business as verified (KYB), and email customers
   through a pre-filled Gmail window.
   ========================================================================== */
'use strict';

(function () {
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t = 'info', ms) => { if (typeof toast === 'function') toast(m, t, ms); };

  const TIERS = ['free', 'pro', 'team', 'enterprise'];
  const MONEY_KINDS = ['upgrade', 'payment', 'kyb'];
  let leads = [];
  let users = [];
  let reviews = [];
  let revFilter = 'new';
  let promos = [];
  let winners = { cur: [], prev: [], curId: '', prevId: '' };
  let awarded = {};
  let aiLimits = { free: 15, pro: 60 };
  let offer = { active: false, code: '', text: '' };
  let cchal = [];
  let reports = [];
  let photos = [];
  let showChecked = false;
  let repView = {};
  let cwin = {};
  let tab = 'requests';
  let filter = 'new';
  let search = '';
  let unsub = null;
  let started = false;
  let loadError = '';

  const isAdmin = () => state.user?.role === 'admin';
  const db = () => window.MH_FIREBASE?.db;
  const FV = () => window.firebase.firestore.FieldValue;
  const when = (ts) => { try { const d = ts?.toDate ? ts.toDate() : new Date(ts); return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  const isNew = (l) => !l.status || l.status === 'new';
  const short = (uid) => (uid ? `${uid.slice(0, 6)}…${uid.slice(-4)}` : '');

  /* ------------------------------------------------------------------ */
  /* Mounting                                                            */
  /* ------------------------------------------------------------------ */
  function mount() {
    if (q('#view-admin')) return;
    const main = q('main');
    if (!main) return;
    const section = document.createElement('section');
    section.className = 'view';
    section.id = 'view-admin';
    section.innerHTML = `
      <div class="section-head">
        <div><span class="panel-kicker">ADMIN</span><h2>Requests &amp; customers</h2>
          <p>Approve plans, verify businesses and reply to customers. Only accounts marked admin can open this.</p></div>
        <button class="btn btn-glass" id="adminRefresh">Refresh</button>
      </div>
      <div id="adminRoot"></div>`;
    main.appendChild(section);

    const actions = q('.top-actions');
    if (actions && !q('#adminBtn')) {
      const btn = document.createElement('button');
      btn.id = 'adminBtn';
      btn.className = 'btn btn-glass small hidden';
      btn.innerHTML = 'Admin <span class="admin-badge hidden" id="adminBadge">0</span>';
      btn.addEventListener('click', () => setView('admin'));
      actions.insertBefore(btn, actions.firstChild);
    }
    q('#adminRefresh').addEventListener('click', () => { loadUsers(); notify('Refreshed.', 'info', 1500); });
    q('#adminRoot').addEventListener('click', onClick);
    q('#adminRoot').addEventListener('input', (e) => { if (e.target.id === 'adminSearch') { search = e.target.value.trim().toLowerCase(); render(); q('#adminSearch')?.focus(); q('#adminSearch').setSelectionRange(search.length, search.length); } });
    q('#adminRoot').addEventListener('change', onChange);
  }

  async function start() {
    if (started || !isAdmin()) return;
    started = true;
    try {
      await window.MH_FIREBASE.initFirebase();
      if (!db()) throw new Error('Database not ready');
      unsub = db().collection('rfq_leads').orderBy('created_at', 'desc').limit(150).onSnapshot((snap) => {
        leads = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        loadError = '';
        render();
        updateBadge();
      }, (err) => { loadError = err.message; render(); });
      db().collection('feedback').orderBy('created_at', 'desc').limit(200).onSnapshot((snap) => {
        reviews = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        render();
      }, (err) => { loadError = err.message; render(); });
      loadExtras();
      await loadUsers();
    } catch (err) { loadError = err.message; started = false; render(); }
  }

  async function loadUsers() {
    try {
      const snap = await db().collection('users').limit(500).get();
      users = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
      loadError = '';
    } catch (err) { loadError = err.message; }
    render();
  }

  function updateBadge() {
    const n = leads.filter((l) => isNew(l) && MONEY_KINDS.includes(l.kind)).length;
    const badge = q('#adminBadge');
    if (!badge) return;
    badge.textContent = String(n);
    badge.classList.toggle('hidden', n === 0);
  }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                              */
  /* ------------------------------------------------------------------ */
  function userForLead(l) {
    return users.find((u) => u.uid === l.user_id) || users.find((u) => String(u.email || '').toLowerCase() === String(l.email || '').toLowerCase());
  }
  function requestedTier(l) {
    const t = String(l.plan || '').toLowerCase();
    return TIERS.includes(t) ? t : '';
  }
  function gmail(to, subject, body) {
    return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }
  const planName = (t) => ({ pro: 'Pro', team: 'Team', enterprise: 'Enterprise', free: 'Free' }[t] || t);

  /* ------------------------------------------------------------------ */
  /* Render                                                               */
  /* ------------------------------------------------------------------ */
  function render() {
    const root = q('#adminRoot');
    if (!root) return;
    if (!isAdmin()) { root.innerHTML = '<div class="empty-state"><strong>Admins only</strong><span>Sign in with an admin account.</span></div>'; return; }
    const newCount = leads.filter(isNew).length;
    const paid = users.filter((u) => u.tier && u.tier !== 'free').length;
    const newReviews = reviews.filter((r) => !r.status || r.status === 'Open').length;
    root.innerHTML = `
      ${loadError ? `<div class="ai-note warn"><b>Could not load data.</b> ${esc(loadError)} Check that you deployed the latest Firestore rules and that your user document has role = admin.</div>` : ''}
      <div class="admin-stats">
        <div class="glass"><span>New requests</span><strong>${newCount}</strong></div>
        <div class="glass"><span>Total customers</span><strong>${users.length}</strong></div>
        <div class="glass"><span>On a paid plan</span><strong>${paid}</strong></div>
        <div class="glass"><span>Verified businesses</span><strong>${users.filter((u) => u.kyb_status === 'approved').length}</strong></div>
      </div>
      <div class="admin-tabs">
        <button class="${tab === 'requests' ? 'active' : ''}" data-tab="requests">Requests${newCount ? ` <i>${newCount}</i>` : ''}</button>
        <button class="${tab === 'reviews' ? 'active' : ''}" data-tab="reviews">Reviews${newReviews ? ` <i>${newReviews}</i>` : ''}</button>
        <button class="${tab === 'winners' ? 'active' : ''}" data-tab="winners">Winners</button>
        <button class="${tab === 'photos' ? 'active' : ''}" data-tab="photos">Photos${photosToCheck().length ? ` (${photosToCheck().length})` : ''}</button>
        <button class="${tab === 'reports' ? 'active' : ''}" data-tab="reports">Reports${reports.some((r) => r.status === 'new') ? ' •' : ''}</button>
        <button class="${tab === 'community' ? 'active' : ''}" data-tab="community">Community${cchal.some((c) => c.status === 'pending') ? ' •' : ''}</button>
        <button class="${tab === 'promos' ? 'active' : ''}" data-tab="promos">Promo codes</button>
        <button class="${tab === 'users' ? 'active' : ''}" data-tab="users">Customers</button>
      </div>
      ${['reviews', 'winners', 'promos', 'community', 'reports', 'photos'].includes(tab) ? '' : `<input id="adminSearch" class="admin-search" type="search" placeholder="${tab === 'users' ? 'Search by email, name or user ID' : 'Search requests by email, name or organisation'}" value="${esc(search)}" />`}
      ${tab === 'requests' ? requestsHtml() : tab === 'reviews' ? reviewsHtml() : tab === 'winners' ? winnersHtml() : tab === 'promos' ? promosHtml() : tab === 'community' ? communityHtml() : tab === 'reports' ? reportsHtml() : tab === 'photos' ? photosHtml() : usersHtml()}`;
  }

  function requestsHtml() {
    let list = leads;
    if (filter === 'new') list = list.filter(isNew);
    if (search) list = list.filter((l) => [l.email, l.name, l.organization, l.user_id].some((v) => String(v || '').toLowerCase().includes(search)));
    const chips = ['new', 'all'].map((f) => `<button class="${filter === f ? 'active' : ''}" data-filter="${f}">${f === 'new' ? 'Needs action' : 'Everything'}</button>`).join('');
    if (!list.length) return `<div class="admin-filter">${chips}</div><div class="empty-state"><strong>${filter === 'new' ? 'Nothing waiting' : 'No requests yet'}</strong><span>New upgrade, payment and RFQ requests appear here instantly.</span></div>`;
    return `<div class="admin-filter">${chips}</div><div class="admin-list">${list.map(requestCard).join('')}</div>`;
  }

  function requestCard(l) {
    const u = userForLead(l);
    const want = requestedTier(l);
    const money = MONEY_KINDS.includes(l.kind);
    const done = l.status && l.status !== 'new';
    const body = `Hi ${(l.name || '').split(' ')[0] || 'there'},\n\nThanks for your MaterialHunt request.`;
    const approveBtns = l.kind === 'kyb' && u
      ? `<button class="btn btn-primary small" data-kybok="${l.id}" data-uid="${esc(u.uid)}">Verify business</button>`
      : (money && want && u && want !== 'enterprise'
        ? `<button class="btn btn-primary small" data-approve="${l.id}" data-uid="${esc(u.uid)}" data-tier="${want}">Approve ${planName(want)}</button>`
        : '');
    const needAccount = money && !u ? '<span class="admin-warn">No account with this email yet. Ask them to sign up first.</span>' : '';
    return `<article class="admin-card glass ${done ? 'done' : ''}">
      <header>
        <span class="admin-kind kind-${esc(l.kind)}">${esc(l.kind)}</span>
        <b>${esc(l.name)}</b><span class="admin-org">${esc(l.organization)}</span>
        <span class="admin-time">${esc(when(l.created_at))}</span>
        ${done ? `<span class="admin-status">${esc(l.status)}</span>` : ''}
      </header>
      <div class="admin-meta">
        <span>${esc(l.email)}</span>
        ${l.request_type ? `<span>${esc(l.request_type)}</span>` : ''}
        ${l.amount_inr ? `<span>₹${Number(l.amount_inr).toLocaleString('en-IN')}</span>` : ''}
        ${l.alloy ? `<span>${esc(l.alloy)}</span>` : ''}
      </div>
      ${l.notes ? `<p class="admin-notes">${esc(l.notes)}</p>` : ''}
      ${u ? `<p class="admin-user">Account: <b>${esc(u.email)}</b> · now <b>${esc(planName(u.tier || 'free'))}</b> · ID <code>${esc(u.uid)}</code> <button class="text-btn" data-copy="${esc(u.uid)}">Copy ID</button></p>` : ''}
      ${needAccount}
      <div class="admin-actions">
        ${approveBtns}
        <a class="btn btn-glass small" target="_blank" rel="noopener" href="${gmail(l.email, `Your MaterialHunt request`, body)}">Email them</a>
        ${!done ? `<button class="btn btn-ghost small" data-mark="${l.id}" data-status="handled">Mark handled</button><button class="btn btn-ghost small" data-mark="${l.id}" data-status="rejected">Reject</button>` : `<button class="btn btn-ghost small" data-mark="${l.id}" data-status="new">Reopen</button>`}
      </div>
    </article>`;
  }

  const stars = (n) => '★'.repeat(Math.max(0, Math.min(5, Number(n) || 0))) + '☆'.repeat(5 - Math.max(0, Math.min(5, Number(n) || 0)));

  function reviewsHtml() {
    const rated = reviews.filter((r) => Number(r.rating) > 0);
    const avg = rated.length ? (rated.reduce((a, r) => a + Number(r.rating), 0) / rated.length) : 0;
    let list = reviews;
    if (revFilter === 'new') list = list.filter((r) => !r.status || r.status === 'Open');
    const chips = ['new', 'all'].map((f) => `<button class="${revFilter === f ? 'active' : ''}" data-revfilter="${f}">${f === 'new' ? 'Unread' : 'Everything'}</button>`).join('');
    const head = `<div class="admin-stats rev-stats">
      <div class="glass"><span>Average rating</span><strong>${rated.length ? avg.toFixed(1) : '-'}<small> / 5</small></strong></div>
      <div class="glass"><span>Rated reviews</span><strong>${rated.length}</strong></div>
      <div class="glass"><span>All comments</span><strong>${reviews.length}</strong></div>
      <div class="glass"><span>Unread</span><strong>${reviews.filter((r) => !r.status || r.status === 'Open').length}</strong></div></div>`;
    if (!list.length) return `${head}<div class="admin-filter">${chips}</div><div class="empty-state"><strong>${revFilter === 'new' ? 'No unread reviews' : 'No reviews yet'}</strong><span>Reviews from signed-in users appear here instantly.</span></div>`;
    return `${head}<div class="admin-filter">${chips}</div><div class="admin-list">${list.map((r) => {
      const u = users.find((x) => x.uid === r.user_id);
      const read = r.status && r.status !== 'Open';
      const subject = 'Thanks for your MaterialHunt feedback';
      const body = `Hi ${u ? String(u.org || u.displayName || '').split(' ')[0] : 'there'},\n\nThank you for your feedback. `;
      return `<article class="admin-card glass ${read ? 'done' : ''}">
        <header><span class="admin-kind">${esc(r.category || 'General')}</span><b class="rev-stars">${stars(r.rating)}</b>
          <span class="admin-org">${u ? esc(u.email) : esc(short(r.user_id))}</span><span class="admin-time">${esc(when(r.created_at))}</span>${read ? `<span class="admin-status">${esc(r.status)}</span>` : ''}</header>
        <p class="admin-notes rev-comment">${esc(r.comment)}</p>
        <div class="admin-actions">
          ${u ? `<a class="btn btn-glass small" target="_blank" rel="noopener" href="${gmail(u.email, subject, body)}">Reply</a>` : ''}
          ${read ? `<button class="btn btn-ghost small" data-revmark="${r.id}" data-status="Open">Mark unread</button>` : `<button class="btn btn-primary small" data-revmark="${r.id}" data-status="Read">Mark as read</button>`}
        </div></article>`;
    }).join('')}</div>`;
  }

  /* ------------------------- winners (top 3 per period) ------------------------- */
  const awardCfg = () => (window.MH_CONFIG && window.MH_CONFIG.awards) || [];

  async function loadExtras() {
    try {
      const C = window.MH_CHALLENGE;
      if (C) {
        const cur = C.periodInfo(0); const prev = C.periodInfo(-1);
        winners.curId = cur.id; winners.prevId = prev.id;
        const pull = async (id) => {
          const snap = await db().collection('challenge_entries').where('period', '==', id).limit(100).get();
          return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.score - a.score).slice(0, 3);
        };
        [winners.cur, winners.prev] = await Promise.all([pull(cur.id), pull(prev.id)]);
      }
      const a = await db().collection('awards').get();
      awarded = {};
      a.docs.forEach((d) => { awarded[d.id] = d.data(); });
      try {
        const rp = await db().collection('reports').limit(100).get();
        reports = rp.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.created_at?.toMillis ? b.created_at.toMillis() : 0) - (a.created_at?.toMillis ? a.created_at.toMillis() : 0));
        const pf = await db().collection('profiles').limit(400).get();
        photos = pf.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((p) => p.avatar).sort((a, b) => (b.updated_at?.toMillis ? b.updated_at.toMillis() : 0) - (a.updated_at?.toMillis ? a.updated_at.toMillis() : 0));
        const pz = await db().collection('prizes').limit(300).get();
        pz.docs.forEach((d) => { awarded[d.id] = { days: d.data().days, claimed: d.data().claimed }; });
      } catch { /* rules not deployed yet */ }
      const cc = await db().collection('community_challenges').limit(100).get();
      cchal = cc.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.created_at?.toMillis ? b.created_at.toMillis() : 0) - (a.created_at?.toMillis ? a.created_at.toMillis() : 0));
      const off = await db().collection('settings').doc('public_promo').get();
      if (off.exists) offer = { active: Boolean(off.data().active), code: off.data().code || '', text: off.data().text || '' };
      const lim = await db().collection('settings').doc('ai').get();
      if (lim.exists) aiLimits = { free: Number(lim.data().free) || 15, pro: Number(lim.data().pro) || 60 };
      const pr = await db().collection('promos').get();
      promos = pr.docs.map((d) => ({ code: d.id, ...d.data() })).sort((x, y) => String(y.created_at?.toMillis ? y.created_at.toMillis() : 0).localeCompare(String(x.created_at?.toMillis ? x.created_at.toMillis() : 0)));
      render();
    } catch (err) { loadError = err.message; render(); }
  }

  function winnerBlock(title, benchId, list, periodId, canAward) {
    const cfg = awardCfg();
    const bench = benchId && typeof BENCHMARKS !== 'undefined' ? BENCHMARKS[benchId] : null;
    if (!list.length) return `<div class="admin-card glass"><b>${esc(title)}</b><p class="admin-notes">No entries yet.</p></div>`;
    return `<div class="admin-card glass"><header><b>${esc(title)}</b><span class="admin-org">${esc(periodId)}${bench ? ` · ${esc(bench.title)}` : ''}</span></header>
      ${list.map((r, i) => {
        const prize = canAward ? cfg[i] : null;
        const key = `${periodId}_${i + 1}`;
        const done = awarded[key];
        return `<div class="winner-row"><span class="lb-rank">${i + 1}</span>
          <span><b>${esc(r.name)}</b> <span class="medal-dot medal-${esc(String(r.medal || '').toLowerCase())}"></span><br><small class="admin-org">${esc(r.formula)} · SF ${Number(r.sf).toFixed(2)} · ₹${Number(r.cost).toLocaleString('en-IN')} · score ${r.score}</small></span>
          ${prize ? (done ? `<span class="admin-status">${done.claimed === false ? 'Prize sent, not claimed yet' : 'Awarded'} · ${esc(done.days)} days</span>` : `<button class="btn btn-primary small" data-award="${esc(key)}|${esc(r.user_id)}|${prize.days}">Award ${esc(prize.prize)}</button>`) : ''}
          <button class="text-btn" data-copy="${esc(r.user_id)}">Copy ID</button></div>`;
      }).join('')}</div>`;
  }

  function winnersHtml() {
    const C = window.MH_CHALLENGE;
    if (!C) return '<div class="empty-state"><span>Open the benchmark page once, then return here.</span></div>';
    return `<p class="micro-note">Only the top 3 of each leaderboard win. Prizes are issued automatically after each period ends (the winner claims them in their notifications). The Award buttons are a manual backup.</p>
      <p><button class="btn btn-glass small" id="prizeRun">Check for prizes now</button></p>
      <div class="admin-list">${winnerBlock('Finished period (award these)', C.benchIdFor(C.periodInfo(-1)), winners.prev, winners.prevId, true)}${winnerBlock('This period (live, awarded after it ends)', C.benchIdFor(C.periodInfo(0)), winners.cur, winners.curId, false)}</div>`;
  }

  async function award(token) {
    const [key, userId, days] = token.split('|');
    const n = Number(days);
    const uref = db().collection('users').doc(userId);
    const snap = await uref.get();
    const ms = (t) => (t && t.toDate ? t.toDate().getTime() : 0);
    const base = Math.max(Date.now(), ms(snap.data()?.pro_until));
    const until = window.firebase.firestore.Timestamp.fromDate(new Date(base + n * 86400000));
    await uref.update({ pro_until: until, award_note: key });
    const [period, rank] = key.split('_');
    await db().collection('awards').doc(key).set({ period, rank: Number(rank), user_id: userId, days: n, created_at: FV().serverTimestamp(), by: window.MH_FIREBASE.auth.currentUser.uid });
    awarded[key] = { days: n };
    notify(`Awarded ${n} days of Pro.`, 'success', 3500);
    render();
  }

  /* ------------------------- promo codes ------------------------- */
  function randomCode() {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    return `MH-${Array.from(bytes).map((b) => alphabet[b % alphabet.length]).join('')}`;
  }

  function promosHtml() {
    return `<div class="admin-card glass"><b>Assistant limits (live AI questions per member per day)</b>
      <p class="admin-notes">Enforced by the database. Lower these on a busy day so the free AI allowance lasts; the built-in assistant keeps working after the limit. Resets at midnight India time.</p>
      <div class="promo-form"><input id="limFree" type="number" min="1" max="500" value="${aiLimits.free}" /><span>free members</span>
        <input id="limPro" type="number" min="1" max="1000" value="${aiLimits.pro}" /><span>Pro members</span>
        <button class="btn btn-primary small" id="limSave">Save limits</button></div></div>
      ${offerHtml()}${promosHtmlCodes()}`;
  }

  /* ------------------------- community challenges ------------------------- */
  const cms = (t) => (t && t.toMillis ? t.toMillis() : 0);

  function communityHtml() {
    if (!cchal.length) return '<div class="empty-state"><strong>No community challenges yet</strong></div>';
    const order = { pending: 0, live: 1, closed: 2, rejected: 3 };
    const list = cchal.slice().sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
    return `<p class="micro-note">Approve a challenge only if it is sensible and appropriate for a public audience that includes students. Its creator already passed it in the Forge (reference alloy shown). Prizes only count after you mark the challenge funded, which you do once the creator's payment has reached you.</p>
      <div class="admin-list">${list.map((c) => {
        const ended = c.status === 'closed' || (c.status === 'live' && cms(c.ends_at) < Date.now());
        const w = cwin[c.id];
        return `<div class="admin-card glass ${c.status === 'rejected' || c.status === 'closed' ? 'done' : ''}"><header><b>${esc(c.title)}</b><span class="admin-org">by ${esc(c.owner_name)} · ${esc(c.status)}</span><span class="admin-time">${c.status === 'live' ? `ends ${new Date(cms(c.ends_at)).toLocaleDateString('en-IN')}` : ''}</span></header>
          <p class="admin-notes">${esc(c.brief)}</p>
          <p class="admin-notes">${Number(c.temp).toLocaleString('en-IN')} °C · ${c.burst} MPa · wall ${c.load} MPa · ≤ ${c.max_density} g/cm³ · ≤ ₹${Number(c.max_cost).toLocaleString('en-IN')} · SF ≥ ${c.min_sf} · ${c.metals_only ? 'metals only' : 'any element'}${c.banned ? ` · banned ${esc(c.banned)}` : ''} · ${esc(c.environment)}<br>Creator's solution: <b>${esc(c.ref_formula)}</b> (SF ${Number(c.ref_sf).toFixed(2)}) · prize: ${c.prize_days ? `${c.prize_days} days Pro × 3, ${c.funded ? 'FUNDED' : 'not yet paid'}` : 'none'} · creator ID <code>${esc(c.owner)}</code></p>
          <div class="admin-actions">
            ${c.status === 'pending' ? `<select id="ccDays-${esc(c.id)}" class="field-select small"><option value="7">7 days</option><option value="14" selected>14 days</option><option value="30">30 days</option></select>
              <button class="btn btn-primary small" data-cc="approve" data-id="${esc(c.id)}">Approve</button><button class="btn btn-ghost small" data-cc="reject" data-id="${esc(c.id)}">Reject</button>` : ''}
            ${c.status === 'live' ? `<button class="btn btn-ghost small" data-cc="close" data-id="${esc(c.id)}">Close now</button>` : ''}
            ${c.prize_days && c.status !== 'rejected' ? `<button class="btn btn-glass small" data-cc="fund" data-id="${esc(c.id)}">${c.funded ? 'Mark not paid' : 'Mark as paid'}</button>` : ''}
            ${c.status !== 'pending' && c.status !== 'rejected' ? `<button class="btn btn-glass small" data-cc="winners" data-id="${esc(c.id)}">Top 3</button>` : ''}
          </div>
          ${w ? (w.map((r, i) => {
            const key = `${c.id}_${i + 1}`;
            const done = awarded[key];
            const can = c.prize_days && c.funded && ended;
            return `<div class="winner-row"><span class="lb-rank">${i + 1}</span><span><b>${esc(r.name)}</b><br><small class="admin-org">${esc(r.formula)} · SF ${Number(r.sf).toFixed(2)} · ₹${Number(r.cost).toLocaleString('en-IN')} · score ${r.score}</small></span>
              ${done ? `<span class="admin-status">${done.claimed === false ? 'Prize sent, not claimed yet' : 'Awarded'} · ${esc(done.days)} days</span>` : can ? `<button class="btn btn-primary small" data-award="${esc(key)}|${esc(r.user_id)}|${c.prize_days}">Award ${c.prize_days} days Pro</button>` : `<small class="admin-org">${c.prize_days ? (c.funded ? 'after it ends' : 'not funded') : 'no prize'}</small>`}
              <button class="text-btn" data-copy="${esc(r.user_id)}">Copy ID</button></div>`;
          }).join('') || '<p class="admin-notes">No entries.</p>') : ''}
        </div>`;
      }).join('')}</div>`;
  }

  async function communityAction(t) {
    const id = t.dataset.id;
    const c = cchal.find((x) => x.id === id);
    if (!c) return;
    const ref = db().collection('community_challenges').doc(id);
    if (t.dataset.cc === 'approve') {
      const days = Number(q(`#ccDays-${id}`)?.value) || 14;
      const ends = window.firebase.firestore.Timestamp.fromDate(new Date(Date.now() + days * 86400000));
      await ref.update({ status: 'live', ends_at: ends });
      c.status = 'live'; c.ends_at = ends;
      notify('Challenge is live.', 'success', 3000);
    } else if (t.dataset.cc === 'reject') {
      const note = (window.prompt('Reason for the creator (optional, they will see it):') || '').slice(0, 200);
      await ref.update(note ? { status: 'rejected', admin_note: note } : { status: 'rejected' });
      c.status = 'rejected'; c.admin_note = note;
    } else if (t.dataset.cc === 'close') {
      await ref.update({ status: 'closed' });
      c.status = 'closed';
    } else if (t.dataset.cc === 'fund') {
      await ref.update({ funded: !c.funded });
      c.funded = !c.funded;
    } else if (t.dataset.cc === 'winners') {
      const snap = await db().collection('community_entries').where('challenge', '==', id).limit(100).get();
      cwin[id] = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.score - a.score).slice(0, 3);
    }
    render();
  }

  function offerHtml() {
    return `<div class="admin-card glass"><b>Show a code on the pricing page</b>
      <p class="admin-notes">Nothing is shown by default. Turn this on at the summit so visitors can tap the code instead of typing it. The code must already exist below.</p>
      <div class="promo-form"><input id="offerCode" type="text" maxlength="40" placeholder="Code" value="${esc(offer.code || '')}" />
        <input id="offerText" type="text" maxlength="90" placeholder="Message" value="${esc(offer.text || 'Summit visitors: 2 days of free Pro.')}" />
        <button class="btn btn-primary small" id="offerOn">${offer.active ? 'Update' : 'Show it'}</button>${offer.active ? '<button class="btn btn-ghost small" id="offerOff">Hide it</button>' : ''}</div></div>`;
  }

  /* ------------------------- reports (photos and misuse) ------------------------- */
  const REASONS = { photo: 'Inappropriate photo', name_or_bio: 'Inappropriate name or bio', harassment: 'Harassment or abuse', other: 'Something else' };

  /* ------------------------- daily photo check by hand ------------------------- */
  const photoKey = (p) => `${p.uid}:${String(p.avatar).length}:${String(p.avatar).slice(-24)}`;
  const checkedMap = () => { try { return JSON.parse(localStorage.getItem('mh_photo_ok') || '{}'); } catch { return {}; } };
  const photosToCheck = () => { const m = checkedMap(); return photos.filter((p) => !m[photoKey(p)]); };

  function photosHtml() {
    const m = checkedMap();
    const list = showChecked ? photos : photosToCheck();
    return `<p class="micro-note">Photos are not checked by AI (to save the free AI budget for the assistant), so look at them here once a day. "Looks fine" hides a photo from this list (on this device only). "Remove" deletes it and stops that member adding photos again. Only members who switched "show my photo" on have it visible to others.</p>
      <p><button class="btn btn-ghost small" id="phAll">${showChecked ? 'Show only unchecked' : 'Show already checked too'}</button> <span class="admin-org">${photosToCheck().length} to check · ${photos.length} photos in total</span></p>
      <div class="photo-grid">${list.length ? list.map((p) => `<div class="photo-tile glass"><img src="${esc(p.avatar)}" alt="" /><b>${esc(p.display_name || 'Member')}</b><small class="admin-org">${p.show_avatar ? 'shown on leaderboard' : 'private'}${m[photoKey(p)] ? ' · checked' : ''}</small>
        <div class="admin-actions"><button class="btn btn-glass small" data-ph="ok" data-id="${esc(p.uid)}">Looks fine</button><button class="btn btn-primary small" data-ph="remove" data-id="${esc(p.uid)}">Remove</button></div></div>`).join('') : '<div class="empty-state"><strong>Nothing to check</strong><span>New photos will appear here.</span></div>'}</div>`;
  }

  async function photoAction(t) {
    const p = photos.find((x) => x.uid === t.dataset.id);
    if (!p) return;
    if (t.dataset.ph === 'ok') {
      const m = checkedMap(); m[photoKey(p)] = Date.now(); localStorage.setItem('mh_photo_ok', JSON.stringify(m));
    } else if (t.dataset.ph === 'remove') {
      await db().collection('profiles').doc(p.uid).update({ avatar: '', show_avatar: false, photo_blocked: true });
      photos = photos.filter((x) => x.uid !== p.uid);
      notify('Photo removed and photos blocked for that member.', 'success', 3500);
    }
    render();
  }

  function reportsHtml() {
    if (!reports.length) return '<div class="empty-state"><strong>No reports</strong><span>Reports about profiles will appear here.</span></div>';
    const list = reports.slice().sort((a, b) => (a.status === 'new' ? 0 : 1) - (b.status === 'new' ? 0 : 1));
    return `<p class="micro-note">Look at the profile first. "Remove photo" deletes the picture and stops that member adding photos again. Photos are also checked automatically before they appear.</p>
      <div class="admin-list">${list.map((r) => {
        const v = repView[r.target];
        return `<div class="admin-card glass ${r.status === 'new' ? '' : 'done'}"><header><b>${esc(REASONS[r.reason] || r.reason)}</b><span class="admin-org">${esc(r.status)}</span><span class="admin-time">${r.created_at?.toDate ? esc(r.created_at.toDate().toLocaleString('en-IN')) : ''}</span></header>
          ${r.note ? `<p class="admin-notes">${esc(r.note)}</p>` : ''}
          <p class="admin-notes">Reported member: <code>${esc(r.target)}</code> · reported by <code>${esc(r.reporter)}</code></p>
          ${v === undefined ? '' : v === null ? '<p class="admin-notes">This member has no profile.</p>' : `<div class="winner-row">${v.avatar ? `<img src="${esc(v.avatar)}" alt="" style="width:64px;height:64px;border-radius:12px;object-fit:cover" />` : '<span class="admin-org">No photo</span>'}<span><b>${esc(v.display_name)}</b><br><small class="admin-org">${esc([v.who, v.org].filter(Boolean).join(' · '))}</small><br><small>${esc(v.bio)}</small></span></div>`}
          <div class="admin-actions"><button class="btn btn-glass small" data-rp="view" data-id="${esc(r.id)}">Show profile</button>
            <button class="btn btn-primary small" data-rp="photo" data-id="${esc(r.id)}">Remove photo and block photos</button>
            <button class="btn btn-glass small" data-rp="reset" data-id="${esc(r.id)}">Reset name and bio</button>
            ${r.status === 'new' ? `<button class="btn btn-ghost small" data-rp="done" data-id="${esc(r.id)}">Dismiss</button>` : ''}</div></div>`;
      }).join('')}</div>`;
  }

  async function reportAction(t) {
    const r = reports.find((x) => x.id === t.dataset.id);
    if (!r) return;
    const pref = db().collection('profiles').doc(r.target);
    if (t.dataset.rp === 'view') {
      const snap = await pref.get();
      repView[r.target] = snap.exists ? snap.data() : null;
    } else if (t.dataset.rp === 'photo') {
      await pref.update({ avatar: '', show_avatar: false, photo_blocked: true });
      repView[r.target] = { ...(repView[r.target] || {}), avatar: '' };
      await db().collection('reports').doc(r.id).update({ status: 'actioned', handled_at: FV().serverTimestamp() });
      r.status = 'actioned';
      notify('Photo removed and photos blocked for that member.', 'success', 3500);
    } else if (t.dataset.rp === 'reset') {
      await pref.update({ display_name: 'Member', bio: '' });
      repView[r.target] = { ...(repView[r.target] || {}), display_name: 'Member', bio: '' };
      await db().collection('reports').doc(r.id).update({ status: 'actioned', handled_at: FV().serverTimestamp() });
      r.status = 'actioned';
      notify('Name and bio reset.', 'success', 3000);
    } else if (t.dataset.rp === 'done') {
      await db().collection('reports').doc(r.id).update({ status: 'dismissed', handled_at: FV().serverTimestamp() });
      r.status = 'dismissed';
    }
    render();
  }

  async function runPrizeJob(btn) {
    const base = window.MH_CONFIG?.aiProxyUrl;
    if (!base) { notify('The assistant server address is not set.', 'warning', 4000); return; }
    btn.disabled = true;
    try {
      const token = await window.MH_FIREBASE.auth.currentUser.getIdToken();
      const res = await fetch(`${base}/run-prizes`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'failed');
      notify(`Prize check done: ${j.issued.length} issued, ${j.skipped} already done${j.errors.length ? `, problem: ${j.errors[0]}` : ''}.`, j.errors.length ? 'warning' : 'success', 7000);
      loadExtras();
    } catch (e) { notify(`Could not run the prize check: ${e.message}`, 'error', 7000); }
    btn.disabled = false;
  }

  function promosHtmlCodes() {
    return `<div class="admin-card glass"><b>Create a promo code</b>
      <p class="admin-notes">Leave the code box empty for a long random code (safest). A short readable code such as CCQBSTS2026 is easier to share but easier to guess, so give it a low number of uses. Codes live only in your database, and each person can redeem one.</p>
      <div class="promo-form"><input id="promoCustom" type="text" maxlength="40" placeholder="Code (leave empty for a random one)" autocapitalize="characters" /><input id="promoLabel" type="text" maxlength="60" placeholder="Label, e.g. Tech summit" />
        <input id="promoDays" type="number" min="1" max="365" value="2" title="Days of Pro" /><span>days</span>
        <input id="promoMax" type="number" min="1" max="100000" value="500" title="Maximum uses" /><span>uses</span>
        <button class="btn btn-primary small" id="promoCreate">Generate code</button></div></div>
      <div class="admin-list">${promos.length ? promos.map((c) => `<div class="admin-card glass ${c.active ? '' : 'done'}"><header><code class="promo-code">${esc(c.code)}</code><span class="admin-org">${esc(c.label || '')}</span><span class="admin-time">${Number(c.uses || 0)} / ${Number(c.max_uses || 0)} used · ${Number(c.days || 0)} days</span></header>
        <div class="admin-actions"><button class="btn btn-glass small" data-copy="${esc(c.code)}">Copy code</button>
          <button class="btn btn-ghost small" data-promo-toggle="${esc(c.code)}">${c.active ? 'Turn off' : 'Turn on'}</button>
          <button class="btn btn-ghost small" data-promo-del="${esc(c.code)}">Delete</button></div></div>`).join('') : '<div class="empty-state"><strong>No codes yet</strong><span>Generate one above.</span></div>'}</div>`;
  }

  async function createPromo() {
    const days = Math.max(1, Math.min(365, Number(q('#promoDays').value) || 2));
    const max = Math.max(1, Math.min(100000, Number(q('#promoMax').value) || 100));
    const label = (q('#promoLabel').value || '').trim().slice(0, 60);
    const typed = (q('#promoCustom')?.value || '').toUpperCase().replace(/\s+/g, '');
    if (typed && !/^[A-Z0-9-]{6,40}$/.test(typed)) { notify('Use 6 to 40 letters, numbers or dashes.', 'warning', 4000); return; }
    const code = typed || randomCode();
    if (typed && promos.some((p) => p.code === code)) { notify('That code already exists.', 'warning', 3500); return; }
    await db().collection('promos').doc(code).set({ days, max_uses: max, uses: 0, active: true, label, created_at: FV().serverTimestamp() });
    promos.unshift({ code, days, max_uses: max, uses: 0, active: true, label });
    notify(`Code ${code} created. Copy it now.`, 'success', 5000);
    render();
  }

  function usersHtml() {
    let list = users.slice().sort((a, b) => String(b.email).localeCompare(String(a.email)));
    if (search) list = list.filter((u) => [u.email, u.displayName, u.org, u.uid].some((v) => String(v || '').toLowerCase().includes(search)));
    if (!list.length) return '<div class="empty-state"><strong>No customers found</strong><span>Try a different search.</span></div>';
    return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Customer</th><th>Plan</th><th>Business verified</th><th>User ID</th></tr></thead><tbody>${list.slice(0, 200).map((u) => `
      <tr>
        <td><b>${esc(u.org || u.displayName || '')}</b><br><span>${esc(u.email)}</span></td>
        <td><select data-tier-uid="${esc(u.uid)}">${TIERS.map((t) => `<option value="${t}" ${t === (u.tier || 'free') ? 'selected' : ''}>${planName(t)}</option>`).join('')}</select></td>
        <td><button class="btn ${u.kyb_status === 'approved' ? 'btn-primary' : 'btn-glass'} small" data-kyb="${esc(u.uid)}" data-state="${u.kyb_status === 'approved' ? 'pending' : 'approved'}">${u.kyb_status === 'approved' ? 'Verified ✓' : 'Verify'}</button></td>
        <td><code>${esc(short(u.uid))}</code> <button class="text-btn" data-copy="${esc(u.uid)}">Copy</button></td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                              */
  /* ------------------------------------------------------------------ */
  async function setTier(uid, tier) {
    await db().collection('users').doc(uid).update({ tier, tier_set_at: FV().serverTimestamp() });
    const u = users.find((x) => x.uid === uid);
    if (u) u.tier = tier;
  }
  async function markLead(id, status, note) {
    const update = { status, handled_at: FV().serverTimestamp(), handled_by: window.MH_FIREBASE.auth.currentUser.uid };
    if (note) update.admin_note = String(note).trim().slice(0, 300);
    await db().collection('rfq_leads').doc(id).update(update);
    const l = leads.find((x) => x.id === id);
    if (l) { l.status = status; if (note) l.admin_note = update.admin_note; }
  }

  async function onClick(e) {
    const t = e.target.closest('[data-tab],[data-filter],[data-revfilter],[data-revmark],[data-approve],[data-kybok],[data-mark],[data-kyb],[data-copy],[data-award],[data-promo-toggle],[data-promo-del],#promoCreate,#limSave,#offerOn,#offerOff,[data-cc],[data-rp],[data-ph],#phAll,#prizeRun');
    if (!t) return;
    try {
      if (t.dataset.tab) { tab = t.dataset.tab; search = ''; render(); }
      else if (t.dataset.filter) { filter = t.dataset.filter; render(); }
      else if (t.dataset.revfilter) { revFilter = t.dataset.revfilter; render(); }
      else if (t.dataset.award) { await award(t.dataset.award); }
      else if (t.dataset.promoToggle) {
        const pr = promos.find((x) => x.code === t.dataset.promoToggle);
        await db().collection('promos').doc(pr.code).update({ active: !pr.active });
        pr.active = !pr.active; render();
      } else if (t.dataset.promoDel) {
        if (!t.dataset.sure) { t.dataset.sure = '1'; t.textContent = 'Sure?'; setTimeout(() => { if (t.isConnected) { delete t.dataset.sure; t.textContent = 'Delete'; } }, 3000); return; }
        await db().collection('promos').doc(t.dataset.promoDel).delete();
        promos = promos.filter((x) => x.code !== t.dataset.promoDel); render();
      } else if (t.id === 'promoCreate') { await createPromo(); }
      else if (t.dataset.cc) { await communityAction(t); }
      else if (t.dataset.rp) { await reportAction(t); }
      else if (t.dataset.ph) { await photoAction(t); }
      else if (t.id === 'phAll') { showChecked = !showChecked; render(); }
      else if (t.id === 'prizeRun') { await runPrizeJob(t); }
      else if (t.id === 'offerOn') {
        const code = (q('#offerCode').value || '').toUpperCase().replace(/\s+/g, '');
        if (!promos.some((p) => p.code === code)) { notify('Create that code first (below), then show it.', 'warning', 4500); return; }
        offer = { active: true, code, text: (q('#offerText').value || '').trim().slice(0, 90) };
        await db().collection('settings').doc('public_promo').set(offer);
        notify('The code is now shown on the pricing page.', 'success', 3500); render();
      } else if (t.id === 'offerOff') {
        offer.active = false;
        await db().collection('settings').doc('public_promo').set(offer);
        notify('Hidden from the pricing page.', 'info', 3000); render();
      }
      else if (t.id === 'limSave') {
        const free = Math.max(1, Math.min(500, Number(q('#limFree').value) || 15));
        const pro = Math.max(1, Math.min(1000, Number(q('#limPro').value) || 60));
        await db().collection('settings').doc('ai').set({ free, pro });
        aiLimits = { free, pro };
        notify(`Limits saved: ${free} free, ${pro} Pro per day.`, 'success', 3500);
        render();
      }
      else if (t.dataset.revmark) {
        await db().collection('feedback').doc(t.dataset.revmark).update({ status: t.dataset.status, triaged_at: FV().serverTimestamp() });
        const rv = reviews.find((x) => x.id === t.dataset.revmark);
        if (rv) rv.status = t.dataset.status;
        render();
      }
      else if (t.dataset.copy) { await navigator.clipboard?.writeText(t.dataset.copy); notify('User ID copied.', 'success', 1500); }
      else if (t.dataset.approve) {
        t.disabled = true;
        await setTier(t.dataset.uid, t.dataset.tier);
        await markLead(t.dataset.approve, 'approved');
        const l = leads.find((x) => x.id === t.dataset.approve);
        notify(`${planName(t.dataset.tier)} approved for ${l?.email || 'customer'}. Use "Email them" to let them know.`, 'success', 4500);
        updateBadge(); render();
      } else if (t.dataset.kybok) {
        t.disabled = true;
        await db().collection('users').doc(t.dataset.uid).update({ kyb_status: 'approved' });
        const ku = users.find((x) => x.uid === t.dataset.uid);
        if (ku) ku.kyb_status = 'approved';
        await markLead(t.dataset.kybok, 'approved');
        notify('Business verified. The badge now shows on their account.', 'success', 4500);
        updateBadge(); render();
      } else if (t.dataset.mark) {
        let note = '';
        if (t.dataset.status === 'rejected') note = window.prompt('Reason to show the customer (optional). Do not include private details:', '') || '';
        await markLead(t.dataset.mark, t.dataset.status, note);
        updateBadge(); render();
      }
      else if (t.dataset.kyb) {
        await db().collection('users').doc(t.dataset.kyb).update({ kyb_status: t.dataset.state });
        const u = users.find((x) => x.uid === t.dataset.kyb);
        if (u) u.kyb_status = t.dataset.state;
        render();
      }
    } catch (err) { notify(err.message || 'That did not work.', 'error', 5000); render(); }
  }

  async function onChange(e) {
    const sel = e.target.closest('[data-tier-uid]');
    if (!sel) return;
    try { await setTier(sel.dataset.tierUid, sel.value); notify(`Plan changed to ${planName(sel.value)}.`, 'success', 2500); render(); }
    catch (err) { notify(err.message || 'Could not change the plan.', 'error', 5000); }
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                               */
  /* ------------------------------------------------------------------ */
  function onSession() {
    const btn = q('#adminBtn');
    if (btn) btn.classList.toggle('hidden', !isAdmin());
    if (isAdmin()) start();
    else { if (unsub) { unsub(); unsub = null; } started = false; }
  }
  window.addEventListener('mh:session', onSession);

  const originalSetView = window.setView;
  window.setView = function patchedSetView(view, scroll) {
    if (view === 'admin' && !isAdmin()) { notify('Admin access only.', 'warning', 2500); return; }
    originalSetView(view, scroll);
    if (view === 'admin') { start(); render(); }
  };

  function boot() { mount(); onSession(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.MH_ADMIN = { render, _set: (l, u) => { leads = l; users = u; } };
})();
