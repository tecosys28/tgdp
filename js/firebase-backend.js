/* ═══════════════════════════════════════════════════════════════════════════
   TGDP ECOSYSTEM - FIREBASE BACKEND
   Handles: Auth, Firestore, Storage for Registration & Live Sync
   ═══════════════════════════════════════════════════════════════════════════ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
         onAuthStateChanged, signOut, sendEmailVerification }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, collection,
         onSnapshot, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";

// ─── Firebase Init ───────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAsHHiCqvvlwzt3Zx7nwbKCnpmkWG-HPpc",
  authDomain: "tgdp-d4a3d.firebaseapp.com",
  projectId: "tgdp-d4a3d",
  storageBucket: "tgdp-d4a3d.firebasestorage.app",
  messagingSenderId: "399267274832",
  appId: "1:399267274832:web:202956b9af788eb96ff155",
  measurementId: "G-NHVPJS29MB"
};

const app      = initializeApp(FIREBASE_CONFIG);
const auth     = getAuth(app);
const db       = getFirestore(app);
const storage  = getStorage(app);
const analytics = getAnalytics(app);

// ─── Upload KYC Document to Firebase Storage ─────────────────────────────────
async function uploadKYCDoc(uid, file, docType) {
  if (!file) return null;
  const storageRef = ref(storage, `kyc/${uid}/${docType}_${Date.now()}_${file.name}`);
  const snapshot = await uploadBytes(storageRef, file);
  const url = await getDownloadURL(snapshot.ref);
  return url;
}

// ─── Register User ────────────────────────────────────────────────────────────
// Called from registration.html on form submit
window.firebaseRegisterUser = async function(formData) {
  const { email, password, firstName, lastName, phone, pan, aadhaar,
          address, city, state, pincode, roles,
          panDoc, aadhaarDoc, photoDoc, addressDoc } = formData;

  // 1. Create Firebase Auth account
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;
  const uid  = user.uid;

  // 2. Send email verification
  await sendEmailVerification(user);

  // 3. Upload KYC documents to Storage
  const [panDocUrl, aadhaarDocUrl, photoDocUrl, addressDocUrl] = await Promise.all([
    uploadKYCDoc(uid, panDoc,     'pan'),
    uploadKYCDoc(uid, aadhaarDoc, 'aadhaar'),
    uploadKYCDoc(uid, photoDoc,   'photo'),
    uploadKYCDoc(uid, addressDoc, 'address'),
  ]);

  // 4. Save user profile to Firestore /users/{uid}
  await setDoc(doc(db, 'users', uid), {
    uid,
    firstName,
    lastName,
    email,
    phone,
    pan:     pan.toUpperCase(),
    aadhaar,
    address,
    city,
    state,
    pincode,
    roles,
    primaryRole:   roles[0],
    status:        'pending_kyc',
    emailVerified: false,
    createdAt:     serverTimestamp(),
    updatedAt:     serverTimestamp(),
  });

  // 5. Save KYC record to Firestore /kyc/{uid}
  await setDoc(doc(db, 'kyc', uid), {
    userId:         uid,
    panDocUrl:      panDocUrl      || null,
    aadhaarDocUrl:  aadhaarDocUrl  || null,
    photoDocUrl:    photoDocUrl    || null,
    addressDocUrl:  addressDocUrl  || null,
    kycStatus:      'submitted',
    submittedAt:    serverTimestamp(),
    reviewedAt:     null,
    reviewedBy:     null,
    notes:          '',
  });

  return { uid, primaryRole: roles[0] };
};

// ─── Login ────────────────────────────────────────────────────────────────────
window.firebaseLogin = async function(email, password) {
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;
  const userDoc = await getDoc(doc(db, 'users', user.uid));
  if (!userDoc.exists()) throw new Error('User profile not found');
  return userDoc.data();
};

// ─── Logout ───────────────────────────────────────────────────────────────────
window.firebaseLogout = async function() {
  await signOut(auth);
  window.location.href = '/index.html';
};

// ─── Auth State Observer ──────────────────────────────────────────────────────
// Fires on every page load — redirects unauthenticated users from dashboards
window.initAuthGuard = function(requireAuth = true, redirectTo = '/registration.html') {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (requireAuth && !user) {
        window.location.href = redirectTo;
        return;
      }
      if (user) {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        resolve(userDoc.exists() ? userDoc.data() : null);
      } else {
        resolve(null);
      }
    });
  });
};

// ─── Real-time User Profile Sync ──────────────────────────────────────────────
// Call this on dashboard pages to keep UI in sync with Firestore
window.syncUserProfile = function(uid, onUpdate) {
  return onSnapshot(doc(db, 'users', uid), (snapshot) => {
    if (snapshot.exists()) onUpdate(snapshot.data());
  });
};

// ─── Real-time Balance Sync ───────────────────────────────────────────────────
window.syncTGDPBalance = function(uid, onUpdate) {
  return onSnapshot(doc(db, 'tgdp_balances', uid), (snapshot) => {
    onUpdate(snapshot.exists() ? snapshot.data() : { balance: 0 });
  });
};

window.syncFTRBalance = function(uid, onUpdate) {
  return onSnapshot(doc(db, 'ftr_balances', uid), (snapshot) => {
    onUpdate(snapshot.exists() ? snapshot.data() : { balance: 0 });
  });
};

// ─── Export for use in non-module scripts ────────────────────────────────────
window.tgdpAuth    = auth;
window.tgdpDB      = db;
window.tgdpStorage = storage;
