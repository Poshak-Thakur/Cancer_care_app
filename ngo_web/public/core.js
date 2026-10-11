/* Saathi NGO Portal — core: config, API client, session, shell, login */
const $=s=>document.querySelector(s),app=$('#app');
const CFG=window.SAATHI_CONFIG||{},API=(CFG.API_BASE_URL||'/api').replace(/\/+$/,'');
const esc=t=>String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const P={pill:'M8 3h8v3H8zM6 6h12v15H6zM12 10v7M8.5 13.5h7',cal:'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',smile:'M12 3a9 9 0 100 18 9 9 0 000-18zM8.5 14a4 4 0 007 0M9 10h.01M15 10h.01',doc:'M7 3h8l4 4v14H7zM14 3v5h5M10 13h6M10 17h6',users:'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20c0-3 3-5 6-5s6 2 6 5M17 11a2.5 2.5 0 100-5M17 15c2.5 0 4 1.7 4 4',chat:'M4 5h16v11H9l-5 4z',home:'M4 11l8-7 8 7v9H4z',alert:'M12 4l9 16H3zM12 10v4M12 17h.01',clip:'M8 4h8v3H8zM6 5h12v16H6zM9 14l2 2 4-4',shield:'M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z',send:'M3 11l18-8-8 18-2-8z'};
const ic=(n,s=22)=>`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[n]}"/></svg>`;
const LOGO=(s=60)=>`<img src="logo.png" alt="Saathi Cancer Care dragonfly logo" height="${s}" style="width:auto;display:block">`;
const tile=n=>`<span class="tile">${ic(n)}</span>`,chev='<span class="chev" aria-hidden="true">›</span>',av=(n,c='')=>`<span class="av ${c}">${esc((n||'?')[0]).toUpperCase()}</span>`;
const row=(i,t,s,right='',go='')=>`<div class="lrow"${go?` onclick="${go}" tabindex="0"`:''}>${tile(i)}<div class="grow"><b>${esc(t)}</b><div class="sub">${esc(s)}</div></div>${right}${go?chev:''}</div>`;
const head=(t,s)=>`<h1>${t}</h1><p class="subt">${s||''}</p>`,sec=(t,r='')=>`<div class="sec"><h3>${t}</h3>${r}</div>`,skel='<div class="skel"></div><div class="skel"></div>';
const TZ='Asia/Kolkata';
const fmtD=v=>v?new Date(v).toLocaleDateString([], {day:'numeric',month:'short',year:'numeric',timeZone:TZ}):'—';
const fmtDT=v=>v?new Date(v).toLocaleString([], {day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:TZ}):'—';
const istISO=v=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)?v.slice(0,16)+':00+05:30':null;
const istToday=()=>new Date().toLocaleDateString('en-CA',{timeZone:TZ});
const age=d=>d?Math.floor((Date.now()-new Date(d))/31557600000):'—';
const greet=()=>{const h=new Date().getHours();return h<12?'morning':h<17?'afternoon':'evening'};
const human=s=>String(s||'').toLowerCase().replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());
const first=u=>(u&&(u.full_name||u.email)||'').split(/[ @]/)[0];
const uname=u=>u?(u.full_name||u.email||'Unknown'):'Unknown';

/* ---------- session ---------- */
// Session design (see docs/SESSION_SECURITY.md): tokens live in sessionStorage only (one tab, gone when the tab closes,
// never shared with other tabs), an inactivity timer signs the counsellor out, and logout revokes the refresh token.
const SKEY='saathi.session';
let S=null;try{localStorage.removeItem(SKEY);S=JSON.parse(sessionStorage.getItem(SKEY)||'null')}catch{}
const save=()=>{try{S?sessionStorage.setItem(SKEY,JSON.stringify(S)):sessionStorage.removeItem(SKEY)}catch{}};
const IDLE_MS=Math.max(0.02,Number(CFG.IDLE_TIMEOUT_MINUTES)||15)*60000;let idleT=null;
function touch(){if(!S)return;clearTimeout(idleT);idleT=setTimeout(()=>logout('You were signed out after '+Math.round(IDLE_MS/60000)+' minutes of inactivity.'),IDLE_MS)}
['pointerdown','keydown','touchstart'].forEach(e=>addEventListener(e,touch,{passive:true}));
let TIMER=null;const clearTimer=()=>{if(TIMER){clearInterval(TIMER);TIMER=null}};

/* ---------- API client ---------- */
class ApiError extends Error{constructor(status,j){super((j&&j.message)||(status===0?'Cannot reach the Saathi server. Check your connection and the API address in config.js.':'Request failed ('+status+').'));this.status=status;this.code=j&&j.code;this.errors=j&&j.errors;this.body=j}}
const errText=e=>{if(!e)return'Something went wrong.';let m=e.message||'Something went wrong.';if(e.errors&&e.errors.length)m+=' '+e.errors.map(x=>(x.path?x.path+': ':'')+x.message).join(' ');return m};
let refreshing=null;
async function refresh(){if(!S||!S.refresh_token)return false;
  refreshing=refreshing||(async()=>{try{const r=await fetch(API+'/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:S.refresh_token})});const j=await r.json().catch(()=>({}));if(!r.ok||!j.token)return false;S.token=j.token;S.refresh_token=j.refresh_token||S.refresh_token;save();return true}catch{return false}finally{refreshing=null}})();
  return refreshing}
async function api(path,o={},retry=true){
  let r;const h={'Accept':'application/json'};const fd=typeof FormData!=='undefined'&&o.body instanceof FormData;if(o.body!==undefined&&!fd)h['Content-Type']='application/json';if(S&&!o.noAuth)h.Authorization='Bearer '+S.token;
  try{r=await fetch(API+path,{method:o.method||(o.body!==undefined?'POST':'GET'),headers:h,body:o.body===undefined?undefined:fd?o.body:JSON.stringify(o.body)})}catch{throw new ApiError(0)}
  const j=await r.json().catch(()=>({}));
  if(r.status===401&&S&&!o.noAuth){if(retry&&await refresh())return api(path,o,false);forceLogout('Your session has expired. Please sign in again.');throw new ApiError(401,j)}
  if(!r.ok)throw new ApiError(r.status,j);
  // OTP/refresh answers keep token/user at the root; everything else wraps in {status,data,pagination}.
  return{data:j.data!==undefined?j.data:j,pagination:j.pagination||null,message:j.message,meta:j.meta,raw:j}}
const qs=o=>{const p=new URLSearchParams();Object.entries(o).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')p.set(k,v)});const s=p.toString();return s?'?'+s:''};
function toast(m,bad){const t=document.createElement('div');t.className='toast'+(bad?' bad':'');t.setAttribute('role',bad?'alert':'status');t.textContent=m;document.body.appendChild(t);setTimeout(()=>t.remove(),bad?6000:3500)}
function clearDrafts(){for(const st of[sessionStorage,localStorage]){Object.keys(st).filter(k=>k.startsWith('draft:')).forEach(k=>st.removeItem(k))}}
let NOTICE='';
function forceLogout(msg){clearTimer();clearTimeout(idleT);if(BADGE_T){clearInterval(BADGE_T);BADGE_T=null}LAST_ALERTS=null;clearDrafts();S=null;save();if(msg)NOTICE=msg;location.hash='#/login';route()}
// Signs out locally first (so nothing stays on screen), then revokes the refresh token on the server (best effort).
function logout(msg){const t=S&&S.token,rt=S&&S.refresh_token;forceLogout(typeof msg==='string'?msg:undefined);revoke(t,rt)}
function revoke(t,rt){if(t)fetch(API+'/auth/logout',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify({refresh_token:rt})}).catch(()=>{})}
let RETRY=null;
function stateErr(e,fn){RETRY=typeof fn==='function'?fn:()=>route();const m=e&&e.status===403?'You do not have access to this area. Only the central NGO counsellor account can use this portal.':errText(e);return`<div class="card state"><h2>${e&&e.status===403?'Access denied':'Could not load this page'}</h2><p>${esc(m)}</p><button class="out" onclick="RETRY()">Try again</button></div>`}
const U=v=>isUuid(v)?v:'';
const isUuid=s=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s||''));
const empty=t=>`<p class="meta pad">${esc(t)}</p>`;
const pager=(pg,fn)=>pg&&pg.total_pages>1?`<div class="pager"><button class="out" ${pg.page<=1?'disabled':''} onclick="${fn}(${Number(pg.page)-1})">‹ Previous</button><span class="meta">Page ${pg.page} of ${pg.total_pages} · ${pg.total} total</span><button class="out" ${pg.page>=pg.total_pages?'disabled':''} onclick="${fn}(${Number(pg.page)+1})">Next ›</button></div>`:'';
const tag=(t,c='')=>`<span class="tag ${c}">${esc(human(t))}</span>`;
const sevCls=s=>/high|crit/i.test(s||'')?'alert':/med/i.test(s||'')?'warn':'';

/* ---------- live alert badge (polls the overview every 60s) ---------- */
let BADGE_T=null,LAST_ALERTS=null;
async function pollBadge(){if(!S)return;try{const n=(await api('/admin/overview')).data.active_alerts;
  if(LAST_ALERTS!==null&&n>LAST_ALERTS)toast('New alert received.',1);LAST_ALERTS=n;
  const a=document.querySelector('.side a[href="#/alerts"]');if(a){let b=a.querySelector('.abadge');if(!b){b=document.createElement('span');b.className='abadge';a.appendChild(b)}b.textContent=n?n:'';b.style.cssText='margin-left:auto;background:var(--terra);color:#fff;border-radius:99px;padding:0 8px;font-size:13px;display:'+(n?'inline':'none')}
  document.title=(n?'('+n+') ':'')+'Saathi NGO Portal'}catch{}}
function startBadge(){pollBadge();if(!BADGE_T)BADGE_T=setInterval(pollBadge,60000)}
/* ---------- shell ---------- */
function shell(h,p){const l=(href,i,t)=>`<a href="#${href}" class="${p.startsWith(href)?'on':''}">${ic(i,20)}${t}</a>`;
  app.innerHTML=`<div class="shell"><nav class="side" aria-label="Main"><div class="brand">${LOGO()}<div><b>Saathi</b><small>Itti Foundation</small></div></div>${l('/dashboard','home','Dashboard')}${l('/patients','users','Patients')}${l('/alerts','alert','Alerts')}${l('/care-events','cal','Care events')}${l('/documents','doc','Document review')}${l('/messages','chat','Messages')}<h6>Community</h6>${l('/community/feed','users','Public feed')}${l('/community/moderation','shield','Moderation')}<h6>Manage</h6>${l('/caregivers','users','Caregiver recognition')}${l('/forms','clip','Check-in form')}${l('/audit','doc','Audit log')}
  <div class="foot"><div class="prow">${av(uname(S.user),'rose')}<div><b>${esc(uname(S.user))}</b><br><small>NGO counsellor</small></div></div><button class="out" onclick="logout()">Log out</button></div></nav><main class="main" id="main">${h}</main></div>`;startBadge();touch()}
const main=h=>{const m=$('#main');if(m)m.innerHTML=h};

/* ---------- login (email OTP) ---------- */
let LOGIN_EMAIL='';
function login(){clearTimer();const note=NOTICE;
  app.innerHTML=`<div class="login"><div class="card">${LOGO(96)}<h1 style="font-size:28px;margin:8px 0 16px">Saathi NGO Portal</h1><div id="lbox"></div></div></div>`;
  const box=$('#lbox');
  const stepEmail=(err=note||'')=>{box.innerHTML=`<form id="lf"><label for="em">Registered email address</label><input id="em" type="email" autocomplete="username" value="${esc(LOGIN_EMAIL)}" required><p class="err" id="e" role="alert">${esc(err)}</p><button style="width:100%">Send login code</button></form><p class="meta">We email a 6-digit code to the NGO counsellor account.</p>`;
    $('#lf').onsubmit=async e=>{e.preventDefault();LOGIN_EMAIL=$('#em').value.trim().toLowerCase();const b=e.target.querySelector('button');b.disabled=true;
      try{await api('/auth/request-otp',{body:{email:LOGIN_EMAIL},noAuth:true});NOTICE='';stepOtp()}catch(x){b.disabled=false;$('#e').textContent=errText(x)}}};
  const stepOtp=()=>{box.innerHTML=`<form id="lf"><p>Enter the code sent to <b>${esc(LOGIN_EMAIL)}</b>.</p><label for="otp">6-digit code</label><input id="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" required><p class="err" id="e" role="alert"></p><button style="width:100%">Verify and sign in</button><p style="text-align:center"><a href="#" id="back" class="back">Use a different email</a></p></form>`;
    $('#otp').focus();$('#back').onclick=e=>{e.preventDefault();stepEmail('')};
    $('#lf').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;
      try{const r=await api('/auth/verify-otp',{body:{email:LOGIN_EMAIL,otp:$('#otp').value.trim()},noAuth:true});
        S={token:r.raw.token,refresh_token:r.raw.refresh_token,user:r.raw.user};save();touch();
        // Confirm the account is the central NGO counsellor before showing anything.
        try{await api('/admin/overview')}catch(x){if(x.status===403){const rt=S.refresh_token,t=S.token;S=null;save();clearDrafts();revoke(t,rt);return denied()}throw x}
        location.hash='#/dashboard';route()}catch(x){b.disabled=false;const el=$('#e');if(el)el.textContent=errText(x)}}};
  stepEmail()}
function denied(){$('#lbox').innerHTML=`<h2>Access denied</h2><p>This account is not the central NGO counsellor, so it cannot use the NGO portal.</p><button onclick="LOGIN_EMAIL='';login()">Back to sign in</button>`}
