import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { Box, Paper, Typography, Grid } from '@mui/material';
import { getUnderlying } from '../../features/selected/selectedSlice';
import { useOpenInterestQuery } from '../../app/services/openInterest';

type PcrRow = { expiry: string; callOI: number; putOI: number; pcr: number };

const TrendAnalyses = () => {
  const underlying = useSelector(getUnderlying);
  const { data, isFetching, isError } = useOpenInterestQuery({ underlying });

  const rows: PcrRow[] = useMemo(() => {
    const out: PcrRow[] = [];
    if (!data) return out;
    const expiries: string[] = data.filteredExpiries && data.filteredExpiries.length
      ? data.filteredExpiries
      : Object.keys(data.grouped || {});
    for (const ex of expiries) {
      const g = data.grouped?.[ex];
      const list = (g?.data || []) as any[];
      let callOI = 0, putOI = 0;
      for (const r of list) {
        callOI += r?.CE?.openInterest || 0;
        putOI += r?.PE?.openInterest || 0;
      }
      const pcr = callOI === 0 ? 0 : putOI / callOI;
      out.push({ expiry: ex, callOI, putOI, pcr });
    }
    return out;
  }, [data]);

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="h5" sx={{ mb: 1 }}>Trend analyses</Typography>
      <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Put-Call Ratio (by expiry)</Typography>
        {isError && (
          <Typography color="error" variant="body2">Failed to load data</Typography>
        )}
        <Grid container sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
          <Grid item xs={12} sx={{ display: 'flex', p: 1, bgcolor: 'background.default', fontSize: 12, fontWeight: 600 }}>
            <Box sx={{ flex: 1 }}>Expiry</Box>
            <Box sx={{ width: 140, textAlign: 'right' }}>Call OI</Box>
            <Box sx={{ width: 140, textAlign: 'right' }}>Put OI</Box>
            <Box sx={{ width: 100, textAlign: 'right' }}>PCR</Box>
          </Grid>
          {(isFetching && rows.length === 0) && (
            <Grid item xs={12} sx={{ p: 2 }}>
              <Typography variant="body2" color="text.secondary">Loading…</Typography>
            </Grid>
          )}
          {rows.map((r) => (
            <Grid key={r.expiry} item xs={12} sx={{ display: 'flex', p: 1, borderTop: 1, borderTopColor: 'divider', fontSize: 12 }}>
              <Box sx={{ flex: 1 }}>{r.expiry}</Box>
              <Box sx={{ width: 140, textAlign: 'right' }}>{r.callOI.toLocaleString()}</Box>
              <Box sx={{ width: 140, textAlign: 'right' }}>{r.putOI.toLocaleString()}</Box>
              <Box sx={{ width: 100, textAlign: 'right' }}>{r.pcr.toFixed(2)}</Box>
            </Grid>
          ))}
        </Grid>
        <Typography variant="caption" color="text.secondary">
          Note: Real-time trends will update as new snapshots arrive. Additional analyses (IV trend, Max Pain over time, OI momentum) coming soon.
        </Typography>
      </Paper>
    </Box>
  );
};

export default TrendAnalyses;
