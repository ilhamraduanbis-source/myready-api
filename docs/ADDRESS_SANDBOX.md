# Malaysian Address Resolver Sandbox

This is a free, bounded MYReady experiment. It tests whether external software repeatedly needs deterministic Malaysian address context. It is not a billing service, government service, geocoder, proof of address, or guarantee of postal delivery.

Use synthetic or de-identified data only. Do not send names, identity numbers, phone numbers, or other personal information.

## Quick start

1. Obtain an anonymous token. No account or personal details are required.

```sh
curl -sS -X POST \
  https://myready-api.ilhamraduan-bis.workers.dev/sandbox/v1/access
```

2. Keep the returned token secret. It expires after 90 days, is revocable, allows only the address sandbox, and is not a billing credential.

3. Resolve a synthetic address. Use a unique idempotency key for each logical input.

```sh
curl -sS -X POST \
  https://myready-api.ilhamraduan-bis.workers.dev/sandbox/v1/address/resolve \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_SANDBOX_TOKEN' \
  -H 'Idempotency-Key: example-address-001' \
  --data '{"address":"5 Jln Ampang, Tmn Ampang, 55000 Kuala Lumpur"}'
```

The response has one of four statuses:

- `resolved`: one deterministic postcode/locality/state candidate remains.
- `ambiguous`: the input or official reference has multiple plausible candidates.
- `conflict`: supplied Malaysian context contradicts the postcode reference.
- `unknown`: a deterministic result cannot be returned.

Selected abbreviations such as `Jln`, `Tmn`, `Kg`, `Bdr`, `Lrg`, `Psrn`, `Lbh`, `Sg`, and `Kt` are normalised. The response always identifies its dataset version and limitations.

## Access and limits

- Anonymous issuance: maximum 5 tokens per source per day.
- Resolver limit: 30 requests per token per minute.
- Token scope: `sandbox:address:resolve` only.
- Tokens cannot access the MyInvois pilot.
- Revoke your token with `DELETE /sandbox/v1/access` using the same bearer header.
- Repeated equivalent inputs are marked as duplicates even if the idempotency key changes.

## Privacy-safe measurement

MYReady stores only a hashed token identifier, timestamp, outcome/error categories, rate-limit result, dataset version, latency, salted request fingerprint, input-field presence/count, duplicate/internal/noise flags, and whether normalisation, ambiguity, or conflict occurred.

It does not retain raw addresses, request bodies, names, unit/house numbers, phone numbers, identity numbers, or persistent raw IP addresses for experiment analytics. A daily salted source hash is used only to limit anonymous token issuance.

## Experimental boundary

`economic_mode` is `free_bounded_validation` and `billing_enabled` is `false`. No charge is made and no commercial account relationship is created. `observation_qualified` is an experiment measurement flag, not a fee or revenue indicator.

The official machine-readable contract is available at:

`https://myready-api.ilhamraduan-bis.workers.dev/openapi/address-sandbox.json`
