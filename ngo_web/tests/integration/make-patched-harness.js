// The backend's in-memory test harness has no tables for OTP / refresh tokens / community extras.
// This writes a patched COPY (harness.patched.js) next to the original; the backend repository is not modified otherwise.
const fs=require('fs'),path=require('path');
module.exports=(BE)=>{const dir=path.join(BE,'tests','helpers'),src=fs.readFileSync(path.join(dir,'harness.js'),'utf8');
  const out=src.replace("'ngoauthority', 'patientclaimattempt',","'ngoauthority', 'patientclaimattempt', 'authotp', 'refreshtoken', 'callsession', 'polloption', 'pollvote', 'postcomment', 'postlike',");
  if(out===src&&!src.includes("'authotp'"))throw new Error('Could not patch harness.js: table list not found.');
  fs.writeFileSync(path.join(dir,'harness.patched.js'),out)};
