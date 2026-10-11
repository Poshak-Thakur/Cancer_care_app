// Integration rig: the REAL backend (routes, middleware, controllers, services) over HTTP,
// with the in-memory Prisma fake from the backend's own test harness (no PostgreSQL available here).
process.env.JWT_SECRET='rig-secret';process.env.CORS_ALLOWED_ORIGINS='http://localhost:5173';process.env.NODE_ENV='development';
const BE=process.env.BACKEND_DIR&&require('path').resolve(process.env.BACKEND_DIR);
if(!BE){console.error('Set BACKEND_DIR to the backend repository (the folder containing src/ and tests/).');process.exit(2)}
process.env.CORS_ALLOWED_ORIGINS=process.env.CORS_ALLOWED_ORIGINS||'http://localhost:5173';
require('./make-patched-harness')(BE);
const h=require(BE+'/tests/helpers/harness.patched.js');
global.OTPS={};
const mailer=require(BE+'/src/config/mailer');mailer.sendMail=async(m)=>{const x=/code is: (\d{6})/.exec(m.text);if(x)global.OTPS[m.to.toLowerCase()]=x[1];return{}};
// Rig-only shim: the fake Prisma does not implement relation counts (_count), which two admin list queries use.
const T=n=>h.fakeDb[n]._rows();const act=['OPEN','ACKNOWLEDGED','IN_PROGRESS'];
const pf=h.fakeDb.patient.findMany.bind(h.fakeDb.patient);
h.fakeDb.patient.findMany=async(a)=>{const rows=await pf({...a,select:a.select?{...a.select,_count:undefined}:undefined});return rows.map(p=>({...p,_count:{alert:T('alert').filter(x=>x.patient_id===p.id&&act.includes(x.status)).length,patientcaregiverlink:T('patientcaregiverlink').filter(x=>x.patient_id===p.id&&x.consent_status==='GRANTED'&&!x.revoked_at).length}}))};
const af=h.fakeDb.alert.findMany.bind(h.fakeDb.alert);
h.fakeDb.alert.findMany=async(a)=>{const rows=await af({...a,include:a.include?{...a.include,_count:undefined}:undefined});return rows.map(x=>({...x,_count:{alertrecipient:T('alertrecipient').filter(r=>r.alert_id===x.id).length,alertupdate:T('alertupdate').filter(r=>r.alert_id===x.id).length}}))};
const cf=h.fakeDb.communitypost.findMany.bind(h.fakeDb.communitypost);
h.fakeDb.communitypost.findMany=async(a)=>{if(!(a.include&&a.include._count&&a.include.polloption))return cf(a);
  const {_count,polloption,postlike,...inc}=a.include;const rows=await cf({...a,include:inc});
  return rows.map(p=>({...p,_count:{postlike:T('postlike').filter(x=>x.post_id===p.id).length,postcomment:T('postcomment').filter(x=>x.post_id===p.id).length},polloption:[],postlike:[]}))};
const cp=h.fakeDb.caregiverprofile.findMany.bind(h.fakeDb.caregiverprofile);
h.fakeDb.caregiverprofile.findMany=async(a)=>{const rows=await cp(a);return rows.map(p=>({...p,useraccount:h.fakeDb.useraccount._rows().find(u=>u.id===p.user_id)}))};
// Rig-only: column defaults that real PostgreSQL/Prisma applies but the fake does not.
const wrapDefault=(t,d)=>{const c=h.fakeDb[t].create.bind(h.fakeDb[t]);h.fakeDb[t].create=async(a)=>c({...a,data:{...d,...a.data}})};
wrapDefault('refreshtoken',{revoked:false});wrapDefault('authotp',{attempts_count:0});
const app=require(BE+'/src/app');
module.exports={h,app};
if(require.main===module){app.listen(3000,()=>console.log('rig on 3000'))}
