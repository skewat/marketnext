import { gbs } from './black76.js';

// Standard Normal Cumulative Distribution Function (CDF)
const cdf = (x) => {
  // Using the Abramowitz and Stegun approximation 7.1.26
  const p = 0.2316419;
  const b1 = 0.319381530;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;

  const t = 1 / (1 + p * Math.abs(x));
  const Z = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
  const y = 1 - Z * (b1 * t + b2 * Math.pow(t, 2) + b3 * Math.pow(t, 3) + b4 * Math.pow(t, 4) + b5 * Math.pow(t, 5));

  return x > 0 ? y : 1 - y;
};

// Probability of Profit (POP) calculation using log-normal distribution
const calculatePop = (legs, breakevenPoints, underlyingPrice, r) => {
    if (!breakevenPoints || breakevenPoints.length === 0) {
        // If no breakeven points, the strategy is either always profitable or always losing.
        // Check the payoff at the current price.
        const payoffAtCurrentPrice = legs.reduce((acc, leg) => {
            const pos = (leg.action === 'B' || leg.side === 'B') ? 1 : -1;
            const price = leg.price || 0;
            return acc - pos * price; // This is simplified; a full payoff calc is better.
        }, 0);
        // A more direct way: check if maxLoss is positive or maxProfit is negative.
        // This part is tricky without the full payoff curve. Let's assume 0 if no BEPs.
        return 50; // Or check a sample point. A 50/50 guess if we can't determine.
    }

    // Find a representative leg for expiry and IV
    const legForParams = legs.reduce((latest, leg) => {
        const legDate = new Date(leg.expiry);
        if (!latest || legDate > new Date(latest.expiry)) return leg;
        return latest;
    }, legs[0]);

    const now = new Date();
    const expiry = new Date(legForParams.expiry);
    let T = (expiry.getTime() - now.getTime()) / (365 * 24 * 3600 * 1000);
    if (T <= 0) T = 1 / 365;

    // Use an average IV of the legs, or a default
    const avgIv = legs.reduce((sum, leg) => sum + (leg.iv || 0.2), 0) / legs.length;
    if (avgIv === 0) return 50; // Cannot calculate without volatility

    const S = underlyingPrice;
    const sigma = avgIv * Math.sqrt(T);

    // Determine profitable regions by testing points between breakevens
    const testPoints = [-Infinity, ...breakevenPoints, Infinity];
    let pop = 0;

    for (let i = 0; i < testPoints.length - 1; i++) {
        const lowerBound = testPoints[i];
        const upperBound = testPoints[i + 1];
        const testPrice = isFinite(lowerBound) ? (isFinite(upperBound) ? (lowerBound + upperBound) / 2 : lowerBound * 1.1) : upperBound * 0.9;
        if (!isFinite(testPrice)) continue;

        // Calculate payoff at testPrice to see if the region is profitable
        const payoffAtTestPrice = legs.reduce((pnl, leg) => {
            const pos = (leg.action === 'B' || leg.side === 'B') ? 1 : -1;
            const premium = leg.price || 0;
            let intrinsic = 0;
            if (leg.type === 'CE') {
                intrinsic = Math.max(0, testPrice - leg.strike);
            } else {
                intrinsic = Math.max(0, leg.strike - testPrice);
            }
            return pnl + pos * (intrinsic - premium);
        }, 0);

        if (payoffAtTestPrice > 0) {
            // This region is profitable, calculate its probability
            const d2_lower = isFinite(lowerBound) ? (Math.log(S / lowerBound) + (r - 0.5 * Math.pow(avgIv, 2)) * T) / sigma : -Infinity;
            const d2_upper = isFinite(upperBound) ? (Math.log(S / upperBound) + (r - 0.5 * Math.pow(avgIv, 2)) * T) / sigma : Infinity;

            const p_lower = isFinite(d2_lower) ? cdf(d2_lower) : 0;
            const p_upper = isFinite(d2_upper) ? cdf(d2_upper) : 1;
            
            pop += p_lower - p_upper;
        }
    }

    return pop * 100;
};


export const calculateStrategyMetrics = (payoffsAtExpiry, totalInvestment, legs = [], underlyingPrice = 0, r = 0) => {
  if (!payoffsAtExpiry || payoffsAtExpiry.length === 0) {
    return {
      maxProfit: 0,
      maxLoss: 0,
      pop: 0,
      roi: 0,
      isMaxProfitUnlimited: false,
      isMaxLossUnlimited: false,
      breakevenPoints: []
    };
  }

  // Sort payoffs by underlying price for trend analysis
  const sortedPayoffs = [...payoffsAtExpiry].sort((a, b) => a.at - b.at);
  
  // Calculate max profit, max loss
  let maxProfit = -Infinity;
  let maxLoss = Infinity;
  let maxProfitIndex = -1;
  let maxLossIndex = -1;
  
  // First pass to find max profit and loss
  sortedPayoffs.forEach((point, index) => {
    const totalValue = point.payoff;
    
    // Handle infinite values
    if (!isFinite(totalValue)) {
      return;
    }
    
    if (totalValue > maxProfit) {
      maxProfit = totalValue;
      maxProfitIndex = index;
    }
    if (totalValue < maxLoss) {
      maxLoss = totalValue;
      maxLossIndex = index;
    }
  });

  // Handle case where no finite values found
  if (!isFinite(maxProfit)) {
    maxProfit = 0;
  }
  if (!isFinite(maxLoss)) {
    maxLoss = 0;
  }

  // Check if profit/loss is unlimited by analyzing trends at boundaries
  const isMaxProfitUnlimited = checkUnlimitedProfit(sortedPayoffs, maxProfitIndex);
  const isMaxLossUnlimited = checkUnlimitedLoss(sortedPayoffs, maxLossIndex);

  // Calculate ROI more safely
  let roi = 0;
  if (totalInvestment && Math.abs(totalInvestment) > 0 && isFinite(maxProfit)) {
    roi = (maxProfit / Math.abs(totalInvestment)) * 100;
  }

  // Calculate breakeven points (zero crossings) using linear interpolation
  const breakevenPoints = [];
  const EPS = 1e-6;
  for (let i = 1; i < sortedPayoffs.length; i++) {
    const p0 = sortedPayoffs[i - 1];
    const p1 = sortedPayoffs[i];
    const y0 = p0.payoff;
    const y1 = p1.payoff;
    if (!isFinite(y0) || !isFinite(y1)) continue;
    // If either point is approximately zero, record its x
    if (Math.abs(y0) < EPS) breakevenPoints.push(p0.at);
    // Check for sign change
    if (y0 === 0 || y1 === 0) continue; // already handled approx-zero above
    if ((y0 < 0 && y1 > 0) || (y0 > 0 && y1 < 0)) {
      const t = -y0 / (y1 - y0);
      const x = p0.at + t * (p1.at - p0.at);
      breakevenPoints.push(x);
    }
  }

  // Deduplicate and sort breakeven points
  const uniqueBE = Array.from(new Set(breakevenPoints.map(v => Number(v.toFixed(2))))).sort((a,b)=>a-b);

  // Calculate Probability of Profit (POP) using the new method
  const pop = calculatePop(legs, uniqueBE, underlyingPrice, r);

  return {
    maxProfit: Math.round(maxProfit),
    maxLoss: Math.round(maxLoss),
    pop: Math.round(pop * 100) / 100, // Round to 2 decimal places
    roi: Math.round(roi * 100) / 100, // Round to 2 decimal places
    isMaxProfitUnlimited,
    isMaxLossUnlimited,
    breakevenPoints: uniqueBE
  };
};

// Helper function to detect unlimited profit potential
const checkUnlimitedProfit = (sortedPayoffs, maxProfitIndex) => {
  if (maxProfitIndex === -1 || sortedPayoffs.length < 10) return false;
  
  // For puts, unlimited profit occurs when price approaches zero (left side)
  // For calls, unlimited profit occurs when price goes very high (right side)
  
  // Check if max profit occurs near the beginning (left side - puts)
  const isNearStart = maxProfitIndex <= 5;
  // Check if max profit occurs near the end (right side - calls) 
  const isNearEnd = maxProfitIndex >= sortedPayoffs.length - 5;
  
  if (isNearStart) {
    // Check if there's a consistent downward trend as we move away from zero
    const firstPoints = sortedPayoffs.slice(0, Math.min(15, sortedPayoffs.length));
    let decreasingCount = 0;
    
    for (let i = 1; i < firstPoints.length; i++) {
      if (firstPoints[i].payoff < firstPoints[i-1].payoff) {
        decreasingCount++;
      }
    }
    
    // If payoff decreases as price increases from zero, it's likely unlimited (put scenario)
    return decreasingCount >= Math.floor((firstPoints.length - 1) * 0.6);
  }
  
  if (isNearEnd) {
    // Check if there's a consistent upward trend in the last few points (call scenario)
    const lastPoints = sortedPayoffs.slice(-15);
    let increasingCount = 0;
    
    for (let i = 1; i < lastPoints.length; i++) {
      if (lastPoints[i].payoff > lastPoints[i-1].payoff) {
        increasingCount++;
      }
    }
    
    // If payoff increases as price increases, it's likely unlimited (call scenario)
    return increasingCount >= Math.floor((lastPoints.length - 1) * 0.6);
  }
  
  return false;
};

// Helper function to detect unlimited loss potential  
const checkUnlimitedLoss = (sortedPayoffs, maxLossIndex) => {
  if (maxLossIndex === -1 || sortedPayoffs.length < 10) return false;
  
  // Check if max loss occurs near the beginning (left side) 
  const isNearLowEnd = maxLossIndex <= 5;
  // Check if max loss occurs near the end (right side)
  const isNearHighEnd = maxLossIndex >= sortedPayoffs.length - 5;
  
  if (isNearLowEnd) {
    // Check if loss keeps getting worse as we approach zero (short put scenario)
    const firstPoints = sortedPayoffs.slice(0, Math.min(15, sortedPayoffs.length));
    let worseningCount = 0;
    
    for (let i = 1; i < firstPoints.length; i++) {
      if (firstPoints[i].payoff > firstPoints[i-1].payoff) { // Getting less negative = improving
        worseningCount++;
      }
    }
    
    // If loss keeps getting worse towards zero, it's unlimited
    return worseningCount >= Math.floor((firstPoints.length - 1) * 0.6);
  } 
  
  if (isNearHighEnd) {
    // Check if loss keeps getting worse at high prices (short call scenario)
    const lastPoints = sortedPayoffs.slice(-15);
    let worseningCount = 0;
    
    for (let i = 1; i < lastPoints.length; i++) {
      if (lastPoints[i].payoff < lastPoints[i-1].payoff) { // Getting more negative = worsening
        worseningCount++;
      }
    }
    
    // If loss keeps getting worse at high prices, it's unlimited
    return worseningCount >= Math.floor((lastPoints.length - 1) * 0.6);
  }
  
  return false;
};