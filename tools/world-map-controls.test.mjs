import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { groupChoices, SAME_SEX_OPTIONS } from "../games/world-map/js/category-groups.mjs";
import { dropdownLabel, getDropdownGroups } from "../games/world-map/js/dropdowns.mjs";
import { rangeEndpointLabel, rangePosition, setRangePosition } from "../games/world-map/js/thresholds.mjs";
import { countryTimeZoneColor, countryTimeZoneLabel, listTimeZones, timeZoneColor, timeZoneOffset } from "../games/world-map/js/timezones.mjs";

test("requested dropdown families retain every source option exactly once", async () => {
    const snapshot = JSON.parse(await readFile(new URL("../games/world-map/data/geogrid.json", import.meta.url), "utf8"));
    const groups = getDropdownGroups(snapshot.choices);
    assert.equal(groups.length, 11);
    const ids = groups.flatMap(group => group.ids);
    const keys = groups.flatMap(group => group.choices.map(choice => choice.key));
    assert.equal(new Set(keys).size, keys.length);
    assert.deepEqual(new Set(keys), new Set(snapshot.choices.filter(choice => ids.includes(choice.id)).map(choice => choice.key)));
    const byKey = new Map(groups.map(group => [group.key, group]));
    assert.equal(byKey.get("empire").choices.length, 3);
    assert.ok(byKey.get("name-length").choices.some(choice => dropdownLabel(choice) === "10+ letters"));
    assert.equal(dropdownLabel(byKey.get("starting-letter").choices[0]), "A");
    assert.equal(dropdownLabel(byKey.get("official-language").choices[0]), "Arabic");
    const ranked = groupChoices(snapshot.choices).find(section => section.section === "Rankings");
    assert.equal(ranked.groups.length, 1);
    assert.deepEqual(new Set(ranked.groups[0].choices.map(choice => choice.key)),
        new Set(snapshot.choices.filter(choice => /^(top|bottom)_20_/.test(choice.id)).map(choice => choice.key)));
});

function createNumericRange() {
    const range = { key: "medals", name: "Olympic medals", values: [0, 10, 20], labels: ["0 medals", "10 medals", "20 medals"] };
    for (const side of ["lower", "upper", "exact"]) {
        range[side] = {
            id: side,
            choices: range.values.map((value, index) => ({ key: side + ":" + index, value })),
        };
    }
    return range;
}

test("same-sex switch orders Legal, Off, and Illegal and preserves the separate source conditions", async () => {
    const snapshot = JSON.parse(await readFile(new URL("../games/world-map/data/geogrid.json", import.meta.url), "utf8"));
    assert.deepEqual(SAME_SEX_OPTIONS.map(option => option.value), ["legal", "off", "illegal"]);
    assert.equal(SAME_SEX_OPTIONS[1].id, null);
    assert.equal(SAME_SEX_OPTIONS[0].id, "same_sex_marriage_legal");
    assert.equal(SAME_SEX_OPTIONS[2].id, "same_sex_activities_illegal");
    const groups = groupChoices(snapshot.choices).flatMap(section => section.groups);
    const group = groups.find(group => group.name === "Same-sex laws");
    assert.deepEqual(group.choices.map(choice => choice.id), ["same_sex_marriage_legal", "same_sex_activities_illegal"]);
});

test("two numeric handles can meet at exactly zero, expand, and reset without losing other filters", () => {
    const range = createNumericRange();
    const selected = new Map([["other", false]]);
    assert.equal(rangeEndpointLabel(range, "lower"), "0 medals");
    setRangePosition(selected, range, "upper", 0);
    assert.deepEqual([...selected.keys()], ["other", "exact:0"]);
    selected.delete("exact:0");
    setRangePosition(selected, range, "lower", 1);
    setRangePosition(selected, range, "upper", 1);
    assert.deepEqual([...selected.keys()], ["other", "exact:0"]);
    assert.equal(rangePosition(selected, range, "lower"), 1);
    assert.equal(rangePosition(selected, range, "upper"), 1);
    setRangePosition(selected, range, "upper", 3);
    assert.deepEqual([...selected.keys()], ["other", "lower:0", "upper:2"]);
    setRangePosition(selected, range, "lower", 3);
    assert.deepEqual([...selected.keys()], ["other", "exact:2"]);
    setRangePosition(selected, range, "lower", 0);
    assert.deepEqual([...selected.keys()], ["other", "upper:2"]);
    setRangePosition(selected, range, "upper", 4);
    assert.deepEqual([...selected.keys()], ["other"]);
    for (const side of ["lower", "upper"]) {
        for (const invalid of [-1, 5, 0.5, NaN]) assert.throws(() => setRangePosition(selected, range, side, invalid));
    }
});

test("numeric handles clamp at each other and preserve excluded exact matches", () => {
    const range = createNumericRange();
    const selected = new Map([["exact:1", true]]);
    setRangePosition(selected, range, "lower", 3);
    assert.deepEqual([...selected], [["exact:1", true]]);
    setRangePosition(selected, range, "upper", 0);
    assert.deepEqual([...selected], [["exact:1", true]]);
    selected.clear();
    setRangePosition(selected, range, "upper", 2);
    setRangePosition(selected, range, "lower", 4);
    assert.deepEqual([...selected], [["exact:1", false]]);
    selected.delete("exact:1");
    assert.equal(rangePosition(selected, range, "lower"), 0);
    assert.equal(rangePosition(selected, range, "upper"), 4);
});

test("timezone view preserves fractional offsets, multiple zones, and missing data", () => {
    const countries = {
        a: { timeZones: ["UTC+05:30"] },
        b: { timeZones: ["UTC-03:30", "UTC+00:00"] },
        c: { timeZones: null },
    };
    assert.equal(timeZoneOffset("UTC+05:45"), 345);
    assert.equal(timeZoneOffset("UTC-03:30"), -210);
    assert.deepEqual(listTimeZones(countries), ["UTC-03:30", "UTC+00:00", "UTC+05:30"]);
    assert.equal(countryTimeZoneColor(countries.a), timeZoneColor("UTC+05:30"));
    assert.equal(countryTimeZoneColor(countries.b), "#956cac");
    assert.equal(countryTimeZoneColor(countries.b, "UTC-03:30"), timeZoneColor("UTC-03:30"));
    assert.equal(countryTimeZoneColor(countries.b, "UTC+05:30"), "#e0e3e4");
    assert.equal(countryTimeZoneColor(countries.c), "#d9bc86");
    assert.equal(countryTimeZoneColor(undefined), "#b9b2c8");
    assert.equal(countryTimeZoneLabel(countries.b), "UTC-03:30, UTC+00:00");
    assert.equal(countryTimeZoneLabel(countries.c), "Time zones unavailable");
    assert.throws(() => timeZoneOffset("UTC+05:99"), /Invalid time zone/);
});
