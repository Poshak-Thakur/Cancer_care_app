/* Alerts, messages, caregiver recognition, community */
/* ---------- alerts ---------- */
const AF={active:{label:'Active',status:'OPEN,ACKNOWLEDGED,IN_PROGRESS'},resolved:{label:'Resolved',status:'RESOLVED'},closed:{label:'Cancelled / exhausted',status:'CANCELLED,ESCALATION_EXHAUSTED'},all:{label:'All',status:''}};
let AQ={f:'active',page:1};
async function alertsPage(){shell(skel,'/alerts');
  main(head('Alerts','Help requests and automatic alerts for all patients')+`<div class="seg">${Object.entries(AF).map(([k,v])=>`<button class="${AQ.f===k?'sel':''}" onclick="AQ={f:'${k}',page:1};alertsPage()">${v.label}</button>`).join('')}</div><div id="alist" style="margin-top:16px">${skel}</div>`);loadAlerts()}
async function loadAlerts(){const el=$('#alist');try{const r=await api('/admin/alerts'+qs({status:AF[AQ.f].status,page:AQ.page,limit:20}));
  el.innerHTML=`<div class="card list">${r.data.map(a=>`<div class="lrow" onclick="location.hash='#/alerts/${U(a.id)}'" tabindex="0" onkeydown="if(event.key==='Enter')this.click()">${tile('alert')}<div class="grow"><b>${esc(a.patient?a.patient.full_name:'Patient')}</b><div class="sub">${a.type==='HELP_REQUEST'?'Help Now request (sent by user)':esc(human(a.type))+' (automatic)'} · ${esc(fmtDT(a.created_at))}${a.latest_update?' · Latest: '+esc(String(a.latest_update.note||'').slice(0,60)):''}</div></div>${tag(a.severity,sevCls(a.severity))}${tag(a.status,a.status==='OPEN'?'alert':a.status==='RESOLVED'?'ok':'')}${chev}</div>`).join('')||empty('No alerts in this view.')}</div>${pager(r.pagination,'goAPage')}`}catch(e){el.innerHTML=stateErr(e,()=>loadAlerts())}}
const goAPage=n=>{AQ.page=n;loadAlerts()};
const NEXT={OPEN:['ACKNOWLEDGED','Acknowledge'],ACKNOWLEDGED:['IN_PROGRESS','Start working on it'],IN_PROGRESS:['RESOLVED','Mark resolved']};
let ALERT=null;
async function alertDetail(id){shell(skel,'/alerts');try{const r=await api('/admin/alerts/'+id);ALERT=r.data;renderAlert()}catch(e){main(stateErr(e,()=>alertDetail(id)))}}
function renderAlert(){const a=ALERT,nx=NEXT[a.status],p=a.patient||{};
  main(`<a class="back" href="#/alerts">‹ All alerts</a>`+head(`${a.type==='HELP_REQUEST'?'Help Now request':esc(human(a.type))}`,`${esc(p.full_name||'Patient')} · ${esc(fmtDT(a.created_at))}`)+
  `<div class="grid"><div class="card"><div class="row">${tag(a.status,a.status==='OPEN'?'alert':a.status==='RESOLVED'?'ok':'')}${tag(a.severity,sevCls(a.severity))}${tag(a.type==='HELP_REQUEST'?'Manual':'Automatic')}</div>
  <dl class="kv" style="margin-top:12px"><dt>Patient</dt><dd><a class="back" href="#/patients/${esc(a.patient_id)}">${esc(p.full_name||'Open record')}</a></dd>${p.cancer_type?`<dt>Diagnosis</dt><dd>${esc(p.cancer_type)}${p.cancer_stage?' · Stage '+esc(p.cancer_stage):''}</dd>`:''}${a.requested_by?`<dt>Requested by</dt><dd>${esc(uname(a.requested_by))}</dd>`:''}<dt>Last updated</dt><dd>${fmtDT(a.updated_at)}</dd></dl>
  ${a.source?`<h3 class="ct" style="margin-top:16px">Triggering check-in · ${esc(fmtDT(a.source.recorded_at))}</h3><div class="sub">${esc((a.source.symptomobservation||[]).map(o=>`${human(o.observation_type)}: ${obsVal(o)??'—'}${o.unit?' '+o.unit:''}`).join(' · ')||'No observations')}</div>`:''}</div>
  <div class="card"><h3 class="ct">Update status</h3>${nx?`<label for="sn">Note (optional)</label><textarea id="sn" rows="2"></textarea><p class="err" id="s-e" role="alert"></p><button onclick="setAlertStatus('${nx[0]}')">${nx[1]}</button><p class="meta">Alerts move one step at a time: Open → Acknowledged → In progress → Resolved.</p>`:`<p>${a.status==='RESOLVED'?'This alert is resolved.':'This alert was closed by the system or the requester and cannot be changed by staff.'}</p>`}
  ${a.type==='HELP_REQUEST'?'<small>A Help Now request can only be cancelled by the person who sent it.</small>':''}</div></div>`+
  sec('Timeline')+`<div class="card"><div class="tl">${(a.updates||[]).map(u=>`<div><b>${esc(human(u.type))}</b> <small>${esc(fmtDT(u.created_at))} · ${esc(uname(u.created_by_user))}</small><br><span class="pre">${esc(u.note)}</span></div>`).join('')||empty('No updates yet.')}</div>
  <form onsubmit="addAlertNote(event)"><label for="an">Add a note to the timeline</label><textarea id="an" rows="2" required></textarea><p class="err" id="an-e" role="alert"></p><button class="out">Add note</button></form></div>`+
  sec('Who was notified')+'<p class="meta">Push “Sent” means Firebase accepted it for the phone; it does not prove it was displayed. The web portal itself has no phone push, so this account is alerted by the portal’s alert badge, sound and desktop alert.</p>'+`<div class="card list">${(a.recipients||[]).map(r=>`<div class="lrow"><div class="grow"><b>${esc(uname(r.user))}</b><div class="sub">${(r.deliveries||[]).map(deliveryLine).join('<br>')||'No delivery record'}</div></div></div>`).join('')||empty('No recipients recorded.')}</div>`)}
async function setAlertStatus(s){try{await api(`/admin/alerts/${ALERT.id}/status`,{method:'PATCH',body:{status:s,note:$('#sn').value.trim()||undefined}});toast('Alert updated.');alertDetail(ALERT.id)}catch(x){$('#s-e').textContent=errText(x);if(x.code==='STALE_STATUS'||x.code==='INVALID_TRANSITION')setTimeout(()=>alertDetail(ALERT.id),1800)}}
async function addAlertNote(e){e.preventDefault();try{await api(`/admin/alerts/${ALERT.id}/updates`,{body:{note:$('#an').value}});toast('Note added.');alertDetail(ALERT.id)}catch(x){$('#an-e').textContent=errText(x)}}

/* ---------- messages (real conversation ids) ---------- */
const pn=c=>c.patient?c.patient.full_name:'Patient unavailable';
const ctx=c=>c.patient_id?'About '+esc(pn(c)):'Direct conversation';
const other=c=>c.participant_one&&c.participant_one.id===S.user.id?c.participant_two:c.participant_one;
async function messages(cid){shell(skel,'/messages');clearTimer();
  try{const r=await api('/chat/conversations');const list=r.data;cid=cid||(list[0]||{}).id;const cur=list.find(c=>c.id===cid);
    list.forEach(c=>{const o=other(c);if(o&&o.id)PEERS[o.id]=uname(o)});
    main(head('Messages','Conversations with patients, caregivers and delegates')+`<div class="chat"><div class="card list">${list.map(c=>{const o=other(c),m=c.messages&&c.messages[0];return`<div class="lrow conv ${c.id===cid?'on':''}" onclick="location.hash='#/messages/${U(c.id)}'" tabindex="0">${av(uname(o))}<div class="grow"><b>${esc(uname(o))}</b><div class="sub">${ctx(c)}</div><div class="sub clip">${m?esc(m.message_type==='TEXT'?m.content:'['+human(m.message_type)+']'):'No messages yet'}</div></div>${c.unread_count>0?`<span class="badge alert">${c.unread_count} new</span>`:''}</div>`}).join('')||empty('No conversations yet. Open a patient and press Message next to a family member or caregiver.')}</div><div class="card chatwrap" id="cpane">${cur?'':empty('Select a conversation.')}</div></div>`);
    if(cur)openConv(cur)}catch(e){main(stateErr(e,()=>messages(cid)))}}
function bubbles(ms,o){let last='';return ms.map(m=>{const dt=new Date(m.created_at).toDateString(),sep=dt!==last?`<div class="dchip">${esc(dt)}</div>`:'',tm=new Date(m.created_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});last=dt;
  const body=m.message_type==='IMAGE'&&m.media_url?`<img src="${esc(m.media_url)}" alt="Shared image">`:m.message_type==='AUDIO'&&m.media_url?`<audio controls preload="metadata" src="${esc(m.media_url)}"></audio>`:esc(m.content||'');
  if(m.message_type==='SYSTEM')return sep+`<div class="sys">${esc(m.content)}</div>`;
  return sep+(m.sender_id===S.user.id?`<div class="mrow me"><div><div class="bub c">${body}</div><small>${tm}</small></div></div>`:`<div class="mrow">${av(uname(o))}<div><div class="bub p">${body}</div><small>${tm}</small></div></div>`)}).join('')}
let CONV=null;
async function openConv(c){CONV=c;const o=other(c),pane=$('#cpane');
  pane.innerHTML=`<div class="chead">${av(uname(o))}<div><b class="big">${esc(uname(o))}</b><div class="sub">${ctx(c)} · <span id="plink"></span></div></div><span class="grow"></span><button class="out" onclick="callFromChat('AUDIO')">Voice call</button><button class="out" onclick="callFromChat('VIDEO')">Video call</button></div><div class="banner">${ic('shield',22)}<span>Keep messages about care. Avoid sharing full medical records in chat.</span></div><div class="msgs" id="ms">${skel}</div><div id="rec" hidden></div><form onsubmit="sendMsg(event)"><button type="button" class="out" id="micbtn" onclick="recStart()" aria-label="Record a voice note" title="Record a voice note">🎤</button><input id="mt" placeholder="Type a message…" aria-label="Message" autocomplete="off"><button class="sendbtn" aria-label="Send message">${ic('send')}</button></form>`;
  if(c.patient)$('#plink').innerHTML=`<a class="back" href="#/patients/${U(c.patient.id)}">Open patient</a>`;
  await refreshMsgs(true);clearTimer();TIMER=setInterval(()=>refreshMsgs(false),10000)}
async function refreshMsgs(scroll){const el=$('#ms');if(!el||!CONV)return;try{const r=await api('/chat/messages/'+CONV.id),near=el.scrollHeight-el.scrollTop-el.clientHeight<80;el.innerHTML=bubbles(r.data,other(CONV))||'<p class="meta">No messages yet. Say hello.</p>';if(scroll||near)el.scrollTop=el.scrollHeight}catch(x){if(scroll)el.innerHTML=stateErr(x,()=>refreshMsgs(true))}}
async function sendMsg(e){e.preventDefault();const t=$('#mt').value.trim();if(!t)return;$('#mt').value='';try{await api('/chat/send',{body:{conversation_id:CONV.id,content:t,message_type:'TEXT'}});refreshMsgs(true)}catch(x){$('#mt').value=t;toast(errText(x),1)}}

/* ---------- caregiver recognition ---------- */
let CQ={rec:'',type:'',search:'',page:1};
async function caregivers(){shell(skel,'/caregivers');
  main(head('Caregiver recognition','Decide which caregivers the NGO recognises')+`<div class="card"><p class="meta">Recognition is an NGO eligibility decision. It does not create, edit or remove any patient–caregiver link or consent. Removing recognition pauses a caregiver's access to patients; recognising again restores existing consented links.</p><div class="row"><select id="cr" aria-label="Recognition" onchange="CQ.rec=this.value;CQ.page=1;loadCg()"><option value="">All recognition states</option><option value="NOT_RECOGNIZED">Not recognised</option><option value="RECOGNIZED">Recognised</option></select><select id="ct" aria-label="Type" onchange="CQ.type=this.value;CQ.page=1;loadCg()"><option value="">All types</option><option value="FAMILY">Family</option><option value="VOLUNTEER">Volunteer</option></select><input id="cs" type="search" placeholder="Search name or email" aria-label="Search" onkeydown="if(event.key==='Enter'){CQ.search=this.value.trim();CQ.page=1;loadCg()}"><button class="out" onclick="CQ.search=$('#cs').value.trim();CQ.page=1;loadCg()">Search</button></div></div><div id="cg">${skel}</div>`);
  $('#cr').value=CQ.rec;$('#ct').value=CQ.type;$('#cs').value=CQ.search;loadCg()}
async function loadCg(){const el=$('#cg');el.innerHTML=skel;try{const r=await api('/admin/caregivers'+qs({recognition_status:CQ.rec,caregiver_type:CQ.type,search:CQ.search,page:CQ.page,limit:20}));
  el.innerHTML=`<div class="card list">${r.data.map(c=>{const ok=c.ngo_recognition_status==='RECOGNIZED';return`<div class="lrow">${av(uname(c.user))}<div class="grow"><b>${esc(uname(c.user))}</b><div class="sub">${esc(c.user&&c.user.email||'')}${c.user&&c.user.phone_number?' · '+esc(c.user.phone_number):''}</div></div>${tag(c.caregiver_type)}${tag(ok?'Recognised':'Not recognised',ok?'ok':'warn')}${ok?`<button class="out" onclick="recog('${U(c.user_id)}',false)">Remove recognition</button>`:`<button class="green" onclick="recog('${U(c.user_id)}',true)">Recognise</button>`}</div>`}).join('')||empty('No caregivers match these filters.')}</div>${pager(r.pagination,'goCgPage')}`}catch(e){el.innerHTML=stateErr(e,()=>loadCg())}}
const goCgPage=n=>{CQ.page=n;loadCg()};
async function recog(uid,v){if(!v&&!confirm('Remove NGO recognition? This pauses the caregiver\'s access to patients until recognised again. Their patient links are not deleted.'))return;try{const r=await api(`/admin/caregivers/${uid}/recognition`,{method:'PATCH',body:{recognized:v}});toast(r.message||'Updated.');loadCg()}catch(x){toast(errText(x),1)}}

/* ---------- community ---------- */
const media=(urls,type)=>(urls||[]).map(u=>type==='VIDEO'?`<video controls src="${esc(u)}" style="max-width:100%;border-radius:12px;margin-top:8px"></video>`:`<img src="${esc(u)}" alt="Post media" style="max-width:100%;max-height:320px;border-radius:12px;margin-top:8px">`).join('');
async function feed(){shell(skel,'/community/feed');
  try{const r=await api('/community/feed');main(head('Community feed','Approved public posts, newest first. Posts are removed from here through moderation.')+composer()+(r.data.map(p=>`<div class="card"><div class="prow">${av(p.author_name,'rose')}<div class="grow"><b>${esc(p.author_name)}</b><div class="sub">${esc(human(p.post_type))} · ${esc(fmtDT(p.created_at))}</div></div><span class="meta">♥ ${p.likes_count} · 💬 ${p.comments_count}</span></div><p class="pre">${esc(p.content)}</p>${media(p.media_urls,p.post_type)}${(p.poll_options||[]).length?`<div>${p.poll_options.map(o=>`<div class="sub">○ ${esc(o.option)} — ${o.votes} vote${o.votes===1?'':'s'}</div>`).join('')}</div>`:''}</div>`).join('')||'<div class="card">Nothing here yet.</div>'))}catch(e){main(stateErr(e,()=>feed()))}}
async function moderation(){shell(skel,'/community/moderation');
  try{const r=await api('/community/moderation-queue');
    main(head('Moderation queue','Posts waiting for review, private posts, and reported posts.')+(r.data.map(p=>`<div class="card"><div class="prow">${av(p.author&&p.author.email,'rose')}<div class="grow"><b>${esc(p.author?p.author.email.split('@')[0]:'User')}</b><div class="sub">${esc(human(p.post_type))} · ${esc(human(p.visibility))} · ${esc(fmtDT(p.created_at))}</div></div>${tag(p.status,p.status==='PENDING'?'warn':p.status==='REJECTED'?'alert':'ok')}</div><p class="pre">${esc(p.content)}</p>${media(p.media_urls,p.post_type)}
    ${(p.reports||[]).map(rp=>`<div class="flagbox" style="margin-top:12px"><b>Report</b> <small>${esc(fmtDT(rp.created_at))} · ${esc(uname(rp.reporter))}</small><p class="pre">${esc(rp.reason)}</p><div class="row"><input id="rn${rp.id}" placeholder="Note (optional)" aria-label="Report note" style="flex:1"><button class="out" onclick="rpt('${U(rp.id)}','REVIEWED')">Mark reviewed</button><button class="out" onclick="rpt('${U(rp.id)}','DISMISSED')">Dismiss</button></div></div>`).join('')}
    <label for="f${p.id}">Feedback to the author (required to reject or request changes)</label><textarea id="f${p.id}" rows="2">${esc(p.moderator_feedback||'')}</textarea><small>Approving, rejecting or requesting changes also closes any open reports on this post.</small>
    <div class="row2"><button class="green" onclick="mod('${U(p.id)}','APPROVED')">Approve</button><button class="out" onclick="mod('${U(p.id)}','PENDING')">Request revision</button><button class="red" onclick="mod('${U(p.id)}','REJECTED')">Reject</button></div></div>`).join('')||'<div class="card">The queue is empty. Thank you for keeping the community safe.</div>'))}catch(e){main(stateErr(e,()=>moderation()))}}
async function mod(id,s){const f=$('#f'+id).value.trim();if((s==='REJECTED'||s==='PENDING')&&!f){toast('Please write compassionate feedback for the author first.',1);return}
  try{await api(`/community/posts/${id}/moderate`,{method:'PATCH',body:{status:s,moderator_feedback:f||undefined}});toast(s==='APPROVED'?'Post approved.':s==='REJECTED'?'Post rejected.':'Revision requested.');moderation()}catch(x){toast(errText(x),1)}}
async function rpt(id,s){try{await api(`/community/reports/${id}/status`,{method:'PATCH',body:{status:s,moderator_note:$('#rn'+id).value.trim()||undefined}});toast('Report updated.');moderation()}catch(x){toast(errText(x),1)}}

/* NGO post composer (text, image, video, poll). Polls are NGO-only on the backend. */
const composer=()=>`<div class="card"><h3 class="ct">Share with the community</h3><form onsubmit="publishPost(event)"><div class="form2"><div><label for="pt">Type</label><select id="pt" onchange="postType()"><option value="TEXT">Text</option><option value="IMAGE">Images</option><option value="VIDEO">Video</option><option value="POLL">Poll</option></select></div><div><label for="pv">Visibility</label><select id="pv"><option value="PUBLIC">Public</option><option value="PRIVATE">Private</option></select></div><div class="full"><label for="pc">Message</label><textarea id="pc" rows="3"></textarea></div><div class="full" id="pm" hidden><label for="pf">Files (up to 5)</label><input id="pf" type="file" multiple></div><div class="full" id="po" hidden><label for="pp">Poll options (one per line, at least 2)</label><textarea id="pp" rows="3"></textarea></div></div><p class="err" id="pe2" role="alert"></p><button>Publish</button></form></div>`;
function postType(){const t=$('#pt').value;$('#pm').hidden=!(t==='IMAGE'||t==='VIDEO');$('#po').hidden=t!=='POLL';$('#pf').accept=t==='IMAGE'?'image/*':t==='VIDEO'?'video/*':''}
async function publishPost(e){e.preventDefault();const t=$('#pt').value,fd=new FormData();fd.append('post_type',t);fd.append('visibility',$('#pv').value);fd.append('content',$('#pc').value);
  if(t==='POLL')fd.append('poll_options',JSON.stringify($('#pp').value.split('\n').map(x=>x.trim()).filter(Boolean)));
  if(t==='IMAGE'||t==='VIDEO')[...$('#pf').files].forEach(f=>fd.append('media',f));
  try{const r=await api('/community/posts',{body:fd});toast(r.message||'Post published.');feed()}catch(x){$('#pe2').textContent=errText(x)}}

/* ---------- alert delivery wording (fields come from alertdelivery: channel, delivery_status, failure_reason, *_at) ---------- */
const FAIL_TEXT=r=>!r?'':r==='NO_DEVICE_TOKEN'?'no phone registered for notifications':r==='FIREBASE_NOT_INITIALIZED'?'server push is not configured':/^FCM_ERROR:/.test(r)?'rejected by Firebase ('+r.slice(10)+')':r;
const deliveryLine=d=>{const st=d.delivery_status,cls=st==='FAILED'?'alert':st==='SENT'||st==='DELIVERED'||st==='SEEN'?'ok':'warn',at=d.sent_at||d.failed_at||d.queued_at;
  return`${esc(human(d.channel||'PUSH'))}: ${tag(st,cls)}${d.failure_reason?' '+esc(FAIL_TEXT(d.failure_reason)):''}${at?` <small>${esc(fmtDT(at))}</small>`:''}`};

/* ---------- voice notes (record -> preview -> upload to /chat/upload-audio -> send as AUDIO message) ---------- */
let REC=null;const REC_MAX_S=300,AUDIO_MAX_BYTES=10*1024*1024;
const recMime=()=>{if(typeof MediaRecorder==='undefined')return'';return['audio/mp4;codecs=mp4a.40.2','audio/mp4','audio/webm;codecs=opus','audio/webm'].find(t=>{try{return MediaRecorder.isTypeSupported(t)}catch{return false}})||''};
const micState=async()=>{try{return(await navigator.permissions.query({name:'microphone'})).state}catch{return'unknown'}};
function micHelp(kind){const p=$('#rec');if(!p)return;p.hidden=false;
  const msg=kind==='blocked'?'<b>The microphone is blocked for this site.</b> Click the lock icon (🔒) next to the address bar → <b>Microphone → Allow</b>. Chrome only applies the change after you <b>reload this page</b>.'
    :kind==='none'?'<b>No microphone was found</b> on this computer. Plug one in or choose one in the browser’s site settings.'
    :kind==='busy'?'<b>The microphone is in use</b> by another program or browser tab. Close it and try again.':'<b>Could not start recording.</b>';
  p.innerHTML=`<div class="banner" style="margin:8px 0;display:block">${msg}<div class="row2" style="margin-top:8px"><button type="button" class="out" onclick="location.reload()">Reload page</button><button type="button" class="out" onclick="$('#rec').hidden=true;recStart()">Try again</button><button type="button" class="out" onclick="$('#rec').hidden=true">Close</button></div></div>`}
async function recStart(){if(REC)return;
  if(!navigator.mediaDevices||typeof MediaRecorder==='undefined'){toast('Voice notes are not supported in this browser.',1);return}
  if(await micState()==='denied'){micHelp('blocked');return}
  try{const stream=await navigator.mediaDevices.getUserMedia({audio:true}),mime=recMime(),mr=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
    REC={mr,stream,chunks:[],t0:Date.now(),state:'recording',conv:CONV&&CONV.id,mime:mr.mimeType||mime||'audio/webm'};
    mr.ondataavailable=e=>{if(e.data&&e.data.size)REC&&REC.chunks.push(e.data)};
    mr.onstop=()=>{if(!REC)return;stream.getTracks().forEach(t=>t.stop());if(REC.state==='cancelled')return;REC.blob=new Blob(REC.chunks,{type:REC.mime});REC.url=URL.createObjectURL(REC.blob);REC.state='review';recRender()};
    mr.start();REC.tick=setInterval(()=>{const s=Math.floor((Date.now()-REC.t0)/1000);const el=$('#rectime');if(el)el.textContent=Math.floor(s/60)+':'+String(s%60).padStart(2,'0');if(s>=REC_MAX_S)recStop()},500);recRender()}
  catch(x){REC=null;console.error('[voice note] getUserMedia failed',x);micHelp(/NotAllowed|Permission/i.test(String(x.name))?'blocked':/NotFound/i.test(String(x.name))?'none':/NotReadable/i.test(String(x.name))?'busy':'other')}}
function recStop(){if(REC&&REC.state==='recording'){clearInterval(REC.tick);REC.mr.stop()}}
function cancelRec(){if(!REC)return;const r=REC;REC=null;clearInterval(r.tick);r.state='cancelled';try{if(r.mr.state!=='inactive')r.mr.stop()}catch{}try{r.stream.getTracks().forEach(t=>t.stop())}catch{}if(r.url)URL.revokeObjectURL(r.url);const p=$('#rec');if(p){p.hidden=true;p.innerHTML=''}const b=$('#micbtn');if(b)b.disabled=false}
function recRender(){const p=$('#rec');if(!p||!REC)return;p.hidden=false;$('#micbtn').disabled=true;
  p.innerHTML=REC.state==='recording'?`<div class="banner" style="margin:8px 0"><b style="color:var(--red,#B33)">● Recording</b> <span id="rectime">0:00</span> <button type="button" class="out" onclick="recStop()">Stop</button> <button type="button" class="out" onclick="cancelRec()">Cancel</button></div>`
    :`<div class="banner" style="margin:8px 0"><audio controls src="${esc(REC.url)}"></audio> <button type="button" class="green" id="recsend" onclick="recSend()">Send voice note</button> <button type="button" class="out" onclick="cancelRec()">Discard</button></div>`}
async function recSend(){const r=REC;if(!r||!r.blob||!CONV||CONV.id!==r.conv)return;
  if(r.blob.size>AUDIO_MAX_BYTES){toast('This recording is larger than 10 MB. Record a shorter note.',1);return}
  const btn=$('#recsend');if(btn)btn.disabled=true;
  try{const fd=new FormData();fd.append('audio',r.blob,'voice-note.'+(/mp4/.test(r.mime)?'m4a':'webm'));
    const up=await api('/chat/upload-audio',{body:fd});
    await api('/chat/send',{body:{conversation_id:CONV.id,message_type:'AUDIO',media_url:up.data.media_url}});
    cancelRec();toast('Voice note sent.');refreshMsgs(true)}
  catch(x){toast(errText(x),1);if(btn)btn.disabled=false}}

