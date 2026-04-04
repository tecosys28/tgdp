// ═══════════════════════════════════════════════════════════════════════════
// TGDP BLOCKCHAIN SERVICE
// ethers.js v6  |  Polygon mainnet + Amoy testnet
// Reads contract addresses from Firestore /config/contracts at runtime.
// All writes go through the REGISTRAR wallet (server-side / Cloud Function).
// Browser callers use read-only provider; no private keys in the browser.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Network config ───────────────────────────────────────────────────────────

export const NETWORKS = {
  polygon: {
    name:        'Polygon Mainnet',
    chainId:     137,
    rpcUrl:      'https://polygon-rpc.com',
    explorerUrl: 'https://polygonscan.com',
  },
  amoy: {
    // Polygon's current testnet (Mumbai deprecated → Amoy)
    name:        'Polygon Amoy Testnet',
    chainId:     80002,
    rpcUrl:      'https://rpc-amoy.polygon.technology',
    explorerUrl: 'https://amoy.polygonscan.com',
  },
};

// Active network — switch to 'polygon' for production
export const ACTIVE_NETWORK = NETWORKS.amoy;

// ─── ABIs (matching contracts.sol exactly) ────────────────────────────────────

export const TGDP_ABI = [
  // ERC-20 standard
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  // TGDP-specific
  'function mint(address to, uint256 goldMilligrams, bytes32 certificateHash) returns (bytes32)',
  'function burn(uint256 amount)',
  'function getMintRecord(bytes32 recordId) view returns (address recipient, uint256 amount, bytes32 certificateHash, uint256 goldMilligrams, uint256 timestamp)',
  'function getMintRecordCount() view returns (uint256)',
  'function TGDP_PER_GRAM() view returns (uint256)',
  // Events
  'event TGDPMinted(bytes32 indexed recordId, address indexed recipient, uint256 amount, bytes32 certificateHash, uint256 goldMilligrams, uint256 timestamp)',
  'event TGDPBurned(address indexed holder, uint256 amount, uint256 timestamp)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

export const FTR_ABI = [
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])',
  'function getValidBalance(address user, uint256 categoryId) view returns (uint256)',
  'function getEarliestExpiry(address user, uint256 categoryId) view returns (uint256)',
  'function categoryNames(uint256 id) view returns (string)',
  'function swap(uint256 tgdpAmount, uint256 categoryId) returns (bytes32)',
  'function redeem(uint256 categoryId, uint256 amount, address partner) returns (bytes32)',
  'function registerPartner(address partner)',
  'function revokePartner(address partner)',
  'event FTRSwapped(bytes32 indexed swapId, address indexed user, uint256 tgdpAmount, uint256 ftrAmount, uint256 categoryId, uint256 commission, uint256 expiryDate)',
  'event FTRRedeemed(bytes32 indexed redemptionId, address indexed user, uint256 categoryId, uint256 amount, address indexed partner)',
];

export const GIC_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function credit(address licensee, uint256 amount, uint8 streamType, bytes32 relatedTxHash) returns (bytes32)',
  'function redeem(uint256 amount)',
  'function incrementHouseholdCount(address licensee)',
  'function getLicenseeStats(address licensee) view returns (uint256 totalEarned, uint256 totalRedeemed, uint256 registrationEarnings, uint256 mintingEarnings, uint256 tradingEarnings, uint256 balance, uint256 householdCount)',
  'event GICCredited(bytes32 indexed creditId, address indexed licensee, uint256 amount, uint8 streamType, bytes32 relatedTxHash)',
  'event GICRedeemed(address indexed licensee, uint256 amount, uint256 timestamp)',
];

export const REGISTRY_ABI = [
  'function registerUser(address user, bytes32 kycHash, uint8[] roles)',
  'function linkHouseholdToLicensee(address household, address licensee)',
  'function earmarkGold(address owner, bytes32 certificateHash, uint256 pureGoldMilligrams, uint256 tgdpAmount) returns (bytes32)',
  'function deactivateEarmark(bytes32 earmarkId)',
  'function hasUserRole(address user, uint8 role) view returns (bool)',
  'function getUser(address user) view returns (bytes32 kycHash, uint8[] roles, bool isActive, uint256 registeredAt, address linkedLicensee)',
  'function getLicenseeHouseholds(address licensee) view returns (address[])',
  'function getEarmark(bytes32 earmarkId) view returns (address owner, bytes32 certificateHash, uint256 pureGoldMilligrams, uint256 tgdpAmount, uint256 timestamp, bool isActive)',
  'function getTotalUsers() view returns (uint256)',
  'function getTotalEarmarks() view returns (uint256)',
  'event UserRegistered(address indexed user, bytes32 kycHash, uint8[] roles, uint256 timestamp)',
  'event HouseholdLinked(address indexed household, address indexed licensee, uint256 timestamp)',
  'event GoldEarmarked(bytes32 indexed earmarkId, address indexed owner, bytes32 certificateHash, uint256 goldMilligrams, uint256 tgdpAmount)',
];

export const IPR_ABI = [
  'function registerDesign(bytes32 designHash, string metadataUri, address designer) returns (uint256)',
  'function recordSale(uint256 designId, address buyer, uint256 amount)',
  'function transferDesign(uint256 designId, address newOwner)',
  'function deactivateDesign(uint256 designId)',
  'function verifyOwnership(uint256 designId, address claimedOwner) view returns (bool)',
  'function getDesign(uint256 designId) view returns (bytes32 designHash, string metadataUri, address designer, uint256 registeredAt, bool isActive, uint256 salesCount, uint256 totalRevenue)',
  'function getDesignerDesigns(address designer) view returns (uint256[])',
  'function getDesignIdByHash(bytes32 designHash) view returns (uint256)',
  'function getTotalDesigns() view returns (uint256)',
  'event DesignRegistered(uint256 indexed designId, bytes32 designHash, address indexed designer, string metadataUri, uint256 timestamp)',
  'event DesignTransferred(uint256 indexed designId, address indexed from, address indexed to, uint256 timestamp)',
  'event DesignSold(uint256 indexed designId, address indexed buyer, uint256 amount, uint256 timestamp)',
];

// ─── IPFS / Pinata config ─────────────────────────────────────────────────────

export const IPFS_CONFIG = {
  gateway:         'https://gateway.pinata.cloud/ipfs/',
  pinataEndpoint:  'https://api.pinata.cloud/pinning/pinFileToIPFS',
  // API keys are injected at runtime from Firestore /config/secrets (admin only)
  // Never hardcode them here.
};

// ─── BlockchainService ────────────────────────────────────────────────────────
// Browser: read-only (balances, verifications, explorer links)
// Server (Cloud Function): full signer access via REGISTRAR_PRIVATE_KEY env var

export class BlockchainService {
  constructor() {
    this.provider    = null;
    this.signer      = null;
    this.contracts   = {};
    this.addresses   = {};     // loaded from Firestore
    this.initialized = false;
  }

  /**
   * Initialize read-only provider (browser / verification use).
   * @param {object} contractAddresses  { tgdpToken, ftrToken, gicToken, registry, iprRegistry }
   */
  async initReadOnly(contractAddresses) {
    const { ethers } = await import('https://cdn.jsdelivr.net/npm/ethers@6.13.1/dist/ethers.min.js');
    this._ethers   = ethers;
    this.provider  = new ethers.JsonRpcProvider(ACTIVE_NETWORK.rpcUrl);
    this.addresses = contractAddresses;
    this._attachContracts(this.provider);
    this.initialized = true;
  }

  /**
   * Initialize with signer (Node.js / Cloud Functions only).
   * @param {string} privateKey          Registrar wallet private key.
   * @param {object} contractAddresses   Same as above.
   */
  async initWithSigner(privateKey, contractAddresses) {
    const { ethers } = require('ethers');   // Node import
    this._ethers      = ethers;
    this.provider     = new ethers.JsonRpcProvider(ACTIVE_NETWORK.rpcUrl);
    this.signer       = new ethers.Wallet(privateKey, this.provider);
    this.addresses    = contractAddresses;
    this._attachContracts(this.signer);
    this.initialized  = true;
  }

  _attachContracts(signerOrProvider) {
    const { ethers } = this._ethers ? { ethers: this._ethers } : require('ethers');
    const a = this.addresses;
    this.contracts.tgdp     = new ethers.Contract(a.tgdpToken,   TGDP_ABI,     signerOrProvider);
    this.contracts.ftr      = new ethers.Contract(a.ftrToken,    FTR_ABI,      signerOrProvider);
    this.contracts.gic      = new ethers.Contract(a.gicToken,    GIC_ABI,      signerOrProvider);
    this.contracts.registry = new ethers.Contract(a.registry,    REGISTRY_ABI, signerOrProvider);
    this.contracts.ipr      = new ethers.Contract(a.iprRegistry, IPR_ABI,      signerOrProvider);
  }

  _requireSigner() {
    if (!this.signer) throw new Error('Signer required — use initWithSigner()');
  }

  // ── TGDP reads ──────────────────────────────────────────────────────────────

  async getTGDPBalance(address) {
    const raw = await this.contracts.tgdp.balanceOf(address);
    return this._ethers.formatUnits(raw, 18);
  }

  async getMintRecord(recordId) {
    const r = await this.contracts.tgdp.getMintRecord(recordId);
    return {
      recipient:       r[0],
      amount:          this._ethers.formatUnits(r[1], 18),
      certificateHash: r[2],
      goldMilligrams:  Number(r[3]),
      timestamp:       Number(r[4]),
    };
  }

  async getTotalMinted() {
    return Number(await this.contracts.tgdp.getMintRecordCount());
  }

  // ── TGDP writes (signer required) ──────────────────────────────────────────

  /**
   * Mint TGDP on-chain for verified gold earmark.
   * @param {string}  toAddress         Recipient wallet (hex).
   * @param {number}  goldMilligrams    Pure gold in milligrams.
   * @param {string}  certificateHash   bytes32 hex string of purity cert.
   */
  async mintTGDP(toAddress, goldMilligrams, certificateHash) {
    this._requireSigner();
    const tx = await this.contracts.tgdp.mint(
      toAddress,
      BigInt(goldMilligrams),
      certificateHash,
    );
    const receipt = await tx.wait();
    const event   = receipt.logs
      .map(l => { try { return this.contracts.tgdp.interface.parseLog(l); } catch { return null; } })
      .find(e => e && e.name === 'TGDPMinted');

    return {
      txHash:    receipt.hash,
      blockNumber: receipt.blockNumber,
      recordId:  event ? event.args.recordId : null,
      gasUsed:   receipt.gasUsed.toString(),
      explorerUrl: this.getExplorerUrl(receipt.hash),
    };
  }

  async burnTGDP(amount) {
    this._requireSigner();
    const tx      = await this.contracts.tgdp.burn(this._ethers.parseUnits(String(amount), 18));
    const receipt = await tx.wait();
    return { txHash: receipt.hash, explorerUrl: this.getExplorerUrl(receipt.hash) };
  }

  // ── FTR reads ───────────────────────────────────────────────────────────────

  async getFTRBalance(address, categoryId) {
    const raw = await this.contracts.ftr.balanceOf(address, categoryId);
    return this._ethers.formatUnits(raw, 18);
  }

  async getValidFTRBalance(address, categoryId) {
    const raw = await this.contracts.ftr.getValidBalance(address, categoryId);
    return this._ethers.formatUnits(raw, 18);
  }

  async getFTREarliestExpiry(address, categoryId) {
    const ts = await this.contracts.ftr.getEarliestExpiry(address, categoryId);
    return Number(ts) > 0 ? new Date(Number(ts) * 1000).toISOString() : null;
  }

  // ── FTR writes ──────────────────────────────────────────────────────────────

  async swapToFTR(tgdpAmount, categoryId) {
    this._requireSigner();
    const amountWei = this._ethers.parseUnits(String(tgdpAmount), 18);
    // Approve first
    const approveTx = await this.contracts.tgdp.approve(this.addresses.ftrToken, amountWei);
    await approveTx.wait();
    // Swap
    const tx      = await this.contracts.ftr.swap(amountWei, categoryId);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, explorerUrl: this.getExplorerUrl(receipt.hash) };
  }

  async redeemFTR(categoryId, amount, partnerAddress) {
    this._requireSigner();
    const tx = await this.contracts.ftr.redeem(
      categoryId,
      this._ethers.parseUnits(String(amount), 18),
      partnerAddress,
    );
    const receipt = await tx.wait();
    return { txHash: receipt.hash, explorerUrl: this.getExplorerUrl(receipt.hash) };
  }

  // ── GIC reads / writes ──────────────────────────────────────────────────────

  async getGICBalance(address) {
    const raw = await this.contracts.gic.balanceOf(address);
    return this._ethers.formatUnits(raw, 18);
  }

  async getLicenseeStats(address) {
    const s = await this.contracts.gic.getLicenseeStats(address);
    return {
      totalEarned:          this._ethers.formatUnits(s[0], 18),
      totalRedeemed:        this._ethers.formatUnits(s[1], 18),
      registrationEarnings: this._ethers.formatUnits(s[2], 18),
      mintingEarnings:      this._ethers.formatUnits(s[3], 18),
      tradingEarnings:      this._ethers.formatUnits(s[4], 18),
      balance:              this._ethers.formatUnits(s[5], 18),
      householdCount:       Number(s[6]),
    };
  }

  async creditGIC(licenseeAddress, amount, streamType, relatedTxHash) {
    this._requireSigner();
    const tx = await this.contracts.gic.credit(
      licenseeAddress,
      this._ethers.parseUnits(String(amount), 18),
      streamType,
      relatedTxHash || this._ethers.ZeroHash,
    );
    const receipt = await tx.wait();
    return { txHash: receipt.hash, explorerUrl: this.getExplorerUrl(receipt.hash) };
  }

  // ── Registry writes ─────────────────────────────────────────────────────────

  async registerUserOnChain(userAddress, kycDocumentHash, roles) {
    this._requireSigner();
    const tx = await this.contracts.registry.registerUser(userAddress, kycDocumentHash, roles);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, explorerUrl: this.getExplorerUrl(receipt.hash) };
  }

  async linkHouseholdOnChain(householdAddress, licenseeAddress) {
    this._requireSigner();
    const tx = await this.contracts.registry.linkHouseholdToLicensee(householdAddress, licenseeAddress);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, explorerUrl: this.getExplorerUrl(receipt.hash) };
  }

  async earmarkGoldOnChain(ownerAddress, certificateHash, goldMilligrams, tgdpWei) {
    this._requireSigner();
    const tx = await this.contracts.registry.earmarkGold(
      ownerAddress,
      certificateHash,
      BigInt(goldMilligrams),
      tgdpWei,
    );
    const receipt = await tx.wait();
    const event   = receipt.logs
      .map(l => { try { return this.contracts.registry.interface.parseLog(l); } catch { return null; } })
      .find(e => e && e.name === 'GoldEarmarked');

    return {
      txHash:    receipt.hash,
      earmarkId: event ? event.args.earmarkId : null,
      explorerUrl: this.getExplorerUrl(receipt.hash),
    };
  }

  // ── IPR reads / writes ──────────────────────────────────────────────────────

  async registerDesignOnChain(designHash, metadataUri, designerAddress) {
    this._requireSigner();
    const tx = await this.contracts.ipr.registerDesign(designHash, metadataUri, designerAddress);
    const receipt = await tx.wait();
    const event   = receipt.logs
      .map(l => { try { return this.contracts.ipr.interface.parseLog(l); } catch { return null; } })
      .find(e => e && e.name === 'DesignRegistered');

    return {
      txHash:    receipt.hash,
      designId:  event ? Number(event.args.designId) : null,
      explorerUrl: this.getExplorerUrl(receipt.hash),
    };
  }

  async verifyDesignOwnership(designId, claimedOwner) {
    return await this.contracts.ipr.verifyOwnership(designId, claimedOwner);
  }

  async getDesignOnChain(designId) {
    const d = await this.contracts.ipr.getDesign(designId);
    return {
      designHash:   d[0],
      metadataUri:  d[1],
      designer:     d[2],
      registeredAt: Number(d[3]),
      isActive:     d[4],
      salesCount:   Number(d[5]),
      totalRevenue: this._ethers.formatUnits(d[6], 18),
    };
  }

  // ── IPFS upload ─────────────────────────────────────────────────────────────

  async uploadToIPFS(file, metadata, pinataApiKey, pinataSecretKey) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('pinataMetadata', JSON.stringify({
      name:      metadata.name || 'TGDP Document',
      keyvalues: metadata,
    }));

    const response = await fetch(IPFS_CONFIG.pinataEndpoint, {
      method:  'POST',
      headers: {
        'pinata_api_key':        pinataApiKey,
        'pinata_secret_api_key': pinataSecretKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Pinata upload failed: ${err}`);
    }

    const result = await response.json();
    return {
      ipfsHash: result.IpfsHash,
      url:      IPFS_CONFIG.gateway + result.IpfsHash,
    };
  }

  // ── Hashing helpers ─────────────────────────────────────────────────────────

  /**
   * Compute keccak256 hash of any JSON-serialisable object.
   * Used to create certificateHash and designHash before calling contracts.
   */
  hashDocument(content) {
    const { ethers } = this._ethers ? { ethers: this._ethers } : require('ethers');
    return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(content)));
  }

  // ── Utility ─────────────────────────────────────────────────────────────────

  getExplorerUrl(txHash) {
    return `${ACTIVE_NETWORK.explorerUrl}/tx/${txHash}`;
  }

  isValidAddress(address) {
    const { ethers } = this._ethers ? { ethers: this._ethers } : require('ethers');
    return ethers.isAddress(address);
  }

  async getNetworkInfo() {
    const network = await this.provider.getNetwork();
    return { chainId: Number(network.chainId), name: network.name };
  }
}

// ─── Singleton for browser use ────────────────────────────────────────────────

export const blockchainService = new BlockchainService();

// ─── FTR category constants (mirrors Solidity) ────────────────────────────────

export const FTR_CATEGORIES = {
  HOSPITALITY: 1,
  HEALTHCARE:  2,
  EDUCATION:   3,
  RETAIL:      4,
  TRAVEL:      5,
};

// ─── GIC stream type constants (mirrors Solidity) ─────────────────────────────

export const GIC_STREAMS = {
  REGISTRATION: 1,
  MINTING:      2,
  TRADING:      3,
};

// ─── Role ID constants (mirrors TGDPRegistry.sol) ─────────────────────────────

export const ROLES = {
  HOUSEHOLD:  1,
  LICENSEE:   2,
  JEWELER:    3,
  DESIGNER:   4,
  RETURNEE:   5,
  CONSULTANT: 6,
  ADVERTISER: 7,
  OMBUDSMAN:  8,
};
