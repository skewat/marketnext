import { gbs } from "./black76.js";

// Scenario-based margin calculator using Black-76 style pricing (GBS helper)
// Returns a numeric margin (rounded) compatible with existing callers.
export const calculateMarginRequired = (optionLegs, lotSize = 75, underlyingPrice, opts = {}) => {
    if (!optionLegs || optionLegs.length === 0) return 0;

    const r = typeof opts.r === 'number' ? opts.r : 0; // risk-free
    const spot = underlyingPrice || opts.spot || 0;
    const lot = lotSize || 75;

    const spotMoves = opts.spotMoves || [-0.3, -0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2, 0.3];
    const volShifts = opts.volShifts || [-0.2, 0, 0.2];
    const exposurePct = typeof opts.exposurePct === 'number' ? opts.exposurePct : 0.03;

    // Current portfolio value (mark-to-market based on provided leg.price)
    const currentValue = optionLegs.reduce((acc, leg) => {
        const pos = leg.action === 'B' ? +1 : -1; // Buy = +1, Sell = -1
        const price = leg.price || 0;
        const lots = leg.lots || 1;
        return acc + pos * price * lot * lots;
    }, 0);

    // Build scenarios and evaluate
    let worstPnL = 0; // most negative PnL observed

    for (const move of spotMoves) {
        for (const vshift of volShifts) {
            const scenarioSpot = spot * (1 + move);
            let value = 0;

            for (const leg of optionLegs) {
                const pos = leg.action === 'B' ? +1 : -1;
                const lots = leg.lots || 1;
                // Time to expiry in years (clip to minimum 1 day)
                const now = new Date();
                const expiry = leg.expiry ? new Date(leg.expiry) : now;
                let T = (expiry.getTime() - now.getTime()) / (365 * 24 * 3600 * 1000);
                if (T <= 0) T = 1 / 365; // at least one day

                const F = scenarioSpot * Math.exp(r * T);
                const iv = (typeof leg.iv === 'number' ? leg.iv : 0.2) * (1 + vshift);
                const optType = leg.type === 'CE' ? 'c' : 'p';

                // Use gbs to get theoretical price
                let price = 0;
                try {
                    const res = gbs(optType, F, leg.strike, T, r, 0, iv);
                    price = Array.isArray(res) ? res[0] : res;
                    if (!isFinite(price) || price === null) price = 0;
                } catch (e) {
                    // On any model error, fall back to intrinsic
                    if (optType === 'c') {
                        price = Math.max(F - leg.strike, 0);
                    } else {
                        price = Math.max(leg.strike - F, 0);
                    }
                }

                value += pos * price * lot * lots;
            }

            const pnl = value - currentValue;
            if (pnl < worstPnL) worstPnL = pnl;
        }
    }

    const spanMargin = -worstPnL; // worst loss as positive number

    // Exposure margin as % of gross short premium
    const grossShortPremium = optionLegs.reduce((acc, leg) => {
        if (leg.action === 'S') {
            return acc + (leg.price || 0) * lot * (leg.lots || 1);
        }
        return acc;
    }, 0);

    const exposureMargin = exposurePct * grossShortPremium;

    const totalMargin = Math.max(spanMargin, exposureMargin);

    return Math.round(totalMargin || 0);
};

    // A detailed margin calculation that mirrors the user's helper signature:
    // calculateMargin(legs, market, params) -> { spanMargin, exposureMargin, totalMargin }
    export const calculateMargin = (legs, market = {}, params = {}) => {
        const lotSize = params.lotSize || 75;
        const r = typeof params.r === 'number' ? params.r : 0;
        const spot = (market && market.spot) || params.spot || 0;

        const spotMoves = params.spotMoves || [-0.3, -0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2, 0.3];
        const volShifts = params.volShifts || [-0.2, 0, 0.2];
        const exposurePct = typeof params.exposurePct === 'number' ? params.exposurePct : 0.03;

        // Current portfolio value (per their code: buy=+1, sell=-1)
        const currentValue = (legs || []).reduce((acc, leg) => {
            const pos = (leg.side === 'B' || leg.action === 'B') ? +1 : -1;
            const price = leg.price || 0;
            const lots = leg.lots || 1;
            return acc + pos * price * lotSize * lots;
        }, 0);

        let worstPnL = 0;

        for (const move of spotMoves) {
            for (const vshift of volShifts) {
                const scenarioSpot = spot * (1 + move);
                let value = 0;

                for (const leg of legs) {
                    const pos = (leg.side === 'B' || leg.action === 'B') ? +1 : -1;
                    const lots = leg.lots || 1;
                    const now = new Date();
                    const expiry = leg.expiry ? new Date(leg.expiry) : now;
                    let T = (expiry.getTime() - now.getTime()) / (365 * 24 * 3600 * 1000);
                    if (T <= 0) T = 1 / 365;

                    const F = scenarioSpot * Math.exp(r * T);
                    const iv = (typeof leg.iv === 'number' ? leg.iv : 0.2) * (1 + vshift);
                    const optType = leg.type === 'CE' ? 'c' : 'p';

                    let theoPrice = 0;
                    try {
                        const res = gbs(optType, F, leg.strike, T, r, 0, iv);
                        theoPrice = Array.isArray(res) ? res[0] : res;
                        if (!isFinite(theoPrice) || theoPrice === null) theoPrice = 0;
                    } catch (e) {
                        if (optType === 'c') theoPrice = Math.max(F - leg.strike, 0);
                        else theoPrice = Math.max(leg.strike - F, 0);
                    }

                    value += pos * theoPrice * lotSize * lots;
                }

                const pnl = value - currentValue;
                if (pnl < worstPnL) worstPnL = pnl;
            }
        }

        const spanMargin = -worstPnL;

        const grossShortPremium = (legs || []).reduce((acc, leg) => {
            const isShort = (leg.side === 'S' || leg.action === 'S');
            if (isShort) return acc + (leg.price || 0) * lotSize * (leg.lots || 1);
            return acc;
        }, 0);

        const exposureMargin = exposurePct * grossShortPremium;
        const totalMargin = Math.max(spanMargin, exposureMargin);

        return {
            spanMargin: Math.round(spanMargin),
            exposureMargin: Math.round(exposureMargin),
            totalMargin: Math.round(totalMargin)
        };
    };

    // Keep existing calculateMarginRequired compatible: call calculateMargin with defaults
    export const calculateMarginRequiredFromLegs = (legs, lotSize = 75, underlyingPrice) => {
        const details = calculateMargin(legs, { spot: underlyingPrice }, { lotSize });
        return details.totalMargin;
    };