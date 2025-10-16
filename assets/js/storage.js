const VERSION = '10.12.2';
const APP_URL = `https://www.gstatic.com/firebasejs/${VERSION}/firebase-app.js`;
const FIRESTORE_URL = `https://www.gstatic.com/firebasejs/${VERSION}/firebase-firestore.js`;
const AUTH_URL = `https://www.gstatic.com/firebasejs/${VERSION}/firebase-auth.js`;

const CSV_FIRESTORE_CHUNK_SIZE = 250;

function sanitizeRowForFirestore(row) {
  if (!row || typeof row !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined || value === null) {
      out[key] = null;
    } else if (value instanceof Date) {
      out[key] = value.toISOString();
    } else if (Number.isNaN(value)) {
      out[key] = null;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function hydrateRowFromFirestore(row) {
  if (!row || typeof row !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null) {
      out[key] = undefined;
    } else {
      out[key] = value;
    }
  }
  return out;
}

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
  if (!mod) {
    console.log('[storage] observeAuth: Firebase not available, calling callback with null user');
    cb(null);
    return;
  }
  const { auth, onAuthStateChanged } = mod;
  console.log('[storage] observeAuth: Setting up Firebase auth state observer');
  onAuthStateChanged(auth, user => {
    console.log('[storage] Auth state changed:', user ? `User: ${user.email}` : 'No user');
    cb(user);
  });
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
      const db = await ensureDb();
      if (!db) {
        console.warn('[storage] loadUserSettings: Firestore not available, falling back to localStorage');
        throw new Error('Firestore not available');
      }
      const m = await import(FIRESTORE_URL);
      const snap = await m.getDoc(m.doc(db, 'userSettings', uid));
      const data = snap.exists() ? snap.data() : {};
      console.log(`[storage] loadUserSettings(${key}): Loaded from Firestore:`, data?.[key]);
      return data?.[key] || null;
    } else {
      console.log('[storage] loadUserSettings: User not authenticated, falling back to localStorage');
    }
  } catch (e) {
    console.warn('[storage] loadUserSettings Firestore failed:', e.message);
  }
  try {
    const local = localStorage.getItem('userSettings');
    const parsed = local ? JSON.parse(local) : {};
    console.log(`[storage] loadUserSettings(${key}): Loaded from localStorage:`, parsed[key]);
    return parsed[key] ?? null;
  } catch (e) {
    console.warn('[storage] loadUserSettings localStorage failed:', e.message);
  }
  return null;
}

export async function saveUserSettings(key, value) {
  try {
    const mod = await ensureAuth();
    if (mod && mod.auth.currentUser) {
      const uid = mod.auth.currentUser.uid;
      const db = await ensureDb();
      if (!db) {
        console.warn('[storage] saveUserSettings: Firestore not available, falling back to localStorage');
        throw new Error('Firestore not available');
      }
      const m = await import(FIRESTORE_URL);
      await m.setDoc(m.doc(db, 'userSettings', uid), { [key]: value }, { merge: true });
      console.log(`[storage] saveUserSettings(${key}): Saved to Firestore:`, value);
      // Also save to localStorage as backup
      try {
        const all = JSON.parse(localStorage.getItem('userSettings') || '{}');
        all[key] = value;
        localStorage.setItem('userSettings', JSON.stringify(all));
        console.log(`[storage] saveUserSettings(${key}): Also saved to localStorage`);
      } catch (e) {
        console.warn('[storage] saveUserSettings localStorage backup failed:', e.message);
      }
      return true;
    } else {
      console.log('[storage] saveUserSettings: User not authenticated, saving to localStorage only');
    }
  } catch (e) {
    console.warn('[storage] saveUserSettings Firestore failed:', e.message);
  }
  try {
    const all = JSON.parse(localStorage.getItem('userSettings') || '{}');
    all[key] = value;
    localStorage.setItem('userSettings', JSON.stringify(all));
    console.log(`[storage] saveUserSettings(${key}): Saved to localStorage:`, value);
    return true;
  } catch (e) {
    console.warn('[storage] saveUserSettings localStorage failed:', e.message);
  }
  return false;
}

// CSV Data Storage
export async function saveCsvData(rows, headers, mapping) {
  const uploadedAt = new Date().toISOString();
  const dataToSave = {
    rows,
    headers,
    mapping,
    uploadedAt,
    rowCount: rows.length
  };

  let localSaved = true;
  try {
    localStorage.setItem('csvData', JSON.stringify(dataToSave));
  } catch (e) {
    localSaved = false;
    console.warn('[storage] saveCsvData localStorage failed', e);
  }

  let remoteSaved = false;
  try {
    const mod = await ensureAuth();
    if (mod && mod.auth.currentUser) {
      const uid = mod.auth.currentUser.uid;
      const db = await ensureDb();
      if (!db) {
        console.warn('[storage] saveCsvData Firestore not available');
        return localSaved;
      }
      const m = await import(FIRESTORE_URL);
      const chunkSize = CSV_FIRESTORE_CHUNK_SIZE;
      const chunkCount = rows.length ? Math.ceil(rows.length / chunkSize) : 0;
      const metadataToSave = {
        headers,
        mapping,
        uploadedAt,
        rowCount: rows.length,
        dataSource: 'firestoreChunks',
        chunks: { count: chunkCount, size: chunkSize }
      };

      const chunksCollection = m.collection(db, 'userData', uid, 'csvChunks');
      try {
        const existingChunks = await m.getDocs(chunksCollection);
        if (!existingChunks.empty) {
          for (const docSnap of existingChunks.docs) {
            try {
              await m.deleteDoc(docSnap.ref);
            } catch (err) {
              console.info('[storage] saveCsvData could not delete existing chunk, overwriting in place', err);
              try {
                const docData = docSnap.data() || {};
                await m.setDoc(docSnap.ref, { index: docData.index ?? 0, rows: [], stale: true, updatedAt: uploadedAt }, { merge: true });
              } catch (overwriteError) {
                console.warn('[storage] saveCsvData failed to clear existing chunk data', overwriteError);
              }
            }
          }
        }
      } catch (e) {
        console.warn('[storage] saveCsvData failed to clear existing chunks', e);
      }

      if (chunkCount > 0) {
        let batch = m.writeBatch(db);
        const commits = [];
        let opCount = 0;
        for (let idx = 0; idx < chunkCount; idx++) {
          const start = idx * chunkSize;
          const chunkRows = rows.slice(start, start + chunkSize).map(sanitizeRowForFirestore);
          const chunkRef = m.doc(db, 'userData', uid, 'csvChunks', `chunk-${String(idx).padStart(4, '0')}`);
          batch.set(chunkRef, { index: idx, rows: chunkRows, updatedAt: uploadedAt });
          opCount++;
          if (opCount >= 400) {
            commits.push(batch.commit());
            batch = m.writeBatch(db);
            opCount = 0;
          }
        }
        if (opCount > 0) {
          commits.push(batch.commit());
        }
        if (commits.length) {
          await Promise.all(commits);
        }
      }

      const metaRef = m.doc(db, 'userData', uid);
      await m.setDoc(metaRef, { csvMetadata: metadataToSave }, { merge: true });
      remoteSaved = true;
    }
  } catch (e) {
    console.warn('[storage] saveCsvData Firestore write failed', e);
  }

  return localSaved || remoteSaved;
}



export async function loadCsvData() {
  // Priority 1: If authenticated, load from Firebase (latest synced data)
  try {
    const mod = await ensureAuth();
    if (mod && mod.auth.currentUser) {
      const uid = mod.auth.currentUser.uid;
      const db = await ensureDb();
      if (!db) {
        console.warn('[storage] loadCsvData Firestore not available, falling back to localStorage');
      } else {
        const m = await import(FIRESTORE_URL);

        const userDoc = await m.getDoc(m.doc(db, 'userData', uid));
        if (userDoc.exists()) {
          const data = userDoc.data();

          // Handle legacy format
          if (data.csvData) {
            const csvData = data.csvData;
            try {
              localStorage.setItem('csvData', JSON.stringify(csvData));
            } catch (e) {
              console.warn('[storage] Failed to update localStorage with Firebase data', e);
            }
            console.log('[storage] loadCsvData: Loaded from Firebase (legacy format)');
            return csvData;
          }

          // Handle chunked format
          const metadata = data.csvMetadata;
          if (metadata) {
            const rows = [];
            const expectedChunks = metadata.chunks?.count ?? null;
            try {
              const chunkSnap = await m.getDocs(m.collection(db, 'userData', uid, 'csvChunks'));
              if (!chunkSnap.empty) {
                const sorted = chunkSnap.docs.sort((a, b) => {
                  const ai = a.data().index ?? 0;
                  const bi = b.data().index ?? 0;
                  return ai - bi;
                });
                for (const docSnap of sorted) {
                  const docData = docSnap.data();
                  if (Array.isArray(docData.rows)) {
                    for (const row of docData.rows) {
                      rows.push(hydrateRowFromFirestore(row));
                    }
                  }
                }
              }
            } catch (e) {
              console.warn('[storage] loadCsvData failed to read Firestore chunks', e);
            }

            if (expectedChunks != null && rows.length === 0) {
              console.warn('[storage] loadCsvData expected chunk data but none was retrieved');
            }

            const payload = {
              rows,
              headers: metadata.headers || [],
              mapping: metadata.mapping || {},
              uploadedAt: metadata.uploadedAt || new Date().toISOString(),
              rowCount: rows.length || metadata.rowCount || 0
            };
            try {
              localStorage.setItem('csvData', JSON.stringify(payload));
            } catch (e) {
              console.warn('[storage] loadCsvData failed to update localStorage with Firebase data', e);
            }
            console.log('[storage] loadCsvData: Loaded from Firebase (chunked format),', rows.length, 'rows');
            return payload;
          }
        }
        // No data in Firebase for authenticated user
        console.log('[storage] loadCsvData: No data in Firebase, falling back to localStorage');
      }
    }
  } catch (e) {
    console.warn('[storage] loadCsvData Firestore failed, falling back to localStorage:', e);
  }

  // Priority 2: Fallback to localStorage (offline or Firebase unavailable)
  try {
    const local = localStorage.getItem('csvData');
    if (local) {
      console.log('[storage] loadCsvData: Loaded from localStorage');
      return JSON.parse(local);
    }
  } catch (e) {
    console.warn('[storage] loadCsvData localStorage failed', e);
  }

  console.log('[storage] loadCsvData: No data found in Firebase or localStorage');
  return null;
}



export async function deleteCsvData() {
  let remoteDeleted = false;
  try {
    const mod = await ensureAuth();
    if (mod && mod.auth.currentUser) {
      const uid = mod.auth.currentUser.uid;
      const db = await ensureDb();
      if (db) {
        const m = await import(FIRESTORE_URL);
        try {
          const chunkSnap = await m.getDocs(m.collection(db, 'userData', uid, 'csvChunks'));
          if (!chunkSnap.empty) {
            for (const docSnap of chunkSnap.docs) {
              try {
                await m.deleteDoc(docSnap.ref);
              } catch (err) {
                console.warn('[storage] deleteCsvData failed to remove chunk document', err);
              }
            }
          }
        } catch (e) {
          console.warn('[storage] deleteCsvData failed to query chunk documents', e);
        }
        await m.updateDoc(m.doc(db, 'userData', uid), {
          csvData: m.deleteField(),
          csvMetadata: m.deleteField()
        });
        remoteDeleted = true;
      }
    }
  } catch (e) {
    console.warn('[storage] deleteCsvData Firestore failed', e);
  }

  let localDeleted = false;
  try {
    localStorage.removeItem('csvData');
    localDeleted = true;
  } catch (e) {
    console.warn('[storage] deleteCsvData localStorage failed', e);
  }
  return remoteDeleted || localDeleted;
}



// Demo state management for cross-platform demo tracking
export async function getDemoState(key) {
  try {
    const mod = await ensureAuth();
    if (mod && mod.auth.currentUser) {
      const uid = mod.auth.currentUser.uid;
      const m = await import(FIRESTORE_URL);
      const snap = await m.getDoc(m.doc(await ensureDb(), 'userSettings', uid));
      const data = snap.exists() ? snap.data() : {};
      return data?.[`demo_${key}`] || null;
    }
  } catch {}
  try {
    return localStorage.getItem(`qr_demo_${key}`);
  } catch {}
  return null;
}

export async function setDemoState(key, value) {
  try {
    const mod = await ensureAuth();
    if (mod && mod.auth.currentUser) {
      const uid = mod.auth.currentUser.uid;
      const m = await import(FIRESTORE_URL);
      await m.setDoc(m.doc(await ensureDb(), 'userSettings', uid), { [`demo_${key}`]: value }, { merge: true });
      return true;
    }
  } catch (e) { console.warn('[storage] setDemoState Firestore failed', e); }
  try {
    localStorage.setItem(`qr_demo_${key}`, value);
    return true;
  } catch {}
  return false;
}

// Test Firebase connection and settings functionality
export async function testFirebaseSettings() {
  console.log('[storage] Testing Firebase settings functionality...');

  try {
    const app = await ensureApp();
    if (!app) {
      console.warn('[storage] Firebase app not initialized');
      return { status: 'error', message: 'Firebase not configured' };
    }
    console.log('[storage] ✓ Firebase app initialized');

    const db = await ensureDb();
    if (!db) {
      console.warn('[storage] Firestore not available');
      return { status: 'error', message: 'Firestore not available' };
    }
    console.log('[storage] ✓ Firestore connected');

    const mod = await ensureAuth();
    if (!mod || !mod.auth.currentUser) {
      console.warn('[storage] User not authenticated');
      return { status: 'warning', message: 'User not authenticated - will use localStorage only' };
    }
    console.log('[storage] ✓ User authenticated:', mod.auth.currentUser.email);

    // Test settings save/load
    const testKey = 'test_' + Date.now();
    const testValue = 'test_value_' + Math.random();

    await saveUserSettings(testKey, testValue);
    console.log('[storage] ✓ Test save completed');

    const loaded = await loadUserSettings(testKey);
    console.log('[storage] ✓ Test load completed, got:', loaded);

    if (loaded === testValue) {
      console.log('[storage] ✓ Settings save/load test passed');
      return { status: 'success', message: 'Firebase settings working correctly' };
    } else {
      console.warn('[storage] ✗ Settings save/load test failed - values do not match');
      return { status: 'error', message: 'Settings save/load test failed' };
    }

  } catch (e) {
    console.warn('[storage] Firebase settings test failed:', e);
    return { status: 'error', message: e.message };
  }
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
    // Clean up demo state
    localStorage.removeItem('qr_demo_autoloaded');
    localStorage.removeItem('qr_demo_disabled');
    return true;
  } catch (e) {
    console.warn('[storage] deleteAllUserData localStorage failed', e);
  }
  return false;
}

