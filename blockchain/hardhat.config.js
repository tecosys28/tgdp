// ═══════════════════════════════════════════════════════════════════════════
// TGDP — HARDHAT CONFIG
// Compiles and deploys the 5 TGDP smart contracts to Polygon / Amoy testnet.
//
// Setup:
//   cd blockchain
//   npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox @openzeppelin/contracts
//   npx hardhat compile
//   npx hardhat run scripts/deploy.js --network amoy
//   npx hardhat run scripts/deploy.js --network polygon   # mainnet
// ═══════════════════════════════════════════════════════════════════════════

require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config({ path: '../.env' });

const DEPLOYER_PRIVATE_KEY  = process.env.DEPLOYER_PRIVATE_KEY  || '0x0000000000000000000000000000000000000000000000000000000000000001';
const REGISTRAR_PRIVATE_KEY = process.env.REGISTRAR_PRIVATE_KEY || DEPLOYER_PRIVATE_KEY;
const POLYGONSCAN_API_KEY   = process.env.POLYGONSCAN_API_KEY   || '';

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.20',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },

  networks: {
    // Local dev
    hardhat: {},

    // Polygon Amoy testnet (get MATIC from https://faucet.polygon.technology/)
    amoy: {
      url:      'https://rpc-amoy.polygon.technology',
      chainId:  80002,
      accounts: [DEPLOYER_PRIVATE_KEY],
      gasPrice: 'auto',
    },

    // Polygon Mainnet
    polygon: {
      url:      process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
      chainId:  137,
      accounts: [DEPLOYER_PRIVATE_KEY],
      gasPrice: 'auto',
    },
  },

  etherscan: {
    apiKey: {
      polygon:        POLYGONSCAN_API_KEY,
      polygonAmoy:    POLYGONSCAN_API_KEY,
    },
    customChains: [
      {
        network:  'polygonAmoy',
        chainId:  80002,
        urls: {
          apiURL:     'https://api-amoy.polygonscan.com/api',
          browserURL: 'https://amoy.polygonscan.com',
        },
      },
    ],
  },

  paths: {
    sources:   './contracts',
    tests:     './test',
    cache:     './cache',
    artifacts: './artifacts',
  },
};
