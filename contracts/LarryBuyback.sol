// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Minimal Uniswap V4 types, matching v4-core.
struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

interface IPoolManagerV4 {
    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256 swapDelta);
    function settle() external payable returns (uint256 paid);
    function take(address currency, address to, uint256 amount) external;
}

/// @title LarryBuyback
/// @notice Holds ETH and buys $LARRY with it in small amounts, sending every token it buys straight to
/// the dead address. A keeper bot triggers each buy with a swap from an allowed router or aggregator
/// (for example 0x); the contract checks the $LARRY it received against the keeper's minimum and burns
/// all of it in the same transaction. Spending is capped per buy and per day onchain.
///
/// Where $LARRY trades in a Uniswap V4 ETH pool, `buyAndBurnV4` swaps on the PoolManager directly and has
/// it pay the $LARRY straight to the dead address, with no router or aggregator in between.
///
/// The contract only ever spends ETH and never approves tokens, so a swap call cannot pull anything
/// else from it. Whatever $LARRY it holds can be burned by anyone.
contract LarryBuyback is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IERC20 public immutable larry;
    address public keeper;
    /// @notice Most ETH a single buy may spend, and per UTC day.
    uint256 public maxPerBuy;
    uint256 public maxPerDay;
    bool public paused;
    /// @notice Routers and aggregators the keeper may swap through.
    mapping(address => bool) public allowedTarget;

    /// @notice Uniswap V4 PoolManager and the ETH / $LARRY pool to buy from.
    address public poolManager;
    PoolKey public v4Pool;
    bool internal _inV4;
    /// @dev Lowest sqrt price Uniswap allows plus one: no price limit on an ETH to $LARRY swap.
    uint160 internal constant MIN_SQRT_PRICE_PLUS_ONE = 4295128740;

    uint256 public currentDay;
    uint256 public spentToday;
    uint256 public totalSpent;
    uint256 public totalBurned;
    uint256 public buys;

    event BoughtAndBurned(address indexed target, uint256 ethSpent, uint256 larryBurned);
    event Burned(uint256 amount);
    event KeeperSet(address keeper);
    event LimitsSet(uint256 maxPerBuy, uint256 maxPerDay);
    event TargetSet(address indexed target, bool allowed);
    event PausedSet(bool paused);
    event Withdrawn(address to, uint256 amount);
    event V4PoolSet(address poolManager, PoolKey key);

    error NotKeeper();
    error Paused();
    error TargetNotAllowed();
    error OverLimit();
    error TooLittleOut();
    error SwapFailed(bytes reason);
    error BadParams();

    constructor(IERC20 larry_, address keeper_, uint256 maxPerBuy_, uint256 maxPerDay_) Ownable(msg.sender) {
        if (address(larry_) == address(0) || maxPerBuy_ == 0 || maxPerDay_ < maxPerBuy_) revert BadParams();
        larry = larry_;
        keeper = keeper_;
        maxPerBuy = maxPerBuy_;
        maxPerDay = maxPerDay_;
        emit KeeperSet(keeper_);
        emit LimitsSet(maxPerBuy_, maxPerDay_);
    }

    receive() external payable {}

    /// @notice ETH still free to spend today.
    function leftToday() public view returns (uint256) {
        uint256 spent = block.timestamp / 1 days == currentDay ? spentToday : 0;
        return spent >= maxPerDay ? 0 : maxPerDay - spent;
    }

    /// @notice Swaps `value` ETH through `target` with `data`, then burns all $LARRY this contract holds.
    /// Reverts unless the swap delivered at least `minOut` $LARRY to this contract.
    function buyAndBurn(address target, bytes calldata data, uint256 value, uint256 minOut) external nonReentrant {
        _checkBuy(value);
        if (!allowedTarget[target] || target == address(larry)) revert TargetNotAllowed();

        uint256 ethBefore = address(this).balance;
        uint256 larryBefore = larry.balanceOf(address(this));
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) revert SwapFailed(ret);

        uint256 got = larry.balanceOf(address(this)) - larryBefore;
        if (got == 0 || got < minOut) revert TooLittleOut();
        // Routers may refund part of the ETH; count what actually left.
        uint256 spent = ethBefore - address(this).balance;
        _record(spent);

        uint256 all = larry.balanceOf(address(this));
        totalBurned += all;
        larry.safeTransfer(DEAD, all);
        emit BoughtAndBurned(target, spent, all);
    }

    /// @notice Buys $LARRY with `value` ETH in the Uniswap V4 pool and has the PoolManager pay it straight to
    /// the dead address. Returns the $LARRY burned; reverts below `minOut`. Simulating it with `minOut` 0
    /// gives a live quote.
    function buyAndBurnV4(uint256 value, uint256 minOut) external nonReentrant returns (uint256 burned) {
        _checkBuy(value);
        if (poolManager == address(0)) revert TargetNotAllowed();
        _inV4 = true;
        (uint256 paid, uint256 got) = abi.decode(IPoolManagerV4(poolManager).unlock(abi.encode(value)), (uint256, uint256));
        _inV4 = false;
        if (got == 0 || got < minOut) revert TooLittleOut();
        _record(paid);
        totalBurned += got;
        emit BoughtAndBurned(poolManager, paid, got);
        return got;
    }

    /// @dev Called by the PoolManager inside `unlock`: swap exact ETH in, pay it, take $LARRY to the dead address.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != poolManager || !_inV4) revert NotKeeper();
        uint256 value = abi.decode(data, (uint256));
        PoolKey memory key = v4Pool;
        int256 delta = IPoolManagerV4(poolManager).swap(key, SwapParams(true, -int256(value), MIN_SQRT_PRICE_PLUS_ONE), "");
        int128 amount0 = int128(delta >> 128);
        int128 amount1 = int128(delta);
        if (amount0 > 0 || amount1 < 0) revert TooLittleOut();
        uint256 paid = uint256(uint128(-amount0));
        uint256 got = uint256(uint128(amount1));
        if (paid > value) revert OverLimit();
        IPoolManagerV4(poolManager).settle{value: paid}();
        if (got > 0) IPoolManagerV4(poolManager).take(address(larry), DEAD, got);
        return abi.encode(paid, got);
    }

    function _checkBuy(uint256 value) internal {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        if (paused) revert Paused();
        if (value == 0 || value > maxPerBuy) revert OverLimit();
        uint256 today = block.timestamp / 1 days;
        if (today != currentDay) {
            currentDay = today;
            spentToday = 0;
        }
    }

    function _record(uint256 spent) internal {
        if (spent > maxPerBuy || spentToday + spent > maxPerDay) revert OverLimit();
        spentToday += spent;
        totalSpent += spent;
        buys += 1;
    }

    /// @notice Burns any $LARRY sent to this contract. Anyone can call it.
    function burnHeld() external nonReentrant {
        uint256 all = larry.balanceOf(address(this));
        if (all == 0) return;
        totalBurned += all;
        larry.safeTransfer(DEAD, all);
        emit Burned(all);
    }

    // ---------------------------------------------------------------- owner

    function setKeeper(address k) external onlyOwner {
        keeper = k;
        emit KeeperSet(k);
    }

    function setLimits(uint256 perBuy, uint256 perDay) external onlyOwner {
        if (perBuy == 0 || perDay < perBuy) revert BadParams();
        maxPerBuy = perBuy;
        maxPerDay = perDay;
        emit LimitsSet(perBuy, perDay);
    }

    function setTarget(address target, bool allowed) external onlyOwner {
        if (target == address(larry) || target == address(0)) revert BadParams();
        allowedTarget[target] = allowed;
        emit TargetSet(target, allowed);
    }

    /// @notice The Uniswap V4 ETH / $LARRY pool: currency0 must be native ETH (address 0), currency1 $LARRY.
    function setV4Pool(address manager, PoolKey calldata key) external onlyOwner {
        if (manager == address(0) || key.currency0 != address(0) || key.currency1 != address(larry)) revert BadParams();
        poolManager = manager;
        v4Pool = key;
        emit V4PoolSet(manager, key);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    /// @notice Takes unspent ETH back out, for example to stop the buybacks for good.
    function withdraw(address payable to, uint256 amount) external onlyOwner nonReentrant {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert BadParams();
        emit Withdrawn(to, amount);
    }
}
