/* ═══════════════════════════════════════════════════════════════════════════
   TGDP ECOSYSTEM - SHARED JAVASCRIPT
   Version: 1.0.0
   Last Updated: March 2026
   ═══════════════════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════════════════════
// FIREBASE CONFIGURATION (Replace with your Firebase project details)
// ═══════════════════════════════════════════════════════════════════════════
const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
  measurementId: "YOUR_MEASUREMENT_ID"
};

// Firebase initialization (uncomment when Firebase SDK is loaded)
// import { initializeApp } from 'firebase/app';
// import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
// import { getFirestore, collection, doc, setDoc, getDoc, updateDoc, query, where, getDocs } from 'firebase/firestore';
// import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
// const app = initializeApp(FIREBASE_CONFIG);
// const auth = getAuth(app);
// const db = getFirestore(app);
// const storage = getStorage(app);

// ═══════════════════════════════════════════════════════════════════════════
// RAZORPAY CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════
const RAZORPAY_CONFIG = {
  key_id: "SNvdpImD0XKojj",  // TROT Gold Razorpay Key ID
  key_secret: "YOUR_KEY_SECRET",       // Keep this on server-side only - DO NOT expose in frontend
  currency: "INR",
  company_name: "TROT Gold",
  company_logo: "assets/images/trot-logo.jpg",
  theme_color: "#d4af37"
};

// Razorpay payment handler (example)
function initiatePayment(amount, description, onSuccess, onFailure) {
  const options = {
    key: RAZORPAY_CONFIG.key_id,
    amount: amount * 100, // Razorpay expects amount in paise
    currency: RAZORPAY_CONFIG.currency,
    name: RAZORPAY_CONFIG.company_name,
    description: description,
    image: RAZORPAY_CONFIG.company_logo,
    handler: function(response) {
      // Payment successful
      console.log('Payment ID:', response.razorpay_payment_id);
      if (onSuccess) onSuccess(response);
    },
    prefill: {
      name: TGDP.user?.name || '',
      email: TGDP.user?.email || '',
      contact: TGDP.user?.phone || ''
    },
    theme: {
      color: RAZORPAY_CONFIG.theme_color
    },
    modal: {
      ondismiss: function() {
        if (onFailure) onFailure({ error: 'Payment cancelled' });
      }
    }
  };
  
  // Uncomment when Razorpay SDK is loaded
  // const rzp = new Razorpay(options);
  // rzp.open();
  
  // Mock for development
  console.log('Razorpay payment initiated (mock):', options);
  showToast('Payment gateway will be activated after Razorpay integration', 'info');
}

// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL STATE
// ═══════════════════════════════════════════════════════════════════════════
const TGDP = {
  // Current user (populated after login)
  user: null,
  
  // Current LBMA rate (simulated - would come from API)
  lbmaRate: 7342,
  lbmaRateUSD: 88.50,
  
  // Exchange rate
  usdToInr: 83.00,
  
  // App version
  version: '1.0.0',
  
  // Portal colors for theming
  portalColors: {
    tgold: '#d4af37',
    gic: '#a78bfa',
    tjr: '#2dd4bf',
    tjdb: '#fb7185'
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// FORMATTING UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format number as Indian Rupees
 */
function formatINR(amount, decimals = 0) {
  if (typeof amount !== 'number' || isNaN(amount)) return '₹0';
  return '₹' + amount.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

/**
 * Format number as US Dollars
 */
function formatUSD(amount, decimals = 2) {
  if (typeof amount !== 'number' || isNaN(amount)) return '$0.00';
  return '$' + amount.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

/**
 * Format number with commas (Indian style)
 */
function formatNumber(num, decimals = 0) {
  if (typeof num !== 'number' || isNaN(num)) return '0';
  return num.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

/**
 * Format date in Indian format
 */
function formatDate(date, format = 'short') {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  
  const options = {
    short: { day: '2-digit', month: 'short', year: 'numeric' },
    long: { day: '2-digit', month: 'long', year: 'numeric' },
    full: { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' },
    datetime: { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
  };
  
  return d.toLocaleDateString('en-IN', options[format] || options.short);
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
function formatRelativeTime(date) {
  const now = new Date();
  const d = new Date(date);
  const diff = now - d;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  return formatDate(date);
}

// ═══════════════════════════════════════════════════════════════════════════
// ID GENERATORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a random alphanumeric ID
 */
function generateId(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate reference number with prefix
 */
function generateRefNo(prefix = 'REF') {
  const year = new Date().getFullYear();
  const num = String(Math.floor(Math.random() * 90000) + 10000);
  return `${prefix}-${year}-${num}`;
}

/**
 * Generate application IDs for different entity types
 */
function generateApplicationId(type) {
  const prefixes = {
    licensee: 'LIC',
    household: 'HH',
    jeweler: 'JWL',
    designer: 'DES',
    returnee: 'RET',
    consultant: 'CON',
    advertiser: 'ADV',
    ombudsman: 'OMB'
  };
  const prefix = prefixes[type] || 'APP';
  const region = 'IND'; // Could be dynamic based on user location
  const num = String(Math.floor(Math.random() * 90000) + 10000);
  return `${prefix}-${region}-${num}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate email format
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email.trim());
}

/**
 * Validate phone number (Indian format)
 */
function isValidPhone(phone) {
  if (!phone || typeof phone !== 'string') return false;
  const cleaned = phone.replace(/\D/g, '');
  // Indian mobile: 10 digits starting with 6-9
  return /^[6-9]\d{9}$/.test(cleaned);
}

/**
 * Validate PAN number
 */
function isValidPAN(pan) {
  if (!pan || typeof pan !== 'string') return false;
  // PAN format: 5 letters, 4 digits, 1 letter
  const regex = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
  return regex.test(pan.toUpperCase().trim());
}

/**
 * Validate Aadhaar number
 */
function isValidAadhaar(aadhaar) {
  if (!aadhaar || typeof aadhaar !== 'string') return false;
  const cleaned = aadhaar.replace(/\D/g, '');
  // Aadhaar: 12 digits, doesn't start with 0 or 1
  return /^[2-9]\d{11}$/.test(cleaned);
}

/**
 * Validate GST number
 */
function isValidGST(gst) {
  if (!gst || typeof gst !== 'string') return false;
  // GST format: 2 digits state code, 10 char PAN, 1 digit entity, Z, 1 check digit
  const regex = /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/;
  return regex.test(gst.toUpperCase().trim());
}

/**
 * Validate password strength
 */
function isStrongPassword(password) {
  if (!password || typeof password !== 'string') return false;
  // At least 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char
  const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/;
  return regex.test(password);
}

// ═══════════════════════════════════════════════════════════════════════════
// ROLE COMPATIBILITY MATRIX
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Role incompatibility rules
 * Key: role that has restrictions
 * Value: array of roles it CANNOT be combined with
 */
const ROLE_INCOMPATIBILITIES = {
  ombudsman: ['licensee', 'household', 'jeweler', 'designer', 'returnee', 'consultant', 'advertiser'],
  jeweler: ['household', 'returnee', 'designer', 'consultant', 'licensee'],
  household: ['jeweler'],
  returnee: ['jeweler'],
  designer: ['jeweler'],
  consultant: ['jeweler'],
  licensee: ['jeweler'],
  advertiser: []
};

/**
 * Check if a role combination is valid
 */
function isRoleCombinationValid(roles) {
  if (!Array.isArray(roles) || roles.length === 0) return true;
  
  // Check each role against its incompatible roles
  for (const role of roles) {
    const incompatible = ROLE_INCOMPATIBILITIES[role] || [];
    for (const otherRole of roles) {
      if (role !== otherRole && incompatible.includes(otherRole)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Get list of roles that are incompatible with currently selected roles
 */
function getIncompatibleRoles(selectedRoles) {
  const incompatible = new Set();
  
  for (const role of selectedRoles) {
    const roleIncompatible = ROLE_INCOMPATIBILITIES[role] || [];
    roleIncompatible.forEach(r => incompatible.add(r));
  }
  
  return Array.from(incompatible);
}

/**
 * Get role display name
 */
function getRoleDisplayName(role) {
  const names = {
    licensee: 'TGDP Licensee',
    household: 'Household',
    jeweler: 'Registered Jeweler',
    designer: 'Jewelry Designer',
    returnee: 'Jewelry Returnee',
    consultant: 'Gold Consultant',
    advertiser: 'Advertiser',
    ombudsman: 'Ombudsman'
  };
  return names[role] || role;
}

// ═══════════════════════════════════════════════════════════════════════════
// UI UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Show toast notification
 */
function showToast(message, type = 'info', duration = 3000) {
  // Remove existing toasts
  document.querySelectorAll('.toast').forEach(t => t.remove());
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${getToastIcon(type)}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;
  
  // Add toast styles if not present
  if (!document.getElementById('toast-styles')) {
    const styles = document.createElement('style');
    styles.id = 'toast-styles';
    styles.textContent = `
      .toast {
        position: fixed;
        bottom: 2rem;
        right: 2rem;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 1rem 1.5rem;
        background: var(--obsidian-light);
        border: 1px solid var(--obsidian-border);
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        z-index: 9999;
        animation: slideIn 0.3s ease;
      }
      .toast-success { border-color: var(--success); }
      .toast-error { border-color: var(--danger); }
      .toast-warning { border-color: var(--warning); }
      .toast-info { border-color: var(--info); }
      .toast-icon { font-size: 1.25rem; }
      .toast-message { font-size: 0.9rem; }
      .toast-close {
        margin-left: 0.5rem;
        background: none;
        border: none;
        color: var(--text-muted);
        font-size: 1.25rem;
        cursor: pointer;
      }
      .toast-close:hover { color: var(--text-primary); }
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `;
    document.head.appendChild(styles);
  }
  
  document.body.appendChild(toast);
  
  if (duration > 0) {
    setTimeout(() => toast.remove(), duration);
  }
}

function getToastIcon(type) {
  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };
  return icons[type] || icons.info;
}

/**
 * Show loading overlay
 */
function showLoading(message = 'Loading...') {
  hideLoading(); // Remove any existing
  
  const overlay = document.createElement('div');
  overlay.id = 'loading-overlay';
  overlay.innerHTML = `
    <div class="loading-content">
      <div class="loading-spinner"></div>
      <div class="loading-message">${message}</div>
    </div>
  `;
  
  // Add loading styles if not present
  if (!document.getElementById('loading-styles')) {
    const styles = document.createElement('style');
    styles.id = 'loading-styles';
    styles.textContent = `
      #loading-overlay {
        position: fixed;
        inset: 0;
        background: rgba(10,10,15,0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
      }
      .loading-content {
        text-align: center;
      }
      .loading-spinner {
        width: 48px;
        height: 48px;
        border: 3px solid var(--obsidian-border);
        border-top-color: var(--gold);
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 1rem;
      }
      .loading-message {
        color: var(--text-secondary);
        font-size: 0.9rem;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(styles);
  }
  
  document.body.appendChild(overlay);
}

/**
 * Hide loading overlay
 */
function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.remove();
}

/**
 * Show/hide panel in dashboard
 */
function showPanel(panelId) {
  // Hide all panels
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  
  // Show selected panel
  const panel = document.getElementById(`panel-${panelId}`);
  if (panel) {
    panel.classList.add('active');
  }
  
  // Update nav items
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
    if (item.onclick && item.onclick.toString().includes(`'${panelId}'`)) {
      item.classList.add('active');
    }
  });
  
  // Update page title if exists
  const titleMap = {
    'overview': 'Dashboard Overview',
    'households': 'My Households',
    'gic-earnings': 'GIC Earnings',
    'gic-redeem': 'Redeem GIC',
    'reports': 'Reports',
    'complaints': 'Ombudsman Complaints',
    'settings': 'Settings'
  };
  
  const pageTitle = document.getElementById('pageTitle');
  if (pageTitle && titleMap[panelId]) {
    pageTitle.textContent = titleMap[panelId];
  }
}

/**
 * Open modal
 */
function openModal(modalId) {
  const modal = document.getElementById(`modal-${modalId}`);
  if (modal) {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

/**
 * Close modal
 */
function closeModal(modalId) {
  const modal = document.getElementById(`modal-${modalId}`);
  if (modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
}

/**
 * Close modal when clicking overlay
 */
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
    document.body.style.overflow = '';
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FORM UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate form and return errors
 */
function validateForm(formId) {
  const form = document.getElementById(formId);
  if (!form) return { valid: false, errors: ['Form not found'] };
  
  const errors = [];
  const requiredFields = form.querySelectorAll('[required]');
  
  requiredFields.forEach(field => {
    const value = field.value.trim();
    const label = field.previousElementSibling?.textContent || field.name || 'Field';
    
    if (!value) {
      errors.push(`${label.replace(' *', '')} is required`);
      field.classList.add('error');
    } else {
      field.classList.remove('error');
      
      // Type-specific validation
      if (field.type === 'email' && !isValidEmail(value)) {
        errors.push('Please enter a valid email address');
        field.classList.add('error');
      }
      if (field.dataset.validate === 'phone' && !isValidPhone(value)) {
        errors.push('Please enter a valid phone number');
        field.classList.add('error');
      }
      if (field.dataset.validate === 'pan' && !isValidPAN(value)) {
        errors.push('Please enter a valid PAN number');
        field.classList.add('error');
      }
      if (field.dataset.validate === 'aadhaar' && !isValidAadhaar(value)) {
        errors.push('Please enter a valid Aadhaar number');
        field.classList.add('error');
      }
    }
  });
  
  return { valid: errors.length === 0, errors };
}

/**
 * Reset form
 */
function resetForm(formId) {
  const form = document.getElementById(formId);
  if (form) {
    form.reset();
    form.querySelectorAll('.error').forEach(el => el.classList.remove('error'));
    form.querySelectorAll('.form-error').forEach(el => el.remove());
  }
}

/**
 * Serialize form data to object
 */
function serializeForm(formId) {
  const form = document.getElementById(formId);
  if (!form) return {};
  
  const data = {};
  const formData = new FormData(form);
  
  for (const [key, value] of formData.entries()) {
    if (data[key]) {
      // Handle multiple values (checkboxes)
      if (!Array.isArray(data[key])) {
        data[key] = [data[key]];
      }
      data[key].push(value);
    } else {
      data[key] = value;
    }
  }
  
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════
// LBMA RATE SIMULATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update LBMA rate with small random variation (simulation)
 */
function updateLBMARate() {
  // Small random variation: ±₹5
  const variation = (Math.random() - 0.5) * 10;
  TGDP.lbmaRate = Math.round(7342 + variation);
  
  // Update all rate displays
  document.querySelectorAll('[data-lbma-rate]').forEach(el => {
    el.textContent = formatINR(TGDP.lbmaRate);
  });
  
  document.querySelectorAll('#lbmaRate').forEach(el => {
    el.textContent = formatINR(TGDP.lbmaRate);
  });
}

// Update rate every 15 seconds
setInterval(updateLBMARate, 15000);

// ═══════════════════════════════════════════════════════════════════════════
// REPORT GENERATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate report (placeholder for actual implementation)
 */
function generateReport(reportType) {
  const reportTitles = {
    'household-enrolment': '🏠 Household Enrolment Summary',
    'gic-earnings': '🎫 GIC Earnings Statement',
    'gic-redemption': '💱 GIC Redemption History',
    'minting-activity': '⛏️ Household Minting Activity',
    'ftr-purchases': '🎯 FTR Purchase Report',
    'licence-utilisation': '📜 Licence Utilisation Report',
    'payment-status': '💳 Payment/Tranche Status',
    'dormant-households': '😴 Dormant Households',
    'pending-kyc': '📋 Pending KYC',
    'gic-expiry': '⏰ GIC Expiry Warning',
    'payment-overdue': '💸 Payment Overdue',
    'household-complaints': '📢 Household Complaints',
    'audit-flags': '🔍 Audit Flags',
    'capacity-alert': '📊 Licence Capacity Alert'
  };
  
  showLoading('Generating report...');
  
  // Simulate report generation delay
  setTimeout(() => {
    hideLoading();
    
    const preview = document.getElementById('reportPreview');
    const title = document.getElementById('reportPreviewTitle');
    const content = document.getElementById('reportPreviewContent');
    
    if (preview && title && content) {
      title.textContent = reportTitles[reportType] || '📊 Report';
      content.innerHTML = generateReportContent(reportType);
      preview.style.display = 'block';
      preview.scrollIntoView({ behavior: 'smooth' });
    } else {
      showToast(`Report "${reportTitles[reportType]}" generated successfully!`, 'success');
    }
  }, 1000);
}

/**
 * Generate sample report content
 */
function generateReportContent(reportType) {
  const today = formatDate(new Date());
  
  // Return sample content based on report type
  return `
    <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
      <div style="font-size: 3rem; margin-bottom: 1rem;">📊</div>
      <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">Report generated successfully</p>
      <p style="font-size: 0.85rem;">Generated on: ${today}</p>
      <p style="font-size: 0.85rem; margin-top: 1rem;">
        Download using the buttons above or view in the preview panel.
      </p>
    </div>
  `;
}

/**
 * Close report preview
 */
function closeReportPreview() {
  const preview = document.getElementById('reportPreview');
  if (preview) preview.style.display = 'none';
}

/**
 * Download report
 */
function downloadReport(format) {
  showToast(`Downloading report as ${format.toUpperCase()}...`, 'info');
  
  // In production, this would generate and download the actual file
  setTimeout(() => {
    showToast(`Report downloaded successfully!`, 'success');
  }, 1500);
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPLAINT FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Submit complaint to Ombudsman
 */
function submitComplaint() {
  const against = document.getElementById('complaintAgainst')?.value;
  const category = document.getElementById('complaintCategory')?.value;
  const subject = document.getElementById('complaintSubject')?.value;
  const description = document.getElementById('complaintDescription')?.value;
  
  if (!against || !category || !subject || !description) {
    showToast('Please fill in all required fields', 'error');
    return;
  }
  
  showLoading('Submitting complaint...');
  
  setTimeout(() => {
    hideLoading();
    
    const refNo = generateRefNo('OMB');
    
    showToast(`Complaint ${refNo} submitted successfully!`, 'success');
    
    // Clear form
    document.getElementById('complaintAgainst').value = '';
    document.getElementById('complaintCategory').value = '';
    document.getElementById('complaintSubject').value = '';
    document.getElementById('complaintDescription').value = '';
  }, 1500);
}

/**
 * View complaint details
 */
function viewComplaint(refNo) {
  openModal('complaint-view');
  // In production, fetch and display complaint details
  showToast(`Loading complaint ${refNo}...`, 'info');
}

// ═══════════════════════════════════════════════════════════════════════════
// FILE UPLOAD HANDLING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handle file selection
 */
function handleFileSelect(inputId, previewId) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  
  if (!input || !input.files.length) return;
  
  const file = input.files[0];
  const maxSize = 5 * 1024 * 1024; // 5MB
  
  if (file.size > maxSize) {
    showToast('File size must be less than 5MB', 'error');
    input.value = '';
    return;
  }
  
  const validTypes = ['image/jpeg', 'image/png', 'application/pdf'];
  if (!validTypes.includes(file.type)) {
    showToast('Only JPG, PNG, and PDF files are allowed', 'error');
    input.value = '';
    return;
  }
  
  if (preview) {
    preview.innerHTML = `
      <span style="color: var(--success);">✓</span>
      ${file.name} (${(file.size / 1024).toFixed(1)} KB)
    `;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WIZARD NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════

let currentWizardStep = 1;
const totalWizardSteps = 4;

/**
 * Go to next wizard step
 */
function nextStep() {
  if (currentWizardStep < totalWizardSteps) {
    // Validate current step
    const validation = validateCurrentStep();
    if (!validation.valid) {
      showToast(validation.errors[0], 'error');
      return;
    }
    
    currentWizardStep++;
    updateWizardUI();
  }
}

/**
 * Go to previous wizard step
 */
function prevStep() {
  if (currentWizardStep > 1) {
    currentWizardStep--;
    updateWizardUI();
  }
}

/**
 * Go to specific wizard step
 */
function goToStep(step) {
  if (step >= 1 && step <= totalWizardSteps && step <= currentWizardStep + 1) {
    currentWizardStep = step;
    updateWizardUI();
  }
}

/**
 * Update wizard UI
 */
function updateWizardUI() {
  // Update step indicators
  document.querySelectorAll('.wizard-step').forEach((el, index) => {
    el.classList.remove('active', 'completed');
    if (index + 1 < currentWizardStep) {
      el.classList.add('completed');
    } else if (index + 1 === currentWizardStep) {
      el.classList.add('active');
    }
  });
  
  // Update step connectors
  document.querySelectorAll('.wizard-connector').forEach((el, index) => {
    el.classList.remove('completed');
    if (index + 1 < currentWizardStep) {
      el.classList.add('completed');
    }
  });
  
  // Show/hide step content
  document.querySelectorAll('.wizard-content').forEach((el, index) => {
    el.style.display = (index + 1 === currentWizardStep) ? 'block' : 'none';
  });
  
  // Update navigation buttons
  const prevBtn = document.getElementById('wizardPrev');
  const nextBtn = document.getElementById('wizardNext');
  const submitBtn = document.getElementById('wizardSubmit');
  
  if (prevBtn) prevBtn.style.display = currentWizardStep > 1 ? 'inline-flex' : 'none';
  if (nextBtn) nextBtn.style.display = currentWizardStep < totalWizardSteps ? 'inline-flex' : 'none';
  if (submitBtn) submitBtn.style.display = currentWizardStep === totalWizardSteps ? 'inline-flex' : 'none';
}

/**
 * Validate current wizard step
 */
function validateCurrentStep() {
  // Override this in specific pages for step-specific validation
  return { valid: true, errors: [] };
}

// ═══════════════════════════════════════════════════════════════════════════
// MOBILE NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Toggle mobile sidebar
 */
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    sidebar.classList.toggle('open');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  // Initialize LBMA rate display
  updateLBMARate();
  
  // Initialize wizard if present
  if (document.querySelector('.wizard-steps')) {
    updateWizardUI();
  }
  
  // Initialize chatbot
  initChatbot();
  
  // Initialize FAQ if present
  initFAQ();
  
  // Initialize soft keyboards
  initSoftKeyboards();
  
  // Log initialization
  console.log('TGDP Ecosystem initialized', TGDP.version);
});

// ═══════════════════════════════════════════════════════════════════════════
// CHATBOT SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

const CHATBOT_RESPONSES = {
  greetings: [
    "Hello! I'm TROT Assistant. How can I help you today?",
    "Welcome to TGDP! I'm here to assist with any questions about T-Gold, FTRs, GICs, or our ecosystem."
  ],
  tgold: "T-Gold (TGDP) represents tokenized gold at 10 TGDPs per gram of pure gold. You can mint, trade with 0% fees, and convert to FTRs. Would you like to know more about minting or trading?",
  ftr: "Future Trade Rights (FTRs) are redeemable credits from T-Gold swaps (4% commission). Categories include Hospitality, Healthcare, Education, Retail, and Travel. Valid for 12 months.",
  gic: "Gold Income Coupons (GICs) are Licensee earnings at 25% revenue share across 3 streams: Registration fees, Minting commissions, and Trading activity. Licensees pay $300/household capacity.",
  complaint: "To file a complaint, go to your portal dashboard and click 'File Complaint'. The 5-step process: Filing → Acknowledgment (24-48h) → Investigation (3-7 days) → Mediation (7-10 days) → Resolution (10-14 days).",
  pricing: "Current LBMA gold rate determines all valuations. Platform fee is 0% for trading. FTR swap commission is 4%. Licensee cost is $300 USD per household capacity.",
  default: "I can help with T-Gold, FTRs, GICs, complaints, pricing, and general platform questions. What would you like to know?"
};

function initChatbot() {
  // Create chatbot HTML if not exists
  if (!document.getElementById('trot-chatbot')) {
    const chatbotHTML = `
      <!-- Chatbot Trigger Button -->
      <button class="chatbot-trigger" id="chatbot-trigger" onclick="toggleChatbot()">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C6.48 2 2 6.48 2 12c0 1.54.36 2.98.97 4.29L2 22l5.71-.97A9.96 9.96 0 0012 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm-1 15h2v2h-2v-2zm0-10h2v8h-2V7z"/>
        </svg>
      </button>
      
      <!-- Chatbot Window -->
      <div class="chatbot-window" id="chatbot-window">
        <div class="chatbot-header">
          <div class="chatbot-header-info">
            <div class="chatbot-avatar">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.48 2 2 6.48 2 12c0 1.54.36 2.98.97 4.29L2 22l5.71-.97A9.96 9.96 0 0012 22c5.52 0 10-4.48 10-10S17.52 2 12 2z"/>
              </svg>
            </div>
            <div class="chatbot-header-text">
              <h4>TROT Assistant</h4>
              <span>● Online</span>
            </div>
          </div>
          <button class="chatbot-close" onclick="toggleChatbot()">×</button>
        </div>
        
        <div class="chatbot-messages" id="chatbot-messages">
          <div class="chat-message bot">
            Hello! I'm TROT Assistant. I can help you with T-Gold, FTRs, GICs, complaints, and more. How can I assist you today?
          </div>
        </div>
        
        <div class="chatbot-quick-actions">
          <button class="quick-action-btn" onclick="sendQuickMessage('What is T-Gold?')">T-Gold</button>
          <button class="quick-action-btn" onclick="sendQuickMessage('How do FTRs work?')">FTRs</button>
          <button class="quick-action-btn" onclick="sendQuickMessage('Explain GIC earnings')">GICs</button>
          <button class="quick-action-btn" onclick="sendQuickMessage('How to file complaint?')">Complaints</button>
          <button class="quick-action-btn" onclick="sendQuickMessage('What are the fees?')">Pricing</button>
        </div>
        
        <div class="chatbot-input">
          <input type="text" id="chatbot-input" placeholder="Type your message..." onkeypress="handleChatKeypress(event)">
          <button onclick="sendChatMessage()">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', chatbotHTML);
  }
}

function toggleChatbot() {
  const window = document.getElementById('chatbot-window');
  window.classList.toggle('active');
  if (window.classList.contains('active')) {
    document.getElementById('chatbot-input').focus();
  }
}

function sendQuickMessage(message) {
  const input = document.getElementById('chatbot-input');
  input.value = message;
  sendChatMessage();
}

function handleChatKeypress(event) {
  if (event.key === 'Enter') {
    sendChatMessage();
  }
}

function sendChatMessage() {
  const input = document.getElementById('chatbot-input');
  const message = input.value.trim();
  if (!message) return;
  
  const messagesContainer = document.getElementById('chatbot-messages');
  
  // Add user message
  messagesContainer.innerHTML += `<div class="chat-message user">${escapeHtml(message)}</div>`;
  input.value = '';
  
  // Generate response
  setTimeout(() => {
    const response = getChatbotResponse(message);
    messagesContainer.innerHTML += `<div class="chat-message bot">${response}</div>`;
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }, 500);
  
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function getChatbotResponse(message) {
  const lower = message.toLowerCase();
  
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    return CHATBOT_RESPONSES.greetings[Math.floor(Math.random() * CHATBOT_RESPONSES.greetings.length)];
  }
  if (lower.includes('t-gold') || lower.includes('tgold') || lower.includes('tgdp') || lower.includes('mint') || lower.includes('tokenize')) {
    return CHATBOT_RESPONSES.tgold;
  }
  if (lower.includes('ftr') || lower.includes('future trade') || lower.includes('swap')) {
    return CHATBOT_RESPONSES.ftr;
  }
  if (lower.includes('gic') || lower.includes('license') || lower.includes('earning') || lower.includes('income')) {
    return CHATBOT_RESPONSES.gic;
  }
  if (lower.includes('complaint') || lower.includes('dispute') || lower.includes('problem') || lower.includes('issue')) {
    return CHATBOT_RESPONSES.complaint;
  }
  if (lower.includes('price') || lower.includes('fee') || lower.includes('cost') || lower.includes('rate')) {
    return CHATBOT_RESPONSES.pricing;
  }
  
  return CHATBOT_RESPONSES.default;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ═══════════════════════════════════════════════════════════════════════════
// SOFT KEYBOARD SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

function initSoftKeyboards() {
  // Add soft keyboard toggle to inputs with data-soft-keyboard attribute
  document.querySelectorAll('[data-soft-keyboard]').forEach(input => {
    wrapWithSoftKeyboard(input);
  });
}

function wrapWithSoftKeyboard(input) {
  const type = input.getAttribute('data-soft-keyboard') || 'alpha';
  const wrapper = document.createElement('div');
  wrapper.className = 'soft-keyboard-container';
  input.parentNode.insertBefore(wrapper, input);
  wrapper.appendChild(input);
  
  // Add toggle button
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'soft-keyboard-toggle';
  toggleBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z"/></svg>`;
  toggleBtn.onclick = () => toggleSoftKeyboard(input.id || generateId('sk'));
  wrapper.appendChild(toggleBtn);
  
  // Create keyboard
  const keyboard = createSoftKeyboard(type, input);
  wrapper.appendChild(keyboard);
  
  // Store input ID for reference
  if (!input.id) input.id = generateId('input');
  keyboard.setAttribute('data-target-input', input.id);
}

function createSoftKeyboard(type, targetInput) {
  const keyboard = document.createElement('div');
  keyboard.className = `soft-keyboard ${type === 'numeric' ? 'numeric' : ''}`;
  keyboard.id = `keyboard-${targetInput.id || generateId('kb')}`;
  
  let keysHTML = '';
  
  if (type === 'numeric') {
    keysHTML = `
      <div class="soft-keyboard-header">
        <span>Numeric Keyboard</span>
        <button class="soft-keyboard-close" onclick="closeSoftKeyboard('${keyboard.id}')">×</button>
      </div>
      <div class="soft-keyboard-row">
        <button class="soft-key" onclick="typeSoftKey('1', '${targetInput.id}')">1</button>
        <button class="soft-key" onclick="typeSoftKey('2', '${targetInput.id}')">2</button>
        <button class="soft-key" onclick="typeSoftKey('3', '${targetInput.id}')">3</button>
      </div>
      <div class="soft-keyboard-row">
        <button class="soft-key" onclick="typeSoftKey('4', '${targetInput.id}')">4</button>
        <button class="soft-key" onclick="typeSoftKey('5', '${targetInput.id}')">5</button>
        <button class="soft-key" onclick="typeSoftKey('6', '${targetInput.id}')">6</button>
      </div>
      <div class="soft-keyboard-row">
        <button class="soft-key" onclick="typeSoftKey('7', '${targetInput.id}')">7</button>
        <button class="soft-key" onclick="typeSoftKey('8', '${targetInput.id}')">8</button>
        <button class="soft-key" onclick="typeSoftKey('9', '${targetInput.id}')">9</button>
      </div>
      <div class="soft-keyboard-row">
        <button class="soft-key" onclick="typeSoftKey('.', '${targetInput.id}')">.</button>
        <button class="soft-key" onclick="typeSoftKey('0', '${targetInput.id}')">0</button>
        <button class="soft-key" onclick="backspaceSoftKey('${targetInput.id}')">⌫</button>
      </div>
    `;
  } else {
    keysHTML = `
      <div class="soft-keyboard-header">
        <span>Virtual Keyboard</span>
        <button class="soft-keyboard-close" onclick="closeSoftKeyboard('${keyboard.id}')">×</button>
      </div>
      <div class="soft-keyboard-row">
        <button class="soft-key" onclick="typeSoftKey('1', '${targetInput.id}')">1</button>
        <button class="soft-key" onclick="typeSoftKey('2', '${targetInput.id}')">2</button>
        <button class="soft-key" onclick="typeSoftKey('3', '${targetInput.id}')">3</button>
        <button class="soft-key" onclick="typeSoftKey('4', '${targetInput.id}')">4</button>
        <button class="soft-key" onclick="typeSoftKey('5', '${targetInput.id}')">5</button>
        <button class="soft-key" onclick="typeSoftKey('6', '${targetInput.id}')">6</button>
        <button class="soft-key" onclick="typeSoftKey('7', '${targetInput.id}')">7</button>
        <button class="soft-key" onclick="typeSoftKey('8', '${targetInput.id}')">8</button>
        <button class="soft-key" onclick="typeSoftKey('9', '${targetInput.id}')">9</button>
        <button class="soft-key" onclick="typeSoftKey('0', '${targetInput.id}')">0</button>
      </div>
      <div class="soft-keyboard-row">
        <button class="soft-key" onclick="typeSoftKey('Q', '${targetInput.id}')">Q</button>
        <button class="soft-key" onclick="typeSoftKey('W', '${targetInput.id}')">W</button>
        <button class="soft-key" onclick="typeSoftKey('E', '${targetInput.id}')">E</button>
        <button class="soft-key" onclick="typeSoftKey('R', '${targetInput.id}')">R</button>
        <button class="soft-key" onclick="typeSoftKey('T', '${targetInput.id}')">T</button>
        <button class="soft-key" onclick="typeSoftKey('Y', '${targetInput.id}')">Y</button>
        <button class="soft-key" onclick="typeSoftKey('U', '${targetInput.id}')">U</button>
        <button class="soft-key" onclick="typeSoftKey('I', '${targetInput.id}')">I</button>
        <button class="soft-key" onclick="typeSoftKey('O', '${targetInput.id}')">O</button>
        <button class="soft-key" onclick="typeSoftKey('P', '${targetInput.id}')">P</button>
      </div>
      <div class="soft-keyboard-row">
        <button class="soft-key" onclick="typeSoftKey('A', '${targetInput.id}')">A</button>
        <button class="soft-key" onclick="typeSoftKey('S', '${targetInput.id}')">S</button>
        <button class="soft-key" onclick="typeSoftKey('D', '${targetInput.id}')">D</button>
        <button class="soft-key" onclick="typeSoftKey('F', '${targetInput.id}')">F</button>
        <button class="soft-key" onclick="typeSoftKey('G', '${targetInput.id}')">G</button>
        <button class="soft-key" onclick="typeSoftKey('H', '${targetInput.id}')">H</button>
        <button class="soft-key" onclick="typeSoftKey('J', '${targetInput.id}')">J</button>
        <button class="soft-key" onclick="typeSoftKey('K', '${targetInput.id}')">K</button>
        <button class="soft-key" onclick="typeSoftKey('L', '${targetInput.id}')">L</button>
      </div>
      <div class="soft-keyboard-row">
        <button class="soft-key" onclick="typeSoftKey('Z', '${targetInput.id}')">Z</button>
        <button class="soft-key" onclick="typeSoftKey('X', '${targetInput.id}')">X</button>
        <button class="soft-key" onclick="typeSoftKey('C', '${targetInput.id}')">C</button>
        <button class="soft-key" onclick="typeSoftKey('V', '${targetInput.id}')">V</button>
        <button class="soft-key" onclick="typeSoftKey('B', '${targetInput.id}')">B</button>
        <button class="soft-key" onclick="typeSoftKey('N', '${targetInput.id}')">N</button>
        <button class="soft-key" onclick="typeSoftKey('M', '${targetInput.id}')">M</button>
        <button class="soft-key wide" onclick="backspaceSoftKey('${targetInput.id}')">⌫</button>
      </div>
      <div class="soft-keyboard-row">
        <button class="soft-key wide" onclick="typeSoftKey('@', '${targetInput.id}')">@</button>
        <button class="soft-key extra-wide" onclick="typeSoftKey(' ', '${targetInput.id}')">Space</button>
        <button class="soft-key" onclick="typeSoftKey('.', '${targetInput.id}')">.</button>
        <button class="soft-key wide" onclick="closeSoftKeyboard('${keyboard.id}')">Done</button>
      </div>
    `;
  }
  
  keyboard.innerHTML = keysHTML;
  return keyboard;
}

function toggleSoftKeyboard(inputId) {
  const keyboard = document.querySelector(`[data-target-input="${inputId}"]`) || 
                   document.getElementById(`keyboard-${inputId}`);
  if (keyboard) {
    keyboard.classList.toggle('active');
    if (keyboard.classList.contains('active')) {
      document.getElementById(inputId)?.focus();
    }
  }
}

function closeSoftKeyboard(keyboardId) {
  const keyboard = document.getElementById(keyboardId);
  if (keyboard) {
    keyboard.classList.remove('active');
  }
}

function typeSoftKey(char, inputId) {
  const input = document.getElementById(inputId);
  if (input) {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.value = input.value.substring(0, start) + char + input.value.substring(end);
    input.selectionStart = input.selectionEnd = start + 1;
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function backspaceSoftKey(inputId) {
  const input = document.getElementById(inputId);
  if (input && input.value.length > 0) {
    const start = input.selectionStart;
    if (start > 0) {
      input.value = input.value.substring(0, start - 1) + input.value.substring(start);
      input.selectionStart = input.selectionEnd = start - 1;
    }
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// Global function to add soft keyboard to any input programmatically
function enableSoftKeyboard(inputId, type = 'alpha') {
  const input = document.getElementById(inputId);
  if (input && !input.closest('.soft-keyboard-container')) {
    input.setAttribute('data-soft-keyboard', type);
    wrapWithSoftKeyboard(input);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FAQ SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

function initFAQ() {
  // Initialize FAQ accordions
  document.querySelectorAll('.faq-question').forEach(question => {
    question.addEventListener('click', () => {
      const item = question.closest('.faq-item');
      const wasActive = item.classList.contains('active');
      
      // Close all FAQs in the same section
      item.closest('.faq-section')?.querySelectorAll('.faq-item').forEach(i => {
        i.classList.remove('active');
      });
      
      // Toggle current
      if (!wasActive) {
        item.classList.add('active');
      }
    });
  });
  
  // Initialize FAQ search
  const searchInput = document.getElementById('faq-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      filterFAQs(e.target.value);
    });
  }
  
  // Initialize category filters
  document.querySelectorAll('.faq-category-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.faq-category-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterFAQsByCategory(btn.getAttribute('data-category'));
    });
  });
}

function filterFAQs(query) {
  const lowerQuery = query.toLowerCase();
  let hasResults = false;
  
  document.querySelectorAll('.faq-item').forEach(item => {
    const question = item.querySelector('.faq-question h4')?.textContent.toLowerCase() || '';
    const answer = item.querySelector('.faq-answer-content')?.textContent.toLowerCase() || '';
    
    if (question.includes(lowerQuery) || answer.includes(lowerQuery)) {
      item.style.display = '';
      hasResults = true;
      
      // Expand if matches
      if (lowerQuery.length > 2) {
        item.classList.add('active');
      }
    } else {
      item.style.display = 'none';
    }
  });
  
  // Show/hide sections based on visible items
  document.querySelectorAll('.faq-section').forEach(section => {
    const visibleItems = section.querySelectorAll('.faq-item[style=""], .faq-item:not([style])');
    section.style.display = visibleItems.length > 0 ? '' : 'none';
  });
  
  // Show no results message
  const noResults = document.getElementById('faq-no-results');
  if (noResults) {
    noResults.style.display = hasResults ? 'none' : 'block';
  }
}

function filterFAQsByCategory(category) {
  if (!category || category === 'all') {
    document.querySelectorAll('.faq-section').forEach(s => s.style.display = '');
    document.querySelectorAll('.faq-item').forEach(i => i.style.display = '');
    return;
  }
  
  document.querySelectorAll('.faq-section').forEach(section => {
    section.style.display = section.getAttribute('data-category') === category ? '' : 'none';
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT FOR MODULES (if using ES modules)
// ═══════════════════════════════════════════════════════════════════════════
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TGDP,
    formatINR,
    formatUSD,
    formatNumber,
    formatDate,
    generateId,
    generateRefNo,
    isValidEmail,
    isValidPhone,
    isValidPAN,
    isValidAadhaar,
    isRoleCombinationValid,
    getIncompatibleRoles,
    showToast,
    showLoading,
    hideLoading,
    showPanel,
    openModal,
    closeModal,
    toggleChatbot,
    enableSoftKeyboard,
    filterFAQs
  };
}
