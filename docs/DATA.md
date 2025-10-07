# Data Organization (Data/)

The Data folder is the single source of truth for persisted artifacts. The backend is responsible for reading and writing these files.

## Folder Layout

Data/
- oi-cache/ — Per-identifier cache files for OI responses
- strategies.json — Saved strategies grouped by underlying
- positions.json — Flat list of positions

## oi-cache
- File naming: `${IDENTIFIER}.json` (uppercased, sanitized to A-Z0-9_-)
- Contents: The exact response of `TransformedData` per identifier cached for ~60 seconds
- Invalidation:
  - Automatic TTL expiry
  - Manual via `DELETE /open-interest-cache?identifier=...`

## strategies.json
- Structure:
```json
{
  "<UNDERLYING>": {
    "<STRATEGY_NAME>": SavedStrategy
  }
}
```
- `SavedStrategy` fields:
  - name, underlying, expiry (nullable)
  - version?: 2 → ATM-relative legs supported
  - optionLegs: legacy absolute or v2 with `strikeRef: { kind: 'ATM', offset }`
  - updatedAt: number
  - type?: 'user' | 'default' (backend-owned; 'default' is protected)
  - creator?: string (backend-owned; 'admin' protected)
- Protection rules:
  - DELETE is blocked if `creator==='admin'` or `type==='default'`

## positions.json
- Structure: Array of Position
- `Position` fields:
  - id: string (server assigned)
  - name: string (strategy name)
  - underlying: string
  - expiry: string (requested/resolved)
  - legs: OptionLeg[] — absolute-strike legs; can be empty and reconstructed from SavedStrategy on demand
  - status: 'open'|'closed'|'scheduled'
  - createdAt: number
  - schedule?: { day, time } (for scheduled)
  - exit?: Exit settings (SL %, SL abs, On expiry)

## Common patterns
- Reconstruction: Frontend rebuilds legs from saved ATM-relative strategies for the current snapshot to ensure fresh price/IV.
- Fallbacks: If futures price is missing, UI uses `atmStrike` or even `underlyingValue` to define the ATM base.
- Expiry resolution: UI resolves shortcuts (Next weekly/monthly) and falls back to available expiry for Positions display.
