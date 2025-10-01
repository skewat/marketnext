export const calculateStrategyMetrics = (payoffsAtExpiry, totalInvestment) => {
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
  
  // Calculate max profit, max loss and POP
  let maxProfit = -Infinity;
  let maxLoss = Infinity;
  let profitablePoints = 0;
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
    if (totalValue > 0) {
      profitablePoints++;
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

  // Calculate Probability of Profit (POP)
  const totalPoints = sortedPayoffs.length;
  const pop = totalPoints > 0 ? (profitablePoints / totalPoints) * 100 : 0;

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