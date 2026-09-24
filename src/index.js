import {
  authorizeSandbox, duplicateFingerprint, executeAddressResolution, issueSandboxToken,
  obviousAutomationNoise, recordSandboxEvent, revokeSandboxToken, sandboxFingerprint,
} from "./sandbox.js";
import addressSandboxOpenApi from "../docs/address-sandbox-openapi.json" with { type: "json" };

const VERSION = "1.0";
const SIMULATED_UNIT_VALUE = Object.freeze({ currency: "MYR", amount_minor: 1, amount: 0.01 });
const DEFAULT_PILOT_RATE_LIMIT = 60;

const STATES = {
  johor: "01", kedah: "02", kelantan: "03", melaka: "04", malacca: "04",
  "negeri sembilan": "05", pahang: "06", "pulau pinang": "07", penang: "07",
  perak: "08", perlis: "09", selangor: "10", terengganu: "11", sabah: "12",
  sarawak: "13", "kuala lumpur": "14", kl: "14", labuan: "15", putrajaya: "16",
};

const PAYMENTS = {
  cash: "01", tunai: "01", cheque: "02", cek: "02", "bank transfer": "03",
  "online transfer": "03", "transfer bank": "03", "credit card": "04",
  "kad kredit": "04", "debit card": "05", "kad debit": "05", "e-wallet": "06",
  ewallet: "06", "digital wallet": "06", "digital bank": "07",
};

const DOCUMENTS = {
  "self-billed invoice": "11", "self billed invoice": "11", "credit note": "02",
  "nota kredit": "02", "debit note": "03", "nota debit": "03", "refund note": "04",
  "nota bayaran balik": "04", invoice: "01", invois: "01",
};

const MYINVOIS_DOCUMENT_TYPES = new Set(["01", "02", "03", "04", "11", "12", "13", "14"]);
const MYINVOIS_ID_TYPES = new Set(["BRN", "NRIC", "PASSPORT", "ARMY"]);
const MYINVOIS_TAX_TYPES = new Set(["01", "02", "03", "04", "05", "06", "E"]);
const MYINVOIS_STATE_CODES = new Set([...new Set(Object.values(STATES)), "17"]);
const MYINVOIS_PAYMENT_MODES = new Set(["01", "02", "03", "04", "05", "06", "07", "08"]);
const MYINVOIS_CLASSIFICATIONS = new Set(Array.from({ length: 45 }, (_, index) => String(index + 1).padStart(3, "0")));

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findNamedMatches(text, dictionary) {
  const matches = [];
  for (const name of Object.keys(dictionary).sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(name)}(?=$|[^a-z0-9])`, "gi");
    let match;
    while ((match = pattern.exec(text)) !== null) {
      matches.push({ name, code: dictionary[name], index: match.index + match[1].length });
    }
  }
  return matches.sort((a, b) => a.index - b.index);
}

function parseMoneyCandidates(text) {
  const pattern = /(?<![a-z0-9])(?:rm|myr)\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?!\d|[,.]\d)\s*(juta|ribu|k|m)?(?=$|[^a-z0-9])/gi;
  const candidates = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    let amount = Number(match[1].replaceAll(",", ""));
    const unit = (match[2] || "").toLowerCase();
    if (unit === "k" || unit === "ribu") amount *= 1_000;
    if (unit === "m" || unit === "juta") amount *= 1_000_000;
    if (Number.isFinite(amount)) {
      candidates.push({ amount, index: match.index, end: pattern.lastIndex, raw: match[0] });
    }
  }
  return candidates;
}

function chooseAmount(text, candidates) {
  if (candidates.length === 0) return { candidate: null, ambiguous: false, candidates: [] };
  const uniqueAmounts = [...new Set(candidates.map(({ amount }) => amount))];
  if (uniqueAmounts.length === 1) return { candidate: candidates[0], ambiguous: false, candidates };

  const hintPattern = /\b(?:grand\s+total|jumlah\s+keseluruhan|jumlah\s+akhir|jumlah\s+perlu\s+dibayar|amount\s+due|total\s+due|net\s+total|total|jumlah)\b/gi;
  const hints = [...text.matchAll(hintPattern)].map((match) => ({ index: match.index, end: match.index + match[0].length }));
  if (hints.length === 0) return { candidate: null, ambiguous: true, candidates };

  const ranked = candidates.map((candidate) => {
    const distance = Math.min(...hints.map((hint) => {
      if (candidate.index >= hint.end) return candidate.index - hint.end;
      if (hint.index >= candidate.end) return hint.index - candidate.end;
      return 0;
    }));
    return { candidate, distance };
  }).filter(({ distance }) => distance <= 50).sort((a, b) => a.distance - b.distance);

  if (ranked.length === 0 || (ranked[1] && ranked[0].distance === ranked[1].distance)) {
    return { candidate: null, ambiguous: true, candidates };
  }
  return { candidate: ranked[0].candidate, ambiguous: false, candidates };
}

export function resolveMalaysia(text) {
  const resolved = {};
  const warnings = [];
  const ambiguities = {};

  const amountResult = chooseAmount(text, parseMoneyCandidates(text));
  if (amountResult.candidate) {
    resolved.amount = amountResult.candidate.amount;
    resolved.currency = "MYR";
  } else if (amountResult.ambiguous) {
    ambiguities.amounts = amountResult.candidates.map(({ amount, raw }) => ({ amount, currency: "MYR", raw }));
    warnings.push("Multiple MYR amounts found; no unique total could be resolved.");
  }

  const phones = text.match(/(?<!\d)(?:\+?60[\s-]*1\d|01\d)(?:[\s-]*\d){7,8}(?!\d)/g) || [];
  for (const candidate of phones) {
    let digits = candidate.replace(/\D/g, "");
    if (digits.startsWith("60")) digits = `0${digits.slice(2)}`;
    if (/^01\d{8,9}$/.test(digits)) {
      resolved.phone = `+60${digits.slice(1)}`;
      break;
    }
  }

  let match = text.match(/(?<!\d)(\d{12})(?!\d)/);
  if (match) {
    resolved.registration_no = match[1];
    warnings.push("SSM number parsed by format only; registration existence not verified.");
  }

  match = text.match(/(?<!\d)(\d{5})(?!\d)/);
  if (match) {
    resolved.postcode = match[1];
    warnings.push("Postcode extracted; city/state relationship not yet verified against authoritative postcode data.");
  }

  const stateMatches = findNamedMatches(text, STATES);
  const uniqueStates = [...new Map(stateMatches.map(({ name, code }) => [code, { name, code }])).values()];
  if (uniqueStates.length === 1) resolved.state_code = uniqueStates[0].code;
  if (uniqueStates.length > 1) {
    ambiguities.states = uniqueStates;
    warnings.push("Multiple Malaysian states found; state_code was not resolved.");
  }

  const payment = findNamedMatches(text, PAYMENTS)[0];
  if (payment) resolved.payment_mode = payment.code;
  const document = findNamedMatches(text, DOCUMENTS)[0];
  if (document) resolved.document_type = document.code;

  const hasAmbiguity = Object.keys(ambiguities).length > 0;
  const response = {
    resolved,
    warnings,
    machine_ready: resolved.amount !== undefined && resolved.currency === "MYR" && !hasAmbiguity,
  };
  if (hasAmbiguity) response.ambiguities = ambiguities;
  return response;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function addIssue(collection, path, code, message) {
  collection.push({ path, code, message });
}

function validateParty(party, path, errors, warnings) {
  if (!isObject(party)) {
    addIssue(errors, path, "required", `${path} is required.`);
    return;
  }
  for (const field of ["tin", "id_type", "id_value", "name"]) {
    if (typeof party[field] !== "string" || !party[field].trim()) {
      addIssue(errors, `${path}.${field}`, "required", `${field} is required.`);
    }
  }
  if (party.id_type && !MYINVOIS_ID_TYPES.has(party.id_type)) {
    addIssue(errors, `${path}.id_type`, "invalid_code", "Use BRN, NRIC, PASSPORT or ARMY.");
  }
  if (party.id_type === "NRIC" && party.id_value && !/^\d{12}$/.test(party.id_value)) {
    addIssue(errors, `${path}.id_value`, "invalid_format", "NRIC must contain 12 digits without separators.");
  }
  if (party.tin && !/^[A-Z0-9]{8,20}$/.test(party.tin)) {
    addIssue(errors, `${path}.tin`, "invalid_format", "TIN must contain 8 to 20 uppercase letters or digits.");
  }
  if (party.phone && !/^\+?[0-9]{8,15}$/.test(party.phone)) {
    addIssue(errors, `${path}.phone`, "invalid_format", "Phone must contain 8 to 15 digits with an optional leading +.");
  }
  if (party.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(party.email)) {
    addIssue(errors, `${path}.email`, "invalid_format", "Email format is invalid.");
  }

  const address = party.address;
  if (!isObject(address)) {
    addIssue(errors, `${path}.address`, "required", "Address is required.");
    return;
  }
  for (const field of ["line", "city", "postcode", "state_code", "country_code"]) {
    if (typeof address[field] !== "string" || !address[field].trim()) {
      addIssue(errors, `${path}.address.${field}`, "required", `${field} is required.`);
    }
  }
  if (address.country_code && !/^[A-Z]{3}$/.test(address.country_code)) {
    addIssue(errors, `${path}.address.country_code`, "invalid_format", "Country code must use three uppercase letters.");
  }
  if (address.country_code === "MYS") {
    if (!/^\d{5}$/.test(address.postcode || "")) {
      addIssue(errors, `${path}.address.postcode`, "invalid_format", "Malaysian postcode must contain 5 digits.");
    }
    if (!MYINVOIS_STATE_CODES.has(address.state_code)) {
      addIssue(errors, `${path}.address.state_code`, "invalid_code", "Use an official MyInvois Malaysia state code.");
    }
  } else if (address.country_code && address.state_code && address.state_code.length > 50) {
    addIssue(errors, `${path}.address.state_code`, "too_long", "Foreign state must not exceed 50 characters.");
  }
  if (party.tin && party.id_type && party.id_value) {
    addIssue(warnings, path, "not_authoritatively_verified", "TIN and identity pairing passed local format checks only; validate it with MyInvois.");
  }
}

export function preflightMyInvois(document) {
  const errors = [];
  const warnings = [];
  if (!isObject(document)) {
    return { status: "rejected", ready: false, errors: [{ path: "document", code: "required", message: "document is required." }], warnings };
  }

  if (!new Set(["1.0", "1.1"]).has(document.e_invoice_version)) {
    addIssue(errors, "e_invoice_version", "invalid_version", "Use MyInvois e-Invoice version 1.0 or 1.1.");
  }
  if (!MYINVOIS_DOCUMENT_TYPES.has(document.document_type_code)) {
    addIssue(errors, "document_type_code", "invalid_code", "Use a supported MyInvois e-Invoice type code.");
  }
  if (typeof document.invoice_number !== "string" || !document.invoice_number.trim()) {
    addIssue(errors, "invoice_number", "required", "invoice_number is required.");
  } else if (document.invoice_number.length > 50) {
    addIssue(errors, "invoice_number", "too_long", "invoice_number must not exceed 50 characters.");
  }
  if (!isValidDate(document.issue_date)) {
    addIssue(errors, "issue_date", "invalid_format", "issue_date must be a real date in YYYY-MM-DD format.");
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$/.test(document.issue_time || "")) {
    addIssue(errors, "issue_time", "invalid_format", "issue_time must use HH:MM:SSZ in UTC.");
  }
  if (!/^[A-Z]{3}$/.test(document.currency || "")) {
    addIssue(errors, "currency", "invalid_format", "currency must use a three-letter ISO-style code.");
  }
  if (document.currency && document.currency !== "MYR" && (!isFiniteNumber(document.exchange_rate) || document.exchange_rate <= 0)) {
    addIssue(errors, "exchange_rate", "required", "A positive exchange_rate is required for foreign currency.");
  }
  if (document.payment_mode && !MYINVOIS_PAYMENT_MODES.has(document.payment_mode)) {
    addIssue(errors, "payment_mode", "invalid_code", "Use an official MyInvois payment mode code.");
  }

  validateParty(document.supplier, "supplier", errors, warnings);
  validateParty(document.buyer, "buyer", errors, warnings);

  if (!Array.isArray(document.lines) || document.lines.length === 0) {
    addIssue(errors, "lines", "required", "At least one invoice line is required.");
  } else {
    document.lines.forEach((line, index) => {
      const path = `lines[${index}]`;
      if (!isObject(line)) {
        addIssue(errors, path, "invalid_type", "Invoice line must be an object.");
        return;
      }
      if (typeof line.description !== "string" || !line.description.trim()) addIssue(errors, `${path}.description`, "required", "description is required.");
      if (!MYINVOIS_CLASSIFICATIONS.has(line.classification_code)) addIssue(errors, `${path}.classification_code`, "invalid_code", "Use an official MyInvois classification code from 001 to 045.");
      if (!MYINVOIS_TAX_TYPES.has(line.tax_type)) addIssue(errors, `${path}.tax_type`, "invalid_code", "Use an official MyInvois tax type code.");
      if (!isFiniteNumber(line.quantity) || line.quantity <= 0) addIssue(errors, `${path}.quantity`, "invalid_value", "quantity must be greater than zero.");
      if (!isFiniteNumber(line.unit_price) || line.unit_price < 0) addIssue(errors, `${path}.unit_price`, "invalid_value", "unit_price must be zero or greater.");
      if (!isFiniteNumber(line.line_total) || line.line_total < 0) addIssue(errors, `${path}.line_total`, "invalid_value", "line_total must be zero or greater.");
      if (isFiniteNumber(line.quantity) && isFiniteNumber(line.unit_price) && isFiniteNumber(line.line_total)) {
        const calculated = line.quantity * line.unit_price;
        if (Math.abs(calculated - line.line_total) > 0.01) addIssue(errors, `${path}.line_total`, "arithmetic_mismatch", "line_total does not match quantity multiplied by unit_price.");
      }
    });
  }

  const totals = document.totals;
  if (!isObject(totals)) {
    addIssue(errors, "totals", "required", "totals is required.");
  } else {
    for (const field of ["subtotal", "tax", "total"]) {
      if (!isFiniteNumber(totals[field]) || totals[field] < 0) addIssue(errors, `totals.${field}`, "invalid_value", `${field} must be zero or greater.`);
    }
    if (isFiniteNumber(totals.subtotal) && Array.isArray(document.lines)) {
      const lineSum = document.lines.reduce((sum, line) => sum + (isFiniteNumber(line?.line_total) ? line.line_total : 0), 0);
      if (Math.abs(lineSum - totals.subtotal) > 0.01) addIssue(errors, "totals.subtotal", "arithmetic_mismatch", "subtotal does not match the sum of line totals.");
    }
    if (isFiniteNumber(totals.subtotal) && isFiniteNumber(totals.tax) && isFiniteNumber(totals.total) && Math.abs(totals.subtotal + totals.tax - totals.total) > 0.01) {
      addIssue(errors, "totals.total", "arithmetic_mismatch", "total does not match subtotal plus tax.");
    }
  }

  const status = errors.length ? "rejected" : warnings.length ? "needs_review" : "ready";
  return {
    status,
    ready: errors.length === 0,
    validation_scope: "local_preflight_not_authoritative_myinvois_validation",
    errors,
    warnings,
  };
}

function isValidIdempotencyKey(value) {
  return value === null || /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

async function createOperationId(text, idempotencyKey) {
  if (!idempotencyKey) return crypto.randomUUID();
  const bytes = new TextEncoder().encode(`myready:v1:resolve:${idempotencyKey}:${text}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createPreflightOperationId(document, idempotencyKey) {
  if (!idempotencyKey) return crypto.randomUUID();
  const bytes = new TextEncoder().encode(`myready:v1:myinvois-preflight:${idempotencyKey}:${JSON.stringify(document)}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function attachUsage(result, operationId, idempotent) {
  return {
    ...result,
    usage: {
      operation_id: operationId,
      idempotent,
      simulated_value_eligible: result.machine_ready,
      simulated_unit_value: SIMULATED_UNIT_VALUE,
      simulated_value_status: "not_recorded",
      economic_mode: "simulated_value_only",
      cash_collected: false,
    },
  };
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function ensurePilotSecurityTables(database) {
  await database.prepare(`
    CREATE TABLE IF NOT EXISTS pilot_participants (
      participant_id TEXT PRIMARY KEY,
      token_hash TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
      rate_limit_per_minute INTEGER NOT NULL DEFAULT 60 CHECK (rate_limit_per_minute BETWEEN 1 AND 600),
      created_at TEXT NOT NULL,
      revoked_at TEXT
    )
  `).run();
  await database.prepare(`
    CREATE TABLE IF NOT EXISTS pilot_rate_limits (
      participant_id TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      request_count INTEGER NOT NULL,
      PRIMARY KEY (participant_id, window_start)
    )
  `).run();
}

function bearerToken(request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization) return null;
  const match = authorization.match(/^Bearer (myr_pilot_[A-Za-z0-9_-]{32,128})$/);
  return match?.[1] || null;
}

async function authorizePilot(request, env, now = Date.now()) {
  const token = bearerToken(request);
  if (!token || !env?.LEDGER) return { ok: false, status: 401, error: "invalid_pilot_token" };

  await ensurePilotSecurityTables(env.LEDGER);
  const tokenHash = await sha256Hex(token);
  const participant = await env.LEDGER.prepare(`
    SELECT participant_id, rate_limit_per_minute
    FROM pilot_participants
    WHERE token_hash = ? AND status = 'active' AND revoked_at IS NULL
  `).bind(tokenHash).first();
  if (!participant) return { ok: false, status: 401, error: "invalid_pilot_token" };

  const windowStart = Math.floor(now / 60_000) * 60;
  await env.LEDGER.prepare(`
    INSERT INTO pilot_rate_limits (participant_id, window_start, request_count)
    VALUES (?, ?, 1)
    ON CONFLICT(participant_id, window_start)
    DO UPDATE SET request_count = request_count + 1
  `).bind(participant.participant_id, windowStart).run();
  const bucket = await env.LEDGER.prepare(`
    SELECT request_count FROM pilot_rate_limits
    WHERE participant_id = ? AND window_start = ?
  `).bind(participant.participant_id, windowStart).first();
  const limit = Number(participant.rate_limit_per_minute) || DEFAULT_PILOT_RATE_LIMIT;
  const remaining = Math.max(0, limit - Number(bucket?.request_count || 1));
  if (Number(bucket?.request_count || 1) > limit) {
    return { ok: false, status: 429, error: "rate_limit_exceeded", limit, remaining, retryAfter: 60 - (Math.floor(now / 1000) % 60) };
  }
  return { ok: true, participantId: participant.participant_id, limit, remaining };
}

async function recordPilotEvent(env, event) {
  if (!env?.LEDGER) return;
  try {
    await env.LEDGER.prepare(`
      CREATE TABLE IF NOT EXISTS pilot_events_v2 (
        event_id TEXT PRIMARY KEY,
        participant_id TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        outcome TEXT NOT NULL,
        reason_codes TEXT NOT NULL,
        simulated_value_eligible INTEGER NOT NULL,
        duplicate INTEGER NOT NULL,
        idempotent INTEGER NOT NULL,
        simulated_amount_minor INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )
    `).run();
    await env.LEDGER.prepare(`
      INSERT INTO pilot_events_v2
        (event_id, participant_id, endpoint, outcome, reason_codes, simulated_value_eligible, duplicate, idempotent, simulated_amount_minor, latency_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), event.pilotClientId, event.endpoint, event.outcome,
      JSON.stringify([...new Set(event.reasonCodes)]), event.usage.simulated_value_eligible ? 1 : 0,
      event.usage.ledger?.duplicate ? 1 : 0, event.usage.idempotent ? 1 : 0,
      event.usage.simulated_value_eligible && !event.usage.ledger?.duplicate ? 1 : 0,
      Math.max(0, Math.round(event.latencyMs)), new Date().toISOString(),
    ).run();
  } catch {
    // Pilot telemetry must never make the validation endpoint unavailable.
  }
}

async function recordSimulatedValueOperation(env, usage, endpoint = "/v1/malaysia/resolve") {
  if (!usage.simulated_value_eligible || !env?.LEDGER) return usage;

  await env.LEDGER.prepare(`
    CREATE TABLE IF NOT EXISTS operations (
      operation_id TEXT PRIMARY KEY,
      endpoint TEXT NOT NULL,
      idempotent INTEGER NOT NULL,
      currency TEXT NOT NULL,
      amount_minor INTEGER NOT NULL CHECK (amount_minor = 1),
      created_at TEXT NOT NULL
    )
  `).run();

  const insertion = await env.LEDGER.prepare(`
    INSERT OR IGNORE INTO operations
      (operation_id, endpoint, idempotent, currency, amount_minor, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    usage.operation_id,
    endpoint,
    usage.idempotent ? 1 : 0,
    usage.simulated_unit_value.currency,
    usage.simulated_unit_value.amount_minor,
    new Date().toISOString(),
  ).run();

  const newlyRecorded = insertion.meta?.changes === 1;
  return {
    ...usage,
    simulated_value_status: "recorded_simulation_only",
    ledger: {
      recorded: true,
      duplicate: !newlyRecorded,
    },
  };
}

export default {
  async fetch(request, env) {
    const startedAt = performance.now();
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, service: "MYReady", version: VERSION });
    }
    if (request.method === "GET" && url.pathname === "/openapi/address-sandbox.json") {
      return Response.json(addressSandboxOpenApi, { headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      } });
    }
    if (request.method === "POST" && url.pathname === "/sandbox/v1/access") {
      let issued;
      try {
        issued = await issueSandboxToken(request, env);
      } catch {
        issued = { ok: false, status: 503, error: "sandbox_access_unavailable" };
      }
      if (!issued.ok) return Response.json({ error: issued.error }, { status: issued.status, headers: { "Cache-Control": "no-store" } });
      return Response.json({
        token: issued.token,
        token_type: "Bearer",
        expires_at: issued.expiresAt,
        scope: "sandbox:address:resolve",
        rate_limit_per_minute: issued.limit,
        commercial_relationship: false,
        billing_enabled: false,
      }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "DELETE" && url.pathname === "/sandbox/v1/access") {
      let revoked;
      try {
        revoked = await revokeSandboxToken(request, env);
      } catch {
        revoked = { ok: false, status: 503, error: "sandbox_access_unavailable" };
      }
      if (!revoked.ok) return Response.json({ error: revoked.error }, { status: revoked.status, headers: { "Cache-Control": "no-store" } });
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "POST" && url.pathname === "/sandbox/v1/address/resolve") {
      let authorization;
      try {
        authorization = await authorizeSandbox(request, env);
      } catch {
        return Response.json({ error: "sandbox_authentication_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
      }
      if (!authorization.ok) {
        const headers = { "Cache-Control": "no-store" };
        if (authorization.retryAfter) headers["Retry-After"] = String(authorization.retryAfter);
        return Response.json({ error: authorization.error }, { status: authorization.status, headers });
      }
      const declaredLength = Number(request.headers.get("content-length") || 0);
      if (declaredLength > 10_000) return Response.json({ error: "payload_too_large" }, { status: 413 });
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "invalid_json" }, { status: 400 });
      }
      if (!isObject(body) || typeof body.address !== "string" || body.address.trim().length < 4) {
        return Response.json({ error: "address_required" }, { status: 422 });
      }
      if (Object.keys(body).some((field) => !["address", "postcode", "locality", "state"].includes(field))) {
        return Response.json({ error: "unknown_field" }, { status: 422 });
      }
      if (body.address.length > 500) return Response.json({ error: "address_too_long" }, { status: 413 });
      for (const field of ["postcode", "locality", "state"]) {
        if (body[field] !== undefined && typeof body[field] !== "string") return Response.json({ error: `invalid_${field}` }, { status: 422 });
        if (typeof body[field] === "string" && body[field].length > 100) return Response.json({ error: `${field}_too_long` }, { status: 413 });
      }
      const idempotencyKey = request.headers.get("Idempotency-Key");
      if (!idempotencyKey || !isValidIdempotencyKey(idempotencyKey)) return Response.json({ error: "valid_idempotency_key_required" }, { status: 400 });

      const resolution = executeAddressResolution(body);
      const fingerprint = await sandboxFingerprint(env, authorization, body);
      const duplicate = await duplicateFingerprint(env, authorization, fingerprint);
      const noise = obviousAutomationNoise(request);
      const fieldCount = [body.address, body.postcode, body.locality, body.state].filter((value) => typeof value === "string" && value.trim()).length;
      const postcodeOnly = fieldCount === 1 && /^\s*\d{5}\s*$/.test(body.address);
      const meaningful = resolution.meaningful_resolution;
      const qualified = !authorization.isInternal && !duplicate && !noise && !postcodeOnly && meaningful;
      await recordSandboxEvent(env, {
        tokenId: authorization.tokenId, isInternal: authorization.isInternal, outcome: resolution.status,
        qualified, duplicate, noise, fingerprint, fieldCount, hasAddress: true,
        hasPostcode: Boolean(body.postcode || /(?<!\d)\d{5}(?!\d)/.test(body.address)),
        meaningful, ambiguity: resolution.status === "ambiguous", conflict: resolution.status === "conflict",
        latencyMs: performance.now() - startedAt,
      });
      return Response.json({
        ...resolution,
        experiment: {
          economic_mode: "free_bounded_validation",
          billing_enabled: false,
          observation_qualified: qualified,
          duplicate,
          dataset_version: resolution.provenance.version,
        },
      }, { headers: {
        "Cache-Control": "no-store",
        "X-RateLimit-Limit": String(authorization.limit),
        "X-RateLimit-Remaining": String(authorization.remaining),
        "X-MYReady-Observation-Qualified": String(qualified),
      } });
    }
    if (request.method === "POST" && url.pathname === "/v1/myinvois/preflight") {
      let authorization;
      try {
        authorization = await authorizePilot(request, env);
      } catch {
        return Response.json({ error: "pilot_authentication_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
      }
      if (!authorization.ok) {
        const headers = { "Cache-Control": "no-store" };
        if (authorization.retryAfter) headers["Retry-After"] = String(authorization.retryAfter);
        return Response.json({ error: authorization.error }, { status: authorization.status, headers });
      }
      const declaredLength = Number(request.headers.get("content-length") || 0);
      if (declaredLength > 100_000) return Response.json({ error: "payload_too_large" }, { status: 413 });
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "invalid_json" }, { status: 400 });
      }
      if (JSON.stringify(body).length > 100_000) return Response.json({ error: "payload_too_large" }, { status: 413 });
      const idempotencyKey = request.headers.get("Idempotency-Key");
      if (!isValidIdempotencyKey(idempotencyKey)) return Response.json({ error: "invalid_idempotency_key" }, { status: 400 });
      const operationId = await createPreflightOperationId(body.document, idempotencyKey);
      const preflight = preflightMyInvois(body.document);
      const result = attachUsage({ ...preflight, machine_ready: preflight.ready }, operationId, idempotencyKey !== null);
      result.usage = await recordSimulatedValueOperation(env, result.usage, "/v1/myinvois/preflight");
      await recordPilotEvent(env, {
        pilotClientId: authorization.participantId,
        endpoint: "/v1/myinvois/preflight",
        outcome: preflight.status,
        reasonCodes: [...preflight.errors, ...preflight.warnings].map(({ code }) => code),
        usage: result.usage,
        latencyMs: performance.now() - startedAt,
      });
      return Response.json(result, {
        headers: {
          "X-MYReady-Operation-Id": operationId,
          "X-MYReady-Simulated-Value-Eligible": String(result.usage.simulated_value_eligible),
          "X-MYReady-Simulated-Unit-Value": "MYR 0.01",
          "X-RateLimit-Limit": String(authorization.limit),
          "X-RateLimit-Remaining": String(authorization.remaining),
          "Cache-Control": "no-store",
        },
      });
    }
    if (request.method !== "POST" || url.pathname !== "/v1/malaysia/resolve") {
      return Response.json({
        service: "MYReady", version: VERSION, status: "online",
        endpoints: {
          health: "GET /health", resolve: "POST /v1/malaysia/resolve",
          preflight: "POST /v1/myinvois/preflight", sandbox_access: "POST /sandbox/v1/access",
          address_resolver: "POST /sandbox/v1/address/resolve",
        },
      }, { status: 404 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
    if (typeof body.text !== "string" || !body.text.trim()) {
      return Response.json({ error: "text_required" }, { status: 422 });
    }
    if (body.text.length > 5000) return Response.json({ error: "text_too_long" }, { status: 413 });
    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (!isValidIdempotencyKey(idempotencyKey)) {
      return Response.json({ error: "invalid_idempotency_key" }, { status: 400 });
    }
    const operationId = await createOperationId(body.text, idempotencyKey);
    const result = attachUsage(resolveMalaysia(body.text), operationId, idempotencyKey !== null);
    result.usage = await recordSimulatedValueOperation(env, result.usage);
    await recordPilotEvent(env, {
      pilotClientId: "unattributed",
      endpoint: "/v1/malaysia/resolve",
      outcome: result.machine_ready ? "ready" : "rejected",
      reasonCodes: Object.keys(result.ambiguities || {}).map((name) => `ambiguous_${name}`),
      usage: result.usage,
      latencyMs: performance.now() - startedAt,
    });
    return Response.json(result, {
      headers: {
        "X-MYReady-Operation-Id": operationId,
        "X-MYReady-Simulated-Value-Eligible": String(result.usage.simulated_value_eligible),
        "X-MYReady-Simulated-Unit-Value": "MYR 0.01",
      },
    });
  },
};
