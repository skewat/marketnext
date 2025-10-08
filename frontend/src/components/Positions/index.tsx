import { useEffect, useMemo, useState, useContext } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Box, Paper, Typography, Grid, FormControl, InputLabel, Select, MenuItem, Button, Drawer, Table, TableHead, TableRow, TableCell, TableBody, Checkbox, TextField } from '@mui/material';
import { getUnderlying, setUnderlying as setGlobalUnderlying, setSBATMIVsPerExpiry, setSBFuturesPerExpiry, setSBUnderlyingPrice, setSBTargetUnderlyingPrice, setSBTargetDateTime, setSBOptionLegs, setSBExpiry } from '../../features/selected/selectedSlice';
import { useOpenInterestQuery } from '../../app/services/openInterest';
import PNLVisualizer from '../StrategyBuilder/PNLVisualizer';
import { getTargetDateTime } from '../../utils';
import type { OptionLeg as OptionLegType } from '../../features/selected/types';
import { ToastContext } from '../../contexts/ToastContextProvider';
import { LOTSIZES } from '../../identifiers';

type StoredLeg = OptionLegType & { tradedPrice?: number | null; tradedAt?: number; premiumAtEntry?: number | null };

type Position = {
  id: string;
  name: string;
  underlying: string;
  expiry: string;
  legs: StoredLeg[];
  status: 'open'|'closed'|'scheduled';
  createdAt: number;
  entryAt?: number;
  exitAt?: number;
  updatedAt?: number;
  schedule?: { day: string; time: string };
  exit?: { mode: 'stopLossPct'|'stopLossAbs'|'onExpiry'; stopLossPct?: string; stopLossAbs?: string; profitTargetPct?: string; trailingEnabled?: boolean };
};

// Backend helpers
const apiBase = (import.meta.env.MODE === 'development' ? '/api' : (import.meta as any).env.VITE_API_BASE_URL);
const fetchPositions = async (underlying?: string): Promise<Position[]> => {
  const url = `${apiBase}/positions${underlying ? `?underlying=${encodeURIComponent(underlying)}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  return await res.json();
};
const patchPosition = async (id: string, patch: Partial<Position>): Promise<Position | null> => {
  const url = `${apiBase}/positions/${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  if (!res.ok) return null;
  return await res.json();
};
const fetchSavedStrategiesMap = async (underlying: string): Promise<Record<string, any>> => {
  try {
    const res = await fetch(`${apiBase}/strategies?underlying=${encodeURIComponent(underlying)}`);
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
};

const fetchStrategyNote = async (underlying: string, name: string): Promise<string | null> => {
  try {
    const res = await fetch(`${apiBase}/strategy-note?underlying=${encodeURIComponent(underlying)}&name=${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    const json = await res.json();
    return json?.content ?? null;
  } catch { return null; }
};

const saveStrategyNote = async (underlying: string, name: string, content: string): Promise<boolean> => {
  try {
    const res = await fetch(`${apiBase}/strategy-note`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ underlying, name, content }) });
    return res.ok;
  } catch { return false; }
};

const Positions = () => {
  const dispatch = useDispatch();
  const underlying = useSelector(getUnderlying);
  const { data } = useOpenInterestQuery({ underlying });
  const { setOpen, setToastPack } = useContext(ToastContext);

  const [positions, setPositions] = useState<Position[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustTradeOpen, setAdjustTradeOpen] = useState(false);
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteContent, setNoteContent] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteEditMode, setNoteEditMode] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const NOTE_MAX = 1000;
  const [isExiting, setIsExiting] = useState(false);
  // Adjust state
  const [exitLegMap, setExitLegMap] = useState<Record<string, boolean>>({});
  type NewLegDraft = { expiry: string; spot: string; lots: string; type: 'CE'|'PE'; action: 'B'|'S' };
  const [newLegDrafts, setNewLegDrafts] = useState<NewLegDraft[]>([]);

  // Helper to check if a timestamp is on the same local day as today
  const isSameLocalDay = (ms?: number) => {
    if (!ms || !Number.isFinite(ms)) return false;
    const a = new Date(ms);
    const b = new Date();
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  };

  // Filter positions: by underlying AND include all open, plus those closed today
  const filtered = useMemo(()=> {
    return positions
      .filter(p => p.underlying === underlying)
      .filter(p => p.status === 'open' || (p.status === 'closed' && isSameLocalDay(p.exitAt)));
  }, [positions, underlying]);

  useEffect(()=>{ (async ()=>{ setPositions(await fetchPositions(underlying)); })(); }, [underlying]);

  // Ensure the app underlying matches the selected position's underlying
  useEffect(() => {
    if (!selectedId) return;
    const pos = positions.find(p => p.id === selectedId);
    if (pos && pos.underlying !== underlying) {
      dispatch(setGlobalUnderlying(pos.underlying as any));
    }
  }, [selectedId]);

  // On select, feed SB state and render PNLVisualizer
  useEffect(()=>{
    if (!selectedId || !data) return;
    const pos = filtered.find(p => p.id === selectedId);
    if (!pos) return;
  const { grouped, underlyingValue } = data as any;
    const atmIVsPerExpiry: { [k:string]: number } = {};
    const futuresPerExpiry: { [k:string]: number } = {};
    Object.keys(grouped||{}).forEach(k => { atmIVsPerExpiry[k] = grouped[k]?.atmIV || 0; futuresPerExpiry[k] = grouped[k]?.syntheticFuturesPrice || 0; });
    dispatch(setSBUnderlyingPrice(underlyingValue));
    dispatch(setSBATMIVsPerExpiry(atmIVsPerExpiry as any));
    dispatch(setSBFuturesPerExpiry(futuresPerExpiry as any));
    dispatch(setSBTargetUnderlyingPrice({ value: underlyingValue, autoUpdate: true } as any));
    dispatch(setSBTargetDateTime({ value: getTargetDateTime().toISOString(), autoUpdate: true } as any));
  // Resolve expiry: use position expiry if available else the first available expiry
  const availableExpiries = Object.keys(grouped || {});
  const useExpiry = availableExpiries.includes(pos.expiry) ? pos.expiry : (availableExpiries[0] || pos.expiry);
    // Rebuild legs with latest price/iv and nearest strike mapping for the saved expiry.
    (async () => {
      const g = grouped?.[useExpiry];
      const rows = (g?.data || []) as any[];
      const strikes: number[] = rows.map((r:any) => r.strikePrice || r.strike).filter((v:any)=> typeof v==='number');
      const fut = g?.syntheticFuturesPrice ?? null;
      const atmBase = (fut ?? g?.atmStrike ?? underlyingValue ?? null) as number | null;
      const rowByStrike = new Map<number, any>();
      for (const r of rows) {
        const k = (r.strikePrice ?? r.strike) as number;
        if (typeof k === 'number') rowByStrike.set(k, r);
      }
      let legsSource: OptionLegType[] = pos.legs || [];
      // Fallback: if stored legs are empty, try reconstructing from saved strategy
      if (!legsSource.length) {
        const map = await fetchSavedStrategiesMap(underlying);
        const saved = map[pos.name];
        if (saved && Array.isArray(saved.optionLegs)) {
          const rebuilt: OptionLegType[] = [];
          for (const item of saved.optionLegs as any[]) {
            let strike: number | null = null;
            if (item?.strikeRef?.kind === 'ATM' && atmBase !== null && strikes.length) {
              const nearest = strikes.reduce((prev,curr)=> Math.abs(curr-atmBase) < Math.abs(prev-atmBase) ? curr : prev, strikes[0]);
              const atmIdx = Math.max(0, strikes.findIndex((s:number)=>s===nearest));
              let idx = atmIdx + (item.strikeRef.offset as number);
              if (idx < 0) idx = 0;
              if (idx > strikes.length-1) idx = strikes.length-1;
              strike = strikes[idx];
            } else if (typeof item?.strike === 'number') {
              if (strikes.length) {
                let best = strikes[0]; let bestDiff = Math.abs(best - item.strike);
                for (const s of strikes){ const d = Math.abs(s - item.strike); if (d < bestDiff){ bestDiff = d; best = s; } }
                strike = best;
              } else {
                strike = item.strike;
              }
            }
            if (strike !== null) {
              const row = rowByStrike.get(strike);
              const price = item.type === 'CE' ? (row?.CE?.lastPrice ?? null) : (row?.PE?.lastPrice ?? null);
              const iv = row?.iv ?? null;
              rebuilt.push({ active: item.active ?? true, action: item.action, expiry: useExpiry, strike, type: item.type, lots: item.lots, price, iv } as OptionLegType);
            }
          }
          legsSource = rebuilt;
        }
      }
      const normalizedLegs: OptionLegType[] = (legsSource || []).map((leg) => {
        // Snap to nearest available strike for current snapshot
        let strike = leg.strike;
        if (strikes.length) {
          if (!strikes.includes(leg.strike)) {
            let best = strikes[0]; let bestDiff = Math.abs(best - leg.strike);
            for (const s of strikes) { const d = Math.abs(s - leg.strike); if (d < bestDiff) { bestDiff = d; best = s; } }
            strike = best;
          }
        }
        const row = rowByStrike.get(strike);
        // Prefer persisted tradedPrice/premiumAtEntry as the entry price for payoff baseline; fallback to current LTP
        const entryPrice = (typeof (leg as any).tradedPrice === 'number') ? (leg as any).tradedPrice
          : (typeof (leg as any).premiumAtEntry === 'number') ? (leg as any).premiumAtEntry
          : (leg.type === 'CE' ? (row?.CE?.lastPrice ?? null) : (row?.PE?.lastPrice ?? null));
        const iv = row?.iv ?? null;
        return { ...leg, active: (leg as any).active ?? true, expiry: useExpiry, strike, price: entryPrice, iv } as OptionLegType;
      });
      dispatch(setSBOptionLegs({ type: 'set', optionLegs: normalizedLegs } as any));
      dispatch(setSBExpiry(useExpiry));
    })();
  }, [selectedId, data]);

  // Build leg display data: traded vs current price for each leg
  const legDisplay = useMemo(() => {
    if (!selectedId || !data) return [] as Array<{ key: string; action: 'B'|'S'; type: 'CE'|'PE'; strike: number; lots: number; tradedPrice: number | null; currentPrice: number | null; tradedAt?: number; premiumAtEntry?: number | null; expiryShort: string; delta?: number | null }>; 
    const pos = positions.find(p => p.id === selectedId);
    if (!pos) return [];
    const { grouped } = data as any;
    const availableExpiries = Object.keys(grouped || {});
    const useExpiry = availableExpiries.includes(pos.expiry) ? pos.expiry : (availableExpiries[0] || pos.expiry);
    const g = grouped?.[useExpiry];
    const rows = (g?.data || []) as any[];
    const strikes: number[] = rows.map((r:any) => r.strikePrice || r.strike).filter((v:any)=> typeof v==='number');
    const rowByStrike = new Map<number, any>();
    for (const r of rows) {
      const k = (r.strikePrice ?? r.strike) as number;
      if (typeof k === 'number') rowByStrike.set(k, r);
    }
    const snapStrike = (k: number) => {
      if (!strikes.length) return k;
      if (strikes.includes(k)) return k;
      let best = strikes[0]; let bestDiff = Math.abs(best - k);
      for (const s of strikes) { const d = Math.abs(s - k); if (d < bestDiff) { bestDiff = d; best = s; } }
      return best;
    };
    return (pos.legs || []).map((leg, idx) => {
      const strike = snapStrike(leg.strike);
      const row = rowByStrike.get(strike);
      const currentPrice = leg.type === 'CE' ? (row?.CE?.lastPrice ?? null) : (row?.PE?.lastPrice ?? null);
      const greeksDelta = leg.type === 'CE' ? (row?.CE?.greeks?.delta ?? null) : (row?.PE?.greeks?.delta ?? null);
      const tradedPrice = (typeof leg.tradedPrice === 'number') ? leg.tradedPrice : (typeof (leg as any).price === 'number' ? (leg as any).price : null);
      const premiumAtEntry = typeof leg.premiumAtEntry === 'number' ? leg.premiumAtEntry : undefined;
      const expFull = (leg.expiry || useExpiry) as string;
      const expiryShort = typeof expFull === 'string' ? expFull.replace(/-\d{4}$/,'') : '';
      return { key: `${idx}-${leg.type}-${strike}`, action: leg.action, type: leg.type, strike, lots: leg.lots, tradedPrice, currentPrice, tradedAt: leg.tradedAt, premiumAtEntry, expiryShort, delta: typeof greeksDelta === 'number' ? greeksDelta : null };
    });
  }, [selectedId, positions, data]);

  // Load adjustment note when Adjust drawer opens
  useEffect(() => {
    if (!adjustOpen) {
      setNoteContent(null);
      setNoteError(null);
      setNoteLoading(false);
      return;
    }
    const pos = positions.find(p => p.id === selectedId);
    if (!pos) { setNoteContent(null); return; }
    setNoteLoading(true);
    setNoteError(null);
    fetchStrategyNote(pos.underlying, pos.name)
      .then(content => { if (content) setNoteContent(content); else setNoteError('No adjustment note found for this strategy.'); })
      .catch(() => setNoteError('Failed to load adjustment note.'))
      .finally(() => setNoteLoading(false));
  }, [adjustOpen, selectedId, positions]);

  // Exit now handled via reverse orders (handleReverseExit)

  // Broker symbol helpers (DDMONYY format)
  const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'] as const;
  const toExpiryCode = (expiryInput: string | Date): string => {
    try {
      let d: Date | null = null;
      if (expiryInput instanceof Date) d = expiryInput;
      else if (typeof expiryInput === 'string') {
        const m1 = expiryInput.match(/^(\d{1,2})[- ]?([A-Za-z]{3})[- ]?(\d{2,4})$/);
        if (m1) {
          const dd = parseInt(m1[1],10);
          const mon = m1[2].toUpperCase();
          const yy = m1[3].length === 4 ? parseInt(m1[3].slice(-2),10) : parseInt(m1[3],10);
          const mi = MONTHS.indexOf(mon as any);
          if (mi >= 0) d = new Date(2000+yy, mi, dd);
        }
        if (!d) {
          const t = Date.parse(expiryInput);
          if (!Number.isNaN(t)) d = new Date(t);
        }
      }
      if (!d) d = new Date(expiryInput as any);
      const dd = String(d.getDate()).padStart(2,'0');
      const mon = MONTHS[d.getMonth()];
      const yy = String(d.getFullYear()).slice(-2);
      return `${dd}${mon}${yy}`;
    } catch {
      return String(expiryInput).replace(/-/g,'').toUpperCase();
    }
  };
  const buildOptionSymbol = (und: string, expiry: string | Date, strike: number, type: 'CE'|'PE'): string => {
    const undU = String(und).toUpperCase();
    const expCode = toExpiryCode(expiry);
    const typ = String(type).toUpperCase();
    return `${undU}${expCode}${Math.round(Number(strike))}${typ}`;
  };

  const handleReverseExit = async () => {
    if (!selectedId) return;
    const pos = positions.find(p => p.id === selectedId);
    if (!pos) return;
    const lotSize = LOTSIZES.get(pos.underlying as any) || 75;
    if (!Array.isArray(pos.legs) || pos.legs.length === 0) {
      setToastPack(p=>[...p,{ key: Date.now(), type: 'error', message: 'No legs to reverse' }]); setOpen(true); return;
    }
    setIsExiting(true);
    try {
      // Build reverse orders
      const orders = pos.legs.map(l => ({
        symbol: buildOptionSymbol(pos.underlying, pos.expiry, l.strike, l.type),
        exchange: 'NFO',
        action: (l.action === 'B' ? 'SELL' : 'BUY'),
        quantity: Math.max(1, Number(l.lots||1)) * lotSize,
        pricetype: 'MARKET',
        product: 'NRML',
      }));
      const resp = await fetch(`${apiBase}/openalgo/basket-order`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ strategy: pos.name, orders }) });
      const data = await resp.json().catch(()=>({}));
      if (!resp.ok || data?.ok === false) {
        setToastPack(p=>[...p,{ key: Date.now(), type: 'error', message: `Reverse order failed${data?.error?`: ${String(data.error)}`:''}` }]);
      } else {
        const idsArr = Array.isArray(data?.orderIds) ? data.orderIds : [];
        const idsStr = idsArr.length ? idsArr.slice(0,3).join(', ') + (idsArr.length>3 ? ', …' : '') : '';
        const logUrl = `${apiBase}/logs/today`;
        setToastPack(p=>[...p,{ key: Date.now(), type: 'success', message: `Reverse orders sent${idsStr ? ` (IDs: ${idsStr})` : ''}`, actionLabel:'View Log', actionHref: logUrl }]);
        // Mark position closed locally
        const updated = await patchPosition(selectedId, { status: 'closed' });
        if (updated) setPositions(prev => prev.map(p => p.id === selectedId ? (updated as Position) : p));
      }
    } catch (e:any) {
      setToastPack(p=>[...p,{ key: Date.now(), type: 'error', message: `Failed to send reverse orders: ${e?.message||'network error'}` }]);
    } finally {
      setIsExiting(false);
      setOpen(true);
    }
  };

  const handleRecalculate = () => {
    if (!selectedId || !data) {
      setToastPack(p=>[...p,{ key: Date.now(), type: 'error', message: 'Select a position first' }]);
      setOpen(true);
      return;
    }
    const pos = filtered.find(p => p.id === selectedId);
    if (!pos) return;
    const { grouped, underlyingValue } = data as any;
    const g = grouped?.[pos.expiry];
    const rows = (g?.data || []) as any[];
    const strikes: number[] = rows.map((r:any) => r.strikePrice || r.strike).filter((v:any)=> typeof v==='number');
    const rowByStrike = new Map<number, any>();
    for (const r of rows) {
      const k = (r.strikePrice ?? r.strike) as number;
      if (typeof k === 'number') rowByStrike.set(k, r);
    }
    const normalizedLegs: OptionLegType[] = (pos.legs || []).map((leg) => {
      let strike = leg.strike;
      if (strikes.length) {
        if (!strikes.includes(leg.strike)) {
          let best = strikes[0]; let bestDiff = Math.abs(best - leg.strike);
          for (const s of strikes) { const d = Math.abs(s - leg.strike); if (d < bestDiff) { bestDiff = d; best = s; } }
          strike = best;
        }
      }
      const row = rowByStrike.get(strike);
      const price = leg.type === 'CE' ? (row?.CE?.lastPrice ?? null) : (row?.PE?.lastPrice ?? null);
      const iv = row?.iv ?? null;
      return { ...leg, active: (leg as any).active ?? true, expiry: pos.expiry, strike, price, iv } as OptionLegType;
    });
    dispatch(setSBUnderlyingPrice(underlyingValue));
    dispatch(setSBOptionLegs({ type: 'set', optionLegs: normalizedLegs } as any));
    dispatch(setSBExpiry(pos.expiry));
    dispatch(setSBTargetDateTime({ value: getTargetDateTime().toISOString(), autoUpdate: true } as any));
    setToastPack(p=>[...p,{ key: Date.now(), type: 'success', message: 'Recalculated with latest prices' }]);
    setOpen(true);
  };

  // Helpers for building symbols/strikes
  // Use earlier declared toExpiryCode/buildOptionSymbol; only need strike snapper here
  const snapStrikeFor = (expiry: string, desiredSpot: number): { strike: number; price: number|null; iv: number|null } => {
    const d: any = data; const g = d?.grouped?.[expiry];
    const rows = (g?.data || []) as any[];
    const strikes: number[] = rows.map((r:any)=> r.strikePrice || r.strike).filter((v:any)=> typeof v==='number');
    if (!strikes.length) return { strike: Math.round(desiredSpot), price: null, iv: null };
    let best = strikes[0]; let bestDiff = Math.abs(best - desiredSpot);
    for (const s of strikes) { const dif = Math.abs(s - desiredSpot); if (dif < bestDiff) { bestDiff = dif; best = s; } }
    const row = rows.find((r:any)=> (r.strikePrice ?? r.strike) === best);
    const price = row ? (typeof row.CE?.lastPrice === 'number' ? row.CE.lastPrice : (typeof row.PE?.lastPrice === 'number' ? row.PE.lastPrice : null)) : null;
    const iv = row?.iv ?? null;
    return { strike: best, price, iv };
  };

  const executeAdjustment = async () => {
    if (!selectedId) return;
    const pos = positions.find(p => p.id === selectedId);
    if (!pos) return;
    const lotSize = LOTSIZES.get(pos.underlying as any) || 75;
    const exits = legDisplay.filter(ld => exitLegMap[ld.key]);
    const maxNew = exits.length;
    if (newLegDrafts.length > maxNew) {
      setToastPack(p=>[...p,{ key: Date.now(), type:'error', message:`Too many new legs (max ${maxNew})` }]); setOpen(true); return;
    }
    // Build orders
    const orders: Array<{symbol:string; exchange:string; action:'BUY'|'SELL'; quantity:number; pricetype:string; product:string}> = [];
    // Exit legs -> reverse orders
    for (const l of exits) {
      orders.push({
        symbol: buildOptionSymbol(pos.underlying, pos.expiry, l.strike, l.type),
        exchange: 'NFO', action: (l.action==='B'?'SELL':'BUY'),
        quantity: Math.max(1, Number(l.lots||1)) * lotSize,
        pricetype: 'MARKET', product: 'NRML'
      });
    }
    // New legs
    for (const nd of newLegDrafts) {
      const expiry = nd.expiry || pos.expiry;
      const spotNum = parseFloat(nd.spot || '');
      const lotsNum = Math.max(1, parseInt(nd.lots||'1',10) || 1);
      if (!expiry || !Number.isFinite(spotNum)) {
        setToastPack(p=>[...p,{ key: Date.now(), type:'error', message:'Fill expiry and spot for all new legs' }]); setOpen(true); return;
      }
      const snap = snapStrikeFor(expiry, spotNum);
      orders.push({
        symbol: buildOptionSymbol(pos.underlying, expiry, snap.strike, nd.type),
        exchange: 'NFO', action: (nd.action==='B'?'BUY':'SELL'),
        quantity: lotsNum * lotSize,
        pricetype: 'MARKET', product: 'NRML'
      });
    }
    if (orders.length === 0) { setToastPack(p=>[...p,{ key: Date.now(), type:'info', message:'No adjustments selected' }]); setOpen(true); return; }
    try {
      const resp = await fetch(`${apiBase}/openalgo/basket-order`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ strategy: `${pos.name} - adjustment`, orders }) });
      const dataJson = await resp.json().catch(()=>({}));
      if (!resp.ok || dataJson?.ok === false) {
        setToastPack(p=>[...p,{ key: Date.now(), type:'error', message:`Adjustment order failed${dataJson?.error?`: ${String(dataJson.error)}`:''}` }]);
      } else {
        const idsArr = Array.isArray(dataJson?.orderIds) ? dataJson.orderIds : [];
        const idsStr = idsArr.length ? idsArr.slice(0,3).join(', ') + (idsArr.length>3 ? ', …' : '') : '';
        const logUrl = `${apiBase}/logs/today`;
        setToastPack(p=>[...p,{ key: Date.now(), type:'success', message:`Adjustment sent${idsStr ? ` (IDs: ${idsStr})` : ''}`, actionLabel:'View Log', actionHref: logUrl }]);
        // Update position legs: remove exited; add new legs
        const keepKeys = new Set(legDisplay.filter(ld => !exitLegMap[ld.key]).map(ld => ld.key));
        const remaining = (pos.legs || []).filter((leg, idx) => keepKeys.has(`${idx}-${leg.type}-${leg.strike}`));
        const added = newLegDrafts.map(nd => {
          const expiry = nd.expiry || pos.expiry;
          const spotNum = parseFloat(nd.spot||'');
          const lotsNum = Math.max(1, parseInt(nd.lots||'1',10) || 1);
          const snap = snapStrikeFor(expiry, spotNum);
          // Price for storage: use current LTP for that strike/type if available
          const dAny: any = data; const g = dAny?.grouped?.[expiry];
          const rows = (g?.data || []) as any[];
          const row = rows.find((r:any)=> (r.strikePrice ?? r.strike) === snap.strike);
          const price = nd.type==='CE' ? (row?.CE?.lastPrice ?? null) : (row?.PE?.lastPrice ?? null);
          const iv = row?.iv ?? null;
          return { active:true, action: nd.action, expiry, strike: snap.strike, type: nd.type, lots: lotsNum, price, iv } as OptionLegType;
        });
        const nextLegs = [ ...remaining, ...added ];
        const updated = await patchPosition(selectedId, { legs: nextLegs });
        if (updated) {
          setPositions(prev => prev.map(p => p.id === selectedId ? (updated as Position) : p));
        }
        // Refresh SB/PNL state
        handleRecalculate();
        setAdjustTradeOpen(false);
        setExitLegMap({}); setNewLegDrafts([]);
      }
    } catch (e:any) {
      setToastPack(p=>[...p,{ key: Date.now(), type:'error', message:`Failed to send adjustment: ${e?.message||'network error'}` }]);
    } finally { setOpen(true); }
  };

  return (
    <Box sx={{ p:{ xs:2, md:3 }, display:'flex', flexDirection:'column', gap:2 }}>
      <Typography variant='h5' sx={{ mb:1 }}>Positions</Typography>
      <Paper sx={{ p:2, display:'flex', flexDirection:'column', gap:3 }}>
        <Grid container spacing={1.5} alignItems='center'>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth size='small'>
              <InputLabel id='position-select-label'>Select position</InputLabel>
              <Select labelId='position-select-label' label='Select position' value={selectedId} onChange={e=>setSelectedId(e.target.value)}>
                {filtered.length===0 && <MenuItem value='' disabled>No positions</MenuItem>}
                {filtered.map(p => (
                  <MenuItem key={p.id} value={p.id}>{p.name} · {p.expiry} · {p.status}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs='auto'>
            <Button variant='contained' color='error' size='small' disabled={!selectedId || isExiting} onClick={handleReverseExit}>Exit</Button>
          </Grid>
          <Grid item xs='auto'>
            <Button variant='outlined' size='small' disabled={!selectedId} onClick={()=>setAdjustOpen(true)}>Notes</Button>
          </Grid>
          <Grid item xs='auto'>
            <Button variant='outlined' size='small' disabled={!selectedId} onClick={()=>{ setAdjustTradeOpen(true); setExitLegMap({}); setNewLegDrafts([]); }}>Adjust</Button>
          </Grid>
          <Grid item xs='auto'>
            <Button variant='outlined' size='small' disabled={!selectedId} onClick={handleRecalculate}>Recalculate</Button>
          </Grid>
        </Grid>

        {selectedId && (()=>{
          const pos = filtered.find(p => p.id === selectedId);
          if (!pos) return null;
          const isClosed = pos.status === 'closed';
          const lotSize = LOTSIZES.get(pos.underlying as any) || null;
          if (isClosed) {
            // For closed positions, reuse PNLVisualizer to only render Current PnL card (no chart/other data)
            const tableSumPnL = (() => {
              const lotSize = LOTSIZES.get(pos.underlying as any) || null;
              if (!lotSize) return undefined;
              let sum = 0;
              for (const l of legDisplay) {
                const sign = l.action === 'B' ? -1 : 1;
                const entryPrem = (l.tradedPrice != null) ? sign * l.tradedPrice * l.lots * lotSize : null;
                const currentPrem = (l.currentPrice != null) ? sign * l.currentPrice * l.lots * lotSize : null;
                if (entryPrem != null && currentPrem != null) sum += (entryPrem - currentPrem);
              }
              return sum;
            })();
            return (
              <Box>
                {/* Legs summary table */}
                {legDisplay.length > 0 && (
                  <Paper sx={{ mb:2, p:1 }}>
                    <Typography variant='subtitle1' sx={{ mb:1 }}>Legs</Typography>
                    <Table size='small'>
                      <TableHead>
                        <TableRow>
                          <TableCell>Action</TableCell>
                          <TableCell>Type</TableCell>
                          <TableCell>Expiry</TableCell>
                          <TableCell align='right'>Strike</TableCell>
                          <TableCell align='right'>Lots</TableCell>
                          <TableCell align='right'>Traded Price</TableCell>
                          <TableCell align='right'>Current Price</TableCell>
                          <TableCell align='right'>Delta</TableCell>
                          {lotSize && <TableCell align='right'>Entry Premium</TableCell>}
                          {lotSize && <TableCell align='right'>Current Premium</TableCell>}
                          {lotSize && <TableCell align='right'>PnL</TableCell>}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {legDisplay.map(l => {
                          const sign = l.action === 'B' ? -1 : 1;
                          const entryPrem = (l.tradedPrice != null && lotSize) ? sign * l.tradedPrice * l.lots * lotSize : null;
                          const currentPrem = (l.currentPrice != null && lotSize) ? sign * l.currentPrice * l.lots * lotSize : null;
                          // Align with backend payoff sign: positive when credit increases or debit decreases
                          const legPnl = (entryPrem != null && currentPrem != null) ? (entryPrem - currentPrem) : null;
                          return (
                            <TableRow key={l.key}>
                              <TableCell>{l.action}</TableCell>
                              <TableCell>{l.type}</TableCell>
                              <TableCell>{l.expiryShort}</TableCell>
                              <TableCell align='right'>{l.strike}</TableCell>
                              <TableCell align='right'>{l.lots}</TableCell>
                              <TableCell align='right'>{l.tradedPrice != null ? l.tradedPrice.toFixed(2) : '-'}</TableCell>
                              <TableCell align='right'>{l.currentPrice != null ? l.currentPrice.toFixed(2) : '-'}</TableCell>
                              <TableCell align='right'>
                                {(() => {
                                  // Show signed per-contract delta (do not multiply by lots or lot size)
                                  const posDelta = (l.delta != null) ? ((l.action === 'B' ? 1 : -1) * l.delta) : null;
                                  return posDelta != null ? (posDelta >= 0 ? `+${posDelta.toFixed(2)}` : posDelta.toFixed(2)) : '-';
                                })()}
                              </TableCell>
                              {lotSize && <TableCell align='right'>{entryPrem != null ? (entryPrem >= 0 ? `+${entryPrem.toFixed(2)}` : entryPrem.toFixed(2)) : '-'}</TableCell>}
                              {lotSize && <TableCell align='right'>{currentPrem != null ? (currentPrem >= 0 ? `+${currentPrem.toFixed(2)}` : currentPrem.toFixed(2)) : '-'}</TableCell>}
                              {lotSize && <TableCell align='right'>{legPnl != null ? (legPnl >= 0 ? `+${legPnl.toFixed(2)}` : legPnl.toFixed(2)) : '-'}</TableCell>}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </Paper>
                )}
                <PNLVisualizer showMargin={false} showCurrentPnL={true} onlyCurrentPnL={true} pnlLabel={'Realised PnL'} overrideCurrentPnL={tableSumPnL as any} />
              </Box>
            );
          }
          return (
            <Box>
              {/* Legs summary table */}
              {legDisplay.length > 0 && (
                <Paper sx={{ mb:2, p:1 }}>
                  <Typography variant='subtitle1' sx={{ mb:1 }}>Legs</Typography>
                  <Table size='small'>
                    <TableHead>
                      <TableRow>
                        <TableCell>Action</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell>Expiry</TableCell>
                        <TableCell align='right'>Strike</TableCell>
                        <TableCell align='right'>Lots</TableCell>
                        <TableCell align='right'>Traded Price</TableCell>
                        <TableCell align='right'>Current Price</TableCell>
                        <TableCell align='right'>Delta</TableCell>
                        {lotSize && <TableCell align='right'>Entry Premium</TableCell>}
                        {lotSize && <TableCell align='right'>Current Premium</TableCell>}
                        {lotSize && <TableCell align='right'>PnL</TableCell>}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {legDisplay.map(l => {
                        const sign = l.action === 'B' ? -1 : 1;
                        const entryPrem = (l.tradedPrice != null && lotSize) ? sign * l.tradedPrice * l.lots * lotSize : null;
                        const currentPrem = (l.currentPrice != null && lotSize) ? sign * l.currentPrice * l.lots * lotSize : null;
                        // Align with backend payoff sign: positive when credit increases or debit decreases
                        const legPnl = (entryPrem != null && currentPrem != null) ? (entryPrem - currentPrem) : null;
                        return (
                          <TableRow key={l.key}>
                            <TableCell>{l.action}</TableCell>
                            <TableCell>{l.type}</TableCell>
                            <TableCell>{l.expiryShort}</TableCell>
                            <TableCell align='right'>{l.strike}</TableCell>
                            <TableCell align='right'>{l.lots}</TableCell>
                            <TableCell align='right'>{l.tradedPrice != null ? l.tradedPrice.toFixed(2) : '-'}</TableCell>
                            <TableCell align='right'>{l.currentPrice != null ? l.currentPrice.toFixed(2) : '-'}</TableCell>
                            <TableCell align='right'>
                              {(() => {
                                // Show signed per-contract delta (do not multiply by lots or lot size)
                                const posDelta = (l.delta != null) ? ((l.action === 'B' ? 1 : -1) * l.delta) : null;
                                return posDelta != null ? (posDelta >= 0 ? `+${posDelta.toFixed(2)}` : posDelta.toFixed(2)) : '-';
                              })()}
                            </TableCell>
                            {lotSize && <TableCell align='right'>{entryPrem != null ? (entryPrem >= 0 ? `+${entryPrem.toFixed(2)}` : entryPrem.toFixed(2)) : '-'}</TableCell>}
                            {lotSize && <TableCell align='right'>{currentPrem != null ? (currentPrem >= 0 ? `+${currentPrem.toFixed(2)}` : currentPrem.toFixed(2)) : '-'}</TableCell>}
                            {lotSize && <TableCell align='right'>{legPnl != null ? (legPnl >= 0 ? `+${legPnl.toFixed(2)}` : legPnl.toFixed(2)) : '-'}</TableCell>}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Paper>
              )}
              {(() => {
                const lotSize = LOTSIZES.get(pos.underlying as any) || null;
                const tableSumPnL = (() => {
                  if (!lotSize) return undefined;
                  let sum = 0;
                  for (const l of legDisplay) {
                    const sign = l.action === 'B' ? -1 : 1;
                    const entryPrem = (l.tradedPrice != null) ? sign * l.tradedPrice * l.lots * lotSize : null;
                    const currentPrem = (l.currentPrice != null) ? sign * l.currentPrice * l.lots * lotSize : null;
                    if (entryPrem != null && currentPrem != null) sum += (entryPrem - currentPrem);
                  }
                  return sum;
                })();
                return (
                  <PNLVisualizer showMargin={false} showCurrentPnL={true} overrideCurrentPnL={tableSumPnL as any} />
                );
              })()}
            </Box>
          );
        })()}

          {/* Adjustment Drawer */}
          <Drawer anchor='right' open={adjustTradeOpen} onClose={()=>setAdjustTradeOpen(false)}>
            <Box sx={{ width: 420, p:2, display:'flex', flexDirection:'column', gap:2 }}>
              <Typography variant='h6'>Adjust Position</Typography>
              <Typography variant='subtitle2'>Exit existing legs</Typography>
              <Table size='small'>
                <TableHead>
                  <TableRow>
                    <TableCell>Exit</TableCell>
                    <TableCell>Action</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell align='right'>Strike</TableCell>
                    <TableCell align='right'>Lots</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {legDisplay.map(ld => (
                    <TableRow key={ld.key}>
                      <TableCell>
                        <Checkbox size='small' checked={!!exitLegMap[ld.key]} onChange={e=> setExitLegMap(m=>({ ...m, [ld.key]: e.target.checked }))} />
                      </TableCell>
                      <TableCell>{ld.action}</TableCell>
                      <TableCell>{ld.type}</TableCell>
                      <TableCell align='right'>{ld.strike}</TableCell>
                      <TableCell align='right'>{ld.lots}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Typography variant='subtitle2' sx={{ mt:1 }}>Add new legs</Typography>
              {newLegDrafts.map((n, idx) => (
                <Grid key={idx} container spacing={1} alignItems='center'>
                  <Grid item xs={12}>
                    <Typography variant='caption'>New leg #{idx+1}</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <FormControl fullWidth size='small'>
                      <InputLabel id={`adj-exp-${idx}`}>Expiry</InputLabel>
                      <Select labelId={`adj-exp-${idx}`} label='Expiry' value={n.expiry}
                        onChange={e=> setNewLegDrafts(a=> a.map((x,i)=> i===idx ? { ...x, expiry: e.target.value } : x))}>
                        {Object.keys(((data as any)?.grouped)||{}).map(ex=> <MenuItem key={ex} value={ex}>{ex}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={6}>
                    <TextField size='small' label='Spot price' value={n.spot} onChange={e=> setNewLegDrafts(a=> a.map((x,i)=> i===idx ? { ...x, spot: e.target.value } : x))} fullWidth />
                  </Grid>
                  <Grid item xs={4}>
                    <TextField size='small' label='Lots' type='number' value={n.lots} onChange={e=> setNewLegDrafts(a=> a.map((x,i)=> i===idx ? { ...x, lots: e.target.value } : x))} inputProps={{ min:1, step:1 }} fullWidth />
                  </Grid>
                  <Grid item xs={4}>
                    <FormControl fullWidth size='small'>
                      <InputLabel id={`adj-type-${idx}`}>Type</InputLabel>
                      <Select labelId={`adj-type-${idx}`} label='Type' value={n.type} onChange={e=> setNewLegDrafts(a=> a.map((x,i)=> i===idx ? { ...x, type: e.target.value as any } : x))}>
                        <MenuItem value='CE'>CE</MenuItem>
                        <MenuItem value='PE'>PE</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={4}>
                    <FormControl fullWidth size='small'>
                      <InputLabel id={`adj-act-${idx}`}>Action</InputLabel>
                      <Select labelId={`adj-act-${idx}`} label='Action' value={n.action} onChange={e=> setNewLegDrafts(a=> a.map((x,i)=> i===idx ? { ...x, action: e.target.value as any } : x))}>
                        <MenuItem value='B'>BUY</MenuItem>
                        <MenuItem value='S'>SELL</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>
              ))}
              <Box sx={{ display:'flex', gap:1 }}>
                <Button size='small' variant='outlined' disabled={newLegDrafts.length >= Object.values(exitLegMap).filter(Boolean).length} onClick={()=> setNewLegDrafts(a=> [...a, { expiry: (positions.find(p=>p.id===selectedId)?.expiry)||'', spot:'', lots:'1', type:'CE', action:'B' }])}>Add leg</Button>
                <Button size='small' variant='outlined' disabled={newLegDrafts.length===0} onClick={()=> setNewLegDrafts(a=> a.slice(0, -1))}>Remove last</Button>
              </Box>
              <Box sx={{ display:'flex', gap:1, mt:1 }}>
                <Button variant='contained' color='primary' onClick={executeAdjustment}>EXECUTE adjustment</Button>
                <Button variant='text' onClick={()=> setAdjustTradeOpen(false)}>Cancel</Button>
              </Box>
            </Box>
          </Drawer>
      </Paper>

      <Drawer anchor='right' open={adjustOpen} onClose={()=>setAdjustOpen(false)}>
        <Box sx={{ width: { xs: 320, md: 420 }, p:2 }}>
          <Typography variant='h6' sx={{ mb:2 }}>Adjust position</Typography>
          {noteLoading && (
            <Typography variant='body2' color='text.secondary'>Loading note…</Typography>
          )}
          {!noteLoading && noteError && (
            <Typography variant='body2' color='error'>{noteError}</Typography>
          )}
          {!noteLoading && !noteError && noteContent && !noteEditMode && (
            <>
              <Typography variant='subtitle2' gutterBottom>When things go against</Typography>
              <Box component='pre' sx={{ whiteSpace:'pre-wrap', bgcolor:'background.default', p:1, borderRadius:1, maxHeight: 360, overflow:'auto', fontSize: 13 }}>
                {noteContent}
              </Box>
              <Box sx={{ display:'flex', gap:1, mt:1 }}>
                <Button size='small' variant='text' onClick={()=>{ setNoteEditMode(true); setNoteDraft(noteContent || ''); }}>Edit note</Button>
                <Typography variant='caption' color='text.secondary' sx={{ alignSelf:'center' }}>Or edit on server: Data/strategy-notes/UNDERLYING/StrategyName.txt</Typography>
              </Box>
            </>
          )}
          {!noteLoading && !noteError && noteEditMode && (
            <>
              <Typography variant='subtitle2' gutterBottom>Edit adjustment note</Typography>
              <Box sx={{ display:'flex', flexDirection:'column', gap:1 }}>
                <textarea
                  value={noteDraft}
                  onChange={e=>{
                    const next = e.target.value;
                    setNoteDraft(next.length > NOTE_MAX ? next.slice(0, NOTE_MAX) : next);
                  }}
                  maxLength={NOTE_MAX}
                  style={{ width:'100%', height:240, padding:8, fontFamily:'inherit', fontSize:13 }}
                />
                <Typography variant='caption' color='text.secondary' sx={{ alignSelf:'flex-end' }}>{noteDraft.length}/{NOTE_MAX}</Typography>
                <Box sx={{ display:'flex', gap:1, justifyContent:'flex-end' }}>
                  <Button size='small' onClick={()=>{ setNoteEditMode(false); }}>Cancel</Button>
                  <Button size='small' variant='contained' onClick={async()=>{
                    const pos = positions.find(p => p.id === selectedId);
                    if (!pos) return;
                    const ok = await saveStrategyNote(pos.underlying, pos.name, noteDraft);
                    if (ok) { setNoteContent(noteDraft); setNoteEditMode(false); setToastPack(p=>[...p,{ key: Date.now(), type:'success', message:`Note saved (${Math.min(noteDraft.length, NOTE_MAX)}/${NOTE_MAX})` }]); } else { setToastPack(p=>[...p,{ key: Date.now(), type:'error', message:'Failed to save note' }]); }
                    setOpen(true);
                  }}>Save</Button>
                </Box>
              </Box>
            </>
          )}
          {!noteLoading && !noteError && !noteContent && (
            <Box sx={{ display:'flex', flexDirection:'column', gap:1 }}>
              <Typography variant='body2' color='text.secondary'>No note available.</Typography>
              <Button size='small' variant='text' onClick={()=>{ setNoteEditMode(true); setNoteDraft(''); }}>Add note</Button>
            </Box>
          )}
        </Box>
      </Drawer>
    </Box>
  );
};

export default Positions;
