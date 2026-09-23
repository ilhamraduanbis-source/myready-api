import test from "node:test";
import assert from "node:assert/strict";
import worker, { resolveMalaysia } from "../src/index.js";

test("resolves a localized MYR amount", () => {
  assert.deepEqual(resolveMalaysia("Bayaran MYR 1.5 juta").resolved, { amount: 1_500_000, currency: "MYR" });
  assert.equal(resolveMalaysia("RM 1,000.50").resolved.amount, 1000.5);
  assert.equal(resolveMalaysia("RM1.5k").resolved.amount, 1500);
  assert.equal(resolveMalaysia("RM0").resolved.amount, 0);
});

test("selects a labelled total before or after the amount", () => {
  assert.equal(resolveMalaysia("Subtotal RM100, cukai RM6, jumlah RM106").resolved.amount, 106);
  assert.equal(resolveMalaysia("RM100 subtotal dan RM106 grand total").resolved.amount, 106);
});

test("does not guess between distinct unlabelled amounts", () => {
  const result = resolveMalaysia("Deposit RM50 dan baki RM100");
  assert.equal(result.resolved.amount, undefined);
  assert.equal(result.machine_ready, false);
  assert.deepEqual(result.ambiguities.amounts.map((item) => item.amount), [50, 100]);
});

test("repeated identical amounts are not ambiguous", () => {
  const result = resolveMalaysia("RM50 pada invois; salinan menyatakan RM50");
  assert.equal(result.resolved.amount, 50);
  assert.equal(result.machine_ready, true);
});

test("rejects malformed thousands separators", () => {
  assert.equal(resolveMalaysia("Nilai RM1,2,3").resolved.amount, undefined);
  assert.equal(resolveMalaysia("Nilai RM1.2.3").resolved.amount, undefined);
  assert.equal(resolveMalaysia("Kod RM1abc").resolved.amount, undefined);
});

test("does not silently pick one of multiple states", () => {
  const result = resolveMalaysia("Penghantaran dari Selangor ke Johor, jumlah RM50");
  assert.equal(result.resolved.state_code, undefined);
  assert.equal(result.machine_ready, false);
  assert.deepEqual(result.ambiguities.states.map((item) => item.code).sort(), ["01", "10"]);
});

test("state aliases sharing one code are not ambiguous", () => {
  const result = resolveMalaysia("Melaka (Malacca), RM20");
  assert.equal(result.resolved.state_code, "04");
  assert.equal(result.machine_ready, true);
});

test("uses token boundaries for state and payment names", () => {
  const result = resolveMalaysia("cashless booth in klang, RM10");
  assert.equal(result.resolved.payment_mode, undefined);
  assert.equal(result.resolved.state_code, undefined);
});

test("normalizes phone, document and payment fields", () => {
  assert.deepEqual(resolveMalaysia("Invois RM25, kad debit, 012-345 6789, Kuala Lumpur").resolved, {
    amount: 25, currency: "MYR", phone: "+60123456789", state_code: "14",
    payment_mode: "05", document_type: "01",
  });
});

test("worker validates request body and size", async () => {
  let response = await worker.fetch(new Request("https://example.test/v1/malaysia/resolve", { method: "POST", body: "{" }));
  assert.equal(response.status, 400);
  response = await worker.fetch(new Request("https://example.test/v1/malaysia/resolve", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: " " }),
  }));
  assert.equal(response.status, 422);
  response = await worker.fetch(new Request("https://example.test/v1/malaysia/resolve", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "x".repeat(5001) }),
  }));
  assert.equal(response.status, 413);
});

test("health identifies v0.9", async () => {
  const response = await worker.fetch(new Request("https://example.test/health"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).version, "0.9");
});

test("successful operations expose the explicit one-cent unit price", async () => {
  const response = await worker.fetch(new Request("https://example.test/v1/malaysia/resolve", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": "invoice-123" },
    body: JSON.stringify({ text: "Jumlah RM10 di Selangor" }),
  }));
  const body = await response.json();
  assert.equal(body.usage.chargeable, true);
  assert.equal(body.usage.charge_status, "not_collected");
  assert.deepEqual(body.usage.unit_price, { currency: "MYR", amount_minor: 1, amount: 0.01 });
  assert.equal(body.usage.idempotent, true);
  assert.equal(response.headers.get("X-MYReady-Unit-Price"), "MYR 0.01");
});

test("the same idempotency key and input produce the same operation id", async () => {
  const request = () => new Request("https://example.test/v1/malaysia/resolve", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": "stable-key" },
    body: JSON.stringify({ text: "RM25" }),
  });
  const first = await (await worker.fetch(request())).json();
  const second = await (await worker.fetch(request())).json();
  assert.equal(first.usage.operation_id, second.usage.operation_id);
});

test("ambiguous operations are not chargeable", async () => {
  const response = await worker.fetch(new Request("https://example.test/v1/malaysia/resolve", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": "ambiguous-1" },
    body: JSON.stringify({ text: "RM10 atau RM20" }),
  }));
  const body = await response.json();
  assert.equal(body.usage.chargeable, false);
});

test("invalid idempotency keys are rejected", async () => {
  const response = await worker.fetch(new Request("https://example.test/v1/malaysia/resolve", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": "contains spaces" },
    body: JSON.stringify({ text: "RM10" }),
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_idempotency_key" });
});

test("chargeable operations are recorded without storing source text", async () => {
  const statements = [];
  const LEDGER = {
    prepare(sql) {
      const statement = { sql, values: [] };
      statements.push(statement);
      return {
        bind(...values) {
          statement.values = values;
          return this;
        },
        async run() {
          return { meta: { changes: sql.includes("INSERT OR IGNORE") ? 1 : 0 } };
        },
      };
    },
  };
  const response = await worker.fetch(new Request("https://example.test/v1/malaysia/resolve", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": "ledger-test" },
    body: JSON.stringify({ text: "Sensitive invoice text RM10" }),
  }), { LEDGER });
  const body = await response.json();
  assert.equal(body.usage.charge_status, "recorded_not_collected");
  assert.deepEqual(body.usage.ledger, { recorded: true, duplicate: false });
  assert.equal(statements.length, 2);
  assert.equal(JSON.stringify(statements).includes("Sensitive invoice text"), false);
});

test("ledger identifies an already-recorded operation", async () => {
  const LEDGER = {
    prepare(sql) {
      return {
        bind() { return this; },
        async run() { return { meta: { changes: 0 } }; },
      };
    },
  };
  const response = await worker.fetch(new Request("https://example.test/v1/malaysia/resolve", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": "duplicate-test" },
    body: JSON.stringify({ text: "RM10" }),
  }), { LEDGER });
  const body = await response.json();
  assert.equal(body.usage.ledger.duplicate, true);
});
