// ─── Database migration runner ────────────────────────────────────────────────
// Runs database/schema.sql against the connected PostgreSQL instance.
// Safe to run multiple times — all CREATE statements use IF NOT EXISTS.
// Called automatically by index.js on every server startup.

const path = require('path');
const fs   = require('fs');
const { Pool } = require('pg');

const IS_PROD = process.env.NODE_ENV === 'production';

async function migrate() {
  const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');

  if (!fs.existsSync(schemaPath)) {
    process.stderr.write('[migrate] schema.sql not found — skipping\n');
    return;
  }

  const sql = fs.readFileSync(schemaPath, 'utf8');

  // Use a dedicated short-lived pool for migration (separate from the app pool)
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: IS_PROD ? { rejectUnauthorized: false } : false,
    max: 1,
    connectionTimeoutMillis: 10000,
  });

  const client = await pool.connect();
  try {
    process.stdout.write('[migrate] Running schema.sql…\n');
    await client.query(sql);
    process.stdout.write('[migrate] Schema up to date\n');
  } catch (err) {
    // If tables already exist with slightly different state, some statements may
    // error on duplicate type/enum values. Log but don't crash — the app can
    // still start if core tables exist.
    if (err.code === '42710' || err.code === '42P07') {
      // 42710 = duplicate_object (enum/extension already exists)
      // 42P07 = duplicate_table
      process.stdout.write(`[migrate] Already up to date (${err.message})\n`);
    } else {
      process.stderr.write(`[migrate] ERROR: ${err.message}\n`);
      throw err;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

module.exports = { migrate };
