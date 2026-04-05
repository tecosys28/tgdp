// ═══════════════════════════════════════════════════════════════════════════
// TGDP ECOSYSTEM — EXPRESS REST API SERVER
// Replaces Firebase Cloud Functions. Uses PostgreSQL for all data storage.
// Firebase Auth is still used for authentication (token verification only).
// ═══════════════════════════════════════════════════════════════════════════

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const { errorHandler }   = require('./middleware/errorHandler');

const usersRouter      = require('./routes/users');
const balancesRouter   = require('./routes/balances');
const configRouter     = require('./routes/config');
const tgdpRouter       = require('./routes/tgdp');
const ftrRouter        = require('./routes/ftr');
const { router: gicRouter } = require('./routes/gic');
const householdsRouter = require('./routes/households');
const complaintsRouter = require('./routes/complaints');
const tjrRouter        = require('./routes/tjr');
const tjdbRouter       = require('./routes/tjdb');
const kycRouter        = require('./routes/kyc');
const adminRouter      = require('./routes/admin');
const paymentsRouter   = require('./routes/payments');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── CORS ────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    'http://localhost:3001',
    'http://localhost:5000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:5000',
  ],
  credentials: true,
}));

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));

// ─── API routes ───────────────────────────────────────────────────────────────
app.use('/api/v1/users',      usersRouter);
app.use('/api/v1/balances',   balancesRouter);
app.use('/api/v1/config',     configRouter);
app.use('/api/v1/tgdp',       tgdpRouter);
app.use('/api/v1/ftr',        ftrRouter);
app.use('/api/v1/gic',        gicRouter);
app.use('/api/v1/households', householdsRouter);
app.use('/api/v1/complaints', complaintsRouter);
app.use('/api/v1/tjr',        tjrRouter);
app.use('/api/v1/tjdb',       tjdbRouter);
app.use('/api/v1/kyc',        kycRouter);
app.use('/api/v1/admin',      adminRouter);
app.use('/api/v1/payments',   paymentsRouter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Static file serving — serves the entire project root ────────────────────
// API routes are mounted under /api/v1/ so they never conflict with static files.
app.use(express.static(path.join(__dirname, '..')));

// SPA fallback — serve index.html for non-API, non-file routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// ─── Central error handler ────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  TGDP API Server running at http://localhost:${PORT}`);
  console.log(`  Static files served from:   ${path.join(__dirname, '..')}`);
  console.log(`  Health check:               http://localhost:${PORT}/api/v1/health\n`);
});
