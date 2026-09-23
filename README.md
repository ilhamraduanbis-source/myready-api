# MYReady API

Malaysia-specific data compatibility API proof of concept.

## Endpoints
- `GET /health`
- `POST /v1/malaysia/resolve`

Current v0.7 normalizes selected Malaysian state, payment, document, phone, MYR amount, postcode candidate and SSM-format inputs. It reports ambiguous amounts and states rather than silently guessing. Validation against authoritative registries is intentionally not claimed.

## Development

Run the zero-dependency regression suite with `npm test`. Pushes to `main` run the suite before the existing Cloudflare Workers deployment step.
