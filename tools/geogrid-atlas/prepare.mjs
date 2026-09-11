import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractCatalog } from "./catalog.mjs";
import { borderCount, COLORS, evaluate, flagColors, RULES } from "./rules.mjs";
import { NUMERIC_METRICS, validateNumericCountry } from "../../games/world-map/js/numeric-ranges.mjs";

export const GEOGRID_PATH = "games/world-map/data/geogrid.json";
export const GEOGRID_SOURCES_PATH = "games/world-map/data/geogrid-sources.json";
export const ATLAS_URL = "https://www.geogridgame.com/";
export const DATA_URL = "https://cdn-assets.teuteuf.fr/data/geogrid/combined.json";
const COUNTRY_URL = "https://cdn-assets.teuteuf.fr/data/common/countries.json";
const SUPPORTED = JSON.parse(await readFile(new URL("./supported.json", import.meta.url), "utf8"));
const CAPITAL_INPUTS = {
    capital_population_over_x: ["capital-city populations"],
    captial_population_under_x: ["capital-city populations"],
    capital_starting_letter: ["capital-city names"],
    capital_not_most_populated_city: ["capital-city populations", "other city populations", "capital designation"],
};

function hashBytes(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}

function formatJson(value) {
    return JSON.stringify(value, null, 2) + "\n";
}

export function validateCatalog(choices) {
    const actual = Object.fromEntries(choices.map(choice => [choice.key, choice]));
    const expected = Object.fromEntries(Object.entries(SUPPORTED).flatMap(([id, variants]) => variants.map(([variantId, parameter]) => [id + ":" + (variantId ?? "default"), parameter])));
    for (const [key, choice] of Object.entries(actual)) {
        if (!RULES[choice.id] || !Object.hasOwn(expected, key) || expected[key] !== choice.parameter) {
            throw new Error("Unsupported new or changed world atlas variant: " + key);
        }
    }
    const missing = Object.keys(expected).filter(key => !Object.hasOwn(actual, key));
    if (missing.length) throw new Error("World atlas variants removed or unavailable: " + missing.join(", "));
    if (choices.length !== Object.keys(actual).length) throw new Error("Duplicate atlas choice");
}

export function validateCoverage(snapshot) {
    const count = Object.keys(snapshot.countries).length;
    const missing = snapshot.choices.filter(choice => !Object.hasOwn(CAPITAL_INPUTS, choice.id) && choice.unknown.length === count);
    if (missing.length) throw new Error("Source facts missing for every country; review the combined schema: " + missing.map(choice => choice.key).join(", "));
}

export function countryLocation(record) {
    const { longitude = null, latitude = null } = record.common;
    if (longitude !== null && (!Number.isFinite(longitude) || Math.abs(longitude) > 180) ||
        latitude !== null && (!Number.isFinite(latitude) || Math.abs(latitude) > 90)) {
        throw new Error("Invalid country coordinates: " + record.common.code);
    }
    return longitude === null || latitude === null ? null : [longitude, latitude];
}

export function countryNumericFacts(record, combined) {
    const numericValues = {};
    for (const metric of NUMERIC_METRICS) {
        numericValues[metric.key] = metric.key === "border_count" ? borderCount(record, combined) :
            metric.key === "flag_color_count" ? flagColors(record)?.length ?? null :
            metric.path?.split(".").reduce((value, key) => value?.[key], record) ?? null;
    }
    const facts = {
        numericValues, landlocked: record.geogrid?.geographyInfo?.landlocked ?? null,
        timeZones: record.geogrid?.politicalInfo?.timeZones ?? null,
    };
    validateNumericCountry(facts);
    return facts;
}

export function buildSnapshot({ choices, combined, registry, geometry, source }) {
    validateCatalog(choices);
    if (!combined || typeof combined !== "object" || Array.isArray(combined) || !Object.keys(combined).length) throw new Error("Invalid combined country dataset");
    if (!Array.isArray(registry) || !registry.length) throw new Error("Missing country registry");
    const registered = new Set(registry.map(country => country.code?.toLowerCase()));
    if (registered.size !== registry.length || [...registered].some(code => !/^[a-z]{2}$/.test(code))) throw new Error("Invalid country registry codes");
    const codes = Object.keys(combined).sort();
    if (codes.length !== registry.length || codes.some(code => !registered.has(code))) throw new Error("Combined countries don't match the complete country registry");
    const countries = {};
    for (const code of codes) {
        const record = combined[code];
        if (!/^[a-z]{2}$/.test(code) || record?.common?.code !== code.toUpperCase() || typeof record.common.name !== "string" || !record.common.name) {
            throw new Error("Invalid combined country: " + code);
        }
        const { population = null, size = null, borders = null, borderMode = null } = record.common;
        if ([population, size].some(value => value !== null && (!Number.isFinite(value) || value < 0))) throw new Error("Invalid population or size: " + code);
        if (borders !== null && (!Array.isArray(borders) || borders.some(neighbor => typeof neighbor !== "string" || !registered.has(neighbor)))) throw new Error("Invalid border codes: " + code);
        if (borderMode !== null && !["bordering", "nearby"].includes(borderMode)) throw new Error("Invalid border mode: " + code);
        countries[code] = {
            code: record.common.code, name: record.common.name, flagColors: flagColors(record),
            population, size, borders, borderMode, borderCount: borderCount(record, combined), location: countryLocation(record),
            ...countryNumericFacts(record, combined),
        };
    }
    const features = geometry?.objects?.countries?.geometries;
    if (!Array.isArray(features) || !features.length) throw new Error("Missing world country geometry");
    const mapping = {};
    for (const feature of [...features].sort((left, right) => left.id.localeCompare(right.id))) {
        if (typeof feature.id !== "string" || Object.hasOwn(mapping, feature.id)) throw new Error("Missing or duplicate geometry ID");
        const candidate = feature.id === "X-KOSOVO" ? "xk" : feature.properties?.iso2?.toLowerCase();
        mapping[feature.id] = candidate && Object.hasOwn(countries, candidate) ? candidate : null;
    }
    const evaluated = choices.map(choice => {
        const matches = [];
        const unknown = [];
        for (const code of codes) {
            const result = evaluate(combined[code], choice, combined);
            if (result === null) unknown.push(code);
            else if (result === true) matches.push(code);
            else if (result !== false) throw new Error("Invalid match result: " + choice.key + "/" + code);
        }
        const { parameter, ...metadata } = choice;
        const unavailableReason = CAPITAL_INPUTS[choice.id] ? "GeoGrid combined.json doesn't contain " + CAPITAL_INPUTS[choice.id].join(", ") + "; the separate cities dataset isn't used." : null;
        return { ...metadata, value: parameter, matches, unknown, ...(unavailableReason ? { unavailableReason } : {}) };
    });
    return {
        version: 1, source,
        colors: COLORS.map(value => {
            const variant = choices.find(choice => choice.id === "color_on_flag" && choice.parameter === value && !choice.legacy);
            if (!variant) throw new Error("Missing canonical flag-color variant: " + value);
            return { value, label: value === "grey" ? "Gray" : value.charAt(0).toUpperCase() + value.slice(1), variantId: variant.variantId };
        }),
        countries, mapping, choices: evaluated,
    };
}

async function readPrevious(root) {
    try {
        return JSON.parse(await readFile(path.join(root, GEOGRID_SOURCES_PATH), "utf8"));
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return null;
    }
}

export async function prepareAtlas({ root, directory }) {
    const cache = path.join(directory, "geogrid-atlas");
    await mkdir(cache, { recursive: true });
    const inputs = [];
    async function download(url, filename) {
        const response = await fetch(url, { signal: AbortSignal.timeout(60000), redirect: "error" });
        if (!response.ok) throw new Error("GeoGrid source unavailable: " + response.status + " " + url);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (!bytes.length) throw new Error("Empty GeoGrid source: " + url);
        await writeFile(path.join(cache, filename), bytes);
        inputs.push({ url, sha256: hashBytes(bytes), bytes: bytes.length });
        return bytes.toString("utf8");
    }
    const html = await download(ATLAS_URL, "index.html");
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)].map(match => new URL(match[1], ATLAS_URL)).filter(url => /^\/js\/app\.[a-z0-9]+\.js$/.test(url.pathname));
    if (scripts.length !== 1 || scripts[0].origin !== new URL(ATLAS_URL).origin) throw new Error("Couldn't identify the public GeoGrid app bundle");
    const bundleUrl = scripts[0].href;
    const [bundle, combinedText, registryText] = await Promise.all([
        download(bundleUrl, "app.js"),
        download(DATA_URL, "combined.json"),
        download(COUNTRY_URL, "countries.json"),
    ]);
    const choices = extractCatalog(bundle);
    const geometry = JSON.parse(await readFile(path.join(root, "games/world-map/data/world.json"), "utf8"));
    inputs.sort((left, right) => left.url.localeCompare(right.url));
    const revision = hashBytes(formatJson(inputs));
    const previous = await readPrevious(root);
    const fetchedAt = previous?.revision === revision ? previous.fetchedAt : new Date().toISOString();
    const source = { url: DATA_URL, atlasUrl: ATLAS_URL, bundleUrl, revision, fetchedAt };
    const snapshot = buildSnapshot({
        choices, combined: JSON.parse(combinedText), registry: JSON.parse(registryText),
        geometry, source,
    });
    validateCoverage(snapshot);
    const codes = Object.keys(snapshot.countries);
    const mapped = new Set(Object.values(snapshot.mapping).filter(Boolean));
    const coverage = {
        countryCount: codes.length, categoryIdCount: new Set(choices.map(choice => choice.id)).size,
        choiceCount: choices.length, evaluatedCountryChoices: choices.length * codes.length,
        flagColorsKnown: codes.filter(code => snapshot.countries[code].flagColors !== null).length,
        flagColorsUnknown: codes.filter(code => snapshot.countries[code].flagColors === null),
        locationsKnown: codes.filter(code => snapshot.countries[code].location !== null).length,
        locationsUnknown: codes.filter(code => snapshot.countries[code].location === null),
        ...numericCoverage(snapshot),
        geometryCount: Object.keys(snapshot.mapping).length, mappedGeometryCount: Object.values(snapshot.mapping).filter(Boolean).length,
        unmappedGeometry: Object.keys(snapshot.mapping).filter(id => snapshot.mapping[id] === null),
        countriesWithoutGeometry: codes.filter(code => !mapped.has(code)),
        unknownCountryChoices: snapshot.choices.reduce((sum, choice) => sum + choice.unknown.length, 0),
        unknownByChoice: Object.fromEntries(snapshot.choices.filter(choice => choice.unknown.length).map(choice => [choice.key, choice.unknown.length])),
        unavailableCategoryIds: Object.keys(CAPITAL_INPUTS),
        unavailableChoiceCount: snapshot.choices.filter(choice => choice.unavailableReason).length,
    };
    const provenance = {
        version: 1, provider: "GeoGrid / Teuteuf", atlasUrl: ATLAS_URL, revision, fetchedAt, inputs, coverage,
        attribution: "Category labels, parameters, and country memberships are derived from public factual GeoGrid / Teuteuf data.",
        rights: "Public availability isn't a blanket reuse license. No license for the GeoGrid application or atlas prose is asserted or transferred. The application code, atlas descriptions, and source imagery aren't bundled.",
        matching: [
            "All world Categories Atlas IDs and all public picker variants are included, including legacy variants and choices excluded from daily challenges. USA-state categories are excluded.",
            "Numeric over/under comparisons are strict. Explicitly missing source fields produce unknown, including negative conditions.",
            "GeoGrid's picker spells the color grey; its current country records spell it gray. Both source spellings map to grey, displayed as Gray.",
            "Combined.json is the only source of criterion facts. The atlas supplies category metadata and parameters; the common country registry is used only to validate country coverage.",
            "Country population, area, raw border codes, border mode, and effective border count come from combined.json. Nearby-mode lists aren't land borders; the category border count also honors overrides and excludes nearby-mode neighbors.",
            "Country location is [longitude, latitude] from combined.json common.longitude and common.latitude, including source countries without geometry. Missing coordinates produce null; supplied coordinates must be finite numbers within longitude [-180, 180] and latitude [-90, 90]. No coordinates are inferred or taken from fallback sources.",
            ...NUMERIC_MATCHING,
            "All four capital-category IDs (20 variants) remain available but unknown for every country: combined.json contains no capital-city names or populations. GeoGrid's own capital criteria use common/cities.json, which isn't fetched or used here.",
            "Geometry is linked only by explicit ISO2 codes and the Kosovo-to-XK alias when XK exists in the source. Source countries without geometry remain in memberships.",
            "Country and city details and imagery in the playbook remain separate from these category memberships.",
        ],
    };
    return {
        files: [{ path: GEOGRID_PATH, content: formatJson(snapshot) }, { path: GEOGRID_SOURCES_PATH, content: formatJson(provenance) }],
        summary: [
            `GeoGrid world atlas: ${coverage.categoryIdCount} category IDs, ${coverage.choiceCount} variants, ${coverage.countryCount} source countries`,
            `Evaluated ${coverage.evaluatedCountryChoices} country/choice pairs; ${coverage.unknownCountryChoices} unknown because source inputs are missing`,
            `Flag colors: ${coverage.flagColorsKnown}/${coverage.countryCount} known; ${coverage.flagColorsUnknown.length} unknown`,
            `Locations: ${coverage.locationsKnown}/${coverage.countryCount} known; ${coverage.locationsUnknown.length} unknown`,
            `Geometry: ${coverage.mappedGeometryCount}/${coverage.geometryCount} mapped; ${coverage.countriesWithoutGeometry.length} source countries without geometry`,
            `Source limitation: ${coverage.unavailableChoiceCount} capital variants have no required facts in combined.json; every result is explicitly unknown`,
        ],
    };
}

export function numericCoverage(snapshot) {
    const countries = Object.values(snapshot.countries);
    return {
        numericKnownByMetric: Object.fromEntries(NUMERIC_METRICS.map(metric => [metric.key, countries.filter(country => country.numericValues[metric.key] !== null).length])),
        timeZonesKnown: countries.filter(country => country.timeZones !== null).length,
        timeZonesUnknown: Object.keys(snapshot.countries).filter(code => snapshot.countries[code].timeZones === null),
    };
}

export const NUMERIC_MATCHING = [
    "Numeric range facts are normalized from combined.json into country.numericValues; missing metrics, including all capital populations, remain null. No numeric values are inferred from category memberships or other datasets.",
    "Range controls derive strict greater-than, strict less-than, and equality memberships from numericValues without changing the 441 source choices. Stops are source picker thresholds plus zero and observed negative minima; border counts include every integer through the observed maximum. Flag counts use reviewed picker counts. Derived choices identify their source field and operation.",
    "All coastline range directions retain GeoGrid's has-coastline guard: landlocked countries don't match, and a missing landlocked flag produces unknown. Border counts retain GeoGrid overrides and nearby-mode exclusions; flag color counts count normalized source colors.",
    "Country timeZones preserve every complete string from combined.json geogrid.politicalInfo.timeZones, including fractional-hour offsets. Missing fields produce null. No time zones or geometry are inferred.",
];
