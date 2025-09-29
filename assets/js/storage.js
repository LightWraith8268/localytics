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
      // Validate config to avoid noisy errors with placeholders or missing fields
      const valid = config && typeof config === 'object' && typeof config.apiKey === 'string' && typeof config.projectId === 'string' && typeof config.appId === 'string' && !/YOUR_/.test(config.apiKey);
      if (!valid) {
        console.warn('[storage] Invalid Firebase config; skipping initialization');
        return null;
      }
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
  const mod = await ensureAuth();
  if (!mod) { alert('Sign-in is disabled because Firebase is not configured.\nAdd FIREBASE_CONFIG_JSON secret to the repo and enable Google provider in Firebase Auth.'); return; }
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
  const mod = await ensureAuth();
  if (!mod || !mod.auth.currentUser) { alert('Sign in to save reports.'); return null; }
  const user = mod.auth.currentUser;
  const { addDoc, collection, serverTimestamp } = await import(FIRESTORE_URL).then(m => ({
    addDoc: m.addDoc, collection: m.collection, serverTimestamp: m.serverTimestamp
  }));
  try {
    const payload = { ...doc, ts: serverTimestamp(), ownerUid: user.uid, ownerEmail: user.email || '', ownerName: user.displayName || '' };
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
  let q;
  try {
    const { auth } = await ensureAuth();
    const uid = auth?.currentUser?.uid || '';
    if (!uid) return [];
    q = m.query(
      m.collection(db, 'reports'),
      m.where('ownerUid','==', uid),
      m.orderBy('ts','desc'),
      m.limit(limitCount)
    );
  } catch {
    return [];
  }
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

export async function loadUserSettings(key) {
  // Try Firestore if signed in; else localStorage fallback
  try {
    const mod = await ensureAuth();
    if (mod && mod.auth.currentUser) {
      const uid = mod.auth.currentUser.uid;
      const m = await import(FIRESTORE_URL);
      const snap = await m.getDoc(m.doc(await ensureDb(), 'userSettings', uid));
      const data = snap.exists() ? snap.data() : {};
      return data?.[key] || null;
    }
  } catch {}
  try { const local = localStorage.getItem('userSettings'); return local ? (JSON.parse(local)[key] ?? null) : null; } catch {}
  return null;
}

export async function saveUserSettings(key, value) {
  try {
    const mod = await ensureAuth();
    if (mod && mod.auth.currentUser) {
      const uid = mod.auth.currentUser.uid;
      const m = await import(FIRESTORE_URL);
      await m.setDoc(m.doc(await ensureDb(), 'userSettings', uid), { [key]: value }, { merge: true });
      return true;
    }
  } catch (e) { console.warn('[storage] saveUserSettings Firestore failed', e); }
  try {
    const all = JSON.parse(localStorage.getItem('userSettings') || '{}');
    all[key] = value; localStorage.setItem('userSettings', JSON.stringify(all));
    return true;
  } catch {}
  return false;
}

// CSV Data Storage
export async function saveCsvData(rows, headers, mapping) {
  try {
    const mod = await ensureAuth();
    if (mod && mod.auth.currentUser) {
      const uid = mod.auth.currentUser.uid;
      const db = await ensureDb();
      const m = await import(FIRESTORE_URL);

      const dataToSave = {
        rows: rows,
        headers: headers,
        mapping: mapping,
        uploadedAt: new Date().toISOString(),
        rowCount: rows.length
      };

      await m.setDoc(m.doc(db, 'userData', uid), { csvData: dataToSave }, { merge: true });
      return true;
    }
  } catch (e) {
    console.warn('[storage] saveCsvData Firestore failed', e);
  }

  // Fallback to localStorage
  try {
    const dataToSave = {
      rows: rows,
      headers: headers,
      mapping: mapping,
      uploadedAt: new Date().toISOString(),
      rowCount: rows.length
    };
    localStorage.setItem('csvData', JSON.stringify(dataToSave));
    return true;
  } catch (e) {
    console.warn('[storage] saveCsvData localStorage failed', e);
  }
  return false;
}

export async function loadCsvData() {
  try {
    const mod = await ensureAuth();
    if (mod && mod.auth.currentUser) {
      const uid = mod.auth.currentUser.uid;
      const db = await ensureDb();
      const m = await import(FIRESTORE_URL);

      const snap = await m.getDoc(m.doc(db, 'userData', uid));
      if (snap.exists()) {
        const data = snap.data();
        return data.csvData || null;
      }
    }
  } catch (e) {
    console.warn('[storage] loadCsvData Firestore failed', e);
  }

  // Fallback to localStorage
  try {
    const local = localStorage.getItem('csvData');
    return local ? JSON.parse(local) : null;
  } catch (e) {
    console.warn('[storage] loadCsvData localStorage failed', e);
  }
  return null;
}

export async function deleteCsvData() {
  try {
    const mod = await ensureAuth();
    if (mod && mod.auth.currentUser) {
      const uid = mod.auth.currentUser.uid;
      const db = await ensureDb();
      const m = await import(FIRESTORE_URL);

      await m.updateDoc(m.doc(db, 'userData', uid), {
        csvData: m.deleteField()
      });
      return true;
    }
  } catch (e) {
    console.warn('[storage] deleteCsvData Firestore failed', e);
  }

  // Fallback to localStorage
  try {
    localStorage.removeItem('csvData');
    return true;
  } catch (e) {
    console.warn('[storage] deleteCsvData localStorage failed', e);
  }
  return false;
}

export async function deleteAllUserData() {
  try {
    const mod = await ensureAuth();
    if (mod && mod.auth.currentUser) {
      const uid = mod.auth.currentUser.uid;
      const db = await ensureDb();
      const m = await import(FIRESTORE_URL);

      // Delete user data document
      await m.deleteDoc(m.doc(db, 'userData', uid));

      // Delete user settings document
      await m.deleteDoc(m.doc(db, 'userSettings', uid));

      // Delete all user reports
      const q = m.query(
        m.collection(db, 'reports'),
        m.where('ownerUid', '==', uid)
      );
      const snap = await m.getDocs(q);
      const batch = m.writeBatch(db);
      snap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();

      return true;
    }
  } catch (e) {
    console.warn('[storage] deleteAllUserData Firestore failed', e);
  }

  // Fallback to localStorage
  try {
    localStorage.removeItem('csvData');
    localStorage.removeItem('userSettings');
    return true;
  } catch (e) {
    console.warn('[storage] deleteAllUserData localStorage failed', e);
  }
  return false;
}

