/* Audio / video calls (Agora) and incoming-call handling for the NGO counsellor.
   The browser libraries are vendored in /vendor (no CDN). Call credentials come ONLY from the Dost backend
   (POST /calls/initiate for outgoing calls, the authenticated socket 'incomingCall' event for incoming calls). */
let SOCK=null,CALL=null,RINGT=null,ACTX=null,SOCK_STATE='offline',SOCK_ERR='',POLLC=null;const SEEN=new Set();
const PEERS={};                                   // user id -> display name (filled by the pages that list people)
const API_ORIGIN=(()=>{try{return new URL(API,location.href).origin}catch{return''}})();
const CALL_TIMEOUT_MS=45000;

/* ---- sound + desktop notifications ---- */
function beep(n=1){try{ACTX=ACTX||new(window.AudioContext||window.webkitAudioContext)();let t=ACTX.currentTime;for(let i=0;i<n;i++){const o=ACTX.createOscillator(),g=ACTX.createGain();o.connect(g);g.connect(ACTX.destination);o.frequency.value=880;g.gain.setValueAtTime(.15,t);o.start(t);o.stop(t+.25);t+=.4}}catch{}}
function ring(){stopRing();beep(2);RINGT=setInterval(()=>beep(2),2500)}
function stopRing(){if(RINGT){clearInterval(RINGT);RINGT=null}}
function notify(title,body){try{if('Notification' in window&&Notification.permission==='granted'&&document.hidden)new Notification(title,{body,requireInteraction:true,tag:title})}catch{}}

/* ---- live-connection status (shown in the sidebar so a missed call can be diagnosed) ---- */
const callStateHtml=()=>SOCK_STATE==='online'?'<span class="tag ok">Calls: ready</span>':SOCK_STATE==='connecting'?'<span class="tag warn">Calls: connecting…</span>':`<span class="tag alert" title="${esc(SOCK_ERR)}">Calls: offline</span>${SOCK_ERR?`<div class="meta" style="margin-top:4px">${esc(String(SOCK_ERR).slice(0,90))}</div>`:''}`;
function setSockState(st,err){SOCK_STATE=st;SOCK_ERR=err||'';const el=document.getElementById('callstate');if(el)el.innerHTML=callStateHtml()}
/* ---- socket (incoming calls) ---- */
function startCalls(){if(SOCK||!S||typeof io==='undefined'||!API_ORIGIN)return;
  setSockState('connecting');
  SOCK=io(API_ORIGIN,{auth:cb=>cb({token:S&&S.token}),reconnection:true});
  SOCK.on('connect',()=>setSockState('online'));
  SOCK.on('disconnect',r=>setSockState('offline','Disconnected: '+r));
  SOCK.on('incomingCall',onIncoming);SOCK.on('callStatusUpdated',onStatus);
  SOCK.on('connect_error',async e=>{const m=String(e&&e.message);setSockState('offline',m);console.warn('[calls] socket error:',m);if(/auth|token|jwt|invalid|expired/i.test(m))await refresh()});
  if(!POLLC)POLLC=setInterval(pollIncoming,5000)}
function stopCalls(){if(SOCK){SOCK.disconnect();SOCK=null}if(POLLC){clearInterval(POLLC);POLLC=null}SEEN.clear();setSockState('offline');endLocal()}
/* Recovery: if the live connection is down, a ringing call is still found through the REST API (needs POST /calls/:id/join-token on the backend). */
async function pollIncoming(){if(!S||CALL||SOCK_STATE==='online')return;
  try{const r=await api('/calls/incoming');
    for(const c of r.data||[]){if(SEEN.has(c.id)||c.status!=='INITIATED'||Date.now()-new Date(c.created_at)>CALL_TIMEOUT_MS)continue;SEEN.add(c.id);
      try{const j=(await api(`/calls/${U(c.id)}/join-token`,{method:'POST',body:{}})).data;
        onIncoming({call_id:c.id,caller_id:c.caller_id,caller_name:(c.caller&&(c.caller.full_name||c.caller.email))||'Caller',call_type:c.call_type,channelName:j.provider_room||j.channelName||c.provider_room,token:j.token,appId:j.appId})}
      catch(x){toast(x.status===404?'A call is ringing, but the live connection is offline and this server cannot hand the call to the portal yet.':errText(x),1);notify('Dost: incoming call','Open the portal to see the call.')}}}
  catch{}}

/* ---- incoming ---- */
function onIncoming(c){
  if(!c||!isUuid(c.call_id)||!c.channelName||!c.token||!c.appId)return;
  if(CALL){api(`/calls/${U(c.call_id)}/status`,{method:'PATCH',body:{status:'REJECTED'}}).catch(()=>{});return}   // already busy
  CALL={id:c.call_id,dir:'in',type:c.call_type==='VIDEO'?'VIDEO':'AUDIO',peer:c.caller_name||'Caller',creds:{appId:c.appId,channel:c.channelName,token:c.token},state:'ringing'};
  ring();notify('Incoming '+human(CALL.type)+' call',CALL.peer);renderCall();
  CALL.t=setTimeout(()=>{if(CALL&&CALL.state==='ringing')hangup()},CALL_TIMEOUT_MS)}
async function acceptCall(){const c=CALL;if(!c||c.state!=='ringing')return;clearTimeout(c.t);stopRing();c.state='connecting';renderCall();
  try{await api(`/calls/${U(c.id)}/status`,{method:'PATCH',body:{status:'ONGOING'}});if(CALL!==c)return;await joinAgora(c)}
  catch(x){if(CALL!==c)return;console.error('[calls] accept failed',x);toast(callErr(x),1);await hangup(true)}}

/* ---- outgoing ---- */
async function startCall(receiverId,patientId,type){
  if(CALL){toast('You are already in a call.',1);return}
  if(!isUuid(receiverId))return;
  if(typeof AgoraRTC==='undefined'){toast('Calling is not available: the call library did not load.',1);return}
  const body={receiver_id:receiverId,call_type:type==='VIDEO'?'VIDEO':'AUDIO'};if(isUuid(patientId))body.patient_id=patientId;
  const cur=CALL={id:null,dir:'out',type:body.call_type,peer:PEERS[receiverId]||'Contact',creds:null,state:'calling'};renderCall();
  try{const r=await api('/calls/initiate',{body}),d=r.data;
    if(CALL!==cur)return;                                    // cancelled while the request was in flight
    CALL.id=d.id;CALL.creds={appId:d.appId,channel:d.provider_room,token:d.token};
    CALL.t=setTimeout(()=>{if(CALL&&CALL.state==='calling'){toast('No answer.');hangup()}},CALL_TIMEOUT_MS);
    await joinAgora(cur)}
  catch(x){if(CALL!==cur){if(cur.id)api(`/calls/${U(cur.id)}/status`,{method:'PATCH',body:{status:'MISSED'}}).catch(()=>{});return}   // user cancelled / call ended while connecting: not an error
    console.error('[calls] start failed',x);toast(callErr(x),1);await hangup(true)}}
const callErr=x=>{const k=String(x&&(x.name||x.code)||''),m=String(x&&x.message||'');
  if(/NotAllowed|PERMISSION_DENIED/i.test(k+m))return'Microphone or camera access is blocked. Click the lock icon in the address bar, allow it, then reload this page and call again.';
  if(/NotFound|DEVICES_NOT_FOUND/i.test(k+m))return'No microphone or camera was found on this computer.';
  if(/NotReadable|DEVICE_NOT_READABLE/i.test(k+m))return'The microphone or camera is being used by another program.';
  if(x&&x.code&&/^(INVALID|DYNAMIC_KEY|CAN_NOT_GET_GATEWAY|UID_CONFLICT|OPERATION_ABORTED|NOT_SUPPORTED|WS_|NETWORK)/.test(String(x.code)))return`Could not connect the call (${x.code}). Check the internet connection; if it keeps happening, ask the administrator to check the Agora App ID and certificate on the server.`;
  return errText(x)};

/* ---- media ---- */
async function joinAgora(c){
  const client=c.client=AgoraRTC.createClient({mode:'rtc',codec:'vp8'});
  client.on('user-published',async(u,m)=>{try{await client.subscribe(u,m);if(m==='video'&&u.videoTrack)u.videoTrack.play('callRemote');if(m==='audio'&&u.audioTrack)u.audioTrack.play();
    clearTimeout(c.t);c.state='live';c.t0=c.t0||Date.now();renderCall()}catch(e){console.error(e)}});
  client.on('user-left',()=>{if(CALL===c)hangup()});
  await client.join(c.creds.appId,c.creds.channel,c.creds.token,null);
  c.tracks=[];c.mic=await AgoraRTC.createMicrophoneAudioTrack();c.tracks.push(c.mic);
  if(c.type==='VIDEO'){c.cam=await AgoraRTC.createCameraVideoTrack();c.tracks.push(c.cam)}
  await client.publish(c.tracks);if(c.cam)c.cam.play('callLocal');
  if(CALL===c&&c.state==='connecting')renderCall()}

/* ---- state from the other side ---- */
function onStatus(e){if(!CALL||!e||e.call_id!==CALL.id)return;
  if(e.status==='ONGOING'&&CALL.dir==='out'){clearTimeout(CALL.t);CALL.state='connecting';renderCall()}
  else if(e.status==='REJECTED'){toast('The call was declined.');endLocal()}
  else if(e.status==='COMPLETED'||e.status==='MISSED'){toast(CALL.state==='ringing'?'Missed call from '+CALL.peer+'.':'Call ended.');endLocal()}}

/* ---- ending ---- */
async function hangup(silent){const c=CALL;if(!c)return;
  const status=c.dir==='in'&&c.state==='ringing'?'REJECTED':(c.state==='live'||c.state==='connecting')?'COMPLETED':c.dir==='in'?'REJECTED':'MISSED';
  const id=c.id;endLocal();
  if(id)try{await api(`/calls/${U(id)}/status`,{method:'PATCH',body:{status}})}catch(x){if(!silent&&x.status!==400)console.error(x)}}
function endLocal(){const c=CALL;stopRing();if(!c)return;CALL=null;clearTimeout(c.t);clearInterval(c.tick);
  try{(c.tracks||[]).forEach(t=>{t.stop();t.close()})}catch{}try{if(c.client)c.client.leave()}catch{}
  const box=document.getElementById('callbox');if(box)box.remove()}

/* ---- overlay ---- */
function renderCall(){const c=CALL;let box=document.getElementById('callbox');if(!c){if(box)box.remove();return}
  if(!box){box=document.createElement('div');box.id='callbox';box.setAttribute('role','dialog');box.setAttribute('aria-label','Call');
    box.style.cssText='position:fixed;right:24px;bottom:24px;width:340px;max-width:calc(100vw - 32px);background:var(--deep,#0E3E45);color:#fff;border-radius:18px;padding:16px;z-index:20;box-shadow:0 12px 40px rgba(0,0,0,.35)';document.body.appendChild(box)}
  const label=c.state==='ringing'?`Incoming ${human(c.type).toLowerCase()} call`:c.state==='calling'?'Calling…':c.state==='connecting'?'Connecting…':'In call';
  const btn=(t,fn,cls='out')=>`<button class="${cls}" onclick="${fn}" style="margin:4px 4px 0 0">${t}</button>`;
  box.innerHTML=`<div style="font-size:14px;opacity:.8">${label}</div><div style="font-size:20px;font-weight:700;margin:2px 0 8px">${esc(c.peer)}</div>
    ${c.type==='VIDEO'?`<div id="callRemote" style="width:100%;height:190px;background:#000;border-radius:12px;overflow:hidden;position:relative"></div><div id="callLocal" style="width:96px;height:72px;background:#222;border-radius:8px;overflow:hidden;position:absolute;right:28px;bottom:84px"></div>`:''}
    <div id="calltime" style="font-variant-numeric:tabular-nums;margin:6px 0">${c.state==='live'?'00:00':''}</div>
    <div>${c.state==='ringing'?btn('Accept','acceptCall()','green')+btn('Decline','hangup()','red'):
      btn(c.mic&&c.mic.muted?'Unmute':'Mute','toggleMic()')+(c.type==='VIDEO'?btn('Camera on/off','toggleCam()'):'')+btn(c.state==='calling'?'Cancel':'End call','hangup()','red')}</div>`;
  clearInterval(c.tick);if(c.state==='live')c.tick=setInterval(()=>{const el=document.getElementById('calltime');if(el&&c.t0){const s=Math.floor((Date.now()-c.t0)/1000);el.textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')}},1000);
  if(c.cam&&document.getElementById('callLocal'))c.cam.play('callLocal')}
async function toggleMic(){const c=CALL;if(!c||!c.mic)return;await c.mic.setMuted(!c.mic.muted);renderCall()}
async function toggleCam(){const c=CALL;if(!c||!c.cam)return;await c.cam.setEnabled(!c.cam.enabled);}
/* ---- entry points used by pages ---- */
function callFromChat(type){if(!CONV)return;const o=other(CONV);if(o&&o.id){PEERS[o.id]=uname(o);startCall(o.id,CONV.patient_id,type)}}

