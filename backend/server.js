import express from 'express';
import axios from 'axios';
import UserAgent from 'user-agents';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { formatData, getPayoffData } from './utils.js';
import authRouter from './auth.js';

const baseURL = 'https://www.nseindia.com/';

const getOptionsWithUserAgent = () => {
  const userAgent = new UserAgent();
  return {
    headers: {
      "Accept": "*/*",
      "User-Agent": userAgent.toString(),
      "Connection": "keep-alive",
    },
    withCredentials: true,
  };
};

const app = express();
app.use(express.json());
app.use(express.urlencoded({extended: true}));
// Auth routes
app.use('/auth', authRouter);
// File cache: Data/oi-cache at repo root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const dataRoot = path.resolve(repoRoot, 'Data');
const oiCacheDir = path.resolve(dataRoot, 'oi-cache');
const ensureDir = (dir)=>{ if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); };
ensureDir(dataRoot);
ensureDir(oiCacheDir);

// JSON file storage for strategies and positions
const strategiesFile = path.join(dataRoot, 'strategies.json');
const positionsFile = path.join(dataRoot, 'positions.json');
const readJson = (file, fallback) => {
  try { if (!fs.existsSync(file)) return fallback; const t = fs.readFileSync(file, 'utf8'); return JSON.parse(t); } catch { return fallback; }
};
const writeJson = (file, data) => { try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch {} };

const CACHE_TTL_MS = 60 * 1000; // 1 minute default; can align with polling cadence
const cachePath = (identifier) => path.join(oiCacheDir, `${identifier.toUpperCase().replace(/[^A-Z0-9_-]/gi,'_')}.json`);
const readCache = (identifier) => {
  try {
    const p = cachePath(identifier);
    if (!fs.existsSync(p)) return null;
    const stat = fs.statSync(p);
    const age = Date.now() - stat.mtimeMs;
    if (age > CACHE_TTL_MS) return null;
    const txt = fs.readFileSync(p, 'utf8');
    return JSON.parse(txt);
  } catch { return null; }
};
const writeCache = (identifier, data) => {
  try { fs.writeFileSync(cachePath(identifier), JSON.stringify(data)); } catch {}
};

const MAX_RETRY_COUNT = 3;

const getOptionChainWithRetry = async (cookie, identifier, retryCount = 0) => {
  const isIndex = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"].includes(identifier);
  const apiEndpoint = "api/option-chain-" + (isIndex ? "indices" : "equities");
  const options = getOptionsWithUserAgent();
  try {
    const url = baseURL + apiEndpoint + "?symbol=" + encodeURIComponent(identifier);
    const response = await axios.get(url, { ...options, headers: { ...options.headers, Cookie: cookie } });
    const formattedData = formatData(response.data, identifier);
    return formattedData;

  } catch (error) {
    console.error(`Error fetching option chain. Retry count: ${retryCount}`, error);
    if (retryCount < MAX_RETRY_COUNT) {
      return getOptionChainWithRetry(cookie, identifier, retryCount + 1);
    } else {
      throw new Error('Failed to fetch option chain after multiple retries');
    };
  };
};

const getCookies = async () => {
  const options = getOptionsWithUserAgent();
  try {
    const response = await axios.get(baseURL + "option-chain", options);
    const cookie = response.headers['set-cookie'];
    return cookie;
  } catch (error) {
    console.error('Error fetching cookies:');
    throw new Error('Failed to fetch cookies');
  };
};

app.get('/open-interest', async (req, res) => {
  const now = new Date();
  const time = now.getHours() + ":" + now.getMinutes() + ":" + now.getSeconds();
  console.log(`Request received at ${time}`);

  const { identifier } = req.query;

  if (!identifier) {
    res.status(400).json({ error: 'Invalid request. No identifier was given.' });
    return;
  };

  try {
    // Serve from cache if fresh unless nocache=1
    if (req.query.nocache !== '1') {
      const cached = readCache(identifier);
      if (cached) {
        return res.status(200).json(cached).end();
      }
    }
    const cookie = await getCookies();
    const data = await getOptionChainWithRetry(cookie, identifier.toUpperCase());
    // Write to cache
    writeCache(identifier, data);
    res.json(data).status(200).end();
  } catch (error) {
    console.error('Proxy request error: here', error);
    res.status(500).json({ error: 'Proxy request failed.' });
  };
});

// Strategies API
// GET /strategies?underlying=... (optional) => grouped object or underlying map
app.get('/strategies', (req, res) => {
  const data = readJson(strategiesFile, {});
  const { underlying } = req.query;
  if (underlying) return res.status(200).json(data[underlying] || {}).end();
  return res.status(200).json(data).end();
});

// POST /strategies  { underlying, name, strategy }
app.post('/strategies', (req, res) => {
  const { underlying, name, strategy } = req.body || {};
  if (!underlying || !name || !strategy) return res.status(400).json({ error: 'underlying, name, strategy required' });
  const root = readJson(strategiesFile, {});
  if (!root[underlying]) root[underlying] = {};
  const existing = root[underlying][name] || {};
  // Only backend decides meta; preserve existing if present, default type to 'user'
  const type = existing.type || 'user';
  const creator = existing.creator || strategy.creator || undefined; // optional; if provided earlier, keep
  root[underlying][name] = { ...strategy, type, ...(creator ? { creator } : {}) };
  writeJson(strategiesFile, root);
  res.status(200).json({ ok: true }).end();
});

// DELETE /strategies?underlying=...&name=...
app.delete('/strategies', (req, res) => {
  const { underlying, name } = req.query;
  if (!underlying || !name) return res.status(400).json({ error: 'underlying and name required' });
  const root = readJson(strategiesFile, {});
  const strat = root[underlying]?.[name];
  if (!strat) return res.status(404).json({ error: 'not found' });
  if (strat.creator === 'admin' || strat.type === 'default') {
    return res.status(403).json({ error: 'protected strategy cannot be deleted' });
  }
  delete root[underlying][name];
  writeJson(strategiesFile, root);
  res.status(200).json({ ok: true }).end();
});

// PATCH meta for a strategy (backend-editable fields: type, creator)
app.patch('/strategies/meta', (req, res) => {
  const { underlying, name } = req.query;
  const { type, creator } = req.body || {};
  if (!underlying || !name) return res.status(400).json({ error: 'underlying and name required' });
  const root = readJson(strategiesFile, {});
  const strat = root[underlying]?.[name];
  if (!strat) return res.status(404).json({ error: 'not found' });
  if (type && !['user','default'].includes(type)) return res.status(400).json({ error: 'invalid type' });
  const updated = { ...strat, ...(type ? { type } : {}), ...(creator !== undefined ? { creator } : {}) };
  root[underlying][name] = updated;
  writeJson(strategiesFile, root);
  res.status(200).json(updated).end();
});

// Positions API
// GET /positions?underlying=... (optional) => list
app.get('/positions', (req, res) => {
  const list = readJson(positionsFile, []);
  const { underlying } = req.query;
  if (underlying) return res.status(200).json(list.filter(p => p.underlying === underlying)).end();
  return res.status(200).json(list).end();
});

// POST /positions  body: position (if id missing, create)
app.post('/positions', (req, res) => {
  const pos = req.body || {};
  if (!pos.underlying || !pos.expiry || !Array.isArray(pos.legs)) {
    return res.status(400).json({ error: 'invalid position payload' });
  }
  const list = readJson(positionsFile, []);
  const id = pos.id || `${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  const withId = { ...pos, id };
  list.push(withId);
  writeJson(positionsFile, list);
  res.status(200).json(withId).end();
});

// PATCH /positions/:id  body: partial fields
app.patch('/positions/:id', (req, res) => {
  const { id } = req.params;
  const patch = req.body || {};
  const list = readJson(positionsFile, []);
  const idx = list.findIndex(p => p.id === id);
  if (idx < 0) return res.status(404).json({ error: 'not found' });
  list[idx] = { ...list[idx], ...patch };
  writeJson(positionsFile, list);
  res.status(200).json(list[idx]).end();
});

// DELETE /positions/:id
app.delete('/positions/:id', (req, res) => {
  const { id } = req.params;
  const list = readJson(positionsFile, []);
  const next = list.filter(p => p.id !== id);
  writeJson(positionsFile, next);
  res.status(200).json({ ok: true }).end();
});

// Clear a cached identifier
app.delete('/open-interest-cache', (req, res) => {
  const { identifier } = req.query;
  if (!identifier) return res.status(400).json({ error: 'Invalid request. No identifier was given.' });
  try {
    const p = cachePath(identifier);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Cache clear error:', error);
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

app.post('/builder', async (req, res) => {
  const builderData = req.body;
  try {
    const payoff = getPayoffData(builderData);
    res.json(payoff).status(200).end();
  } catch (error) {
    console.error('Payoff calculation error:', error);
    res.status(500).json({ error: 'Payoff calculation failed.' });
  };
  
});

app.listen(6123, () => {
  console.log('Server running on port 6123');
});
