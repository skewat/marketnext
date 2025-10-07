# Frontend Architecture

Stack
- React 18 + TypeScript + Vite + MUI
- Redux Toolkit for state management and RTK Query for data fetching
- React Router for routing

Entry
- `src/App.tsx` configures routes under a shared `Layout` and `ToastContextProvider`.

## Pages and Components

- OpenInterest
  - Files: `components/OpenInterest/*`
  - Features: Menu for underlying/expiry/range; two charts (OI Change, OI Total); worker-based OI refresh cadence; next update indicator

- StrategyBuilder
  - Files: `components/StrategyBuilder/*`
  - Features: Add/Edit legs, Save/Load via backend, delete with protection messaging; shared PNLVisualizer with computed metrics

- Strategy deploy (Scheduler)
  - Files: `components/Scheduler/index.tsx`
  - Features: Select saved strategy, choose explicit or shortcut expiry; day/time scheduler (Today + Mon–Fri, 09:15–15:30, 5-min steps)
  - Exit conditions: exclusive SL% | SL abs | On expiry; validation and field-disable behavior
  - Legs preview: shows Offset from ATM, Strike, and current Premium
  - Deploy/Schedule: saves to backend `/positions`, legs rebuilt from saved strategy and current OI

- Positions
  - Files: `components/Positions/index.tsx`
  - Features: Position selector; Exit, Adjust (placeholder), Recalculate
  - On select: ensures underlying match; resolves expiry to available; rebuilds legs with current price/IV; falls back to reconstruct from strategy if legs are empty

- TrendAnalyses
  - Files: `components/TrendAnalyses/index.tsx`
  - Features: PCR by expiry from current OI; extensible area for IV trend, Max Pain, momentum

- PNLVisualizer
  - Files: `components/StrategyBuilder/PNLVisualizer/*`
  - Uses SB state and `useBuilderQuery` to render payoff charts and StrategyMetrics

## Redux selectedSlice

Key fields
- underlying, expiries, strikeRange, strikeDistanceFromATM
- nextUpdateAt, pollIntervalMin
- strategyBuilder (SB): expiry, underlyingPrice, targetUnderlyingPrice, targetDateTimeISOString, atmIVsPerExpiry, futuresPerExpiry, optionLegs, projectedFuturePrices

Reducers and helpers
- `setSBOptionLegs` enforces `targetDateTime` cap to min(legs' expiries)
- Other setters populate SB from OI snapshots on relevant pages

## RTK Query services

- `useOpenInterestQuery`
  - Base URL configured to `/api` in dev
  - Tag: OpenInterest, invalidated by worker messages

- `useBuilderQuery`
  - Posts current SB state to `/builder` for payoff and metrics

## Worker (IntervalWorker)

- Posts `get-oi` to periodically invalidate OI cache tags (1/3/5/15 minutes)
- Keeps UI OI views up to date without reloading the page

## UI Conventions

- MUI components styled with small sizes for dense finance UI
- Small toasts for user feedback on CRUD and error states
- Compact action bars (e.g., deploy controls, position actions)
