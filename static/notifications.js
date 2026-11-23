/* ==========================================================================
   MATERIALHUNT — notifications
   A bell in the top bar. Shows the live status of the signed-in user's own requests
   (upgrade, payment, business verification, RFQ, lab test) so they can see when it
   has been approved or not approved. Reads only the user's own requests (see firestore.rules).
   ========================================================================== */
'use strict';

(function () {
  const q = (selector, root = document) => root.querySelector(selector);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t = 'info', ms) => { if (typeof toast === 'function') toast(m, t, ms); };

  const KINDS = ['upgrade', 'payment', 'kyb', 'rfq', 'lab_test'];
  let items = [];
  let unsub = null;
  let first = true;
  let refreshing = false;

  const uid = () => window.MH_FIREBASE?.auth?.currentUser?.uid || '';
  const seenKey = () => `mh_notif_seen_${uid()}`;
  const readSeen = () => { try { return JSON.parse(localStorage.getItem(seenKey()) || '{}'); } catch { return {}; } };
  const writeSeen = (m) => localStorage.setItem(seenKey(), JSON.stringify(m));
  const decided = (l) => Boolean(l.status) && l.status !== 'new';
  const isUnseen = (l) => decided(l) && readSeen()[l.id] !== l.status;
  const planName = (p) => ({ pro: 'Pro', team: 'Team', enterprise: 'your organisation', credits: 'credit pack' }[p] || '');
  const when = (ts) => { try { const d = ts?.toDate ? ts.toDate() : new Date(ts); return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

  function describe(l) {
    const plan = planName(l.plan);
    const titles = {
      upgrade: `Upgrade request${plan ? `: ${plan}` : ''}`,
      payment: `Payment confirmation${plan ? `: ${plan}` : ''}`,
      kyb: 'Verified business badge',
      rfq: 'Quote request',
      lab_test: 'Lab test request',
    };
    let tone = 'pending';
    let text = 'Pending. We will update this as soon as we have looked at it.';
    if (l.status === 'approved') {
      tone = 'good';
      text = l.kind === 'kyb' ? 'Approved. Your business is now verified.'
        : (l.kind === 'upgrade' || l.kind === 'payment') ? (l.plan === 'team' || l.plan === 'enterprise' ? 'Approved. We will be in touch by email.' : 'Approved. Your plan is now active.')
          : 'Approved. Check your email for the next step.';
    } else if (l.status === 'rejected') {
      tone = 'bad';
      text = `Not approved.${l.admin_note ? ` ${l.admin_note}` : ' Check your email for details.'}`;
    } else if (l.status === 'handled') {
      tone = 'good';
      text = `Handled. ${l.admin_note ? l.admin_note : 'Check your email for details.'}`;
    }
    return { title: titles[l.kind] || 'Request', text, tone };
  }

  /* ------------------------------------------------------------------ */
  /* Data                                                                */
  /* ------------------------------------------------------------------ */
  async function start() {
    if (unsub || !state.user) return;
    try {
      await window.MH_FIREBASE.initFirebase();
      const db = window.MH_FIREBASE.db;
      if (!db || !uid()) return;
      first = true;
      unsub = db.collection('rfq_leads').where('user_id', '==', uid()).onSnapshot((snap) => {
        items = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((l) => KINDS.includes(l.kind))
          .sort((a, b) => (b.created_at?.toMillis ? b.created_at.toMillis() : 0) - (a.created_at?.toMillis ? a.created_at.toMillis() : 0));
        if (!first) {
          snap.docChanges().forEach((c) => {
            if (c.type !== 'modified') return;
            const l = { id: c.doc.id, ...c.doc.data() };
            if (!decided(l)) return;
            const d = describe(l);
            notify(`${d.title}: ${d.text}`, d.tone === 'bad' ? 'warning' : 'success', 6000);
          });
        }
        first = false;
        render();
        refreshProfileIfNeeded();
      }, () => { /* rules not deployed yet, or offline: stay quiet */ });
    } catch { /* stay quiet */ }
  }

  function stop() {
    if (unsub) { unsub(); unsub = null; }
    items = [];
    render();
  }

  /* when a plan or business badge was approved, pull the new plan into the page without a reload */
  async function refreshProfileIfNeeded() {
    if (refreshing) return;
    const needs = items.some((l) => l.status === 'approved' && isUnseen(l) && ['upgrade', 'payment', 'kyb'].includes(l.kind));
    if (!needs) return;
    refreshing = true;
    try {
      const res = await api('/api/auth/refresh', { method: 'POST' });
      if (res?.user) setSession(state.token, res.user);
    } catch { /* will update on next load */ }
    refreshing = false;
  }

  /* ------------------------------------------------------------------ */
  /* UI                                                                  */
  /* ------------------------------------------------------------------ */
  function mount() {
    const actions = q('.top-actions');
    if (!actions || q('#notifBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'notifBtn';
    btn.className = 'icon-btn hidden notif-btn';
    btn.setAttribute('aria-label', 'Notifications');
    btn.title = 'Notifications';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9ZM10 20a2 2 0 0 0 4 0"/></svg><span class="notif-badge hidden" id="notifBadge">0</span>';
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    const anchor = q('#designsBtn') || q('#inviteBtn');
    if (anchor) actions.insertBefore(btn, anchor); else actions.insertBefore(btn, actions.firstChild);

    const panel = document.createElement('div');
    panel.id = 'notifPanel';
    panel.className = 'notif-panel glass hidden';
    panel.innerHTML = '<div class="notif-head"><b>Notifications</b><button class="text-btn" id="notifReadAll">Mark all as read</button></div><div class="notif-list" id="notifList"></div>';
    document.body.appendChild(panel);
    q('#notifReadAll', panel).addEventListener('click', () => { const m = readSeen(); items.forEach((l) => { if (decided(l)) m[l.id] = l.status; }); writeSeen(m); render(); });
    document.addEventListener('click', (e) => { if (!panel.contains(e.target) && !e.target.closest('#notifBtn')) panel.classList.add('hidden'); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') panel.classList.add('hidden'); });
  }

  function toggle() {
    const panel = q('#notifPanel');
    const opening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    if (opening) {
      render();
      // everything shown has now been seen
      const m = readSeen();
      items.forEach((l) => { if (decided(l)) m[l.id] = l.status; });
      writeSeen(m);
      setTimeout(updateBadge, 1200);
    }
  }

  function updateBadge() {
    const n = items.filter(isUnseen).length;
    const badge = q('#notifBadge');
    if (!badge) return;
    badge.textContent = String(n);
    badge.classList.toggle('hidden', n === 0);
  }

  function render() {
    updateBadge();
    const list = q('#notifList');
    if (!list) return;
    if (!items.length) { list.innerHTML = '<div class="empty-state"><strong>No notifications yet</strong><span>Upgrade, verification and quote requests you send will show their status here.</span></div>'; return; }
    const seen = readSeen();
    list.innerHTML = items.slice(0, 30).map((l) => {
      const d = describe(l);
      const fresh = decided(l) && seen[l.id] !== l.status;
      return `<article class="notif-item tone-${d.tone}${fresh ? ' fresh' : ''}">
        <span class="notif-dot"></span>
        <div><b>${esc(d.title)}</b><p>${esc(d.text)}</p><small>${esc(when(l.created_at))}</small></div></article>`;
    }).join('');
  }

  window.addEventListener('mh:session', (e) => {
    q('#notifBtn')?.classList.toggle('hidden', !e.detail.user);
    if (e.detail.user) start(); else { stop(); }
  });

  function boot() { mount(); if (state.user) { q('#notifBtn')?.classList.remove('hidden'); start(); } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.MH_NOTIFY = { _set: (list) => { items = list; render(); } };
})();
