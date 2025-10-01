import { calculateMarginRequired } from './marginCalculator.js';

const lotSize = 75; // NIFTY
const underlying = 17500;

const fmt = (x) => new Intl.NumberFormat('en-IN').format(Math.round(x));

function scenario(name, legs) {
  const m = calculateMarginRequired(legs, lotSize, underlying);
  console.log(`\n${name}`);
  console.log(`Margin ≈ ₹${fmt(m)}`);
}

// 1) Naked short call ATM
scenario('Naked Short Call 17500 CE (1 lot @ ₹100)', [
  { type: 'CE', action: 'S', strike: 17500, lots: 1, price: 100 }
]);

// 2) Naked short put ATM
scenario('Naked Short Put 17500 PE (1 lot @ ₹100)', [
  { type: 'PE', action: 'S', strike: 17500, lots: 1, price: 100 }
]);

// 3) Long call ATM
scenario('Long Call 17500 CE (1 lot @ ₹100)', [
  { type: 'CE', action: 'B', strike: 17500, lots: 1, price: 100 }
]);

// 4) Vertical call credit spread: Short 17500 CE, Long 17700 CE
scenario('Call Credit Spread: Short 17500 CE @ ₹100, Long 17700 CE @ ₹40', [
  { type: 'CE', action: 'S', strike: 17500, lots: 1, price: 100 },
  { type: 'CE', action: 'B', strike: 17700, lots: 1, price: 40 },
]);

// 5) Put Credit Spread: Short 17500 PE, Long 17300 PE
scenario('Put Credit Spread: Short 17500 PE @ ₹120, Long 17300 PE @ ₹50', [
  { type: 'PE', action: 'S', strike: 17500, lots: 1, price: 120 },
  { type: 'PE', action: 'B', strike: 17300, lots: 1, price: 50 },
]);

// 6) Iron Condor: Short 17500 CE/PE, Long 17700 CE / 17300 PE
scenario('Iron Condor (17500 short wings, 200 wide)', [
  { type: 'CE', action: 'S', strike: 17500, lots: 1, price: 100 },
  { type: 'CE', action: 'B', strike: 17700, lots: 1, price: 40 },
  { type: 'PE', action: 'S', strike: 17500, lots: 1, price: 120 },
  { type: 'PE', action: 'B', strike: 17300, lots: 1, price: 50 },
]);
