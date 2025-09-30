import { useState, useEffect, useMemo, useCallback } from "react";
import { useSelector, useDispatch } from "react-redux";
import useDeepMemo from "../../../hooks/useDeepMemo";
import { getUnderlying, setNextUpdateAt, setSBOptionLegs, getSBOptionLegs, getSBExpiry, setSBExpiry, 
  setSBATMIVsPerExpiry, setSBFuturesPerExpiry, setSBUnderlyingPrice, getSBTargetDateTime, getSBTargetUnderlyingPrice,
  setSBTargetUnderlyingPrice, setSBTargetDateTime
} from "../../../features/selected/selectedSlice";
import { useOpenInterestQuery } from "../../../app/services/openInterest";
import { type DataItem } from "../../../features/selected/types";
import { getNearestStrikePrice, getNextTime, getTargetDateTime } from "../../../utils";
import { Box, Typography, Button, Drawer, FormControl, InputLabel, Select, MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, TextField, IconButton, Tooltip } from "@mui/material";
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import OptionLeg, { type Leg } from "./OptionLeg";
import AddEditLegs from "../AddEditLegs";
import StrategyInfo from "./StrategyInfo";
import { useContext } from "react";
import { ToastContext } from "../../../contexts/ToastContextProvider";
import { type OptionLeg as OptionLegType } from "../../../features/selected/types";

const formatData = (data: DataItem[]) => {
  return data.map((item) => {
    return {
      strike: item.strikePrice,
      callPrice: item.CE ? item.CE.lastPrice : null,
      callOI: item.CE ? item.CE.openInterest : null,
      putPrice: item.PE ? item.PE.lastPrice : null,
      putOI: item.PE ? item.PE.openInterest : null,
      syntheticFuturesPrice: item.syntheticFuturesPrice,
      iv: item.iv,
      ceGreeks: item.CE?.greeks || null,
      peGreeks: item.PE?.greeks || null
    };
  });
};

type FormattedDataItem = ReturnType<typeof formatData>[number];

export type PriceAndIV= Map<string, Map<number, FormattedDataItem>> | null;

export const getOptionPriceAndIV = (
  priceAndIV: NonNullable<PriceAndIV>,
  type: "CE" | "PE",
  expiry: string,
  strike: number
): [number, number | null] => {
  if (priceAndIV.has(expiry)) {
    const priceMap = priceAndIV.get(expiry);
    if (priceMap && priceMap.has(strike)) {
      const row = priceMap.get(strike);
      const price = type === "CE" ? row?.callPrice || 0 : row?.putPrice || 0;
      const iv = row?.iv || null;
      return [price, iv];
    }
  }
  return [0, null];
};

const STORAGE_KEY = "marketnext.savedStrategies";

type SavedStrategy = {
  name: string;
  underlying: string;
  expiry: string | null;
  optionLegs: OptionLegType[];
  updatedAt: number;
};

// Root shape: { [underlying: string]: { [name: string]: SavedStrategy } }
const loadSavedRoot = (): Record<string, Record<string, SavedStrategy>> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Migration: if flat map of name -> strategy, convert to underlying-scoped
    const firstKey = Object.keys(parsed)[0];
    const firstVal = firstKey ? parsed[firstKey] : undefined;
    const isFlat = firstVal && typeof firstVal === 'object' && Array.isArray(firstVal.optionLegs);
    if (isFlat) {
      const root = {} as Record<string, Record<string, SavedStrategy>>;
      for (const name of Object.keys(parsed)) {
        const strat: SavedStrategy = parsed[name];
        const u = strat.underlying || 'UNKNOWN';
        if (!root[u]) root[u] = {};
        root[u][name] = strat;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(root));
      return root;
    }
    return parsed;
  } catch {
    return {};
  }
};

const loadSavedMap = (underlying: string): Record<string, SavedStrategy> => {
  const root = loadSavedRoot();
  return root[underlying] || {};
};

const Strategy = () => {
  const dispatch = useDispatch();
  const underlying = useSelector(getUnderlying);
  const expiry = useSelector(getSBExpiry);
  const optionLegs = useSelector(getSBOptionLegs);
  const targetDateTimeAutoUpdate = useSelector(getSBTargetDateTime).autoUpdate;
  const targetUnderlyingPriceAutoUpdate = useSelector(getSBTargetUnderlyingPrice).autoUpdate;
  const filteredOptionLegs = useMemo(() => optionLegs.filter((leg) => leg.active), [optionLegs]);
  const memoizedOptionLegs = useDeepMemo(optionLegs);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const { setToastPack, setOpen } = useContext(ToastContext);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [loadSelected, setLoadSelected] = useState<string>("");
  const [savedNames, setSavedNames] = useState<string[]>(Object.keys(loadSavedMap(underlying)).sort());
  const { data, isFetching, isError } = useOpenInterestQuery({ underlying: underlying });
  const filteredExpiries = useDeepMemo(data?.filteredExpiries);
  const rows = (data && expiry) ? formatData(data.grouped[expiry]?.data || []) : [];

  const priceAndIV = useMemo(() => {
    const map = new Map<string, Map<number, FormattedDataItem>>();
    if (!filteredExpiries || !data) return null;

    filteredExpiries.forEach((expiry) => {
      const strikeMap = new Map<number, FormattedDataItem>();
      const rows = formatData(data.grouped[expiry]?.data) || [];
      rows.forEach((row) => {
        strikeMap.set(row.strike, row);
      });
      map.set(expiry, strikeMap);
    });

    return map;

  }, [data, filteredExpiries]);

  const strikePrices = useMemo(() => {
    return rows.map((row) => row.strike);
  }, [rows]);

  const syntheticFuturesPrice = useMemo(() => {
    if (rows.length === 0) return null;
    return rows[0].syntheticFuturesPrice;
  }, [rows])

  const strikePriceATM = useMemo(() => {
    if (syntheticFuturesPrice === null) return null;

    return getNearestStrikePrice(strikePrices, syntheticFuturesPrice);
  }, [rows, strikePrices, syntheticFuturesPrice]);

  const handleAddEditBtnClick = () => {
    setDrawerOpen((prevState) => !prevState);
  };

  const refreshSavedNames = () => {
    setSavedNames(Object.keys(loadSavedMap(underlying)).sort());
  };

  const handleOpenSave = () => {
    setSaveName("");
    setSaveDialogOpen(true);
  };

  const handleConfirmSave = () => {
    const name = saveName.trim();
    if (!name) {
      setToastPack((p) => [...p, { key: Date.now(), type: "error", message: "Enter a strategy name" }]);
      setOpen(true);
      return;
    }
    const root = loadSavedRoot();
    if (!root[underlying]) root[underlying] = {};
    root[underlying][name] = {
      name,
      underlying,
      expiry,
      optionLegs,
      updatedAt: Date.now(),
    } as SavedStrategy;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(root));
    setSaveDialogOpen(false);
    refreshSavedNames();
    setToastPack((p) => [...p, { key: Date.now(), type: "success", message: `Saved strategy: ${name}` }]);
    setOpen(true);
  };

  const handleLoad = (name: string) => {
    const map = loadSavedMap(underlying);
    const saved = map[name];
    if (!saved) return;
    // Load option legs and expiry; keep underlying as-is to avoid cross-instrument mismatch surprises
    dispatch(setSBOptionLegs({ type: "set", optionLegs: saved.optionLegs }));
    if (saved.expiry) dispatch(setSBExpiry(saved.expiry));
    setToastPack((p) => [...p, { key: Date.now(), type: "info", message: `Loaded strategy: ${name}` }]);
    setOpen(true);
  };

  // Update list when underlying changes
  useEffect(() => {
    refreshSavedNames();
    setLoadSelected("");
  }, [underlying]);

  useEffect(() => {
    if (!isFetching && !isError) {
      const now = new Date();
      const nextTime = getNextTime(now);
      dispatch(setNextUpdateAt(nextTime));
    };
  }, [isFetching, isError]);

  useEffect(() => {
    if (data && memoizedOptionLegs) {
      const updatedOptionLegs = memoizedOptionLegs.map((optionLeg) => {
        if (priceAndIV === null) return optionLeg;
        const [price, iv] = getOptionPriceAndIV(
          priceAndIV, optionLeg.type, optionLeg.expiry, optionLeg.strike
        );

        return {
          ...optionLeg, 
          price: price,
          iv: iv
        };
      });
      dispatch(setSBOptionLegs({
        type: "set",
        optionLegs: updatedOptionLegs
      }));
    };

  }, [data, memoizedOptionLegs, priceAndIV]);

  useEffect(() => {
    if (data) {
      const { grouped, underlyingValue } = data;
      const atmIVsPerExpiry: { [key: string]: number } = {};
      const futuresPerExpiry: { [key: string]: number } = {};
      Object.keys(grouped).forEach((key) => {
        atmIVsPerExpiry[key] = grouped[key].atmIV || 0;
        futuresPerExpiry[key] = grouped[key].syntheticFuturesPrice || 0;
      });
      dispatch(setSBUnderlyingPrice(underlyingValue));
      dispatch(setSBATMIVsPerExpiry(atmIVsPerExpiry));
      dispatch(setSBFuturesPerExpiry(futuresPerExpiry));
      if (targetUnderlyingPriceAutoUpdate) {
        dispatch(setSBTargetUnderlyingPrice({
          value: underlyingValue,
          autoUpdate: true
        }));
      };
      if (targetDateTimeAutoUpdate) {
        const targetDateTime = getTargetDateTime();
        dispatch(setSBTargetDateTime({
          value: targetDateTime.toISOString(),
          autoUpdate: true
        }));
      };
    };
  }, [data]);

  useEffect(() => {
    if (filteredExpiries) {
      dispatch(setSBExpiry(filteredExpiries[0]));
    };
  }, [filteredExpiries]);

  const handleExpiryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setSBExpiry(e.target.value));
  };

  const hanldeOptionLegChange = useCallback(
    (optionLeg: Leg, legIndexPos: number) => {
      dispatch(setSBOptionLegs({
        optionLeg: optionLeg,
        type: "replace",
        optionLegIndex: legIndexPos
      }));
    },
    [dispatch]
  );
  
  const handleOptionLegDelete = useCallback(
    (legIndexPos: number) => {
      dispatch(setSBOptionLegs({
        type: "delete",
        optionLegIndex: legIndexPos
      }));
    },
    [dispatch]
  );
  return (
    <Box sx={{ height: "auto", borderRadius: "5px", backgroundColor: "background.paper", border: 1, borderColor: "divider", px: 1.5, py: 1 }}>
      <Typography sx={{ fontSize: "15px", width: "100%", height: "fit-content",  py: 1, fontWeight: "bold" }}>Strategy</Typography>
      {optionLegs.length !== 0 && (<Box sx={{ flexDirection: "column", overflowX: "scroll" }}>
        {data && optionLegs.map((optionLeg, i) => {
          const key = String(optionLeg.strike) + optionLeg.type + optionLeg.expiry + 
          optionLeg.action + optionLeg.lots + optionLeg.price + optionLeg.iv;

          return (
            <OptionLeg
              priceAndIV={priceAndIV}
              showHeader={i === 0}
              active={optionLeg.active}
              key={key}
              data={data}
              legIndexPos={i} 
              action={optionLeg.action} 
              expiries={filteredExpiries || []} 
              expiry={optionLeg.expiry}
              strike={optionLeg.strike} 
              type={optionLeg.type} 
              lots={optionLeg.lots} 
              price={optionLeg.price || 0}
              iv={optionLeg.iv} 
              onChange={hanldeOptionLegChange}
              onDelete={handleOptionLegDelete}
            />
          )
        })}
      </Box>)}
      <Box sx={{ display: "flex", justifyContent: "start", alignItems: "center", p: 1, px: 0 }}>
        <StrategyInfo optionLegs={filteredOptionLegs} underlying={underlying} />
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, p: 1, px: 0.5, flexWrap: "nowrap" }}>
        <Button 
          variant="outlined" 
          color="primary" 
          size="small"
          sx={{ minWidth: 88, height: 32, fontSize: "12px", textTransform: "none", px: 1.5 }}
          onClick={handleAddEditBtnClick}
        >
          Add/Edit
        </Button>
        <Button 
          variant="contained" 
          color="secondary"
          size="small"
          sx={{ height: 32, fontSize: "12px", textTransform: "none", px: 1.75 }}
          onClick={handleOpenSave}
        >
          Save
        </Button>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel id="load-strategy-label">Load</InputLabel>
            <Select
              labelId="load-strategy-label"
              value={loadSelected}
              label="Load"
              onChange={(e) => {
                const n = e.target.value as string;
                setLoadSelected(n);
                if (n) handleLoad(n);
              }}
              renderValue={(v) => (v ? v : "")}
            >
              {savedNames.length === 0 && (
                <MenuItem value="" disabled>No saved strategies</MenuItem>
              )}
              {savedNames.map((n) => (
                <MenuItem key={n} value={n}>{n}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Tooltip title={loadSelected ? `Delete '${loadSelected}'` : 'Select a saved strategy first'}>
            <span>
              <IconButton
                aria-label="delete saved strategy"
                size="small"
                color="error"
                disabled={!loadSelected}
                onClick={() => {
                  if (!loadSelected) return;
                  const ok = window.confirm(`Delete saved strategy '${loadSelected}'?`);
                  if (!ok) return;
                  const root = loadSavedRoot();
                  if (root[underlying] && root[underlying][loadSelected]) {
                    delete root[underlying][loadSelected];
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(root));
                    setToastPack((p) => [...p, { key: Date.now(), type: 'warning', message: `Deleted strategy: ${loadSelected}` }]);
                    setOpen(true);
                  }
                  setLoadSelected("");
                  refreshSavedNames();
                }}
              >
                <DeleteForeverIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      {/* Save Strategy Dialog */}
      <Dialog open={saveDialogOpen} onClose={() => setSaveDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Save Strategy</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Strategy Name"
            type="text"
            fullWidth
            variant="outlined"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleConfirmSave}>Save</Button>
        </DialogActions>
      </Dialog>
      <Drawer
        anchor={"left"}
        open={drawerOpen}
        PaperProps={{
          sx: { width: "100%", maxWidth: {xs: "100%", sm: "530px"} },
        }}
        closeAfterTransition
        hideBackdrop
      >
        <Box sx={{ height: "100dvh", display: "flex", rowGap: "10px", flex: 1,
          flexDirection: "column", overflow: "auto", width: "100%", pt: "60px",
          position: "relative" }}
        >
          <AddEditLegs 
            rows={rows}
            selectedExpiry={expiry}
            expiries={filteredExpiries || []}
            strikePriceATM={strikePriceATM}
            onExpiryChange={handleExpiryChange}
            onDrawerClose={() => setDrawerOpen(false)} 
          />
        </Box>
      </Drawer>
    </Box>
  );
};

export default Strategy;