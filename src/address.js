import postcodeRows from "../data/postcodes.json" with { type: "json" };

export const ADDRESS_DATASET = Object.freeze({
  id: "data.gov.my-poskod",
  version: "2026-09-24-snapshot",
  source: "https://data.gov.my/data-catalogue/poskod",
  authority: "Government of Malaysia open data catalogue",
  limitations: "Annual postcode-to-city/state reference; not proof of a physical or deliverable address.",
});

const STATE_CODES = Object.freeze({
  Johor: "01", Kedah: "02", Kelantan: "03", Melaka: "04", "Negeri Sembilan": "05",
  Pahang: "06", "Pulau Pinang": "07", Perak: "08", Perlis: "09", Selangor: "10",
  Terengganu: "11", Sabah: "12", Sarawak: "13", "W.P. Kuala Lumpur": "14",
  "W.P. Labuan": "15", "W.P. Putrajaya": "16",
});

const STATE_ALIASES = new Map([
  ["johor", "Johor"], ["kedah", "Kedah"], ["kelantan", "Kelantan"], ["melaka", "Melaka"],
  ["malacca", "Melaka"], ["negeri sembilan", "Negeri Sembilan"], ["n sembilan", "Negeri Sembilan"],
  ["n9", "Negeri Sembilan"], ["pahang", "Pahang"], ["pulau pinang", "Pulau Pinang"],
  ["penang", "Pulau Pinang"], ["perak", "Perak"], ["perlis", "Perlis"], ["selangor", "Selangor"],
  ["terengganu", "Terengganu"], ["sabah", "Sabah"], ["sarawak", "Sarawak"],
  ["w p kuala lumpur", "W.P. Kuala Lumpur"], ["wp kuala lumpur", "W.P. Kuala Lumpur"],
  ["kuala lumpur", "W.P. Kuala Lumpur"], ["kl", "W.P. Kuala Lumpur"],
  ["w p labuan", "W.P. Labuan"], ["wp labuan", "W.P. Labuan"], ["labuan", "W.P. Labuan"],
  ["w p putrajaya", "W.P. Putrajaya"], ["wp putrajaya", "W.P. Putrajaya"], ["putrajaya", "W.P. Putrajaya"],
]);

const ABBREVIATIONS = Object.freeze([
  [/\bjln\.?\b/gi, "Jalan"], [/\btmn\.?\b/gi, "Taman"], [/\bkg\.?\b/gi, "Kampung"],
  [/\bbdr\.?\b/gi, "Bandar"], [/\blrg\.?\b/gi, "Lorong"], [/\bpersiaran\b/gi, "Persiaran"],
  [/\bpsrn\.?\b/gi, "Persiaran"], [/\blbh\.?\b/gi, "Lebuh"], [/\bsg\.?\b/gi, "Sungai"],
  [/\bkt\.?\b/gi, "Kota"], [/\bttdi\b/gi, "TTDI"],
]);

const postcodeIndex = new Map();
for (const [postcode, state, city] of postcodeRows) {
  const entry = Object.freeze({ postcode, state, state_code: STATE_CODES[state] || null, locality: city });
  const existing = postcodeIndex.get(postcode) || [];
  existing.push(entry);
  postcodeIndex.set(postcode, existing);
}

function fold(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function canonicalState(value) {
  return STATE_ALIASES.get(fold(value)) || null;
}

function normaliseText(value) {
  let result = String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of ABBREVIATIONS) result = result.replace(pattern, replacement);
  return result.replace(/\s*,\s*/g, ", ").replace(/,{2,}/g, ",").trim();
}

function uniqueCandidates(rows) {
  return [...new Map(rows.map((row) => [`${row.postcode}|${row.state}|${row.locality}`, row])).values()];
}

export function resolveAddress(input) {
  const sourceAddress = normaliseText(input.address);
  const explicitPostcode = String(input.postcode || "").trim();
  const embeddedPostcodes = [...sourceAddress.matchAll(/(?<!\d)(\d{5})(?!\d)/g)].map((match) => match[1]);
  const postcodeValues = [...new Set([explicitPostcode, ...embeddedPostcodes].filter(Boolean))];
  const suppliedState = canonicalState(input.state);
  const suppliedLocality = normaliseText(input.locality);
  const normalisations = [];
  const conflicts = [];

  if (sourceAddress !== String(input.address || "").trim()) normalisations.push("address_format");
  if (postcodeValues.length > 1) {
    return result("ambiguous", sourceAddress, postcodeValues, [], normalisations, conflicts, [
      { field: "postcode", values: postcodeValues, reason: "multiple_postcodes" },
    ]);
  }

  const postcode = postcodeValues[0] || null;
  if (!postcode) {
    return result("unknown", sourceAddress, [], [], normalisations, conflicts, [], "postcode_required_for_deterministic_lookup");
  }
  if (!/^\d{5}$/.test(postcode)) {
    return result("unknown", sourceAddress, [postcode], [], normalisations, conflicts, [], "invalid_postcode_format");
  }

  const candidates = uniqueCandidates(postcodeIndex.get(postcode) || []);
  if (!candidates.length) {
    return result("unknown", sourceAddress, [postcode], [], normalisations, conflicts, [], "postcode_not_found");
  }

  const statesInText = [...STATE_ALIASES.entries()]
    .filter(([alias]) => new RegExp(`(^|\\b)${alias.replaceAll(" ", "\\s+")}(?=$|\\b)`, "i").test(fold(sourceAddress)))
    .map(([, state]) => state);
  const addressStates = [...new Set(statesInText)];
  const candidateStates = [...new Set(candidates.map((candidate) => candidate.state))];
  if (addressStates.length > 1) {
    const unsupportedStates = addressStates.filter((state) => !candidateStates.includes(state));
    if (unsupportedStates.length) {
      conflicts.push({ field: "state", supplied: addressStates, expected: candidateStates });
      return result("conflict", sourceAddress, [postcode], candidates, normalisations, conflicts, []);
    }
    return result("ambiguous", sourceAddress, [postcode], candidates, normalisations, conflicts, [
      { field: "state", values: addressStates, reason: "multiple_states" },
    ]);
  }
  const claimedState = suppliedState || addressStates[0] || null;
  if (claimedState && !candidateStates.includes(claimedState)) {
    conflicts.push({ field: "state", supplied: claimedState, expected: candidateStates });
  }

  const localityClaim = suppliedLocality || null;
  if (localityClaim) {
    const localityMatches = candidates.filter((candidate) => fold(candidate.locality) === fold(localityClaim));
    if (!localityMatches.length) {
      conflicts.push({ field: "locality", supplied: suppliedLocality, expected: [...new Set(candidates.map((candidate) => candidate.locality))] });
    }
  }

  if (conflicts.length) return result("conflict", sourceAddress, [postcode], candidates, normalisations, conflicts, []);
  if (candidates.length > 1) {
    return result("ambiguous", sourceAddress, [postcode], candidates, normalisations, conflicts, [
      { field: "locality", values: candidates.map((candidate) => candidate.locality), reason: "postcode_has_multiple_localities" },
    ]);
  }
  return result("resolved", sourceAddress, [postcode], candidates, normalisations, conflicts, []);
}

function result(status, normalisedAddress, postcodes, candidates, normalisations, conflicts, ambiguities, reason = null) {
  const meaningful = normalisations.length > 0 || conflicts.length > 0 || ambiguities.length > 0;
  return {
    status,
    machine_ready: status === "resolved",
    input_summary: {
      has_address: Boolean(normalisedAddress),
      has_postcode: postcodes.length > 0,
    },
    normalised: {
      address: normalisedAddress || null,
      postcode: postcodes.length === 1 ? postcodes[0] : null,
    },
    candidates,
    normalisations,
    conflicts,
    ambiguities,
    reason,
    meaningful_resolution: meaningful,
    provenance: ADDRESS_DATASET,
    disclaimer: "Local deterministic resolution only. It does not prove that an address exists or is deliverable.",
  };
}
