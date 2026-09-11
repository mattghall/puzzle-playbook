import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { applyCapitalData, CAPITAL_IDS, CITY_URL, readCapitalData } from "./capitals.mjs";
import { GEOGRID_PATH, GEOGRID_SOURCES_PATH, prepareCapitals } from "./prepare.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SNAPSHOT = JSON.parse(await readFile(path.join(ROOT, GEOGRID_PATH), "utf8"));
const PROVENANCE = JSON.parse(await readFile(path.join(ROOT, GEOGRID_SOURCES_PATH), "utf8"));

function city(index, name, capital, population, countryCode = "MY") {
    return { index, countryCode, names: { en: name }, capital, ...(population === undefined ? {} : { population }) };
}

function getChoice(snapshot, id, value) {
    return snapshot.choices.find(choice => choice.id === id && (value === undefined || choice.value === value));
}

function withoutCapitals(snapshot) {
    const copy = structuredClone(snapshot);
    delete copy.source;
    copy.choices = copy.choices.filter(choice => !CAPITAL_IDS.includes(choice.id));
    for (const country of Object.values(copy.countries)) {
        delete country.capital;
        delete country.numericValues.capital_population;
    }
    return copy;
}

test("capital supplementation preserves every non-capital fact, choice, unknown, and geometry mapping", () => {
    const snapshot = structuredClone(SNAPSHOT);
    applyCapitalData(snapshot, [city(1, "First", true, 100000), city(2, "Second", false, 200000)]);
    assert.deepEqual(withoutCapitals(snapshot), withoutCapitals(SNAPSHOT));
    assert.deepEqual(snapshot.countries.my.numericValues.capital_population, [100000]);
    assert.equal(snapshot.countries.my.capital.notLargest, true);
    assert.ok(getChoice(snapshot, "capital_not_most_populated_city").matches.includes("my"));
});

test("multiple capitals retain any-capital thresholds and accent-normalized names without inventing populations", () => {
    const snapshot = structuredClone(SNAPSHOT);
    const cities = [city(1, " Álpha", true, 50000), city(2, "Beta", true, 200000), city(3, "Gamma", false, 300000)];
    applyCapitalData(snapshot, cities);
    assert.ok(getChoice(snapshot, "capital_starting_letter", "A").matches.includes("my"));
    assert.ok(getChoice(snapshot, "capital_starting_letter", "B").matches.includes("my"));
    assert.ok(getChoice(snapshot, "capital_population_over_x", 100000).matches.includes("my"));
    assert.ok(getChoice(snapshot, "captial_population_under_x", 100000).matches.includes("my"));
    assert.ok(!getChoice(snapshot, "capital_population_over_x", 200000).matches.includes("my"));
    assert.ok(!getChoice(snapshot, "captial_population_under_x", 50000).matches.includes("my"));
    cities[1].population = undefined;
    applyCapitalData(snapshot, cities);
    assert.deepEqual(snapshot.countries.my.numericValues.capital_population, [50000, null]);
    assert.ok(getChoice(snapshot, "capital_population_over_x", 100000).unknown.includes("my"));
    assert.ok(getChoice(snapshot, "captial_population_under_x", 100000).matches.includes("my"));
    assert.ok(getChoice(snapshot, "capital_starting_letter", "B").matches.includes("my"));
    assert.equal(snapshot.countries.my.capital.notLargest, null);
    assert.equal(snapshot.countries.aq.numericValues.capital_population, null);
});

test("largest-city comparisons remain unknown when evidence is insufficient", () => {
    const compare = cities => readCapitalData(cities, { my: {} }).my.notLargest;
    assert.equal(compare([city(1, "Capital", true, 100)]), null);
    assert.equal(compare([city(1, "Capital", true, 100), city(2, "Other", false)]), null);
    assert.equal(compare([city(1, "Capital", true), city(2, "Other", false, 200)]), null);
    assert.equal(compare([city(1, "Capital", true, 100), city(2, "Other", false, 200), city(3, "Missing", false)]), true);
    assert.equal(compare([city(1, "Capital", true, 200), city(2, "Other", false, 100)]), false);
    assert.equal(compare([city(1, "Capital", true, 200), city(2, "Other", false, 200)]), false);
    assert.equal(compare([city(1, "Capital", true, 200), city(2, "Other", false, 100), city(3, "Missing", false)]), null);
    assert.equal(compare([city(1, "Capital", true, 200), city(2, "Other capital", true, 100)]), false);
});

test("capital inputs reject malformed records and retain source citations", () => {
    const valid = city(1, "Capital", true, 100);
    const sourceLink = "https://example.org/capital";
    assert.equal(readCapitalData([{ ...valid, sourceLink }], { my: {} }).my.cities[0].source.url, sourceLink);
    for (const change of [
        { index: "1" }, { countryCode: "ZZ" }, { capital: "true" }, { names: { en: "" } },
        { population: "100" }, { population: -1 }, { population: 1.5 }, { population: Infinity }, { sourceLink: "javascript:alert(1)" },
    ]) assert.throws(() => readCapitalData([{ ...valid, ...change }], { my: {} }), /Invalid GeoGrid city/);
    assert.throws(() => readCapitalData([valid, valid], { my: {} }), /Invalid GeoGrid city/);
    assert.throws(() => readCapitalData([], { my: {} }), /Missing GeoGrid city data/);
    assert.throws(() => applyCapitalData(structuredClone(SNAPSHOT), [city(1, "Other", false, 100)]), /no capital designations/);
});

test("capital-only refresh requests just cities, preserves other facts, and records reproducible provenance", async () => {
    const directory = path.join(ROOT, "tools/geogrid-atlas/.test-capitals");
    const root = path.join(directory, "root");
    await mkdir(path.join(root, "games/world-map/data"), { recursive: true });
    await writeFile(path.join(root, GEOGRID_PATH), JSON.stringify(SNAPSHOT));
    await writeFile(path.join(root, GEOGRID_SOURCES_PATH), JSON.stringify(PROVENANCE));
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async url => {
        calls.push(url);
        return new Response(JSON.stringify([city(1, "Capital", true, 100), city(2, "Other", false, 200)]));
    };
    try {
        const result = await prepareCapitals({ root, directory });
        assert.deepEqual(calls, [CITY_URL]);
        const snapshot = JSON.parse(result.files[0].content);
        const provenance = JSON.parse(result.files[1].content);
        assert.deepEqual(withoutCapitals(snapshot), withoutCapitals(SNAPSHOT));
        assert.equal(provenance.coverage.capitalNamesKnown, 1);
        assert.equal(provenance.coverage.capitalLargestKnown, 1);
        assert.equal(provenance.coverage.numericKnownByMetric.capital_population, 1);
        assert.equal(snapshot.source.revision, provenance.revision);
        assert.equal(snapshot.source.capitals.url, CITY_URL);
        assert.deepEqual(provenance.inputs.filter(input => input.url !== CITY_URL), PROVENANCE.inputs.filter(input => input.url !== CITY_URL));
        for (const file of result.files) await writeFile(path.join(root, file.path), file.content);
        assert.deepEqual((await prepareCapitals({ root, directory })).files, result.files);
        globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
        await assert.rejects(prepareCapitals({ root, directory }), /source unavailable: 503/);
        assert.deepEqual(JSON.parse(await readFile(path.join(root, GEOGRID_PATH), "utf8")), snapshot);
    } finally {
        globalThis.fetch = original;
        await rm(directory, { recursive: true, force: true });
    }
});
