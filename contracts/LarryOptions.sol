// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ILarryPool} from "./interfaces/ILarryPool.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {OracleLib} from "./libraries/OracleLib.sol";
import {BlackScholesLib} from "./libraries/BlackScholesLib.sol";

/// @title LarryOptions
/// @notice European, cash settled options sold by LarryPool and priced onchain with Black Scholes.
///
/// Expiries are Fridays at 08:00 UTC. Payouts are capped at the strike value per contract
/// (a call can at most double in the money), and that cap is reserved in the pool at purchase,
/// so every option can always be paid.
///
/// Settlement is trustless: anyone submits the first Chainlink round published at or after
/// expiry, and the contract checks it really is the first one.
contract LarryOptions is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 internal constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;
    /// @dev 1970-01-02 was a Friday; 08:00 UTC on it is 115200 seconds after the epoch.
    uint256 internal constant FRIDAY_0800 = 115_200;

    struct Market {
        address feed; // Chainlink price feed proxy
        uint32 heartbeat; // max seconds since the last oracle update when buying
        uint64 vol; // annualised implied volatility, WAD (0.6e18 = 60%)
        uint16 spreadBps; // markup over the model price, kept by LPs
        uint16 minPremiumBps; // floor on premium, as a share of spot
        uint32 maxExpiry; // furthest expiry that can be bought, in seconds from now
        uint128 maxOpenNotional; // cap on reserved payouts for this market, collateral units
        bool enabled;
    }

    struct Option {
        address owner;
        uint32 marketId;
        bool isCall;
        bool exercised;
        uint64 expiry;
        uint256 strike; // WAD
        uint256 amount; // contracts, WAD (1e18 = one unit of the underlying)
        uint256 premium; // paid, collateral units
        uint256 maxPayout; // reserved in the pool, collateral units
    }

    ILarryPool public immutable pool;
    IERC20 public immutable collateralToken;
    uint256 internal immutable _unit; // 10 ** collateral decimals

    mapping(uint256 => Market) public markets;
    mapping(uint256 => uint256) public openNotional;
    /// @notice Settlement price per market and expiry (WAD), zero until settled.
    mapping(uint256 => mapping(uint256 => uint256)) public settlementPrice;

    mapping(uint256 => Option) internal _options;
    uint256 public nextOptionId = 1;
    mapping(address => uint256[]) internal _idsOf;

    /// @notice Fee on top of the premium, sent to the treasury.
    uint256 public protocolFeeBps = 30;
    /// @notice After this delay past expiry the owner may settle by hand if no oracle round exists.
    uint256 public constant MANUAL_SETTLE_DELAY = 3 days;
    bool public paused;

    event MarketSet(uint256 indexed marketId, Market market);
    event PausedSet(bool paused);
    event ProtocolFeeSet(uint256 bps);
    event OptionBought(
        uint256 indexed id,
        address indexed owner,
        uint256 indexed marketId,
        bool isCall,
        uint256 strike,
        uint256 expiry,
        uint256 amount,
        uint256 premium,
        uint256 fee
    );
    event Settled(uint256 indexed marketId, uint256 indexed expiry, uint256 price, uint80 roundId, bool manual);
    event Exercised(uint256 indexed id, address indexed owner, uint256 payout);

    error MarketDisabled();
    error Paused();
    error BadExpiry();
    error BadStrike();
    error BadAmount();
    error PremiumTooHigh();
    error NotionalCap();
    error NotExpired();
    error AlreadySettled();
    error NotSettled();
    error BadRound();
    error AlreadyExercised();
    error UnknownOption();
    error BadParams();

    constructor(ILarryPool pool_) Ownable(msg.sender) {
        pool = pool_;
        collateralToken = IERC20(pool_.asset());
        (bool ok, bytes memory data) = address(collateralToken).staticcall(abi.encodeWithSignature("decimals()"));
        _unit = 10 ** (ok && data.length >= 32 ? abi.decode(data, (uint8)) : 18);
    }

    // ---------------------------------------------------------------- views

    function isValidExpiry(uint256 expiry) public view returns (bool) {
        return expiry > block.timestamp + 1 hours && expiry % 1 weeks == FRIDAY_0800;
    }

    function getOption(uint256 id) external view returns (Option memory) {
        return _options[id];
    }

    function optionIdsOf(address owner_) external view returns (uint256[] memory) {
        return _idsOf[owner_];
    }

    function spot(uint256 marketId) public view returns (uint256 p) {
        Market storage m = markets[marketId];
        if (m.feed == address(0)) revert MarketDisabled();
        (p,) = OracleLib.latest(m.feed, m.heartbeat);
    }

    /// @notice Price to buy `amount` contracts now.
    /// @return premium premium in collateral units
    /// @return fee protocol fee in collateral units, paid on top
    /// @return maxPayout liquidity the pool reserves for this option
    function quote(uint256 marketId, bool isCall, uint256 strike, uint256 expiry, uint256 amount)
        public
        view
        returns (uint256 premium, uint256 fee, uint256 maxPayout)
    {
        Market storage m = markets[marketId];
        if (!m.enabled) revert MarketDisabled();
        if (!isValidExpiry(expiry) || expiry > block.timestamp + m.maxExpiry) revert BadExpiry();
        if (amount == 0) revert BadAmount();
        uint256 s = spot(marketId);
        if (strike < s / 2 || strike > s * 2) revert BadStrike();

        uint256 unitPrice = BlackScholesLib.price(isCall, s, strike, expiry - block.timestamp, m.vol);
        unitPrice = (unitPrice * (BPS + m.spreadBps)) / BPS;
        uint256 floor = (s * m.minPremiumBps) / BPS;
        if (unitPrice < floor) unitPrice = floor;
        // A call's payout is capped at the strike, so it is never worth more than the strike.
        if (unitPrice > strike) unitPrice = strike;

        premium = Math.mulDiv(unitPrice * amount / WAD, _unit, WAD, Math.Rounding.Ceil);
        fee = (premium * protocolFeeBps) / BPS;
        maxPayout = Math.mulDiv(strike * amount / WAD, _unit, WAD, Math.Rounding.Ceil);
    }

    /// @notice Value of an option once its expiry is settled, in collateral units.
    function payoutOf(uint256 id) public view returns (uint256) {
        Option storage o = _options[id];
        uint256 px = settlementPrice[o.marketId][o.expiry];
        if (px == 0) return 0;
        uint256 intrinsic = o.isCall ? (px > o.strike ? px - o.strike : 0) : (o.strike > px ? o.strike - px : 0);
        uint256 payout = Math.mulDiv(intrinsic * o.amount / WAD, _unit, WAD);
        return payout > o.maxPayout ? o.maxPayout : payout;
    }

    // ------------------------------------------------------------- trading

    function buy(uint256 marketId, bool isCall, uint256 strike, uint256 expiry, uint256 amount, uint256 maxCost)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (paused) revert Paused();
        (uint256 premium, uint256 fee, uint256 maxPayout) = quote(marketId, isCall, strike, expiry, amount);
        if (premium + fee > maxCost) revert PremiumTooHigh();

        openNotional[marketId] += maxPayout;
        if (openNotional[marketId] > markets[marketId].maxOpenNotional) revert NotionalCap();
        pool.reserve(maxPayout);

        collateralToken.safeTransferFrom(msg.sender, address(pool), premium);
        if (fee > 0) collateralToken.safeTransferFrom(msg.sender, pool.treasury(), fee);

        id = nextOptionId++;
        _options[id] = Option({
            owner: msg.sender,
            marketId: uint32(marketId),
            isCall: isCall,
            exercised: false,
            expiry: uint64(expiry),
            strike: strike,
            amount: amount,
            premium: premium,
            maxPayout: maxPayout
        });
        _idsOf[msg.sender].push(id);
        emit OptionBought(id, msg.sender, marketId, isCall, strike, expiry, amount, premium, fee);
    }

    /// @notice Records the settlement price of an expiry from the first Chainlink round at or after it.
    function settle(uint256 marketId, uint256 expiry, uint80 roundId) external {
        Market storage m = markets[marketId];
        if (m.feed == address(0)) revert MarketDisabled();
        if (block.timestamp < expiry) revert NotExpired();
        if (settlementPrice[marketId][expiry] != 0) revert AlreadySettled();

        IAggregatorV3 feed = IAggregatorV3(m.feed);
        (, int256 answer,, uint256 updatedAt,) = feed.getRoundData(roundId);
        if (updatedAt < expiry) revert BadRound();

        // The previous round must be from before expiry, which proves `roundId` is the first
        // round at or after it. At a phase boundary the previous round id may not exist; only
        // then is the round accepted without that proof, and it must land within an hour of expiry.
        bool prevExists;
        uint256 prevUpdatedAt;
        try feed.getRoundData(roundId - 1) returns (uint80, int256, uint256, uint256 ts, uint80) {
            prevExists = ts != 0;
            prevUpdatedAt = ts;
        } catch {}
        if (prevExists ? prevUpdatedAt >= expiry : updatedAt > expiry + 1 hours) revert BadRound();

        uint256 px = OracleLib.toWad(answer, feed.decimals());
        settlementPrice[marketId][expiry] = px;
        emit Settled(marketId, expiry, px, roundId, false);
    }

    /// @notice Fallback if no oracle round can settle an expiry. Only after a long delay.
    function settleManual(uint256 marketId, uint256 expiry, uint256 priceWad) external onlyOwner {
        if (block.timestamp < expiry + MANUAL_SETTLE_DELAY) revert NotExpired();
        if (settlementPrice[marketId][expiry] != 0) revert AlreadySettled();
        if (priceWad == 0) revert BadParams();
        settlementPrice[marketId][expiry] = priceWad;
        emit Settled(marketId, expiry, priceWad, 0, true);
    }

    /// @notice Pays out a settled option to its owner and frees the pool reservation. Anyone may call.
    function exercise(uint256 id) public nonReentrant {
        Option storage o = _options[id];
        if (o.owner == address(0)) revert UnknownOption();
        if (o.exercised) revert AlreadyExercised();
        if (settlementPrice[o.marketId][o.expiry] == 0) revert NotSettled();

        uint256 payout = payoutOf(id);
        o.exercised = true;
        openNotional[o.marketId] -= o.maxPayout;
        if (payout > 0) pool.payOut(o.owner, payout);
        pool.release(o.maxPayout - payout);
        emit Exercised(id, o.owner, payout);
    }

    // --------------------------------------------------------------- admin

    function setMarket(uint256 marketId, Market calldata m) external onlyOwner {
        if (
            m.feed == address(0) || m.heartbeat == 0 || m.vol < 0.05e18 || m.vol > 5e18 || m.spreadBps > 2000
                || m.minPremiumBps > 500 || m.maxExpiry < 1 weeks || m.maxExpiry > 120 days
        ) revert BadParams();
        OracleLib.check(m.feed);
        markets[marketId] = m;
        emit MarketSet(marketId, m);
    }

    /// @notice Quick volatility update without resending the whole market.
    function setVol(uint256 marketId, uint64 vol) external onlyOwner {
        if (markets[marketId].feed == address(0) || vol < 0.05e18 || vol > 5e18) revert BadParams();
        markets[marketId].vol = vol;
        emit MarketSet(marketId, markets[marketId]);
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

    function setProtocolFeeBps(uint256 bps) external onlyOwner {
        if (bps > 300) revert BadParams();
        protocolFeeBps = bps;
        emit ProtocolFeeSet(bps);
    }
}
