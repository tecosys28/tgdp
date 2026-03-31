// ═══════════════════════════════════════════════════════════════════════════
// TGDP BLOCKCHAIN RECORDING SYSTEM
// Version: 1.0.0
// Supports: Ethereum/Polygon for smart contracts, IPFS for document hashes
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const BLOCKCHAIN_CONFIG = {
  // Network Configuration (Use Polygon for lower gas fees)
  network: {
    name: 'polygon',
    chainId: 137,
    rpcUrl: 'https://polygon-rpc.com',
    explorerUrl: 'https://polygonscan.com',
    // Testnet for development
    testnet: {
      name: 'polygon-mumbai',
      chainId: 80001,
      rpcUrl: 'https://rpc-mumbai.maticvigil.com',
      explorerUrl: 'https://mumbai.polygonscan.com'
    }
  },
  
  // Contract Addresses (Deploy and update these)
  contracts: {
    tgdpToken: '0x0000000000000000000000000000000000000000', // TGDP ERC-20 Token
    ftrToken: '0x0000000000000000000000000000000000000000',  // FTR ERC-1155 Multi-Token
    gicToken: '0x0000000000000000000000000000000000000000',  // GIC ERC-20 Token
    registry: '0x0000000000000000000000000000000000000000',  // Main Registry Contract
    iprRegistry: '0x0000000000000000000000000000000000000000' // IPR Design Registry
  },
  
  // IPFS Configuration for document storage
  ipfs: {
    gateway: 'https://ipfs.io/ipfs/',
    pinataApiKey: 'YOUR_PINATA_API_KEY',
    pinataSecretKey: 'YOUR_PINATA_SECRET_KEY',
    pinataEndpoint: 'https://api.pinata.cloud/pinning/pinFileToIPFS'
  },
  
  // Gas settings
  gas: {
    maxPriorityFeePerGas: '30000000000', // 30 Gwei
    maxFeePerGas: '50000000000', // 50 Gwei
    gasLimit: 500000
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SMART CONTRACT ABIs
// ─────────────────────────────────────────────────────────────────────────────

// TGDP Token ABI (ERC-20 with minting and burning)
const TGDP_TOKEN_ABI = [
  // Read functions
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  
  // Write functions
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount, bytes32 goldCertificateHash) returns (bool)",
  "function burn(uint256 amount) returns (bool)",
  
  // Events
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  "event Minted(address indexed to, uint256 amount, bytes32 certificateHash, uint256 timestamp)",
  "event Burned(address indexed from, uint256 amount, uint256 timestamp)"
];

// FTR Token ABI (ERC-1155 Multi-Token for 5 categories)
const FTR_TOKEN_ABI = [
  // Read functions
  "function uri(uint256 tokenId) view returns (string)",
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])",
  "function isApprovedForAll(address account, address operator) view returns (bool)",
  "function getCategoryName(uint256 tokenId) view returns (string)",
  "function getExpiryDate(address account, uint256 tokenId) view returns (uint256)",
  
  // Write functions
  "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
  "function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)",
  "function setApprovalForAll(address operator, bool approved)",
  "function swap(uint256 tgdpAmount, uint256 categoryId) returns (uint256 ftrAmount)",
  "function redeem(uint256 tokenId, uint256 amount, address partner) returns (bool)",
  
  // Events
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
  "event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)",
  "event Swapped(address indexed user, uint256 tgdpAmount, uint256 ftrAmount, uint256 categoryId, uint256 timestamp)",
  "event Redeemed(address indexed user, uint256 tokenId, uint256 amount, address partner, uint256 timestamp)"
];

// GIC Token ABI
const GIC_TOKEN_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function totalEarned(address licensee) view returns (uint256)",
  "function pendingRedemption(address licensee) view returns (uint256)",
  "function credit(address licensee, uint256 amount, uint8 streamType, bytes32 txHash) returns (bool)",
  "function redeem(uint256 amount) returns (bool)",
  "event Credited(address indexed licensee, uint256 amount, uint8 streamType, bytes32 txHash, uint256 timestamp)",
  "event Redeemed(address indexed licensee, uint256 amount, uint256 inrValue, uint256 timestamp)"
];

// Main Registry ABI
const REGISTRY_ABI = [
  // User registration
  "function registerUser(address user, bytes32 kycHash, uint8[] roles) returns (bool)",
  "function isRegistered(address user) view returns (bool)",
  "function getUserRoles(address user) view returns (uint8[])",
  "function getKycHash(address user) view returns (bytes32)",
  
  // Household-Licensee linking
  "function linkHouseholdToLicensee(address household, address licensee) returns (bool)",
  "function getLicensee(address household) view returns (address)",
  "function getHouseholds(address licensee) view returns (address[])",
  
  // Gold earmarking
  "function earmarkGold(address user, bytes32 certificateHash, uint256 pureGoldGrams, uint256 tgdpAmount) returns (bytes32 earmarkId)",
  "function getEarmark(bytes32 earmarkId) view returns (address user, bytes32 certHash, uint256 goldGrams, uint256 tgdp, uint256 timestamp)",
  
  // Events
  "event UserRegistered(address indexed user, bytes32 kycHash, uint8[] roles, uint256 timestamp)",
  "event HouseholdLinked(address indexed household, address indexed licensee, uint256 timestamp)",
  "event GoldEarmarked(bytes32 indexed earmarkId, address indexed user, uint256 goldGrams, uint256 tgdpAmount, uint256 timestamp)"
];

// IPR Registry ABI for T-JDB designs
const IPR_REGISTRY_ABI = [
  "function registerDesign(bytes32 designHash, string metadataUri, address designer) returns (uint256 designId)",
  "function getDesign(uint256 designId) view returns (bytes32 hash, string uri, address designer, uint256 timestamp, bool isActive)",
  "function verifyOwnership(uint256 designId, address claimedOwner) view returns (bool)",
  "function transferDesign(uint256 designId, address newOwner) returns (bool)",
  "function getDesignerDesigns(address designer) view returns (uint256[])",
  "event DesignRegistered(uint256 indexed designId, bytes32 designHash, address indexed designer, uint256 timestamp)",
  "event DesignTransferred(uint256 indexed designId, address indexed from, address indexed to, uint256 timestamp)"
];

// ─────────────────────────────────────────────────────────────────────────────
// BLOCKCHAIN SERVICE CLASS
// ─────────────────────────────────────────────────────────────────────────────

class BlockchainService {
  constructor(config = BLOCKCHAIN_CONFIG) {
    this.config = config;
    this.provider = null;
    this.signer = null;
    this.contracts = {};
    this.initialized = false;
  }
  
  // Initialize connection
  async initialize(privateKey = null) {
    try {
      // Check if ethers.js is available
      if (typeof ethers === 'undefined') {
        console.warn('ethers.js not loaded. Blockchain features disabled.');
        return false;
      }
      
      // Connect to network
      this.provider = new ethers.providers.JsonRpcProvider(this.config.network.rpcUrl);
      
      // If private key provided, create signer
      if (privateKey) {
        this.signer = new ethers.Wallet(privateKey, this.provider);
      }
      
      // Initialize contract instances
      this.contracts.tgdp = new ethers.Contract(
        this.config.contracts.tgdpToken,
        TGDP_TOKEN_ABI,
        this.signer || this.provider
      );
      
      this.contracts.ftr = new ethers.Contract(
        this.config.contracts.ftrToken,
        FTR_TOKEN_ABI,
        this.signer || this.provider
      );
      
      this.contracts.gic = new ethers.Contract(
        this.config.contracts.gicToken,
        GIC_TOKEN_ABI,
        this.signer || this.provider
      );
      
      this.contracts.registry = new ethers.Contract(
        this.config.contracts.registry,
        REGISTRY_ABI,
        this.signer || this.provider
      );
      
      this.contracts.ipr = new ethers.Contract(
        this.config.contracts.iprRegistry,
        IPR_REGISTRY_ABI,
        this.signer || this.provider
      );
      
      this.initialized = true;
      console.log('Blockchain service initialized');
      return true;
    } catch (error) {
      console.error('Blockchain initialization failed:', error);
      return false;
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // TGDP OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────
  
  // Mint TGDPs from gold certificate
  async mintTGDP(toAddress, amount, certificateHash) {
    if (!this.initialized || !this.signer) {
      throw new Error('Blockchain not initialized or no signer');
    }
    
    const tx = await this.contracts.tgdp.mint(
      toAddress,
      ethers.utils.parseUnits(amount.toString(), 18),
      certificateHash,
      { gasLimit: this.config.gas.gasLimit }
    );
    
    const receipt = await tx.wait();
    return {
      success: true,
      txHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString()
    };
  }
  
  // Get TGDP balance
  async getTGDPBalance(address) {
    const balance = await this.contracts.tgdp.balanceOf(address);
    return ethers.utils.formatUnits(balance, 18);
  }
  
  // Transfer TGDP
  async transferTGDP(toAddress, amount) {
    const tx = await this.contracts.tgdp.transfer(
      toAddress,
      ethers.utils.parseUnits(amount.toString(), 18),
      { gasLimit: this.config.gas.gasLimit }
    );
    
    const receipt = await tx.wait();
    return {
      success: true,
      txHash: receipt.transactionHash
    };
  }
  
  // Burn TGDP (for withdrawal)
  async burnTGDP(amount) {
    const tx = await this.contracts.tgdp.burn(
      ethers.utils.parseUnits(amount.toString(), 18),
      { gasLimit: this.config.gas.gasLimit }
    );
    
    const receipt = await tx.wait();
    return {
      success: true,
      txHash: receipt.transactionHash
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // FTR OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────
  
  // FTR Category IDs
  static FTR_CATEGORIES = {
    HOSPITALITY: 1,
    HEALTHCARE: 2,
    EDUCATION: 3,
    RETAIL: 4,
    TRAVEL: 5
  };
  
  // Swap TGDP for FTR
  async swapToFTR(tgdpAmount, categoryId) {
    // First approve TGDP transfer
    const approveTx = await this.contracts.tgdp.approve(
      this.config.contracts.ftrToken,
      ethers.utils.parseUnits(tgdpAmount.toString(), 18)
    );
    await approveTx.wait();
    
    // Then swap
    const tx = await this.contracts.ftr.swap(
      ethers.utils.parseUnits(tgdpAmount.toString(), 18),
      categoryId,
      { gasLimit: this.config.gas.gasLimit }
    );
    
    const receipt = await tx.wait();
    return {
      success: true,
      txHash: receipt.transactionHash,
      ftrAmount: tgdpAmount * 0.96 // 4% commission deducted
    };
  }
  
  // Get FTR balance by category
  async getFTRBalance(address, categoryId) {
    const balance = await this.contracts.ftr.balanceOf(address, categoryId);
    return ethers.utils.formatUnits(balance, 18);
  }
  
  // Redeem FTR at partner
  async redeemFTR(categoryId, amount, partnerAddress) {
    const tx = await this.contracts.ftr.redeem(
      categoryId,
      ethers.utils.parseUnits(amount.toString(), 18),
      partnerAddress,
      { gasLimit: this.config.gas.gasLimit }
    );
    
    const receipt = await tx.wait();
    return {
      success: true,
      txHash: receipt.transactionHash
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // GIC OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────
  
  // GIC Stream Types
  static GIC_STREAMS = {
    REGISTRATION: 1,
    MINTING: 2,
    TRADING: 3
  };
  
  // Credit GIC to licensee
  async creditGIC(licenseeAddress, amount, streamType, relatedTxHash) {
    const tx = await this.contracts.gic.credit(
      licenseeAddress,
      ethers.utils.parseUnits(amount.toString(), 18),
      streamType,
      relatedTxHash,
      { gasLimit: this.config.gas.gasLimit }
    );
    
    const receipt = await tx.wait();
    return {
      success: true,
      txHash: receipt.transactionHash
    };
  }
  
  // Get GIC balance
  async getGICBalance(licenseeAddress) {
    const balance = await this.contracts.gic.balanceOf(licenseeAddress);
    return ethers.utils.formatUnits(balance, 18);
  }
  
  // Redeem GIC
  async redeemGIC(amount) {
    const tx = await this.contracts.gic.redeem(
      ethers.utils.parseUnits(amount.toString(), 18),
      { gasLimit: this.config.gas.gasLimit }
    );
    
    const receipt = await tx.wait();
    return {
      success: true,
      txHash: receipt.transactionHash
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // REGISTRY OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────
  
  // Role IDs
  static ROLES = {
    HOUSEHOLD: 1,
    LICENSEE: 2,
    JEWELER: 3,
    DESIGNER: 4,
    RETURNEE: 5,
    CONSULTANT: 6,
    ADVERTISER: 7,
    OMBUDSMAN: 8
  };
  
  // Register user on blockchain
  async registerUser(userAddress, kycDocumentHash, roles) {
    const tx = await this.contracts.registry.registerUser(
      userAddress,
      kycDocumentHash,
      roles,
      { gasLimit: this.config.gas.gasLimit }
    );
    
    const receipt = await tx.wait();
    return {
      success: true,
      txHash: receipt.transactionHash
    };
  }
  
  // Link household to licensee
  async linkHouseholdToLicensee(householdAddress, licenseeAddress) {
    const tx = await this.contracts.registry.linkHouseholdToLicensee(
      householdAddress,
      licenseeAddress,
      { gasLimit: this.config.gas.gasLimit }
    );
    
    const receipt = await tx.wait();
    return {
      success: true,
      txHash: receipt.transactionHash
    };
  }
  
  // Earmark gold (record gold tokenization)
  async earmarkGold(userAddress, certificateHash, pureGoldGrams, tgdpAmount) {
    const tx = await this.contracts.registry.earmarkGold(
      userAddress,
      certificateHash,
      ethers.utils.parseUnits(pureGoldGrams.toString(), 3), // 3 decimals for grams
      ethers.utils.parseUnits(tgdpAmount.toString(), 18),
      { gasLimit: this.config.gas.gasLimit }
    );
    
    const receipt = await tx.wait();
    
    // Extract earmarkId from event
    const event = receipt.events.find(e => e.event === 'GoldEarmarked');
    const earmarkId = event ? event.args.earmarkId : null;
    
    return {
      success: true,
      txHash: receipt.transactionHash,
      earmarkId: earmarkId
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // IPR OPERATIONS (T-JDB)
  // ─────────────────────────────────────────────────────────────────────────
  
  // Register design IPR
  async registerDesignIPR(designHash, metadataUri, designerAddress) {
    const tx = await this.contracts.ipr.registerDesign(
      designHash,
      metadataUri,
      designerAddress,
      { gasLimit: this.config.gas.gasLimit }
    );
    
    const receipt = await tx.wait();
    
    // Extract designId from event
    const event = receipt.events.find(e => e.event === 'DesignRegistered');
    const designId = event ? event.args.designId.toString() : null;
    
    return {
      success: true,
      txHash: receipt.transactionHash,
      designId: designId
    };
  }
  
  // Verify design ownership
  async verifyDesignOwnership(designId, claimedOwner) {
    return await this.contracts.ipr.verifyOwnership(designId, claimedOwner);
  }
  
  // Get design details
  async getDesign(designId) {
    const design = await this.contracts.ipr.getDesign(designId);
    return {
      hash: design.hash,
      metadataUri: design.uri,
      designer: design.designer,
      timestamp: design.timestamp.toNumber(),
      isActive: design.isActive
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // IPFS OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────
  
  // Upload file to IPFS via Pinata
  async uploadToIPFS(file, metadata = {}) {
    const formData = new FormData();
    formData.append('file', file);
    
    const pinataMetadata = JSON.stringify({
      name: metadata.name || 'TGDP Document',
      keyvalues: metadata
    });
    formData.append('pinataMetadata', pinataMetadata);
    
    const response = await fetch(this.config.ipfs.pinataEndpoint, {
      method: 'POST',
      headers: {
        'pinata_api_key': this.config.ipfs.pinataApiKey,
        'pinata_secret_api_key': this.config.ipfs.pinataSecretKey
      },
      body: formData
    });
    
    const result = await response.json();
    return {
      success: true,
      ipfsHash: result.IpfsHash,
      url: `${this.config.ipfs.gateway}${result.IpfsHash}`
    };
  }
  
  // Generate hash for document
  generateDocumentHash(content) {
    if (typeof ethers !== 'undefined') {
      return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(JSON.stringify(content)));
    }
    // Fallback: simple hash
    return this.simpleHash(JSON.stringify(content));
  }
  
  // Simple hash fallback
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return '0x' + Math.abs(hash).toString(16).padStart(64, '0');
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // UTILITY FUNCTIONS
  // ─────────────────────────────────────────────────────────────────────────
  
  // Get transaction details
  async getTransaction(txHash) {
    const tx = await this.provider.getTransaction(txHash);
    const receipt = await this.provider.getTransactionReceipt(txHash);
    
    return {
      hash: txHash,
      blockNumber: receipt.blockNumber,
      from: tx.from,
      to: tx.to,
      value: ethers.utils.formatEther(tx.value),
      gasUsed: receipt.gasUsed.toString(),
      status: receipt.status === 1 ? 'success' : 'failed',
      timestamp: (await this.provider.getBlock(receipt.blockNumber)).timestamp
    };
  }
  
  // Get explorer URL for transaction
  getExplorerUrl(txHash) {
    return `${this.config.network.explorerUrl}/tx/${txHash}`;
  }
  
  // Validate address
  isValidAddress(address) {
    if (typeof ethers !== 'undefined') {
      return ethers.utils.isAddress(address);
    }
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCKCHAIN TRANSACTION RECORDER
// Records all transactions for audit and compliance
// ─────────────────────────────────────────────────────────────────────────────

class BlockchainRecorder {
  constructor() {
    this.transactions = [];
    this.pendingRecords = [];
  }
  
  // Record a transaction
  record(type, data, txHash = null, blockchainEnabled = false) {
    const record = {
      id: this.generateRecordId(),
      type: type,
      data: data,
      txHash: txHash,
      onChain: blockchainEnabled && txHash !== null,
      timestamp: Date.now(),
      status: txHash ? 'confirmed' : 'pending'
    };
    
    this.transactions.push(record);
    
    // Store in localStorage for persistence
    this.saveToLocalStorage();
    
    return record;
  }
  
  // Transaction types
  static TYPES = {
    USER_REGISTRATION: 'USER_REGISTRATION',
    KYC_VERIFICATION: 'KYC_VERIFICATION',
    GOLD_EARMARK: 'GOLD_EARMARK',
    TGDP_MINT: 'TGDP_MINT',
    TGDP_TRANSFER: 'TGDP_TRANSFER',
    TGDP_TRADE: 'TGDP_TRADE',
    TGDP_BURN: 'TGDP_BURN',
    FTR_SWAP: 'FTR_SWAP',
    FTR_TRANSFER: 'FTR_TRANSFER',
    FTR_REDEEM: 'FTR_REDEEM',
    GIC_CREDIT: 'GIC_CREDIT',
    GIC_REDEEM: 'GIC_REDEEM',
    HOUSEHOLD_LINK: 'HOUSEHOLD_LINK',
    JEWELRY_RETURN: 'JEWELRY_RETURN',
    DESIGN_REGISTER: 'DESIGN_REGISTER',
    DESIGN_PURCHASE: 'DESIGN_PURCHASE',
    COMPLAINT_FILE: 'COMPLAINT_FILE',
    COMPLAINT_RESOLVE: 'COMPLAINT_RESOLVE'
  };
  
  generateRecordId() {
    return 'REC' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 5).toUpperCase();
  }
  
  // Get records by type
  getByType(type) {
    return this.transactions.filter(t => t.type === type);
  }
  
  // Get records by user
  getByUser(userId) {
    return this.transactions.filter(t => t.data.userId === userId || t.data.from === userId || t.data.to === userId);
  }
  
  // Get records in date range
  getByDateRange(startDate, endDate) {
    return this.transactions.filter(t => t.timestamp >= startDate && t.timestamp <= endDate);
  }
  
  // Save to localStorage
  saveToLocalStorage() {
    try {
      localStorage.setItem('tgdp_blockchain_records', JSON.stringify(this.transactions));
    } catch (e) {
      console.warn('localStorage not available');
    }
  }
  
  // Load from localStorage
  loadFromLocalStorage() {
    try {
      const stored = localStorage.getItem('tgdp_blockchain_records');
      if (stored) {
        this.transactions = JSON.parse(stored);
      }
    } catch (e) {
      console.warn('localStorage not available');
    }
  }
  
  // Export records for audit
  exportForAudit(format = 'json') {
    const data = {
      exportDate: new Date().toISOString(),
      totalRecords: this.transactions.length,
      onChainRecords: this.transactions.filter(t => t.onChain).length,
      records: this.transactions
    };
    
    if (format === 'json') {
      return JSON.stringify(data, null, 2);
    }
    
    // CSV format
    const headers = ['ID', 'Type', 'Timestamp', 'TxHash', 'OnChain', 'Status', 'Data'];
    const rows = this.transactions.map(t => [
      t.id,
      t.type,
      new Date(t.timestamp).toISOString(),
      t.txHash || '',
      t.onChain,
      t.status,
      JSON.stringify(t.data)
    ]);
    
    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL INSTANCES
// ─────────────────────────────────────────────────────────────────────────────

// Create global instances
const blockchainService = new BlockchainService();
const blockchainRecorder = new BlockchainRecorder();

// Load existing records
blockchainRecorder.loadFromLocalStorage();

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BLOCKCHAIN_CONFIG,
    BlockchainService,
    BlockchainRecorder,
    blockchainService,
    blockchainRecorder
  };
}
