// ═══════════════════════════════════════════════════════════════════════════
// TGDP ECOSYSTEM — CLOUD FUNCTIONS
// All write operations run server-side so clients can never manipulate
// balances, transactions, or commission calculations directly.
// ═══════════════════════════════════════════════════════════════════════════

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule }         = require('firebase-functions/v2/scheduler');
const { onDocumentCreated }  = require('firebase-functions/v2/firestore');
const admin                  = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

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

// ─── 1. KYC APPROVAL (Admin only) ─────────────────────────────────────────────

exports.approveKYC = onCall(async (request) => {
  const adminUid = requireAuth(request);
  await requireRole(adminUid, 'admin');

  const { targetUserId, approved, notes } = request.data;
  if (!targetUserId) throw new HttpsError('invalid-argument', 'targetUserId required.');

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

  const updates = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    timeline:  admin.firestore.FieldValue.arrayUnion({
      stage:     newStage || snap.data().stage,
      timestamp: new Date().toISOString(),
      updatedBy: uid,
      note:      note || '',
    }),
  };

  if (newStage)   updates.stage      = newStage;
  if (resolution) updates.resolution = resolution;
  if (newStage === 'resolved' || newStage === 'closed') updates.status = newStage;
  if (!snap.data().assignedOmbudsman && isOmbudsman) updates.assignedOmbudsman = uid;

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

  await db.collection('tjdb_designs').doc(designId).set({
    designId,
    designerId:  uid,
    title,
    description: description || '',
    category:    category || 'general',
    price,
    imageUrls:   imageUrls || [],
    fileUrls:    fileUrls || [],
    iprRegistered:  false,
    blockchainHash: null,
    status:      'active',
    salesCount:  0,
    createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, designId };
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

  return { success: true, orderId, designerPayout };
});

// ─── 18. SCHEDULED: REFRESH LBMA RATE ────────────────────────────────────────
// Runs daily at 06:00 IST (00:30 UTC) after LBMA morning fixing.
// In production replace the mock with a real LBMA API call.

exports.refreshLBMARate = onSchedule('30 0 * * *', async () => {
  // TODO: replace mock with real LBMA API call
  // Example: const res = await fetch('https://data.nasdaq.com/api/v3/datasets/LBMA/GOLD.json?api_key=YOUR_KEY&rows=1');
  const baseRate  = 7342;
  const variation = (Math.random() - 0.5) * 100;
  const rate      = Math.round(baseRate + variation);

  await db.collection('config').doc('lbma').set({
    ratePerGram: rate,
    currency:    'INR',
    source:      'LBMA',
    updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  console.log(`LBMA rate updated: ₹${rate}/gram`);
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
