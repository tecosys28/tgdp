// ═══════════════════════════════════════════════════════════════════════════
// TGDP ECOSYSTEM — SERVICE LAYER  (18 modules)
// All write operations delegate to Cloud Functions.
// All reads go directly to Firestore via firebase-client.js.
// This file is consumed by portal dashboards and the admin panel.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Shared constants ─────────────────────────────────────────────────────────

export const TGDP_PER_GRAM      = 10;       // 10 TGDP = 1 gram pure gold
export const FTR_COMMISSION     = 0.04;     // 4% swap commission
export const GIC_SHARE          = 0.25;     // 25% licensee revenue share
export const DESIGNER_SHARE     = 0.85;     // 85% designer payout
export const FTR_VALIDITY_DAYS  = 365;      // 12-month FTR validity

export const PURITY_STANDARDS = {
  999: { karats: '24K', factor: 0.999 },
  916: { karats: '22K', factor: 0.916 },
  875: { karats: '21K', factor: 0.875 },
  750: { karats: '18K', factor: 0.750 },
  585: { karats: '14K', factor: 0.585 },
  417: { karats: '10K', factor: 0.417 },
};

export const FTR_CATEGORIES = {
  1: { id: 1, name: 'Hospitality', icon: '🏨', description: 'Hotels, Restaurants, Resorts, Spas' },
  2: { id: 2, name: 'Healthcare',  icon: '🏥', description: 'Hospitals, Clinics, Pharmacies, Labs' },
  3: { id: 3, name: 'Education',   icon: '🎓', description: 'Schools, Universities, Training Centers' },
  4: { id: 4, name: 'Retail',      icon: '🛍️', description: 'Shopping, Electronics, Apparel, Groceries' },
  5: { id: 5, name: 'Travel',      icon: '✈️', description: 'Airlines, Railways, Tour Operators' },
};

export const ROLE_INCOMPATIBILITIES = {
  ombudsman: ['licensee', 'household', 'jeweler', 'designer', 'returnee', 'consultant', 'advertiser'],
  jeweler:   ['household', 'returnee', 'designer', 'consultant', 'licensee'],
  household:  ['jeweler'],
  returnee:   ['jeweler'],
  designer:   ['jeweler'],
  consultant: ['jeweler'],
  licensee:   ['jeweler'],
};

// ─── Validators ───────────────────────────────────────────────────────────────

export const Validators = {
  pan:     v => /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(v.toUpperCase()),
  aadhaar: v => /^\d{12}$/.test(v.replace(/\s/g, '')),
  email:   v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  phone:   v => /^[6-9]\d{9}$/.test(v.replace(/[\s-]/g, '')),
  gst:     v => /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/.test(v.toUpperCase()),
  ifsc:    v => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.toUpperCase()),
  pincode: v => /^\d{6}$/.test(v),
};

// ─── Formatters ───────────────────────────────────────────────────────────────

export function formatINR(amount) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount || 0);
}
export function formatTGDP(amount) {
  return (amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' TGDP';
}
export function generateId(prefix = 'ID') {
  return prefix + '-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 5).toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. UserService
// ─────────────────────────────────────────────────────────────────────────────

export const UserService = {
  /** Validate role combination (client-side pre-check before submission). */
  isRoleCombinationValid(roles) {
    for (const role of roles) {
      const blocked = ROLE_INCOMPATIBILITIES[role] || [];
      for (const other of roles) {
        if (role !== other && blocked.includes(other)) return false;
      }
    }
    return true;
  },

  getIncompatibleRoles(selectedRoles) {
    const set = new Set();
    for (const role of selectedRoles) {
      (ROLE_INCOMPATIBILITIES[role] || []).forEach(r => set.add(r));
    }
    return Array.from(set);
  },

  /** Derive redirect path from role array (first role wins). */
  getPortalForRoles(roles) {
    const map = {
      household:  'portals/tgold/dashboard.html',
      licensee:   'portals/gic/dashboard.html',
      jeweler:    'portals/tjr/dashboard.html',
      designer:   'portals/tjdb/dashboard.html',
      returnee:   'portals/tjr/dashboard.html',
      consultant: 'portals/tgold/dashboard.html',
      advertiser: 'portals/tgold/dashboard.html',
      ombudsman:  'portals/ombudsman/dashboard.html',
      admin:      'admin/index.html',
    };
    for (const r of roles) { if (map[r]) return map[r]; }
    return 'portals/tgold/dashboard.html';
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. KYCService
// ─────────────────────────────────────────────────────────────────────────────

export const KYCService = {
  REQUIRED_DOCS: {
    household:  ['pan', 'aadhaar', 'photo'],
    licensee:   ['pan', 'aadhaar', 'photo', 'gst'],
    jeweler:    ['pan', 'aadhaar', 'photo', 'bis_license', 'nabl_cert'],
    designer:   ['pan', 'aadhaar', 'photo'],
    returnee:   ['pan', 'aadhaar', 'photo'],
    consultant: ['pan', 'aadhaar', 'photo'],
    advertiser: ['pan', 'aadhaar', 'photo'],
    ombudsman:  ['pan', 'aadhaar', 'photo', 'appointment_letter'],
  },

  getRequiredDocs(roles) {
    const docs = new Set();
    for (const role of roles) {
      (this.REQUIRED_DOCS[role] || ['pan', 'aadhaar', 'photo']).forEach(d => docs.add(d));
    }
    return Array.from(docs);
  },

  isKYCComplete(kycData, roles) {
    const required = this.getRequiredDocs(roles);
    return required.every(doc => !!kycData[`${doc}DocUrl`]);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. TGDPService
// ─────────────────────────────────────────────────────────────────────────────

export const TGDPService = {
  /** Calculate TGDP amount from gold specs. */
  calculateTGDP(goldGrams, purityCode) {
    const factor = PURITY_STANDARDS[purityCode]?.factor || purityCode / 1000;
    const pureGrams = goldGrams * factor;
    return Math.floor(pureGrams * TGDP_PER_GRAM);
  },

  /** Calculate INR value of a TGDP amount at a given rate. */
  tgdpToINR(tgdpAmount, lbmaRatePerGram) {
    return Math.round((tgdpAmount / TGDP_PER_GRAM) * lbmaRatePerGram);
  },

  /** Calculate TGDP needed to buy INR amount at a given rate. */
  inrToTGDP(inrAmount, lbmaRatePerGram) {
    return Math.ceil((inrAmount / lbmaRatePerGram) * TGDP_PER_GRAM);
  },

  /** Validate a withdrawal amount against balance. */
  canWithdraw(balance, amount) {
    return amount > 0 && balance >= amount;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. FTRService
// ─────────────────────────────────────────────────────────────────────────────

export const FTRService = {
  /** Calculate FTR amount received after 4% commission. */
  calculateSwap(tgdpAmount) {
    const commission = Math.round(tgdpAmount * FTR_COMMISSION);
    return { ftrAmount: tgdpAmount - commission, commission };
  },

  /** Check if FTR tokens are still valid. */
  isValid(expiryDate) {
    return new Date(expiryDate) > new Date();
  },

  /** Days remaining until FTR expiry. */
  daysUntilExpiry(expiryDate) {
    return Math.ceil((new Date(expiryDate) - Date.now()) / 86400000);
  },

  getCategoryName(id) {
    return FTR_CATEGORIES[id]?.name || 'Unknown';
  },

  getCategoryIcon(id) {
    return FTR_CATEGORIES[id]?.icon || '❓';
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. GICService
// ─────────────────────────────────────────────────────────────────────────────

export const GICService = {
  STREAM_NAMES: { 1: 'Registration', 2: 'Minting', 3: 'Trading' },

  /** Calculate GIC amount from a revenue event. */
  calculateGIC(revenueAmount) {
    return Math.round(revenueAmount * GIC_SHARE);
  },

  /** GIC to INR conversion (1 GIC = 1 INR for redemption purposes). */
  gicToINR(gicAmount) {
    return gicAmount; // 1:1 INR peg for redemption
  },

  getStreamName(streamType) {
    return this.STREAM_NAMES[streamType] || 'Unknown';
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. LBMAService
// ─────────────────────────────────────────────────────────────────────────────

export const LBMAService = {
  /** Calculate gold value in INR. */
  goldValueINR(goldGrams, purityCode, ratePerGram) {
    const factor = PURITY_STANDARDS[purityCode]?.factor || purityCode / 1000;
    return Math.round(goldGrams * factor * ratePerGram);
  },

  /** Calculate TGDP value in INR. */
  tgdpValueINR(tgdpAmount, ratePerGram) {
    return Math.round((tgdpAmount / TGDP_PER_GRAM) * ratePerGram);
  },

  /** Format rate for display. */
  formatRate(ratePerGram) {
    return `₹${ratePerGram.toLocaleString('en-IN')}/gram`;
  },

  /** Check if a rate update is stale (older than 24h). */
  isStale(updatedAt) {
    if (!updatedAt) return true;
    const ts = updatedAt.toDate ? updatedAt.toDate() : new Date(updatedAt);
    return Date.now() - ts.getTime() > 24 * 60 * 60 * 1000;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. TransactionService
// ─────────────────────────────────────────────────────────────────────────────

export const TransactionService = {
  TX_TYPES: ['mint', 'trade', 'ftr_swap', 'ftr_redemption', 'withdrawal', 'jewelry_return', 'design_purchase'],

  /** Convert a transactions array to CSV string. */
  toCSV(transactions) {
    const headers = ['txId', 'type', 'userId', 'amount', 'description', 'status', 'createdAt'];
    const escape  = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows    = transactions.map(tx => headers.map(h => {
      if (h === 'createdAt') {
        const d = tx.createdAt?.toDate ? tx.createdAt.toDate() : new Date(tx.createdAt || 0);
        return escape(d.toISOString());
      }
      return escape(tx[h]);
    }).join(','));
    return [headers.join(','), ...rows].join('\n');
  },

  downloadCSV(csvContent, filename) {
    const a     = document.createElement('a');
    a.href      = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);
    a.download  = filename || `tgdp-transactions-${Date.now()}.csv`;
    a.click();
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 8. ComplaintService
// ─────────────────────────────────────────────────────────────────────────────

export const ComplaintService = {
  // Stage order enforced by Cloud Function — mirrored here for UI logic
  STAGE_ORDER: ['acknowledgment', 'investigation', 'mediation', 'resolution', 'appeal', 'closed'],

  // SLA deadline in days from filing (matches spec 5.1)
  SLA_DAYS: { acknowledgment: 2, investigation: 7, mediation: 10, resolution: 14 },

  CATEGORIES: {
    tgold:     ['minting', 'trading', 'ftr', 'withdrawal', 'technical', 'other'],
    gic:       ['payment', 'household_conflict', 'license', 'commission', 'gic', 'fraud', 'kyc', 'other'],
    tjr:       ['valuation', 'payment', 'pickup', 'quality', 'technical', 'other'],
    tjdb:      ['ipr', 'order', 'payment', 'designer', 'other'],
    ombudsman: ['process', 'sla_breach', 'other'],
  },

  getSLADeadline(filedAt, stage) {
    const days = this.SLA_DAYS[stage];
    if (!days) return null;
    const ts = filedAt?.toDate ? filedAt.toDate() : new Date(filedAt || 0);
    return new Date(ts.getTime() + days * 86400000);
  },

  isSLABreached(filedAt, stage) {
    const deadline = this.getSLADeadline(filedAt, stage);
    return deadline && Date.now() > deadline.getTime();
  },

  daysUntilSLA(filedAt, stage) {
    const deadline = this.getSLADeadline(filedAt, stage);
    if (!deadline) return null;
    return Math.ceil((deadline - Date.now()) / 86400000);
  },

  canAdvanceToStage(currentStage, newStage) {
    const ci = this.STAGE_ORDER.indexOf(currentStage);
    const ni = this.STAGE_ORDER.indexOf(newStage);
    return ni > ci;
  },

  getNextStage(currentStage) {
    const idx = this.STAGE_ORDER.indexOf(currentStage);
    return idx >= 0 && idx < this.STAGE_ORDER.length - 1
      ? this.STAGE_ORDER[idx + 1]
      : null;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 9. TJRService  (T-JR: Jewelry Returns)
// ─────────────────────────────────────────────────────────────────────────────

export const TJRService = {
  ITEM_TYPES: ['necklace', 'bangle', 'bracelet', 'ring', 'earrings', 'chain', 'pendant', 'coins', 'other'],

  PICKUP_SLOTS: [
    '09:00–11:00', '11:00–13:00', '13:00–15:00', '15:00–17:00',
  ],

  /** Calculate assessed TGDP value from jeweler assessment. */
  calculateAssessedTGDP(goldGrams, purityCode) {
    return TGDPService.calculateTGDP(goldGrams, purityCode);
  },

  /** Jeweler assessment fee: 0.5% of assessed gold value. */
  calculateJewelerFee(goldGrams, purityCode, lbmaRate) {
    const value = LBMAService.goldValueINR(goldGrams, purityCode, lbmaRate);
    return Math.round(value * 0.005);
  },

  /** Status flow for T-JR returns. */
  STATUS_FLOW: ['submitted', 'pickup_scheduled', 'picked_up', 'assessed', 'payment_processed', 'completed'],
};

// ─────────────────────────────────────────────────────────────────────────────
// 10. TJDBService  (T-JDB: Design Bank)
// ─────────────────────────────────────────────────────────────────────────────

export const TJDBService = {
  CATEGORIES: ['ring', 'necklace', 'earrings', 'bangle', 'bracelet', 'pendant', 'brooch', 'set', 'other'],

  /** Calculate designer payout from a sale. */
  calculatePayout(salePrice) {
    const payout   = Math.round(salePrice * DESIGNER_SHARE);
    const platform = salePrice - payout;
    return { designerPayout: payout, platformRevenue: platform };
  },

  /** Compute keccak256-equivalent hash for design content (browser-side). */
  async computeDesignHash(content) {
    const encoder = new TextEncoder();
    const data    = encoder.encode(JSON.stringify(content));
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    return '0x' + Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  /** Build IPFS gateway URL from CID. */
  ipfsUrl(cid) {
    if (!cid) return null;
    const cleanCid = cid.startsWith('ipfs://') ? cid.slice(7) : cid;
    return `https://gateway.pinata.cloud/ipfs/${cleanCid}`;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 11. JewelerService
// ─────────────────────────────────────────────────────────────────────────────

export const JewelerService = {
  REQUIRED_CERTS: ['bis_license', 'nabl_cert'],

  PURITY_TOLERANCE: 0.005, // ±0.5% per spec

  /** Check if an assessed purity is within acceptable tolerance of declared. */
  isWithinTolerance(declared, assessed) {
    return Math.abs(declared - assessed) / 1000 <= this.PURITY_TOLERANCE;
  },

  /** Validate BIS license format (ISI mark number). */
  validateBISLicense(value) {
    return typeof value === 'string' && value.trim().length >= 5;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 12. NotificationService
// ─────────────────────────────────────────────────────────────────────────────

export const NotificationService = {
  /** Show an in-app toast (delegates to shared.js showToast). */
  toast(message, type = 'info') {
    if (typeof showToast === 'function') {
      showToast(message, type);
    } else {
      console.log(`[${type.toUpperCase()}] ${message}`);
    }
  },

  /** Notification templates. */
  TEMPLATES: {
    kycApproved:     (name)    => `Welcome, ${name}! Your KYC has been approved.`,
    kycRejected:     (reason)  => `KYC rejected: ${reason}. Please re-submit.`,
    mintApproved:    (tgdp)    => `${tgdp} TGDP credited to your wallet.`,
    complaintFiled:  (id)      => `Complaint ${id} filed. Ombudsman assigned within 48h.`,
    ftrExpiringSoon: (cat, d)  => `Your ${cat} FTR tokens expire in ${d} days.`,
    designSold:      (title)   => `Your design "${title}" was purchased!`,
    gicCredited:     (amount)  => `₹${amount} GIC credited to your account.`,
    paymentSuccess:  (amount)  => `Payment of ₹${amount} received.`,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 13. PaymentService
// ─────────────────────────────────────────────────────────────────────────────

export const PaymentService = {
  VALID_PURPOSES: ['gic_license', 'withdrawal', 'design_purchase'],

  /** Validate INR amount before initiating payment. */
  validateAmount(amount) {
    return typeof amount === 'number' && amount > 0 && amount <= 10000000;
  },

  /** Map purpose to display label. */
  purposeLabel(purpose) {
    const map = {
      gic_license:      'GIC License Fee',
      withdrawal:       'TGDP Withdrawal',
      design_purchase:  'Design Purchase (INR)',
    };
    return map[purpose] || purpose;
  },

  /**
   * Initiate a Razorpay payment.
   * Delegates to window.initiatePayment defined in shared.js.
   */
  pay(amount, purpose, metadata, onSuccess, onFailure) {
    if (typeof initiatePayment !== 'function') {
      console.error('initiatePayment not available — ensure shared.js is loaded');
      onFailure?.({ error: 'Payment gateway not loaded' });
      return;
    }
    const label = this.purposeLabel(purpose);
    initiatePayment(amount, label, purpose, metadata, onSuccess, onFailure);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 14. TradingService
// ─────────────────────────────────────────────────────────────────────────────

export const TradingService = {
  TRADING_FEE: 0, // 0% — spec 3.1

  /** Validate a trade order. */
  validateOrder(fromUserId, toUserId, amount) {
    if (!fromUserId || !toUserId)    return 'Both parties required';
    if (fromUserId === toUserId)     return 'Cannot trade with yourself';
    if (!amount || amount <= 0)      return 'Amount must be positive';
    return null;
  },

  /** Calculate fee (always 0, but kept for future configurability). */
  calculateFee(amount) {
    return Math.round(amount * this.TRADING_FEE);
  },

  /** Net amount received after fee. */
  netAmount(amount) {
    return amount - this.calculateFee(amount);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 15. EarmarkingService
// ─────────────────────────────────────────────────────────────────────────────

export const EarmarkingService = {
  STATUS_FLOW: ['pending_verification', 'active', 'redeemed', 'rejected'],

  /** Earmark represents gold-backed TGDP. Compute expected TGDP on lock. */
  calculateLock(goldGrams, purityCode) {
    const tgdp = TGDPService.calculateTGDP(goldGrams, purityCode);
    return { tgdpAmount: tgdp, pureGoldGrams: goldGrams * (PURITY_STANDARDS[purityCode]?.factor || purityCode / 1000) };
  },

  /** Forfeit: tokens burned when gold is physically withdrawn. */
  forfeitAmount(tgdpBalance) {
    return tgdpBalance; // 1:1 — burn all TGDP linked to earmark
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 16. NominationService
// ─────────────────────────────────────────────────────────────────────────────

export const NominationService = {
  MAX_NOMINEES: 5,
  MAX_SHARE_PCT: 100,

  /** Validate nominee list — shares must sum to 100%. */
  validateNominees(nominees) {
    if (!nominees?.length)         return 'At least one nominee required';
    if (nominees.length > this.MAX_NOMINEES) return `Maximum ${this.MAX_NOMINEES} nominees`;
    const total = nominees.reduce((s, n) => s + (n.share || 0), 0);
    if (Math.abs(total - 100) > 0.01) return `Shares must total 100% (currently ${total}%)`;
    for (const n of nominees) {
      if (!n.name || !n.relationship || !n.aadhaar) return 'Each nominee requires name, relationship, and Aadhaar';
      if (!Validators.aadhaar(n.aadhaar)) return `Invalid Aadhaar for nominee ${n.name}`;
    }
    return null;
  },

  /** Calculate each nominee's TGDP entitlement. */
  calculateEntitlements(totalTGDP, nominees) {
    return nominees.map(n => ({
      ...n,
      tgdpEntitlement: Math.round(totalTGDP * n.share / 100),
    }));
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 17. RecallService
// ─────────────────────────────────────────────────────────────────────────────

export const RecallService = {
  RECALL_TYPES: {
    voluntary: 'User-initiated — user returns gold and burns TGDP',
    forced:    'Admin-initiated — regulatory or fraud-related',
    ftr_buyback: 'Platform buys back FTR tokens at face value',
  },

  /** FTR buyback rate: 1 FTR = 1 TGDP (face value, no penalty). */
  calculateFTRBuyback(ftrAmount) {
    return ftrAmount; // 1:1 buyback
  },

  /** TGDP to burn on voluntary gold recall. */
  calculateTGDPBurn(goldGrams, purityCode) {
    return TGDPService.calculateTGDP(goldGrams, purityCode);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 18. AnalyticsService
// ─────────────────────────────────────────────────────────────────────────────

export const AnalyticsService = {
  /** Summarise transactions into a report object. */
  summariseTransactions(transactions) {
    const summary = { total: 0, byType: {}, byStatus: {}, totalTGDP: 0 };
    for (const tx of transactions) {
      summary.total++;
      summary.byType[tx.type]     = (summary.byType[tx.type]     || 0) + 1;
      summary.byStatus[tx.status] = (summary.byStatus[tx.status] || 0) + 1;
      summary.totalTGDP += tx.amount || 0;
    }
    return summary;
  },

  /** Calculate SLA compliance rate from complaints array. */
  slaComplianceRate(complaints) {
    if (!complaints.length) return 100;
    const breached = complaints.filter(c =>
      ComplaintService.isSLABreached(c.createdAt, c.stage)
    ).length;
    return Math.round(((complaints.length - breached) / complaints.length) * 100);
  },

  /** Export any array as CSV. */
  toCSV(rows, columns) {
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return [
      columns.map(c => c.label || c.key).join(','),
      ...rows.map(r => columns.map(c => escape(r[c.key])).join(',')),
    ].join('\n');
  },

  downloadCSV(csvContent, filename) {
    const a    = document.createElement('a');
    a.href     = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);
    a.download = filename;
    a.click();
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE REGISTRY  (named slots match spec 9.1)
// ─────────────────────────────────────────────────────────────────────────────

export const TGDPServices = {
  User:         UserService,        //  1
  KYC:          KYCService,         //  2
  TGDP:         TGDPService,        //  3
  FTR:          FTRService,         //  4
  GIC:          GICService,         //  5
  LBMA:         LBMAService,        //  6
  Transaction:  TransactionService, //  7
  Complaint:    ComplaintService,   //  8
  TJR:          TJRService,         //  9
  TJDB:         TJDBService,        // 10
  Jeweler:      JewelerService,     // 11
  Notification: NotificationService,// 12
  Payment:      PaymentService,     // 13
  Trading:      TradingService,     // 14
  Earmarking:   EarmarkingService,  // 15
  Nomination:   NominationService,  // 16
  Recall:       RecallService,      // 17
  Analytics:    AnalyticsService,   // 18

  isReady() { return true; },
};

// ─── CJS compat for Node (seed script / tests) ────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TGDPServices,
    UserService, KYCService, TGDPService, FTRService, GICService,
    LBMAService, TransactionService, ComplaintService, TJRService,
    TJDBService, JewelerService, NotificationService, PaymentService,
    TradingService, EarmarkingService, NominationService, RecallService,
    AnalyticsService,
    Validators, formatINR, formatTGDP, generateId,
    PURITY_STANDARDS, FTR_CATEGORIES, ROLE_INCOMPATIBILITIES,
    TGDP_PER_GRAM, FTR_COMMISSION, GIC_SHARE, DESIGNER_SHARE,
  };
}
