/* Check-in form manager, audit log, router */
const FTYPES=['TEXT','LONG_TEXT','NUMBER','SCALE','BOOLEAN','SINGLE_CHOICE','MULTI_CHOICE'],CHOICE=['SINGLE_CHOICE','MULTI_CHOICE'];
let FORM=null,EDIT=null;
const cfgText=f=>{const c=f.validation_config||{};const b=Object.entries(c).map(([k,v])=>`${k.replace(/_/g,' ')}: ${v}`);return b.join(' · ')};
const fieldRow=(f,ed)=>`<div class="field"><div class="row"><b>${esc(f.label)}</b>${tag(f.field_type)}${f.is_required?tag('Required','warn'):''}<span class="mono meta">${esc(f.field_key)}</span>${ed?`<span class="grow"></span><button class="out" onclick="editField('${U(f.id)}')">Edit</button><button class="red" onclick="removeField('${U(f.id)}')">Remove</button>`:''}</div>${f.help_text?`<div class="sub">${esc(f.help_text)}</div>`:''}${cfgText(f)?`<div class="sub">${esc(cfgText(f))}</div>`:''}${(f.options||[]).length?`<div class="sub">Options: ${f.options.map(o=>esc(o.label)).join(' · ')}</div>`:''}</div>`;
async function forms(){shell(skel,'/forms');try{const r=await api('/admin/check-in-forms/current');FORM=r.data;renderForms()}catch(e){main(stateErr(e,()=>forms()))}}
function renderForms(){const{published:pub,draft}=FORM;
  main(head("Today's check-in form",'Questions patients answer in the Dost app. Published versions never change; edit a draft, then publish it.')+
  sec(`Published ${pub?'· version '+pub.version_number:''}`,pub?`<small>Published ${fmtDT(pub.published_at)}</small>`:'')+`<div class="card">${pub?pub.fields.map(f=>fieldRow(f,false)).join('')||empty('This version has no questions.'):empty('Nothing is published yet, so patients see the default check-in.')}</div>`+
  sec(draft?`Draft · version ${draft.version_number}`:'Draft')+(draft?`<div class="card">${draft.fields.map(f=>fieldRow(f,true)).join('')||empty('The draft has no questions yet.')}<div class="row2"><button class="out" onclick="EDIT={};renderForms()">+ Add question</button><button class="green" onclick="publishDraft()">Publish draft</button></div></div>${EDIT?fieldForm(EDIT,draft):''}`:`<div class="card"><p>To change the form, start a draft. It begins as a copy of the published version, and patients do not see it until you publish.</p><button onclick="newDraft()">Start a draft</button></div>`))}
async function newDraft(){try{await api('/admin/check-in-forms/drafts',{body:{}});toast('Draft ready.');forms()}catch(x){toast(errText(x),1)}}
function editField(id){EDIT=FORM.draft.fields.find(f=>f.id===id);renderForms();$('#ff').scrollIntoView({behavior:'smooth'})}
function fieldForm(f,draft){const isNew=!f.id,c=f.validation_config||{},t=f.field_type||'TEXT';
  return`<div class="card" id="ff"><h3 class="ct">${isNew?'Add a question':'Edit question'}</h3><form onsubmit="saveField(event)"><div class="form2">
  <div><label for="fk">Key (identifies the question across versions)</label><input id="fk" value="${esc(f.field_key||'')}" ${isNew?'':'disabled'} pattern="[a-z][a-z0-9_]{0,63}" placeholder="e.g. sleep_hours" required></div>
  <div><label for="ft">Answer type</label><select id="ft" ${isNew?'':'disabled'} onchange="typeChanged()">${FTYPES.map(x=>`<option value="${x}" ${x===t?'selected':''}>${human(x)}</option>`).join('')}</select></div>
  <div class="full"><label for="fl">Question</label><input id="fl" value="${esc(f.label||'')}" maxlength="255" required></div>
  <div class="full"><label for="fh">Help text (optional)</label><input id="fh" value="${esc(f.help_text||'')}" maxlength="1000"></div>
  <div class="full" id="fcfg"></div><div class="full" id="fopt"><label for="fo">Options (one per line, at least 2)</label><textarea id="fo" rows="4">${esc((f.options||[]).map(o=>o.label).join('\n'))}</textarea></div>
  <div><label class="chk"><input type="checkbox" id="fr" style="width:auto" ${f.is_required?'checked':''}> Required</label></div></div>
  <p class="err" id="ff-e" role="alert"></p><div class="row"><button>${isNew?'Add to draft':'Save changes'}</button><button type="button" class="out" onclick="EDIT=null;renderForms()">Cancel</button></div></form></div>`}
function typeChanged(){const t=$('#ft').value,c=(EDIT&&EDIT.validation_config)||{},n=(k,l,v)=>`<div><label for="c-${k}">${l}</label><input id="c-${k}" type="number" value="${v??''}"></div>`;
  $('#fopt').hidden=!CHOICE.includes(t);
  $('#fcfg').innerHTML=t==='TEXT'||t==='LONG_TEXT'?`<div class="form2">${n('max_length','Max length',c.max_length)}</div>`:t==='NUMBER'?`<div class="form2">${n('min','Minimum',c.min)}${n('max','Maximum',c.max)}<div><label for="c-unit">Unit</label><input id="c-unit" value="${esc(c.unit||'')}" maxlength="20"></div><div><label class="chk"><input type="checkbox" id="c-integer" style="width:auto" ${c.integer?'checked':''}> Whole numbers only</label></div></div>`:t==='SCALE'?`<div class="form2">${n('min','Scale starts at',c.min??0)}${n('max','Scale ends at',c.max??10)}</div>`:t==='MULTI_CHOICE'?`<div class="form2">${n('min_selections','Minimum selections',c.min_selections)}${n('max_selections','Maximum selections',c.max_selections)}</div>`:''}
const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,64);
async function saveField(e){e.preventDefault();const f=EDIT,isNew=!f.id,t=isNew?$('#ft').value:f.field_type,num=k=>{const el=$('#c-'+k);return el&&el.value!==''?Number(el.value):undefined},cfg={};
  if(t==='TEXT'||t==='LONG_TEXT'){if(num('max_length')!==undefined)cfg.max_length=num('max_length')}
  else if(t==='NUMBER'){['min','max'].forEach(k=>{if(num(k)!==undefined)cfg[k]=num(k)});if($('#c-unit').value.trim())cfg.unit=$('#c-unit').value.trim();if($('#c-integer').checked)cfg.integer=true}
  else if(t==='SCALE'){cfg.min=num('min')??0;cfg.max=num('max')??10}
  else if(t==='MULTI_CHOICE'){['min_selections','max_selections'].forEach(k=>{if(num(k)!==undefined)cfg[k]=num(k)})}
  const body={label:$('#fl').value.trim(),help_text:$('#fh').value.trim()||null,is_required:$('#fr').checked,validation_config:cfg};
  if(CHOICE.includes(t)){const old=Object.fromEntries((f.options||[]).map(o=>[o.label,o.option_value])),used=new Set();
    body.options=$('#fo').value.split('\n').map(s=>s.trim()).filter(Boolean).map((l,i)=>{let v=old[l]||slug(l)||'option',b=v,k=2;while(used.has(v))v=b+'_'+k++;used.add(v);return{option_value:v,label:l,display_order:i+1}})}
  try{if(isNew){body.field_key=$('#fk').value.trim();body.field_type=t;await api(`/admin/check-in-forms/${FORM.draft.id}/fields`,{body})}else await api('/admin/check-in-fields/'+f.id,{method:'PATCH',body});
    EDIT=null;toast('Draft saved.');forms()}catch(x){$('#ff-e').textContent=errText(x)}}
async function removeField(id){if(!confirm('Remove this question from the draft? Past answers and earlier versions are kept.'))return;try{await api('/admin/check-in-fields/'+id,{method:'DELETE'});toast('Removed from draft.');forms()}catch(x){toast(errText(x),1)}}
async function publishDraft(){if(!confirm('Publish this version? Patients will see it in the app, and it cannot be edited afterwards (you can start a new draft).'))return;try{await api(`/admin/check-in-forms/${FORM.draft.id}/publish`,{body:{}});toast('New version published.');forms()}catch(x){toast(errText(x),1)}}
const _rf=renderForms;renderForms=function(){_rf();if(EDIT)typeChanged()};

/* ---------- audit log (read-only) ---------- */
let UQ={page:1,action:'',target_resource:'',target_id:'',from:'',to:''};
async function audit(){shell(skel,'/audit');
  main(head('Audit log','A read-only record of important actions in Dost.')+`<div class="card"><div class="row">${[['action','Action e.g. ALERT_STATUS_CHANGED'],['target_resource','Resource e.g. alert']].map(([k,p])=>`<input id="u-${k}" placeholder="${p}" value="${esc(UQ[k])}" aria-label="${p}">`).join('')}<input id="u-target_id" placeholder="Target ID (UUID)" value="${esc(UQ.target_id)}" aria-label="Target id" style="min-width:280px"><label class="chk" style="margin:0">From <input id="u-from" type="date" value="${esc(UQ.from)}"></label><label class="chk" style="margin:0">To <input id="u-to" type="date" value="${esc(UQ.to)}"></label><button class="out" onclick="applyAudit()">Filter</button><button class="out" onclick="UQ={page:1,action:'',target_resource:'',target_id:'',from:'',to:''};audit()">Clear</button></div></div><div id="alog">${skel}</div>`);loadAudit()}
function applyAudit(){['action','target_resource','target_id','from','to'].forEach(k=>UQ[k]=$('#u-'+k).value.trim());UQ.page=1;loadAudit()}
async function loadAudit(){const el=$('#alog');el.innerHTML=skel;try{const r=await api('/admin/audit-logs'+qs({...UQ,limit:25}));
  el.innerHTML=`<div class="card" style="overflow:auto"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Resource</th><th>Details</th></tr></thead><tbody>${r.data.map(l=>`<tr><td>${esc(fmtDT(l.created_at))}</td><td>${esc(l.actor?uname(l.actor):'System')}</td><td><span class="mono">${esc(l.action)}</span></td><td>${esc(l.target_resource)}<br><span class="mono meta">${esc(String(l.target_id).slice(0,8))}…</span></td><td style="white-space:normal;text-align:left">${l.payload?`<details><summary>View</summary><pre class="mono pre">${esc(JSON.stringify(l.payload,null,2))}</pre></details>`:'—'}</td></tr>`).join('')||`<tr><td colspan="5">${empty('No log entries match.')}</td></tr>`}</tbody></table></div>${pager(r.pagination,'goUPage')}`}catch(e){el.innerHTML=stateErr(e,()=>loadAudit())}}
const goUPage=n=>{UQ.page=n;loadAudit()};


/* ---------- global review pages (server-side paginated endpoints; nothing is scanned or capped in the browser) ---------- */
const noEndpoint=(e,what)=>e&&e.status===404?Object.assign(e,{message:what+' is not available on this server. The backend must provide the paginated admin endpoint.'}):e;
let DQ={page:1};
async function documentsReview(){shell(skel,'/documents');
  main(head('Document review','Documents waiting for verification, oldest first')+'<div id="rdocs">'+skel+'</div>');loadDocs()}
async function loadDocs(){const el=$('#rdocs');el.innerHTML=skel;
  try{const r=await api('/admin/documents'+qs({verification_status:'PENDING',page:DQ.page,limit:20}));
    if(!r.data.length&&DQ.page>1){DQ.page=Math.max(1,(r.pagination&&r.pagination.total_pages)||1);return loadDocs()}
    el.innerHTML=`<div class="card list">${r.data.map(x=>{const p=x.patient||{};return`<div class="lrow">${tile('doc')}<div class="grow"><b>${esc(x.title||'Document')}</b><div class="sub">${p.id?`<a class="back" href="#/patients/${U(p.id)}">${esc(p.full_name)}</a>`:'Patient unavailable'} · ${esc(human(x.document_type))} · uploaded ${esc(fmtD(x.uploaded_at))}${x.is_private?' · Private':''}</div></div><button class="out" onclick="openFile('documents','${U(x.id)}')">View</button><button class="green" onclick="revDoc('${U(x.id)}','VERIFIED')">Verify</button><button class="red" onclick="revDoc('${U(x.id)}','REJECTED')">Reject</button></div>`}).join('')||empty('No documents are waiting for verification.')}</div>${pager(r.pagination,'goDocPage')}`}
  catch(e){el.innerHTML=stateErr(noEndpoint(e,'The document review queue'),loadDocs)}}
const goDocPage=n=>{DQ.page=n;loadDocs()};
async function revDoc(id,s){if(s==='REJECTED'&&!confirm('Mark this document as rejected?'))return;try{await api(`/documents/${id}/verify`,{method:'PATCH',body:{verification_status:s}});toast('Document marked '+human(s)+'.');loadDocs()}catch(x){toast(errText(x),1)}}

let EVQ={date:'',days:1,overdue:true,page:1};
async function careEventsPage(){shell(skel,'/care-events');if(!EVQ.date)EVQ.date=istToday();
  main(head('Care events','Scheduled care events across all patients (India time)')+`<div class="card"><div class="row"><label for="cd" style="margin:0">Date</label><input id="cd" type="date" value="${esc(EVQ.date)}" style="width:auto"><select id="cr2" aria-label="Range"><option value="1">That day</option><option value="7">That day and the 6 days before</option></select><label class="chk" style="margin:0"><input type="checkbox" id="co" style="width:auto" ${EVQ.overdue?'checked':''}> Overdue only</label><button class="out" onclick="EVQ.page=1;loadEvents(true)">Show</button></div></div><div id="revs"></div>`);$('#cr2').value=EVQ.days;loadEvents(false)}
async function loadEvents(read){if(read)EVQ={...EVQ,date:$('#cd').value||istToday(),days:Number($('#cr2').value),overdue:$('#co').checked};
  const el=$('#revs');el.innerHTML=skel;
  try{const to=EVQ.date,from=new Date(new Date(to+'T12:00:00+05:30').getTime()-(EVQ.days-1)*864e5).toLocaleDateString('en-CA',{timeZone:TZ});
    const r=await api('/admin/care-events'+qs({overdue:EVQ.overdue?'true':undefined,from,to,page:EVQ.page,limit:20}));
    el.innerHTML=`<div class="card list">${r.data.map(e=>evLine(e,e.patient)).join('')||empty(EVQ.overdue?'No overdue care events in this range.':'No care events in this range.')}</div>${pager(r.pagination,'goEvPage')}`}
  catch(e){el.innerHTML=stateErr(noEndpoint(e,'The care-event list'),()=>loadEvents(false))}}
const goEvPage=n=>{EVQ.page=n;loadEvents(false)};

/* ---------- router ---------- */
function route(){clearTimer();if(typeof cancelRec==='function')cancelRec();const h=location.hash.slice(1)||'/dashboard',[,a,b]=h.split('/');
  if(!S){if(a!=='login'){location.hash='#/login';return}return login()}
  if(a==='login'){location.hash='#/dashboard';return}
  if(b&&['patients','alerts','messages'].includes(a)&&!isUuid(b)){shell('<div class="card state"><h2>Not found</h2><p>That link is not valid.</p><a class="back" href="#/dashboard">Back to dashboard</a></div>','/'+a);return}
  const pages={'care-events':()=>careEventsPage(),documents:()=>documentsReview(),dashboard:()=>dashboard(),patients:()=>b?patientPage(b):patientsPage(),alerts:()=>b?alertDetail(b):alertsPage(),messages:()=>messages(b),community:()=>b==='moderation'?moderation():feed(),caregivers:()=>caregivers(),forms:()=>forms(),audit:()=>audit()};
  Promise.resolve((pages[a]||pages.dashboard)()).catch(e=>{console.error(e);if(S&&$('#main'))main(stateErr(e))})}
addEventListener('hashchange',route);
if(S&&!location.hash)location.hash='#/dashboard';
route();