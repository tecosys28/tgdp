// ═══════════════════════════════════════════════════════════════════════════
// TGDP — PostgreSQL seed script
// Creates 3 demo Firebase Auth users and inserts matching rows into PostgreSQL.
// Idempotent — safe to run multiple times (ON CONFLICT DO NOTHING).
// Usage: node scripts/seed-postgres.js
// ═══════════════════════════════════════════════════════════════════════════

// Use server/node_modules for all dependencies
const serverPath = require('path').join(__dirname, '../server');
require(require('path').join(serverPath, 'node_modules/dotenv')).config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require(require('path').join(serverPath, 'node_modules/pg'));

// ── Firebase Admin (Auth emulator) ───────────────────────────────────────────
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
const adminPkg = require(require('path').join(serverPath, 'node_modules/firebase-admin'));
const adminApp = adminPkg.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'tgdp-d4a3d' });
const auth = adminApp.auth();

// ── PostgreSQL ────────────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Demo users ────────────────────────────────────────────────────────────────
const DEMO_USERS = [
  {
    email:       'admin@tgdp.local',
    password:    'Admin@1234',
    displayName: 'Admin User',
    primaryRole: 'admin',
    roles:       ['admin'],
    status:      'active',
    kycStatus:   'approved',
    tgdpBalance: 0,
    gicBalance:  0,
  },
  {
    email:       'household@tgdp.local',
    password:    'House@1234',
    displayName: 'Demo Household',
    primaryRole: 'household',
    roles:       ['household'],
    status:      'active',
    kycStatus:   'approved',
    tgdpBalance: 1000,
    gicBalance:  0,
  },
  {
    email:       'licensee@tgdp.local',
    password:    'Licensee@1234',
    displayName: 'Demo Licensee',
    primaryRole: 'licensee',
    roles:       ['licensee'],
    status:      'active',
    kycStatus:   'approved',
    tgdpBalance: 500,
    gicBalance:  250,
  },
];

const FTR_CATEGORIES = ['hospitality','healthcare','education','retail','travel'];

async function seed() {
  console.log('\n  TGDP PostgreSQL Seed\n');

  const client = await pool.connect();
  try {
    for (const u of DEMO_USERS) {
      // 1. Create or get Firebase Auth user
      let uid;
      try {
        const existing = await auth.getUserByEmail(u.email);
        uid = existing.uid;
        console.log(`  [auth] User exists: ${u.email} (${uid})`);
      } catch {
        const created = await auth.createUser({
          email:        u.email,
          password:     u.password,
          displayName:  u.displayName,
          emailVerified: true,
        });
        uid = created.uid;
        console.log(`  [auth] Created:      ${u.email} (${uid})`);
      }

      const [firstName, ...rest] = u.displayName.split(' ');
      const lastName = rest.join(' ') || '';

      await client.query('BEGIN');
      try {
        // 2. Insert user row
        await client.query(
          `INSERT INTO users
             (uid, email, first_name, last_name, primary_role, status, email_verified)
           VALUES ($1,$2,$3,$4,$5,$6,true)
           ON CONFLICT (uid) DO UPDATE SET status = $6, updated_at = NOW()`,
          [uid, u.email, firstName, lastName, u.primaryRole, u.status]
        );

        // 3. Insert roles
        for (const role of u.roles) {
          await client.query(
            'INSERT INTO user_roles (uid, role) VALUES ($1,$2) ON CONFLICT DO NOTHING',
            [uid, role]
          );
        }

        // 4. Insert KYC record
        await client.query(
          `INSERT INTO kyc (uid, kyc_status)
           VALUES ($1,$2)
           ON CONFLICT (uid) DO UPDATE SET kyc_status = $2`,
          [uid, u.kycStatus]
        );

        // 5. TGDP balance
        await client.query(
          `INSERT INTO tgdp_balances (uid, balance) VALUES ($1,$2)
           ON CONFLICT (uid) DO UPDATE SET balance = $2`,
          [uid, u.tgdpBalance]
        );

        // 6. FTR balances (one row per category)
        for (const cat of FTR_CATEGORIES) {
          await client.query(
            `INSERT INTO ftr_balances (uid, category, balance_inr) VALUES ($1,$2,0)
             ON CONFLICT (uid, category) DO NOTHING`,
            [uid, cat]
          );
        }

        // 7. GIC balance
        await client.query(
          `INSERT INTO gic_balances (uid, balance) VALUES ($1,$2)
           ON CONFLICT (uid) DO UPDATE SET balance = $2`,
          [uid, u.gicBalance]
        );

        await client.query('COMMIT');
        console.log(`  [pg]   Seeded:       ${u.email} (${u.primaryRole}, balance: ${u.tgdpBalance} TGDP)`);
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(`  [pg]   Error seeding ${u.email}:`, e.message);
        throw e;
      }
    }

    // 8. Verify config rows exist (schema.sql seeds them, but verify)
    const cfgRes = await pool.query('SELECT key FROM config');
    console.log(`\n  Config keys in DB: ${cfgRes.rows.map(r => r.key).join(', ')}`);

    console.log('\n  Seed complete.\n');
    console.log('  Login credentials:');
    for (const u of DEMO_USERS) {
      console.log(`    ${u.primaryRole.padEnd(12)} ${u.email}  /  ${u.password}`);
    }
    console.log('');
  } finally {
    client.release();
    await pool.end();
    process.exit(0);
  }
}

seed().catch(err => {
  console.error('\nSeed failed:', err.message);
  process.exit(1);
});
