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
        <button class="${tab === 'users' ? 'active' : ''}" data-tab="users">Customers</button>
      </div>
      ${tab === 'reviews' ? '' : `<input id="adminSearch" class="admin-search" type="search" placeholder="${tab === 'users' ? 'Search by email, name or user ID' : 'Search requests by email, name or organisation'}" value="${esc(search)}" />`}
      ${tab === 'requests' ? requestsHtml() : tab === 'reviews' ? reviewsHtml() : usersHtml()}`;
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
  async function markLead(id, status) {
    await db().collection('rfq_leads').doc(id).update({ status, handled_at: FV().serverTimestamp(), handled_by: window.MH_FIREBASE.auth.currentUser.uid });
    const l = leads.find((x) => x.id === id);
    if (l) l.status = status;
  }

  async function onClick(e) {
    const t = e.target.closest('[data-tab],[data-filter],[data-revfilter],[data-revmark],[data-approve],[data-kybok],[data-mark],[data-kyb],[data-copy]');
    if (!t) return;
    try {
      if (t.dataset.tab) { tab = t.dataset.tab; search = ''; render(); }
      else if (t.dataset.filter) { filter = t.dataset.filter; render(); }
      else if (t.dataset.revfilter) { revFilter = t.dataset.revfilter; render(); }
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
      } else if (t.dataset.mark) { await markLead(t.dataset.mark, t.dataset.status); updateBadge(); render(); }
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
