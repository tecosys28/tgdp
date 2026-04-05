/* ═══════════════════════════════════════════════════════════════════════════
   TGDP ECOSYSTEM — FIREBASE BACKEND (PostgreSQL REST API edition)
   Firebase Auth + Firebase Storage remain unchanged.
   All Firestore reads/writes replaced with REST API calls.
   ═══════════════════════════════════════════════════════════════════════════ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
         onAuthStateChanged, signOut, sendEmailVerification, sendPasswordResetEmail,
         GoogleAuthProvider, signInWithRedirect, getRedirectResult, connectAuthEmulator }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getStorage, ref, uploadBytes, getDownloadURL, connectStorageEmulator }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";
import { FIREBASE_CONFIG, GOOGLE_CLIENT_ID } from './firebase-config.js';

const IS_LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const API_BASE = IS_LOCAL ? 'http://localhost:3001/api/v1' : '/api/v1';

const app     = initializeApp(FIREBASE_CONFIG);
const auth    = getAuth(app);
const storage = getStorage(app);

if (IS_LOCAL) {
  if (!auth.emulatorConfig) {
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  }
  connectStorageEmulator(storage, 'localhost', 9199);
} else {
  getAnalytics(app);
}

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  client_id: GOOGLE_CLIENT_ID,
  prompt: 'select_account'
});

// ─── REST API helper ──────────────────────────────────────────────────────────

async function apiFetch(path, opts = {}) {
  const user  = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(API_BASE + path, {
    ...opts,
    headers,
    body: opts.body !== undefined
      ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body))
      : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error?.message || `API error ${res.status}`);
    err.code   = json.error?.code || 'UNKNOWN';
    err.status = res.status;
    throw err;
  }
  return json;
}

// ─── KYC Document Upload (Firebase Storage) ───────────────────────────────────

async function uploadKYCDoc(uid, file, docType) {
  if (!file) return null;
  const storageRef = ref(storage, `kyc/${uid}/${docType}_${Date.now()}_${file.name}`);
  const snapshot   = await uploadBytes(storageRef, file);
  return getDownloadURL(snapshot.ref);
}

// ─── Google Sign-In ───────────────────────────────────────────────────────────

window.firebaseGoogleSignIn = async function() {
  await signInWithRedirect(auth, googleProvider);
  return null;
};

window.checkGoogleRedirect = async function() {
  try {
    const result = await getRedirectResult(auth);
    if (!result) return null;
    const user = result.user;
    const uid  = user.uid;

    // Create profile in PostgreSQL if it doesn't already exist
    try {
      const existing = await apiFetch('/users/me');
      return { uid, isNewUser: false, ...existing };
    } catch (e) {
      if (e.status !== 404) throw e;
    }

    // New Google user — create profile
    const nameParts = (user.displayName || '').split(' ');
    await apiFetch('/users', {
      method: 'POST',
      body: {
        email:       user.email,
        firstName:   nameParts[0] || '',
        lastName:    nameParts.slice(1).join(' ') || '',
        roles:       [],
        primaryRole: null,
        authProvider:'google',
        photoURL:    user.photoURL || null,
      },
    });
    return { uid, isNewUser: true, primaryRole: null };
  } catch (err) {
    console.error('Google redirect error:', err);
    return null;
  }
};

// ─── Register User ────────────────────────────────────────────────────────────

window.firebaseRegisterUser = async function(formData) {
  const { email, password, firstName, lastName, phone, pan, aadhaar,
          address, city, state, pincode, roles,
          panDoc, aadhaarDoc, photoDoc, addressDoc } = formData;

  if (!roles || !roles.length) throw new Error('Please select at least one role.');

  // 1. Create Firebase Auth account
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;
  const uid  = user.uid;

  // 2. Send email verification
  await sendEmailVerification(user);

  // 3. Upload KYC docs to Firebase Storage
  const [panDocUrl, aadhaarDocUrl, photoDocUrl, addressDocUrl] = await Promise.all([
    uploadKYCDoc(uid, panDoc,     'pan'),
    uploadKYCDoc(uid, aadhaarDoc, 'aadhaar'),
    uploadKYCDoc(uid, photoDoc,   'photo'),
    uploadKYCDoc(uid, addressDoc, 'address'),
  ]);

  // 4. Save user profile + KYC to PostgreSQL via REST API
  await apiFetch('/users', {
    method: 'POST',
    body: {
      email, firstName, lastName, phone,
      pan: pan.toUpperCase(), aadhaar, address, city, state, pincode,
      roles, primaryRole: roles[0], authProvider: 'email',
      panDocUrl, aadhaarDocUrl, photoDocUrl, addressDocUrl,
    },
  });

  return { uid, primaryRole: roles[0] };
};

// ─── Login ────────────────────────────────────────────────────────────────────

window.firebaseLogin = async function(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
  // Token is now available — fetch profile from REST API
  const profile = await apiFetch('/users/me');
  if (!profile || !profile.uid) throw new Error('User profile not found');
  return profile;
};

// ─── Password Reset ──────────────────────────────────────────────────────────

window.firebaseResetPassword = async function(email) {
  await sendPasswordResetEmail(auth, email);
};

// ─── Logout ───────────────────────────────────────────────────────────────────

window.firebaseLogout = async function() {
  await signOut(auth);
  window.location.href = '/login.html';
};

// ─── Auth State Guard ─────────────────────────────────────────────────────────
// Waits for auth state to settle, then fetches profile from REST API.

window.initAuthGuard = function(requireAuth = true, redirectTo = '/registration.html') {
  return new Promise((resolve) => {
    const check = async (user) => {
      if (requireAuth && !user) { window.location.href = redirectTo; return; }
      if (user) {
        try {
          const profile = await apiFetch('/users/me');
          resolve(profile || null);
        } catch (e) {
          if (e.status === 404) { window.location.href = redirectTo; return; }
          resolve(null);
        }
      } else {
        resolve(null);
      }
    };
    if (typeof auth.authStateReady === 'function') {
      auth.authStateReady().then(() => check(auth.currentUser));
    } else {
      const unsub = onAuthStateChanged(auth, user => { unsub(); check(user); });
    }
  });
};

// ─── Polling-based profile + balance sync (replaces onSnapshot) ──────────────

window.syncUserProfile = function(_uid, onUpdate) {
  const fetch_ = () => apiFetch('/users/me').then(onUpdate).catch(() => {});
  fetch_();
  const id = setInterval(fetch_, 10000);
  return () => clearInterval(id);
};

window.syncTGDPBalance = function(_uid, onUpdate) {
  const fetch_ = () => apiFetch('/balances/tgdp').then(onUpdate).catch(() => {});
  fetch_();
  const id = setInterval(fetch_, 5000);
  return () => clearInterval(id);
};

window.syncFTRBalance = function(_uid, onUpdate) {
  const fetch_ = () => apiFetch('/balances/ftr').then(onUpdate).catch(() => {});
  fetch_();
  const id = setInterval(fetch_, 5000);
  return () => clearInterval(id);
};

// ─── Exports for inline scripts ───────────────────────────────────────────────
window.tgdpAuth    = auth;
window.tgdpStorage = storage;
