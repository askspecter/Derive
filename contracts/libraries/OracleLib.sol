// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";

/// @notice Reads Chainlink price feeds and normalises answers to 18 decimals.
library OracleLib {
    error InvalidPrice();
    error StalePrice();

    function toWad(int256 answer, uint8 feedDecimals) internal pure returns (uint256) {
        if (answer <= 0) revert InvalidPrice();
        uint256 a = uint256(answer);
        if (feedDecimals == 18) return a;
        if (feedDecimals < 18) return a * 10 ** (18 - feedDecimals);
        return a / 10 ** (feedDecimals - 18);
    }

    /// @notice Latest price as WAD. Reverts when the feed hasn't updated within `heartbeat` seconds.
    function latest(address feed, uint256 heartbeat) internal view returns (uint256 price, uint256 updatedAt) {
        (, int256 answer,, uint256 ts,) = IAggregatorV3(feed).latestRoundData();
        if (ts == 0 || block.timestamp - ts > heartbeat) revert StalePrice();
        price = toWad(answer, IAggregatorV3(feed).decimals());
        updatedAt = ts;
    }

    /// @notice Reverts unless `feed` answers like a Chainlink aggregator with a positive price.
    function check(address feed) internal view {
        (, int256 answer,,,) = IAggregatorV3(feed).latestRoundData();
        toWad(answer, IAggregatorV3(feed).decimals());
    }
}
