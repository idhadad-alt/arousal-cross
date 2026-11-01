// צלב העוררות - צוות חמני. first test version (owner-only).
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
         getRedirectResult, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, addDoc, collection, query, where,
         orderBy, limit, getDocs, serverTimestamp, onSnapshot }
  from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getMessaging, getToken, onMessage }
  from "https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyDJzRldHhcwoCKYewhFx0cEjs8id9gGIlI",
  authDomain: "arousal-cross-hamani.firebaseapp.com",
  projectId: "arousal-cross-hamani",
  messagingSenderId: "70626915450",
  appId: "1:70626915450:web:89b47076bcf3749ae777c3"
};
const VAPID_KEY = "BAMOObINbvLbdblvRmNTkurjHaPx69eowAnzAKAaxFDTbcIM-quzJTu0iTFPZxxq1WppknYWKglnYgaoUwQP8D4";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let messaging = null;

const $ = (s) => document.querySelector(s);
const state = { user: null, name: "", members: [], myReports: [], view: "cross",
  histMode: "today", showAvg: false, draft: null, welcomed: true };

const HEB_DAYS = ["א׳","ב׳","ג׳","ד׳","ה׳","ו׳","ש׳"];
const QUADS = {
  UL: { title: "סוערת",   vocab: "חרדה · זעם · לחימה · בריחה · מתח גבוה" },
  UR: { title: "התרגשות ויוזמה",  vocab: "התרגשות · יוזמה · עשייה · פלואו · מרץ" },
  LL: { title: "כובד וניתוק",  vocab: "כובד · ניתוק · חוסר כוחות · שקיעה · ריק" },
  LR: { title: "מנוחה והחלמה",  vocab: "נינוחות · שלווה · מנוחה · הרפיה · החלמה" }
};
// ---------- auth + roster gate ----------
async function checkRoster(user) {
  const snap = await getDoc(doc(db, "roster", user.email));
  return snap.exists() ? (snap.data().name || user.displayName || user.email) : null;
}

$("#btn-login").addEventListener("click", async () => {
  const msg = $("#gate-msg"); msg.classList.add("hidden");
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    if (["auth/popup-blocked","auth/popup-closed-by-user","auth/cancelled-popup-request",
         "auth/operation-not-supported-in-this-environment"].includes(e.code)) {
      await signInWithRedirect(auth, new GoogleAuthProvider());
    } else { msg.textContent = "שגיאת כניסה: " + e.code; msg.classList.remove("hidden"); }
  }
});
getRedirectResult(auth).catch(() => {});

onAuthStateChanged(auth, async (user) => {
  if (!user) { showGate(); return; }
  const name = await checkRoster(user).catch(() => null);
  if (name === null) {
    const msg = $("#gate-msg");
    msg.textContent = "הכתובת " + user.email + " לא נמצאת ברשימת הצוות. פנה לאלעד.";
    msg.classList.remove("hidden");
    showGate(true);
    return;
  }
  state.user = user; state.name = name;
  enterApp();
});

function showGate(signedIn=false) {
  $("#gate").classList.remove("hidden");
  $("#tabs").classList.add("hidden");
  ["cross","team","history","settings","help"].forEach(v => $("#view-"+v).classList.add("hidden"));
  $("#btn-login").textContent = signedIn ? "כניסה עם חשבון אחר" : "כניסה עם חשבון Google";
  $("#who").textContent = "";
  state.user = null;
}
// ---------- cross rendering ----------
// x: -5..+5 (left..right), y: -5..+5 (bottom..top)
function toPct(x, y) { return { left: (50 + x * 10), top: (50 - y * 10) }; }

function crossHTML() {
  return `<div class="cross-wrap" id="cw">
    <div class="quad qUL" data-q="UL"><span class="qlabel">${QUADS.UL.title}</span></div>
    <div class="quad qUR" data-q="UR"><span class="qlabel">${QUADS.UR.title}</span></div>
    <div class="quad qLL" data-q="LL"><span class="qlabel">${QUADS.LL.title}</span></div>
    <div class="quad qLR" data-q="LR"><span class="qlabel">${QUADS.LR.title}</span></div>
    <div class="axis v"></div><div class="axis h"></div>
    <span class="axlab top">יתר-עוררות +5</span>
    <span class="axlab bottom">תת-עוררות -5</span>
    <span class="axlab right">נעימה / מתרחבת</span>
    <span class="axlab left">לא נעימה / מתכווצת</span>
  </div>`;
}

function addPointEl(wrap, x, y, cls, onTap) {
  const p = document.createElement("div");
  p.className = "pt " + cls;
  const pos = toPct(x, y);
  p.style.left = pos.left + "%"; p.style.top = pos.top + "%";
  if (onTap) p.addEventListener("click", (e) => { e.stopPropagation(); onTap(); });
  wrap.appendChild(p);
  return p;
}

function quadInfo(x, y) {
  if (y >= 0 && x < 0) return QUADS.UL;
  if (y >= 0 && x >= 0) return QUADS.UR;
  if (y < 0 && x < 0) return QUADS.LL;
  return QUADS.LR;
}

function wireQuadVocab(wrap) {
  wrap.querySelectorAll(".quad").forEach(q => {
    q.addEventListener("click", (e) => {
      if (!e.target.closest(".qlabel")) return;
      const info = QUADS[q.dataset.q];
      popup(`<h4>${info.title}</h4><div class="vocab">${info.vocab}</div>`);
    });
  });
}

function popup(html) {
  const o = $("#overlay");
  o.innerHTML = `<div class="backdrop"></div><div class="popup">${html}
    <div style="margin-top:12px;text-align:left"><button class="ghost" id="pp-close">סגור</button></div></div>`;
  o.querySelector(".backdrop").addEventListener("click", closeOverlay);
  o.querySelector("#pp-close").addEventListener("click", closeOverlay);
}
function closeOverlay() { $("#overlay").innerHTML = ""; }
function pointPopup(m) {
  const t = new Date(m.lastPoint.at);
  let html = `<h4>${m.name}</h4><div class="muted">${fmtTime(t)}</div>`;
  if (m.additions && m.additions.word) html += `<div>מילה: ${m.additions.word}</div>`;
  if (m.additions && m.additions.songUrl) html += `<div><a href="${m.additions.songUrl}" target="_blank" rel="noopener">השיר של הרגע</a></div>`;
  if (m.additions && m.additions.photo) html += `<img src="${m.additions.photo}" alt="תמונת רגע">`;
  popup(html);
}
// ---------- my cross (place + report) ----------
function renderCross() {
  const sec = $("#view-cross");
  sec.innerHTML = `<p class="muted" style="text-align:center;margin:4px 0 10px">
    לחיצה על הצלב ממקמת את הנקודה שלך. לחיצה על שכונה מציגה את המילים שלה.</p>` + crossHTML();
  const wrap = sec.querySelector("#cw");
  wireQuadVocab(wrap);
  const mine = state.members.find(m => m.id === state.user.uid);
  if (mine && mine.lastPoint) addPointEl(wrap, mine.lastPoint.x, mine.lastPoint.y, "mine", () => pointPopup(mine));
  if (state.draft) addPointEl(wrap, state.draft.x, state.draft.y, "draft");
  wrap.addEventListener("click", (e) => {
    if (e.target.closest(".pt") || e.target.closest(".quad .qlabel")) return;
    const r = wrap.getBoundingClientRect();
    const x = Math.max(-5, Math.min(5, ((r.right - e.clientX) / r.width - 0.5) * -10));
    const y = Math.max(-5, Math.min(5, (0.5 - (e.clientY - r.top) / r.height) * 10));
    state.draft = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    renderCross();
    openReportSheet();
  });
}

function openReportSheet() {
  const q = quadInfo(state.draft.x, state.draft.y);
  const o = $("#overlay");
  o.innerHTML = `<div class="backdrop"></div><div class="sheet">
    <h3>דיווח חדש · שכונת ${q.title}</h3>
    <div class="muted">אנרגיה ${state.draft.y > 0 ? "+" + state.draft.y : state.draft.y} ·
      איכות ${state.draft.x > 0 ? "+" + state.draft.x : state.draft.x}</div>
    <label>מילה (אופציונלי)</label><input type="text" id="f-word" maxlength="60">
    <label>קישור לשיר (אופציונלי)</label><input type="url" id="f-song" placeholder="https://...">
    <label>תמונה של הרגע (אופציונלי)</label>
    <div class="row" style="margin-top:2px">
      <button class="ghost" id="f-cam-btn" type="button">צילום עכשיו</button>
      <button class="ghost" id="f-gal-btn" type="button">מהגלריה</button>
    </div>
    <input type="file" id="f-camera" accept="image/*" capture="environment" style="display:none">
    <input type="file" id="f-photo" accept="image/*" style="display:none">
    <div class="muted hidden" id="f-photo-name" style="margin-top:6px"></div>
    <div class="row">
      <button class="primary" id="f-save">שמירה</button>
      <button class="ghost" id="f-cancel">ביטול</button>
    </div></div>`;
  o.querySelector(".backdrop").addEventListener("click", () => { state.draft = null; closeOverlay(); renderCross(); });
  o.querySelector("#f-cancel").addEventListener("click", () => { state.draft = null; closeOverlay(); renderCross(); });
  o.querySelector("#f-save").addEventListener("click", saveReport);
  const camIn = o.querySelector("#f-camera"), galIn = o.querySelector("#f-photo"), pName = o.querySelector("#f-photo-name");
  o.querySelector("#f-cam-btn").addEventListener("click", () => camIn.click());
  o.querySelector("#f-gal-btn").addEventListener("click", () => galIn.click());
  const showPick = (inp, other) => inp.addEventListener("change", () => {
    if (inp.files[0]) { other.value = ""; pName.textContent = "נבחרה תמונה: " + inp.files[0].name; pName.classList.remove("hidden"); }
    else { pName.classList.add("hidden"); }
  });
  showPick(camIn, galIn); showPick(galIn, camIn);
}
// ---------- photo compression + save ----------
function compressPhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const max = 640;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      let q = 0.72, data = c.toDataURL("image/jpeg", q);
      while (data.length > 210000 && q > 0.3) { q -= 0.1; data = c.toDataURL("image/jpeg", q); }
      URL.revokeObjectURL(img.src);
      resolve(data); // ~<=150KB binary as base64 data-url
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function saveReport() {
  const btn = $("#f-save"); btn.disabled = true; btn.textContent = "שומר...";
  try {
    const word = $("#f-word").value.trim();
    const song = $("#f-song").value.trim();
    const pf = $("#f-camera").files[0] || $("#f-photo").files[0];
    const rec = { uid: state.user.uid, name: state.name,
      x: state.draft.x, y: state.draft.y, at: serverTimestamp() };
    if (word) rec.word = word;
    if (song) rec.songUrl = song;
    if (pf) rec.photo = await compressPhoto(pf);
    await addDoc(collection(db, "reports"), rec);
    const add = {};
    if (rec.word) add.word = rec.word;
    if (rec.songUrl) add.songUrl = rec.songUrl;
    if (rec.photo) add.photo = rec.photo;
    await setDoc(doc(db, "members", state.user.uid), {
      name: state.name, email: state.user.email,
      lastPoint: { x: rec.x, y: rec.y, at: new Date().toISOString() },
      additions: add
    }, { merge: true });
    state.draft = null; closeOverlay();
  } catch (e) {
    alert("השמירה נכשלה: " + e.code);
    btn.disabled = false; btn.textContent = "שמירה";
  }
}
// ---------- team view ----------
function fmtTime(d) {
  return `${HEB_DAYS[d.getDay()]} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function renderTeam() {
  const sec = $("#view-team");
  sec.innerHTML = `<div class="seg"><button id="btn-avg">${state.showAvg ? "הסתר ממוצע צוותי" : "ממוצע צוותי"}</button></div>` + crossHTML();
  const wrap = sec.querySelector("#cw");
  wireQuadVocab(wrap);
  state.members.filter(m => m.lastPoint).forEach(m => {
    const cls = m.id === state.user.uid ? "mine" : "other";
    addPointEl(wrap, m.lastPoint.x, m.lastPoint.y, cls, () => pointPopup(m));
  });
  if (state.showAvg) {
    const pts = state.members.filter(m => m.lastPoint);
    if (pts.length) {
      const ax = pts.reduce((s, m) => s + m.lastPoint.x, 0) / pts.length;
      const ay = pts.reduce((s, m) => s + m.lastPoint.y, 0) / pts.length;
      addPointEl(wrap, ax, ay, "avg");
    }
  }
  sec.querySelector("#btn-avg").addEventListener("click", () => { state.showAvg = !state.showAvg; renderTeam(); });
}
// ---------- history (new reports only; path on the same cross) ----------
function renderHistory() {
  const sec = $("#view-history");
  const reps = state.myReports;
  const now = new Date();
  let pts;
  if (state.histMode === "today") {
    pts = reps.filter(r => r.at && r.at.toDate().toDateString() === now.toDateString());
  } else {
    const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 6);
    const byDay = {};
    reps.filter(r => r.at && r.at.toDate() >= weekAgo).forEach(r => {
      const k = r.at.toDate().toDateString();
      (byDay[k] = byDay[k] || []).push(r);
    });
    pts = Object.values(byDay).map(day => ({
      x: day.reduce((s, r) => s + r.x, 0) / day.length,
      y: day.reduce((s, r) => s + r.y, 0) / day.length,
      at: day[day.length - 1].at, daily: true
    }));
  }
  pts.sort((a, b) => a.at.toDate() - b.at.toDate());
  sec.innerHTML = `<div class="seg">
      <button data-m="today" class="${state.histMode === "today" ? "on" : ""}">היום</button>
      <button data-m="week" class="${state.histMode === "week" ? "on" : ""}">השבוע</button>
    </div>` + crossHTML() + `<div class="list" id="hlist"></div>`;
  const wrap = sec.querySelector("#cw");
  wireQuadVocab(wrap);
  if (pts.length > 1) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "trail"); svg.setAttribute("viewBox", "0 0 100 100");
    const pl = document.createElementNS(ns, "polyline");
    pl.setAttribute("points", pts.map(p => { const q = toPct(p.x, p.y); return `${q.left},${q.top}`; }).join(" "));
    pl.setAttribute("fill", "none"); pl.setAttribute("stroke", "#b9a97e");
    pl.setAttribute("stroke-width", "0.5"); pl.setAttribute("stroke-dasharray", "1.2 1");
    svg.appendChild(pl); wrap.appendChild(svg);
  }
  pts.forEach(p => addPointEl(wrap, p.x, p.y, "hist"));
  const hl = sec.querySelector("#hlist");
  hl.innerHTML = pts.length ? "" : `<div class="muted" style="text-align:center">אין דיווחים עדיין.</div>`;
  [...pts].reverse().forEach(r => {
    const d = document.createElement("div"); d.className = "item";
    const q = quadInfo(r.x, r.y);
    d.innerHTML = `<span>${fmtTime(r.at.toDate())} · ${q.title}${r.daily ? " (ממוצע יומי)" : ""}</span>
      <span class="muted">${r.word ? r.word + " · " : ""}${r.y > 0 ? "+" + r.y : r.y}/${r.x > 0 ? "+" + r.x : r.x}</span>`;
    hl.appendChild(d);
  });
  sec.querySelectorAll(".seg button").forEach(b =>
    b.addEventListener("click", () => { state.histMode = b.dataset.m; renderHistory(); }));
}
// ---------- settings + reminders (opt-in) ----------
function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }
function isStandalone() { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; }

function renderSettings() {
  const sec = $("#view-settings");
  const m = state.members.find(x => x.id === state.user.uid) || {};
  const on = !!(m.reminders && m.reminders.enabled);
  let iosNote = "";
  if (isIOS() && !isStandalone())
    iosNote = `<p class="muted">באייפון: כדי לקבל תזכורות צריך קודם להוסיף את האתר למסך הבית
      (שיתוף ← הוספה למסך הבית) ואז להיכנס מהאייקון ולהפעיל כאן.</p>`;
  sec.innerHTML = `<div style="max-width:520px;margin:0 auto">
    <h3 style="margin:8px 0">תזכורות לדיווח</h3>
    <p class="muted">בערך 10 דקות לפני 08:00, 13:00, 20:00. בחירה אישית - אפשר לכבות בכל רגע.</p>
    ${iosNote}
    <button class="${on ? "ghost" : "primary"}" id="btn-rem">${on ? "כיבוי התזכורות" : "הפעלת תזכורות"}</button>
    <p class="muted" id="rem-msg"></p>
    <hr style="border-color:var(--line);margin:22px 0">
    <button class="ghost" id="btn-out">יציאה</button>
  </div>`;
  sec.querySelector("#btn-rem").addEventListener("click", () => toggleReminders(!on));
  sec.querySelector("#btn-out").addEventListener("click", () => signOut(auth));
}

async function toggleReminders(enable) {
  const msg = $("#rem-msg"); msg.textContent = "";
  const ref = doc(db, "members", state.user.uid);
  if (!enable) {
    await setDoc(ref, { reminders: { enabled: false, tokens: [] } }, { merge: true });
    renderSettings(); return;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { msg.textContent = "ההתראות לא אושרו במכשיר."; return; }
    if (!messaging) messaging = getMessaging(app);
    const reg = await navigator.serviceWorker.register("firebase-messaging-sw.js");
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) { msg.textContent = "לא נוצר אסימון התראות."; return; }
    await setDoc(ref, { reminders: { enabled: true, tokens: [token], updatedAt: new Date().toISOString() } }, { merge: true });
    renderSettings();
    $("#rem-msg").textContent = "התזכורות הופעלו.";
  } catch (e) { msg.textContent = "לא הצליח: " + (e.code || e.message); }
}
// ---------- data + navigation ----------
let unsubMembers = null, unsubReports = null;

async function enterApp() {
  $("#gate").classList.add("hidden");
  $("#tabs").classList.remove("hidden");
  $("#who").textContent = state.name;
  if (unsubMembers) unsubMembers();
  unsubMembers = onSnapshot(collection(db, "members"), (snap) => {
    state.members = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    refreshView();
  }, () => {});
  if (unsubReports) unsubReports();
  const q = query(collection(db, "reports"), where("uid", "==", state.user.uid), limit(120));
  unsubReports = onSnapshot(q, (snap) => {
    state.myReports = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ((b.at && b.at.toDate) ? b.at.toDate() : 0) - ((a.at && a.at.toDate) ? a.at.toDate() : 0));
    refreshView();
  }, () => {});
  try {
    if (!messaging) messaging = getMessaging(app);
    onMessage(messaging, () => {});
  } catch (e) {}
  showView("cross");
  try {
    const msnap = await getDoc(doc(db, "members", state.user.uid));
    state.welcomed = !!(msnap.exists() && msnap.data().welcomed);
    if (!state.welcomed) showView("help");
  } catch (e) { state.welcomed = true; }
}

function showView(v) {
  state.view = v;
  ["cross","team","history","settings","help"].forEach(k => {
    $("#view-" + k).classList.toggle("hidden", k !== v);
  });
  document.querySelectorAll("nav.tabs button").forEach(b =>
    b.classList.toggle("active", b.dataset.v === v));
  refreshView();
}

function refreshView() {
  if (!state.user) return;
  if (state.view === "cross") renderCross();
  else if (state.view === "team") renderTeam();
  else if (state.view === "history") renderHistory();
  else if (state.view === "settings") renderSettings();
  else if (state.view === "help") renderHelp();
}


// ---------- instructions / welcome ----------
function helpHTML(firstTime) {
  return `<div class="help">
    ${firstTime ? `<h2 style="margin:6px 0 2px">ברוכים הבאים לצלב העוררות</h2>
      <p class="muted">רגע לפני שמתחילים - סקירה קצרה של הרעיון והאפשרויות.</p>` :
      `<h2 style="margin:6px 0 2px">הוראות וסיור</h2>`}
    <div class="card">
      <h3>מה זה?</h3>
      <p>צלב העוררות הוא מפה משותפת של מצב הרגע. כל אחד ממקם נקודה לפי שני צירים:
        אנרגיה (מתת-עוררות עד יתר-עוררות) ואיכות (מ"לא נעימה / מתכווצת" עד "נעימה / מתרחבת").
        הצירים יוצרים ארבע שכונות: סוערת, התרגשות ויוזמה, כובד וניתוק, מנוחה והחלמה.
        לחיצה על שם של שכונה מציגה את המילים שלה.</p>
      <h3>למה?</h3>
      <p>כדי לאפשר לצוות להמשיך לנטר את המצבים האישיים וגם את המצב המשותף,
        ולשמור על דופק של הצוות לאורך היום.</p>
    </div>
    <div class="card">
      <h3>סיור קצר</h3>
      <ol>
        <li><b>הצלב</b> - לחיצה במקום שמתאר את הרגע ממקמת את הנקודה ופותחת דיווח.
          אפשר (לא חובה) לצרף מילה, קישור לשיר, או תמונה - ב"צילום עכשיו" מהמצלמה או "מהגלריה".
          שמירה מעדכנת את המיקום שלך. לחיצה על הנקודה שלך מציגה את הדיווח האחרון שלך.</li>
        <li><b>הצוות</b> - הנקודות העדכניות של כל חברי הצוות. לחיצה על נקודה של חבר מציגה
          את הדיווח האחרון שלו (שם, יום ושעה, ומה שצירף). "ממוצע צוותי" מציג את מרכז הכובד
          של הצוות. שים לב: כאן מוצג המצב העדכני של כל חבר, לא ההיסטוריה שלו.</li>
        <li><b>היסטוריה</b> - הדיווחים שלך: היום או השבוע, כנקודות על הצלב.</li>
        <li><b>הגדרות</b> - הפעלה אישית של תזכורות לדיווח (בשלב זה התזכורות עדיין לא נשלחות)
          ויציאה מהחשבון.</li>
      </ol>
    </div>
    <div class="card">
      <h3>פרטיות ובחירה</h3>
      <p>הכניסה אישית ומרצון, לחברי הצוות הרשומים בלבד. המילה, השיר והתמונה אופציונליים תמיד.
        מה שאתה משתף גלוי לחברי הצוות בלבד.</p>
    </div>
    ${firstTime ? `<div style="text-align:center;margin:18px 0 8px">
      <button class="primary" id="btn-start">מתחילים</button></div>` : ``}
  </div>`;
}

function renderHelp() {
  const sec = $("#view-help");
  const firstTime = !state.welcomed;
  sec.innerHTML = helpHTML(firstTime);
  if (firstTime) {
    sec.querySelector("#btn-start").addEventListener("click", async () => {
      state.welcomed = true;
      try { await setDoc(doc(db, "members", state.user.uid), { welcomed: true }, { merge: true }); } catch (e) {}
      showView("cross");
    });
  }
}

document.querySelectorAll("nav.tabs button").forEach(b =>
  b.addEventListener("click", () => showView(b.dataset.v)));
