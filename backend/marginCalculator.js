// Calculates an approximate margin for option positions when risk is unlimited.
// Approach:
// - Long options: margin = premium paid (debit)
// - Short options: VAR + Exposure approximation using underlying price basis
//     VAR = max(20% * S - OTM, 10% * S)
//     Exposure = 3% * S
// - Portfolio stress test: evaluate expiry P&L at S moves of -30%, -20%, +20%, +30%
// - Return the maximum of (sum(VAR+Exposure) for shorts) and (worst stress-test loss)
export const calculateMarginRequired = (optionLegs, lotSize, underlyingPrice) => {
    if (!optionLegs || optionLegs.length === 0 || !underlyingPrice) return 0;

    const S = Math.max(underlyingPrice, 1); // avoid zero/negative

    // Helper to get OTM amount for a leg at current S
    const getOTM = (type, strike, spot) => {
        if (type === "CE") return Math.max(0, strike - spot);
        return Math.max(0, spot - strike); // PE
    };

    // Approximate VAR + Exposure for a single short leg
    const shortLegMargin = (leg) => {
        const { type, strike, lots = 1 } = leg;
        const otm = getOTM(type, strike, S);
        const varMargin = Math.max(0.20 * S - otm, 0.10 * S);
        const exposure = 0.03 * S;
        const perLot = (varMargin + exposure) * lotSize;
        return perLot * lots;
    };

    // Premium cashflow per leg (positive if received, negative if paid)
    const premiumCash = (leg) => {
        const { price = 0, lots = 1, action } = leg;
        const sign = action === "S" ? 1 : -1;
        return price * lots * lotSize * sign;
    };

    // Expiry intrinsic P&L for a leg at spot Sx (including premium cashflow)
    const legExpiryPnLAt = (leg, Sx) => {
        const { type, action, strike, lots = 1, price = 0 } = leg;
        const qty = lots * lotSize;
        let intrinsic = 0;
        if (type === "CE") {
            intrinsic = Math.max(Sx - strike, 0) * qty;
        } else { // PE
            intrinsic = Math.max(strike - Sx, 0) * qty;
        }
        // For long: PnL = intrinsic - premium; For short: PnL = premium - intrinsic
        const prem = price * qty;
        return action === "B" ? (intrinsic - prem) : (prem - intrinsic);
    };

    // Sum of VAR+Exposure for all short legs, and premium for long legs
    let varExposureSum = 0;
    let longPremiumSum = 0; // debit for long options
    for (const leg of optionLegs) {
        if (leg.action === "S") {
            varExposureSum += shortLegMargin(leg);
        } else {
            longPremiumSum += Math.max(0, -premiumCash(leg)); // positive debit
        }
    }

    // Portfolio stress test at expiry
    const stressMultipliers = [0.7, 0.8, 1.2, 1.3];
    let worstStressLoss = 0;
    for (const m of stressMultipliers) {
        const Sx = Math.max(1, S * m);
        let pnl = 0;
        for (const leg of optionLegs) {
            pnl += legExpiryPnLAt(leg, Sx);
        }
        // Track the worst negative PnL across stress scenarios
        worstStressLoss = Math.max(worstStressLoss, Math.max(0, -pnl));
    }

    // Combine: ensure margin at least covers long debits and stress scenario
    const approxMargin = Math.max(varExposureSum, worstStressLoss, longPremiumSum);
    return Math.round(approxMargin);
};