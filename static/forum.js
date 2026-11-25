/* ==========================================================================
   MATERIALHUNT — forum
   A place to ask a question, check a result with other people, and answer. Verified members can post.
   Clean posts go live at once; posts with a link, a long number or a rude word wait for an admin; two reports hide a post.
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

  /* the same automatic check as the database rules: posts with links, long numbers, @ or rude words wait for a person */
  const CLEAN_BAD = /(https?:|www\.|\.com|\.net|\.org|\.in\/|@|[0-9]{8,}|\b(fuck|shit|bitch|bastard|asshole|cunt|slut|porn|nude|sex|madarchod|bhenchod|chutiya|gandu|randi|harami)\w*\b)/i;
  const isClean = (...parts) => parts.every((s) => !CLEAN_BAD.test(String(s || '')));
  let reported = {};
  const hidden = (id, owner) => (reported[id] || 0) >= 2 && owner !== window.MH_FIREBASE?.auth?.currentUser?.uid;

  async function loadReports() {
    reported = {};
    try {
      const s = await db().collection('forum_reports').limit(800).get();
      s.docs.forEach((d) => { const t = d.data().target; if (t) reported[t] = (reported[t] || 0) + 1; });
    } catch { /* without reports nothing is hidden */ }
  }

  async function report(id) {
    if (!state.user) { notify('Sign in to report a post.', 'info', 3000); return; }
    if (!state.user.email_verified) { notify('Verify your email first, then you can report.', 'warning', 4000); return; }
    try {
      const uid = window.MH_FIREBASE.auth.currentUser.uid;
      await db().collection('forum_reports').doc(`${uid}_${id}`).set({ reporter: uid, target: id, created_at: FV().serverTimestamp() });
      reported[id] = (reported[id] || 0) + 1;
      notify('Thank you. Two reports hide a post until our team has looked at it.', 'success', 4500);
      render();
    } catch { notify('You have already reported this, or it could not be sent.', 'info', 3500); }
  }

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
      await loadReports();
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
    const list = threads.filter((t) => (filter === 'all' || t.category === filter) && !hidden(t.id, t.owner));
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
          <button class="text-btn" type="button" data-report="${esc(t.id)}">Report this question</button>
          ${rs.filter((r) => !hidden(r.id, r.owner)).map((r) => `<div class="forum-reply"><p>${esc(r.body).replace(/\n/g, '<br>')}</p><small>${esc(r.owner_name || 'Member')} · ${esc(ago(r.created_at))} · <button class="text-btn" type="button" data-report="${esc(r.id)}">Report</button></small></div>`).join('')}
          <form class="forum-answer" data-t="${esc(t.id)}"><label class="field-label" for="fa-${esc(t.id)}">Your answer or check</label>
            <textarea id="fa-${esc(t.id)}" rows="3" maxlength="500" minlength="5" placeholder="Share what you know, or what you got when you tried it. Please do not share personal details." required></textarea>
            <button class="btn btn-glass small" type="submit">Post answer</button></form></div>` : ''}
      </article>`;
    }).join('') : `<div class="empty-state"><strong>${loaded ? 'No questions here yet' : 'Loading…'}</strong><span>${loaded ? 'Be the first to ask. Examples of good questions: "Aluminium or steel for a motor bracket at 120 °C?", "I got 200 MPa for 316L, is that right?", "Why did my mild steel bolt rust through in two months?"' : ''}</span></div>`);
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
      <p class="micro-note">Posts are checked automatically and appear at once. A post with a link, a long number or a rude word waits for a person to read it. Do not put your phone number, address or other personal details in a post.</p>
      <form class="auth-form" id="fqForm">
        <label class="field-label" for="fqCat">What is it about?</label>
        <select id="fqCat" class="field-select">${Object.entries(CATS).map(([k, v]) => `<option value="${k}">${esc(v[0])}: ${esc(v[1])}</option>`).join('')}</select>
        <label class="field-label" for="fqTitleIn">Short title</label><input id="fqTitleIn" type="text" minlength="5" maxlength="100" placeholder="e.g. Aluminium or steel for a motor bracket at 120 °C?" required />
        <label class="field-label" for="fqBody">Details (<span id="fqCount">0</span>/600)</label>
        <textarea id="fqBody" rows="5" minlength="10" maxlength="600" placeholder="What are you making, what is it used for, and what have you tried? If you are checking a result, say what you measured and how." required></textarea>
        <button class="btn btn-primary full" type="submit">Post question</button>
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
        const doc = {
          owner: window.MH_FIREBASE.auth.currentUser.uid, owner_name: who(), category: q('#fqCat', m).value,
          title: q('#fqTitleIn', m).value.trim().slice(0, 100), body: q('#fqBody', m).value.trim().slice(0, 600), status: 'pending', created_at: FV().serverTimestamp(),
        };
        let live = isClean(doc.title, doc.body);
        try { await db().collection('forum_threads').add({ ...doc, status: live ? 'approved' : 'pending' }); }
        catch (e1) { if (!live) throw e1; live = false; await db().collection('forum_threads').add(doc); }
        stamp();
        m.classList.add('hidden');
        notify(live ? 'Posted. Your question is live.' : 'Thank you! This post has a link, a long number or a word that needs a person to look at it, so it will appear once our team has read it.', live ? 'success' : 'info', 6500);
        if (live) await load(); else { await loadMine(); render(); }
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
      const doc = { thread: form.dataset.t, owner: window.MH_FIREBASE.auth.currentUser.uid, owner_name: who(), body, status: 'pending', created_at: FV().serverTimestamp() };
      let live = isClean(body);
      try { await db().collection('forum_replies').add({ ...doc, status: live ? 'approved' : 'pending' }); }
      catch (e1) { if (!live) throw e1; live = false; await db().collection('forum_replies').add(doc); }
      stamp();
      ta.value = '';
      notify(live ? 'Posted. Your answer is live.' : 'Thank you! This answer needs a person to look at it, so it will appear once our team has read it.', live ? 'success' : 'info', 6000);
      if (live) await load();
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
        <p>Not sure which material to use, or want someone to check your result? Ask here. Other members answer, and posts are checked automatically; anyone can report one. Reading is open to everyone; posting needs a free, verified account.</p></div>
        <div class="forum-actions"><button class="btn btn-primary" id="forumAsk" type="button">Ask a question</button> <button class="btn btn-ghost" id="forumRefresh" type="button">Refresh</button></div></div>
      <div id="forumList"><div class="empty-state"><strong>Loading…</strong></div></div>`;
    main.appendChild(sec);
    sec.addEventListener('click', (e) => {
      const f = e.target.closest('[data-f]');
      if (f) { filter = f.dataset.f; render(); return; }
      const rp = e.target.closest('[data-report]');
      if (rp) { report(rp.dataset.report); return; }
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
