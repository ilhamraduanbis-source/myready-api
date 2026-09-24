import { ADDRESS_DATASET, resolveAddress } from "./address.js";

const TOKEN_PREFIX = "myr_sandbox_";
const TOKEN_TTL_DAYS = 90;
const RATE_LIMIT_PER_MINUTE = 30;

export function sandboxBearerToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer (myr_sandbox_[A-Za-z0-9_-]{40,64})$/);
  return match?.[1] || null;
}

export function obviousAutomationNoise(request) {
  const ua = (request.headers.get("User-Agent") || "").toLowerCase();
  return /(crawler|spider|scanner|sqlmap|nikto|nmap|masscan|zgrab|acunetix|nessus)/.test(ua);
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const encoded = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `${TOKEN_PREFIX}${encoded}`;
}

export async function ensureSandboxTables(database) {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS sandbox_tokens (
      token_id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      is_internal INTEGER NOT NULL DEFAULT 0, rate_limit_per_minute INTEGER NOT NULL DEFAULT 30,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS sandbox_rate_limits (
      token_id TEXT NOT NULL, window_start INTEGER NOT NULL, request_count INTEGER NOT NULL,
      PRIMARY KEY (token_id, window_start)
    )`,
    `CREATE TABLE IF NOT EXISTS sandbox_events (
      event_id TEXT PRIMARY KEY, token_id TEXT NOT NULL, is_internal INTEGER NOT NULL,
      endpoint TEXT NOT NULL, outcome TEXT NOT NULL, qualified INTEGER NOT NULL,
      duplicate INTEGER NOT NULL, noise INTEGER NOT NULL, request_fingerprint TEXT NOT NULL,
      field_count INTEGER NOT NULL, has_address INTEGER NOT NULL, has_postcode INTEGER NOT NULL,
      meaningful_normalisation INTEGER NOT NULL, ambiguity INTEGER NOT NULL, conflict INTEGER NOT NULL,
      error_category TEXT, dataset_version TEXT NOT NULL, latency_ms INTEGER NOT NULL, created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS sandbox_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sandbox_access_limits (
      source_hash TEXT NOT NULL, day_bucket TEXT NOT NULL, issue_count INTEGER NOT NULL,
      PRIMARY KEY (source_hash, day_bucket)
    )`,
  ]) await database.prepare(sql).run();
}

async function setting(database, key) {
  let row = await database.prepare("SELECT setting_value FROM sandbox_settings WHERE setting_key = ?").bind(key).first();
  if (row?.setting_value) return row.setting_value;
  const value = crypto.randomUUID() + crypto.randomUUID();
  await database.prepare("INSERT OR IGNORE INTO sandbox_settings (setting_key, setting_value) VALUES (?, ?)").bind(key, value).run();
  row = await database.prepare("SELECT setting_value FROM sandbox_settings WHERE setting_key = ?").bind(key).first();
  return row?.setting_value || value;
}

export async function issueSandboxToken(request, env) {
  if (!env?.LEDGER) return { ok: false, status: 503, error: "sandbox_access_unavailable" };
  await ensureSandboxTables(env.LEDGER);
  if (obviousAutomationNoise(request)) return { ok: false, status: 403, error: "automated_scanner_not_allowed" };
  const salt = await setting(env.LEDGER, "access_limit_salt");
  const source = request.headers.get("CF-Connecting-IP") || "unknown-source";
  const dayBucket = new Date().toISOString().slice(0, 10);
  const sourceHash = await sha256Hex(`${salt}:${dayBucket}:${source}`);
  await env.LEDGER.prepare(`INSERT INTO sandbox_access_limits (source_hash, day_bucket, issue_count) VALUES (?, ?, 1)
    ON CONFLICT(source_hash, day_bucket) DO UPDATE SET issue_count = issue_count + 1`)
    .bind(sourceHash, dayBucket).run();
  const accessBucket = await env.LEDGER.prepare("SELECT issue_count FROM sandbox_access_limits WHERE source_hash = ? AND day_bucket = ?")
    .bind(sourceHash, dayBucket).first();
  if (Number(accessBucket?.issue_count || 1) > 5) return { ok: false, status: 429, error: "sandbox_token_issue_limit_exceeded" };
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const tokenId = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.valueOf() + TOKEN_TTL_DAYS * 86_400_000);
  await env.LEDGER.prepare(`INSERT INTO sandbox_tokens
    (token_id, token_hash, status, is_internal, rate_limit_per_minute, created_at, expires_at, revoked_at)
    VALUES (?, ?, 'active', 0, ?, ?, ?, NULL)`)
    .bind(tokenId, tokenHash, RATE_LIMIT_PER_MINUTE, now.toISOString(), expires.toISOString()).run();
  return { ok: true, token, tokenId, expiresAt: expires.toISOString(), limit: RATE_LIMIT_PER_MINUTE };
}

export async function authorizeSandbox(request, env, now = Date.now()) {
  const token = sandboxBearerToken(request);
  if (!token || !env?.LEDGER) return { ok: false, status: 401, error: "invalid_sandbox_token" };
  await ensureSandboxTables(env.LEDGER);
  const tokenHash = await sha256Hex(token);
  const row = await env.LEDGER.prepare(`SELECT token_id, is_internal, rate_limit_per_minute, expires_at
    FROM sandbox_tokens WHERE token_hash = ? AND status = 'active' AND revoked_at IS NULL`)
    .bind(tokenHash).first();
  if (!row || Date.parse(row.expires_at) <= now) return { ok: false, status: 401, error: "invalid_or_expired_sandbox_token" };

  const windowStart = Math.floor(now / 60_000) * 60;
  await env.LEDGER.prepare(`INSERT INTO sandbox_rate_limits (token_id, window_start, request_count) VALUES (?, ?, 1)
    ON CONFLICT(token_id, window_start) DO UPDATE SET request_count = request_count + 1`)
    .bind(row.token_id, windowStart).run();
  const bucket = await env.LEDGER.prepare("SELECT request_count FROM sandbox_rate_limits WHERE token_id = ? AND window_start = ?")
    .bind(row.token_id, windowStart).first();
  const limit = Number(row.rate_limit_per_minute) || RATE_LIMIT_PER_MINUTE;
  const count = Number(bucket?.request_count || 1);
  if (count > limit) return { ok: false, status: 429, error: "rate_limit_exceeded", limit, remaining: 0, retryAfter: 60 - (Math.floor(now / 1000) % 60) };
  return { ok: true, tokenId: row.token_id, tokenHash, isInternal: Boolean(row.is_internal), limit, remaining: Math.max(0, limit - count) };
}

export async function revokeSandboxToken(request, env) {
  const token = sandboxBearerToken(request);
  if (!token || !env?.LEDGER) return { ok: false, status: 401, error: "invalid_sandbox_token" };
  await ensureSandboxTables(env.LEDGER);
  const tokenHash = await sha256Hex(token);
  const row = await env.LEDGER.prepare("SELECT token_id, status, revoked_at FROM sandbox_tokens WHERE token_hash = ?")
    .bind(tokenHash).first();
  if (!row || row.status !== "active" || row.revoked_at) return { ok: false, status: 401, error: "invalid_sandbox_token" };
  await env.LEDGER.prepare("UPDATE sandbox_tokens SET status = 'revoked', revoked_at = ? WHERE token_hash = ?")
    .bind(new Date().toISOString(), tokenHash).run();
  return { ok: true };
}

export async function sandboxFingerprint(env, authorization, input) {
  const salt = await setting(env.LEDGER, "telemetry_salt");
  const canonical = JSON.stringify({
    address: String(input.address || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim(),
    postcode: String(input.postcode || "").trim(), locality: String(input.locality || "").toLowerCase().trim(),
    state: String(input.state || "").toLowerCase().trim(),
  });
  return sha256Hex(`${salt}:${authorization.tokenHash}:${canonical}`);
}

export async function duplicateFingerprint(env, authorization, fingerprint) {
  const row = await env.LEDGER.prepare(`SELECT 1 AS seen FROM sandbox_events
    WHERE token_id = ? AND request_fingerprint = ? AND qualified = 1 LIMIT 1`)
    .bind(authorization.tokenId, fingerprint).first();
  return Boolean(row?.seen);
}

export function executeAddressResolution(input) {
  return resolveAddress(input);
}

export async function recordSandboxEvent(env, event) {
  try {
    await ensureSandboxTables(env.LEDGER);
    await env.LEDGER.prepare(`INSERT INTO sandbox_events
      (event_id, token_id, is_internal, endpoint, outcome, qualified, duplicate, noise, request_fingerprint,
       field_count, has_address, has_postcode, meaningful_normalisation, ambiguity, conflict, error_category,
       dataset_version, latency_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), event.tokenId, event.isInternal ? 1 : 0, "/sandbox/v1/address/resolve",
        event.outcome, event.qualified ? 1 : 0, event.duplicate ? 1 : 0, event.noise ? 1 : 0,
        event.fingerprint, event.fieldCount, event.hasAddress ? 1 : 0, event.hasPostcode ? 1 : 0,
        event.meaningful ? 1 : 0, event.ambiguity ? 1 : 0, event.conflict ? 1 : 0,
        event.errorCategory || null, ADDRESS_DATASET.version, Math.max(0, Math.round(event.latencyMs)), new Date().toISOString()).run();
  } catch {
    // Privacy-safe telemetry must not make the resolver unavailable.
  }
}
