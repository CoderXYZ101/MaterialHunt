/* ==========================================================================
   MATERIALHUNT — member profiles
   Optional photo, display name, organisation and a short bio. Visible only to signed-in
   members (see firestore.rules). The photo is shown on the leaderboard only if the owner
   switches that on. Photos are shrunk to a small square and stored inside the profile document.
   ========================================================================== */
'use strict';

(function () {
  const q = (selector, root = document) => root.querySelector(selector);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t = 'info', ms) => { if (typeof toast === 'function') toast(m, t, ms); };

  const WHO = ['Student', 'Engineer or professional', 'Business owner or buyer', 'Educator', 'Researcher', 'Maker or hobbyist'];
  const cache = new Map();   // uid -> profile (or null when none)
  let mine = null;
  let photosBlocked = false;
  let draftAvatar = '';
  const db = () => window.MH_FIREBASE?.db;
  const uid = () => window.MH_FIREBASE?.auth?.currentUser?.uid || '';
  const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

  async function fetchProfile(id) {
    if (cache.has(id)) return cache.get(id);
    if (!state.user) return null;
    try {
      await window.MH_FIREBASE.initFirebase();
      const snap = await db().collection('profiles').doc(id).get();
      const data = snap.exists ? snap.data() : null;
      cache.set(id, data);
      return data;
    } catch { return null; }
  }

  async function loadMine() {
    if (!state.user) { mine = null; applyChip(); return; }
    mine = await fetchProfile(uid());
    applyChip();
  }

  function applyChip() {
    const av = q('#userAvatar');
    if (!av) return;
    if (mine && mine.avatar) { av.innerHTML = `<img src="${esc(mine.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit" />`; }
    else if (state.user) { av.textContent = initials(mine?.display_name || state.user.organization_name || state.user.email); }
  }

  /* ---------------- leaderboard avatars and names ---------------- */
  async function decorate(root) {
    const slots = Array.from((root || document).querySelectorAll('[data-av]'));
    for (const slot of slots) {
      slot.textContent = initials(slot.dataset.nm);
      if (!state.user) continue;
      const p = await fetchProfile(slot.dataset.av);
      if (p && p.show_avatar && p.avatar) slot.innerHTML = `<img src="${esc(p.avatar)}" alt="" />`;
    }
  }

  /* ---------------- modal (other members' profiles) ---------------- */
  function modal() {
    let m = q('#profileModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'profileModal';
      m.className = 'modal-backdrop hidden';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
    }
    return m;
  }
  const closeModal = () => q('#profileModal')?.classList.add('hidden');

  const PHOTO_ERRORS = {
    unsafe: 'that picture was not accepted. Please choose a different one (a clear, appropriate photo of you or a logo).',
    photo_blocked: 'photos are switched off for this account.',
    check_unavailable: 'the automatic photo check is not available right now. Please try again later.',
    save_profile_first: 'please save your profile first.',
    bad_image: 'that image could not be used.',
    sign_in_required: 'please sign in again.',
  };

  /* a photo only goes onto a profile after the server's safety check */
  async function uploadPhoto(dataUrl) {
    const base = window.MH_CONFIG?.aiProxyUrl;
    if (!base) throw new Error(PHOTO_ERRORS.check_unavailable);
    const token = await window.MH_FIREBASE.auth.currentUser.getIdToken();
    let res;
    try {
      res = await fetch(`${base}/set-avatar`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ image: dataUrl }) });
    } catch { throw new Error(PHOTO_ERRORS.check_unavailable); }
    if (res.ok) return;
    let code = '';
    try { code = (await res.json()).error; } catch { code = ''; }
    throw new Error(PHOTO_ERRORS[code] || 'something went wrong. Please try again.');
  }

  /* ---------------- my profile: its own page ---------------- */
  function pageRoot() {
    let root = q('#profileRoot');
    if (!root) {
      const main = q('main');
      const sec = document.createElement('section');
      sec.className = 'view';
      sec.id = 'view-profile';
      sec.innerHTML = '<div id="profileRoot"></div>';
      main.appendChild(sec);
      root = q('#profileRoot', sec);
    }
    return root;
  }

  async function openMine() {
    if (!state.user) { openAuth('register'); return; }
    await loadMine();
    try { await window.MH_FIREBASE.initFirebase(); photosBlocked = (await db().collection('photo_blocks').doc(uid()).get()).exists; } catch { photosBlocked = false; }
    const m = pageRoot();
    const p = mine || {};
    draftAvatar = p.avatar || '';
    m.innerHTML = `<div class="section-head"><div><span class="panel-kicker">YOUR ACCOUNT</span><h2>My profile</h2><p>What other members see about you, and your account controls.</p></div>
        <div class="prof-head-actions"><button class="btn btn-glass" type="button" id="profMembers">Find members</button><button class="btn btn-glass" type="button" id="profEndorse">Endorse MaterialHunt</button></div></div>
      <div class="profile-grid">
        <article class="glass tool-form profile-card">
          <div class="prof-top">
            <div class="prof-avatar" id="profAvatar"></div>
            <div class="prof-photo-actions">
              <div class="prof-btns"><button class="btn btn-glass small" type="button" id="profPick">Add a photo</button><button class="btn btn-ghost small" type="button" id="profClear">Remove</button></div>
              <input type="file" id="profFile" accept="image/*" class="hidden" />
              <p class="micro-note">${photosBlocked ? 'Photos are switched off for your account.' : 'Optional. Photos are reviewed by our team and can be reported.'}</p>
            </div>
          </div>
          <form class="auth-form" id="profForm">
            <label class="field-label" for="profName">Display name</label><input id="profName" type="text" maxlength="40" value="${esc(p.display_name || state.user.organization_name || '')}" required />
            <label class="field-label" for="profWho">I am a (optional)</label>
            <select id="profWho" class="field-select"><option value="">Prefer not to say</option>${WHO.map((w) => `<option${p.who === w ? ' selected' : ''}>${esc(w)}</option>`).join('')}</select>
            <label class="field-label" for="profOrg">Organisation (optional)</label><input id="profOrg" type="text" maxlength="80" placeholder="Company, institute or team" value="${esc(p.org || '')}" />
            <label class="field-label" for="profBio">About you (optional, <span id="profCount">0</span>/200)</label><textarea id="profBio" rows="3" maxlength="200">${esc(p.bio || '')}</textarea>
            <label class="guardrail-check"><input type="checkbox" id="profShow" ${p.show_avatar ? 'checked' : ''} /><span><strong>Show my photo on the leaderboard</strong><small>Only signed-in members can see it. Off by default.</small></span></label>
            <label class="guardrail-check"><input type="checkbox" id="profFind" ${p.discoverable === false ? '' : 'checked'} /><span><strong>Let other members find me by name</strong><small>You appear in Find members. Turn off to stay out of it.</small></span></label>
            <p class="micro-note">Do not share phone numbers, home addresses or other private details. Your name, organisation and bio can be seen by other signed-in members.</p>
            <button class="btn btn-primary full" type="submit">Save profile</button>
            <p class="form-error" id="profError"></p>
          </form>
        </article>
        <article class="glass tool-form profile-card danger-zone">
          <span class="panel-kicker">DANGER ZONE</span><h3>Delete my data</h3>
          <p class="micro-note">You can do this at any time, even if your photo was removed or your account was reported.</p>
          <div class="dz-row"><div><b>Delete my profile</b><small>Removes your photo, bio and display name. Your account and leaderboard entries stay.</small></div>
            <button class="btn btn-ghost" type="button" id="profDelete" ${mine ? '' : 'disabled'}>${mine ? 'Delete profile' : 'No profile yet'}</button></div>
          <div class="dz-row"><div><b>Delete my account</b><small>Permanently deletes your account and everything linked to it. You confirm with your password. This cannot be undone.</small></div>
            <button class="btn acct-danger" type="button" id="profDeleteAccount">Delete account…</button></div>
        </article>
      </div>`;
    const paint = () => { q('#profAvatar', m).innerHTML = draftAvatar ? `<img src="${esc(draftAvatar)}" alt="Your photo" />` : `<span>${esc(initials(q('#profName', m).value))}</span>`; };
    paint();
    q('#profName', m).addEventListener('input', () => { if (!draftAvatar) paint(); });
    const count = () => { q('#profCount', m).textContent = String(q('#profBio', m).value.length); };
    q('#profBio', m).addEventListener('input', count); count();
    q('#profPick', m).addEventListener('click', () => q('#profFile', m).click());
    q('#profClear', m).addEventListener('click', () => { draftAvatar = ''; q('#profShow', m).checked = false; paint(); });
    q('#profFile', m).addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const side = Math.min(img.width, img.height);
          const c = document.createElement('canvas');
          c.width = c.height = 128;
          c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 128, 128);
          draftAvatar = c.toDataURL('image/jpeg', 0.82);
          paint();
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
    q('#profMembers', m).addEventListener('click', () => setView('members'));
    q('#profEndorse', m).addEventListener('click', () => window.MH_ENDORSE?.open());
    q('#profDeleteAccount', m).addEventListener('click', () => window.MH_ACCOUNT?.open());
    q('#profDelete', m).addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (!btn.dataset.sure) { btn.dataset.sure = '1'; btn.textContent = 'Tap again to delete for good'; setTimeout(() => { if (btn.isConnected) { delete btn.dataset.sure; btn.textContent = 'Delete profile'; } }, 4000); return; }
      btn.disabled = true;
      try {
        await window.MH_FIREBASE.initFirebase();
        await db().collection('profiles').doc(uid()).delete();
        mine = null;
        cache.set(uid(), null);
        applyChip();
        notify('Your profile was deleted.', 'success', 3500);
        openMine();
      } catch { q('#profError', m).textContent = 'Your profile could not be deleted right now. Please try again.'; btn.disabled = false; }
    });
    q('#profForm', m).addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = q('#profError', m);
      err.textContent = '';
      const blocked = photosBlocked;
      const doc = {
        display_name: q('#profName', m).value.trim().slice(0, 40), bio: q('#profBio', m).value.trim().slice(0, 200), org: q('#profOrg', m).value.trim().slice(0, 80), who: q('#profWho', m).value, discoverable: q('#profFind', m).checked,
        avatar: blocked ? '' : draftAvatar, show_avatar: Boolean(!blocked && draftAvatar && q('#profShow', m).checked),
      };
      doc.name_lower = doc.display_name.toLowerCase();
      if (!doc.display_name) { err.textContent = 'Please enter a display name.'; return; }
      if (blocked && draftAvatar) { err.textContent = 'Photos are switched off for this account.'; return; }
      const submit = q('button[type=submit]', m);
      submit.disabled = true;
      try {
        await window.MH_FIREBASE.initFirebase();
        await db().collection('profiles').doc(uid()).set({ ...doc, updated_at: window.firebase.firestore.FieldValue.serverTimestamp() });
        mine = { ...doc };
        cache.set(uid(), mine);
        applyChip();
        notify('Profile saved.', 'success', 2500);
      } catch (error) { err.textContent = error.message || 'Could not save your profile.'; }
      submit.disabled = false;
    });
    setView('profile');
  }

  async function viewPerson(id) {
    if (!state.user) { notify('Sign in to view member profiles.', 'info', 3500); openAuth('login'); return; }
    if (id === uid()) { openMine(); return; }
    const m = modal();
    m.innerHTML = '<div class="auth-modal glass tool-modal profile-modal"><button class="modal-close" data-x aria-label="Close">×</button><div class="empty-state"><span>Loading…</span></div></div>';
    m.classList.remove('hidden');
    q('[data-x]', m).addEventListener('click', closeModal);
    const p = await fetchProfile(id);
    const row = (window.MH_CHALLENGE?.boardRows?.() || []).find((r) => r.user_id === id);
    const name = p?.display_name || row?.name || 'Member';
    q('.profile-modal', m).innerHTML = `<button class="modal-close" data-x aria-label="Close">×</button>
      <div class="prof-top"><div class="prof-avatar">${p && p.show_avatar && p.avatar ? `<img src="${esc(p.avatar)}" alt="" />` : `<span>${esc(initials(name))}</span>`}</div>
        <div><h2>${esc(name)}</h2>${p?.who || p?.org ? `<p class="micro-note">${esc([p.who, p.org].filter(Boolean).join(' · '))}</p>` : ''}</div></div>
      ${p?.bio ? `<p class="prof-bio">${esc(p.bio)}</p>` : '<p class="micro-note">This member has not added a bio yet.</p>'}
      <div id="repBox"><button class="btn btn-ghost small report-btn" id="repOpen">Report this profile</button></div>
      ${row ? `<div class="prof-entry"><span class="medal-dot medal-${esc(String(row.medal).toLowerCase())}"></span> <b>${esc(row.medal)}</b> · ${esc(row.formula)} · score <b>${row.score}</b></div>` : ''}`;
    q('[data-x]', m).addEventListener('click', closeModal);
    q('#repOpen', m)?.addEventListener('click', () => reportForm(m, id));
  }

  function reportForm(m, target) {
    const box = q('#repBox', m);
    box.innerHTML = `<form class="auth-form" id="repForm"><label class="field-label" for="repReason">What is the problem?</label>
      <select id="repReason" class="field-select"><option value="photo">Inappropriate photo</option><option value="name_or_bio">Inappropriate name or bio</option><option value="harassment">Harassment or abuse</option><option value="other">Something else</option></select>
      <label class="field-label" for="repNote">Details (optional)</label><textarea id="repNote" rows="2" maxlength="200"></textarea>
      <button class="btn btn-primary small" type="submit">Send report</button> <span class="micro-note" id="repMsg"></span></form>`;
    q('#repForm', m).addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = q('#repMsg', m);
      if (!state.user?.email_verified) { msg.textContent = 'Verify your email first to send a report.'; return; }
      try {
        await window.MH_FIREBASE.initFirebase();
        await db().collection('reports').doc(`${uid()}_${target}`).set({ reporter: uid(), target, reason: q('#repReason', m).value, note: q('#repNote', m).value.trim().slice(0, 200), status: 'new', created_at: window.firebase.firestore.FieldValue.serverTimestamp() });
        box.innerHTML = '<p class="micro-note">Thank you. Our team will review this report.</p>';
      } catch { msg.textContent = 'You have already reported this member, or the report could not be sent.'; }
    });
  }

  /* ---------------- Members page (search any member) ---------------- */
  const HINT = 'Type at least 2 letters of a name. Only members who chose to be listed appear.';
  function mountMembers() {
    const main = q('main');
    if (!main) return false;
    if (!q('#view-members')) {
      const sec = document.createElement('section');
      sec.className = 'view';
      sec.id = 'view-members';
      sec.innerHTML = `<div class="section-head"><div><span class="panel-kicker">COMMUNITY</span><h2>Find members</h2><p>Search engineers, students and makers on MaterialHunt by name.</p></div></div>
        <article class="glass tool-form members-card">
          <input id="msInput" type="search" maxlength="40" placeholder="Search by display name" autocomplete="off" />
          <div id="msResults" class="ms-results"><p class="micro-note">${HINT}</p></div>
        </article>`;
      main.appendChild(sec);
      let timer = null;
      q('#msInput', sec).addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => searchMembers(e.target.value), 320); });
      q('#msResults', sec).addEventListener('click', (e) => { const b = e.target.closest('[data-person]'); if (b) viewPerson(b.dataset.person); });
    }
    const actions = q('.top-actions');
    if (actions && !q('#membersBtn')) {
      const btn = document.createElement('button');
      btn.id = 'membersBtn';
      btn.className = `icon-btn${state.user ? '' : ' hidden'}`;
      btn.title = 'Find members';
      btn.setAttribute('aria-label', 'Find members');
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.4"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.4 3.4 0 0 1 0 6.8M18 14.2A6.5 6.5 0 0 1 21.5 20"/></svg>';
      btn.addEventListener('click', () => { setView('members'); setTimeout(() => q('#msInput')?.focus(), 200); });
      actions.insertBefore(btn, q('#helpBtn') || actions.firstChild);
    }
    return Boolean(q('#view-members') && q('#membersBtn'));
  }

  const row = (p) => `<button class="ms-row" data-person="${esc(p.id)}"><span class="lb-av">${p.show_avatar && p.avatar ? `<img src="${esc(p.avatar)}" alt="" />` : esc(initials(p.display_name))}</span><span><b>${esc(p.display_name)}</b><small>${esc([p.who, p.org].filter(Boolean).join(' · '))}</small></span></button>`;

  async function searchMembers(raw) {
    const box = q('#msResults');
    if (!box) return;
    const term = String(raw || '').trim().toLowerCase();
    if (!state.user) { box.innerHTML = '<p class="micro-note">Sign in to search members.</p>'; return; }
    if (term.length === 1) { box.innerHTML = `<p class="micro-note">${HINT}</p>`; return; }
    box.innerHTML = '<p class="micro-note">Searching…</p>';
    try {
      await window.MH_FIREBASE.initFirebase();
      let snap; let label = '';
      if (term.length >= 2) snap = await db().collection('profiles').orderBy('name_lower').startAt(term).endAt(`${term}\uf8ff`).limit(40).get();
      else { snap = await db().collection('profiles').orderBy('updated_at', 'desc').limit(30).get(); label = '<p class="micro-note">Recently active members:</p>'; }
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.discoverable !== false && p.display_name);
      box.innerHTML = rows.length ? label + rows.map(row).join('') : '<p class="micro-note">No members found. People appear here once they have set up their profile.</p>';
    } catch { box.innerHTML = '<p class="micro-note">Search is not available right now.</p>'; }
  }

  /* ---------------- wiring ---------------- */
  document.addEventListener('click', (e) => {
    const person = e.target.closest('[data-person]');
    if (person) { viewPerson(person.dataset.person); return; }
    if (e.target.closest('#userAvatar, #userName')) openMine();
  });
  window.addEventListener('mh:session', (e) => { cache.clear(); if (e.detail.user) loadMine(); else { mine = null; } });
  window.addEventListener('mh:session', (e) => { q('#membersBtn')?.classList.toggle('hidden', !e.detail.user); });
  { let n = 0; const t = setInterval(() => { if (mountMembers() || n++ > 40) clearInterval(t); }, 250); }
  const prevSetView = window.setView;
  if (typeof prevSetView === 'function') {
    window.setView = function profileSetView(view, scroll) {
      if (view === 'members') { mountMembers(); }
      prevSetView(view, scroll);
      if (view === 'members' && !q('#msResults .ms-row')) searchMembers('');
    };
  }

  window.MH_PROFILE = { open: openMine, view: viewPerson, decorate, displayName: () => mine?.display_name || '' };
})();
