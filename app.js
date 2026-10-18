(function(){
/* ---------- Repository settings (detected from the GitHub Pages address) ---------- */
const OWNER = location.hostname.endsWith('github.io') ? location.hostname.split('.')[0] : 'dhageali';
const REPO = (location.pathname.split('/').filter(Boolean)[0]) || 'green-podium';
const BRANCH = 'main';
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/`;

const LOGO = 'logo.png';
const LEAVES = ['Gold Leaf','Silver Leaf','Bronze Leaf'];
let state = JSON.parse(document.getElementById('gp-state').textContent);
let saved = JSON.stringify(state);
let config = null;          // encrypted key from config.json
let token = null;           // decrypted GitHub key, kept in memory only
let mode = 'view';          // view | unlock | setup | edit
let msg = '';
const app = document.getElementById('app');

const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const W = () => state.weekLabels.length;
const has = v => v !== null && v !== '' && v !== undefined;
const doneWeeks = () => state.weekLabels.map((_,w) => state.classes.some(c => has(c.scores[w]))).lastIndexOf(true) + 1;
const total = c => c.scores.reduce((a,v) => a + (has(v) ? Number(v) : 0), 0);
const sorted = () => state.classes.filter(c => c.name.trim()).map(c => ({...c, points: total(c)})).sort((a,b) => b.points - a.points);
const ranks = l => l.reduce((acc,c,i) => { acc.push(i > 0 && c.points === l[i-1].points ? acc[i-1] : i+1); return acc; }, []);
const maxSoFar = () => Math.max(1, doneWeeks()) * state.perWeek;
const maxMonth = () => W() * state.perWeek;

/* ---------- Encryption: password -> AES key that unlocks the GitHub key ---------- */
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = buf => { let s = ''; new Uint8Array(buf).forEach(b => s += String.fromCharCode(b)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveKey(password, salt){
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:250000, hash:'SHA-256'}, base, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
}
async function encryptToken(tok, password){
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, await deriveKey(password, salt), enc.encode(tok));
  return {v:1, salt:b64(salt), iv:b64(iv), ct:b64(ct)};
}
async function decryptToken(cfg, password){
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv:unb64(cfg.iv)}, await deriveKey(password, unb64(cfg.salt)), unb64(cfg.ct));
  return dec.decode(pt);
}

/* ---------- GitHub: save a file to the repository ---------- */
const utf8b64 = str => b64(enc.encode(str));
async function gh(path, opts = {}, tok = token){
  const r = await fetch(API + path + (opts.method ? '' : `?ref=${BRANCH}`), {
    ...opts, headers: {'Accept':'application/vnd.github+json', 'Authorization':'Bearer ' + tok, ...(opts.headers || {})}
  });
  return r;
}
async function saveFile(path, text, message, tok = token){
  let sha;
  const cur = await gh(path, {}, tok);
  if(cur.status === 401 || cur.status === 403) throw new Error('auth');
  if(cur.ok) sha = (await cur.json()).sha;
  const r = await gh(path, {method:'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({message, content: utf8b64(text), branch: BRANCH, ...(sha ? {sha} : {})})}, tok);
  if(r.status === 401 || r.status === 403) throw new Error('auth');
  if(!r.ok) throw new Error('save');
}

/* ---------- Page ---------- */
function spot(c, place, rk){
  if(!c) return `<div class="spot p${place} empty"><div class="medal">${place}</div><div class="cls">—</div><div class="pts">&nbsp;</div><div class="block"><span class="lvl">${place}</span></div></div>`;
  return `<div class="spot p${place} r${rk}"><div class="medal">${rk}</div><div class="cls">${esc(c.name)}</div><div class="pts">${c.points} / ${maxSoFar()} pts</div><div class="block"><span class="lvl">${rk}</span><span class="tag">${LEAVES[rk-1]||''}</span></div></div>`;
}

function render(){
  const list = sorted(), rk = ranks(list), d = doneWeeks(), mm = maxMonth();
  const leader = list[0] ? list[0].points : 0;
  const finished = d >= W();
  const weeks = state.weekLabels.map((lb,i) => `<div class="wk ${i < d ? 'done' : ''} ${i === W()-1 ? 'final' : ''}"><b>Week ${i+1}</b><span>${esc(lb)}</span><span>${i < d ? 'Scored' : (i === W()-1 ? 'Final week · Reveal' : 'Coming up')}</span></div>`).join('');
  const rows = list.map((c,i) => {
    const segs = c.scores.map(v => has(v) ? `<span style="width:${Number(v)/mm*100}%" title="${v} pts"></span>` : '').join('');
    return `<li class="row"><span class="rank">${rk[i]}</span><span class="name">${esc(c.name)}</span><span class="val">${c.points}<small> / ${mm}</small></span><div class="bar">${segs}</div><span class="gap">${c.points < leader ? (leader - c.points) + ' pts behind the leader' : 'Leading the Green Race'}</span></li>`;
  }).join('');
  const thead = `<tr><th>Class</th>${state.weekLabels.map((lb,i) => `<th>W${i+1}<br>${esc(lb)}</th>`).join('')}<th>Total</th></tr>`;
  const tbody = list.map(c => `<tr><td>${esc(c.name)}</td>${c.scores.map(v => has(v) ? `<td>${v}</td>` : `<td class="pending">–</td>`).join('')}<td class="tot">${c.points}</td></tr>`).join('');
  const ctrl = mode === 'view'
    ? `<button id="edit" class="primary">🔒 Update standings</button>`
    : (mode === 'edit' ? `<button id="lock">Lock</button>` : '');
  app.innerHTML = `<div class="wrap">
  <header><div class="logo"><img src="${LOGO}" alt="Rafic Hariri Technical Institute"></div><span class="eyebrow">Green Podium · Monthly Reveal</span><h1>${finished ? 'Greenest Classroom of ' + esc(state.month.split(' ')[0]) : "Who's leading the Green Race?"}</h1><p class="week">${esc(state.title)} · ${esc(state.month)} · ${d} of ${W()} weeks scored · max ${state.perWeek} pts per week</p></header>
  <div class="weeks">${weeks}</div>
  ${finished ? '' : `<div class="note">Standings so far. ${W() - d} week${W() - d === 1 ? '' : 's'} left, with up to ${(W() - d) * state.perWeek} points still to earn. The Greenest Classroom is announced after Week ${W()}.</div>`}
  <div><div class="stage">${spot(list[1],2,rk[1])}${spot(list[0],1,rk[0])}${spot(list[2],3,rk[2])}</div><div class="base"></div></div>
  <section><h2>Leaf Meter</h2><p class="hint">Each bar fills toward the month's maximum of ${mm} points. Every segment is one week.</p><ul class="meter">${rows}</ul></section>
  <section><h2>Week by week</h2><div class="tbl"><table><thead>${thead}</thead><tbody>${tbody}</tbody></table></div></section>
  <div class="actions"><button id="copy">Copy for Teams post</button>${ctrl}<span class="status" id="status" role="status">${esc(msg)}</span></div>
  ${panel()}
  <footer>RHHS Green App · Greenest Classroom of the Month</footer></div>`;
  bind();
}

function panel(){
  if(mode === 'unlock') return `<form class="editor" id="f-unlock" autocomplete="off">
    <h2>Enter password</h2>
    <label for="pw">Password<input id="pw" type="password" autocomplete="current-password" required></label>
    <div class="actions"><button class="primary" type="submit">Unlock</button><button type="button" id="cancel">Cancel</button></div></form>`;
  if(mode === 'setup') return `<form class="editor" id="f-setup" autocomplete="off">
    <h2>One-time setup</h2>
    <p class="hint">Paste your GitHub access key and choose a password. The key is saved in encrypted form, and only this password can unlock it.</p>
    <label for="tok">GitHub access key<input id="tok" type="password" required></label>
    <label for="pw1">New password (at least 8 characters)<input id="pw1" type="password" minlength="8" autocomplete="new-password" required></label>
    <label for="pw2">Repeat password<input id="pw2" type="password" minlength="8" autocomplete="new-password" required></label>
    <div class="actions"><button class="primary" type="submit">Save setup</button><button type="button" id="cancel">Cancel</button></div></form>`;
  if(mode === 'edit'){
    const head = `<tr><th>Class</th>${state.weekLabels.map((_,i) => `<th>W${i+1}</th>`).join('')}</tr>`;
    const body = state.classes.map((c,ci) => `<tr><td><input id="n${ci}" aria-label="Class name" value="${esc(c.name)}" style="width:100px"></td>${c.scores.map((v,w) => `<td><input id="s${ci}_${w}" aria-label="${esc(c.name)} week ${w+1}" type="number" min="0" max="${state.perWeek}" value="${has(v) ? v : ''}"></td>`).join('')}</tr>`).join('');
    return `<div class="editor"><h2>Update standings</h2><label for="e-month">Month<input id="e-month" value="${esc(state.month)}"></label>
    <p class="hint">Enter each week's points (0–${state.perWeek}). Leave future weeks empty.</p>
    <div class="tbl"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>
    <div class="actions"><button id="save" class="primary">Publish standings</button><button id="cancel">Cancel</button></div></div>`;
  }
  return '';
}

function readEditor(){
  state.month = document.getElementById('e-month').value.trim() || state.month;
  state.classes = state.classes.map((c,ci) => ({ name: document.getElementById('n'+ci).value.trim() || c.name,
    scores: c.scores.map((_,w) => { const v = document.getElementById(`s${ci}_${w}`).value; return v === '' ? null : Math.min(state.perWeek, Math.max(0, Number(v) || 0)); }) }));
}

function teamsText(){
  const l = sorted(), rk = ranks(l), m = ['🥇','🥈','🥉'], d = doneWeeks(), mm = maxMonth();
  const lines = l.map((c,i) => rk[i] <= 3 ? `${m[rk[i]-1]} ${LEAVES[rk[i]-1]}: ${c.name} – ${c.points}/${mm} pts` : `${rk[i]}. ${c.name} – ${c.points}/${mm} pts`).join('\n');
  const end = d >= W() ? `Congratulations to our Greenest Classroom of ${state.month.split(' ')[0]}! 🌍` : `${W() - d} week(s) to go – every point counts. Keep it green!`;
  return `🌿 Green Podium – ${state.title}\n${state.month} · after Week ${d} of ${W()}\n\n${lines}\n\n${end}\n\n${location.href}`;
}

function go(m, text = ''){ mode = m; msg = text; render(); const f = document.querySelector('.editor input'); if(f) f.focus(); }
function setStatus(t){ msg = t; const s = document.getElementById('status'); if(s) s.textContent = t; }

function bind(){
  document.getElementById('copy').onclick = async () => {
    try { await navigator.clipboard.writeText(teamsText()); setStatus('Copied. Paste it into your Teams post.'); }
    catch(e){ setStatus('Copy is blocked in this browser.'); }
  };
  const ed = document.getElementById('edit');
  if(ed) ed.onclick = () => go(config && config.ct ? 'unlock' : 'setup');
  const lk = document.getElementById('lock');
  if(lk) lk.onclick = () => { token = null; state = JSON.parse(saved); go('view', 'Locked.'); };
  const cancel = document.getElementById('cancel');
  if(cancel) cancel.onclick = () => { state = JSON.parse(saved); go(token ? 'view' : 'view'); };

  const fu = document.getElementById('f-unlock');
  if(fu) fu.onsubmit = async e => {
    e.preventDefault(); setStatus('Checking…');
    try { token = await decryptToken(config, document.getElementById('pw').value); go('edit', 'Unlocked.'); }
    catch(err){ token = null; setStatus('Incorrect password. Try again.'); document.getElementById('pw').select(); }
  };

  const fs = document.getElementById('f-setup');
  if(fs) fs.onsubmit = async e => {
    e.preventDefault();
    const tok = document.getElementById('tok').value.trim(), p1 = document.getElementById('pw1').value, p2 = document.getElementById('pw2').value;
    if(p1 !== p2){ setStatus('The two passwords are different.'); return; }
    setStatus('Saving setup…');
    try {
      const cfg = await encryptToken(tok, p1);
      await saveFile('config.json', JSON.stringify(cfg, null, 2) + '\n', 'Set up Green Podium editing', tok);
      config = cfg; token = tok; go('edit', 'Setup saved. You can now update the standings.');
    } catch(err){
      setStatus(err.message === 'auth' ? 'GitHub refused this access key. Check that it has Contents: Read and write on this repository.' : 'Could not save the setup. Check your connection and try again.');
    }
  };

  const sv = document.getElementById('save');
  if(sv) sv.onclick = async () => {
    readEditor(); sv.disabled = true; setStatus('Publishing…');
    try {
      await saveFile('data.json', JSON.stringify(state, null, 2) + '\n', `Update standings – ${state.month}, week ${doneWeeks()}`);
      saved = JSON.stringify(state); token = null;
      go('view', 'Published and locked. Everyone sees the new standings within a few minutes.');
    } catch(err){
      sv.disabled = false;
      setStatus(err.message === 'auth' ? 'GitHub refused the access key. It may have expired. Run setup again with a new key.' : 'Could not publish. Check your connection and try again.');
      if(err.message === 'auth'){ config = null; }
    }
  };
}

/* ---------- Load latest data and settings ---------- */
render();
const bust = '?t=' + Date.now();
fetch('data.json' + bust, {cache:'no-store'}).then(r => r.ok ? r.json() : null).then(d => { if(d && mode === 'view'){ state = d; saved = JSON.stringify(d); render(); } }).catch(() => {});
fetch('config.json' + bust, {cache:'no-store'}).then(r => r.ok ? r.json() : null).then(c => { config = c; }).catch(() => {});
})();
