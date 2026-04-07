// ─── PostgreSQL connection pool ────────────────────────────────────────────────
// Reads DATABASE_URL from environment.
// On Render (production), Render injects DATABASE_URL with SSL params.
// SSL is required for Render Postgres; ignored on localhost.

const { Pool } = require('pg');

const IS_PROD = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: IS_PROD ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  process.stderr.write(`[db] Unexpected pool error: ${err.message}\n`);
});

// Verify connection on startup
pool.query('SELECT 1').then(() => {
  process.stdout.write('[db] PostgreSQL connected\n');
}).catch((err) => {
  process.stderr.write(`[db] Connection failed: ${err.message}\n`);
  process.exit(1);
});

module.exports = pool;
