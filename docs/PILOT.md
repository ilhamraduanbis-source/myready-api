# MYReady Limited Free Pilot

MYReady is testing whether a lightweight Malaysia-specific preflight can reduce the time developers spend finding avoidable MyInvois payload problems.

## Offer

- Up to 3 Malaysian software or ERP integration teams
- 30 days of free API access
- No billing and no payment details
- One separate revocable access token per team
- A default limit of 60 authenticated requests per minute per team
- Direct feedback loop on missing or unhelpful checks
- Local pre-submission checks only; no submission to HASiL

## Best fit

Teams building or maintaining Malaysian ERP, POS, billing, vertical SaaS or MyInvois integration workflows that can test the API with synthetic or safely de-identified payloads.

## What MYReady checks today

- required compact-contract fields;
- supported MyInvois document, payment, tax, state and classification codes;
- local TIN, identity, phone, email and Malaysian-address formats;
- foreign-currency exchange-rate presence;
- invoice-line and document-total arithmetic;
- safe retries through idempotency handling.

## Important limit

MYReady is a local developer preflight. It is not an official HASiL service, does not perform authoritative TIN/BRN verification, does not sign UBL documents and does not guarantee MyInvois acceptance.

## What we ask from pilot teams

- attempt one real integration rather than only calling the endpoint manually;
- use synthetic or de-identified data during evaluation;
- identify checks that saved time, produced noise or were missing;
- permit collection of aggregate event categories, latency, repeat usage and simulated value only;
- join a short written feedback check at the end.

The API does not store invoice text, TINs, identity numbers, addresses or customer details in its pilot telemetry.

MYReady does not request, use or store a participant's MyInvois credentials. Participants must keep their MYReady pilot token out of source control and logs. Tokens are stored by MYReady only as SHA-256 hashes and can be revoked without changing another participant's access.

## Success test

The pilot succeeds only if at least one external integration produces repeated useful calls and the developer can identify concrete work or errors that MYReady removed. Raw call volume alone is not success.
