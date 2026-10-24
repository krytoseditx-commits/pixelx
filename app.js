import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, getDoc, getDocs, writeBatch,
  query, orderBy, limit, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ============ CONFIGURATION (REQUIRED FOR CHAT) ============
   Firebase console > Project settings > General > Your apps > Web app > Config.
   These values are public identifiers, not secrets. Security comes from
   Authentication + Firestore Security Rules. NEVER put a service-account key here. */
const firebaseConfig = {
  apiKey: "AIzaSyCUsPMM79gHOn9inl2G3p9V2VuQUTkXfQg",
  authDomain: "pixel-x-231d8.firebaseapp.com",
  projectId: "pixel-x-231d8",
  storageBucket: "pixel-x-231d8.firebasestorage.app",
  messagingSenderId: "269773260223",
  appId: "1:269773260223:web:8c166e2a10b9ec203d4d0a"
};
const CONVERSATION_ID = "main"; // must match the document id in Firestore: conversations/main
const MAX_LEN = 500;
/* ============================================================ */

const $ = (id) => document.getElementById(id);

/* ---------- Tabs ---------- */
function showTab(name) {
  $("game").hidden = name !== "game";
  $("chat").hidden = name !== "chat";
  $("tabGame").classList.toggle("on", name === "game");
  $("tabChat").classList.toggle("on", name === "chat");
}
$("tabGame").onclick = () => showTab("game");
$("tabChat").onclick = () => showTab("chat");

/* ---------- Tic-Tac-Toe ---------- */
const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const KEY = "pixelx-scores";
let scores = { x: 0, o: 0, d: 0 };
try {
  const s = JSON.parse(localStorage.getItem(KEY));
  if (s) scores = { x: +s.x || 0, o: +s.o || 0, d: +s.d || 0 };
} catch (e) { /* ignore corrupt data */ }

let board, turn, over, starter = "X";
const cells = [];
for (let i = 0; i < 9; i++) {
  const b = document.createElement("button");
  b.className = "cell";
  b.type = "button";
  b.onclick = () => play(i);
  $("board").appendChild(b);
  cells.push(b);
}

function saveScores() {
  try { localStorage.setItem(KEY, JSON.stringify(scores)); } catch (e) {}
  $("sx").textContent = scores.x;
  $("so").textContent = scores.o;
  $("sd").textContent = scores.d;
}
function newRound() {
  board = Array(9).fill("");
  over = false;
  turn = starter;
  starter = starter === "X" ? "O" : "X"; // alternate who starts
  cells.forEach((c, i) => {
    c.textContent = "";
    c.disabled = false;
    c.className = "cell";
    c.setAttribute("aria-label", "Cell " + (i + 1) + ", empty");
  });
  $("status").textContent = "Player " + turn + "'s turn";
}
function play(i) {
  if (over || board[i]) return;
  board[i] = turn;
  cells[i].textContent = turn;
  cells[i].classList.add(turn.toLowerCase());
  cells[i].setAttribute("aria-label", "Cell " + (i + 1) + ", " + turn);
  const line = LINES.find((l) => l.every((k) => board[k] === turn));
  if (line) {
    over = true;
    scores[turn.toLowerCase()]++;
    line.forEach((k) => cells[k].classList.add("win"));
    $("status").textContent = "Player " + turn + " wins!";
  } else if (board.every(Boolean)) {
    over = true;
    scores.d++;
    $("status").textContent = "It's a draw";
  } else {
    turn = turn === "X" ? "O" : "X";
    $("status").textContent = "Player " + turn + "'s turn";
  }
  if (over) cells.forEach((c) => (c.disabled = true));
  saveScores();
}
$("newRound").onclick = newRound;
$("resetScores").onclick = () => {
  scores = { x: 0, o: 0, d: 0 };
  saveScores();
};
saveScores();
newRound();

/* ---------- Chat (Firebase) ---------- */
const configured = !Object.values(firebaseConfig).some((v) => String(v).startsWith("YOUR_"));
let auth, db, unsub = null, me = null;

function show(view) { // "login" | "denied" | "chat"
  $("loginForm").hidden = view !== "login";
  $("denied").hidden = view !== "denied";
  $("chatView").hidden = view !== "chat";
}

if (!configured) {
  $("setupWarn").hidden = false;
  show(null);
} else {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  show("login");
  onAuthStateChanged(auth, onUser);
}

const AUTH_ERRORS = {
  "auth/invalid-credential": "Wrong email or password.",
  "auth/invalid-email": "That email address is not valid.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/too-many-requests": "Too many attempts. Try again later.",
  "auth/network-request-failed": "Network error. Check your connection."
};

$("loginForm").onsubmit = async (e) => {
  e.preventDefault();
  $("loginErr").textContent = "";
  const email = $("email").value.trim();
  const pw = $("password").value;
  if (!email || pw.length < 6) { $("loginErr").textContent = "Enter your email and password."; return; }
  $("loginBtn").disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, pw);
    $("password").value = "";
  } catch (err) {
    $("loginErr").textContent = AUTH_ERRORS[err.code] || "Sign-in failed. Please try again.";
  } finally {
    $("loginBtn").disabled = false;
  }
};

const doSignOut = () => signOut(auth);
$("outBtn").onclick = doSignOut;
$("deniedOut").onclick = doSignOut;

async function onUser(user) {
  if (unsub) { unsub(); unsub = null; }
  me = user;
  $("msgs").textContent = "";
  if (!user) { show("login"); return; }
  $("myUid").textContent = user.uid;
  try {
    // Membership check: rules only allow members to read this document.
    await getDoc(doc(db, "conversations", CONVERSATION_ID));
  } catch (err) {
    show("denied");
    return;
  }
  show("chat");
  listen();
}

function setConn(state, text) {
  $("conn").className = "conn " + state;
  $("conn").querySelector("em").textContent = text;
}
window.addEventListener("online", () => setConn("", "Reconnecting…"));
window.addEventListener("offline", () => setConn("off", "Offline"));

function fmt(ts) {
  if (!ts) return "";
  const d = ts.toDate();
  const same = d.toDateString() === new Date().toDateString();
  return d.toLocaleString([], same
    ? { hour: "2-digit", minute: "2-digit" }
    : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function listen() {
  const q = query(
    collection(db, "conversations", CONVERSATION_ID, "messages"),
    orderBy("createdAt", "asc"), limit(200)
  );
  setConn("", "Connecting…");
  unsub = onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    if (!navigator.onLine) setConn("off", "Offline");
    else if (snap.metadata.fromCache) setConn("", "Connecting…");
    else setConn("ok", "Connected");

    const box = $("msgs");
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.textContent = "";
    snap.docs.forEach((d) => {
      const m = d.data({ serverTimestamps: "estimate" });
      const mine = m.uid === me.uid;
      const el = document.createElement("div");
      el.className = "msg " + (mine ? "me" : "them");
      el.appendChild(document.createTextNode(String(m.text))); // textContent only: no HTML injection
      const meta = document.createElement("span");
      meta.className = "meta";
      const state = mine ? (d.metadata.hasPendingWrites ? " · Sending…" : " · Sent") : "";
      meta.textContent = fmt(m.createdAt) + state;
      el.appendChild(meta);
      box.appendChild(el);
    });
    $("empty").hidden = !snap.empty;
    if (nearBottom || snap.docChanges().some((c) => c.type === "added")) box.scrollTop = box.scrollHeight;
  }, (err) => {
    setConn("off", "Connection error");
    $("sendErr").textContent = err.code === "permission-denied"
      ? "You are not allowed to read this conversation." : "Could not load messages.";
  });
}

$("msgInput").addEventListener("input", () => {
  $("count").textContent = $("msgInput").value.length;
});

$("sendForm").onsubmit = (e) => {
  e.preventDefault();
  $("sendErr").textContent = "";
  const text = $("msgInput").value.trim();
  if (!text) return;
  if (text.length > MAX_LEN) { $("sendErr").textContent = "Message is too long (max " + MAX_LEN + ")."; return; }
  if (!me) return;
  $("msgInput").value = "";
  $("count").textContent = "0";
  // Not awaited: while offline the write is queued and shown as "Sending…".
  addDoc(collection(db, "conversations", CONVERSATION_ID, "messages"), {
    text, uid: me.uid, createdAt: serverTimestamp()
  }).catch((err) => {
    $("sendErr").textContent = err.code === "permission-denied"
      ? "Message rejected: you are not authorized." : "Message failed to send. Please try again.";
    $("msgInput").value = text;
  });
};

/* ---------- Clear chat (with confirmation) ---------- */
$("clearBtn").onclick = () => $("confirm").showModal();
$("confirmNo").onclick = () => $("confirm").close();
$("confirmYes").onclick = async () => {
  $("confirmYes").disabled = true;
  try {
    const col = collection(db, "conversations", CONVERSATION_ID, "messages");
    let snap;
    do {
      snap = await getDocs(query(col, limit(400)));
      if (snap.empty) break;
      const batch = writeBatch(db);
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    } while (snap.size === 400);
    $("sendErr").textContent = "";
  } catch (err) {
    $("sendErr").textContent = "Could not clear the chat. Check your connection and try again.";
  } finally {
    $("confirmYes").disabled = false;
    $("confirm").close();
  }
};
