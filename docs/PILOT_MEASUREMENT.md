# Pilot Measurement

## Decision questions

1. Did an external developer integrate MYReady into a workflow?
2. Did the integration produce repeated useful calls on different documents or test cases?
3. Which checks prevented concrete debugging or submission work?
4. Which checks were noise, incomplete or already trivial for the developer?
5. Is a lightweight external preflight preferable to official docs, open-source libraries or an in-house validator?

## Privacy-safe event fields

Pilot telemetry stores only:

- opaque pilot client ID;
- endpoint;
- outcome category;
- reason-code categories;
- simulated-value eligibility, duplicate and idempotent flags;
- simulated amount in minor units;
- latency;
- timestamp.

It does not store request bodies, invoice numbers, TINs, identity numbers, names, addresses or line descriptions.
It also does not store plaintext pilot tokens or MyInvois credentials.

## Metrics

- invited teams;
- teams that call the API;
- teams that complete an integration;
- time from onboarding to first successful request;
- calls and unique non-duplicate operations per team;
- repeat-use days and calls per active day;
- ready, needs-review and rejected rates;
- duplicate rate;
- common error and warning codes;
- median and upper-tail latency;
- simulated value at RM0.01 per qualifying non-duplicate event;
- developer-reported time saved;
- missing, noisy and unused checks;
- support minutes required per integrated team.

## Guardrails against false traction

- Exclude duplicates from simulated value.
- Flag bursts with identical outcomes as possible loops.
- Separate manual curl testing from workflow integration.
- Do not call a team “integrated” until MYReady is invoked from their software or automated test suite.
- Do not infer willingness to pay from free usage.
- Exclude unauthenticated and rate-limited attempts from product-usage evidence.

## Pilot decision after 30 days

- **Continue:** at least one real integration shows repeated useful use and concrete saved work.
- **Refine:** integration occurs but missing/noisy rules block dependence.
- **Kill or reposition:** activity remains manual, one-off or offers no advantage over existing free tools.
