# MYReady API

Malaysia-specific data compatibility API proof of concept.

## Endpoints
- `GET /health`
- `POST /v1/malaysia/resolve`

Current v0.9 normalizes selected Malaysian state, payment, document, phone, MYR amount, postcode candidate and SSM-format inputs. It reports ambiguous amounts and states rather than silently guessing. Validation against authoritative registries is intentionally not claimed.

Every successful machine-ready operation is explicitly marked as chargeable at RM0.01. Chargeable operations are written once to a Cloudflare D1 ledger using their operation ID; repeated requests are marked as duplicates. The ledger deliberately stores no source text. The API reports `charge_status: recorded_not_collected` once recorded: auditable usage is live, while collection remains disabled until a payment rail is connected.

Clients should send an `Idempotency-Key` header (1–128 letters, digits, `.`, `_`, `:`, or `-`). Reusing the same key with the same input produces the same operation ID, allowing a future ledger to prevent duplicate charging.

## Development

Run the zero-dependency regression suite with `npm test`. Pushes to `main` run the suite before the existing Cloudflare Workers deployment step.
