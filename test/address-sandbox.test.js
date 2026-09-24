import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { resolveAddress } from "../src/address.js";
import { authorizeSandbox, issueSandboxToken, revokeSandboxToken, sha256Hex } from "../src/sandbox.js";

function memoryLedger() {
  const state = { settings: new Map(), access: new Map(), tokens: new Map(), rates: new Map(), events: [] };
  return {
    state,
    prepare(sql) {
      const statement = { values: [] };
      return {
        bind(...values) { statement.values = values; return this; },
        async run() {
          if (sql.includes("INSERT OR IGNORE INTO sandbox_settings")) {
            const [key, value] = statement.values;
            if (!state.settings.has(key)) state.settings.set(key, value);
          } else if (sql.includes("INSERT INTO sandbox_access_limits")) {
            const [source, day] = statement.values;
            const key = `${source}|${day}`;
            state.access.set(key, (state.access.get(key) || 0) + 1);
          } else if (sql.includes("INSERT INTO sandbox_tokens")) {
            const [id, hash, limit, created, expires] = statement.values;
            state.tokens.set(hash, { token_id: id, token_hash: hash, status: "active", is_internal: 0,
              rate_limit_per_minute: limit, created_at: created, expires_at: expires, revoked_at: null });
          } else if (sql.includes("INSERT INTO sandbox_rate_limits")) {
            const [id, window] = statement.values;
            const key = `${id}|${window}`;
            state.rates.set(key, (state.rates.get(key) || 0) + 1);
          } else if (sql.includes("INSERT INTO sandbox_events")) {
            state.events.push(statement.values);
          } else if (sql.includes("UPDATE sandbox_tokens SET status = 'revoked'")) {
            const [revokedAt, hash] = statement.values;
            const row = state.tokens.get(hash);
            if (row) { row.status = "revoked"; row.revoked_at = revokedAt; }
          }
          return { meta: { changes: 1 } };
        },
        async first() {
          if (sql.includes("FROM sandbox_settings")) return { setting_value: state.settings.get(statement.values[0]) };
          if (sql.includes("FROM sandbox_access_limits")) {
            return { issue_count: state.access.get(`${statement.values[0]}|${statement.values[1]}`) || 0 };
          }
          if (sql.includes("FROM sandbox_tokens")) {
            const row = state.tokens.get(statement.values[0]);
            return row?.status === "active" && !row.revoked_at ? row : null;
          }
          if (sql.includes("FROM sandbox_rate_limits")) {
            return { request_count: state.rates.get(`${statement.values[0]}|${statement.values[1]}`) || 0 };
          }
          if (sql.includes("FROM sandbox_events")) {
            const [tokenId, fingerprint] = statement.values;
            return state.events.some((event) => event[1] === tokenId && event[8] === fingerprint && event[5] === 1)
              ? { seen: 1 } : null;
          }
          return null;
        },
      };
    },
  };
}

test("address resolver normalises Malaysian abbreviations and uses official postcode provenance", () => {
  const result = resolveAddress({ address: "5 Jln Ampang, Tmn Ampang, 55000 Kuala Lumpur" });
  assert.equal(result.status, "resolved");
  assert.equal(result.machine_ready, true);
  assert.match(result.normalised.address, /Jalan Ampang, Taman Ampang/);
  assert.equal(result.candidates[0].state, "W.P. Kuala Lumpur");
  assert.equal(result.provenance.id, "data.gov.my-poskod");
  assert.equal(result.meaningful_resolution, true);
});

test("address resolver reports conflicts, ambiguity and trivial lookups without guessing", () => {
  const conflict = resolveAddress({ address: "5 Jln Ampang, 55000 KL, Selangor" });
  assert.equal(conflict.status, "conflict");
  assert.deepEqual(conflict.conflicts[0].expected, ["W.P. Kuala Lumpur"]);

  const ambiguous = resolveAddress({ address: "Jalan Contoh 40160" });
  assert.equal(ambiguous.status, "ambiguous");
  assert.ok(ambiguous.candidates.length > 1);

  const trivial = resolveAddress({ address: "55000" });
  assert.equal(trivial.status, "resolved");
  assert.equal(trivial.meaningful_resolution, false);
});

test("anonymous sandbox token is scoped, hashed at rest, revocable and rate limited", async () => {
  const ledger = memoryLedger();
  const env = { LEDGER: ledger };
  const request = new Request("https://example.test/sandbox/v1/access", { method: "POST", headers: { "CF-Connecting-IP": "198.51.100.8" } });
  const issued = await issueSandboxToken(request, env);
  assert.equal(issued.ok, true);
  assert.match(issued.token, /^myr_sandbox_[A-Za-z0-9_-]{40,64}$/);
  const hash = await sha256Hex(issued.token);
  assert.equal(ledger.state.tokens.has(hash), true);
  assert.equal(JSON.stringify([...ledger.state.tokens.values()]).includes(issued.token), false);

  const authRequest = new Request("https://example.test/sandbox/v1/address/resolve", {
    headers: { Authorization: `Bearer ${issued.token}` },
  });
  assert.equal((await authorizeSandbox(authRequest, env)).ok, true);
  ledger.state.tokens.get(hash).rate_limit_per_minute = 2;
  assert.equal((await authorizeSandbox(authRequest, env)).ok, true);
  assert.equal((await authorizeSandbox(authRequest, env)).status, 429);
  assert.equal((await revokeSandboxToken(authRequest, env)).ok, true);
  assert.equal((await authorizeSandbox(authRequest, env)).status, 401);
});

test("sandbox endpoint excludes internal traffic, rejects replay qualification and stores no raw address", async () => {
  const ledger = memoryLedger();
  const env = { LEDGER: ledger };
  const access = await worker.fetch(new Request("https://example.test/sandbox/v1/access", {
    method: "POST", headers: { "CF-Connecting-IP": "198.51.100.9" },
  }), env);
  assert.equal(access.status, 201);
  const { token } = await access.json();
  const rawAddress = "5 Jln Ampang, Tmn Ampang, 55000 Kuala Lumpur";
  const call = (key) => worker.fetch(new Request("https://example.test/sandbox/v1/address/resolve", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}`, "Idempotency-Key": key },
    body: JSON.stringify({ address: rawAddress }),
  }), env);
  let response = await call("address-test-1");
  let body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.experiment.observation_qualified, true);
  response = await call("address-test-2");
  body = await response.json();
  assert.equal(body.experiment.duplicate, true);
  assert.equal(body.experiment.observation_qualified, false);
  assert.equal(JSON.stringify(ledger.state.events).includes(rawAddress), false);

  const tokenHash = await sha256Hex(token);
  ledger.state.tokens.get(tokenHash).is_internal = 1;
  response = await worker.fetch(new Request("https://example.test/sandbox/v1/address/resolve", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}`, "Idempotency-Key": "internal-test" },
    body: JSON.stringify({ address: "7 Jln Tun Razak, 50400 KL" }),
  }), env);
  assert.equal((await response.json()).experiment.observation_qualified, false);
});

test("sandbox credentials cannot authenticate to the MyInvois pilot", async () => {
  const ledger = memoryLedger();
  const env = { LEDGER: ledger };
  const issued = await issueSandboxToken(new Request("https://example.test/sandbox/v1/access", {
    method: "POST", headers: { "CF-Connecting-IP": "198.51.100.10" },
  }), env);
  const response = await worker.fetch(new Request("https://example.test/v1/myinvois/preflight", {
    method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${issued.token}` },
    body: JSON.stringify({ document: {} }),
  }), env);
  assert.equal(response.status, 401);
});
