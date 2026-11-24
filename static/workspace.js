/* ==========================================================================
   MATERIALHUNT — plan features: model workspace and team shelf
   - caps(): what each plan allows (own-data rows, saved models, compare, test-error report).
   - "My models" panel in the ML Lab: save trained models (kept on this device in IndexedDB), reuse them,
     compare them side by side (Max and up), download a test-error report (Ultra).
   - Teams (team plans): a team name (first come, first served), seats set by the owner's plan, people added by
     email who accept in one tap and then get the team's plan, a team chat, and a shelf for designs and models.
   The limits are enforced in this page (the data lives on the member's own device), which is honest for
   features that are not secrets; the shared shelf and AI limits are enforced by the database rules.
   ========================================================================== */
'use strict';

(function () {
  const q = (selector, root = document) => root.querySelector(selector);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t = 'info', ms) => { if (typeof toast === 'function') toast(m, t, ms); };
  const db = () => window.MH_FIREBASE?.db;
  const FV = () => window.firebase.firestore.FieldValue;
  const ms = (t) => (t && t.toMillis ? t.toMillis() : 0);
  const f0 = (v) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-IN') : Number(v).toFixed(1));

  /* ------------------------------------------------------------------ */
  /* What each plan allows                                                */
  /* ------------------------------------------------------------------ */
  const BASE = { free: 'free', guest: 'free', pro: 'pro', team: 'pro', max: 'max', team_max: 'max', ultra: 'ultra', team_ultra: 'ultra', enterprise: 'ultra' };
  const CAPS = {
    free: { name: 'Free', rows: 300, models: 1, compare: false, report: false, next: 'Pro' },
    pro: { name: 'Pro', rows: 1000, models: 3, compare: false, report: false, next: 'Max' },
    max: { name: 'Max', rows: 5000, models: 10, compare: true, report: false, next: 'Ultra' },
    ultra: { name: 'Ultra', rows: 50000, models: 50, compare: true, report: true, next: '' },
  };
  const tier = () => window.MH_PLAN?.tier?.() || 'guest';
  const caps = () => CAPS[BASE[tier()] || 'free'];
  const isTeam = () => ['team', 'team_max', 'team_ultra'].includes(tier());
  const canShareModels = () => ['team_max', 'team_ultra'].includes(tier());
  const myTeam = () => (state.user && Number(state.user.team_slot) >= 0 ? String(state.user.team || '') : '');
  const upgrade = () => { const n = caps().next; if (n) window.openUpgrade?.(n.toLowerCase()); };

  /* ------------------------------------------------------------------ */
  /* Saved models: IndexedDB                                              */
  /* ------------------------------------------------------------------ */
  const owner = () => state.user?.id || 'guest';
  const idb = () => new Promise((res, rej) => {
    if (!window.indexedDB) { rej(new Error('Saving is not available in this browser.')); return; }
    const r = indexedDB.open('mh_models', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('models', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error || new Error('Could not open storage.'));
  });
  const run = async (mode, fn) => {
    const d = await idb();
    return new Promise((res, rej) => { const tx = d.transaction('models', mode); const req = fn(tx.objectStore('models')); tx.oncomplete = () => res(req && req.result); tx.onerror = () => rej(tx.error); });
  };
  const listModels = async () => ((await run('readonly', (s) => s.getAll())) || []).filter((m) => m.owner === owner()).sort((a, b) => b.savedAt - a.savedAt);
  const putModel = (m) => run('readwrite', (s) => s.put(m));
  const delModel = (id) => run('readwrite', (s) => s.delete(id));

  let saved = [];
  let picked = new Set();

  const download = (name, text, type) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  };
  const slug = (s) => String(s || 'model').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'model';

  function reportCsv(m) {
    const lab = m.model;
    const lines = [
      `# MaterialHunt test-error report`,
      `# Model: ${m.name}`,
      `# Property: ${lab.targetLabel} (${lab.unit || 'no unit'})`,
      `# Samples: ${lab.n}`,
      `# Test method: ${lab.evalMethod}. Every row below was predicted by a model that had not seen that sample.`,
      `# Average error: ${lab.cv.mae.toFixed(2)}   Average % error: ${lab.cv.mape.toFixed(1)}   R2: ${lab.cv.r2.toFixed(3)}`,
      `# Guessing the average would give an average error of ${lab.baseline.mae.toFixed(2)} (R2 ${lab.baseline.r2.toFixed(3)})`,
      'sample,actual,predicted,error,error_percent',
    ];
    lab.points.forEach((p) => lines.push([`"${String(p.name).replace(/"/g, '""')}"`, p.actual, Number(p.pred).toFixed(3), Number(p.pred - p.actual).toFixed(3), p.actual ? (Math.abs(p.pred - p.actual) / Math.abs(p.actual) * 100).toFixed(1) : ''].join(',')));
    return lines.join('\n');
  }

  async function refreshSaved() {
    try { saved = await listModels(); } catch { saved = []; }
    renderModels();
  }

  function renderModels() {
    const host = q('#mlModelsBody');
    if (!host) return;
    const c = caps();
    const lab = window.MH_ML?.lab;
    const left = c.models - saved.length;
    const rows = saved.map((m) => `<tr>
        <td>${c.compare ? `<input type="checkbox" data-pick="${esc(m.id)}" ${picked.has(m.id) ? 'checked' : ''} aria-label="Compare ${esc(m.name)}" />` : ''}</td>
        <td><b>${esc(m.name)}</b><br><small>${esc(m.model.targetLabel)} · ${m.model.n} samples</small></td>
        <td>${f0(m.model.cv.mae)} ${esc(m.model.unit || '')}<br><small>R² ${m.model.cv.r2.toFixed(2)}</small></td>
        <td class="ml-model-actions">
          <button class="btn btn-glass small" data-m="use" data-id="${esc(m.id)}">Use as My ML</button>
          <button class="btn btn-ghost small" data-m="file" data-id="${esc(m.id)}">Model file</button>
          ${c.report ? `<button class="btn btn-ghost small" data-m="report" data-id="${esc(m.id)}">Test report</button>` : ''}
          ${canShareModels() && myTeam() ? `<button class="btn btn-ghost small" data-m="share" data-id="${esc(m.id)}">Share with team</button>` : ''}
          <button class="btn btn-ghost small" data-m="del" data-id="${esc(m.id)}">Delete</button></td></tr>`).join('');
    const chosen = saved.filter((m) => picked.has(m.id));
    const cmp = c.compare && chosen.length >= 2 ? `<h4>Side by side</h4><div class="admin-table-wrap"><table class="ml-table"><thead><tr><th>Model</th><th>Predicts</th><th>Samples</th><th>Average error</th><th>Average % error</th><th>R²</th><th>Guess-the-average error</th></tr></thead><tbody>
        ${chosen.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.model.targetLabel)}</td><td>${m.model.n}</td><td>${f0(m.model.cv.mae)} ${esc(m.model.unit || '')}</td><td>${m.model.cv.mape.toFixed(0)}%</td><td>${m.model.cv.r2.toFixed(2)}</td><td>${f0(m.model.baseline.mae)}</td></tr>`).join('')}</tbody></table></div>
        <p class="micro-note">Compare models only when they predict the same property. A lower error and a higher R² mean a better test result on that model's own data.</p>` : '';
    host.innerHTML = `<p class="micro-note">Your plan: <b>${esc(c.name)}</b> · ${saved.length} of ${c.models} saved models · own-data tables up to ${c.rows.toLocaleString('en-IN')} rows. Models are saved on this device, in this browser.${c.compare ? '' : ` Comparing models side by side starts on Max.`}${c.report ? '' : ' Downloadable test-error reports are on Ultra.'}</p>
      <div class="ml-save-row"><input id="mlModelName" type="text" maxlength="60" placeholder="Name for the model you just trained" ${lab ? `value="${esc(`${lab.targetLabel} (${lab.n} samples)`)}"` : 'disabled'} />
        <button class="btn btn-primary small" id="mlModelSave" ${lab ? '' : 'disabled'}>Save current model</button>
        ${left <= 0 && c.next ? `<button class="btn btn-glass small" id="mlModelUp">Upgrade to ${esc(c.next)} for more</button>` : ''}</div>
      ${lab ? '' : '<p class="micro-note">Train a model above, then save it here.</p>'}
      ${saved.length ? `<div class="admin-table-wrap"><table class="ml-table"><thead><tr><th></th><th>Model</th><th>Test error</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="micro-note">No saved models yet.</p>'}${cmp}`;
  }

  async function onModelClick(e) {
    const t = e.target.closest('[data-m],#mlModelSave,#mlModelUp,[data-pick]');
    if (!t) return;
    if (t.dataset.pick) { if (t.checked) picked.add(t.dataset.pick); else picked.delete(t.dataset.pick); renderModels(); return; }
    if (t.id === 'mlModelUp') { upgrade(); return; }
    if (t.id === 'mlModelSave') {
      const lab = window.MH_ML?.lab;
      const c = caps();
      if (!lab) return;
      if (!state.user) { notify('Create a free account to keep your models.', 'info', 3500); openAuth('register'); return; }
      if (saved.length >= c.models) { notify(`Your ${c.name} plan keeps up to ${c.models} saved model${c.models === 1 ? '' : 's'}. Delete one or upgrade.`, 'warning', 5000); return; }
      const name = (q('#mlModelName').value || '').trim().slice(0, 60) || `${lab.targetLabel} (${lab.n} samples)`;
      try {
        await putModel({ id: `${owner()}:${Date.now()}`, owner: owner(), name, prop: q('#mlUseProp')?.value || 'y', savedAt: Date.now(), model: JSON.parse(JSON.stringify(lab)) });
        notify('Model saved on this device.', 'success', 2500);
      } catch { notify('Could not save it. The browser may have blocked storage.', 'error', 4000); }
      await refreshSaved();
      return;
    }
    const m = saved.find((x) => x.id === t.dataset.id);
    if (!m) return;
    const act = t.dataset.m;
    if (act === 'use') {
      window.MH_ENGINE?.setCustom(m.model, m.prop || 'y');
      window.MH_ENGINE?.setMode('custom');
      notify('The other tabs now use this model for that property.', 'success', 3500);
    } else if (act === 'file') {
      download(`materialhunt-model-${slug(m.name)}.json`, JSON.stringify({ format: 'materialhunt-ml-1', prop: m.prop || 'y', savedAt: new Date(m.savedAt).toISOString(), model: m.model }), 'application/json');
    } else if (act === 'report') {
      if (!caps().report) { upgrade(); return; }
      download(`materialhunt-test-report-${slug(m.name)}.csv`, reportCsv(m), 'text/csv');
    } else if (act === 'share') {
      await shareModel(m);
    } else if (act === 'del') {
      if (!t.dataset.sure) { t.dataset.sure = '1'; t.textContent = 'Sure?'; setTimeout(() => { if (t.isConnected) { delete t.dataset.sure; t.textContent = 'Delete'; } }, 3000); return; }
      await delModel(m.id); picked.delete(m.id); await refreshSaved();
    }
  }

  function mountModels() {
    const sec = q('#view-ml');
    if (!sec) return false;
    if (q('#mlModels')) return true;
    const a = document.createElement('article');
    a.id = 'mlModels';
    a.className = 'glass ml-models';
    a.innerHTML = '<span class="pv-kicker">YOUR WORKSPACE</span><h3>My models</h3><div id="mlModelsBody"></div>';
    sec.appendChild(a);
    a.addEventListener('click', onModelClick);
    a.addEventListener('change', (e) => { if (e.target.matches('[data-pick]')) onModelClick(e); });
    refreshSaved();
    // refresh the "current model" state when a model is trained or loaded
    if (q('#mlResult')) new MutationObserver(() => renderModels()).observe(q('#mlResult'), { childList: true });
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Teams: names, seats, invitations by email, shelf and chat            */
  /* ------------------------------------------------------------------ */
  const SEATS = { team: 5, team_max: 10, team_ultra: 25 };
  const RANK = { free: 0, guest: 0, pro: 1, team: 1, max: 2, team_max: 2, ultra: 3, team_ultra: 3, enterprise: 3 };
  const PLAN_LABEL = { team: 'Team Pro', team_max: 'Team Max', team_ultra: 'Team Ultra' };
  const TEAM_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
  const slugTeam = (raw) => String(raw || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const uidNow = () => window.MH_FIREBASE?.auth?.currentUser?.uid || '';
  const emailKey = (e) => String(e || '').trim().toLowerCase().replace(/\./g, ',');
  const okEmail = (e) => /^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(e);
  const who = () => (window.MH_PROFILE?.displayName?.() || state.user?.organization_name || 'Member').slice(0, 40);
  const ago = (t) => { const m = Math.max(0, (Date.now() - ms(t)) / 60000); if (!ms(t)) return 'just now'; if (m < 60) return `${Math.max(1, Math.round(m))} min ago`; if (m < 1440) return `${Math.round(m / 60)} h ago`; return `${Math.round(m / 1440)} d ago`; };

  let team = null;      // { id, display, owner, plan, until }
  let members = [];
  let sentInvites = [];
  let myInvite = null;  // { key, team, display, by_name, plan }
  let items = [];
  let messages = [];
  let tab = 'chat';
  let stopChat = null;
  let note = '';

  const seatsOf = () => (team ? (SEATS[team.plan] || 5) : 0);
  const isOwner = () => Boolean(team && team.owner === uidNow());
  const full = () => team && members.length >= seatsOf();
  const say = (m) => { note = m; const e = q('#teamMsg'); if (e) e.textContent = m; };

  /* members get the team's plan while the team's plan is active */
  function applyTeamPlan() {
    const u = state.user;
    if (!u) return;
    if (u._ownTier === undefined) u._ownTier = u.tier;
    let tierNow = u._ownTier;
    if (team && RANK[team.plan] > (RANK[u._ownTier] || 0) && (!team.until || team.until > Date.now())) tierNow = team.plan;
    if (tierNow !== u.tier) { u.tier = tierNow; u.tier_name = PLAN_LABEL[tierNow] || tierNow; window.MH_GROWTH?.renderPricing?.(); }
  }

  async function loadTeam() {
    team = null; members = []; sentInvites = []; myInvite = null;
    const u = state.user;
    if (!u || !u.email_verified) { applyTeamPlan(); return; }
    try {
      await window.MH_FIREBASE.initFirebase();
      const id = myTeam();
      if (id) {
        const n = await db().collection('team_names').doc(id).get();
        const seat = n.exists ? await db().collection('team_members').doc(`${id}_${u.team_slot}`).get() : null;
        if (n.exists && seat && seat.exists && seat.data().uid === uidNow()) team = { id, ...n.data() };
        else { await db().collection('users').doc(uidNow()).update({ team: '', team_slot: -1 }); u.team = ''; u.team_slot = -1; }
      }
      if (team) {
        members = (await db().collection('team_members').where('team', '==', team.id).get()).docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.slot - b.slot);
        if (isOwner()) {
          sentInvites = (await db().collection('team_invites').where('by', '==', uidNow()).get()).docs.map((d) => ({ key: d.id, ...d.data() })).filter((i) => i.team === team.id);
          const real = u._ownTier;
          const until = Date.parse(u.trial_until || '') || 0;
          if (SEATS[real] && (team.plan !== real || (team.until || 0) !== until)) {
            try { await db().collection('team_names').doc(team.id).update({ plan: real, until }); team.plan = real; team.until = until; } catch { /* keep the old copy */ }
          }
        }
      } else if (u.email) {
        const inv = await db().collection('team_invites').doc(emailKey(u.email)).get();
        if (inv.exists) {
          const n = await db().collection('team_names').doc(inv.data().team).get();
          myInvite = { key: inv.id, ...inv.data(), plan: n.exists ? n.data().plan : '' };
        }
      }
    } catch { /* offline: leave what we have */ }
    applyTeamPlan();
  }

  /* ---------------- actions ---------------- */
  async function createTeam() {
    const raw = (q('#teamNew')?.value || '').trim();
    const id = slugTeam(raw);
    if (!TEAM_RE.test(id)) { say('Use 3 to 40 letters or numbers. Spaces become dashes.'); return; }
    let taken = false;
    try { taken = (await db().collection('team_names').doc(id).get()).exists; } catch { say('Could not check. Are you online?'); return; }
    if (taken) { say(`"${id}" is taken. Try another name.`); return; }
    const real = state.user._ownTier;
    if (!SEATS[real]) { say('Creating a team needs a Team Pro, Team Max or Team Ultra plan on your account.'); return; }
    try {
      await db().collection('team_names').doc(id).set({ owner: uidNow(), display: raw.slice(0, 40), plan: real, until: Date.parse(state.user.trial_until || '') || 0, created_at: FV().serverTimestamp() });
      await db().collection('team_members').doc(`${id}_0`).set({ team: id, slot: 0, uid: uidNow(), name: who(), joined_at: FV().serverTimestamp() });
      await db().collection('users').doc(uidNow()).update({ team: id, team_slot: 0 });
      state.user.team = id; state.user.team_slot = 0;
      notify(`Team "${raw}" created. Add your teammates by email.`, 'success', 5000);
      note = ''; tab = 'members';
      await loadTeam(); render();
    } catch { say('Could not create the team. Your plan must be active and your email verified, or someone just took that name.'); }
  }

  async function inviteByEmail() {
    const email = (q('#teamEmail')?.value || '').trim().toLowerCase();
    if (!okEmail(email)) { say('Enter a valid email address.'); return; }
    if (full()) { say(`Team full: all ${seatsOf()} seats are used.`); return; }
    if (members.length + sentInvites.filter((i) => i.key !== emailKey(email)).length >= seatsOf()) { say('All seats are taken or already promised to pending invitations. Cancel one first.'); return; }
    try {
      await db().collection('team_invites').doc(emailKey(email)).set({ team: team.id, display: team.display, by: uidNow(), by_name: who(), created_at: FV().serverTimestamp() });
      say(`Added. When ${email} signs in with that email, they will see an invitation to join and can accept it.`);
      if (q('#teamEmail')) q('#teamEmail').value = '';
      await loadTeam(); renderBody();
    } catch { say('Could not add them. Your team plan must be active.'); }
  }

  async function acceptInvite() {
    const inv = myInvite;
    if (!inv) return;
    try {
      const n = await db().collection('team_names').doc(inv.team).get();
      if (!n.exists) { say('That team no longer exists.'); return; }
      const seats = SEATS[n.data().plan] || 5;
      const taken = (await db().collection('team_members').where('team', '==', inv.team).get()).docs.map((d) => d.data().slot);
      let slot = -1;
      for (let i = 0; i < seats && slot < 0; i += 1) {
        if (taken.includes(i)) continue;
        try { await db().collection('team_members').doc(`${inv.team}_${i}`).set({ team: inv.team, slot: i, uid: uidNow(), name: who(), joined_at: FV().serverTimestamp() }); slot = i; } catch { /* taken a moment ago or no seat: try the next */ }
      }
      if (slot < 0) { say(`Team full: all ${seats} seats are used. Ask the team owner to free a seat.`); return; }
      await db().collection('users').doc(uidNow()).update({ team: inv.team, team_slot: slot });
      state.user.team = inv.team; state.user.team_slot = slot;
      try { await db().collection('team_invites').doc(inv.key).delete(); } catch { /* ignore */ }
      notify('You joined the team. You now have the team plan.', 'success', 5000);
      note = ''; tab = 'chat';
      await loadTeam(); mountShelf(); render();
    } catch { say('Could not join. Please try again.'); }
  }

  async function declineInvite() {
    if (!myInvite) return;
    try { await db().collection('team_invites').doc(myInvite.key).delete(); } catch { /* ignore */ }
    myInvite = null; note = ''; mountShelf(); render();
  }

  async function leaveTeam() {
    try {
      await db().collection('team_members').doc(`${team.id}_${state.user.team_slot}`).delete();
      await db().collection('users').doc(uidNow()).update({ team: '', team_slot: -1 });
      state.user.team = ''; state.user.team_slot = -1;
      stopChatNow(); note = '';
      await loadTeam(); applyTeamPlan(); mountShelf(); render();
    } catch { say('Could not leave the team.'); }
  }

  async function removeMember(id) {
    const m = members.find((x) => x.id === id);
    if (!m || m.uid === uidNow()) return;
    try { await db().collection('team_members').doc(id).delete(); say(`${m.name} was removed. Their seat is free.`); await loadTeam(); renderBody(); } catch { say('Could not remove them.'); }
  }

  async function cancelInvite(key) {
    try { await db().collection('team_invites').doc(key).delete(); await loadTeam(); renderBody(); } catch { say('Could not cancel it.'); }
  }

  async function put(kind, name, payload) {
    if (!team) { notify('Join or create a team first.', 'warning', 4000); return false; }
    const text = JSON.stringify(payload);
    if (text.length > 900000) { notify('That is too big to share. Train it with fewer trees and try again.', 'warning', 5000); return false; }
    try {
      await db().collection('team_items').add({ team: team.id, kind, name: String(name).slice(0, 80), owner: uidNow(), owner_name: who(), payload: text, created_at: FV().serverTimestamp() });
      notify('Shared with your team.', 'success', 3000);
      await loadItems();
      return true;
    } catch { notify('Could not share it. Your team plan may have ended.', 'error', 4500); return false; }
  }

  async function shareDesign() {
    const snap = window.MH_DESIGNS?.snapshot?.();
    if (!snap) { notify('Run a simulation first, then share it.', 'info', 3500); return; }
    await put('design', (q('#teamName')?.value || '').trim() || 'Untitled design', snap);
  }
  async function shareModel(m) {
    if (!canShareModels()) { notify('Sharing models needs Team Max or Team Ultra.', 'info', 4000); return; }
    await put('model', m.name, { format: 'materialhunt-ml-1', prop: m.prop || 'y', model: m.model });
  }

  async function loadItems() {
    items = [];
    if (!team) return;
    try {
      const s = await db().collection('team_items').where('team', '==', team.id).limit(100).get();
      items = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.created_at) - ms(a.created_at));
    } catch { /* leave empty */ }
    renderBody();
  }

  async function sendMessage() {
    const box = q('#chatText');
    const text = (box?.value || '').trim().slice(0, 500);
    if (!text || !team) return;
    try {
      box.value = '';
      await db().collection('team_messages').add({ team: team.id, owner: uidNow(), owner_name: who(), text, created_at: FV().serverTimestamp() });
    } catch { box.value = text; notify('Could not send. Your team plan may have ended.', 'error', 3500); }
  }

  function startChatNow() {
    stopChatNow();
    if (!team || !db()) return;
    try {
      stopChat = db().collection('team_messages').where('team', '==', team.id).limit(200).onSnapshot((snap) => {
        messages = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (ms(a.created_at) || Date.now()) - (ms(b.created_at) || Date.now()));
        renderChat();
      }, () => { /* no access */ });
    } catch { stopChat = null; }
  }
  function stopChatNow() { if (stopChat) { try { stopChat(); } catch { /* ignore */ } stopChat = null; } }

  /* ---------------- drawing ---------------- */
  function renderChat() {
    const l = q('#chatList');
    if (!l) return;
    const stick = l.scrollTop + l.clientHeight >= l.scrollHeight - 40;
    l.innerHTML = messages.length ? messages.map((m) => `<div class="chat-msg${m.owner === uidNow() ? ' mine' : ''}"><small>${esc(m.owner_name || 'Member')} · ${esc(ago(m.created_at))}</small><p>${esc(m.text).replace(/\n/g, '<br>')}</p>${(m.owner === uidNow() || isOwner()) ? `<button class="text-btn" data-t="delmsg" data-id="${esc(m.id)}">delete</button>` : ''}</div>`).join('') : '<p class="micro-note">No messages yet. Say hello to your team.</p>';
    if (stick) l.scrollTop = l.scrollHeight;
  }

  function renderBody() {
    const b = q('#teamBody');
    if (!b || !team) return;
    const seatsLeft = seatsOf() - members.length;
    if (tab === 'chat') {
      b.innerHTML = `<div id="chatList" class="chat-list"></div>
        <div class="ml-save-row"><input id="chatText" type="text" maxlength="500" placeholder="Message your team" /><button class="btn btn-primary small" data-t="send">Send</button></div>
        <p class="micro-note">Only people in your team can see this. Be kind. Team owners can delete messages.</p>`;
      renderChat();
      startChatNow();
      return;
    }
    stopChatNow();
    if (tab === 'shelf') {
      b.innerHTML = `<div class="ml-save-row"><input id="teamName" type="text" maxlength="80" placeholder="Name for the design you want to share" /><button class="btn btn-primary small" data-t="share">Share current design</button><button class="btn btn-ghost small" data-t="refresh">Refresh</button></div>
        ${canShareModels() ? '<p class="micro-note">To share a trained model, save it in the ML Lab under My models, then press "Share with team".</p>' : '<p class="micro-note">Sharing trained models is part of Team Max and Team Ultra.</p>'}
        ${items.length ? items.map((i) => `<article class="forum-thread glass"><div class="forum-body" style="padding-top:14px"><span class="forum-cat">${i.kind === 'model' ? 'Trained model' : 'Design'}</span>
          <p><b>${esc(i.name)}</b><br><small>${esc(i.owner_name || 'Member')} · ${esc(ago(i.created_at))}</small></p>
          <div class="admin-actions"><button class="btn btn-primary small" data-t="open" data-id="${esc(i.id)}">${i.kind === 'model' ? 'Open in ML Lab' : 'Open in Simulator'}</button>
          ${(i.owner === uidNow() || isOwner()) ? `<button class="btn btn-ghost small" data-t="delitem" data-id="${esc(i.id)}">Remove</button>` : ''}</div></div></article>`).join('') : '<div class="empty-state"><strong>Nothing shared yet</strong><span>Share a design from the Simulator, or a trained model from the ML Lab.</span></div>'}`;
      return;
    }
    b.innerHTML = `<p class="micro-note">${members.length} of ${seatsOf()} seats used${full() ? ' · <b>Team full</b>' : ` · ${seatsLeft} free`}. Everyone you add gets the ${esc(PLAN_LABEL[team.plan] || 'team')} plan while the team's plan is active.</p>
      <div class="admin-table-wrap"><table class="ml-table"><thead><tr><th>Seat</th><th>Member</th><th></th></tr></thead><tbody>${members.map((m) => `<tr><td>${m.slot + 1}</td><td>${esc(m.name)}${m.uid === team.owner ? ' <small>(owner)</small>' : ''}${m.uid === uidNow() ? ' <small>(you)</small>' : ''}</td><td>${isOwner() && m.uid !== uidNow() ? `<button class="btn btn-ghost small" data-t="remove" data-id="${esc(m.id)}">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      ${isOwner() ? `<h4>Add someone</h4>
        <div class="ml-save-row"><input id="teamEmail" type="email" maxlength="200" placeholder="Their email address" ${full() ? 'disabled' : ''} /><button class="btn btn-primary small" data-t="invite" ${full() ? 'disabled' : ''}>${full() ? 'Team full' : 'Add'}</button></div>
        <p class="micro-note">They need a MaterialHunt account with this verified email. When they sign in they see an invitation and accept it in one tap.</p>
        ${sentInvites.length ? `<h4>Waiting for a reply</h4><ul class="dr-evidence">${sentInvites.map((i) => `<li>${esc(i.key.replace(/,/g, '.'))} <button class="text-btn" data-t="cancel" data-id="${esc(i.key)}">cancel</button></li>`).join('')}</ul>` : ''}` : `<button class="btn btn-ghost small" data-t="leave">Leave this team</button>`}`;
  }

  function render() {
    const root = q('#teamRoot');
    if (!root) return;
    if (!state.user?.email_verified) { root.innerHTML = '<div class="empty-state"><strong>Verify your email first</strong><span>Teams need a verified email address.</span></div>'; return; }
    if (team) {
      root.innerHTML = `<div class="glass team-head"><p><b>${esc(team.display)}</b> <small>(<code>${esc(team.id)}</code>) · ${esc(PLAN_LABEL[team.plan] || 'Team')} · ${members.length} of ${seatsOf()} seats${full() ? ' · <b>Team full</b>' : ''}</small></p>
        <div class="forum-chips"><button class="forum-chip${tab === 'chat' ? ' on' : ''}" data-t="tab" data-id="chat">Chat</button><button class="forum-chip${tab === 'shelf' ? ' on' : ''}" data-t="tab" data-id="shelf">Shelf</button><button class="forum-chip${tab === 'members' ? ' on' : ''}" data-t="tab" data-id="members">Members${isOwner() ? ' and invitations' : ''}</button></div>
        <p class="micro-note" id="teamMsg" aria-live="polite">${esc(note)}</p></div><div id="teamBody"></div>`;
      renderBody();
      if (tab === 'shelf') loadItems();
      return;
    }
    stopChatNow();
    if (myInvite) {
      root.innerHTML = `<div class="glass team-head"><h3>You have been invited</h3><p><b>${esc(myInvite.by_name || 'Someone')}</b> invited you to join <b>${esc(myInvite.display || myInvite.team)}</b>${myInvite.plan ? ` (${esc(PLAN_LABEL[myInvite.plan] || 'team')} plan)` : ''}. When you join, you get the team's plan while it is active.</p>
        <div class="admin-actions"><button class="btn btn-primary small" data-t="accept">Accept</button><button class="btn btn-ghost small" data-t="decline">Decline</button></div><p class="micro-note" id="teamMsg" aria-live="polite">${esc(note)}</p></div>`;
      return;
    }
    root.innerHTML = SEATS[state.user._ownTier]
      ? `<div class="glass team-head"><h3>Create your team</h3>
        <p class="micro-note">Pick a name. It works like a user name: the first person to take it keeps it, and if it is taken you pick another. Your ${esc(PLAN_LABEL[state.user._ownTier])} plan has ${SEATS[state.user._ownTier]} seats, including yours.</p>
        <div class="ml-save-row"><input id="teamNew" type="text" maxlength="40" placeholder="e.g. SEA Robotics Club" /><button class="btn btn-glass small" data-t="check">Check name</button><button class="btn btn-primary small" data-t="create">Create team</button></div>
        <p class="micro-note" id="teamMsg" aria-live="polite">${esc(note)}</p></div>`
      : '<div class="glass team-head"><h3>You are not in a team</h3><p class="micro-note">A team owner can add you by email using the email address of your MaterialHunt account. Come back here when they have. Team plans are on the Pricing page.</p></div>';
  }

  async function onTeamClick(e) {
    const t = e.target.closest('[data-t]');
    if (!t) return;
    const a = t.dataset.t;
    if (a === 'tab') { tab = t.dataset.id; render(); return; }
    if (a === 'send') { await sendMessage(); return; }
    if (a === 'share') { await shareDesign(); return; }
    if (a === 'refresh') { await loadItems(); return; }
    if (a === 'create') { await createTeam(); return; }
    if (a === 'check') {
      const id = slugTeam(q('#teamNew')?.value || '');
      if (!TEAM_RE.test(id)) { say('Use 3 to 40 letters or numbers. Spaces become dashes.'); return; }
      try { say((await db().collection('team_names').doc(id).get()).exists ? `"${id}" is taken. Try another name.` : `"${id}" is free. Press "Create team" to take it.`); } catch { say('Could not check. Are you online?'); }
      return;
    }
    if (a === 'invite') { await inviteByEmail(); return; }
    if (a === 'accept') { await acceptInvite(); return; }
    if (a === 'decline') { await declineInvite(); return; }
    if (a === 'remove') { await removeMember(t.dataset.id); return; }
    if (a === 'cancel') { await cancelInvite(t.dataset.id); return; }
    if (a === 'leave') {
      if (!t.dataset.sure) { t.dataset.sure = '1'; t.textContent = 'Sure? Press again'; setTimeout(() => { if (t.isConnected) { delete t.dataset.sure; t.textContent = 'Leave this team'; } }, 3000); return; }
      await leaveTeam(); return;
    }
    if (a === 'delmsg') { try { await db().collection('team_messages').doc(t.dataset.id).delete(); } catch { /* ignore */ } return; }
    if (a === 'delitem') { try { await db().collection('team_items').doc(t.dataset.id).delete(); items = items.filter((x) => x.id !== t.dataset.id); renderBody(); } catch { /* ignore */ } return; }
    if (a === 'open') {
      const it = items.find((x) => x.id === t.dataset.id);
      if (!it) return;
      let data;
      try { data = JSON.parse(it.payload); } catch { notify('That item is damaged.', 'error', 3000); return; }
      if (it.kind === 'design') { window.MH_DESIGNS?.open?.({ ...data, name: it.name }); }
      else {
        setView('ml');
        if (window.MH_ML?.loadLab?.(data.model, data.prop)) notify('Model loaded in the ML Lab. Press "Use as My ML" to use it in the other tabs.', 'success', 5000);
        else notify('That model could not be loaded.', 'error', 3500);
      }
    }
  }

  function mountShelf() {
    const main = q('main');
    if (!main) return;
    const nav = q('.main-nav');
    const want = isTeam() || Boolean(myInvite) || Boolean(team);
    if (want && nav && !q('[data-view="team"]', nav)) {
      const b = document.createElement('button');
      b.className = 'nav-link'; b.dataset.view = 'team'; b.title = 'Your team: chat, shared designs and members'; b.textContent = myInvite && !team ? 'Team •' : 'Team';
      b.addEventListener('click', () => setView('team'));
      nav.insertBefore(b, q('[data-view="pricing"]', nav));
    } else if (want && nav) {
      const b = q('[data-view="team"]', nav);
      if (b) b.textContent = myInvite && !team ? 'Team •' : 'Team';
    }
    if (!want) { q('[data-view="team"]', nav)?.remove(); stopChatNow(); return; }
    if (q('#view-team')) return;
    const sec = document.createElement('section');
    sec.className = 'view';
    sec.id = 'view-team';
    sec.innerHTML = `<div class="section-head"><div><span class="panel-kicker">TEAM</span><h2>Your team</h2>
        <p>Chat with your team, share designs${canShareModels() ? ' and trained models' : ''}, and add people by email. Everyone in the team gets the team's plan. Only your team can see what is shared.</p></div></div><div id="teamRoot"><div class="empty-state"><strong>Loading…</strong></div></div>`;
    main.appendChild(sec);
    sec.addEventListener('click', onTeamClick);
    sec.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'chatText') { e.preventDefault(); sendMessage(); } });
    new MutationObserver(() => { if (sec.classList.contains('active')) loadTeam().then(() => { mountShelf(); render(); }); else stopChatNow(); }).observe(sec, { attributes: true, attributeFilter: ['class'] });
  }

  async function onSession() {
    stopChatNow();
    await loadTeam();
    mountShelf();
    if (q('#view-team')?.classList.contains('active')) render();
    if (myInvite && !team) notify(`You have been invited to join the team "${myInvite.display || myInvite.team}". Open the Team tab to accept.`, 'info', 7000);
  }

  /* ------------------------------------------------------------------ */
  function boot() {
    let tries = 0;
    const t = setInterval(() => { tries += 1; if (mountModels() || tries > 60) clearInterval(t); }, 500);
    window.addEventListener('mh:session', () => { setTimeout(() => { onSession(); refreshSaved(); }, 600); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.MH_PLANS = { caps, tier, isTeam, canShareModels };
})();
