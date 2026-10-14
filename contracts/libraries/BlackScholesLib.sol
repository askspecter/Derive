// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FixedPointMathLib as F} from "solady/src/utils/FixedPointMathLib.sol";

/// @notice Black Scholes prices in 18 decimal fixed point, with a zero interest rate
/// (premiums and collateral are both in a dollar stablecoin).
library BlackScholesLib {
    int256 internal constant WAD = 1e18;
    uint256 internal constant YEAR = 365 days;

    // Abramowitz and Stegun 7.1.26 erf coefficients (max error 1.5e-7).
    int256 internal constant P = 327591100000000000; // 0.3275911
    int256 internal constant A1 = 254829592000000000; // 0.254829592
    int256 internal constant A2 = -284496736000000000; // -0.284496736
    int256 internal constant A3 = 1421413741000000000; // 1.421413741
    int256 internal constant A4 = -1453152027000000000; // -1.453152027
    int256 internal constant A5 = 1061405429000000000; // 1.061405429
    int256 internal constant INV_SQRT2 = 707106781186547524; // 1/sqrt(2)

    /// @notice Standard normal CDF of a WAD value.
    function normCdf(int256 x) internal pure returns (int256) {
        // N(x) = (1 + erf(x / sqrt 2)) / 2
        int256 z = F.sMulWad(x, INV_SQRT2);
        bool neg = z < 0;
        if (neg) z = -z;
        if (z > 6 * WAD) return neg ? int256(0) : WAD;
        int256 t = F.sDivWad(WAD, WAD + F.sMulWad(P, z));
        int256 poly = F.sMulWad(t, A1 + F.sMulWad(t, A2 + F.sMulWad(t, A3 + F.sMulWad(t, A4 + F.sMulWad(t, A5)))));
        int256 erf = WAD - F.sMulWad(poly, F.expWad(-F.sMulWad(z, z)));
        if (neg) erf = -erf;
        return (WAD + erf) / 2;
    }

    /// @param spot underlying price (WAD)
    /// @param strike strike price (WAD)
    /// @param secondsToExpiry time left in seconds
    /// @param vol annualised implied volatility (WAD, 0.6e18 = 60%)
    /// @return price of one option on one unit of the underlying (WAD)
    function price(bool isCall, uint256 spot, uint256 strike, uint256 secondsToExpiry, uint256 vol)
        internal
        pure
        returns (uint256)
    {
        uint256 intrinsic = isCall ? (spot > strike ? spot - strike : 0) : (strike > spot ? strike - spot : 0);
        if (secondsToExpiry == 0 || vol == 0) return intrinsic;

        uint256 t = (secondsToExpiry * 1e18) / YEAR;
        uint256 volSqrtT = F.mulWad(vol, F.sqrtWad(t));
        if (volSqrtT == 0) return intrinsic;

        int256 lnSK = F.lnWad(int256(F.divWad(spot, strike)));
        int256 halfVar = int256(F.mulWad(F.mulWad(vol, vol), t) / 2);
        int256 d1 = F.sDivWad(lnSK + halfVar, int256(volSqrtT));
        int256 d2 = d1 - int256(volSqrtT);

        int256 s = int256(spot);
        int256 k = int256(strike);
        int256 p = isCall
            ? F.sMulWad(s, normCdf(d1)) - F.sMulWad(k, normCdf(d2))
            : F.sMulWad(k, normCdf(-d2)) - F.sMulWad(s, normCdf(-d1));
        uint256 bs = p > 0 ? uint256(p) : 0;
        return bs > intrinsic ? bs : intrinsic;
    }
}
