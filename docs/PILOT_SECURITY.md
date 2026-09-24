# Pilot Security Operations

## Design

- Each participant receives a separate random token beginning with `myr_pilot_`.
- Only the SHA-256 token hash is stored in D1.
- The participant identity used for telemetry comes from the authenticated D1 record, not a client-supplied label.
- Missing, unknown and revoked tokens return the same generic response.
- Rate limiting uses a fixed one-minute D1 bucket per participant. The default is 60 requests per minute.
- Tokens and request bodies are never written to telemetry.

## Provisioning

Generate a cryptographically random token outside logs and source control. Store its SHA-256 hash in `pilot_participants` with a non-sensitive participant ID. Deliver the plaintext token once through an approved private channel. Never send MyInvois credentials to MYReady.

## Revocation

Revocation changes only the participant record:

```sql
UPDATE pilot_participants
SET status = 'revoked', revoked_at = datetime('now')
WHERE participant_id = ?;
```

The next request returns the generic `invalid_pilot_token` response. Replacing a token means generating a new random token and replacing its stored hash; another participant is unaffected.

## Boundary

Security and functional tests target only MYReady-controlled infrastructure. The pilot does not probe, fuzz, scrape protected areas, brute-force, bypass controls or test MyInvois, HASiL, competitors, participants or other third-party production systems. Competitor research uses public information and authorised public interfaces only.
