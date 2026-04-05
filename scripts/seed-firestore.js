// ═══════════════════════════════════════════════════════════════════════════
// TGDP ECOSYSTEM — FIRESTORE SEED SCRIPT
// Run once after deploying to initialise config documents and create
// the first admin user.
//
// Usage:
//   node scripts/seed-firestore.js
//
// Prerequisites:
//   1. npm install firebase-admin  (in project root, not functions/)
//   2. Download service account key from Firebase Console →
//      Project Settings → Service Accounts → Generate new private key
//      Save as: scripts/serviceAccountKey.json
// ═══════════════════════════════════════════════════════════════════════════

const admin = require('firebase-admin');
const path  = require('path');

const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function seed() {
  console.log('Starting Firestore seed...');

  // ── 1. LBMA config ──────────────────────────────────────────────────────────
  await db.collection('config').doc('lbma').set({
    ratePerGram: 7342,
    currency:    'INR',
    source:      'LBMA',
    updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log('✓ LBMA config seeded');

  // ── 2. Commission config ────────────────────────────────────────────────────
  await db.collection('config').doc('commissions').set({
    tradingFee:       0,
    ftrSwapRate:      4,
    gicShareRate:     25,
    designerShare:    85,
    platformShare:    15,
    registrationFee:  300,
    updatedAt:        admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log('✓ Commission config seeded');

  // ── 3. SLA config ───────────────────────────────────────────────────────────
  await db.collection('config').doc('sla').set({
    acknowledgmentHours: 48,
    investigationDays:   7,
    mediationDays:       10,
    resolutionDays:      14,
    appealWindowDays:    7,
    updatedAt:           admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log('✓ SLA config seeded');

  // ── 4. Revenue tracker ──────────────────────────────────────────────────────
  await db.collection('config').doc('revenue').set({
    totalFTRCommission: 0,
    totalDesignRevenue: 0,
    updatedAt:          admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log('✓ Revenue tracker seeded');

  // ── 5. FTR category config ──────────────────────────────────────────────────
  await db.collection('config').doc('ftr_categories').set({
    categories: [
      { id: 1, name: 'Hospitality', icon: '🏨', description: 'Hotels, Restaurants, Resorts, Spas' },
      { id: 2, name: 'Healthcare',  icon: '🏥', description: 'Hospitals, Clinics, Pharmacies, Labs' },
      { id: 3, name: 'Education',   icon: '🎓', description: 'Schools, Universities, Training Centers' },
      { id: 4, name: 'Retail',      icon: '🛍️', description: 'Shopping, Electronics, Apparel, Groceries' },
      { id: 5, name: 'Travel',      icon: '✈️', description: 'Airlines, Railways, Tour Operators' },
    ],
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log('✓ FTR categories seeded');

  // ── 6. IPFS / Pinata config ─────────────────────────────────────────────────
  // Set your Pinata JWT here (or update via Firebase Console → Firestore → config/ipfs)
  // Get it from https://app.pinata.cloud → API Keys → New Key
  const PINATA_JWT = process.env.PINATA_JWT || 'YOUR_PINATA_JWT_HERE';
  await db.collection('config').doc('ipfs').set({
    pinataJWT:    PINATA_JWT === 'YOUR_PINATA_JWT_HERE' ? null : PINATA_JWT,
    gateway:      'https://gateway.pinata.cloud/ipfs/',
    // Documents pinned to IPFS:
    // - Gold purity certificates (on confirmMint)
    // - KYC approval records (on approveKYC)
    // - Design metadata JSON (on registerDesign)
    // - Legal agreement records (manual / future)
    updatedAt:    admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log('✓ IPFS config seeded (set pinataJWT in /config/ipfs to enable)');

  // ── 7. Create first admin user (update UID below after creating in Firebase Auth) ─
  // Steps:
  //   a) Go to Firebase Console → Authentication → Add User
  //   b) Create admin@trot-gold.com with a strong password
  //   c) Copy the UID shown and paste it below
  //   d) Re-run this script

  const ADMIN_UID = 'REPLACE_WITH_ADMIN_UID'; // ← paste your admin UID here

  if (ADMIN_UID !== 'REPLACE_WITH_ADMIN_UID') {
    await db.collection('users').doc(ADMIN_UID).set({
      uid:           ADMIN_UID,
      firstName:     'TGDP',
      lastName:      'Admin',
      email:         'admin@trot-gold.com',
      phone:         '',
      pan:           '',
      aadhaar:       '',
      address:       '',
      city:          '',
      state:         '',
      pincode:       '',
      roles:         ['admin'],
      primaryRole:   'admin',
      status:        'active',
      emailVerified: true,
      authProvider:  'email',
      createdAt:     admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log('✓ Admin user profile seeded for UID:', ADMIN_UID);
  } else {
    console.log('⚠ Skipping admin user — replace ADMIN_UID in this script first.');
  }

  console.log('\nSeed complete! Firestore collections initialised:');
  console.log('  config/lbma, config/commissions, config/sla, config/revenue, config/ftr_categories, config/ipfs');
  console.log('\nCollections created on first write (no pre-seeding needed):');
  console.log('  users, kyc, tgdp_balances, ftr_balances, gic_balances');
  console.log('  tgdp_transactions, earmarks, ftr_swaps, ftr_redemptions');
  console.log('  gic_credits, gic_redemptions, household_links');
  console.log('  complaints, tjr_returns, tjdb_designs, tjdb_orders');
  console.log('  tgdp_withdrawals, audit_logs');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
