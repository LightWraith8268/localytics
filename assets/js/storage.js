const VERSION = '10.12.2';
const APP_URL = `https://www.gstatic.com/firebasejs/${VERSION}/firebase-app.js`;
const FIRESTORE_URL = `https://www.gstatic.com/firebasejs/${VERSION}/firebase-firestore.js`;
const AUTH_URL = `https://www.gstatic.com/firebasejs/${VERSION}/firebase-auth.js`;

async function ensureApp() {
  const { getApps, initializeApp } = await import(APP_URL);
  let app = null;
  const apps = getApps();
  if (apps.length) { app = apps[0]; }
  else {
    try {
      const cfgMod = await import('./firebase.js');
      const config = cfgMod.default || cfgMod.firebaseConfig || cfgMod;
      app = initializeApp(config);
    } catch (e) {
      console.warn('[storage] No firebase config found');
      return null;
    }
  }
  return app;
}

async function ensureDb() {
  if (window.firebaseDb) return window.firebaseDb;
  const app = await ensureApp(); if (!app) return null;
  const { getFirestore } = await import(FIRESTORE_URL);
  return getFirestore(app);
}

async function ensureAuth() {
  const app = await ensureApp(); if (!app) return null;
  const { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } = await import(AUTH_URL);
  return { auth: getAuth(app), onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut };
}

export async function observeAuth(cb) {
  const mod = await ensureAuth();
  if (!mod) { cb(null); return; }
  const { auth, onAuthStateChanged } = mod;
  onAuthStateChanged(auth, user => cb(user));
}

export async function signInWithGoogle() {
  const mod = await ensureAuth(); if (!mod) return;
  const { auth, GoogleAuthProvider, signInWithPopup } = mod;
  const provider = new GoogleAuthProvider();
  try { await signInWithPopup(auth, provider); } catch (e) { alert('Sign-in failed: ' + e.message); }
}

export async function signOutUser() {
  const mod = await ensureAuth(); if (!mod) return;
  const { auth, signOut } = mod;
  try { await signOut(auth); } catch (e) { alert('Sign-out failed: ' + e.message); }
}

export async function saveReport(doc) {
  const db = await ensureDb(); if (!db) return null;
  const { addDoc, collection, serverTimestamp } = await import(FIRESTORE_URL).then(m => ({
    addDoc: m.addDoc, collection: m.collection, serverTimestamp: m.serverTimestamp
  }));
  try {
    const payload = { ...doc, ts: serverTimestamp() };
    const ref = await addDoc(collection(db, 'reports'), payload);
    return { id: ref.id };
  } catch (e) {
    console.warn('[storage] saveReport failed', e);
    return null;
  }
}

export async function listReports(limitCount = 20) {
  const db = await ensureDb(); if (!db) return [];
  const m = await import(FIRESTORE_URL);
  const q = m.query(m.collection(db, 'reports'), m.orderBy('ts','desc'), m.limit(limitCount));
  try {
    const snap = await m.getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[storage] listReports failed', e);
    return [];
  }
}

export async function loadReport(id) {
  const db = await ensureDb(); if (!db) return null;
  const m = await import(FIRESTORE_URL);
  try {
    const snap = await m.getDoc(m.doc(db, 'reports', id));
    return snap.exists() ? ({ id: snap.id, ...snap.data() }) : null;
  } catch (e) {
    console.warn('[storage] loadReport failed', e);
    return null;
  }
}

export async function deleteReport(id) {
  const db = await ensureDb(); if (!db) return false;
  const m = await import(FIRESTORE_URL);
  try { await m.deleteDoc(m.doc(db, 'reports', id)); return true; } catch (e) { console.warn('[storage] deleteReport failed', e); return false; }
}

