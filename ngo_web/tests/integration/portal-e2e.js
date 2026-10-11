// End-to-end run: the REAL ngo_web source in jsdom  ->  HTTP  ->  the REAL backend (routes, middleware, controllers, services),
// backed by the backend test-harness's in-memory database (PostgreSQL is not available in this environment).
const fs=require('fs'),path=require('path'),{JSDOM}=require('jsdom');
const PUB=process.env.PORTAL_PUBLIC||path.join(__dirname,'..','..','public')+path.sep;
const {h,app}=require('./rig');const seed=require('./seed');
const API='http://localhost:3000/api',ORIGIN='http://localhost:5173',db=h.fakeDb;
const results=[],log=[];let S;
const ok=(name,cond,extra='')=>{results.push([!!cond,name,extra]);console.log((cond?'PASS ':'FAIL ')+name+(extra&&!cond?'  -> '+extra:''))};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function mkPortal(cfg={}){
  const dom=new JSDOM(fs.readFileSync(PUB+'index.html','utf8').replace(/<script[^>]*><\/script>/g,''),{url:ORIGIN+'/',runScripts:'dangerously',pretendToBeVisual:true});
  const w=dom.window,reqs=[];
  w.fetch=async(u,o={})=>{const hd=o.headers||{};reqs.push({m:o.method||'GET',u,auth:!!(hd.Authorization),p:u.replace(API,'').split('?')[0]});
    const r=await fetch(u,{...o,headers:{...hd,Origin:ORIGIN}});const t=await r.text();if(!r.ok&&process.env.DBG)console.log('   HTTP',r.status,o.method||'GET',u.replace(API,''),t.slice(0,160));return{ok:r.ok,status:r.status,json:async()=>t?JSON.parse(t):{}}};
  w.confirm=()=>true;w.alert=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.opened=[];w.open=(u)=>{const o={location:'',close(){}};w.opened.push(o);return o};
  const addScript=t=>{const e=w.document.createElement('script');e.textContent=t;w.document.body.appendChild(e)};
  addScript('window.SAATHI_CONFIG='+JSON.stringify({API_BASE_URL:API,...cfg}));
  for(const f of ['core','patients','operations','admin'])addScript(fs.readFileSync(PUB+f+'.js','utf8'));
  const P={w,reqs,d:w.document,
    text:s=>((P.d.querySelector(s||'#main')||{}).textContent||'').replace(/\s+/g,' ').trim(),
    go:async(hash,ms=350)=>{w.location.hash=hash;await sleep(ms)},
    click:async(label,scope='#main',ms=350)=>{const b=[...P.d.querySelectorAll(scope+' button, '+scope+' a')].find(x=>x.textContent.trim()===label||x.textContent.trim().startsWith(label));if(!b)throw new Error('no button '+label);b.click();await sleep(ms)},
    has:(label,scope='#main')=>[...P.d.querySelectorAll(scope+' button, '+scope+' a')].some(x=>x.textContent.trim().startsWith(label)),
    submit:async(sel,ms=350)=>{P.d.querySelector(sel).dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));await sleep(ms)},
    set:(sel,v)=>{P.d.querySelector(sel).value=v},
    login:async(email)=>{await db.authotp.deleteMany({where:{email}});await P.go('#/login',100);w.eval('LOGIN_EMAIL=""');w.eval('login()');P.set('#em',email);await P.submit('#lf');const otp=global.OTPS[email];P.set('#otp',otp);await P.submit('#lf',700)}};
  return P}
const nonAuth=['/auth/request-otp','/auth/verify-otp','/auth/refresh'];
(async()=>{
  S=await seed(h);h.storage.files.add('PLACEHOLDER');const srv=app.listen(3000);
  // ---- CORS
  let r=await fetch(API+'/admin/overview',{method:'OPTIONS',headers:{Origin:ORIGIN,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization'}});
  ok('CORS: portal origin allowed in preflight',r.headers.get('access-control-allow-origin')===ORIGIN,String(r.headers.get('access-control-allow-origin')));
  r=await fetch(API+'/admin/overview',{method:'OPTIONS',headers:{Origin:'http://evil.example','Access-Control-Request-Method':'GET'}});
  ok('CORS: unknown origin not allowed',r.headers.get('access-control-allow-origin')!=='http://evil.example');

  // ---- login failures + non-NGO account
  let P=await mkPortal();await P.go('#/dashboard',100);
  ok('unauthenticated visit shows login',!!P.d.querySelector('#lf'));
  await P.go('#/login',100);P.set('#em','counsellor@saathi.test');await P.submit('#lf');P.set('#otp','000000');await P.submit('#lf',500);
  ok('wrong OTP shows backend error and no session',/Invalid OTP/i.test(P.text('.login'))&&!P.w.sessionStorage.getItem('saathi.session'),P.text('.login'));
  const P2=await mkPortal();
  await P2.login(S.a.owner.email);
  ok('non-NGO account sees Access denied and holds no session',/Access denied/.test(P2.text('.login'))&&!P2.w.sessionStorage.getItem('saathi.session'),P2.text('.login'));

  // ---- real login
  await P.login('counsellor@saathi.test');
  ok('OTP login reaches dashboard',/Good (morning|afternoon|evening), Asha/.test(P.text()),P.text().slice(0,80));
  ok('session kept in sessionStorage only (not localStorage)',!!P.w.sessionStorage.getItem('saathi.session')&&!P.w.localStorage.getItem('saathi.session'));

  // ---- dashboard
  const ov=(await (await fetch(API+'/admin/overview',{headers:{Authorization:'Bearer '+JSON.parse(P.w.sessionStorage.getItem('saathi.session')).token}})).json()).data;
  await P.go('#/dashboard');const dt=P.text();
  ok('dashboard metrics equal /admin/overview',dt.includes(ov.total_patients+'Total patients')&&dt.includes(ov.active_alerts+'Active alerts')&&dt.includes(ov.documents_awaiting_verification+'Documents to verify'),dt.slice(0,260));
  ok('dashboard has no "missed check-ins" metric',!/missed check-?ins?\s*\d/i.test(dt)&&!/Missed check-ins$/i.test(dt.replace(/Missed check-ins are not shown[^.]*\./,'')));

  // ---- patients
  await P.go('#/patients');
  ok('patient list shows all patients',(P.text().match(/Kulkarni|Patil/g)||[]).length>=3,P.text().slice(0,200));
  ok('duplicate name+DOB flagged',(P.text().match(/Possible duplicate/g)||[]).length===2);
  P.set('#ps','Ramesh');await P.click('Search');
  ok('search sends search param and filters',P.reqs.some(q=>/search=Ramesh/.test(q.u))&&/Ramesh/.test(P.text('#plist'))&&!/Kulkarni/.test(P.text('#plist')),P.text('#plist').slice(0,120)+' reqs:'+P.reqs.filter(q=>/search/.test(q.u)).length);
  await P.go('#/patients/'+S.a.patient.id,600);
  ok('patient workspace renders backend sections',/Meera Kulkarni's care/.test(P.text())&&/Medications/.test(P.text())&&/Care circle/.test(P.text())&&/Consent history/.test(P.text()));
  ok('symptom chart drawn from real observations',!!P.d.querySelector('#main svg[aria-label*="symptom"]'));
  // edit profile: required language
  await P.click('Edit →');P.set('#e-preferred_language','');await P.submit('#pe');
  ok('clearing preferred language is refused with a message',/Preferred language is required/.test(P.text('#pe-e')),'err='+P.text('#pe-e')+' form='+!!P.d.querySelector('#pe')+' hidden='+(P.d.querySelector('#pe')||{}).hidden);
  P.set('#e-preferred_language','mr');P.set('#e-cancer_stage','III');await P.submit('#pe',700);
  ok('profile PATCH persisted by backend',db.patient._rows().find(x=>x.id===S.a.patient.id).cancer_stage==='III');
  ok('profile update audited',h.auditActions().some(a=>/PATIENT/.test(a)),h.auditActions().join(','));
  // case note + draft handling
  await P.go('#/patients/'+S.a.patient.id,600);
  P.set('#nt','Phone call with family.');P.d.querySelector('#nt').dispatchEvent(new P.w.Event('input',{bubbles:true}));
  ok('case-note draft kept in sessionStorage only',!!P.w.sessionStorage.getItem('draft:'+S.a.patient.id)&&!P.w.localStorage.getItem('draft:'+S.a.patient.id));
  await P.submit('#main form[onsubmit^="addNote"]',700);
  ok('case note saved by backend and draft removed',db.patientcasenote._rows().length===1&&!P.w.sessionStorage.getItem('draft:'+S.a.patient.id));
  // unsaved draft is wiped by logout (checked later)

  // ---- alerts
  await P.go('#/alerts',500);
  ok('alert list shows help request as user-sent and automatic one',/Help Now request \(sent by user\)/.test(P.text())&&/automatic/.test(P.text()));
  await P.go('#/alerts/'+S.help.id,500);
  ok('help request: only a forward action, no cancel',P.has('Acknowledge')&&!/cancel/i.test(P.d.querySelector('#main').innerHTML.replace(/Help Now request can only be cancelled by the person who sent it\./,'')));
  await P.click('Acknowledge',null?'#main':'#main',700);
  ok('OPEN -> ACKNOWLEDGED persisted',db.alert._rows().find(x=>x.id===S.help.id).status==='ACKNOWLEDGED',db.alert._rows().find(x=>x.id===S.help.id).status+' | '+P.text().slice(0,200));
  // backend rejects: change status behind the UI, then click stale button
  db.alert._rows().find(x=>x.id===S.help.id).status='RESOLVED';
  P.d.querySelectorAll('.toast').forEach(t=>t.remove());
  await P.click('Start working on it',  '#main',700);
  const tl=[...P.d.querySelectorAll('.toast')].map(t=>t.textContent);
  ok('rejected transition shows error, no success toast',/\S/.test(P.text('#s-e'))&&!tl.some(t=>/Alert updated/.test(t)),P.text('#s-e')+' | '+tl.join(';'));
  db.alert._rows().find(x=>x.id===S.help.id).status='ACKNOWLEDGED';
  await P.go('#/alerts/'+S.help.id,500);await P.click('Start working on it','#main',700);await P.click('Mark resolved','#main',700);
  ok('IN_PROGRESS -> RESOLVED persisted, no further actions',db.alert._rows().find(x=>x.id===S.help.id).status==='RESOLVED'&&!P.has('Mark resolved'));
  P.set('#an','Called the family.');await P.submit('#main form[onsubmit^="addAlertNote"]',600);
  ok('timeline note added',/Called the family/.test(P.text()));
  ok('status changes audited',h.auditActions().filter(a=>/ALERT/.test(a)).length>=3);

  // ---- caregivers
  await P.go('#/caregivers',500);
  ok('caregiver list from backend',/kavya/.test(P.text())&&/rohit/.test(P.text()),P.text('#cg').slice(0,300));
  const linkBefore=JSON.stringify(db.patientcaregiverlink._rows());
  await P.click('Recognise','#cg',700);
  ok('recognition persisted',db.caregiverprofile._rows().some(x=>x.ngo_recognition_status==='RECOGNIZED'));
  ok('recognition does not touch patient-caregiver links',linkBefore===JSON.stringify(db.patientcaregiverlink._rows()));

  // ---- documents
  await P.go('#/documents',600);
  ok('document queue lists pending doc with patient',/Blood test/.test(P.text())&&/Meera Kulkarni/.test(P.text()));
  await P.click('View','#rdocs',700);
  ok('signed URL requested and opened (no storage path shown)',P.reqs.some(q=>/file-url/.test(q.u))&&P.w.opened.length===1&&/^https:\/\/signed\.test\//.test(P.w.opened[0].location)&&!/private\//.test(P.d.body.innerHTML),JSON.stringify(P.w.opened.map(o=>o.location))+' reqs:'+P.reqs.filter(q=>/file-url/.test(q.u)).length+' '+P.text('#rdocs').slice(0,200));
  await P.click('Verify','#rdocs',700);
  ok('document VERIFIED with verifier recorded',db.medicaldocument._rows()[0].verification_status==='VERIFIED'&&!!db.medicaldocument._rows()[0].verified_by);
  ok('verification audited',h.auditActions().some(a=>/DOCUMENT/.test(a)));

  // ---- care events
  await P.go('#/care-events',700);P.set('#cr2','7');await P.click('Show','#main',700);
  ok('overdue care event listed with patient link',/Overdue/.test(P.text())&&/Meera Kulkarni/.test(P.text()),P.text().slice(0,200));
  await P.click('Done','#revs',700);
  ok('care event marked COMPLETED',db.careevent._rows()[0].completion_status==='COMPLETED');

  // ---- create patient + claim code + claim by patient
  await P.go('#/patients');await P.click('+ Add patient record');
  P.set('#n-full_name','Sunita Deshmukh');P.set('#n-date_of_birth','1975-05-05');P.set('#n-cancer_type','Cervical');await P.submit('#np',900);
  ok('patient record created through admin API',/Sunita Deshmukh's care/.test(P.text()),P.text().slice(0,100));
  await P.click('Generate code','#main',700);
  const code=(P.text('#ccode')||'').trim();
  ok('claim code displayed once',/^[A-F0-9]{8}$/.test(code),code);
  ok('code is not shown in any audit payload',!JSON.stringify(db.auditlogentry._rows()).includes(code));
  // patient side (as the Flutter app would)
  const pe='sunita.new@test.dev';let rr=await fetch(API+'/auth/request-otp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:pe})});
  rr=await fetch(API+'/auth/verify-otp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:pe,otp:global.OTPS[pe]})});const pj=await rr.json();
  const claim=await fetch(API+'/patients/claim',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+pj.token},body:JSON.stringify({code})});
  ok('patient claims record with the code (201)',claim.status===201,String(claim.status));
  const again=await fetch(API+'/patients/claim',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+pj.token},body:JSON.stringify({code})});
  ok('same code cannot be reused',again.status>=400,String(again.status));
  const pid=P.w.location.hash.split('/')[2];await P.go('#/patients',500);await P.go('#/patients/'+pid,800);
  ok('portal then shows the patient\'s registered email and no code card',P.text().includes(pe)&&!P.has('Generate code'),P.text().slice(0,300));

  // ---- chat
  await P.go('#/patients/'+S.a.patient.id,700);
  await P.click('Message','#main',900);
  ok('Message opens a real conversation',/^#\/messages\//.test(P.w.location.hash),P.w.location.hash);
  P.set('#mt','Namaste, how are you today?');await P.submit('#main form',700);
  ok('message sent and stored',db.chatmessage._rows().some(m=>m.content==='Namaste, how are you today?'));
  await P.go('#/patients/'+S.b.patient.id,700);await P.click('Message','#main',900);
  await P.go('#/messages',800);
  const convs=db.chatconversation._rows(),names=Object.fromEntries(db.patient._rows().map(x=>[x.id,x.full_name]));
  const items=[...P.d.querySelectorAll('.conv')].map(x=>x.textContent);
  ok('every conversation labelled with its own patient',convs.length===2&&convs.every(c=>items.some(t=>t.includes('About '+names[c.patient_id]))),items.join(' | '));
  ok('Ramesh thread not labelled Meera',items.some(t=>t.includes('About Ramesh Patil'))&&items.filter(t=>t.includes('About Meera')).length===1);

  // ---- community
  await P.go('#/community/moderation',700);
  ok('moderation queue with report',/Walking helps/.test(P.text())&&/Check the health claim/.test(P.text()));
  await P.click('Mark reviewed','#main',700);
  ok('report reviewed',db.communityreport._rows()[0].status!=='OPEN');
  P.set('#f'+db.communitypost._rows()[0].id,'');await P.click('Reject','#main',500);
  ok('reject without feedback is refused client-side',db.communitypost._rows()[0].status==='PENDING');
  await P.click('Approve','#main',700);
  ok('post approved',db.communitypost._rows()[0].status==='APPROVED');
  await P.go('#/community/feed',700);
  ok('approved post appears in the public feed (author_name field)',/Walking helps/.test(P.text()),P.text().slice(0,160));

  // ---- check-in form
  await P.go('#/forms',600);await P.click('Start a draft','#main',700);
  await P.click('+ Add question','#main',300);
  P.set('#fk','pain_today');P.set('#ft','SCALE');P.d.querySelector('#ft').dispatchEvent(new P.w.Event('change'));P.set('#fl','How is your pain today?');await P.submit('#ff form',700);
  ok('draft field saved',/How is your pain today/.test(P.text()),P.text().slice(0,200));
  await P.click('Publish draft','#main',800);
  ok('form published (immutable version)',db.checkinformversion._rows().some(v=>v.status==='PUBLISHED'));
  const cur=await (await fetch(API+'/admin/check-in-forms/current',{headers:{Authorization:'Bearer '+JSON.parse(P.w.sessionStorage.getItem('saathi.session')).token}})).json();
  ok('published version served by current endpoint',cur.data.published&&cur.data.published.fields.length===1);

  // ---- audit
  await P.go('#/audit',700);
  ok('audit log lists actions (read-only, no edit controls)',/ALERT_STATUS_CHANGED|DOCUMENT_VERIFICATION_CHANGED/.test(P.text())&&!P.has('Delete'));

  // ---- sessions: refresh, expiry, 403
  const sess=JSON.parse(P.w.sessionStorage.getItem('saathi.session'));
  sess.token='not-a-valid-token';P.w.sessionStorage.setItem('saathi.session',sess&&JSON.stringify(sess));P.w.eval('S=JSON.parse(sessionStorage.getItem("saathi.session"))');
  const before=P.reqs.length;await P.go('#/dashboard',900);
  ok('expired access token: 401 -> /auth/refresh -> retry succeeds',P.reqs.slice(before).some(q=>q.p==='/auth/refresh')&&/Total patients/.test(P.text()));
  P.w.eval('S.token="bad";S.refresh_token="bad";sessionStorage.setItem("saathi.session",JSON.stringify(S))');
  await P.go('#/patients',900);
  ok('dead session: forced back to login with notice, no data left on screen',!!P.d.querySelector('#lf')&&/expired/i.test(P.text('.login'))&&!/Kulkarni/.test(P.d.body.textContent),P.text('.login').slice(0,120)+' | '+(/Kulkarni/.test(P.d.body.textContent)));
  // logout wipes drafts + revokes refresh token
  await P.login('counsellor@saathi.test');
  const t1=JSON.parse(P.w.sessionStorage.getItem('saathi.session'));
  P.w.sessionStorage.setItem('draft:'+S.a.patient.id,'unsaved clinical text');
  await P.go('#/dashboard',500);P.w.eval('logout()');await sleep(600);
  ok('logout clears unsaved drafts and session',!P.w.sessionStorage.getItem('draft:'+S.a.patient.id)&&!P.w.sessionStorage.getItem('saathi.session'));
  const rf=await fetch(API+'/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:t1.refresh_token})});
  ok('logout revoked the refresh token on the server',rf.status===401||rf.status===403,String(rf.status));
  // idle timeout
  const P3=await mkPortal({IDLE_TIMEOUT_MINUTES:0.03});await P3.login('counsellor@saathi.test');
  P3.w.sessionStorage.setItem('draft:x','secret');await sleep(2400);
  ok('inactivity timeout signs out, clears drafts, explains why',!!P3.d.querySelector('#lf')&&/inactivity/.test(P3.text('.login'))&&!P3.w.sessionStorage.getItem('draft:x')&&!P3.w.sessionStorage.getItem('saathi.session'),P3.text('.login').slice(0,100)+' | '+P3.text().slice(0,80));

  // ---- header / origin audit over everything the portal sent
  const all=[...P.reqs,...P3.reqs];
  ok('every protected request carried the Bearer header',all.filter(q=>!nonAuth.includes(q.p)).every(q=>q.auth),all.filter(q=>!nonAuth.includes(q.p)&&!q.auth).map(q=>q.p).join(','));
  ok('portal only talked to the Saathi API origin',all.every(q=>q.u.startsWith(API)));
  ok('no request used a URL-derived or malformed id',all.every(q=>!/undefined|null|%27|'/.test(q.p)));
  ok('portal made no calls to removed/unsupported endpoints',all.every(q=>!/account-links|\/hide|\/flags|\/emergencies|\/api\/login/.test(q.u)));
  const fail=results.filter(x=>!x[0]);console.log(`\n${results.length-fail.length}/${results.length} checks passed`);
  fs.writeFileSync('e2e-results.json',JSON.stringify({total:results.length,passed:results.length-fail.length,results},null,1));
  srv.close();process.exit(fail.length?1:0)
})().catch(e=>{console.error('RUNNER ERROR',e);process.exit(2)});
