// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/// @title LarryVaultOracle
/// @notice Morpho Blue oracle pricing LLP (Larry Vault shares) in the vault's own asset (USDG), so LLP can be
/// used as collateral to borrow USDG. The price is what a share redeems for right now: USDG held by the vault
/// per share. Morpho reads it as the value of 1 collateral unit in loan units, scaled by 1e36.
contract LarryVaultOracle {
    IERC4626 public immutable vault;
    uint256 internal immutable _oneShare;

    constructor(IERC4626 vault_) {
        vault = vault_;
        _oneShare = 10 ** vault_.decimals();
    }

    /// @notice Loan units per collateral unit, times 1e36.
    function price() external view returns (uint256) {
        return (vault.convertToAssets(_oneShare) * 1e36) / _oneShare;
    }
}
