import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileAtlasQuery, createAtlas, getAtlasChoice } from "../games/world-map/js/atlas.mjs";
import { NUMERIC_METRICS } from "../games/world-map/js/numeric-ranges.mjs";

const SNAPSHOT = JSON.parse(await readFile(new URL("../games/world-map/data/geogrid.json", import.meta.url), "utf8"));
const ATLAS = createAtlas(SNAPSHOT, []);

function getRange(id, current = ATLAS) {
    const range = current.numericRanges.find(range => range.sourceIds.includes(id));
    assert.ok(range, "Missing numeric range: " + id);
    return range;
}

function getChoiceAtValue(range, side, value) {
    const choice = range[side].choices.find(choice => choice.value === value);
    assert.ok(choice, "Missing numeric stop: " + value);
    return choice;
}

function createFixture() {
    const createCountry = code => ({
        code: code.toUpperCase(), name: code, flagColors: ["red"], landlocked: false, timeZones: ["UTC+00:00"],
        numericValues: Object.fromEntries(NUMERIC_METRICS.map(metric => [metric.key, metric.key === "capital_population" ? null : 0])),
    });
    return {
        ...SNAPSHOT, mapping: {}, countries: { aa: createCountry("aa"), bb: createCountry("bb"), cc: createCountry("cc") },
        choices: SNAPSHOT.choices.map(choice => ({ ...choice, matches: [], unknown: [] })),
    };
}

test("every numeric family has both strict bounds and exact values without changing source choices", () => {
    assert.equal(ATLAS.numericRanges.length, 22);
    assert.equal(ATLAS.choices.size, 441);
    assert.equal(SNAPSHOT.choices.length, 441);
    assert.equal(ATLAS.rangeChoices.size, 507);
    for (const original of SNAPSHOT.choices) {
        const { matches, unknown, ...metadata } = ATLAS.choices.get(original.key);
        assert.deepEqual({ ...metadata, matches: [...matches], unknown: [...unknown] }, original);
        assert.equal(getAtlasChoice(ATLAS, original.key), ATLAS.choices.get(original.key));
        if (typeof original.value === "number") assert.ok(getRange(original.id));
    }
    for (const range of ATLAS.numericRanges) {
        assert.ok(range.values.includes(0), range.key);
        assert.deepEqual([...new Set(range.values)].sort((a, b) => a - b), range.values);
        assert.equal(range.labels.length, range.values.length);
        assert.ok(range.labels.every(label => /[a-zA-Z%°μ]/.test(label)), range.key);
        for (const [side, direction] of [["lower", "Over"], ["upper", "Under"], ["exact", "Exactly"]]) {
            assert.equal(range[side].direction, direction);
            assert.deepEqual(range[side].choices.map(choice => choice.value), range.values);
            for (const choice of range[side].choices) {
                assert.equal(getAtlasChoice(ATLAS, choice.key), choice);
                assert.equal(ATLAS.choices.has(choice.key), false);
                assert.ok(choice.matches instanceof Set && choice.unknown instanceof Set);
                assert.ok([...choice.matches].every(code => !choice.unknown.has(code)));
                assert.equal(choice.sources[0].derived, true);
                assert.equal(choice.sources[0].url, SNAPSHOT.source.url);
                assert.ok(choice.id && Number.isInteger(choice.variantId) && choice.label && choice.section && choice.category);
            }
        }
    }
    assert.equal(getAtlasChoice(ATLAS, "not-a-choice"), undefined);
    assert.deepEqual(getRange("rainfall_over_x").labels, ["0 mm", "500 mm", "1K mm", "1.5K mm", "2K mm"]);
    assert.equal(getRange("arable_land_under_x").labels[0], "0%");
    assert.equal(getRange("olympic_medals_over_x").labels[0], "0 Olympic medals");
});

test("derived bounds preserve all corresponding original numeric memberships and missing facts", () => {
    for (const original of ATLAS.choices.values()) {
        if (typeof original.value !== "number") continue;
        const range = getRange(original.id);
        const side = /(^|_)under_/.test(original.id) ? "upper" : "lower";
        const choice = getChoiceAtValue(range, side, original.value);
        assert.deepEqual(choice.matches, original.matches, original.key);
        assert.deepEqual(choice.unknown, original.unknown, original.key);
    }
    const zero = getChoiceAtValue(getRange("no_olympic_medals"), "exact", 0);
    const original = [...ATLAS.choices.values()].find(choice => choice.id === "no_olympic_medals");
    assert.deepEqual(zero.matches, original.matches);
    assert.deepEqual(zero.unknown, original.unknown);
    assert.ok(zero.matches.size > 0);
});

test("all derived country results agree with numeric facts, not opposite predicates", () => {
    for (const metric of NUMERIC_METRICS) {
        const range = getRange(metric.sourceIds[0]);
        for (const side of ["lower", "upper", "exact"]) {
            for (const choice of range[side].choices) {
                const query = compileAtlasQuery(ATLAS, [{ key: choice.key, exclude: false }]);
                const inverted = compileAtlasQuery(ATLAS, [{ key: choice.key, exclude: true }]);
                assert.equal(query(null), "outside");
                for (const [code, country] of Object.entries(SNAPSHOT.countries)) {
                    const value = country.numericValues[metric.key];
                    const coastal = metric.key === "coastline_length";
                    const unknown = !(coastal && country.landlocked === true) && (value === null || coastal && country.landlocked === null);
                    const matches = !unknown && !(coastal && country.landlocked === true) &&
                        (side === "lower" ? value > choice.value : side === "upper" ? value < choice.value : value === choice.value);
                    assert.equal(query(code), unknown ? "unknown" : matches ? "match" : "nonmatch", choice.key + "/" + code);
                    assert.equal(inverted(code), unknown ? "unknown" : matches ? "nonmatch" : "match");
                }
            }
        }
    }
});

test("one-sided families gain exact and opposite bounds, with strictly excluded endpoints", () => {
    const input = createFixture();
    input.countries.aa.numericValues.arable_land = 5;
    input.countries.bb.numericValues.arable_land = 0;
    input.countries.cc.numericValues.arable_land = null;
    const current = createAtlas(input, []);
    const range = getRange("arable_land_under_x", current);
    const lower = getChoiceAtValue(range, "lower", 5);
    const upper = getChoiceAtValue(range, "upper", 5);
    const exact = getChoiceAtValue(range, "exact", 5);
    assert.deepEqual([...lower.matches], []);
    assert.deepEqual([...upper.matches], ["bb"]);
    assert.deepEqual([...exact.matches], ["aa"]);
    for (const choice of [lower, upper, exact]) assert.deepEqual([...choice.unknown], ["cc"]);
    assert.deepEqual([...getChoiceAtValue(range, "exact", 0).matches], ["bb"]);
    const both = [{ key: lower.key, exclude: false }, { key: upper.key, exclude: false }];
    assert.equal(compileAtlasQuery(current, both, "all")("aa"), "nonmatch");
    assert.equal(compileAtlasQuery(current, both, "any")("aa"), "nonmatch");
    assert.equal(compileAtlasQuery(current, both, "any")("cc"), "unknown");
    for (const id of ["arable_land_under_x", "protected_waters_under_x", "over_x_living_langs", "urban_pop_over_x", "forest_cover_over_x", "largest_city_x_urban_pop"]) {
        const family = getRange(id);
        assert.equal(family.lower.choices.length, family.upper.choices.length);
        assert.equal(family.exact.choices.length, family.values.length);
    }
});

test("border counts include every observed integer, and flag counts use reviewed source stops", () => {
    const borders = getRange("borders_x_to_y");
    const max = Math.max(...Object.values(SNAPSHOT.countries).map(country => country.numericValues.border_count ?? 0));
    assert.deepEqual(borders.values, Array.from({ length: max + 1 }, (_, index) => index));
    assert.deepEqual(borders.sourceIds, ["borders_x_to_y", "borders_x_or_more"]);
    assert.equal(ATLAS.numericRanges.some(range => range.sourceIds.includes("borders_x")), false);
    assert.deepEqual(getRange("flag_has_x_colors").sourceIds, ["flag_has_x_colors", "flag_has_x_or_more_colors"]);
    assert.deepEqual(getRange("flag_has_x_colors").values, [0, 2, 3, 4, 5]);
    for (const country of Object.values(SNAPSHOT.countries)) {
        assert.equal(country.numericValues.border_count, country.borderCount);
        assert.equal(country.numericValues.flag_color_count, country.flagColors?.length ?? null);
    }
    const temperature = getRange("temp_over_x");
    assert.equal(temperature.values[0], Math.min(...Object.values(SNAPSHOT.countries).map(country => country.numericValues.temp ?? 0)));
    assert.ok(temperature.values[0] < 0);
});

test("capital numeric facts stay unavailable, and coastline retains its source guard", () => {
    const capital = getRange("capital_population_over_x");
    for (const side of ["lower", "upper", "exact"]) {
        for (const choice of capital[side].choices) {
            assert.equal(choice.unknown.size, 249);
            assert.equal(choice.matches.size, 0);
            assert.match(choice.unavailableReason, /combined.json doesn't contain/);
        }
    }
    const input = createFixture();
    input.countries.aa.landlocked = true;
    input.countries.bb.landlocked = null;
    const coast = getRange("coastline_length_over_x", createAtlas(input, []));
    for (const choice of [getChoiceAtValue(coast, "exact", 0), getChoiceAtValue(coast, "upper", 100)]) {
        assert.deepEqual([...choice.matches], ["cc"]);
        assert.deepEqual([...choice.unknown], ["bb"]);
        assert.match(choice.sources[0].guard, /landlocked/);
    }
});

test("time zones preserve complete multi-zone and fractional-offset source strings", () => {
    assert.deepEqual(SNAPSHOT.countries.np.timeZones, ["UTC+05:45"]);
    assert.ok(SNAPSHOT.countries.us.timeZones.includes("UTC-12:00"));
    assert.equal(SNAPSHOT.countries.us.timeZones.length, 8);
    assert.ok(SNAPSHOT.countries.ca.timeZones.includes("UTC-03:30"));
    assert.ok(SNAPSHOT.countries.tv.timeZones.includes("UTC+12:00"));
    assert.equal(Object.values(SNAPSHOT.mapping).includes("tv"), false);
});

test("numeric and time-zone schemas reject malformed extensions while legacy fixtures remain valid", () => {
    for (const change of [
        input => input.countries.aa.numericValues.population = "0",
        input => input.countries.aa.numericValues.population = Infinity,
        input => input.countries.aa.numericValues.population = -1,
        input => input.countries.aa.numericValues.border_count = 1.5,
        input => input.countries.aa.numericValues.hdi = 1.1,
        input => input.countries.aa.numericValues.arable_land = 101,
        input => input.countries.aa.numericValues.capital_population = 10,
        input => delete input.countries.aa.numericValues.rainfall,
        input => delete input.countries.aa.numericValues,
        input => input.countries.aa.numericValues = [],
        input => input.countries.aa.landlocked = "false",
        input => input.countries.aa.timeZones = "UTC+01:00",
        input => input.countries.aa.timeZones = [1],
        input => input.countries.aa.timeZones = [""],
        input => input.countries.aa.timeZones = ["UTC+00:00", "UTC+00:00"],
    ]) {
        const input = createFixture();
        change(input);
        assert.throws(() => createAtlas(input, []), /GeoGrid/);
    }
    const input = createFixture();
    for (const country of Object.values(input.countries)) {
        delete country.numericValues;
        delete country.landlocked;
        delete country.timeZones;
    }
    const legacy = createAtlas(input, []);
    assert.deepEqual(legacy.numericRanges, []);
    assert.equal(legacy.rangeChoices.size, 0);
    assert.equal(legacy.choices.size, 441);
    input.countries.aa.timeZones = [false];
    assert.throws(() => createAtlas(input, []), /time zones/);
});
