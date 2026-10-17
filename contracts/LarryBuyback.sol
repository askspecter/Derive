// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title LarryBuyback
/// @notice Holds ETH and buys $LARRY with it in small amounts, sending every token it buys straight to
/// the dead address. A keeper bot triggers each buy with a swap from an allowed router or aggregator
/// (for example 0x); the contract checks the $LARRY it received against the keeper's minimum and burns
/// all of it in the same transaction. Spending is capped per buy and per day onchain.
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
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        if (paused) revert Paused();
        if (!allowedTarget[target] || target == address(larry)) revert TargetNotAllowed();
        if (value == 0 || value > maxPerBuy) revert OverLimit();

        uint256 today = block.timestamp / 1 days;
        if (today != currentDay) {
            currentDay = today;
            spentToday = 0;
        }

        uint256 ethBefore = address(this).balance;
        uint256 larryBefore = larry.balanceOf(address(this));
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) revert SwapFailed(ret);

        uint256 got = larry.balanceOf(address(this)) - larryBefore;
        if (got == 0 || got < minOut) revert TooLittleOut();
        // Routers may refund part of the ETH; count what actually left.
        uint256 spent = ethBefore - address(this).balance;
        if (spent > maxPerBuy || spentToday + spent > maxPerDay) revert OverLimit();
        spentToday += spent;
        totalSpent += spent;
        buys += 1;

        uint256 all = larry.balanceOf(address(this));
        totalBurned += all;
        larry.safeTransfer(DEAD, all);
        emit BoughtAndBurned(target, spent, all);
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
