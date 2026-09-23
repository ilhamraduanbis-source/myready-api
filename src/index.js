const VERSION = "0.7";

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

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, service: "MYReady", version: VERSION });
    }
    if (request.method !== "POST" || url.pathname !== "/v1/malaysia/resolve") {
      return Response.json({
        service: "MYReady", version: VERSION, status: "online",
        endpoints: { health: "GET /health", resolve: "POST /v1/malaysia/resolve" },
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
    return Response.json(resolveMalaysia(body.text));
  },
};
