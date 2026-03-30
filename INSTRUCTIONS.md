# TGDP Ecosystem Deployment Guide
## www.trot-gold.com

---

## 📁 Project Structure

```
tgdp-complete/
├── index.html                    # Main ecosystem hub
├── registration.html             # Multi-role registration wizard
├── css/
│   └── shared.css                # Design system & components
├── js/
│   └── shared.js                 # Utility functions
├── components/
│   └── complaint-form.html       # Reusable complaint component
├── portals/
│   ├── tgold/                    # T-Gold Portal
│   │   ├── index.html            # Landing page
│   │   └── dashboard.html        # Dashboard with minting, trading, FTR
│   ├── gic/                      # GIC Licensing Portal
│   │   ├── index.html            # Landing page
│   │   └── dashboard.html        # Licensee dashboard
│   ├── tjr/                      # T-JR Jewelry Return Portal
│   │   ├── index.html            # Landing page
│   │   └── dashboard.html        # Returns management
│   ├── tjdb/                     # T-JDB Design Bank Portal
│   │   ├── index.html            # Landing page
│   │   └── dashboard.html        # Design gallery & orders
│   └── ombudsman/                # Ombudsman Portal
│       ├── index.html            # Landing + protocol info
│       └── dashboard.html        # Case management
└── docs/
    ├── agreements/
    │   ├── terms.html            # Terms of Service
    │   ├── privacy.html          # Privacy Policy
    │   └── disclaimer.html       # Disclaimer
    └── whitepaper/
        ├── index.html            # Whitepaper hub
        ├── taxonomy.html         # Asset taxonomy
        └── roadmap.html          # Development roadmap
```

---

## 🚀 Firebase Deployment

### Step 1: Install Firebase CLI
```bash
npm install -g firebase-tools
```

### Step 2: Login to Firebase
```bash
firebase login
```

### Step 3: Initialize Project
```bash
cd tgdp-complete
firebase init hosting
```

When prompted:
- Select your Firebase project or create new
- Public directory: `.` (current directory)
- Single-page app: `No`
- Overwrite index.html: `No`

### Step 4: Deploy
```bash
firebase deploy --only hosting
```

### Step 5: Configure Custom Domain
1. Go to Firebase Console → Hosting
2. Click "Add custom domain"
3. Enter: `www.trot-gold.com`
4. Add the DNS records to your domain registrar
5. Wait for SSL provisioning (up to 24 hours)

---

## ⚙️ Configuration Required

### Firebase Config (firebase.json)
```json
{
  "hosting": {
    "public": ".",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**",
      "README.md",
      "INSTRUCTIONS.md"
    ],
    "rewrites": [],
    "headers": [
      {
        "source": "**/*.@(js|css)",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "max-age=31536000"
          }
        ]
      }
    ]
  }
}
```

### Razorpay Integration
Replace `RAZORPAY_KEY_ID` in js/shared.js with your actual key:
```javascript
const RAZORPAY_KEY = 'rzp_live_XXXXXXXXXXXXXX';
```

### Firebase Authentication (Future)
For user authentication, add Firebase Auth:
```html
<script src="https://www.gstatic.com/firebasejs/9.x.x/firebase-app.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.x.x/firebase-auth.js"></script>
```

---

## 🎨 Portal Color Themes

| Portal | Primary Color | CSS Variable |
|--------|---------------|--------------|
| T-Gold | Gold #d4af37 | `--gold` |
| GIC Licensing | Purple #a78bfa | `--purple` |
| T-JR | Teal #2dd4bf | `--teal` |
| T-JDB | Rose #fb7185 | `--rose` |
| Ombudsman | Slate #94a3b8 | `--ombudsman` |

---

## ⚖️ Complaint Protocol (5 Steps)

1. **Filing** (Day 0) - User submits via any portal dashboard
2. **Acknowledgment** (24-48 hours) - Ombudsman confirms receipt
3. **Investigation** (3-7 days) - Evidence collection
4. **Mediation** (7-10 days) - Parties brought together
5. **Resolution** (10-14 days) - Binding decision issued

### Who Can File Complaints:
- Households (via T-Gold)
- Licensees (via GIC)
- Returnees (via T-JR)
- Designers/Buyers (via T-JDB)
- Jewelers, Consultants, Advertisers

---

## 👥 User Roles & Compatibility

| Role | Cannot Combine With |
|------|---------------------|
| Ombudsman | ALL (exclusive role) |
| Jeweler | Household, Returnee, Designer, Consultant, Licensee |
| Household | Jeweler |
| Advertiser | None (can combine with any) |

---

## 📝 Pending Legal Documents

The following require legal drafting before go-live:

### Role-Specific Agreements
- `docs/licenses/licensee.html`
- `docs/licenses/household.html`
- `docs/licenses/jeweler.html`
- `docs/licenses/designer.html`
- `docs/licenses/returnee.html`
- `docs/licenses/consultant.html`
- `docs/licenses/advertiser.html`
- `docs/licenses/ombudsman.html`

### Trust Documents
- `docs/whitepaper/trust-deed.html`

---

## 🔧 Technical Notes

- All files are self-contained HTML with inline/linked CSS and JS
- No build step required
- Works on any static hosting (Firebase, Netlify, Vercel, S3)
- Mobile responsive design
- Dark theme optimized for gold aesthetics

---

## 📞 Support

For technical issues: support@trot-gold.com
For legal/compliance: legal@trot-gold.com

---

*Last Updated: March 28, 2026*
