# MarketNext Architecture and Design

Last updated: 2025-10-02

This document describes the overall architecture, runtime data flow, precise data formats, and code organization for the MarketNext repository. It covers everything in the repository folder that sits “above” the `Data` folder (i.e., the `frontend` and `backend` codebases and their integration) and details how the `Data` folder is consumed.

---

## 1. System overview

- Monorepo layout with a React + TypeScript frontend (`frontend/`) and a Node.js + Express backend (`backend/`).
- The backend is the single source of truth for persisted artifacts via the `Data/` folder:
  - `Data/oi-cache/` — file cache for NSE option chain snapshots (per underlying identifier)
  - `Data/strategies.json` — saved strategies per underlying
  - `Data/positions.json` — positions (open/closed/scheduled)
- The frontend consumes backend REST APIs for:
  - Current option chain (Open Interest) snapshots
  - Strategy Builder payoff computation (builder API)
  - CRUD of saved strategies and positions
- Development uses Vite’s proxy to reach the backend at `http://localhost:6123` under `/api`.

---

## 2. Repository structure

- `backend/`
  - `server.js` — Express server, REST APIs, OI cache, strategies and positions persistence, builder endpoint
  - `utils.js` — Option chain transformation and payoff computations (Black-76 in `black76.js`), strategy metrics
  - `black76.js` — Pricing utilities (greeks, theoreticals)
  - `strategyMetrics.js` — Strategy metrics computation (Max P/L, POP, breakevens, etc.)
  - `marginCalculator.js` — Margin estimation helpers
  - `auth.js` — Authentication routes (mounted as `/auth`) [lightweight wrapper/placeholder]
  - `package.json` — Backend dependencies and scripts
- `frontend/`
  - `src/`
    - `app/services/openInterest.ts` — RTK Query API definitions for OI and builder
    - `components/`
      - `Common/` — Header, Drawer, Toast, Loading overlay, etc.
      - `OpenInterest/` — OI page (menu, charts: OI change and totals)
      - `StrategyBuilder/` — Strategy authoring UI (legs editing, info, metrics, PNLVisualizer)
      - `Scheduler/` — “Strategy deploy” page (select saved strategy, choose expiry/day/time, exit conditions, preview, PNL)
      - `Positions/` — Positions page (select position, exit/adjust, PNL visualizer)
      - `TrendAnalyses/` — Trend analyses page (PCR by expiry; room for IV trend, Max Pain, momentum)
      - `Chart/` — Reusable chart components for PNL (axes, tooltips, crosshair, lines)
    - `contexts/` — Toast context provider
    - `features/selected/` — Redux slice: global selected state and SB sub-state
    - `hooks/` — Reusable hooks (e.g., chart dimensions, deep memo)
    - `identifiers/` — Underlying identifiers and lotsizes
    - `store/` — Redux store setup
    - `theme/` — MUI theming
    - `utils/` — Shared utilities (time, strike helpers, max target datetime, etc.)
    - `worker/IntervalWorker.ts` — Web Worker loop for periodic OI invalidation (1/3/5/15 min)
  - `vite.config.ts` — Dev proxy for `/api` → `http://localhost:6123`
  - `package.json`, `tsconfig*.json` — Frontend configuration files
- `Data/`
  - `oi-cache/` — Per-underlying JSON cache files
  - `strategies.json` — Saved strategies store
  - `positions.json` — Positions store
- `README.md` — Project overview

---

## 3. Runtime data flow

### 3.1 Open Interest snapshots
- Frontend calls `GET /open-interest?identifier=...` via RTK Query.
- Backend returns a transformed payload (`TransformedData`) with:
  - `grouped`: { expiry → { atmStrike, atmIV, syntheticFuturesPrice, data[] } }
  - `filteredExpiries`, `allExpiries`, `strikePrices`, `underlyingValue`
- Backend caches OI in `Data/oi-cache` with TTL=60s (configurable in code). `nocache=1` bypasses cache.

### 3.2 Strategy Builder P&L
- Frontend assembles SB state (underlying price, target price/datetime, per-expiry IV/futures, active legs, lot size, is index) and posts to `POST /builder`.
- Backend computes payoffs at target and expiry, strategy metrics (max profit/loss, POP, ROI, margin, breakevens), and returns chart ranges and projected futures prices.

### 3.3 Saving/Loading strategies
- Frontend uses backend strategies APIs:
  - `GET /strategies?underlying=...` → `{ [name]: SavedStrategy }`
  - `POST /strategies` → Save/overwrite entry while preserving backend-owned meta (`type`, `creator`)
  - `DELETE /strategies?underlying=...&name=...` → Enforces protection rule (no delete if `creator==='admin'` or `type==='default'`)
  - `PATCH /strategies/meta?underlying=...&name=...` → Backend-only edits of `type` and `creator`
- Strategy Builder saves strategies in version 2 format (ATM-relative legs) with backward compatible loading for legacy absolute-strike entries.

### 3.4 Strategy deploy (Scheduler)
- User selects a saved strategy (loaded from backend) and an expiry:
  - “Next weekly/monthly” resolves to a concrete expiry; hint shows resolution.
- Exit conditions are exclusive: `SL %`, `SL abs`, or `On expiry` (default). Trailing is disabled for `On expiry`.
- Market-time scheduler constraints: Day ∈ {Today, Mon–Fri}, Time ∈ [09:15, 15:30] (5-min steps). Values are clamped.
- Legs preview and PNL are reconstructed for the selected expiry using current OI (strike, premium, IV). Deploy or Schedule creates entries in `Data/positions.json` via `POST /positions`.

### 3.5 Positions
- Positions page loads via `GET /positions?underlying=...` and renders a selector.
- Selecting a position:
  - Ensures global underlying matches the position’s underlying.
  - Resolves expiry: uses saved expiry if present today, else first available expiry (visual cue planned).
  - Rebuilds legs: snaps strikes to current chain, injects latest price/IV; if stored legs are empty, reconstructs from saved strategy of the same name.
  - Updates SB state and shows P&L chart + metrics.
- Exiting a position: `PATCH /positions/:id` with `{ status: 'closed' }`.

---

## 4. Data model (precise formats)

### 4.1 Transformed OI (`GET /open-interest`)
```ts
export type ContractData = {
  impliedVolatility: number; // iv used in row.iv aggregation
  lastPrice: number;
  openInterest: number;
  greeks: Greeks | null;
  // ...other NSE fields
};
export type DataItem = {
  strikePrice: number;
  expiryDate: string;
  CE?: ContractData;
  PE?: ContractData;
  syntheticFuturesPrice: number; // derived per expiry
  iv: number; // atm/implied iv used across rows
};
export type GroupedData = {
  [expiry: string]: {
    atmStrike: number | null;
    atmIV: number | null;
    syntheticFuturesPrice: number | null;
    data: DataItem[]; // sorted by strike
  };
};
export type TransformedData = {
  underlying: string;
  grouped: GroupedData;
  filteredExpiries: string[]; // default chartable subset
  allExpiries: string[];
  strikePrices: number[];
  underlyingValue: number;
};
```

### 4.2 Strategy format (saved in `Data/strategies.json`)
File structure:
```json
{
  "<UNDERLYING>": {
    "<NAME>": SavedStrategy,
    // ... more strategies
  }
}
```
SavedStrategy v2 (ATM-relative) — persisted shape:
```ts
export type SavedOptionLegV2 = {
  active: boolean;
  action: 'B' | 'S';
  expiry: string; // original authoring expiry (used during reconstruction)
  strikeRef: { kind: 'ATM'; offset: number }; // offset from ATM index at time of reconstruction
  type: 'CE' | 'PE';
  lots: number;
  price: number | null; // historical at save time (ignored during reconstruction)
  iv: number | null;    // historical at save time (ignored during reconstruction)
};
export type SavedStrategy = {
  name: string;
  underlying: string;
  expiry: string | null; // optional authoring default
  version?: 2;           // undefined/omitted means legacy absolute strikes
  optionLegs: (OptionLeg | SavedOptionLegV2)[];
  updatedAt: number;
  // Backend-owned meta
  type?: 'user' | 'default';
  creator?: string; // 'admin' blocks delete
};
```
Legacy entries with absolute `strike` are still loadable; the UI maps to nearest strike for current snapshot.

### 4.3 Positions format (saved in `Data/positions.json`)
File is a top-level JSON array:
```ts
export type Position = {
  id: string; // assigned by server
  name: string; // saved strategy name this position reflects
  underlying: string;
  expiry: string; // requested or resolved expiry
  legs: OptionLeg[]; // absolute-strike legs (rebuilt from saved strategy if empty)
  status: 'open' | 'closed' | 'scheduled';
  createdAt: number;
  schedule?: { day: string; time: string }; // present for 'scheduled'
  exit?: {
    mode: 'stopLossPct' | 'stopLossAbs' | 'onExpiry';
    stopLossPct?: string;
    stopLossAbs?: string;
    profitTargetPct?: string;
    trailingEnabled?: boolean;
  };
};
export type OptionLeg = {
  active: boolean;
  action: 'B' | 'S';
  expiry: string; // concrete expiry used for pricing
  strike: number; // absolute strike chosen/snap-to-nearest
  type: 'CE' | 'PE';
  lots: number;
  price: number | null; // lastPrice at time of rebuild
  iv: number | null;    // row iv at time of rebuild
};
```

---

## 5. Backend API

Base URL
- Dev: `/api` (proxied to `http://localhost:6123`)
- Prod: `VITE_API_BASE_URL` (configured in environment)

Endpoints
- `GET /open-interest?identifier=SYMBOL[&nocache=1]`
  - Response: `TransformedData`
  - Caching: file cache in `Data/oi-cache` with TTL=60s
- `DELETE /open-interest-cache?identifier=SYMBOL`
  - Deletes cache file for a specific identifier
- `GET /strategies?underlying=<SYMBOL>`
  - Response: `{ [name]: SavedStrategy }`
- `POST /strategies`  body: `{ underlying, name, strategy }`
  - Creates/overwrites; preserves backend-owned meta
- `DELETE /strategies?underlying=<S>&name=<N>`
  - 403 if `creator==='admin'` or `type==='default'`
- `PATCH /strategies/meta?underlying=<S>&name=<N>`
  - Body: `{ type?: 'user'|'default', creator?: string }`
- `GET /positions[?underlying=<S>]`
  - Response: `Position[]` (filtered if underlying provided)
- `POST /positions`  body: `Position` (without id)
  - Returns created position with `id`
- `PATCH /positions/:id`  body: Partial<Position>
  - Updates and returns the modified position
- `DELETE /positions/:id`
  - Deletes a position
- `POST /builder`  body: `BuilderRequestParams`
  - Response: `BuilderData` (payoffs, metrics)

Notes
- `auth.js` is mounted at `/auth`; currently a minimal placeholder for future auth (e.g., token issuance, user profile). The UI stores a simple token and user info in localStorage and shows a header avatar; no route protection is enforced yet.

---

## 6. Frontend architecture

- Framework: React 18 + TypeScript + Vite + MUI.
- State: Redux Toolkit; RTK Query for data fetching.
- Routing: React Router.

### 6.1 Global state (Redux slice `selectedSlice.ts`)
- `underlying`: current identifier
- `expiries`: selected/visible expiries for OI views
- `strikeRange`, `strikeDistanceFromATM` for chart ranges
- `nextUpdateAt`, `pollIntervalMin` for OI polling
- `strategyBuilder` sub-state:
  - `expiry`, `underlyingPrice`
  - `targetUnderlyingPrice` (value, autoUpdate)
  - `targetDateTimeISOString` (value, autoUpdate)
  - `atmIVsPerExpiry`, `futuresPerExpiry`
  - `optionLegs`, `projectedFuturePrices`
- Slice ensures `targetDateTime` never exceeds min of legs’ expiries.

### 6.2 RTK Query services
- `useOpenInterestQuery` — fetches OI; tagged to allow worker-driven invalidation.
- `useBuilderQuery` — computes payoffs from SB state.

### 6.3 Pages and key components
- Open Interest
  - Menu, OI Change and OI Total charts; worker-driven periodic refresh; shows next update time.
- Strategy Builder
  - Add/Edit legs drawer, save/load via backend; computes and displays PNL + Strategy metrics.
- Strategy deploy (Scheduler)
  - Select saved strategy; pick “next weekly/monthly” or explicit expiry; exit conditions; schedule controls limited to market hours; legs preview; embeds shared PNL visualizer.
  - Deploy/Schedule writes positions via backend `POST /positions` using legs rebuilt from saved strategy against the current OI.
- Positions
  - Loads positions; on selection, ensures underlying alignment, resolves a valid expiry, rebuilds legs (snap + price/IV injection), falls back to reconstruct from saved strategy if position legs are empty; shows PNL and metrics.
  - Exit uses `PATCH /positions/:id`; Adjust drawer placeholder; manual Recalculate available.
- Trend analyses
  - Initial metric: Put-Call Ratio by expiry from current OI; extensible to IV trend, Max Pain, OI momentum.

### 6.4 PNL Visualizer
- Shared between Strategy Builder, Strategy deploy, and Positions.
- Consumes SB state and `useBuilderQuery` output:
  - Chart: payoffs at target and expiry, crosshair tooltips, axes
  - Metrics: Max Profit/Loss, POP, ROI, margin, breakevens

### 6.5 OI polling worker
- A simple web worker that posts `get-oi` messages at the selected cadence (1/3/5/15 minutes), letting RTK Query invalidate OI cache.

---

## 7. Important behaviors and edge cases

- Expiry resolution
  - Scheduler supports shortcuts: “Next weekly” and “Next monthly”; shows “Resolves to …” hint.
  - Positions resolve to the saved expiry if available; else fall back to first available expiry (planned UI hint).
- Leg reconstruction
  - For v2 strategies: `strikeRef.kind==='ATM'` → compute nearest ATM index from futures price; fallback to `atmStrike` or `underlyingValue` if futures is null.
  - For legacy strategies: map absolute `strike` to nearest available strike.
- Price/IV refresh
  - On expiry change or recalc, legs are rebuilt with latest `lastPrice` and `iv` so Strategy metrics recompute.
- Backend protections
  - Strategies with `creator==='admin'` or `type==='default'` cannot be deleted.
- Caching
  - OI responses are cached 60s per identifier in `Data/oi-cache`; `nocache=1` bypasses when diagnosing or forcing refresh.
- Market hours
  - Scheduler clamps Day (Today/Mon–Fri) and Time (09:15–15:30, 5-min increments).

---

## 8. Configuration & running locally

- Frontend: Vite dev server, proxies `/api` → `http://localhost:6123` (see `vite.config.ts`).
- Backend: Express on port `6123`.
- Environment:
  - Dev: `import.meta.env.MODE === 'development'` switches base URLs to `/api`.
  - Prod: `VITE_API_BASE_URL` must be set for frontend to reach the backend.

---

## 9. Testing and validation hooks

- TypeScript type-checking across frontend and backend.
- RTK Query cache invalidation for OI via worker keeps UI state fresh.
- Strategy metrics recomputation validated by updating SB legs with live price/IV on expiry change or user-triggered recalc.

---

## 10. Future enhancements

- Backend
  - Make OI TTL configurable via environment
  - Append historical snapshots for trend analytics (IV trend, Max Pain evolution)
  - Auth hardening (JWT, route guards), multitenancy for strategies/positions
- Frontend
  - Positions: visual hint when expiry falls back; delete button; auto-refresh when OI updates
  - Trend analyses: IV trend sparklines, Max Pain chart, OI momentum/velocity
  - Admin panel for strategy meta (`type`, `creator`) and cache controls

---

## 11. Glossary

- ATM — At The Money (nearest strike to synthetic futures price)
- PCR — Put-Call Ratio (sum(Put OI)/sum(Call OI))
- POP — Probability of Profit (derived from payoff distribution per strategy model)
- Max Pain — Strike with minimal aggregate option payoff at expiry

---

## 12. Sequence walkthroughs

- Save strategy from Strategy Builder
  1) User edits legs → Save → `POST /strategies` (v2 ATM-relative legs)
  2) Backend persists under `Data/strategies.json`, preserving meta

- Deploy strategy (now)
  1) User selects saved strategy + expiry → legs reconstructed with price/IV → `POST /positions`
  2) Positions page will later rebuild from saved legs or strategy if legs were empty

- Select position
  1) UI ensures underlying match → resolve expiry → rebuild legs (snap + price/IV)
  2) SB updated → PNLVisualizer renders payoff and metrics
