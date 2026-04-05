// ═══════════════════════════════════════════════════════════════════════════
// TGDP ECOSYSTEM — EXPRESS REST API SERVER
// ═══════════════════════════════════════════════════════════════════════════

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const { errorHandler } = require('./middleware/errorHandler');

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
const IS_PROD = process.env.NODE_ENV === 'production';

// ─── CORS ─────────────────────────────────────────────────────────────────────
// In production: set ALLOWED_ORIGINS as a comma-separated list in .env
// e.g. ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
// In development: allow localhost automatically
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3001', 'http://localhost:5000', 'http://127.0.0.1:3001', 'http://127.0.0.1:5000'];

app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin requests (no Origin header) and whitelisted origins
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ─── Security headers ─────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (IS_PROD) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));

// ─── Basic rate limiting (no extra dependency) ────────────────────────────────
const hits = new Map();
app.use('/api/', (req, res, next) => {
  const key = req.ip;
  const now = Date.now();
  const window = 60_000; // 1 minute
  const limit  = 300;    // 300 requests/min per IP
  const entry  = hits.get(key) || { count: 0, start: now };
  if (now - entry.start > window) { entry.count = 0; entry.start = now; }
  entry.count++;
  hits.set(key, entry);
  if (entry.count > limit) {
    return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests.', status: 429 } });
  }
  next();
});
// Clean up rate-limit map every 5 minutes
setInterval(() => { const now = Date.now(); hits.forEach((v,k) => { if (now - v.start > 60_000) hits.delete(k); }); }, 300_000);

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
  res.json({ status: 'ok', timestamp: new Date().toISOString(), env: process.env.NODE_ENV || 'development' });
});

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..'), { index: false }));

// SPA fallback
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// ─── Central error handler ────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const mode = IS_PROD ? 'PRODUCTION' : 'development';
  process.stdout.write(`[TGDP] Server started — port ${PORT} — ${mode}\n`);
});
