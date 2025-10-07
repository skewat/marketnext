# Backend Architecture

Stack
- Node.js + Express
- axios for HTTP
- user-agents for rotating UA headers
- fs and path for file-backed storage under `Data/`

Entry point
- `backend/server.js`

## Responsibilities

- Proxy NSE option-chain with retry, transform to `TransformedData`
- File cache OI snapshots under `Data/oi-cache` (TTL default 60s)
- Persist and serve strategies and positions under `Data/strategies.json` and `Data/positions.json`
- Compute strategy payoffs and metrics via `/builder`
- Expose simple `/auth` router placeholder

## Key modules

- `utils.js`
  - `formatData` — Normalize NSE payload to `TransformedData`
  - `getPayoffData` — Compute payoff arrays, strategy metrics (uses `black76.js` and `strategyMetrics.js`)
- `black76.js` — Option pricing utilities used by payoff calculations
- `strategyMetrics.js` — Derives Max Profit/Loss, POP, ROI, margin, breakevens
- `marginCalculator.js` — Estimate margins for strategies
- `auth.js` — Placeholder for authentication endpoints

## Persistence

- Directory structure created on boot if missing: `Data/`, `Data/oi-cache/`
- `strategies.json` structure: `{ [underlying]: { [name]: SavedStrategy } }`
- `positions.json` structure: `Position[]`

## APIs and semantics

- OI cache respects `nocache` to bypass for force refresh
- `POST /strategies` preserves `type` and `creator` from existing entry; defaults `type='user'`
- `DELETE /strategies` blocks when `creator==='admin'` or `type==='default'`
- `PATCH /strategies/meta` allows backend-only edits of `type` and `creator`

## Error handling

- 4xx for invalid payloads; 5xx on upstream failures
- Basic logging for retries and proxy failures

## Configuration

- `CACHE_TTL_MS` in `server.js` sets file cache TTL (default 60s)
- Port fixed at `6123` in current setup

## Future work

- JWT-based auth and route protection
- Parameterize TTL and port via environment
- Persist historical OI snapshots for trends
- Concurrency-safe writes (lock or atomic write) if multi-process is required
