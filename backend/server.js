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
const logsRoot = path.resolve(repoRoot, 'logs');
const oiCacheDir = path.resolve(dataRoot, 'oi-cache');
const strategyNotesDir = path.resolve(dataRoot, 'strategy-notes');
const positionNotesDir = path.resolve(dataRoot, 'position-notes');
const NOTE_MAX_LENGTH = 1000;
const ensureDir = (dir)=>{ if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); };
ensureDir(dataRoot);
ensureDir(oiCacheDir);
ensureDir(strategyNotesDir);
ensureDir(positionNotesDir);
ensureDir(logsRoot);

// JSON file storage for strategies and positions
const strategiesFile = path.join(dataRoot, 'strategies.json');
const positionsFile = path.join(dataRoot, 'positions.json');
const openAlgoConfigFile = path.join(dataRoot, 'openalgo.json');
const safeName = (name) => String(name).replace(/[^a-zA-Z0-9_\-\. ]+/g, '_').trim();
const notePath = (underlying, name) => path.join(strategyNotesDir, String(underlying).toUpperCase(), `${safeName(name)}.txt`);
const posNotePath = (positionId) => path.join(positionNotesDir, `${safeName(positionId)}.txt`);
const readJson = (file, fallback) => {
  try { if (!fs.existsSync(file)) return fallback; const t = fs.readFileSync(file, 'utf8'); return JSON.parse(t); } catch { return fallback; }
};
const writeJson = (file, data) => { try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch {} };
// Helper: extract potential order IDs from arbitrary API responses
const collectOrderIds = (payload) => {
  const out = new Set();
  const keys = new Set(['order_id','orderId','orderid','nOrdNo','oms_order_id','omsOrderId','id']);
  const visit = (v) => {
    try {
      if (v == null) return;
      if (Array.isArray(v)) { v.forEach(visit); return; }
      if (typeof v === 'object') {
        for (const [k,val] of Object.entries(v)) {
          const key = String(k);
          if (keys.has(key) && (typeof val === 'string' || typeof val === 'number')) out.add(String(val));
          visit(val);
        }
        return;
      }
    } catch {}
  };
  visit(payload);
  return Array.from(out);
};

// --- API logging middleware ---
const LOG_MAX_BODY = 5000; // truncate large bodies to keep logs light
const maskValue = (val) => {
  if (typeof val !== 'string') return val;
  if (!val) return val;
  return val.length <= 6 ? '*'.repeat(val.length) : val.slice(0,3) + '***' + val.slice(-3);
};
const maskKeys = new Set(['apikey','apiKey','authorization','Authorization','x-api-key','X-API-KEY']);
const maskObject = (obj) => {
  try {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(maskObject);
    const o = {};
    for (const [k,v] of Object.entries(obj)) {
      if (maskKeys.has(k)) o[k] = maskValue(typeof v === 'string' ? v : JSON.stringify(v));
      else if (v && typeof v === 'object') o[k] = maskObject(v);
      else o[k] = v;
    }
    return o;
  } catch { return obj; }
};
const clip = (str) => {
  try {
    const s = typeof str === 'string' ? str : JSON.stringify(str);
    return s.length > LOG_MAX_BODY ? s.slice(0, LOG_MAX_BODY) + `\n…(${s.length - LOG_MAX_BODY} more bytes)` : s;
  } catch { return String(str); }
};
const logLine = (entry) => {
  try {
    const day = new Date();
    const yyyy = String(day.getFullYear());
    const mm = String(day.getMonth()+1).padStart(2,'0');
    const dd = String(day.getDate()).padStart(2,'0');
    const file = path.join(logsRoot, `api-${yyyy}-${mm}-${dd}.jsonl`);
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch {}
};

app.use((req, res, next) => {
  const started = Date.now();
  const reqHeaders = maskObject(req.headers || {});
  const reqBodyMasked = maskObject(req.body || {});
  let resBodyCache = undefined;
  const origJson = res.json.bind(res);
  const origSend = res.send.bind(res);

  res.json = (data) => { resBodyCache = data; return origJson(data); };
  res.send = (data) => { resBodyCache = data; return origSend(data); };

  res.on('finish', () => {
    try {
      const durationMs = Date.now() - started;
      // Prepare response body string, masking if JSON
      let resBodyStr = '';
      if (resBodyCache !== undefined) {
        try { resBodyStr = typeof resBodyCache === 'string' ? resBodyCache : JSON.stringify(maskObject(resBodyCache)); }
        catch { resBodyStr = String(resBodyCache); }
      }
      const entry = {
        ts: new Date().toISOString(),
        ip: req.ip,
        method: req.method,
        path: req.originalUrl || req.url,
        status: res.statusCode,
        durationMs,
        request: {
          headers: reqHeaders,
          query: maskObject(req.query || {}),
          body: clip(JSON.stringify(reqBodyMasked)),
        },
        response: {
          body: clip(resBodyStr),
        },
      };
      logLine(entry);
    } catch {}
  });
  next();
});

// Format option symbol like NIFTY28MAR2420800CE
const monthMap = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const formatOptionSymbol = (underlying, expiryInput, strike, type) => {
  try {
    let d = null;
    if (expiryInput instanceof Date) d = expiryInput;
    else if (typeof expiryInput === 'string') {
      // Try common formats
      // 1) DD-MMM-YYYY or DDMMMYYYY
      const m1 = expiryInput.match(/^(\d{1,2})[- ]?([A-Za-z]{3})[- ]?(\d{2,4})$/);
      if (m1) {
        const dd = parseInt(m1[1],10);
        const mon = m1[2].toUpperCase();
        const yy = m1[3].length === 4 ? parseInt(m1[3].slice(-2),10) : parseInt(m1[3],10);
        const mi = monthMap.indexOf(mon);
        if (mi >= 0) d = new Date(2000+yy, mi, dd);
      }
      if (!d) {
        const t = Date.parse(expiryInput);
        if (!Number.isNaN(t)) d = new Date(t);
      }
    }
    if (!d) d = new Date(expiryInput);
    const dd = String(d.getDate()).padStart(2,'0');
    const mon = monthMap[d.getMonth()];
    const yy = String(d.getFullYear()).slice(-2);
    const datePart = `${dd}${mon}${yy}`;
    const und = String(underlying).toUpperCase();
    const typ = String(type).toUpperCase();
    return `${und}${datePart}${Math.round(Number(strike))}${typ}`;
  } catch {
    const und = String(underlying).toUpperCase();
    const typ = String(type).toUpperCase();
    return `${und}${String(expiryInput)}${Math.round(Number(strike))}${typ}`;
  }
};

// Format only the expiry part as DDMONYY (e.g., 14OCT25)
const formatExpiryCode = (expiryInput) => {
  try {
    let d = null;
    if (expiryInput instanceof Date) d = expiryInput;
    else if (typeof expiryInput === 'string') {
      const m1 = expiryInput.match(/^(\d{1,2})[- ]?([A-Za-z]{3})[- ]?(\d{2,4})$/);
      if (m1) {
        const dd = parseInt(m1[1],10);
        const mon = m1[2].toUpperCase();
        const yy = m1[3].length === 4 ? parseInt(m1[3].slice(-2),10) : parseInt(m1[3],10);
        const mi = monthMap.indexOf(mon);
        if (mi >= 0) d = new Date(2000+yy, mi, dd);
      }
      if (!d) {
        const t = Date.parse(expiryInput);
        if (!Number.isNaN(t)) d = new Date(t);
      }
    }
    if (!d) d = new Date(expiryInput);
    const dd = String(d.getDate()).padStart(2,'0');
    const mon = monthMap[d.getMonth()];
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}${mon}${yy}`;
  } catch {
    // Fallback to best-effort string (strip dashes)
    return String(expiryInput).replace(/-/g,'').toUpperCase();
  }
};

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
  // Record tradedPrice/tradedAt per leg if not provided
  const legs = Array.isArray(pos.legs) ? pos.legs.map((leg) => ({
    ...leg,
    tradedPrice: (leg && typeof leg.tradedPrice === 'number') ? leg.tradedPrice : (typeof leg.price === 'number' ? leg.price : null),
    tradedAt: (leg && typeof leg.tradedAt === 'number') ? leg.tradedAt : now,
    premiumAtEntry: (leg && typeof leg.premiumAtEntry === 'number') ? leg.premiumAtEntry : (typeof leg.price === 'number' ? (leg.price * (leg.lots || 1)) : null),
  })) : [];
  const withId = { 
    ...pos, 
    id, 
    status,
    createdAt,
    entryAt,
    updatedAt: now,
    exitAt: typeof pos.exitAt === 'number' ? pos.exitAt : (status === 'closed' ? now : undefined),
    exit: normalizeExit(pos.exit),
    legs,
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
  // Backfill leg fields if legs provided
  if (Array.isArray(merged.legs)) {
    merged.legs = merged.legs.map((leg, i) => {
      const prevLeg = Array.isArray(prev.legs) ? prev.legs[i] : undefined;
      const tradedPrice = (leg && typeof leg.tradedPrice === 'number') ? leg.tradedPrice
        : (prevLeg && typeof prevLeg.tradedPrice === 'number') ? prevLeg.tradedPrice
        : (typeof leg.price === 'number' ? leg.price : null);
      const tradedAt = (leg && typeof leg.tradedAt === 'number') ? leg.tradedAt
        : (prevLeg && typeof prevLeg.tradedAt === 'number') ? prevLeg.tradedAt
        : now;
      const premiumAtEntry = (leg && typeof leg.premiumAtEntry === 'number') ? leg.premiumAtEntry
        : (prevLeg && typeof prevLeg.premiumAtEntry === 'number') ? prevLeg.premiumAtEntry
        : (typeof tradedPrice === 'number' ? (tradedPrice * (leg?.lots || prevLeg?.lots || 1)) : null);
      return { ...leg, tradedPrice, tradedAt, premiumAtEntry };
    });
  }
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

// Position note API: notes tied to a specific position id
// GET /position-note/:id
app.get('/position-note/:id', (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const p = posNotePath(id);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'note not found' });
    const raw = fs.readFileSync(p, 'utf8');
    const content = raw.slice(0, NOTE_MAX_LENGTH);
    const truncated = raw.length > NOTE_MAX_LENGTH;
    return res.status(200).json({ content, truncated, length: content.length }).end();
  } catch (e) {
    return res.status(500).json({ error: 'failed to read note' });
  }
});

// PATCH /position-note/:id  { content, underlying?, name? }
// If no position note exists, optionally seed from strategy note (if underlying+name provided)
app.patch('/position-note/:id', (req, res) => {
  const { id } = req.params;
  const { content, underlying, name } = req.body || {};
  if (!id || typeof content !== 'string') return res.status(400).json({ error: 'id and content required' });
  try {
    const p = posNotePath(id);
    ensureDir(path.dirname(p));
    if (!fs.existsSync(p) && underlying && name) {
      // Seed from strategy note if available
      const sp = notePath(underlying, name);
      try {
        if (fs.existsSync(sp)) {
          const src = fs.readFileSync(sp, 'utf8');
          const seed = src.slice(0, NOTE_MAX_LENGTH);
          fs.writeFileSync(p, seed, 'utf8');
        }
      } catch {}
    }
    const str = String(content);
    const trimmed = str.length > NOTE_MAX_LENGTH ? str.slice(0, NOTE_MAX_LENGTH) : str;
    fs.writeFileSync(p, trimmed, 'utf8');
    return res.status(200).json({ ok: true, length: trimmed.length });
  } catch (e) {
    return res.status(500).json({ error: 'failed to write note' });
  }
});

// OpenAlgo config API (persist API key)
// GET /openalgo-config -> { apiKey?: string, host?: string, port?: number }
app.get('/openalgo-config', (req, res) => {
  try {
    const cfg = readJson(openAlgoConfigFile, {});
    const apiKey = cfg.apiKey || '';
    const host = cfg.host || '127.0.0.1';
    const port = typeof cfg.port === 'number' ? cfg.port : 5000;
    return res.status(200).json({ apiKey, host, port });
  } catch (e) {
    return res.status(500).json({ error: 'failed to read config' });
  }
});

// PATCH /openalgo-config { apiKey?, host?, port? }
app.patch('/openalgo-config', (req, res) => {
  const { apiKey, host, port } = req.body || {};
  if (apiKey !== undefined && typeof apiKey !== 'string') return res.status(400).json({ error: 'apiKey must be string' });
  if (host !== undefined && typeof host !== 'string') return res.status(400).json({ error: 'host must be string' });
  if (port !== undefined && !(Number.isInteger(port) && port > 0)) return res.status(400).json({ error: 'port must be positive integer' });
  try {
    const prev = readJson(openAlgoConfigFile, {});
    const next = { ...prev };
    if (apiKey !== undefined) next.apiKey = apiKey;
    if (host !== undefined) next.host = host;
    if (port !== undefined) next.port = port;
    writeJson(openAlgoConfigFile, next);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'failed to write config' });
  }
});

// Serve today's aggregated API log file for quick access from UI
app.get('/logs/today', (req, res) => {
  try {
    const day = new Date();
    const yyyy = String(day.getFullYear());
    const mm = String(day.getMonth()+1).padStart(2,'0');
    const dd = String(day.getDate()).padStart(2,'0');
    const file = path.join(logsRoot, `api-${yyyy}-${mm}-${dd}.jsonl`);
    if (!fs.existsSync(file)) return res.status(404).send('No log for today');
    return res.sendFile(file);
  } catch (e) {
    return res.status(500).send('Failed to read log');
  }
});

// POST /openalgo/funds { host?: string, port?: number, apiKey?: string }
app.post('/openalgo/funds', async (req, res) => {
  const { host, port, apiKey } = req.body || {};
  const cfg = readJson(openAlgoConfigFile, {});
  const key = (typeof apiKey === 'string' && apiKey) ? apiKey : (cfg.apiKey || '');
  const cfgHost = typeof cfg.host === 'string' && cfg.host ? cfg.host : '127.0.0.1';
  const cfgPort = Number.isInteger(cfg.port) && cfg.port > 0 ? cfg.port : 5000;
  const bodyHost = typeof host === 'string' && host ? host : undefined;
  const bodyPort = Number.isInteger(port) && port > 0 ? port : undefined;
  const base = (() => {
    const h = bodyHost ?? cfgHost;
    const p = bodyPort ?? cfgPort;
    if (/^https?:\/\//i.test(h)) {
      // treat as full URL
      return h.replace(/\/$/, '');
    }
    return `http://${h}:${p}`;
  })();
  const url = String(base).replace(/\/$/, '') + '/api/v1/funds';
  if (!key) return res.status(400).json({ error: 'apiKey required' });
  const started = Date.now();
  // Explicit log for outgoing OpenAlgo call
  try {
    logLine({
      ts: new Date().toISOString(),
      event: 'openalgo.request',
      endpoint: 'funds',
      method: 'POST',
      target: url,
      base,
      host: (new URL(url)).host,
      maskedApiKey: key.length <= 5 ? '*'.repeat(key.length) : key.slice(0,3) + '***' + key.slice(-2)
    });
  } catch {}
  try {
    const axiosRes = await axios.post(url, { apikey: key }, { validateStatus: () => true });
    const ms = Date.now() - started;
    const rawBody = typeof axiosRes.data === 'string' ? axiosRes.data : JSON.stringify(axiosRes.data);
    let parsed = null;
    try { parsed = typeof axiosRes.data === 'string' ? JSON.parse(axiosRes.data) : axiosRes.data; } catch {}
    const MAX_RAW = 10000;
    const u = new URL(url);
    const pathWithQuery = u.pathname + u.search;
    const hostHeader = u.host;
    const maskedKey = key.length <= 5 ? '*'.repeat(key.length) : key.slice(0,3) + '***' + key.slice(-2);
    const requestPayload = JSON.stringify({ apikey: maskedKey }, null, 2);
    const requestRaw = [`POST ${pathWithQuery} HTTP/1.1`, `Host: ${hostHeader}`, `Content-Type: application/json`, '', requestPayload].join('\n');
    const statusLine = `HTTP/1.1 ${axiosRes.status}`;
    const respHeaderLines = Object.entries(axiosRes.headers || {}).map(([k,v])=>`${k}: ${String(v)}`);
    const clippedBody = rawBody.length > MAX_RAW ? rawBody.slice(0, MAX_RAW) + `\n…(${rawBody.length - MAX_RAW} more bytes)` : rawBody;
    const responseRaw = [statusLine, ...respHeaderLines, '', clippedBody].join('\n');
    return res.status(200).json({
      ok: true,
      data: parsed ?? rawBody,
      debug: {
        durationMs: ms,
        request: { method: 'POST', url, headers: { 'Host': hostHeader, 'Content-Type': 'application/json' } },
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
    const requestPayload = JSON.stringify({ apikey: maskedKey }, null, 2);
    const requestRaw = [`POST ${pathWithQuery} HTTP/1.1`, `Host: ${hostHeader}`, `Content-Type: application/json`, '', requestPayload].join('\n');
    const responseRaw = [`HTTP/1.1 0 Network Error`, '', String(e?.message || 'Failed to connect')].join('\n');
    return res.status(502).json({ error: 'failed to fetch funds', debug: { requestRaw, responseRaw } });
  }
});

// POST /openalgo/basket-order
// Body options:
// 1) { strategy: string, orders: Array<{ symbol, exchange, action, quantity, pricetype, product }> }
// 2) { strategy, exchange, product, pricetype, underlying, legs: Array<{ action, type, strike, expiry, quantity }> }
app.post('/openalgo/basket-order', async (req, res) => {
  const body = req.body || {};
  const cfg = readJson(openAlgoConfigFile, {});
  const key = typeof body.apiKey === 'string' && body.apiKey ? body.apiKey : (cfg.apiKey || '');
  if (!key) return res.status(400).json({ error: 'apiKey required' });
  const host = typeof body.host === 'string' && body.host ? body.host : (cfg.host || '127.0.0.1');
  const port = Number.isInteger(body.port) && body.port > 0 ? body.port : (Number.isInteger(cfg.port) ? cfg.port : 5000);
  const base = /^https?:\/\//i.test(host) ? host.replace(/\/$/,'') : `http://${host}:${port}`;

  const strategy = typeof body.strategy === 'string' ? body.strategy : 'NodeJS';
  // Prefer explicit orders if provided
  let orders = Array.isArray(body.orders) ? body.orders : null;
  // Fallback: build orders from legs + underlying
  if (!orders && Array.isArray(body.legs) && body.underlying) {
  const exchange = body.exchange || 'NFO';
  const product = body.product || 'NRML';
    const pricetype = body.pricetype || 'MARKET';
    const underlying = body.underlying;
    orders = body.legs.map(l => {
      const actRaw = ((l.action || '') + '').toUpperCase();
      const action = (actRaw === 'B' || actRaw === 'BUY') ? 'BUY' : (actRaw === 'S' || actRaw === 'SELL') ? 'SELL' : actRaw || 'BUY';
      return {
        symbol: formatOptionSymbol(underlying, l.expiry, l.strike, l.type),
        exchange,
        action,
        expiry: formatExpiryCode(l.expiry),
        quantity: Number(l.quantity) || 1,
        pricetype,
        product,
      };
    });
  }
  if (!orders || !Array.isArray(orders) || orders.length === 0) {
    return res.status(400).json({ error: 'orders or legs required' });
  }

  const url = `${base}/api/v1/basketorder`;
  const payload = { apikey: key, strategy, orders };
  const started = Date.now();
  // Explicit log for outgoing OpenAlgo call
  try {
    logLine({
      ts: new Date().toISOString(),
      event: 'openalgo.request',
      endpoint: 'basketorder',
      method: 'POST',
      target: url,
      base,
      host: (new URL(url)).host,
      strategy,
      ordersCount: Array.isArray(orders) ? orders.length : 0
    });
  } catch {}
  try {
    const axiosRes = await axios.post(url, payload, { validateStatus: () => true });
    const ms = Date.now() - started;
    const rawBody = typeof axiosRes.data === 'string' ? axiosRes.data : JSON.stringify(axiosRes.data);
    const MAX_RAW = 10000;
    const u = new URL(url);
    const pathWithQuery = u.pathname + u.search;
    const hostHeader = u.host;
    const requestPayload = JSON.stringify({ ...payload, apikey: key.length <= 5 ? '*'.repeat(key.length) : key.slice(0,3)+'***'+key.slice(-2) }, null, 2);
    const requestRaw = [`POST ${pathWithQuery} HTTP/1.1`, `Host: ${hostHeader}`, `Content-Type: application/json`, '', requestPayload].join('\n');
    const statusLine = `HTTP/1.1 ${axiosRes.status}`;
    const respHeaderLines = Object.entries(axiosRes.headers || {}).map(([k,v])=>`${k}: ${String(v)}`);
    const clippedBody = rawBody.length > MAX_RAW ? rawBody.slice(0, MAX_RAW) + `\n…(${rawBody.length - MAX_RAW} more bytes)` : rawBody;
    const responseRaw = [statusLine, ...respHeaderLines, '', clippedBody].join('\n');
    const orderIds = collectOrderIds(axiosRes.data);
    return res.status(200).json({ ok: true, data: axiosRes.data, orderIds, debug: { durationMs: ms, requestRaw, responseRaw, response: { status: axiosRes.status, headers: axiosRes.headers } } });
  } catch (e) {
    const u = new URL(url);
    const pathWithQuery = u.pathname + u.search;
    const hostHeader = u.host;
    const requestPayload = JSON.stringify({ ...payload, apikey: key.length <= 5 ? '*'.repeat(key.length) : key.slice(0,3)+'***'+key.slice(-2) }, null, 2);
    const requestRaw = [`POST ${pathWithQuery} HTTP/1.1`, `Host: ${hostHeader}`, `Content-Type: application/json`, '', requestPayload].join('\n');
    const responseRaw = [`HTTP/1.1 0 Network Error`, '', String(e?.message || 'Failed to connect')].join('\n');
    return res.status(502).json({ error: 'failed to place basket', debug: { requestRaw, responseRaw } });
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
