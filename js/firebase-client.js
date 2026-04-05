// ═══════════════════════════════════════════════════════════════════════════
// TGDP ECOSYSTEM — FIREBASE CLIENT
// Shared module imported by all portal dashboards.
// Provides: auth guard, real-time balance sync, Cloud Function calls,
// Firestore reads for transactions / complaints / returns / designs.
// ═══════════════════════════════════════════════════════════════════════════

import { initializeApp }       from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut, connectAuthEmulator }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, collection,
  getDoc, getDocs, onSnapshot,
  query, where, orderBy, limit,
  serverTimestamp, connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, connectStorageEmulator }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { getFunctions, httpsCallable, connectFunctionsEmulator }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

// ─── Init ─────────────────────────────────────────────────────────────────────

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAsHHiCqvvlwzt3Zx7nwbKCnpmkWG-HPpc",
  authDomain:        "tgdp-d4a3d.firebaseapp.com",
  projectId:         "tgdp-d4a3d",
  storageBucket:     "tgdp-d4a3d.firebasestorage.app",
  messagingSenderId: "399267274832",
  appId:             "1:399267274832:web:202956b9af788eb96ff155",
  measurementId:     "G-NHVPJS29MB"
};

const IS_LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

const app       = initializeApp(FIREBASE_CONFIG);
const auth      = getAuth(app);
const db        = getFirestore(app);
const storage   = getStorage(app);
const functions = getFunctions(app, 'asia-south1');

// ─── Local emulator auto-connect ──────────────────────────────────────────────
// Must connect immediately after get*() before any auth/db operations.
if (IS_LOCAL) {
  if (!auth.emulatorConfig) {
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  }
  connectFirestoreEmulator(db,   'localhost', 8080);
  connectStorageEmulator(storage,'localhost', 9199);
  connectFunctionsEmulator(functions, 'localhost', 5001);
}

// ─── Callable function wrappers ───────────────────────────────────────────────

export const callMintTGDP              = (data) => httpsCallable(functions, 'mintTGDP')(data);
export const callConfirmMint           = (data) => httpsCallable(functions, 'confirmMint')(data);
export const callTradeTGDP             = (data) => httpsCallable(functions, 'tradeTGDP')(data);
export const callSwapToFTR             = (data) => httpsCallable(functions, 'swapToFTR')(data);
export const callRedeemFTR             = (data) => httpsCallable(functions, 'redeemFTR')(data);
export const callWithdrawTGDP          = (data) => httpsCallable(functions, 'withdrawTGDP')(data);
export const callLinkHousehold         = (data) => httpsCallable(functions, 'linkHouseholdToLicensee')(data);
export const callRedeemGIC             = (data) => httpsCallable(functions, 'redeemGIC')(data);
export const callFileComplaint         = (data) => httpsCallable(functions, 'fileComplaint')(data);
export const callUpdateComplaint       = (data) => httpsCallable(functions, 'updateComplaint')(data);
export const callSubmitJewelryReturn   = (data) => httpsCallable(functions, 'submitJewelryReturn')(data);
export const callJewelerAssessment     = (data) => httpsCallable(functions, 'submitJewelerAssessment')(data);
export const callProcessReturnPayment  = (data) => httpsCallable(functions, 'processReturnPayment')(data);
export const callRegisterDesign        = (data) => httpsCallable(functions, 'registerDesign')(data);
export const callPurchaseDesign        = (data) => httpsCallable(functions, 'purchaseDesign')(data);
export const callApproveKYC            = (data) => httpsCallable(functions, 'approveKYC')(data);
export const callGetAdminStats         = ()     => httpsCallable(functions, 'getAdminStats')();

// ─── Auth ──────────────────────────────────────────────────────────────────────

/**
 * Require an authenticated, active user.
 * Returns the Firestore user profile doc.
 * If not authenticated → redirects to redirectTo.
 * If KYC pending → redirects to /registration.html to complete profile.
 * @param {string} requiredRole  - If set, also checks this role exists.
 * @param {string} redirectTo    - Where to send unauthenticated users.
 */
export function requireAuth(requiredRole = null, redirectTo = '/login.html') {
  return new Promise((resolve, reject) => {
    // Use authStateReady() to wait until the SDK has restored auth state from
    // localStorage before checking — avoids redirecting on the transient null
    // that fires before the session token is verified.
    const check = async (user) => {
      if (!user) { window.location.href = redirectTo; return; }
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!snap.exists()) { window.location.href = '/registration.html'; return; }
        const profile = snap.data();
        if (requiredRole && (!profile.roles || !profile.roles.includes(requiredRole))) {
          window.location.href = '/index.html'; return;
        }
        resolve({ uid: user.uid, ...profile });
      } catch (err) { reject(err); }
    };

    if (typeof auth.authStateReady === 'function') {
      // Firebase JS SDK v9.22+ — resolves once auth state is settled
      auth.authStateReady().then(() => check(auth.currentUser)).catch(reject);
    } else {
      // Older SDK: unsubscribe after first non-null-checking call
      const unsub = onAuthStateChanged(auth, user => {
        unsub();
        check(user);
      });
    }
  });
}

export async function logout() {
  await signOut(auth);
  window.location.href = '/login.html';
}

// ─── Real-time balance listeners ──────────────────────────────────────────────

/** Listen for TGDP balance changes. Returns unsubscribe fn. */
export function onTGDPBalance(uid, cb) {
  return onSnapshot(doc(db, 'tgdp_balances', uid), (snap) => {
    cb(snap.exists() ? (snap.data().balance || 0) : 0);
  });
}

/** Listen for FTR balance changes. Returns unsubscribe fn. */
export function onFTRBalance(uid, cb) {
  return onSnapshot(doc(db, 'ftr_balances', uid), (snap) => {
    cb(snap.exists() ? snap.data() : {});
  });
}

/** Listen for GIC balance changes. Returns unsubscribe fn. */
export function onGICBalance(uid, cb) {
  return onSnapshot(doc(db, 'gic_balances', uid), (snap) => {
    cb(snap.exists() ? (snap.data().balance || 0) : 0);
  });
}

/** Listen for live LBMA rate from config. */
export function onLBMARate(cb) {
  return onSnapshot(doc(db, 'config', 'lbma'), (snap) => {
    cb(snap.exists() ? (snap.data().ratePerGram || 7342) : 7342);
  });
}

// ─── Firestore reads ───────────────────────────────────────────────────────────

/** Get user profile by uid. */
export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}

/** Get recent TGDP transactions for a user (latest N). */
export async function getTransactions(uid, n = 20) {
  const q = query(
    collection(db, 'tgdp_transactions'),
    where('userId', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(n)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Get all earmarks (gold holdings) for a household. */
export async function getEarmarks(uid) {
  const q = query(
    collection(db, 'earmarks'),
    where('userId', '==', uid),
    orderBy('createdAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Get FTR swaps for a user. */
export async function getFTRSwaps(uid, n = 20) {
  const q = query(
    collection(db, 'ftr_swaps'),
    where('userId', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(n)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Get all households linked to a licensee. */
export async function getLicenseeHouseholds(licenseeUid) {
  const q = query(
    collection(db, 'household_links'),
    where('licenseeId', '==', licenseeUid),
    where('status', '==', 'active')
  );
  const snap = await getDocs(q);
  const links = snap.docs.map(d => d.data());

  // Fetch each household profile
  const profiles = await Promise.all(
    links.map(l => getUserProfile(l.householdId))
  );
  return profiles.filter(Boolean).map((p, i) => ({ ...p, linkId: links[i].linkId, linkedAt: links[i].linkedAt }));
}

/** Get GIC credit history for a licensee. */
export async function getGICCredits(licenseeUid, n = 30) {
  const q = query(
    collection(db, 'gic_credits'),
    where('licenseeId', '==', licenseeUid),
    orderBy('createdAt', 'desc'),
    limit(n)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Get complaints filed by a user. */
export async function getUserComplaints(uid) {
  const q = query(
    collection(db, 'complaints'),
    where('complainantId', '==', uid),
    orderBy('createdAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Get all open complaints (Ombudsman view). */
export async function getOpenComplaints(n = 50) {
  const q = query(
    collection(db, 'complaints'),
    where('status', 'in', ['filed', 'investigating', 'mediation']),
    orderBy('createdAt', 'asc'),
    limit(n)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Get T-JR returns for a user. */
export async function getUserReturns(uid) {
  const q = query(
    collection(db, 'tjr_returns'),
    where('userId', '==', uid),
    orderBy('createdAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Get returns assigned to a jeweler. */
export async function getJewelerReturns(jewelerUid) {
  const q = query(
    collection(db, 'tjr_returns'),
    where('jewelerId', '==', jewelerUid),
    orderBy('createdAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Get T-JDB designs (marketplace). */
export async function getDesigns(n = 50) {
  const q = query(
    collection(db, 'tjdb_designs'),
    where('status', '==', 'active'),
    orderBy('createdAt', 'desc'),
    limit(n)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Get designs by a specific designer. */
export async function getDesignerDesigns(designerUid) {
  const q = query(
    collection(db, 'tjdb_designs'),
    where('designerId', '==', designerUid),
    orderBy('createdAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Get all pending KYC submissions (Admin). */
export async function getPendingKYC() {
  const q = query(
    collection(db, 'kyc'),
    where('kycStatus', '==', 'submitted'),
    orderBy('submittedAt', 'asc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Get all users (Admin). */
export async function getAllUsers(n = 100) {
  const q = query(
    collection(db, 'users'),
    orderBy('createdAt', 'desc'),
    limit(n)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ─── Storage uploads ──────────────────────────────────────────────────────────

/** Upload a design file/image to Firebase Storage. Returns download URL. */
export async function uploadDesignFile(designerUid, file, fileType) {
  const storageRef = ref(storage, `designs/${designerUid}/${fileType}_${Date.now()}_${file.name}`);
  const snapshot   = await uploadBytes(storageRef, file);
  return getDownloadURL(snapshot.ref);
}

/** Upload a KYC document to Firebase Storage. Returns download URL. */
export async function uploadKYCDocument(uid, file, docType) {
  const storageRef = ref(storage, `kyc/${uid}/${docType}_${Date.now()}_${file.name}`);
  const snapshot   = await uploadBytes(storageRef, file);
  return getDownloadURL(snapshot.ref);
}

// ─── IPFS / Pinata ───────────────────────────────────────────────────────────
// Pinata API keys are fetched from Firestore /config/ipfs (admin-set, never hardcoded).
// Only the browser-safe JWT is exposed here; secret key stays in Cloud Functions.

const PINATA_GATEWAY = 'https://gateway.pinata.cloud/ipfs/';
const PINATA_ENDPOINT = 'https://api.pinata.cloud/pinning/pinFileToIPFS';
const PINATA_JSON_ENDPOINT = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';

let _pinataJWT = null;

/** Load Pinata JWT from Firestore /config/ipfs (cached). */
async function getPinataJWT() {
  if (_pinataJWT) return _pinataJWT;
  const snap = await getDoc(doc(db, 'config', 'ipfs'));
  if (!snap.exists() || !snap.data().pinataJWT) {
    throw new Error('Pinata not configured. Set /config/ipfs.pinataJWT in Firestore.');
  }
  _pinataJWT = snap.data().pinataJWT;
  return _pinataJWT;
}

/**
 * Pin a file (Blob/File) to IPFS via Pinata.
 * Used for: gold purity certificates, design files.
 * @param {File|Blob} file
 * @param {string}    name       Display name stored in Pinata metadata
 * @param {object}    keyvalues  Extra metadata key-values
 * @returns {{ ipfsHash, url }}
 */
export async function pinFileToIPFS(file, name, keyvalues = {}) {
  const jwt = await getPinataJWT();
  const form = new FormData();
  form.append('file', file, name);
  form.append('pinataMetadata', JSON.stringify({ name, keyvalues }));
  form.append('pinataOptions',  JSON.stringify({ cidVersion: 1 }));

  const res = await fetch(PINATA_ENDPOINT, {
    method:  'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body:    form,
  });
  if (!res.ok) throw new Error(`Pinata upload failed: ${await res.text()}`);
  const json = await res.json();
  return { ipfsHash: json.IpfsHash, url: PINATA_GATEWAY + json.IpfsHash };
}

/**
 * Pin a JSON metadata object to IPFS via Pinata.
 * Used for: design metadata (T-JDB), legal agreement records.
 * @param {object} metadata   JSON-serialisable object
 * @param {string} name       Display name in Pinata
 * @returns {{ ipfsHash, url }}
 */
export async function pinJSONToIPFS(metadata, name) {
  const jwt = await getPinataJWT();
  const res = await fetch(PINATA_JSON_ENDPOINT, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      pinataContent:  metadata,
      pinataMetadata: { name },
      pinataOptions:  { cidVersion: 1 },
    }),
  });
  if (!res.ok) throw new Error(`Pinata JSON pin failed: ${await res.text()}`);
  const json = await res.json();
  return { ipfsHash: json.IpfsHash, url: PINATA_GATEWAY + json.IpfsHash };
}

/**
 * Hash a file's content using SHA-256 (browser Web Crypto API).
 * Returns hex string suitable for use as a document fingerprint.
 * Used client-side before upload so the hash can be stored on-chain.
 */
export async function hashFile(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return '0x' + Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

export function formatINR(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0
  }).format(amount || 0);
}

export function formatTGDP(amount) {
  return (amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' TGDP';
}

export function formatDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function timeSince(ts) {
  if (!ts) return '—';
  const d    = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function statusBadge(status) {
  const map = {
    active:               'badge-success',
    completed:            'badge-success',
    approved:             'badge-success',
    paid:                 'badge-success',
    processing:           'badge-warning',
    pending_verification: 'badge-warning',
    pending_kyc:          'badge-warning',
    submitted:            'badge-info',
    assessed:             'badge-info',
    filed:                'badge-info',
    investigating:        'badge-warning',
    mediation:            'badge-warning',
    rejected:             'badge-danger',
    resolved:             'badge-success',
    closed:               'badge-success',
  };
  return map[status] || 'badge-info';
}

// ─── Expose on window for non-module scripts ──────────────────────────────────
window.tgdpClient = {
  auth, db, storage, functions,
  requireAuth, logout,
  onTGDPBalance, onFTRBalance, onGICBalance, onLBMARate,
  getUserProfile, getTransactions, getEarmarks, getFTRSwaps,
  getLicenseeHouseholds, getGICCredits,
  getUserComplaints, getOpenComplaints,
  getUserReturns, getJewelerReturns,
  getDesigns, getDesignerDesigns,
  getPendingKYC, getAllUsers,
  uploadDesignFile, uploadKYCDocument,
  pinFileToIPFS, pinJSONToIPFS, hashFile,
  callMintTGDP, callTradeTGDP, callSwapToFTR, callRedeemFTR,
  callWithdrawTGDP, callLinkHousehold, callRedeemGIC,
  callFileComplaint, callUpdateComplaint,
  callSubmitJewelryReturn, callJewelerAssessment, callProcessReturnPayment,
  callRegisterDesign, callPurchaseDesign,
  callApproveKYC, callGetAdminStats,
  formatINR, formatTGDP, formatDate, timeSince, statusBadge,
};
