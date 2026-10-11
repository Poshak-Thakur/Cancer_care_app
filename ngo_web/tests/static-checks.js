// Static security checks on the portal source (run: npm run test:static).
const fs=require('fs'),path=require('path'),dir=path.join(__dirname,'..','public');
const files=['core','patients','operations','admin'].map(f=>[f,fs.readFileSync(path.join(dir,f+'.js'),'utf8')]);
const all=files.map(x=>x[1]).join('\n'),core=files[0][1];
let bad=0;const fail=m=>{bad++;console.log('FAIL '+m)},pass=m=>console.log('PASS '+m);
// 1. interpolations inside inline handlers: ids must pass U() (UUID check); the rest must be code constants.
const SAFE=[/^U\(/,/^go$/,/^fn$/,/^Number\(pg\.page\)[+-]1$/,/^k$/,/^nx\[0\]$/,/^v$/,/^s$/];
let n=0;for(const [f,src] of files)for(const m of src.matchAll(/on(?:click|submit|change|input|keydown)=\\?"([^"]*)"/g))
  for(const x of m[1].matchAll(/\$\{([^}]*)\}/g)){n++;if(!SAFE.some(r=>r.test(x[1].trim())))fail(`${f}.js handler interpolates unvalidated "${x[1]}" in: ${m[1].slice(0,80)}`)}
pass(`${n} handler interpolations checked (ids validated by U())`);
// 2. no dynamic code execution
if(/\beval\s*\(|new Function|document\.write/.test(all))fail('dynamic code execution found');else pass('no eval / new Function / document.write');
// 3. storage
if(/localStorage\.(setItem|getItem)\(/.test(all))fail('localStorage read/write found');else pass('localStorage is never read or written (only legacy keys are removed)');
if(!/sessionStorage\.setItem\(SKEY/.test(core))fail('session is not stored in sessionStorage');else pass('session lives in sessionStorage');
// 4. one place builds the Authorization header
if(!/h\.Authorization='Bearer '\+S\.token/.test(core))fail('api() does not set the Bearer header');else pass('api() sets Authorization: Bearer on protected requests');
const fetches=(all.match(/\bfetch\(/g)||[]).length;
if(fetches!==3)fail(`expected 3 fetch() call sites (api, refresh, logout), found ${fetches}`);else pass('fetch() only in api(), refresh() and logout()');
// 5. unsupported / removed actions
for(const w of ['account-links','/hide','/flags','/emergencies','api/login'])if(all.includes(w))fail('unsupported endpoint referenced: '+w);
if(/body:\{status:'CANCELLED'|status:'ESCALATION_EXHAUSTED'/.test(all))fail('alert cancel / exhaust offered');else pass('no unsupported actions referenced; alert cancel is never offered');
// 6. no demo credentials or seeded data
if(/\b(password|data\.json|demo)\b/i.test(all))fail('demo/credential wording in source');else pass('no demo credentials / seeded data in source');
// 7. server.js is static only
const srv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
if(/app\.(post|put|patch|delete)\(/.test(srv)||/app\.get\('\/api/.test(srv))fail('server.js defines API routes');else pass('server.js serves static files only');
console.log(bad?`\n${bad} problem(s)`:'\nAll static checks passed');process.exit(bad?1:0);
