# MYReady MyInvois Preflight Quick Start

Base URL: `https://myready-api.ilhamraduan-bis.workers.dev`

Endpoint: `POST /v1/myinvois/preflight`

Each pilot team receives one revocable bearer token. Send it in `Authorization` together with an `Idempotency-Key`. Keep the token in a secret manager or environment variable; do not commit it, paste it into tickets or log it.

```bash
curl -X POST "https://myready-api.ilhamraduan-bis.workers.dev/v1/myinvois/preflight" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MYREADY_PILOT_TOKEN" \
  -H "Idempotency-Key: demo-invoice-1001" \
  --data '{
    "document": {
      "e_invoice_version": "1.0",
      "document_type_code": "01",
      "invoice_number": "INV-1001",
      "issue_date": "2026-09-24",
      "issue_time": "05:00:00Z",
      "currency": "MYR",
      "payment_mode": "03",
      "supplier": {
        "tin": "C1234567890",
        "id_type": "BRN",
        "id_value": "202601234567",
        "name": "Example Supplier Sdn Bhd",
        "address": {
          "line": "1 Jalan Ampang",
          "city": "Kuala Lumpur",
          "postcode": "50450",
          "state_code": "14",
          "country_code": "MYS"
        }
      },
      "buyer": {
        "tin": "C0987654321",
        "id_type": "BRN",
        "id_value": "202609876543",
        "name": "Example Buyer Sdn Bhd",
        "address": {
          "line": "2 Jalan Ampang",
          "city": "Kuala Lumpur",
          "postcode": "50450",
          "state_code": "14",
          "country_code": "MYS"
        }
      },
      "lines": [{
        "description": "Consulting",
        "classification_code": "022",
        "tax_type": "06",
        "quantity": 2,
        "unit_price": 50,
        "line_total": 100
      }],
      "totals": { "subtotal": 100, "tax": 0, "total": 100 }
    }
  }'
```

## Reading the result

- `ready: true` means the compact payload passed implemented local checks.
- `status: needs_review` means no local blocking error was found but an authoritative check, such as TIN/identity pairing, is still required.
- `status: rejected` means `errors` contains blocking issues with machine-readable `path` and `code` values.
- `validation_scope` always states that this is not authoritative MyInvois validation.
- `usage.simulated_value_eligible` states whether the operation contributes RM0.01 to the economic simulation.
- `usage.economic_mode` is `simulated_value_only` and `usage.cash_collected` is always `false`. No money is collected during the pilot.

Example blocking error:

```json
{
  "path": "totals.total",
  "code": "arithmetic_mismatch",
  "message": "total does not match subtotal plus tax."
}
```

## Safe retries

Reuse the same `Idempotency-Key` only for the same logical request. The first locally ready request is recorded once; a repeat returns the same operation ID and `ledger.duplicate: true`.

## Limits

- Maximum request size: 100 KB
- Idempotency key: 1–128 letters, digits, `.`, `_`, `:` or `-`
- Default participant limit: 60 authenticated requests per minute
- Do not send production personal data during evaluation

## Authentication errors

- Missing, malformed, unknown and revoked tokens all return HTTP `401` with `invalid_pilot_token`.
- Exceeding the participant limit returns HTTP `429` with `rate_limit_exceeded` and a `Retry-After` header.
- Contact the pilot administrator if a token may have been exposed. It will be revoked and replaced; MYReady never needs MyInvois credentials.

## Not included

MYReady does not authenticate to MyInvois, validate TIN/BRN against HASiL, create signatures, submit documents, poll statuses or guarantee acceptance.
