import { type StrategyMetrics as Metrics } from "../../../features/selected/types";
import { Box, Typography, Paper } from "@mui/material";
import { formatAndAddSuffix } from "../../../utils";

type MetricsProps = {
  metrics: Metrics | undefined;
  showMargin?: boolean;
  currentPnL?: number | undefined;
  // When true, render only the Current PnL card (used for closed positions)
  onlyCurrentPnL?: boolean;
  // Optional override for the PnL label (e.g., "Realised PnL" for closed trades)
  pnlLabel?: string;
};

const StrategyMetrics = ({ metrics, showMargin = true, currentPnL, onlyCurrentPnL = false, pnlLabel = "Current PnL" }: MetricsProps) => {
  if (!metrics) return null;

  const formatSigned2 = (v: number) => {
    const sign = v >= 0 ? '+' : '-';
    const amt = Math.abs(v).toFixed(2);
    return `${sign}₹${amt}`;
  };

  return (
    <Box 
      sx={{ 
        display: "flex", 
        gap: 2, 
        width: "100%",
        flexWrap: "wrap"
      }}
    >
      {typeof currentPnL === 'number' && onlyCurrentPnL && (
        <Paper 
          sx={{ 
            flex: 1, 
            p: 2, 
            minWidth: "150px",
            backgroundColor: currentPnL >= 0 ? "success.dark" : "error.dark",
            color: "white"
          }}
        >
          <Typography variant="subtitle2">{pnlLabel}</Typography>
          <Typography variant="h6">{formatSigned2(currentPnL)}</Typography>
        </Paper>
      )}
      {onlyCurrentPnL && (
        // Only current PnL requested
        null
      )}
      {!onlyCurrentPnL && (
        <>
      <Paper 
        sx={{ 
          flex: 1, 
          p: 2, 
          minWidth: "150px",
          backgroundColor: "success.main",
          color: "white"
        }}
      >
        <Typography variant="subtitle2">Max Profit</Typography>
        <Typography variant="h6">
          {metrics.isMaxProfitUnlimited ? "Unlimited" : `₹${formatAndAddSuffix(metrics.maxProfit)}`}
        </Typography>
        <Typography variant="caption">
          ROI: {metrics.isMaxProfitUnlimited ? "∞%" : `${metrics.roi}%`}
        </Typography>
      </Paper>
      <Paper 
        sx={{ 
          flex: 1, 
          p: 2, 
          minWidth: "150px",
          backgroundColor: "error.main", 
          color: "white"
        }}
      >
        <Typography variant="subtitle2">Max Loss</Typography>
        <Typography variant="h6">
          {metrics.isMaxLossUnlimited ? "Unlimited" : `₹${formatAndAddSuffix(Math.abs(metrics.maxLoss))}`}
        </Typography>
      </Paper>
      {showMargin && (
        <Paper 
          sx={{ 
            flex: 1, 
            p: 2, 
            minWidth: "150px",
            backgroundColor: "warning.main",
            color: "white"
          }}
        >
          <Typography variant="subtitle2">Margin Required</Typography>
          <Typography variant="h6">₹{formatAndAddSuffix(metrics.marginRequired)}</Typography>
          <Typography variant="caption">
            ROIC: {
              metrics.isMaxProfitUnlimited
                ? "∞%"
                : metrics.marginRequired > 0
                  ? `${(metrics.maxProfit / metrics.marginRequired * 100).toFixed(2)}%`
                  : "—"
            }
          </Typography>
        </Paper>
      )}
      {typeof currentPnL === 'number' && (
        <Paper 
          sx={{ 
            flex: 1, 
            p: 2, 
            minWidth: "150px",
            backgroundColor: currentPnL >= 0 ? "success.dark" : "error.dark",
            color: "white"
          }}
        >
          <Typography variant="subtitle2">{pnlLabel}</Typography>
          <Typography variant="h6">{formatSigned2(currentPnL)}</Typography>
        </Paper>
      )}
        </>
      )}
      <Paper 
        sx={{ 
          flex: 1, 
          p: 2, 
          minWidth: "150px",
          backgroundColor: "info.main",
          color: "white"
        }}
      >
        <Typography variant="subtitle2">Probability of Profit</Typography>
        <Typography variant="h6">{metrics.pop}%</Typography>
      </Paper>
      <Paper 
        sx={{ 
          flex: 1, 
          p: 2, 
          minWidth: "180px",
          backgroundColor: "primary.dark",
          color: "white"
        }}
      >
        <Typography variant="subtitle2">Break-even Points</Typography>
        <Typography variant="h6" sx={{ wordBreak: 'break-word' }}>
          {metrics.breakevenPoints && metrics.breakevenPoints.length > 0
            ? metrics.breakevenPoints.map(v => `₹${formatAndAddSuffix(v)}`).join(', ')
            : '—'}
        </Typography>
      </Paper>
    </Box>
  );
};

export default StrategyMetrics;