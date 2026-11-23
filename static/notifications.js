/* ==========================================================================
   MATERIALHUNT — notifications
   A bell in the top bar. The drop-down shows only what is unread; "See all" opens the full
   Notifications page. Two kinds of items:
     - the live status of the member's own requests (upgrade, payment, business verification, RFQ, lab test)
     - prizes (leaderboard and community challenge winners), which the winner claims with one tap
   Reads only the member's own records (see firestore.rules).
   ========================================================================== */
'use strict';

(function () {
  const q = (selector, root = document) => root.querySelector(selector);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t = 'info', ms) => { if (typeof toast === 'function') toast(m, t, ms); };

  const KINDS = ['upgrade', 'payment', 'kyb', 'rfq', 'lab_test'];
  let leads = [];
  let prizes = [];
  let unsubLeads = null;
  let unsubPrizes = null;
  let firstLeads = true;
  let firstPrizes = true;
  let refreshing = false;
  let claiming = false;

  const uid = () => window.MH_FIREBASE?.auth?.currentUser?.uid || '';
  const seenKey = () => `mh_notif_seen_${uid()}`;
  const readSeen = () => { try { return JSON.parse(localStorage.getItem(seenKey()) || '{}'); } catch { return {}; } };
  const writeSeen = (m) => localStorage.setItem(seenKey(), JSON.stringify(m));
  const decided = (l) => Boolean(l.status) && l.status !== 'new';
  const planName = (p) => ({ pro: 'Pro', team: 'Team', enterprise: 'your organisation', credits: 'credit pack' }[p] || '');
  const ms = (ts) => (ts?.toMillis ? ts.toMillis() : 0);
  const when = (ts) => { try { const d = ts?.toDate ? ts.toDate() : new Date(ts); return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  const ordinal = (n) => ({ 1: '1st', 2: '2nd', 3: '3rd' }[n] || `${n}th`);

  /* one common shape for everything that can appear */
  function describeLead(l) {
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
    const seen = readSeen();
    return { key: `lead:${l.id}`, id: l.id, type: 'lead', title: titles[l.kind] || 'Request', text, tone, at: ms(l.created_at), time: when(l.created_at), unread: decided(l) && seen[l.id] !== l.status, status: l.status, kind: l.kind };
  }

  function describePrize(p) {
    return {
      key: `prize:${p.id}`, id: p.id, type: 'prize', title: `${ordinal(p.rank)} place: ${p.days} days of Pro`,
      text: p.claimed ? `Claimed. ${p.days} days of Pro were added to your account.` : `Congratulations! You finished ${ordinal(p.rank)} in ${p.label || 'a leaderboard'}. Claim your Pro days now.`,
      tone: p.claimed ? 'good' : 'prize', at: ms(p.created_at), time: when(p.created_at), unread: !p.claimed, claimed: Boolean(p.claimed),
    };
  }

  const all = () => leads.map(describeLead).concat(prizes.map(describePrize)).sort((a, b) => b.at - a.at);
  const unread = () => all().filter((n) => n.unread);

  /* ------------------------------------------------------------------ */
  /* Data                                                                */
  /* ------------------------------------------------------------------ */
  async function start() {
    if (unsubLeads || !state.user) return;
    try {
      await window.MH_FIREBASE.initFirebase();
      const db = window.MH_FIREBASE.db;
      if (!db || !uid()) return;
      firstLeads = true; firstPrizes = true;
      unsubLeads = db.collection('rfq_leads').where('user_id', '==', uid()).onSnapshot((snap) => {
        leads = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((l) => KINDS.includes(l.kind));
        if (!firstLeads) {
          snap.docChanges().forEach((c) => {
            if (c.type !== 'modified') return;
            const l = { id: c.doc.id, ...c.doc.data() };
            if (!decided(l)) return;
            const d = describeLead(l);
            notify(`${d.title}: ${d.text}`, d.tone === 'bad' ? 'warning' : 'success', 6000);
          });
        }
        firstLeads = false;
        render();
        refreshProfileIfNeeded();
      }, () => { /* rules not deployed yet, or offline: stay quiet */ });
      unsubPrizes = db.collection('prizes').where('user_id', '==', uid()).onSnapshot((snap) => {
        prizes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (!firstPrizes) {
          snap.docChanges().forEach((c) => { if (c.type === 'added' && !c.doc.data().claimed) notify('You won a prize! Open your notifications to claim it.', 'success', 8000); });
        } else if (prizes.some((p) => !p.claimed)) {
          notify('You have a prize waiting. Open your notifications to claim it.', 'success', 8000);
        }
        firstPrizes = false;
        render();
      }, () => { /* stay quiet */ });
    } catch { /* stay quiet */ }
  }

  function stop() {
    if (unsubLeads) { unsubLeads(); unsubLeads = null; }
    if (unsubPrizes) { unsubPrizes(); unsubPrizes = null; }
    leads = []; prizes = [];
    render();
  }

  async function refreshSession() {
    if (refreshing) return;
    refreshing = true;
    try {
      const res = await api('/api/auth/refresh', { method: 'POST' });
      if (res?.user) setSession(state.token, res.user);
    } catch { /* will update on next load */ }
    refreshing = false;
  }

  /* when a plan or business badge was approved, pull the new plan into the page without a reload */
  function refreshProfileIfNeeded() {
    const needs = leads.some((l) => l.status === 'approved' && readSeen()[l.id] !== l.status && ['upgrade', 'payment', 'kyb'].includes(l.kind));
    if (needs) refreshSession();
  }

  /* adds the prize's Pro days to the member's own record, in one batch with marking the prize claimed (the rules check both) */
  async function claim(id) {
    const p = prizes.find((x) => x.id === id);
    if (!p || p.claimed || claiming) return;
    claiming = true;
    try {
      await window.MH_FIREBASE.initFirebase();
      const db = window.MH_FIREBASE.db;
      const FV = window.firebase.firestore;
      const uref = db.collection('users').doc(uid());
      const snap = await uref.get();
      const cur = ms(snap.data()?.pro_until);
      const until = FV.Timestamp.fromMillis(Math.max(Date.now(), cur) + Number(p.days) * 86400000);
      const batch = db.batch();
      batch.update(db.collection('prizes').doc(id), { claimed: true, claimed_at: FV.FieldValue.serverTimestamp() });
      batch.update(uref, { pro_until: until, award_note: id });
      await batch.commit();
      notify(`${p.days} days of Pro added. Enjoy!`, 'success', 6000);
      await refreshSession();
    } catch { notify('Could not claim it right now. Please try again in a moment.', 'error', 5000); }
    claiming = false;
  }

  function markRead(key) {
    const n = all().find((x) => x.key === key);
    if (!n || n.type !== 'lead') return;
    const m = readSeen();
    m[n.id] = n.status;
    writeSeen(m);
    render();
  }

  function markAllRead() {
    const m = readSeen();
    leads.forEach((l) => { if (decided(l)) m[l.id] = l.status; });
    writeSeen(m);
    render();
  }

  /* ------------------------------------------------------------------ */
  /* UI                                                                  */
  /* ------------------------------------------------------------------ */
  function itemHtml(n, compact) {
    return `<article class="notif-item tone-${n.tone}${n.unread ? ' fresh' : ''}">
      <span class="notif-dot"></span>
      <div><b>${esc(n.title)}</b><p>${esc(n.text)}</p><small>${esc(n.time)}</small>
        ${n.type === 'prize' && !n.claimed ? `<button class="btn btn-primary small notif-claim" data-claim="${esc(n.id)}">Claim ${esc(n.title.split(': ')[1] || '')}</button>` : ''}
        ${n.type === 'lead' && n.unread ? `<button class="text-btn" data-read="${esc(n.key)}">Mark as read</button>` : ''}</div></article>`;
  }

  function mount() {
    const actions = q('.top-actions');
    if (!actions || q('#notifBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'notifBtn';
    btn.className = 'icon-btn hidden notif-btn';
    btn.setAttribute('aria-label', 'Notifications');
    btn.title = 'Notifications';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9ZM10 20a2 2 0 0 0 4 0"/></svg><span class="notif-badge hidden" id="notifBadge">0</span>';
    btn.addEventListener('click', (e) => { e.stopPropagation(); q('#notifPanel').classList.toggle('hidden'); render(); });
    const anchor = q('#designsBtn') || q('#inviteBtn');
    if (anchor) actions.insertBefore(btn, anchor); else actions.insertBefore(btn, actions.firstChild);

    const panel = document.createElement('div');
    panel.id = 'notifPanel';
    panel.className = 'notif-panel glass hidden';
    panel.innerHTML = '<div class="notif-head"><b>Unread</b><button class="text-btn" id="notifReadAll">Mark all as read</button></div><div class="notif-list" id="notifList"></div><div class="notif-foot"><button class="text-btn" id="notifSeeAll">See all notifications</button></div>';
    document.body.appendChild(panel);
    q('#notifReadAll', panel).addEventListener('click', markAllRead);
    q('#notifSeeAll', panel).addEventListener('click', () => { panel.classList.add('hidden'); setView('notifications'); });
    document.addEventListener('click', (e) => {
      const c = e.target.closest('[data-claim]'); if (c) { claim(c.dataset.claim); return; }
      const r = e.target.closest('[data-read]'); if (r) { markRead(r.dataset.read); return; }
      if (!panel.contains(e.target) && !e.target.closest('#notifBtn')) panel.classList.add('hidden');
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') panel.classList.add('hidden'); });

    const main = q('main');
    if (main && !q('#view-notifications')) {
      const sec = document.createElement('section');
      sec.className = 'view';
      sec.id = 'view-notifications';
      sec.innerHTML = `<div class="section-head"><div><span class="panel-kicker">YOUR ACCOUNT</span><h2>Notifications</h2><p>Request updates and prizes. Unread items are highlighted.</p></div><button class="btn btn-glass" id="notifPageRead">Mark all as read</button></div><div class="glass notif-page" id="notifPage"></div>`;
      main.appendChild(sec);
      q('#notifPageRead', sec).addEventListener('click', markAllRead);
    }
  }

  function render() {
    const list = unread();
    const badge = q('#notifBadge');
    if (badge) { badge.textContent = String(list.length); badge.classList.toggle('hidden', list.length === 0); }
    const dd = q('#notifList');
    if (dd) {
      dd.innerHTML = list.length
        ? list.slice(0, 8).map((n) => itemHtml(n, true)).join('') + (list.length > 8 ? `<p class="micro-note" style="padding:8px 12px">${list.length - 8} more on the notifications page.</p>` : '')
        : '<div class="empty-state"><strong>You are all caught up</strong><span>New updates and prizes appear here.</span></div>';
    }
    const page = q('#notifPage');
    if (page) {
      const everything = all();
      page.innerHTML = everything.length ? everything.map((n) => itemHtml(n, false)).join('') : '<div class="empty-state"><strong>No notifications yet</strong><span>Upgrade, verification and quote requests you send, and any prizes you win, will show up here.</span></div>';
    }
  }

  window.addEventListener('mh:session', (e) => {
    q('#notifBtn')?.classList.toggle('hidden', !e.detail.user);
    if (e.detail.user) start(); else { stop(); }
  });

  function boot() { mount(); render(); if (state.user) { q('#notifBtn')?.classList.remove('hidden'); start(); } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.MH_NOTIFY = { _set: (l, p) => { leads = l; prizes = p || []; render(); } };
})();
