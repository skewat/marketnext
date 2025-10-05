#!/usr/bin/env node
import axios from 'axios';

// Usage: node openalgoFundsCli.mjs --host 127.0.0.1 --port 5000 --apikey YOUR_KEY
// Or: node openalgoFundsCli.mjs --base http://127.0.0.1:5000 --apikey YOUR_KEY
// Optional: --path /api/v1/funds (defaults to /api/v1/funds)

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  return undefined;
};

const baseArg = getArg('base');
const hostArg = getArg('host');
const portArg = getArg('port');
const apiKeyArg = getArg('apikey') || getArg('apiKey');
const pathArg = getArg('path') || '/api/v1/funds';

if (!apiKeyArg) {
  console.error('Missing --apikey');
  process.exit(2);
}

const base = (() => {
  if (baseArg) return baseArg.replace(/\/$/, '');
  const host = hostArg || '127.0.0.1';
  const port = Number.isFinite(parseInt(portArg, 10)) ? parseInt(portArg, 10) : 5000;
  return `http://${host}:${port}`;
})();

const url = `${base}${pathArg.startsWith('/') ? '' : '/'}${pathArg}`;

console.log(`POST ${url}`);

try {
  const res = await axios.post(url, { apikey: apiKeyArg }, { validateStatus: () => true });
  console.log(`Status: ${res.status}`);
  console.log('Response Headers:', res.headers);
  const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
  console.log('Body:');
  console.log(body);
  process.exit(res.status >= 200 && res.status < 300 ? 0 : 1);
} catch (e) {
  console.error('Request failed:', e?.message || e);
  process.exit(1);
}
