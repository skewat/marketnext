import { useEffect, useMemo, useState, useContext } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Box, Paper, Typography, Grid, FormControl, InputLabel, Select, MenuItem, Button, Drawer, Table, TableHead, TableRow, TableCell, TableBody } from '@mui/material';
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
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteContent, setNoteContent] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteEditMode, setNoteEditMode] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const NOTE_MAX = 1000;

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
        const price = leg.type === 'CE' ? (row?.CE?.lastPrice ?? null) : (row?.PE?.lastPrice ?? null);
        const iv = row?.iv ?? null;
        return { ...leg, active: (leg as any).active ?? true, expiry: useExpiry, strike, price, iv } as OptionLegType;
      });
      dispatch(setSBOptionLegs({ type: 'set', optionLegs: normalizedLegs } as any));
      dispatch(setSBExpiry(useExpiry));
    })();
  }, [selectedId, data]);

  // Build leg display data: traded vs current price for each leg
  const legDisplay = useMemo(() => {
    if (!selectedId || !data) return [] as Array<{ key: string; action: 'B'|'S'; type: 'CE'|'PE'; strike: number; lots: number; tradedPrice: number | null; currentPrice: number | null; tradedAt?: number; premiumAtEntry?: number | null; expiryShort: string }>; 
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
      const tradedPrice = (typeof leg.tradedPrice === 'number') ? leg.tradedPrice : (typeof (leg as any).price === 'number' ? (leg as any).price : null);
      const premiumAtEntry = typeof leg.premiumAtEntry === 'number' ? leg.premiumAtEntry : undefined;
      const expFull = (leg.expiry || useExpiry) as string;
      const expiryShort = typeof expFull === 'string' ? expFull.replace(/-\d{4}$/,'') : '';
      return { key: `${idx}-${leg.type}-${strike}`, action: leg.action, type: leg.type, strike, lots: leg.lots, tradedPrice, currentPrice, tradedAt: leg.tradedAt, premiumAtEntry, expiryShort };
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

  const handleExit = async () => {
    if (!selectedId) return;
    const updated = await patchPosition(selectedId, { status: 'closed' });
    if (updated) {
      setPositions(prev => prev.map(p => p.id === selectedId ? (updated as Position) : p));
      setToastPack(p=>[...p,{ key: Date.now(), type: 'success', message: 'Position exited' }]);
    } else {
      setToastPack(p=>[...p,{ key: Date.now(), type: 'error', message: 'Failed to exit position' }]);
    }
    setOpen(true);
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
            <Button variant='contained' color='error' size='small' disabled={!selectedId} onClick={handleExit}>Exit</Button>
          </Grid>
          <Grid item xs='auto'>
            <Button variant='outlined' size='small' disabled={!selectedId} onClick={()=>setAdjustOpen(true)}>Adjust</Button>
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
                          const legPnl = (entryPrem != null && currentPrem != null) ? (currentPrem - entryPrem) : null;
                          return (
                            <TableRow key={l.key}>
                              <TableCell>{l.action}</TableCell>
                              <TableCell>{l.type}</TableCell>
                              <TableCell>{l.expiryShort}</TableCell>
                              <TableCell align='right'>{l.strike}</TableCell>
                              <TableCell align='right'>{l.lots}</TableCell>
                              <TableCell align='right'>{l.tradedPrice != null ? l.tradedPrice.toFixed(2) : '-'}</TableCell>
                              <TableCell align='right'>{l.currentPrice != null ? l.currentPrice.toFixed(2) : '-'}</TableCell>
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
                <PNLVisualizer showMargin={false} showCurrentPnL={true} onlyCurrentPnL={true} pnlLabel={'Realised PnL'} />
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
                        const legPnl = (entryPrem != null && currentPrem != null) ? (currentPrem - entryPrem) : null;
                        return (
                          <TableRow key={l.key}>
                            <TableCell>{l.action}</TableCell>
                            <TableCell>{l.type}</TableCell>
                            <TableCell>{l.expiryShort}</TableCell>
                            <TableCell align='right'>{l.strike}</TableCell>
                            <TableCell align='right'>{l.lots}</TableCell>
                            <TableCell align='right'>{l.tradedPrice != null ? l.tradedPrice.toFixed(2) : '-'}</TableCell>
                            <TableCell align='right'>{l.currentPrice != null ? l.currentPrice.toFixed(2) : '-'}</TableCell>
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
              <PNLVisualizer showMargin={false} showCurrentPnL={true} />
            </Box>
          );
        })()}
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
