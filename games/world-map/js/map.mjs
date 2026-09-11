import { geoArea, geoCentroid, geoPath } from "d3-geo";
import { createProjection, isVisible } from "./projection.mjs";
import { getCountryId, IMAGE_ATLAS_WIDTH } from "./model.mjs";
import { createRasterRenderer } from "./raster-gl.mjs";
import { getCalloutAnchors, layoutCallouts } from "./callouts.mjs";

const WATER_COLOR = "#acd5e7";
const DEFAULT_ROTATION = [-10, -18, 0];

export function createMap(canvas, countries, layers, callbacks, calloutCountries = countries) {
    const context = canvas.getContext("2d");
    const rasterCanvas = document.createElement("canvas");
    const rasterContext = rasterCanvas.getContext("2d");
    const gpu = createRasterRenderer(callbacks.onError, IMAGE_ATLAS_WIDTH);
    const worker = new Worker(new URL("./raster-worker.mjs", import.meta.url));
    const textures = new Set();
    const pendingTextures = new Map();
    const pointers = new Map();
    const sphere = { type: "Sphere" };
    const land = { type: "FeatureCollection", features: countries };
    const paths = new Map();
    const anchors = getCalloutAnchors(calloutCountries);
    let pathView = "";
    const view = { width: 800, height: 600, projection: "globe", rotation: [...DEFAULT_ROTATION], pan: [0, 0], zoom: 1 };
    let renderedView = structuredClone(view);
    let projection = createProjection(view);
    let appearance = { mode: "natural", texture: "natural", colors: new Map(), selected: null, city: null, cities: [] };
    let sequence = 0;
    let frameSequence = -1;
    let busy = false;
    let inflight = null;
    let queued = null;
    let frameRequest = null;
    let hoverRequest = null;
    let hoverPoint = null;
    let settledTimer = null;
    let dragging = false;
    let start = null;
    let markers = [];
    let callouts = [];
    let pixelRatio = 1;
    let movingFrame = false;
    canvas.dataset.renderer = gpu ? "webgl" : "software";

    function getPath(geometry) {
        if (!paths.has(geometry)) {
            const path = new Path2D();
            if (geometry === land) {
                for (const country of countries) path.addPath(getPath(country));
            } else {
                path.addPath(new Path2D(geoPath(projection)(geometry) || ""));
            }
            paths.set(geometry, path);
        }
        return paths.get(geometry);
    }

    function drawGeometry(geometry, fill, stroke, width = 0.65) {
        const path = getPath(geometry);
        if (fill) {
            context.fillStyle = fill;
            context.fill(path);
        }
        if (stroke) {
            context.strokeStyle = stroke;
            context.lineWidth = width;
            context.stroke(path);
        }
    }

    function drawCities(occupied) {
        markers = [];
        const labels = [...occupied];
        const ordered = [...appearance.cities].sort((a, b) =>
            Number(b.id === appearance.city) - Number(a.id === appearance.city));
        context.font = "12px system-ui, sans-serif";
        context.textBaseline = "middle";
        for (const city of ordered) {
            const point = [city.longitude, city.latitude];
            if (!isVisible(point, renderedView)) continue;
            const [x, y] = projection(point);
            if (x < 8 || y < 8 || x > view.width - 8 || y > view.height - 8) continue;
            markers.push({ city, x, y });
            context.fillStyle = city.id === appearance.city ? "#ad361f" : "#202c35";
            context.strokeStyle = "#fff";
            context.lineWidth = 1.4;
            context.beginPath();
            if (city.isCapitalOrSeat) {
                context.moveTo(x, y - 5);
                context.lineTo(x + 5, y);
                context.lineTo(x, y + 5);
                context.lineTo(x - 5, y);
                context.closePath();
            } else {
                context.arc(x, y, 3.2, 0, Math.PI * 2);
            }
            context.fill();
            context.stroke();
            if (movingFrame && city.id !== appearance.city) continue;
            const width = context.measureText(city.name).width;
            const left = x + 8 + width > view.width - 4 ? x - 8 - width : x + 8;
            const box = [left - 2, y - 9, left + width + 2, y + 9];
            if (labels.some(other => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1])) continue;
            labels.push(box);
            context.strokeStyle = "#ffffff";
            context.lineWidth = 3.5;
            context.lineJoin = "round";
            context.strokeText(city.name, left, y);
            context.fillStyle = "#17212a";
            context.fillText(city.name, left, y);
        }
    }

    function drawCallouts() {
        context.font = "10px system-ui, sans-serif";
        callouts = layoutCallouts(anchors, projection, renderedView, name => context.measureText(name).width, appearance);
        for (const callout of callouts) {
            const [x, y] = callout.point;
            if (callout.box) {
                const [left, top, right, bottom] = callout.box;
                context.beginPath();
                context.moveTo(x, y);
                context.lineTo(Math.max(left, Math.min(right, x)), Math.max(top, Math.min(bottom, y)));
                context.strokeStyle = "#526572bb";
                context.lineWidth = 1;
                context.stroke();
            }
            context.beginPath();
            context.arc(x, y, 2, 0, Math.PI * 2);
            context.fillStyle = appearance.colors.get(callout.id) || "#dbdddf";
            context.fill();
            context.strokeStyle = "#45545d";
            context.lineWidth = 1;
            context.stroke();
        }
        callbacks.onCallouts?.(callouts, appearance);
    }

    function draw() {
        const key = JSON.stringify(renderedView);
        if (key !== pathView) {
            paths.clear();
            pathView = key;
        }
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.clearRect(0, 0, view.width, view.height);
        drawGeometry(sphere, WATER_COLOR);
        for (const country of countries) {
            drawGeometry(country, appearance.colors.get(getCountryId(country)) || "#e9e9e4");
        }
        const raster = textures.has(appearance.texture) && gpu
            ? gpu.render(appearance.texture, renderedView, projection, movingFrame ? Math.min(1, pixelRatio) : pixelRatio)
            : frameSequence === sequence ? rasterCanvas : null;
        if (raster && textures.has(appearance.texture)) {
            context.save();
            context.clip(getPath(land));
            context.drawImage(raster, 0, 0, view.width, view.height);
            context.restore();
        }
        if (appearance.mode === "natural" && layers.urban && !movingFrame) {
            drawGeometry(layers.urban, "#afa69a");
        }
        if (layers.lakes) drawGeometry(layers.lakes, WATER_COLOR);
        drawGeometry(land, null, "#48545bcc", 0.65);
        const selected = countries.find(country => getCountryId(country) === appearance.selected);
        if (selected) {
            drawGeometry(selected, null, "#ffffff", 3.5);
            drawGeometry(selected, null, "#202a32", 1.8);
        }
        drawGeometry(sphere, null, "#7a9bab", 1);
        drawCallouts();
        context.save();
        context.clip(getPath(sphere));
        drawCities(callouts.filter(callout => callout.box).map(callout => callout.box));
        context.restore();
    }

    function sendRaster() {
        if (busy || !queued) return;
        busy = true;
        inflight = queued;
        worker.postMessage(queued);
        queued = null;
    }

    function requestDraw(moving = false) {
        clearInspection();
        sequence++;
        if (frameRequest !== null) cancelAnimationFrame(frameRequest);
        frameRequest = requestAnimationFrame(() => {
            frameRequest = null;
            if (!gpu && appearance.texture && textures.has(appearance.texture)) {
                const maxWidth = moving ? 440 : 1500;
                const ratio = Math.min(pixelRatio, maxWidth / view.width);
                queued = { type: "render", sequence, texture: appearance.texture, view: structuredClone(view), ratio, moving };
                sendRaster();
            } else {
                movingFrame = moving;
                renderedView = structuredClone(view);
                projection = createProjection(renderedView);
                frameSequence = -1;
                draw();
            }
        });
    }

    worker.onmessage = function(event) {
        const message = event.data;
        if (message.type === "ready") {
            textures.add(message.id);
            pendingTextures.get(message.id)?.resolve();
            pendingTextures.delete(message.id);
            if (appearance.texture === message.id) requestDraw();
            return;
        }
        busy = false;
        if (message.type === "error") {
            callbacks.onError(new Error(message.message));
        } else if (inflight && inflight.texture === appearance.texture &&
            inflight.view.width === view.width && inflight.view.height === view.height) {
            // Present imagery and vectors from the same view, even while a newer drag frame waits.
            renderedView = inflight.view;
            movingFrame = inflight.moving;
            projection = createProjection(renderedView);
            rasterCanvas.width = message.width;
            rasterCanvas.height = message.height;
            rasterContext.putImageData(new ImageData(new Uint8ClampedArray(message.buffer), message.width, message.height), 0, 0);
            frameSequence = sequence;
            draw();
        }
        sendRaster();
    };
    worker.onerror = function(event) {
        busy = false;
        const error = new Error(event.message || "Map rendering failed");
        for (const pending of pendingTextures.values()) pending.reject(error);
        pendingTextures.clear();
        callbacks.onError(error);
    };

    function scheduleSettle() {
        clearTimeout(settledTimer);
        settledTimer = setTimeout(() => requestDraw(), 120);
    }

    function zoomBy(factor, point = [view.width / 2, view.height / 2]) {
        const previous = view.zoom;
        view.zoom = Math.max(1, Math.min(12, previous * factor));
        if (view.projection === "flat") {
            const ratio = view.zoom / previous;
            view.pan = [
                point[0] - view.width / 2 - (point[0] - view.width / 2 - view.pan[0]) * ratio,
                point[1] - view.height / 2 - (point[1] - view.height / 2 - view.pan[1]) * ratio,
            ];
            boundPan();
        }
        requestDraw(true);
        scheduleSettle();
    }

    function boundPan() {
        view.pan[0] = Math.max(-view.width * (view.zoom - 1) / 2, Math.min(view.width * (view.zoom - 1) / 2, view.pan[0]));
        view.pan[1] = Math.max(-view.height * (view.zoom - 1) / 2, Math.min(view.height * (view.zoom - 1) / 2, view.pan[1]));
    }

    function moveBy(dx, dy) {
        if (view.projection === "globe") {
            view.rotation[0] = (view.rotation[0] + dx / projection.scale() * 60) % 360;
            view.rotation[1] = Math.max(-89.9, Math.min(89.9, view.rotation[1] - dy / projection.scale() * 60));
        } else {
            view.pan[0] += dx;
            view.pan[1] += dy;
            boundPan();
        }
        requestDraw(true);
    }

    function getPoint(event) {
        const rect = canvas.getBoundingClientRect();
        return [event.clientX - rect.left, event.clientY - rect.top];
    }

    function inspect(point) {
        const callout = [...callouts].sort((a, b) =>
            Math.hypot(a.point[0] - point[0], a.point[1] - point[1]) - Math.hypot(b.point[0] - point[0], b.point[1] - point[1]))
            .find(item => Math.hypot(item.point[0] - point[0], item.point[1] - point[1]) < 7);
        if (callout) {
            return { id: callout.id, name: callout.name, point };
        }
        const marker = [...markers].sort((a, b) =>
            Math.hypot(a.x - point[0], a.y - point[1]) - Math.hypot(b.x - point[0], b.y - point[1]))
            .find(item => Math.hypot(item.x - point[0], item.y - point[1]) < 12);
        if (marker) {
            const country = countries.find(item => getCountryId(item) === marker.city.country);
            return { id: marker.city.country, name: country.properties.name + ": " + marker.city.name, point, city: marker.city };
        }
        const location = projection.invert(point);
        if (!location || !isVisible(location, renderedView)) return null;
        const roundTrip = projection(location);
        if (Math.hypot(roundTrip[0] - point[0], roundTrip[1] - point[1]) > 1) return null;
        const country = countries.find(item => context.isPointInPath(getPath(item), point[0] * pixelRatio, point[1] * pixelRatio));
        return country ? { id: getCountryId(country), name: country.properties.name, point } : null;
    }

    function clearInspection() {
        if (hoverRequest !== null) cancelAnimationFrame(hoverRequest);
        hoverRequest = null;
        hoverPoint = null;
        callbacks.onInspect?.(null);
    }

    function hover(point) {
        hoverPoint = point;
        if (hoverRequest !== null) return;
        hoverRequest = requestAnimationFrame(() => {
            hoverRequest = null;
            if (!pointers.size) callbacks.onInspect?.(inspect(hoverPoint));
        });
    }

    function pick(point) {
        const hit = inspect(point);
        if (hit?.city) callbacks.onCity(hit.city);
        else callbacks.onCountry(hit?.id ?? null);
        callbacks.onInspect?.(hit);
    }

    canvas.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        clearInspection();
        canvas.setPointerCapture(event.pointerId);
        pointers.set(event.pointerId, getPoint(event));
        if (pointers.size === 1) {
            start = getPoint(event);
            dragging = false;
        } else {
            dragging = true;
        }
    });
    canvas.addEventListener("pointermove", event => {
        const previous = pointers.get(event.pointerId);
        if (!previous) {
            if (!pointers.size && event.pointerType !== "touch") hover(getPoint(event));
            return;
        }
        const point = getPoint(event);
        const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
        if (other) {
            const oldDistance = Math.hypot(previous[0] - other[0], previous[1] - other[1]);
            const newDistance = Math.hypot(point[0] - other[0], point[1] - other[1]);
            if (oldDistance > 0) zoomBy(newDistance / oldDistance, [(point[0] + other[0]) / 2, (point[1] + other[1]) / 2]);
        } else if (dragging || Math.hypot(point[0] - start[0], point[1] - start[1]) > 4) {
            dragging = true;
            moveBy(point[0] - previous[0], point[1] - previous[1]);
        }
        pointers.set(event.pointerId, point);
    });
    canvas.addEventListener("pointerup", event => {
        if (!pointers.has(event.pointerId)) return;
        const tapped = !dragging && pointers.size === 1;
        pointers.delete(event.pointerId);
        if (!pointers.size) requestDraw();
        if (tapped) pick(getPoint(event));
    });
    canvas.addEventListener("pointercancel", event => {
        pointers.delete(event.pointerId);
        requestDraw();
    });
    canvas.addEventListener("pointerleave", event => {
        if (event.pointerType !== "touch") clearInspection();
    });
    function zoomFromWheel(event) {
        event.preventDefault();
        zoomBy(Math.exp(-event.deltaY * 0.0015), getPoint(event));
    }
    canvas.addEventListener("wheel", zoomFromWheel, { passive: false });
    canvas.addEventListener("keydown", event => {
        const movement = { ArrowLeft: [-35, 0], ArrowRight: [35, 0], ArrowUp: [0, -35], ArrowDown: [0, 35] }[event.key];
        if (movement) {
            event.preventDefault();
            moveBy(...movement);
            scheduleSettle();
        } else if (event.key === "+" || event.key === "=" || event.key === "-") {
            event.preventDefault();
            zoomBy(event.key === "-" ? 0.8 : 1.25);
        } else if (event.key === "Home") {
            event.preventDefault();
            reset();
        } else if (event.key === "Escape") {
            clearInspection();
        }
    });

    function reset() {
        view.rotation = [...DEFAULT_ROTATION];
        view.pan = [0, 0];
        view.zoom = 1;
        requestDraw();
    }

    const observer = new ResizeObserver(entries => {
        const { width, height } = entries[0].contentRect;
        if (!width || !height) return;
        view.width = width;
        view.height = height;
        pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * pixelRatio);
        canvas.height = Math.round(height * pixelRatio);
        boundPan();
        requestDraw();
    });
    observer.observe(canvas);

    function focus(location) {
        if (view.projection === "globe") {
            view.rotation = [-location[0], -location[1], 0];
        } else {
            view.zoom = Math.max(2.5, view.zoom);
            view.pan = [0, 0];
            const point = createProjection(view)(location);
            view.pan = [view.width / 2 - point[0], view.height / 2 - point[1]];
            boundPan();
        }
        requestDraw();
    }

    return {
        update(next) {
            appearance = { ...appearance, ...next };
            requestDraw();
        },
        setProjection(value) {
            view.projection = value;
            requestDraw();
        },
        setTexture(id, image) {
            if (gpu) {
                gpu.setTexture(id, image);
                textures.add(id);
                requestDraw();
                return Promise.resolve();
            } else {
                return new Promise((resolve, reject) => {
                    pendingTextures.set(id, { resolve, reject });
                    worker.postMessage({ type: "texture", id, width: image.width, height: image.height, buffer: image.data.buffer }, [image.data.buffer]);
                });
            }
        },
        focusCountry(id) {
            const country = countries.find(item => getCountryId(item) === id);
            let geometry = country.geometry;
            if (geometry.type === "MultiPolygon") {
                geometry = geometry.coordinates.map(coordinates => ({ type: "Polygon", coordinates }))
                    .sort((a, b) => geoArea(b) - geoArea(a))[0];
            }
            focus(geoCentroid(geometry));
        },
        focusCity(city) {
            focus([city.longitude, city.latitude]);
        },
        focusLocation: focus,
        reset,
        zoomBy,
        zoomFromWheel,
    };
}
