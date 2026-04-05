// ─── PostgreSQL connection pool ───────────────────────────────────────────────
// Reads DATABASE_URL from environment (set in .env or shell).
// Example: postgresql://tgdp:password@localhost:5432/tgdp_local

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err.message);
});

module.exports = pool;
