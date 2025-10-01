import { useSelector, useDispatch } from "react-redux";
import { getNextUpdateAt, getPollIntervalMin, setPollIntervalMin } from "../../features/selected/selectedSlice";
import { Box, Typography, FormControl, InputLabel, Select, MenuItem } from "@mui/material";
import SelectUnderlying from "./SelectUnderlying";
import Expiries from "./Expiries";
import StrikeRange from "./StrikeRange";

const NextUpdateAt = () => {
  const dispatch = useDispatch();
  const nextUpdateAt = useSelector(getNextUpdateAt);
  const intervalMin = useSelector(getPollIntervalMin);

  return (
    <Box sx={{ minHeight: "50px", borderRadius: "5px", backgroundColor: "background.paper", border: 1, borderColor: "divider" }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: "fit-content", p: 1.5, columnGap: 1 }}>
        {nextUpdateAt && (
          <Typography variant="body1" color="textSecondary" component="div" sx={{ fontWeight: "normal" }}>Next update at {nextUpdateAt}</Typography>
        )}
        <FormControl size="small" sx={{ minWidth: 110 }}>
          <InputLabel id="oi-interval-label">Interval</InputLabel>
          <Select
            labelId="oi-interval-label"
            label="Interval"
            value={intervalMin}
            onChange={(e) => dispatch(setPollIntervalMin(e.target.value as 1 | 3 | 5 | 15))}
          >
            {[1,3,5,15].map(v => <MenuItem key={v} value={v}>{v} min</MenuItem>)}
          </Select>
        </FormControl>
      </Box>
    </Box>
  )
};

const Menu = () => {
  return (
    <Box sx={{ height: "100%", borderRadius: "5px", border: 0, borderColor: "divider", display: "flex", rowGap: "15px", flexDirection: "column" }}>
      <SelectUnderlying/>
      <Expiries/>
      <StrikeRange/>
      <NextUpdateAt/>
    </Box>
  );
};

export default Menu;