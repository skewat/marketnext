#!/usr/bin/env node
import axios from 'axios';

// Example:
// node openalgoBasketCli.mjs --base http://127.0.0.1:5000 --apikey KEY --orders '[{"symbol":"RELIANCE","exchange":"NSE","action":"BUY","quantity":1,"pricetype":"MARKET","product":"MIS"}]'
// or using legs:
// node openalgoBasketCli.mjs --base http://127.0.0.1:5000 --apikey KEY --underlying NIFTY --legs '[{"action":"BUY","type":"CE","strike":20800,"expiry":"28-MAR-2024","quantity":50}]'

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  return undefined;
};

const baseArg = getArg('base') || 'http://127.0.0.1:5000';
const apiKeyArg = getArg('apikey') || getArg('apiKey');
const strategyArg = getArg('strategy') || 'NodeJS';
const ordersArg = getArg('orders');
const legsArg = getArg('legs');
const underlyingArg = getArg('underlying');
const exchangeArg = getArg('exchange') || 'NSE';
const productArg = getArg('product') || 'MIS';
const pricetypeArg = getArg('pricetype') || 'MARKET';

if (!apiKeyArg) {
  console.error('Missing --apikey');
  process.exit(2);
}

let orders = null;
if (ordersArg) {
  try { orders = JSON.parse(ordersArg); } catch { console.error('Invalid --orders JSON'); process.exit(2); }
}
let legs = null;
if (legsArg) {
  try { legs = JSON.parse(legsArg); } catch { console.error('Invalid --legs JSON'); process.exit(2); }
}

const url = `${baseArg.replace(/\/$/,'')}/api/v1/basketorder`;
const payload = orders ? { apikey: apiKeyArg, strategy: strategyArg, orders } : { apikey: apiKeyArg, strategy: strategyArg, exchange: exchangeArg, product: productArg, pricetype: pricetypeArg, underlying: underlyingArg, legs };

console.log('POST', url);
console.log('Payload:', JSON.stringify(payload, null, 2));

try {
  const res = await axios.post(url, payload, { validateStatus: () => true });
  console.log('Status:', res.status);
  console.log('Body:', typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2));
  process.exit(res.status >= 200 && res.status < 300 ? 0 : 1);
} catch (e) {
  console.error('Request failed:', e?.message || e);
  process.exit(1);
}
