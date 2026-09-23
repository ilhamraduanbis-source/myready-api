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

test("health identifies v0.7", async () => {
  const response = await worker.fetch(new Request("https://example.test/health"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).version, "0.7");
});
