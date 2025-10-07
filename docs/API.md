# Backend API Reference

Base URL
- Development: /api (proxied to http://localhost:6123)
- Production: VITE_API_BASE_URL (configure in frontend env)

Auth
- Currently no enforced auth on the API endpoints. `backend/auth.js` is mounted at `/auth` for future use.

## Open Interest

GET /open-interest?identifier=SYMBOL[&nocache=1]
- Description: Fetch transformed NSE option chain for an underlying.
- Query params:
  - identifier: string (e.g., NIFTY, BANKNIFTY, RELIANCE)
  - nocache: optional '1' to bypass the file cache
- Response: TransformedData

DELETE /open-interest-cache?identifier=SYMBOL
- Description: Remove cached OI file for a given symbol.
- Response: { ok: true }

## Strategies

GET /strategies?underlying=UNDERLYING
- Description: Get saved strategies for an underlying.
- Response: { [name: string]: SavedStrategy }

POST /strategies
- Body: { underlying: string, name: string, strategy: SavedStrategy }
- Description: Create/overwrite a strategy. Backend preserves existing meta (type, creator) or defaults type='user'.
- Response: { ok: true }

DELETE /strategies?underlying=UNDERLYING&name=NAME
- Description: Delete a strategy. Protected if creator==='admin' or type==='default'.
- Responses:
  - 200: { ok: true }
  - 403: { error: 'protected strategy cannot be deleted' }
  - 404: { error: 'not found' }

PATCH /strategies/meta?underlying=UNDERLYING&name=NAME
- Description: Backend-only metadata update (type, creator).
- Body: { type?: 'user'|'default', creator?: string }
- Response: SavedStrategy (updated)

## Positions

GET /positions[?underlying=UNDERLYING]
- Description: Return all positions, optionally filtered by underlying.
- Response: Position[]

POST /positions
- Body: Position (without id is acceptable; server sets id)
- Response: Position (created)

PATCH /positions/:id
- Body: Partial<Position>
- Response: Position (updated)

DELETE /positions/:id
- Response: { ok: true }

## Builder

POST /builder
- Body: BuilderRequestParams (from frontend SB state)
- Response: BuilderData (payoff arrays, metrics, ranges)

## Types (abridged)

TransformedData
- underlying: string
- grouped: { [expiry: string]: { atmStrike: number|null, atmIV: number|null, syntheticFuturesPrice: number|null, data: DataItem[] } }
- filteredExpiries: string[]
- allExpiries: string[]
- strikePrices: number[]
- underlyingValue: number

SavedStrategy (v2 ATM-relative)
- name: string
- underlying: string
- expiry: string|null
- version?: 2
- optionLegs: Array<
  - legacy OptionLeg (absolute strike) OR
  - { active, action, expiry, strikeRef: { kind: 'ATM', offset: number }, type, lots, price|null, iv|null }
>
- updatedAt: number
- type?: 'user'|'default'
- creator?: string

Position
- id: string
- name: string
- underlying: string
- expiry: string
- legs: OptionLeg[]
- status: 'open'|'closed'|'scheduled'
- createdAt: number
- schedule?: { day: string, time: string }
- exit?: { mode: 'stopLossPct'|'stopLossAbs'|'onExpiry', stopLossPct?: string, stopLossAbs?: string, profitTargetPct?: string, trailingEnabled?: boolean }

OptionLeg
- active: boolean
- action: 'B'|'S'
- expiry: string
- strike: number
- type: 'CE'|'PE'
- lots: number
- price: number|null
- iv: number|null
