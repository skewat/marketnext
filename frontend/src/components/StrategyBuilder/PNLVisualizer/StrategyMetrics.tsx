import { type StrategyMetrics as Metrics } from "../../../features/selected/types";
import { Box, Typography, Paper } from "@mui/material";
import { formatAndAddSuffix } from "../../../utils";

type MetricsProps = {
  metrics: Metrics | undefined;
};

const StrategyMetrics = ({ metrics }: MetricsProps) => {
  if (!metrics) return null;

  return (
    <Box 
      sx={{ 
        display: "flex", 
        gap: 2, 
        width: "100%",
        flexWrap: "wrap"
      }}
    >
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