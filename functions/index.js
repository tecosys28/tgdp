// ═══════════════════════════════════════════════════════════════════════════
// TGDP ECOSYSTEM — CLOUD FUNCTIONS
// All write operations run server-side so clients can never manipulate
// balances, transactions, or commission calculations directly.
// ═══════════════════════════════════════════════════════════════════════════

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule }         = require('firebase-functions/v2/scheduler');
const { onDocumentCreated }  = require('firebase-functions/v2/firestore');
const admin                  = require('firebase-admin');
const { ethers }             = require('ethers');

admin.initializeApp();
const db = admin.firestore();

// ─── Blockchain helpers ───────────────────────────────────────────────────────

/**
 * Load contract addresses from Firestore /config/contracts.
 * Returns null if not yet deployed (blockchain recording is skipped gracefully).
 */
async function getContractAddresses() {
  const snap = await db.collection('config').doc('contracts').get();
  if (!snap.exists) return null;
  return snap.data();
}

/**
 * Get a signer for the REGISTRAR wallet.
 * Private key stored in Firebase Secret Manager as REGISTRAR_PRIVATE_KEY.
 * Returns null if not configured (pre-deployment mode).
 */
function getRegistrarSigner(rpcUrl) {
  const pk = process.env.REGISTRAR_PRIVATE_KEY;
  if (!pk) return null;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(pk, provider);
}

const RPC_URL = process.env.POLYGON_RPC_URL || 'https://rpc-amoy.polygon.technology';

/**
 * Record a transaction on-chain and save the tx hash to Firestore.
 * All blockchain errors are caught and logged — they never block the Firebase operation.
 *
 * @param {string}   operation   e.g. 'mint', 'earmark', 'designIPR', 'designSale'
 * @param {Function} fn          Async function that uses `signer` and returns { txHash, ... }
 * @param {string}   firestorePath  e.g. 'earmarks/MINT-XXX'  — doc to update with txHash
 */
async function recordOnChain(operation, fn, firestorePath) {
  try {
    const addresses = await getContractAddresses();
    if (!addresses) {
      console.log(`[blockchain] Contracts not deployed yet — skipping ${operation}`);
      return null;
    }
    const signer = getRegistrarSigner(RPC_URL);
    if (!signer) {
      console.log('[blockchain] REGISTRAR_PRIVATE_KEY not set — skipping on-chain record');
      return null;
    }

    const result = await fn(signer, addresses);

    // Save tx hash to Firestore for audit trail
    if (firestorePath && result && result.txHash) {
      const [col, docId] = firestorePath.split('/');
      await db.collection(col).doc(docId).update({
        blockchainTxHash:  result.txHash,
        blockchainNetwork: process.env.POLYGON_NETWORK || 'amoy',
        blockchainRecordedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    console.log(`[blockchain] ${operation} recorded: ${result?.txHash}`);
    return result;
  } catch (err) {
    // Never throw — blockchain recording is best-effort
    console.error(`[blockchain] ${operation} failed (non-fatal):`, err.message);
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireAuth(context) {
  if (!context.auth) throw new HttpsError('unauthenticated', 'Login required.');
  return context.auth.uid;
}

async function getUserDoc(uid) {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) throw new HttpsError('not-found', 'User not found.');
  return snap.data();
}

async function requireRole(uid, role) {
  const user = await getUserDoc(uid);
  if (!user.roles || !user.roles.includes(role)) {
    throw new HttpsError('permission-denied', `Role '${role}' required.`);
  }
  return user;
}

async function requireKYC(uid) {
  const user = await getUserDoc(uid);
  if (user.status !== 'active') {
    throw new HttpsError('failed-precondition', 'KYC verification required before this action.');
  }
  return user;
}

function generateId(prefix) {
  return prefix + '-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 5).toUpperCase();
}

// LBMA rate — stored in /config/lbma and refreshed by scheduler
async function getLBMARate() {
  const snap = await db.collection('config').doc('lbma').get();
  if (snap.exists && snap.data().ratePerGram) return snap.data().ratePerGram;
  return 7342; // safe fallback
}

// ─── Role compatibility (mirrors spec 4.2 and Solidity _validateRoles) ────────

const ROLE_INCOMPATIBILITIES = {
  ombudsman: ['licensee', 'household', 'jeweler', 'designer', 'returnee', 'consultant', 'advertiser'],
  jeweler:   ['household', 'returnee', 'designer', 'consultant', 'licensee'],
  household:  ['jeweler'],
  returnee:   ['jeweler'],
  designer:   ['jeweler'],
  consultant: ['jeweler'],
  licensee:   ['jeweler'],
};

function isRoleCombinationValid(roles) {
  if (!Array.isArray(roles) || roles.length === 0) return true;
  for (const role of roles) {
    const blocked = ROLE_INCOMPATIBILITIES[role] || [];
    for (const other of roles) {
      if (role !== other && blocked.includes(other)) return false;
    }
  }
  return true;
}

// ─── 1. KYC APPROVAL (Admin only) ─────────────────────────────────────────────

exports.approveKYC = onCall(async (request) => {
  const adminUid = requireAuth(request);
  await requireRole(adminUid, 'admin');

  const { targetUserId, approved, notes } = request.data;
  if (!targetUserId) throw new HttpsError('invalid-argument', 'targetUserId required.');

  // Validate role combination before approving
  if (approved) {
    const userSnap = await db.collection('users').doc(targetUserId).get();
    if (!userSnap.exists) throw new HttpsError('not-found', 'User not found.');
    const roles = userSnap.data().roles || [];
    if (!isRoleCombinationValid(roles)) {
      throw new HttpsError('failed-precondition',
        `User has incompatible roles [${roles.join(', ')}]. Fix roles before approving.`);
    }
  }

  const batch = db.batch();
  const status = approved ? 'active' : 'rejected';

  batch.update(db.collection('users').doc(targetUserId), {
    status,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  batch.update(db.collection('kyc').doc(targetUserId), {
    kycStatus:  approved ? 'approved' : 'rejected',
    reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
    reviewedBy: adminUid,
    notes:      notes || '',
  });

  batch.set(db.collection('audit_logs').doc(), {
    action:    approved ? 'kyc_approved' : 'kyc_rejected',
    adminUid,
    targetUserId,
    notes:     notes || '',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();
  return { success: true, status };
});

// ─── 2. MINT TGDP ─────────────────────────────────────────────────────────────
// Triggered after admin approves a gold earmarking request.
// Input: { goldGrams, purity, itemDescription, jewelerId }

exports.mintTGDP = onCall(async (request) => {
  const uid = requireAuth(request);
  await requireKYC(uid);
  await requireRole(uid, 'household');

  const { goldGrams, purity, itemDescription, jewelerId } = request.data;
  if (!goldGrams || goldGrams <= 0) throw new HttpsError('invalid-argument', 'goldGrams must be > 0.');
  if (![999, 916, 875, 750, 585, 417].includes(purity)) throw new HttpsError('invalid-argument', 'Invalid purity value.');

  const purityFactor = purity / 1000;
  const pureGoldGrams = goldGrams * purityFactor;
  const tgdpAmount    = Math.floor(pureGoldGrams * 10); // 10 TGDP per pure gram
  const rate          = await getLBMARate();
  const valueINR      = Math.round(pureGoldGrams * rate);
  const mintId        = generateId('MINT');

  const batch = db.batch();

  // Create earmarking record (pending admin confirmation)
  batch.set(db.collection('earmarks').doc(mintId), {
    mintId,
    userId:         uid,
    jewelerId:      jewelerId || null,
    goldGrams,
    purity,
    pureGoldGrams,
    tgdpAmount,
    valueINR,
    itemDescription: itemDescription || '',
    status:          'pending_verification',
    createdAt:       admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:       admin.firestore.FieldValue.serverTimestamp(),
  });

  // Audit log
  batch.set(db.collection('audit_logs').doc(), {
    action:    'mint_requested',
    userId:    uid,
    mintId,
    tgdpAmount,
    goldGrams,
    purity,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();
  return { success: true, mintId, tgdpAmount, status: 'pending_verification' };
});

// ─── 3. CONFIRM MINT (Admin approves earmarking) ──────────────────────────────

exports.confirmMint = onCall(async (request) => {
  const adminUid = requireAuth(request);
  await requireRole(adminUid, 'admin');

  const { mintId, approved, rejectionReason } = request.data;
  if (!mintId) throw new HttpsError('invalid-argument', 'mintId required.');

  const earmarkSnap = await db.collection('earmarks').doc(mintId).get();
  if (!earmarkSnap.exists) throw new HttpsError('not-found', 'Earmark not found.');
  const earmark = earmarkSnap.data();
  if (earmark.status !== 'pending_verification') {
    throw new HttpsError('failed-precondition', 'Earmark already processed.');
  }

  const batch = db.batch();

  if (approved) {
    // Credit TGDP balance
    batch.set(db.collection('tgdp_balances').doc(earmark.userId), {
      balance:   admin.firestore.FieldValue.increment(earmark.tgdpAmount),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Transaction record
    const txId = generateId('TX');
    batch.set(db.collection('tgdp_transactions').doc(txId), {
      txId,
      type:        'mint',
      userId:      earmark.userId,
      amount:      earmark.tgdpAmount,
      goldGrams:   earmark.goldGrams,
      purity:      earmark.purity,
      description: `Gold minted: ${earmark.itemDescription}`,
      status:      'completed',
      mintId,
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    });

    batch.update(db.collection('earmarks').doc(mintId), {
      status:     'active',
      approvedBy: adminUid,
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
    });
  } else {
    batch.update(db.collection('earmarks').doc(mintId), {
      status:          'rejected',
      rejectedBy:      adminUid,
      rejectionReason: rejectionReason || '',
      updatedAt:       admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  batch.set(db.collection('audit_logs').doc(), {
    action:    approved ? 'mint_approved' : 'mint_rejected',
    adminUid,
    mintId,
    userId:    earmark.userId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();

  // ── Blockchain recording (best-effort, post-commit) ──────────────────────
  if (approved) {
    const goldMilligrams = Math.round(earmark.pureGoldGrams * 1000);
    const certHash       = ethers.keccak256(ethers.toUtf8Bytes(mintId));
    const tgdpWei        = ethers.parseUnits(String(earmark.tgdpAmount), 18);

    // 1. Earmark gold in Registry
    await recordOnChain('earmarkGold', async (signer, addr) => {
      const REGISTRY_ABI = [
        'function earmarkGold(address owner, bytes32 certificateHash, uint256 pureGoldMilligrams, uint256 tgdpAmount) returns (bytes32)',
      ];
      const registry = new ethers.Contract(addr.registry, REGISTRY_ABI, signer);
      const tx       = await registry.earmarkGold(earmark.userId, certHash, BigInt(goldMilligrams), tgdpWei);
      const receipt  = await tx.wait();
      return { txHash: receipt.hash };
    }, `earmarks/${mintId}`);

    // 2. Mint TGDP on-chain
    await recordOnChain('mintTGDP', async (signer, addr) => {
      const TGDP_ABI = [
        'function mint(address to, uint256 goldMilligrams, bytes32 certificateHash) returns (bytes32)',
      ];
      const tgdp    = new ethers.Contract(addr.tgdpToken, TGDP_ABI, signer);
      const tx      = await tgdp.mint(earmark.userId, BigInt(goldMilligrams), certHash);
      const receipt = await tx.wait();
      return { txHash: receipt.hash };
    }, null); // tx hash written to earmarks doc by first recordOnChain already
  }

  return { success: true, approved };
});

// ─── 4. TRADE TGDP (Peer-to-peer, 0% fee) ────────────────────────────────────

exports.tradeTGDP = onCall(async (request) => {
  const uid = requireAuth(request);
  await requireKYC(uid);
  await requireRole(uid, 'household');

  const { toUserId, amount, note } = request.data;
  if (!toUserId || toUserId === uid) throw new HttpsError('invalid-argument', 'Invalid recipient.');
  if (!amount || amount <= 0) throw new HttpsError('invalid-argument', 'Amount must be > 0.');

  // Verify recipient exists and is active
  const recipient = await getUserDoc(toUserId);
  if (recipient.status !== 'active') throw new HttpsError('failed-precondition', 'Recipient not active.');

  const senderRef = db.collection('tgdp_balances').doc(uid);
  const txId      = generateId('TRADE');

  await db.runTransaction(async (t) => {
    const senderSnap = await t.get(senderRef);
    const senderBalance = senderSnap.exists ? (senderSnap.data().balance || 0) : 0;
    if (senderBalance < amount) throw new HttpsError('failed-precondition', 'Insufficient TGDP balance.');

    // Debit sender
    t.set(senderRef, {
      balance:   admin.firestore.FieldValue.increment(-amount),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Credit recipient
    t.set(db.collection('tgdp_balances').doc(toUserId), {
      balance:   admin.firestore.FieldValue.increment(amount),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Transaction record
    t.set(db.collection('tgdp_transactions').doc(txId), {
      txId,
      type:        'trade',
      fromUserId:  uid,
      toUserId,
      amount,
      fee:         0,
      note:        note || '',
      status:      'completed',
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { success: true, txId, amount };
});

// ─── 5. SWAP TGDP → FTR (4% commission) ──────────────────────────────────────

exports.swapToFTR = onCall(async (request) => {
  const uid = requireAuth(request);
  await requireKYC(uid);
  await requireRole(uid, 'household');

  const { tgdpAmount, ftrCategory } = request.data;
  if (!tgdpAmount || tgdpAmount <= 0) throw new HttpsError('invalid-argument', 'tgdpAmount must be > 0.');
  if (![1, 2, 3, 4, 5].includes(ftrCategory)) throw new HttpsError('invalid-argument', 'ftrCategory must be 1–5.');

  const FTR_COMMISSION = 0.04;
  const commission     = Math.round(tgdpAmount * FTR_COMMISSION);
  const ftrAmount      = tgdpAmount - commission;
  const rate           = await getLBMARate();
  const ftrValueINR    = Math.round((ftrAmount / 10) * rate); // TGDP → grams → INR

  // Expiry: 12 months from now
  const expiryDate = new Date();
  expiryDate.setFullYear(expiryDate.getFullYear() + 1);

  const senderRef  = db.collection('tgdp_balances').doc(uid);
  const ftrRef     = db.collection('ftr_balances').doc(uid);
  const swapId     = generateId('SWAP');

  await db.runTransaction(async (t) => {
    const snap = await t.get(senderRef);
    const balance = snap.exists ? (snap.data().balance || 0) : 0;
    if (balance < tgdpAmount) throw new HttpsError('failed-precondition', 'Insufficient TGDP balance.');

    // Debit TGDP
    t.set(senderRef, {
      balance:   admin.firestore.FieldValue.increment(-tgdpAmount),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Credit FTR (category-keyed map inside balance doc)
    t.set(ftrRef, {
      [`cat_${ftrCategory}`]: admin.firestore.FieldValue.increment(ftrValueINR),
      updatedAt:              admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Swap record
    t.set(db.collection('ftr_swaps').doc(swapId), {
      swapId,
      userId:      uid,
      tgdpAmount,
      commission,
      ftrAmount,
      ftrValueINR,
      ftrCategory,
      expiryDate:  admin.firestore.Timestamp.fromDate(expiryDate),
      status:      'active',
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    });

    // Platform commission credited to config/revenue
    t.set(db.collection('config').doc('revenue'), {
      totalFTRCommission: admin.firestore.FieldValue.increment(commission),
      updatedAt:          admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  return { success: true, swapId, ftrAmount, ftrValueINR, commission, expiryDate: expiryDate.toISOString() };
});

// ─── 6. REDEEM FTR ────────────────────────────────────────────────────────────

exports.redeemFTR = onCall(async (request) => {
  const uid = requireAuth(request);
  await requireKYC(uid);

  const { ftrCategory, amountINR, partnerName, redemptionNote } = request.data;
  if (!ftrCategory || !amountINR || amountINR <= 0) throw new HttpsError('invalid-argument', 'ftrCategory and amountINR required.');

  const ftrRef    = db.collection('ftr_balances').doc(uid);
  const redeemId  = generateId('REDEEM');

  await db.runTransaction(async (t) => {
    const snap = await t.get(ftrRef);
    const catBalance = snap.exists ? (snap.data()[`cat_${ftrCategory}`] || 0) : 0;
    if (catBalance < amountINR) throw new HttpsError('failed-precondition', 'Insufficient FTR balance.');

    t.set(ftrRef, {
      [`cat_${ftrCategory}`]: admin.firestore.FieldValue.increment(-amountINR),
      updatedAt:              admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    t.set(db.collection('ftr_redemptions').doc(redeemId), {
      redeemId,
      userId:         uid,
      ftrCategory,
      amountINR,
      partnerName:    partnerName || '',
      redemptionNote: redemptionNote || '',
      status:         'completed',
      createdAt:      admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { success: true, redeemId };
});

// ─── 7. WITHDRAW TGDP → INR ───────────────────────────────────────────────────

exports.withdrawTGDP = onCall(async (request) => {
  const uid = requireAuth(request);
  await requireKYC(uid);
  await requireRole(uid, 'household');

  const { tgdpAmount, bankAccountNumber, ifscCode, accountHolderName } = request.data;
  if (!tgdpAmount || tgdpAmount <= 0) throw new HttpsError('invalid-argument', 'tgdpAmount must be > 0.');
  if (!bankAccountNumber || !ifscCode) throw new HttpsError('invalid-argument', 'Bank details required.');

  const rate       = await getLBMARate();
  const pureGrams  = tgdpAmount / 10;
  const amountINR  = Math.round(pureGrams * rate);
  const withdrawId = generateId('WD');

  const balanceRef = db.collection('tgdp_balances').doc(uid);

  await db.runTransaction(async (t) => {
    const snap    = await t.get(balanceRef);
    const balance = snap.exists ? (snap.data().balance || 0) : 0;
    if (balance < tgdpAmount) throw new HttpsError('failed-precondition', 'Insufficient TGDP balance.');

    t.set(balanceRef, {
      balance:   admin.firestore.FieldValue.increment(-tgdpAmount),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    t.set(db.collection('tgdp_withdrawals').doc(withdrawId), {
      withdrawId,
      userId:             uid,
      tgdpAmount,
      amountINR,
      ratePerGram:        rate,
      bankAccountNumber,
      ifscCode,
      accountHolderName:  accountHolderName || '',
      status:             'processing',
      createdAt:          admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:          admin.firestore.FieldValue.serverTimestamp(),
    });

    t.set(db.collection('tgdp_transactions').doc(generateId('TX')), {
      type:        'withdrawal',
      userId:      uid,
      amount:      -tgdpAmount,
      amountINR,
      description: `Withdrawal to ****${bankAccountNumber.slice(-4)}`,
      status:      'processing',
      withdrawId,
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { success: true, withdrawId, amountINR, status: 'processing' };
});

// ─── 8. LINK HOUSEHOLD TO LICENSEE ───────────────────────────────────────────

exports.linkHouseholdToLicensee = onCall(async (request) => {
  const licenseeUid = requireAuth(request);
  await requireKYC(licenseeUid);
  await requireRole(licenseeUid, 'licensee');

  const { householdUserId } = request.data;
  if (!householdUserId) throw new HttpsError('invalid-argument', 'householdUserId required.');

  const household = await getUserDoc(householdUserId);
  if (!household.roles || !household.roles.includes('household')) {
    throw new HttpsError('failed-precondition', 'Target user is not a household.');
  }

  // Check if already linked
  const existing = await db.collection('household_links')
    .where('householdId', '==', householdUserId)
    .where('status', '==', 'active')
    .limit(1).get();
  if (!existing.empty) throw new HttpsError('already-exists', 'Household already linked to a licensee.');

  const linkId = generateId('LINK');
  await db.collection('household_links').doc(linkId).set({
    linkId,
    licenseeId:  licenseeUid,
    householdId: householdUserId,
    status:      'active',
    linkedAt:    admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, linkId };
});

// ─── 9. CREDIT GIC TO LICENSEE ───────────────────────────────────────────────
// Called automatically when a linked household does a registration / mint / FTR swap.
// Also callable by admin to manually credit.

async function creditGIC(licenseeUid, stream, amount, sourceRef) {
  const GIC_SHARE   = 0.25;
  const gicAmount   = Math.round(amount * GIC_SHARE);
  const creditId    = generateId('GIC');

  const batch = db.batch();
  batch.set(db.collection('gic_balances').doc(licenseeUid), {
    balance:   admin.firestore.FieldValue.increment(gicAmount),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  batch.set(db.collection('gic_credits').doc(creditId), {
    creditId,
    licenseeId: licenseeUid,
    stream,     // 'registration' | 'minting' | 'trading'
    amount:     gicAmount,
    sourceRef:  sourceRef || '',
    createdAt:  admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();
  return gicAmount;
}

exports.creditGICManual = onCall(async (request) => {
  const adminUid = requireAuth(request);
  await requireRole(adminUid, 'admin');
  const { licenseeUid, stream, amount, sourceRef } = request.data;
  const credited = await creditGIC(licenseeUid, stream, amount, sourceRef);
  return { success: true, credited };
});

// ─── 10. REDEEM GIC ───────────────────────────────────────────────────────────

exports.redeemGIC = onCall(async (request) => {
  const uid = requireAuth(request);
  await requireKYC(uid);
  await requireRole(uid, 'licensee');

  const { gicAmount, bankAccountNumber, ifscCode } = request.data;
  if (!gicAmount || gicAmount <= 0) throw new HttpsError('invalid-argument', 'gicAmount must be > 0.');

  const balanceRef = db.collection('gic_balances').doc(uid);
  const redeemId   = generateId('GICR');

  await db.runTransaction(async (t) => {
    const snap    = await t.get(balanceRef);
    const balance = snap.exists ? (snap.data().balance || 0) : 0;
    if (balance < gicAmount) throw new HttpsError('failed-precondition', 'Insufficient GIC balance.');

    t.set(balanceRef, {
      balance:   admin.firestore.FieldValue.increment(-gicAmount),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    t.set(db.collection('gic_redemptions').doc(redeemId), {
      redeemId,
      licenseeId:        uid,
      gicAmount,
      bankAccountNumber: bankAccountNumber || '',
      ifscCode:          ifscCode || '',
      status:            'processing',
      createdAt:         admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { success: true, redeemId };
});

// ─── 11. FILE COMPLAINT ───────────────────────────────────────────────────────

exports.fileComplaint = onCall(async (request) => {
  const uid = requireAuth(request);
  await requireKYC(uid);

  const { portal, category, subject, description, respondentId } = request.data;
  if (!portal || !subject || !description) throw new HttpsError('invalid-argument', 'portal, subject, description required.');

  const complaintId  = generateId('CMP');
  const ackDeadline  = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const resDeadline  = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  await db.collection('complaints').doc(complaintId).set({
    complaintId,
    complainantId:      uid,
    respondentId:       respondentId || null,
    portal,
    category:           category || 'general',
    subject,
    description,
    status:             'filed',
    stage:              'acknowledgment',
    ackDeadline:        admin.firestore.Timestamp.fromDate(ackDeadline),
    resolutionDeadline: admin.firestore.Timestamp.fromDate(resDeadline),
    assignedOmbudsman:  null,
    timeline: [{
      stage:     'filed',
      timestamp: new Date().toISOString(),
      note:      'Complaint filed by user.',
    }],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, complaintId, ackDeadline: ackDeadline.toISOString() };
});

// ─── 12. UPDATE COMPLAINT (Ombudsman) ────────────────────────────────────────
// Enforces spec 5.1 stage ordering and sets per-stage SLA deadlines.

const COMPLAINT_STAGE_ORDER = [
  'acknowledgment', 'investigation', 'mediation', 'resolution', 'appeal', 'closed',
];
// Days from filing to stage deadline (spec 5.1)
const COMPLAINT_STAGE_DAYS = {
  acknowledgment: 2,
  investigation:  7,
  mediation:      10,
  resolution:     14,
};

exports.updateComplaint = onCall(async (request) => {
  const uid = requireAuth(request);
  const user = await getUserDoc(uid);
  const isOmbudsman = user.roles && user.roles.includes('ombudsman');
  const isAdmin     = user.roles && user.roles.includes('admin');
  if (!isOmbudsman && !isAdmin) throw new HttpsError('permission-denied', 'Ombudsman or admin required.');

  const { complaintId, newStage, note, resolution } = request.data;
  if (!complaintId) throw new HttpsError('invalid-argument', 'complaintId required.');

  const ref  = db.collection('complaints').doc(complaintId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Complaint not found.');

  const current = snap.data();

  // Enforce stage ordering — cannot go backwards
  if (newStage) {
    const currentIdx = COMPLAINT_STAGE_ORDER.indexOf(current.stage);
    const newIdx     = COMPLAINT_STAGE_ORDER.indexOf(newStage);
    if (newIdx === -1) throw new HttpsError('invalid-argument', `Invalid stage: ${newStage}`);
    if (newIdx <= currentIdx) {
      throw new HttpsError('failed-precondition',
        `Cannot move complaint backwards from '${current.stage}' to '${newStage}'`);
    }
  }

  // Resolution is required when closing/resolving
  if ((newStage === 'resolution' || newStage === 'closed') && !resolution) {
    throw new HttpsError('invalid-argument', 'resolution decision required when resolving a complaint.');
  }

  const updates = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    timeline:  admin.firestore.FieldValue.arrayUnion({
      stage:     newStage || current.stage,
      timestamp: new Date().toISOString(),
      updatedBy: uid,
      note:      note || '',
    }),
  };

  if (newStage) {
    updates.stage = newStage;

    // Set stage-specific deadline based on filing date
    const filedAt   = current.createdAt?.toDate ? current.createdAt.toDate() : new Date();
    const stageDays = COMPLAINT_STAGE_DAYS[newStage];
    if (stageDays) {
      updates.stageDeadline = admin.firestore.Timestamp.fromDate(
        new Date(filedAt.getTime() + stageDays * 24 * 60 * 60 * 1000)
      );
    }

    // Appeal window: 7 days after resolution date
    if (newStage === 'resolution') {
      updates.appealDeadline = admin.firestore.Timestamp.fromDate(
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      );
      updates.status = 'resolved';
    }
    if (newStage === 'closed') updates.status = 'closed';
  }

  if (resolution) updates.resolution = resolution;
  if (!current.assignedOmbudsman && isOmbudsman) updates.assignedOmbudsman = uid;

  await ref.update(updates);
  return { success: true };
});

// ─── 13. SUBMIT JEWELRY RETURN (T-JR) ────────────────────────────────────────

exports.submitJewelryReturn = onCall(async (request) => {
  const uid = requireAuth(request);
  await requireKYC(uid);

  const { itemDescription, goldGrams, estimatedPurity, preferredJewelerId, pickupAddress, pickupDate } = request.data;
  if (!itemDescription || !goldGrams) throw new HttpsError('invalid-argument', 'itemDescription and goldGrams required.');

  const rate           = await getLBMARate();
  const estPurity      = estimatedPurity || 916;
  const estPureGrams   = goldGrams * (estPurity / 1000);
  const estimatedValue = Math.round(estPureGrams * rate);
  const returnId       = generateId('TJR');

  await db.collection('tjr_returns').doc(returnId).set({
    returnId,
    userId:            uid,
    itemDescription,
    goldGrams,
    estimatedPurity:   estPurity,
    estimatedValue,
    preferredJewelerId: preferredJewelerId || null,
    pickupAddress:     pickupAddress || '',
    pickupDate:        pickupDate || null,
    jewelerId:         null,
    assessedGrams:     null,
    assessedPurity:    null,
    assessedValue:     null,
    status:            'submitted',
    createdAt:         admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:         admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, returnId, estimatedValue };
});

// ─── 14. JEWELER ASSESSMENT (T-JR) ───────────────────────────────────────────

exports.submitJewelerAssessment = onCall(async (request) => {
  const uid = requireAuth(request);
  await requireRole(uid, 'jeweler');

  const { returnId, assessedGrams, assessedPurity, certNumber } = request.data;
  if (!returnId || !assessedGrams || !assessedPurity) throw new HttpsError('invalid-argument', 'returnId, assessedGrams, assessedPurity required.');

  const rate         = await getLBMARate();
  const pureGrams    = assessedGrams * (assessedPurity / 1000);
  const assessedValue = Math.round(pureGrams * rate);

  await db.collection('tjr_returns').doc(returnId).update({
    jewelerId:      uid,
    assessedGrams,
    assessedPurity,
    assessedValue,
    certNumber:     certNumber || '',
    status:         'assessed',
    assessedAt:     admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, assessedValue };
});

// ─── 15. PROCESS JEWELRY RETURN PAYMENT ──────────────────────────────────────
// Admin confirms assessment → credits TGDP to returnee.

exports.processReturnPayment = onCall(async (request) => {
  const adminUid = requireAuth(request);
  await requireRole(adminUid, 'admin');

  const { returnId } = request.data;
  if (!returnId) throw new HttpsError('invalid-argument', 'returnId required.');

  const snap = await db.collection('tjr_returns').doc(returnId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Return not found.');
  const ret = snap.data();
  if (ret.status !== 'assessed') throw new HttpsError('failed-precondition', 'Return not yet assessed.');

  const tgdpAmount = Math.floor((ret.assessedGrams * (ret.assessedPurity / 1000)) * 10);
  const txId       = generateId('TX');

  const batch = db.batch();

  batch.set(db.collection('tgdp_balances').doc(ret.userId), {
    balance:   admin.firestore.FieldValue.increment(tgdpAmount),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  batch.set(db.collection('tgdp_transactions').doc(txId), {
    txId,
    type:        'jewelry_return',
    userId:      ret.userId,
    amount:      tgdpAmount,
    description: `Jewelry return: ${ret.itemDescription}`,
    returnId,
    status:      'completed',
    createdAt:   admin.firestore.FieldValue.serverTimestamp(),
  });

  batch.update(db.collection('tjr_returns').doc(returnId), {
    status:      'paid',
    tgdpCredited: tgdpAmount,
    paidAt:      admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();
  return { success: true, tgdpAmount };
});

// ─── 16. REGISTER DESIGN (T-JDB) ─────────────────────────────────────────────

exports.registerDesign = onCall(async (request) => {
  const uid = requireAuth(request);
  await requireKYC(uid);
  await requireRole(uid, 'designer');

  const { title, description, category, price, imageUrls, fileUrls } = request.data;
  if (!title || !price) throw new HttpsError('invalid-argument', 'title and price required.');

  const designId = generateId('DES');

  // Compute design hash from content (mirrors what browser hashes before upload)
  const designHash = ethers.keccak256(
    ethers.toUtf8Bytes(JSON.stringify({ designId, uid, title, category, price }))
  );

  await db.collection('tjdb_designs').doc(designId).set({
    designId,
    designerId:     uid,
    title,
    description:    description || '',
    category:       category || 'general',
    price,
    imageUrls:      imageUrls || [],
    fileUrls:       fileUrls  || [],
    designHash,
    iprRegistered:  false,
    blockchainTxHash: null,
    status:         'active',
    salesCount:     0,
    createdAt:      admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
  });

  // Register IPR on-chain (best-effort)
  const metadataUri = `ipfs://tgdp-designs/${designId}`;   // real IPFS hash written after Pinata upload
  await recordOnChain('registerDesignIPR', async (signer, addr) => {
    const IPR_ABI = [
      'function registerDesign(bytes32 designHash, string metadataUri, address designer) returns (uint256)',
    ];
    const ipr     = new ethers.Contract(addr.iprRegistry, IPR_ABI, signer);
    const tx      = await ipr.registerDesign(designHash, metadataUri, uid);
    const receipt = await tx.wait();
    return { txHash: receipt.hash };
  }, `tjdb_designs/${designId}`);

  // Mark IPR registered in Firestore
  await db.collection('tjdb_designs').doc(designId).update({ iprRegistered: true });

  return { success: true, designId, designHash };
});

// ─── 17. PURCHASE DESIGN (T-JDB) ─────────────────────────────────────────────

exports.purchaseDesign = onCall(async (request) => {
  const uid = requireAuth(request);
  await requireKYC(uid);

  const { designId, tgdpAmount } = request.data;
  if (!designId || !tgdpAmount) throw new HttpsError('invalid-argument', 'designId and tgdpAmount required.');

  const designSnap = await db.collection('tjdb_designs').doc(designId).get();
  if (!designSnap.exists) throw new HttpsError('not-found', 'Design not found.');
  const design = designSnap.data();
  if (design.status !== 'active') throw new HttpsError('failed-precondition', 'Design not available.');

  const DESIGNER_SHARE   = 0.85;
  const PLATFORM_SHARE   = 0.15;
  const designerPayout   = Math.round(tgdpAmount * DESIGNER_SHARE);
  const platformRevenue  = tgdpAmount - designerPayout;
  const orderId          = generateId('ORD');

  await db.runTransaction(async (t) => {
    const balSnap = await t.get(db.collection('tgdp_balances').doc(uid));
    const balance = balSnap.exists ? (balSnap.data().balance || 0) : 0;
    if (balance < tgdpAmount) throw new HttpsError('failed-precondition', 'Insufficient TGDP balance.');

    // Debit buyer
    t.set(db.collection('tgdp_balances').doc(uid), {
      balance:   admin.firestore.FieldValue.increment(-tgdpAmount),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Credit designer
    t.set(db.collection('tgdp_balances').doc(design.designerId), {
      balance:   admin.firestore.FieldValue.increment(designerPayout),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Order record
    t.set(db.collection('tjdb_orders').doc(orderId), {
      orderId,
      buyerId:        uid,
      designerId:     design.designerId,
      designId,
      tgdpAmount,
      designerPayout,
      platformRevenue,
      status:         'completed',
      createdAt:      admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update design sales count
    t.update(db.collection('tjdb_designs').doc(designId), {
      salesCount: admin.firestore.FieldValue.increment(1),
      updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
    });

    // Platform revenue
    t.set(db.collection('config').doc('revenue'), {
      totalDesignRevenue: admin.firestore.FieldValue.increment(platformRevenue),
      updatedAt:          admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  // Record sale on IPR Registry (best-effort)
  if (design.designHash) {
    await recordOnChain('recordDesignSale', async (signer, addr) => {
      const IPR_ABI = [
        'function recordSale(uint256 designId, address buyer, uint256 amount)',
        'function getDesignIdByHash(bytes32 designHash) view returns (uint256)',
      ];
      const ipr         = new ethers.Contract(addr.iprRegistry, IPR_ABI, signer);
      const onChainId   = await ipr.getDesignIdByHash(design.designHash);
      if (Number(onChainId) === 0) return null; // not yet on-chain
      const saleAmtWei  = ethers.parseUnits(String(tgdpAmount), 18);
      const tx          = await ipr.recordSale(onChainId, uid, saleAmtWei);
      const receipt     = await tx.wait();
      return { txHash: receipt.hash };
    }, `tjdb_orders/${orderId}`);
  }

  return { success: true, orderId, designerPayout };
});

// ─── 18. SCHEDULED: REFRESH LBMA RATE ────────────────────────────────────────
// Runs daily at 06:00 IST (00:30 UTC) after LBMA morning fixing.
// Uses Nasdaq Data Link LBMA/GOLD dataset + exchangerate-api for USD→INR.
// Set NASDAQ_API_KEY in Firebase Secret Manager (param in .env for local dev).

exports.refreshLBMARate = onSchedule('30 0 * * *', async () => {
  const NASDAQ_API_KEY = process.env.NASDAQ_API_KEY;

  let ratePerGramINR;
  let ratePerGramUSD;
  let usdToInr;
  let source = 'LBMA';

  try {
    if (!NASDAQ_API_KEY) throw new Error('NASDAQ_API_KEY not set');

    // 1. Fetch LBMA Gold AM fixing (USD per troy oz) from Nasdaq Data Link
    //    LBMA/GOLD dataset columns: Date | USD (AM) | USD (PM) | GBP (AM) | GBP (PM) | EUR (AM) | EUR (PM)
    const lbmaUrl = `https://data.nasdaq.com/api/v3/datasets/LBMA/GOLD.json?api_key=${NASDAQ_API_KEY}&rows=1`;
    const lbmaRes = await fetch(lbmaUrl);
    if (!lbmaRes.ok) throw new Error(`LBMA API ${lbmaRes.status}: ${await lbmaRes.text()}`);
    const lbmaJson = await lbmaRes.json();

    // dataset.data[0] = [date, USD_AM, USD_PM, GBP_AM, GBP_PM, EUR_AM, EUR_PM]
    const latestRow = lbmaJson.dataset?.data?.[0];
    if (!latestRow || latestRow.length < 2) throw new Error('Unexpected LBMA response shape');
    const usdPerTroyOz = parseFloat(latestRow[1]); // AM fixing
    if (!usdPerTroyOz || isNaN(usdPerTroyOz)) throw new Error('Invalid LBMA USD value');

    // 1 troy oz = 31.1034768 grams
    ratePerGramUSD = usdPerTroyOz / 31.1034768;

    // 2. Fetch USD→INR exchange rate (free tier, no key needed)
    const fxUrl = 'https://open.er-api.com/v6/latest/USD';
    const fxRes = await fetch(fxUrl);
    if (!fxRes.ok) throw new Error(`FX API ${fxRes.status}`);
    const fxJson = await fxRes.json();
    usdToInr = fxJson?.rates?.INR;
    if (!usdToInr || isNaN(usdToInr)) throw new Error('Invalid INR rate');

    ratePerGramINR = Math.round(ratePerGramUSD * usdToInr * 100) / 100;
    console.log(`LBMA: $${usdPerTroyOz}/oz → $${ratePerGramUSD.toFixed(4)}/g × ₹${usdToInr} = ₹${ratePerGramINR}/g`);

  } catch (err) {
    console.error('LBMA fetch failed, keeping existing rate:', err.message);
    // Do not overwrite with stale data — just log and exit
    await db.collection('config').doc('lbma').set({
      lastFetchError: err.message,
      lastFetchAt:    admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return;
  }

  await db.collection('config').doc('lbma').set({
    ratePerGram:    ratePerGramINR,
    ratePerGramUSD: Math.round(ratePerGramUSD * 10000) / 10000,
    usdToInr:       Math.round(usdToInr * 100) / 100,
    currency:       'INR',
    source,
    updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
    lastFetchError: null,
  }, { merge: true });

  console.log(`LBMA rate updated: ₹${ratePerGramINR}/gram`);
});

// ─── 19. TRIGGER: Auto-credit GIC on new household link ──────────────────────

exports.onHouseholdLinked = onDocumentCreated('household_links/{linkId}', async (event) => {
  const link = event.data.data();
  if (!link || !link.licenseeId) return;

  // Credit registration GIC (25% of ₹300 registration fee = ₹75)
  const REGISTRATION_FEE = 300;
  await creditGIC(link.licenseeId, 'registration', REGISTRATION_FEE, event.params.linkId);
  console.log(`GIC credited to licensee ${link.licenseeId} for household link ${event.params.linkId}`);
});

// ─── 20. ADMIN: GET DASHBOARD STATS ──────────────────────────────────────────

exports.getAdminStats = onCall(async (request) => {
  const uid = requireAuth(request);
  await requireRole(uid, 'admin');

  const [
    usersSnap,
    kycSnap,
    complaintsSnap,
    revenueSnap,
  ] = await Promise.all([
    db.collection('users').count().get(),
    db.collection('kyc').where('kycStatus', '==', 'submitted').count().get(),
    db.collection('complaints').where('status', '==', 'filed').count().get(),
    db.collection('config').doc('revenue').get(),
  ]);

  const revenue = revenueSnap.exists ? revenueSnap.data() : {};

  return {
    totalUsers:         usersSnap.data().count,
    pendingKYC:         kycSnap.data().count,
    openComplaints:     complaintsSnap.data().count,
    totalFTRCommission: revenue.totalFTRCommission || 0,
    totalDesignRevenue: revenue.totalDesignRevenue || 0,
  };
});

// ─── 21. RAZORPAY: CREATE ORDER ───────────────────────────────────────────────
// Creates a Razorpay order server-side so the key_secret never touches the client.
// purpose: 'gic_license' | 'withdrawal' | 'design_purchase'
// amount: INR value (NOT paise — conversion done here)

exports.createRazorpayOrder = onCall(async (request) => {
  const uid = requireAuth(request);
  const { amount, purpose, metadata = {} } = request.data;

  if (!amount || amount <= 0) throw new HttpsError('invalid-argument', 'amount required');
  const VALID_PURPOSES = ['gic_license', 'withdrawal', 'design_purchase'];
  if (!VALID_PURPOSES.includes(purpose)) throw new HttpsError('invalid-argument', 'invalid purpose');

  const RAZORPAY_KEY_ID     = process.env.RAZORPAY_KEY_ID;
  const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    throw new HttpsError('failed-precondition', 'Razorpay credentials not configured');
  }

  // Create Razorpay order via REST API
  const credentials = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
  const orderRes = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      amount:   Math.round(amount * 100), // paise
      currency: 'INR',
      receipt:  `tgdp_${purpose}_${uid}_${Date.now()}`,
      notes: {
        userId:  uid,
        purpose,
        ...metadata,
      },
    }),
  });

  if (!orderRes.ok) {
    const errText = await orderRes.text();
    console.error('Razorpay order creation failed:', errText);
    throw new HttpsError('internal', 'Payment order creation failed');
  }

  const order = await orderRes.json();

  // Persist order for verification later
  await db.collection('payment_orders').doc(order.id).set({
    orderId:   order.id,
    userId:    uid,
    amount,
    purpose,
    metadata,
    status:    'created',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    orderId:   order.id,
    amount:    order.amount,   // paise
    currency:  order.currency,
    keyId:     RAZORPAY_KEY_ID,
  };
});

// ─── 22. RAZORPAY: VERIFY PAYMENT ────────────────────────────────────────────
// Verifies Razorpay payment signature after the checkout modal closes.
// On success, triggers the business action (e.g., activate GIC license).

exports.verifyRazorpayPayment = onCall(async (request) => {
  const uid = requireAuth(request);
  const { orderId, paymentId, signature } = request.data;

  if (!orderId || !paymentId || !signature) {
    throw new HttpsError('invalid-argument', 'orderId, paymentId, signature required');
  }

  const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
  if (!RAZORPAY_KEY_SECRET) {
    throw new HttpsError('failed-precondition', 'Razorpay credentials not configured');
  }

  // Verify HMAC-SHA256 signature: sign(orderId + "|" + paymentId) with key_secret
  const crypto    = require('crypto');
  const expected  = crypto
    .createHmac('sha256', RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  if (expected !== signature) {
    throw new HttpsError('permission-denied', 'Payment signature verification failed');
  }

  // Fetch the pending order record
  const orderSnap = await db.collection('payment_orders').doc(orderId).get();
  if (!orderSnap.exists) throw new HttpsError('not-found', 'Order not found');
  const order = orderSnap.data();
  if (order.userId !== uid) throw new HttpsError('permission-denied', 'Order does not belong to user');
  if (order.status === 'paid') return { success: true, alreadyProcessed: true };

  // Mark paid
  await db.collection('payment_orders').doc(orderId).update({
    status:    'paid',
    paymentId,
    paidAt:    admin.firestore.FieldValue.serverTimestamp(),
  });

  // Trigger post-payment business logic
  if (order.purpose === 'gic_license') {
    // Activate GIC licensee status
    await db.collection('users').doc(uid).update({
      gicLicenseActive: true,
      gicLicensePaidAt: admin.firestore.FieldValue.serverTimestamp(),
      gicLicenseTxId:   paymentId,
    });
    await db.collection('kyc').doc(uid).update({
      gicLicenseFee: true,
    });

  } else if (order.purpose === 'withdrawal') {
    // Withdrawal payment captured — queue for processing
    await db.collection('withdrawal_requests').add({
      userId:    uid,
      amount:    order.amount,
      paymentId,
      orderId,
      status:    'queued',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

  } else if (order.purpose === 'design_purchase') {
    // Design purchase — orderId stored in metadata
    const { designId } = order.metadata;
    if (designId) {
      await db.collection('tjdb_orders').add({
        buyerId:   uid,
        designId,
        amount:    order.amount,
        paymentId,
        orderId,
        paymentMethod: 'razorpay',
        status:    'completed',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  return { success: true };
});
