import { type StrategyMetrics } from "../../../features/selected/types";
import { Box, Typography, Paper } from "@mui/material";
import { formatAndAddSuffix } from "../../../utils";

type MetricsProps = {
  metrics: StrategyMetrics | undefined;
};

const StrategyMetricsDisplay = ({ metrics }: MetricsProps) => {
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
  <Typography variant="h6">₹{formatAndAddSuffix(metrics.maxProfit)}</Typography>
        <Typography variant="caption">ROI: {metrics.roi}%</Typography>
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
  <Typography variant="h6">₹{formatAndAddSuffix(Math.abs(metrics.maxLoss))}</Typography>
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
    </Box>
  );
};

export default StrategyMetricsDisplay;