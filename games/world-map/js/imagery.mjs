import { geoArea, geoBounds, geoEquirectangular, geoPath } from "d3-geo";
import { fitImage, getCountryId, IMAGE_ATLAS_WIDTH, validateImagePath } from "./model.mjs";

const ATLAS_WIDTH = IMAGE_ATLAS_WIDTH;
const ATLAS_HEIGHT = ATLAS_WIDTH / 2;

function validatePlacement(placement, region = false) {
    if (!placement || typeof placement !== "object" || Array.isArray(placement)) throw new Error("Invalid image placement");
    if (placement.fit !== undefined && !["cover", "contain", "stretch"].includes(placement.fit)) throw new Error("Invalid image fit");
    for (const key of ["focalPoint", "offset"]) {
        const values = placement[key];
        if (values !== undefined && (!Array.isArray(values) || values.length !== 2 ||
            values.some(value => !Number.isFinite(value) || (key === "focalPoint" && (value < 0 || value > 1))))) {
            throw new Error("Invalid image " + key);
        }
    }
    if (placement.scale !== undefined && (!Number.isFinite(placement.scale) || placement.scale <= 0)) throw new Error("Invalid image scale");
    if (placement.rotation !== undefined && (!Number.isFinite(placement.rotation) || Math.abs(placement.rotation) > 180)) throw new Error("Invalid image rotation");
    if (placement.background !== undefined && !/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(placement.background)) {
        throw new Error("Invalid image background");
    }
    if (placement.regions !== undefined) {
        if (region || !placement.regions || typeof placement.regions !== "object" || Array.isArray(placement.regions)) {
            throw new Error("Invalid image regions");
        }
        for (const [key, override] of Object.entries(placement.regions)) {
            if (!/^(0|[1-9][0-9]*)$/.test(key)) throw new Error("Invalid image region index");
            validatePlacement(override, true);
        }
    }
}

export function validateImageSets(manifest, countryIds) {
    if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.sets) || !manifest.sets.length) throw new Error("Invalid image sets");
    const ids = new Set();
    for (const set of manifest.sets) {
        if (!set || !/^[a-z][a-z0-9-]*$/.test(set.id) || ids.has(set.id) || typeof set.title !== "string" || !set.title.trim() ||
            !set.images || typeof set.images !== "object" || Array.isArray(set.images)) {
            throw new Error("Invalid image set");
        }
        ids.add(set.id);
        for (const [country, image] of Object.entries(set.images)) {
            if (!countryIds.has(country)) throw new Error("Unmapped image country: " + country);
            if (!image || typeof image.label !== "string" || !image.label.trim() ||
                !image.source?.license || !image.source?.url) throw new Error("Missing image credit: " + country);
            if (new URL(image.source.url).protocol !== "https:") throw new Error("Invalid image source: " + country);
            getAssetUrl(image.src);
            if (image.placement !== undefined) validatePlacement(image.placement);
        }
    }
}

export function loadImage(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Couldn't load " + src));
        image.src = src;
    });
}

export function getAssetUrl(src) {
    return "/category-map/" + validateImagePath(src);
}

function getBox(geometry) {
    const [[west, south], [east, north]] = geoBounds(geometry);
    return [west, south, east < west ? east + 360 : east, north];
}

function groupRegions(country) {
    const polygons = country.geometry.type === "Polygon" ? [country.geometry.coordinates] : country.geometry.coordinates;
    const regions = polygons.map(coordinates => ({ type: "Polygon", coordinates }));
    regions.sort((a, b) => geoArea(b) - geoArea(a));
    const groups = [];
    for (const region of regions) {
        const box = getBox(region);
        const center = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
        const group = groups.find(candidate => {
            const bounds = candidate.bounds;
            const longitude = center[0] + 360 * Math.round(((bounds[0] + bounds[2]) / 2 - center[0]) / 360);
            const margin = Math.max(2, Math.min(8, (bounds[2] - bounds[0]) * 0.15));
            return longitude >= bounds[0] - margin && longitude <= bounds[2] + margin &&
                center[1] >= bounds[1] - margin && center[1] <= bounds[3] + margin;
        });
        if (group) {
            group.geometry.coordinates.push(region.coordinates);
            group.bounds = getBox(group.geometry);
        } else {
            groups.push({ geometry: { type: "MultiPolygon", coordinates: [region.coordinates] }, bounds: box });
        }
    }
    return groups;
}

export async function buildImageAtlas(countries, imageSet, onProgress) {
    const canvas = document.createElement("canvas");
    canvas.width = ATLAS_WIDTH;
    canvas.height = ATLAS_HEIGHT;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const projection = geoEquirectangular().scale(ATLAS_WIDTH / (2 * Math.PI)).translate([ATLAS_WIDTH / 2, ATLAS_HEIGHT / 2]);
    const path = geoPath(projection, context);
    let loaded = 0;
    for (const country of countries) {
        const entry = imageSet.images[getCountryId(country)];
        if (!entry) continue;
        const image = await loadImage(getAssetUrl(entry.src));
        const groups = groupRegions(country);
        groups.forEach((group, index) => {
            const placement = { ...entry.placement, ...entry.placement?.regions?.[index] };
            const [west, south, east, north] = group.bounds;
            const box = [
                (west + 180) / 360 * ATLAS_WIDTH,
                (90 - north) / 180 * ATLAS_HEIGHT,
                (east - west) / 360 * ATLAS_WIDTH,
                (north - south) / 180 * ATLAS_HEIGHT,
            ];
            if (!box[2] || !box[3]) return;
            context.save();
            context.beginPath();
            path(group.geometry);
            context.clip();
            context.fillStyle = placement.background || "#ffffff";
            context.fillRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);
            const [x, y, width, height] = fitImage(image.naturalWidth, image.naturalHeight, box, placement);
            for (const offset of [-ATLAS_WIDTH, 0, ATLAS_WIDTH]) {
                context.save();
                context.translate(x + offset + width / 2, y + height / 2);
                context.rotate((placement.rotation || 0) * Math.PI / 180);
                context.drawImage(image, -width / 2, -height / 2, width, height);
                context.restore();
            }
            context.restore();
        });
        loaded++;
        if (loaded % 20 === 0) {
            onProgress(loaded);
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
    }
    return context.getImageData(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);
}

export async function loadTerrain(src) {
    const image = await loadImage(src);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height);
}
