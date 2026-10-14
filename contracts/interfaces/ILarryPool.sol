// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Surface of LarryPool that the trading products (perps, options) use.
interface ILarryPool {
    function asset() external view returns (address);

    function treasury() external view returns (address);

    function freeLiquidity() external view returns (uint256);

    /// @dev Locks pool liquidity that a position could win. Reverts if not enough is free.
    function reserve(uint256 amount) external;

    /// @dev Unlocks liquidity previously reserved.
    function release(uint256 amount) external;

    /// @dev Pays a winning trader out of pool liquidity. Must be covered by the caller's reservation.
    function payOut(address to, uint256 amount) external;
}
