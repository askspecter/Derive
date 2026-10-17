// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title HeatFeed
/// @notice A heat index for one stock token, in the shape of a Chainlink price feed so LarryPerps can list
/// it as a market (for example NVDA-HEAT). The index is 100 when whale flow is neutral, above 100 when
/// whales are buying and below when they are selling. An updater posts it from Thermal's whale flow data.
///
/// Every update is stored onchain with its time, and each one can move the index at most `maxMoveBps`,
/// so one bad or late update can't jump a market. If updates stop, the perps market's heartbeat marks the
/// feed stale and new trades halt until it resumes.
contract HeatFeed is Ownable2Step {
    struct Round {
        int256 answer;
        uint64 updatedAt;
    }

    uint8 public constant decimals = 8;
    uint256 public constant version = 1;
    int256 public constant MIN_ANSWER = 1e8; // index 1
    int256 public constant MAX_ANSWER = 1000e8; // index 1000

    string public description;
    address public updater;
    uint16 public maxMoveBps;
    uint80 public latestRound;
    mapping(uint80 => Round) internal _rounds;

    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);
    event UpdaterSet(address updater);
    event MaxMoveSet(uint256 bps);

    error NotUpdater();
    error OutOfRange();
    error MoveTooLarge();
    error NoData();
    error BadParams();

    constructor(string memory description_, address updater_, uint16 maxMoveBps_, int256 initial) Ownable(msg.sender) {
        if (maxMoveBps_ == 0 || maxMoveBps_ > 5000) revert BadParams();
        description = description_;
        updater = updater_;
        maxMoveBps = maxMoveBps_;
        emit UpdaterSet(updater_);
        emit MaxMoveSet(maxMoveBps_);
        _store(initial);
    }

    /// @notice Posts the latest heat index (8 decimals, 100e8 = neutral).
    function update(int256 answer) external {
        if (msg.sender != updater && msg.sender != owner()) revert NotUpdater();
        int256 prev = _rounds[latestRound].answer;
        int256 diff = answer > prev ? answer - prev : prev - answer;
        if (diff * 10_000 > prev * int256(uint256(maxMoveBps))) revert MoveTooLarge();
        _store(answer);
    }

    function _store(int256 answer) internal {
        if (answer < MIN_ANSWER || answer > MAX_ANSWER) revert OutOfRange();
        uint80 id = ++latestRound;
        _rounds[id] = Round(answer, uint64(block.timestamp));
        emit AnswerUpdated(answer, id, block.timestamp);
    }

    // ------------------------------------------------- Chainlink interface

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return getRoundData(latestRound);
    }

    function getRoundData(uint80 id) public view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = _rounds[id];
        if (r.updatedAt == 0) revert NoData();
        return (id, r.answer, r.updatedAt, r.updatedAt, id);
    }

    function latestAnswer() external view returns (int256) {
        return _rounds[latestRound].answer;
    }

    // ---------------------------------------------------------------- owner

    function setUpdater(address u) external onlyOwner {
        updater = u;
        emit UpdaterSet(u);
    }

    function setMaxMoveBps(uint16 bps) external onlyOwner {
        if (bps == 0 || bps > 5000) revert BadParams();
        maxMoveBps = bps;
        emit MaxMoveSet(bps);
    }
}
