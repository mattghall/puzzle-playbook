import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { feature } from "topojson-client";
import { compileAtlasQuery, createAtlas, filterChoices, matchAtlasCountry } from "../games/world-map/js/atlas.mjs";
import { groupChoices, presentChoice } from "../games/world-map/js/category-groups.mjs";
import { expandThresholdMatches, getThresholdRanges, getThresholdSeries, rangeEndpointLabel, rangePosition, setRangePosition, setThreshold, thresholdLabel, thresholdPosition } from "../games/world-map/js/thresholds.mjs";
import { getColorPalette } from "../games/world-map/js/color-picker.mjs";

const COUNTRIES = ["AAA", "BBB", "CCC"].map(id => ({ type: "Feature", properties: { id, name: id }, geometry: { type: "Polygon", coordinates: [] } }));
const SNAPSHOT = {
    version: 1,
    colors: [{ value: "red", label: "Red", variantId: 3 }],
    countries: {
        aa: { code: "AA", name: "A", flagColors: ["red"] },
        bb: { code: "BB", name: "B", flagColors: null },
        tv: { code: "TV", name: "Tuvalu", flagColors: [] },
    },
    mapping: { AAA: "aa", BBB: "bb", CCC: null },
    choices: [
        { key: "red:3", id: "red", variantId: 3, label: "Red on flag", section: "Flag", category: "Colors", matches: ["aa"], unknown: ["bb"] },
        { key: "large:0", id: "large", variantId: 0, label: "Over 50 million", section: "Demographics", category: "Population", matches: ["bb"], unknown: [] },
    ],
};

test("atlas fixture combines all, any, exclusions, contradictions, and missing source values", () => {
    const atlas = createAtlas(SNAPSHOT, COUNTRIES);
    const red = { key: "red:3", exclude: false };
    const large = { key: "large:0", exclude: false };
    const notRed = { ...red, exclude: true };
    for (const mode of ["all", "any"]) assert.equal(matchAtlasCountry(atlas, "AAA", [], mode), "match");
    assert.equal(matchAtlasCountry(atlas, "AAA", [red]), "match");
    assert.equal(matchAtlasCountry(atlas, "BBB", [red]), "unknown");
    assert.equal(matchAtlasCountry(atlas, "AAA", [red, large]), "nonmatch");
    assert.equal(matchAtlasCountry(atlas, "BBB", [red, large]), "unknown");
    assert.equal(matchAtlasCountry(atlas, "BBB", [red, large], "any"), "match");
    assert.equal(matchAtlasCountry(atlas, "AAA", [red, large], "any"), "match");
    assert.equal(matchAtlasCountry(atlas, "AAA", [notRed]), "nonmatch");
    assert.equal(matchAtlasCountry(atlas, "BBB", [notRed]), "unknown");
    assert.equal(matchAtlasCountry(atlas, "AAA", [red, notRed]), "nonmatch");
    assert.equal(matchAtlasCountry(atlas, "AAA", [red, notRed], "any"), "match");
    assert.equal(matchAtlasCountry(atlas, "BBB", [red, { ...large, exclude: true }]), "nonmatch");
    assert.equal(matchAtlasCountry(atlas, "BBB", [red, { ...large, exclude: true }], "any"), "unknown");
    assert.equal(matchAtlasCountry(atlas, "geogrid:tv", [notRed]), "match");
    assert.equal(matchAtlasCountry(atlas, "geogrid:tv", [red, large], "any"), "nonmatch");
    for (const conditions of [[], [red], [notRed]]) assert.equal(matchAtlasCountry(atlas, "CCC", conditions), "outside");
    assert.equal(atlas.records.length, 4);
    assert.equal(atlas.records.find(country => country.properties.name === "Tuvalu").geometry, null);
    assert.deepEqual(filterChoices(atlas, " flag RED ").map(choice => choice.key), ["red:3"]);
    assert.deepEqual(filterChoices(atlas, "50", "Demographics").map(choice => choice.key), ["large:0"]);
    assert.equal(filterChoices(atlas, "50", "Flag").length, 0);
    assert.throws(() => matchAtlasCountry(atlas, "BAD", []), /Unknown map country/);
    assert.throws(() => compileAtlasQuery(atlas, [red], "invalid"), /Invalid category combination/);
    assert.throws(() => compileAtlasQuery(atlas, [{ key: "missing", exclude: false }]), /Invalid selected category/);
    assert.throws(() => compileAtlasQuery(atlas, [{ key: "red:3" }]), /Invalid selected category/);
});

test("atlas fixture rejects missing mappings, duplicate variants, and invalid memberships", () => {
    for (const change of [
        snapshot => delete snapshot.mapping.AAA,
        snapshot => snapshot.mapping.AAA = "missing",
        snapshot => snapshot.choices.push(snapshot.choices[0]),
        snapshot => snapshot.choices[0].unknown.push("aa"),
        snapshot => snapshot.choices[0].matches.push("missing"),
        snapshot => snapshot.colors.push(snapshot.colors[0]),
        snapshot => snapshot.countries.aa.flagColors.push("gold"),
    ]) {
        const snapshot = structuredClone(SNAPSHOT);
        change(snapshot);
        assert.throws(() => createAtlas(snapshot, COUNTRIES), /GeoGrid/);
    }
});

async function readAtlas() {
    const snapshot = JSON.parse(await readFile(new URL("../games/world-map/data/geogrid.json", import.meta.url), "utf8"));
    const world = JSON.parse(await readFile(new URL("../games/world-map/data/world.json", import.meta.url), "utf8"));
    return createAtlas(snapshot, feature(world, world.objects.countries).features);
}

test("category groups combine flag colors and features without losing or duplicating choices", async () => {
    const atlas = await readAtlas();
    const choices = [...atlas.choices.values()];
    const groups = groupChoices(choices);
    const flattened = groups.flatMap(section => section.groups.flatMap(group => group.choices));
    assert.equal(flattened.length, choices.length);
    assert.equal(new Set(flattened.map(choice => choice.key)).size, choices.length);
    assert.ok(flattened.every(choice => atlas.choices.get(choice.key) === choice));
    const flag = groups.find(section => section.section === "Flag");
    assert.deepEqual(flag.groups.map(group => group.name), ["Flag colors", "Flag features"]);
    const colors = flag.groups[0];
    for (const id of ["color_on_flag", "color_not_on_flag", "flag_rwb", "flag_without_rwb", "flag_has_x_colors", "flag_has_x_or_more_colors"]) {
        assert.ok(colors.choices.some(choice => choice.id === id), id);
    }
    assert.deepEqual(flag.groups[1].choices.map(choice => presentChoice(choice).label).sort(),
        ["Animal", "Coat of arms", "Horizontal stripes", "Moon", "Plant", "Star or sun", "Vertical stripes"].sort());
    const star = choices.find(choice => choice.id === "flag_has_star");
    assert.equal(presentChoice(star).fullLabel, "Star or sun on flag");
    assert.ok(filterChoices(atlas, "sun", "Flag").includes(star));
    assert.equal(filterChoices(atlas, "flag features", "Flag").length, 7);
    assert.equal(presentChoice(choices.find(choice => choice.id === "flag_rwb")).label, "Only red, white, and blue");
    assert.equal(presentChoice(choices.find(choice => choice.id === "color_on_flag" && choice.value === "grey")).label, "With gray");
    assert.equal(groups.find(section => section.section === "Geography").groups.find(group => group.name === "Island nation").choices.length, 1);
});

test("threshold sliders expose every numeric category at an exact integer stop", async () => {
    const atlas = await readAtlas();
    const choices = [...atlas.choices.values()];
    const series = getThresholdSeries(choices);
    const numeric = choices.filter(choice => typeof choice.value === "number");
    assert.equal([...series.values()].reduce((sum, entry) => sum + entry.choices.length, 0), numeric.length);
    for (const entry of series.values()) {
        const selected = new Map();
        assert.equal(thresholdPosition(selected, entry), 0);
        for (let index = 0; index < entry.choices.length; index++) {
            const choice = entry.choices[index];
            setThreshold(selected, entry, index + 1);
            assert.deepEqual([...selected.keys()], [choice.key]);
            assert.equal(thresholdPosition(selected, entry), index + 1);
            assert.ok(thresholdLabel(choice));
            if (index) assert.ok(choice.value > entry.choices[index - 1].value);
            const query = compileAtlasQuery(atlas, [{ key: choice.key, exclude: false }]);
            for (const code of Object.keys(atlas.snapshot.countries)) {
                assert.equal(query(code), choice.matches.has(code) ? "match" : choice.unknown.has(code) ? "unknown" : "nonmatch");
            }
        }
        setThreshold(selected, entry, 0);
        assert.equal(selected.size, 0);
        for (const invalid of [-1, 0.5, entry.choices.length + 1, NaN]) assert.throws(() => setThreshold(selected, entry, invalid), /Invalid threshold/);
    }
    assert.deepEqual(series.get("rainfall_over_x").choices.map(choice => choice.value), [500, 1000, 1500, 2000]);
    assert.deepEqual(series.get("population_over_x").choices.map(choice => choice.value), [100000, 1000000, 2000000, 5000000, 10000000, 20000000, 50000000, 100000000, 200000000]);
    assert.equal(series.get("largest_city_x_urban_pop").direction, "Over");
    assert.equal(series.get("captial_population_under_x").direction, "Under");
});

test("flag palettes expose eleven colors and retain equivalent legacy variants without duplicate swatches", async () => {
    const atlas = await readAtlas();
    for (const id of ["color_on_flag", "color_not_on_flag"]) {
        const choices = [...atlas.choices.values()].filter(choice => choice.id === id);
        const palette = getColorPalette(choices, atlas.snapshot.colors);
        assert.equal(palette.length, 11);
        assert.equal(new Set(palette.map(swatch => swatch.color)).size, 11);
        assert.deepEqual(new Set(palette.flatMap(swatch => swatch.keys)), new Set(choices.map(choice => choice.key)));
        for (const swatch of palette) {
            assert.equal(swatch.choice.id, id);
            assert.equal(swatch.choice.value, swatch.color);
            assert.equal(swatch.choice.legacy, undefined);
            assert.match(swatch.fill, /^#[0-9a-f]{6}$/);
            assert.match(swatch.ink, /^#[0-9a-f]{6}$/);
            for (const key of swatch.keys) {
                assert.deepEqual(atlas.choices.get(key).matches, swatch.choice.matches);
                assert.deepEqual(atlas.choices.get(key).unknown, swatch.choice.unknown);
            }
        }
        assert.equal(palette.find(swatch => swatch.color === "blue").choice.variantId, 1);
        assert.equal(palette.find(swatch => swatch.color === "grey").choice.variantId, 6);
    }
});

test("sliders preserve other bounds and exclusions, and search doesn't renumber their stops", async () => {
    const atlas = await readAtlas();
    const choices = [...atlas.choices.values()];
    const series = getThresholdSeries(choices);
    const over = series.get("rainfall_over_x");
    const under = series.get("rainfall_under_x");
    const flag = choices.find(choice => choice.id === "color_on_flag");
    const selected = new Map([[flag.key, false]]);
    setThreshold(selected, under, 4);
    setThreshold(selected, over, 1);
    selected.set(over.choices[0].key, true);
    setThreshold(selected, over, 3);
    assert.equal(selected.size, 3);
    assert.equal(selected.get(over.choices[2].key), true);
    assert.equal(selected.get(under.choices[3].key), false);
    assert.equal(selected.get(flag.key), false);
    setThreshold(selected, over, 0);
    assert.equal(selected.size, 2);
    selected.delete(under.choices[3].key);
    assert.equal(thresholdPosition(selected, under), 0);
    const expanded = expandThresholdMatches(choices, filterChoices(atlas, "rainfall 1K"));
    assert.deepEqual(new Set(expanded.map(choice => choice.key)), new Set([...over.choices, ...under.choices].map(choice => choice.key)));
    assert.deepEqual(expandThresholdMatches(choices, []), []);
    assert.throws(() => getThresholdSeries([{ key: "bad", id: "bad", value: 3 }]), /Unsupported numeric/);
    assert.throws(() => getThresholdSeries([over.choices[0], over.choices[0]]), /Duplicate/);
});

test("range endpoints show zero with source units and infinity without abbreviated zeroes", async () => {
    const atlas = await readAtlas();
    const ranges = getThresholdRanges([...atlas.choices.values()]);
    const expected = {
        "Average elevation": "0 m",
        "Average temperature": "0 \u00b0C",
        "Annual rainfall": "0 mm",
        "Forest cover": "0%",
        "Human Development Index": "0",
        "GDP per capita": "$0",
        "Population count": "0",
        "Area": "0 km\u00b2",
        "Capital city population": "0",
    };
    for (const [name, label] of Object.entries(expected)) {
        const range = ranges.find(range => range.name === name);
        assert.equal(rangeEndpointLabel(range, "lower"), label);
    }
    for (const range of ranges) {
        assert.equal(rangeEndpointLabel(range, "upper"), "\u221e");
        assert.match(rangeEndpointLabel(range, "lower"), /0/);
        assert.doesNotMatch(rangeEndpointLabel(range, "lower"), /Off|0[KMB]/);
    }
});

test("shared ranges start Off at both ends and expose every supported bound without crossing", async () => {
    const atlas = await readAtlas();
    const choices = [...atlas.choices.values()];
    const ranges = getThresholdRanges(choices);
    const covered = [];
    for (const range of ranges) {
        const selected = new Map();
        const max = range.values.length + 1;
        assert.equal(rangePosition(selected, range, "lower"), 0);
        assert.equal(rangePosition(selected, range, "upper"), max);
        for (const side of ["lower", "upper"]) {
            const series = range[side];
            if (!series) {
                assert.throws(() => setRangePosition(selected, range, side, 1), /Invalid range/);
                continue;
            }
            for (const choice of series.choices) {
                selected.clear();
                const position = range.values.indexOf(choice.value) + 1;
                setRangePosition(selected, range, side, position);
                assert.deepEqual([...selected.keys()], [choice.key]);
                assert.equal(rangePosition(selected, range, side), position);
                covered.push(choice.key);
                setRangePosition(selected, range, side, side === "lower" ? 0 : max);
                assert.equal(selected.size, 0);
            }
        }
    }
    assert.deepEqual(new Set(covered), new Set(choices.filter(choice => typeof choice.value === "number").map(choice => choice.key)));
    const rain = ranges.find(range => range.lower?.id === "rainfall_over_x");
    const selected = new Map([["color_on_flag:0", false]]);
    setRangePosition(selected, rain, "lower", 1);
    setRangePosition(selected, rain, "upper", 2);
    assert.equal(selected.get("rainfall_over_x:0"), false);
    assert.equal(selected.get("rainfall_under_x:1"), false);
    setRangePosition(selected, rain, "lower", 4);
    assert.equal(rangePosition(selected, rain, "lower"), 1);
    setRangePosition(selected, rain, "upper", 0);
    assert.equal(rangePosition(selected, rain, "upper"), 2);
    setRangePosition(selected, rain, "upper", 5);
    assert.ok(!selected.has("rainfall_under_x:1"));
    selected.set("rainfall_over_x:0", true);
    setRangePosition(selected, rain, "lower", 3);
    assert.equal(selected.get("rainfall_over_x:2"), true);
    assert.equal(selected.get("color_on_flag:0"), false);
    for (const value of [-1, 0.5, 6, NaN]) assert.throws(() => setRangePosition(selected, rain, "lower", value), /Invalid range/);
    const matched = expandThresholdMatches(choices, filterChoices(atlas, "rainfall >"));
    assert.ok(matched.some(choice => choice.id === "rainfall_under_x"));
});

test("shared ranges snap asymmetric bounds to their own source stops and reset independently", async () => {
    const atlas = await readAtlas();
    const rain = getThresholdRanges([...atlas.choices.values()]).find(range => range.lower?.id === "rainfall_over_x");
    const range = {
        ...rain,
        lower: { ...rain.lower, choices: rain.lower.choices.filter((choice, index) => index % 2 === 0) },
        upper: { ...rain.upper, choices: rain.upper.choices.filter((choice, index) => index % 2 === 1) },
    };
    const selected = new Map();
    setRangePosition(selected, range, "lower", 2);
    assert.deepEqual([...selected.keys()], ["rainfall_over_x:0"]);
    setRangePosition(selected, range, "upper", 3);
    assert.deepEqual([...selected.keys()], ["rainfall_over_x:0", "rainfall_under_x:1"]);
    selected.delete("rainfall_over_x:0");
    assert.equal(rangePosition(selected, range, "lower"), 0);
    assert.equal(rangePosition(selected, range, "upper"), 2);
    setRangePosition(selected, range, "lower", 4);
    assert.equal(rangePosition(selected, range, "lower"), 1);
    selected.clear();
    assert.equal(rangePosition(selected, range, "lower"), 0);
    assert.equal(rangePosition(selected, range, "upper"), 5);
});

test("every flag-color combination agrees with the combined dataset's palettes", async () => {
    const atlas = await readAtlas();
    const colors = atlas.snapshot.colors;
    assert.equal(colors.length, 11);
    const conditions = colors.map(color => {
        const choice = [...atlas.choices.values()].find(choice => choice.id === "color_on_flag" && choice.variantId === color.variantId);
        assert.ok(choice, color.value);
        assert.equal(choice.unknown.size, 0, "All source countries must have flag palettes");
        return { key: choice.key, exclude: false };
    });
    for (let mask = 0; mask < 2 ** colors.length; mask++) {
        const selected = conditions.filter((_, index) => mask & 2 ** index);
        const wanted = colors.filter((_, index) => mask & 2 ** index).map(color => color.value);
        const all = compileAtlasQuery(atlas, selected);
        const any = compileAtlasQuery(atlas, selected, "any");
        const without = compileAtlasQuery(atlas, selected.map(condition => ({ ...condition, exclude: true })));
        for (const [code, country] of Object.entries(atlas.snapshot.countries)) {
            const has = color => country.flagColors.includes(color);
            assert.equal(all(code), wanted.every(has) ? "match" : "nonmatch", code + ": all " + mask);
            assert.equal(any(code), !wanted.length || wanted.some(has) ? "match" : "nonmatch", code + ": any " + mask);
            assert.equal(without(code), !wanted.some(has) ? "match" : "nonmatch", code + ": without " + mask);
        }
    }
});

test("every category pair follows set intersection, union, and exclusion", async () => {
    const atlas = await readAtlas();
    const codes = Object.keys(atlas.snapshot.countries);
    const choices = [...atlas.choices.values()];
    function getValue(choice, code) {
        return choice.unknown.has(code) ? null : choice.matches.has(code);
    }
    function getExpected(a, b, mode) {
        if (mode === "all" && (a === false || b === false)) return "nonmatch";
        if (mode === "any" && (a === true || b === true)) return "match";
        if (a === null || b === null) return "unknown";
        return mode === "all" ? "match" : "nonmatch";
    }
    for (let i = 0; i < choices.length; i++) {
        for (let j = i; j < choices.length; j++) {
            const first = choices[i];
            const second = choices[j];
            const conditions = [{ key: first.key, exclude: false }, { key: second.key, exclude: false }];
            const all = compileAtlasQuery(atlas, conditions);
            const any = compileAtlasQuery(atlas, conditions, "any");
            const except = compileAtlasQuery(atlas, [conditions[0], { ...conditions[1], exclude: true }]);
            for (const code of codes) {
                const a = getValue(first, code);
                const b = getValue(second, code);
                assert.equal(all(code), getExpected(a, b, "all"));
                assert.equal(any(code), getExpected(a, b, "any"));
                assert.equal(except(code), getExpected(a, b === null ? null : !b, "all"));
            }
        }
    }
    const unlimited = compileAtlasQuery(atlas, choices.map(choice => ({ key: choice.key, exclude: false })));
    for (const code of codes) assert.equal(unlimited(code), "nonmatch");
});
