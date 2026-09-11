import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { feature } from "topojson-client";
import { createAtlas } from "../games/world-map/js/atlas.mjs";
import { boxesOverlap, getCalloutAnchors, layoutCallouts } from "../games/world-map/js/callouts.mjs";
import { createProjection, isVisible } from "../games/world-map/js/projection.mjs";

const WORLD = JSON.parse(await readFile(new URL("../games/world-map/data/world.json", import.meta.url), "utf8"));
const COUNTRIES = feature(WORLD, WORLD.objects.countries).features;
const measureText = text => text.length * 6;

function createView(projection, width = 800, height = 600) {
    return { projection, width, height, zoom: 1, rotation: [-10, -18, 0], pan: [0, 0] };
}

test("tiny countries have bounded, non-overlapping callouts in both projections", () => {
    const anchors = getCalloutAnchors(COUNTRIES);
    for (const type of ["globe", "flat"]) {
        for (const [width, height] of [[280, 330], [800, 600], [1200, 800]]) {
            const camera = createView(type, width, height);
            for (const mode of ["criteria", "imagery", "timezones"]) {
                const callouts = layoutCallouts(anchors, createProjection(camera), camera, measureText, { mode, selected: "SMR" });
                assert.ok(callouts.find(item => item.id === "SMR")?.box, "San Marino: " + type + "/" + width);
                assert.ok(callouts.find(item => item.id === "VAT"), "Vatican must have a marker");
                const labels = callouts.filter(item => item.box);
                const covered = labels.reduce((sum, item) => sum + (item.box[2] - item.box[0]) * (item.box[3] - item.box[1]), 0);
                assert.ok(covered <= width * height * 0.04, "Markers must not cover the map");
                labels.forEach((item, index) => {
                    assert.ok(isVisible(item.location, camera));
                    assert.ok(item.box[0] >= 4 && item.box[1] >= 4 && item.box[2] <= width - 4 && item.box[3] <= height - 4);
                    assert.ok(labels.slice(index + 1).every(other => !boxesOverlap(item.box, other.box)));
                    assert.ok(Math.abs(item.box[2] - item.box[0] - (mode === "imagery" ? 24 : 16)) < 1e-9);
                    assert.ok(Math.abs(item.box[3] - item.box[1] - 18) < 1e-9);
                    const [left, top, right, bottom] = item.box;
                    const [x, y] = item.point;
                    assert.ok(Math.hypot(Math.max(left - x, 0, x - right), Math.max(top - y, 0, y - bottom)) <= 51);
                    assert.ok(left + item.labelOffset[0] >= 4);
                    assert.ok(left + item.labelOffset[0] + item.labelWidth <= width - 4);
                });
                assert.deepEqual(callouts, layoutCallouts(anchors, createProjection(camera), camera, measureText, { mode, selected: "SMR" }));
            }
        }
    }
});

test("callouts disappear when large enough, offscreen, behind the globe, or in other fill modes", () => {
    const camera = createView("globe");
    const anchors = [
        { id: "small", name: "Small", location: [10, 18], area: 0.0001 },
        { id: "back", name: "Back", location: [-170, -18], area: 0 },
        { id: "large", name: "Large", location: [10, 18], area: 1 },
    ];
    const options = { mode: "criteria", selected: "small" };
    assert.deepEqual(layoutCallouts(anchors, createProjection(camera), camera, measureText, options).map(item => item.id), ["small"]);
    const zoomed = { ...camera, zoom: 12 };
    assert.equal(layoutCallouts(anchors, createProjection(zoomed), zoomed, measureText, options).length, 0);
    const panned = { ...createView("flat"), zoom: 12, pan: [10000, 10000] };
    assert.equal(layoutCallouts(anchors, createProjection(panned), panned, measureText, options).length, 0);
    for (const mode of ["natural", "blank", "neighbors"]) {
        assert.deepEqual(layoutCallouts(anchors, createProjection(camera), camera, measureText, { mode }), []);
    }
});

test("source-only locations get markers without invented polygons and archipelagos anchor to land", async () => {
    const snapshot = JSON.parse(await readFile(new URL("../games/world-map/data/geogrid.json", import.meta.url), "utf8"));
    const atlas = createAtlas(snapshot, COUNTRIES);
    const anchors = getCalloutAnchors(atlas.records);
    const tuvalu = anchors.find(item => item.id === "geogrid:tv");
    assert.ok(tuvalu);
    assert.deepEqual(tuvalu.location, snapshot.countries.tv.location);
    assert.equal(atlas.records.find(item => item.id === tuvalu.id).geometry, null);
    const camera = { ...createView("globe"), rotation: [-tuvalu.location[0], -tuvalu.location[1], 0] };
    assert.ok(layoutCallouts(anchors, createProjection(camera), camera, measureText, { mode: "criteria", selected: tuvalu.id }).find(item => item.id === tuvalu.id)?.box);
    const fiji = anchors.find(item => item.id === "FJI");
    assert.ok(fiji.location[0] > 170 && fiji.location[1] < -15);
    assert.throws(() => getCalloutAnchors([{ properties: { id: "bad", location: [181, 0] }, geometry: null }]), /Invalid callout/);
    assert.deepEqual(getCalloutAnchors([{ properties: { id: "missing" }, geometry: null }]), []);
});
