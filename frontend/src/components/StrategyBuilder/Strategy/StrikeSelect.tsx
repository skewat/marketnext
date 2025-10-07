import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import IconButton from "@mui/material/IconButton";
import RemoveIcon from '@mui/icons-material/Remove';
import AddIcon from '@mui/icons-material/Add';

type StrikeSelectProps = {
  strikes: number[];
  strike: number;
  showHeader?: boolean;
  onChange: (strike: number) => void;
};

const StrikeSelect = ({ strikes, strike, onChange, showHeader = false }: StrikeSelectProps) => {
  // Find the nearest valid index for a given strike
  const getIndex = (s: number) => {
    if (!strikes || strikes.length === 0) return -1;
    let idx = strikes.indexOf(s);
    if (idx !== -1) return idx;
    // fallback to nearest
    let best = 0; let bestDiff = Number.POSITIVE_INFINITY;
    for (let i = 0; i < strikes.length; i++) {
      const d = Math.abs(strikes[i] - s);
      if (d < bestDiff) { bestDiff = d; best = i; }
    }
    return best;
  };

  const idx = getIndex(strike);
  const atMin = idx <= 0;
  const atMax = idx >= strikes.length - 1;

  const step = (dir: -1 | 1) => {
    if (idx < 0) return;
    const nextIdx = Math.min(Math.max(idx + dir, 0), strikes.length - 1);
    if (nextIdx !== idx) {
      onChange(strikes[nextIdx]);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", rowGap: "10px" }}>
      {showHeader && <span style={{ fontSize: "12px", opacity: 0.7 }}>Strike</span>}
      <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <IconButton size="small" aria-label="decrease strike" onClick={() => step(-1)} disabled={atMin} sx={{ p: 0.25, height: 24, width: 24 }}>
          <RemoveIcon fontSize="small" />
        </IconButton>
        <Select
          size="small"
          sx={{ width: "85px", minWidth: "85px", height: "25px", minHeight: "25px", fontSize: "12px", p: 0,
            border: "1px solid", borderColor: "color-mix(in srgb, currentColor 23%, transparent)", borderRadius: "5px",
            '&& .MuiSelect-select': {
              pl: 1,
              pr: "23px !important",
            },
            '& .MuiSelect-nativeInput': {
              p: 0,
            },
            '& .MuiSelect-icon': {
              width: "23px",
              right: 0,
            },
            ' & fieldset': {
              p: 0,
              border: "none",
            }
          }}
          value={strike}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {strikes.map((s) => (
            <MenuItem key={s} value={s} sx={{ pr: 3 }}>{s}</MenuItem>
          ))}
        </Select>
        <IconButton size="small" aria-label="increase strike" onClick={() => step(1)} disabled={atMax} sx={{ p: 0.25, height: 24, width: 24 }}>
          <AddIcon fontSize="small" />
        </IconButton>
      </div>
    </div>
  );
};

export default StrikeSelect;