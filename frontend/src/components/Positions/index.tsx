import { useEffect, useMemo, useState, useContext } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Box, Paper, Typography, Grid, FormControl, InputLabel, Select, MenuItem, Button, Drawer } from '@mui/material';
import { getUnderlying, setSBATMIVsPerExpiry, setSBFuturesPerExpiry, setSBUnderlyingPrice, setSBTargetUnderlyingPrice, setSBTargetDateTime, setSBOptionLegs, setSBExpiry } from '../../features/selected/selectedSlice';
import { useOpenInterestQuery } from '../../app/services/openInterest';
import PNLVisualizer from '../StrategyBuilder/PNLVisualizer';
import { getTargetDateTime } from '../../utils';
import type { OptionLeg as OptionLegType } from '../../features/selected/types';
import { ToastContext } from '../../contexts/ToastContextProvider';

type Position = {
  id: string;
  name: string;
  underlying: string;
  expiry: string;
  legs: OptionLegType[];
  status: 'open'|'closed'|'scheduled';
  createdAt: number;
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

const Positions = () => {
  const dispatch = useDispatch();
  const underlying = useSelector(getUnderlying);
  const { data } = useOpenInterestQuery({ underlying });
  const { setOpen, setToastPack } = useContext(ToastContext);

  const [positions, setPositions] = useState<Position[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [adjustOpen, setAdjustOpen] = useState(false);

  // Filter positions by current underlying
  const filtered = useMemo(()=> positions.filter(p => p.underlying === underlying), [positions, underlying]);

  useEffect(()=>{ (async ()=>{ setPositions(await fetchPositions(underlying)); })(); }, [underlying]);

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
    dispatch(setSBOptionLegs({ type: 'set', optionLegs: pos.legs } as any));
    dispatch(setSBExpiry(pos.expiry));
  }, [selectedId, data]);

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
        </Grid>

        {selectedId && (
          <Box>
            <PNLVisualizer />
          </Box>
        )}
      </Paper>

      <Drawer anchor='right' open={adjustOpen} onClose={()=>setAdjustOpen(false)}>
        <Box sx={{ width: { xs: 320, md: 420 }, p:2 }}>
          <Typography variant='h6' sx={{ mb:2 }}>Adjust position</Typography>
          <Typography variant='body2' color='text.secondary'>Adjustment tools coming soon.</Typography>
        </Box>
      </Drawer>
    </Box>
  );
};

export default Positions;
