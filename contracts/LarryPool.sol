// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20, IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title LarryPool
/// @notice Liquidity vault (LLP) that is the counterparty to every Larry trade.
/// LPs deposit the collateral token (USDG) and receive shares. Trader losses and
/// fees flow into the pool; trader profits are paid out of it.
///
/// Solvency: a product must reserve the maximum amount a position can win before
/// opening it, and reserved liquidity can never be withdrawn by LPs. Payouts can
/// only consume a product's own reservation.
contract LarryPool is ERC4626, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Trading contracts allowed to reserve and pay out liquidity.
    mapping(address => bool) public isProduct;
    /// @notice Liquidity currently reserved by each product.
    mapping(address => uint256) public reservedBy;
    /// @notice Sum of all reservations.
    uint256 public totalReserved;

    /// @notice Max total assets the pool accepts. Keeps exposure small while the protocol is young.
    uint256 public depositCap;
    /// @notice Seconds a deposit is locked before it can be withdrawn or transferred.
    uint256 public lockPeriod;
    /// @notice When the account last received freshly minted shares.
    mapping(address => uint256) public lastDepositAt;
    /// @notice New deposits are blocked while paused. Withdrawals always work.
    bool public depositsPaused;
    /// @notice Receives the protocol share of trading fees.
    address public treasury;

    event ProductSet(address indexed product, bool enabled);
    event DepositCapSet(uint256 cap);
    event LockPeriodSet(uint256 period);
    event DepositsPausedSet(bool paused);
    event TreasurySet(address treasury);
    event Reserved(address indexed product, uint256 amount);
    event Released(address indexed product, uint256 amount);
    event PaidOut(address indexed product, address indexed to, uint256 amount);

    error NotProduct();
    error InsufficientFreeLiquidity();
    error ExceedsReservation();
    error DepositsPaused();
    error Locked();
    error ZeroAddress();

    modifier onlyProduct() {
        if (!isProduct[msg.sender]) revert NotProduct();
        _;
    }

    constructor(IERC20 collateral, uint256 initialDepositCap)
        ERC20("Larry Liquidity", "LLP")
        ERC4626(collateral)
        Ownable(msg.sender)
    {
        depositCap = initialDepositCap;
        lockPeriod = 1 days;
        treasury = msg.sender;
    }

    // ---------------------------------------------------------------- views

    /// @notice Liquidity not reserved for open positions.
    function freeLiquidity() public view returns (uint256) {
        uint256 bal = totalAssets();
        return bal > totalReserved ? bal - totalReserved : 0;
    }

    function unlockAt(address account) public view returns (uint256) {
        return lastDepositAt[account] + lockPeriod;
    }

    function maxDeposit(address) public view override returns (uint256) {
        if (depositsPaused) return 0;
        uint256 assets = totalAssets();
        return assets >= depositCap ? 0 : depositCap - assets;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        return convertToShares(maxDeposit(receiver));
    }

    function maxWithdraw(address owner_) public view override returns (uint256) {
        if (block.timestamp < unlockAt(owner_)) return 0;
        return Math.min(super.maxWithdraw(owner_), freeLiquidity());
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        if (block.timestamp < unlockAt(owner_)) return 0;
        return Math.min(super.maxRedeem(owner_), _convertToShares(freeLiquidity(), Math.Rounding.Floor));
    }

    // --------------------------------------------------------- LP actions

    function deposit(uint256 assets, address receiver) public override nonReentrant returns (uint256) {
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public override nonReentrant returns (uint256) {
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner_) public override nonReentrant returns (uint256) {
        return super.withdraw(assets, receiver, owner_);
    }

    function redeem(uint256 shares, address receiver, address owner_) public override nonReentrant returns (uint256) {
        return super.redeem(shares, receiver, owner_);
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        if (depositsPaused) revert DepositsPaused();
        lastDepositAt[receiver] = block.timestamp;
        super._deposit(caller, receiver, assets, shares);
    }

    /// @dev Locked shares can't move, so a fresh deposit can't dodge the lock by transferring.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && block.timestamp < unlockAt(from)) revert Locked();
        super._update(from, to, value);
    }

    /// @dev Virtual shares make the classic first depositor inflation attack uneconomical.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 3;
    }

    // ----------------------------------------------------- product hooks

    function reserve(uint256 amount) external onlyProduct {
        if (amount > freeLiquidity()) revert InsufficientFreeLiquidity();
        reservedBy[msg.sender] += amount;
        totalReserved += amount;
        emit Reserved(msg.sender, amount);
    }

    function release(uint256 amount) external onlyProduct {
        if (amount > reservedBy[msg.sender]) revert ExceedsReservation();
        reservedBy[msg.sender] -= amount;
        totalReserved -= amount;
        emit Released(msg.sender, amount);
    }

    /// @notice Pays a trader from the pool, consuming the product's reservation.
    function payOut(address to, uint256 amount) external onlyProduct nonReentrant {
        if (amount > reservedBy[msg.sender]) revert ExceedsReservation();
        reservedBy[msg.sender] -= amount;
        totalReserved -= amount;
        IERC20(asset()).safeTransfer(to, amount);
        emit PaidOut(msg.sender, to, amount);
    }

    // -------------------------------------------------------------- admin

    function setProduct(address product, bool enabled) external onlyOwner {
        if (product == address(0)) revert ZeroAddress();
        isProduct[product] = enabled;
        emit ProductSet(product, enabled);
    }

    function setDepositCap(uint256 cap) external onlyOwner {
        depositCap = cap;
        emit DepositCapSet(cap);
    }

    function setLockPeriod(uint256 period) external onlyOwner {
        require(period <= 30 days, "lock too long");
        lockPeriod = period;
        emit LockPeriodSet(period);
    }

    function setDepositsPaused(bool paused) external onlyOwner {
        depositsPaused = paused;
        emit DepositsPausedSet(paused);
    }

    function setTreasury(address t) external onlyOwner {
        if (t == address(0)) revert ZeroAddress();
        treasury = t;
        emit TreasurySet(t);
    }
}
