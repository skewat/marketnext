import { useMemo, useState, useContext, useEffect } from 'react';
import { Box, Grid, Typography, TextField, Checkbox, FormControlLabel, Button, Paper, Select, MenuItem, FormControl, InputLabel, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useSelector, useDispatch } from 'react-redux';
import { getUnderlying, setSBOptionLegs, setSBExpiry, setSBFuturesPerExpiry, setSBATMIVsPerExpiry, setSBUnderlyingPrice, setSBTargetUnderlyingPrice, setSBTargetDateTime } from '../../features/selected/selectedSlice';
import { useOpenInterestQuery } from '../../app/services/openInterest';
import { ToastContext } from '../../contexts/ToastContextProvider';
import PNLVisualizer from '../StrategyBuilder/PNLVisualizer';
import { getTargetDateTime } from '../../utils';
import type { OptionLeg as OptionLegType } from '../../features/selected/types';

// Types
type ScheduledLeg = { id:string; expiry:string; offsetFromATM:number; optionType:'CE'|'PE'; action:'B'|'S'; strike?: number; premium?: number | null };

type SchedulerConfig = {
  // Core deploy settings
  selectedStrategyName?: string;
  deployMode: 'now' | 'schedule';
  deployDay: string | null; // Today | Mon..Sun
  deployTime: string | null; // HH:MM (5-min steps)
  deployExpiry: 'next-weekly' | 'next-monthly' | string | null;
  // Risk controls
  profitTargetPct: string;
  stopLossPct: string;
  stopLossAbs?: string;
  trailingEnabled: boolean;
  exitMode?: 'stopLossPct' | 'stopLossAbs' | 'onExpiry';
  // Legacy fields (kept for storage compatibility; not shown)
  scheduleEnabled: boolean;
  startTime: string;
  endTime: string;
  days: string[];
  legs: ScheduledLeg[];
};

// Defaults & Storage
const DEFAULT_CONFIG: SchedulerConfig = {
  profitTargetPct: '2',
  stopLossPct: '1',
  trailingEnabled: false,
  scheduleEnabled: true,
  startTime: '09:20',
  endTime: '15:25',
  days: ['Mon','Tue','Wed','Thu','Fri'],
  legs: [],
  selectedStrategyName: '',
  deployMode: 'now',
  deployDay: 'Today',
  deployTime: '09:20',
  deployExpiry: null,
  stopLossAbs: '',
  exitMode: 'onExpiry',
};
const STORAGE_KEY = 'marketnext.schedulerConfig';

const Scheduler = () => {
  // External state
  const dispatch = useDispatch();
  const underlying = useSelector(getUnderlying);
  const { data } = useOpenInterestQuery({ underlying });
  const { setOpen, setToastPack } = useContext(ToastContext);

  // Local state
  const [cfg, setCfg] = useState<SchedulerConfig>(()=>{
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) } as SchedulerConfig;
    } catch {}
    return DEFAULT_CONFIG;
  });
  const [isDeploying, setIsDeploying] = useState(false);
  const [selectedStrategyName, setSelectedStrategyName] = useState<string>(cfg.selectedStrategyName || '');

  // Saved strategies loader from backend (scoped by underlying)
  type SavedStrategy = { name:string; underlying:string; expiry:string|null; version?:2; optionLegs:any[]; updatedAt:number; type?: 'user'|'default'; creator?: string };
  const apiBase = (import.meta.env.MODE === 'development' ? '/api' : (import.meta as any).env.VITE_API_BASE_URL);
  const fetchSavedMap = async (u: string): Promise<Record<string, SavedStrategy>> => {
    try {
      const url = `${apiBase}/strategies?underlying=${encodeURIComponent(u)}`;
      const res = await fetch(url);
      if (!res.ok) return {};
      return await res.json();
    } catch {
      return {};
    }
  };
  const [savedMap, setSavedMap] = useState<Record<string, SavedStrategy>>({});
  const [savedNames, setSavedNames] = useState<string[]>([]);

  // Handlers
  const handleChange = (k: keyof SchedulerConfig, v:any)=> setCfg(p=>({ ...p, [k]: v }));
  const resetConfig = ()=> { setCfg(DEFAULT_CONFIG); setSelectedStrategyName(''); };

  const postPosition = async (payload: any) => {
    const url = `${apiBase}/positions`;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error('Failed to save position');
    return res.json();
  };

  // Build absolute legs for current selection using OI snapshot
  const buildLegsForSelected = (): OptionLegType[] => {
    const d: any = data;
    if (!d || !selectedStrategyName || !selectedActualExpiry) return [];
    const grouped = d.grouped;
    const g = grouped?.[selectedActualExpiry];
    const rows = (g?.data || []) as any[];
    const strikes: number[] = rows.map((r:any)=> r.strikePrice || r.strike).filter((v:any)=> typeof v==='number');
    const fut = g?.syntheticFuturesPrice ?? null;
    const rowByStrike = new Map<number, any>();
    for (const r of rows) { const k = (r.strikePrice ?? r.strike) as number; if (typeof k === 'number') rowByStrike.set(k, r); }
    const saved = (savedMap[selectedStrategyName] || { optionLegs: [] }) as any;
    const legs: OptionLegType[] = [];
    for (const item of (saved.optionLegs || []) as any[]) {
      let strike: number | null = null;
      if (item?.strikeRef?.kind === 'ATM' && fut !== null && strikes.length) {
        const nearest = strikes.reduce((prev,curr)=> Math.abs(curr-fut) < Math.abs(prev-fut) ? curr : prev, strikes[0]);
        const atmIdx = Math.max(0, strikes.findIndex((s:number)=>s===nearest));
        let idx = atmIdx + (item.strikeRef.offset as number);
        if (idx < 0) idx = 0; if (idx > strikes.length-1) idx = strikes.length-1;
        strike = strikes[idx];
      } else if (typeof item?.strike === 'number') {
        if (strikes.length) { let best = strikes[0]; let bestDiff = Math.abs(best - item.strike); for (const s of strikes){ const d = Math.abs(s - item.strike); if (d < bestDiff){ bestDiff = d; best = s; } } strike = best; } else { strike = item.strike; }
      }
      if (strike !== null) {
        const row = rowByStrike.get(strike);
        const price = item.type === 'CE' ? (row?.CE?.lastPrice ?? null) : (row?.PE?.lastPrice ?? null);
        const iv = row?.iv ?? null;
        legs.push({ active: item.active ?? true, action: item.action, expiry: selectedActualExpiry, strike, type: item.type, lots: item.lots, price, iv } as OptionLegType);
      }
    }
    return legs;
  };

  const handleDeploy = async ()=> {
    if (!selectedStrategyName) {
      setToastPack(p=>[...p,{key:Date.now(),type:'error',message:'Select a saved strategy to deploy'}]); setOpen(true); return;
    }
    // Exit condition validation based on selected mode
    const pct = parseFloat(cfg.stopLossPct || '');
    const abs = parseFloat((cfg.stopLossAbs || '').toString());
    if ((cfg.exitMode || 'onExpiry') === 'stopLossPct') {
      if (!(+pct > 0)) { setToastPack(p=>[...p,{ key: Date.now(), type: 'error', message: 'Set Stop loss % (> 0)' }]); setOpen(true); return; }
    } else if ((cfg.exitMode || 'onExpiry') === 'stopLossAbs') {
      if (!(+abs > 0)) { setToastPack(p=>[...p,{ key: Date.now(), type: 'error', message: 'Set Stop loss abs (> 0)' }]); setOpen(true); return; }
    }
    const expiry = selectedActualExpiry || cfg.deployExpiry || '';
    if (!expiry) { setToastPack(p=>[...p,{key:Date.now(),type:'error',message:'Select an expiry'}]); setOpen(true); return; }
    if (cfg.deployMode === 'schedule') {
      // Persist scheduled deploy settings automatically
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...cfg, selectedStrategyName }));
      if (!cfg.deployDay || !cfg.deployTime) { setToastPack(p=>[...p,{key:Date.now(),type:'error',message:'Select day and time for scheduled deploy'}]); setOpen(true); return; }
      setIsDeploying(true);
      setToastPack(p=>[...p,{key:Date.now(),type:'info',message:`Scheduled deploy: ${selectedStrategyName} on ${cfg.deployDay} at ${cfg.deployTime}`}]);
      try {
        const legs = buildLegsForSelected();
        await postPosition({ name: selectedStrategyName, underlying, expiry, legs, status: 'scheduled', createdAt: Date.now(), schedule: { day: cfg.deployDay!, time: cfg.deployTime! }, exit: { mode: (cfg.exitMode||'onExpiry') as any, stopLossPct: cfg.stopLossPct, stopLossAbs: cfg.stopLossAbs, profitTargetPct: cfg.profitTargetPct, trailingEnabled: cfg.trailingEnabled } });
      } catch (e) {
        setToastPack(p=>[...p,{key:Date.now(),type:'error',message:'Failed to schedule position'}]);
      } finally {
        setIsDeploying(false);
      }
      setOpen(true);
      return;
    }
    setIsDeploying(true);
    setToastPack(p=>[...p,{key:Date.now(),type:'success',message:`Deploying now: ${selectedStrategyName}`}]);
    // Save as an open position to backend
    try {
      const legs = buildLegsForSelected();
      await postPosition({ name: selectedStrategyName, underlying, expiry, legs, status: 'open', createdAt: Date.now(), exit: { mode: (cfg.exitMode||'onExpiry') as any, stopLossPct: cfg.stopLossPct, stopLossAbs: cfg.stopLossAbs, profitTargetPct: cfg.profitTargetPct, trailingEnabled: cfg.trailingEnabled } });
    } catch (e) {
      setToastPack(p=>[...p,{key:Date.now(),type:'error',message:'Failed to deploy position'}]);
    } finally {
      setIsDeploying(false);
    }
    setOpen(true);
  };

  // Manual recompute: rebuild legs with latest price/iv and bump target datetime
  const handleRecalculate = () => {
    if (!data || !selectedStrategyName || !selectedActualExpiry) {
      setToastPack(p=>[...p,{ key: Date.now(), type: 'error', message: 'Select a strategy and expiry first' }]);
      setOpen(true);
      return;
    }
    const { grouped, underlyingValue } = data as any;
    const g = grouped?.[selectedActualExpiry];
    const rows = (g?.data || []) as any[];
    const strikes: number[] = rows.map((r:any) => r.strikePrice || r.strike).filter((v: any)=> typeof v==='number');
    const fut = g?.syntheticFuturesPrice ?? null;
    const rowByStrike = new Map<number, any>();
    for (const r of rows) {
      const k = (r.strikePrice ?? r.strike) as number;
      if (typeof k === 'number') rowByStrike.set(k, r);
    }
    const saved = (savedMap[selectedStrategyName] || { optionLegs: [] }) as any;
    const absLegs: OptionLegType[] = [];
    for (const item of (saved.optionLegs || []) as any[]) {
      let strike: number | null = null;
      if (item?.strikeRef?.kind === 'ATM' && fut !== null && strikes.length) {
        const nearest = strikes.reduce((prev,curr)=> Math.abs(curr-fut) < Math.abs(prev-fut) ? curr : prev, strikes[0]);
        const atmIdx = Math.max(0, strikes.findIndex(s=>s===nearest));
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
        absLegs.push({
          active: item.active ?? true,
          action: item.action,
          expiry: selectedActualExpiry,
          strike,
          type: item.type,
          lots: item.lots,
          price,
          iv,
        } as OptionLegType);
      }
    }
    // Update SB stores and bump target datetime to trigger recompute
    dispatch(setSBUnderlyingPrice(underlyingValue));
    dispatch(setSBOptionLegs({ type: 'set', optionLegs: absLegs } as any));
    dispatch(setSBExpiry(selectedActualExpiry));
    dispatch(setSBTargetDateTime({ value: getTargetDateTime().toISOString(), autoUpdate: true } as any));
    setToastPack(p=>[...p,{ key: Date.now(), type: 'success', message: 'Recalculated with latest prices' }]);
    setOpen(true);
  };

  // Refresh saved names on underlying change
  useEffect(()=>{
    (async ()=>{
      const map = await fetchSavedMap(underlying);
      setSavedMap(map);
      const names = Object.keys(map).sort();
      setSavedNames(names);
      setSelectedStrategyName(prev => prev && map[prev] ? prev : '');
    })();
  }, [underlying]);

  // Allowed schedule days and time options within market hours (IST): 09:15–15:30
  const allowedDays = useMemo(()=>['Today','Mon','Tue','Wed','Thu','Fri'], []);
  const timeOptions = useMemo(()=>{
    const start = 9*60 + 15; // 09:15
    const end = 15*60 + 30; // 15:30
    const out: string[] = [];
    for (let m = start; m <= end; m += 5) {
      const h = Math.floor(m / 60).toString().padStart(2,'0');
      const mm = (m % 60).toString().padStart(2,'0');
      out.push(`${h}:${mm}`);
    }
    return out;
  }, []);

  // Clamp stored day/time to allowed ranges when scheduling
  useEffect(()=>{
    if (cfg.deployMode !== 'schedule') return;
    if (!allowedDays.includes(cfg.deployDay || '')) {
      setCfg(p=>({ ...p, deployDay: 'Today' }));
    }
    if (!timeOptions.includes(cfg.deployTime || '')) {
      setCfg(p=>({ ...p, deployTime: timeOptions[0] || '' }));
    }
  }, [cfg.deployMode, cfg.deployDay, cfg.deployTime, allowedDays, timeOptions]);

  // Expiry helpers
  const availableExpiries: string[] = useMemo(()=>{
    const ex = (data as any)?.filteredExpiries as string[] | undefined;
    if (ex && Array.isArray(ex) && ex.length) return ex;
    const grouped = (data as any)?.grouped;
    return grouped ? Object.keys(grouped) : [];
  }, [data]);

  const resolveDeployExpiry = (sel: SchedulerConfig['deployExpiry'], expiries: string[]): string | null => {
    if (!expiries || expiries.length === 0) return null;
    if (!sel || sel === '') return expiries[0];
    if (sel === 'next-weekly' || sel === 'next-monthly') {
      // Parse dates
      const parsed = expiries.map(e => ({ e, d: new Date(e) })).sort((a,b)=> a.d.getTime()-b.d.getTime());
      if (parsed.length === 0) return null;
      const firstMonth = parsed[0].d.getMonth();
      const sameMonth = parsed.filter(x => x.d.getMonth() === firstMonth);
      const monthly = sameMonth[sameMonth.length-1]?.e || parsed[parsed.length-1].e;
      if (sel === 'next-monthly') return monthly;
      // next-weekly: earliest before monthly in the same month, else earliest overall
      const weekly = sameMonth.length > 1 ? sameMonth[0].e : parsed[0].e;
      return weekly;
    }
    // specific expiry chosen
    return sel;
  };

  const selectedActualExpiry = useMemo(()=> resolveDeployExpiry(cfg.deployExpiry, availableExpiries), [cfg.deployExpiry, availableExpiries]);

  // Sync Strategy Builder state to render shared PNL visualizer when a strategy is selected
  useEffect(()=>{
    if (!data || !selectedStrategyName || !selectedActualExpiry) return;
    // Populate SB maps and underlying
    const { grouped, underlyingValue } = data as any;
    const atmIVsPerExpiry: { [k:string]: number } = {};
    const futuresPerExpiry: { [k:string]: number } = {};
    Object.keys(grouped || {}).forEach(key => {
      atmIVsPerExpiry[key] = grouped[key]?.atmIV || 0;
      futuresPerExpiry[key] = grouped[key]?.syntheticFuturesPrice || 0;
    });
    dispatch(setSBUnderlyingPrice(underlyingValue));
    dispatch(setSBATMIVsPerExpiry(atmIVsPerExpiry as any));
    dispatch(setSBFuturesPerExpiry(futuresPerExpiry as any));
    // Target values (auto)
    dispatch(setSBTargetUnderlyingPrice({ value: underlyingValue, autoUpdate: true } as any));
    dispatch(setSBTargetDateTime({ value: getTargetDateTime().toISOString(), autoUpdate: true } as any));

    // Build absolute legs for SB from saved strategy using selected expiry, and inject latest price/iv
    type SavedStrategy = { optionLegs: any[] };
    const saved = (savedMap[selectedStrategyName] || {}) as SavedStrategy;
    const g = grouped?.[selectedActualExpiry];
    const rows = (g?.data || []) as any[];
    const strikes: number[] = rows.map(r => r.strikePrice || r.strike).filter((v)=> typeof v==='number');
    const fut = g?.syntheticFuturesPrice ?? null;
    const rowByStrike = new Map<number, any>();
    for (const r of rows) {
      const k = (r.strikePrice ?? r.strike) as number;
      if (typeof k === 'number') rowByStrike.set(k, r);
    }
    const absLegs: OptionLegType[] = [];
    for (const item of (saved.optionLegs || []) as any[]) {
      let strike: number | null = null;
      if (item?.strikeRef?.kind === 'ATM' && fut !== null && strikes.length) {
        // reconstruct by offset
        const nearest = strikes.reduce((prev,curr)=> Math.abs(curr-fut) < Math.abs(prev-fut) ? curr : prev, strikes[0]);
        const atmIdx = Math.max(0, strikes.findIndex(s=>s===nearest));
        let idx = atmIdx + (item.strikeRef.offset as number);
        if (idx < 0) idx = 0;
        if (idx > strikes.length-1) idx = strikes.length-1;
        strike = strikes[idx];
      } else if (typeof item?.strike === 'number') {
        // legacy absolute; keep closest match
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
        absLegs.push({
          active: item.active ?? true,
          action: item.action,
          expiry: selectedActualExpiry,
          strike: strike,
          type: item.type,
          lots: item.lots,
          price: price,
          iv: iv,
        } as OptionLegType);
      }
    }
    dispatch(setSBOptionLegs({ type: 'set', optionLegs: absLegs } as any));
    dispatch(setSBExpiry(selectedActualExpiry));
  }, [data, selectedStrategyName, selectedActualExpiry, underlying]);

  // Build a preview of legs as offsets for the selected strategy (read-only)
  const legsPreview: ScheduledLeg[] = useMemo(()=>{
    if (!selectedStrategyName) return [];
    const useExpiry = selectedActualExpiry;
    if (!useExpiry) return [];
    const saved = savedMap[selectedStrategyName];
    if (!saved) return [];
    const g = (data as any)?.grouped?.[useExpiry];
    const rows = (g?.data || []) as any[];
    const strikes: number[] = rows.map(r => r.strikePrice || r.strike).filter((v)=> typeof v==='number');
    const fut = g?.syntheticFuturesPrice ?? null;
    const rowByStrike = new Map<number, any>();
    for (const r of rows) {
      const k = (r.strikePrice ?? r.strike) as number;
      if (typeof k === 'number') rowByStrike.set(k, r);
    }
    const result: ScheduledLeg[] = [];
    for (const item of saved.optionLegs as any[]) {
      if (item?.strikeRef?.kind === 'ATM') {
        let strike: number | undefined = undefined;
        let premium: number | null | undefined = undefined;
        if (strikes.length && fut !== null) {
          const nearest = strikes.reduce((prev,curr)=> Math.abs(curr-fut) < Math.abs(prev-fut) ? curr : prev, strikes[0]);
          const atmIdx = Math.max(0, strikes.findIndex(s=>s===nearest));
          let idx = atmIdx + (item.strikeRef.offset as number);
          if (idx < 0) idx = 0;
          if (idx > strikes.length-1) idx = strikes.length-1;
          strike = strikes[idx];
          const row = rowByStrike.get(strike);
          premium = item.type === 'CE' ? row?.CE?.lastPrice ?? null : row?.PE?.lastPrice ?? null;
        }
        result.push({ id: item.id || Math.random().toString(36).slice(2), expiry: useExpiry, offsetFromATM: item.strikeRef.offset, optionType: item.type, action: item.action, strike, premium: premium ?? null });
      } else if (item && typeof item.strike === 'number') {
        // Legacy absolute-strike: derive offset against the selected expiry
        if (!strikes.length || fut === null) continue;
        const nearest = strikes.reduce((prev,curr)=> Math.abs(curr-fut) < Math.abs(prev-fut) ? curr : prev, strikes[0]);
        const atmIdx = Math.max(0, strikes.findIndex(s=>s===nearest));
        let legIdx = strikes.findIndex(s=>s===item.strike);
        if (legIdx < 0) {
          let bestIdx = 0; let bestDiff = Number.POSITIVE_INFINITY;
          for (let i=0;i<strikes.length;i++){ const d = Math.abs(strikes[i]-item.strike); if (d<bestDiff){bestDiff=d; bestIdx=i;} }
          legIdx = bestIdx;
        }
        const strike = strikes[legIdx];
        const row = rowByStrike.get(strike);
        const premium = item.type === 'CE' ? row?.CE?.lastPrice ?? null : row?.PE?.lastPrice ?? null;
        result.push({ id: Math.random().toString(36).slice(2), expiry: useExpiry, offsetFromATM: legIdx - atmIdx, optionType: item.type, action: item.action, strike, premium });
      }
    }
    return result;
  }, [selectedStrategyName, selectedActualExpiry, underlying, data, savedMap]);

  return (
    <Box sx={{ p:{xs:2, md:3}, display:'flex', flexDirection:'column', gap:2 }}>
      <Typography variant='h5' sx={{ mb:1 }}>Strategy deploy</Typography>
      <Paper sx={{ p:2, display:'flex', flexDirection:'column', gap:3 }}>
        {/* Strategy Selection (top) */}
        <Box>
          <Typography variant='subtitle1' sx={{ fontWeight:600, mb:1 }}>Select saved strategy</Typography>
          <Grid container spacing={1.5}>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth size='small'>
                <InputLabel id='saved-strategy-label'>Saved strategy</InputLabel>
                <Select labelId='saved-strategy-label' label='Saved strategy' value={selectedStrategyName} onChange={e=>{ const v = e.target.value as string; setSelectedStrategyName(v); setCfg(p=>({...p, selectedStrategyName:v })); }}>
                  {savedNames.length===0 && <MenuItem value='' disabled>No saved strategies</MenuItem>}
                  {savedNames.map(n=> <MenuItem key={n} value={n}>{n}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth size='small'>
                <InputLabel id='deploy-expiry-label'>Expiry</InputLabel>
                <Select
                  labelId='deploy-expiry-label'
                  label='Expiry'
                  value={cfg.deployExpiry || ''}
                  onChange={e=>handleChange('deployExpiry', e.target.value)}
                >
                  <MenuItem value={'next-weekly'}>Next weekly</MenuItem>
                  <MenuItem value={'next-monthly'}>Next monthly</MenuItem>
                  {(
                    (data as any)?.filteredExpiries
                      ? (data as any).filteredExpiries as string[]
                      : Object.keys(((data as any)?.grouped) || {})
                  ).map((ex: string) => (
                    <MenuItem key={ex} value={ex}>{ex}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              {(cfg.deployExpiry === 'next-weekly' || cfg.deployExpiry === 'next-monthly') && selectedActualExpiry && (
                <Typography variant='caption' color='text.secondary' sx={{ mt: 0.5, display: 'block' }}>
                  Resolves to {selectedActualExpiry}
                </Typography>
              )}
            </Grid>
            {legsPreview.length>0 && (
              <Grid item xs={12}>
                <Box sx={{ border:1, borderColor:'divider', borderRadius:1, overflow:'hidden' }}>
                  <Box sx={{ display:'flex', p:0.75, backgroundColor:'background.default', fontSize:11, fontWeight:600 }}>
                    <Box sx={{ flex:1 }}>Expiry</Box>
                    <Box sx={{ width:130 }}>Strike Ref</Box>
                    <Box sx={{ width:100 }}>Strike</Box>
                    <Box sx={{ width:90 }}>Premium</Box>
                    <Box sx={{ width:60 }}>Type</Box>
                    <Box sx={{ width:60 }}>Action</Box>
                  </Box>
                  {legsPreview.map(leg => (
                    <Box key={leg.id} sx={{ display:'flex', alignItems:'center', px:0.75, py:0.5, fontSize:11, borderTop:1, borderTopColor:'divider' }}>
                      <Box sx={{ flex:1 }}>{leg.expiry}</Box>
                      <Box sx={{ width:130 }}>{leg.offsetFromATM===0 ? 'ATM' : (leg.offsetFromATM>0 ? `ATM+${leg.offsetFromATM}` : `ATM${leg.offsetFromATM}`)}</Box>
                      <Box sx={{ width:100 }}>{typeof leg.strike==='number' ? leg.strike : '-'}</Box>
                      <Box sx={{ width:90 }}>{typeof leg.premium==='number' ? leg.premium.toFixed(2) : '-'}</Box>
                      <Box sx={{ width:60 }}>{leg.optionType}</Box>
                      <Box sx={{ width:60 }}>{leg.action==='B'?'BUY':'SELL'}</Box>
                    </Box>
                  ))}
                </Box>
              </Grid>
            )}
          </Grid>
        </Box>

        {/* Deploy controls + button */}
        <Box>
          <Typography variant='subtitle1' sx={{ fontWeight:600, mb:1 }}>Deploy</Typography>
          <Grid container spacing={1.5} alignItems='center'>
            <Grid item>
              <ToggleButtonGroup value={cfg.deployMode} exclusive onChange={(_,v)=> v && handleChange('deployMode', v)} size='small'>
                <ToggleButton value='now'>Deploy now</ToggleButton>
                <ToggleButton value='schedule'>Schedule deploy at</ToggleButton>
              </ToggleButtonGroup>
            </Grid>
            <Grid item xs={12} md={3}>
              <FormControl fullWidth size='small'>
                <InputLabel id='deploy-day-label'>Day</InputLabel>
                <Select labelId='deploy-day-label' label='Day' value={cfg.deployDay || ''} onChange={e=>handleChange('deployDay', e.target.value)} disabled={cfg.deployMode!=='schedule'}>
                  {allowedDays.map(d=> <MenuItem key={d} value={d}>{d}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={3}>
              <FormControl fullWidth size='small'>
                <InputLabel id='deploy-time-label'>Time</InputLabel>
                <Select labelId='deploy-time-label' label='Time' value={cfg.deployTime || ''} onChange={e=>handleChange('deployTime', e.target.value)} disabled={cfg.deployMode!=='schedule'}>
                  {timeOptions.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs='auto'>
              <Button variant='contained' color='success' onClick={handleDeploy} disabled={isDeploying || !selectedStrategyName} size='small'>
                {cfg.deployMode === 'now' ? 'Deploy now' : 'Schedule'}
              </Button>
            </Grid>
            <Grid item xs='auto'>
              <Button variant='outlined' onClick={handleRecalculate} size='small' disabled={!selectedStrategyName || !selectedActualExpiry}>Recalculate</Button>
            </Grid>
            <Grid item xs='auto'>
              <Button variant='outlined' onClick={resetConfig} size='small'>Reset</Button>
            </Grid>
          </Grid>
          {!selectedStrategyName && <Typography variant='caption' color='error' sx={{ mt:1, display:'block' }}>Select a saved strategy to enable deploy</Typography>}
        </Box>

        {/* Exit conditions */}
        <Box>
          <Typography variant='subtitle1' sx={{ fontWeight:600, mb:1 }}>Exit conditions</Typography>
          <Grid container spacing={1.5}>
            <Grid item xs={12} md={2}><TextField size='small' label='Profit target %' type='number' fullWidth value={cfg.profitTargetPct} onChange={e=>handleChange('profitTargetPct', e.target.value)} inputProps={{min:0,step:'any'}} /></Grid>
            <Grid item xs={12} md={2}><TextField size='small' label='Stop loss %' type='number' fullWidth value={cfg.stopLossPct} onChange={e=>handleChange('stopLossPct', e.target.value)} inputProps={{min:0,step:'any'}} disabled={(cfg.exitMode||'onExpiry')!=='stopLossPct'} /></Grid>
            <Grid item xs={12} md={2}><TextField size='small' label='Stop loss abs' type='number' fullWidth value={cfg.stopLossAbs} onChange={e=>handleChange('stopLossAbs', e.target.value)} inputProps={{min:0,step:'any'}} disabled={(cfg.exitMode||'onExpiry')!=='stopLossAbs'} /></Grid>
            <Grid item xs={12} md={3}>
              <ToggleButtonGroup value={cfg.exitMode || 'onExpiry'} exclusive onChange={(_,v)=> v && handleChange('exitMode', v)} size='small' color='primary'>
                <ToggleButton value='stopLossPct'>SL %</ToggleButton>
                <ToggleButton value='stopLossAbs'>SL abs</ToggleButton>
                <ToggleButton value='onExpiry'>On expiry</ToggleButton>
              </ToggleButtonGroup>
            </Grid>
            <Grid item xs={12}><FormControlLabel control={<Checkbox checked={cfg.trailingEnabled} onChange={e=>handleChange('trailingEnabled', e.target.checked)} disabled={(cfg.exitMode||'onExpiry')==='onExpiry'} />} label='Enable Trailing Stop Loss' /></Grid>
          </Grid>
        </Box>

        {/* Payoff visualizer (shared component) at bottom */}
        {selectedStrategyName && (
          <Box>
            <PNLVisualizer />
          </Box>
        )}
      </Paper>
    </Box>
  );
};

export default Scheduler;
