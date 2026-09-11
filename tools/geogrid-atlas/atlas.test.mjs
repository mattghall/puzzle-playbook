import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { extractCatalog } from "./catalog.mjs";
import { buildSnapshot, countryLocation, countryNumericFacts, numericCoverage, prepareAtlas, validateCatalog, validateCoverage } from "./prepare.mjs";
import { COLORS, evaluate, flagColors, RULES } from "./rules.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SUPPORTED = JSON.parse(await readFile(new URL("./supported.json", import.meta.url), "utf8"));
const CHOICES = Object.entries(SUPPORTED).flatMap(([id, variants]) => variants.map(([variantId, parameter]) => ({
    key: id + ":" + (variantId ?? "default"), id, variantId, parameter, label: id, section: "Test", category: id, sources: [],
})));
const SNAPSHOT = JSON.parse(await readFile(path.join(ROOT, "games/world-map/data/geogrid.json"), "utf8"));
const PROVENANCE = JSON.parse(await readFile(path.join(ROOT, "games/world-map/data/geogrid-sources.json"), "utf8"));

function getChoice(id, variantId = null) {
    const value = CHOICES.find(item => item.id === id && item.variantId === variantId);
    assert.ok(value, "Unknown test choice: " + id);
    return value;
}

function record(fields = {}, common = {}) {
    return { common: { code: "AA", name: "Example", borderMode: "bordering", borders: [], ...common }, geogrid: fields };
}

function match(country, id, variantId = null, countries = { aa: country }) {
    return evaluate(country, getChoice(id, variantId), countries);
}

test("all world atlas IDs and every reviewed picker variant have rules and memberships", () => {
    assert.equal(Object.keys(SUPPORTED).length, 127);
    assert.equal(CHOICES.length, 441);
    assert.equal(SNAPSHOT.choices.length, CHOICES.length);
    assert.deepEqual(Object.keys(RULES).sort(), Object.keys(SUPPORTED).sort());
    validateCatalog(CHOICES);
    assert.deepEqual(SNAPSHOT.choices.map(item => item.key).sort(), CHOICES.map(item => item.key).sort());
    assert.equal(new Set(SNAPSHOT.choices.map(item => item.section)).size, 11);
    assert.ok(SNAPSHOT.choices.some(item => item.id === "captial_population_under_x"));
    assert.ok(SNAPSHOT.choices.some(item => item.key === "color_on_flag:9" && item.legacy));
    assert.equal(SNAPSHOT.choices.filter(item => item.id === "coastline_length_over_x").some(item => item.variantId === 6), false);
    assert.ok(SNAPSHOT.choices.filter(item => item.id === "rainfall_over_x").length);
    for (const item of SNAPSHOT.choices) {
        const codes = [...item.matches, ...item.unknown];
        assert.equal(new Set(codes).size, codes.length, item.key);
        assert.ok(codes.every(code => Object.hasOwn(SNAPSHOT.countries, code)), item.key);
    }
});

test("all 249 source flags are known, with explicit geometry gaps and source-only countries", () => {
    assert.equal(Object.keys(SNAPSHOT.countries).length, 249);
    assert.equal(PROVENANCE.coverage.flagColorsKnown, 249);
    assert.deepEqual(PROVENANCE.coverage.flagColorsUnknown, []);
    assert.equal(Object.keys(SNAPSHOT.mapping).length, 241);
    for (const country of Object.values(SNAPSHOT.countries)) {
        assert.ok(country.flagColors.length);
        assert.ok(country.flagColors.every(color => COLORS.includes(color)));
    }
    assert.equal(SNAPSHOT.mapping["X-KOSOVO"], "xk");
    assert.ok(SNAPSHOT.countries.tv);
    assert.equal(Object.values(SNAPSHOT.mapping).includes("tv"), false);
    assert.ok(SNAPSHOT.choices.find(item => item.key === "color_on_flag:1").matches.includes("tv"));
    assert.equal(SNAPSHOT.colors.find(color => color.value === "grey").label, "Gray");
    assert.ok(SNAPSHOT.choices.find(item => item.key === "color_on_flag:6").matches.length > 0);
    assert.ok(SNAPSHOT.choices.filter(item => item.section === "Flag").every(item => !item.unknown.length));
});

test("all 2,048 flag combinations match independent country colors for ALL, ANY, and exclusions", () => {
    const colors = SNAPSHOT.colors;
    const codes = Object.keys(SNAPSHOT.countries);
    assert.equal(colors.length, 11);
    assert.equal(colors.find(color => color.value === "blue").variantId, 1);
    assert.equal(colors.find(color => color.value === "grey").variantId, 6);
    const positive = colors.map(color => {
        const entry = SNAPSHOT.choices.find(item => item.id === "color_on_flag" && item.variantId === color.variantId);
        assert.equal(entry.value, color.value);
        return new Set(entry.matches);
    });
    const negative = colors.map(color => {
        const entry = SNAPSHOT.choices.find(item => item.id === "color_not_on_flag" && item.variantId === color.variantId);
        assert.equal(entry.value, color.value);
        return new Set(entry.matches);
    });
    for (let mask = 0; mask < 2 ** colors.length; mask++) {
        const included = colors.map((color, index) => index).filter(index => mask & 2 ** index);
        const excluded = colors.map((color, index) => index).filter(index => !(mask & 2 ** index));
        const actualAll = codes.filter(code => included.every(index => positive[index].has(code)));
        const actualAny = codes.filter(code => included.some(index => positive[index].has(code)));
        const actualExact = actualAll.filter(code => excluded.every(index => negative[index].has(code)));
        const expectedAll = codes.filter(code => included.every(index => SNAPSHOT.countries[code].flagColors.includes(colors[index].value)));
        const expectedAny = codes.filter(code => included.some(index => SNAPSHOT.countries[code].flagColors.includes(colors[index].value)));
        const expectedExact = expectedAll.filter(code => SNAPSHOT.countries[code].flagColors.length === included.length);
        assert.deepEqual(actualAll, expectedAll, "ALL mask " + mask);
        assert.deepEqual(actualAny, expectedAny, "ANY mask " + mask);
        assert.deepEqual(actualExact, expectedExact, "Exact colors and exclusions mask " + mask);
    }
});

test("country locations use longitude then latitude, preserve zero, and never infer missing coordinates", () => {
    assert.deepEqual(countryLocation(record({}, { longitude: 177.64933, latitude: -7.109535 })), [177.64933, -7.109535]);
    for (const [longitude, latitude] of [[0, 0], [-180, -90], [180, 90]]) {
        assert.deepEqual(countryLocation(record({}, { longitude, latitude })), [longitude, latitude]);
    }
    for (const common of [{}, { longitude: 1 }, { latitude: 1 }, { longitude: null, latitude: 1 }, { longitude: 1, latitude: null }]) {
        assert.equal(countryLocation(record({}, common)), null);
    }
    for (const field of ["longitude", "latitude"]) {
        for (const value of [NaN, Infinity, -Infinity, "0", "", false, [], {}, field === "longitude" ? 180.001 : 90.001, field === "longitude" ? -180.001 : -90.001]) {
            assert.throws(() => countryLocation(record({}, { longitude: 0, latitude: 0, [field]: value })), /Invalid country coordinates/);
            assert.throws(() => countryLocation(record({}, { [field]: value })), /Invalid country coordinates/);
        }
    }
});

test("numeric normalization preserves source values, zero, missing inputs, and full time-zone strings", () => {
    const country = record({
        geographyInfo: { averageTemperature: -18.68, arableLand: 0, borderCountOverride: 5, landlocked: true },
        politicalInfo: { livingLanguages: 12, urbanPopulation: 25.5, timeZones: ["UTC+05:45", "UTC-03:30"] },
        sportsInfo: { olympicMedals: 0 },
        flagInfo: { colorsOnFlag: ["red", "gray"] },
        capitalPopulation: 100000,
    }, { population: 1234, size: 10.5 });
    const facts = countryNumericFacts(country, { aa: country });
    assert.equal(facts.numericValues.temp, -18.68);
    assert.equal(facts.numericValues.arable_land, 0);
    assert.equal(facts.numericValues.olympic_medals, 0);
    assert.equal(facts.numericValues.border_count, 5);
    assert.equal(facts.numericValues.flag_color_count, 2);
    assert.equal(facts.numericValues.living_languages, 12);
    assert.equal(facts.numericValues.urban_population, 25.5);
    assert.equal(facts.numericValues.population, 1234);
    assert.equal(facts.numericValues.size, 10.5);
    assert.equal(facts.numericValues.capital_population, null);
    assert.equal(facts.numericValues.rainfall, null);
    assert.equal(facts.landlocked, true);
    assert.deepEqual(facts.timeZones, ["UTC+05:45", "UTC-03:30"]);
    const missing = countryNumericFacts(record(), {});
    assert.equal(missing.timeZones, null);
    assert.equal(missing.landlocked, null);
    assert.equal(missing.numericValues.olympic_medals, null);
    for (const fields of [
        { geographyInfo: { annualRainfall: "10" } },
        { geographyInfo: { averageTemperature: NaN } },
        { geographyInfo: { arableLand: 101 } },
        { geographyInfo: { borderCountOverride: 1.5 } },
        { sportsInfo: { olympicMedals: -1 } },
        { economicInfo: { HDI: 1.1 } },
        { politicalInfo: { timeZones: ["UTC+01:00", null] } },
        { politicalInfo: { timeZones: ["UTC+01:00", "UTC+01:00"] } },
    ]) assert.throws(() => countryNumericFacts(record(fields), {}), /Invalid/);
});

test("bundled locations cover all source-only countries, including Tuvalu, without changing geometry", () => {
    const codes = Object.keys(SNAPSHOT.countries);
    assert.equal(PROVENANCE.coverage.locationsKnown, 249);
    assert.deepEqual(PROVENANCE.coverage.locationsUnknown, []);
    for (const country of Object.values(SNAPSHOT.countries)) {
        assert.equal(country.location.length, 2, country.code);
        assert.deepEqual(countryLocation(record({}, { longitude: country.location[0], latitude: country.location[1] })), country.location);
    }
    const mapped = new Set(Object.values(SNAPSHOT.mapping).filter(Boolean));
    assert.deepEqual(codes.filter(code => !mapped.has(code)), PROVENANCE.coverage.countriesWithoutGeometry);
    assert.equal(PROVENANCE.coverage.countriesWithoutGeometry.length, 13);
    assert.equal(PROVENANCE.coverage.unmappedGeometry.length, 5);
    assert.ok(PROVENANCE.coverage.countriesWithoutGeometry.every(code => SNAPSHOT.countries[code].location !== null));
    assert.deepEqual(SNAPSHOT.countries.tv.location, [177.64933, -7.109535]);
    assert.ok(PROVENANCE.matching.some(text => text.includes("common.longitude and common.latitude")));
});

test("numeric and time-zone coverage agree with the enriched snapshot and retain authoritative provenance", () => {
    const coverage = numericCoverage(SNAPSHOT);
    for (const [key, value] of Object.entries(coverage)) assert.deepEqual(PROVENANCE.coverage[key], value);
    assert.equal(coverage.numericKnownByMetric.capital_population, 242);
    assert.equal(coverage.numericKnownByMetric.flag_color_count, 249);
    assert.equal(coverage.timeZonesKnown, 249);
    assert.equal(SNAPSHOT.source.revision, PROVENANCE.revision);
    assert.ok(PROVENANCE.matching.some(text => text.includes("country.numericValues")));
    assert.ok(PROVENANCE.matching.some(text => text.includes("geogrid.politicalInfo.timeZones")));
});

test("unsupported, missing, duplicated, or changed source variants fail explicitly", () => {
    assert.throws(() => validateCatalog([...CHOICES, { id: "new_category", key: "new_category:default", variantId: null }]), /Unsupported/);
    assert.throws(() => validateCatalog([...CHOICES, { ...CHOICES[0], key: "color_on_flag:100", variantId: 100 }]), /Unsupported/);
    assert.throws(() => validateCatalog(CHOICES.slice(1)), /removed or unavailable/);
    assert.throws(() => validateCatalog([...CHOICES, CHOICES[0]]), /Duplicate/);
    assert.throws(() => validateCatalog(CHOICES.map((item, index) => index ? item : { ...item, parameter: "ultraviolet" })), /Unsupported/);
});

test("a removed combined field fails refresh instead of silently making an entire category unknown", () => {
    validateCoverage(SNAPSHOT);
    const changed = structuredClone(SNAPSHOT);
    changed.choices[0].matches = [];
    changed.choices[0].unknown = Object.keys(changed.countries);
    assert.throws(() => validateCoverage(changed), /review the combined schema/);
});

test("missing inputs stay unknown for positive and negative rules", () => {
    const empty = record();
    for (const item of CHOICES) {
        const result = evaluate(empty, item, { aa: empty });
        assert.ok(result === null || typeof result === "boolean", item.key);
    }
    for (const id of ["flag_without_rwb", "doesnt_touch_tropics", "no_olympic_medals"]) assert.equal(match(empty, id), null);
    assert.equal(match(empty, "not_official_language", 0), null);
    assert.equal(match(empty, "color_not_on_flag", 0), null);
    assert.equal(match(record({ geographyInfo: { touchesTropics: false } }), "doesnt_touch_tropics"), true);
    assert.equal(match(record({ politicalInfo: { officialLanguageCodes: [] } }), "not_official_language", 0), true);
    assert.throws(() => match(record({ geographyInfo: { touchesTropics: "false" } }), "touches_tropics"), /Invalid source field/);
    assert.throws(() => evaluate(empty, { id: "unsupported" }, {}, []), /Unsupported/);
});

test("numeric thresholds are strict, flags normalize gray, and every color variant is usable", () => {
    assert.equal(match(record({}, { population: 1e5 }), "population_over_x", 0), false);
    assert.equal(match(record({}, { population: 1e5 }), "population_under_x", 0), false);
    assert.equal(match(record({}, { population: 100001 }), "population_over_x", 0), true);
    assert.equal(match(record({ geographyInfo: { landlocked: true, coastlineLength: 0 } }), "coastline_length_under_x", 0), false);
    assert.equal(match(record({ geographyInfo: { landlocked: false, coastlineLength: 99 } }), "coastline_length_under_x", 0), true);
    const flag = record({ flagInfo: { colorsOnFlag: ["gray", "red", "blue"] } });
    assert.deepEqual(flagColors(flag), ["grey", "red", "blue"]);
    assert.equal(match(flag, "color_on_flag", 6), true);
    assert.equal(match(flag, "color_on_flag", 9), true);
    assert.equal(match(flag, "flag_has_x_colors", 1), true);
    assert.equal(match(flag, "flag_rwb"), false);
    assert.equal(match(record({ flagInfo: { colorsOnFlag: ["red", "white", "blue"] } }), "flag_rwb"), true);
    assert.throws(() => flagColors(record({ flagInfo: { colorsOnFlag: ["ultraviolet"] } })), /Unrecognized/);
});

test("land borders honor nearby mode, count overrides, and missing neighbor data", () => {
    const nearby = record({}, { borderMode: "nearby", borders: ["ru"] });
    assert.equal(match(nearby, "borders_x", 0), false);
    assert.equal(match(nearby, "borders_x_to_y", 0), false);
    const country = record({}, { borders: ["ru", "is"] });
    const neighbors = { ru: record(), is: nearby };
    assert.equal(match(country, "borders_x", 0, neighbors), true);
    assert.equal(match(country, "borders_x_to_y", 0, neighbors), true);
    assert.equal(match(country, "borders_x_to_y", 0, {}), null);
    assert.equal(match(record({ geographyInfo: { borderCountOverride: 5 } }), "borders_x_or_more", 0), true);
});

test("name rules distinguish accent normalization, letter counts, and word separators", () => {
    assert.equal(match(record({}, { name: "Åland Islands" }), "starting_letter", 0), true);
    assert.equal(match(record({}, { name: "Côte d'Ivoire" }), "name_x_plus_letters_long", 0), true);
    assert.equal(match(record({}, { name: "Timor-Leste" }), "name_multiple_words"), true);
    assert.equal(match(record({}, { name: "Cuba" }), "name_length", 0), true);
    assert.equal(match(record({}, { name: "Albania" }), "name_start_end_same_letter"), true);
});

test("combined-only rule evaluation keeps missing capitals unknown while the snapshot uses city facts", () => {
    const country = record();
    const cities = [
        { countryCode: "AA", names: { en: "Álpha" }, capital: true, population: 50000 },
        { countryCode: "AA", names: { en: "Beta" }, capital: true, population: 100000 },
        { countryCode: "AA", names: { en: "Gamma" }, capital: false, population: 200000 },
    ];
    const capitalChoices = CHOICES.filter(item => RULES[item.id].operation === "capital");
    assert.equal(capitalChoices.length, 20);
    for (const item of capitalChoices) {
        assert.equal(evaluate(country, item, {}, cities), null);
        const bundled = SNAPSHOT.choices.find(entry => entry.key === item.key);
        assert.ok(bundled.unknown.length < 249);
        assert.ok(bundled.matches.length > 0);
        assert.equal(bundled.unavailableReason, undefined);
        assert.ok(bundled.sources.some(source => source.url.endsWith("/cities.json")));
    }
    assert.equal(PROVENANCE.inputs.some(input => input.url.endsWith("/cities.json")), true);
});

test("static extraction reads literal metadata, never runs the remote application, and excludes USA", () => {
    const source = `
        const colors = [{id: 0, value: "red"}, {id: 1, value: "blue"}];
        const flags = {name: "Flag", categories: [{ids: ["color_on_flag"], name: "Flag color"}]};
        const geography = {name: "Geography", categories: [{ids: ["island_nation"], name: "Island nation"}]};
        const capital = {name: "Capital", categories: []};
        const atlas = [flags, geography, capital];
        const usaFlags = {name: "Flag", categories: [{ids: ["usa_only"], name: "USA only"}]};
        const usaAtlas = [usaFlags, capital];
        function picker() {
            const sections = [
                {section: "Flag", choices: [...colors.map(c => ({id: "color_on_flag", variantId: c.id, name: \`Flag: \${c.value}\`}))]},
                {section: "Geography", choices: [{id: "island_nation", variantId: null, name: "Island nation"}]},
                {section: "Capital", choices: []}
            ];
            return sections;
        }
        throw new Error("This code must never execute");
    `;
    const extracted = extractCatalog(source);
    assert.deepEqual(extracted.map(item => item.key), ["color_on_flag:0", "color_on_flag:1", "island_nation:default"]);
    assert.equal(extracted[1].label, "Flag: blue");
    assert.throws(() => extractCatalog(source.replace('value: "red"', 'value: (() => { throw new Error("executed"); })()')), /Unsupported literal/);
    assert.throws(() => extractCatalog(source.replace('id: "island_nation"', 'id: "unlisted_id"')), /Expected exactly one world category picker/);
    assert.throws(() => extractCatalog(source.replace("...colors.map", "...colors.filter")), /Unsupported picker variant expansion/);
});

test("snapshot preparation evaluates the complete registry and doesn't inherit disputed area facts", () => {
    const country = record({ flagInfo: { colorsOnFlag: ["blue"] } }, { population: 1000, size: 123 });
    const input = {
        choices: CHOICES, combined: { aa: country }, registry: [{ code: "AA" }],
        geometry: { objects: { countries: { geometries: [
            { id: "AAA", properties: { iso2: "AA" } },
            { id: "X-DISPUTED", properties: {} },
            { id: "X-KOSOVO", properties: {} },
        ] } } }, source: {},
    };
    const result = buildSnapshot(input);
    assert.equal(result.choices.length, 441);
    assert.equal(result.countries.aa.population, 1000);
    assert.equal(result.countries.aa.size, 123);
    assert.deepEqual(result.countries.aa.borders, []);
    assert.equal(result.countries.aa.borderMode, "bordering");
    assert.equal(result.countries.aa.borderCount, 0);
    assert.equal(result.countries.aa.location, null);
    assert.equal(result.countries.aa.numericValues.population, 1000);
    assert.equal(result.countries.aa.numericValues.size, 123);
    assert.equal(result.countries.aa.numericValues.border_count, 0);
    assert.equal(result.countries.aa.numericValues.flag_color_count, 1);
    assert.equal(result.countries.aa.numericValues.capital_population, null);
    assert.equal(result.countries.aa.timeZones, null);
    assert.deepEqual(result.mapping, { AAA: "aa", "X-DISPUTED": null, "X-KOSOVO": null });
    assert.deepEqual(result.choices.find(item => item.key === "color_on_flag:1").matches, ["aa"]);
    const located = structuredClone(input);
    located.combined.aa.common.longitude = 177.64933;
    located.combined.aa.common.latitude = -7.109535;
    const enriched = buildSnapshot(located);
    assert.deepEqual(enriched.countries.aa.location, [177.64933, -7.109535]);
    assert.deepEqual(enriched.choices, result.choices);
    enriched.countries.aa.location = null;
    assert.deepEqual(enriched, result);
    located.combined.aa.common.latitude = 91;
    assert.throws(() => buildSnapshot(located), /Invalid country coordinates/);
});

test("source failures are explicit and never write bundled snapshots", async () => {
    const directory = path.join(ROOT, "tools/geogrid-atlas/.test-fetch");
    await mkdir(directory, { recursive: true });
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
    try {
        await assert.rejects(prepareAtlas({ root: ROOT, directory }), /source unavailable: 503/);
        assert.equal(await readFile(path.join(ROOT, "games/world-map/data/geogrid.json"), "utf8"), JSON.stringify(SNAPSHOT, null, 2) + "\n");
    } finally {
        globalThis.fetch = original;
        await rm(directory, { recursive: true, force: true });
    }
});
