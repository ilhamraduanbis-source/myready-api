import test from "node:test";
import assert from "node:assert/strict";
import worker, { preflightMyInvois, resolveMalaysia } from "../src/index.js";

function validInvoice() {
  const address = { line: "1 Jalan Ampang", city: "Kuala Lumpur", postcode: "50450", state_code: "14", country_code: "MYS" };
  return {
    e_invoice_version: "1.0",
    document_type_code: "01",
    invoice_number: "INV-1001",
    issue_date: "2026-09-24",
    issue_time: "05:00:00Z",
    currency: "MYR",
    payment_mode: "03",
    supplier: { tin: "C1234567890", id_type: "BRN", id_value: "202601234567", name: "Supplier Sdn Bhd", address: { ...address } },
    buyer: { tin: "C0987654321", id_type: "BRN", id_value: "202609876543", name: "Buyer Sdn Bhd", address: { ...address } },
    lines: [{ description: "Consulting", classification_code: "022", tax_type: "06", quantity: 2, unit_price: 50, line_total: 100 }],
    totals: { subtotal: 100, tax: 0, total: 100 },
  };
}

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

test("health identifies v1.0", async () => {
  const response = await worker.fetch(new Request("https://example.test/health"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).version, "1.0");
});

test("MyInvois preflight accepts a structurally ready invoice", () => {
  const result = preflightMyInvois(validInvoice());
  assert.equal(result.ready, true);
  assert.equal(result.status, "needs_review");
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.filter((item) => item.code === "not_authoritatively_verified").length, 2);
});

test("MyInvois preflight rejects missing and malformed mandatory fields", () => {
  const invoice = validInvoice();
  invoice.issue_date = "2026-02-30";
  invoice.buyer.address.postcode = "1234";
  invoice.buyer.address.state_code = "99";
  invoice.buyer.id_type = "NRIC";
  invoice.buyer.id_value = "900101-10-1234";
  const result = preflightMyInvois(invoice);
  assert.equal(result.ready, false);
  assert.equal(result.status, "rejected");
  assert.deepEqual(result.errors.map((item) => item.path).sort(), [
    "buyer.address.postcode", "buyer.address.state_code", "buyer.id_value", "issue_date",
  ]);
});

test("MyInvois preflight requires exchange rate for foreign currency", () => {
  const invoice = validInvoice();
  invoice.currency = "USD";
  const result = preflightMyInvois(invoice);
  assert.equal(result.ready, false);
  assert.equal(result.errors.some((item) => item.path === "exchange_rate"), true);
  invoice.exchange_rate = 4.2;
  assert.equal(preflightMyInvois(invoice).ready, true);
});

test("MyInvois preflight catches line and total arithmetic mismatches", () => {
  const invoice = validInvoice();
  invoice.lines[0].line_total = 90;
  invoice.totals = { subtotal: 80, tax: 6, total: 100 };
  const paths = preflightMyInvois(invoice).errors.map((item) => item.path);
  assert.equal(paths.includes("lines[0].line_total"), true);
  assert.equal(paths.includes("totals.subtotal"), true);
  assert.equal(paths.includes("totals.total"), true);
});

test("MyInvois preflight rejects invented classification codes", () => {
  const invoice = validInvoice();
  invoice.lines[0].classification_code = "999";
  const result = preflightMyInvois(invoice);
  assert.equal(result.ready, false);
  assert.equal(result.errors[0].path, "lines[0].classification_code");
});

test("MyInvois preflight endpoint charges only locally ready documents", async () => {
  const response = await worker.fetch(new Request("https://example.test/v1/myinvois/preflight", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": "preflight-1" },
    body: JSON.stringify({ document: validInvoice() }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.machine_ready, true);
  assert.equal(body.status, "needs_review");
  assert.equal(body.usage.chargeable, true);
  assert.equal(response.headers.get("X-MYReady-Unit-Price"), "MYR 0.01");

  const invalid = validInvoice();
  invalid.totals.total = 999;
  const rejected = await (await worker.fetch(new Request("https://example.test/v1/myinvois/preflight", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ document: invalid }),
  }))).json();
  assert.equal(rejected.usage.chargeable, false);
});

test("MyInvois preflight ledger stores endpoint but not invoice contents", async () => {
  const statements = [];
  const LEDGER = {
    prepare(sql) {
      const statement = { sql, values: [] };
      statements.push(statement);
      return { bind(...values) { statement.values = values; return this; }, async run() { return { meta: { changes: 1 } }; } };
    },
  };
  const invoice = validInvoice();
  invoice.invoice_number = "PRIVATE-INVOICE-SECRET";
  const response = await worker.fetch(new Request("https://example.test/v1/myinvois/preflight", {
    method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "preflight-ledger" }, body: JSON.stringify({ document: invoice }),
  }), { LEDGER });
  const body = await response.json();
  assert.equal(body.usage.charge_status, "recorded_not_collected");
  assert.equal(JSON.stringify(statements).includes("/v1/myinvois/preflight"), true);
  assert.equal(JSON.stringify(statements).includes("PRIVATE-INVOICE-SECRET"), false);
});

test("MyInvois preflight rejects oversized payloads", async () => {
  const response = await worker.fetch(new Request("https://example.test/v1/myinvois/preflight", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ document: { note: "x".repeat(100_001) } }),
  }));
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "payload_too_large" });
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
