# MYReady API

Malaysia-specific data compatibility API proof of concept.

## Endpoints
- `GET /health`
- `POST /v1/malaysia/resolve`
- `POST /v1/myinvois/preflight`

Current v1.0 normalizes selected Malaysian state, payment, document, phone, MYR amount, postcode candidate and SSM-format inputs. It reports ambiguous amounts and states rather than silently guessing. Validation against authoritative registries is intentionally not claimed.

`POST /v1/myinvois/preflight` performs a local pre-submission check on MYReady's compact invoice contract. It checks supported MyInvois codes, mandatory party and address fields, local formats, foreign-currency exchange rates and line/total arithmetic. It returns `ready`, `needs_review` or `rejected` together with path-specific issues. This is not a replacement for MyInvois authentication, TIN/BRN validation, UBL validation, signing or submission.

Every successful machine-ready operation is assigned RM0.01 of simulated economic value. Eligible operations are recorded once in the production D1 ledger using their operation ID and repeated requests are marked as duplicates. This is usage metering, not revenue: pilot responses state `simulated_value_eligible`, `economic_mode: simulated_value_only` and `cash_collected: false`. The ledger deliberately stores no source text and real collection is disabled.

Clients should send an `Idempotency-Key` header (1–128 letters, digits, `.`, `_`, `:`, or `-`). Reusing the same key with the same input produces the same operation ID, allowing a future ledger to prevent duplicate charging.

Only locally ready operations qualify for simulated value. A `needs_review` result can still be locally ready when the remaining warnings require an authoritative MyInvois check. Rejected and duplicate operations do not add simulated value. Pilot access uses a separate revocable bearer token per participant and a per-participant request limit.

## Development

Run the zero-dependency regression suite with `npm test`. Pushes to `main` run the suite before the existing Cloudflare Workers deployment step.

## Limited free pilot

- [Pilot offer](docs/PILOT.md)
- [Developer quick start](docs/QUICKSTART.md)
- [OpenAPI 3.1 specification](docs/openapi.yaml)
- [Privacy-safe measurement plan](docs/PILOT_MEASUREMENT.md)
- [Pilot security operations](docs/PILOT_SECURITY.md)
