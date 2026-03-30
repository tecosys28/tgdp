# FILE RENAME GUIDE

## Files to Rename After Download

When uploading to your server, rename these files:

| Current Name (Email-Safe) | Rename To (For Server) |
|---------------------------|------------------------|
| `js/shared.txt` | `js/shared.js` |
| `blockchain/blockchain-service.txt` | `blockchain/blockchain-service.js` |
| `services/core-services.txt` | `services/core-services.js` |
| `api/api-config.txt` | `api/api-config.js` |

## Quick Rename Commands

### Mac/Linux:
```bash
mv js/shared.txt js/shared.js
mv blockchain/blockchain-service.txt blockchain/blockchain-service.js
mv services/core-services.txt services/core-services.js
mv api/api-config.txt api/api-config.js
```

### Windows (Command Prompt):
```cmd
ren js\shared.txt shared.js
ren blockchain\blockchain-service.txt blockchain-service.js
ren services\core-services.txt core-services.js
ren api\api-config.txt api-config.js
```

### Windows (PowerShell):
```powershell
Rename-Item -Path "js\shared.txt" -NewName "shared.js"
Rename-Item -Path "blockchain\blockchain-service.txt" -NewName "blockchain-service.js"
Rename-Item -Path "services\core-services.txt" -NewName "core-services.js"
Rename-Item -Path "api\api-config.txt" -NewName "api-config.js"
```

## Update HTML References

After renaming, update all HTML files that reference these:

Find: `shared.txt`
Replace: `shared.js`

Find: `blockchain-service.txt`
Replace: `blockchain-service.js`

Find: `core-services.txt`
Replace: `core-services.js`

Find: `api-config.txt`
Replace: `api-config.js`
