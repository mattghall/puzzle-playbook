import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createAtlas } from "../games/world-map/js/atlas.mjs";
import { readSettings, writeSettings } from "../games/world-map/js/settings.mjs";
import { listTimeZones } from "../games/world-map/js/timezones.mjs";

const SNAPSHOT = JSON.parse(await readFile(new URL("../games/world-map/data/geogrid.json", import.meta.url), "utf8"));
const ATLAS = createAtlas(SNAPSHOT, []);
const IMAGE_SETS = [{ id: "flags" }, { id: "portraits" }];
const TIME_ZONES = listTimeZones(SNAPSHOT.countries);
const BASE = "https://example.com/category-map";

function read(url) {
    return readSettings(url, ATLAS, IMAGE_SETS, TIME_ZONES);
}

test("settings URLs round-trip every display mode, city overlay, and exact or excluded filter", () => {
    const exact = ATLAS.numericRanges.find(range => range.sourceIds.includes("no_olympic_medals")).exact.choices[0];
    for (const mode of ["natural", "blank", "neighbors", "imagery", "criteria", "timezones"]) {
        const settings = {
            ...read(BASE),
            mode,
            projection: "flat",
            imageSet: "portraits",
            timeZone: "UTC+05:45",
            overlays: { capitals: true, largest: true, count: 10 },
            matchMode: "any",
            conditions: [
                { key: "color_on_flag:0", exclude: true },
                { key: exact.key, exclude: false },
                { key: "same_sex_marriage_legal:default", exclude: false },
            ],
        };
        assert.deepEqual(read(writeSettings(BASE, settings, "flags", ATLAS)), settings);
    }
    assert.equal(read(BASE + "?display=white").mode, "blank");
    assert.equal(read(BASE + "?display=images").mode, "imagery");
});

test("defaults keep the URL short and preserve unrelated parameters and fragments", () => {
    const url = BASE + "?help=1#sources";
    assert.equal(writeSettings(url, read(BASE), "flags", ATLAS), url);
    const active = writeSettings(url, { ...read(BASE), mode: "criteria", conditions: [{ key: "color_on_flag:0", exclude: false }] }, "flags", ATLAS);
    assert.equal(writeSettings(active, read(BASE), "flags", ATLAS), url);
});

test("invalid settings and unknown filter keys are reported without losing valid filters", () => {
    const settings = read(BASE + "?display=bad&view=flat&cities=20&capitals=true&images=missing&timezone=UTC%2B99%3A00&match=any&filter=missing&filter=color_on_flag%3A0");
    assert.equal(settings.warnings.length, 7);
    assert.equal(settings.mode, "natural");
    assert.equal(settings.overlays.count, 1);
    assert.equal(settings.imageSet, "flags");
    assert.equal(settings.matchMode, "any");
    assert.deepEqual(settings.conditions, [{ key: "color_on_flag:0", exclude: false }]);
    assert.ok(!writeSettings(BASE, settings, "flags", ATLAS).includes("missing"));
    assert.equal(read(BASE + "?display=images&display=criteria").warnings.length, 1);
});

test("duplicate filter keys use their last inclusion setting and encoded offsets survive", () => {
    assert.deepEqual(read(BASE + "?filter=color_on_flag:0&exclude=color_on_flag:0").conditions,
        [{ key: "color_on_flag:0", exclude: true }]);
    const url = writeSettings(BASE, { ...read(BASE), timeZone: "UTC+05:30" }, "flags", ATLAS);
    assert.equal(new URL(url).searchParams.get("timezone"), "UTC+05:30");
    assert.equal(read(url).timeZone, "UTC+05:30");
});

test("every original and numeric filter has an unambiguous friendly URL in both directions", () => {
    for (const choice of [...ATLAS.choices.values(), ...ATLAS.rangeChoices.values()]) {
        for (const exclude of [false, true]) {
            const settings = { ...read(BASE), conditions: [{ key: choice.key, exclude }] };
            const url = writeSettings(BASE, settings, "flags", ATLAS);
            assert.deepEqual(read(url), settings, choice.key);
            assert.ok(!url.includes("filter=") && !url.includes("exclude=") && !url.includes("_"), url);
        }
    }
});

test("friendly values are readable and old filter links upgrade without changing meaning", () => {
    const old = BASE + "?display=criteria&filter=color_on_flag%3A0&exclude=official_language%3A0&filter=numeric%3Arainfall%3Alower%3A500";
    const url = writeSettings(old, read(old), "flags", ATLAS);
    assert.equal(url, BASE + "?display=criteria&flag-color=red&not-official-language=arabic&rainfall-min=500");
    assert.deepEqual(read(url), read(old));
    assert.equal(read(BASE + "?flag-color=chartreuse").warnings.length, 1);
    const repeated = read(BASE + "?flag-color=red&flag-color=blue&not-flag-color=red");
    assert.deepEqual(repeated.conditions, [{ key: "color_on_flag:0", exclude: true }, { key: "color_on_flag:1", exclude: false }]);
});
