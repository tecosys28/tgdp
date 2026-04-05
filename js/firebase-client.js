// ═══════════════════════════════════════════════════════════════════════════
// TGDP ECOSYSTEM — CLIENT MODULE (PostgreSQL REST API edition)
// Firebase Auth + Firebase Storage remain unchanged.
// All Firestore reads and Cloud Function calls replaced with REST API calls.
// ═══════════════════════════════════════════════════════════════════════════

import { initializeApp }  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut, connectAuthEmulator }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getStorage, ref, uploadBytes, getDownloadURL, connectStorageEmulator }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { FIREBASE_CONFIG } from './firebase-config.js';

// ─── Init ─────────────────────────────────────────────────────────────────────

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
}

// ─── REST API helper ──────────────────────────────────────────────────────────

/**
 * Make an authenticated REST API call.
 * Automatically attaches the current user's Firebase ID token.
 * @param {string} path  e.g. '/users/me'
 * @param {object} [opts] fetch options (method, body, etc.)
 * @returns {Promise<any>} parsed JSON response
 */
async function apiFetch(path, opts = {}) {
  const user = auth.currentUser;
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

// ─── Auth ──────────────────────────────────────────────────────────────────────

/**
 * Require authenticated + active user. Returns user profile from REST API.
 * Redirects unauthenticated users to redirectTo.
 */
export function requireAuth(requiredRole = null, redirectTo = '/login.html') {
  return new Promise((resolve, reject) => {
    const check = async (user) => {
      if (!user) { window.location.href = redirectTo; return; }
      try {
        const profile = await apiFetch('/users/me');
        if (!profile || !profile.uid) { window.location.href = '/registration.html'; return; }
        if (requiredRole && (!profile.roles || !profile.roles.includes(requiredRole))) {
          window.location.href = '/index.html'; return;
        }
        resolve(profile);
      } catch (err) {
        if (err.status === 404) { window.location.href = '/registration.html'; return; }
        reject(err);
      }
    };

    if (typeof auth.authStateReady === 'function') {
      auth.authStateReady().then(() => check(auth.currentUser)).catch(reject);
    } else {
      const unsub = onAuthStateChanged(auth, user => { unsub(); check(user); });
    }
  });
}

export async function logout() {
  await signOut(auth);
  window.location.href = '/login.html';
}

// ─── Polling-based "real-time" listeners ──────────────────────────────────────
// Replace onSnapshot with setInterval polling every 5 seconds.
// Each function returns a cleanup/unsubscribe function matching the old contract.

/** Poll TGDP balance every 5 seconds. Returns unsubscribe fn. */
export function onTGDPBalance(uid, cb) {
  const fetch_ = () => apiFetch('/balances/tgdp').then(d => cb(d.balance || 0)).catch(() => {});
  fetch_();
  const id = setInterval(fetch_, 5000);
  return () => clearInterval(id);
}

/** Poll FTR balance every 5 seconds. Returns unsubscribe fn. */
export function onFTRBalance(uid, cb) {
  const fetch_ = () => apiFetch('/balances/ftr').then(d => cb(d)).catch(() => {});
  fetch_();
  const id = setInterval(fetch_, 5000);
  return () => clearInterval(id);
}

/** Poll GIC balance every 5 seconds. Returns unsubscribe fn. */
export function onGICBalance(uid, cb) {
  const fetch_ = () => apiFetch('/balances/gic').then(d => cb(d.balance || 0)).catch(() => {});
  fetch_();
  const id = setInterval(fetch_, 5000);
  return () => clearInterval(id);
}

/** Poll LBMA rate every 30 seconds (changes daily). Returns unsubscribe fn. */
export function onLBMARate(cb) {
  const fetch_ = () => fetch(API_BASE + '/config/lbma')
    .then(r => r.json()).then(d => cb(d.ratePerGram || 7342)).catch(() => {});
  fetch_();
  const id = setInterval(fetch_, 30000);
  return () => clearInterval(id);
}

// ─── Data reads ───────────────────────────────────────────────────────────────

export function getUserProfile(uid)         { return apiFetch(`/users/${uid}`); }
export function getTransactions(uid, n=20)  { return apiFetch(`/tgdp/transactions?limit=${n}`); }
export function getEarmarks(uid)            { return apiFetch('/tgdp/earmarks'); }
export function getFTRSwaps(uid, n=20)      { return apiFetch(`/ftr/swaps?limit=${n}`); }
export function getLicenseeHouseholds(uid)  { return apiFetch('/households'); }
export function getGICCredits(uid, n=30)    { return apiFetch(`/gic/credits?limit=${n}`); }
export function getUserComplaints(uid)      { return apiFetch('/complaints'); }
export function getOpenComplaints(n=50)     { return apiFetch(`/complaints/open?limit=${n}`); }
export function getUserReturns(uid)         { return apiFetch('/tjr/returns/mine'); }
export function getJewelerReturns(uid)      { return apiFetch('/tjr/returns/assigned'); }
export function getDesigns(n=50)            { return apiFetch(`/tjdb/designs?limit=${n}`); }
export function getDesignerDesigns(uid)     { return apiFetch('/tjdb/designs/mine'); }
export function getPendingKYC()             { return apiFetch('/kyc/pending'); }
export function getAllUsers(n=100)          { return apiFetch(`/users?limit=${n}`); }

// ─── Mutation calls (replace httpsCallable) ───────────────────────────────────

export function callMintTGDP(data)             { return apiFetch('/tgdp/mint',               { method:'POST', body: data }); }
export function callConfirmMint(data)          { return apiFetch(`/tgdp/mint/${data.mintId}/confirm`, { method:'POST', body: data }); }
export function callTradeTGDP(data)            { return apiFetch('/tgdp/trade',              { method:'POST', body: data }); }
export function callSwapToFTR(data)            { return apiFetch('/tgdp/swap',               { method:'POST', body: data }); }
export function callRedeemFTR(data)            { return apiFetch('/ftr/redeem',              { method:'POST', body: data }); }
export function callWithdrawTGDP(data)         { return apiFetch('/tgdp/withdraw',           { method:'POST', body: data }); }
export function callLinkHousehold(data)        { return apiFetch('/households/link',         { method:'POST', body: data }); }
export function callRedeemGIC(data)            { return apiFetch('/gic/redeem',              { method:'POST', body: data }); }
export function callFileComplaint(data)        { return apiFetch('/complaints',              { method:'POST', body: data }); }
export function callUpdateComplaint(data)      { return apiFetch(`/complaints/${data.complaintId}`, { method:'PATCH', body: data }); }
export function callSubmitJewelryReturn(data)  { return apiFetch('/tjr/returns',             { method:'POST', body: data }); }
export function callJewelerAssessment(data)    { return apiFetch(`/tjr/returns/${data.returnId}/assess`, { method:'PATCH', body: data }); }
export function callProcessReturnPayment(data) { return apiFetch(`/tjr/returns/${data.returnId}/pay`,    { method:'POST', body: data }); }
export function callRegisterDesign(data)       { return apiFetch('/tjdb/designs',            { method:'POST', body: data }); }
export function callPurchaseDesign(data)       { return apiFetch(`/tjdb/designs/${data.designId}/purchase`, { method:'POST', body: data }); }
export function callApproveKYC(data)           { return apiFetch('/kyc/approve',             { method:'POST', body: data }); }
export function callGetAdminStats()            { return apiFetch('/admin/stats'); }

// ─── Storage uploads (Firebase Storage — unchanged) ───────────────────────────

export async function uploadDesignFile(designerUid, file, fileType) {
  const storageRef = ref(storage, `designs/${designerUid}/${fileType}_${Date.now()}_${file.name}`);
  const snapshot   = await uploadBytes(storageRef, file);
  return getDownloadURL(snapshot.ref);
}

export async function uploadKYCDocument(uid, file, docType) {
  const storageRef = ref(storage, `kyc/${uid}/${docType}_${Date.now()}_${file.name}`);
  const snapshot   = await uploadBytes(storageRef, file);
  return getDownloadURL(snapshot.ref);
}

// ─── IPFS / Pinata ───────────────────────────────────────────────────────────
// Pinata JWT now comes from REST API (/config/ipfs) instead of Firestore.

const PINATA_GATEWAY      = 'https://gateway.pinata.cloud/ipfs/';
const PINATA_ENDPOINT     = 'https://api.pinata.cloud/pinning/pinFileToIPFS';
const PINATA_JSON_ENDPOINT= 'https://api.pinata.cloud/pinning/pinJSONToIPFS';

let _pinataJWT = null;

async function getPinataJWT() {
  if (_pinataJWT) return _pinataJWT;
  const data = await apiFetch('/config/ipfs');
  if (!data.pinataJWT) throw new Error('Pinata not configured. Set pinataJWT in server config.');
  _pinataJWT = data.pinataJWT;
  return _pinataJWT;
}

export async function pinFileToIPFS(file, name, keyvalues = {}) {
  const jwt = await getPinataJWT();
  const form = new FormData();
  form.append('file', file, name);
  form.append('pinataMetadata', JSON.stringify({ name, keyvalues }));
  form.append('pinataOptions',  JSON.stringify({ cidVersion: 1 }));
  const res = await fetch(PINATA_ENDPOINT, {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: form,
  });
  if (!res.ok) throw new Error(`Pinata upload failed: ${await res.text()}`);
  const json = await res.json();
  return { ipfsHash: json.IpfsHash, url: PINATA_GATEWAY + json.IpfsHash };
}

export async function pinJSONToIPFS(metadata, name) {
  const jwt = await getPinataJWT();
  const res = await fetch(PINATA_JSON_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ pinataContent: metadata, pinataMetadata: { name }, pinataOptions: { cidVersion: 1 } }),
  });
  if (!res.ok) throw new Error(`Pinata JSON pin failed: ${await res.text()}`);
  const json = await res.json();
  return { ipfsHash: json.IpfsHash, url: PINATA_GATEWAY + json.IpfsHash };
}

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
    active:'badge-success', completed:'badge-success', approved:'badge-success',
    paid:'badge-success', processing:'badge-warning', pending_verification:'badge-warning',
    pending_kyc:'badge-warning', submitted:'badge-info', assessed:'badge-info',
    filed:'badge-info', investigating:'badge-warning', mediation:'badge-warning',
    rejected:'badge-danger', resolved:'badge-success', closed:'badge-success',
  };
  return map[status] || 'badge-info';
}

// ─── Expose on window for non-module scripts ──────────────────────────────────
window.tgdpClient = {
  auth, storage,
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
  callConfirmMint,
  formatINR, formatTGDP, formatDate, timeSince, statusBadge,
};
