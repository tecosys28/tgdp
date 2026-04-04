// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ═══════════════════════════════════════════════════════════════════════════
// TGDP ECOSYSTEM SMART CONTRACTS
// Network: Polygon (chainId 137) for low gas fees
// Deploy order: TGDPToken → GICToken → FTRToken(tgdpAddr) → TGDPRegistry → IPRRegistry
// ═══════════════════════════════════════════════════════════════════════════

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

// ═══════════════════════════════════════════════════════════════════════════
// CONTRACT 1: TGDP TOKEN (ERC-20)
// 10 TGDP = 1 gram pure gold (999 fineness)
// Decimals: 18  |  Unit: smallest = 0.000000000000000001 TGDP
// ═══════════════════════════════════════════════════════════════════════════

contract TGDPToken is ERC20, ERC20Burnable, Pausable, AccessControl {

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // 10 TGDP per pure gram, goldGrams stored in milligrams (3 decimal precision)
    uint256 public constant TGDP_PER_GRAM = 10;

    struct MintRecord {
        address  recipient;
        uint256  amount;           // TGDP wei (18 decimals)
        bytes32  certificateHash;  // keccak256 of purity certificate
        uint256  goldMilligrams;   // pure gold in milligrams
        uint256  timestamp;
    }

    mapping(bytes32 => MintRecord) public mintRecords;
    bytes32[] public mintRecordIds;

    event TGDPMinted(
        bytes32 indexed recordId,
        address indexed recipient,
        uint256 amount,
        bytes32 certificateHash,
        uint256 goldMilligrams,
        uint256 timestamp
    );

    event TGDPBurned(address indexed holder, uint256 amount, uint256 timestamp);

    constructor() ERC20("TGDP Token", "TGDP") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
    }

    /**
     * @notice Mint TGDP backed by physical gold.
     * @param to                Recipient wallet address.
     * @param goldMilligrams    Pure gold content in milligrams (e.g. 30 g = 30000).
     * @param certificateHash   keccak256 hash of the purity certificate document.
     * @return recordId         On-chain audit record identifier.
     *
     * TGDP amount is derived on-chain from goldMilligrams:
     *   tgdpWei = goldMilligrams * 10 * 1e18 / 1000
     *            = goldMilligrams * 1e16
     */
    function mint(
        address to,
        uint256 goldMilligrams,
        bytes32 certificateHash
    ) external onlyRole(MINTER_ROLE) whenNotPaused returns (bytes32) {
        require(to != address(0),           "Cannot mint to zero address");
        require(goldMilligrams > 0,         "Gold amount must be positive");
        require(certificateHash != bytes32(0), "Certificate hash required");

        // Derive TGDP amount deterministically from gold — no caller-supplied amount
        uint256 amount = goldMilligrams * TGDP_PER_GRAM * 1e15; // = mg * 10 * 1e15 = mg * 1e16

        bytes32 recordId = keccak256(abi.encodePacked(
            to, goldMilligrams, certificateHash, block.timestamp, mintRecordIds.length
        ));

        mintRecords[recordId] = MintRecord({
            recipient:       to,
            amount:          amount,
            certificateHash: certificateHash,
            goldMilligrams:  goldMilligrams,
            timestamp:       block.timestamp
        });
        mintRecordIds.push(recordId);

        _mint(to, amount);

        emit TGDPMinted(recordId, to, amount, certificateHash, goldMilligrams, block.timestamp);
        return recordId;
    }

    function burn(uint256 amount) public override {
        super.burn(amount);
        emit TGDPBurned(msg.sender, amount, block.timestamp);
    }

    function getMintRecord(bytes32 recordId) external view returns (
        address recipient,
        uint256 amount,
        bytes32 certificateHash,
        uint256 goldMilligrams,
        uint256 timestamp
    ) {
        MintRecord memory r = mintRecords[recordId];
        return (r.recipient, r.amount, r.certificateHash, r.goldMilligrams, r.timestamp);
    }

    function getMintRecordCount() external view returns (uint256) {
        return mintRecordIds.length;
    }

    function pause()   external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    function _update(address from, address to, uint256 value)
        internal override whenNotPaused
    {
        super._update(from, to, value);
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// CONTRACT 2: FTR TOKEN (ERC-1155)
// Future Trade Rights — 5 redemption categories, 12-month validity
// Token IDs: 1=Hospitality 2=Healthcare 3=Education 4=Retail 5=Travel
// ═══════════════════════════════════════════════════════════════════════════

contract FTRToken is ERC1155, AccessControl, Pausable {

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PARTNER_ROLE  = keccak256("PARTNER_ROLE");

    uint256 public constant HOSPITALITY = 1;
    uint256 public constant HEALTHCARE  = 2;
    uint256 public constant EDUCATION   = 3;
    uint256 public constant RETAIL      = 4;
    uint256 public constant TRAVEL      = 5;

    // 4% swap commission in basis points
    uint256 public constant SWAP_COMMISSION_BPS = 400;
    uint256 public constant BPS_DENOMINATOR     = 10000;

    // 12-month validity
    uint256 public constant VALIDITY_PERIOD = 365 days;

    IERC20 public immutable tgdpToken;

    mapping(uint256 => string) public categoryNames;

    struct FTRBatch {
        uint256 amount;
        uint256 expiryDate;
    }
    // user => categoryId => list of batches (FIFO expiry)
    mapping(address => mapping(uint256 => FTRBatch[])) private _batches;

    struct SwapRecord {
        address user;
        uint256 tgdpAmount;
        uint256 ftrAmount;
        uint256 categoryId;
        uint256 commission;
        uint256 expiryDate;
        uint256 timestamp;
    }
    mapping(bytes32 => SwapRecord) public swapRecords;

    struct RedemptionRecord {
        address user;
        uint256 categoryId;
        uint256 amount;
        address partner;
        uint256 timestamp;
    }
    mapping(bytes32 => RedemptionRecord) public redemptionRecords;

    event FTRSwapped(
        bytes32 indexed swapId,
        address indexed user,
        uint256 tgdpAmount,
        uint256 ftrAmount,
        uint256 categoryId,
        uint256 commission,
        uint256 expiryDate
    );

    event FTRRedeemed(
        bytes32 indexed redemptionId,
        address indexed user,
        uint256 categoryId,
        uint256 amount,
        address indexed partner
    );

    constructor(address _tgdpToken)
        ERC1155("https://api.trot-gold.com/ftr/{id}.json")
    {
        require(_tgdpToken != address(0), "Invalid TGDP token address");
        tgdpToken = IERC20(_tgdpToken);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);

        categoryNames[HOSPITALITY] = "Hospitality";
        categoryNames[HEALTHCARE]  = "Healthcare";
        categoryNames[EDUCATION]   = "Education";
        categoryNames[RETAIL]      = "Retail";
        categoryNames[TRAVEL]      = "Travel";
    }

    /**
     * @notice Swap TGDP for FTR tokens (4% commission deducted).
     *         Caller must approve this contract for tgdpAmount first.
     */
    function swap(uint256 tgdpAmount, uint256 categoryId)
        external whenNotPaused returns (bytes32)
    {
        require(tgdpAmount > 0, "Amount must be positive");
        require(categoryId >= HOSPITALITY && categoryId <= TRAVEL, "Invalid category");

        uint256 commission = (tgdpAmount * SWAP_COMMISSION_BPS) / BPS_DENOMINATOR;
        uint256 ftrAmount  = tgdpAmount - commission;
        uint256 expiryDate = block.timestamp + VALIDITY_PERIOD;

        require(tgdpToken.transferFrom(msg.sender, address(this), tgdpAmount), "TGDP transfer failed");

        _mint(msg.sender, categoryId, ftrAmount, "");

        _batches[msg.sender][categoryId].push(FTRBatch({
            amount:     ftrAmount,
            expiryDate: expiryDate
        }));

        bytes32 swapId = keccak256(abi.encodePacked(
            msg.sender, tgdpAmount, categoryId, block.timestamp
        ));

        swapRecords[swapId] = SwapRecord({
            user:       msg.sender,
            tgdpAmount: tgdpAmount,
            ftrAmount:  ftrAmount,
            categoryId: categoryId,
            commission: commission,
            expiryDate: expiryDate,
            timestamp:  block.timestamp
        });

        emit FTRSwapped(swapId, msg.sender, tgdpAmount, ftrAmount, categoryId, commission, expiryDate);
        return swapId;
    }

    /**
     * @notice Redeem FTR at a registered partner location.
     *         Only non-expired tokens can be redeemed.
     */
    function redeem(uint256 categoryId, uint256 amount, address partner)
        external whenNotPaused returns (bytes32)
    {
        require(hasRole(PARTNER_ROLE, partner),                 "Not a registered partner");
        require(getValidBalance(msg.sender, categoryId) >= amount, "Insufficient valid FTR balance");

        // Deduct from oldest batches first (FIFO)
        _deductValid(msg.sender, categoryId, amount);
        _burn(msg.sender, categoryId, amount);

        bytes32 redemptionId = keccak256(abi.encodePacked(
            msg.sender, categoryId, amount, partner, block.timestamp
        ));

        redemptionRecords[redemptionId] = RedemptionRecord({
            user:       msg.sender,
            categoryId: categoryId,
            amount:     amount,
            partner:    partner,
            timestamp:  block.timestamp
        });

        emit FTRRedeemed(redemptionId, msg.sender, categoryId, amount, partner);
        return redemptionId;
    }

    function getValidBalance(address user, uint256 categoryId) public view returns (uint256) {
        FTRBatch[] memory batches = _batches[user][categoryId];
        uint256 total = 0;
        for (uint256 i = 0; i < batches.length; i++) {
            if (batches[i].expiryDate > block.timestamp) {
                total += batches[i].amount;
            }
        }
        return total;
    }

    function getEarliestExpiry(address user, uint256 categoryId) external view returns (uint256) {
        FTRBatch[] memory batches = _batches[user][categoryId];
        uint256 earliest = type(uint256).max;
        for (uint256 i = 0; i < batches.length; i++) {
            if (batches[i].expiryDate > block.timestamp && batches[i].expiryDate < earliest) {
                earliest = batches[i].expiryDate;
            }
        }
        return earliest == type(uint256).max ? 0 : earliest;
    }

    function _deductValid(address user, uint256 categoryId, uint256 amount) internal {
        FTRBatch[] storage batches = _batches[user][categoryId];
        uint256 remaining = amount;
        for (uint256 i = 0; i < batches.length && remaining > 0; i++) {
            if (batches[i].expiryDate > block.timestamp && batches[i].amount > 0) {
                if (batches[i].amount <= remaining) {
                    remaining       -= batches[i].amount;
                    batches[i].amount = 0;
                } else {
                    batches[i].amount -= remaining;
                    remaining          = 0;
                }
            }
        }
    }

    function registerPartner(address partner) external onlyRole(OPERATOR_ROLE) {
        _grantRole(PARTNER_ROLE, partner);
    }

    function revokePartner(address partner) external onlyRole(OPERATOR_ROLE) {
        _revokeRole(PARTNER_ROLE, partner);
    }

    function pause()   external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC1155, AccessControl) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// CONTRACT 3: GIC TOKEN (ERC-20)
// Gold Income Coupons — earned by Licensees from 3 revenue streams
// 25% revenue share on: registration fees, minting fees, FTR swap commissions
// ═══════════════════════════════════════════════════════════════════════════

contract GICToken is ERC20, AccessControl {

    bytes32 public constant CREDITOR_ROLE = keccak256("CREDITOR_ROLE");

    uint8 public constant STREAM_REGISTRATION = 1;
    uint8 public constant STREAM_MINTING      = 2;
    uint8 public constant STREAM_TRADING      = 3;

    struct LicenseeStats {
        uint256 totalEarned;
        uint256 totalRedeemed;
        uint256 registrationEarnings;
        uint256 mintingEarnings;
        uint256 tradingEarnings;
        uint256 householdCount;
    }
    mapping(address => LicenseeStats) public licenseeStats;

    struct CreditRecord {
        address licensee;
        uint256 amount;
        uint8   streamType;
        bytes32 relatedTxHash;
        uint256 timestamp;
    }
    mapping(bytes32 => CreditRecord) public creditRecords;

    event GICCredited(
        bytes32 indexed creditId,
        address indexed licensee,
        uint256 amount,
        uint8   streamType,
        bytes32 relatedTxHash
    );

    event GICRedeemed(
        address indexed licensee,
        uint256 amount,
        uint256 timestamp
    );

    constructor() ERC20("GIC Token", "GIC") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(CREDITOR_ROLE, msg.sender);
    }

    function credit(
        address licensee,
        uint256 amount,
        uint8   streamType,
        bytes32 relatedTxHash
    ) external onlyRole(CREDITOR_ROLE) returns (bytes32) {
        require(licensee != address(0), "Invalid licensee address");
        require(amount > 0,             "Amount must be positive");
        require(
            streamType >= STREAM_REGISTRATION && streamType <= STREAM_TRADING,
            "Invalid stream type"
        );

        bytes32 creditId = keccak256(abi.encodePacked(
            licensee, amount, streamType, relatedTxHash, block.timestamp
        ));

        creditRecords[creditId] = CreditRecord({
            licensee:      licensee,
            amount:        amount,
            streamType:    streamType,
            relatedTxHash: relatedTxHash,
            timestamp:     block.timestamp
        });

        licenseeStats[licensee].totalEarned += amount;
        if (streamType == STREAM_REGISTRATION) {
            licenseeStats[licensee].registrationEarnings += amount;
        } else if (streamType == STREAM_MINTING) {
            licenseeStats[licensee].mintingEarnings += amount;
        } else {
            licenseeStats[licensee].tradingEarnings += amount;
        }

        _mint(licensee, amount);

        emit GICCredited(creditId, licensee, amount, streamType, relatedTxHash);
        return creditId;
    }

    function redeem(uint256 amount) external {
        require(balanceOf(msg.sender) >= amount, "Insufficient GIC balance");
        _burn(msg.sender, amount);
        licenseeStats[msg.sender].totalRedeemed += amount;
        emit GICRedeemed(msg.sender, amount, block.timestamp);
    }

    function incrementHouseholdCount(address licensee) external onlyRole(CREDITOR_ROLE) {
        licenseeStats[licensee].householdCount++;
    }

    function getLicenseeStats(address licensee) external view returns (
        uint256 totalEarned,
        uint256 totalRedeemed,
        uint256 registrationEarnings,
        uint256 mintingEarnings,
        uint256 tradingEarnings,
        uint256 balance,
        uint256 householdCount
    ) {
        LicenseeStats memory s = licenseeStats[licensee];
        return (
            s.totalEarned,
            s.totalRedeemed,
            s.registrationEarnings,
            s.mintingEarnings,
            s.tradingEarnings,
            balanceOf(licensee),
            s.householdCount
        );
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// CONTRACT 4: TGDP REGISTRY
// Central on-chain registry: users, roles, household-licensee links, gold earmarks
// ═══════════════════════════════════════════════════════════════════════════

contract TGDPRegistry is AccessControl {

    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    // Role IDs — match firebase-client.js RoleMatrix
    uint8 public constant ROLE_HOUSEHOLD  = 1;
    uint8 public constant ROLE_LICENSEE   = 2;
    uint8 public constant ROLE_JEWELER    = 3;
    uint8 public constant ROLE_DESIGNER   = 4;
    uint8 public constant ROLE_RETURNEE   = 5;
    uint8 public constant ROLE_CONSULTANT = 6;
    uint8 public constant ROLE_ADVERTISER = 7;
    uint8 public constant ROLE_OMBUDSMAN  = 8;

    struct User {
        bytes32 kycHash;
        uint8[] roles;
        bool    isActive;
        uint256 registeredAt;
        address linkedLicensee;
    }
    mapping(address => User) public users;
    address[] public userAddresses;

    mapping(address => address[]) public licenseeHouseholds;

    struct GoldEarmark {
        address owner;
        bytes32 certificateHash;
        uint256 pureGoldMilligrams;
        uint256 tgdpAmount;       // TGDP wei (18 decimals)
        uint256 timestamp;
        bool    isActive;
    }
    mapping(bytes32 => GoldEarmark) public goldEarmarks;
    bytes32[] public earmarkIds;

    event UserRegistered(
        address indexed user,
        bytes32 kycHash,
        uint8[] roles,
        uint256 timestamp
    );

    event HouseholdLinked(
        address indexed household,
        address indexed licensee,
        uint256 timestamp
    );

    event GoldEarmarked(
        bytes32 indexed earmarkId,
        address indexed owner,
        bytes32 certificateHash,
        uint256 goldMilligrams,
        uint256 tgdpAmount
    );

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(REGISTRAR_ROLE, msg.sender);
    }

    function registerUser(
        address user,
        bytes32 kycHash,
        uint8[] calldata roles
    ) external onlyRole(REGISTRAR_ROLE) {
        require(user != address(0),            "Invalid address");
        require(!users[user].isActive,         "User already registered");
        require(roles.length > 0,              "At least one role required");
        require(_validateRoles(roles),         "Incompatible roles");

        users[user] = User({
            kycHash:         kycHash,
            roles:           roles,
            isActive:        true,
            registeredAt:    block.timestamp,
            linkedLicensee:  address(0)
        });
        userAddresses.push(user);

        emit UserRegistered(user, kycHash, roles, block.timestamp);
    }

    function linkHouseholdToLicensee(
        address household,
        address licensee
    ) external onlyRole(REGISTRAR_ROLE) {
        require(users[household].isActive,            "Household not registered");
        require(users[licensee].isActive,             "Licensee not registered");
        require(_hasRole(household, ROLE_HOUSEHOLD),  "Not a household");
        require(_hasRole(licensee,  ROLE_LICENSEE),   "Not a licensee");
        require(users[household].linkedLicensee == address(0), "Already linked");

        users[household].linkedLicensee = licensee;
        licenseeHouseholds[licensee].push(household);

        emit HouseholdLinked(household, licensee, block.timestamp);
    }

    function earmarkGold(
        address owner,
        bytes32 certificateHash,
        uint256 pureGoldMilligrams,
        uint256 tgdpAmount
    ) external onlyRole(REGISTRAR_ROLE) returns (bytes32) {
        require(users[owner].isActive, "User not registered");
        require(pureGoldMilligrams > 0, "Gold amount must be positive");

        bytes32 earmarkId = keccak256(abi.encodePacked(
            owner, certificateHash, pureGoldMilligrams, block.timestamp
        ));

        goldEarmarks[earmarkId] = GoldEarmark({
            owner:                owner,
            certificateHash:      certificateHash,
            pureGoldMilligrams:   pureGoldMilligrams,
            tgdpAmount:           tgdpAmount,
            timestamp:            block.timestamp,
            isActive:             true
        });
        earmarkIds.push(earmarkId);

        emit GoldEarmarked(earmarkId, owner, certificateHash, pureGoldMilligrams, tgdpAmount);
        return earmarkId;
    }

    function deactivateEarmark(bytes32 earmarkId) external onlyRole(REGISTRAR_ROLE) {
        goldEarmarks[earmarkId].isActive = false;
    }

    function hasUserRole(address user, uint8 role) external view returns (bool) {
        return _hasRole(user, role);
    }

    function getUser(address user) external view returns (
        bytes32 kycHash,
        uint8[] memory roles,
        bool    isActive,
        uint256 registeredAt,
        address linkedLicensee
    ) {
        User memory u = users[user];
        return (u.kycHash, u.roles, u.isActive, u.registeredAt, u.linkedLicensee);
    }

    function getLicenseeHouseholds(address licensee) external view returns (address[] memory) {
        return licenseeHouseholds[licensee];
    }

    function getEarmark(bytes32 earmarkId) external view returns (
        address owner,
        bytes32 certificateHash,
        uint256 pureGoldMilligrams,
        uint256 tgdpAmount,
        uint256 timestamp,
        bool    isActive
    ) {
        GoldEarmark memory e = goldEarmarks[earmarkId];
        return (e.owner, e.certificateHash, e.pureGoldMilligrams, e.tgdpAmount, e.timestamp, e.isActive);
    }

    function getTotalUsers()    external view returns (uint256) { return userAddresses.length; }
    function getTotalEarmarks() external view returns (uint256) { return earmarkIds.length; }

    // ── Internal helpers ──────────────────────────────────────────────────────

    function _hasRole(address user, uint8 role) internal view returns (bool) {
        uint8[] memory roles = users[user].roles;
        for (uint256 i = 0; i < roles.length; i++) {
            if (roles[i] == role) return true;
        }
        return false;
    }

    function _validateRoles(uint8[] calldata roles) internal pure returns (bool) {
        bool hasOmbudsman  = false;
        bool hasJeweler    = false;
        bool hasHousehold  = false;
        bool hasReturnee   = false;
        bool hasDesigner   = false;
        bool hasConsultant = false;
        bool hasLicensee   = false;

        for (uint256 i = 0; i < roles.length; i++) {
            if (roles[i] == ROLE_OMBUDSMAN)  hasOmbudsman  = true;
            if (roles[i] == ROLE_JEWELER)    hasJeweler    = true;
            if (roles[i] == ROLE_HOUSEHOLD)  hasHousehold  = true;
            if (roles[i] == ROLE_RETURNEE)   hasReturnee   = true;
            if (roles[i] == ROLE_DESIGNER)   hasDesigner   = true;
            if (roles[i] == ROLE_CONSULTANT) hasConsultant = true;
            if (roles[i] == ROLE_LICENSEE)   hasLicensee   = true;
        }

        // Ombudsman is fully exclusive (spec 4.2)
        if (hasOmbudsman && roles.length > 1) return false;

        // Jeweler cannot be: Household, Returnee, Designer, Consultant, or Licensee (spec 4.2)
        if (hasJeweler && (hasHousehold || hasReturnee || hasDesigner || hasConsultant || hasLicensee)) return false;

        return true;
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// CONTRACT 5: IPR REGISTRY (T-JDB)
// Blockchain-timestamped Intellectual Property registration for jewelry designs
// ═══════════════════════════════════════════════════════════════════════════

contract IPRRegistry is AccessControl {

    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    uint256 private _designCounter;

    struct Design {
        bytes32 designHash;    // keccak256 of design file content
        string  metadataUri;   // IPFS URI pointing to design metadata JSON
        address designer;
        uint256 registeredAt;
        bool    isActive;
        uint256 salesCount;
        uint256 totalRevenue;  // cumulative TGDP wei received
    }

    mapping(uint256 => Design)   public designs;
    mapping(bytes32 => uint256)  public hashToDesignId;  // prevent duplicate registration
    mapping(address => uint256[]) public designerDesigns;

    event DesignRegistered(
        uint256 indexed designId,
        bytes32 designHash,
        address indexed designer,
        string  metadataUri,
        uint256 timestamp
    );

    event DesignTransferred(
        uint256 indexed designId,
        address indexed from,
        address indexed to,
        uint256 timestamp
    );

    event DesignSold(
        uint256 indexed designId,
        address indexed buyer,
        uint256 amount,
        uint256 timestamp
    );

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(REGISTRAR_ROLE, msg.sender);
    }

    function registerDesign(
        bytes32 designHash,
        string  calldata metadataUri,
        address designer
    ) external onlyRole(REGISTRAR_ROLE) returns (uint256) {
        require(designer != address(0),             "Invalid designer address");
        require(bytes(metadataUri).length > 0,      "Metadata URI required");
        require(hashToDesignId[designHash] == 0,    "Design already registered");

        _designCounter++;
        uint256 designId = _designCounter;

        designs[designId] = Design({
            designHash:   designHash,
            metadataUri:  metadataUri,
            designer:     designer,
            registeredAt: block.timestamp,
            isActive:     true,
            salesCount:   0,
            totalRevenue: 0
        });

        hashToDesignId[designHash] = designId;
        designerDesigns[designer].push(designId);

        emit DesignRegistered(designId, designHash, designer, metadataUri, block.timestamp);
        return designId;
    }

    function recordSale(uint256 designId, address buyer, uint256 amount)
        external onlyRole(REGISTRAR_ROLE)
    {
        require(designs[designId].isActive, "Design not active");
        designs[designId].salesCount++;
        designs[designId].totalRevenue += amount;
        emit DesignSold(designId, buyer, amount, block.timestamp);
    }

    function transferDesign(uint256 designId, address newOwner) external {
        require(designs[designId].designer == msg.sender, "Not the owner");
        require(newOwner != address(0),                   "Invalid new owner");

        address oldOwner             = designs[designId].designer;
        designs[designId].designer   = newOwner;
        designerDesigns[newOwner].push(designId);

        emit DesignTransferred(designId, oldOwner, newOwner, block.timestamp);
    }

    function deactivateDesign(uint256 designId) external {
        require(
            designs[designId].designer == msg.sender || hasRole(REGISTRAR_ROLE, msg.sender),
            "Not authorized"
        );
        designs[designId].isActive = false;
    }

    function verifyOwnership(uint256 designId, address claimedOwner) external view returns (bool) {
        return designs[designId].designer == claimedOwner && designs[designId].isActive;
    }

    function getDesign(uint256 designId) external view returns (
        bytes32 designHash,
        string  memory metadataUri,
        address designer,
        uint256 registeredAt,
        bool    isActive,
        uint256 salesCount,
        uint256 totalRevenue
    ) {
        Design memory d = designs[designId];
        return (d.designHash, d.metadataUri, d.designer, d.registeredAt, d.isActive, d.salesCount, d.totalRevenue);
    }

    function getDesignerDesigns(address designer) external view returns (uint256[] memory) {
        return designerDesigns[designer];
    }

    function getDesignIdByHash(bytes32 designHash) external view returns (uint256) {
        return hashToDesignId[designHash];
    }

    function getTotalDesigns() external view returns (uint256) {
        return _designCounter;
    }
}
