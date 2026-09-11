import assert from "node:assert/strict";
import { test } from "node:test";
import { buildImageAtlas } from "../games/world-map/js/imagery.mjs";

test("image preparation reports every completed flag and yields without animation frames", async () => {
    const countries = Array.from({ length: 21 }, (_, id) => ({
        type: "Feature",
        properties: { id },
        geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] },
    }));
    const images = Object.fromEntries(countries.map(country => [country.properties.id, { src: "img/flags/test.svg" }]));
    const requests = [];
    const progress = [];
    const pixels = { width: 4096, height: 2048 };
    const context = {
        save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
        arc() {}, clip() {}, fillRect() {}, translate() {}, rotate() {}, drawImage() {},
        getImageData() { return pixels; },
    };
    const previous = { document: globalThis.document, Image: globalThis.Image, requestAnimationFrame: globalThis.requestAnimationFrame };
    globalThis.document = { createElement: () => ({ getContext: () => context }) };
    globalThis.Image = class {
        naturalWidth = 20;
        naturalHeight = 10;
        set src(value) {
            requests.push(value);
            queueMicrotask(() => this.onload());
        }
    };
    globalThis.requestAnimationFrame = () => { throw new Error("Background loading must not wait for a visible frame"); };
    try {
        assert.equal(await buildImageAtlas(countries, { images }, (loaded, total) => progress.push([loaded, total])), pixels);
        assert.equal(requests.length, 21);
        assert.deepEqual(progress, Array.from({ length: 22 }, (_, loaded) => [loaded, 21]));
        globalThis.Image = class {
            set src(value) { queueMicrotask(() => this.onerror()); }
        };
        await assert.rejects(buildImageAtlas(countries, { images }, () => {}), /Couldn't load/);
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
    }
});
