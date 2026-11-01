// צלב העוררות - צוות חמני. first test version (owner-only).
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
         getRedirectResult, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where,
         orderBy, limit, getDocs, serverTimestamp, onSnapshot, deleteField, arrayRemove }
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

const LEGACY_GID = "hamani";
const LEGACY_NAME = "צוות חמני";
const $ = (s) => document.querySelector(s);
const state = { user: null, name: "", members: [], myReports: [], view: "cross",
  histMode: "today", showAvg: false, draft: null, welcomed: true,
  group: LEGACY_GID, groups: [], groupNames: {}, profile: {}, allGroups: [], isAdmin: false, groupPhoto: null };

const DEFAULT_TIMES = ["07:50", "12:50", "19:50"];
const QA_REM = new URLSearchParams(location.search).has("qarem");
const qaRem = {
  get() { try { return JSON.parse(localStorage.getItem("qaReminders") || "{}"); } catch (e) { return {}; } },
  merge(patch) { const v = Object.assign({}, qaRem.get(), patch); localStorage.setItem("qaReminders", JSON.stringify(v)); }
};
function myMember() { return state.members.find(x => x.id === state.user.uid) || {}; }
function myReminders() { if (QA_REM) return qaRem.get(); return state.profile.reminders || {}; }
async function saveReminders(patch) {
  if (QA_REM) { qaRem.merge(patch); return; }
  const ref = doc(db, "members", state.user.uid);
  const flat = {};
  for (const k of Object.keys(patch)) flat["reminders." + k] = patch[k];
  try { await updateDoc(ref, flat); }
  catch (e) { await setDoc(ref, flat, { mergeFields: Object.keys(flat) }); }
  state.profile = Object.assign({}, state.profile);
  state.profile.reminders = Object.assign({}, state.profile.reminders, patch);
}

const HEB_DAYS = ["א׳","ב׳","ג׳","ד׳","ה׳","ו׳","ש׳"];
const QUADS = {
  UL: { title: "סוערת",   vocab: "חרדה · זעם · לחימה · בריחה · מתח גבוה" },
  UR: { title: "התרגשות ויוזמה",  vocab: "התרגשות · יוזמה · עשייה · פלואו · מרץ" },
  LL: { title: "כובד וניתוק",  vocab: "כובד · ניתוק · חוסר כוחות · שקיעה · ריק" },
  LR: { title: "מנוחה והחלמה",  vocab: "נינוחות · שלווה · מנוחה · הרפיה · החלמה" }
};
const OWNER_EMAIL = "idhadad@gmail.com";
function collG(gid, name) { return gid === LEGACY_GID ? collection(db, name) : collection(db, "groups", gid, name); }
function docG(gid, name, id) { return gid === LEGACY_GID ? doc(db, name, id) : doc(db, "groups", gid, name, id); }
function joinLink(gid) {
  return "https://idhadad-alt.github.io/arousal-cross/" + (gid === LEGACY_GID ? "" : "?g=" + gid);
}
// ---------- auth + roster gate ----------
async function checkRoster(user, gid) {
  const snap = await getDoc(docG(gid, "roster", user.email));
  return snap.exists() ? (snap.data().name || user.displayName || user.email) : null;
}

$("#btn-login").addEventListener("click", async () => {
  const msg = $("#gate-msg"); msg.classList.add("hidden");
  try {
    await signInWithRedirect(auth, new GoogleAuthProvider());
  } catch (e) { msg.textContent = "שגיאת כניסה: " + e.code; msg.classList.remove("hidden"); }
});
getRedirectResult(auth).catch(() => {});

onAuthStateChanged(auth, async (user) => {
  if (!user) { showGate(); return; }
  const urlG = new URLSearchParams(location.search).get("g");
  if (urlG) sessionStorage.setItem("pendingGroup", urlG);
  const targetG = urlG || sessionStorage.getItem("pendingGroup") ||
    localStorage.getItem("currentGroup") || LEGACY_GID;
  const name = await checkRoster(user, targetG).catch(() => null);
  if (name === null) {
    const msg = $("#gate-msg");
    msg.textContent = "הכתובת " + user.email + " לא נמצאת ברשימת הקבוצה הזו. פנה למנהל הקבוצה.";
    sessionStorage.removeItem("pendingGroup");
    msg.classList.remove("hidden");
    showGate(true);
    return;
  }
  state.user = user; state.name = name; state.group = targetG;
  localStorage.setItem("currentGroup", targetG);
  sessionStorage.removeItem("pendingGroup");
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
    const repRef = await addDoc(collG(state.group, "reports"), rec);
    const add = {};
    if (rec.word) add.word = rec.word;
    if (rec.songUrl) add.songUrl = rec.songUrl;
    if (rec.photo) add.photo = rec.photo;
    await setDoc(docG(state.group, "members", state.user.uid), {
      name: state.name, email: state.user.email,
      lastPoint: { x: rec.x, y: rec.y, at: new Date().toISOString(), rid: repRef.id },
      additions: add, lastReportId: repRef.id
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
  sec.innerHTML = (state.groupPhoto ? `<img src="${state.groupPhoto}" alt="תמונת קבוצה" style="width:100%;height:auto;max-height:340px;object-fit:contain;border-radius:12px;margin-bottom:8px">` : "")
    + `<div class="seg"><button id="btn-avg">${state.showAvg ? "הסתר ממוצע צוותי" : "ממוצע צוותי"}</button></div>` + crossHTML();
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
    if (!r.daily && r.id) {
      const btns = document.createElement("span");
      btns.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";
      if (r.photo) {
        const pr = document.createElement("button"); pr.className = "ghost"; pr.textContent = "מחיקת התמונה";
        pr.addEventListener("click", async () => {
          if (!pr.dataset.armed) { pr.dataset.armed = "1"; pr.textContent = "בטוח? לחץ שוב"; setTimeout(() => { pr.dataset.armed = ""; pr.textContent = "מחיקת התמונה"; }, 4000); return; }
          pr.disabled = true;
          try {
            await updateDoc(docG(state.group, "reports", r.id), { photo: deleteField() });
            const mref = docG(state.group, "members", state.user.uid);
            const ms = await getDoc(mref);
            if (ms.exists()) {
              const m = ms.data();
              const isLatest = m.lastReportId ? m.lastReportId === r.id : true;
              if (isLatest && m.additions && m.additions.photo === r.photo)
                await updateDoc(mref, { "additions.photo": deleteField() });
            }
            r.photo = null; renderHistory();
          } catch (e) { pr.disabled = false; }
        });
        btns.appendChild(pr);
      }
      const del = document.createElement("button"); del.className = "ghost"; del.textContent = "מחיקת הדיווח";
      del.addEventListener("click", async () => {
        if (!del.dataset.armed) { del.dataset.armed = "1"; del.textContent = "בטוח? לחץ שוב"; setTimeout(() => { del.dataset.armed = ""; del.textContent = "מחיקת הדיווח"; }, 4000); return; }
        del.disabled = true;
        try {
          await deleteDoc(docG(state.group, "reports", r.id));
          const mref = docG(state.group, "members", state.user.uid);
          const ms = await getDoc(mref);
          if (ms.exists()) {
            const m = ms.data(); const patch = {};
            // identity match on the report id; legacy docs (no lastReportId/rid) fall back to coordinates
            const isLatest = m.lastReportId ? m.lastReportId === r.id
              : (m.lastPoint && m.lastPoint.rid ? m.lastPoint.rid === r.id
              : (m.lastPoint && m.lastPoint.x === r.x && m.lastPoint.y === r.y));
            if (isLatest) {
              if (m.lastPoint) patch.lastPoint = deleteField();
              if (m.additions) {
                if (r.photo && m.additions.photo === r.photo) patch["additions.photo"] = deleteField();
                if (r.word && m.additions.word === r.word) patch["additions.word"] = deleteField();
                if (r.songUrl && m.additions.songUrl === r.songUrl) patch["additions.songUrl"] = deleteField();
              }
            }
            if (Object.keys(patch).length) await updateDoc(mref, patch);
          }
          state.myReports = state.myReports.filter(x => x.id !== r.id);
          renderHistory();
        } catch (e) { del.disabled = false; }
      });
      btns.appendChild(del);
      d.appendChild(btns);
    }
    hl.appendChild(d);
  });
  sec.querySelectorAll(".seg button").forEach(b =>
    b.addEventListener("click", () => { state.histMode = b.dataset.m; renderHistory(); }));
}
// ---------- settings + reminders (opt-in) ----------
function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }
function isStandalone() { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; }

// ---------- group admin: roster management (per current group) ----------
const isSuper = () => !!(state.user && state.user.email && state.user.email.toLowerCase() === OWNER_EMAIL);

function memberStatus(email) {
  const m = state.members.find(x => (x.email || "").toLowerCase() === email);
  if (!m) return "ברשימה - טרם נכנס";
  if (m.welcomed === true) return "נכנס והשלים את ההדרכה";
  if (m.welcomed === false) return "נכנס - לפני סיום ההדרכה";
  return "נכנס";
}

async function renderAdminList(sec) {
  const box = sec.querySelector("#admin-list");
  try {
    const snap = await getDocs(collG(state.group, "roster"));
    if (!snap.size) { box.innerHTML = `<div class="muted">הרשימה ריקה.</div>`; return; }
    box.innerHTML = "";
    snap.docs.map(d => { const r = d.data(); return { name: r.name, email: (r.email || d.id).toLowerCase() }; })
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "he"))
      .forEach(r => {
        const email = (r.email || "").toLowerCase();
        const item = document.createElement("div");
        item.className = "item";
        item.innerHTML = `<span><b>${r.name || ""}</b> <span class="muted" dir="ltr">${email}</span><br>
          <span class="muted">${memberStatus(email)}</span></span>`;
        if (email !== OWNER_EMAIL) {
          const del = document.createElement("button");
          del.className = "ghost"; del.textContent = "הסרה";
          del.addEventListener("click", async () => {
            if (del.dataset.armed) {
              del.disabled = true;
              try { await deleteDoc(docG(state.group, "roster", email)); } catch (e) {}
              renderAdminList(sec);
            } else {
              del.dataset.armed = "1"; del.textContent = "אישור הסרה";
              setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = "הסרה"; } }, 4000);
            }
          });
          item.appendChild(del);
        }
        box.appendChild(item);
      });
  } catch (e) { box.innerHTML = `<div class="muted">טעינת הרשימה נכשלה: ${e.code || e}</div>`; }
}

function wireAdmin(sec) {
  renderAdminList(sec);
  const msg = sec.querySelector("#a-msg");
  sec.querySelector("#a-add").addEventListener("click", async () => {
    const name = sec.querySelector("#a-name").value.trim();
    const email = sec.querySelector("#a-email").value.trim().toLowerCase();
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = "מלא שם וכתובת Gmail תקינה."; return; }
    try {
      await setDoc(docG(state.group, "roster", email), { name, email, addedAt: new Date().toISOString() });
      msg.textContent = name + " נוסף/ה לרשימה. שלח/י לו/לה את קישור ההצטרפות.";
      sec.querySelector("#a-name").value = ""; sec.querySelector("#a-email").value = "";
      renderAdminList(sec);
    } catch (e) { msg.textContent = "ההוספה נכשלה: " + (e.code || e); }
  });
  sec.querySelector("#a-copy").addEventListener("click", async () => {
    const link = joinLink(state.group);
    try { await navigator.clipboard.writeText(link); msg.textContent = "הקישור הועתק - שלח אותו רק למי שהזנת לרשימה."; }
    catch (e) {
      const t = document.createElement("textarea"); t.value = link; document.body.appendChild(t);
      t.select(); document.execCommand("copy"); t.remove();
      msg.textContent = "הקישור הועתק - שלח אותו רק למי שהזנת לרשימה.";
    }
  });
}

// ---------- super-admin: groups management + aggregate stats (no names) ----------
function fmtDateIL(d) { return d.toDateString(); }

async function renderSuper(sec) {
  const box = sec.querySelector("#super-groups");
  box.innerHTML = `<div class="muted">טוען...</div>`;
  try {
    const snap = await getDocs(collection(db, "groups"));
    state.allGroups = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const rows = [];
    // include the legacy group as an aggregate row too
    const legacyStats = await groupStats(LEGACY_GID);
    rows.push({ id: LEGACY_GID, name: LEGACY_NAME, approved: true, stats: legacyStats });
    for (const g of state.allGroups) rows.push({ ...g, stats: await groupStats(g.id) });
    box.innerHTML = "";
    rows.forEach(g => {
      const item = document.createElement("div");
      item.className = "item";
      const st = g.stats;
      const admins = (g.adminEmails || []).length;
      item.innerHTML = `<span><b>${g.name || g.id}</b><br>
          <span class="muted">${st.withPoint} משתתפים פעילים · ${st.activeToday} דיווחו היום · ${st.reportsToday} דיווחים היום` +
          (st.withPoint ? ` · מרכז קבוצתי ${st.avgY > 0 ? "+" + st.avgY : st.avgY}/${st.avgX > 0 ? "+" + st.avgX : st.avgX}` : "") +
          `</span></span>`;
      const btns = document.createElement("span");
      btns.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";
      const view = document.createElement("button");
      view.className = "ghost"; view.textContent = "צפייה בקבוצה";
      view.addEventListener("click", async () => {
        view.disabled = true;
        try {
          if (g.id !== LEGACY_GID) {
            const r = await getDoc(docG(g.id, "roster", state.user.email));
            if (!r.exists()) await setDoc(docG(g.id, "roster", state.user.email),
              { name: state.name, email: state.user.email, addedAt: new Date().toISOString() });
          }
          if (!state.groups.includes(g.id)) {
            const groups = [...state.groups, g.id];
            await updateDoc(doc(db, "members", state.user.uid), { groups });
            state.profile.groups = groups; state.groups = groups;
          }
          switchGroup(g.id);
        } catch (e) { view.disabled = false; }
      });
      btns.appendChild(view);
      item.appendChild(btns);
      box.appendChild(item);
    });
    if (!rows.length) box.innerHTML = `<div class="muted">אין קבוצות.</div>`;
  } catch (e) { box.innerHTML = `<div class="muted">טעינת הקבוצות נכשלה: ${e.code || e}</div>`; }
}

async function groupStats(gid) {
  // aggregate only - no names are read into the UI from here
  const out = { withPoint: 0, activeToday: 0, reportsToday: 0, avgX: 0, avgY: 0 };
  try {
    const msnap = await getDocs(collG(gid, "members"));
    const today = new Date().toDateString();
    let sx = 0, sy = 0;
    msnap.docs.forEach(d => {
      const lp = d.data().lastPoint;
      if (lp && typeof lp.x === "number") {
        out.withPoint++; sx += lp.x; sy += lp.y;
        if (lp.at && new Date(lp.at).toDateString() === today) out.activeToday++;
      }
    });
    if (out.withPoint) { out.avgX = Math.round(sx / out.withPoint * 10) / 10; out.avgY = Math.round(sy / out.withPoint * 10) / 10; }
    const rsnap = await getDocs(collG(gid, "reports"));
    rsnap.docs.forEach(d => {
      const at = d.data().at;
      if (at && at.toDate && at.toDate().toDateString() === today) out.reportsToday++;
    });
  } catch (e) {}
  return out;
}

function wireSuper(sec) {
  renderSuper(sec);
  renderAdmins(sec);
  const msg = sec.querySelector("#g-msg");
  const btn = sec.querySelector("#g-create");
  btn.addEventListener("click", async () => {
    const name = sec.querySelector("#g-name").value.trim();
    const adminEmail = sec.querySelector("#g-admin").value.trim().toLowerCase();
    msg.textContent = "";
    if (!name) { msg.textContent = "מלא שם לקבוצה."; return; }
    btn.disabled = true; msg.textContent = "יוצר...";
    const adminEmails = adminEmail && adminEmail !== OWNER_EMAIL ? [adminEmail, OWNER_EMAIL] : [OWNER_EMAIL];
    try {
      const ref = await addDoc(collection(db, "groups"), {
        name, adminEmails, approved: true, createdAt: new Date().toISOString()
      });
      await setDoc(docG(ref.id, "roster", OWNER_EMAIL),
        { name: state.name, email: OWNER_EMAIL, addedAt: new Date().toISOString() });
      if (adminEmail && adminEmail !== OWNER_EMAIL) {
        await setDoc(docG(ref.id, "roster", adminEmail),
          { name: "", email: adminEmail, addedAt: new Date().toISOString() });
      }
      msg.textContent = "הקבוצה נוצרה. קישור הצטרפות: " + joinLink(ref.id);
      sec.querySelector("#g-name").value = ""; sec.querySelector("#g-admin").value = "";
      renderSuper(sec);
    } catch (e) { msg.textContent = "יצירת הקבוצה נכשלה: " + (e.code || e); }
    btn.disabled = false;
  });
  const aMsg = sec.querySelector("#adm-msg"), aBtn = sec.querySelector("#adm-add");
  aBtn.addEventListener("click", async () => {
    const email = sec.querySelector("#adm-email").value.trim().toLowerCase();
    aMsg.textContent = "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { aMsg.textContent = "מלא כתובת Gmail תקינה."; return; }
    aBtn.disabled = true; aMsg.textContent = "מאשר...";
    try {
      await setDoc(doc(db, "admins", email), { addedAt: new Date().toISOString(), addedBy: OWNER_EMAIL });
      aMsg.textContent = email + " אושר כמנחה - הוא יכול עכשיו לפתוח קבוצות משלו.";
      sec.querySelector("#adm-email").value = "";
      renderAdmins(sec);
    } catch (e) { aMsg.textContent = "האישור נכשל: " + (e.code || e); }
    aBtn.disabled = false;
  });
}

async function renderAdmins(sec) {
  const box = sec.querySelector("#admins-list");
  if (!box) return;
  try {
    const snap = await getDocs(collection(db, "admins"));
    box.innerHTML = snap.empty ? `<div class="muted">אין מנחים מאושרים עדיין.</div>` : "";
    snap.docs.forEach(d => {
      const item = document.createElement("div"); item.className = "item";
      item.innerHTML = `<span>${d.id}</span>`;
      const del = document.createElement("button"); del.className = "ghost"; del.textContent = "הסרת הרשאה";
      del.addEventListener("click", async () => {
        if (!del.dataset.armed) { del.dataset.armed = "1"; del.textContent = "בטוח? יבוטל גם ניהול קבוצות"; setTimeout(() => { del.dataset.armed = ""; del.textContent = "הסרת הרשאה"; }, 4000); return; }
        del.disabled = true;
        const email = d.id;
        try {
          await deleteDoc(doc(db, "admins", email));
          const gs = await getDocs(collection(db, "groups"));
          for (const g of gs.docs) {
            const ae = g.data().adminEmails || [];
            if (ae.includes(email))
              await updateDoc(doc(db, "groups", g.id), { adminEmails: arrayRemove(email) }).catch(() => {});
          }
        } catch (e) {}
        renderAdmins(sec); renderSuper(sec);
      });
      item.appendChild(del); box.appendChild(item);
    });
  } catch (e) { box.innerHTML = `<div class="muted">טעינת המנחים נכשלה.</div>`; }
}

// ---------- approved facilitator (admin): create an own group directly ----------
function wireFacilitator(sec) {
  const msg = sec.querySelector("#f-msg");
  const btn = sec.querySelector("#f-create");
  btn.addEventListener("click", async () => {
    const name = sec.querySelector("#f-name").value.trim();
    msg.textContent = "";
    if (!name) { msg.textContent = "מלא שם לקבוצה."; return; }
    btn.disabled = true; msg.textContent = "יוצר...";
    const email = state.user.email.toLowerCase();
    try {
      const ref = await addDoc(collection(db, "groups"), {
        name, adminEmails: [email], approved: true, createdAt: new Date().toISOString()
      });
      await setDoc(docG(ref.id, "roster", email),
        { name: state.name, email, addedAt: new Date().toISOString() });
      const groups = [...new Set([...state.groups, ref.id])];
      try { await updateDoc(doc(db, "members", state.user.uid), { groups }); }
      catch (e) { await setDoc(doc(db, "members", state.user.uid), { groups }, { merge: true }); }
      state.profile.groups = groups; state.groups = groups;
      await loadGroupNames(); renderGroupSwitcher();
      msg.textContent = "הקבוצה נוצרה. קישור הצטרפות: " + joinLink(ref.id);
      sec.querySelector("#f-name").value = "";
    } catch (e) { msg.textContent = "יצירת הקבוצה נכשלה: " + (e.code || e); }
    btn.disabled = false;
  });
}

// ---------- group photo (group admin / super) ----------
function wireGroupPhoto(sec) {
  const cur = sec.querySelector("#gphoto-cur"), msg = sec.querySelector("#g-photo-msg");
  const btn = sec.querySelector("#g-photo-save"), inp = sec.querySelector("#g-photo");
  if (!btn) return;
  const showCur = () => {
    cur.innerHTML = state.groupPhoto
      ? `<img src="${state.groupPhoto}" alt="תמונת קבוצה" style="width:100%;height:auto;max-height:220px;object-fit:contain;border-radius:10px;margin:6px 0">`
      : `<div class="muted">אין תמונת קבוצה עדיין.</div>`;
  };
  showCur();
  btn.addEventListener("click", async () => {
    const f = inp.files[0];
    msg.textContent = "";
    if (!f) { msg.textContent = "בחר תמונה קודם."; return; }
    btn.disabled = true; msg.textContent = "שומר...";
    try {
      const data = await compressPhoto(f);
      await setDoc(doc(db, "groupMeta", state.group),
        { photo: data, updatedAt: new Date().toISOString(), updatedBy: state.user.email }, { merge: true });
      state.groupPhoto = data; showCur();
      msg.textContent = "תמונת הקבוצה נשמרה.";
    } catch (e) { msg.textContent = "שמירת התמונה נכשלה: " + (e.code || e); }
    btn.disabled = false;
  });
}

function renderSettings() {
  const sec = $("#view-settings");
  const rem = myReminders();
  const on = !!rem.enabled;
  const times = (rem.times && rem.times.length ? rem.times : DEFAULT_TIMES);
  const tstyle = "padding:8px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);width:96px";
  let iosNote = "";
  if (isIOS() && !isStandalone())
    iosNote = `<p class="muted">באייפון: כדי לקבל תזכורות צריך קודם להוסיף את האתר למסך הבית
      (שיתוף ← הוספה למסך הבית) ואז להיכנס מהאייקון ולהפעיל כאן.</p>`;
  sec.innerHTML = `<div style="max-width:520px;margin:0 auto">
    <h3 style="margin:8px 0">תזכורות לדיווח</h3>
    <p class="muted">בחירה אישית - אפשר לכבות בכל רגע ולהתאים את השעות. ברירת מחדל: 07:50, 12:50, 19:50.
      (בשלב זה התזכורות עדיין לא נשלחות בפועל)</p>
    ${iosNote}
    <div class="muted" style="font-size:.82rem;margin:8px 0 2px">שעות קבלת התזכורות</div>
    <div style="display:flex;gap:8px;direction:ltr;justify-content:center;margin:6px 0 10px">
      <input type="time" id="rt0" value="${times[0] || ""}" style="${tstyle}">
      <input type="time" id="rt1" value="${times[1] || ""}" style="${tstyle}">
      <input type="time" id="rt2" value="${times[2] || ""}" style="${tstyle}">
    </div>
    <div style="display:flex;gap:10px">
      <button class="${on ? "ghost" : "primary"}" id="btn-rem" style="flex:1">${on ? "כיבוי התזכורות" : "הפעלת תזכורות"}</button>
      <button class="ghost" id="btn-times" style="flex:1">שמירת שעות</button>
    </div>
    <p class="muted" id="rem-msg"></p>
    <hr style="border-color:var(--line);margin:22px 0">
    <button class="ghost" id="btn-out">יציאה</button>
    <div id="admin-slot"></div>
  </div>`;
  fillAdminSlot(sec);
  sec.querySelector("#btn-rem").addEventListener("click", async () => {
    const msg = $("#rem-msg"); msg.textContent = "";
    if (on) { await saveReminders({ enabled: false, tokens: [] }); renderSettings(); return; }
    const res = await enableReminders();
    if (res.ok) { renderSettings(); $("#rem-msg").textContent = "התזכורות הופעלו."; }
    else msg.textContent = reminderFailText(res);
  });
  sec.querySelector("#btn-times").addEventListener("click", async () => {
    const msg = $("#rem-msg");
    const vals = [0, 1, 2].map(i => sec.querySelector("#rt" + i).value).filter(v => /^\d{2}:\d{2}$/.test(v));
    if (!vals.length) { msg.textContent = "צריך לפחות שעה אחת תקינה."; return; }
    try { await saveReminders({ times: vals }); msg.textContent = "השעות נשמרו: " + vals.join(", "); }
    catch (e) { msg.textContent = "שמירת השעות נכשלה: " + (e.code || e); }
  });
  sec.querySelector("#btn-out").addEventListener("click", () => signOut(auth));
}

async function fillAdminSlot(sec) {
  const slot = sec.querySelector("#admin-slot");
  if (!slot) return;
  let gdoc = null;
  if (state.group !== LEGACY_GID) {
    try { const s = await getDoc(doc(db, "groups", state.group)); gdoc = s.exists() ? s.data() : null; } catch (e) {}
  }
  const email = (state.user.email || "").toLowerCase();
  const groupAdmin = isSuper() || (gdoc && Array.isArray(gdoc.adminEmails) && gdoc.adminEmails.includes(email));
  let html = "";
  if (groupAdmin) {
    html += `
    <hr style="border-color:var(--line);margin:22px 0">
    <h3 style="margin:8px 0">ניהול הקבוצה${state.groupNames[state.group] ? " · " + state.groupNames[state.group] : ""}</h3>
    <p class="muted">מי שמופיע כאן מורשה להיכנס לקבוצה הזו. שלח את קישור ההצטרפות בעצמך - האפליקציה לא שולחת דבר מאליה.</p>
    <div class="list" id="admin-list"><div class="muted">טוען...</div></div>
    <label style="display:block;font-size:.82rem;color:var(--muted);margin:12px 0 4px">שם</label>
    <input type="text" id="a-name" maxlength="40" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink)">
    <label style="display:block;font-size:.82rem;color:var(--muted);margin:10px 0 4px">כתובת ה-Gmail שלו</label>
    <input type="text" id="a-email" dir="ltr" placeholder="name@gmail.com" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink)">
    <div class="row" style="display:flex;gap:10px;margin-top:14px">
      <button class="primary" id="a-add" style="flex:1">הוספה לרשימה</button>
      <button class="ghost" id="a-copy" style="flex:1">העתקת קישור הצטרפות</button>
    </div>
    <p class="muted" id="a-msg"></p>
    <hr style="border-color:var(--line);margin:22px 0">
    <label style="display:block;font-size:.82rem;color:var(--muted);margin:12px 0 4px">תמונת קבוצה</label>
    <div id="gphoto-cur"></div>
    <input type="file" id="g-photo" accept="image/*" style="width:100%;margin:6px 0">
    <button class="ghost" id="g-photo-save" style="width:100%">שמירת תמונת הקבוצה</button>
    <p class="muted" id="g-photo-msg"></p>`;
  }
  if (isSuper()) {
    html += `
    <hr style="border-color:var(--line);margin:22px 0">
    <h3 style="margin:8px 0">מנחים מורשים (אדמינים)</h3>
    <p class="muted">מנחה שתאשר כאן יוכל לפתוח ולנהל קבוצות משלו. אפשר להסיר את ההרשאה בכל רגע - ההסרה מבטלת מיד גם פתיחת קבוצות חדשות וגם את ניהול הקבוצות שכבר פתח. הקבוצות והמשתתפים נשארים.</p>
    <div class="list" id="admins-list"><div class="muted">טוען...</div></div>
    <label style="display:block;font-size:.82rem;color:var(--muted);margin:12px 0 4px">כתובת ה-Gmail של המנחה</label>
    <input type="text" id="adm-email" dir="ltr" placeholder="name@gmail.com" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink)">
    <div class="row" style="display:flex;gap:10px;margin-top:14px">
      <button class="primary" id="adm-add" style="flex:1">אישור מנחה</button>
    </div>
    <p class="muted" id="adm-msg"></p>
    <hr style="border-color:var(--line);margin:22px 0">
    <h3 style="margin:8px 0">כל הקבוצות (סופר-אדמין)</h3>
    <p class="muted">סטטיסטיקה מצטברת בלבד, ללא שמות. צפייה בקבוצה מעבירה אותך אליה כמשתתף.</p>
    <div class="list" id="super-groups"><div class="muted">טוען...</div></div>
    <label style="display:block;font-size:.82rem;color:var(--muted);margin:12px 0 4px">שם קבוצה חדשה</label>
    <input type="text" id="g-name" maxlength="60" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink)">
    <label style="display:block;font-size:.82rem;color:var(--muted);margin:10px 0 4px">מנהל הקבוצה (Gmail, אופציונלי)</label>
    <input type="text" id="g-admin" dir="ltr" placeholder="name@gmail.com" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink)">
    <div class="row" style="display:flex;gap:10px;margin-top:14px">
      <button class="primary" id="g-create" style="flex:1">יצירת קבוצה</button>
    </div>
    <p class="muted" id="g-msg"></p>`;
  } else if (state.isAdmin) {
    html += `
    <hr style="border-color:var(--line);margin:22px 0">
    <h3 style="margin:8px 0">מנחים: פתיחת קבוצה חדשה</h3>
    <p class="muted">הקבוצה תיפתח מיד, ואז תוכל להזין שם ומוזמנים.</p>
    <input type="text" id="f-name" maxlength="60" placeholder="שם הקבוצה" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink)">
    <div class="row" style="display:flex;gap:10px;margin-top:14px">
      <button class="primary" id="f-create" style="flex:1">יצירת קבוצה</button>
    </div>
    <p class="muted" id="f-msg"></p>`;
  }
  slot.innerHTML = html;
  if (slot.querySelector("#a-add")) wireAdmin(sec);
  if (slot.querySelector("#g-create")) wireSuper(sec);
  if (slot.querySelector("#f-create")) wireFacilitator(sec);
  if (slot.querySelector("#g-photo-save")) wireGroupPhoto(sec);
}

async function enableReminders() {
  const unsupported = !window.isSecureContext || !("Notification" in window) ||
    !("serviceWorker" in navigator) || !("PushManager" in window);
  if (unsupported) return { ok: false, stage: "unsupported" };
  let perm;
  try { perm = await Notification.requestPermission(); }
  catch (e) { return { ok: false, stage: "perm-error", detail: String(e && e.message || e) }; }
  if (perm === "denied") return { ok: false, stage: "denied" };
  if (perm !== "granted") return { ok: false, stage: "dismissed" };
  try {
    if (!messaging) messaging = getMessaging(app);
    const reg = await navigator.serviceWorker.register("firebase-messaging-sw.js");
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) return { ok: false, stage: "token-empty" };
    const cur = myReminders();
    const patch = { enabled: true, tokens: [token], updatedAt: new Date().toISOString() };
    if (!cur.times || !cur.times.length) patch.times = DEFAULT_TIMES;
    await saveReminders(patch);
    return { ok: true };
  } catch (e) { return { ok: false, stage: "token-error", detail: String(e && e.code || e && e.message || e) }; }
}

function reminderFailText(r) {
  switch (r.stage) {
    case "unsupported":
      return "הדפדפן הזה לא תומך בהתראות. באנדרויד: כרום עדכני. באייפון: קודם מוסיפים את האתר למסך הבית ונכנסים מהאייקון.";
    case "denied":
      return "ההתראות חסומות לאתר בדפדפן. לאישור: לוחצים על סמל המנעול ליד שורת הכתובת ← הרשאות ← התראות ← אפשר, ואז מנסים שוב.";
    case "dismissed":
      return "חלון האישור של הדפדפן נסגר בלי לבחור אישור. מנסים שוב ולוחצים על אישור בחלון שקופץ.";
    case "perm-error":
    case "token-error":
    case "token-empty":
    default:
      return "שגיאה טכנית (" + r.stage + (r.detail ? ": " + r.detail : "") + "). נסו שוב, ואם חוזר - צלמו ושלחו לאלעד.";
  }
}

function showReminderPrompt() {
  const o = $("#overlay");
  o.innerHTML = `<div class="backdrop"></div><div class="popup">
    <h3 style="margin:2px 0 8px">תזכורות לדיווח?</h3>
    <p>אפשר לקבל תזכורת עד שלוש פעמים ביום - ברירת המחדל 07:50, 12:50, 19:50.
      אפשר לכבות בכל רגע או להתאים את השעות אישית בהגדרות.</p>
    <p class="muted">באותו דפדפן הכניסה נשמרת - מכאן והלאה נכנסים ישר לצלב. אחרי יציאה מהחשבון, ניקוי נתוני גלישה או מעבר למכשיר חדש נכנסים שוב עם גוגל.</p>
    <div class="row" style="display:flex;gap:10px;margin-top:12px">
      <button class="primary" id="rem-yes" style="flex:1">הפעלת תזכורות</button>
      <button class="ghost" id="rem-no" style="flex:1">לא עכשיו</button>
    </div>
    <p class="muted" id="rem-pop-msg" style="margin:8px 0 0"></p>
  </div>`;
  const yes = o.querySelector("#rem-yes"), no = o.querySelector("#rem-no"), msg = o.querySelector("#rem-pop-msg");
  no.addEventListener("click", async () => {
    try { await saveReminders({ asked: true }); } catch (e) {}
    closeOverlay();
  });
  yes.addEventListener("click", async () => {
    yes.disabled = true;
    // permission request must stay inside the user gesture - record the answer after
    const res = await enableReminders();
    try { await saveReminders({ asked: true }); } catch (e) {}
    if (res.ok) { closeOverlay(); return; }
    msg.textContent = reminderFailText(res);
    yes.classList.add("hidden");
    no.textContent = "סגור";
  });
}
// ---------- data + navigation ----------
let unsubMembers = null, unsubReports = null;

async function enterApp() {
  $("#gate").classList.add("hidden");
  $("#tabs").classList.remove("hidden");
  $("#who").textContent = state.name;
  if (unsubMembers) unsubMembers();
  unsubMembers = onSnapshot(collG(state.group, "members"), (snap) => {
    state.members = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (state.group === LEGACY_GID) {
      const mine = state.members.find(m => m.id === state.user.uid);
      if (mine) state.profile = Object.assign({}, state.profile, mine);
    }
    refreshView();
  }, () => {});
  if (unsubReports) unsubReports();
  const q = query(collG(state.group, "reports"), where("uid", "==", state.user.uid), limit(120));
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
  // profile (welcomed, reminders, group membership) lives in top-level members/{uid}
  let remAsked = true;
  try {
    const psnap = await getDoc(doc(db, "members", state.user.uid));
    state.profile = psnap.exists() ? psnap.data() : {};
    state.welcomed = !!state.profile.welcomed;
    if (!state.welcomed) { showView("help"); }
    remAsked = !!(state.profile.reminders && state.profile.reminders.asked);
    let groups = Array.isArray(state.profile.groups) && state.profile.groups.length
      ? state.profile.groups.slice() : [LEGACY_GID];
    if (!groups.includes(state.group)) {
      groups.push(state.group);
      try { await updateDoc(doc(db, "members", state.user.uid), { groups }); }
      catch (e) { await setDoc(doc(db, "members", state.user.uid), { groups }, { merge: true }); }
      state.profile.groups = groups;
    }
    state.groups = groups;
    await loadGroupNames();
  } catch (e) { state.welcomed = true; remAsked = true; state.groups = [state.group]; }
  renderGroupSwitcher();
  state.isAdmin = await fetchIsAdmin().catch(() => false);
  await loadGroupPhoto().catch(() => {});
  if (QA_REM) remAsked = !!qaRem.get().asked;
  if (!state.welcomed) return;
  if (!remAsked) showReminderPrompt();
}

async function loadGroupNames() {
  state.groupNames = {};
  for (const gid of state.groups) {
    if (gid === LEGACY_GID) { state.groupNames[gid] = LEGACY_NAME; continue; }
    try {
      const gsnap = await getDoc(doc(db, "groups", gid));
      state.groupNames[gid] = gsnap.exists() ? (gsnap.data().name || gid) : gid;
    } catch (e) { state.groupNames[gid] = gid; }
  }
}

async function fetchIsAdmin() {
  if (isSuper()) return true;
  try { return (await getDoc(doc(db, "admins", state.user.email.toLowerCase()))).exists(); }
  catch (e) { return false; }
}

async function loadGroupPhoto() {
  state.groupPhoto = null;
  try {
    const s = await getDoc(doc(db, "groupMeta", state.group));
    if (s.exists() && s.data().photo) state.groupPhoto = s.data().photo;
  } catch (e) {}
}

function renderGroupSwitcher() {
  const who = $("#who");
  if (state.groups.length < 2) { who.textContent = state.name; return; }
  who.innerHTML = "";
  const sel = document.createElement("select");
  sel.style.cssText = "font:inherit;background:transparent;border:1px solid var(--line);border-radius:8px;padding:2px 6px";
  state.groups.forEach(gid => {
    const opt = document.createElement("option");
    opt.value = gid; opt.textContent = (state.groupNames[gid] || gid) + " · " + state.name;
    if (gid === state.group) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener("change", () => { if (sel.value !== state.group) switchGroup(sel.value); });
  who.appendChild(sel);
}

async function switchGroup(gid) {
  state.group = gid;
  localStorage.setItem("currentGroup", gid);
  state.draft = null; closeOverlay();
  const name = await checkRoster(state.user, gid).catch(() => null);
  if (name) state.name = name;
  enterApp();
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
        <li><b>הגדרות</b> - הפעלה אישית של תזכורות לדיווח, התאמת שעות התזכורת, וכיבוי בכל רגע.
          (בשלב זה התזכורות עדיין לא נשלחות) גם יציאה מהחשבון.</li>
      </ol>
    </div>
    <div class="card">
      <h3>פרטיות ובחירה</h3>
      <p>הכניסה אישית ומרצון, לחברי הצוות הרשומים בלבד. המילה, השיר והתמונה אופציונליים תמיד.
        מה שאתה משתף גלוי לחברי הצוות בלבד.</p>
      <p>באותו דפדפן הכניסה נשמרת - מכאן והלאה נכנסים ישר לצלב. אחרי יציאה מהחשבון, ניקוי נתוני גלישה או מעבר למכשיר חדש נכנסים שוב עם גוגל.</p>
      <p>מנהל המערכת (אלעד) יכול לצפות בדיווחים בכל הקבוצות. סטטיסטיקה רוחבית בין קבוצות מוצגת ללא שמות.</p>
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
      if (!myReminders().asked) showReminderPrompt();
    });
  }
}

document.querySelectorAll("nav.tabs button").forEach(b =>
  b.addEventListener("click", () => showView(b.dataset.v)));
