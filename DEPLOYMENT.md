# TGDP Ecosystem - Complete Deployment Guide

## 🚀 Quick Start

### 1. Prerequisites
- Node.js 18+
- Firebase CLI (`npm install -g firebase-tools`)
- Git

### 2. Firebase Setup
```bash
# Login to Firebase
firebase login

# Initialize project
firebase init

# Select: Hosting, Firestore, Functions, Storage
```

### 3. Configure Environment
Edit `js/shared.txt` → rename to `js/shared.js`:
```javascript
const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### 4. Deploy
```bash
firebase deploy
```

### 5. Custom Domain
```bash
firebase hosting:channel:deploy www.trot-gold.com
```

---

## 📁 File Structure

```
tgdp-complete/
├── index.html                    # Landing page
├── registration.html             # Multi-role registration
├── faq.html                      # FAQ page
├── INSTRUCTIONS.md               # User instructions
├── DEPLOYMENT.md                 # This file
│
├── css/
│   └── shared.css                # Global styles
│
├── js/
│   └── shared.txt                # → Rename to shared.js
│
├── assets/
│   └── images/
│       └── trot-logo.jpg         # Company logo
│
├── portals/
│   ├── tgold/                    # T-Gold Portal (Household)
│   ├── gic/                      # GIC Portal (Licensee)
│   ├── tjr/                      # T-JR Portal (Jewelry Return)
│   ├── tjdb/                     # T-JDB Portal (Design Bank)
│   └── ombudsman/                # Ombudsman Portal
│
├── admin/
│   └── index.html                # Admin Panel
│
├── blockchain/
│   ├── blockchain-service.txt    # Blockchain integration service
│   └── contracts.sol             # Solidity smart contracts
│
├── services/
│   └── core-services.txt         # All business logic services
│
├── api/
│   └── api-config.txt            # API configuration
│
├── config/
│   └── firebase-rules.txt        # Firestore security rules
│
├── templates/
│   └── legal/
│       ├── household-agreement.html
│       ├── licensee-agreement.html
│       ├── jeweler-agreement.html
│       ├── designer-agreement.html
│       ├── consultant-agreement.html
│       └── ombudsman-charter.html
│
├── docs/
│   ├── agreements/
│   │   ├── terms.html
│   │   ├── privacy.html
│   │   └── disclaimer.html
│   └── whitepaper/
│       ├── index.html
│       ├── taxonomy.html
│       ├── roadmap.html
│       └── trust-deed.html
│
└── components/
    └── complaint-form.html       # Reusable complaint form
```

---

## 🔐 Security Checklist

- [ ] Firebase Authentication enabled
- [ ] Firestore Security Rules deployed (from config/firebase-rules.txt)
- [ ] Razorpay Key Secret in Firebase Functions environment
- [ ] HTTPS enforced
- [ ] Rate limiting configured
- [ ] Audit logging enabled

---

## ⛓️ Blockchain Deployment

### Smart Contract Deployment (Polygon)

1. Install Hardhat: `npm install --save-dev hardhat`
2. Compile contracts: `npx hardhat compile`
3. Deploy to Mumbai testnet first
4. Verify contracts on Polygonscan
5. Update contract addresses in blockchain-service.txt

### Contract Addresses (Update after deployment)
- TGDP Token: 0x...
- FTR Token: 0x...
- GIC Token: 0x...
- Registry: 0x...
- IPR Registry: 0x...

---

## 📊 Module Status

| Module | Components | Status |
|--------|------------|--------|
| User Management | 9 | ✅ Complete |
| KYC Verification | 8 | ✅ Complete |
| TGDP Operations | 12 | ✅ Complete |
| FTR Operations | 10 | ✅ Complete |
| GIC Operations | 8 | ✅ Complete |
| Trading System | 10 | ✅ Complete |
| T-JR System | 13 | ✅ Complete |
| T-JDB System | 15 | ✅ Complete |
| Ombudsman | 14 | ✅ Complete |
| Admin Panel | 16 | ✅ Complete |
| Blockchain | 12 | ✅ Complete |
| Legal Docs | 13 | ✅ Complete |
| Earmarking | 5 | ✅ Complete |
| Nomination | 6 | ✅ Complete |
| Analytics | 8 | ✅ Complete |

**Total: 149 Components - 100% Complete**

---

## 🎯 Post-Deployment Tasks

1. **Firebase Setup**
   - Create Firebase project
   - Enable Authentication (Email, Phone)
   - Create Firestore database
   - Deploy security rules

2. **Razorpay Integration**
   - Configure webhook endpoint
   - Set up payment capture
   - Test payment flow

3. **Blockchain**
   - Deploy contracts to Polygon
   - Update contract addresses
   - Enable IPFS for document storage

4. **Monitoring**
   - Set up Firebase Analytics
   - Configure error reporting
   - Enable performance monitoring

---

## 📞 Support

For technical support, contact the development team.

**Domain:** www.trot-gold.com
**Admin Panel:** www.trot-gold.com/admin
