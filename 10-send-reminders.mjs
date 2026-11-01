// Reminder sender: reads opted-in members from Firestore and sends FCM web push.
// No dependencies; node 20 built-ins only. Secrets arrive via env, never logged.
import { createSign } from 'node:crypto';

const SA = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const PROJECT = process.env.FIREBASE_PROJECT_ID;
const SITE = process.env.SITE_URL;

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    iss: SA.client_email,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  })).toString('base64url');
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${signer.sign(SA.private_key, 'base64url')}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('token exchange failed: ' + res.status);
  return data.access_token;
}
function slotInfo() {
  if (process.env.TEST_SLOT) {
    const [date, time] = process.env.TEST_SLOT.split('@');
    return { slot: process.env.TEST_SLOT, label: time.slice(0, 2) + ':' + time.slice(2) };
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const g = (t) => parts.find(p => p.type === t).value;
  const h = parseInt(g('hour'), 10);
  const label = { 7: '08:00', 12: '13:00', 19: '20:00' }[h];
  if (!label) { console.log('not a reminder hour, exiting'); process.exit(0); }
  return { slot: `${g('year')}-${g('month')}-${g('day')}@${label.replace(':', '')}`, label };
}

const FV = {
  s: (v) => ({ stringValue: v }),
  b: (v) => ({ booleanValue: v }),
  a: (arr) => ({ arrayValue: { values: arr } })
};
const fromFV = (f) => ({
  name: f.name?.stringValue || '',
  enabled: f.reminders?.mapValue?.fields?.enabled?.booleanValue === true,
  tokens: (f.reminders?.mapValue?.fields?.tokens?.arrayValue?.values || []).map(v => v.stringValue),
  lastSlot: f.reminders?.mapValue?.fields?.lastReminderSlot?.stringValue || ''
});
async function main() {
  const { slot, label } = slotInfo();
  const token = await accessToken();
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
  const res = await fetch(`${base}/members?pageSize=100`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  const members = (data.documents || []).map(d => ({ path: d.name, ...fromFV(d.fields || {}) }));
  let sent = 0, skipped = 0;
  for (const m of members) {
    if (!m.enabled || !m.tokens.length || m.lastSlot === slot) { skipped++; continue; }
    for (const t of m.tokens) {
      const msg = {
        message: {
          token: t,
          notification: { title: 'צלב העוררות', body: `עוד כ-10 דקות: זמן לדיווח של ${label}` },
          webpush: {
            notification: { icon: SITE + 'icons/icon-192.png' },
            fcm_options: { link: SITE }
          }
        }
      };
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(msg)
      });
      if (r.ok) sent++;
      else console.log('send failed for one token:', r.status);
    }
    await fetch(`${base}/members/${m.path.split('/').pop()}?updateMask.fieldPaths=reminders`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { reminders: { mapValue: { fields: {
        enabled: FV.b(true), tokens: FV.a(m.tokens.map(FV.s)), lastReminderSlot: FV.s(slot) } } } } })
    });
  }
  console.log(`slot ${slot}: sent=${sent} skipped=${skipped}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
