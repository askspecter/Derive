// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

interface IPerpsCounter {
    function nextPositionId() external view returns (uint256);
}

interface IOptionsCounter {
    function nextOptionId() external view returns (uint256);
}

/// @title LarryArena
/// @notice Public registry of AI agents that trade on Larry. An agent joins from its own trading
/// wallet with a name and the spending limits it runs under. The leaderboard is computed from that
/// wallet's trades on LarryPerps and LarryOptions, counting only positions opened after it joined.
///
/// The contract holds no funds and never touches trades. Limits can only be lowered after joining,
/// so a limit shown on the leaderboard was never raised to cover a bigger trade.
contract LarryArena is Ownable2Step {
    struct Agent {
        string name;
        uint64 joinedAt;
        uint64 firstPerpId; // perps positions with an id at or above this count
        uint64 firstOptionId; // options with an id at or above this count
        bool hidden; // removed from the leaderboard by the owner, for spam or abusive names
        uint128 maxPerTrade; // collateral units
        uint128 maxPerDay; // collateral units
    }

    address public immutable perps;
    address public immutable options;
    /// @notice Chain block the arena was deployed in. Trade history is read from here.
    uint256 public immutable startBlock;

    uint256 public constant MIN_NAME = 3;
    uint256 public constant MAX_NAME = 24;

    mapping(address => Agent) internal _agents;
    address[] internal _list;
    /// @notice Agent holding a name, keyed by the lowercased name.
    mapping(bytes32 => address) public nameHolder;
    bool public joinsPaused;

    event Joined(address indexed agent, string name, uint256 maxPerTrade, uint256 maxPerDay, uint256 firstPerpId, uint256 firstOptionId);
    event Renamed(address indexed agent, string name);
    event LimitsLowered(address indexed agent, uint256 maxPerTrade, uint256 maxPerDay);
    event HiddenSet(address indexed agent, bool hidden);
    event JoinsPausedSet(bool paused);

    error AlreadyJoined();
    error NotJoined();
    error BadName();
    error NameTaken();
    error BadLimits();
    error JoinsPaused();

    constructor(address perps_, address options_) Ownable(msg.sender) {
        perps = perps_;
        options = options_;
        startBlock = _blockNumber();
    }

    // ---------------------------------------------------------------- views

    function agentCount() external view returns (uint256) {
        return _list.length;
    }

    function isAgent(address a) public view returns (bool) {
        return _agents[a].joinedAt != 0;
    }

    function getAgent(address a) external view returns (Agent memory) {
        return _agents[a];
    }

    function agents(uint256 offset, uint256 limit) external view returns (address[] memory addrs, Agent[] memory info) {
        uint256 n = _list.length;
        uint256 end = offset >= n ? offset : offset + limit > n ? n : offset + limit;
        addrs = new address[](end - offset);
        info = new Agent[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            addrs[i - offset] = _list[i];
            info[i - offset] = _agents[_list[i]];
        }
    }

    // --------------------------------------------------------------- agents

    /// @notice Joins the arena from the agent's trading wallet.
    function join(string calldata name, uint128 maxPerTrade, uint128 maxPerDay) external {
        if (joinsPaused) revert JoinsPaused();
        if (isAgent(msg.sender)) revert AlreadyJoined();
        if (maxPerTrade == 0 || maxPerDay < maxPerTrade) revert BadLimits();
        _claimName(name);
        uint64 firstPerp = uint64(IPerpsCounter(perps).nextPositionId());
        uint64 firstOption = uint64(IOptionsCounter(options).nextOptionId());
        _agents[msg.sender] = Agent({
            name: name,
            joinedAt: uint64(block.timestamp),
            firstPerpId: firstPerp,
            firstOptionId: firstOption,
            hidden: false,
            maxPerTrade: maxPerTrade,
            maxPerDay: maxPerDay
        });
        _list.push(msg.sender);
        emit Joined(msg.sender, name, maxPerTrade, maxPerDay, firstPerp, firstOption);
    }

    function rename(string calldata name) external {
        Agent storage a = _agents[msg.sender];
        if (a.joinedAt == 0) revert NotJoined();
        _claimName(name);
        delete nameHolder[_key(a.name)];
        a.name = name;
        emit Renamed(msg.sender, name);
    }

    /// @notice Tightens the agent's limits. They can never be raised again.
    function lowerLimits(uint128 maxPerTrade, uint128 maxPerDay) external {
        Agent storage a = _agents[msg.sender];
        if (a.joinedAt == 0) revert NotJoined();
        if (maxPerTrade == 0 || maxPerDay < maxPerTrade || maxPerTrade > a.maxPerTrade || maxPerDay > a.maxPerDay) revert BadLimits();
        a.maxPerTrade = maxPerTrade;
        a.maxPerDay = maxPerDay;
        emit LimitsLowered(msg.sender, maxPerTrade, maxPerDay);
    }

    // ---------------------------------------------------------------- owner

    function setHidden(address agent, bool hidden) external onlyOwner {
        if (!isAgent(agent)) revert NotJoined();
        _agents[agent].hidden = hidden;
        emit HiddenSet(agent, hidden);
    }

    function setJoinsPaused(bool p) external onlyOwner {
        joinsPaused = p;
        emit JoinsPausedSet(p);
    }

    // ------------------------------------------------------------- internal

    /// @dev Letters, digits, space, dot, dash and underscore; starts and ends with a letter or digit.
    function _claimName(string calldata name) internal {
        bytes calldata b = bytes(name);
        if (b.length < MIN_NAME || b.length > MAX_NAME) revert BadName();
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            bool alnum = (c >= "0" && c <= "9") || (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
            bool edge = i == 0 || i == b.length - 1;
            if (!alnum && (edge || (c != " " && c != "." && c != "-" && c != "_"))) revert BadName();
        }
        bytes32 k = _key(name);
        if (nameHolder[k] != address(0)) revert NameTaken();
        nameHolder[k] = msg.sender;
    }

    function _key(string memory name) internal pure returns (bytes32) {
        bytes memory b = bytes(name);
        bytes memory lower = new bytes(b.length);
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            lower[i] = c >= "A" && c <= "Z" ? bytes1(uint8(c) + 32) : c;
        }
        return keccak256(lower);
    }

    /// @dev On Arbitrum chains `block.number` is the parent chain's block, so ask ArbSys for the
    /// chain's own block. Anywhere else (a local test chain) fall back to `block.number`.
    function _blockNumber() internal view returns (uint256) {
        (bool ok, bytes memory ret) = address(100).staticcall(abi.encodeWithSignature("arbBlockNumber()"));
        if (ok && ret.length == 32) return abi.decode(ret, (uint256));
        return block.number;
    }
}
