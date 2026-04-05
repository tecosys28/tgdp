#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// TGDP LOCAL SEED SCRIPT
// Seeds Firestore emulator with all config + a demo admin user.
// Run AFTER emulators are started:
//   node scripts/seed-local.js
// ═══════════════════════════════════════════════════════════════════════════

process.env.FIRESTORE_EMULATOR_HOST  = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

// Resolve firebase-admin from functions/node_modules
const adminPath = require('path').resolve(__dirname, '../functions/node_modules/firebase-admin');
const { initializeApp } = require(adminPath + '/lib/app');
const { getFirestore }  = require(adminPath + '/lib/firestore');
const { getAuth }       = require(adminPath + '/lib/auth');

initializeApp({ projectId: 'tgdp-d4a3d' });

const db   = getFirestore();
const auth = getAuth();

async function seed() {
  console.log('🌱 Seeding Firestore emulator...\n');
  const now = new Date();

  // ── /config/lbma ──────────────────────────────────────────────────────────
  // Gold price in INR per gram (used for mint valuation)
  await db.collection('config').doc('lbma').set({
    ratePerGram:   7342,          // INR per gram (fallback value from code)
    currency:      'INR',
    source:        'local-seed',
    updatedAt:     now,
  });
  console.log('✓ config/lbma');

  // ── /config/contracts ─────────────────────────────────────────────────────
  // Polygon Amoy testnet contract addresses (deploy your own or leave empty)
  await db.collection('config').doc('contracts').set({
    tgdpToken:   '',   // fill after deploying contracts
    ftrToken:    '',
    gicToken:    '',
    registry:    '',
    iprRegistry: '',
    network:     'amoy',
    updatedAt:   now,
  });
  console.log('✓ config/contracts');

  // ── /config/ipfs ──────────────────────────────────────────────────────────
  // Pinata IPFS credentials (optional — IPFS ops are non-fatal)
  await db.collection('config').doc('ipfs').set({
    pinataJWT:    '',   // fill with your Pinata JWT if needed
    updatedAt:    now,
  });
  console.log('✓ config/ipfs');

  // ── /config/commissions ───────────────────────────────────────────────────
  await db.collection('config').doc('commissions').set({
    ftrCommission:     0.02,   // 2% FTR swap commission
    gicShare:          0.5,    // 50% of commission goes to GIC
    designerShare:     0.9,    // 90% of design sale to designer
    minGICRedemption:  100,    // minimum GIC to redeem
    updatedAt:         now,
  });
  console.log('✓ config/commissions');

  // ── /config/sla ───────────────────────────────────────────────────────────
  await db.collection('config').doc('sla').set({
    acknowledgmentHours: 24,
    investigationDays:   7,
    mediationDays:       14,
    resolutionDays:      30,
    appealWindowDays:    10,
    updatedAt:           now,
  });
  console.log('✓ config/sla');

  // ── /config/revenue ───────────────────────────────────────────────────────
  await db.collection('config').doc('revenue').set({
    totalFTRCommission:  0,
    totalDesignRevenue:  0,
    updatedAt:           now,
  });
  console.log('✓ config/revenue');

  // ── Demo Admin User ────────────────────────────────────────────────────────
  // Creates a Firebase Auth user + Firestore profile for local testing
  const ADMIN_EMAIL    = 'admin@tgdp.local';
  const ADMIN_PASSWORD = 'Admin@1234';
  const ADMIN_UID      = 'local-admin-001';

  try {
    await auth.createUser({
      uid:           ADMIN_UID,
      email:         ADMIN_EMAIL,
      password:      ADMIN_PASSWORD,
      emailVerified: true,
      displayName:   'Local Admin',
    });
    console.log(`✓ Auth user created: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  } catch (e) {
    if (e.code === 'auth/uid-already-exists' || e.code === 'auth/email-already-exists') {
      console.log(`  Auth user already exists: ${ADMIN_EMAIL}`);
    } else {
      console.warn('  Auth user skipped:', e.message);
    }
  }

  await db.collection('users').doc(ADMIN_UID).set({
    uid:           ADMIN_UID,
    email:         ADMIN_EMAIL,
    displayName:   'Local Admin',
    roles:         ['admin'],
    primaryRole:   'admin',
    status:        'active',
    kycStatus:     'approved',
    isActive:      true,
    walletAddress: '',
    createdAt:     now,
    updatedAt:     now,
  });
  console.log('✓ users/local-admin-001');

  await db.collection('kyc').doc(ADMIN_UID).set({
    uid:        ADMIN_UID,
    kycStatus:  'approved',
    approvedAt: now,
    approvedBy: 'seed-script',
    kycHash:    '0x0000000000000000000000000000000000000000000000000000000000000000',
  });
  console.log('✓ kyc/local-admin-001');

  // ── Demo Household User ────────────────────────────────────────────────────
  const HH_EMAIL    = 'household@tgdp.local';
  const HH_PASSWORD = 'House@1234';
  const HH_UID      = 'local-household-001';

  try {
    await auth.createUser({
      uid:           HH_UID,
      email:         HH_EMAIL,
      password:      HH_PASSWORD,
      emailVerified: true,
      displayName:   'Demo Household',
    });
    console.log(`✓ Auth user created: ${HH_EMAIL} / ${HH_PASSWORD}`);
  } catch (e) {
    if (e.code === 'auth/uid-already-exists' || e.code === 'auth/email-already-exists') {
      console.log(`  Auth user already exists: ${HH_EMAIL}`);
    } else {
      console.warn('  Auth user skipped:', e.message);
    }
  }

  await db.collection('users').doc(HH_UID).set({
    uid:           HH_UID,
    email:         HH_EMAIL,
    displayName:   'Demo Household',
    roles:         ['household'],
    primaryRole:   'household',
    status:        'active',
    kycStatus:     'approved',
    isActive:      true,
    walletAddress: '',
    createdAt:     now,
    updatedAt:     now,
  });

  await db.collection('tgdp_balances').doc(HH_UID).set({
    uid:       HH_UID,
    balance:   1000,   // 1000 TGDP for testing
    updatedAt: now,
  });

  await db.collection('ftr_balances').doc(HH_UID).set({
    uid:       HH_UID,
    balances:  { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    updatedAt: now,
  });

  await db.collection('gic_balances').doc(HH_UID).set({
    uid:       HH_UID,
    balance:   0,
    updatedAt: now,
  });
  console.log(`✓ Household demo user seeded (${HH_EMAIL} / ${HH_PASSWORD})`);

  // ── Demo Licensee User ─────────────────────────────────────────────────────
  const LIC_EMAIL    = 'licensee@tgdp.local';
  const LIC_PASSWORD = 'Licensee@1234';
  const LIC_UID      = 'local-licensee-001';

  try {
    await auth.createUser({
      uid:           LIC_UID,
      email:         LIC_EMAIL,
      password:      LIC_PASSWORD,
      emailVerified: true,
      displayName:   'Demo Licensee',
    });
    console.log(`✓ Auth user created: ${LIC_EMAIL} / ${LIC_PASSWORD}`);
  } catch (e) {
    if (e.code === 'auth/uid-already-exists' || e.code === 'auth/email-already-exists') {
      console.log(`  Auth user already exists: ${LIC_EMAIL}`);
    } else {
      console.warn('  Auth user skipped:', e.message);
    }
  }

  await db.collection('users').doc(LIC_UID).set({
    uid:           LIC_UID,
    email:         LIC_EMAIL,
    displayName:   'Demo Licensee',
    roles:         ['licensee'],
    primaryRole:   'licensee',
    status:        'active',
    kycStatus:     'approved',
    isActive:      true,
    walletAddress: '',
    createdAt:     now,
    updatedAt:     now,
  });

  await db.collection('tgdp_balances').doc(LIC_UID).set({ uid: LIC_UID, balance: 500, updatedAt: now });
  await db.collection('gic_balances').doc(LIC_UID).set({ uid: LIC_UID, balance: 250, updatedAt: now });
  console.log(`✓ Licensee demo user seeded (${LIC_EMAIL} / ${LIC_PASSWORD})`);

  console.log('\n✅ Seed complete!\n');
  console.log('Demo accounts:');
  console.log('  Admin     →  admin@tgdp.local      /  Admin@1234');
  console.log('  Household →  household@tgdp.local  /  House@1234');
  console.log('  Licensee  →  licensee@tgdp.local   /  Licensee@1234');
  console.log('\nOpen: http://localhost:5000\n');
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
