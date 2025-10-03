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
const strategyNotesDir = path.resolve(dataRoot, 'strategy-notes');
const NOTE_MAX_LENGTH = 1000;
const ensureDir = (dir)=>{ if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); };
ensureDir(dataRoot);
ensureDir(oiCacheDir);
ensureDir(strategyNotesDir);

// JSON file storage for strategies and positions
const strategiesFile = path.join(dataRoot, 'strategies.json');
const positionsFile = path.join(dataRoot, 'positions.json');
const openAlgoConfigFile = path.join(dataRoot, 'openalgo.json');
const safeName = (name) => String(name).replace(/[^a-zA-Z0-9_\-\. ]+/g, '_').trim();
const notePath = (underlying, name) => path.join(strategyNotesDir, String(underlying).toUpperCase(), `${safeName(name)}.txt`);
const readJson = (file, fallback) => {
  try { if (!fs.existsSync(file)) return fallback; const t = fs.readFileSync(file, 'utf8'); return JSON.parse(t); } catch { return fallback; }
};
const writeJson = (file, data) => { try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch {} };

// Normalize exit object to enforce backend semantics
const normalizeExit = (exit) => {
  const toPosStr = (v) => {
    const n = typeof v === 'string' ? parseFloat(v) : (typeof v === 'number' ? v : NaN);
    return Number.isFinite(n) && n > 0 ? String(n) : '0';
  };
  const mode = exit?.mode === 'stopLossAbs' || exit?.mode === 'stopLossPct' ? exit.mode : 'onExpiry';
  const profitTargetPct = toPosStr(exit?.profitTargetPct);
  if (mode === 'onExpiry') {
    return {
      mode,
      stopLossPct: '0',
      stopLossAbs: '0',
      profitTargetPct,
      trailingEnabled: false,
    };
  }
  if (mode === 'stopLossPct') {
    return {
      mode,
      stopLossPct: toPosStr(exit?.stopLossPct),
      stopLossAbs: '0',
      profitTargetPct,
      trailingEnabled: !!exit?.trailingEnabled,
    };
  }
  // mode === 'stopLossAbs'
  return {
    mode,
    stopLossPct: '0',
    stopLossAbs: toPosStr(exit?.stopLossAbs),
    profitTargetPct,
    trailingEnabled: !!exit?.trailingEnabled,
  };
};

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
  // Create a note file for the strategy if it does not exist yet
  try {
    const dir = path.dirname(notePath(underlying, name));
    ensureDir(dir);
    const p = notePath(underlying, name);
    if (!fs.existsSync(p)) {
      const template = `Strategy: ${name}\nUnderlying: ${underlying}\nUpdated: ${new Date().toISOString()}\n\nWhen things go against:\n- Describe adjustments to consider (roll strikes, reduce lots, hedge, exit)\n- Define thresholds (IV spike, delta, underlying move)\n- Contingency plan\n`;
      const trimmed = template.slice(0, NOTE_MAX_LENGTH);
      fs.writeFileSync(p, trimmed, 'utf8');
    }
  } catch {}
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
  const now = Date.now();
  const createdAt = typeof pos.createdAt === 'number' ? pos.createdAt : now;
  const entryAt = typeof pos.entryAt === 'number' ? pos.entryAt : createdAt;
  const status = pos.status === 'closed' || pos.status === 'scheduled' ? pos.status : 'open';
  const withId = { 
    ...pos, 
    id, 
    status,
    createdAt,
    entryAt,
    updatedAt: now,
    exitAt: typeof pos.exitAt === 'number' ? pos.exitAt : (status === 'closed' ? now : undefined),
    exit: normalizeExit(pos.exit)
  };
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
  const prev = list[idx];
  const merged = { ...prev, ...patch };
  // timestamps
  const now = Date.now();
  merged.updatedAt = now;
  if (merged.status === 'closed' && !merged.exitAt) {
    merged.exitAt = now;
  }
  if (!merged.createdAt) merged.createdAt = prev.createdAt || now;
  if (!merged.entryAt) merged.entryAt = prev.entryAt || merged.createdAt;
  merged.exit = normalizeExit(merged.exit);
  list[idx] = merged;
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

// Strategy note API (read-only)
// GET /strategy-note?underlying=...&name=...
app.get('/strategy-note', (req, res) => {
  const { underlying, name } = req.query;
  if (!underlying || !name) return res.status(400).json({ error: 'underlying and name required' });
  const p = notePath(underlying, name);
  try {
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'note not found' });
    const raw = fs.readFileSync(p, 'utf8');
    const content = raw.slice(0, NOTE_MAX_LENGTH);
    const truncated = raw.length > NOTE_MAX_LENGTH;
    return res.status(200).json({ content, truncated, length: content.length }).end();
  } catch (e) {
    return res.status(500).json({ error: 'failed to read note' });
  }
});

// PATCH /strategy-note (create or update)
// body: { underlying, name, content }
app.patch('/strategy-note', (req, res) => {
  const { underlying, name, content } = req.body || {};
  if (!underlying || !name || typeof content !== 'string') return res.status(400).json({ error: 'underlying, name, content required' });
  try {
    const p = notePath(underlying, name);
    ensureDir(path.dirname(p));
    const str = String(content);
    const trimmed = str.length > NOTE_MAX_LENGTH ? str.slice(0, NOTE_MAX_LENGTH) : str;
    fs.writeFileSync(p, trimmed, 'utf8');
    return res.status(200).json({ ok: true, truncated: trimmed.length < str.length, length: trimmed.length });
  } catch (e) {
    return res.status(500).json({ error: 'failed to write note' });
  }
});

// OpenAlgo config API (persist API key)
// GET /openalgo-config -> { apiKey?: string }
app.get('/openalgo-config', (req, res) => {
  try {
    const cfg = readJson(openAlgoConfigFile, {});
    return res.status(200).json({ apiKey: cfg.apiKey || '' });
  } catch (e) {
    return res.status(500).json({ error: 'failed to read config' });
  }
});

// PATCH /openalgo-config { apiKey }
app.patch('/openalgo-config', (req, res) => {
  const { apiKey } = req.body || {};
  if (typeof apiKey !== 'string') return res.status(400).json({ error: 'apiKey (string) required' });
  try {
    writeJson(openAlgoConfigFile, { apiKey });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'failed to write config' });
  }
});

// POST /openalgo/funds { host?: string, apiKey?: string }
app.post('/openalgo/funds', async (req, res) => {
  const { host, apiKey } = req.body || {};
  const cfg = readJson(openAlgoConfigFile, {});
  const key = (typeof apiKey === 'string' && apiKey) ? apiKey : (cfg.apiKey || '');
  const base = (typeof host === 'string' && host) ? host : 'http://127.0.0.1:5000';
  const url = String(base).replace(/\/$/, '') + '/funds';
  if (!key) return res.status(400).json({ error: 'apiKey required' });
  const headers = { 'X-API-KEY': key };
  const started = Date.now();
  try {
    const axiosRes = await axios.get(url, { headers, validateStatus: () => true });
    const ms = Date.now() - started;
    const rawBody = typeof axiosRes.data === 'string' ? axiosRes.data : JSON.stringify(axiosRes.data);
    let parsed = null;
    try { parsed = typeof axiosRes.data === 'string' ? JSON.parse(axiosRes.data) : axiosRes.data; } catch {}
    const MAX_RAW = 10000;
    const u = new URL(url);
    const pathWithQuery = u.pathname + u.search;
    const hostHeader = u.host;
    const maskedKey = key.length <= 5 ? '*'.repeat(key.length) : key.slice(0,3) + '***' + key.slice(-2);
    const requestRaw = [`GET ${pathWithQuery} HTTP/1.1`, `Host: ${hostHeader}`, `X-API-KEY: ${maskedKey}`, '', ''].join('\n');
    const statusLine = `HTTP/1.1 ${axiosRes.status}`;
    const respHeaderLines = Object.entries(axiosRes.headers || {}).map(([k,v])=>`${k}: ${String(v)}`);
    const clippedBody = rawBody.length > MAX_RAW ? rawBody.slice(0, MAX_RAW) + `\n…(${rawBody.length - MAX_RAW} more bytes)` : rawBody;
    const responseRaw = [statusLine, ...respHeaderLines, '', clippedBody].join('\n');
    return res.status(200).json({
      ok: true,
      data: parsed ?? rawBody,
      debug: {
        durationMs: ms,
        request: { method: 'GET', url, headers: { 'Host': hostHeader, 'X-API-KEY': maskedKey } },
        response: { status: axiosRes.status, headers: axiosRes.headers },
        requestRaw,
        responseRaw,
      }
    });
  } catch (e) {
    const u = new URL(url);
    const pathWithQuery = u.pathname + u.search;
    const hostHeader = u.host;
    const maskedKey = key.length <= 5 ? '*'.repeat(key.length) : key.slice(0,3) + '***' + key.slice(-2);
    const requestRaw = [`GET ${pathWithQuery} HTTP/1.1`, `Host: ${hostHeader}`, `X-API-KEY: ${maskedKey}`, '', ''].join('\n');
    const responseRaw = [`HTTP/1.1 0 Network Error`, '', String(e?.message || 'Failed to connect')].join('\n');
    return res.status(502).json({ error: 'failed to fetch funds', debug: { requestRaw, responseRaw } });
  }
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
