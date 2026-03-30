// SPDX-License-Identifier: MIT
// TGDP Ecosystem Smart Contracts
// Deploy on Polygon for low gas fees

// ═══════════════════════════════════════════════════════════════════════════
// CONTRACT 1: TGDP TOKEN (ERC-20)
// Tokenized Gold Depository Points - 1 TGDP = 0.1 gram pure gold
// ═══════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract TGDPToken is ERC20, ERC20Burnable, Pausable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    
    // Minting records for audit
    struct MintRecord {
        address recipient;
        uint256 amount;
        bytes32 certificateHash;
        uint256 timestamp;
        uint256 goldGrams; // in milligrams for precision
    }
    
    mapping(bytes32 => MintRecord) public mintRecords;
    bytes32[] public mintRecordIds;
    
    // Events
    event TGDPMinted(
        bytes32 indexed recordId,
        address indexed recipient,
        uint256 amount,
        bytes32 certificateHash,
        uint256 goldGrams,
        uint256 timestamp
    );
    
    event TGDPBurned(
        address indexed holder,
        uint256 amount,
        uint256 timestamp
    );
    
    constructor() ERC20("TGDP Token", "TGDP") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
    }
    
    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }
    
    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }
    
    // Mint TGDP from gold certificate
    // amount: TGDP tokens (18 decimals)
    // certificateHash: Hash of purity certificate
    // goldGrams: Pure gold content in milligrams
    function mint(
        address to,
        uint256 amount,
        bytes32 certificateHash,
        uint256 goldGrams
    ) public onlyRole(MINTER_ROLE) returns (bytes32) {
        require(to != address(0), "Cannot mint to zero address");
        require(amount > 0, "Amount must be positive");
        require(certificateHash != bytes32(0), "Certificate hash required");
        
        // Verify TGDP amount matches gold content (10 TGDP per gram)
        // goldGrams is in milligrams, so multiply by 10 and convert
        uint256 expectedTGDP = (goldGrams * 10 * 1e18) / 1000;
        require(amount == expectedTGDP, "TGDP amount does not match gold content");
        
        bytes32 recordId = keccak256(abi.encodePacked(
            to,
            amount,
            certificateHash,
            block.timestamp,
            mintRecordIds.length
        ));
        
        mintRecords[recordId] = MintRecord({
            recipient: to,
            amount: amount,
            certificateHash: certificateHash,
            timestamp: block.timestamp,
            goldGrams: goldGrams
        });
        mintRecordIds.push(recordId);
        
        _mint(to, amount);
        
        emit TGDPMinted(recordId, to, amount, certificateHash, goldGrams, block.timestamp);
        
        return recordId;
    }
    
    // Override burn to emit event
    function burn(uint256 amount) public override {
        super.burn(amount);
        emit TGDPBurned(msg.sender, amount, block.timestamp);
    }
    
    // Get mint record
    function getMintRecord(bytes32 recordId) public view returns (
        address recipient,
        uint256 amount,
        bytes32 certificateHash,
        uint256 timestamp,
        uint256 goldGrams
    ) {
        MintRecord memory record = mintRecords[recordId];
        return (
            record.recipient,
            record.amount,
            record.certificateHash,
            record.timestamp,
            record.goldGrams
        );
    }
    
    // Get total mint records count
    function getMintRecordCount() public view returns (uint256) {
        return mintRecordIds.length;
    }
    
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal whenNotPaused override {
        super._beforeTokenTransfer(from, to, amount);
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// CONTRACT 2: FTR TOKEN (ERC-1155)
// Future Trade Rights - Multi-token for 5 categories
// ═══════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

contract FTRToken is ERC1155, AccessControl, Pausable {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PARTNER_ROLE = keccak256("PARTNER_ROLE");
    
    // FTR Categories
    uint256 public constant HOSPITALITY = 1;
    uint256 public constant HEALTHCARE = 2;
    uint256 public constant EDUCATION = 3;
    uint256 public constant RETAIL = 4;
    uint256 public constant TRAVEL = 5;
    
    // Commission rate (4% = 400 basis points)
    uint256 public constant SWAP_COMMISSION_BPS = 400;
    uint256 public constant BPS_DENOMINATOR = 10000;
    
    // Validity period (12 months in seconds)
    uint256 public constant VALIDITY_PERIOD = 365 days;
    
    // TGDP Token reference
    IERC20 public tgdpToken;
    
    // Category names
    mapping(uint256 => string) public categoryNames;
    
    // FTR expiry tracking
    struct FTRHolding {
        uint256 amount;
        uint256 expiryDate;
    }
    mapping(address => mapping(uint256 => FTRHolding[])) public holdings;
    
    // Swap records
    struct SwapRecord {
        address user;
        uint256 tgdpAmount;
        uint256 ftrAmount;
        uint256 categoryId;
        uint256 commission;
        uint256 timestamp;
    }
    mapping(bytes32 => SwapRecord) public swapRecords;
    
    // Redemption records
    struct RedemptionRecord {
        address user;
        uint256 categoryId;
        uint256 amount;
        address partner;
        uint256 timestamp;
    }
    mapping(bytes32 => RedemptionRecord) public redemptionRecords;
    
    // Events
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
    
    constructor(address _tgdpToken) ERC1155("https://api.trot-gold.com/ftr/{id}.json") {
        tgdpToken = IERC20(_tgdpToken);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
        
        // Set category names
        categoryNames[HOSPITALITY] = "Hospitality";
        categoryNames[HEALTHCARE] = "Healthcare";
        categoryNames[EDUCATION] = "Education";
        categoryNames[RETAIL] = "Retail";
        categoryNames[TRAVEL] = "Travel";
    }
    
    // Swap TGDP for FTR
    function swap(uint256 tgdpAmount, uint256 categoryId) public whenNotPaused returns (bytes32) {
        require(tgdpAmount > 0, "Amount must be positive");
        require(categoryId >= HOSPITALITY && categoryId <= TRAVEL, "Invalid category");
        
        // Calculate commission (4%)
        uint256 commission = (tgdpAmount * SWAP_COMMISSION_BPS) / BPS_DENOMINATOR;
        uint256 ftrAmount = tgdpAmount - commission;
        
        // Transfer TGDP from user (requires prior approval)
        require(tgdpToken.transferFrom(msg.sender, address(this), tgdpAmount), "TGDP transfer failed");
        
        // Mint FTR
        _mint(msg.sender, categoryId, ftrAmount, "");
        
        // Record holding with expiry
        uint256 expiryDate = block.timestamp + VALIDITY_PERIOD;
        holdings[msg.sender][categoryId].push(FTRHolding({
            amount: ftrAmount,
            expiryDate: expiryDate
        }));
        
        // Create swap record
        bytes32 swapId = keccak256(abi.encodePacked(
            msg.sender,
            tgdpAmount,
            categoryId,
            block.timestamp
        ));
        
        swapRecords[swapId] = SwapRecord({
            user: msg.sender,
            tgdpAmount: tgdpAmount,
            ftrAmount: ftrAmount,
            categoryId: categoryId,
            commission: commission,
            timestamp: block.timestamp
        });
        
        emit FTRSwapped(swapId, msg.sender, tgdpAmount, ftrAmount, categoryId, commission, expiryDate);
        
        return swapId;
    }
    
    // Redeem FTR at partner
    function redeem(
        uint256 categoryId,
        uint256 amount,
        address partner
    ) public whenNotPaused returns (bytes32) {
        require(hasRole(PARTNER_ROLE, partner), "Not a registered partner");
        require(balanceOf(msg.sender, categoryId) >= amount, "Insufficient FTR balance");
        
        // Check for valid (non-expired) tokens
        uint256 validBalance = getValidBalance(msg.sender, categoryId);
        require(validBalance >= amount, "Insufficient valid FTR balance");
        
        // Burn FTR
        _burn(msg.sender, categoryId, amount);
        
        // Create redemption record
        bytes32 redemptionId = keccak256(abi.encodePacked(
            msg.sender,
            categoryId,
            amount,
            partner,
            block.timestamp
        ));
        
        redemptionRecords[redemptionId] = RedemptionRecord({
            user: msg.sender,
            categoryId: categoryId,
            amount: amount,
            partner: partner,
            timestamp: block.timestamp
        });
        
        emit FTRRedeemed(redemptionId, msg.sender, categoryId, amount, partner);
        
        return redemptionId;
    }
    
    // Get valid (non-expired) balance
    function getValidBalance(address user, uint256 categoryId) public view returns (uint256) {
        FTRHolding[] memory userHoldings = holdings[user][categoryId];
        uint256 validAmount = 0;
        
        for (uint256 i = 0; i < userHoldings.length; i++) {
            if (userHoldings[i].expiryDate > block.timestamp) {
                validAmount += userHoldings[i].amount;
            }
        }
        
        return validAmount;
    }
    
    // Get expiry date for user's FTR
    function getEarliestExpiry(address user, uint256 categoryId) public view returns (uint256) {
        FTRHolding[] memory userHoldings = holdings[user][categoryId];
        uint256 earliestExpiry = type(uint256).max;
        
        for (uint256 i = 0; i < userHoldings.length; i++) {
            if (userHoldings[i].expiryDate > block.timestamp && 
                userHoldings[i].expiryDate < earliestExpiry) {
                earliestExpiry = userHoldings[i].expiryDate;
            }
        }
        
        return earliestExpiry == type(uint256).max ? 0 : earliestExpiry;
    }
    
    // Register partner
    function registerPartner(address partner) public onlyRole(OPERATOR_ROLE) {
        _grantRole(PARTNER_ROLE, partner);
    }
    
    // Pause/Unpause
    function pause() public onlyRole(OPERATOR_ROLE) {
        _pause();
    }
    
    function unpause() public onlyRole(OPERATOR_ROLE) {
        _unpause();
    }
    
    // Required overrides
    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// CONTRACT 3: GIC TOKEN (ERC-20)
// Gold Income Coupons for Licensees
// ═══════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract GICToken is ERC20, AccessControl {
    bytes32 public constant CREDITOR_ROLE = keccak256("CREDITOR_ROLE");
    
    // Revenue share percentage (25% = 2500 basis points)
    uint256 public constant REVENUE_SHARE_BPS = 2500;
    uint256 public constant BPS_DENOMINATOR = 10000;
    
    // Stream types
    uint8 public constant STREAM_REGISTRATION = 1;
    uint8 public constant STREAM_MINTING = 2;
    uint8 public constant STREAM_TRADING = 3;
    
    // Licensee stats
    struct LicenseeStats {
        uint256 totalEarned;
        uint256 totalRedeemed;
        uint256 registrationEarnings;
        uint256 mintingEarnings;
        uint256 tradingEarnings;
        uint256 householdCount;
    }
    mapping(address => LicenseeStats) public licenseeStats;
    
    // Credit records
    struct CreditRecord {
        address licensee;
        uint256 amount;
        uint8 streamType;
        bytes32 relatedTxHash;
        uint256 timestamp;
    }
    mapping(bytes32 => CreditRecord) public creditRecords;
    
    // Events
    event GICCredited(
        bytes32 indexed creditId,
        address indexed licensee,
        uint256 amount,
        uint8 streamType,
        bytes32 relatedTxHash
    );
    
    event GICRedeemed(
        address indexed licensee,
        uint256 amount,
        uint256 inrValue,
        uint256 timestamp
    );
    
    constructor() ERC20("GIC Token", "GIC") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(CREDITOR_ROLE, msg.sender);
    }
    
    // Credit GIC to licensee
    function credit(
        address licensee,
        uint256 amount,
        uint8 streamType,
        bytes32 relatedTxHash
    ) public onlyRole(CREDITOR_ROLE) returns (bytes32) {
        require(licensee != address(0), "Invalid licensee address");
        require(amount > 0, "Amount must be positive");
        require(streamType >= STREAM_REGISTRATION && streamType <= STREAM_TRADING, "Invalid stream type");
        
        bytes32 creditId = keccak256(abi.encodePacked(
            licensee,
            amount,
            streamType,
            relatedTxHash,
            block.timestamp
        ));
        
        creditRecords[creditId] = CreditRecord({
            licensee: licensee,
            amount: amount,
            streamType: streamType,
            relatedTxHash: relatedTxHash,
            timestamp: block.timestamp
        });
        
        // Update stats
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
    
    // Redeem GIC (burn and record)
    function redeem(uint256 amount, uint256 inrValue) public {
        require(balanceOf(msg.sender) >= amount, "Insufficient GIC balance");
        
        _burn(msg.sender, amount);
        licenseeStats[msg.sender].totalRedeemed += amount;
        
        emit GICRedeemed(msg.sender, amount, inrValue, block.timestamp);
    }
    
    // Get licensee stats
    function getLicenseeStats(address licensee) public view returns (
        uint256 totalEarned,
        uint256 totalRedeemed,
        uint256 registrationEarnings,
        uint256 mintingEarnings,
        uint256 tradingEarnings,
        uint256 balance
    ) {
        LicenseeStats memory stats = licenseeStats[licensee];
        return (
            stats.totalEarned,
            stats.totalRedeemed,
            stats.registrationEarnings,
            stats.mintingEarnings,
            stats.tradingEarnings,
            balanceOf(licensee)
        );
    }
    
    // Increment household count for licensee
    function incrementHouseholdCount(address licensee) public onlyRole(CREDITOR_ROLE) {
        licenseeStats[licensee].householdCount++;
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// CONTRACT 4: TGDP REGISTRY
// Central registry for users, households, and gold earmarks
// ═══════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract TGDPRegistry is AccessControl {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    
    // Role constants
    uint8 public constant ROLE_HOUSEHOLD = 1;
    uint8 public constant ROLE_LICENSEE = 2;
    uint8 public constant ROLE_JEWELER = 3;
    uint8 public constant ROLE_DESIGNER = 4;
    uint8 public constant ROLE_RETURNEE = 5;
    uint8 public constant ROLE_CONSULTANT = 6;
    uint8 public constant ROLE_ADVERTISER = 7;
    uint8 public constant ROLE_OMBUDSMAN = 8;
    
    // User registration
    struct User {
        bytes32 kycHash;
        uint8[] roles;
        bool isActive;
        uint256 registeredAt;
        address linkedLicensee; // For households
    }
    mapping(address => User) public users;
    address[] public userAddresses;
    
    // Licensee -> Households mapping
    mapping(address => address[]) public licenseeHouseholds;
    
    // Gold earmarks
    struct GoldEarmark {
        address owner;
        bytes32 certificateHash;
        uint256 pureGoldMilligrams;
        uint256 tgdpAmount;
        uint256 timestamp;
        bool isActive;
    }
    mapping(bytes32 => GoldEarmark) public goldEarmarks;
    bytes32[] public earmarkIds;
    
    // Events
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
    
    // Register user
    function registerUser(
        address user,
        bytes32 kycHash,
        uint8[] memory roles
    ) public onlyRole(REGISTRAR_ROLE) {
        require(user != address(0), "Invalid address");
        require(!users[user].isActive, "User already registered");
        require(roles.length > 0, "At least one role required");
        
        // Validate role compatibility
        require(validateRoles(roles), "Incompatible roles");
        
        users[user] = User({
            kycHash: kycHash,
            roles: roles,
            isActive: true,
            registeredAt: block.timestamp,
            linkedLicensee: address(0)
        });
        userAddresses.push(user);
        
        emit UserRegistered(user, kycHash, roles, block.timestamp);
    }
    
    // Validate role compatibility
    function validateRoles(uint8[] memory roles) internal pure returns (bool) {
        bool hasOmbudsman = false;
        bool hasJeweler = false;
        bool hasHousehold = false;
        
        for (uint256 i = 0; i < roles.length; i++) {
            if (roles[i] == ROLE_OMBUDSMAN) hasOmbudsman = true;
            if (roles[i] == ROLE_JEWELER) hasJeweler = true;
            if (roles[i] == ROLE_HOUSEHOLD) hasHousehold = true;
        }
        
        // Ombudsman cannot have other roles
        if (hasOmbudsman && roles.length > 1) return false;
        
        // Jeweler and Household are incompatible
        if (hasJeweler && hasHousehold) return false;
        
        return true;
    }
    
    // Link household to licensee
    function linkHouseholdToLicensee(
        address household,
        address licensee
    ) public onlyRole(REGISTRAR_ROLE) {
        require(users[household].isActive, "Household not registered");
        require(users[licensee].isActive, "Licensee not registered");
        require(hasRole_(household, ROLE_HOUSEHOLD), "Not a household");
        require(hasRole_(licensee, ROLE_LICENSEE), "Not a licensee");
        require(users[household].linkedLicensee == address(0), "Already linked");
        
        users[household].linkedLicensee = licensee;
        licenseeHouseholds[licensee].push(household);
        
        emit HouseholdLinked(household, licensee, block.timestamp);
    }
    
    // Check if user has specific role
    function hasRole_(address user, uint8 role) public view returns (bool) {
        uint8[] memory roles = users[user].roles;
        for (uint256 i = 0; i < roles.length; i++) {
            if (roles[i] == role) return true;
        }
        return false;
    }
    
    // Earmark gold
    function earmarkGold(
        address owner,
        bytes32 certificateHash,
        uint256 pureGoldMilligrams,
        uint256 tgdpAmount
    ) public onlyRole(REGISTRAR_ROLE) returns (bytes32) {
        require(users[owner].isActive, "User not registered");
        
        bytes32 earmarkId = keccak256(abi.encodePacked(
            owner,
            certificateHash,
            pureGoldMilligrams,
            block.timestamp
        ));
        
        goldEarmarks[earmarkId] = GoldEarmark({
            owner: owner,
            certificateHash: certificateHash,
            pureGoldMilligrams: pureGoldMilligrams,
            tgdpAmount: tgdpAmount,
            timestamp: block.timestamp,
            isActive: true
        });
        earmarkIds.push(earmarkId);
        
        emit GoldEarmarked(earmarkId, owner, certificateHash, pureGoldMilligrams, tgdpAmount);
        
        return earmarkId;
    }
    
    // Get user info
    function getUser(address user) public view returns (
        bytes32 kycHash,
        uint8[] memory roles,
        bool isActive,
        uint256 registeredAt,
        address linkedLicensee
    ) {
        User memory u = users[user];
        return (u.kycHash, u.roles, u.isActive, u.registeredAt, u.linkedLicensee);
    }
    
    // Get licensee's households
    function getLicenseeHouseholds(address licensee) public view returns (address[] memory) {
        return licenseeHouseholds[licensee];
    }
    
    // Get earmark details
    function getEarmark(bytes32 earmarkId) public view returns (
        address owner,
        bytes32 certificateHash,
        uint256 pureGoldMilligrams,
        uint256 tgdpAmount,
        uint256 timestamp,
        bool isActive
    ) {
        GoldEarmark memory e = goldEarmarks[earmarkId];
        return (e.owner, e.certificateHash, e.pureGoldMilligrams, e.tgdpAmount, e.timestamp, e.isActive);
    }
    
    // Get total users
    function getTotalUsers() public view returns (uint256) {
        return userAddresses.length;
    }
    
    // Get total earmarks
    function getTotalEarmarks() public view returns (uint256) {
        return earmarkIds.length;
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// CONTRACT 5: IPR REGISTRY (T-JDB)
// Jewelry Design Intellectual Property Registry
// ═══════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

contract IPRRegistry is AccessControl {
    using Counters for Counters.Counter;
    
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    
    Counters.Counter private _designIdCounter;
    
    // Design registration
    struct Design {
        bytes32 designHash;
        string metadataUri; // IPFS URI
        address designer;
        uint256 registeredAt;
        bool isActive;
        uint256 salesCount;
        uint256 totalRevenue;
    }
    
    mapping(uint256 => Design) public designs;
    mapping(bytes32 => uint256) public hashToDesignId;
    mapping(address => uint256[]) public designerDesigns;
    
    // Events
    event DesignRegistered(
        uint256 indexed designId,
        bytes32 designHash,
        address indexed designer,
        string metadataUri,
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
    
    // Register design
    function registerDesign(
        bytes32 designHash,
        string memory metadataUri,
        address designer
    ) public onlyRole(REGISTRAR_ROLE) returns (uint256) {
        require(designer != address(0), "Invalid designer address");
        require(hashToDesignId[designHash] == 0, "Design already registered");
        
        _designIdCounter.increment();
        uint256 designId = _designIdCounter.current();
        
        designs[designId] = Design({
            designHash: designHash,
            metadataUri: metadataUri,
            designer: designer,
            registeredAt: block.timestamp,
            isActive: true,
            salesCount: 0,
            totalRevenue: 0
        });
        
        hashToDesignId[designHash] = designId;
        designerDesigns[designer].push(designId);
        
        emit DesignRegistered(designId, designHash, designer, metadataUri, block.timestamp);
        
        return designId;
    }
    
    // Verify ownership
    function verifyOwnership(uint256 designId, address claimedOwner) public view returns (bool) {
        return designs[designId].designer == claimedOwner && designs[designId].isActive;
    }
    
    // Transfer design ownership
    function transferDesign(uint256 designId, address newOwner) public {
        require(designs[designId].designer == msg.sender, "Not the owner");
        require(newOwner != address(0), "Invalid new owner");
        
        address oldOwner = designs[designId].designer;
        designs[designId].designer = newOwner;
        designerDesigns[newOwner].push(designId);
        
        emit DesignTransferred(designId, oldOwner, newOwner, block.timestamp);
    }
    
    // Record sale
    function recordSale(uint256 designId, address buyer, uint256 amount) public onlyRole(REGISTRAR_ROLE) {
        require(designs[designId].isActive, "Design not active");
        
        designs[designId].salesCount++;
        designs[designId].totalRevenue += amount;
        
        emit DesignSold(designId, buyer, amount, block.timestamp);
    }
    
    // Get design details
    function getDesign(uint256 designId) public view returns (
        bytes32 designHash,
        string memory metadataUri,
        address designer,
        uint256 registeredAt,
        bool isActive,
        uint256 salesCount,
        uint256 totalRevenue
    ) {
        Design memory d = designs[designId];
        return (d.designHash, d.metadataUri, d.designer, d.registeredAt, d.isActive, d.salesCount, d.totalRevenue);
    }
    
    // Get designer's designs
    function getDesignerDesigns(address designer) public view returns (uint256[] memory) {
        return designerDesigns[designer];
    }
    
    // Get design ID by hash
    function getDesignIdByHash(bytes32 designHash) public view returns (uint256) {
        return hashToDesignId[designHash];
    }
    
    // Get total designs
    function getTotalDesigns() public view returns (uint256) {
        return _designIdCounter.current();
    }
    
    // Deactivate design
    function deactivateDesign(uint256 designId) public {
        require(designs[designId].designer == msg.sender || hasRole(REGISTRAR_ROLE, msg.sender), "Not authorized");
        designs[designId].isActive = false;
    }
}
