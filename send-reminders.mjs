// Reminder sender v2: per-member custom times. Reads opted-in members from
// Firestore and sends FCM web push when Jerusalem-local time matches one of
// their chosen times. No dependencies; node 20 built-ins only.
// Secrets arrive via env, never logged.
import { createSign } from 'node:crypto';

const SA = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const PROJECT = process.env.FIREBASE_PROJECT_ID;
const SITE = process.env.SITE_URL;
const DEFAULT_TIMES = ['07:50', '12:50', '19:50'];
const WINDOW_MIN = 15; // cron runs every 10 min; a late run still catches the slot

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

// Jerusalem wall-clock now (DST-safe: Intl handles IST/IDT transitions).
function jerusalemNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const g = (t) => parts.find(p => p.type === t).value;
  const hour = g('hour') === '24' ? '00' : g('hour');
  return {
    date: `${g('year')}-${g('month')}-${g('day')}`,
    minutes: parseInt(hour, 10) * 60 + parseInt(g('minute'), 10)
  };
}

const FV = {
  s: (v) => ({ stringValue: v }),
  b: (v) => ({ booleanValue: v }),
  a: (arr) => ({ arrayValue: { values: arr } })
};
const strArr = (n) => (n?.arrayValue?.values || []).map(v => v.stringValue);
const fromFV = (f) => {
  const r = f.reminders?.mapValue?.fields || {};
  return {
    id: (f.name?.stringValue || ''),
    name: f.name?.stringValue || '',
    enabled: r.enabled?.booleanValue === true,
    asked: r.asked?.booleanValue === true,
    tokens: strArr(r.tokens),
    times: strArr(r.times),
    lastSlots: strArr(r.lastSlots)
  };
};

async function main() {
  const forced = (process.env.TEST_SLOT || '').trim(); // e.g. 2026-11-01@07:50
  const now = jerusalemNow();
  const token = await accessToken();
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
  const res = await fetch(`${base}/members?pageSize=100`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  const members = (data.documents || []).map(d => ({ path: d.name, ...fromFV(d.fields || {}) }));
  let sent = 0, skipped = 0;
  for (const m of members) {
    if (!m.enabled || !m.tokens.length) { skipped++; continue; }
    const times = m.times.length ? m.times : DEFAULT_TIMES;
    const due = [];
    for (const t of times) {
      if (!/^\d{2}:\d{2}$/.test(t)) continue;
      let slotId = null;
      if (forced) {
        const [, ft] = forced.split('@');
        if (ft === t) slotId = forced;
      } else {
        const [hh, mm] = t.split(':').map(Number);
        const tMin = hh * 60 + mm;
        if (now.minutes >= tMin && now.minutes < tMin + WINDOW_MIN) slotId = `${now.date}@${t}`;
      }
      if (slotId && !m.lastSlots.includes(slotId)) due.push({ t, slotId });
    }
    if (!due.length) { skipped++; continue; }
    let memberSent = 0;
    for (const d of due) {
      // Atomic idempotency: claim the slot with a create-only doc BEFORE sending.
      // currentDocument.exists=false makes Firestore fail the write if any other
      // run already claimed this member+slot, so overlapping runs cannot both send.
      const claimId = encodeURIComponent(`${m.path.split('/').pop()}_${d.slotId}`);
      const claim = await fetch(`${base}/reminderClaims/${claimId}?currentDocument.exists=false`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { at: FV.s(new Date().toISOString()) } })
      });
      if (!claim.ok) { console.log('slot already claimed, skipping'); continue; }
      for (const t of m.tokens) {
        const msg = {
          message: {
            token: t,
            notification: { title: 'צלב העוררות', body: `התזכורת של ${d.t} - זמן לדיווח קצר בצלב` },
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
        if (r.ok) { sent++; memberSent++; }
        else console.log('send failed for one token:', r.status);
      }
    }
    // Record claimed slots on the member doc too (informational; the
    // reminderClaims docs above are the authoritative atomic guard).
    const lastSlots = [...m.lastSlots, ...due.map(d => d.slotId)].slice(-12);
    await fetch(`${base}/members/${m.path.split('/').pop()}?updateMask.fieldPaths=reminders`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { reminders: { mapValue: { fields: {
        enabled: FV.b(m.enabled),
        asked: FV.b(m.asked),
        tokens: FV.a(m.tokens.map(FV.s)),
        times: FV.a(times.map(FV.s)),
        lastSlots: FV.a(lastSlots.map(FV.s)),
        updatedAt: FV.s(new Date().toISOString())
      } } } } })
    });
    if (memberSent === 0) console.log('all tokens failed for one member');
  }
  console.log(`done: sent=${sent} skipped=${skipped} (jerusalem minutes=${now.minutes}, forced=${forced || 'no'})`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
