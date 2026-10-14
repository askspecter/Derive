// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Chainlink style aggregator for tests. Each update creates a new round.
contract MockAggregator {
    struct Round {
        int256 answer;
        uint256 updatedAt;
    }

    uint8 public immutable decimals;
    string public description;
    uint80 public latestRound;
    mapping(uint80 => Round) internal _rounds;

    constructor(uint8 decimals_, string memory description_, int256 initialAnswer) {
        decimals = decimals_;
        description = description_;
        _push(initialAnswer, block.timestamp);
    }

    function setAnswer(int256 answer) external {
        _push(answer, block.timestamp);
    }

    function setAnswerAt(int256 answer, uint256 updatedAt) external {
        _push(answer, updatedAt);
    }

    function _push(int256 answer, uint256 ts) internal {
        latestRound++;
        _rounds[latestRound] = Round(answer, ts);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = _rounds[latestRound];
        return (latestRound, r.answer, r.updatedAt, r.updatedAt, latestRound);
    }

    function getRoundData(uint80 id) external view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = _rounds[id];
        require(r.updatedAt != 0, "No data present.");
        return (id, r.answer, r.updatedAt, r.updatedAt, id);
    }
}
