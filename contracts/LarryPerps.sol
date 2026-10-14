// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ILarryPool} from "./interfaces/ILarryPool.sol";
import {OracleLib} from "./libraries/OracleLib.sol";

/// @title LarryPerps
/// @notice Isolated margin perpetuals priced by Chainlink, with LarryPool as counterparty.
/// Sizes and collateral are in collateral token units (a dollar stablecoin), prices are WAD.
///
/// A position's profit is capped at `maxProfitMultiple` times its collateral, and that
/// amount is reserved in the pool when the position opens, so every winner can be paid.
contract LarryPerps is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 internal constant BPS = 10_000;

    struct Market {
        address feed; // Chainlink price feed proxy
        uint32 heartbeat; // max seconds since the last oracle update
        uint16 maxLeverage; // e.g. 20 for 20x
        uint16 openFeeBps; // fee on size when opening
        uint16 closeFeeBps; // fee on size when closing
        uint16 borrowBpsPerDay; // carry paid to LPs on size, per day
        uint16 maintenanceBps; // liquidatable below this share of size
        uint16 liquidationFeeBps; // share of size paid to the liquidator
        uint16 maxProfitMultiple; // profit cap as a multiple of collateral
        uint128 maxOpenInterest; // per side, in collateral units
        bool enabled;
    }

    struct Position {
        address owner;
        uint32 marketId;
        bool isLong;
        uint64 openedAt;
        uint256 size;
        uint256 collateral;
        uint256 entryPrice;
        uint256 reserved;
    }

    ILarryPool public immutable pool;
    IERC20 public immutable collateralToken;

    mapping(uint256 => Market) public markets;
    mapping(uint256 => uint256) public openInterestLong;
    mapping(uint256 => uint256) public openInterestShort;

    mapping(uint256 => Position) internal _positions;
    uint256 public nextPositionId = 1;

    mapping(address => uint256[]) internal _idsOf;
    mapping(uint256 => uint256) internal _idxInOwner;
    uint256[] internal _openIds;
    mapping(uint256 => uint256) internal _idxInOpen;

    /// @notice Share of opening fees sent to the treasury instead of LPs.
    uint256 public protocolShareBps = 3000;
    /// @notice Smallest collateral a position may post.
    uint256 public minCollateral;
    /// @notice Blocks new positions. Closing, adding collateral and liquidations always work.
    bool public paused;

    event MarketSet(uint256 indexed marketId, Market market);
    event PausedSet(bool paused);
    event ProtocolShareSet(uint256 bps);
    event MinCollateralSet(uint256 amount);
    event PositionOpened(
        uint256 indexed id, address indexed owner, uint256 indexed marketId, bool isLong, uint256 size, uint256 collateral, uint256 price, uint256 fee
    );
    event CollateralAdded(uint256 indexed id, uint256 amount);
    event PositionClosed(uint256 indexed id, address indexed owner, uint256 price, int256 pnl, uint256 borrowFee, uint256 closeFee, uint256 paidToTrader);
    event PositionLiquidated(uint256 indexed id, address indexed owner, address indexed liquidator, uint256 price, uint256 liquidatorFee);

    error MarketDisabled();
    error Paused();
    error SlippageExceeded();
    error BadLeverage();
    error CollateralTooSmall();
    error OpenInterestCap();
    error NotOwner();
    error NotLiquidatable();
    error UnknownPosition();
    error BadParams();

    constructor(ILarryPool pool_) Ownable(msg.sender) {
        pool = pool_;
        collateralToken = IERC20(pool_.asset());
        minCollateral = 10 * 10 ** _decimals();
    }

    // ---------------------------------------------------------------- views

    function price(uint256 marketId) public view returns (uint256 p) {
        Market storage m = markets[marketId];
        if (m.feed == address(0)) revert MarketDisabled();
        (p,) = OracleLib.latest(m.feed, m.heartbeat);
    }

    function getPosition(uint256 id) external view returns (Position memory) {
        return _positions[id];
    }

    function positionIdsOf(address owner_) external view returns (uint256[] memory) {
        return _idsOf[owner_];
    }

    function openPositionCount() external view returns (uint256) {
        return _openIds.length;
    }

    function openPositionIds(uint256 offset, uint256 limit) external view returns (uint256[] memory ids) {
        uint256 n = _openIds.length;
        if (offset >= n) return new uint256[](0);
        uint256 end = offset + limit > n ? n : offset + limit;
        ids = new uint256[](end - offset);
        for (uint256 i = offset; i < end; i++) ids[i - offset] = _openIds[i];
    }

    /// @notice Unrealised state of a position at the current oracle price.
    function positionState(uint256 id)
        external
        view
        returns (uint256 markPrice, int256 pnl, uint256 borrowFee, int256 equity, bool liquidatable)
    {
        Position storage p = _positions[id];
        if (p.owner == address(0)) revert UnknownPosition();
        Market storage m = markets[p.marketId];
        markPrice = price(p.marketId);
        pnl = _pnl(p, markPrice);
        borrowFee = _borrowFee(p, m);
        equity = int256(p.collateral) + pnl - int256(borrowFee);
        liquidatable = equity < int256((p.size * m.maintenanceBps) / BPS);
    }

    /// @notice Price at which the position becomes liquidatable, ignoring future borrow fees.
    function liquidationPrice(uint256 id) external view returns (uint256) {
        Position storage p = _positions[id];
        if (p.owner == address(0)) revert UnknownPosition();
        Market storage m = markets[p.marketId];
        int256 buffer = int256(p.collateral) - int256(_borrowFee(p, m)) - int256((p.size * m.maintenanceBps) / BPS);
        // pnl = size * (P - entry) / entry * dir; solve pnl = -buffer
        int256 move = (buffer * int256(p.entryPrice)) / int256(p.size);
        int256 liq = p.isLong ? int256(p.entryPrice) - move : int256(p.entryPrice) + move;
        return liq > 0 ? uint256(liq) : 0;
    }

    // ------------------------------------------------------------- trading

    /// @param collateral collateral to post, in token units (fee is taken from it)
    /// @param size position size in token units (dollars)
    /// @param acceptablePrice worst oracle price the trader accepts (WAD)
    function openPosition(uint256 marketId, bool isLong, uint256 collateral, uint256 size, uint256 acceptablePrice)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (paused) revert Paused();
        Market storage m = markets[marketId];
        if (!m.enabled) revert MarketDisabled();

        uint256 px = price(marketId);
        if (isLong ? px > acceptablePrice : px < acceptablePrice) revert SlippageExceeded();

        uint256 fee = (size * m.openFeeBps) / BPS;
        if (collateral < minCollateral || collateral <= fee) revert CollateralTooSmall();
        uint256 net = collateral - fee;
        if (size < net || size > net * m.maxLeverage) revert BadLeverage();

        if (isLong) {
            openInterestLong[marketId] += size;
            if (openInterestLong[marketId] > m.maxOpenInterest) revert OpenInterestCap();
        } else {
            openInterestShort[marketId] += size;
            if (openInterestShort[marketId] > m.maxOpenInterest) revert OpenInterestCap();
        }

        uint256 reserved = net * m.maxProfitMultiple;
        pool.reserve(reserved);

        collateralToken.safeTransferFrom(msg.sender, address(this), collateral);
        uint256 protocolFee = (fee * protocolShareBps) / BPS;
        if (protocolFee > 0) collateralToken.safeTransfer(pool.treasury(), protocolFee);
        if (fee > protocolFee) collateralToken.safeTransfer(address(pool), fee - protocolFee);

        id = nextPositionId++;
        _positions[id] = Position({
            owner: msg.sender,
            marketId: uint32(marketId),
            isLong: isLong,
            openedAt: uint64(block.timestamp),
            size: size,
            collateral: net,
            entryPrice: px,
            reserved: reserved
        });
        _idxInOwner[id] = _idsOf[msg.sender].length;
        _idsOf[msg.sender].push(id);
        _idxInOpen[id] = _openIds.length;
        _openIds.push(id);

        emit PositionOpened(id, msg.sender, marketId, isLong, size, net, px, fee);
    }

    function addCollateral(uint256 id, uint256 amount) external nonReentrant {
        Position storage p = _positions[id];
        if (p.owner == address(0)) revert UnknownPosition();
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        p.collateral += amount;
        emit CollateralAdded(id, amount);
    }

    function closePosition(uint256 id, uint256 acceptablePrice) external nonReentrant {
        Position memory p = _positions[id];
        if (p.owner != msg.sender) revert NotOwner();
        Market storage m = markets[p.marketId];
        uint256 px = price(p.marketId);
        if (p.isLong ? px < acceptablePrice : px > acceptablePrice) revert SlippageExceeded();

        int256 pnl = _pnl(p, px);
        if (pnl > int256(p.reserved)) pnl = int256(p.reserved);
        uint256 borrowFee = _borrowFee(p, m);
        uint256 closeFee = (p.size * m.closeFeeBps) / BPS;

        int256 value = int256(p.collateral) + pnl - int256(borrowFee) - int256(closeFee);
        uint256 toTrader = value > 0 ? uint256(value) : 0;
        if (toTrader > p.collateral + p.reserved) toTrader = p.collateral + p.reserved;

        _remove(id, p);
        uint256 fromPool;
        if (toTrader > p.collateral) {
            fromPool = toTrader - p.collateral;
            collateralToken.safeTransfer(p.owner, p.collateral);
            pool.payOut(p.owner, fromPool);
        } else {
            if (toTrader > 0) collateralToken.safeTransfer(p.owner, toTrader);
            collateralToken.safeTransfer(address(pool), p.collateral - toTrader);
        }
        pool.release(p.reserved - fromPool);

        emit PositionClosed(id, p.owner, px, pnl, borrowFee, closeFee, toTrader);
    }

    /// @notice Anyone can liquidate an underwater position and earn the liquidation fee.
    function liquidate(uint256 id) external nonReentrant {
        Position memory p = _positions[id];
        if (p.owner == address(0)) revert UnknownPosition();
        Market storage m = markets[p.marketId];
        uint256 px = price(p.marketId);

        int256 equity = int256(p.collateral) + _pnl(p, px) - int256(_borrowFee(p, m));
        if (equity >= int256((p.size * m.maintenanceBps) / BPS)) revert NotLiquidatable();

        uint256 reward = (p.size * m.liquidationFeeBps) / BPS;
        if (reward > p.collateral) reward = p.collateral;

        _remove(id, p);
        if (reward > 0) collateralToken.safeTransfer(msg.sender, reward);
        if (p.collateral > reward) collateralToken.safeTransfer(address(pool), p.collateral - reward);
        pool.release(p.reserved);

        emit PositionLiquidated(id, p.owner, msg.sender, px, reward);
    }

    // ------------------------------------------------------------ internal

    function _pnl(Position memory p, uint256 px) internal pure returns (int256) {
        int256 diff = int256(px) - int256(p.entryPrice);
        int256 pnl = (int256(p.size) * diff) / int256(p.entryPrice);
        return p.isLong ? pnl : -pnl;
    }

    function _borrowFee(Position memory p, Market storage m) internal view returns (uint256) {
        return (p.size * m.borrowBpsPerDay * (block.timestamp - p.openedAt)) / (BPS * 1 days);
    }

    function _remove(uint256 id, Position memory p) internal {
        if (p.isLong) openInterestLong[p.marketId] -= p.size;
        else openInterestShort[p.marketId] -= p.size;

        uint256[] storage ids = _idsOf[p.owner];
        uint256 i = _idxInOwner[id];
        uint256 lastId = ids[ids.length - 1];
        ids[i] = lastId;
        _idxInOwner[lastId] = i;
        ids.pop();

        uint256 j = _idxInOpen[id];
        uint256 lastOpen = _openIds[_openIds.length - 1];
        _openIds[j] = lastOpen;
        _idxInOpen[lastOpen] = j;
        _openIds.pop();

        delete _positions[id];
        delete _idxInOwner[id];
        delete _idxInOpen[id];
    }

    function _decimals() internal view returns (uint8) {
        (bool ok, bytes memory data) = address(collateralToken).staticcall(abi.encodeWithSignature("decimals()"));
        return ok && data.length >= 32 ? abi.decode(data, (uint8)) : 18;
    }

    // --------------------------------------------------------------- admin

    function setMarket(uint256 marketId, Market calldata m) external onlyOwner {
        if (
            m.feed == address(0) || m.heartbeat == 0 || m.maxLeverage == 0 || m.maxLeverage > 50
                || m.openFeeBps > 100 || m.closeFeeBps > 100 || m.borrowBpsPerDay > 100 || m.maintenanceBps == 0
                || m.maintenanceBps > 2000 || m.liquidationFeeBps > m.maintenanceBps || m.maxProfitMultiple == 0
                || m.maxProfitMultiple > 20
        ) revert BadParams();
        // Fails early if the feed is not a working Chainlink proxy. Freshness is not
        // checked here so stock markets can be listed while their exchange is closed.
        OracleLib.check(m.feed);
        markets[marketId] = m;
        emit MarketSet(marketId, m);
    }

    function setMarketEnabled(uint256 marketId, bool enabled) external onlyOwner {
        if (markets[marketId].feed == address(0)) revert BadParams();
        markets[marketId].enabled = enabled;
        emit MarketSet(marketId, markets[marketId]);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    function setProtocolShareBps(uint256 bps) external onlyOwner {
        if (bps > 5000) revert BadParams();
        protocolShareBps = bps;
        emit ProtocolShareSet(bps);
    }

    function setMinCollateral(uint256 amount) external onlyOwner {
        minCollateral = amount;
        emit MinCollateralSet(amount);
    }
}
