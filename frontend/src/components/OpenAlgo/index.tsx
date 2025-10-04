import { useRef, useState, useEffect } from 'react';
import { Box, Paper, Typography, Grid, TextField, Button, Divider, Checkbox, FormControlLabel } from '@mui/material';
import OpenAlgoClient from 'openalgo';

type ProfileResponse = unknown;

type LogEntry = {
  id: number;
  at: string;
  request: { method: string; url: string; headers: Record<string, string> };
  status?: number | null;
  durationMs?: number;
  error?: string | null;
  responsePreview?: string; // truncated string of body (JSON or text)
  responseHeaders?: Record<string, string>;
  requestRaw?: string;
  responseRaw?: string;
  requestPayload?: string | null;
};

const OpenAlgo = () => {
  const [host, setHost] = useState<string>('127.0.0.1');
  const [port, setPort] = useState<number>(5000);
  const [apiKey, setApiKey] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<number | null>(null);
  const [result, setResult] = useState<ProfileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const apiBase = (import.meta.env.MODE === 'development' ? '/api' : (import.meta as any).env.VITE_API_BASE_URL);
  const [useProxy, setUseProxy] = useState(false);

  useEffect(() => {
    // Auto-scroll to bottom when log grows
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log.length]);

  const mask = (s: string) => {
    if (!s) return '';
    if (s.length <= 5) return '*'.repeat(s.length);
    return s.slice(0, 3) + '***' + s.slice(-2);
  };

  const runFundsCheck = async () => {
    setLoading(true); setError(null); setStatus(null); setResult(null);
    try {
      const base = `http://${host}:${port}`.replace(/\/$/, '');
      if (useProxy) {
        // Use backend proxy to avoid CORS and get raw dumps from server
        try {
          const res = await fetch(`${apiBase}/openalgo/funds`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host, port, apiKey }) });
          const j = await res.json();
          if (res.ok && j?.ok) {
            setStatus(200);
            setResult(j.data as any);
            setLog(prev => ([...prev, {
              id: Date.now(), at: new Date().toISOString(), request: { method: 'POST', url: `${apiBase}/openalgo/funds`, headers: { 'Content-Type': 'application/json' } }, status: 200, durationMs: j?.debug?.durationMs, error: null, responsePreview: typeof j.data === 'string' ? j.data : JSON.stringify(j.data, null, 2), responseHeaders: j?.debug?.response?.headers, requestRaw: j?.debug?.requestRaw, responseRaw: j?.debug?.responseRaw, requestPayload: JSON.stringify({ host: base, apiKey: mask(apiKey) })
            }]));
          } else {
            throw new Error(j?.error || 'Proxy call failed');
          }
        } catch (e:any) {
          setError(e?.message || 'Proxy call failed');
        }
      } else {
        // 1) Use library in-browser
        try {
          const client = new OpenAlgoClient(apiKey, base);
          const libResp = await client.funds();
          setResult(libResp as any);
        } catch (libErr: any) {
          setError(libErr?.message || 'openalgo.funds() failed');
        }
        // 2) Also perform raw GET to /funds for logging
        const url = base + '/funds';
        const started = performance.now();
        const headers = { 'X-API-KEY': apiKey } as Record<string, string>;
        try {
          const res = await fetch(url, { headers });
          setStatus(res.status);
          const text = await res.text();
          let parsed: any = null;
          try { parsed = text ? JSON.parse(text) : null; } catch {}
          const duration = Math.round(performance.now() - started);
          const respHeaders: Record<string, string> = {};
          res.headers.forEach((v, k) => { respHeaders[k] = v; });
          const preview = ((): string => {
            const contentStr = parsed !== null ? JSON.stringify(parsed, null, 2) : (text ?? '');
            return contentStr.length > 2000 ? contentStr.slice(0, 2000) + `\n…(${contentStr.length - 2000} more bytes)` : contentStr;
          })();
          const MAX_RAW = 10000;
          const u = new URL(url);
          const pathWithQuery = u.pathname + u.search;
          const host = u.host;
          const reqHeaderLines: string[] = [`Host: ${host}`];
          Object.entries({ 'X-API-KEY': mask(apiKey) }).forEach(([k,v])=>{ reqHeaderLines.push(`${k}: ${v}`); });
          const requestRaw = [`GET ${pathWithQuery} HTTP/1.1`, ...reqHeaderLines, '', ''].join('\n');
          const statusLine = `HTTP/1.1 ${res.status} ${res.statusText || ''}`.trim();
          const respHeaderLines = Object.entries(respHeaders).map(([k,v])=>`${k}: ${v}`);
          const fullRespBody = parsed !== null ? JSON.stringify(parsed, null, 2) : (text ?? '');
          const clippedBody = fullRespBody.length > MAX_RAW ? fullRespBody.slice(0, MAX_RAW) + `\n…(${fullRespBody.length - MAX_RAW} more bytes)` : fullRespBody;
          const responseRaw = [statusLine, ...respHeaderLines, '', clippedBody].join('\n');
          setLog(prev => [
            ...prev,
            {
              id: Date.now(),
              at: new Date().toISOString(),
              request: { method: 'GET', url, headers: { 'X-API-KEY': mask(apiKey) } },
              status: res.status,
              durationMs: duration,
              responsePreview: preview,
              error: null,
              responseHeaders: respHeaders,
              requestRaw,
              responseRaw,
              requestPayload: null,
            },
          ]);
        } catch (fetchErr: any) {
          const url2 = base + '/funds';
          const u = new URL(url2);
          const pathWithQuery = u.pathname + u.search;
          const host = u.host;
          const reqHeaderLines: string[] = [`Host: ${host}`];
          Object.entries({ 'X-API-KEY': mask(apiKey) }).forEach(([k,v])=>{ reqHeaderLines.push(`${k}: ${v}`); });
          const requestRaw = [`GET ${pathWithQuery} HTTP/1.1`, ...reqHeaderLines, '', ''].join('\n');
          const responseRaw = [`HTTP/1.1 0 Network Error`, '', (fetchErr?.message || 'Failed to connect')].join('\n');
          setLog(prev => [
            ...prev,
            {
              id: Date.now(),
              at: new Date().toISOString(),
              request: { method: 'GET', url: url2, headers: { 'X-API-KEY': mask(apiKey) } },
              status: null,
              durationMs: undefined,
              responsePreview: undefined,
              error: fetchErr?.message || 'Failed to connect',
              responseHeaders: undefined,
              requestRaw,
              responseRaw,
              requestPayload: null,
            },
          ]);
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to connect');
  const url = `http://${host}:${port}`.replace(/\/$/, '') + '/funds';
      // Build raw-like request even for error case
      const u = new URL(url);
      const pathWithQuery = u.pathname + u.search;
      const host = u.host;
      const reqHeaderLines: string[] = [`Host: ${host}`];
      Object.entries({ 'X-API-KEY': mask(apiKey) }).forEach(([k,v])=>{ reqHeaderLines.push(`${k}: ${v}`); });
      const requestRaw = [`GET ${pathWithQuery} HTTP/1.1`, ...reqHeaderLines, '', ''].join('\n');
      const responseRaw = [`HTTP/1.1 0 Network Error`, '', (e?.message || 'Failed to connect')].join('\n');
      setLog(prev => [
        ...prev,
        {
          id: Date.now(),
          at: new Date().toISOString(),
          request: { method: 'GET', url, headers: { 'X-API-KEY': mask(apiKey) } },
          status: null,
          durationMs: undefined,
          responsePreview: undefined,
          error: e?.message || 'Failed to connect',
          responseHeaders: undefined,
          requestRaw,
          responseRaw,
          requestPayload: null,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // Load persisted config on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${apiBase}/openalgo-config`);
        if (res.ok) {
          const j = await res.json();
          if (j) {
            if (typeof j.apiKey === 'string') setApiKey(j.apiKey);
            if (typeof j.host === 'string' && j.host) setHost(j.host);
            if (Number.isFinite(j.port)) setPort(j.port);
          }
        }
      } catch {}
    })();
  }, []);

  const saveConfig = async () => {
    try {
      const res = await fetch(`${apiBase}/openalgo-config`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey, host, port }) });
      if (!res.ok) throw new Error('Failed');
      setLog(prev => ([...prev, {
        id: Date.now(), at: new Date().toISOString(), request: { method: 'PATCH', url: `${apiBase}/openalgo-config`, headers: { 'Content-Type': 'application/json' } }, status: 200, durationMs: undefined, error: null, responsePreview: 'Saved OpenAlgo config'
      }]));
    } catch (e:any) {
      setLog(prev => ([...prev, {
        id: Date.now(), at: new Date().toISOString(), request: { method: 'PATCH', url: `${apiBase}/openalgo-config`, headers: { 'Content-Type': 'application/json' } }, status: null, durationMs: undefined, error: e?.message || 'Failed to save OpenAlgo config'
      }]));
    }
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="h5" sx={{ mb: 1 }}>OpenAlgo</Typography>
      <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Connect to OpenAlgo server</Typography>
        <Grid container spacing={1.5} alignItems="center">
          <Grid item xs={12} md={4}>
            <TextField size="small" fullWidth label="Host" placeholder="127.0.0.1" value={host} onChange={(e)=>setHost(e.target.value)} />
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField size="small" fullWidth label="Port" type="number" placeholder="5000" value={port} onChange={(e)=>setPort(parseInt(e.target.value||'0',10)||0)} />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField size="small" fullWidth label="API Key" placeholder="your-openalgo-api-key" value={apiKey} onChange={(e)=>setApiKey(e.target.value)} />
          </Grid>
          <Grid item xs='auto'>
            <Button variant="contained" onClick={runFundsCheck} disabled={loading}>
              {loading ? 'Running…' : 'Funds'}
            </Button>
          </Grid>
          <Grid item xs='auto'>
            <Button variant="outlined" onClick={saveConfig}>Save</Button>
          </Grid>
          <Grid item xs={12} md={12}>
            <FormControlLabel control={<Checkbox checked={useProxy} onChange={e=>setUseProxy(e.target.checked)} />} label="Use backend proxy for /funds (avoid CORS; includes raw dumps)" />
          </Grid>
        </Grid>

        <Box>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Result</Typography>
          {status !== null && (
            <Typography variant="body2" sx={{ mb: 0.5 }}>Status Code: {status}</Typography>
          )}
          {error && (
            <Typography variant="body2" color="error">Error: {error}</Typography>
          )}
          {!error && (result !== null) && (
            <Box component="pre" sx={{ p: 1, border: 1, borderColor: 'divider', borderRadius: 1, overflowX: 'auto', fontSize: 12 }}>
              {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
            </Box>
          )}
          {!error && result === null && status !== null && (
            <Typography variant="body2" color="text.secondary">No content</Typography>
          )}
        </Box>

        <Typography variant="caption" color="text.secondary">
          Note: This invokes openalgo.funds() using your API key and also logs a GET /funds to show raw HTTP request/response. If your server does not enable CORS, consider adding a backend proxy.
        </Typography>
      </Paper>

      <Paper sx={{ p:2, display:'flex', flexDirection:'column', gap:1 }}>
        <Box sx={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Debug log</Typography>
          <Button size="small" onClick={()=>setLog([])}>Clear</Button>
        </Box>
        <Typography variant="caption" color="text.secondary">Shows recent OpenAlgo API calls with request and response previews.</Typography>
        <Divider sx={{ my:1 }} />
        <Box sx={{ maxHeight: 260, overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 1, p:1 }}>
          {log.length === 0 && (
            <Typography variant="body2" color="text.secondary">No calls yet.</Typography>
          )}
          {log.map(entry => (
            <Box key={entry.id} sx={{ mb:1.5 }}>
              <Typography variant="caption" color="text.secondary">{entry.at}</Typography>
              <Box sx={{ display:'flex', flexWrap:'wrap', gap:1 }}>
                <Typography variant="body2"><b>{entry.request.method}</b> {entry.request.url}</Typography>
                {entry.status !== undefined && (
                  <Typography variant="body2">· Status: {entry.status ?? 'N/A'}</Typography>
                )}
                {typeof entry.durationMs === 'number' && (
                  <Typography variant="body2">· {entry.durationMs} ms</Typography>
                )}
              </Box>
              <Typography variant="caption" color="text.secondary">Headers: {Object.entries(entry.request.headers).map(([k,v])=>`${k}: ${v}`).join(', ') || '—'}</Typography>
              {entry.error && (
                <Typography variant="body2" color="error">Error: {entry.error}</Typography>
              )}
              <Typography variant="caption" color="text.secondary">Raw HTTP request</Typography>
              <Box component="pre" sx={{ p:1, bgcolor:'background.default', borderRadius:1, overflowX:'auto', fontSize:12, mb:1 }}>
                {entry.requestRaw || '—'}
              </Box>
              {entry.requestPayload && (
                <>
                  <Typography variant="caption" color="text.secondary">Request payload</Typography>
                  <Box component="pre" sx={{ p:1, bgcolor:'background.default', borderRadius:1, overflowX:'auto', fontSize:12, mb:1 }}>
                    {entry.requestPayload}
                  </Box>
                </>
              )}
              <Typography variant="caption" color="text.secondary">Raw HTTP response</Typography>
              <Box component="pre" sx={{ p:1, bgcolor:'background.default', borderRadius:1, overflowX:'auto', fontSize:12 }}>
                {entry.responseRaw || entry.responsePreview || 'No content'}
              </Box>
              {!entry.error && entry.responseHeaders && (
                <Typography variant="caption" color="text.secondary">Response headers: {Object.entries(entry.responseHeaders).map(([k,v])=>`${k}: ${v}`).join(', ') || '—'}</Typography>
              )}
              <Divider sx={{ my:1 }} />
            </Box>
          ))}
          <div ref={logEndRef} />
        </Box>
      </Paper>
    </Box>
  );
};

export default OpenAlgo;
