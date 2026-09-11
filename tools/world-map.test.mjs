import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { geoArea } from "d3-geo";
import { neighbors } from "topojson-client";
import { colorNeighbors, fitImage, listCities } from "../games/world-map/js/model.mjs";
import { createProjection, isVisible } from "../games/world-map/js/projection.mjs";
import { createRasterRenderer } from "../games/world-map/js/raster-gl.mjs";
import { getAssetUrl, validateImageSets } from "../games/world-map/js/imagery.mjs";
import { getFlagPlacement, validateImageBytes } from "./world-map-images.mjs";

assert.equal(getAssetUrl("img/flags/smr.svg"), "/category-map/img/flags/smr.svg");

for (const graph of [
    [],
    [[]],
    [[1], [0], []],
    [[1, 2], [0, 2], [0, 1]],
    Array.from({ length: 9 }, (_, index) => Array.from({ length: 9 }, (_, other) => other).filter(other => other !== index)),
]) {
    const colors = colorNeighbors(graph);
    assert.deepEqual(colors, colorNeighbors(graph));
    graph.forEach((neighbors, index) => neighbors.forEach(neighbor => assert.notEqual(colors[index], colors[neighbor])));
}

assert.deepEqual(fitImage(200, 100, [0, 0, 100, 100]), [-50, 0, 200, 100]);
assert.deepEqual(fitImage(200, 100, [0, 0, 100, 100], { fit: "contain" }), [0, 25, 100, 50]);
assert.deepEqual(fitImage(100, 200, [10, 20, 100, 100], { focalPoint: [0, 0] }), [10, 20, 100, 200]);
assert.deepEqual(fitImage(100, 100, [0, 0, 100, 100], { scale: 0.5, offset: [0.1, 0] }), [35, 25, 50, 50]);
assert.deepEqual(fitImage(200, 100, [10, 20, 300, 50], { fit: "stretch" }), [10, 20, 300, 50]);

const IMAGE_SET = { version: 1, sets: [{ id: "test", title: "Test", images: {
    AAA: { src: "img/example.svg", label: "Example", source: { url: "https://commons.wikimedia.org/wiki/File:Example.svg", license: "CC0" },
        placement: { fit: "stretch", rotation: -60, focalPoint: [0.5, 0.5], regions: { 1: { fit: "contain" } } } },
} }] };
validateImageSets(IMAGE_SET, new Set(["AAA"]));
assert.throws(() => validateImageSets(IMAGE_SET, new Set(["BBB"])), /Unmapped/);
for (const invalid of [
    { fit: "repeat" }, { focalPoint: [2, 0] }, { offset: [0] }, { scale: 0 },
    { rotation: 181 }, { background: "bad-color" }, { regions: { west: {} } },
]) {
    const set = structuredClone(IMAGE_SET);
    set.sets[0].images.AAA.placement = invalid;
    assert.throws(() => validateImageSets(set, new Set(["AAA"])));
}
const INVALID_PATH = structuredClone(IMAGE_SET);
INVALID_PATH.sets[0].images.AAA.src = "img/../private.svg";
assert.throws(() => validateImageSets(INVALID_PATH, new Set(["AAA"])), /Invalid image path/);

const CITIES = {
    AAA: { cities: [
        { id: "first", capitalRoles: [], rank: 1 },
        { id: "capital", capitalRoles: ["Capital"], rank: 3 },
        { id: "second-capital", capitalRoles: ["Legislative"], rank: null },
        { id: "tenth", capitalRoles: [], rank: 10 },
        { id: "eleventh", capitalRoles: [], rank: 11 },
    ] },
    BBB: { cities: [{ id: "other", capitalRoles: [], rank: 1 }] },
};
assert.equal(listCities(CITIES, { capitals: false, largest: false, count: 10 }).length, 0);
assert.equal(listCities(CITIES, { capitals: true, largest: false, count: 1 }).length, 2);
assert.equal(listCities(CITIES, { capitals: false, largest: true, count: 1 }).length, 2);
assert.equal(listCities(CITIES, { capitals: true, largest: true, count: 10 }).length, 5);
assert.equal(new Set(listCities(CITIES, { capitals: true, largest: true, count: 10 }).map(city => city.id)).size, 5);

for (const projection of ["globe", "flat"]) {
    for (const rotation of [[0, 0, 0], [-130, 60, 0], [179, -40, 0]]) {
        const view = { width: 800, height: 600, zoom: 1, rotation, pan: [0, 0], projection };
        const project = createProjection(view);
        for (const point of [[0, 0], [85, 28], [178, -18], [-178, 10], [-70, -40]]) {
            if (!isVisible(point, view)) continue;
            const restored = project.invert(project(point));
            assert.ok(Math.abs(restored[0] - point[0]) < 1e-7);
            assert.ok(Math.abs(restored[1] - point[1]) < 1e-7);
        }
    }
}
assert.equal(isVisible([180, 0], { projection: "globe", rotation: [0, 0, 0] }), false);
assert.equal(isVisible([0, 0], { projection: "globe", rotation: [0, 0, 0] }), true);
assert.equal(isVisible([180, 0], { projection: "flat", rotation: [0, 0, 0] }), true);

globalThis.document = {
    createElement: () => ({
        getContext: () => ({
            FRAGMENT_SHADER: 1,
            HIGH_FLOAT: 2,
            MAX_TEXTURE_SIZE: 3,
            getShaderPrecisionFormat: () => ({ precision: 23 }),
            getParameter: () => 2048,
        }),
    }),
};
assert.equal(createRasterRenderer(() => assert.fail("Unexpected renderer error"), 4096), null);
delete globalThis.document;

const MESSAGES = [];
globalThis.self = { postMessage: message => MESSAGES.push(message) };
await import("../games/world-map/js/raster-worker.mjs");
self.onmessage({ data: { type: "texture", id: "fixture", width: 2, height: 1, buffer: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]).buffer } });
assert.equal(MESSAGES.pop().type, "ready");
for (const projection of ["globe", "flat"]) {
    const view = { width: 100, height: 80, zoom: 1, rotation: [0, 0, 0], pan: [0, 0], projection };
    self.onmessage({ data: { type: "render", sequence: 1, texture: "fixture", view, ratio: 1 } });
    const frame = MESSAGES.pop();
    assert.equal(frame.type, "frame");
    const pixels = new Uint8ClampedArray(frame.buffer);
    assert.equal(pixels[3], 0);
    assert.deepEqual([...pixels.slice((40 * 100 + 45) * 4, (40 * 100 + 45) * 4 + 4)], [255, 0, 0, 255]);
    assert.deepEqual([...pixels.slice((40 * 100 + 55) * 4, (40 * 100 + 55) * 4 + 4)], [0, 255, 0, 255]);
}
self.onmessage({ data: { type: "render", sequence: 2, texture: "missing" } });
assert.equal(MESSAGES.pop().type, "error");
delete globalThis.self;

const WORLD = JSON.parse(await readFile(new URL("../games/world-map/data/world.json", import.meta.url), "utf8"));
const COUNTRY_IDS = new Set(WORLD.objects.countries.geometries.map(country => country.id));
assert.equal(COUNTRY_IDS.size, WORLD.objects.countries.geometries.length);
const ADJACENCY = neighbors(WORLD.objects.countries.geometries);
const COLORS = colorNeighbors(ADJACENCY);
ADJACENCY.forEach((adjacent, index) => adjacent.forEach(other => {
    assert.ok(ADJACENCY[other].includes(index));
    assert.notEqual(COLORS[index], COLORS[other]);
}));
const LAYERS = JSON.parse(await readFile(new URL("../games/world-map/data/layers.json", import.meta.url), "utf8"));
for (const layer of Object.values(LAYERS)) {
    assert.equal(layer.type, "FeatureCollection");
    assert.ok(layer.features.length > 0);
    for (const feature of layer.features) {
        const area = geoArea(feature);
        assert.ok(area > 0 && area < 2 * Math.PI);
    }
}
const IMAGES = JSON.parse(await readFile(new URL("../games/world-map/data/image-sets.json", import.meta.url), "utf8"));
validateImageSets(IMAGES, COUNTRY_IDS);
for (const set of IMAGES.sets) {
    for (const image of Object.values(set.images)) {
        const bytes = await readFile(new URL("../games/world-map/" + image.src, import.meta.url));
        assert.equal(createHash("sha256").update(bytes).digest("hex"), image.source.sha256);
    }
}
for (const [name, mime] of [
    ["portrait.svg", "image/svg+xml"], ["pixel.png", "image/png"],
    ["pixel.jpg", "image/jpeg"], ["pixel.webp", "image/webp"],
]) {
    const bytes = await readFile(new URL("./fixtures/world-map/" + name, import.meta.url));
    validateImageBytes(bytes, mime, "img/" + name);
    assert.throws(() => validateImageBytes(Buffer.from("invalid"), mime, "img/" + name));
    assert.throws(() => validateImageBytes(bytes, mime, "img/../" + name), /Invalid image path/);
}
assert.throws(() => validateImageBytes(Buffer.from("<svg><script>bad()</script></svg>"), "image/svg+xml", "img/test.svg"));
assert.throws(() => validateImageBytes(Buffer.from("<svg><image href=\"https://example.com/a.png\"/></svg>"), "image/svg+xml", "img/test.svg"));
assert.deepEqual(IMAGES.sets.find(set => set.id === "flags").images.NPL.placement, getFlagPlacement("NPL"));
console.log("World map assertions passed.");
