/* ==========================================================================
   MATERIALHUNT — forum
   A place to ask a question, check a result with other people, and answer. Verified members can post.
   Nothing is public until an admin approves it (questions and answers alike), so the forum stays safe
   for a school-run site. Replies are plain text. Nobody is asked for personal details.
   ========================================================================== */
'use strict';

(function () {
  const q = (selector, root = document) => root.querySelector(selector);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t = 'info', ms) => { if (typeof toast === 'function') toast(m, t, ms); };
  const db = () => window.MH_FIREBASE?.db;
  const FV = () => window.firebase.firestore.FieldValue;
  const ms = (t) => (t && t.toMillis ? t.toMillis() : 0);

  const CATS = {
    choose: ['Which material?', 'I need a metal for a job and want advice'],
    check: ['Check my result', 'I got a result and want others to check it'],
    failure: ['Why did it fail?', 'Something broke or rusted and I want to know why'],
    general: ['Something else', 'Any other material question'],
  };

  let threads = [];
  let replies = {};
  let mine = [];
  let filter = 'all';
  let openId = '';
  let loaded = false;

  const who = () => (window.MH_PROFILE?.displayName?.() || state.user?.name || state.user?.email?.split('@')[0] || 'Member').slice(0, 40);
  const ago = (t) => {
    const m = Math.max(0, (Date.now() - ms(t)) / 60000);
    if (!ms(t)) return 'just now';
    if (m < 60) return `${Math.max(1, Math.round(m))} min ago`;
    if (m < 1440) return `${Math.round(m / 60)} h ago`;
    return `${Math.round(m / 1440)} d ago`;
  };

  async function load() {
    const host = q('#forumList');
    try {
      await window.MH_FIREBASE.initFirebase();
      if (!db()) throw new Error('offline');
      const t = await db().collection('forum_threads').where('status', '==', 'approved').limit(80).get();
      threads = t.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.created_at) - ms(a.created_at));
      const r = await db().collection('forum_replies').where('status', '==', 'approved').limit(400).get();
      replies = {};
      r.docs.forEach((d) => { const x = { id: d.id, ...d.data() }; (replies[x.thread] = replies[x.thread] || []).push(x); });
      Object.values(replies).forEach((a) => a.sort((x, y) => ms(x.created_at) - ms(y.created_at)));
      loaded = true;
    } catch {
      loaded = false;
      if (host) host.innerHTML = '<div class="empty-state"><strong>The forum could not load</strong><span>It needs an internet connection. Check your connection and press Refresh.</span></div>';
      return;
    }
    await loadMine();
    render();
  }

  async function loadMine() {
    mine = [];
    const uid = window.MH_FIREBASE?.auth?.currentUser?.uid;
    if (!uid || !db()) return;
    try {
      const s = await db().collection('forum_threads').where('owner', '==', uid).limit(30).get();
      mine = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.status !== 'approved').sort((a, b) => ms(b.created_at) - ms(a.created_at));
    } catch { mine = []; }
  }

  function render() {
    const host = q('#forumList');
    if (!host) return;
    const list = threads.filter((t) => filter === 'all' || t.category === filter);
    const chips = ['all', ...Object.keys(CATS)].map((k) => `<button class="forum-chip${filter === k ? ' on' : ''}" data-f="${k}">${k === 'all' ? 'All' : esc(CATS[k][0])}</button>`).join('');
    const pend = mine.length ? `<div class="forum-pending">${mine.map((m) => `<div><b>${esc(m.title)}</b> <span>${m.status === 'rejected' ? 'was not approved' : 'is waiting for our team to read it'}</span></div>`).join('')}</div>` : '';
    host.innerHTML = `<div class="forum-chips">${chips}</div>${pend}` + (list.length ? list.map((t) => {
      const rs = replies[t.id] || [];
      const open = openId === t.id;
      return `<article class="forum-thread glass${open ? ' open' : ''}" data-id="${esc(t.id)}">
        <button class="forum-head" data-open="${esc(t.id)}" aria-expanded="${open}">
          <span class="forum-cat">${esc((CATS[t.category] || CATS.general)[0])}</span>
          <strong>${esc(t.title)}</strong>
          <small>${esc(t.owner_name || 'Member')} · ${esc(ago(t.created_at))} · ${rs.length} ${rs.length === 1 ? 'answer' : 'answers'}</small>
        </button>
        ${open ? `<div class="forum-body"><p>${esc(t.body).replace(/\n/g, '<br>')}</p>
          ${rs.map((r) => `<div class="forum-reply"><p>${esc(r.body).replace(/\n/g, '<br>')}</p><small>${esc(r.owner_name || 'Member')} · ${esc(ago(r.created_at))}</small></div>`).join('')}
          <form class="forum-answer" data-t="${esc(t.id)}"><label class="field-label" for="fa-${esc(t.id)}">Your answer or check</label>
            <textarea id="fa-${esc(t.id)}" rows="3" maxlength="500" minlength="5" placeholder="Share what you know, or what you got when you tried it. Please do not share personal details." required></textarea>
            <button class="btn btn-glass small" type="submit">Send for review</button></form></div>` : ''}
      </article>`;
    }).join('') : `<div class="empty-state"><strong>${loaded ? 'No questions here yet' : 'Loading…'}</strong><span>${loaded ? 'Be the first to ask. A real question about a real part is the best kind.' : ''}</span></div>`);
  }

  function modal() {
    let m = q('#forumModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'forumModal';
      m.className = 'modal-backdrop hidden';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
    }
    return m;
  }

  function gate() {
    if (!state.user) { notify('Create a free account (or sign in) to post. Reading is open to everyone.', 'info', 5000); openAuth('register'); return false; }
    if (!state.user.email_verified) { notify('Please verify your email first, then you can post.', 'warning', 5000); return false; }
    const last = Number((() => { try { return localStorage.getItem('mh_forum_last'); } catch { return 0; } })() || 0);
    if (Date.now() - last < 30000) { notify('Please wait a few seconds before posting again.', 'info', 3000); return false; }
    return true;
  }
  const stamp = () => { try { localStorage.setItem('mh_forum_last', String(Date.now())); } catch { /* ignore */ } };

  function ask() {
    if (!gate()) return;
    const m = modal();
    m.innerHTML = `<div class="auth-modal glass tool-modal endorse-modal" role="dialog" aria-modal="true" aria-labelledby="fqTitle">
      <button class="modal-close" data-x aria-label="Close">×</button>
      <span class="panel-kicker">FORUM</span><h2 id="fqTitle">Ask a question</h2>
      <p class="micro-note">Our team reads every post before it appears, which can take a little while. Do not put your phone number, address or other personal details in a post.</p>
      <form class="auth-form" id="fqForm">
        <label class="field-label" for="fqCat">What is it about?</label>
        <select id="fqCat" class="field-select">${Object.entries(CATS).map(([k, v]) => `<option value="${k}">${esc(v[0])}: ${esc(v[1])}</option>`).join('')}</select>
        <label class="field-label" for="fqTitleIn">Short title</label><input id="fqTitleIn" type="text" minlength="5" maxlength="100" placeholder="e.g. Aluminium or steel for a motor bracket at 120 °C?" required />
        <label class="field-label" for="fqBody">Details (<span id="fqCount">0</span>/600)</label>
        <textarea id="fqBody" rows="5" minlength="10" maxlength="600" placeholder="What are you making, what is it used for, and what have you tried? If you are checking a result, say what you measured and how." required></textarea>
        <button class="btn btn-primary full" type="submit">Send for review</button>
        <p class="form-error" id="fqError"></p>
      </form></div>`;
    m.classList.remove('hidden');
    q('[data-x]', m).addEventListener('click', () => m.classList.add('hidden'));
    const c = () => { q('#fqCount', m).textContent = String(q('#fqBody', m).value.length); };
    q('#fqBody', m).addEventListener('input', c); c();
    q('#fqForm', m).addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = q('#fqError', m);
      err.textContent = '';
      const btn = q('button[type=submit]', m);
      btn.disabled = true;
      try {
        await db().collection('forum_threads').add({
          owner: window.MH_FIREBASE.auth.currentUser.uid, owner_name: who(), category: q('#fqCat', m).value,
          title: q('#fqTitleIn', m).value.trim().slice(0, 100), body: q('#fqBody', m).value.trim().slice(0, 600), status: 'pending', created_at: FV().serverTimestamp(),
        });
        stamp();
        m.classList.add('hidden');
        notify('Thank you! Your question will appear once our team has read it.', 'success', 6000);
        await loadMine();
        render();
      } catch { err.textContent = 'Could not send it. Please try again in a moment.'; btn.disabled = false; }
    });
  }

  async function answer(form) {
    if (!gate()) return;
    const ta = q('textarea', form);
    const body = ta.value.trim().slice(0, 500);
    if (body.length < 5) return;
    const btn = q('button', form);
    btn.disabled = true;
    try {
      await db().collection('forum_replies').add({
        thread: form.dataset.t, owner: window.MH_FIREBASE.auth.currentUser.uid, owner_name: who(), body, status: 'pending', created_at: FV().serverTimestamp(),
      });
      stamp();
      ta.value = '';
      notify('Thank you! Your answer will appear once our team has read it.', 'success', 6000);
    } catch { notify('Could not send it. Please try again.', 'error', 4000); }
    btn.disabled = false;
  }

  function mount() {
    const main = q('main');
    if (!main || q('#view-forum')) return Boolean(q('#view-forum'));
    const sec = document.createElement('section');
    sec.className = 'view';
    sec.id = 'view-forum';
    sec.innerHTML = `<div class="section-head"><div><span class="panel-kicker">FORUM · ASK AND CHECK</span><h2>Ask people, check your result</h2>
        <p>Not sure which material to use, or want someone to check your result? Ask here. Other members answer, and our team reads every post before it appears. Reading is open to everyone; posting needs a free, verified account.</p></div>
        <div class="forum-actions"><button class="btn btn-primary" id="forumAsk" type="button">Ask a question</button> <button class="btn btn-ghost" id="forumRefresh" type="button">Refresh</button></div></div>
      <div id="forumList"><div class="empty-state"><strong>Loading…</strong></div></div>`;
    main.appendChild(sec);
    sec.addEventListener('click', (e) => {
      const f = e.target.closest('[data-f]');
      if (f) { filter = f.dataset.f; render(); return; }
      const o = e.target.closest('[data-open]');
      if (o) { openId = openId === o.dataset.open ? '' : o.dataset.open; render(); return; }
      if (e.target.closest('#forumAsk')) ask();
      if (e.target.closest('#forumRefresh')) load();
    });
    sec.addEventListener('submit', (e) => { const f = e.target.closest('.forum-answer'); if (f) { e.preventDefault(); answer(f); } });
    return true;
  }

  function boot() {
    mount();
    const sec = q('#view-forum');
    let first = true;
    const check = () => { if (sec.classList.contains('active') && first) { first = false; load(); } };
    new MutationObserver(check).observe(sec, { attributes: true, attributeFilter: ['class'] });
    check();
    window.addEventListener('mh:session', () => { if (loaded) loadMine().then(render); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.MH_FORUM = { refresh: load };
})();
